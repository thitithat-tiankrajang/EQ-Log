import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createManualPlayers } from "../../tools/phase-a/local-accounts.mjs";
import { available, env, observe } from "../live-security-browser/fixtures";

/**
 * Product-owner UX review on the REAL local app: genuine local Supabase Auth,
 * two real users, a real secured game, the real LiveGameShell — on a phone.
 * Racks come from the server's authoritative deal, so the test exchanges (a
 * real turn, selected with a touch drag across the rack) until Player A holds
 * an alternative tile, then exercises the direct value picker on it.
 */
test.skip(!available, "Existing disposable Milestone-S stack required");
const evidence = "docs/evidence/po-ux-review";
const PHONE = { width: 390, height: 844 };
const ALTERNATIVE = /tile, sign not chosen|blank, value not chosen/;

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await page.getByLabel("Local email").fill(email);
  await page.getByLabel("Local password").fill(password);
  await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

async function touchAcross(page: Page, from: number, to: number) {
  const tiles = page.locator(".lg-rack-tile");
  const a = (await tiles.nth(from).boundingBox())!;
  const b = (await tiles.nth(to).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = a.y + a.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: a.x + a.width / 2, y }],
  });
  for (let step = 1; step <= 12; step += 1)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: a.x + a.width / 2 + ((b.x - a.x) * step) / 12, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

const rackLabels = (page: Page) =>
  page
    .locator(".lg-rack-tile")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label") ?? ""));

test("real secured game on a phone: HUD, Unseen, touch Exchange drag-across, direct alternative choice", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  mkdirSync(evidence, { recursive: true });
  const password = `Disposable-${randomUUID()}!`;
  const [a, b] = await createManualPlayers(password, env);
  const phone = { viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
  const ca = await browser.newContext(phone),
    cb = await browser.newContext(phone);
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  const oa = observe(pa),
    ob = observe(pb);
  const log: string[] = [];
  try {
    await login(pa, a.email, password);
    await login(pb, b.email, password);
    await pa.getByRole("link", { name: "Create game", exact: true }).click();
    await pa.locator('[data-choice="match"] a').click();
    await pa.getByRole("combobox", { name: "Opponent username", exact: true }).click();
    await pa.getByRole("option", { name: b.name, exact: true }).click();
    await pa.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    const gameURL = pa.url();
    await pb.getByRole("link", { name: "Create game", exact: true }).click();
    await pb.getByRole("link", { name: "Have a code? Join a game", exact: true }).click();
    await pb.getByLabel("Room code or link").fill(gameURL);
    await pb.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(pb.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    await pa.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pb.getByText("A ready · B not ready", { exact: true })).toBeVisible();
    await pb.getByRole("button", { name: "Ready", exact: true }).click();
    await pa.getByRole("button", { name: "Launch game", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    log.push("real login, UI create/join, ready, launch");

    // HUD: both players, scores, clocks; turn on A. Unseen visible without opening anything.
    const hud = pa.getByRole("region", { name: "Score" });
    await expect(hud.getByRole("group")).toHaveCount(2);
    await expect(hud.getByRole("group").first()).toHaveAttribute("data-to-move", "true");
    await expect(pa.getByRole("button", { name: /tiles unseen/ })).toBeVisible();
    await expect(pb.locator('.lg-shell[data-turn="thinking"]')).toBeVisible();
    await pa.screenshot({ path: `${evidence}/real-01-phone-active.png` });
    await pb.screenshot({ path: `${evidence}/real-02-phone-thinking.png` });

    // Real Exchanges, selected by touch drag-across, until A holds an alternative tile.
    let exchanges = 0;
    // Always at least one real Exchange (the drag-across check), then more until
    // the authoritative deal gives A an alternative tile.
    while (
      (exchanges === 0 || !(await rackLabels(pa)).some((label) => ALTERNATIVE.test(label))) &&
      exchanges < 7
    ) {
      await pa.getByRole("button", { name: "Exchange", exact: true }).tap();
      await touchAcross(pa, 0, 3);
      await expect(pa.locator('.lg-rack-tile[aria-pressed="true"]')).toHaveCount(4);
      if (exchanges === 0)
        await pa.screenshot({ path: `${evidence}/real-03-phone-exchange-drag.png` });
      await pa.getByRole("button", { name: "Exchange 4 tiles", exact: true }).tap();
      await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      await pb.getByRole("button", { name: "Pass", exact: true }).tap();
      await pb.getByRole("button", { name: "Confirm pass", exact: true }).tap();
      await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      exchanges += 1;
    }
    log.push(`${exchanges} real touch drag-across Exchange(s) of 4, each answered by a real Pass`);
    await expect(pa.getByRole("button", { name: /Last move, turn \d+: .*Passed/ })).toBeVisible();

    const labels = await rackLabels(pa);
    const index = labels.findIndex((label) => ALTERNATIVE.test(label));
    expect(
      index,
      `no alternative tile after ${exchanges} exchanges: ${labels.join(" | ")}`,
    ).toBeGreaterThanOrEqual(0);
    const blank = /blank/.test(labels[index]);
    await pa.locator(".lg-rack-tile").nth(index).tap();
    await pa.getByRole("button", { name: /^H8,/ }).tap();
    const picker = pa.getByRole("dialog", {
      name: blank ? "Blank: choose its value" : "Choose the sign",
    });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole("button", { name: /^Play as / })).toHaveCount(blank ? 26 : 2);
    await pa.screenshot({ path: `${evidence}/real-04-phone-alternative-chooser.png` });
    const option = picker.getByRole("button", { name: /^Play as / }).last();
    const optionName = (await option.getAttribute("aria-label"))!;
    await option.tap();
    await expect(picker).toHaveCount(0);
    await expect(pa.getByRole("button", { name: /^H8,/ })).toHaveAccessibleName(
      blank ? /blank played as/ : /chosen from/,
    );
    log.push(`real ${blank ? "blank" : "sign"} tile: one tap on "${optionName}"`);
    await pa.screenshot({ path: `${evidence}/real-05-phone-tentative-chosen.png` });
    await pa.getByRole("button", { name: "Recall", exact: true }).tap();
    await expect(pa.locator(".lg-cell.is-tentative")).toHaveCount(0);

    // No hidden information in either browser's responses.
    await Promise.all([oa.flush(), ob.flush()]);
    for (const seen of [oa, ob])
      expect(JSON.stringify(seen.responses)).not.toMatch(
        /"(?:tilebag|canonical|history|rngStep|rngSeed|hostRacks)"\s*:/,
      );
    log.push("no forbidden keys in either recipient's responses");
    writeFileSync(
      `${evidence}/real-verification.json`,
      JSON.stringify(
        { base: "http://127.0.0.1:5192", backend: env.API_URL, phone: PHONE, steps: log },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await ca.close();
    await cb.close();
  }
});
