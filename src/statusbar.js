import { ctx, state } from "./runtime.js";

const ITEM_ID = "android-mirroring";

// Icon only. The counts live in the hover and in the pane, not beside the icon.
export function render() {
  if (!ctx?.statusBar?.setItem) return;
  const ready = state.devices.filter((device) => device.state === "device").length;
  const detected = state.devices.length;
  const mirroring = state.mirrors.size;
  const tone = state.error ? "error" : mirroring > 0 || ready > 0 ? "success" : detected > 0 ? "warning" : "default";

  /** @type {import("../tedi").StatusItemDetailRow[]} */
  const rows = [
    { label: "Ready", value: String(ready) },
    { label: "Detected", value: String(detected) },
    { label: "Mirroring", value: String(mirroring) },
  ];
  const notes = [];
  if (state.error) notes.push(state.error);
  if (state.probed && !state.adbPath) notes.push("adb Not Found");
  if (state.probed && !state.scrcpyPath) notes.push("scrcpy Not Found");
  for (const note of notes) rows.push({ label: "", note });

  ctx.statusBar.setItem({
    id: ITEM_ID,
    icon: "lucide:Smartphone",
    kind: "status",
    tone,
    tooltip: ["Android Mirror", `${ready} Ready, ${detected} Detected, ${mirroring} Mirroring`, ...notes].join("\n"),
    detail: { title: "Android Mirror", rows },
    onClick: state.onOpen ?? undefined,
  });
}

export function removeItem() {
  ctx?.statusBar?.removeItem(ITEM_ID);
}
