import { expect, test } from "@playwright/test";

test("browser Back from a newly started game returns to its lobby", async ({ page }) => {
  await page.goto("/#/public");
  await page.getByRole("link", { name: /New game/ }).click();
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//);

  await page.goBack();
  await expect(page).toHaveURL(/#\/public$/);
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
});

test("the Create page Back button returns to Region when opened from Region", async ({ page }) => {
  await page.goto("/#/region");
  await page.getByRole("link", { name: "Create game" }).click();
  await expect(page).toHaveURL(/#\/create\?space=region$/);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/#\/region$/);
});

test("the Create page Back button returns to Private when opened from Private", async ({
  page,
}) => {
  await page.goto("/#/private");
  await page.getByRole("link", { name: "Create game" }).click();
  await expect(page).toHaveURL(/#\/create\?from=private$/);

  await page.getByRole("button", { name: "Back" }).click();
  await expect(page).toHaveURL(/#\/private$/);
});

test("taking a break from a Private game returns to the private library", async ({
  page,
}, testInfo) => {
  await page.goto("/#/private");
  await page.getByRole("link", { name: "Create game" }).click();
  await page.getByRole("button", { name: /^Private/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  if (testInfo.project.name !== "desktop") {
    await page
      .getByRole("dialog", { name: "Pick tiles from the bag" })
      .getByRole("button", { name: /Close for now/ })
      .click();
  }

  await page.getByRole("button", { name: "Break" }).click();
  await expect(page).toHaveURL(/#\/private$/);
});
