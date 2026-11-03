// Android Play inside TEDI: every phone's screen with a drag-and-drop keymap,
// one of them active, the others optionally synced.
//
// The screens and the editor are one web page served by play/relay.mjs (Node),
// so the same thing runs in a TEDI pane (an iframe onto the relay), in a
// detached phone's floating window (screen only, sized to the phone and turning
// with it), in a browser, or with no TEDI at all (`node play/relay.mjs --open`).
// This file starts that relay once per TEDI, shows the page, and opens and
// places the windows the page asks for.

import { IN_FLOAT, ctx, state } from "./runtime.js";

export const PLAY_PANEL_ID = "android-play";
/** One pane holds every phone; Play on a row focuses that phone in it. */
const PLAY_KEY = "play";

/** @type {Promise<{port: number, token: string}> | null} */
let starting = null;
/** The phone the last Play press asked for, and the mounted panes to tell. */
let focusSerial = "";
/** @type {Set<(serial: string) => void>} */
const focusers = new Set();
/** A detached phone's reuseKey: that one phone, screen only. */
const SOLO_PREFIX = "solo:";
/** One phone in a pane of its own, bar and all: Play with All Phones off. */
const ONLY_PREFIX = "only:";
/** Where the running relay is published, so a floating window (TEDI runs a second
 *  copy of this extension in it) joins it instead of starting another relay,
 *  another scrcpy session and another detach list. */
const RELAY_KEY = "playRelay";

/** A stable float-window id per phone (negative, like TEDI's own non-leaf
 *  floats), so detaching the same phone again brings its window forward.
 *  @param {string} serial */
function floatId(serial) {
  let hash = 5381;
  for (const ch of serial) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0;
  return -(3_000_000 + (hash % 1_000_000));
}

/** The float window's title bar, above the phone screen. */
const FLOAT_BAR = 33;
/** A detached screen's long edge, before it has to shrink to fit the monitor. */
const SCREEN_LONG = 780;

/**
 * Where detached phones go: side by side on one monitor, in as many rows as
 * leaves the screens biggest, all shrunk alike so every window fits. Each screen
 * keeps its phone's shape at the same long edge, portrait or landscape.
 * @param {{width: number, height: number}[]} phones video sizes (0 = not known yet: a portrait phone)
 * @param {{x: number, y: number, width: number, height: number}} area the monitor's work area
 * @returns {{x: number, y: number, width: number, height: number}[]} window bounds, logical pixels
 */
export function tileWindows(phones, area) {
  const gap = 12;
  const margin = 16;
  const screens = phones.map(({ width, height }) => {
    const aspect = width && height ? width / height : 9 / 19.5;
    return aspect < 1 ? { w: SCREEN_LONG * aspect, h: SCREEN_LONG } : { w: SCREEN_LONG, h: SCREEN_LONG / aspect };
  });
  /** @param {number} perRow */
  const rowsOf = (perRow) => {
    const rows = [];
    for (let i = 0; i < screens.length; i += perRow) rows.push(screens.slice(i, i + perRow));
    return rows;
  };
  let best = { scale: -1, rows: rowsOf(1) };
  for (let count = 1; count <= screens.length; count++) {
    const rows = rowsOf(Math.ceil(screens.length / count));
    let scale = 1;
    let height = 0;
    for (const row of rows) {
      const width = row.reduce((sum, s) => sum + s.w, 0);
      scale = Math.min(scale, (area.width - 2 * margin - gap * (row.length - 1)) / width);
      height += Math.max(...row.map((s) => s.h));
    }
    scale = Math.min(scale, (area.height - 2 * margin - rows.length * FLOAT_BAR - gap * (rows.length - 1)) / height);
    if (scale > best.scale + 1e-6) best = { scale, rows };
  }
  const { scale, rows } = best;
  const rowHeights = rows.map((row) => Math.max(...row.map((s) => s.h * scale)) + FLOAT_BAR);
  let top = area.y + (area.height - rowHeights.reduce((a, b) => a + b, 0) - gap * (rows.length - 1)) / 2;
  const out = [];
  for (const [r, row] of rows.entries()) {
    let left = area.x + (area.width - row.reduce((sum, s) => sum + s.w * scale, 0) - gap * (row.length - 1)) / 2;
    for (const s of row) {
      const width = s.w * scale;
      const height = s.h * scale + FLOAT_BAR;
      out.push({ x: Math.round(left), y: Math.round(top + (rowHeights[r] - height) / 2), width: Math.round(width), height: Math.round(height) });
      left += width + gap;
    }
    top += rowHeights[r] + gap;
  }
  return out;
}

/** The work area of the monitor this window is on, logical pixels. */
function screenArea() {
  const s = /** @type {Screen & {availLeft?: number, availTop?: number}} */ (screen);
  return { x: s.availLeft ?? 0, y: s.availTop ?? 0, width: s.availWidth, height: s.availHeight };
}

/**
 * Detach: the phone's screen alone, straight into one of TEDI's own floating
 * windows (always on top, movable anywhere), with no pane in between. The
 * float window renders the same screen-only panel a pane would. When no
 * floating window can be opened (an older TEDI), the phone gets a pane instead.
 * @param {string} serial @param {{width: number, height: number}} size the window
 * @returns {Promise<boolean>} whether it is a floating window
 */
async function openSolo(serial, size) {
  if (!ctx) return false;
  const device = state.devices.find((item) => item.serial === serial);
  const title = device?.model || serial;
  const reuseKey = `${SOLO_PREFIX}${serial}`;
  const leafId = floatId(serial);
  const params = { leafId, kind: "extension-panel", title, extensionId: ctx.id, panelId: PLAY_PANEL_ID, reuseKey };
  const utf8 = new TextEncoder().encode(JSON.stringify(params));
  try {
    await ctx.invoke("open_float_window", {
      leafId,
      params: encodeURIComponent(btoa(String.fromCharCode(...utf8))),
      title,
      width: size.width,
      height: size.height,
    });
    return true;
  } catch (error) {
    ctx.logger?.info?.("floating window unavailable, detaching into a pane", error);
    ctx.tabs?.openExtensionPane?.({ panelId: PLAY_PANEL_ID, title, icon: "lucide:Smartphone", reuseKey });
    return false;
  }
}

/** A TEDI older than `set_float_window_bounds` opens floats where it likes and never resizes them. */
let boundsUnsupported = false;
/** @param {Record<string, number>} args */
async function setFloatBounds(args) {
  if (boundsUnsupported || !ctx) return;
  try {
    await ctx.invoke("set_float_window_bounds", args);
  } catch (error) {
    if (/not found|unknown command/i.test(String(error))) boundsUnsupported = true;
    ctx.logger?.info?.("could not place the floating window", error);
  }
}

/**
 * Every phone in its own floating window, side by side instead of on top of each
 * other. Phones already detached join the layout.
 * @param {{serial: string, width: number, height: number}[]} phones
 */
async function detachAll(phones) {
  const bounds = tileWindows(phones, screenArea());
  for (const [i, phone] of phones.entries()) {
    if (await openSolo(phone.serial, bounds[i])) await setFloatBounds({ leafId: floatId(phone.serial), ...bounds[i] });
  }
}

/**
 * In a floating window: turn the window with the phone. The screen keeps its
 * long edge, so a portrait window becomes an equally big landscape one (smaller
 * if the monitor is too small), and the window keeps its center.
 * @param {HTMLElement} box what the window shows the phone in
 * @param {number} width @param {number} height the phone's video size
 */
function fitFloat(box, width, height) {
  const rect = box.getBoundingClientRect();
  const aspect = width / height;
  if (!IN_FLOAT || !aspect || !rect.width || !rect.height || Math.abs(rect.width / rect.height / aspect - 1) < 0.03) return;
  const barX = innerWidth - rect.width;
  const barY = innerHeight - rect.height;
  const long = Math.max(rect.width, rect.height);
  const w = aspect < 1 ? long * aspect : long;
  const h = aspect < 1 ? long : long / aspect;
  const scale = Math.min(1, (screen.availWidth - 32 - barX) / w, (screen.availHeight - 32 - barY) / h);
  void setFloatBounds({ width: Math.round(w * scale + barX), height: Math.round(h * scale + barY) });
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Play exactly these phones, in a pane of their own. The same set reopens the
 * same pane, so ticking the same two phones again lands where it was.
 * @param {string[]} serials @param {string} active the one the button was pressed on
 */
export function openSet(serials, active) {
  if (serials.length === 0) return;
  const name = (/** @type {string} */ serial) =>
    state.names[serial] || state.devices.find((item) => item.serial === serial)?.model || serial;
  const title = serials.length === 1 ? name(serials[0]) : `${name(active)} +${serials.length - 1}`;
  focusSerial = active;
  ctx?.tabs?.openExtensionPane?.({
    panelId: PLAY_PANEL_ID,
    title,
    icon: "lucide:Gamepad2",
    reuseKey: `${ONLY_PREFIX}${[...serials].sort().join(",")}`,
  });
}

/** Every mounted Play page, so a rename reaches the tiles it shows. @type {Set<() => void>} */
const namePushers = new Set();

/** Tell every open Play page the names changed. */
export function pushNames() {
  for (const push of [...namePushers]) push();
}

/** Play every phone, in the one shared pane, with this one active. @param {string} serial */
export function openPlay(serial) {
  focusSerial = serial;
  for (const focus of focusers) focus(serial);
  const options = {
    panelId: PLAY_PANEL_ID,
    title: "Android Play",
    icon: "lucide:Gamepad2",
    reuseKey: PLAY_KEY,
  };
  try {
    if (typeof ctx?.tabs?.openExtensionPane === "function") ctx.tabs.openExtensionPane(options);
    else ctx?.tabs?.openExtensionTab?.(options);
  } catch (error) {
    ctx?.logger?.error?.("could not open Android Play", error);
  }
}

/** The main window runs the relay; a floating window only joins it (see IN_FLOAT). */
export function ensureRelay() {
  if (state.relay) return Promise.resolve(state.relay);
  starting ??= (IN_FLOAT ? joinRelay() : startRelay()).finally(() => {
    starting = null;
  });
  return starting;
}

/** @param {number} port */
async function relayAnswers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { mode: "no-cors", signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

/** Floating window: drop a joined relay that stopped answering, so the pane rejoins the next one. */
export async function checkJoinedRelay() {
  const relay = state.relay;
  if (relay && !relay.owned && !(await relayAnswers(relay.port)) && state.relay === relay) state.relay = null;
}

/** Floating window: join the relay the main window published, once it answers. */
async function joinRelay() {
  /** @type {{port: number, token: string} | null} */
  const saved = await ctx?.storage.get(RELAY_KEY).catch(() => null) ?? null;
  if (!saved?.port || !saved.token || !(await relayAnswers(saved.port))) throw new Error("Waiting for Android Play in the Main Window");
  state.relay = { handle: 0, offset: 0, port: saved.port, token: saved.token, owned: false };
  return state.relay;
}

async function startRelay() {
  if (!ctx) throw new Error("Android Mirror is not active");
  // A Play tab TEDI restores at launch mounts before the first probe has found node and adb.
  for (let waited = 0; !state.probed && state.active && waited < 30_000; waited += 200) await sleep(200);
  if (!state.nodePath) throw new Error("Node.js Not Found. Install It from nodejs.org, Then Press Refresh in Android Mirror");
  if (!state.adbPath) throw new Error("adb Not Found");
  const host = ctx;
  const sep = host.installPath.includes("\\") ? "\\" : "/";
  const script = [host.installPath, "play", "relay.mjs"].join(sep);
  const data = [host.paths.home, ".tedi", "android-keymaps.json"].join(sep);
  const token = crypto.randomUUID().replaceAll("-", "");
  const handle = await host.invoke("shell_bg_spawn_direct", {
    program: state.nodePath,
    args: [script, "--port", "0", "--token", token, "--adb", state.adbPath, "--data", data],
    cwd: null,
  });
  let out = "";
  let offset = 0;
  const stop = () => host.invoke("shell_bg_remove", { handle }).catch(() => {});
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const logs = await host.invoke("shell_bg_logs", { handle, sinceOffset: offset });
    offset = logs.next_offset;
    out += logs.bytes;
    const match = out.match(/TAM_RELAY_LISTENING (\d+)/);
    if (match) {
      if (!state.active) {
        await stop();
        throw new Error("Android Mirror was turned off");
      }
      state.relay = { handle, offset, port: Number(match[1]), token, owned: true };
      await host.storage.set(RELAY_KEY, { port: state.relay.port, token }).catch(() => {});
      return state.relay;
    }
    if (logs.exited) {
      await stop();
      throw new Error(out.trim().split("\n").slice(-3).join(" ") || "The Relay Exited");
    }
    await sleep(100);
  }
  await stop();
  throw new Error("The Relay Did Not Start in Time");
}

let lastRestart = 0;
/**
 * Main window: drain the relay's output and notice when it exits. A relay that
 * died on its own is started again (at most every 10 s): floating windows that
 * joined it cannot start one, and a Play pane here restarts it only while open.
 */
export async function reapRelay() {
  const relay = state.relay;
  if (!relay?.owned || !ctx) return;
  const logs = await ctx.invoke("shell_bg_logs", { handle: relay.handle, sinceOffset: relay.offset });
  relay.offset = logs.next_offset;
  if (!logs.exited || state.relay !== relay) return;
  state.relay = null;
  await ctx.invoke("shell_bg_remove", { handle: relay.handle }).catch(() => {});
  await ctx.storage.delete(RELAY_KEY).catch(() => {});
  if (!state.active || Date.now() - lastRestart < 10_000) return;
  lastRestart = Date.now();
  ensureRelay().catch((error) => ctx?.logger?.warn?.("Android Play relay did not restart", error));
}

export async function stopRelay() {
  const relay = state.relay;
  state.relay = null;
  if (!relay?.owned) return; // a joined relay belongs to the main window
  await ctx?.storage.delete(RELAY_KEY).catch(() => {});
  await ctx?.invoke("shell_bg_kill", { handle: relay.handle }).catch(() => {});
  await ctx?.invoke("shell_bg_remove", { handle: relay.handle }).catch(() => {});
}

/** TEDI's own tokens, by the same names, for a page that cannot read the host's CSS. */
const THEME_TOKENS = [
  "background", "sidebar", "foreground", "muted-foreground", "border", "primary", "primary-foreground",
  "tedi-button-face", "tedi-button-face-hover", "tedi-button-face-foreground", "input", "ring",
  "popover", "popover-foreground", "accent", "accent-foreground", "card", "destructive", "font-sans", "font-mono",
];
function theme() {
  const css = getComputedStyle(document.documentElement);
  /** @type {Record<string, string>} */
  const out = {};
  for (const name of THEME_TOKENS) {
    const value = css.getPropertyValue(`--${name}`).trim();
    if (value) out[name] = value;
  }
  return out;
}

/**
 * TEDI's text font, as bytes: the page is another origin and cannot load the
 * host's bundled Inter itself. The Latin face is enough for this UI.
 * @returns {Promise<{family: string, data: ArrayBuffer} | null>}
 */
async function hostFont() {
  const family = getComputedStyle(document.body).fontFamily.split(",")[0].trim().replace(/^["']|["']$/g, "");
  for (const sheet of [...document.styleSheets]) {
    /** @type {CSSRuleList | null} */
    let rules = null;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of [...rules]) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const face = rule.style;
      if (face.getPropertyValue("font-family").replace(/["']/g, "").trim() !== family) continue;
      const range = face.getPropertyValue("unicode-range");
      if (range && !/U\+0+(?:-|,|$)/i.test(range)) continue;
      const url = face.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if (!url) continue;
      try {
        return { family, data: await (await fetch(new URL(url, sheet.href ?? location.href))).arrayBuffer() };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * @param {HTMLElement} container
 * @param {string | undefined} reuseKey "play" for the grid, "solo:<serial>" for one detached
 *   phone (a bare serial too: panes opened before one pane held them all)
 * @returns {() => void}
 */
export function mountPlay(container, reuseKey) {
  // "solo:<serial>" is a detached phone; a bare serial is a pane opened before
  // one pane held every phone, which shows just that phone too.
  const only = reuseKey?.startsWith(ONLY_PREFIX) ? reuseKey.slice(ONLY_PREFIX.length) : "";
  const solo = only
    ? ""
    : reuseKey?.startsWith(SOLO_PREFIX)
      ? reuseKey.slice(SOLO_PREFIX.length)
      : reuseKey && reuseKey !== PLAY_KEY ? reuseKey : "";
  container.replaceChildren();
  const host = document.createElement("div");
  host.style.cssText = "height:100%;display:flex;flex-direction:column;background:var(--sidebar, var(--background));";
  const frame = document.createElement("iframe");
  frame.title = "Android Play";
  frame.style.cssText = "flex:1 1 auto;width:100%;height:100%;border:0;background:transparent;";
  const note = document.createElement("div");
  note.style.cssText = "padding:16px;color:var(--muted-foreground);font-size:11.5px;line-height:1.6;";
  note.textContent = "Starting Android Play...";
  host.append(note);
  container.append(host);

  let disposed = false;
  let port = 0;
  const origin = () => `http://127.0.0.1:${port}`;
  let loading = false;
  /** The probe count when the start failed (-1: it did not); the next probe (a Refresh) retries. */
  let failedAt = -1;
  const load = async () => {
    loading = true;
    try {
      const relay = await ensureRelay();
      failedAt = -1;
      if (disposed || relay.port === port) return;
      port = relay.port;
      const which = solo
        ? `solo=${encodeURIComponent(solo)}`
        : only
          ? `only=${encodeURIComponent(only)}&focus=${encodeURIComponent(focusSerial)}`
          : `focus=${encodeURIComponent(focusSerial)}`;
      frame.src = `${origin()}/?${which}&t=${relay.token}&embed=1#theme=${encodeURIComponent(JSON.stringify(theme()))}&names=${encodeURIComponent(JSON.stringify(state.names))}`;
      host.replaceChildren(frame);
    } catch (error) {
      failedAt = state.probes;
      note.textContent = `Android Play Could Not Start: ${error instanceof Error ? error.message : String(error)}`;
      host.replaceChildren(note);
    } finally {
      loading = false;
    }
  };
  /** @param {object} message */
  const post = (message) => {
    if (port) frame.contentWindow?.postMessage(message, origin());
  };
  frame.addEventListener("load", () => {
    void hostFont().then((font) => {
      if (font && port) frame.contentWindow?.postMessage({ type: "tam-font", ...font }, origin(), [font.data]);
    });
  });
  /** @param {string} serial */
  const focus = (serial) => post({ type: "tam-focus", serial });
  if (!solo && !only) focusers.add(focus);
  // A rename in the Android Mirror tab shows on the tiles without a reload.
  let shownNames = "";
  const pushNames = () => {
    const next = JSON.stringify(state.names);
    if (next === shownNames) return;
    shownNames = next;
    post({ type: "tam-names", names: state.names });
  };
  namePushers.add(pushNames);

  // The relay can exit while TEDI keeps running; start a new one for this pane.
  // A floating window keeps trying to join, since it cannot start one itself.
  // A pane that could not start tries again after the next Refresh.
  const paint = () => {
    if (loading || (state.relay && state.relay.port === port)) return;
    if (port) {
      port = 0;
      note.textContent = "Android Play Stopped, Starting It Again...";
      host.replaceChildren(note);
    } else if (!IN_FLOAT && !(failedAt >= 0 && state.probes !== failedAt)) {
      return;
    }
    void load();
  };
  state.views.add(paint);

  /** @param {MessageEvent} event */
  const onMessage = (event) => {
    if (!port || event.source !== frame.contentWindow || event.origin !== origin()) return;
    const data = event.data;
    /** @param {any} phone */
    const asPhone = (phone) =>
      typeof phone?.serial === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(phone.serial)
        ? { serial: phone.serial, width: Number(phone.width) || 0, height: Number(phone.height) || 0 }
        : null;
    if (data?.type === "tam-detach") {
      const phone = asPhone(data);
      if (phone) void openSolo(phone.serial, tileWindows([phone], screenArea())[0]);
      return;
    }
    if (data?.type === "tam-detach-all" && Array.isArray(data.phones)) {
      const phones = /** @type {unknown[]} */ (data.phones).slice(0, 32).flatMap((phone) => asPhone(phone) ?? []);
      if (phones.length) void detachAll(phones);
      return;
    }
    if (data?.type === "tam-size" && solo) fitFloat(host, Number(data.width) || 0, Number(data.height) || 0);
  };
  window.addEventListener("message", onMessage);

  // An iframe swallows the mouse: dragging a splitter or a pane edge across it
  // would stall the moment the pointer entered the page. A press that starts
  // OUTSIDE the frame is a host drag, so the frame ignores the pointer until
  // the button comes up. (A press inside the frame never reaches this window.)
  const releaseFrame = () => {
    frame.style.pointerEvents = "";
  };
  const onHostPress = () => {
    frame.style.pointerEvents = "none";
  };
  window.addEventListener("pointerdown", onHostPress, true);
  window.addEventListener("pointerup", releaseFrame, true);
  window.addEventListener("pointercancel", releaseFrame, true);
  window.addEventListener("blur", releaseFrame);

  void load();

  return () => {
    disposed = true;
    focusers.delete(focus);
    namePushers.delete(pushNames);
    state.views.delete(paint);
    window.removeEventListener("message", onMessage);
    window.removeEventListener("pointerdown", onHostPress, true);
    window.removeEventListener("pointerup", releaseFrame, true);
    window.removeEventListener("pointercancel", releaseFrame, true);
    window.removeEventListener("blur", releaseFrame);
    container.replaceChildren();
  };
}
