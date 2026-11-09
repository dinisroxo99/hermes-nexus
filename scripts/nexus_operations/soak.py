"""Observe the running Nexus service on a numeric loopback address."""
import datetime as dt
import http.client
import ipaddress
import json
import math
import os
import socket
import threading
from pathlib import Path
import time
from urllib.parse import quote, urlsplit

MAX_RESPONSE = 256 * 1024


def endpoint(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.path not in ("", "/") or parsed.query or parsed.fragment
            or parsed.username is not None or parsed.password is not None
            or not ipaddress.ip_address(parsed.hostname or "").is_loopback):
        raise ValueError("expected_loopback_http_origin")
    return parsed.hostname, parsed.port or 80


def get_json(origin, path, body=None, timeout=5):
    connection = http.client.HTTPConnection(*origin, timeout=timeout)
    deadline = time.monotonic() + timeout
    timer = None
    try:
        connection.connect()
        sock = connection.sock
        def expire():
            # Abort the whole response even if the service trickles bytes within each socket timeout.
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        timer = threading.Timer(max(0, deadline - time.monotonic()), expire)
        timer.daemon = True
        timer.start()
        payload = json.dumps(body) if body is not None else None
        connection.request("POST" if payload else "GET", path, payload, {"Content-Type": "application/json"})
        response = connection.getresponse()
        raw = response.read(MAX_RESPONSE + 1)
        if response.status != 200 or len(raw) > MAX_RESPONSE:
            return None
        envelope = json.loads(raw)
        if isinstance(envelope, dict) and envelope.get("ok") is True and isinstance(envelope.get("data"), dict):
            return envelope["data"]
    except (OSError, ValueError, http.client.HTTPException, RecursionError):
        return None
    finally:
        if timer:
            timer.cancel()
        connection.close()
    return None


def local_process_sample(pid):
    """Linux /proc start-time ticks bind two samples to one process; PID reuse starts a different series."""
    if pid is None:
        return None
    try:
        proc = Path("/proc") / str(pid)
        cols = (proc / "stat").read_text().rsplit(")", 1)[1].split()
        return int(cols[19]), (int(cols[11]) + int(cols[12])) / os.sysconf("SC_CLK_TCK"), int(cols[21]) * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError, TypeError):
        return None


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def verify_service(url, seconds, interval, project_id=None, pid=None, checkpoint=None):
    if not 0 <= seconds <= 604800 or not 1 <= interval <= 3600:
        raise ValueError("invalid_observation_period")
    origin = endpoint(url)
    if project_id is not None and (not project_id or len(project_id) > 128 or not project_id.isascii()):
        raise ValueError("invalid_project_id")
    if pid is not None and pid <= 0:
        raise ValueError("invalid_pid")
    started = time.monotonic()
    until = started + seconds
    previous = previous_start = process_first = process_last = rss_peak = None
    consecutive_process = True
    process_samples = 0
    report = {"schemaVersion": 1, "startedAt": now(), "requestedSeconds": seconds, "intervalSeconds": interval,
              "samples": 0, "livenessFailures": 0, "readinessFailures": 0, "uptimeRestartsObserved": 0,
              "contextProbeFailures": 0 if project_id else None, "contextPartialSamples": 0 if project_id else None,
              "maxSamplingGapSeconds": 0}
    while True:
        stamp = time.monotonic()
        if previous is not None:
            report["maxSamplingGapSeconds"] = max(report["maxSamplingGapSeconds"], round(stamp - previous, 2))
        previous = stamp
        report["samples"] += 1
        health = get_json(origin, "/api/health") or {}
        uptime = health.get("uptime")
        if (health.get("status") != "ok" or type(uptime) not in (int, float)
                or not math.isfinite(uptime) or uptime < 0):
            report["livenessFailures"] += 1
        else:
            # Measure at receipt, so latency in unrelated endpoints cannot create a spurious restart.
            process_start = time.monotonic() - uptime
            if previous_start is not None and process_start > previous_start + 2:
                report["uptimeRestartsObserved"] += 1
            previous_start = process_start
        if (get_json(origin, "/api/ready") or {}).get("ready") is not True:
            report["readinessFailures"] += 1
        if project_id:
            pack = get_json(origin, "/api/intelligence/projects/" + quote(project_id, safe="") + "/task-context",
                            {"task": {"title": "Operational readiness sample"}, "limits": {"maxBytes": 16384}})
            if not pack or pack.get("projectId") != project_id or pack.get("analysisVersion") != "task-context-v1":
                report["contextProbeFailures"] += 1
            elif pack.get("observation", {}).get("incomplete") is True:
                report["contextPartialSamples"] += 1
        sample = local_process_sample(pid)
        if sample:
            process_samples += 1
            if process_first is None:
                process_first = sample
            consecutive_process &= process_first[0] == sample[0]
            process_last = sample
            rss_peak = max(rss_peak or 0, sample[2])
        if checkpoint:
            checkpoint({**report, "status": "in_progress", "sampledAt": now(), "elapsedSeconds": round(time.monotonic() - started, 2)})
        if stamp >= until:
            break
        remaining = min(stamp + interval, until) - time.monotonic()
        if remaining > 0:
            time.sleep(remaining)
    complete_process = process_samples == report["samples"] and consecutive_process
    report.update(endedAt=now(), elapsedSeconds=round(time.monotonic() - started, 2),
                  processMetrics={"samples": process_samples, "complete": complete_process if pid is not None else None,
                                  "peakRssBytes": rss_peak,
                                  "cpuSecondsBetweenSamples": round(process_last[1] - process_first[1], 3)
                                  if complete_process and process_samples > 1 else None})
    report["status"] = "degraded" if (report["livenessFailures"] or report["readinessFailures"]
                                      or report["contextProbeFailures"] or report["uptimeRestartsObserved"]
                                      or report["maxSamplingGapSeconds"] > interval + 5
                                      or (pid is not None and not complete_process)) else "healthy"
    if checkpoint:
        checkpoint(report)
    return report
