import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/#/public/rooms");
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
});

test("opens a match from the lobby's game entry point", async ({ page }) => {
  await expect(page.getByRole("heading", { level: 1, name: "Public" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Start a game" })).toBeVisible();
  await page.getByRole("link", { name: /New game/ }).click();
  await expect(page).toHaveURL(/#\/create$/);
  await expect(page.getByRole("heading", { level: 1, name: "Choose a space" })).toBeVisible();
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /Match/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Configure match" })).toBeVisible();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await expect(page).toHaveURL(/#\/room\//);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Player A vs Player B/i);
  const action = page.getByRole("button", { name: "Start Lab" });
  await expect(action).toBeVisible();
  const dockAndNav = await page.evaluate(() => {
    const dock = document.querySelector(".action-dock")?.getBoundingClientRect();
    const nav = document.querySelector(".eq-primary-nav")?.getBoundingClientRect();
    return {
      dockBottom: dock?.bottom ?? 0,
      navTop: nav?.top ?? 0,
      navFixed: getComputedStyle(document.querySelector(".eq-primary-nav")!).position === "fixed",
    };
  });
  if (dockAndNav.navFixed) {
    expect(dockAndNav.dockBottom).toBeLessThanOrEqual(dockAndNav.navTop);
  }
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
  test.setTimeout(90_000);
  for (const hash of [
    "#/public",
    "#/public/history",
    "#/create",
    "#/private",
    "#/profile",
    "#/public/join",
    "#/private?view=trash",
    "#/study",
    "#/admin/users",
    "#/admin/regions",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.locator(".eq-app-shell main")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations, hash).toEqual([]);
  }

  await page.goto("/#/create");
  await page.getByRole("button", { name: /Public/ }).click();
  // New bot rooms are Authur's; Aether rooms are refused by the database.
  await page.getByRole("button", { name: /^Authur/ }).click();
  const botResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(botResults.violations, "Authur setup").toEqual([]);

  await page.goto("/#/public");
  await page.goto("/#/create");
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  const waitingResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(waitingResults.violations, "Waiting room").toEqual([]);
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

test("loads the designed bot setup form instead of browser-default controls", async ({ page }) => {
  await page.getByRole("link", { name: "Create game" }).click();
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /^Authur/ }).click();

  const section = page.locator(".bot-config-section").first();
  const option = page.getByRole("radio", { name: /^You/ });
  await expect(section).toBeVisible();
  await expect(option).toBeVisible();

  const styles = await page.evaluate(() => {
    const sectionStyle = getComputedStyle(document.querySelector(".bot-config-section")!);
    const optionStyle = getComputedStyle(document.querySelector(".bot-difficulty-option")!);
    return {
      botRuleLoaded: [...document.styleSheets].some((sheet) =>
        [...sheet.cssRules].some((rule) => rule.cssText.includes(".bot-config-section")),
      ),
      visualVariant: document.querySelector(".eq-flow-page")?.getAttribute("data-visual"),
      sectionDisplay: sectionStyle.display,
      sectionGap: sectionStyle.gap,
      sectionRadius: sectionStyle.borderRadius,
      optionDisplay: optionStyle.display,
      optionRadius: optionStyle.borderRadius,
    };
  });
  expect(styles).toMatchObject({
    botRuleLoaded: true,
    visualVariant: "glass",
    sectionDisplay: "grid",
    sectionGap: "14px",
    sectionRadius: "14px",
    optionDisplay: "flex",
    optionRadius: "12px",
  });
});

test("renders the custom dropdown instead of a native select", async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/#/private");
  const dropdown = page.getByRole("combobox", { name: "Sort private files" });
  await expect(dropdown).toBeVisible();

  const styles = await dropdown.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      tagName: element.tagName,
      display: style.display,
      minHeight: style.minHeight,
      borderRadius: style.borderRadius,
    };
  });
  expect(styles).toMatchObject({
    tagName: "BUTTON",
    display: "flex",
    minHeight: "40px",
    borderRadius: "10px",
  });
  await expect(page.locator("select")).toHaveCount(0);

  await dropdown.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await expect(page.getByRole("option", { name: "Recently updated" })).toBeVisible();
  const geometry = await Promise.all([dropdown.boundingBox(), listbox.boundingBox()]);
  expect(geometry[0]).not.toBeNull();
  expect(geometry[1]).not.toBeNull();
  expect(Math.abs(geometry[1]!.x - geometry[0]!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometry[1]!.width - geometry[0]!.width)).toBeLessThanOrEqual(1);
  const popupStyles = await listbox.evaluate((element) => {
    const listboxStyle = getComputedStyle(element);
    const optionStyle = getComputedStyle(element.querySelector(".ui-select-option")!);
    const shellStyle = getComputedStyle(document.querySelector(".eq-app-shell")!);
    const bodyStyle = getComputedStyle(document.body);
    return {
      shellSurface: shellStyle.getPropertyValue("--eq-surface").trim(),
      bodySurface: bodyStyle.getPropertyValue("--eq-surface").trim(),
      listboxDisplay: listboxStyle.display,
      listboxRadius: listboxStyle.borderRadius,
      listboxBackground: listboxStyle.backgroundColor,
      optionDisplay: optionStyle.display,
      optionRadius: optionStyle.borderRadius,
      optionFont: optionStyle.fontFamily,
    };
  });
  expect(popupStyles).toMatchObject({
    shellSurface: "#ffffff",
    bodySurface: "#ffffff",
    listboxDisplay: "grid",
    listboxRadius: "12px",
    listboxBackground: "rgb(255, 255, 255)",
    optionDisplay: "flex",
    optionRadius: "8px",
  });
  expect(popupStyles.optionFont).not.toContain("Times New Roman");
  await page.getByRole("option", { name: "Name" }).click();
  await expect(dropdown).toContainText("Name");
  await expect(listbox).toBeHidden();
  expect(runtimeErrors).toEqual([]);
});

test("uses one focus ring around search and animates dialog exit", async ({ page }) => {
  await page.goto("/#/private");
  const search = page.getByPlaceholder("Search this folder");
  await search.focus();
  const focus = await search.evaluate((input) => ({
    input: getComputedStyle(input).outlineStyle,
    wrapper: getComputedStyle(input.parentElement!).outlineStyle,
  }));
  expect(focus).toEqual({ input: "none", wrapper: "solid" });

  await page.goto("/#/create");
  await page.getByRole("button", { name: /Public/ }).click();
  await page.getByRole("button", { name: /Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: /Edit/ }).click();
  const backdrop = page.locator(".ui-sheet-backdrop");
  await expect(backdrop).toHaveAttribute("data-state", "open");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(backdrop).toHaveAttribute("data-state", "closing");
  await expect(backdrop).toHaveCount(0);
});

test("shows the styled coffee return control outside Play and returns to the paused game", async ({
  page,
}, testInfo) => {
  await expect(page.getByRole("button", { name: /Return to paused game/i })).toHaveCount(0);
  await page.goto("/#/public");
  await page.getByRole("link", { name: /New game/ }).click();
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  const roomId = await page.evaluate(() =>
    decodeURIComponent(window.location.hash.match(/^#\/play\/([^?]+)/)?.[1] ?? ""),
  );
  expect(roomId).not.toBe("");
  if (testInfo.project.name !== "desktop") {
    await page
      .getByRole("dialog", { name: "Pick tiles from the bag" })
      .getByRole("button", { name: /Close for now/ })
      .click();
  }
  await page.getByRole("button", { name: "Break" }).click();
  await expect(page).toHaveURL(/#\/public$/);

  const returnButton = page.getByRole("button", { name: /Return to paused game/i });
  await expect(returnButton).toBeVisible();
  const styles = await returnButton.evaluate((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const navigationBounds = document.querySelector(".eq-primary-nav")?.getBoundingClientRect();
    return {
      position: style.position,
      display: style.display,
      borderRadius: style.borderRadius,
      minHeight: style.minHeight,
      rightGap: window.innerWidth - bounds.right,
      bottomGap: window.innerHeight - bounds.bottom,
      clearsNavigation: navigationBounds
        ? bounds.right <= navigationBounds.left ||
          bounds.left >= navigationBounds.right ||
          bounds.bottom <= navigationBounds.top ||
          bounds.top >= navigationBounds.bottom
        : true,
    };
  });
  expect(styles).toMatchObject({
    position: "fixed",
    display: "flex",
    clearsNavigation: true,
  });
  expect(Number.parseFloat(styles.borderRadius)).toBeGreaterThanOrEqual(12);
  expect(Number.parseFloat(styles.minHeight)).toBeGreaterThanOrEqual(44);
  expect(styles.rightGap).toBeGreaterThanOrEqual(12);
  expect(styles.rightGap).toBeLessThanOrEqual(32);
  expect(styles.bottomGap).toBeGreaterThanOrEqual(12);
  expect(styles.bottomGap).toBeLessThanOrEqual(120);

  for (const hash of ["#/private", "#/profile", "#/create", "#/region"]) {
    await page.goto(`/${hash}`);
    await expect(returnButton, hash).toBeVisible();
  }

  await returnButton.click();
  await expect(page).toHaveURL(new RegExp(`#\\/play\\/${roomId}\\?from=region$`));
  await expect(page.locator("body")).toHaveAttribute("data-route", "play");
  await expect(returnButton).toHaveCount(0);
});
