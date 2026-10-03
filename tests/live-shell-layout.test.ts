import { describe, expect, it } from "vitest";
import { computeLiveLayout } from "../src/liveGame/shell/layout";

/**
 * Viewport classes the shell must serve (CSS px after browser chrome). The
 * board is square, so each case checks the board is the largest square the
 * arrangement allows and that nothing the layout reserves exceeds the viewport.
 */
const MATRIX = [
  { name: "320px phone", width: 320, height: 460, mode: "stack" },
  { name: "375px phone", width: 375, height: 548, mode: "stack" },
  { name: "390px phone", width: 390, height: 664, mode: "stack" },
  { name: "tablet portrait", width: 768, height: 950, mode: "stack" },
  { name: "tablet portrait (large)", width: 820, height: 1100, mode: "stack" },
  { name: "tablet landscape", width: 1024, height: 700, mode: "column" },
  { name: "13-inch laptop", width: 1280, height: 690, mode: "duo" },
  { name: "13-inch laptop (1440)", width: 1440, height: 790, mode: "duo" },
  { name: "1080p desktop", width: 1920, height: 960, mode: "duo" },
  { name: "wide desktop", width: 2560, height: 1310, mode: "duo" },
  { name: "1280x560 short window", width: 1280, height: 560, mode: "duo" },
  { name: "phone landscape", width: 750, height: 340, mode: "stack-landscape" },
] as const;

describe("computeLiveLayout", () => {
  for (const view of MATRIX) {
    it(`${view.name}: ${view.mode}, square board within the viewport`, () => {
      const layout = computeLiveLayout(view);
      expect(layout.mode).toBe(view.mode);
      expect(layout.board).toBeLessThanOrEqual(Math.min(view.width, view.height));
      expect(layout.board).toBe(layout.cell * 15 + layout.label + 2);
      if (layout.mode === "duo") {
        // Two gutters plus the board fit the width.
        expect(layout.board + 2 * layout.gutter + 24).toBeLessThanOrEqual(view.width);
        expect(layout.gutter).toBeGreaterThanOrEqual(264);
      }
      if (layout.mode === "stack") {
        // Eight rack tiles with gaps and tray chrome fit the width.
        const gap = view.width < 600 ? 4 : 6;
        expect(8 * layout.rackTile + 7 * gap + 12).toBeLessThanOrEqual(view.width - 8);
      }
    });
  }

  it("maximizes the board from both dimensions (height-bound on landscape, width-bound on portrait)", () => {
    expect(computeLiveLayout({ width: 1920, height: 960 }).board).toBeGreaterThan(820);
    // Edge-to-edge minus intentional margins: within ~8px of the 390px width.
    expect(computeLiveLayout({ width: 390, height: 664 }).board).toBeGreaterThanOrEqual(366);
    expect(computeLiveLayout({ width: 768, height: 950 }).board).toBeGreaterThan(640);
  });

  it("moves the rack into the gutter only for a genuinely short window", () => {
    const short = computeLiveLayout({ width: 1280, height: 560 });
    expect(short.rack).toBe("gutter");
    const below = computeLiveLayout({ width: 1280, height: 560 - 0 });
    expect(below.board).toBeGreaterThanOrEqual(500);
    expect(computeLiveLayout({ width: 1440, height: 860 }).rack).toBe("below");
    expect(computeLiveLayout({ width: 1920, height: 960 }).rack).toBe("below");
  });

  it("uses available height on large screens and keeps cells integer", () => {
    const wide = computeLiveLayout({ width: 3840, height: 2000 });
    expect(wide.board).toBeGreaterThan(1750);
    expect(computeLiveLayout({ width: 2560, height: 1310 }).board).toBeGreaterThan(1150);
    for (const view of MATRIX) expect(Number.isInteger(computeLiveLayout(view).cell)).toBe(true);
  });

  it("folds the self strip into the action row when a phone is height-bound", () => {
    expect(computeLiveLayout({ width: 320, height: 460 }).compact).toBe(true);
    expect(computeLiveLayout({ width: 390, height: 664 }).compact).toBe(false);
  });

  it("prints the matrix", () => {
    const rows = MATRIX.map((view) => {
      const l = computeLiveLayout(view);
      return `${view.name.padEnd(26)} ${`${view.width}x${view.height}`.padEnd(10)} ${l.mode.padEnd(16)} rack=${l.rack.padEnd(6)} board=${l.board} cell=${l.cell} tile=${l.rackTile} gutter=${l.gutter}${l.compact ? " compact" : ""}`;
    });
    console.log(rows.join("\n"));
  });
});
