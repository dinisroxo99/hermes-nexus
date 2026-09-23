import { once } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveBindAddress, server, startServer } from "../src/server.js";

test("bind address defaults to the existing wildcard and preserves an explicit loopback value", () => {
  assert.equal(resolveBindAddress({}), "0.0.0.0");
  assert.equal(resolveBindAddress({ HOST: "127.0.0.1" }), "127.0.0.1");
});

test("bind address rejects explicitly empty or whitespace-only HOST values", () => {
  for (const HOST of ["", " ", "\t\r\n"]) {
    assert.throws(() => resolveBindAddress({ HOST }), {
      name: "TypeError",
      message: "HOST must contain a bind address when set."
    });
  }
});

test("startup passes HOST to the listener and reports its effective address and port", () => {
  const calls = [];
  const messages = [];
  const listener = {
    address: () => ({ address: "127.0.0.1", port: 43210 }),
    listen(port, host, callback) {
      calls.push({ port, host });
      callback();
      return this;
    }
  };

  const result = startServer({
    env: { HOST: "127.0.0.1", PORT: "43210" },
    listener,
    log: (message) => messages.push(message)
  });

  assert.equal(result, listener);
  assert.deepEqual(calls, [{ port: 43210, host: "127.0.0.1" }]);
  assert.deepEqual(messages, ["Hermes Nexus ativo em http://127.0.0.1:43210"]);
});

test("server health route starts only on loopback and fully closes its listener", async () => {
  const messages = [];
  const listening = once(server, "listening");
  startServer({
    env: { HOST: "127.0.0.1", PORT: "0" },
    log: (message) => messages.push(message)
  });
  await listening;

  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    assert.ok(address.port > 0);
    assert.deepEqual(messages, [`Hermes Nexus ativo em http://127.0.0.1:${address.port}`]);

    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.status, "ok");
    assert.equal(typeof payload.data.uptime, "number");
    assert.equal(typeof payload.data.timestamp, "string");
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  assert.equal(server.listening, false);
  assert.equal(server.address(), null);
});
