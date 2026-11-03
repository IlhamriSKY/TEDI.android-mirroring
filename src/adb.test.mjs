import assert from "node:assert/strict";
import test from "node:test";
import { isSafeEndpoint, isSafeSerial, parseDevices, parseMdns, parseProbeOutput, probeCommand, takeFrames, unconnected, wifiAddress } from "./adb.js";

test("parses Linux/macOS USB device details", () => {
  const [device] = parseDevices("R58M123456A device usb:1-2 product:panther model:Pixel_7 device:panther");
  assert.deepEqual(device, { serial: "R58M123456A", state: "device", model: "Pixel 7", product: "panther", transport: "usb" });
});

test("Windows prints no usb: field, transport_id still means USB", () => {
  const [device] = parseDevices("8826d625               device product:vayu_id model:M2102J20SG device:vayu transport_id:1");
  assert.equal(device.transport, "usb");
  assert.equal(device.model, "M2102J20SG");
});

test("several devices at once, each transport recognised", () => {
  const devices = parseDevices([
    "List of devices attached",
    "* daemon not running; starting now at tcp:5037",
    "adb server version (41) doesn't match this client (39); killing...",
    "8826d625 device product:vayu_id model:M2102J20SG device:vayu transport_id:1",
    "adb-R58M123-AbCdEf._adb-tls-connect._tcp device product:oriole model:Pixel_6 device:oriole transport_id:3",
    "192.168.1.42:5555 device product:x model:Tab transport_id:4",
    "emulator-5554 offline transport_id:2",
    "ABC123 unauthorized usb:1-1 transport_id:5",
    "XYZ no permissions (user in plugdev group; are your udev rules wrong?); see [http://developer.android.com/tools/device.html] usb:1-3",
    "bad/serial device",
  ].join("\n"));
  assert.deepEqual(
    devices.map((d) => [d.serial, d.state, d.transport]),
    [
      ["8826d625", "device", "usb"],
      ["adb-R58M123-AbCdEf._adb-tls-connect._tcp", "device", "wifi"],
      ["192.168.1.42:5555", "device", "wifi"],
      ["emulator-5554", "offline", "emulator"],
      ["ABC123", "unauthorized", "usb"],
      ["XYZ", "no permissions", "usb"],
    ],
  );
});

test("track-devices frames: real Windows output with an uncounted \\r", () => {
  const { frames, rest } = takeFrames("005a8826d625               device product:vayu_id model:M2102J20SG device:vayu transport_id:1\r\n");
  assert.equal(frames.length, 1);
  assert.equal(parseDevices(frames[0])[0].serial, "8826d625");
  assert.equal(rest, "");
});

test("track-devices frames: daemon chatter, split chunks, empty list", () => {
  const payload = "AAA device usb:1 transport_id:1\nBBB device usb:2 transport_id:2\n";
  const whole = `* daemon not running; starting now at tcp:5037\n* daemon started successfully\n${payload.length.toString(16).padStart(4, "0")}${payload}0000`;
  const first = takeFrames(whole.slice(0, 70));
  assert.equal(first.frames.length, 0);
  const second = takeFrames(first.rest + whole.slice(70));
  assert.deepEqual(second.frames, [payload, ""]);
  assert.equal(parseDevices(second.frames[0]).length, 2);
  assert.equal(parseDevices(second.frames[1]).length, 0);
});

test("mDNS: tab-separated services, pairing ports dropped", () => {
  const services = parseMdns([
    "List of discovered mdns services",
    "adb-R58M123-AbCdEf\t_adb-tls-connect._tcp\t192.168.1.42:37145",
    "adb-R58M123-AbCdEf\t_adb-tls-pairing._tcp\t192.168.1.42:41235",
    "adb-R58M123-AbCdEf\t_adb-tls-connect._tcp\t192.168.1.42:37145",
    "adb-other\t_adb._tcp.\t192.168.1.50:5555",
  ].join("\n"));
  assert.deepEqual(services, [
    { endpoint: "192.168.1.42:37145", name: "adb-R58M123-AbCdEf" },
    { endpoint: "192.168.1.50:5555", name: "adb-other" },
  ]);
});

test("a service already attached, by mDNS name or by address, is not offered again", () => {
  const services = [
    { endpoint: "192.168.1.42:37145", name: "adb-R58M123-AbCdEf" },
    { endpoint: "192.168.1.50:5555", name: "adb-other" },
    { endpoint: "192.168.1.60:40000", name: "adb-new" },
  ];
  const devices = parseDevices([
    "adb-R58M123-AbCdEf._adb-tls-connect._tcp device transport_id:3",
    "192.168.1.50:5555 device transport_id:4",
  ].join("\n"));
  assert.deepEqual(unconnected(services, devices).map((s) => s.name), ["adb-new"]);
});

test("rejects unsafe serials and endpoints", () => {
  assert.equal(isSafeSerial("192.168.1.42:5555"), true);
  assert.equal(isSafeSerial("C:\\bad path"), false);
  assert.equal(isSafeEndpoint("phone.local:5555"), true);
  assert.equal(isSafeEndpoint("192.168.1.42:99999"), false);
  assert.equal(isSafeEndpoint("192.168.1.42; Remove-Item *"), false);
});

test("parses marker-framed probe output after profile noise", () => {
  const result = parseProbeOutput("motd\r\n__TAM_ADB_PATH__\r\n/opt/sdk/adb\r\n__TAM_SCRCPY_PATH__\r\n\r\n__TAM_END__\r\n");
  assert.deepEqual(result, { adbPath: "/opt/sdk/adb", scrcpyPath: "", nodePath: "" });
  assert.equal(parseProbeOutput("__TAM_ADB_PATH__\nA\n__TAM_SCRCPY_PATH__\nS\n__TAM_NODE_PATH__\n/usr/bin/node\n__TAM_END__\n").nodePath, "/usr/bin/node");
  assert.throws(() => parseProbeOutput("nothing"), /Could Not Read/);
});

test("probe per OS: PowerShell on Windows, sh -c elsewhere", () => {
  assert.match(probeCommand("windows"), /Get-Command adb/);
  for (const os of ["macos", "linux"]) assert.match(probeCommand(os), /^sh -c '/);
  assert.throws(() => probeCommand("android"), /Windows, macOS, and Linux/);
});

test("the Wi-Fi address is wlan's, not mobile data's or loopback's", () => {
  const out = [
    "1: lo    inet 127.0.0.1/8 scope host lo\       valid_lft forever preferred_lft forever",
    "12: rmnet_data0    inet 10.64.12.9/30 scope global rmnet_data0\       valid_lft forever preferred_lft forever",
    "30: wlan0    inet 192.168.1.23/24 brd 192.168.1.255 scope global wlan0\       valid_lft forever preferred_lft forever",
  ].join("\r\n");
  assert.equal(wifiAddress(out), "192.168.1.23");
  assert.equal(wifiAddress(out.split("\r\n").slice(0, 2).join("\n")), "");
});
