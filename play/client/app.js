// Android Play viewer: every connected phone in a grid, each with its screen
// (H.264 decoded by WebCodecs) and an emulator-style keymap drawn over it.
//
// One phone is ACTIVE: the keyboard and mouse drive it, with its own keymap
// profile. A phone marked Sync repeats the active phone's input (same spots,
// as fractions of the screen), which is how several accounts of the same game
// are played at once. A phone's screen can be off: it still takes input, and
// this PC stops receiving and decoding its video.
//
// Sound plays here, not on the phone (Android 11+). Muting is per phone and on
// this side only; a muted or hidden phone is not sent any sound. Volume and
// brightness are the phone's own, set from here.
//
// Positions are fractions of the video frame (0..1), so a layout survives any
// window size. A joystick radius is a fraction of the frame HEIGHT, which keeps
// the ring round on a landscape frame.

const params = new URLSearchParams(location.search);
const TOKEN = params.get("t") ?? "";
const EMBED = params.has("embed");
const FOCUS = params.get("focus") ?? "";
/** A detached phone's window: this one phone, screen only, always active. */
const SOLO = params.get("solo") ?? "";
if (SOLO) document.documentElement.classList.add("solo");
/** The phones the Android Mirror tab ticked for this pane, empty for every phone. */
const ONLY = new Set((params.get("only") ?? "").split(",").filter(Boolean));
/** True while this page is about a single phone, however it was opened. */
const LONE = Boolean(SOLO) || ONLY.size === 1;
const ACTION = { DOWN: 0, UP: 1, MOVE: 2 };
const MOUSE_ID = 0;
const POLL_MS = 3000;

/** @param {string} path */
const api = (path) => `${path}${path.includes("?") ? "&" : "?"}t=${encodeURIComponent(TOKEN)}`;
const clamp01 = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Small UI kit: lucide glyphs, buttons, a themed tooltip, a custom select
// ---------------------------------------------------------------------------

const svg = (/** @type {string} */ body) =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  plus: svg('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  pencil: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  home: svg('<circle cx="12" cy="12" r="8"/>'),
  recent: svg('<rect width="14" height="14" x="5" y="5" rx="1"/>'),
  grid: svg('<rect width="7" height="7" x="3" y="3"/><rect width="7" height="7" x="14" y="3"/><rect width="7" height="7" x="14" y="14"/><rect width="7" height="7" x="3" y="14"/>'),
  focus: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>'),
  video: svg('<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12"/>'),
  videoOff: svg('<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>'),
  sync: svg('<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>'),
  detach: svg('<rect width="18" height="18" x="3" y="3"/><path d="M12 3v18"/><path d="m15 10 2 2-2 2"/>'),
  caret: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  volume: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>'),
  volumeOff: svg('<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>'),
  sliders: svg('<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M11 8v6"/><path d="M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/><path d="M8 11h6"/>'),
};

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * @param {string} label text, or "" for an icon-only button
 * @param {() => void} onClick
 * @param {{icon?: keyof typeof ICONS, tip?: string, cls?: string}} [opts]
 */
function btn(label, onClick, opts = {}) {
  const node = /** @type {HTMLButtonElement} */ (el("button", `${opts.cls ?? ""}${label ? "" : " icon"}`.trim()));
  node.type = "button";
  if (opts.icon) node.insertAdjacentHTML("beforeend", ICONS[opts.icon]);
  if (label) node.append(document.createTextNode(label));
  if (opts.tip) node.dataset.tip = opts.tip;
  node.setAttribute("aria-label", opts.tip ?? label);
  node.addEventListener("click", onClick);
  return node;
}

/** @param {HTMLElement} node @param {keyof typeof ICONS} icon */
function setIcon(node, icon) {
  node.querySelector("svg")?.remove();
  node.insertAdjacentHTML("afterbegin", ICONS[icon]);
}

// One tooltip for the page, the host's delays: 300 ms to open, then instant
// while moving between controls.
const tip = el("div", "tip");
document.body.append(tip);
let tipTimer = 0;
/** @type {HTMLElement | null} */
let tipFor = null;
function showTip(/** @type {HTMLElement} */ target) {
  tip.textContent = target.dataset.tip ?? "";
  tip.classList.add("is-open");
  const r = target.getBoundingClientRect();
  const t = tip.getBoundingClientRect();
  const x = Math.max(6, Math.min(innerWidth - t.width - 6, r.left + r.width / 2 - t.width / 2));
  const y = r.bottom + 6 + t.height > innerHeight ? r.top - t.height - 6 : r.bottom + 6;
  tip.style.left = `${Math.round(x)}px`;
  tip.style.top = `${Math.round(y)}px`;
}
document.addEventListener("mouseover", (e) => {
  const target = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
  if (target === tipFor) return;
  clearTimeout(tipTimer);
  const wasOpen = tip.classList.contains("is-open");
  tipFor = target instanceof HTMLElement ? target : null;
  if (!tipFor) {
    tip.classList.remove("is-open");
    return;
  }
  const node = tipFor;
  if (wasOpen) showTip(node);
  else tipTimer = window.setTimeout(() => node.isConnected && showTip(node), 300);
});
// Take the keyboard on any press inside the page. The phone screen cancels its
// pointerdown (touch handling), and a cancelled press does not focus an
// iframe: inside TEDI the keys then went to TEDI, so neither the keymap nor
// typing ever reached the phone.
document.addEventListener("pointerdown", () => window.focus(), true);

document.addEventListener("pointerdown", () => {
  clearTimeout(tipTimer);
  tip.classList.remove("is-open");
});

/** @type {(() => void) | null} */
let closeOpenMenu = null;
/**
 * The host's Radix Select, rebuilt: a trigger with a caret and a --popover
 * list with a check on the current value. Native <select> looks like Windows.
 * @param {string} tipText @param {(value: string) => void} onChange
 */
function makeSelect(tipText, onChange) {
  const trigger = /** @type {HTMLButtonElement} */ (el("button", "select"));
  trigger.type = "button";
  trigger.dataset.tip = tipText;
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = el("span", "select-label");
  trigger.append(label);
  trigger.insertAdjacentHTML("beforeend", ICONS.caret.replace("<svg", '<svg class="caret"'));
  /** @type {{value: string, label: string}[]} */
  let options = [];
  let current = "";
  const close = () => {
    document.querySelector(".menu")?.remove();
    trigger.setAttribute("aria-expanded", "false");
    closeOpenMenu = null;
  };
  trigger.addEventListener("click", () => {
    if (closeOpenMenu) {
      const wasMine = trigger.getAttribute("aria-expanded") === "true";
      closeOpenMenu();
      if (wasMine) return;
    }
    const menu = el("ul", "menu");
    menu.setAttribute("role", "listbox");
    for (const option of options) {
      const item = el("li");
      item.setAttribute("role", "option");
      item.append(el("span", "", option.label));
      if (option.value === current) {
        item.classList.add("is-active");
        item.insertAdjacentHTML("beforeend", `<span class="check">${ICONS.check}</span>`);
      }
      item.addEventListener("click", () => {
        close();
        if (option.value !== current) onChange(option.value);
      });
      menu.append(item);
    }
    document.body.append(menu);
    const r = trigger.getBoundingClientRect();
    menu.style.minWidth = `${Math.round(r.width)}px`;
    menu.style.left = `${Math.round(Math.min(r.left, innerWidth - menu.offsetWidth - 6))}px`;
    menu.style.top = `${Math.round(r.bottom + 4)}px`;
    trigger.setAttribute("aria-expanded", "true");
    closeOpenMenu = close;
  });
  return {
    node: trigger,
    /** @param {{value: string, label: string}[]} next @param {string} value */
    set(next, value) {
      options = next;
      current = value;
      label.textContent = options.find((o) => o.value === value)?.label ?? value;
    },
  };
}
document.addEventListener("pointerdown", (e) => {
  if (closeOpenMenu && !(e.target instanceof Element && e.target.closest(".menu, .select, .pop"))) closeOpenMenu();
});

/** @param {string} code a KeyboardEvent.code */
function keyLabel(code) {
  if (!code) return "?";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num${code.slice(6)}`;
  /** @type {Record<string, string>} */
  const names = {
    Space: "Space", ShiftLeft: "LShift", ShiftRight: "RShift", ControlLeft: "LCtrl", ControlRight: "RCtrl",
    AltLeft: "LAlt", AltRight: "RAlt", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
    Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", Backslash: "\\", CapsLock: "Caps", Enter: "Enter", Tab: "Tab",
  };
  return names[code] ?? code;
}

/** What the user renamed each phone to, by serial. TEDI owns the list and
 *  passes it in `#names={...}`, then posts `tam-names` whenever it changes. */
let customNames = /** @type {Record<string, string>} */ ({});
/** @param {string} hash */
function readNames(hash) {
  const match = hash.match(/names=([^&]+)/);
  if (!match) return;
  try {
    const value = JSON.parse(decodeURIComponent(match[1]));
    if (value && typeof value === "object") customNames = value;
  } catch {}
}
readNames(location.hash);

/** TEDI passes its live tokens as `#theme={...}` (names without the leading --). */
function applyTheme() {
  const match = location.hash.match(/theme=([^&]+)/);
  if (!match) return;
  try {
    const theme = JSON.parse(decodeURIComponent(match[1]));
    for (const [name, value] of Object.entries(theme)) {
      if (/^[a-z-]+$/.test(name) && typeof value === "string" && !/[;{}]/.test(value)) {
        document.documentElement.style.setProperty(`--${name}`, value);
      }
    }
  } catch {}
}
applyTheme();

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * @typedef {{id: string, type: "tap", x: number, y: number, key: string}} TapControl
 * @typedef {{id: string, type: "joystick", x: number, y: number, r: number,
 *   keys: {up: string, left: string, down: string, right: string}}} JoystickControl
 * @typedef {{id: string, type: "swipe", x: number, y: number, x2: number, y2: number, ms: number, key: string}} SwipeControl
 * @typedef {TapControl | JoystickControl | SwipeControl} Control
 * @typedef {{video: Record<string, boolean>, sync: Record<string, boolean>, mute: Record<string, boolean>, layout: "grid" | "focus", opacity: number, zoom: number, keySize: number}} PlaySettings
 * @typedef {{version: number, profiles: Record<string, {controls: Control[]}>, lastProfile: Record<string, string>, play: PlaySettings}} KeymapDoc
 */

/** @type {KeymapDoc} */
let doc = { version: 1, profiles: { Default: { controls: [] } }, lastProfile: {}, play: { video: {}, sync: {}, mute: {}, layout: "grid", opacity: 1, zoom: 1, keySize: 1 } };
/** Zoom steps of the grid. 1 fits every shown phone in the pane; above it the grid scrolls. */
const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 2.5, 3];
/** Control sizes, as a multiple of the 54px a button is by default. */
const KEY_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** @type {Map<string, Dev>} */
const devs = new Map();
let active = "";
/** @type {"play" | "edit"} */
let mode = "play";
/** @type {string | null} */
let selected = null;
/** @type {{id: string, slot: string} | null} */
let capture = null;
/**
 * A control just added and not dragged yet. It pulses, so the eye finds the
 * new one among the rest; the first press on it (or leaving Edit) stops that.
 * @type {string | null}
 */
let fresh = null;
/**
 * While playing, the keyboard either fires the keymap (shortcut) or types into
 * the phone (typing: chat, search boxes). The ~ key switches.
 * @type {"shortcut" | "type"}
 */
let inputMode = "shortcut";

/** Phones that have a window of their own right now; the grid leaves them out. */
let detached = new Set();
/** The relay's keymap revision this page shows. */
let docRev = 0;

const activeDev = () => devs.get(active) ?? null;

/**
 * Whether a phone is on screen in this page. `anyLayout` ignores Focus, for
 * "could this phone be the active one".
 * @param {string} serial @param {boolean} [anyLayout]
 */
function isShown(serial, anyLayout = false) {
  if (SOLO) return serial === SOLO;
  if (detached.has(serial)) return false;
  return anyLayout || doc.play.layout === "grid" || serial === active;
}

/** @param {unknown[]} serials phones that have a window of their own */
function applyDetached(serials) {
  const next = new Set(serials.filter((s) => typeof s === "string"));
  if (SOLO || [...next].join() === [...detached].join()) {
    detached = next;
    return;
  }
  detached = next;
  releaseAll();
  pickActive();
  layoutGrid();
  refreshChrome();
}

/**
 * A window that shows one phone at a comfortable size, from its video size.
 * @param {number} w @param {number} h
 */
function windowSize(w, h) {
  const aspect = w && h ? w / h : 9 / 19.5;
  const chrome = { x: 24, y: 110 }; // bar, tile head, padding
  const screen = aspect < 1 ? { height: 760, width: 760 * aspect } : { width: 1100, height: 1100 / aspect };
  return { width: Math.round(Math.max(420, screen.width + chrome.x)), height: Math.round(screen.height + chrome.y) };
}

/** Keep the active phone one this page can show. */
function pickActive() {
  if (SOLO) active = devs.has(SOLO) ? SOLO : "";
  else if (!devs.has(active) || detached.has(active)) active = [...devs.keys()].find((s) => !detached.has(s)) ?? "";
}

let saveTimer = 0;
/** A local change not yet acknowledged by the relay; it wins over echoes. */
let savePending = false;
function save() {
  clearTimeout(saveTimer);
  savePending = true;
  saveTimer = window.setTimeout(() => {
    fetch(api("/api/keymaps"), { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        docRev = Math.max(docRev, (await res.json()).rev ?? 0);
      })
      .catch((error) => setStatus(`Could Not Save: ${error.message}`, true))
      .finally(() => {
        savePending = false;
      });
  }, 300);
}

/** Another page saved: take its keymaps, unless this page has a save of its own pending. @param {number} rev @param {KeymapDoc} next */
function adoptDoc(rev, next) {
  if (rev <= docRev || !next || typeof next.profiles !== "object") return;
  docRev = rev;
  if (savePending) return;
  releaseAll();
  doc = normalizeDoc(next);
  if (!byIdIn(activeDev(), selected)) selected = null;
  refreshChrome();
}

/** A keymap file from disk or an older version: fill in what it lacks. @param {KeymapDoc} value */
function normalizeDoc(value) {
  value.lastProfile ??= {};
  /** @type {Partial<PlaySettings>} */
  const play = value.play ?? {};
  value.play = { video: {}, sync: {}, mute: {}, layout: "grid", opacity: 1, zoom: 1, keySize: 1, ...play };
  // A dragged size lands between the button steps, so any value in range is kept.
  const zoom = value.play.zoom;
  if (!(typeof zoom === "number" && zoom >= ZOOMS[0] && zoom <= ZOOMS[ZOOMS.length - 1])) value.play.zoom = 1;
  if (!KEY_SIZES.includes(value.play.keySize)) value.play.keySize = 1;
  if (Object.keys(value.profiles).length === 0) value.profiles.Default = { controls: [] };
  return value;
}

/** @param {Dev | null} dev @param {string | null} id */
const byIdIn = (dev, id) => (dev && id ? dev.controls().find((c) => c.id === id) ?? null : null);

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

/** The relay sends sound raw: 48 kHz, 16-bit little-endian, stereo. */
const PCM_RATE = 48000;
const PCM_FRAME_BYTES = 4;
/** Played in 20 ms pieces, a little ahead, so a late packet does not click. */
const PCM_CHUNK_BYTES = (PCM_RATE / 50) * PCM_FRAME_BYTES;
const PCM_LEAD_S = 0.08;
/** Further ahead than this (the phone's clock ran fast, or a stall) and it starts over. */
const PCM_MAX_LEAD_S = 0.3;

/** @type {AudioContext | null} */
let audioCtx = null;
/** One context for the page. The browser lets it run only after a click or key press in this page. */
function audioContext() {
  audioCtx ??= new AudioContext({ latencyHint: "interactive" });
  if (audioCtx.state === "suspended") void audioCtx.resume().catch(() => {});
  return audioCtx;
}
for (const type of ["pointerdown", "keydown"]) {
  document.addEventListener(type, () => {
    if (audioCtx?.state === "suspended") void audioCtx.resume().catch(() => {});
  }, true);
}

class PcmPlayer {
  constructor() {
    /** @type {Uint8Array[]} */
    this.pending = [];
    this.pendingBytes = 0;
    this.next = 0;
  }

  /** @param {Uint8Array} bytes */
  push(bytes) {
    this.pending.push(bytes);
    this.pendingBytes += bytes.length;
    if (this.pendingBytes < PCM_CHUNK_BYTES) return;
    const pcm = new Uint8Array(this.pendingBytes);
    let at = 0;
    for (const part of this.pending) {
      pcm.set(part, at);
      at += part.length;
    }
    this.pending = [];
    this.pendingBytes = 0;
    const ctx = audioContext();
    if (ctx.state !== "running") return; // not allowed to play yet: drop it rather than pile it up
    const frames = Math.floor(pcm.length / PCM_FRAME_BYTES);
    const buffer = ctx.createBuffer(2, frames, PCM_RATE);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    const view = new DataView(pcm.buffer, 0, frames * PCM_FRAME_BYTES);
    for (let i = 0; i < frames; i++) {
      left[i] = view.getInt16(i * 4, true) / 32768;
      right[i] = view.getInt16(i * 4 + 2, true) / 32768;
    }
    const now = ctx.currentTime;
    if (this.next < now + 0.01 || this.next > now + PCM_MAX_LEAD_S) this.next = now + PCM_LEAD_S;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(this.next);
    this.next += buffer.duration;
  }

  reset() {
    this.pending = [];
    this.pendingBytes = 0;
    this.next = 0;
  }
}

/**
 * The phone's brightness slider is perceptual, like Android's own: the display
 * service counts linear light, where the whole dim half of the range would sit
 * in the first few percent of the slider.
 */
const BRIGHTNESS_GAMMA = 2.2;
/** The lit part of a retro slider, which app.css reads as --fill. A set from
 *  code fires no input event, so every place that moves one calls this.
 *  @param {HTMLInputElement} input */
const paintSlider = (input) => input.style.setProperty("--fill", `${input.value}%`);

/** How often a dragged slider may reach the phone. */
const PHONE_EVERY_MS = 150;

/**
 * Send a dragged slider to the phone at most every PHONE_EVERY_MS, and once
 * more where it stops. Returns a cancel for the pending send.
 * @param {HTMLInputElement} input @param {() => void} send
 */
function sendWhileDragged(input, send) {
  let last = 0;
  let trailing = 0;
  const now = () => {
    clearTimeout(trailing);
    last = Date.now();
    send();
  };
  input.addEventListener("input", () => {
    clearTimeout(trailing);
    const wait = PHONE_EVERY_MS - (Date.now() - last);
    if (wait <= 0) now();
    else trailing = window.setTimeout(now, wait);
  });
  input.addEventListener("change", now);
  return () => clearTimeout(trailing);
}

/**
 * The phone's volume and brightness, in a popover under the button that
 * opened it. Both are read from the phone when it opens.
 * @param {Dev} dev @param {HTMLElement} anchor
 */
function openControls(dev, anchor) {
  if (closeOpenMenu) {
    const mine = anchor.getAttribute("aria-expanded") === "true";
    closeOpenMenu();
    if (mine) return;
  }
  const pop = el("div", "pop");
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", `Controls for ${dev.name}`);
  /** @param {string} label @param {number} value 0..100 */
  const slider = (label, value) => {
    const input = /** @type {HTMLInputElement} */ (el("input"));
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(Math.round(value));
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => paintSlider(input));
    paintSlider(input);
    return input;
  };

  // Volume: the phone's media volume, which is also how loud it plays here.
  const volume = slider("Phone volume", 0);
  volume.disabled = true;
  const volumeValue = el("span", "pop-value", "...");
  volume.addEventListener("input", () => {
    volumeValue.textContent = `${volume.value}%`;
  });
  const cancelVolume = sendWhileDragged(volume, () => dev.send({ t: "volume", level: Number(volume.value) / 100 }));
  dev.onVolume = (level) => {
    volume.disabled = level === null;
    if (level !== null) volume.value = String(Math.round(level * 100));
    paintSlider(volume);
    volumeValue.textContent = level === null ? "-" : `${volume.value}%`;
  };
  dev.send({ t: "volume?" });
  const noSound = dev.audioState === "off" || dev.audioState === "error";

  // Brightness: the phone's own screen.
  const bright = slider("Phone brightness", 0);
  bright.disabled = true;
  const brightValue = el("span", "pop-value", "...");
  const autoBtn = btn("Auto", () => {
    dev.send({ t: "brightness", auto: true });
    autoBtn.classList.add("is-on");
  }, { cls: "pop-auto", tip: "Let the phone set its brightness from the light around it" });
  bright.addEventListener("input", () => {
    brightValue.textContent = `${bright.value}%`;
    autoBtn.classList.remove("is-on"); // moving it takes the phone off Auto, as on the phone
  });
  const cancelBrightness = sendWhileDragged(bright, () => dev.send({ t: "brightness", level: (Number(bright.value) / 100) ** BRIGHTNESS_GAMMA }));
  dev.onBrightness = (level, auto) => {
    bright.disabled = level === null;
    if (level !== null) bright.value = String(Math.round(level ** (1 / BRIGHTNESS_GAMMA) * 100));
    paintSlider(bright);
    brightValue.textContent = level === null ? "-" : `${bright.value}%`;
    autoBtn.classList.toggle("is-on", auto);
  };
  dev.send({ t: "brightness?" });

  /** @param {keyof typeof ICONS} icon @param {string} label @param {HTMLElement[]} parts */
  const row = (icon, label, parts) => {
    const r = el("div", "pop-row");
    const name = el("span", "pop-label");
    name.insertAdjacentHTML("beforeend", ICONS[icon]);
    name.append(document.createTextNode(label));
    r.append(name, ...parts);
    return r;
  };
  pop.append(
    row("volume", "Volume", [volume, volumeValue, el("span")]),
    el("div", "pop-note", noSound ? "The phone's media volume. No sound reaches this computer from it." : "The phone's media volume. It plays here, not on the phone, while Play is open."),
    row("sun", "Brightness", [bright, brightValue, autoBtn]),
    el("div", "pop-note", "The phone's own screen. Moving it turns Auto off."),
  );
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.round(Math.max(6, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 6)))}px`;
  pop.style.top = `${Math.round(r.bottom + pop.offsetHeight + 4 > innerHeight ? Math.max(6, r.top - pop.offsetHeight - 4) : r.bottom + 4)}px`;
  anchor.setAttribute("aria-expanded", "true");
  closeOpenMenu = () => {
    cancelVolume();
    cancelBrightness();
    pop.remove();
    dev.onVolume = null;
    dev.onBrightness = null;
    anchor.setAttribute("aria-expanded", "false");
    closeOpenMenu = null;
  };
}

// ---------------------------------------------------------------------------
// A phone: its tile, its stream and its keymap overlay
// ---------------------------------------------------------------------------

class Dev {
  /** @param {string} serial @param {string} name */
  constructor(serial, name) {
    this.serial = serial;
    this.name = name || serial;
    this.w = 0;
    this.h = 0;
    /** @type {WebSocket | null} */
    this.ws = null;
    this.retries = 0;
    this.gone = false;
    /** @type {boolean | null} what the relay was last told */
    this.sentVideo = null;
    /** Sound on the phone, from the relay: "" not known yet, "on", "off" (before Android 11), "error". */
    this.audioState = "";
    /** @type {boolean | null} */
    this.sentAudio = null;
    this.player = new PcmPlayer();
    /** The open controls popover, waiting for the phone's volume and brightness. @type {((level: number | null) => void) | null} */
    this.onVolume = null;
    /** @type {((level: number | null, auto: boolean) => void) | null} */
    this.onBrightness = null;
    /** @type {VideoDecoder | null} */
    this.decoder = null;
    /** @type {Uint8Array | null} */
    this.pendingConfig = null;
    this.needKey = true;
    this.timestamp = 0;
    this.lastReset = 0;

    this.tile = el("div", "tile");
    const head = el("div", "tile-head");
    this.nameEl = el("span", "name", customNames[this.serial] || this.name);
    this.stateEl = el("span", "state", "Connecting...");
    this.videoBtn = btn("", () => this.setVideo(!this.videoOn()), { cls: "ghost", icon: "video" });
    this.syncBtn = btn("", () => {
      doc.play.sync[this.serial] = !doc.play.sync[this.serial];
      save();
      refreshChrome(); // the bar counts the phones that get the input
    }, { cls: "ghost", icon: "sync" });
    this.audioBtn = btn("", () => {
      doc.play.mute[this.serial] = !doc.play.mute[this.serial];
      save();
      this.syncAudio();
      this.refreshHead();
    }, { cls: "ghost", icon: "volume" });
    this.controlsBtn = btn("", () => openControls(this, this.controlsBtn), {
      cls: "ghost",
      icon: "sliders",
      tip: "The phone's volume and brightness",
    });
    this.controlsBtn.setAttribute("aria-haspopup", "dialog");
    head.append(this.nameEl, this.stateEl, this.audioBtn, this.controlsBtn, this.videoBtn, this.syncBtn);
    // A phone can move to a window of its own (one screen, movable to any
    // monitor). The grid hides it while that window is open.
    if (!SOLO) {
      head.append(btn("", () => this.detach(), {
        cls: "ghost",
        icon: "detach",
        tip: EMBED
          ? "Detach: this phone alone in a floating window, screen only. It turns with the phone; close it to bring the phone back here"
          : "Open this phone alone in its own window. Close it to bring the phone back here",
      }));
    }
    head.addEventListener("click", (e) => {
      if (!(e.target instanceof Element && e.target.closest("button"))) activate(this.serial);
    });
    this.body = el("div", "tile-body");
    this.screen = el("div", "screen");
    this.canvas = /** @type {HTMLCanvasElement} */ (el("canvas"));
    this.g = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext("2d", { alpha: false }));
    this.overlay = el("div", "overlay");
    this.off = el("div", "off", "Screen Off, Still Controlled");
    // A detached phone's window has no header, so its state shows over the screen until it is live.
    this.stateOverlay = el("div", "solo-state", "Connecting...");
    this.stateOverlay.hidden = !SOLO;
    this.screen.append(this.canvas, this.off, this.overlay);
    // Drag the corner to size the phones: the zoom the buttons and Ctrl+wheel
    // set, but any value between their steps. Double-click fits them again. A
    // detached window has none: its own window size is what sizes the phone.
    if (!SOLO) {
      const grip = el("div", "resize-grip");
      grip.dataset.tip = "Drag to resize. Double-click to fit";
      grip.addEventListener("pointerdown", (e) => this.startResize(e, grip));
      grip.addEventListener("dblclick", () => stepZoom(0));
      this.screen.append(grip);
    }
    this.body.append(this.screen, this.stateOverlay);
    // A detached window has no header: mute and the controls show in a corner on hover.
    if (SOLO) {
      const tools = el("div", "solo-tools");
      tools.append(this.audioBtn, this.controlsBtn);
      this.body.append(tools);
    }
    this.tile.append(head, this.body);
    this.bindPointer();
    this.refreshHead();
    this.connect();
  }

  videoOn() {
    return doc.play.video[this.serial] !== false;
  }

  /** The screen is shown when it is on and on screen (not hidden by Focus or detached to its own window). */
  wantVideo() {
    return this.videoOn() && isShown(this.serial);
  }

  aspect() {
    return this.w && this.h ? this.w / this.h : 16 / 9;
  }

  profileName() {
    const name = doc.lastProfile[this.serial];
    return name && doc.profiles[name] ? name : Object.keys(doc.profiles)[0];
  }

  /** @returns {Control[]} */
  controls() {
    return doc.profiles[this.profileName()].controls;
  }

  /** @param {boolean} on */
  setVideo(on) {
    doc.play.video[this.serial] = on;
    save();
    this.syncVideo();
    this.refreshHead();
  }

  /** Sound plays for a phone that has it, is not muted, and is on screen in this page. */
  wantAudio() {
    return this.audioState !== "off" && this.audioState !== "error" && !doc.play.mute[this.serial] && isShown(this.serial);
  }

  /** Tell the relay whether to send sound. */
  syncAudio() {
    const want = this.wantAudio();
    if (!want) this.player.reset();
    if (want !== this.sentAudio && this.ws?.readyState === WebSocket.OPEN) {
      this.sentAudio = want;
      this.send({ t: "audio", on: want });
    }
  }

  /** Tell the relay whether to send frames, and drop the decoder when not. */
  syncVideo() {
    const want = this.wantVideo();
    this.off.hidden = want;
    if (!want && this.decoder) {
      if (this.decoder.state !== "closed") this.decoder.close();
      this.decoder = null;
    }
    if (want !== this.sentVideo && this.ws?.readyState === WebSocket.OPEN) {
      this.sentVideo = want;
      this.needKey = true;
      this.send({ t: "video", on: want });
    }
  }

  refreshHead() {
    const on = this.videoOn();
    setIcon(this.videoBtn, on ? "video" : "videoOff");
    this.videoBtn.dataset.tip = on ? "Screen on. Click to turn it off (still controlled)" : "Screen off. Click to show it";
    this.videoBtn.classList.toggle("is-on", !on);
    const sync = Boolean(doc.play.sync[this.serial]);
    this.syncBtn.classList.toggle("is-on", sync);
    this.syncBtn.dataset.tip = sync ? "Sync on: repeats the active phone's input" : "Sync off: click to repeat the active phone's input here";
    const muted = Boolean(doc.play.mute[this.serial]);
    const noSound = this.audioState === "off" || this.audioState === "error";
    setIcon(this.audioBtn, muted || noSound ? "volumeOff" : "volume");
    this.audioBtn.disabled = noSound;
    this.audioBtn.classList.toggle("is-on", muted && !noSound);
    this.audioBtn.dataset.tip = this.audioState === "off"
      ? "No sound: the phone needs Android 11 or newer"
      : this.audioState === "error"
        ? "The phone's sound could not start. It still plays on the phone"
        : muted
          ? "Muted here. Click to hear the phone on this computer"
          : "Sound plays here, not on the phone. Click to mute it here";
    this.tile.classList.toggle("is-active", this.serial === active);
    this.off.hidden = this.wantVideo();
  }

  /** @param {string} text @param {boolean} [error] @param {boolean} [live] the stream is up */
  setState(text, error = false, live = false) {
    this.stateEl.textContent = text;
    this.stateEl.classList.toggle("is-error", error);
    this.stateOverlay.textContent = text;
    this.stateOverlay.classList.toggle("is-error", error);
    this.stateOverlay.hidden = !SOLO || live;
  }

  /** @param {object} msg */
  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  connect() {
    if (typeof VideoDecoder === "undefined") {
      this.setState("This Browser Cannot Decode Video (Use Edge or Chrome)", true);
      return;
    }
    let closedReason = "";
    const want = this.wantVideo();
    const solo = SOLO === this.serial ? "&solo=1" : "";
    const sound = this.wantAudio();
    const socket = new WebSocket(`ws://${location.host}/ws?serial=${encodeURIComponent(this.serial)}&video=${want ? 1 : 0}&audio=${sound ? 1 : 0}${solo}&t=${encodeURIComponent(TOKEN)}`);
    socket.binaryType = "arraybuffer";
    this.ws = socket;
    this.sentVideo = want;
    this.sentAudio = sound;
    socket.onmessage = (e) => {
      if (typeof e.data !== "string") {
        const frame = new Uint8Array(e.data);
        if (frame[0] & 4) {
          if (this.wantAudio()) this.player.push(frame.subarray(1));
        } else if (this.wantVideo()) this.onVideo(frame);
        return;
      }
      const msg = JSON.parse(e.data);
      if (msg.type === "session") {
        this.w = msg.width;
        this.h = msg.height;
        if (typeof msg.audio === "string" && msg.audio !== this.audioState) {
          this.audioState = msg.audio;
          this.syncAudio();
          this.refreshHead();
        }
        this.name = msg.name || this.serial;
        this.nameEl.textContent = customNames[this.serial] || this.name;
        this.retries = 0;
        this.setState(`${msg.width}x${msg.height}`, false, true);
        layoutGrid();
        // A detached phone's window turns with it (the phone rotated, or this is its first frame).
        if (EMBED && SOLO === this.serial) parent.postMessage({ type: "tam-size", width: msg.width, height: msg.height }, "*");
      } else if (msg.type === "volume") {
        this.onVolume?.(typeof msg.level === "number" ? msg.level : null);
      } else if (msg.type === "brightness") {
        this.onBrightness?.(typeof msg.level === "number" ? msg.level : null, msg.auto === true);
      } else if (msg.type === "keymaps") {
        adoptDoc(msg.rev, msg.doc);
      } else if (msg.type === "detached" && Array.isArray(msg.serials)) {
        applyDetached(msg.serials);
      } else if (msg.type === "closed") {
        closedReason = msg.reason;
      } else if (msg.type === "log") {
        this.setState(msg.text, true);
      }
    };
    socket.onclose = () => {
      if (this.ws !== socket || this.gone) return;
      releaseAll();
      if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
      this.decoder = null;
      this.retries += 1;
      if (this.retries > 5) {
        this.setState(`${closedReason || "Disconnected"}. Reload to Retry`, true);
        return;
      }
      this.setState(`${closedReason || "Disconnected"}, Retrying...`, true);
      setTimeout(() => !this.gone && this.connect(), 1000 * this.retries);
    };
  }

  /** Inside TEDI the extension opens a floating window, screen only; a plain browser opens a popup. */
  detach() {
    if (EMBED) {
      parent.postMessage({ type: "tam-detach", serial: this.serial, width: this.w, height: this.h }, "*");
      return;
    }
    const size = windowSize(this.w, this.h);
    const url = `${location.origin}/?t=${encodeURIComponent(TOKEN)}&solo=${encodeURIComponent(this.serial)}${location.hash}`;
    window.open(url, `play-${this.serial}`, `popup,width=${size.width},height=${size.height}`);
  }

  destroy() {
    this.gone = true;
    this.ws?.close();
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.tile.remove();
  }

  // --- video ---------------------------------------------------------------
  recover() {
    this.needKey = true;
    if (Date.now() - this.lastReset > 1000) {
      this.lastReset = Date.now();
      this.send({ t: "reset" });
    }
  }

  /** @param {Uint8Array} config */
  configure(config) {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
        }
        this.g.drawImage(frame, 0, 0);
        frame.close();
      },
      error: (error) => {
        this.setState(`Video: ${error.message}`, true);
        this.recover();
      },
    });
    this.decoder.configure({ codec: codecOf(config), optimizeForLatency: true });
    this.needKey = true;
  }

  /** @param {Uint8Array} packet */
  onVideo(packet) {
    const flags = packet[0];
    const data = packet.subarray(1);
    if (flags & 1) {
      this.pendingConfig = data.slice();
      this.configure(this.pendingConfig);
      return;
    }
    const key = Boolean(flags & 2);
    if (!this.decoder || this.decoder.state !== "configured" || (this.needKey && !key)) return;
    let payload = data;
    if (this.pendingConfig && key) {
      payload = new Uint8Array(this.pendingConfig.length + data.length);
      payload.set(this.pendingConfig);
      payload.set(data, this.pendingConfig.length);
      this.pendingConfig = null;
    }
    this.needKey = false;
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: (this.timestamp += 16667), data: payload }));
    } catch {
      this.recover();
    }
  }

  // --- layout and controls -------------------------------------------------
  /**
   * Size the screen to the room it has, keeping the phone's shape. The tile hugs
   * the screen (never narrower than its header needs), so a zoomed grid scrolls
   * over phones, not over empty space. A detached window's tile fills it.
   * @param {number} width @param {number} height the room this tile's screen has
   */
  fit(width, height) {
    let w = width;
    let h = w / this.aspect();
    if (h > height) {
      h = height;
      w = h * this.aspect();
    }
    // + the tile's 1px border on each side (a detached window's tile has none).
    this.tile.style.width = `${Math.floor(SOLO ? width : Math.max(w, Math.min(width, 200)) + 2)}px`;
    this.screen.style.width = `${Math.max(0, Math.floor(w))}px`;
    this.screen.style.height = `${Math.max(0, Math.floor(h))}px`;
    this.body.style.height = `${Math.floor(height)}px`;
    this.renderControls();
  }

  /**
   * Resize from the screen's corner. The grid centres the phones, so the size
   * follows the pointer's distance from the screen's centre, and whichever axis
   * the pointer is further out on wins, the way a locked-ratio corner drag does.
   * @param {PointerEvent} e @param {HTMLElement} grip
   */
  startResize(e, grip) {
    e.preventDefault();
    e.stopPropagation(); // the screen under it would take the press as a touch
    const r = this.screen.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx0 = Math.max(1, e.clientX - cx);
    const dy0 = Math.max(1, e.clientY - cy);
    const zoom0 = doc.play.zoom;
    const [min, max] = [ZOOMS[0], ZOOMS[ZOOMS.length - 1]];
    grip.setPointerCapture(e.pointerId);
    const move = (/** @type {PointerEvent} */ m) => {
      const ratio = Math.max((m.clientX - cx) / dx0, (m.clientY - cy) / dy0);
      const next = Math.round(Math.min(max, Math.max(min, zoom0 * ratio)) * 100) / 100;
      if (next === doc.play.zoom) return;
      doc.play.zoom = next;
      layoutGrid();
      zoomLabel.textContent = next === 1 ? "Fit" : `${Math.round(next * 100)}%`;
    };
    const end = () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      save();
      refreshChrome();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  }

  /** @param {PointerEvent} e */
  toFrame(e) {
    const r = this.overlay.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }

  renderControls() {
    const editing = mode === "edit" && this.serial === active;
    const height = this.overlay.clientHeight;
    const nodes = [];
    const lines = [];
    /** @param {HTMLElement} node @param {number} x @param {number} y @param {string} id @param {string} part */
    const place = (node, x, y, id, part) => {
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
      node.dataset.id = id;
      node.dataset.part = part;
      if (editing && id === selected) node.classList.add("selected");
      if (editing && id === fresh) node.classList.add("fresh");
      if (this.serial === active && live.has(id)) node.classList.add("pressed");
    };
    for (const c of this.controls()) {
      if (c.type === "tap") {
        const node = el("div", "ctl tap", keyLabel(c.key));
        place(node, c.x, c.y, c.id, "move");
        nodes.push(node);
      } else if (c.type === "joystick") {
        const size = Math.max(60, c.r * 2 * height);
        const node = el("div", "ctl joy");
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;
        place(node, c.x, c.y, c.id, "move");
        node.append(
          el("span", "lbl up", keyLabel(c.keys.up)), el("span", "lbl left", keyLabel(c.keys.left)),
          el("span", "lbl down", keyLabel(c.keys.down)), el("span", "lbl right", keyLabel(c.keys.right)), el("span", "dot"),
        );
        if (editing) {
          const grip = el("span", "grip");
          grip.dataset.id = c.id;
          grip.dataset.part = "radius";
          grip.dataset.tip = "Drag to resize";
          node.append(grip);
        }
        nodes.push(node);
      } else {
        const a = el("div", "ctl knob", keyLabel(c.key));
        place(a, c.x, c.y, c.id, "a");
        const b = el("div", "ctl knob small", "end");
        place(b, c.x2, c.y2, c.id, "b");
        nodes.push(a, b);
        lines.push(`<line x1="${c.x * 100}%" y1="${c.y * 100}%" x2="${c.x2 * 100}%" y2="${c.y2 * 100}%"/>`);
      }
    }
    const lineLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    lineLayer.setAttribute("class", "swipe-line");
    lineLayer.innerHTML = lines.join("");
    this.overlay.replaceChildren(lineLayer, ...nodes);
  }

  bindPointer() {
    /** @type {{id: string, part: string, pointer: number, moved: boolean} | null} */
    let drag = null;
    let mouseDown = false;
    this.overlay.addEventListener("pointerdown", (e) => {
      if (mode !== "edit" || e.button !== 0) return;
      if (this.serial !== active) {
        activate(this.serial);
        return;
      }
      const target = e.target instanceof HTMLElement ? e.target.closest("[data-id]") : null;
      if (!(target instanceof HTMLElement)) {
        selected = null;
        capture = null;
        this.renderControls();
        renderInspector();
        return;
      }
      // Capture on the overlay, not the control: controls are redrawn while
      // dragging, and a redrawn element would drop the capture.
      drag = { id: target.dataset.id ?? "", part: target.dataset.part ?? "move", pointer: e.pointerId, moved: false };
      this.overlay.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (drag.id === fresh) {
        fresh = null;
        this.renderControls();
      }
    });
    this.overlay.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const c = this.controls().find((x) => x.id === drag?.id);
      if (!c) return;
      const p = this.toFrame(e);
      drag.moved = true;
      if (drag.part === "radius" && c.type === "joystick") {
        const r = this.overlay.getBoundingClientRect();
        c.r = Math.max(0.04, Math.min(0.45, Math.hypot((p.x - c.x) * r.width, (p.y - c.y) * r.height) / r.height));
      } else if (drag.part === "b" && c.type === "swipe") {
        c.x2 = p.x;
        c.y2 = p.y;
      } else {
        c.x = p.x;
        c.y = p.y;
      }
      this.renderControls();
    });
    const endDrag = (/** @type {PointerEvent} */ e) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      const { id, moved } = drag;
      drag = null;
      selected = id;
      if (moved) save();
      this.renderControls();
      renderInspector();
    };
    this.overlay.addEventListener("pointerup", endDrag);
    this.overlay.addEventListener("pointercancel", endDrag);

    // Play mode: the mouse is a finger on the active phone (and its synced ones).
    this.screen.addEventListener("pointerdown", (e) => {
      if (mode !== "play") return;
      e.preventDefault();
      if (this.serial !== active) {
        activate(this.serial);
        return;
      }
      if (e.button === 2) return pressNav("back");
      if (e.button === 1) return pressNav("home");
      if (e.button !== 0) return;
      this.screen.setPointerCapture(e.pointerId);
      mouseDown = true;
      const p = this.toFrame(e);
      touch(ACTION.DOWN, MOUSE_ID, p.x, p.y);
    });
    this.screen.addEventListener("pointermove", (e) => {
      if (!mouseDown) return;
      const p = this.toFrame(e);
      touch(ACTION.MOVE, MOUSE_ID, p.x, p.y);
    });
    const mouseUp = (/** @type {PointerEvent} */ e) => {
      if (!mouseDown) return;
      mouseDown = false;
      const p = this.toFrame(e);
      touch(ACTION.UP, MOUSE_ID, p.x, p.y);
    };
    this.screen.addEventListener("pointerup", mouseUp);
    this.screen.addEventListener("pointercancel", mouseUp);
    this.screen.addEventListener("contextmenu", (e) => e.preventDefault());
  }
}

/** "avc1.PPCCLL" from the SPS in an Annex B config packet. @param {Uint8Array} config */
function codecOf(config) {
  for (let i = 0; i + 6 < config.length; i++) {
    if (config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1 && (config[i + 3] & 0x1f) === 7) {
      const hex = (/** @type {number} */ b) => b.toString(16).padStart(2, "0");
      return `avc1.${hex(config[i + 4])}${hex(config[i + 5])}${hex(config[i + 6])}`;
    }
  }
  return "avc1.42e01f";
}

// ---------------------------------------------------------------------------
// Page chrome
// ---------------------------------------------------------------------------

const root = /** @type {HTMLElement} */ (document.getElementById("app"));
const bar = el("div", "bar");
const profileSelect = makeSelect("Keymap profile of the active phone", (value) => {
  releaseAll();
  doc.lastProfile[active] = value;
  selected = null;
  capture = null;
  save();
  refreshChrome();
});
const renameInput = /** @type {HTMLInputElement} */ (el("input"));
renameInput.hidden = true;
const newBtn = btn("", () => {
  let n = Object.keys(doc.profiles).length + 1;
  while (doc.profiles[`Profile ${n}`]) n++;
  doc.profiles[`Profile ${n}`] = { controls: [] };
  if (active) doc.lastProfile[active] = `Profile ${n}`;
  save();
  refreshChrome();
}, { icon: "plus", tip: "New profile for the active phone" });
const renameBtn = btn("", () => {
  const dev = activeDev();
  if (!dev) return;
  renameInput.value = dev.profileName();
  profileSelect.node.hidden = true;
  renameInput.hidden = false;
  renameInput.focus();
  renameInput.select();
}, { icon: "pencil", tip: "Rename this profile" });
let deleteArmed = false;
const deleteBtn = btn("", () => {
  const dev = activeDev();
  if (!dev || Object.keys(doc.profiles).length < 2) return;
  if (!deleteArmed) {
    deleteArmed = true;
    deleteBtn.dataset.tip = "Click again to delete";
    deleteBtn.classList.add("is-on");
    setTimeout(() => {
      deleteArmed = false;
      deleteBtn.dataset.tip = "Delete this profile";
      deleteBtn.classList.remove("is-on");
    }, 3000);
    return;
  }
  const name = dev.profileName();
  delete doc.profiles[name];
  for (const [serial, value] of Object.entries(doc.lastProfile)) if (value === name) delete doc.lastProfile[serial];
  save();
  refreshChrome();
}, { icon: "trash", tip: "Delete this profile", cls: "is-danger" });
// One toggle: Edit to place the keys, Done to play with them. Playing is the
// resting state, so the bar only grows while editing.
const editBtn = btn("Edit", () => setMode(mode === "edit" ? "play" : "edit"), { icon: "pencil", tip: "Place and bind controls on the active phone" });
const inputBtn = btn("Shortcut Mode", () => setInputMode(inputMode === "type" ? "shortcut" : "type"), {
  tip: "Shortcut Mode fires the keymap; Typing Mode types into the phone. Press ~ to switch",
});
const addTap = btn("Tap", () => addControl({ id: uid(), type: "tap", x: 0.5, y: 0.5, key: "" }), { icon: "plus", tip: "One key touches one spot (hold = hold)" });
const addJoy = btn("Joystick", () =>
  addControl({ id: uid(), type: "joystick", x: 0.18, y: 0.7, r: 0.16, keys: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD" } }),
{ icon: "plus", tip: "WASD moves a virtual thumb" });
const addSwipe = btn("Swipe", () => addControl({ id: uid(), type: "swipe", x: 0.4, y: 0.5, x2: 0.6, y2: 0.5, ms: 150, key: "" }), { icon: "plus", tip: "One key swipes from start to end" });
const statusEl = el("span", "status");
const opacitySelect = makeSelect("How visible the controls are while playing", (value) => {
  doc.play.opacity = Number(value);
  save();
  refreshChrome();
});
const sizeSelect = makeSelect("How big the buttons are on every phone", (value) => {
  doc.play.keySize = Number(value);
  save();
  refreshChrome();
});
/** How the keys look: only while editing, where they are placed, not while playing with them. */
const keysGroup = el("span", "bar-group");
keysGroup.append(el("span", "label", "Keys"), opacitySelect.node, el("span", "label", "Size"), sizeSelect.node, el("span", "sep"));
const gridBtn = btn("", () => setLayout("grid"), { icon: "grid", tip: "Show every phone", cls: "ghost" });
const focusBtn = btn("", () => setLayout("focus"), { icon: "focus", tip: "Show only the active phone (the rest stay controlled)", cls: "ghost" });
const layoutSeg = el("div", "seg");
layoutSeg.append(gridBtn, focusBtn);
const zoomOutBtn = btn("", () => stepZoom(-1), { icon: "zoomOut", tip: "Zoom out (Ctrl+- or Ctrl+wheel)", cls: "ghost" });
const zoomLabel = btn("Fit", () => stepZoom(0), { tip: "Fit every phone in the pane (Ctrl+0)", cls: "ghost zoom-label" });
const zoomInBtn = btn("", () => stepZoom(1), { icon: "zoomIn", tip: "Zoom in (Ctrl+= or Ctrl+wheel). Scroll to move around", cls: "ghost" });
const zoomSeg = el("div", "seg");
zoomSeg.append(zoomOutBtn, zoomLabel, zoomInBtn);
// TEDI only: it opens and places the windows. A browser allows one popup per
// click, so outside TEDI each phone detaches on its own.
const detachAllBtn = btn("Detach All", () => {
  // One message, so TEDI can lay the windows out side by side instead of stacking them.
  const phones = [...devs.values()].map((d) => ({ serial: d.serial, width: d.w, height: d.h }));
  parent.postMessage({ type: "tam-detach-all", phones }, "*");
}, { icon: "detach", tip: "Open every phone in its own window, side by side, screen only. Close a window to bring its phone back here" });
bar.append(
  el("span", "label", "Profile"), profileSelect.node, renameInput, newBtn, renameBtn, deleteBtn, el("span", "sep"),
  editBtn, inputBtn, addTap, addJoy, addSwipe, el("span", "spacer"), statusEl,
  keysGroup, layoutSeg, zoomSeg, detachAllBtn, el("span", "sep"),
  btn("", () => pressNav("back"), { icon: "back", tip: "Back", cls: "ghost" }),
  btn("", () => pressNav("home"), { icon: "home", tip: "Home", cls: "ghost" }),
  btn("", () => pressNav("recent"), { icon: "recent", tip: "Recent apps", cls: "ghost" }),
);
// The grid scrolls when zoomed in; the stage around it holds what floats over
// the phones and must not scroll away with them.
const stage = el("div", "stage");
const grid = el("div", "grid");
const empty = el("div", "note", "Looking for Phones...");
const inspector = el("div", "inspector");
inspector.hidden = true;
const hint = el("div", "hint", "Click a Phone, Then Use the Keys");
// Which way the keyboard goes. It stays up while typing, because a detached
// phone's window has no bar to say so; switching back to shortcuts flashes it briefly.
const modeBadge = el("div", "mode-badge");
modeBadge.hidden = true;
let badgeTimer = 0;
grid.append(empty);
stage.append(grid, hint, modeBadge);
root.append(bar, stage);

let statusTimer = 0;
/** An error stays up for a few seconds, then the sync summary comes back. @param {string} text @param {boolean} [error] */
function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("is-error", error);
  clearTimeout(statusTimer);
  if (error) {
    statusTimer = window.setTimeout(() => {
      statusEl.classList.remove("is-error");
      refreshChrome();
    }, 6000);
  }
}

function refreshChrome() {
  const dev = activeDev();
  profileSelect.set(Object.keys(doc.profiles).map((name) => ({ value: name, label: name })), dev?.profileName() ?? "");
  opacitySelect.set(
    [{ value: "1", label: "100%" }, { value: "0.75", label: "75%" }, { value: "0.5", label: "50%" }, { value: "0.25", label: "25%" }, { value: "0", label: "Hidden" }],
    String(doc.play.opacity),
  );
  sizeSelect.set(KEY_SIZES.map((v) => ({ value: String(v), label: `${v * 100}%` })), String(doc.play.keySize));
  root.style.setProperty("--ctl-size", `${Math.round(54 * doc.play.keySize)}px`);
  root.style.setProperty("--keys-opacity", String(doc.play.opacity));
  root.classList.toggle("keys-hidden", doc.play.opacity === 0);
  deleteBtn.disabled = Object.keys(doc.profiles).length < 2;
  for (const node of [profileSelect.node, newBtn, renameBtn]) node.toggleAttribute("disabled", !dev);
  const editing = mode === "edit";
  editBtn.classList.toggle("is-on", editing);
  const editLabel = [...editBtn.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (editLabel) editLabel.textContent = editing ? "Done" : "Edit";
  setIcon(editBtn, editing ? "check" : "pencil");
  editBtn.dataset.tip = editing ? "Done: back to playing with the keys" : "Place and bind controls on the active phone";
  editBtn.setAttribute("aria-label", editBtn.dataset.tip);
  for (const node of [addTap, addJoy, addSwipe, newBtn, renameBtn, deleteBtn, keysGroup]) node.hidden = !editing;
  inputBtn.hidden = mode !== "play";
  inputBtn.textContent = inputMode === "type" ? "Typing Mode" : "Shortcut Mode";
  inputBtn.classList.toggle("is-on", inputMode === "type");
  // A detached phone's window has nothing to lay out: it is sized to the phone.
  zoomSeg.hidden = LONE;
  layoutSeg.hidden = LONE;
  const zoom = doc.play.zoom;
  zoomLabel.textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
  zoomOutBtn.disabled = zoom <= ZOOMS[0];
  zoomInBtn.disabled = zoom >= ZOOMS[ZOOMS.length - 1];
  detachAllBtn.hidden = !EMBED || Boolean(SOLO) || [...devs.keys()].every((serial) => detached.has(serial));
  gridBtn.classList.toggle("is-on", doc.play.layout === "grid");
  focusBtn.classList.toggle("is-on", doc.play.layout === "focus");
  grid.classList.toggle("playing", mode === "play");
  const synced = [...devs.values()].filter((d) => d.serial !== active && doc.play.sync[d.serial]).length;
  if (!statusEl.classList.contains("is-error")) setStatus(synced ? `Sync: Input Goes to ${synced + 1} Phones` : "");
  for (const d of devs.values()) {
    d.refreshHead();
    d.syncVideo();
    d.syncAudio();
    d.renderControls();
  }
  renderInspector();
}

/** @param {string} serial */
function activate(serial) {
  if (!devs.has(serial) || serial === active || !isShown(serial, true)) return;
  releaseAll();
  active = serial;
  selected = null;
  capture = null;
  if (doc.play.layout === "focus") layoutGrid();
  refreshChrome();
}

/** @param {"play" | "edit"} next */
function setMode(next) {
  releaseAll();
  mode = next;
  selected = null;
  capture = null;
  fresh = null;
  refreshChrome();
}

/** @param {"grid" | "focus"} next */
function setLayout(next) {
  doc.play.layout = next;
  save();
  layoutGrid();
  refreshChrome();
}

/**
 * Zoom the grid one step in (1) or out (-1), or back to fitting the pane (0),
 * keeping what is in the middle of the pane in the middle.
 * @param {-1 | 0 | 1} direction
 */
function stepZoom(direction) {
  const now = doc.play.zoom;
  const next = direction === 0
    ? 1
    : direction > 0
      ? ZOOMS.find((z) => z > now) ?? now
      : [...ZOOMS].reverse().find((z) => z < now) ?? now;
  if (SOLO || next === now) return;
  const cx = (grid.scrollLeft + grid.clientWidth / 2) / grid.scrollWidth;
  const cy = (grid.scrollTop + grid.clientHeight / 2) / grid.scrollHeight;
  doc.play.zoom = next;
  save();
  layoutGrid();
  grid.scrollLeft = cx * grid.scrollWidth - grid.clientWidth / 2;
  grid.scrollTop = cy * grid.scrollHeight - grid.clientHeight / 2;
  refreshChrome();
}

let lastWheelZoom = 0;
grid.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey) || SOLO) return;
  e.preventDefault(); // or the pane's page zoom takes it
  // A trackpad pinch sends a burst of small events: one step per burst.
  if (e.timeStamp - lastWheelZoom < 150) return;
  lastWheelZoom = e.timeStamp;
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

/** Fit every shown phone into the grid, choosing the column count that leaves the biggest screens, then apply the zoom. */
function layoutGrid() {
  const shown = [...devs.values()].filter((d) => isShown(d.serial));
  for (const d of devs.values()) d.tile.hidden = !shown.includes(d);
  empty.hidden = shown.length > 0;
  if (shown.length === 0) return;
  // A detached phone's window is edge to edge: no gaps, no header, no border.
  const gap = SOLO ? 0 : 6;
  const head = SOLO ? 0 : 29;
  const border = SOLO ? 0 : 2;
  // clientWidth/Height round a fractional box UP, so a layout fitted to them
  // overflows by a fraction of a pixel. That overflow brought scrollbars, the
  // scrollbars shrank the box, the smaller fit lost them again, and a detached
  // window flickered between two sizes every frame. One pixel of slack ends it.
  const W = grid.clientWidth - 1;
  const H = grid.clientHeight - 1;
  let best = { cw: 0, ch: 0, score: -1 };
  for (let cols = 1; cols <= shown.length; cols++) {
    const rows = Math.ceil(shown.length / cols);
    const cw = (W - gap * (cols - 1)) / cols - border;
    const ch = (H - gap * (rows - 1)) / rows - head - border;
    if (cw <= 0 || ch <= 0) continue;
    let score = 0;
    for (const d of shown) {
      const w = Math.min(cw, ch * d.aspect());
      score += w * (w / d.aspect());
    }
    if (score > best.score) best = { cw, ch, score };
  }
  const zoom = SOLO ? 1 : doc.play.zoom;
  for (const d of shown) d.fit(best.cw * zoom, best.ch * zoom);
  hint.hidden = document.hasFocus();
}
new ResizeObserver(layoutGrid).observe(grid);
window.addEventListener("focus", () => (hint.hidden = true));
window.addEventListener("blur", () => {
  releaseAll();
  hint.hidden = false;
});

renameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") commitRename();
  if (e.key === "Escape") {
    renameInput.hidden = true;
    profileSelect.node.hidden = false;
  }
  e.stopPropagation();
});
renameInput.addEventListener("blur", commitRename);
function commitRename() {
  const dev = activeDev();
  const before = dev?.profileName() ?? "";
  const next = renameInput.value.trim();
  renameInput.hidden = true;
  profileSelect.node.hidden = false;
  if (!dev || !next || next === before || doc.profiles[next]) return;
  doc.profiles[next] = doc.profiles[before];
  delete doc.profiles[before];
  for (const [serial, value] of Object.entries(doc.lastProfile)) if (value === before) doc.lastProfile[serial] = next;
  doc.lastProfile[dev.serial] = next;
  save();
  refreshChrome();
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** @param {Control} control */
function addControl(control) {
  const dev = activeDev();
  if (!dev) return;
  doc.lastProfile[dev.serial] = dev.profileName();
  dev.controls().push(control);
  selected = control.id;
  fresh = control.id;
  capture = control.type === "joystick" ? null : { id: control.id, slot: "key" };
  save();
  dev.renderControls();
  renderInspector();
}

function renderInspector() {
  const dev = activeDev();
  const c = mode === "edit" && dev ? dev.controls().find((x) => x.id === selected) ?? null : null;
  inspector.hidden = !c;
  if (!c || !dev) return;
  if (inspector.parentElement !== dev.body) dev.body.append(inspector);
  const kinds = { tap: "Tap", joystick: "Joystick", swipe: "Swipe" };
  inspector.replaceChildren(el("h3", "", kinds[c.type]));
  /** @param {string} label @param {string} slot @param {string} code */
  const bindRow = (label, slot, code) => {
    const row = el("div", "row");
    const waiting = capture?.id === c.id && capture.slot === slot;
    row.append(el("span", "", label), btn(waiting ? "Press a key..." : keyLabel(code), () => {
      capture = { id: c.id, slot };
      renderInspector();
    }, { cls: waiting ? "is-on" : "", tip: "Click, then press the key for this" }));
    inspector.append(row);
  };
  if (c.type === "joystick") {
    bindRow("Up", "up", c.keys.up);
    bindRow("Left", "left", c.keys.left);
    bindRow("Down", "down", c.keys.down);
    bindRow("Right", "right", c.keys.right);
    inspector.append(el("div", "help", "Drag the ring onto the game's stick. The square on its edge resizes it."));
  } else {
    bindRow("Key", "key", c.key);
  }
  if (c.type === "swipe") {
    const row = el("div", "row");
    const ms = /** @type {HTMLInputElement} */ (el("input"));
    ms.type = "number";
    ms.min = "30";
    ms.max = "2000";
    ms.value = String(c.ms);
    ms.addEventListener("change", () => {
      c.ms = Math.max(30, Math.min(2000, Number(ms.value) || 150));
      save();
    });
    ms.addEventListener("keydown", (e) => e.stopPropagation());
    row.append(el("span", "", "Duration"), ms, el("span", "label", "ms"));
    inspector.append(row, el("div", "help", "Drag the key circle (start) and the end circle."));
  }
  if (c.type === "tap") inspector.append(el("div", "help", "Drag the circle onto the button in the game."));
  inspector.append(btn("Delete control", () => deleteSelected(), { icon: "trash", cls: "is-danger" }));
  inspector.append(el("div", "help", "Esc cancels a key change. Delete removes the selected control."));
}

function deleteSelected() {
  const dev = activeDev();
  if (!dev || !selected) return;
  const profile = doc.profiles[dev.profileName()];
  profile.controls = profile.controls.filter((x) => x.id !== selected);
  selected = null;
  capture = null;
  save();
  dev.renderControls();
  renderInspector();
}

// ---------------------------------------------------------------------------
// Input: keys and fingers go to the active phone and every synced phone
// ---------------------------------------------------------------------------

/** @type {Set<string>} */
const held = new Set();
/** Fingers in use, 1..15 (0 is the mouse). */
const fingers = new Set();
/** @type {Map<string, {pid: number, x: number, y: number}>} */
const live = new Map();

function targets() {
  const lead = activeDev();
  if (!lead) return [];
  return [lead, ...[...devs.values()].filter((d) => d !== lead && doc.play.sync[d.serial])];
}

/** @param {number} a @param {number} id @param {number} x @param {number} y */
function touch(a, id, x, y) {
  const msg = { t: "touch", a, id, x: clamp01(x), y: clamp01(y) };
  for (const d of targets()) d.send(msg);
}

/** @param {"back" | "home" | "recent"} key */
function pressNav(key) {
  for (const d of targets()) d.send({ t: key });
}

function allocFinger() {
  for (let i = 1; i < 16; i++) {
    if (!fingers.has(i)) {
      fingers.add(i);
      return i;
    }
  }
  return -1;
}

/**
 * Show a key press on its control: it dips while held, and a ring ripples out
 * from it on every press. The ripple is its own class so it plays to the end
 * even when the key is only tapped.
 * @param {string} id @param {boolean} on
 */
function markPressed(id, on) {
  activeDev()?.overlay.querySelectorAll(`.ctl[data-id="${id}"]`).forEach((node) => {
    node.classList.toggle("pressed", on);
    if (!on) return;
    node.classList.remove("hit");
    void (/** @type {HTMLElement} */ (node).offsetWidth); // restart the animation
    node.classList.add("hit");
    node.addEventListener("animationend", () => node.classList.remove("hit"), { once: true });
  });
}

/** @param {string} id */
function lift(id) {
  const l = live.get(id);
  if (!l) return;
  touch(ACTION.UP, l.pid, l.x, l.y);
  fingers.delete(l.pid);
  live.delete(id);
  markPressed(id, false);
}

function releaseAll() {
  for (const id of [...live.keys()]) lift(id);
  held.clear();
}

/** @param {JoystickControl} c */
function steer(c) {
  const dev = activeDev();
  const dx = (held.has(c.keys.right) ? 1 : 0) - (held.has(c.keys.left) ? 1 : 0);
  const dy = (held.has(c.keys.down) ? 1 : 0) - (held.has(c.keys.up) ? 1 : 0);
  const dot = /** @type {HTMLElement | null} */ (dev?.overlay.querySelector(`.joy[data-id="${c.id}"] .dot`) ?? null);
  if (!dx && !dy) {
    lift(c.id);
    if (dot) dot.style.transform = "";
    return;
  }
  const k = dx && dy ? Math.SQRT1_2 : 1;
  const ratio = dev && dev.w && dev.h ? dev.h / dev.w : 9 / 16;
  const x = clamp01(c.x + dx * k * c.r * ratio);
  const y = clamp01(c.y + dy * k * c.r);
  if (dot) {
    const size = /** @type {HTMLElement} */ (dot.parentElement).offsetWidth * 0.36;
    dot.style.transform = `translate(${dx * k * size}px, ${dy * k * size}px)`;
  }
  const l = live.get(c.id);
  if (l) {
    touch(ACTION.MOVE, l.pid, x, y);
    l.x = x;
    l.y = y;
    return;
  }
  const pid = allocFinger();
  if (pid < 0) return;
  // Put the thumb down in the middle, then push it: most games only start
  // steering on a drag that begins inside the stick.
  touch(ACTION.DOWN, pid, c.x, c.y);
  live.set(c.id, { pid, x: c.x, y: c.y });
  markPressed(c.id, true);
  setTimeout(() => {
    const now = live.get(c.id);
    if (now?.pid !== pid) return;
    touch(ACTION.MOVE, pid, x, y);
    now.x = x;
    now.y = y;
  }, 16);
}

/** @param {SwipeControl} c */
function swipe(c) {
  if (live.has(c.id)) return;
  const pid = allocFinger();
  if (pid < 0) return;
  live.set(c.id, { pid, x: c.x, y: c.y });
  markPressed(c.id, true);
  touch(ACTION.DOWN, pid, c.x, c.y);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    setTimeout(() => {
      const l = live.get(c.id);
      if (l?.pid !== pid) return;
      l.x = c.x + ((c.x2 - c.x) * i) / steps;
      l.y = c.y + ((c.y2 - c.y) * i) / steps;
      touch(ACTION.MOVE, pid, l.x, l.y);
      if (i === steps) lift(c.id);
    }, (c.ms * i) / steps);
  }
}

/** Ctrl + these zoom the grid, like a browser page. @type {Record<string, -1 | 0 | 1>} */
const ZOOM_KEYS = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0 };

window.addEventListener("keydown", (e) => {
  const dev = activeDev();
  if (capture) {
    e.preventDefault();
    const c = dev?.controls().find((x) => x.id === capture?.id);
    if (e.code !== "Escape" && c) {
      if (c.type === "joystick") c.keys[/** @type {"up" | "left" | "down" | "right"} */ (capture.slot)] = e.code;
      else c.key = e.code;
      save();
    }
    capture = null;
    dev?.renderControls();
    renderInspector();
    return;
  }
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Escape" && closeOpenMenu) return closeOpenMenu();
  const zoomKey = ZOOM_KEYS[e.code];
  if ((e.ctrlKey || e.metaKey) && zoomKey !== undefined && !SOLO) {
    e.preventDefault();
    stepZoom(zoomKey);
    return;
  }
  if (!dev) return;
  if (mode === "edit") {
    if ((e.code === "Delete" || e.code === "Backspace") && selected) deleteSelected();
    return;
  }
  if (e.code === "Backquote") {
    e.preventDefault();
    if (!e.repeat) setInputMode(inputMode === "type" ? "shortcut" : "type");
    return;
  }
  if (inputMode === "type") {
    typeKey(e);
    return;
  }
  const hits = dev.controls().filter((c) => (c.type === "joystick" ? Object.values(c.keys).includes(e.code) : c.key === e.code));
  if (hits.length === 0) return;
  e.preventDefault();
  if (e.repeat || held.has(e.code)) return;
  held.add(e.code);
  for (const c of hits) {
    if (c.type === "joystick") steer(c);
    else if (c.type === "swipe") swipe(c);
    else if (!live.has(c.id)) {
      const pid = allocFinger();
      if (pid < 0) continue;
      live.set(c.id, { pid, x: c.x, y: c.y });
      markPressed(c.id, true);
      touch(ACTION.DOWN, pid, c.x, c.y);
    }
  }
});

/** Android keycodes for the keys that are actions, not characters. */
const TYPE_KEYCODES = {
  Enter: 66, NumpadEnter: 66, Backspace: 67, Delete: 112, Tab: 61, Escape: 111,
  ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Home: 122, End: 123, PageUp: 92, PageDown: 93,
};
/** Ctrl+letter shortcuts Android text fields understand (select all, copy, paste, cut, undo, redo). */
const CTRL_KEYCODES = { KeyA: 29, KeyC: 31, KeyV: 50, KeyX: 52, KeyZ: 54, KeyY: 53 };
const META_CTRL = 0x1000 | 0x2000; // META_CTRL_ON | META_CTRL_LEFT_ON
const META_SHIFT = 0x1 | 0x40; // META_SHIFT_ON | META_SHIFT_LEFT_ON

/** Typing mode: characters as text, the rest as key presses. @param {KeyboardEvent} e */
function typeKey(e) {
  if (e.isComposing) return;
  const altGr = e.ctrlKey && e.altKey; // AltGr arrives as Ctrl+Alt on Windows
  const ctrl = (e.ctrlKey || e.metaKey) && !altGr;
  /** @param {object} msg */
  const send = (msg) => {
    e.preventDefault();
    for (const d of targets()) d.send(msg);
  };
  const ctrlCode = CTRL_KEYCODES[/** @type {keyof typeof CTRL_KEYCODES} */ (e.code)];
  if (ctrl && ctrlCode) return send({ t: "keycode", code: ctrlCode, meta: META_CTRL });
  if (!ctrl && (!e.altKey || altGr) && e.key.length === 1) return send({ t: "text", text: e.key });
  const code = TYPE_KEYCODES[/** @type {keyof typeof TYPE_KEYCODES} */ (e.code)];
  if (code) send({ t: "keycode", code, meta: e.shiftKey ? META_SHIFT : 0 });
}

/** @param {"shortcut" | "type"} next */
function setInputMode(next) {
  releaseAll();
  inputMode = next;
  clearTimeout(badgeTimer);
  modeBadge.textContent = next === "type" ? "Typing Mode \u00b7 Press ~ for Shortcuts" : "Shortcut Mode";
  modeBadge.classList.toggle("is-typing", next === "type");
  modeBadge.hidden = false;
  if (next === "shortcut") badgeTimer = window.setTimeout(() => (modeBadge.hidden = true), 1200);
  refreshChrome();
}

window.addEventListener("keyup", (e) => {
  if (!held.has(e.code)) return;
  held.delete(e.code);
  e.preventDefault();
  for (const c of activeDev()?.controls() ?? []) {
    if (c.type === "joystick" && Object.values(c.keys).includes(e.code)) steer(c);
    else if (c.type === "tap" && c.key === e.code) lift(c.id);
  }
});

window.addEventListener("pagehide", () => {
  void audioCtx?.close().catch(() => {});
  releaseAll();
  for (const d of devs.values()) d.destroy();
});

// From the TEDI pane: which phone Play was pressed on, and TEDI's own font.
window.addEventListener("message", (e) => {
  if (e.source !== parent || !e.data || typeof e.data !== "object") return;
  if (e.data.type === "tam-focus" && typeof e.data.serial === "string") {
    pendingFocus = e.data.serial;
    activate(e.data.serial);
  } else if (e.data.type === "tam-names" && e.data.names && typeof e.data.names === "object") {
    customNames = e.data.names;
    for (const d of devs.values()) d.nameEl.textContent = customNames[d.serial] || d.name;
  } else if (e.data.type === "tam-font" && e.data.data instanceof ArrayBuffer && typeof e.data.family === "string") {
    const face = new FontFace(e.data.family, e.data.data, { weight: "100 900" });
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Phones come and go
// ---------------------------------------------------------------------------

let pendingFocus = FOCUS;

async function refreshDevices() {
  try {
    const list = await (await fetch(api("/api/devices"))).json();
    const ready = list.filter((/** @type {{state: string}} */ d) => d.state === "device");
    const seen = new Set();
    for (const info of ready) {
      // A detached phone's window still connects the phones synced to it, hidden,
      // so they keep following its input.
      if (ONLY.size > 0 && !ONLY.has(info.serial)) continue;
      if (SOLO && info.serial !== SOLO && !doc.play.sync[info.serial]) continue;
      seen.add(info.serial);
      if (!devs.has(info.serial)) {
        const dev = new Dev(info.serial, info.model);
        devs.set(info.serial, dev);
        grid.append(dev.tile);
      }
    }
    for (const [serial, dev] of [...devs]) {
      if (!seen.has(serial)) {
        dev.destroy();
        devs.delete(serial);
      }
    }
    if (pendingFocus && devs.has(pendingFocus) && isShown(pendingFocus, true)) {
      active = pendingFocus;
      pendingFocus = "";
    }
    pickActive();
    empty.textContent = SOLO
      ? "Phone Not Connected. Plug It In with USB Debugging On"
      : devs.size > 0
        ? "Every Phone Is Detached. Close Its Window to Bring It Back Here"
        : "No Phone Ready. Plug One In with USB Debugging On";
    layoutGrid();
    refreshChrome();
  } catch (error) {
    setStatus(`Could Not List Phones: ${error}`, true);
  }
}

async function start() {
  try {
    const loaded = await (await fetch(api("/api/keymaps"))).json();
    if (loaded?.doc && typeof loaded.doc.profiles === "object") {
      doc = loaded.doc;
      docRev = loaded.rev ?? 0;
    }
  } catch {}
  doc = normalizeDoc(doc);
  refreshChrome();
  await refreshDevices();
  setInterval(refreshDevices, POLL_MS);
}
void start();
