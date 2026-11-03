import assert from "node:assert/strict";
import test from "node:test";
import { TOOL, handleTool } from "./ai.js";
import { state } from "./runtime.js";

function setup() {
  Object.assign(state, {
    probed: true,
    tracked: true,
    error: null,
    adbPath: "C:/secret/adb.exe",
    scrcpyPath: "C:/secret/scrcpy.exe",
    devices: [
      { serial: "AAA", state: "device", model: "POCO", product: "p", transport: "usb" },
      { serial: "BBB", state: "unauthorized", model: "", product: "", transport: "usb" },
    ],
  });
  state.mirrors.clear();
  /** @type {string[]} */
  const calls = [];
  state.onStart = (serial) => {
    calls.push(`start:${serial}`);
    state.mirrors.set(serial, { handle: 1, offset: 0, title: "t" });
  };
  state.onStop = (serial) => {
    calls.push(`stop:${serial}`);
    state.mirrors.delete(serial);
  };
  return calls;
}

test("status lists devices without tool paths", () => {
  setup();
  const result = handleTool({ action: "status" });
  assert.equal(result.adbFound, true);
  assert.deepEqual(result.devices[0], { serial: "AAA", model: "POCO", connected: true, state: "device", mirroring: false });
  assert.equal(result.devices[1].connected, false);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test("status answers with a sentence before tools are found", () => {
  setup();
  state.probed = false;
  assert.match(handleTool({ action: "status" }).message, /looking for adb/);
});

test("start only reaches a known, ready device", async () => {
  const calls = setup();
  assert.ok((await handleTool({ action: "start" })).error);
  assert.ok((await handleTool({ action: "start", serial: "--shell" })).error);
  assert.ok((await handleTool({ action: "start", serial: "BBB" })).error);
  assert.deepEqual(calls, []);
  assert.equal((await handleTool({ action: "start", serial: "AAA" })).mirroring, true);
  assert.deepEqual(calls, ["start:AAA"]);
});

test("stop ends a mirror and leaves an unknown serial alone", async () => {
  const calls = setup();
  await handleTool({ action: "start", serial: "AAA" });
  assert.equal((await handleTool({ action: "stop", serial: "nope" })).mirroring, false);
  assert.equal((await handleTool({ action: "stop", serial: "AAA" })).mirroring, false);
  assert.deepEqual(calls, ["start:AAA", "stop:AAA"]);
});

test("an action outside the enum does nothing", () => {
  assert.ok(handleTool({ action: "shell" }).error);
  assert.deepEqual(TOOL.parameters.properties.action.enum, ["status", "open", "start", "stop"]);
});
