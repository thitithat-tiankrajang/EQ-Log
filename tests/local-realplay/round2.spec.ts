import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createManualPlayers } from "../../tools/phase-a/local-accounts.mjs";
import { available, env, observe } from "../live-security-browser/fixtures";

/**
 * Phone review round 2 on the REAL secured app, through the physical-phone
 * LAN origin (node tools/phase-a/local.mjs phone): genuine local password
 * Auth, a real game created/joined in the UI, authoritative turns over Edge
 * Functions and Realtime. Two touch phones (390×844) exercise the new
 * interaction model, the draggable sheet, the Turn Log and Notes focus while
 * real live updates arrive. Every request is audited for loopback addresses
 * and every live-game response for hidden-information keys.
 */
const base = process.env.LAN_BASE_URL;
test.skip(!available || !base, "Disposable stack and LAN_BASE_URL (phone mode) required");
const OUT = process.env.ROUND2_EVIDENCE ?? "test-results/round2-real";
const PHONE = { width: 390, height: 844 };

async function tap(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
async function touchDrag(page: Page, from: { x: number; y: number }, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  for (let step = 1; step <= 14; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * step) / 14 }],
    });
    await page.waitForTimeout(50);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const cell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });
const slot = (page: Page, index: number) => page.locator(".lg-rack-tile").nth(index);

test("round 2 on a phone: real secured game, interaction model, sheet, Turn Log, Notes", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  const origin = new URL(base!).origin;
  const password = `Disposable-${randomUUID()}!`;
  const [a, b] = await createManualPlayers(password, env);
  const phone = { viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };
  const ca = await browser.newContext(phone),
    cb = await browser.newContext(phone);
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  const urls: string[] = [];
  for (const page of [pa, pb]) {
    page.on("request", (request) => urls.push(request.url()));
    page.on("websocket", (socket) => urls.push(socket.url()));
  }
  const oa = observe(pa),
    ob = observe(pb);
  const log: string[] = [];
  async function login(page: Page, email: string) {
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
    await page.getByLabel("Local email").fill(email);
    await page.getByLabel("Local password").fill(password);
    await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  }
  try {
    await login(pa, a.email);
    await login(pb, b.email);
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
    log.push("LAN origin: genuine sign-in, UI create/join/ready/launch");

    // HUD: the margin once, on my own row.
    const hud = pa.getByRole("region", { name: "Score" });
    await expect(hud.locator(".lg-sb-diff.is-mine")).toHaveCount(1);
    await expect(hud.locator(".lg-sb-diff.is-mine")).toHaveText("±0");
    await pa.screenshot({ path: `${OUT}/real-01-phone-live.png` });

    // Select → place, select → move, select → a chosen empty slot.
    const before = await pa
      .locator(".lg-rack-tile")
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-tile-id")));
    // The deal is random: use plain tiles here (an alternative tile opens its
    // value picker when placed, and the next tap only closes the picker).
    const plain = (
      await pa
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label") ?? ""))
    )
      .map((label, index) => (/not chosen/.test(label) ? -1 : index))
      .filter((index) => index >= 0);
    expect(plain.length).toBeGreaterThanOrEqual(3);
    const [first, second, third] = plain;
    await tap(pa, slot(pa, first));
    await expect(slot(pa, first)).toHaveClass(/is-selected/);
    await tap(pa, cell(pa, "H8"));
    await expect(cell(pa, "H8")).toHaveAccessibleName(/your tentative tile/);
    await expect(slot(pa, first)).toHaveClass(/is-empty/);
    await tap(pa, cell(pa, "H8"));
    await tap(pa, cell(pa, "H10"));
    await expect(cell(pa, "H10")).toHaveAccessibleName(/your tentative tile/);
    await tap(pa, slot(pa, second));
    await tap(pa, cell(pa, "J8"));
    await tap(pa, cell(pa, "H10"));
    await expect(slot(pa, second)).toHaveClass(/is-target/);
    await pa.screenshot({ path: `${OUT}/real-02-holding-board-tile.png` });
    await tap(pa, slot(pa, second));
    await expect(cell(pa, "H10")).toHaveAccessibleName(/empty/);
    const after = await pa
      .locator(".lg-rack-tile")
      .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-tile-id")));
    // The returned tile sits in the slot chosen for it; its old slot is now the
    // (empty) home of the tile still on J8. Nothing duplicated or lost.
    expect(after[second]).toBe(before[first]);
    expect(after[first]).toBeNull();
    log.push("select → place, board → board, board → a chosen empty slot (tile identity kept)");
    // Arrow: RIGHT, escape after placement, DOWN, OFF.
    await pa.getByRole("button", { name: "Recall", exact: true }).tap();
    await tap(pa, cell(pa, "G8"));
    await expect(cell(pa, "G8")).toHaveClass(/dir-right/);
    await tap(pa, slot(pa, third));
    await expect(cell(pa, "H8")).toHaveClass(/dir-right/);
    await tap(pa, cell(pa, "H8"));
    await expect(cell(pa, "H8")).toHaveClass(/dir-down/);
    await pa.screenshot({ path: `${OUT}/real-03-arrow.png` });
    await tap(pa, cell(pa, "H8"));
    await expect(pa.locator(".lg-cell.is-cursor")).toHaveCount(0);
    await pa.getByRole("button", { name: "Recall", exact: true }).tap();
    log.push("arrow RIGHT → escapes the placed tile → DOWN → OFF");

    // Real turns: A exchanges (touch drag-across preserved), B passes, A passes, B passes.
    await pa.getByRole("button", { name: "Exchange", exact: true }).tap();
    const t0 = (await slot(pa, 0).boundingBox())!;
    const t2 = (await slot(pa, 2).boundingBox())!;
    const cdp = await ca.newCDPSession(pa);
    const y = t0.y + t0.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: t0.x + t0.width / 2, y }],
    });
    for (let step = 1; step <= 10; step += 1)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: t0.x + t0.width / 2 + ((t2.x - t0.x) * step) / 10, y }],
      });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await expect(pa.locator('.lg-rack-tile[aria-pressed="true"]')).toHaveCount(3);
    await pa.getByRole("button", { name: "Exchange 3 tiles", exact: true }).tap();
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    await pb.getByRole("button", { name: "Pass", exact: true }).tap();
    await pb.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    await pa.getByRole("button", { name: "Pass", exact: true }).tap();
    await pa.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    log.push("real turns: touch Exchange 3, Pass, Pass");

    // Notes on A while B's real Pass arrives over Realtime: focus is never ejected.
    await pa.getByRole("button", { name: "Record, bag, notes and tools" }).tap();
    const sheetA = pa.getByRole("dialog", { name: "Game" });
    await sheetA.getByRole("tab", { name: "Notes" }).tap();
    const notes = sheetA.locator(".lg-notes textarea");
    await notes.tap();
    await expect(notes).toBeFocused();
    await pa.keyboard.type("bag: 2 blanks");
    await pb.getByRole("button", { name: "Pass", exact: true }).tap();
    await pb.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await expect(pa.locator('.lg-shell[data-turn="active"]')).toHaveCount(1, { timeout: 20_000 });
    for (let tick = 0; tick < 3; tick += 1) {
      await pa.waitForTimeout(700);
      await expect(notes).toBeFocused();
    }
    await pa.keyboard.type(" left");
    await expect(notes).toHaveValue("bag: 2 blanks left");
    await pa.screenshot({ path: `${OUT}/real-04-notes-focused.png` });
    log.push("Notes kept focus through clock ticks and a real Realtime turn change");

    // Turn Log: reading keeps the board live; peek; View position → review.
    await sheetA.getByRole("tab", { name: "Record" }).tap();
    await expect(sheetA.locator(".lg-tl-entry")).toHaveCount(4);
    await expect(pa.locator(".lg-board-wrap.is-review")).toHaveCount(0);
    const grab = (await pa.locator(".lg-sheet-grab").boundingBox())!;
    await touchDrag(pa, { x: grab.x + grab.width / 2, y: grab.y + 10 }, 180);
    await expect(sheetA).toHaveAttribute("data-snap", "peek");
    await pa.waitForTimeout(400);
    const board = (await pa.locator(".lg-board-wrap").boundingBox())!;
    expect((await sheetA.boundingBox())!.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
    await pa.screenshot({ path: `${OUT}/real-05-sheet-peek.png` });
    await sheetA.getByRole("button", { name: "View position, turn 1" }).tap();
    await expect(pa.locator(".lg-board-wrap.is-review")).toHaveCount(1);
    await pa.screenshot({ path: `${OUT}/real-06-view-position.png` });
    await sheetA
      .getByRole("button", { name: /back to live/i })
      .first()
      .tap();
    await expect(pa.locator(".lg-board-wrap.is-review")).toHaveCount(0);
    log.push("Turn Log opened without review; sheet peek; explicit View position → review");

    // Security audits.
    const loopback = urls.filter((url) =>
      /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]|:54521\b/.test(url),
    );
    expect(loopback).toEqual([]);
    await Promise.all([oa.flush(), ob.flush()]);
    for (const seen of [oa, ob])
      expect(JSON.stringify(seen.responses)).not.toMatch(
        /"(?:tilebag|canonical|history|rngStep|rngSeed|hostRacks)"\s*:/,
      );
    log.push("no loopback request from the phone origin; no hidden-information keys");
    writeFileSync(
      `${OUT}/real-verification.json`,
      JSON.stringify({ origin, backend: env.API_URL, phone: PHONE, steps: log }, null, 2) + "\n",
    );
  } finally {
    await ca.close();
    await cb.close();
  }
});
