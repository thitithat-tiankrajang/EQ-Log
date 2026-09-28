import { expect, test, type Page } from "@playwright/test";

// Runs in every project (desktop, Pixel 7 and 320 px compact): Learn and the
// way into Stage must be the same however narrow the screen.

function primaryNavigation(page: Page) {
  return page.getByRole("navigation", { name: "Primary navigation" });
}

function currentTabs(page: Page) {
  return primaryNavigation(page).locator('a[aria-current="page"]');
}

test.beforeEach(async ({ page }) => {
  await page.goto("/#/public");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("Learn is its own page, with Study, finished games and a way into Stage", async ({ page }) => {
  await primaryNavigation(page).getByRole("link", { name: "Learn" }).click();
  await expect(page).toHaveURL(/#\/learn$/);
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
  await expect(currentTabs(page)).toHaveText(["Learn"]);

  const main = page.getByRole("main");
  await expect(main.locator(".eq-learn-link strong")).toHaveText([
    "Study a position",
    "Public game history",
    "Your saved games",
    "Stage",
  ]);
  await expect(main).not.toContainText(/Training|Survival|EXP/);

  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rowHeights: [...document.querySelectorAll(".eq-learn-link")].map(
      (row) => row.getBoundingClientRect().height,
    ),
  }));
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  for (const height of geometry.rowHeights) expect(height).toBeGreaterThanOrEqual(44);

  await main.getByRole("link", { name: /Study a position/ }).click();
  await expect(page).toHaveURL(/#\/study$/);
  await expect(page.getByRole("heading", { level: 1, name: "Study" })).toBeVisible();
  // Study belongs to Learn.
  await expect(currentTabs(page)).toHaveText(["Learn"]);

  await page.goBack();
  await main.getByRole("link", { name: /^Stage/ }).click();
  await expect(page).toHaveURL(/#\/stage$/);
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
  // Stage is an Arena activity: reaching it from Learn does not make it Learn.
  await expect(currentTabs(page)).toHaveCount(0);
});

test("Stage keeps its old address and is never called Survival", async ({ page }) => {
  for (const hash of ["#/stage", "#/survival"]) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();
    await expect(currentTabs(page)).toHaveCount(0);
    await expect(page.locator(".eq-page-header")).not.toContainText(/Survival|MVP/);
  }
  // Stage is not something to create.
  await primaryNavigation(page).getByRole("link", { name: "Create game" }).click();
  await expect(page.getByRole("dialog", { name: "Create a game" })).not.toContainText(/Stage/);
});

test("Learn works from the keyboard", async ({ page }) => {
  await page.goto("/#/learn");
  const study = page.getByRole("main").getByRole("link", { name: /Study a position/ });
  await study.focus();
  await expect(study).toBeFocused();
  const outline = await study.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/study$/);
});

test("Learn and Stage speak Thai when the player chose Thai", async ({ page }) => {
  await page.goto("/#/me");
  await page.getByRole("button", { name: "ไทย" }).click();
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "เรียนรู้" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "เรียนรู้" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("main").getByRole("link", { name: /^สเตจ/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "สเตจ" })).toBeVisible();
  await page.goto("/#/me");
  await page.getByRole("button", { name: "English" }).click();
});
