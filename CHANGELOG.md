# Changelog

All notable changes to **TEDI Android Mirror**. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

## [0.2.1] - 2026-11-04

### Changed

- **Loading indicators are one ring**, the same one the app draws.

## [0.2.0] - 03-11-2026

### Added

- **AI tool `android_mirror`.** `status` lists devices and whether each is
  mirroring, `open` shows the panel, `start` and `stop` run scrcpy for a serial.
  No shell, input, install or file access.
- **Wi-Fi button on a USB phone's row.** It runs `adb tcpip 5555`, reads the
  phone's Wi-Fi address and connects to it, so the cable can come off. Works on
  any Android version with no pairing code, and without mDNS, which many
  networks block (then Wireless debugging's Connect never appears). Lasts until
  the phone restarts.
- **Wi-Fi Debugging strip: Pair with a code, Connect by address.** For
  networks where the phone never shows up by itself (mDNS blocked), type the
  phone's pairing window IP:Port and 6-digit code, then the Wireless debugging
  IP address & Port. adb's own `protocol fault (couldn't read status message)`
  is replaced by what actually went wrong: a closed pairing window, a wrong
  code, or a phone this PC cannot reach. Connect refuses the pairing window's
  own address (that port closes once paired) and says which port to use.

### Removed

- The Play pane's "Open in a browser window" button, and with it the
  `plugin:opener|open_url` permission. `node play/relay.mjs --open` still
  serves the page to a browser without TEDI.

### Changed

- **Play's Volume slider sets the phone's own media volume** (the one its
  volume keys change) instead of a gain on this computer. Captured sound comes
  after that volume, so it is also how loud the phone plays here. The step range
  is read from the phone: 0..15 on AOSP, 0..150 on MIUI.

## [0.1.0] - 19-09-2026

First release.

### Added

- **Detects Android devices over USB or Wi-Fi debugging and mirrors them with
  `scrcpy`, one button per device**, so several phones can be mirrored at once
  from a TEDI panel. `adb` sitting beside `scrcpy` is preferred over the one on
  `PATH`, because two adb versions restart each other's server and drop a mirror
  that is already running. Windows uses a PowerShell probe, macOS and Linux a
  POSIX one.
- **Play: the phone screen inside TEDI, with a keymap editor for games.** A
  bundled relay (`play/relay.mjs`, node builtins only) pushes the scrcpy server
  to the device and streams H.264 to a WebCodecs page, so the picture renders in
  a TEDI pane or a browser tab with no extra install. The overlay editor maps
  taps, a WASD joystick and swipes onto touch events by drag and drop.
- **Detached windows follow the phone.** A mirror opened as a floating window is
  resized to the device's orientation and laid out beside its siblings, using
  the host's `set_float_window_bounds` command added in TEDI 0.4.62.

`play/scrcpy-server` is the unmodified server from scrcpy 4.1, Apache-2.0, see
[play/NOTICE](play/NOTICE). The relay speaks exactly that server's protocol and
the device refuses any other version, so the two are replaced together.
