import assert from "node:assert/strict";
import test from "node:test";
import { ACTION, CODEC_RAW, ScrcpyStream, WsReader, acceptKey, backMessage, isTrusted, keycodeMessage, resetVideoMessage, textMessage, touchMessage, wsFrame } from "./protocol.mjs";

test("text message matches scrcpy's own serialization test", () => {
  assert.deepEqual([...textMessage("hello, world!")], [1, 0, 0, 0, 0x0d, ...Buffer.from("hello, world!")]);
});

test("long text is cut at 300 bytes without splitting a character", () => {
  const msg = textMessage("é".repeat(200)); // 400 bytes of 2-byte characters
  assert.equal(msg.readUInt32BE(1), 300);
  assert.equal(Buffer.from(msg.subarray(5)).toString("utf8"), "é".repeat(150));
  const odd = textMessage(`a${"é".repeat(200)}`); // byte 300 falls inside a character
  assert.equal(odd.readUInt32BE(1), 299);
});

test("touch message matches scrcpy's own serialization test (first 24 bytes)", () => {
  const msg = touchMessage(ACTION.DOWN, 0x1234567887654321n, 100 / 1080, 200 / 1920, 1080, 1920);
  assert.equal(msg.length, 32);
  assert.deepEqual([...msg.subarray(0, 24)], [
    2, 0x00,
    0x12, 0x34, 0x56, 0x78, 0x87, 0x65, 0x43, 0x21,
    0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xc8,
    0x04, 0x38, 0x07, 0x80,
    0xff, 0xff,
  ]);
  assert.deepEqual([...msg.subarray(24)], [0, 0, 0, 0, 0, 0, 0, 0], "a finger carries no buttons");
});

test("touch up has zero pressure and coordinates stay inside the frame", () => {
  const msg = touchMessage(ACTION.UP, 3, 1.5, -0.2, 1080, 2400);
  assert.equal(msg.readUInt16BE(22), 0);
  assert.equal(msg.readInt32BE(10), 1079);
  assert.equal(msg.readInt32BE(14), 0);
});

test("keycode, back and reset messages match scrcpy's layout", () => {
  assert.deepEqual([...keycodeMessage(ACTION.UP, 66, 5, 0x41)], [0, 1, 0, 0, 0, 66, 0, 0, 0, 5, 0, 0, 0, 0x41]);
  assert.deepEqual([...backMessage(ACTION.UP)], [4, 1]);
  assert.deepEqual([...resetVideoMessage()], [17]);
});

test("video stream: dummy byte, device name, codec, session, packets, split anywhere", () => {
  const name = Buffer.alloc(64);
  name.write("POCO X3 Pro");
  const codec = Buffer.from([0x68, 0x32, 0x36, 0x34]);
  const session = Buffer.alloc(12);
  session[0] = 0x80;
  session.writeUInt32BE(2400, 4);
  session.writeUInt32BE(1080, 8);
  const packet = (flags, bytes) => {
    const head = Buffer.alloc(12);
    head[0] = flags;
    head.writeUInt32BE(bytes.length, 8);
    return Buffer.concat([head, Buffer.from(bytes)]);
  };
  const wire = Buffer.concat([Buffer.from([0]), name, codec, session, packet(0x40, [0, 0, 0, 1, 0x67]), packet(0x20, [1, 2, 3]), packet(0, [9])]);
  const stream = new ScrcpyStream();
  const events = [];
  for (let i = 0; i < wire.length; i += 7) events.push(...stream.push(wire.subarray(i, i + 7)));
  assert.deepEqual(events.map((e) => e.type), ["device", "codec", "session", "packet", "packet", "packet"]);
  assert.equal(events[0].name, "POCO X3 Pro");
  assert.equal(events[1].id, 0x68323634);
  assert.deepEqual([events[2].width, events[2].height], [2400, 1080]);
  assert.deepEqual([events[3].config, events[3].key], [true, false]);
  assert.deepEqual([events[4].config, events[4].key, [...events[4].data]], [false, true, [1, 2, 3]]);
});

test("audio stream: no dummy byte or name, the codec, then raw PCM packets", () => {
  const packet = (bytes) => {
    const head = Buffer.alloc(12);
    head.writeUInt32BE(bytes.length, 8);
    return Buffer.concat([head, Buffer.from(bytes)]);
  };
  const codec = Buffer.alloc(4);
  codec.writeUInt32BE(CODEC_RAW);
  const stream = new ScrcpyStream({ first: false });
  const events = stream.push(Buffer.concat([codec, packet([1, 0, 2, 0]), packet([3, 0, 4, 0])]));
  assert.deepEqual(events.map((e) => e.type), ["codec", "packet", "packet"]);
  assert.equal(events[0].id, CODEC_RAW);
  assert.deepEqual([...events[2].data], [3, 0, 4, 0]);
  const off = new ScrcpyStream({ first: false }).push(Buffer.alloc(4));
  assert.deepEqual(off, [{ type: "codec", id: 0 }], "a phone before Android 11 sends codec 0");
});

test("websocket: accept key from RFC 6455, server frames, masked client frames", () => {
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  assert.deepEqual([...wsFrame(1, Buffer.from("hi"))], [0x81, 2, 0x68, 0x69]);
  assert.equal(wsFrame(2, Buffer.alloc(300)).readUInt16BE(2), 300);
  const mask = [1, 2, 3, 4];
  const text = Buffer.from('{"t":"back"}');
  const masked = Buffer.from(text.map((b, i) => b ^ mask[i % 4]));
  const frame = Buffer.concat([Buffer.from([0x81, 0x80 | text.length, ...mask]), masked]);
  const reader = new WsReader();
  assert.deepEqual(reader.push(frame.subarray(0, 5)), []);
  const [out] = reader.push(frame.subarray(5));
  assert.equal(out.opcode, 1);
  assert.equal(out.payload.toString(), '{"t":"back"}');
});

test("only this server's own pages with the token are trusted", () => {
  const ok = { host: "127.0.0.1:27700", origin: "http://127.0.0.1:27700", token: "t0k" };
  assert.equal(isTrusted(ok, 27700, "t0k"), true);
  assert.equal(isTrusted({ ...ok, origin: undefined }, 27700, "t0k"), true, "non-browser clients send no Origin");
  assert.equal(isTrusted({ ...ok, origin: "https://evil.example" }, 27700, "t0k"), false);
  assert.equal(isTrusted({ ...ok, host: "evil.example:27700" }, 27700, "t0k"), false, "DNS rebinding");
  assert.equal(isTrusted({ ...ok, token: "nope" }, 27700, "t0k"), false);
});
