// Smoke tests for the vendored mbus-client (src/transport/mbus). The library
// itself is tested upstream (mbus/packages/mbus-client); these only guard the
// vendoring — that the copy compiles under mdrone's test tsconfig and the
// protocol layer round-trips — so a bad re-sync fails fast.

import { test } from "node:test";
import assert from "node:assert/strict";

const { createMbusClient } = await import("../.test-dist/transport/mbus/client.js");
const { MBUS_VERSION, outbound, parseServerMessage } = await import(
  "../.test-dist/transport/mbus/protocol.js"
);

test("vendored mbus-client exposes the client factory", () => {
  assert.equal(typeof createMbusClient, "function");
});

test("outbound frames round-trip as JSON", () => {
  assert.deepEqual(JSON.parse(outbound.hello()), { type: "mbus/hello", mbus: MBUS_VERSION });
  assert.deepEqual(JSON.parse(outbound.announce("mdrone")), {
    type: "mbus/announce",
    name: "mdrone",
  });
});

test("parseServerMessage accepts a welcome and ignores non-mbus traffic", () => {
  const welcome = JSON.stringify({
    type: "mbus/welcome",
    clientId: "c1",
    mbus: MBUS_VERSION,
    sources: [{ sourceId: "s1", name: "mdrone", clientId: "c2" }],
  });
  assert.deepEqual(parseServerMessage(welcome), {
    type: "welcome",
    clientId: "c1",
    mbus: MBUS_VERSION,
    sources: [{ sourceId: "s1", name: "mdrone", clientId: "c2" }],
  });
  assert.equal(parseServerMessage(JSON.stringify({ type: "link/tempo", bpm: 120 })), null);
  assert.equal(parseServerMessage("not json"), null);
});
