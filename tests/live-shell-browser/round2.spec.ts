import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { fixture } from "./helpers";

/**
 * Phone review round 2 — interaction model and game UI polish, in a real
 * browser with real touch: tile typography measured from the rendered SVG,
 * select-then-place, double-tap editing, board → rack slot, the arrow, the
 * draggable bottom sheet (peek, dismiss, backdrop), Turn Log scroll and its
 * explicit View position, Notes focus under clock ticks. Writes AFTER
 * evidence to ROUND2_EVIDENCE (default test-results/round2).
 */
const OUT = process.env.ROUND2_EVIDENCE ?? "test-results/round2";
mkdirSync(OUT, { recursive: true });
const manifest: Record<string, unknown>[] = [];
const PHONE = { width: 390, height: 844 };

async function phone(browser: Browser, state: string, viewport = PHONE, scale = 2) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: scale,
    colorScheme: "light",
  });
  const page = await context.newPage();
  await page.goto(fixture(state));
  await expect(page.locator(".lg-shell")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1700);
  return { page, close: () => context.close() };
}
const cell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });
const slot = (page: Page, index: number) => page.locator(".lg-rack-tile").nth(index);
const rackTile = (page: Page, name: RegExp) =>
  page.locator(".lg-rack-tile").and(page.getByRole("button", { name }));
async function tap(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function shot(page: Page, id: string, label: string, clip?: Locator) {
  const path = join(OUT, `${id}.png`);
  if (clip) await clip.screenshot({ path });
  else await page.screenshot({ path });
  manifest.push({ id, label, viewport: page.viewportSize() });
}
/** A touch drag with CDP touch events (moves in steps, like a finger). */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  dy: number,
  steps = 10,
  stepMs = 16,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * step) / steps }],
    });
    await page.waitForTimeout(stepMs);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const serious = async (page: Page, include: string) =>
  (await new AxeBuilder({ page }).include(include).analyze()).violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.length}`);

test.afterAll(() => writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2)));

test.describe("tile typography", () => {
  test("10–20 sit on the tile's optical centre and are as tall as single digits; point values scale with their tile", async ({
    browser,
  }) => {
    const measure = async (page: Page, selector: string) =>
      page.locator(selector).evaluate((tile) => {
        const box = tile.getBoundingClientRect();
        const face = tile.querySelector<SVGGraphicsElement>(".lg-face text, .lg-face svg")!;
        const point = tile.querySelector<SVGTextElement>(".lg-point");
        const f = face.getBoundingClientRect();
        const p = point?.getBoundingClientRect();
        return {
          tile: box.width,
          dx: (f.left + f.width / 2 - (box.left + box.width / 2)) / box.width,
          width: f.width / box.width,
          point: p ? p.height / box.height : 0,
          inside: p
            ? p.right <= box.right + 0.5 && p.bottom <= box.bottom + 0.5 && p.left >= box.left
            : true,
        };
      });
    const { page, close } = await phone(browser, "active", PHONE, 3);
    // "14" in the rack, "7" in the rack, "12" on the board, "4" on the board.
    const wide = await measure(page, '.lg-rack-tile[aria-label*=": 14,"] .lg-tile');
    const single = await measure(page, '.lg-rack-tile[aria-label*=": 7,"] .lg-tile');
    const boardWide = await measure(page, '[data-board-row="7"][data-board-col="5"] .lg-tile');
    expect(Math.abs(wide.dx)).toBeLessThan(0.03);
    expect(Math.abs(boardWide.dx)).toBeLessThan(0.03);
    // Two digits fill ~60% of the tile width (was ~45%): large, not tiny.
    expect(wide.width).toBeGreaterThan(0.55);
    expect(wide.width).toBeLessThan(0.7);
    // Point value: the same fraction of its tile on a 46 px rack tile and a 24 px cell.
    expect(Math.abs(wide.point - boardWide.point)).toBeLessThan(0.03);
    expect(wide.inside && single.inside && boardWide.inside).toBe(true);
    await shot(
      page,
      "03-two-digit-closeup",
      "10–20 close-up (rack 14, board 12), 3×",
      page.locator(".lg-rack"),
    );
    await close();

    // A tiny board (320×460): the point value shrinks with the cell instead of
    // keeping a fixed screen size.
    const tiny = await phone(browser, "active", { width: 320, height: 460 }, 3);
    const small = await measure(tiny.page, '[data-board-row="7"][data-board-col="5"] .lg-tile');
    expect(small.tile).toBeLessThan(boardWide.tile);
    expect(Math.abs(small.point - boardWide.point)).toBeLessThan(0.03);
    expect(small.inside).toBe(true);
    const board = tiny.page.locator(".lg-board");
    const b = (await board.boundingBox())!;
    await tiny.page.screenshot({
      path: join(OUT, "04-tiny-board-points.png"),
      clip: {
        x: b.x + b.width * 0.3,
        y: b.y + b.height * 0.18,
        width: b.width * 0.45,
        height: b.height * 0.42,
      },
    });
    manifest.push({
      id: "04-tiny-board-points",
      label: "Tiny board (320×460) tile point values, 3×",
    });
    await shot(tiny.page, "02-tiny-board", "Height-constrained phone (320×460)");
    await tiny.close();
  });
});

test.describe("touch interaction model", () => {
  test("select then place, board → board, board → a chosen empty rack slot, arrow escape", async ({
    browser,
  }) => {
    const { page, close } = await phone(browser, "active");
    await shot(page, "01-phone-live", "Normal live game (390×844)");
    await shot(
      page,
      "14-my-perspective-lead",
      "Margin once, from my side",
      page.locator(".lg-scoreboard"),
    );
    await shot(
      page,
      "15-controls",
      "Game controls (HUD + action bar)",
      page.locator(".lg-actionbar"),
    );
    await shot(page, "15b-hud-controls", "HUD sound + menu", page.locator(".lg-hud"));

    // Rack tile selected: warm ring, nothing moves.
    const y = (await slot(page, 2).boundingBox())!.y;
    await tap(page, slot(page, 2));
    await expect(slot(page, 2)).toHaveClass(/is-selected/);
    expect((await slot(page, 2).boundingBox())!.y).toBe(y);
    const ring = await slot(page, 2)
      .locator(".lg-tile")
      .evaluate((tile) => getComputedStyle(tile).boxShadow);
    expect(ring).toMatch(/rgb\(232, 147, 12\)/);
    await shot(
      page,
      "05-selected-rack-tile",
      "Selected rack tile (warm ring)",
      page.locator(".lg-rack"),
    );

    await tap(page, cell(page, "C12"));
    await expect(cell(page, "C12")).toHaveAccessibleName(/your tentative tile/);
    await expect(slot(page, 2)).toHaveClass(/is-empty/);
    // Select the tentative tile: empty slots become targets.
    await tap(page, cell(page, "C12"));
    await expect(cell(page, "C12")).toHaveClass(/is-selected/);
    await expect(slot(page, 2)).toHaveClass(/is-target/);
    await shot(
      page,
      "06-selected-board-tile",
      "Selected tentative board tile; empty slot shows it can take it",
    );
    // Board → board.
    await tap(page, cell(page, "E10"));
    await expect(cell(page, "E10")).toHaveAccessibleName(/your tentative tile/);
    // Board → a different empty slot: make slot 7 empty first.
    await tap(page, slot(page, 6));
    await tap(page, cell(page, "A1"));
    await tap(page, cell(page, "E10"));
    await shot(page, "09a-return-holding", "Holding a board tile: empty slots are targets");
    await tap(page, slot(page, 6));
    await expect(cell(page, "E10")).toHaveAccessibleName(/empty/);
    await expect(slot(page, 2)).toHaveClass(/is-empty/);
    await expect(slot(page, 6)).not.toHaveClass(/is-empty/);
    await shot(page, "09b-returned-to-slot", "Board tile returned into the chosen slot (7)");
    await page.getByRole("button", { name: "Recall" }).tap();

    // Arrow: RIGHT, DOWN, escape after a placement.
    await tap(page, cell(page, "G11"));
    await expect(cell(page, "G11")).toHaveClass(/dir-right/);
    await shot(page, "10-arrow-right", "Arrow RIGHT", page.locator(".lg-board"));
    await tap(page, cell(page, "G11"));
    await expect(cell(page, "G11")).toHaveClass(/dir-down/);
    await shot(page, "11-arrow-down", "Arrow DOWN", page.locator(".lg-board"));
    await tap(page, slot(page, 0));
    await expect(cell(page, "G11")).toHaveAccessibleName(/your tentative tile/);
    await expect(cell(page, "G12")).toHaveClass(/dir-down/);
    await shot(
      page,
      "12-arrow-escaped",
      "Arrow moved past the placed tile (G11 → G12)",
      page.locator(".lg-board"),
    );
    // The arrow at G12 points DOWN: one tap turns it OFF, the next back to RIGHT.
    await tap(page, cell(page, "G12"));
    await expect(page.locator(".lg-cell.is-cursor")).toHaveCount(0);
    await tap(page, cell(page, "G12"));
    await expect(cell(page, "G12")).toHaveClass(/dir-right/);
    expect(await serious(page, ".lg-shell")).toEqual([]);
    await close();
  });

  test("an assigned alternative: one tap selects it to move, a double tap edits it", async ({
    browser,
  }) => {
    const { page, close } = await phone(browser, "alternatives");
    await tap(page, rackTile(page, /× \/ ÷ tile/));
    await tap(page, cell(page, "G7"));
    const picker = page.getByRole("dialog", { name: "Choose the sign" });
    await expect(picker).toBeVisible();
    await picker.getByRole("button", { name: "Play as divide" }).tap();
    await expect(picker).toHaveCount(0);
    await tap(page, cell(page, "G7"));
    await expect(picker).toHaveCount(0);
    await expect(cell(page, "G7")).toHaveClass(/is-selected/);
    await shot(
      page,
      "07-alternative-selected",
      "Assigned alternative selected for movement (single tap)",
      page.locator(".lg-board"),
    );
    await tap(page, cell(page, "C13"));
    await expect(cell(page, "C13")).toHaveAccessibleName(/^C13, ÷, chosen from/);
    // Double tap (real touch): the picker, current choice marked.
    const box = (await cell(page, "C13").boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(90);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: "Play as divide" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await shot(page, "08-alternative-picker-edit", "FacePicker after an explicit double tap");
    // Swipe the docked picker down to dismiss it; nothing moves.
    const head = (await page.locator(".lg-picker-head").boundingBox())!;
    await touchDrag(page, { x: head.x + head.width / 2, y: head.y + 8 }, 120);
    await expect(picker).toHaveCount(0);
    await expect(cell(page, "C13")).toHaveAccessibleName(/your tentative tile/);
    await close();
  });
});

test.describe("bottom sheet", () => {
  test("drag down to peek (board visible), drag further to dismiss; backdrop tap closes without touching the board", async ({
    browser,
  }) => {
    const { page, close } = await phone(browser, "long");
    await page.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    const sheet = page.getByRole("dialog", { name: "Game" });
    await expect(sheet).toHaveAttribute("data-snap", "full");
    await page.waitForTimeout(350);
    await shot(page, "16-more-expanded", "More sheet, expanded");
    // The Turn Log has many entries and scrolls inside the sheet.
    const body = page.locator(".lg-sheet-body");
    const entries = page.locator(".lg-tl-entry");
    expect(await entries.count()).toBeGreaterThan(25);
    await shot(page, "18-turn-log-many", "Turn Log, many entries");
    const scroll = await body.evaluate((el) => ({
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
    }));
    expect(scroll.max).toBeGreaterThan(200);
    const bodyBox = (await body.boundingBox())!;
    await touchDrag(
      page,
      { x: bodyBox.x + bodyBox.width / 2, y: bodyBox.y + bodyBox.height - 40 },
      -360,
    );
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await entries.last().scrollIntoViewIfNeeded();
    await expect(entries.last()).toBeInViewport();
    // The long equation stays on one entry line that scrolls sideways.
    const long = page
      .locator(".lg-tl-expr")
      .filter({ hasText: /^.{13,}$/ })
      .first();
    await long.scrollIntoViewIfNeeded();
    const overflow = await long.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
      h: el.clientHeight,
    }));
    expect(overflow.h).toBeLessThan(30);
    await shot(
      page,
      "19-long-expression",
      "Long expression entry (scrolls inside its line)",
      long.locator("xpath=.."),
    );

    const grabAt = async () => {
      const grab = (await page.locator(".lg-sheet-grab").boundingBox())!;
      return { x: grab.x + grab.width / 2, y: grab.y + 10 };
    };
    // A slow, deliberate pull down (no flick): rests at PEEK, and stays there —
    // the whole board is visible above the open sheet.
    await touchDrag(page, await grabAt(), 160, 16, 60);
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    await page.waitForTimeout(800);
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    const boardBottom = (await page.locator(".lg-board-wrap").boundingBox())!;
    const sheetTop = (await sheet.boundingBox())!.y;
    expect(sheetTop).toBeGreaterThanOrEqual(boardBottom.y + boardBottom.height - 1);
    await shot(page, "17-more-peek", "More sheet at peek: the board stays in view");
    // Content is still usable at peek (tabs respond).
    await sheet.getByRole("tab", { name: "Bag" }).tap();
    await expect(sheet.getByRole("tab", { name: "Bag" })).toHaveAttribute("aria-selected", "true");
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    // Restore: drag up (slowly) back to expanded.
    await touchDrag(page, await grabAt(), -200, 16, 60);
    await expect(sheet).toHaveAttribute("data-snap", "full");
    await page.waitForTimeout(350);
    // A quick flick down from expanded also stops at peek, not closed…
    await touchDrag(page, await grabAt(), 140, 6, 12);
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    await page.waitForTimeout(350);
    // …and from peek, a further pull down dismisses.
    await touchDrag(page, await grabAt(), 260, 12, 40);
    await expect(sheet).toHaveCount(0);

    // Backdrop tap: closes, and the tap never reaches the board.
    await page.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(300);
    const c = (await cell(page, "B3").boundingBox())!;
    await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
    await expect(sheet).toHaveCount(0);
    await expect(page.locator(".lg-cell.is-cursor")).toHaveCount(0);
    // Once dismissed, the very next tap reaches the game (no wait for the slide-out).
    await page.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    await page.waitForTimeout(300);
    await page.locator(".lg-sheet-dismiss").tap({ position: { x: 20, y: 20 } });
    await tap(page, slot(page, 0));
    await expect(slot(page, 0)).toHaveClass(/is-selected/);
    await tap(page, slot(page, 0));
    // Re-opening right after a dismissal (during the slide-out) keeps it open.
    await page.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    await page.waitForTimeout(600);
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-state", "open");
    // No close button inside any sheet.
    await expect(sheet.getByRole("button", { name: /^Close/ })).toHaveCount(0);
    expect(await serious(page, ".lg-sheet")).toEqual([]);
    await close();
  });

  test("Turn Log: opening it keeps the board live; View position enters review and lowers the sheet", async ({
    browser,
  }) => {
    const { page, close } = await phone(browser, "long");
    await page.getByRole("button", { name: /^Last move, turn/ }).tap();
    const sheet = page.getByRole("dialog", { name: "Game" });
    await expect(sheet.getByRole("tab", { name: "Record" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(".lg-board-wrap.is-review")).toHaveCount(0);
    await sheet.getByRole("button", { name: "View position, turn 10" }).tap();
    await expect(page.locator(".lg-board-wrap.is-review")).toHaveCount(1);
    await expect(sheet).toHaveAttribute("data-snap", "peek");
    await page.waitForTimeout(350);
    await shot(page, "18b-view-position", "View position: review on the board, sheet at peek");
    await sheet.getByRole("button", { name: "Back to live" }).first().tap();
    await expect(page.locator(".lg-board-wrap.is-review")).toHaveCount(0);
    await close();
  });

  test("Notes: one tap focuses; typing survives clock ticks and live updates", async ({
    browser,
  }) => {
    const { page, close } = await phone(browser, "active");
    await page.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    await page.getByRole("tab", { name: "Notes" }).tap();
    const area = page.locator(".lg-notes textarea");
    await area.tap();
    await expect(area).toBeFocused();
    await page.keyboard.type("x+3=7?");
    for (let tick = 0; tick < 4; tick += 1) {
      await page.waitForTimeout(600);
      await expect(area).toBeFocused();
    }
    await page.keyboard.type(" try 14");
    await expect(area).toHaveValue("x+3=7? try 14");
    // 16 px text: iOS does not zoom the page on focus.
    expect(await area.evaluate((el) => getComputedStyle(el).fontSize)).toBe("16px");
    await shot(page, "20-notes-focused", "Notes: focused textarea, typing");
    await close();
  });
});

test("timerless HUD", async ({ browser }) => {
  const { page, close } = await phone(browser, "untimed");
  await expect(page.locator(".lg-sb-clock")).toHaveCount(0);
  await shot(page, "13-timerless-hud", "Untimed game: no clock at all", page.locator(".lg-hud"));
  await shot(page, "13b-timerless-full", "Untimed game (390×844)");
  await close();
});

test("desktop sanity", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 790 } });
  const page = await context.newPage();
  await page.goto(fixture("long"));
  await expect(page.locator(".lg-shell")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1700);
  await expect(page.locator(".lg-tl-entry").first()).toBeVisible();
  await shot(page, "21-desktop-long", "Desktop 1440×790, long game, Turn Log in the gutter");
  await page.locator(".lg-rack-tile").nth(1).click();
  await cell(page, "B13").click();
  await cell(page, "B13").click();
  await shot(page, "22-desktop-selection", "Desktop: tentative tile selected, empty slot target");
  expect(await serious(page, ".lg-shell")).toEqual([]);
  await page.setViewportSize({ width: 1280, height: 690 });
  await page.waitForTimeout(400);
  await shot(page, "23-desktop-short", "Desktop 1280×690");
  await context.close();
});
