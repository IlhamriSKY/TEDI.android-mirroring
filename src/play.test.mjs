import assert from "node:assert/strict";
import test from "node:test";
import { tileWindows } from "./play.js";

const AREA = { x: 0, y: 0, width: 1920, height: 1040 };
const BAR = 33;
const portrait = { width: 1080, height: 2400 };
const landscape = { width: 2400, height: 1080 };

/** @param {{x: number, y: number, width: number, height: number}[]} wins */
function assertTidy(wins, area = AREA) {
  for (const w of wins) {
    assert.ok(w.x >= area.x && w.y >= area.y, `inside: ${JSON.stringify(w)}`);
    assert.ok(w.x + w.width <= area.x + area.width && w.y + w.height <= area.y + area.height, `inside: ${JSON.stringify(w)}`);
  }
  for (const a of wins) {
    for (const b of wins) {
      if (a === b) continue;
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, `overlap: ${JSON.stringify(a)} ${JSON.stringify(b)}`);
    }
  }
}

test("one phone keeps its shape at full size, centered", () => {
  const [w] = tileWindows([portrait], AREA);
  assert.equal(w.height - BAR, 780);
  assert.equal(w.width, Math.round((780 * 1080) / 2400));
  assert.ok(Math.abs(w.x + w.width / 2 - 960) <= 1);
  const [l] = tileWindows([landscape], AREA);
  assert.equal(l.width, 780);
  assert.equal(l.height - BAR, Math.round((780 * 1080) / 2400));
});

test("a phone whose size is not known yet opens portrait", () => {
  const [w] = tileWindows([{ width: 0, height: 0 }], AREA);
  assert.ok(w.height > w.width);
});

test("many phones sit side by side on the monitor, never on top of each other", () => {
  for (let n = 2; n <= 10; n++) {
    const wins = tileWindows(Array.from({ length: n }, (_, i) => (i % 3 === 2 ? landscape : portrait)), AREA);
    assert.equal(wins.length, n);
    assertTidy(wins);
  }
});

test("four landscape phones go two by two rather than one thin row", () => {
  const wins = tileWindows(Array(4).fill(landscape), AREA);
  assertTidy(wins);
  assert.equal(new Set(wins.map((w) => w.y)).size, 2);
});

test("a monitor to the left of the primary one (negative origin) is honored", () => {
  const area = { x: -1366, y: 0, width: 1366, height: 728 };
  assertTidy(tileWindows([portrait, portrait, landscape], area), area);
});
