/** @typedef {import("../tedi").ExtensionContext} ExtensionContext */
/** @typedef {import("./adb.js").AndroidDevice} AndroidDevice */
/** @typedef {import("./adb.js").WifiService} WifiService */

/** @type {ExtensionContext | null} */
export let ctx = null;

/**
 * TEDI's floating windows run their own copy of this extension just to render
 * a panel. That copy shows the detached screen and nothing else: no tracker,
 * no status item, no relay of its own. Its JS dies with the window without a
 * deactivate, so anything it spawned would be orphaned.
 */
export const IN_FLOAT = typeof location !== "undefined" && /float\.html$/.test(location.pathname);

/** @param {ExtensionContext | null} value */
export function setCtx(value) {
  ctx = value;
}

/**
 * @typedef {Object} MirrorHandle
 * @property {number} handle
 * @property {number} offset
 * @property {string} title
 */

/**
 * The resident `adb track-devices` client. It is also what keeps the adb
 * server alive on Windows, where TEDI puts every child in a kill-on-close Job:
 * a server started by a short-lived adb would die with it.
 * @typedef {Object} Tracker
 * @property {number} handle
 * @property {number} offset
 * @property {string} buffer
 */

/**
 * @typedef {Object} RuntimeState
 * @property {boolean} active
 * @property {ReturnType<typeof setInterval> | null} timer
 * @property {boolean} ticking
 * @property {number} ticks
 * @property {boolean} probed tools were looked for at least once
 * @property {number} probes how many looks have finished (each Refresh is one)
 * @property {boolean} discovering
 * @property {boolean} refreshing a user-started refresh is in flight
 * @property {Tracker | null} tracker
 * @property {number} trackerRetryAt
 * @property {boolean} tracked the tracker has reported at least once
 * @property {AndroidDevice[]} devices
 * @property {WifiService[]} discovered
 * @property {string} adbPath
 * @property {string} scrcpyPath
 * @property {string} nodePath runs play/relay.mjs
 * @property {{handle: number, offset: number, port: number, token: string, owned: boolean} | null} relay
 *   `owned` false: the main window's relay, joined by a floating window
 * @property {string | null} error
 * @property {Set<() => void>} views
 * @property {Map<string, MirrorHandle>} mirrors
 * @property {Set<string>} connecting
 * @property {Set<string>} starting
 * @property {Set<string>} stopping
 * @property {(() => void) | null} onOpen
 * @property {(() => void) | null} onRefresh
 * @property {((endpoint: string) => void) | null} onConnect
 * @property {((serial: string) => void) | null} onStart
 * @property {((serial: string) => void) | null} onStop
 * @property {((serial: string) => void) | null} onPlay
 */

/** @type {RuntimeState} */
export const state = {
  active: false,
  timer: null,
  ticking: false,
  ticks: 0,
  probed: false,
  probes: 0,
  discovering: false,
  refreshing: false,
  tracker: null,
  trackerRetryAt: 0,
  tracked: false,
  devices: [],
  discovered: [],
  adbPath: "",
  scrcpyPath: "",
  nodePath: "",
  relay: null,
  error: null,
  views: new Set(),
  mirrors: new Map(),
  connecting: new Set(),
  starting: new Set(),
  stopping: new Set(),
  onOpen: null,
  onRefresh: null,
  onConnect: null,
  onStart: null,
  onStop: null,
  onPlay: null,
};

export function clearTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}
