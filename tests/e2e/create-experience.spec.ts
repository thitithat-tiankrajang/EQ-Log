import { expect, test, type Page } from "@playwright/test";

// Runs in every project (desktop, Pixel 7 and 320 px compact): the Create
// experience must offer the same choices however narrow the screen.

const CHOICES = [
  "Play another player",
  "Host a game",
  "Pass & Play / Record",
  "Solo practice",
  "Custom game",
];

function createAction(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Create game" });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#/public");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("(+) opens the same Create choices in every layout, fully on screen", async ({ page }) => {
  await createAction(page).click();
  const dialog = page.getByRole("dialog", { name: "Create a game" });
  await expect(dialog).toBeVisible();
  // Opening the chooser is not a navigation.
  await expect(page).toHaveURL(/#\/public$/);

  const options = dialog.locator(".eq-create-option");
  await expect(options).toHaveCount(CHOICES.length);
  await expect(options.locator("strong")).toHaveText(CHOICES);
  // This suite runs without the online service, so the two online choices
  // say why they are unavailable instead of disappearing.
  await expect(dialog.getByText("Needs the online service")).toHaveCount(2);
  await expect(dialog).not.toContainText(/Ranked|Stage|Survival|Authur|ArchBot/);

  // Measure the settled sheet, not its entrance animation.
  await page
    .locator(".ui-sheet-backdrop")
    .evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
  const geometry = await page.evaluate(() => {
    const sheet = document.querySelector(".ui-sheet")!.getBoundingClientRect();
    const rows = [...document.querySelectorAll(".eq-create-option, .eq-create-join")].map((row) =>
      row.getBoundingClientRect(),
    );
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: window.innerHeight,
      pageWidth: document.documentElement.scrollWidth,
      sheet: { left: sheet.left, right: sheet.right, bottom: sheet.bottom },
      rowHeights: rows.map((row) => row.height),
      rowsInside: rows.every((row) => row.left >= sheet.left && row.right <= sheet.right),
    };
  });
  expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.sheet.left).toBeGreaterThanOrEqual(0);
  expect(geometry.sheet.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.sheet.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.rowsInside).toBe(true);
  for (const height of geometry.rowHeights) expect(height).toBeGreaterThanOrEqual(44);

  // The sheet sits above the bottom navigation: the page behind is inert.
  await expect(page.locator("#root")).toHaveAttribute("inert", "");

  await dialog.getByRole("link", { name: /Solo practice/ }).click();
  await expect(page).toHaveURL(/#\/create\?mode=solo$/);
  await expect(page.getByRole("heading", { level: 1, name: "Solo practice" })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("the chooser works from the keyboard and Escape returns focus to (+)", async ({ page }) => {
  await createAction(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create a game" });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  // Tab reaches a choice and stays in the chooser.
  for (let step = 0; step < 8; step += 1) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(createAction(page)).toBeFocused();

  // Enter on a focused choice follows it.
  await page.keyboard.press("Enter");
  await dialog.getByRole("link", { name: /Pass & Play \/ Record/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/create\?mode=passplay$/);
});

test("browser Back leaves a chosen form for the page Create was opened on", async ({ page }) => {
  await createAction(page).click();
  await page
    .getByRole("dialog", { name: "Create a game" })
    .getByRole("link", { name: /Pass & Play \/ Record/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Pass & Play / Record" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/#\/public$/);
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Pass & Play / Record" })).toBeVisible();
});

test("bookmarked Create addresses open directly", async ({ page }) => {
  // A choice skips the chooser and the space step; the space is in the form.
  await page.goto("/#/create?mode=solo&space=region");
  await expect(page.getByRole("heading", { level: 1, name: "Solo practice" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Without an assigned region (local-only), Public is chosen and Region is not offered.
  await expect(page.getByRole("button", { name: "Public" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Region" })).toBeDisabled();

  await page.goto("/#/create?mode=custom");
  await expect(page.getByRole("heading", { level: 1, name: "Choose a space" })).toBeVisible();

  // The older Region create address still opens Create in the Region's context.
  await page.goto("/#/region/create");
  await expect(page.getByRole("heading", { level: 1, name: "Create a game" })).toBeVisible();
  await expect(page.locator(".eq-flow-page .eq-create-option").first()).toBeVisible();
  await expect(
    page.locator(".eq-flow-page").getByRole("link", { name: /Solo practice/ }),
  ).toHaveAttribute("href", "#/create?space=region&mode=solo");

  // The Ranked page's own create address is kept, though Create never offers it.
  await page.goto("/#/create?mode=ranked");
  await expect(
    page.getByRole("heading", { level: 1, name: "Configure ranked match" }),
  ).toBeVisible();
});

test("the chooser speaks Thai when the player chose Thai", async ({ page }) => {
  await page.goto("/#/me");
  await page.getByRole("button", { name: "ไทย" }).click();
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "สร้างเกม" })
    .click();
  const dialog = page.getByRole("dialog", { name: "สร้างเกม" });
  await expect(dialog.locator(".eq-create-option strong")).toHaveText([
    "เล่นกับผู้เล่นอื่น",
    "เป็นผู้จัดเกม",
    "เล่นเครื่องเดียว / บันทึกเกม",
    "ฝึกเดี่ยว",
    "เกมกำหนดเอง",
  ]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "English" }).click();
});

test("statistics stay one tap from Me at #/profile", async ({ page }) => {
  await page.goto("/#/me");
  await page.getByRole("link", { name: /Game statistics/ }).click();
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.locator(".eq-app-shell main")).toBeVisible();
});
