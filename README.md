# TEDI Android Mirror

A TEDI extension that detects one or many Android devices over USB or Wi-Fi debugging, then runs multiple `scrcpy` instances from a TEDI panel.

## Install

1. Open **Settings -> Extensions** in TEDI.
2. Switch to the **From GitHub** tab.
3. Paste `IlhamriSKY/TEDI.android-mirroring` then click **Review -> Install**.

Requires TEDI `>=0.4.7`. The **Android Mirror** and **Android Play** panels
appear as tabs once installed.

To install a local build: `npm install && npm run build`, then zip
`manifest.json`, `extension.js` and the `play/` folder at the root of the
archive, and pick it from the **From .zip** tab. `play/` must be included,
because the Play panel runs `play/relay.mjs` and sends `play/scrcpy-server`
to the device.

## Supported platforms

- Windows
- macOS
- Linux

The extension picks how it runs the probe based on the operating system: PowerShell on Windows and a POSIX shell on macOS/Linux. Each device has its own mirror button, so multiple Android devices can be mirrored at the same time.

## Requirements

- **USB debugging** enabled on the Android device if using USB. On Linux, the user needs USB permission (a udev rule), otherwise the status is `No USB permission`.
- `scrcpy` and `adb`. Official scrcpy releases already bundle their own `adb`, and the `adb` next to `scrcpy` is always picked first so the versions match (two different adb versions restart each other's server and drop the mirror session that is running). If not found there, it is searched for in PATH, `ANDROID_HOME` / `ANDROID_SDK_ROOT`, and the default SDK locations.
- scrcpy locations recognized besides PATH:
  - Windows: `%LOCALAPPDATA%\Programs\scrcpy`, scoop, chocolatey, winget (symlinks are followed)
  - macOS: Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`)
  - Linux: `/usr/bin`, `~/.local/bin`, snap
- For Wi-Fi, the phone and the PC must be on the same network, and the network must let devices reach each other (guest and school networks often do not). Two ways in:
  - **From USB (any Android version):** plug the phone in once and press **Wi-Fi** on its row. No pairing code and no network discovery needed, and the cable can come off afterwards. It lasts until the phone restarts.
  - **Wireless debugging (Android 11+, no cable):** turn it on under Developer options. Pair once: on the phone tap **Pair device with pairing code** (not QR) and keep that window open, then type its IP:Port and 6-digit code in the panel's **Wi-Fi Debugging** strip and press **Pair**. Then type the **IP address & Port** from the main Wireless debugging screen (a different port, it changes each time Wireless debugging is turned on) and press **Connect**. Where the network allows mDNS the phone also shows up by itself with its own **Connect** button.

On a USB connection, Android shows an RSA dialog. Choose **Allow**. If the status is `unauthorized`, unlock the phone and allow this computer.

## Usage

1. Open TEDI's command palette and choose **Open Android Mirror**, or press `Ctrl+Alt+R` (`Cmd+Option+R` on macOS), or click the phone icon in the status bar.
2. The device list updates automatically. **Refresh** re-searches for `adb`/`scrcpy` (for example, after they were just installed) and for Wi-Fi services.
3. For Wi-Fi, press **Wi-Fi** on a USB phone's row, use **Pair** and **Connect** in the **Wi-Fi Debugging** strip at the bottom, or **Connect** on a phone that showed up by itself.
4. Press **Mirror** on the device's row. Multiple devices can be mirrored at the same time, each in its own scrcpy window.
5. Press **Stop** to stop a mirror session that was started from this panel.

### Play: phone screen + drag-and-drop keymap (like an emulator)

The **Play** button on a phone's row opens the **Android Play** pane (one pane for all phones) and makes that phone the active one: the phone's screen appears directly in TEDI, with a button editor over it.

- **Play mode:** the mouse becomes a finger (right-click = Back, middle-click = Home); mapped keyboard keys become touches. Multiple keys can be held at once (multi-touch). Every pressed key is visible: its circle shrinks while held and a white ring pulses outward, showing at full opacity briefly even if **Keys** is set to thin (except Hidden).
- **Shortcut Mode / Typing Mode:** click the phone screen first so the keyboard goes to the phone (not to TEDI), then press **~** to switch. Shortcut Mode runs the keymap; Typing Mode types into the phone (chat, search fields): letters are sent as text, Enter/Backspace/arrows/Tab/Esc as keys, and Ctrl+A/C/V/X/Z/Y are also forwarded. A marker shows above the screen while in Typing Mode.
- **Edit mode:** **+ Tap** (a single point, can be held), **+ Joystick** (WASD, the ring can be dragged and resized), **+ Swipe** (drag from a start point to an end point, duration is adjustable). A newly added control pulses (a white ring radiates outward) until it is dragged for the first time, so it is immediately obvious which one needs to be moved. Drag a control into place, click the control then click the key button in the right panel and press a letter to bind it. Delete removes the selected control.
- **Profiles:** one button set per game (New, Rename, Delete). Stored in `~/.tedi/android-keymaps.json`, reused for the same phone. If that file is corrupted (for example, from a bad manual edit), a copy is saved as `android-keymaps.json.unreadable-<time>.json` before it is overwritten.
- **Without TEDI:** `node play/relay.mjs --open` opens the same page in a browser.
- **Multiple phones:** the **Android Play** pane shows all phones in a grid. Click a phone to make it active; **Sync** (the chain icon) makes that phone follow the active phone's input; the camera icon turns off its screen (it can still be controlled); Grid/Focus controls the layout.
- **Sound:** the phone's audio plays on the PC, not on the phone (Android 11 and up), while Play is open. The speaker icon on each phone's header mutes it **on the PC only**; in the detach window the button appears in the top-right corner when the mouse is over the screen (and stays visible while muted). A muted or not-visible phone is sent no audio at all. Below Android 11 the icon is disabled and audio stays on the phone. Audio is sent raw (48 kHz stereo, about 190 KB/s per phone) so there is no encode delay.
- **Volume and brightness:** the slider icon on each phone's header (in the detach window: top-right corner) opens a small popover. The **Volume** slider sets the phone's own media volume (the one its volume keys change), read from the phone when the popover opens; captured sound comes after that volume, so it is also how loud the phone plays on the PC. The step range is read from the phone (0 to 15 on stock Android, 0 to 150 on MIUI). **Brightness** sets the phone's own screen brightness, read from the phone when the panel opens; dragging it turns off auto-brightness just like on the phone, and **Auto** turns it back on. Brightness is set through the Android display service (the same scale on every phone, including MIUI, which keeps its own version number), with a fallback of the 0 to 255 setting on older Android.
- **Zoom:** the magnifying-glass button in the bar, `Ctrl` + scroll, or `Ctrl+=` / `Ctrl+-` zoom the phone's screen in and out within the pane (50% to 300% of the fit size). When larger than the pane, scroll to pan. The label in the middle (or `Ctrl+0`) returns to **Fit**. Zoom is remembered.
- **Detach:** the panel icon on each phone's header opens that phone directly in a **TEDI float window** (always on top, can be moved anywhere), just the screen with no bar and no buttons; the keymap, mouse and ~ still work. The window **follows the phone's rotation**: when the phone is rotated to landscape or portrait, the window rotates in place (its center stays put, its long side stays the same) and stays within the monitor. Detaching the same phone again brings its window back up. In the grid, that phone is hidden while its window is open; close the window to bring it back. The keymap is set from the grid and applies immediately. The float window uses the main window's relay (it does not create a second session) and does not run any process of its own.
- **Detach All** (in TEDI): the button in the bar opens every phone in its own window and arranges them **side by side** on TEDI's monitor, in one row or more (whichever makes the screens largest), all scaled down evenly if they do not fit. Phones that are already detached are rearranged too. Each window then follows its own phone's rotation.
- **Older TEDI:** following rotation and side-by-side arrangement needs the `set_float_window_bounds` command from a later TEDI version. On a TEDI without it, the float window still opens (centered on the TEDI window, without following rotation). If the float window cannot be opened at all, that phone opens in a regular pane instead.
- **Requirements:** Node.js (for the relay) and adb. The screen is streamed by `play/scrcpy-server` (scrcpy 4.1, Apache-2.0, see `play/NOTICE`), so scrcpy does not need to be installed.

How it works: `play/relay.mjs` (no dependencies) runs scrcpy-server on the phone via `adb forward`, forwards H.264 video to the page over WebSocket, and turns touches on the page into scrcpy control messages. The page decodes video with WebCodecs. The relay only listens on `127.0.0.1` and every request must carry a per-session random token, its own Host and Origin, so no other website can control the phone. One scrcpy session per phone is shared across every page displaying it, and stops a few seconds after the last page closes it.

The status bar icon is icon-only. The device count is on the icon's hover and in the panel.

How it works: one `adb track-devices` process runs for as long as the extension is active and reports device-list changes, so no shell is run every few seconds. That process is also what keeps the adb server alive; on Windows, TEDI puts every child process into a Job Object, and a server started by a short-lived adb dies together with it. Wi-Fi services (`adb mdns services`) are only scanned while the panel is open.

## Limitations

The **Mirror** button opens scrcpy as a **separate native window** (its audio also plays on the PC, a built-in scrcpy behavior, with no mute button; mute it through the Windows Volume Mixer); for the screen inside a TEDI tab, use **Play**. This extension manages scrcpy processes from TEDI, but does not try to take over or kill a scrcpy process that this extension did not create.

The extension only uses fixed commands to look for `adb`/`scrcpy`, then runs `adb` directly without a shell to read the device list, read ADB mDNS, and `adb connect` to a validated mDNS endpoint. The extension does not perform arbitrary IP scanning.

## Build and validate

```powershell
npm install
npm run build
npm test
npm run check
npm run typecheck
```

Package validation from the TEDI root can be done with `tedi ext validate` if that subcommand is available in the CLI build you are using.
