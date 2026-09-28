import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The Ranked stake confirmation on every layout (desktop, Pixel 7, 320 px
// compact), mounted with a scripted client by tests/e2e/harness: the local
// e2e server has no Supabase, so the Ranked page itself cannot be reached.

const harness = (scenario: string, lang = "en") =>
  `/tests/e2e/harness/ranked-confirmation.html?scenario=${scenario}&lang=${lang}`;

async function recorder(page: Page) {
  return page.evaluate(() => window.harness);
}

async function settled(page: Page) {
  await page
    .locator(".ui-sheet-backdrop")
    .evaluate((element) =>
      Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)),
    );
}

test("shows the server's stakes, fits the screen, and joins only when confirmed", async ({
  page,
}) => {
  await page.goto(harness("join"));
  const dialog = page.getByRole("dialog", { name: "Join Ranked match" });
  await expect(dialog.getByRole("status")).toHaveText("Checking the rating at stake…");
  await expect(dialog.getByText("Nokkaew Srisawat-Phongpanich")).toBeVisible();
  await expect(dialog.getByRole("listitem", { name: "Win: 1200 to 1219, +19" })).toBeVisible();
  await expect(dialog.getByRole("listitem", { name: "Draw: 1200 to 1203, +3" })).toBeVisible();
  await expect(dialog.getByRole("listitem", { name: "Loss: 1200 to 1188, −12" })).toBeVisible();
  await settled(page);

  const geometry = await page.evaluate(() => {
    const sheet = document.querySelector(".ui-sheet")!.getBoundingClientRect();
    return {
      width: document.documentElement.clientWidth,
      height: window.innerHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sheet: { left: sheet.left, right: sheet.right, bottom: sheet.bottom },
      buttons: [...document.querySelectorAll(".ranked-confirm-actions button")].map(
        (button) => button.getBoundingClientRect().height,
      ),
      rows: [...document.querySelectorAll(".ranked-stakes-outcomes li")].map((row) => {
        const box = row.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }),
    };
  });
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.sheet.left).toBeGreaterThanOrEqual(0);
  expect(geometry.sheet.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.sheet.bottom).toBeLessThanOrEqual(geometry.height + 1);
  for (const height of geometry.buttons) expect(height).toBeGreaterThanOrEqual(44);
  for (const row of geometry.rows) {
    expect(row.left).toBeGreaterThanOrEqual(geometry.sheet.left);
    expect(row.right).toBeLessThanOrEqual(geometry.sheet.right + 1);
  }

  const axe = await new AxeBuilder({ page })
    .include(".ui-sheet")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);

  expect((await recorder(page)).joins).toEqual([]);
  await dialog.getByRole("button", { name: "Join Ranked" }).click();
  await expect
    .poll(async () => (await recorder(page)).joined)
    .toBe("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc");
  expect((await recorder(page)).joins).toEqual(["rs1:first"]);
});

test("works from the keyboard: focus inside, Escape leaves without joining", async ({ page }) => {
  await page.goto(harness("join"));
  const dialog = page.getByRole("dialog", { name: "Join Ranked match" });
  await expect(dialog.getByRole("button", { name: "Join Ranked" })).toBeEnabled();
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await recorder(page)).closed).toBe(1);
  expect((await recorder(page)).joins).toEqual([]);

  // Tab reaches Join Ranked; Enter confirms it.
  await page.goto(harness("join"));
  const join = page.getByRole("dialog").getByRole("button", { name: "Join Ranked" });
  await expect(join).toBeEnabled();
  for (
    let step = 0;
    step < 6 && !(await join.evaluate((b) => b === document.activeElement));
    step += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(join).toBeFocused();
  expect(await join.evaluate((button) => getComputedStyle(button).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await recorder(page)).joins).toEqual(["rs1:first"]);
});

test("changed stakes are shown and need a second, explicit confirmation", async ({ page }) => {
  await page.goto(harness("stale"));
  const dialog = page.getByRole("dialog", { name: "Join Ranked match" });
  await dialog.getByRole("button", { name: "Join Ranked" }).click();
  await expect(
    dialog.getByText("The rating at stake has changed. Check the new numbers and confirm again."),
  ).toBeVisible();
  await expect(dialog.getByRole("listitem", { name: "Win: 1231 to 1247, +16" })).toBeVisible();
  await page.waitForTimeout(400);
  expect((await recorder(page)).joins).toEqual(["rs1:first"]);
  expect((await recorder(page)).joined).toBeNull();
  await dialog.getByRole("button", { name: "Join Ranked" }).click();
  await expect.poll(async () => (await recorder(page)).joins).toEqual(["rs1:first", "rs1:fresh"]);
  await expect.poll(async () => (await recorder(page)).joined).not.toBeNull();
});

test("the confirmation reads in Thai without overflowing", async ({ page }) => {
  await page.goto(harness("join", "th"));
  const dialog = page.getByRole("dialog", { name: "เข้าร่วมแมตช์จัดอันดับ" });
  await expect(
    dialog.getByRole("listitem", { name: "ชนะ: จาก 1200 เป็น 1219, +19" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "เข้าร่วมจัดอันดับ" })).toBeVisible();
  await expect(
    dialog.getByText("เกมจัดอันดับมีผลต่อเรตติ้งของคุณ", { exact: false }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("at Ready, the stakes come first and Ready confirms them", async ({ page }) => {
  await page.goto(harness("ready"));
  const section = page.getByRole("region", { name: "At stake for you" });
  const ready = section.getByRole("button", { name: "Ready — play for rating" });
  await expect(section.getByRole("status")).toBeVisible();
  await expect(ready).toBeDisabled();
  await expect(section.getByRole("listitem", { name: "Loss: 1200 to 1188, −12" })).toBeVisible();
  await expect(ready).toBeEnabled();
  expect((await ready.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await ready.click();
  expect((await recorder(page)).ready).toBe(1);
});
