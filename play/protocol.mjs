// The wire formats the relay speaks, kept pure so they can be tested without a
// phone: the scrcpy 4.1 server protocol (doc/develop.md, control message unit
// tests) and just enough of RFC 6455 to talk to the viewer page.

import { createHash } from "node:crypto";

/** Must equal the bundled scrcpy-server; the server refuses any other client version. */
export const SERVER_VERSION = "4.1";

export const MSG = { KEYCODE: 0, TEXT: 1, TOUCH: 2, BACK_OR_SCREEN_ON: 4, RESET_VIDEO: 17 };
/** scrcpy's cap on one text message, in UTF-8 bytes. */
const TEXT_MAX_BYTES = 300;
export const ACTION = { DOWN: 0, UP: 1, MOVE: 2 };
/** Android keycodes the toolbar sends (Back has a message of its own). */
export const KEYCODE = { HOME: 3, APP_SWITCH: 187 };
export const CODEC_H264 = 0x68323634;
/** Uncompressed sound: 48 kHz, 16-bit little-endian, stereo, interleaved. */
export const CODEC_RAW = 0x00726177;
/** In place of an audio codec: sound is off on this phone (before Android 11), or it failed to start. */
export const CODEC_DISABLED = 0;
export const CODEC_ERROR = 1;

/** @param {number} value @param {number} max */
const clamp = (value, max) => Math.max(0, Math.min(max, Math.round(value)));

/**
 * One finger event. `x`/`y` are 0..1 of the video frame; the server ignores an
 * event whose width/height are not the current video size, so they are sent as
 * the size of the last session packet.
 * @param {number} action @param {number} pointerId @param {number} x @param {number} y
 * @param {number} width @param {number} height
 */
export function touchMessage(action, pointerId, x, y, width, height) {
  const buf = Buffer.alloc(32);
  buf[0] = MSG.TOUCH;
  buf[1] = action;
  buf.writeBigUInt64BE(BigInt.asUintN(64, BigInt(pointerId)), 2);
  buf.writeInt32BE(clamp(x * width, width - 1), 10);
  buf.writeInt32BE(clamp(y * height, height - 1), 14);
  buf.writeUInt16BE(width, 18);
  buf.writeUInt16BE(height, 20);
  buf.writeUInt16BE(action === ACTION.UP ? 0 : 0xffff, 22);
  // action button and buttons (24..31) stay 0: a finger has no buttons.
  return buf;
}

/** @param {number} action @param {number} keycode @param {number} [repeat] @param {number} [metastate] */
export function keycodeMessage(action, keycode, repeat = 0, metastate = 0) {
  const buf = Buffer.alloc(14);
  buf[0] = MSG.KEYCODE;
  buf[1] = action;
  buf.writeUInt32BE(keycode, 2);
  buf.writeUInt32BE(repeat, 6);
  buf.writeUInt32BE(metastate, 10);
  return buf;
}

/** @param {number} action */
export const backMessage = (action) => Buffer.from([MSG.BACK_OR_SCREEN_ON, action]);

/**
 * Typed text, injected as characters (typing mode). Cut to scrcpy's 300-byte
 * cap on a character boundary, never in the middle of a UTF-8 sequence.
 * @param {string} text
 */
export function textMessage(text) {
  let bytes = Buffer.from(text, "utf8");
  if (bytes.length > TEXT_MAX_BYTES) {
    let end = TEXT_MAX_BYTES;
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
    bytes = bytes.subarray(0, end);
  }
  const head = Buffer.alloc(5);
  head[0] = MSG.TEXT;
  head.writeUInt32BE(bytes.length, 1);
  return Buffer.concat([head, bytes]);
}

/** Ask the encoder to restart: a fresh config packet and key frame follow. */
export const resetVideoMessage = () => Buffer.from([MSG.RESET_VIDEO]);

/**
 * @typedef {{type: "device", name: string} | {type: "codec", id: number}
 *   | {type: "session", width: number, height: number}
 *   | {type: "packet", config: boolean, key: boolean, data: Buffer}} StreamEvent
 */

/**
 * One stream socket of a forward tunnel. The first socket (video) opens with a
 * dummy byte and 64 bytes of device name; every stream then sends its codec id
 * and 12-byte headers that are either a session packet (MSB set: a new video
 * size, e.g. after rotation) or a media packet (config/key flags, PTS, size)
 * followed by its payload.
 */
export class ScrcpyStream {
  /** @param {{first?: boolean}} [options] `first` false: a later socket (audio), no dummy byte or name */
  constructor({ first = true } = {}) {
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
    this.stage = first ? "dummy" : "codec";
  }

  /** @param {Buffer} chunk @returns {StreamEvent[]} */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    /** @type {StreamEvent[]} */
    const events = [];
    for (;;) {
      if (this.stage === "dummy") {
        if (!this.take(1)) break;
        this.stage = "device";
      } else if (this.stage === "device") {
        const name = this.take(64);
        if (!name) break;
        events.push({ type: "device", name: name.toString("utf8").replace(/\0.*$/s, "") });
        this.stage = "codec";
      } else if (this.stage === "codec") {
        const id = this.take(4);
        if (!id) break;
        events.push({ type: "codec", id: id.readUInt32BE(0) });
        this.stage = "packets";
      } else {
        if (this.buf.length < 12) break;
        if (this.buf[0] & 0x80) {
          const head = /** @type {Buffer} */ (this.take(12));
          events.push({ type: "session", width: head.readUInt32BE(4), height: head.readUInt32BE(8) });
          continue;
        }
        const size = this.buf.readUInt32BE(8);
        if (this.buf.length < 12 + size) break;
        const flags = this.buf[0];
        this.take(12);
        const data = /** @type {Buffer} */ (this.take(size));
        events.push({ type: "packet", config: Boolean(flags & 0x40), key: Boolean(flags & 0x20), data });
      }
    }
    return events;
  }

  /** @param {number} n */
  take(n) {
    if (this.buf.length < n) return null;
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
}

// ---------------------------------------------------------------------------
// WebSocket, server side only
// ---------------------------------------------------------------------------

/** @param {string} key the client's Sec-WebSocket-Key */
export function acceptKey(key) {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

/** An unmasked server frame. @param {number} opcode 1 text, 2 binary, 8 close, 10 pong @param {Buffer} payload */
export function wsFrame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Decodes the masked frames a browser sends. Fragmented messages are not used by the viewer. */
export class WsReader {
  constructor(maxPayload = 1 << 20) {
    this.buf = Buffer.alloc(0);
    this.maxPayload = maxPayload;
  }

  /** @param {Buffer} chunk @returns {{opcode: number, payload: Buffer}[]} */
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const opcode = this.buf[0] & 0x0f;
      const masked = Boolean(this.buf[1] & 0x80);
      let len = this.buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (this.buf.length < 4) break;
        len = this.buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) break;
        len = Number(this.buf.readBigUInt64BE(2));
        at = 10;
      }
      if (len > this.maxPayload) throw new Error("WebSocket frame too large");
      const maskAt = at;
      if (masked) at += 4;
      if (this.buf.length < at + len) break;
      const payload = Buffer.from(this.buf.subarray(at, at + len));
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= this.buf[maskAt + (i % 4)];
      frames.push({ opcode, payload });
      this.buf = this.buf.subarray(at + len);
    }
    return frames;
  }
}

/**
 * The relay listens on loopback only, but any web page the user visits can
 * still try `ws://127.0.0.1:port`. So a request must name this server as its
 * Host (defeats DNS rebinding), come from this server's own pages (Origin), and
 * carry the per-run token.
 * @param {{host?: string, origin?: string, token?: string | null}} req
 * @param {number} port @param {string} token
 */
export function isTrusted(req, port, token) {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!req.host || !hosts.includes(req.host)) return false;
  if (req.origin && !hosts.map((h) => `http://${h}`).includes(req.origin)) return false;
  return req.token === token;
}
