import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Home on every layout (desktop, Pixel 7, 320 px compact). The layout checks
// mount the real Home view with fixed games and bots (tests/e2e/harness): the
// local e2e server has no Supabase, so it lists no remote rooms, Ranked or bots.

const harness = (scenario: string, lang = "en") =>
  `/tests/e2e/harness/arena-home.html?scenario=${scenario}&lang=${lang}`;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      width,
      overflow: document.documentElement.scrollWidth - width,
      rows: [...document.querySelectorAll<HTMLElement>(".eq-home-row, .eq-home-links a")].map(
        (row) => {
          const box = row.getBoundingClientRect();
          return { text: row.textContent, left: box.left, right: box.right, height: box.height };
        },
      ),
    };
  });
}

async function expectFits(page: Page) {
  const { width, overflow, rows } = await geometry(page);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.height, row.text ?? "").toBeGreaterThanOrEqual(44);
    expect(row.left, row.text ?? "").toBeGreaterThanOrEqual(0);
    expect(row.right, row.text ?? "").toBeLessThanOrEqual(width + 1);
  }
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page })
    .include("main")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
}

test("puts your games first, then live games, then ways to play, and fits the screen", async ({
  page,
}) => {
  await page.goto(harness("busy"));
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.locator("main h2")).toHaveText(["Continue", "Live now", "Play", "Improve"]);

  const continuing = page.getByRole("region", { name: "Continue" });
  await expect(continuing.getByRole("link", { name: /Ranked match/ })).toHaveAttribute(
    "href",
    "#/ranked/ranked-1",
  );
  await expect(continuing.getByRole("button")).toHaveCount(2);

  const live = page.getByRole("region", { name: "Live now" });
  await expect(live.getByRole("link", { name: /2 Ranked rooms waiting/ })).toHaveAttribute(
    "href",
    "#/ranked",
  );
  await expect(live.getByRole("button")).toHaveCount(2);

  const bots = page.getByRole("region", { name: "Play against AI" });
  await expect(bots.getByRole("link", { name: /Play Authur/ })).toHaveAttribute(
    "href",
    "#/create?mode=bot&from=home",
  );
  await expect(bots.getByText("EQ Pro", { exact: true })).toBeVisible();
  const archbot = bots.getByRole("link", { name: /Play ArchBot/ });
  await expect(archbot).toHaveAttribute("href", "#/create?mode=archbot&from=home");
  await expect(archbot).toContainText("Free");
  await expect(archbot).toContainText("Plays on your device");

  await expectFits(page);
  await expectAccessible(page);
});

test("works from the keyboard with a visible focus ring", async ({ page }) => {
  await page.goto(harness("busy"));
  const first = page.getByRole("region", { name: "Continue" }).getByRole("link").first();
  await expect(first).toBeVisible();
  for (
    let step = 0;
    step < 20 && !(await first.evaluate((el) => el === document.activeElement));
    step += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(first).toBeFocused();
  expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");

  // The next stop is your own game, a real button: Enter opens it.
  await page.keyboard.press("Tab");
  const game = page.getByRole("region", { name: "Continue" }).getByRole("button").first();
  await expect(game).toBeFocused();
  expect(await game.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.harness.continued))
    .toEqual(["Evening match with a rather long name that has to wrap on a phone"]);
});

test("with nothing to continue, it says so and still offers every way to play", async ({
  page,
}) => {
  await page.goto(harness("empty"));
  await expect(page.getByRole("region", { name: "Continue" })).toHaveCount(0);
  await expect(page.getByText("No open games right now. Start one below.")).toBeVisible();
  const play = page.getByRole("region", { name: "Play" });
  for (const name of [/^Ranked/, /^Stage/, /^Create a game/, /^Join with a code/]) {
    await expect(play.getByRole("link", { name })).toBeVisible();
  }
  // Authur switched off for new games: shown, truthfully, and not a link.
  const bots = page.getByRole("region", { name: "Play against AI" });
  await expect(bots.getByRole("link")).toHaveCount(0);
  await expect(bots.getByText("Not available right now")).toBeVisible();
  await expectFits(page);
  await expectAccessible(page);
});

test("loading and error states are announced", async ({ page }) => {
  await page.goto(harness("loading"));
  await expect(page.getByRole("status").filter({ hasText: "Loading your games…" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Loading AI opponents…" })).toBeVisible();
  await expectAccessible(page);

  await page.goto(harness("error"));
  await expect(
    page.getByRole("alert").filter({ hasText: "Your games couldn't be loaded." }),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Try again" });
  await expect(retry).toHaveCount(2);
  for (const button of await retry.all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await expectFits(page);
  await expectAccessible(page);
});

test("fits a 390 px phone in both languages", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "One run at 390 px; the projects cover 412 and 320.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  for (const lang of ["en", "th"]) {
    await page.goto(harness("busy", lang));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectFits(page);
  }
});

test("reads in Thai without overflowing", async ({ page }) => {
  await page.goto(harness("busy", "th"));
  await expect(page.getByRole("heading", { level: 1, name: "หน้าหลัก" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "เล่นกับ AI" })).toBeVisible();
  await expect(page.getByRole("link", { name: /เล่นกับ Authur/ })).toBeVisible();
  await expectFits(page);
});

test("the app's Home lists a game on this device and opens it", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "The route and open path are layout-independent; the layouts are covered above.",
  );
  await page.goto("/#/");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Continue" })).toHaveCount(0);

  await page.goto("/#/create?mode=custom");
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.locator('[data-choice-value="pass_play"]').click();
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.locator('[data-choice-value="play"]').click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: /^Start Lab$/ }).click();
  await expect(page).toHaveURL(/#\/play\//);
  const played = new URL(page.url()).hash.match(/^#\/play\/([^?]+)/)![1];

  await page.goto("/#/");
  const game = page.getByRole("region", { name: "Continue" }).getByRole("button").first();
  await expect(game).toBeVisible();
  await game.click();
  await expect(page).toHaveURL(new RegExp(`#/(play|room)/${played}`));
});
