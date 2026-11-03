#!/usr/bin/env node
// Android Play relay: shows a phone's screen in a web page and turns the page's
// touches and mapped keys into real touches, through the scrcpy server.
//
//   node relay.mjs [--open] [--port 27700] [--adb PATH] [--token T] [--data FILE]
//
// TEDI starts it with --port 0 and reads the "TAM_RELAY_LISTENING <port>" line;
// run by hand it prints a URL (and opens it with --open). No dependencies.
//
// One scrcpy session per phone, shared by every page showing that phone (the
// grid pane, a detached phone's window, a browser tab), so none of them starts
// a second encoder. The session stops a few seconds after its last page closes.
//
// Sound: the session captures the phone's audio output (Android 11+), which
// plays it here instead of on the phone for as long as the session runs. It is
// sent raw and only to pages that play it, so muting a phone costs nothing.

import { execFile, spawn } from "node:child_process";
import { randomBytes, randomInt } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION, KEYCODE, SERVER_VERSION, CODEC_DISABLED, CODEC_H264, CODEC_RAW, ScrcpyStream, WsReader,
  acceptKey, backMessage, isTrusted, keycodeMessage, resetVideoMessage, textMessage, touchMessage, wsFrame,
} from "./protocol.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));
const ADB = String(args.adb || process.env.ADB || "adb");
const TOKEN = String(args.token || randomBytes(16).toString("hex"));
const DATA = String(args.data || path.join(os.homedir(), ".tedi", "android-keymaps.json"));
const SERVER_JAR = path.join(HERE, "scrcpy-server");
const REMOTE_JAR = "/data/local/tmp/tedi-play-server.jar";
const LINGER_MS = 4000;
/** Binary frames to a page start with a flags byte: 1 config, 2 key frame, 4 sound (else video). */
const FRAME_AUDIO = 4;
/** Above this much unsent video a page is too slow: skip to the next key frame (and drop sound). */
const BACKLOG_BYTES = 4 * 1024 * 1024;
/** The page, from play/client/: a document of its own that TEDI's stylesheet never reaches. */
const STATIC = { "/": "index.html", "/app.js": "app.js", "/app.css": "app.css" };
const MIME = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8" };

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, "");
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

/** @param {string[]} adbArgs @param {number} [timeout] @returns {Promise<string>} */
function adb(adbArgs, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(ADB, adbArgs, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${stderr || stdout || error.message}`.trim()));
      else resolve(String(stdout));
    });
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * `video` false keeps the page's touches working (the size still arrives) but
 * sends it no frames: a phone shown with its screen off costs this PC nothing.
 * `audio` is the same for sound (a muted or hidden phone).
 * `solo` marks a page that shows only this phone (a detached window); grid
 * pages leave such phones out while one is open.
 * @typedef {{socket: import("node:net").Socket, base: number, down: Set<number>, waitKey: boolean, video: boolean, audio: boolean, solo: boolean}} Viewer
 */

class Session {
  /** @param {string} serial */
  constructor(serial) {
    this.serial = serial;
    /** @type {Set<Viewer>} */
    this.viewers = new Set();
    this.name = serial;
    this.width = 0;
    this.height = 0;
    this.port = 0;
    this.closed = false;
    /** @type {import("node:child_process").ChildProcess | null} */
    this.proc = null;
    /** @type {import("node:net").Socket | null} */
    this.video = null;
    /** @type {import("node:net").Socket | null} */
    this.audio = null;
    /** Sound on this phone: "" not known yet, "on", "off" (before Android 11), "error". */
    this.audioState = "";
    /** @type {import("node:net").Socket | null} */
    this.control = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.lingerTimer = null;
    /** Phone settings (brightness, volume) waiting for the adb call before them, by kind: only the latest of each is kept. @type {Map<string, string>} */
    this.settingsPending = new Map();
    this.settingsBusy = false;
    /** The phone's media volume steps, once read: 0..15 on AOSP, 0..150 on MIUI. */
    this.volumeRange = { min: 0, max: 0 };
    this.nextBase = 0;
    this.ready = this.start().catch((error) => this.close(`Could Not Start: ${error.message}`));
  }

  async start() {
    const scid = randomInt(1, 0x7fffffff).toString(16).padStart(8, "0");
    // Every await below can outlive a close() (all pages left while starting);
    // `alive` stops the start and close() tears down whatever was made.
    const alive = () => {
      if (this.closed) throw new Error("closed while starting");
    };
    await adb(["-s", this.serial, "push", SERVER_JAR, REMOTE_JAR], 60000);
    alive();
    this.port = Number((await adb(["-s", this.serial, "forward", "tcp:0", `localabstract:scrcpy_${scid}`])).trim());
    if (this.closed && this.port) adb(["-s", this.serial, "forward", "--remove", `tcp:${this.port}`]).catch(() => {});
    alive();
    if (!this.port) throw new Error("adb forward returned no port");
    const serverArgs = [
      "-s", this.serial, "shell", `CLASSPATH=${REMOTE_JAR}`, "app_process", "/", "com.genymobile.scrcpy.Server", SERVER_VERSION,
      `scid=${scid}`, "log_level=info", "tunnel_forward=true", "audio=true", "audio_codec=raw", "control=true", "cleanup=true",
      "video_codec=h264", "max_size=1600", "video_bit_rate=8000000", "max_fps=60",
    ];
    const proc = spawn(ADB, serverArgs, { windowsHide: true });
    this.proc = proc;
    const onLog = (/** @type {Buffer} */ chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (/ERROR|Exception/.test(line)) this.broadcastJson({ type: "log", text: line.trim() });
      }
    };
    proc.stdout.on("data", onLog);
    proc.stderr.on("data", onLog);
    proc.on("exit", () => this.close("The Phone Ended the Session"));
    proc.on("error", (error) => this.close(`Could Not Start: ${error.message}`));

    // The server accepts the video socket first, then audio, then control. A
    // forward tunnel accepts a TCP connection even before the server listens, so
    // the first byte (the dummy byte) is what proves the server is there. A
    // socket nobody reads yet holds its data (it starts paused).
    const { socket: video, first } = await connectWithFirstByte(this.port);
    if (this.closed) video.destroy();
    alive();
    this.video = video;
    const audio = await connectPlain(this.port);
    if (this.closed) audio.destroy();
    alive();
    this.audio = audio;
    const control = await connectPlain(this.port);
    if (this.closed) control.destroy();
    alive();
    this.control = control;
    // Both sockets are up, and a forward only matters for NEW connections: drop
    // it now, so a relay that is killed (TEDI quits, the extension reloads)
    // leaves no stale forwards behind in the adb server.
    const forwarded = this.port;
    this.port = 0;
    adb(["-s", this.serial, "forward", "--remove", `tcp:${forwarded}`]).catch(() => {});
    control.on("data", () => {}); // clipboard and other device messages are not used
    control.on("error", () => {});
    const stream = new ScrcpyStream();
    const onVideo = (/** @type {Buffer} */ chunk) => {
      for (const event of stream.push(chunk)) this.onEvent(event);
    };
    onVideo(first);
    video.on("data", onVideo);
    video.on("close", () => this.close("Video Stream Closed"));
    video.on("error", () => {});
    video.resume();
    // Sound is optional: losing it leaves the screen and the controls running.
    const sound = new ScrcpyStream({ first: false });
    audio.on("data", (/** @type {Buffer} */ chunk) => {
      for (const event of sound.push(chunk)) this.onAudio(event);
    });
    audio.on("close", () => this.audioState === "on" && this.setAudioState("error"));
    audio.on("error", () => {});
  }

  /** @param {import("./protocol.mjs").StreamEvent} event */
  onAudio(event) {
    if (event.type === "codec") {
      this.setAudioState(event.id === CODEC_RAW ? "on" : event.id === CODEC_DISABLED ? "off" : "error");
    } else if (event.type === "packet" && !event.config) {
      const frame = wsFrame(2, Buffer.concat([Buffer.from([FRAME_AUDIO]), event.data]));
      for (const viewer of this.viewers) {
        if (viewer.audio && viewer.socket.writableLength < BACKLOG_BYTES) viewer.socket.write(frame);
      }
    }
  }

  /** @param {string} state */
  setAudioState(state) {
    this.audioState = state;
    this.broadcastJson(this.sessionInfo());
  }

  /** @param {import("./protocol.mjs").StreamEvent} event */
  onEvent(event) {
    if (event.type === "device") {
      this.name = event.name || this.serial;
    } else if (event.type === "codec") {
      if (event.id !== CODEC_H264) this.close("The Phone Sent a Codec Other Than H.264");
    } else if (event.type === "session") {
      this.width = event.width;
      this.height = event.height;
      this.broadcastJson(this.sessionInfo());
    } else {
      const flags = (event.config ? 1 : 0) | (event.key ? 2 : 0);
      const frame = wsFrame(2, Buffer.concat([Buffer.from([flags]), event.data]));
      for (const viewer of this.viewers) {
        if (!viewer.video) continue;
        if (!event.config && viewer.socket.writableLength > BACKLOG_BYTES) viewer.waitKey = true;
        if (viewer.waitKey && !event.config && !event.key) continue;
        if (event.key) viewer.waitKey = false;
        viewer.socket.write(frame);
      }
    }
  }

  sessionInfo() {
    return { type: "session", width: this.width, height: this.height, name: this.name, serial: this.serial, audio: this.audioState };
  }

  /** @param {import("node:net").Socket} socket @param {boolean} video @param {boolean} audio @param {boolean} solo */
  addViewer(socket, video, audio, solo) {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    /** @type {Viewer} */
    const viewer = { socket, base: (this.nextBase++ % 8) * 16, down: new Set(), waitKey: true, video, audio, solo };
    this.viewers.add(viewer);
    // A page joining a stream that is already running missed the size, the
    // config packet and the last key frame: resend the size and restart the
    // encoder. The first page of a session gets all of that anyway.
    void this.ready.then(() => {
      if (this.closed || !this.viewers.has(viewer) || !this.width) return;
      socket.write(wsFrame(1, Buffer.from(JSON.stringify(this.sessionInfo()))));
      if (viewer.video) this.control?.write(resetVideoMessage());
    });
    return viewer;
  }

  /** @param {Viewer} viewer */
  removeViewer(viewer) {
    // A page that vanished mid-touch must not leave a finger on the screen.
    for (const id of viewer.down) this.touch(viewer, ACTION.UP, id, 0, 0);
    this.viewers.delete(viewer);
    if (viewer.solo) announceDetached();
    if (this.viewers.size === 0 && !this.lingerTimer) {
      this.lingerTimer = setTimeout(() => this.close(""), LINGER_MS);
    }
  }

  /** @param {Viewer} viewer @param {number} action @param {number} id @param {number} x @param {number} y */
  touch(viewer, action, id, x, y) {
    if (!this.control || !this.width) return;
    const pointer = viewer.base + (id & 15);
    if (action === ACTION.UP) viewer.down.delete(id);
    else viewer.down.add(id);
    this.control.write(touchMessage(action, pointer, x, y, this.width, this.height));
  }

  /** @param {Viewer} viewer @param {any} msg */
  onMessage(viewer, msg) {
    if (!msg || typeof msg !== "object" || !this.control) return;
    if (msg.t === "touch" && [0, 1, 2].includes(msg.a) && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
      this.touch(viewer, msg.a, Number(msg.id) | 0, msg.x, msg.y);
    } else if (msg.t === "back") {
      this.control.write(backMessage(ACTION.DOWN));
      this.control.write(backMessage(ACTION.UP));
    } else if (msg.t === "home" || msg.t === "recent") {
      const code = msg.t === "home" ? KEYCODE.HOME : KEYCODE.APP_SWITCH;
      this.control.write(keycodeMessage(ACTION.DOWN, code));
      this.control.write(keycodeMessage(ACTION.UP, code));
    } else if (msg.t === "text" && typeof msg.text === "string" && msg.text) {
      // Typing mode: characters, as the phone's keyboard would type them.
      this.control.write(textMessage(msg.text));
    } else if (msg.t === "keycode" && Number.isInteger(msg.code) && msg.code > 0 && msg.code < 400) {
      // Typing mode: Enter, Backspace, arrows and Ctrl shortcuts, as key presses.
      const meta = Number.isInteger(msg.meta) ? msg.meta & 0xffffff : 0;
      this.control.write(keycodeMessage(ACTION.DOWN, msg.code, 0, meta));
      this.control.write(keycodeMessage(ACTION.UP, msg.code, 0, meta));
    } else if (msg.t === "reset") {
      this.control.write(resetVideoMessage());
    } else if (msg.t === "audio") {
      viewer.audio = Boolean(msg.on);
    } else if (msg.t === "brightness?") {
      void this.readBrightness().then((value) => viewer.socket.write(wsFrame(1, Buffer.from(JSON.stringify({ type: "brightness", ...value })))));
    } else if (msg.t === "brightness" && (msg.auto === true || (Number.isFinite(msg.level) && msg.level >= 0 && msg.level <= 1))) {
      // Numbers only reach the shell, never text from the page.
      const level = Number(msg.level);
      void this.queueSetting("brightness", msg.auto === true
        ? "settings put system screen_brightness_mode 1"
        : `settings put system screen_brightness_mode 0; cmd display set-brightness ${level.toFixed(4)} >/dev/null 2>&1 || settings put system screen_brightness ${Math.max(1, Math.round(level * 255))}`);
    } else if (msg.t === "volume?") {
      void this.readVolume().then((level) => viewer.socket.write(wsFrame(1, Buffer.from(JSON.stringify({ type: "volume", level })))));
    } else if (msg.t === "volume" && Number.isFinite(msg.level) && msg.level >= 0 && msg.level <= 1 && this.volumeRange.max > 0) {
      const { min, max } = this.volumeRange;
      const step = min + Math.round(Number(msg.level) * (max - min));
      void this.queueSetting("volume", `cmd media_session volume --stream 3 --set ${step} >/dev/null 2>&1 || media volume --stream 3 --set ${step}`);
    } else if (msg.t === "video") {
      const on = Boolean(msg.on);
      if (on === viewer.video) return;
      viewer.video = on;
      // Turning the screen back on needs a config packet and a key frame.
      if (on) {
        viewer.waitKey = true;
        this.control.write(resetVideoMessage());
      }
    }
  }

  /**
   * The phone's screen brightness: 0..1 as Android's display service counts it
   * (linear light, the same scale on every phone), and whether Auto is on.
   * MIUI and others store the plain setting on scales of their own (0..4095
   * here), so the display service is asked first and that setting only on a
   * phone too old to have it.
   * @returns {Promise<{level: number | null, auto: boolean}>}
   */
  async readBrightness() {
    try {
      const out = await adb(["-s", this.serial, "shell",
        "settings get system screen_brightness_mode; dumpsys display | grep -m1 mCurrentScreenBrightnessSetting; settings get system screen_brightness"]);
      const [mode, current, plain] = out.split(/\r?\n/);
      const float = Number(/=\s*([0-9.]+)/.exec(current ?? "")?.[1]);
      const level = Number.isFinite(float) ? float : Number(plain) / 255;
      return { level: Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : null, auto: mode?.trim() === "1" };
    } catch {
      return { level: null, auto: false };
    }
  }

  /**
   * The phone's media volume, 0..1 of its own steps (the same volume the phone's
   * keys change). Sound captured for Play is taken after it, so this is also how
   * loud the phone plays here.
   * @returns {Promise<number | null>}
   */
  async readVolume() {
    try {
      const out = await adb(["-s", this.serial, "shell", "cmd media_session volume --stream 3 --get 2>/dev/null || media volume --stream 3 --get"]);
      const m = /volume is (\d+) in range \[(\d+)\.\.(\d+)\]/.exec(out);
      if (!m || Number(m[3]) <= Number(m[2])) return null;
      this.volumeRange = { min: Number(m[2]), max: Number(m[3]) };
      return (Number(m[1]) - this.volumeRange.min) / (this.volumeRange.max - this.volumeRange.min);
    } catch {
      return null;
    }
  }

  /** Run what a slider asked for, one adb call at a time, the latest of each kind winning. @param {string} kind @param {string} script */
  async queueSetting(kind, script) {
    this.settingsPending.set(kind, script);
    if (this.settingsBusy) return;
    this.settingsBusy = true;
    try {
      for (const [next, run] of this.settingsPending) {
        if (this.closed) break;
        this.settingsPending.delete(next);
        await adb(["-s", this.serial, "shell", run]).catch(() => {});
      }
    } finally {
      this.settingsBusy = false;
    }
  }

  /** @param {object} value */
  broadcastJson(value) {
    const frame = wsFrame(1, Buffer.from(JSON.stringify(value)));
    for (const viewer of this.viewers) viewer.socket.write(frame);
  }

  /** @param {string} reason */
  close(reason) {
    if (this.closed) return;
    this.closed = true;
    if (reason) this.broadcastJson({ type: "closed", reason });
    for (const viewer of this.viewers) viewer.socket.end(wsFrame(8, Buffer.alloc(0)));
    sessions.delete(this.serial);
    this.video?.destroy();
    this.audio?.destroy();
    this.control?.destroy();
    this.proc?.kill();
    if (this.port) adb(["-s", this.serial, "forward", "--remove", `tcp:${this.port}`]).catch(() => {});
  }
}

/** @param {number} port @returns {Promise<{socket: import("node:net").Socket, first: Buffer}>} */
async function connectWithFirstByte(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      const fail = () => {
        socket.destroy();
        resolve(null);
      };
      socket.once("error", fail);
      socket.once("close", fail);
      socket.once("data", (first) => {
        // Hold everything after the dummy byte until the caller listens:
        // a flowing socket with no "data" listener drops what arrives.
        socket.pause();
        socket.removeListener("close", fail);
        resolve({ socket, first });
      });
    });
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the scrcpy server did not answer");
}

/** @param {number} port @returns {Promise<import("node:net").Socket>} */
function connectPlain(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => resolve(socket));
    socket.once("error", reject);
  });
}

/** @type {Map<string, Session>} */
const sessions = new Map();
/** Bumped on every save, so a page can tell a newer keymap from its own echo. */
let keymapRev = 0;

/** Phones that have a one-phone page (a detached window) open right now. */
const detachedSerials = () =>
  [...sessions.values()].filter((s) => [...s.viewers].some((v) => v.solo)).map((s) => s.serial);

function announceDetached() {
  const message = { type: "detached", serials: detachedSerials() };
  for (const session of sessions.values()) session.broadcastJson(message);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/** @param {string} text */
function parseDevices(text) {
  return text.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/)).filter((f) => f.length >= 2 && f[0])
    .map((f) => ({ serial: f[0], state: f[1], model: (f.find((x) => x.startsWith("model:")) ?? "").slice(6).replaceAll("_", " ") }));
}

/** @param {http.IncomingMessage} req */
function trusted(req, url) {
  return isTrusted({ host: req.headers.host, origin: req.headers.origin, token: url.searchParams.get("t") }, listeningPort, TOKEN);
}

/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * The request target as a URL, or null. Node accepts targets such as "http://["
 * that are no URL at all, and a throw here used to end the relay for everyone.
 * @param {string | undefined} target
 */
function parseUrl(target) {
  try {
    return new URL(target ?? "/", "http://127.0.0.1");
  } catch {
    return null;
  }
}

/** Every page polls the phone list; one `adb devices` answers them all for a moment. */
let devicesCache = { at: 0, list: /** @type {Promise<unknown[]> | null} */ (null) };
function listDevices() {
  if (!devicesCache.list || Date.now() - devicesCache.at > 2500) {
    const list = adb(["devices", "-l"]).then(parseDevices);
    list.catch(() => {
      if (devicesCache.list === list) devicesCache.list = null;
    });
    devicesCache = { at: Date.now(), list };
  }
  return devicesCache.list;
}

/**
 * Save the keymaps without ever losing the user's file: a file this relay could
 * not read (a hand edit gone wrong) is kept aside first, and the write goes
 * through a temporary file, so a crash mid-write leaves the old one whole.
 * @param {unknown} doc
 */
function writeKeymaps(doc) {
  mkdirSync(path.dirname(DATA), { recursive: true });
  if (existsSync(DATA)) {
    try {
      JSON.parse(readFileSync(DATA, "utf8"));
    } catch {
      copyFileSync(DATA, `${DATA}.unreadable-${Date.now()}.json`);
    }
  }
  const temp = `${DATA}.tmp`;
  writeFileSync(temp, JSON.stringify(doc, null, 2));
  renameSync(temp, DATA);
}

const server = http.createServer(async (req, res) => {
  const url = parseUrl(req.url);
  if (!url) {
    res.writeHead(400).end();
    return;
  }
  const host = req.headers.host ?? "";
  if (host !== `127.0.0.1:${listeningPort}` && host !== `localhost:${listeningPort}`) {
    res.writeHead(403).end();
    return;
  }
  const file = STATIC[/** @type {keyof typeof STATIC} */ (url.pathname)];
  if (!file && (!url.pathname.startsWith("/api/") || !trusted(req, url))) {
    res.writeHead(url.pathname.startsWith("/api/") ? 403 : 404).end();
    return;
  }
  try {
    if (req.method === "GET" && file) {
      const body = readFileSync(path.join(HERE, "client", file));
      res.writeHead(200, { "content-type": MIME[/** @type {keyof typeof MIME} */ (file.split(".").pop())], "cache-control": "no-store" });
      res.end(body);
    } else if (url.pathname === "/api/devices") {
      sendJson(res, 200, await listDevices());
    } else if (url.pathname === "/api/keymaps" && req.method === "GET") {
      let doc = { version: 1, profiles: {}, lastProfile: {} };
      try {
        doc = JSON.parse(readFileSync(DATA, "utf8"));
      } catch {}
      sendJson(res, 200, { rev: keymapRev, doc });
    } else if (url.pathname === "/api/keymaps" && req.method === "PUT") {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512 * 1024) throw new Error("keymap file too large");
        chunks.push(chunk);
      }
      const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!doc || typeof doc !== "object" || typeof doc.profiles !== "object") throw new Error("not a keymap document");
      writeKeymaps(doc);
      // Every open page (a grid pane, a detached phone's window, a browser tab) shows
      // the new keymaps now, instead of saving its stale copy over them later.
      keymapRev += 1;
      for (const session of sessions.values()) session.broadcastJson({ type: "keymaps", rev: keymapRev, doc });
      sendJson(res, 200, { ok: true, rev: keymapRev });
    } else {
      res.writeHead(404).end();
    }
  } catch (error) {
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    else res.destroy();
  }
});

server.on("upgrade", (req, socket, head) => {
  socket.on("error", () => {});
  const url = parseUrl(req.url);
  const serial = url?.searchParams.get("serial") ?? "";
  const key = req.headers["sec-websocket-key"];
  if (!url || url.pathname !== "/ws" || !key || !trusted(req, url) || !/^[A-Za-z0-9._:-]{1,128}$/.test(serial)) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(String(key))}\r\n\r\n`);
  socket.setNoDelay(true);
  let session = sessions.get(serial);
  if (!session) {
    session = new Session(serial);
    sessions.set(serial, session);
  }
  const owner = session;
  const solo = url.searchParams.get("solo") === "1";
  const viewer = owner.addViewer(socket, url.searchParams.get("video") !== "0", url.searchParams.get("audio") === "1", solo);
  // Every page learns which phones are detached as it connects, and again
  // whenever a detached window opens or closes.
  if (solo) announceDetached();
  else socket.write(wsFrame(1, Buffer.from(JSON.stringify({ type: "detached", serials: detachedSerials() }))));
  const reader = new WsReader(64 * 1024);
  const onData = (/** @type {Buffer} */ chunk) => {
    try {
      for (const frame of reader.push(chunk)) {
        if (frame.opcode === 1) owner.onMessage(viewer, JSON.parse(frame.payload.toString("utf8")));
        else if (frame.opcode === 9) socket.write(wsFrame(10, frame.payload));
        else if (frame.opcode === 8) socket.end(wsFrame(8, Buffer.alloc(0)));
      }
    } catch {
      socket.destroy();
    }
  };
  socket.on("data", onData);
  if (head?.length) onData(head);
  socket.on("close", () => owner.removeViewer(viewer));
});

let listeningPort = 0;
const wanted = args.port === undefined ? 27700 : Number(args.port);
server.listen(wanted, "127.0.0.1", () => {
  const address = server.address();
  listeningPort = typeof address === "object" && address ? address.port : wanted;
  const link = `http://127.0.0.1:${listeningPort}/?t=${TOKEN}`;
  console.log(`TAM_RELAY_LISTENING ${listeningPort}`);
  console.log(`Android Play: ${link}`);
  if (args.open) openBrowser(link);
});
server.on("error", (error) => {
  console.error(`Android Play relay: ${error.message}`);
  process.exit(1);
});

/** @param {string} link */
function openBrowser(link) {
  const [cmd, cmdArgs] =
    process.platform === "win32" ? ["explorer.exe", [link]] : process.platform === "darwin" ? ["open", [link]] : ["xdg-open", [link]];
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: "ignore" });
  child.on("error", () => console.log("Open the link above in a browser."));
  child.unref();
}

function shutdown() {
  for (const session of [...sessions.values()]) session.close("Relay Stopped");
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, shutdown);
// On Windows TEDI's children die with it (a Job object), but on macOS and Linux
// a relay could outlive a TEDI that quit or crashed. Its parent going away is
// the signal to stop too.
const PARENT = process.ppid;
setInterval(() => process.ppid !== PARENT && shutdown(), 5000).unref();
