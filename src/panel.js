// The Android Mirror pane, in the fleet's layout: the host container is the
// bento tray, one card floats on it, a 30 px bar carries the counts and
// Refresh, and a table holds the devices. Plain DOM, one <style> block, every
// class `tam-` prefixed and every colour a host token, so it follows the theme.
//
// The pane is repainted every tick but only rebuilt when what it shows has
// changed, so a hovered row or a pressed button is not thrown away each second.

import { state } from "./runtime.js";
import { unconnected } from "./adb.js";

const STYLE_ID = "tedi-android-mirror-styles";

/** Inline lucide glyphs, so no React root per icon. */
const svg = (/** @type {string} */ body) =>
  `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  refresh: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'),
  loader: svg('<path d="M21 12a9 9 0 1 1-6.219-8.56"/>'),
  play: svg('<polygon points="6 3 20 12 6 21 6 3"/>'),
  stop: svg('<rect width="14" height="14" x="5" y="5" rx="1"/>'),
  wifi: svg('<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  gamepad: svg('<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>'),
};

const CSS = `
.tam-host { height: 100%; display: flex; flex-direction: column; overflow: hidden; padding: 6px; box-sizing: border-box; background: var(--sidebar, var(--background)); color: var(--foreground); font-size: 11.5px; }
.tam-card { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; border: 1px solid var(--border); border-radius: var(--radius, 0); background: var(--background); overflow: hidden; }
.tam-bar { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-bottom: 1px solid var(--border); flex: 0 0 auto; }
.tam-chips { display: flex; align-items: center; gap: 8px; color: var(--muted-foreground); min-width: 0; overflow: hidden; white-space: nowrap; }
.tam-chips > span + span::before { content: "·"; margin-right: 8px; opacity: 0.6; }
.tam-chips > span:first-child { color: var(--foreground); font-weight: 600; }
.tam-spacer { flex: 1 1 auto; }
.tam-actions { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.tam-row-actions { display: inline-flex; gap: 6px; }
.tam-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--radius, 0); background: var(--tedi-button-face, color-mix(in srgb, var(--foreground) 18%, transparent)); color: var(--tedi-button-face-foreground, var(--foreground)); font: inherit; font-size: 11px; font-weight: 500; line-height: 1; cursor: pointer; outline: none; white-space: nowrap; transition: background-color 0.12s ease, border-color 0.12s ease; }
.tam-btn:hover:not([disabled]) { background: var(--tedi-button-face-hover, color-mix(in srgb, var(--foreground) 28%, transparent)); }
.tam-btn:focus-visible { border-color: var(--ring, var(--primary, #3b82f6)); }
.tam-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.tam-btn.is-on { background: var(--primary, #3b82f6); border-color: var(--primary, #3b82f6); color: var(--primary-foreground, #fff); }
.tam-btn.is-on:hover:not([disabled]) { background: color-mix(in srgb, var(--primary, #3b82f6) 82%, transparent); }
.tam-ico { display: inline-flex; flex: 0 0 auto; }
@keyframes tam-spin { to { transform: rotate(360deg); } }
.tam-spin { animation: tam-spin 0.7s linear infinite; }
.tam-alert { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border); color: var(--tedi-icon-working, #ca8a04); flex: 0 0 auto; }
.tam-alert.is-error { color: var(--destructive, #ef4444); }
.tam-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
.tam-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.tam-table th { position: sticky; top: 0; z-index: 1; text-align: left; padding: 5px 8px; background: var(--card, var(--background)); border-bottom: 1px solid var(--border); color: var(--muted-foreground); font-size: 10px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; white-space: nowrap; }
.tam-table td { height: 30px; padding: 0 8px; border-bottom: 1px solid color-mix(in srgb, var(--border) 50%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 0; }
.tam-table tr:hover td { background: color-mix(in srgb, var(--muted, #888) 22%, transparent); }
.tam-table .tam-act { width: 1%; max-width: none; text-align: right; }
.tam-table + .tam-table { margin-top: 10px; }
.tam-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; }
.tam-dim { color: var(--muted-foreground); }
.tam-badge { padding: 0 5px; background: color-mix(in srgb, var(--primary, #3b82f6) 18%, transparent); color: var(--primary, #3b82f6); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; line-height: 15px; }
.tam-ok { color: var(--tedi-icon-idle, #059669); }
.tam-warn { color: var(--tedi-icon-working, #ca8a04); }
.tam-note { display: flex; align-items: center; gap: 6px; padding: 16px; color: var(--muted-foreground); line-height: 1.6; }
/* Host TooltipContent: popover surface, a hairline ring, soft shadow. The
   wrapper carries the text so a DISABLED button still explains itself (a
   disabled button gets no mouse events; the wrapper under it does). */
.tam-tipwrap { display: inline-flex; }
.tam-tipwrap > button:disabled { pointer-events: none; }
.tam-tip { position: fixed; z-index: 10001; max-width: 300px; padding: 6px 12px; background: var(--popover, var(--background)); color: var(--popover-foreground, var(--foreground)); font-size: 11px; line-height: 1.375; box-shadow: 0 0 0 1px color-mix(in srgb, var(--foreground) 8%, transparent), 0 10px 15px -3px rgb(0 0 0 / 0.22); pointer-events: none; opacity: 0; transform: scale(0.95); transition: opacity 0.12s ease, transform 0.12s ease; }
.tam-tip.is-open { opacity: 1; transform: scale(1); }
`;

function injectStyles() {
  // Rewrite rather than bail: an in-place upgrade re-activates without
  // deactivating, and the old sheet would otherwise style the new markup.
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== CSS) style.textContent = CSS;
}

export function removeStyles() {
  document.getElementById(STYLE_ID)?.remove();
  tipEl?.remove();
  tipEl = null;
}

// One tooltip for the pane, with the host's timing: 300 ms to open, then it
// follows the pointer from button to button without waiting again.
/** @type {HTMLElement | null} */
let tipEl = null;
let tipTimer = 0;
/** @type {Element | null} */
let tipFor = null;

/** @param {HTMLElement} target */
function showTip(target) {
  if (!tipEl?.isConnected) {
    tipEl = el("div", "tam-tip");
    tipEl.setAttribute("role", "tooltip");
    document.body.append(tipEl);
  }
  tipEl.textContent = target.dataset.tip ?? "";
  tipEl.classList.add("is-open");
  const r = target.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const x = Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2));
  const y = r.bottom + 6 + t.height > innerHeight - 8 ? r.top - t.height - 6 : r.bottom + 6;
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipFor = null;
  tipEl?.classList.remove("is-open");
}

/** @param {MouseEvent} event */
function onTipOver(event) {
  const target = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
  if (target === tipFor) return;
  clearTimeout(tipTimer);
  tipFor = target;
  if (!(target instanceof HTMLElement)) {
    tipEl?.classList.remove("is-open");
    return;
  }
  if (tipEl?.classList.contains("is-open")) showTip(target);
  else tipTimer = window.setTimeout(() => target.isConnected && showTip(target), 300);
}

/** @param {string} tag @param {string} [cls] @param {string} [text] */
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

/** @param {keyof typeof ICONS} name @param {boolean} [spin] */
function icon(name, spin = false) {
  const node = el("span", spin ? "tam-ico tam-spin" : "tam-ico");
  node.innerHTML = ICONS[name];
  return node;
}

/**
 * A button with a leading icon that turns into a spinning loader while busy,
 * the same busy language as the host's Spinner and the Network pane.
 * @param {string} label @param {keyof typeof ICONS} glyph
 * @param {{ busy?: boolean, disabled?: boolean, on?: boolean, tip?: string, onClick: () => void }} opts
 * @returns {HTMLElement}
 */
function button(label, glyph, opts) {
  const node = /** @type {HTMLButtonElement} */ (el("button", opts.on ? "tam-btn is-on" : "tam-btn"));
  node.type = "button";
  node.disabled = Boolean(opts.busy || opts.disabled);
  if (opts.busy) node.setAttribute("aria-busy", "true");
  node.append(icon(opts.busy ? "loader" : glyph, opts.busy), document.createTextNode(label));
  node.addEventListener("click", opts.onClick);
  if (!opts.tip) return node;
  node.setAttribute("aria-description", opts.tip);
  const wrap = el("span", "tam-tipwrap");
  wrap.dataset.tip = opts.tip;
  wrap.append(node);
  return wrap;
}

/** @param {string} value @returns {[string, string]} label and class */
function stateLabel(value) {
  if (value === "device") return ["Ready", "tam-ok"];
  if (value === "unauthorized") return ["Allow USB Debugging on the Phone", "tam-warn"];
  if (value === "no permissions") return ["No USB Permission (udev Rules)", "tam-warn"];
  if (value === "authorizing" || value === "connecting") return [value[0].toUpperCase() + value.slice(1), "tam-dim"];
  return [value[0].toUpperCase() + value.slice(1), "tam-warn"];
}

/** @param {string[]} names */
function head(names) {
  const thead = el("thead");
  const tr = el("tr");
  for (const name of names) tr.append(el("th", name ? "" : "tam-act", name));
  thead.append(tr);
  return thead;
}

/** @param {Node | string} content @param {string} [cls] */
function td(content, cls) {
  const cell = el("td", cls);
  cell.append(content);
  return cell;
}

function devicesTable() {
  const table = el("table", "tam-table");
  table.append(head(["Device", "Serial", "Connection", "State", ""]));
  const body = el("tbody");
  for (const device of state.devices) {
    const [label, cls] = stateLabel(device.state);
    const mirroring = state.mirrors.has(device.serial);
    const stopping = state.stopping.has(device.serial);
    const action =
      mirroring || stopping
        ? button("Stop", "stop", {
            on: true,
            busy: stopping,
            tip: "Closes the scrcpy window started here.",
            onClick: () => state.onStop?.(device.serial),
          })
        : button("Mirror", "play", {
            busy: state.starting.has(device.serial),
            disabled: device.state !== "device" || !state.scrcpyPath,
            tip: state.scrcpyPath ? "Opens the phone in its own scrcpy window." : "Mirror needs scrcpy. Install it, then press Refresh.",
            onClick: () => state.onStart?.(device.serial),
          });
    const row = el("tr");
    row.append(
      td(device.model || device.product || device.serial),
      td(device.serial, "tam-mono tam-dim"),
      td(device.transport === "unknown" ? el("span", "tam-dim", "-") : el("span", "tam-badge", device.transport === "wifi" ? "Wi-Fi" : device.transport)),
      td(mirroring ? "Mirroring" : label, mirroring ? "tam-ok" : cls),
      td(actions(
        button("Play", "gamepad", {
          disabled: device.state !== "device" || !state.nodePath,
          tip: state.nodePath
            ? "Opens Android Play on this phone: every phone's screen with keyboard controls for games. Use Edit to place the keys."
            : "Play needs Node.js. Install it from nodejs.org, then press Refresh.",
          onClick: () => state.onPlay?.(device.serial),
        }),
        action,
      ), "tam-act"),
    );
    body.append(row);
  }
  table.append(body);
  return table;
}

/** @param {HTMLElement[]} nodes */
function actions(...nodes) {
  const box = el("span", "tam-row-actions");
  box.append(...nodes);
  return box;
}

/** @param {import("./adb.js").WifiService[]} services */
function wifiTable(services) {
  const table = el("table", "tam-table");
  table.append(head(["Wi-Fi Debugging", "Address", ""]));
  const body = el("tbody");
  for (const service of services) {
    const row = el("tr");
    row.append(
      td(service.name),
      td(service.endpoint, "tam-mono tam-dim"),
      td(
        button("Connect", "wifi", {
          busy: state.connecting.has(service.endpoint),
          tip: "Connects to this phone over Wi-Fi debugging.",
          onClick: () => state.onConnect?.(service.endpoint),
        }),
        "tam-act",
      ),
    );
    body.append(row);
  }
  table.append(body);
  return table;
}

/** @param {string} text @param {boolean} [spin] */
function note(text, spin = false) {
  const node = el("div", "tam-note");
  if (spin) node.append(icon("loader", true));
  node.append(document.createTextNode(text));
  return node;
}

export function repaintViews() {
  for (const paint of [...state.views]) paint();
}

/** @param {HTMLElement} container @returns {() => void} */
export function mount(container) {
  injectStyles();
  container.replaceChildren();
  const host = el("div", "tam-host");
  host.addEventListener("mouseover", onTipOver);
  host.addEventListener("mouseleave", hideTip);
  host.addEventListener("scroll", hideTip, { capture: true, passive: true });
  const card = el("div", "tam-card");
  const bar = el("div", "tam-bar");
  const chips = el("div", "tam-chips");
  const actions = el("div", "tam-actions");
  bar.append(chips, el("div", "tam-spacer"), actions);
  const alert = el("div");
  const body = el("div", "tam-body");
  card.append(bar, alert, body);
  host.append(card);
  container.append(host);

  let signature = "";
  const paint = () => {
    const services = unconnected(state.discovered, state.devices);
    const sig = JSON.stringify([
      state.probed, state.refreshing, state.tracked, state.adbPath, state.scrcpyPath, state.error,
      state.nodePath,
      state.devices, services, [...state.mirrors.keys()], [...state.starting], [...state.stopping], [...state.connecting],
    ]);
    if (sig === signature) return;
    signature = sig;

    const ready = state.devices.filter((device) => device.state === "device").length;
    chips.replaceChildren(
      el("span", "", state.devices.length === 1 ? "1 Device" : `${state.devices.length} Devices`),
      el("span", "", `${ready} Ready`),
      el("span", "", `${state.mirrors.size} Mirroring`),
    );
    actions.replaceChildren(
      button("Refresh", "refresh", { busy: state.refreshing, tip: "Looks for phones, adb and scrcpy again.", onClick: () => state.onRefresh?.() }),
    );

    const problem = state.error ?? (state.probed && state.adbPath && !state.scrcpyPath ? "scrcpy Not Found, Mirror Is Off. Install scrcpy, Then Press Refresh" : "");
    alert.className = problem ? `tam-alert${state.error ? " is-error" : ""}` : "";
    alert.replaceChildren(...(problem ? [icon("alert"), document.createTextNode(problem)] : []));

    const top = body.scrollTop;
    if (!state.probed || (state.adbPath && !state.tracked && !state.error)) {
      body.replaceChildren(note("Detecting Android Devices...", true));
    } else if (!state.adbPath) {
      body.replaceChildren(note("adb Not Found. Install Android SDK Platform-Tools or scrcpy, Then Press Refresh"));
    } else {
      const parts = [];
      parts.push(state.devices.length > 0 ? devicesTable() : note("No Android Device Detected. Plug One In with USB Debugging On, or Turn On Wireless Debugging"));
      if (services.length > 0) parts.push(wifiTable(services));
      body.replaceChildren(...parts);
    }
    body.scrollTop = top;
  };

  state.views.add(paint);
  paint();
  state.onRefresh?.();
  return () => {
    state.views.delete(paint);
    hideTip();
    container.replaceChildren();
  };
}
