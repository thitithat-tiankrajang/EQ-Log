import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectSoundGeometry, measure, open, placeSevenEqualsFivePlusTwo } from "./helpers";

/**
 * AFTER-only visual evidence for product review, from the final tree. Each view
 * records viewport, mode (layout), state and the measured geometry, and asserts
 * the technical gates (square board in the viewport, no overflow, nothing on
 * top of the board, rack beside/below without overlap). Passing these is NOT
 * product approval; the screenshots are for the product owner.
 */
const OUT = process.env.LIVE_SHELL_EVIDENCE ?? "test-results/live-shell-evidence";
mkdirSync(OUT, { recursive: true });
const manifest: unknown[] = [];

type View = {
  id: string;
  label: string;
  viewport: { width: number; height: number };
  state: string;
  viewer?: string;
  prepare?: (page: Page) => Promise<void>;
};

const PHONE = { width: 390, height: 664 };
const LAPTOP = { width: 1440, height: 790 };
const VIEWS: View[] = [
  {
    id: "01-390-active",
    label: "390px phone · ACTIVE (your turn)",
    viewport: PHONE,
    state: "active",
  },
  {
    id: "02-390-thinking",
    label: "390px phone · THINKING (opponent's turn, last move Pass)",
    viewport: PHONE,
    state: "thinking",
  },
  {
    id: "03-390-tentative",
    label: "390px phone · tentative placement 7=5+2 (local only)",
    viewport: PHONE,
    state: "active",
    prepare: placeSevenEqualsFivePlusTwo,
  },
  {
    id: "04-390-pause-request",
    label: "390px phone · incoming pause request (non-blocking)",
    viewport: PHONE,
    state: "pause-request",
  },
  {
    id: "05-320-active",
    label: "320px phone · ACTIVE (compact)",
    viewport: { width: 320, height: 460 },
    state: "active",
  },
  {
    id: "06-390-more-sheet",
    label: "390px phone · secondary tools (More → Record)",
    viewport: PHONE,
    state: "active",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Record, bag, notes and tools" }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "07-390-more-bag",
    label: "390px phone · secondary tools (More → Bag, unseen distribution)",
    viewport: PHONE,
    state: "active",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Record, bag, notes and tools" }).click();
      await page.getByRole("tab", { name: /Bag/ }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "08-390-match-menu",
    label: "390px phone · Match controls (Coffee Break, pause, Surrender last)",
    viewport: PHONE,
    state: "active",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Match controls" }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    id: "09-tablet-portrait",
    label: "Tablet portrait 768×950 · ACTIVE",
    viewport: { width: 768, height: 950 },
    state: "active",
  },
  {
    id: "10-tablet-landscape",
    label: "Tablet landscape 1024×700 · THINKING",
    viewport: { width: 1024, height: 700 },
    state: "thinking",
  },
  {
    id: "11-laptop-13",
    label: "13-inch laptop 1440×790 · ACTIVE",
    viewport: LAPTOP,
    state: "active",
  },
  {
    id: "12-laptop-tentative",
    label: "13-inch laptop 1440×790 · tentative placement, Commit +score",
    viewport: LAPTOP,
    state: "active",
    prepare: placeSevenEqualsFivePlusTwo,
  },
  {
    id: "13-desktop-1080p",
    label: "1080p desktop 1920×960 · ACTIVE",
    viewport: { width: 1920, height: 960 },
    state: "active",
  },
  {
    id: "14-desktop-wide",
    label: "Wide desktop 2560×1310 · THINKING",
    viewport: { width: 2560, height: 1310 },
    state: "thinking",
  },
  {
    id: "15-short-1280x560",
    label: "Short desktop window 1280×560 · ACTIVE (rack in gutter)",
    viewport: { width: 1280, height: 560 },
    state: "active",
  },
  {
    id: "16-desktop-notes",
    label: "Desktop 1440×790 · private Notes in the lower-left gutter",
    viewport: LAPTOP,
    state: "thinking",
    prepare: async (page) => {
      await page
        .getByLabel("Private notes")
        .fill(
          "Pim kept 5 5 ÷ ? after the exchange.\nWatch the 3E at R1 C8.\nPlan: 14 = 7 × 2 off the 2 on R8.",
        );
    },
  },
  {
    id: "17-desktop-last-exchange",
    label: "Desktop 1440×790 · Last Move: Exchanged 4 tiles",
    viewport: LAPTOP,
    state: "exchanged",
  },
  {
    id: "18-desktop-last-place",
    label: "Desktop 1440×790 · Last Move: placement 1+8=9 +score",
    viewport: LAPTOP,
    state: "active",
  },
  {
    id: "19-desktop-pause-request",
    label: "Desktop 1440×790 · incoming pause request (game continues)",
    viewport: LAPTOP,
    state: "pause-request",
  },
  {
    id: "20-desktop-paused",
    label: "Desktop 1440×790 · PAUSED by agreement",
    viewport: LAPTOP,
    state: "paused",
  },
  {
    id: "21-desktop-result",
    label: "Desktop 1440×790 · terminal Result (Notes kept for this visit)",
    viewport: LAPTOP,
    state: "finished",
    prepare: async (page) => {
      await page.getByLabel("Private notes").fill("Result notes stay until I leave.");
    },
  },
  {
    id: "22-390-result",
    label: "390px phone · terminal Result",
    viewport: PHONE,
    state: "finished",
  },
  {
    id: "23-physical-host",
    label: "Desktop 1440×790 · Physical Hosted host (Physical console tab)",
    viewport: LAPTOP,
    state: "physical",
    viewer: "host",
    prepare: async (page) => {
      await page.getByRole("tab", { name: "Physical" }).click();
    },
  },
  {
    id: "24-phone-landscape",
    label: "Phone landscape 750×340 · ACTIVE",
    viewport: { width: 750, height: 340 },
    state: "active",
  },
  {
    id: "25-375-active",
    label: "375px phone 375×548 · ACTIVE",
    viewport: { width: 375, height: 548 },
    state: "active",
  },
  {
    id: "26-tablet-large",
    label: "Large tablet portrait 820×1100 · ACTIVE",
    viewport: { width: 820, height: 1100 },
    state: "active",
  },
  {
    id: "27-laptop-1280",
    label: "13-inch laptop 1280×690 · ACTIVE",
    viewport: { width: 1280, height: 690 },
    state: "active",
  },
  {
    id: "28-390-practice",
    label: "390px phone · own-rack practice (separate dialog)",
    viewport: PHONE,
    state: "thinking",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Record, bag, notes and tools" }).click();
      await page.locator(".lg-tl-view").last().click();
      await page.getByRole("button", { name: "Before", exact: true }).click();
      await page.getByRole("button", { name: "Practice this position", exact: true }).click();
      await page.getByRole("dialog", { name: "Own-rack live practice" }).waitFor();
    },
  },
];

for (const view of VIEWS) {
  test(`${view.id} ${view.label}`, async ({ page }) => {
    await open(page, view.state, view.viewport, view.viewer);
    await view.prepare?.(page);
    await page.waitForTimeout(250);
    const geometry = await measure(page);
    const sheetOpen = (await page.locator(".ui-sheet, .lg-sheet").count()) > 0;
    if (!sheetOpen) expectSoundGeometry(geometry);
    const turn = await page.locator(".lg-shell").getAttribute("data-turn");
    await page.screenshot({ path: join(OUT, `${view.id}.png`) });
    manifest.push({
      id: view.id,
      label: view.label,
      viewport: `${view.viewport.width}x${view.viewport.height}`,
      layout: geometry.layout,
      rack: geometry.rack,
      state: view.state,
      turn,
      board: Math.round(geometry.board.width),
    });
    expect(turn).not.toBeNull();
  });
}

test.afterAll(() => {
  const path = join(OUT, "manifest.json");
  const previous: { id: string }[] =
    manifest.length < VIEWS.length && existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : [];
  const byId = new Map(previous.map((view) => [view.id, view]));
  for (const view of manifest as { id: string }[]) byId.set(view.id, view);
  writeFileSync(
    path,
    JSON.stringify(
      [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
      null,
      2,
    ),
  );
});
