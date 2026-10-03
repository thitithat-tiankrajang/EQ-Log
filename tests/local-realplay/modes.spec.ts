import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { provisionPro } from "../../tools/phase-a/local-accounts.mjs";
import { available, env, observe, sql } from "../live-security-browser/fixtures";
import {
  accounts,
  clocks,
  commit,
  exchange,
  exerciseAlternative,
  exerciseDraft,
  expectResult,
  launch,
  FORBIDDEN,
  openingMove,
  finishByNoScore,
  openScoring,
  pass,
  placeMove,
  placeTokens,
  rackIds,
  recordDraw,
  scores,
  shell,
  signedIn,
  smartExchange,
  surrender,
  waitForTurn,
} from "./modes-kit";

/**
 * Phase A.5 — every game mode playable in the approved LiveGameShell, on the
 * REAL secured local app (genuine local password Auth, Edge authority,
 * recipient projections, Realtime). One test per mode family; each drives the
 * full lifecycle through the UI and records what it proved.
 */
test.skip(!available, "Existing disposable Milestone-S stack required");
test.describe.configure({ mode: "serial" });
const OUT = process.env.MODES_EVIDENCE ?? "test-results/modes";
mkdirSync(OUT, { recursive: true });
const proof: Record<string, string[]> = {};
test.afterAll(() =>
  writeFileSync(`${OUT}/modes-verification.json`, JSON.stringify(proof, null, 2) + "\n"),
);

async function createOnlineMatch(page: Page, opponent: string, timer: "22" | "No timer") {
  await page.getByRole("link", { name: "Create game", exact: true }).click();
  await page.locator('[data-choice="match"] a').click();
  await page.getByRole("radio", { name: new RegExp(`^${timer}`) }).click();
  await page.getByRole("combobox", { name: "Opponent username", exact: true }).click();
  await page.getByRole("option", { name: opponent, exact: true }).click();
  await page.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
  return page.url();
}
async function join(page: Page, url: string) {
  await page.getByRole("link", { name: "Create game", exact: true }).click();
  await page.getByRole("link", { name: "Have a code? Join a game", exact: true }).click();
  await page.getByLabel("Room code or link").fill(url);
  await page.getByRole("button", { name: "Join room", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
}

test("Online Match (online_versus): clocked, full lifecycle to a real end", async ({ browser }) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.online_versus = []);
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password);
  const B = await signedIn(browser, b, password);
  const seen = [observe(A.page), observe(B.page)];
  try {
    const url = await createOnlineMatch(A.page, b.name, "22");
    await join(B.page, url);
    await A.page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(B.page.getByText("A ready · B not ready", { exact: true })).toBeVisible();
    await B.page.getByRole("button", { name: "Ready", exact: true }).click();
    await A.page.getByRole("button", { name: "Launch game", exact: true }).click();
    await waitForTurn(A.page);
    log.push("UI create (22 min) → join → ready → launch");

    // Clock: shown and running for the side to move.
    const first = await clocks(A.page);
    expect(first).toHaveLength(2);
    await A.page.waitForTimeout(2200);
    expect((await clocks(A.page))[0]).not.toBe(first[0]);
    log.push(`clock shown and running (${first.join(" / ")})`);

    await exerciseDraft(A.page);
    const alt = await exerciseAlternative(A.page);
    log.push(
      `draft model: place/move/return-to-slot/arrow/recall${alt ? " + alternative edit" : ""}`,
    );
    const { scorer, other, score, extra } = await openScoring(A.page, B.page);
    await waitForTurn(other);
    expect((await scores(other))[scorer === A.page ? 0 : 1]).toBe(score);
    log.push(
      `real Commit +${score}${extra ? ` after ${extra} real exchange(s)` : ""}; the other seat's projection updated over Realtime`,
    );
    await finishByNoScore(other, scorer);
    log.push("real touch Exchange 2, then Passes: six non-scoring turns");
    const resultA = await expectResult(A.page);
    const resultB = await expectResult(B.page);
    log.push(`6 non-scoring turns → Result on both: "${resultA}" / "${resultB}"`);
    // Replay of the completed game.
    await A.page.getByRole("button", { name: "Open Replay", exact: true }).click();
    await expect(A.page.locator(".lg-shell")).toHaveCount(0, { timeout: 20_000 });
    log.push("Open Replay → completed-game page");

    await Promise.all(seen.map((item) => item.flush()));
    for (const item of seen) expect(JSON.stringify(item.responses)).not.toMatch(FORBIDDEN);
    expect(JSON.stringify(seen[0].responses)).not.toMatch(/"hostRacks"\s*:\s*\{/);
    log.push("no hidden-information keys in either recipient's responses");
  } finally {
    await A.close();
    await B.close();
  }
});

test("Online Match untimed: no timer UI at all", async ({ browser }) => {
  test.setTimeout(180_000);
  const log: string[] = (proof.online_versus_untimed = []);
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password);
  const B = await signedIn(browser, b, password);
  try {
    const url = await createOnlineMatch(A.page, b.name, "No timer");
    await join(B.page, url);
    await A.page.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(B.page.getByText("A ready · B not ready", { exact: true })).toBeVisible();
    await B.page.getByRole("button", { name: "Ready", exact: true }).click();
    await A.page.getByRole("button", { name: "Launch game", exact: true }).click();
    await waitForTurn(A.page);
    await expect(A.page.locator(".lg-scoreboard.is-untimed")).toHaveCount(1);
    await expect(A.page.locator(".lg-sb-clock")).toHaveCount(0);
    await expect(B.page.locator(".lg-sb-clock")).toHaveCount(0);
    log.push("untimed: no clock element, no dash, on both seats");
  } finally {
    await A.close();
    await B.close();
  }
});

test("Pass & Play (local_versus, app draws): privacy handoff every turn, to a real end", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.local_versus = []);
  const { password, list } = await accounts(1);
  const P = await signedIn(browser, list[0], password);
  const page = P.page;
  try {
    await page.goto("/#/create?mode=passplay");
    await page.getByRole("radio", { name: /^No timer/ }).click();
    const names = page.getByRole("textbox", { name: "Name" });
    await names.nth(0).fill("Ann");
    await names.nth(1).fill("Ben");
    await page.locator("details.create-advanced summary").click();
    await page.getByRole("radio", { name: /^App draws/ }).click();
    await page.getByRole("button", { name: "Create match room" }).click();
    await page.getByRole("button", { name: "Launch game", exact: true }).click();
    log.push("UI create (untimed, app draws) → launch");

    const handoff = async (name: string) => {
      // Concealed: no rack tile, no board shell, only the handoff screen.
      await expect(page.getByRole("heading", { name: `Hand the device to ${name}` })).toBeVisible({
        timeout: 20_000,
      });
      await expect(page.locator(".lg-rack-tile")).toHaveCount(0);
      await expect(shell(page)).toHaveCount(0);
      await page.getByRole("button", { name: `${name} — confirm handoff` }).click();
      await waitForTurn(page);
    };
    await handoff("Ann");
    await exerciseDraft(page);
    // The first legal opening is played (a side without one exchanges, a real turn).
    let [current, waiting] = ["Ann", "Ben"];
    let rack = await rackIds(page);
    let move = openingMove(rack);
    for (let tries = 0; !move && tries < 4; tries += 1) {
      await smartExchange(page);
      [current, waiting] = [waiting, current];
      await handoff(current);
      rack = await rackIds(page);
      move = openingMove(rack);
    }
    expect(move, "no opening in five real turns").not.toBeNull();
    await placeMove(page, move!);
    await commit(page);
    // The outgoing rack disappears at once: never visible under the handoff.
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(0, { timeout: 5000 });
    await handoff(waiting);
    const nextRack = await rackIds(page);
    expect(nextRack.filter((id) => id && rack.includes(id))).toEqual([]);
    log.push(
      `${current} commits → concealed → explicit handoff → only ${waiting}'s rack (no shared ids)`,
    );

    // Back navigation and reload on the handoff screen cannot bring a rack back.
    await exchange(page, 2);
    await expect(page.getByRole("heading", { name: `Hand the device to ${current}` })).toBeVisible({
      timeout: 20_000,
    });
    await page.goBack();
    await page.goForward();
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(0);
    log.push("Back/forward on the handoff screen shows no rack");
    await page.reload();
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(0);
    log.push("reload on the handoff screen shows no rack (handoff required again)");

    for (const name of [current, waiting, current, waiting, current]) {
      await handoff(name);
      await pass(page);
    }
    const result = await expectResult(page);
    log.push(`6 non-scoring turns → Result "${result}"`);
  } finally {
    await P.close();
  }
});

test("Solo on this device (solo_practice): clocked, to the solo end", async ({ browser }) => {
  test.setTimeout(240_000);
  const log: string[] = (proof.solo_practice = []);
  const { password, list } = await accounts(1);
  const P = await signedIn(browser, list[0], password);
  const page = P.page;
  try {
    await page.goto("/#/create?mode=solo");
    await page.getByRole("button", { name: "Create solo room" }).click();
    await page.getByRole("button", { name: "Launch game", exact: true }).click();
    await waitForTurn(page);
    expect(await clocks(page)).toHaveLength(1);
    log.push("UI create (22 min) → launch; one seat, one clock");
    await exerciseDraft(page);
    // Before the first score, non-scoring turns never end a solo game.
    let move = openingMove(await rackIds(page));
    for (let retry = 0; !move && retry < 6; retry += 1) {
      await exchange(page, 4);
      await waitForTurn(page);
      move = openingMove(await rackIds(page));
    }
    expect(move).not.toBeNull();
    await placeMove(page, move!);
    const score = await commit(page);
    await waitForTurn(page);
    log.push(`real Commit +${score}`);
    for (let turn = 0; turn < 3; turn += 1) {
      await pass(page);
      if (turn < 2) await waitForTurn(page);
    }
    const result = await expectResult(page);
    log.push(`3 non-scoring turns → solo Result "${result}"`);
  } finally {
    await P.close();
  }
});

test("Physical Hosted (hosted_versus, host enters tiles): two current racks for the host only, recorded play to Finish", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.physical_hosted = []);
  const { password, list } = await accounts(3);
  const [host, a, b] = list;
  const H = await signedIn(browser, host, password);
  const A = await signedIn(browser, a, password);
  const B = await signedIn(browser, b, password);
  const seen = [observe(H.page), observe(A.page)];
  try {
    const page = H.page;
    await page.goto("/#/create?mode=host");
    await page.getByRole("radio", { name: /^No timer/ }).click();
    const seats = page.getByRole("combobox", { name: "Player username" });
    await seats.nth(0).click();
    await page.getByRole("option", { name: a.name, exact: true }).click();
    await seats.nth(1).click();
    await page.getByRole("option", { name: b.name, exact: true }).click();
    await page.locator("details.create-advanced summary").click();
    await page.getByRole("radio", { name: /^Host enters tiles/ }).click();
    await page.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
    await expect(page.getByRole("button", { name: "Launch game", exact: true })).toBeVisible();
    const url = page.url();
    log.push("UI create: host + two registered players, host enters tiles, untimed");
    // Both seated players open the room and confirm Ready; then the host launches.
    for (const seat of [A, B]) {
      await seat.page.goto(url);
      await seat.page.getByRole("button", { name: "Ready", exact: true }).click();
      await expect(seat.page.getByRole("button", { name: "Unready", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Launch game", exact: true }).click({ timeout: 20_000 });
    await expect(shell(page)).toBeVisible({ timeout: 20_000 });
    await recordDraw(page, "1 + 2 = 3 4 5 6", "A");
    await recordDraw(page, "7 + 1 = 8 9 0 2", "B");
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(8);
    log.push("host records both physical draws");

    // A seated player sees only their own rack; the host sees the active rack.
    await expect(shell(A.page)).toBeVisible({ timeout: 20_000 });
    await expect(A.page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(8);
    await placeTokens(page, ["1", "+", "2", "=", "3"]);
    const score = await commit(page);
    log.push(`host records A's move 1+2=3 for +${score}`);
    await expect(
      page.getByRole("button", { name: "Record the physical draw to continue" }),
    ).toBeVisible();
    await recordDraw(page, "7 8 9 0 4", "A");
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    log.push("refill recorded; turn passes to B (host plays B's rack)");
    await page.reload();
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(8, { timeout: 20_000 });
    log.push("host reload: same game, B's current rack, host controls intact");
    await pass(page);
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();

    // Finish game: host lifecycle, behind a confirmation.
    await page.getByRole("button", { name: "Match controls", exact: true }).tap();
    await page.getByRole("button", { name: "Finish game", exact: true }).tap();
    await page
      .getByRole("dialog", { name: "Finish game" })
      .getByRole("button", { name: "Finish game", exact: true })
      .tap();
    const result = await expectResult(page);
    log.push(`host Finish game → Result "${result}"`);

    await Promise.all(seen.map((item) => item.flush()));
    for (const item of seen) expect(JSON.stringify(item.responses)).not.toMatch(FORBIDDEN);
    // Only the host's projection carries both current racks.
    expect(JSON.stringify(seen[0].responses)).toMatch(/"hostRacks"\s*:\s*\{/);
    expect(JSON.stringify(seen[1].responses)).not.toMatch(/"hostRacks"\s*:\s*\{/);
    log.push("hostRacks only in the host's projection; no bag/RNG/history keys anywhere");
  } finally {
    await H.close();
    await A.close();
    await B.close();
  }
});

test("Hosted Match (hosted_versus, app draws): players play their own seats; host pause/resume and Finish", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.hosted_versus = []);
  const { password, list } = await accounts(3);
  const [host, a, b] = list;
  const H = await signedIn(browser, host, password);
  const A = await signedIn(browser, a, password);
  const B = await signedIn(browser, b, password);
  const seen = [observe(H.page), observe(A.page), observe(B.page)];
  try {
    const page = H.page;
    await page.goto("/#/create?mode=host");
    const seats = page.getByRole("combobox", { name: "Player username" });
    await seats.nth(0).click();
    await page.getByRole("option", { name: a.name, exact: true }).click();
    await seats.nth(1).click();
    await page.getByRole("option", { name: b.name, exact: true }).click();
    await page.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
    await expect(page.getByRole("button", { name: "Launch game", exact: true })).toBeVisible();
    const url = page.url();
    for (const seat of [A, B]) {
      await seat.page.goto(url);
      await seat.page.getByRole("button", { name: "Ready", exact: true }).click();
      await expect(seat.page.getByRole("button", { name: "Unready", exact: true })).toBeVisible();
    }
    await page.getByRole("button", { name: "Launch game", exact: true }).click();
    await waitForTurn(A.page);
    log.push("UI create: host + two registered players (app draws, 22 min) → ready → host launch");
    // The host is a referee: no rack, no turn actions.
    await expect(shell(page)).toBeVisible();
    await expect(page.locator(".lg-rack-tile")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
    log.push("host view: no rack, no turn actions (referee)");

    const { scorer, other, score } = await openScoring(A.page, B.page);
    log.push(`real Commit +${score}`);
    await waitForTurn(other);
    await exchange(other, 2);
    await waitForTurn(scorer);

    // Host lifecycle: pause, resume.
    await page.getByRole("button", { name: "Match controls", exact: true }).tap();
    await page.getByRole("button", { name: "Pause game", exact: true }).tap();
    await expect(A.page.locator('.lg-shell[data-turn="paused"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Match controls", exact: true }).tap();
    await page.getByRole("button", { name: "Resume game", exact: true }).tap();
    await waitForTurn(scorer);
    log.push("host Pause → both players paused → Resume");

    await page.getByRole("button", { name: "Match controls", exact: true }).tap();
    await page.getByRole("button", { name: "Finish game", exact: true }).tap();
    await page
      .getByRole("dialog", { name: "Finish game" })
      .getByRole("button", { name: "Finish game", exact: true })
      .tap();
    log.push(
      `host Finish → Result: "${await expectResult(page)}" / A: "${await expectResult(A.page)}"`,
    );
    await Promise.all(seen.map((item) => item.flush()));
    for (const item of seen) expect(JSON.stringify(item.responses)).not.toMatch(FORBIDDEN);
    for (const item of seen)
      expect(JSON.stringify(item.responses)).not.toMatch(/"hostRacks"\s*:\s*\{/);
    log.push("no hidden keys; no current-rack view for an app-draw host");
  } finally {
    await H.close();
    await A.close();
    await B.close();
  }
});

test("Hosted Solo (solo, host supervises one registered player)", async ({ browser }) => {
  test.setTimeout(240_000);
  const log: string[] = (proof.hosted_solo = []);
  const { password, list } = await accounts(2);
  const [host, player] = list;
  const H = await signedIn(browser, host, password);
  const P = await signedIn(browser, player, password);
  try {
    const page = H.page;
    await page.goto("/#/create?mode=solo");
    await page.getByRole("radio", { name: /^Hosted online/ }).click();
    await page.getByRole("radio", { name: /^No timer/ }).click();
    await page.getByRole("combobox", { name: "Player username" }).first().click();
    await page.getByRole("option", { name: player.name, exact: true }).click();
    await page
      .getByRole("button", { name: /^Create/ })
      .last()
      .click();
    await expect(page.getByRole("button", { name: "Launch game", exact: true })).toBeVisible();
    const url = page.url();
    await P.page.goto(url);
    await P.page.getByRole("button", { name: "Ready", exact: true }).click();
    await page.getByRole("button", { name: "Launch game", exact: true }).click();
    await waitForTurn(P.page);
    await expect(P.page.locator(".lg-sb-clock")).toHaveCount(0);
    log.push("UI create (hosted solo, untimed) → player ready → host launch; no timer UI");
    let move = openingMove(await rackIds(P.page));
    for (let retry = 0; !move && retry < 6; retry += 1) {
      await exchange(P.page, 4);
      await waitForTurn(P.page);
      move = openingMove(await rackIds(P.page));
    }
    await placeMove(P.page, move!);
    log.push(`player real Commit +${await commit(P.page)}`);
    for (let turn = 0; turn < 3; turn += 1) {
      await waitForTurn(P.page);
      await pass(P.page);
    }
    log.push(`3 non-scoring turns → Result: "${await expectResult(P.page)}"`);
  } finally {
    await H.close();
    await P.close();
  }
});

test("Pass & Play recorded (local_versus, enter real tiles): the draw prompt opens the recorder", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const log: string[] = (proof.local_versus_recorded = []);
  const { password, list } = await accounts(1);
  const P = await signedIn(browser, list[0], password);
  const page = P.page;
  try {
    await page.goto("/#/create?mode=passplay");
    const names = page.getByRole("textbox", { name: "Name" });
    await names.nth(0).fill("Ann");
    await names.nth(1).fill("Ben");
    await page.getByRole("button", { name: "Create match room" }).click();
    await page.getByRole("button", { name: "Launch game", exact: true }).click();
    await page.getByRole("button", { name: "Ann — confirm handoff" }).click();
    await expect(
      page.getByRole("button", { name: "Record the physical draw to continue" }),
    ).toBeVisible({
      timeout: 20_000,
    });
    log.push("recorded Pass & Play: empty rack until the physical draw is entered");
    // The prompt itself opens the recorder (no hunting through More).
    await page.getByRole("button", { name: "Record the physical draw to continue" }).tap();
    await expect(page.getByLabel("Physical tiles", { exact: true })).toBeVisible();
    await page.locator(".lg-sheet-dismiss").click({ position: { x: 20, y: 20 } });
    log.push("tapping the draw prompt opens the Physical recorder");
    await recordDraw(page, "1 + 2 = 3 4 5 6");
    // (22 min per side) Every commit (a recorded draw too) re-conceals: the claim is per revision.
    await page.getByRole("button", { name: "Ann — confirm handoff" }).click();
    await waitForTurn(page);
    expect(await clocks(page)).toHaveLength(2);
    log.push("clocked Pass & Play (22 min): both clocks shown");
    await placeTokens(page, ["1", "+", "2", "=", "3"]);
    log.push(`Ann records her draw and plays 1+2=3 for +${await commit(page)}`);
    await expect(page.getByRole("heading", { name: "Hand the device to Ann" })).toBeVisible({
      timeout: 20_000,
    });
    // Ann's refill is still Ann's turn: confirm, record, then Ben.
    await page.getByRole("button", { name: "Ann — confirm handoff" }).click();
    await expect(
      page.getByRole("button", { name: "Record the physical draw to continue" }),
    ).toBeVisible();
    await recordDraw(page, "7 8 9 0 2");
    await expect(page.getByRole("heading", { name: "Hand the device to Ben" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Ben — confirm handoff" }).click();
    await expect(
      page.getByRole("button", { name: "Record the physical draw to continue" }),
    ).toBeVisible();
    await expect(page.locator(".lg-rack-tile[data-tile-id]")).toHaveCount(0);
    log.push("Ann's refill recorded → concealed → Ben: his own (empty) rack, his draw next");
    await recordDraw(page, "6 + 5 = 11 7 0 3");
    // Then six Passes (no refill needed) end the game; every commit re-conceals.
    const handoffTo = async (name: string) => {
      await expect(page.getByRole("heading", { name: `Hand the device to ${name}` })).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole("button", { name: `${name} — confirm handoff` }).click();
      await waitForTurn(page);
    };
    for (const name of ["Ben", "Ann", "Ben", "Ann", "Ben", "Ann"]) {
      await handoffTo(name);
      await pass(page);
    }
    log.push(
      `Ben records his draw; six Passes with a handoff each → Result "${await expectResult(page)}"`,
    );
  } finally {
    await P.close();
  }
});

test("ArchBot (stage5b_standard, on-device practice): bot turns on this device, to a Result", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.archbot = []);
  const { password, list } = await accounts(1);
  const P = await signedIn(browser, list[0], password);
  const page = P.page;
  const seen = observe(page);
  try {
    await page.goto("/#/create?mode=archbot");
    await page.getByRole("button", { name: /^Private/ }).click();
    await page.getByRole("button", { name: "Start ArchBot match" }).click();
    await launch(page);
    await waitForTurn(page, 60_000);
    await expect(page.locator(".lg-sb-clock")).toHaveCount(0);
    log.push("UI create (private) → launch → playing; ArchBot seat B; untimed, no clock UI");
    await exerciseDraft(page);
    await pass(page);
    await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "thinking");
    await waitForTurn(page, 120_000);
    const last = await page.locator(".lg-last").first().getAttribute("aria-label");
    log.push(`human Pass → ArchBot moved on this device → human's turn ("${last}")`);
    await exchange(page, 2);
    await waitForTurn(page, 120_000);
    log.push("human Exchange 2 → ArchBot → human's turn");
    await surrender(page);
    log.push(`Surrender → Result "${await expectResult(page)}"`);
    await seen.flush();
    expect(JSON.stringify(seen.responses)).not.toMatch(FORBIDDEN);
  } finally {
    await P.close();
  }
});

test.describe("trusted Authur worker", () => {
  const worker = "eq-milestone-s-authur-trusted-bot-1";
  let started = false;
  test.beforeAll(() => {
    const running =
      execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", worker], {
        encoding: "utf8",
      }).trim() === "true";
    if (!running) {
      execFileSync("docker", ["start", worker], { stdio: "ignore" });
      started = true;
    }
  });
  test.afterAll(() => {
    if (started) execFileSync("docker", ["stop", "--time", "10", worker], { stdio: "ignore" });
  });

  test("Authur (authur_strong): Pro account funds it for real, the trusted worker plays, Free is refused", async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const log: string[] = (proof.authur = []);
    const { password, list } = await accounts(2);
    const [pro, free] = list;
    const granted = await provisionPro(env, pro.email);
    log.push(`local pro helper: plan ${granted.plan}, credits ${granted.credits}`);
    const credits = () =>
      Number(
        sql(
          `select coalesce((select balance from public.economy_balances where user_id='${pro.id}' and currency='probot_credit'),0)`,
        ),
      );
    const before = credits();

    // Free account: the real gate refuses (UI) and so does the server.
    const F = await signedIn(browser, free, password);
    await F.page.goto("/#/create?mode=bot");
    await F.page.getByRole("button", { name: /^Private/ }).click();
    await expect(F.page.getByTestId("probot-status")).toBeVisible();
    await expect(F.page.getByRole("button", { name: "Start Authur match" })).toBeDisabled();
    const anon = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
    const signedFree = await anon.auth.signInWithPassword({ email: free.email, password });
    const refused = await fetch(`${env.API_URL}/functions/v1/live-game`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signedFree.data.session!.access_token}`,
        apikey: env.ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "create",
        requestId: randomUUID(),
        funding: "credit",
        policy: {
          accessScope: "private",
          archivePolicy: "private",
          joinPolicy: "invite_only",
          regionId: null,
        },
        settings: {
          name: "Free Authur attempt",
          gameMode: "versus",
          playerA: "Free",
          playerB: "Authur",
          botSide: "B",
          botEngine: "authur",
          botDifficulty: "super",
          startingSide: "A",
        },
      }),
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    log.push(`Free account: Start disabled in the UI; server refused (${refused.status})`);
    await F.close();

    // Pro account: real funding, trusted execution.
    const P = await signedIn(browser, pro, password);
    const page = P.page;
    const seen = observe(page);
    try {
      await page.goto("/#/create?mode=bot");
      await page.getByRole("button", { name: /^Private/ }).click();
      await page.getByRole("radio", { name: /เครดิต/ }).click();
      await page.getByRole("button", { name: "Start Authur match" }).click();
      await launch(page);
      await waitForTurn(page, 60_000);
      await expect(page.locator(".lg-sb-clock")).toHaveCount(0);
      expect(credits()).toBe(before - 1);
      log.push(`UI create with 1 credit → playing; credits ${before} → ${credits()}`);
      await exerciseDraft(page);
      const opened = openingMove(await rackIds(page));
      if (opened) {
        await placeMove(page, opened);
        log.push(`human real Commit +${await commit(page)}`);
      } else {
        await pass(page);
        log.push("human Pass (no opening in the deal)");
      }
      await waitForTurn(page, 180_000);
      log.push(
        `trusted Authur moved: "${await page.locator(".lg-last").first().getAttribute("aria-label")}"`,
      );
      await page.reload();
      await waitForTurn(page, 60_000);
      log.push("reload mid-game: same game, my turn");
      await exchange(page, 2);
      await waitForTurn(page, 180_000);
      log.push("human Exchange 2 → Authur → human's turn");
      await surrender(page);
      log.push(`Surrender → Result "${await expectResult(page)}"`);
      expect(credits()).toBe(before - 1);
      log.push("exactly one credit consumed for the room (no extra charge per move)");
      await seen.flush();
      expect(JSON.stringify(seen.responses)).not.toMatch(FORBIDDEN);
      expect(JSON.stringify(seen.responses)).not.toMatch(/"hostRacks"\s*:\s*\{/);
      log.push("no bot rack / bag / RNG keys reached the browser");
    } finally {
      await P.close();
    }
  });

  test("Stage (trusted Authur, sealed start): play, bot turn, to the Stage Result", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const log: string[] = (proof.stage = []);
    const { password, list } = await accounts(1);
    const P = await signedIn(browser, list[0], password);
    const page = P.page;
    try {
      await page.goto("/#/stage");
      await page
        .getByRole("button", { name: /^Play Stage/ })
        .first()
        .click();
      await expect(shell(page)).toBeVisible({ timeout: 60_000 });
      log.push("Stage list → Play → sealed start on the board");
      await waitForTurn(page, 180_000);
      await pass(page);
      await waitForTurn(page, 180_000);
      log.push(
        `human Pass → trusted Authur: "${await page.locator(".lg-last").first().getAttribute("aria-label")}"`,
      );
      await surrender(page);
      log.push(`Surrender → Result "${await expectResult(page)}"`);
    } finally {
      await P.close();
    }
  });
});

test("Ranked (ranked function): join with stakes, both ready, real turns, rating Result", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = (proof.ranked = []);
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password);
  const B = await signedIn(browser, b, password);
  const seen = [observe(A.page), observe(B.page)];
  try {
    await A.page.goto("/#/ranked");
    await A.page.getByRole("button", { name: "สร้างห้องจัดอันดับ" }).click();
    await A.page.getByRole("button", { name: "สร้างห้องจัดอันดับ" }).click();
    await expect(
      A.page.getByRole("heading", { name: "Waiting for the second player" }),
    ).toBeVisible();
    const url = A.page.url();
    await B.page.goto("/#/ranked");
    await B.page.getByRole("button", { name: "เข้าร่วม" }).first().click();
    await B.page.getByRole("button", { name: "Join Ranked", exact: true }).click();
    log.push("A creates a 15-min Ranked room; B joins after the stakes sheet");
    await B.page.goto(url);
    for (const seat of [A, B]) {
      const ready = seat.page.getByRole("button", { name: "Ready — play for rating" });
      await expect(ready).toBeEnabled({ timeout: 30_000 });
      await ready.click();
    }
    const first = await Promise.race([
      waitForTurn(A.page, 60_000).then(() => [A, B] as const),
      waitForTurn(B.page, 60_000).then(() => [B, A] as const),
    ]);
    const [mover, other] = first;
    expect(await clocks(mover.page)).toHaveLength(2);
    log.push("both confirm the rating at stake → playing, 15-min clocks");
    const opened = await openScoring(mover.page, other.page);
    log.push(`real Commit +${opened.score}`);
    await waitForTurn(opened.other);
    await exchange(opened.other, 2);
    await waitForTurn(opened.scorer);
    log.push("real Exchange 2");
    await surrender(opened.scorer);
    const result = await expectResult(opened.other);
    log.push(`Surrender → Result "${result}"`);
    await Promise.all(seen.map((item) => item.flush()));
    for (const item of seen) expect(JSON.stringify(item.responses)).not.toMatch(FORBIDDEN);
    log.push("no hidden-information keys (Ranked: opponent rack closed)");
  } finally {
    await A.close();
    await B.close();
  }
});
