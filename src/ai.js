import { ctx, state } from "./runtime.js";
import { sleep } from "./adb.js";

const MAX_DEVICES = 32;
const SETTLE_MS = 5000;

/** @type {import("../tedi").ContributedAiTool} */
export const TOOL = {
  name: "android_mirror",
  description:
    "Android Mirror: phones seen over adb, mirrored with scrcpy. status: tools found and devices (serial, model, connected, mirroring). open: show the panel. start/stop: scrcpy for a serial; start opens a desktop window. No shell, input, install or file access.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["status", "open", "start", "stop"] },
      serial: { type: "string", description: "For start and stop." },
    },
    required: ["action"],
  },
  approval: "needsApproval",
};

function summary() {
  if (!state.probed) return "Still looking for adb and scrcpy.";
  if (state.error) return state.error.slice(0, 300);
  if (!state.adbPath) return "adb was not found. Install Android platform-tools, then press Refresh in the panel.";
  if (!state.tracked) return "Waiting for adb to report devices.";
  if (state.devices.length === 0) return "No devices. Plug in a phone with USB debugging on, or connect one over Wi-Fi in the panel.";
  return `${state.devices.length} device(s), ${state.mirrors.size} mirroring.`;
}

function status() {
  return {
    adbFound: Boolean(state.adbPath),
    scrcpyFound: Boolean(state.scrcpyPath),
    devices: state.devices.slice(0, MAX_DEVICES).map((device) => ({
      serial: device.serial,
      model: device.model,
      connected: device.state === "device",
      state: device.state,
      mirroring: state.mirrors.has(device.serial),
    })),
    message: summary(),
  };
}

// state.onStart/onStop return nothing, so a result is read off the sets they keep busy while running.
/** @param {Set<string>} busy @param {string} serial */
async function settled(busy, serial) {
  const deadline = Date.now() + SETTLE_MS;
  while (busy.has(serial) && Date.now() < deadline) await sleep(50);
}

/** @param {string} serial */
async function start(serial) {
  const device = state.devices.find((item) => item.serial === serial);
  if (!device) return { error: `No device with that serial. Have: ${state.devices.slice(0, MAX_DEVICES).map((item) => item.serial).join(", ") || "(none)"}` };
  if (device.state !== "device") return { error: `${serial} is ${device.state}, so it cannot be mirrored yet.` };
  if (!state.scrcpyPath) return { error: "scrcpy was not found. Install it, then press Refresh in the panel." };
  if (state.mirrors.has(serial)) return { serial, mirroring: true, message: "Already mirroring." };
  state.onStart?.(serial);
  await settled(state.starting, serial);
  const mirroring = state.mirrors.has(serial);
  return {
    serial,
    mirroring,
    message: mirroring ? "scrcpy was launched in a desktop window. Check status to see that it stayed up." : "scrcpy did not start. TEDI showed the reason in a toast.",
  };
}

/** @param {string} serial */
async function stop(serial) {
  if (!state.mirrors.has(serial)) return { serial, mirroring: false, message: "Not mirroring." };
  state.onStop?.(serial);
  await settled(state.stopping, serial);
  const mirroring = state.mirrors.has(serial);
  return { serial, mirroring, message: mirroring ? "scrcpy did not stop. TEDI showed the reason in a toast." : "Stopped mirroring." };
}

/** @param {Record<string, unknown>} args */
export function handleTool(args) {
  const serial = typeof args.serial === "string" ? args.serial : "";
  switch (args.action) {
    case "status":
      return status();
    case "open":
      state.onOpen?.();
      return { message: "Asked TEDI to open the Android Mirror panel." };
    case "start":
      return serial ? start(serial) : { error: "start needs a serial from status." };
    case "stop":
      return serial ? stop(serial) : { error: "stop needs a serial from status." };
    default:
      return { error: 'Unknown action. Use "status", "open", "start" or "stop".' };
  }
}

export function registerAiTool() {
  if (typeof ctx?.contribute?.aiTools !== "function") return;
  ctx.contribute.aiTools([TOOL]);
  ctx.registerAiToolHandler(TOOL.name, handleTool);
}
