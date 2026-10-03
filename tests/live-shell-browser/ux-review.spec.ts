import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectSoundGeometry, fixture, measure, open } from "./helpers";

/**
 * Product-owner mobile/gameplay review: interaction contracts in a real
 * browser, and AFTER-only evidence (full views and 3× close-ups of glyphs and
 * tile states). Fixtures run the real reducers and recipient projection.
 */
const OUT = process.env.PO_UX_EVIDENCE ?? "test-results/po-ux-review";
mkdirSync(OUT, { recursive: true });
const manifest: Record<string, unknown>[] = [];
const PHONE = { width: 390, height: 844 };

const rackTile = (page: Page, name: RegExp) =>
  page.locator(".lg-rack-tile").and(page.getByRole("button", { name }));
const cell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });
const marked = (page: Page) =>
  page.locator('.lg-rack-tile[aria-pressed="true"]').evaluateAll((tiles) => tiles.length);

async function placeSevenEqualsFivePlusTwo(page: Page) {
  await cell(page, "G7").click();
  await page.keyboard.press("Space");
  for (const key of ["7", "5", "p", "2"]) await page.keyboard.press(key);
}

async function dragAcross(page: Page, from: number, to: number) {
  const tiles = page.locator(".lg-rack-tile");
  const a = (await tiles.nth(from).boundingBox())!;
  const b = (await tiles.nth(to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function touchAcross(page: Page, from: number, to: number) {
  const tiles = page.locator(".lg-rack-tile");
  const a = (await tiles.nth(from).boundingBox())!;
  const b = (await tiles.nth(to).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = a.y + a.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: a.x + a.width / 2, y }],
  });
  for (let step = 1; step <= 10; step += 1) {
    const x = a.x + a.width / 2 + ((b.x - a.x) * step) / 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.describe("interaction contracts", () => {
  test("blank: place, then one tap on 20 — no cycling, no default value", async ({ page }) => {
    await open(page, "alternatives", PHONE);
    await rackTile(page, /blank, value not chosen/).click();
    await cell(page, "G7").click();
    const picker = page.getByRole("dialog", { name: "Blank: choose its value" });
    await expect(picker).toBeVisible();
    await expect(cell(page, "G7")).toHaveAccessibleName(/blank, value not chosen/);
    await picker.getByRole("button", { name: "Play as 20" }).click();
    await expect(picker).toHaveCount(0);
    await expect(cell(page, "G7")).toHaveAccessibleName(/^G7, blank played as 20/);
  });

  test("+/−: direct choice; picker docks on phone and anchors on desktop after a resize", async ({
    page,
  }) => {
    await open(page, "alternatives", PHONE);
    await rackTile(page, /\+ \/ - tile/).click();
    await cell(page, "G7").click();
    await expect(page.locator(".lg-picker.is-dock")).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 790 });
    await expect(page.locator(".lg-picker.is-anchor")).toBeVisible();
    await page.getByRole("button", { name: "Play as minus" }).click();
    await expect(cell(page, "G7")).toHaveAccessibleName(/^G7, -, chosen from \+ \/ -/);
    // The chosen sign is drawn in the "chosen" blue; the other sign is a small neutral mark.
    const colour = await cell(page, "G7")
      .locator(".lg-face")
      .evaluate((el) => getComputedStyle(el).color);
    expect(colour).toBe("rgb(92, 200, 255)");
    await expect(cell(page, "G7").locator(".lg-alt-mark")).toHaveCount(1);
  });

  test("an unchosen +/− in the rack is neutral, not blue", async ({ page }) => {
    await open(page, "alternatives", PHONE);
    const face = rackTile(page, /\+ \/ - tile/).locator(".lg-pair");
    await expect(face).toHaveCount(1);
    const colour = await face.evaluate((el) => getComputedStyle(el).color);
    expect(colour).not.toBe("rgb(92, 200, 255)");
  });

  test("Exchange: drag across to select, drag from a marked tile to deselect, nothing moves", async ({
    page,
  }) => {
    await open(page, "active", PHONE);
    const before = await page
      .locator(".lg-rack-tile")
      .evaluateAll((tiles) => tiles.map((tile) => tile.getBoundingClientRect().y));
    await page.getByRole("button", { name: "Exchange" }).click();
    await dragAcross(page, 0, 3);
    expect(await marked(page)).toBe(4);
    await expect(page.getByRole("button", { name: "Exchange 4 tiles" })).toBeEnabled();
    await dragAcross(page, 2, 3);
    expect(await marked(page)).toBe(2);
    // Tap toggles too.
    await page.locator(".lg-rack-tile").nth(7).click();
    expect(await marked(page)).toBe(3);
    const after = await page
      .locator(".lg-rack-tile")
      .evaluateAll((tiles) =>
        tiles.map((tile) => [tile.getBoundingClientRect().y, getComputedStyle(tile).transform]),
      );
    expect(after.map(([y]) => y)).toEqual(before);
    expect(after.every(([, transform]) => transform === "none")).toBe(true);
    // Nothing was exchanged by the gesture itself.
    await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "active");
  });

  test("Exchange drag-across works with real touch", async ({ browser }) => {
    const context = await browser.newContext({ viewport: PHONE, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(fixture("active"));
    await expect(page.locator(".lg-shell")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Exchange" }).tap();
    await touchAcross(page, 1, 5);
    expect(await marked(page)).toBe(5);
    await context.close();
  });

  test("outside Exchange, dragging still reorders the rack and a selected tile does not lift", async ({
    page,
  }) => {
    await open(page, "thinking", PHONE);
    const tokens = () =>
      page
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) =>
          tiles.map((tile) => tile.getAttribute("aria-label")?.split(": ")[1]),
        );
    const start = await tokens();
    const tiles = page.locator(".lg-rack-tile");
    await tiles.nth(0).dragTo(tiles.nth(2));
    const after = await tokens();
    expect(after[2]).toBe(start[0]);
    const y = (await tiles.nth(4).boundingBox())!.y;
    await tiles.nth(4).click();
    await expect(tiles.nth(4)).toHaveClass(/is-selected/);
    expect((await tiles.nth(4).boundingBox())!.y).toBe(y);
  });
});

test.describe("accessibility of the new surfaces", () => {
  const serious = async (page: Page) =>
    (await new AxeBuilder({ page }).include(".lg-shell").analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.length}`);
  test("blank picker open (phone)", async ({ page }) => {
    await open(page, "alternatives", PHONE);
    await rackTile(page, /blank, value not chosen/).click();
    await cell(page, "G7").click();
    await expect(page.getByRole("dialog", { name: "Blank: choose its value" })).toBeVisible();
    // Focus moved into the picker; arrows move between values.
    await expect(page.getByRole("button", { name: "Play as 0", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Play as 1", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("button", { name: "Play as 8", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(cell(page, "G7")).toHaveAccessibleName(/blank played as 8/);
    expect(await serious(page)).toEqual([]);
  });
  test("Exchange selection and tight HUD", async ({ page }) => {
    await open(page, "active", PHONE);
    await page.getByRole("button", { name: "Exchange" }).click();
    await dragAcross(page, 0, 2);
    expect(await serious(page)).toEqual([]);
    await open(page, "active", { width: 320, height: 460 });
    expect(await serious(page)).toEqual([]);
  });
});

type View = {
  id: string;
  label: string;
  viewport: { width: number; height: number };
  state: string;
  prepare?: (page: Page) => Promise<void>;
  /** Overlays (pickers) cover part of the screen on purpose. */
  overlay?: boolean;
};

const VIEWS: View[] = [
  {
    id: "01-phone-active",
    label: "390×844 · ACTIVE (your turn)",
    viewport: PHONE,
    state: "active",
  },
  {
    id: "02-phone-thinking",
    label: "390×844 · THINKING (opponent's turn)",
    viewport: PHONE,
    state: "thinking",
  },
  {
    id: "03-phone-operator-chooser",
    label: "390×844 · +/− placed → direct sign chooser",
    viewport: PHONE,
    state: "alternatives",
    overlay: true,
    prepare: async (page) => {
      await rackTile(page, /\+ \/ - tile/).click();
      await cell(page, "G7").click();
    },
  },
  {
    id: "04-phone-blank-chooser",
    label: "390×844 · blank placed → direct value chooser (0–20, operators)",
    viewport: PHONE,
    state: "alternatives",
    overlay: true,
    prepare: async (page) => {
      await rackTile(page, /blank, value not chosen/).click();
      await cell(page, "G7").click();
    },
  },
  {
    id: "05-phone-exchange-selection",
    label: "390×844 · Exchange: 3 tiles selected by drag-across (stationary)",
    viewport: PHONE,
    state: "active",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Exchange" }).click();
      await dragAcross(page, 1, 3);
    },
  },
  {
    id: "06-phone-tentative",
    label: "390×844 · tentative 7=5+2 (the + is a chosen +/− tile), Commit +12",
    viewport: PHONE,
    state: "alternatives",
    prepare: placeSevenEqualsFivePlusTwo,
  },
  {
    id: "09-phone-320",
    label: "320×568 · normal gameplay",
    viewport: { width: 320, height: 568 },
    state: "active",
  },
  {
    id: "09b-phone-320-short",
    label: "320×460 · very short phone (tight HUD, Unseen total in the action bar)",
    viewport: { width: 320, height: 460 },
    state: "active",
  },
  {
    id: "10-tablet",
    label: "Tablet 768×1024 · ACTIVE",
    viewport: { width: 768, height: 1024 },
    state: "active",
  },
  {
    id: "11-laptop-13",
    label: "13-inch laptop 1440×790 · ACTIVE",
    viewport: { width: 1440, height: 790 },
    state: "active",
  },
  {
    id: "12-desktop-1080p",
    label: "1080p desktop 1920×960 · THINKING",
    viewport: { width: 1920, height: 960 },
    state: "thinking",
  },
  {
    id: "13-short-1280x560",
    label: "Short desktop 1280×560 · ACTIVE",
    viewport: { width: 1280, height: 560 },
    state: "active",
  },
  {
    id: "13b-desktop-chooser",
    label: "Desktop 1440×790 · ×/÷ chooser anchored to the tile",
    viewport: { width: 1440, height: 790 },
    state: "alternatives",
    overlay: true,
    prepare: async (page) => {
      await rackTile(page, /× \/ ÷ tile/).click();
      await cell(page, "G7").click();
    },
  },
];

for (const view of VIEWS) {
  test(`evidence ${view.id}`, async ({ page }) => {
    await open(page, view.state, view.viewport);
    await view.prepare?.(page);
    await page.waitForTimeout(300);
    const geometry = await measure(page);
    if (!view.overlay) expectSoundGeometry(geometry);
    await page.screenshot({ path: join(OUT, `${view.id}.png`) });
    manifest.push({
      id: view.id,
      label: view.label,
      viewport: `${view.viewport.width}x${view.viewport.height}`,
      layout: geometry.layout,
      density: await page
        .locator(".lg-shell")
        .evaluate((el) => (el as HTMLElement).dataset.density ?? ""),
      state: view.state,
      turn: await page.locator(".lg-shell").getAttribute("data-turn"),
      board: Math.round(geometry.board.width),
    });
  });
}

async function closeups(browser: Browser) {
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await page.goto(fixture("alternatives"));
  await expect(page.locator(".lg-shell")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1800);
  const shot = async (id: string, label: string, locator: ReturnType<Page["locator"]>) => {
    await locator.screenshot({ path: join(OUT, `${id}.png`) });
    manifest.push({ id, label, viewport: "390x844 @3x", closeup: true });
  };
  await shot(
    "07-hud-score-lead-clocks",
    "HUD: both players, lead +15/−15, clocks, turn tint",
    page.locator(".lg-hud"),
  );
  await shot(
    "08-unseen-strip",
    "Unseen strip: total, bag, groups (always visible)",
    page.locator(".lg-unseen"),
  );
  await shot("14-number-tile", "Number tile (committed H8 = 4)", cell(page, "H8"));
  await shot(
    "15-plus-minus-open",
    "+/− tile, sign not chosen (rack)",
    rackTile(page, /\+ \/ - tile/),
  );
  await shot(
    "16-times-divide-open",
    "×/÷ tile, sign not chosen (rack)",
    rackTile(page, /× \/ ÷ tile/),
  );
  await shot(
    "19-last-move-tile",
    "Last-move tile (F4 = 1): corner dot, glyph untouched",
    cell(page, "F4"),
  );
  await shot(
    "14b-operator-tiles",
    "Drawn operators on the board: +, ×, =, −",
    page.locator(".lg-grid"),
  );
  await placeSevenEqualsFivePlusTwo(page);
  await page.waitForTimeout(200);
  await shot(
    "17-selected-alternative",
    "Chosen alternative: + from a +/− tile (blue), − mark",
    cell(page, "G10"),
  );
  await shot(
    "18-tentative-tile",
    "Tentative tile (G9 = 5): thin amber edge, slight lift",
    cell(page, "G9"),
  );
  await shot(
    "18b-tentative-column",
    "Tentative play 7=5+2 with Commit score badge",
    page.locator(".lg-board-wrap"),
  );
  await page.getByRole("button", { name: "Recall" }).click();
  await page.getByRole("button", { name: "Exchange" }).click();
  await dragAcross(page, 3, 5);
  await shot(
    "20-exchange-selected-rack",
    "Exchange-selected rack tiles: stationary, overlay + check",
    page.locator(".lg-rack"),
  );
  await context.close();
}

test("evidence close-ups (3×)", async ({ browser }) => {
  await closeups(browser);
});

test.afterAll(() => {
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
});
