import { ctx } from "./runtime.js";

/** @typedef {"usb" | "wifi" | "emulator" | "unknown"} Transport */

/**
 * @typedef {Object} AndroidDevice
 * @property {string} serial
 * @property {string} state
 * @property {string} model
 * @property {string} product
 * @property {Transport} transport
 */

/**
 * @typedef {Object} WifiService
 * @property {string} endpoint
 * @property {string} name mDNS instance name, e.g. `adb-8826d625-AbCdEf`
 */

const MARKERS = {
  adbPath: "__TAM_ADB_PATH__",
  scrcpyPath: "__TAM_SCRCPY_PATH__",
  nodePath: "__TAM_NODE_PATH__",
  end: "__TAM_END__",
};

// Tool discovery only; adb itself is never run through a shell. The adb that
// sits next to scrcpy wins, because a scrcpy release uses exactly that one and
// two adb versions restart each other's server (killing every live mirror).
// Windows symlinks (winget "Links") are followed to find that sibling.
const WINDOWS_PROBE = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
function First($list) { $list | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1 }
$scrcpy = First @(
  (Get-Command scrcpy -CommandType Application | Select-Object -First 1).Source,
  "$env:LOCALAPPDATA\Programs\scrcpy\scrcpy.exe",
  "$env:USERPROFILE\scoop\apps\scrcpy\current\scrcpy.exe",
  "$env:USERPROFILE\scoop\shims\scrcpy.exe",
  "$env:ProgramData\chocolatey\bin\scrcpy.exe"
)
$near = @()
if ($scrcpy) {
  $near += Join-Path (Split-Path -LiteralPath $scrcpy) 'adb.exe'
  $target = (Get-Item -LiteralPath $scrcpy).Target | Select-Object -First 1
  if ($target) { $near += Join-Path (Split-Path -LiteralPath $target) 'adb.exe' }
}
$adb = First ($near + @(
  (Get-Command adb -CommandType Application | Select-Object -First 1).Source,
  "$env:ANDROID_HOME\platform-tools\adb.exe",
  "$env:ANDROID_SDK_ROOT\platform-tools\adb.exe",
  "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
))
Write-Output '__TAM_ADB_PATH__'
Write-Output ([string]$adb)
Write-Output '__TAM_SCRCPY_PATH__'
Write-Output ([string]$scrcpy)
$node = First @((Get-Command node -CommandType Application | Select-Object -First 1).Source, "$env:ProgramFiles\nodejs\node.exe")
Write-Output '__TAM_NODE_PATH__'
Write-Output ([string]$node)
Write-Output '__TAM_END__'
`;

// Runs under "sh -c" because the host starts $SHELL -lc, and a fish or nu
// login shell cannot parse POSIX functions. No single quotes in here: the
// whole script travels inside one.
const POSIX_PROBE = `
first() { for c in "$@"; do if [ -n "$c" ] && [ -f "$c" ] && [ -x "$c" ]; then printf "%s" "$c"; return 0; fi; done; return 1; }
scrcpy="$(first "$(command -v scrcpy 2>/dev/null)" "$HOME/.local/bin/scrcpy" /opt/homebrew/bin/scrcpy /usr/local/bin/scrcpy /usr/bin/scrcpy /snap/bin/scrcpy)"
near=""
if [ -n "$scrcpy" ]; then near="$(dirname "$scrcpy")/adb"; fi
adb="$(first "$near" "$(command -v adb 2>/dev/null)" "\${ANDROID_HOME:+$ANDROID_HOME/platform-tools/adb}" "\${ANDROID_SDK_ROOT:+$ANDROID_SDK_ROOT/platform-tools/adb}" "$HOME/Library/Android/sdk/platform-tools/adb" "$HOME/Android/Sdk/platform-tools/adb" /opt/homebrew/bin/adb /usr/local/bin/adb /usr/bin/adb)"
node="$(first "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.volta/bin/node")"
printf "%s\\n" __TAM_ADB_PATH__ "$adb" __TAM_SCRCPY_PATH__ "$scrcpy" __TAM_NODE_PATH__ "$node" __TAM_END__
`;

/** @param {string} value */
export function isSafeSerial(value) {
  return /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

/** @param {string} value */
export function isSafeEndpoint(value) {
  if (value.length < 3 || value.length > 255) return false;
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(value);
  const host = /^[A-Za-z0-9][A-Za-z0-9.-]*:\d{1,5}$/.test(value);
  const ipv6 = /^\[[0-9A-Fa-f:.]+\]:\d{1,5}$/.test(value);
  if (!ipv4 && !host && !ipv6) return false;
  const port = Number(value.slice(value.lastIndexOf(":") + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (ipv4) return value.split(":")[0].split(".").every((part) => Number(part) <= 255);
  return true;
}

/** @param {string} value */
function shQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** @param {string} platform */
export function probeCommand(platform) {
  if (platform === "windows") return WINDOWS_PROBE;
  if (platform === "macos" || platform === "linux") return `sh -c ${shQuote(POSIX_PROBE)}`;
  throw new Error("Android Mirror supports Windows, macOS, and Linux.");
}

/** Find adb, scrcpy and Node (runs Play). One shell, run on activation and on Refresh only.
 *  @returns {Promise<{adbPath: string, scrcpyPath: string, nodePath: string}>} */
export async function probeTools() {
  if (!ctx) throw new Error("Android Mirror is not active");
  const result = await ctx.invoke("shell_run_command", {
    command: probeCommand(ctx.os?.platform ?? "unknown"),
    cwd: null,
    timeoutSecs: 20,
  });
  if (result.timed_out) throw new Error("Looking for adb and scrcpy Timed Out");
  return parseProbeOutput(result.stdout);
}

/**
 * Parse the marker-framed probe output. Shell profile noise before the first
 * marker is ignored.
 * @param {string} text
 */
export function parseProbeOutput(text) {
  /** @type {Map<string, string[]>} */
  const sections = new Map();
  const names = new Map(Object.entries(MARKERS).map(([name, marker]) => [marker, name]));
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const name = names.get(line.trim());
    if (name) {
      current = name;
      sections.set(name, []);
    } else if (current) {
      sections.get(current)?.push(line);
    }
  }
  if (!sections.has("adbPath") || !sections.has("scrcpyPath")) {
    throw new Error("Could Not Read Where adb and scrcpy Are Installed");
  }
  return {
    adbPath: (sections.get("adbPath") ?? []).join("\n").trim(),
    scrcpyPath: (sections.get("scrcpyPath") ?? []).join("\n").trim(),
    nodePath: (sections.get("nodePath") ?? []).join("\n").trim(),
  };
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a program without a shell and return its combined output.
 * @param {string} program @param {string[]} args @param {number} timeoutMs
 */
export async function runDirect(program, args, timeoutMs = 20000) {
  if (!ctx) throw new Error("Android Mirror is not active");
  const host = ctx;
  const handle = await host.invoke("shell_bg_spawn_direct", { program, args, cwd: null });
  const deadline = Date.now() + timeoutMs;
  let out = "";
  let offset = 0;
  try {
    for (;;) {
      const logs = await host.invoke("shell_bg_logs", { handle, sinceOffset: offset });
      out += logs.bytes;
      offset = logs.next_offset;
      if (logs.exited) {
        // The exit is seen a beat before the pipe readers flush the tail.
        await sleep(60);
        return out + (await host.invoke("shell_bg_logs", { handle, sinceOffset: offset })).bytes;
      }
      if (Date.now() > deadline) throw new Error(`adb ${args[0]} timed out`);
      await sleep(80);
    }
  } finally {
    host.invoke("shell_bg_remove", { handle }).catch(() => {});
  }
}

/**
 * Split `adb track-devices` output into frames: four hex digits of byte length,
 * then that many bytes of `adb devices -l` lines. Windows adds a `\r` the
 * length does not count, and adb's own chatter ("* daemon started
 * successfully") shares the stream; both are dropped. ASCII is assumed, which
 * holds because adb sanitises model/product names.
 * @param {string} text
 * @returns {{frames: string[], rest: string}}
 */
export function takeFrames(text) {
  let rest = text.replace(/\r/g, "");
  /** @type {string[]} */
  const frames = [];
  while (rest.length >= 4) {
    if (!/^[0-9a-fA-F]{4}/.test(rest)) {
      const newline = rest.indexOf("\n");
      if (newline < 0) break;
      rest = rest.slice(newline + 1);
      continue;
    }
    const size = parseInt(rest.slice(0, 4), 16);
    if (rest.length < 4 + size) break;
    frames.push(rest.slice(4, 4 + size));
    rest = rest.slice(4 + size);
  }
  return { frames, rest };
}

const STATES = new Set(["device", "unauthorized", "offline", "authorizing", "connecting", "recovery", "rescue", "sideload", "bootloader", "host"]);

/** @param {string} text @returns {AndroidDevice[]} */
export function parseDevices(text) {
  /** @type {AndroidDevice[]} */
  const devices = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const fields = line.split(/\s+/);
    if (fields.length < 2 || !isSafeSerial(fields[0]) || seen.has(fields[0])) continue;
    const token = fields[1].toLowerCase();
    const state = STATES.has(token) ? token : /\bno permissions\b/i.test(line) ? "no permissions" : "";
    // Skips the header, adb's "* daemon" chatter and version-mismatch notices.
    if (!state) continue;
    seen.add(fields[0]);
    const attrs = new Map();
    for (const field of fields.slice(2)) {
      const colon = field.indexOf(":");
      if (colon > 0) attrs.set(field.slice(0, colon), field.slice(colon + 1));
    }
    devices.push({
      serial: fields[0],
      state,
      model: String(attrs.get("model") ?? "").replaceAll("_", " "),
      product: String(attrs.get("product") ?? ""),
      transport: transportFor(fields[0], line),
    });
  }
  return devices;
}

/** @param {string} serial @param {string} line @returns {Transport} */
function transportFor(serial, line) {
  if (/^emulator-\d+$/.test(serial)) return "emulator";
  if (/\busb:/.test(line)) return "usb";
  if (/\._adb-tls-connect\._tcp\.?$|\._adb\._tcp\.?$/.test(serial)) return "wifi";
  if (/^(?:\d{1,3}\.){3}\d{1,3}:\d+$/.test(serial) || /^\[[0-9a-f:.]+\]:\d+$/i.test(serial)) return "wifi";
  // Windows platform-tools print no usb: field at all.
  if (/\btransport_id:\d+/.test(line)) return "usb";
  return "unknown";
}

/**
 * `adb mdns services` lines are `name<TAB>type<TAB>host:port`. Only connect
 * services are kept: a `_adb-tls-pairing._tcp` port wants a pairing code and
 * `adb connect` to it always fails.
 * @param {string} text @returns {WifiService[]}
 */
export function parseMdns(text) {
  /** @type {WifiService[]} */
  const services = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const fields = raw.trim().split(/\s+/);
    if (fields.length < 3 || !/^_adb(?:-tls-connect)?\._tcp\.?$/.test(fields[1])) continue;
    const endpoint = fields[2];
    if (!isSafeEndpoint(endpoint) || seen.has(endpoint)) continue;
    seen.add(endpoint);
    services.push({ endpoint, name: fields[0] });
  }
  return services;
}

/**
 * Services not already attached, whether adb auto-connected them (serial
 * `name._adb-tls-connect._tcp`) or `adb connect` did (serial `host:port`).
 * @param {WifiService[]} services @param {AndroidDevice[]} devices
 */
export function unconnected(services, devices) {
  return services.filter(
    (service) => !devices.some((device) => device.serial === service.endpoint || device.serial.startsWith(`${service.name}.`)),
  );
}
