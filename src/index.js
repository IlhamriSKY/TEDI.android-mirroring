import { IN_FLOAT, ctx, setCtx, state, clearTimer } from "./runtime.js";
import { isSafeEndpoint, isSafeSerial, parseDevices, parseMdns, probeTools, runDirect, sleep, takeFrames, wifiAddress } from "./adb.js";
import { mount, repaintViews, removeStyles } from "./panel.js";
import { removeItem, render as renderStatus } from "./statusbar.js";
import { registerAiTool } from "./ai.js";
import { PLAY_PANEL_ID, checkJoinedRelay, mountPlay, openSet, pushNames, reapRelay, stopRelay } from "./play.js";

const PANEL_ID = "android-mirroring";
const CMD_OPEN = "tedi.android-mirroring.open";
/** Reads the tracker and mirror logs. IPC only: nothing is spawned per tick. */
const TICK_MS = 1000;
/** Wi-Fi services only show in the pane, so they are only scanned while one is open. */
const MDNS_EVERY_TICKS = 5;
const TRACKER_RETRY_MS = 3000;
/** The port `adb tcpip` opens on a USB phone, until the phone restarts. */
const TCPIP_PORT = 5555;
/** Where the Wi-Fi endpoints to rejoin are kept, and how many. */
const WIFI_KEY = "wifiEndpoints";
const WIFI_REMEMBERED = 4;
const CONNECTED = /^(?:already )?connected to /i;
const DISCONNECTED = /^disconnected/i;
/** Where the phone names and the Play selection live, per install. */
const NAMES_KEY = "names";
const SELECTED_KEY = "selected";
const PAIRED = /^Successfully paired/i;

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
  state.onConnect = connectWifi;
  state.onWifi = (serial) => void wifiFromUsb(serial);
  state.onPair = pairWifi;
  state.onStart = (serial) => void startMirror(serial);
  state.onStop = (serial) => void stopMirror(serial);
  // A row's Play is that phone; Play All is every phone that is ticked.
  state.onPlay = (serial) => openSet([serial], serial);
  state.onPlaySelected = () => {
    const ticked = state.devices
      .filter((device) => device.state === "device" && state.selected.has(device.serial))
      .map((device) => device.serial);
    if (ticked.length > 0) openSet(ticked, ticked[0]);
  };
  state.onForget = (serial) => void forgetPhone(serial);
  state.onSelect = (serial, on) => {
    if (on) state.selected.add(serial);
    else state.selected.delete(serial);
    void ctx?.storage.set(SELECTED_KEY, [...state.selected]).catch(() => {});
    repaintViews();
  };
  state.onRename = (serial, name) => {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (clean) state.names[serial] = clean;
    else delete state.names[serial];
    void ctx?.storage.set(NAMES_KEY, state.names).catch(() => {});
    pushNames();
    renderStatus();
    repaintViews();
  };
  await loadPreferences();
  context.registerCommandHandler(CMD_OPEN, openPane);
  registerAiTool();
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
    onWifi: null,
    onPair: null,
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
    const born = !state.tracked;
    state.tracked = true;
    state.error = null;
    if (born) void rejoinWifi();
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

/**
 * Endpoints adb connect reached, newest first. A TCP transport dies with the
 * adb server, so a TEDI restart or an extension reload loses every Wi-Fi phone
 * while USB comes back on its own: these are the ones to rejoin.
 * @returns {Promise<string[]>}
 */
async function knownWifi() {
  const saved = await ctx?.storage.get(WIFI_KEY).catch(() => null);
  return Array.isArray(saved) ? saved.filter((e) => typeof e === "string" && isSafeEndpoint(e)) : [];
}

/** @param {string} endpoint @param {boolean} keep */
async function rememberWifi(endpoint, keep) {
  const rest = (await knownWifi()).filter((e) => e !== endpoint);
  await ctx?.storage.set(WIFI_KEY, keep ? [endpoint, ...rest].slice(0, WIFI_REMEMBERED) : rest).catch(() => {});
}

/**
 * Remove a phone this PC reached over the network: adb drops the transport, the
 * rejoin list drops the endpoint (or the next tracker would bring it straight
 * back), and the name and tick that were about it go too. A USB phone has no
 * such button: it leaves when the cable does.
 * @param {string} serial
 */
async function forgetPhone(serial) {
  if (!isSafeEndpoint(serial) || !state.tracked || state.connecting.has(serial)) return;
  state.selected.delete(serial);
  delete state.names[serial];
  await ctx?.storage.set(SELECTED_KEY, [...state.selected]).catch(() => {});
  await ctx?.storage.set(NAMES_KEY, state.names).catch(() => {});
  await rememberWifi(serial, false);
  pushNames();
  await connecting(
    serial,
    async () => (await runDirect(state.adbPath, ["disconnect", serial])).trim().replace(/\s+/g, " "),
    DISCONNECTED,
  );
}

/**
 * Rejoin them once a tracker is up, all at once: an unreachable endpoint costs
 * a 20 s adb timeout, and four of those in a row would be over a minute.
 *
 * A failure does NOT forget the endpoint any more. A phone dozing on Wi-Fi
 * refuses one connect and takes the next (its radio wakes on the first packet),
 * so dropping it after a single miss threw away a phone that was fine seconds
 * later. Remove on the row is how an endpoint goes for good.
 */
async function rejoinWifi() {
  const known = await knownWifi();
  await Promise.all(known.map(async (endpoint) => {
    if (!state.tracked || state.devices.some((device) => device.serial === endpoint)) return;
    const output = await adbConnect(endpoint, 1).catch(() => "");
    if (!CONNECTED.test(output)) ctx?.logger?.info?.(`could not rejoin ${endpoint}: ${output || "no answer"}`);
  }));
}

/**
 * `adb connect` to a phone with Wireless debugging on, found by mDNS or typed
 * in from its Wireless debugging screen.
 * @param {string} endpoint
 */
async function connectWifi(endpoint) {
  if (!isSafeEndpoint(endpoint) || !state.tracked || state.connecting.has(endpoint)) return false;
  return connecting(endpoint, async () => {
    const output = await adbConnect(endpoint, 1);
    if (CONNECTED.test(output)) {
      await rememberWifi(endpoint, true);
      return output;
    }
    if (/failed to authenticate/i.test(output)) throw new Error(`${output}. This PC is not paired with the phone yet: pair it with a code first.`);
    throw new Error(`${output}. Check the IP address & Port on the phone's Wireless debugging screen (the port changes each time it is turned on) and that the phone is on a network this PC can reach.`);
  });
}

/**
 * Pair with the phone's "Pair device with pairing code" window (Android 11+),
 * once per PC. The window's port and code only live while it stays open.
 * @param {string} endpoint @param {string} code
 */
async function pairWifi(endpoint, code) {
  const key = `pair:${endpoint}`;
  if (!isSafeEndpoint(endpoint) || !/^\d{6}$/.test(code) || !state.tracked || state.connecting.has(key)) return false;
  return connecting(key, async () => {
    const output = (await runDirect(state.adbPath, ["pair", endpoint, code], 30000)).trim().replace(/\s+/g, " ");
    if (PAIRED.test(output)) return `${output}. Now connect with the IP address & Port on the phone's Wireless debugging screen.`;
    if (/wrong password/i.test(output)) throw new Error("Wrong pairing code. Type the 6 digits the phone's pairing window shows.");
    // adb hides the real reason ("protocol fault (couldn't read status
    // message)"); its log says the port refused or timed out.
    throw new Error(`Could not reach the pairing window at ${endpoint}. Keep it open on the phone (its port and code change each time it opens), check the address, and make sure the phone is on a network this PC can reach.`);
  }, PAIRED);
}

/**
 * Wi-Fi from a USB phone: adbd starts listening on TCP (until the phone
 * restarts) and adb connects to the phone's Wi-Fi address, after which the
 * cable can come off. Needs no pairing code and no mDNS, which many networks
 * block. The key the phone already allowed over USB is the one it trusts.
 * @param {string} serial
 */
async function wifiFromUsb(serial) {
  if (!isSafeSerial(serial) || !state.tracked || state.connecting.has(serial)) return;
  await connecting(serial, async () => {
    const ip = wifiAddress(await runDirect(state.adbPath, ["-s", serial, "shell", "ip -o -4 addr show"]));
    if (!ip) throw new Error("The phone is not on Wi-Fi. Turn Wi-Fi on on the phone, on a network this PC can reach, then try again.");
    await runDirect(state.adbPath, ["-s", serial, "tcpip", String(TCPIP_PORT)]);
    const output = await adbConnect(`${ip}:${TCPIP_PORT}`, 6); // adbd restarts on the new port first
    if (CONNECTED.test(output)) await rememberWifi(`${ip}:${TCPIP_PORT}`, true);
    if (!CONNECTED.test(output) && /failed to connect|timed out|refused/i.test(output)) {
      throw new Error(`${output} This PC cannot reach the phone at ${ip}: check the phone stayed on that Wi-Fi and that this PC can route to it. Guest and school networks often keep devices apart.`);
    }
    return output;
  });
}

/** The user's own name for each phone, and whether Play opens all of them. */
async function loadPreferences() {
  const names = await ctx?.storage.get(NAMES_KEY).catch(() => null);
  if (names && typeof names === "object") {
    for (const [serial, value] of Object.entries(names)) {
      if (isSafeSerial(serial) && typeof value === "string" && value.trim()) state.names[serial] = value;
    }
  }
  const selected = await ctx?.storage.get(SELECTED_KEY).catch(() => null);
  if (Array.isArray(selected)) {
    for (const serial of selected) if (typeof serial === "string" && isSafeSerial(serial)) state.selected.add(serial);
  }
}

/** `adb connect`, retried once a second while it fails. @param {string} endpoint @param {number} tries */
async function adbConnect(endpoint, tries) {
  let output = "";
  for (let i = 0; i < tries; i++) {
    if (i > 0) await sleep(1000);
    output = (await runDirect(state.adbPath, ["connect", endpoint])).trim().replace(/\s+/g, " ");
    if (CONNECTED.test(output)) break;
  }
  return output || `could not connect to ${endpoint}`;
}

/**
 * Run a Wi-Fi step with `key` shown busy, toast how it went, then read the
 * device list again. Resolves true when adb's answer matches `ok`.
 * @param {string} key @param {() => Promise<string>} task resolves to adb's answer; throws what to tell the user
 * @param {RegExp} [ok]
 */
async function connecting(key, task, ok = CONNECTED) {
  state.connecting.add(key);
  paint();
  let done = false;
  try {
    const output = await task();
    done = ok.test(output);
    showToast(`adb: ${output.slice(-240)}`, done ? "success" : "error");
  } catch (error) {
    showToast(messageOf(error).slice(-320), "error");
  } finally {
    state.connecting.delete(key);
    await serialized(async () => {
      await pumpTracker();
      await scanWifi();
    });
    if (state.active) paint();
  }
  return done;
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
