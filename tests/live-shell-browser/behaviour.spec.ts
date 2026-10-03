import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { open, placeSevenEqualsFivePlusTwo } from "./helpers";

const PHONE = { width: 390, height: 664 };
const LAPTOP = { width: 1440, height: 790 };
const rackTokens = (page: import("@playwright/test").Page) =>
  page
    .locator(".lg-rack-tile")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label")?.split(": ")[1]));

test("mobile own-rack practice replaces the tools sheet and closes with pointer or Escape", async ({
  page,
}) => {
  await open(page, "thinking", PHONE);
  await page.getByRole("button", { name: "Record, bag, notes and tools" }).click();
  await page.locator(".lg-log-row").last().click();
  await page.getByRole("button", { name: "Before", exact: true }).click();
  await page.getByRole("button", { name: "Practice this position", exact: true }).click();
  const practice = page.getByRole("dialog", { name: "Own-rack live practice" });
  await expect(practice).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await practice.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  const audit = await new AxeBuilder({ page }).include(".ui-sheet").analyze();
  expect(audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual(
    [],
  );
  await practice.getByRole("button", { name: "Close practice", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Record, bag, notes and tools" }).click();
  await page.getByRole("button", { name: "Practice this position", exact: true }).click();
  await expect(practice).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.locator("#root").evaluate((el) => el.inert)).toBe(false);
});

test("keyboard: Tab into the board, arrows move, Space turns, typing places, Enter commits", async ({
  page,
}) => {
  await open(page, "active", LAPTOP);
  await placeSevenEqualsFivePlusTwo(page);
  await expect(page.locator(".lg-cell.is-tentative")).toHaveCount(4);
  // Focus stayed in the board grid and followed the cursor.
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest("[data-live-board]"))),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Commit +12" })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Pim is thinking")).toBeVisible();
  await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "thinking");
  await expect(page.getByRole("button", { name: /^Last move, turn 5: You, 7=5\+2/ })).toBeVisible();
});

test("THINKING: drag reorders the rack, the board takes no tile, order survives a reload", async ({
  page,
}) => {
  await open(page, "thinking", LAPTOP);
  const before = await rackTokens(page);
  const tiles = page.locator(".lg-rack-tile");
  await tiles.nth(0).dragTo(tiles.nth(3));
  const after = await rackTokens(page);
  expect(after[3]).toBe(before[0]);
  expect(after[0]).toBe(before[3]);
  // Dragging onto the board during THINKING places nothing.
  await tiles.nth(1).dragTo(page.getByRole("button", { name: /^Row 12, column 4,/ }));
  await expect(page.locator(".lg-cell.is-tentative")).toHaveCount(0);
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator(".lg-shell")).toBeVisible();
  expect(await rackTokens(page)).toEqual(after);
});

test("an incoming pause request leaves the game playable and is answered in place", async ({
  page,
}) => {
  await open(page, "pause-request", PHONE);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Pim asks to pause");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Not inert: the board and rack still respond.
  await page.getByRole("button", { name: /^Row 7, column 7,/ }).click();
  await page.keyboard.press("7");
  await expect(page.locator(".lg-cell.is-tentative")).toHaveCount(1);
  await alert.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused by agreement")).toBeVisible();
  await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "paused");
});

test("Notes survive a reload and stay out of every request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(`${request.url()} ${request.postData() ?? ""}`));
  await open(page, "active", LAPTOP);
  await page.getByLabel("Private notes").fill("NOTE-SENTINEL-91");
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.getByLabel("Private notes")).toHaveValue("NOTE-SENTINEL-91");
  expect(requests.some((line) => line.includes("NOTE-SENTINEL-91"))).toBe(false);
});

test("reduced motion removes the sweep and pulses; state is still distinct", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "active", LAPTOP);
  const sweep = await page.evaluate(() => {
    const el = document.createElement("span");
    el.className = "lg-turn-sweep";
    document.querySelector(".lg-board-wrap")!.appendChild(el);
    return getComputedStyle(el).display;
  });
  expect(sweep).toBe("none");
  const dot = await page
    .locator(".lg-card.is-running .lg-run-dot")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(dot).toBe("none");
  await expect(page.locator(".lg-card.is-to-move")).toHaveCount(1);
});

test("turn actions and rack tiles meet the touch-target size on a phone", async ({ page }) => {
  await open(page, "active", PHONE);
  for (const name of ["Exchange", "Pass", "Record, bag, notes and tools", "Match controls"]) {
    const box = (await page.getByRole("button", { name }).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.width).toBeGreaterThanOrEqual(40);
  }
  const tile = (await page.locator(".lg-rack-tile").first().boundingBox())!;
  expect(Math.min(tile.width, tile.height)).toBeGreaterThanOrEqual(40);
});

for (const [state, viewport] of [
  ["active", LAPTOP],
  ["thinking", PHONE],
  ["pause-request", PHONE],
  ["finished", LAPTOP],
] as const) {
  test(`axe: no serious or critical violations (${state}, ${viewport.width}px)`, async ({
    page,
  }) => {
    await open(page, state, viewport);
    const result = await new AxeBuilder({ page }).include(".lg-shell").analyze();
    const serious = result.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(serious.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
  });
}
