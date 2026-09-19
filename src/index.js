import { IN_FLOAT, ctx, setCtx, state, clearTimer } from "./runtime.js";
import { isSafeEndpoint, isSafeSerial, parseDevices, parseMdns, probeTools, runDirect, takeFrames } from "./adb.js";
import { mount, repaintViews, removeStyles } from "./panel.js";
import { removeItem, render as renderStatus } from "./statusbar.js";
import { PLAY_PANEL_ID, checkJoinedRelay, mountPlay, openPlay, reapRelay, stopRelay } from "./play.js";

const PANEL_ID = "android-mirroring";
const CMD_OPEN = "tedi.android-mirroring.open";
/** Reads the tracker and mirror logs. IPC only: nothing is spawned per tick. */
const TICK_MS = 1000;
/** Wi-Fi services only show in the pane, so they are only scanned while one is open. */
const MDNS_EVERY_TICKS = 5;
const TRACKER_RETRY_MS = 3000;

/** @param {import("../tedi").ExtensionContext} context */
export async function activate(context) {
  setCtx(context);
  state.active = true;
  const missing = missingApis(context);
  if (missing.length > 0) {
    context.logger?.warn?.(`Android Mirror needs a newer TEDI (missing: ${missing.join(", ")}).`);
    return;
  }

  if (IN_FLOAT) {
    // A floating window: just the detached screen. Watch the joined relay so
    // the screen rejoins when the main window restarts it.
    context.addDisposer(context.registerPanelRenderer(PLAY_PANEL_ID, (container, info) => mountPlay(container, info?.reuseKey)));
    // The device list needs the tracker, which only the main window runs. A
    // floated Android Mirror pane says so instead of staying blank.
    context.addDisposer(context.registerPanelRenderer(PANEL_ID, (container) => {
      const note = document.createElement("div");
      note.style.cssText = "padding:16px;color:var(--muted-foreground);font-size:11.5px;line-height:1.6;";
      note.textContent = "Android Mirror Runs in the Main TEDI Window. Close This Window to Bring the Pane Back There.";
      container.replaceChildren(note);
      return () => container.replaceChildren();
    }));
    state.timer = setInterval(() => void checkJoinedRelay().finally(repaintViews), 3000);
    return;
  }

  state.onOpen = openPane;
  state.onRefresh = () => void discover(true);
  state.onConnect = (endpoint) => void connectWifi(endpoint);
  state.onStart = (serial) => void startMirror(serial);
  state.onStop = (serial) => void stopMirror(serial);
  state.onPlay = openPlay;
  context.registerCommandHandler(CMD_OPEN, openPane);
  context.addDisposer(context.registerPanelRenderer(PANEL_ID, (container) => mount(container)));
  context.addDisposer(context.registerPanelRenderer(PLAY_PANEL_ID, (container, info) => mountPlay(container, info?.reuseKey)));

  renderStatus();
  void discover(false);
  state.timer = setInterval(() => void tick(), TICK_MS);
}

export async function deactivate() {
  state.active = false;
  clearTimer();
  await stopRelay();
  // Mirrors first: the tracker may own the adb server they run through.
  const handles = [...state.mirrors.values()].map((mirror) => mirror.handle);
  if (state.tracker) handles.push(state.tracker.handle);
  state.mirrors.clear();
  state.tracker = null;
  for (const handle of handles) {
    try {
      await ctx?.invoke("shell_bg_kill", { handle });
      await ctx?.invoke("shell_bg_remove", { handle });
    } catch (error) {
      ctx?.logger?.info?.("Android Mirror process cleanup failed", error);
    }
  }
  state.views.clear();
  state.connecting.clear();
  state.starting.clear();
  state.stopping.clear();
  removeItem();
  removeStyles();
  Object.assign(state, {
    ticks: 0,
    probed: false,
    probes: 0,
    discovering: false,
    refreshing: false,
    trackerRetryAt: 0,
    tracked: false,
    devices: [],
    discovered: [],
    adbPath: "",
    scrcpyPath: "",
    nodePath: "",
    error: null,
    onPlay: null,
    onOpen: null,
    onRefresh: null,
    onConnect: null,
    onStart: null,
    onStop: null,
  });
  setCtx(null);
}

function openPane() {
  const options = {
    panelId: PANEL_ID,
    title: "Android Mirror",
    icon: "lucide:Smartphone",
    reuseKey: "main",
  };
  try {
    if (typeof ctx?.tabs?.openExtensionPane === "function") ctx.tabs.openExtensionPane(options);
    else ctx?.tabs?.openExtensionTab?.(options);
  } catch (error) {
    ctx?.logger?.error?.("could not open Android Mirror", error);
  }
}

function paint() {
  renderStatus();
  repaintViews();
}

let queue = Promise.resolve();
/** One update at a time, so the tracker can never be spawned twice.
 *  @param {() => Promise<void>} task */
function serialized(task) {
  const next = queue.then(task).catch((error) => ctx?.logger?.warn?.("Android Mirror update failed", error));
  queue = next;
  return next;
}

/** Look for adb and scrcpy again. `manual` drives the Refresh spinner.
 *  @param {boolean} manual */
async function discover(manual) {
  if (!state.active) return;
  if (manual) {
    state.refreshing = true;
    paint();
  }
  if (state.discovering) return; // the probe in flight clears the spinner
  state.discovering = true;
  try {
    const tools = await probeTools();
    await serialized(async () => {
      if (!state.active) return;
      if (tools.adbPath !== state.adbPath) await stopTracker();
      state.adbPath = tools.adbPath;
      state.scrcpyPath = tools.scrcpyPath;
      state.nodePath = tools.nodePath;
      state.error = null;
      state.trackerRetryAt = 0;
      await pumpTracker();
      if (manual || state.views.size > 0) await scanWifi();
    });
  } catch (error) {
    state.error = messageOf(error);
    ctx?.logger?.warn?.("Android tool discovery failed", error);
  } finally {
    state.probed = true;
    state.probes += 1;
    state.discovering = false;
    state.refreshing = false;
    if (state.active) paint();
  }
}

async function tick() {
  if (!state.active || state.ticking) return;
  state.ticking = true;
  await serialized(async () => {
    await pumpTracker();
    await reapMirrors();
    await reapRelay().catch((error) => ctx?.logger?.info?.("could not inspect the Play relay", error));
    state.ticks += 1;
    if (state.views.size > 0 && state.ticks % MDNS_EVERY_TICKS === 0) await scanWifi();
  });
  state.ticking = false;
  if (state.active) paint();
}

/** Keep one `adb track-devices -l` running and read its latest device list. */
async function pumpTracker() {
  if (!ctx || !state.active || !state.adbPath) return;
  if (!state.tracker) {
    if (Date.now() < state.trackerRetryAt) return;
    try {
      const handle = await ctx.invoke("shell_bg_spawn_direct", {
        program: state.adbPath,
        args: ["track-devices", "-l"],
        cwd: null,
      });
      if (!state.active) {
        await ctx?.invoke("shell_bg_remove", { handle });
        return;
      }
      state.tracker = { handle, offset: 0, buffer: "" };
    } catch (error) {
      state.error = `Could Not Start adb: ${messageOf(error)}`;
      state.trackerRetryAt = Date.now() + TRACKER_RETRY_MS;
      return;
    }
  }
  const tracker = state.tracker;
  const logs = await ctx.invoke("shell_bg_logs", { handle: tracker.handle, sinceOffset: tracker.offset });
  tracker.offset = logs.next_offset;
  const { frames, rest } = takeFrames(tracker.buffer + logs.bytes);
  tracker.buffer = rest;
  const latest = frames.at(-1);
  if (latest !== undefined) {
    state.devices = parseDevices(latest);
    state.tracked = true;
    state.error = null;
  }
  if (!logs.exited) return;
  // The server went away (adb kill-server, a version clash, a crash). Retry;
  // the new tracker starts a server of its own if none is running.
  state.tracker = null;
  state.tracked = false;
  state.devices = [];
  state.trackerRetryAt = Date.now() + TRACKER_RETRY_MS;
  ctx.invoke("shell_bg_remove", { handle: tracker.handle }).catch(() => {});
  const said = rest.trim().split("\n").at(-1);
  state.error = said ? `adb Stopped: ${said}` : `adb Stopped (Exit ${logs.exit_code ?? "Unknown"})`;
}

async function stopTracker() {
  const tracker = state.tracker;
  state.tracker = null;
  state.tracked = false;
  state.devices = [];
  if (!tracker) return;
  await ctx?.invoke("shell_bg_kill", { handle: tracker.handle }).catch(() => {});
  await ctx?.invoke("shell_bg_remove", { handle: tracker.handle }).catch(() => {});
}

async function scanWifi() {
  // Only against a live tracker: a short-lived adb must never be the one that
  // starts the server, or the server dies with it on Windows.
  if (!state.tracked) return;
  try {
    state.discovered = parseMdns(await runDirect(state.adbPath, ["mdns", "services"], 10000));
  } catch (error) {
    ctx?.logger?.info?.("Wi-Fi debugging scan failed", error);
  }
}

async function reapMirrors() {
  for (const [serial, mirror] of [...state.mirrors.entries()]) {
    try {
      const result = await ctx?.invoke("shell_bg_logs", { handle: mirror.handle, sinceOffset: mirror.offset });
      if (!result) continue;
      mirror.offset = result.next_offset;
      if (!result.exited) continue;
      state.mirrors.delete(serial);
      await ctx?.invoke("shell_bg_remove", { handle: mirror.handle });
      const output = result.bytes.trim();
      if (result.exit_code && output && !state.stopping.has(serial)) {
        showToast(`${mirror.title} stopped: ${output.slice(-180)}`, "warning");
      }
    } catch (error) {
      ctx?.logger?.info?.("could not inspect scrcpy process", error);
    }
  }
}

/** @param {string} endpoint */
async function connectWifi(endpoint) {
  if (!isSafeEndpoint(endpoint) || !state.tracked || state.connecting.has(endpoint)) return;
  state.connecting.add(endpoint);
  paint();
  try {
    const output = (await runDirect(state.adbPath, ["connect", endpoint])).trim().replace(/\s+/g, " ");
    if (/^(?:already )?connected to /i.test(output)) {
      showToast(`adb: ${output}`, "success");
    } else {
      const hint = /failed to (?:connect|authenticate)/i.test(output)
        ? " Pair it once first: Wireless debugging > Pair device with pairing code, then adb pair."
        : "";
      showToast(`adb: ${(output || `could not connect to ${endpoint}`).slice(-200)}${hint}`, "error");
    }
  } catch (error) {
    showToast(`Wi-Fi connect failed: ${messageOf(error)}`, "error");
  } finally {
    state.connecting.delete(endpoint);
    await serialized(async () => {
      await pumpTracker();
      await scanWifi();
    });
    if (state.active) paint();
  }
}

/** @param {string} serial */
async function startMirror(serial) {
  if (!ctx || !state.scrcpyPath || !isSafeSerial(serial) || state.mirrors.has(serial) || state.starting.has(serial)) return;
  const device = state.devices.find((item) => item.serial === serial);
  if (!device || device.state !== "device") {
    showToast("The device is not ready for mirroring.", "warning");
    return;
  }
  // The serial keeps two phones of the same model apart.
  const title = `Android Mirror - ${device.model ? `${device.model} (${serial})` : serial}`.slice(0, 120);
  state.starting.add(serial);
  paint();
  try {
    const handle = await ctx.invoke("shell_bg_spawn_direct", {
      program: state.scrcpyPath,
      args: ["-s", serial, "--window-title", title],
      cwd: null,
    });
    if (typeof handle !== "number") throw new Error("scrcpy did not return a process handle");
    state.mirrors.set(serial, { handle, offset: 0, title });
  } catch (error) {
    showToast(`Could not start scrcpy: ${messageOf(error)}`, "error");
  } finally {
    state.starting.delete(serial);
    paint();
  }
}

/** @param {string} serial */
async function stopMirror(serial) {
  const mirror = state.mirrors.get(serial);
  if (!mirror || !ctx || state.stopping.has(serial)) return;
  state.stopping.add(serial);
  paint();
  try {
    await ctx.invoke("shell_bg_kill", { handle: mirror.handle });
    await ctx.invoke("shell_bg_remove", { handle: mirror.handle });
    state.mirrors.delete(serial);
  } catch (error) {
    showToast(`Could not stop scrcpy: ${messageOf(error)}`, "error");
  } finally {
    state.stopping.delete(serial);
    paint();
  }
}

/** @param {unknown} error */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {string} message @param {"default" | "success" | "info" | "warning" | "error"} variant */
function showToast(message, variant) {
  try {
    ctx?.ui?.toast(message, { variant });
  } catch {
    ctx?.logger?.info?.(message);
  }
}

/** @param {import("../tedi").ExtensionContext} context */
function missingApis(context) {
  const missing = [];
  if (typeof context.invoke !== "function") missing.push("ctx.invoke");
  if (typeof context.statusBar?.setItem !== "function") missing.push("ctx.statusBar");
  if (typeof context.registerPanelRenderer !== "function") missing.push("ctx.registerPanelRenderer");
  if (typeof context.tabs?.openExtensionTab !== "function" && typeof context.tabs?.openExtensionPane !== "function") missing.push("ctx.tabs");
  return missing;
}
