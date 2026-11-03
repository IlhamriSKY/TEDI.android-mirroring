// The Android Mirror pane, in the fleet's layout: the host container is the
// bento tray, one card floats on it, a 30 px bar carries the counts and
// Refresh, and a table holds the devices. Plain DOM, one <style> block, every
// class `tam-` prefixed and every colour a host token, so it follows the theme.
//
// The pane is repainted every tick but only rebuilt when what it shows has
// changed, so a hovered row or a pressed button is not thrown away each second.

import { state } from "./runtime.js";
import { isSafeEndpoint, unconnected } from "./adb.js";

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
  trash: svg('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
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
.tam-table .tam-pick { width: 1%; max-width: none; padding-right: 0; }
.tam-pick-btn { display: inline-flex; align-items: center; padding: 4px 2px; border: 0; background: none; color: inherit; cursor: pointer; outline: none; }
.tam-box { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 14px; height: 14px; box-sizing: border-box; border: 1px solid var(--input); background: transparent; color: var(--primary-foreground, #fff); transition: background-color 0.12s ease, border-color 0.12s ease; }
.tam-box.is-on { border-color: var(--primary, #3b82f6); background: var(--primary, #3b82f6); }
.tam-pick-btn:hover .tam-box { border-color: var(--muted-foreground); }
.tam-pick-btn:focus-visible .tam-box { border-color: var(--ring, var(--primary, #3b82f6)); }

.tam-name { cursor: text; border-bottom: 1px dashed transparent; }
.tam-name:hover, .tam-name:focus-visible { border-bottom-color: var(--muted-foreground); outline: none; }
.tam-name-input { height: 22px; font-family: var(--font-sans, inherit); font-size: 11.5px; }
.tam-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--radius, 0); background: var(--tedi-button-face, color-mix(in srgb, var(--foreground) 18%, transparent)); color: var(--tedi-button-face-foreground, var(--foreground)); font: inherit; font-size: 11px; font-weight: 500; line-height: 1; cursor: pointer; outline: none; white-space: nowrap; transition: background-color 0.12s ease, border-color 0.12s ease; }
.tam-btn:hover:not([disabled]) { background: var(--tedi-button-face-hover, color-mix(in srgb, var(--foreground) 28%, transparent)); }
.tam-btn:focus-visible { border-color: var(--ring, var(--primary, #3b82f6)); }
.tam-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.tam-btn.is-on { background: var(--primary, #3b82f6); border-color: var(--primary, #3b82f6); color: var(--primary-foreground, #fff); }
.tam-btn.is-on:hover:not([disabled]) { background: color-mix(in srgb, var(--primary, #3b82f6) 82%, transparent); }
.tam-btn.is-danger { color: var(--destructive, #ef4444); }
.tam-btn.is-danger:hover:not([disabled]) { background: color-mix(in srgb, var(--destructive, #ef4444) 20%, transparent); }
.tam-btn.tam-icon { width: 22px; padding: 0; gap: 0; }
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
/* Wi-Fi debugging: pair once with a code, then connect (host Input look). */
.tam-pair { flex: 0 0 auto; display: grid; grid-template-columns: auto minmax(0, 1fr) 72px auto; gap: 6px 8px; align-items: center; padding: 8px; border-top: 1px solid var(--border); }
.tam-pair[hidden] { display: none; }
.tam-pair-title { grid-column: 1 / -1; color: var(--muted-foreground); font-size: 10px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
.tam-pair-hint { grid-column: 1 / -1; color: var(--muted-foreground); line-height: 1.5; }
.tam-pair-hint.tam-warn { color: var(--tedi-icon-working, #ca8a04); }
.tam-pair-label { color: var(--muted-foreground); }
.tam-pair .tam-wide { grid-column: span 2; }
.tam-pair-act, .tam-pair-act .tam-tipwrap, .tam-pair-act .tam-btn { display: flex; width: 100%; }
.tam-input { box-sizing: border-box; width: 100%; min-width: 0; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: var(--radius, 0); background: color-mix(in srgb, var(--input) 50%, transparent); color: var(--foreground); font: inherit; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; outline: none; transition: border-color 0.12s ease, background-color 0.12s ease; }
.tam-input:hover { background: color-mix(in srgb, var(--input) 60%, transparent); }
.tam-input:focus { border-color: var(--ring, var(--primary, #3b82f6)); background: color-mix(in srgb, var(--input) 60%, transparent); }
.tam-input::placeholder { color: var(--muted-foreground); opacity: 0.7; font-family: var(--font-sans, inherit); }
.tam-input.tam-search { width: 170px; height: 22px; flex: 0 0 auto; font-family: var(--font-sans, inherit); font-size: 11px; }
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

/**
 * A checkbox in the app's own shape (see `components/ui/checkbox.tsx` and
 * tedi.devenv's `ui/el.js`): a 14px square, not the browser's rounded widget.
 * @param {boolean} on
 */
function checkbox(on) {
  const box = el("span", `tam-box${on ? " is-on" : ""}`);
  if (on) box.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>');
  return box;
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
 * @param {{ busy?: boolean, disabled?: boolean, on?: boolean, danger?: boolean, aria?: string, tip?: string, onClick: () => void }} opts
 * @returns {HTMLElement}
 */
function button(label, glyph, opts) {
  const classes = ["tam-btn", opts.on ? "is-on" : "", opts.danger ? "is-danger" : "", label ? "" : "tam-icon"];
  const node = /** @type {HTMLButtonElement} */ (el("button", classes.filter(Boolean).join(" ")));
  node.type = "button";
  node.disabled = Boolean(opts.busy || opts.disabled);
  if (opts.busy) node.setAttribute("aria-busy", "true");
  node.append(icon(opts.busy ? "loader" : glyph, opts.busy));
  // An icon on its own still has to say what it is.
  if (label) node.append(document.createTextNode(label));
  else if (opts.aria) node.setAttribute("aria-label", opts.aria);
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

/** @param {import("./adb.js").AndroidDevice[]} devices */
function devicesTable(devices) {
  const table = el("table", "tam-table");
  table.append(head(["", "Device", "Serial", "Connection", "State", ""]));
  const body = el("tbody");
  for (const device of devices) {
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
    const picked = state.selected.has(device.serial);
    const pick = /** @type {HTMLButtonElement} */ (el("button", "tam-pick-btn"));
    pick.type = "button";
    pick.setAttribute("role", "checkbox");
    pick.setAttribute("aria-checked", String(picked));
    pick.setAttribute("aria-label", `Play ${state.names[device.serial] || device.model || device.serial} together with the others`);
    pick.dataset.tip = picked
      ? "Ticked: Play opens this phone together with the other ticked ones"
      : "Tick to play this phone together with the other ticked ones";
    pick.append(checkbox(picked));
    pick.addEventListener("click", () => state.onSelect?.(device.serial, !picked));
    const row = el("tr");
    row.append(
      td(pick, "tam-pick"),
      td(nameCell(device)),
      td(device.serial, "tam-mono tam-dim"),
      td(device.transport === "unknown" ? el("span", "tam-dim", "-") : el("span", "tam-badge", device.transport === "wifi" ? "Wi-Fi" : device.transport)),
      td(mirroring ? "Mirroring" : label, mirroring ? "tam-ok" : cls),
      td(actions(
        ...(device.transport === "usb" && device.state === "device" ? [button("Wi-Fi", "wifi", {
          busy: state.connecting.has(device.serial),
          tip: "Connects this phone over Wi-Fi too, so the cable can come off. Lasts until the phone restarts; the phone must be on a network this PC can reach.",
          onClick: () => state.onWifi?.(device.serial),
        })] : []),
        button("Play", "gamepad", {
          disabled: device.state !== "device" || !state.nodePath,
          tip: state.nodePath
            ? "Opens Android Play on this phone alone. Tick phones and use Play All for several at once."
            : "Play needs Node.js. Install it from nodejs.org, then press Refresh.",
          onClick: () => state.onPlay?.(device.serial),
        }),
        action,
        ...(isSafeEndpoint(device.serial) ? [button("", "trash", {
          danger: true,
          aria: "Remove this phone",
          busy: state.connecting.has(device.serial),
          tip: "Disconnects this phone and forgets it, so it does not come back on its own. Its name and tick go with it.",
          onClick: () => state.onForget?.(device.serial),
        })] : []),
      ), "tam-act"),
    );
    body.append(row);
  }
  table.append(body);
  return table;
}

/** The serial whose name is being typed, so a repaint does not throw the input away. */
let renaming = "";
/** What is typed in the search box. Lives here, not in a rebuilt node. */
let query = "";
/** Whether the Wi-Fi Debugging strip is open. Closed, the card is just phones. */
let formOpen = false;

/** @param {import("./adb.js").AndroidDevice} device */
function matchesQuery(device) {
  if (!query) return true;
  const name = state.names[device.serial] || device.model || device.product || "";
  return `${name} ${device.serial} ${device.transport}`.toLowerCase().includes(query);
}

/**
 * The phone's name: what the user called it, else what adb reports. Clicking it
 * turns the cell into a field, because a fleet of identical models is exactly
 * when a name matters.
 * @param {import("./adb.js").AndroidDevice} device
 */
function nameCell(device) {
  const fallback = device.model || device.product || device.serial;
  if (renaming === device.serial) {
    const field = /** @type {HTMLInputElement} */ (el("input", "tam-input tam-name-input"));
    field.value = state.names[device.serial] ?? "";
    field.placeholder = fallback;
    field.setAttribute("aria-label", "Phone name");
    const done = (/** @type {boolean} */ keep) => {
      if (renaming !== device.serial) return;
      renaming = "";
      if (keep) state.onRename?.(device.serial, field.value);
      else repaintViews();
    };
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") done(true);
      else if (event.key === "Escape") done(false);
    });
    field.addEventListener("blur", () => done(true));
    queueMicrotask(() => {
      field.focus();
      field.select();
    });
    return field;
  }
  const label = el("span", "tam-name", state.names[device.serial] || fallback);
  label.tabIndex = 0;
  label.setAttribute("role", "button");
  label.dataset.tip = "Click to rename this phone. Empty puts its model back";
  const edit = () => {
    renaming = device.serial;
    repaintViews();
  };
  label.addEventListener("click", edit);
  label.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      edit();
    }
  });
  return label;
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

/** @param {string} placeholder @param {string} label @param {string} [cls] */
function input(placeholder, label, cls = "tam-input") {
  const node = /** @type {HTMLInputElement} */ (el("input", cls));
  node.type = "text";
  node.placeholder = placeholder;
  node.spellcheck = false;
  node.autocomplete = "off";
  node.setAttribute("aria-label", label);
  return node;
}

/**
 * Wireless debugging by hand, for networks where the phone never shows up by
 * itself (mDNS blocked): pair once with the phone's code, then connect. Built
 * once per pane, so a repaint never clears what is being typed.
 * @returns {{node: HTMLElement, paint: () => void}}
 */
function pairForm() {
  const node = el("div", "tam-pair");
  const pairAt = input("IP:Port in the pairing window", "Pairing address");
  const code = input("Code", "Pairing code");
  code.inputMode = "numeric";
  code.maxLength = 6;
  const connectAt = input("IP address & Port on the Wireless debugging screen", "Connect address", "tam-input tam-wide");
  const pairSlot = el("span", "tam-pair-act");
  const connectSlot = el("span", "tam-pair-act");
  const hint = el("div", "tam-pair-hint");
  /** The pairing window's address once paired: its port closes then, so connecting to it always fails. */
  let pairedAt = "";
  const pairOk = () => isSafeEndpoint(pairAt.value.trim()) && /^\d{6}$/.test(code.value.trim());
  const pairingPort = () => pairedAt !== "" && connectAt.value.trim() === pairedAt;
  const connectOk = () => isSafeEndpoint(connectAt.value.trim()) && !pairingPort();
  const pair = () => {
    if (!pairOk()) return;
    const endpoint = pairAt.value.trim();
    void state.onPair?.(endpoint, code.value.trim()).then((ok) => {
      if (!ok) return;
      pairedAt = endpoint;
      // Same phone, different port: only the port is left to type.
      code.value = "";
      connectAt.value = `${endpoint.slice(0, endpoint.lastIndexOf(":"))}:`;
      connectAt.focus();
      paint();
    });
  };
  const connect = () => {
    if (!connectOk()) return;
    void state.onConnect?.(connectAt.value.trim()).then((ok) => {
      if (ok) connectAt.value = "";
      paint();
    });
  };
  const paint = () => {
    node.hidden = !formOpen || !state.adbPath || !state.tracked;
    const wrongPort = pairingPort();
    hint.className = wrongPort ? "tam-pair-hint tam-warn" : "tam-pair-hint";
    hint.textContent = wrongPort
      ? "That is the pairing port, which closes after pairing. Close the pairing window: the Wireless debugging screen shows a different port under IP address & Port."
      : pairedAt
        ? "Paired. Close the pairing window, then type the port shown under IP address & Port on the Wireless debugging screen."
        : "Phone not listed? On the phone open Developer options > Wireless debugging. Pair once with a pairing code, then connect.";
    const pairing = state.connecting.has(`pair:${pairAt.value.trim()}`);
    pairSlot.replaceChildren(button("Pair", "wifi", {
      busy: pairing,
      disabled: !pairOk(),
      tip: "Pairs this PC with the phone, once. On the phone: Wireless debugging > Pair device with pairing code, and keep that window open.",
      onClick: pair,
    }));
    connectSlot.replaceChildren(button("Connect", "wifi", {
      busy: state.connecting.has(connectAt.value.trim()),
      disabled: !connectOk(),
      tip: "Connects to a paired phone. The port changes each time Wireless debugging is turned on.",
      onClick: connect,
    }));
  };
  for (const field of [pairAt, code, connectAt]) field.addEventListener("input", paint);
  pairAt.addEventListener("keydown", (event) => event.key === "Enter" && code.focus());
  code.addEventListener("keydown", (event) => event.key === "Enter" && pair());
  connectAt.addEventListener("keydown", (event) => event.key === "Enter" && connect());
  node.append(
    el("div", "tam-pair-title", "Wi-Fi Debugging"),
    hint,
    el("span", "tam-pair-label", "Pair"), pairAt, code, pairSlot,
    el("span", "tam-pair-label", "Connect"), connectAt, connectSlot,
  );
  paint();
  return { node, paint };
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
  const search = input("Search name or serial", "Search phones", "tam-input tam-search");
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    repaintViews();
  });
  bar.append(chips, el("div", "tam-spacer"), search, actions);
  const alert = el("div");
  const body = el("div", "tam-body");
  const form = pairForm();
  card.append(bar, alert, body, form.node);
  host.append(card);
  container.append(host);

  let signature = "";
  const paint = () => {
    const services = unconnected(state.discovered, state.devices);
    const sig = JSON.stringify([
      state.probed, state.refreshing, state.tracked, state.adbPath, state.scrcpyPath, state.error,
      state.nodePath,
      state.devices, services, [...state.mirrors.keys()], [...state.starting], [...state.stopping], [...state.connecting],
      [...state.selected], state.names, renaming, query, formOpen,
    ]);
    if (sig === signature) return;
    signature = sig;

    const ready = state.devices.filter((device) => device.state === "device").length;
    chips.replaceChildren(
      el("span", "", state.devices.length === 1 ? "1 Device" : `${state.devices.length} Devices`),
      el("span", "", `${ready} Ready`),
      el("span", "", `${state.mirrors.size} Mirroring`),
    );
    const ticked = state.devices.filter((device) => device.state === "device" && state.selected.has(device.serial)).length;
    actions.replaceChildren(
      button("Play All", "gamepad", {
        disabled: ticked === 0 || !state.nodePath,
        tip: !state.nodePath
          ? "Play needs Node.js. Install it from nodejs.org, then press Refresh."
          : ticked === 0
            ? "Tick the phones you want, then this opens them together in one Android Play pane."
            : `Opens Android Play with the ${ticked} ticked ${ticked === 1 ? "phone" : "phones"}.`,
        onClick: () => state.onPlaySelected?.(),
      }),
      button("Add Phone", "wifi", {
        on: formOpen,
        tip: "Add a phone over Wi-Fi: pair once with the code from Developer options > Wireless debugging, then connect.",
        onClick: () => {
          formOpen = !formOpen;
          repaintViews();
        },
      }),
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
      const shown = state.devices.filter(matchesQuery);
      parts.push(
        shown.length > 0
          ? devicesTable(shown)
          : note(
              state.devices.length > 0
                ? `No Phone Matches "${query}"`
                : "No Android Device Detected. Plug One In with USB Debugging On, or Turn On Wireless Debugging",
            ),
      );
      if (services.length > 0) parts.push(wifiTable(services));
      body.replaceChildren(...parts);
    }
    body.scrollTop = top;
    form.paint();
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
