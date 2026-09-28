import { expect, test } from "@playwright/test";

// Every platform destination at its own address; the old addresses still work.
test("serves each platform address, and keeps the old ones", async ({ page }) => {
  const nav = page.getByRole("navigation", { name: "Primary navigation" });

  await page.goto("/#/");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(new URL(page.url()).hash).toBe("#/");

  await page.goto("/#/home");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  await page.goto("/#/public");
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();

  await page.goto("/#/learn");
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();

  await page.goto("/#/study");
  await expect(page.getByRole("heading", { level: 1, name: "Study" })).toBeVisible();

  await page.goto("/#/me");
  await expect(page.getByRole("heading", { level: 1, name: "Me" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Me", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.goto("/#/stage");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();

  await page.goto("/#/survival");
  await expect(page.getByRole("heading", { level: 1, name: "Stage" })).toBeVisible();

  // The live-games lobby is still there, and is not mistaken for Home.
  await page.goto("/#/region");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
});

test("every layout offers the same five destinations", async ({ page }) => {
  await page.goto("/#/");
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav).toBeVisible();
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(5);
  for (const [name, href] of [
    ["Home", "#/"],
    ["Learn", "#/learn"],
    ["Create game", "#/create"],
    ["Ranked", "#/ranked"],
    ["Me", "#/me"],
  ]) {
    await expect(nav.getByRole("link", { name, exact: true })).toHaveAttribute("href", href);
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
});

test("Me leads to both live-games lobbies and switches language", async ({ page }) => {
  await page.goto("/#/me");
  await page.getByRole("link", { name: /Public games/ }).click();
  await expect(page).toHaveURL(/#\/public$/);
  await page.goBack();
  await page.getByRole("button", { name: "ไทย" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ฉัน" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("navigation", { name: "เมนูหลัก" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Me" })).toBeVisible();
});

test("Back returns through the platform addresses", async ({ page }) => {
  await page.goto("/#/public");
  await page.goto("/#/learn");
  await page.goto("/#/me");
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Learn" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
});
