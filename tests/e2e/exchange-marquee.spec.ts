import { expect, test } from "@playwright/test";

test("dragging across the rack selects exactly those exchange tiles", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The desktop rack is used for this pointer test.");

  await page.goto("/#/public");
  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/#/create");
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.locator('[data-choice-value="pass_play"]').click();
  await page.evaluate(() =>
    document.querySelectorAll("details").forEach((details) => (details.open = true)),
  );
  await page.locator('[data-choice-value="play"]').click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: /^Start Lab$/ }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.locator(".topbar-status")).toContainText("พร้อมเล่น", { timeout: 20_000 });

  await page.locator(".action-buttons button").first().click();
  await expect(page.locator(".topbar-status")).toContainText("เลือกเบี้ยแลก");
  const tiles = page.locator("section.rack.active button.rack-tile");
  await expect(tiles).toHaveCount(8);
  const first = (await tiles.nth(0).boundingBox())!;
  const third = (await tiles.nth(2).boundingBox())!;
  await page.mouse.move(first.x + 3, first.y + 3);
  await page.mouse.down();
  await page.mouse.move(third.x + third.width - 3, third.y + third.height - 3, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator("section.rack.active button.rack-tile.outgoing")).toHaveCount(3);
  await tiles.nth(1).click();
  await expect(page.locator("section.rack.active button.rack-tile.outgoing")).toHaveCount(2);
});
