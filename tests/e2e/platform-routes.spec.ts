import { expect, test } from "@playwright/test";

// The platform destinations are routable before their own pages exist; each is
// served by the page it will replace, at its own address.
test("serves each platform address, and keeps the old ones", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Public" })).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).hash).toBe("#/");

  await page.goto("/#/home");
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();

  await page.goto("/#/learn");
  await expect(page.getByRole("heading", { level: 1, name: "Study" })).toBeVisible();

  await page.goto("/#/me");
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");

  await page.goto("/#/stage");
  const stageHeading = page.getByRole("heading", { level: 1 });
  await expect(stageHeading).toBeVisible();
  const stageTitle = await stageHeading.textContent();

  await page.goto("/#/survival");
  await expect(page.getByRole("heading", { level: 1, name: stageTitle ?? "" })).toBeVisible();

  await page.goto("/#/region");
  await expect(nav.getByRole("link", { name: "Region" })).toHaveAttribute("aria-current", "page");
});

test("Back returns through the platform addresses", async ({ page }) => {
  await page.goto("/#/public");
  await page.goto("/#/learn");
  await page.goto("/#/me");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Study" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
});
