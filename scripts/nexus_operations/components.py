"""Explicit read-only probes for additional components on the operator's loopback host."""
import json
import re
from urllib.parse import urlsplit

from .soak import endpoint, get_json

NAMES = {"gateway", "dispatcher", "inference", "memory", "history"}


def load_components(config_file):
    with open(config_file, "rb") as stream:
        raw = stream.read(16385)
    if len(raw) > 16384:
        raise ValueError("invalid_component_config")
    config = json.loads(raw)
    if not isinstance(config, dict) or not config or not config.keys() <= NAMES:
        raise ValueError("invalid_component_config")
    for rule in config.values():
        if not isinstance(rule, dict) or set(rule) != {"url", "field", "equals"}:
            raise ValueError("invalid_component_config")
        if not isinstance(rule["url"], str) or len(rule["url"]) > 512:
            raise ValueError("invalid_component_config")
        url = urlsplit(rule["url"])
        endpoint(f"{url.scheme}://{url.netloc}")
        if (url.query or url.fragment or not url.path.startswith("/") or url.path.startswith("//")
                or len(url.path) > 256 or not re.fullmatch(r"/[A-Za-z0-9_./-]*", url.path) or ".." in url.path.split("/")
                or not isinstance(rule["field"], list) or not 1 <= len(rule["field"]) <= 6):
            raise ValueError("invalid_component_config")
        for step in rule["field"]:
            if type(step) is int and 0 <= step < 32:
                continue
            if not isinstance(step, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", step):
                raise ValueError("invalid_component_config")
        expected = rule["equals"]
        if (type(expected) not in (str, bool, int) or isinstance(expected, str) and len(expected) > 128
                or type(expected) is int and not -2**53 < expected < 2**53):
            raise ValueError("invalid_component_config")
    return config


def sample_components(rules):
    states = {}
    for name, rule in rules.items():
        url = urlsplit(rule["url"])
        value = get_json(endpoint(f"{url.scheme}://{url.netloc}"), url.path, envelope=False)
        try:
            for step in rule["field"]:
                if type(step) is int:
                    if not isinstance(value, list):
                        raise TypeError
                elif not isinstance(value, dict):
                    raise TypeError
                value = value[step]
            states[name] = type(value) is type(rule["equals"]) and value == rule["equals"]
        except (IndexError, KeyError, TypeError):
            states[name] = False
    return states
