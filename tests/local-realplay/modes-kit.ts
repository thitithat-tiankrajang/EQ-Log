import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createManualPlayers } from "../../tools/phase-a/local-accounts.mjs";
import { env } from "../live-security-browser/fixtures";
import { BOARD_SIZE } from "../../src/constants/gameRules";
import {
  getAssignmentOptions,
  validateMove,
  type BoardSnapshot,
  type PendingPlacement,
} from "../../src/game";
import { tokenOfTileId } from "../../src/domain/tiles";

/**
 * Real-app kit for the mode matrix: genuine local password accounts, touch
 * phones, and the approved shell's interaction model driven through the UI.
 * The only game knowledge the test uses is what the player's own browser
 * shows: its own rack (tile ids are manifest ordinals) and the public board.
 */
export type Account = { id: string; email: string; name: string };
export const PHONE = { width: 390, height: 844 };

export async function accounts(count: number) {
  const password = `Disposable-${randomUUID()}!`;
  const list: Account[] = [];
  while (list.length < count) list.push(...(await createManualPlayers(password, env)));
  return { password, list: list.slice(0, count) };
}

export async function signedIn(
  browser: Browser,
  account: Account,
  password: string,
  viewport = PHONE,
) {
  const context = await browser.newContext({
    viewport,
    hasTouch: true,
    isMobile: viewport.width < 600,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await page.getByLabel("Local email").fill(account.email);
  await page.getByLabel("Local password").fill(password);
  await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  return { page, close: () => context.close() };
}

export const cell = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name},`) });
export const slot = (page: Page, index: number) => page.locator(".lg-rack-tile").nth(index);
export const shell = (page: Page) => page.locator(".lg-shell");

export async function tap(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** The player's own rack as the shell shows it: tile id per slot (null = empty). */
export async function rackIds(page: Page) {
  return page
    .locator(".lg-rack-tile")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("data-tile-id")));
}

export async function waitForTurn(page: Page, timeout = 30_000) {
  await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({ timeout });
}

/** Clock text shown in the HUD for a seat row (null when the game is untimed). */
export async function clocks(page: Page) {
  return page
    .locator(".lg-sb-clock:not(.is-none)")
    .evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
}

/**
 * A legal opening through H8 from the player's own rack, found with the app's
 * own validator (no engine, no hidden information): tiles in row 8. At most
 * one blank, and only in short moves, to keep the search small.
 */
export function openingMove(ids: (string | null)[], board?: BoardSnapshot) {
  const empty: BoardSnapshot =
    board ?? Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  const tiles = ids
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id, token: tokenOfTileId(id) }));
  let best: PendingPlacement[] | null = null;
  const search = (chosen: typeof tiles, length: number) => {
    if (best) return;
    if (chosen.length === length) {
      const blanks = chosen.filter((tile) => tile.token === "?").length;
      if (blanks > 1 || (blanks === 1 && length > 4)) return;
      for (let start = 7 - length + 1; start <= 7 && !best; start += 1) {
        if (start < 0 || start + length > BOARD_SIZE) continue;
        const assign = (index: number, acc: PendingPlacement[]) => {
          if (best) return;
          if (index === chosen.length) {
            if (validateMove(empty, acc).isValid) best = acc;
            return;
          }
          const tile = chosen[index];
          const options = getAssignmentOptions(tile.token);
          for (const face of options.length ? options : [undefined])
            assign(index + 1, [
              ...acc,
              {
                tile,
                row: 7,
                col: start + index,
                ...(face ? { assignedToken: face } : {}),
              } as PendingPlacement,
            ]);
        };
        assign(0, []);
      }
      return;
    }
    for (const tile of tiles) if (!chosen.includes(tile)) search([...chosen, tile], length);
  };
  for (const length of [3, 4, 5, 6]) search([], length);
  return best as PendingPlacement[] | null;
}

const COLUMNS = "ABCDEFGHIJKLMNO";
const SPOKEN: Record<string, string> = {
  "+": "plus",
  "-": "minus",
  "×": "times",
  x: "times",
  "÷": "divide",
  "/": "divide",
  "=": "equals",
};

/** Place a move with the approved model: select a rack tile, tap its square, choose a face. */
export async function placeMove(page: Page, move: PendingPlacement[]) {
  for (const item of move) {
    const slotIndex = (await rackIds(page)).indexOf(item.tile.id);
    await tap(page, slot(page, slotIndex));
    await tap(page, cell(page, `${COLUMNS[item.col]}${item.row + 1}`));
    if (item.assignedToken) {
      const face = SPOKEN[item.assignedToken] ?? item.assignedToken;
      const picker = page.locator("[data-face-picker]");
      await expect(picker).toBeVisible();
      await picker.getByRole("button", { name: `Play as ${face}`, exact: true }).tap();
      await expect(picker).toHaveCount(0);
    }
  }
}

/**
 * The approved interaction model on a real turn, without committing:
 * select → place, select → move, select → return into a chosen empty slot,
 * arrow RIGHT → escapes the placed tile → DOWN → OFF, then Recall.
 */
export async function exerciseDraft(page: Page) {
  const labels = await page
    .locator(".lg-rack-tile")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label") ?? ""));
  const plain = labels
    .map((label, index) => (/not chosen|empty/.test(label) ? -1 : index))
    .filter((index) => index >= 0);
  const [first, second, third] = plain;
  await tap(page, slot(page, first));
  await expect(slot(page, first)).toHaveClass(/is-selected/);
  await tap(page, cell(page, "C3"));
  await expect(cell(page, "C3")).toHaveAccessibleName(/your tentative tile/);
  await tap(page, cell(page, "C3"));
  await tap(page, cell(page, "C5"));
  await expect(cell(page, "C5")).toHaveAccessibleName(/your tentative tile/);
  await tap(page, slot(page, second));
  await tap(page, cell(page, "E3"));
  await tap(page, cell(page, "C5"));
  await tap(page, slot(page, second));
  await expect(cell(page, "C5")).toHaveAccessibleName(/empty/);
  await page.getByRole("button", { name: "Recall", exact: true }).tap();
  await tap(page, cell(page, "C10"));
  await expect(cell(page, "C10")).toHaveClass(/dir-right/);
  await tap(page, slot(page, third));
  await expect(cell(page, "D10")).toHaveClass(/dir-right/);
  await tap(page, cell(page, "D10"));
  await expect(cell(page, "D10")).toHaveClass(/dir-down/);
  await tap(page, cell(page, "D10"));
  await expect(page.locator(".lg-cell.is-cursor")).toHaveCount(0);
  await page.getByRole("button", { name: "Recall", exact: true }).tap();
  await expect(page.locator(".lg-cell.is-tentative")).toHaveCount(0);
}

/** If the rack holds an alternative tile: place it, choose a face, edit it by double tap, recall. */
export async function exerciseAlternative(page: Page) {
  const labels = await page
    .locator(".lg-rack-tile")
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute("aria-label") ?? ""));
  const index = labels.findIndex((label) => /not chosen/.test(label));
  if (index < 0) return false;
  await tap(page, slot(page, index));
  await tap(page, cell(page, "M13"));
  const picker = page.locator("[data-face-picker]");
  await expect(picker).toBeVisible();
  await picker
    .getByRole("button", { name: /^Play as / })
    .last()
    .tap();
  await expect(cell(page, "M13")).toHaveAccessibleName(/chosen from|blank played as/);
  const box = (await cell(page, "M13").boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(80);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(picker).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recall", exact: true }).tap();
  return true;
}

export async function commit(page: Page) {
  const button = page.getByRole("button", { name: /^Commit \+\d+$/ });
  await expect(button).toBeEnabled();
  const score = Number((await button.textContent())!.replace(/\D+/g, ""));
  await button.tap();
  return score;
}

export async function pass(page: Page) {
  await page.getByRole("button", { name: "Pass", exact: true }).tap();
  await page.getByRole("button", { name: "Confirm pass", exact: true }).tap();
}

/** A real Exchange of the first `count` tiles, selected with a touch drag across the rack. */
export async function exchange(page: Page, count = 2) {
  await page.getByRole("button", { name: "Exchange", exact: true }).tap();
  const a = (await slot(page, 0).boundingBox())!;
  const b = (await slot(page, count - 1).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = a.y + a.height / 2;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: a.x + a.width / 2, y }],
  });
  for (let step = 1; step <= 8; step += 1)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: a.x + a.width / 2 + ((b.x - a.x) * step) / 8, y }],
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await expect(page.locator('.lg-rack-tile[aria-pressed="true"]')).toHaveCount(count);
  await page.getByRole("button", { name: `Exchange ${count} tiles`, exact: true }).tap();
}

/** HUD scores, A then B. */
export async function scores(page: Page) {
  return page
    .locator(".lg-sb-score")
    .evaluateAll((items) => items.map((item) => Number(item.textContent)));
}

export async function surrender(page: Page) {
  await page.getByRole("button", { name: "Match controls", exact: true }).tap();
  await page.getByRole("button", { name: "Surrender", exact: true }).tap();
  const sheet = page.getByRole("dialog", { name: "Surrender this game?" });
  await sheet.getByRole("button", { name: "Surrender", exact: true }).tap();
}

/** The Result is shown and nothing that changes the game is left. */
export async function expectResult(page: Page) {
  const result = page.getByRole("status").filter({ has: page.locator(".lg-result-head") });
  await expect(result).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Exchange", exact: true })).toHaveCount(0);
  return (await result.locator(".lg-result-head").innerText()).replace(/\s+/g, " ");
}

/** Hidden-information audit for a recipient's live-game responses. */
export const FORBIDDEN = /"(?:tilebag|canonical|history|rngStep|rngSeed)"\s*:/;

/**
 * A real Exchange that fishes for an opening: every tile except "=" and
 * blanks goes back (at least one, at most seven), selected by taps.
 */
export async function smartExchange(page: Page) {
  const ids = await rackIds(page);
  const keep = new Set<number>();
  ids.forEach((id, index) => {
    if (id && (tokenOfTileId(id) === "=" || tokenOfTileId(id) === "?")) keep.add(index);
  });
  let picks = ids.map((id, index) => (id && !keep.has(index) ? index : -1)).filter((i) => i >= 0);
  if (!picks.length) picks = [ids.findIndex(Boolean)];
  picks = picks.slice(0, 7);
  await page.getByRole("button", { name: "Exchange", exact: true }).tap();
  for (const index of picks) await page.locator(".lg-rack-tile").nth(index).click();
  await expect(page.locator('.lg-rack-tile[aria-pressed="true"]')).toHaveCount(picks.length);
  await page.getByRole("button", { name: new RegExp(`^Exchange ${picks.length} tiles?$`) }).tap();
}

/**
 * The game's first scoring play, made through the UI by whichever side gets a
 * legal opening first: a side without one makes a real Exchange and the other
 * side tries. At most five such turns, so the six-turn no-score rule never ends
 * the game first. Returns who scored, the score and the turns it took.
 */
export async function openScoring(first: Page, second: Page) {
  let [mover, other] = [first, second];
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await waitForTurn(mover);
    const move = openingMove(await rackIds(mover));
    if (move) {
      await placeMove(mover, move);
      return { scorer: mover, other, score: await commit(mover), extra: attempt };
    }
    await smartExchange(mover);
    [mover, other] = [other, mover];
  }
  throw new Error("No legal opening in five real turns");
}

/**
 * Six consecutive non-scoring turns end a versus game: an Exchange, then
 * Passes, alternating, starting with `first`.
 */
export async function finishByNoScore(first: Page, second: Page) {
  let [mover, other] = [first, second];
  for (let turn = 0; turn < 6; turn += 1) {
    await waitForTurn(mover);
    if (turn === 0) await exchange(mover, 2);
    else await pass(mover);
    [mover, other] = [other, mover];
  }
}

/** Open More (phone) or the side tabs (desktop) on a given tab. */
export async function openTab(page: Page, tab: string) {
  const more = page.getByRole("button", { name: "Record, bag, notes and tools" });
  if (await more.count()) await more.tap();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
export async function closeSheet(page: Page) {
  const dismiss = page.locator(".lg-sheet-dismiss");
  if (await dismiss.count()) await dismiss.click({ position: { x: 20, y: 20 } });
  await expect(page.locator(".lg-sheet")).toHaveCount(0);
}

/** Record a physical draw (Physical Hosted host, or a recorded Pass & Play game). */
export async function recordDraw(page: Page, tokens: string, side?: "A" | "B") {
  await openTab(page, "Physical");
  if (side) await page.getByLabel("Physical player", { exact: true }).selectOption(side);
  await page.getByLabel("Physical tiles", { exact: true }).fill(tokens);
  await page.getByRole("button", { name: "Record physical draw", exact: true }).click();
  await closeSheet(page);
}

/** A deterministic opening from a known rack: tokens placed left to right ending at H8. */
export async function placeTokens(page: Page, tokens: string[]) {
  const ids = await rackIds(page);
  const used = new Set<string>();
  const start = 7 - tokens.length + 1;
  const move = tokens.map((token, index) => {
    const id = ids.find((item) => item && !used.has(item) && tokenOfTileId(item) === token)!;
    if (!id) throw new Error(`rack has no ${token}`);
    used.add(id);
    return {
      tile: { id, token: tokenOfTileId(id) },
      row: 7,
      col: start + index,
    } as PendingPlacement;
  });
  await placeMove(page, move);
}

/** Bot and solo rooms open in the waiting room; the owner launches them. */
export async function launch(page: Page) {
  const button = page.getByRole("button", { name: "Launch game", exact: true });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
}
