import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/#/public/rooms");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("uses the center Play destination as the only create entry point", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create match/i })).toHaveCount(0);

  await page.getByRole("link", { name: "Create game" }).click();
  await expect(page).toHaveURL(/#\/create$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Where should this game live?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /Match/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Configure match" })).toBeVisible();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await expect(page).toHaveURL(/#\/room\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Player A vs Player B/i);
});

test("keeps Region inaccessible until an admin assigns the account", async ({ page }) => {
  await page.getByRole("link", { name: "Region" }).click();
  await expect(page).toHaveURL(/#\/region$/);
  await expect(page.getByRole("heading", { name: "Sign in to enter your region" })).toBeVisible();
  await expect(page.getByText(/Region games require an approved account/)).toBeVisible();
});

test("@a11y has no serious accessibility violations on the main non-Play routes", async ({
  page,
}) => {
  for (const hash of [
    "#/public",
    "#/public/history",
    "#/create",
    "#/private",
    "#/profile",
    "#/public/join",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, hash).toEqual([]);
  }
});

test("does not overflow the viewport horizontally", async ({ page }) => {
  for (const hash of [
    "#/public",
    "#/public/history",
    "#/create",
    "#/private",
    "#/profile",
    "#/region",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.locator("main")).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(dimensions.content, hash).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
});

test("keeps every action in a game-table row the same height", async ({ page }) => {
  await page.getByRole("link", { name: "Create game" }).click();
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await expect(page).toHaveURL(/#\/room\//);

  await page.goto("/#/public");
  const actions = page
    .locator(".eq-game-table-actions")
    .first()
    .locator(":scope > button, :scope > a");
  await expect(actions).toHaveCount(2);
  const heights = await actions.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  );
  const styles = await actions.evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item);
      return {
        className: item.className,
        height: style.height,
        minHeight: style.minHeight,
        paddingBlock: `${style.paddingTop} ${style.paddingBottom}`,
        matchesRowRule: item.matches(".eq-game-table-actions > .overflow-menu-trigger"),
        parentClassName: item.parentElement?.className,
      };
    }),
  );

  expect(Math.max(...heights) - Math.min(...heights), JSON.stringify(styles)).toBeLessThanOrEqual(
    0.5,
  );
});
