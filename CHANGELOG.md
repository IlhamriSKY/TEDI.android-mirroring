# Changelog

All notable changes to **TEDI Android Mirror**. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[SemVer](https://semver.org/).

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
