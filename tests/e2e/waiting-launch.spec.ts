import { expect, test } from "@playwright/test";

test("Start Lab counts down before the game opens", async ({ page }) => {
  await page.goto("/#/public");
  await page.getByRole("link", { name: /New game/ }).click();
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();

  await expect(page.getByText("LAB STAGING")).toBeVisible();
  await expect(page.getByRole("button", { name: "Mute launch sounds" })).toBeVisible();
  await page.getByRole("button", { name: "Mute launch sounds" }).click();
  await expect(page.getByRole("button", { name: "Enable launch sounds" })).toBeVisible();
  await page.getByRole("button", { name: "Start Lab" }).click();

  await expect(page.locator(".lab-launch")).toBeVisible();
  await expect(page.locator(".lab-launch")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.locator(".lab-launch").getByRole("button", { name: "Enable launch sounds" }),
  ).toBeFocused();
  await expect(page.getByRole("heading", { name: "Lab starts in" })).toBeVisible();
  await expect(page).toHaveURL(/#\/room\//);
  await expect(
    page.locator(".lab-launch").getByRole("button", { name: "Enable launch sounds" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/play\//, { timeout: 10_000 });
});
