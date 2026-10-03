import { expect, type Page } from "@playwright/test";

export const fixture = (state: string, viewer = "a") =>
  `/#/play/live-shell-fixture:${state}:${viewer}`;

export async function open(
  page: Page,
  state: string,
  viewport: { width: number; height: number },
  viewer = "a",
) {
  await page.setViewportSize(viewport);
  await page.goto(fixture(state, viewer));
  await expect(page.locator(".lg-shell")).toBeVisible({ timeout: 20_000 });
  // Let the turn-sweep and last-move emphasis settle before measuring.
  await page.waitForTimeout(1700);
}

/** Type tiles along the board cursor the way a player does (Space turns it down). */
export async function placeSevenEqualsFivePlusTwo(page: Page) {
  await page.getByRole("button", { name: /^G7,/ }).click();
  await page.keyboard.press("Space");
  for (const key of ["7", "5", "p", "2"]) await page.keyboard.press(key);
}

export type Geometry = {
  layout: string;
  rack: string;
  viewport: { width: number; height: number };
  board: { x: number; y: number; width: number; height: number };
  rackBox: { x: number; y: number; width: number; height: number } | null;
  scrollOverflow: number;
  boardCovered: string[];
};

/** Measures the live shell in the page: board square, rack placement, overflow, occlusion. */
export async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".lg-shell")!;
    const board = document.querySelector<HTMLElement>(".lg-board")!.getBoundingClientRect();
    const rack = document.querySelector<HTMLElement>(".lg-rack");
    const covered: string[] = [];
    // Sample 25 points over the board; each must hit the board itself.
    for (let i = 1; i <= 5; i += 1)
      for (let j = 1; j <= 5; j += 1) {
        const x = board.left + (board.width * i) / 6;
        const y = board.top + (board.height * j) / 6;
        const hit = document.elementFromPoint(x, y);
        if (hit && !hit.closest(".lg-board-wrap")) covered.push(hit.className || hit.tagName);
      }
    const box = (rect: DOMRect) => ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    });
    return {
      layout: shell.dataset.layout ?? "",
      rack: shell.dataset.rack ?? "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      board: box(board),
      rackBox: rack ? box(rack.getBoundingClientRect()) : null,
      scrollOverflow: Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
      ),
      boardCovered: covered,
    };
  });
}

export function expectSoundGeometry(geometry: Geometry) {
  const { board, rackBox, viewport } = geometry;
  expect(Math.abs(board.width - board.height)).toBeLessThanOrEqual(1);
  expect(board.x).toBeGreaterThanOrEqual(0);
  expect(board.y).toBeGreaterThanOrEqual(0);
  expect(board.x + board.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(board.y + board.height).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(geometry.scrollOverflow).toBeLessThanOrEqual(0);
  expect(geometry.boardCovered).toEqual([]);
  if (rackBox) {
    expect(rackBox.x).toBeGreaterThanOrEqual(0);
    expect(rackBox.x + rackBox.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(rackBox.y + rackBox.height).toBeLessThanOrEqual(viewport.height + 0.5);
    // Rack never overlaps the board.
    const overlapsX = rackBox.x < board.x + board.width && rackBox.x + rackBox.width > board.x;
    const overlapsY = rackBox.y < board.y + board.height && rackBox.y + rackBox.height > board.y;
    expect(overlapsX && overlapsY).toBe(false);
    if (geometry.rack === "below") {
      // Desktop: the rack sits right under the board. Stack: your strip sits between.
      const gap = rackBox.y - (board.y + board.height);
      expect(gap).toBeGreaterThanOrEqual(0);
      // Stack: Last Move and Unseen rows sit between board and rack.
      expect(gap).toBeLessThanOrEqual(geometry.layout === "stack" ? 96 : 24);
    }
  }
}
