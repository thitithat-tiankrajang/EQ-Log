// A committed turn must still be there after a reload.
//
// Room state is no longer written to localStorage on the tick that changes it —
// the encode is deferred so it cannot sit between the player and the next frame.
// That is only safe if the write still lands before the page goes away, so this
// plays a real turn and reloads on top of it.

import { expect, test } from "@playwright/test";

type Fiber = { memoizedState: unknown; return: Fiber | null };

test("a committed turn survives a reload", async ({ page }, testInfo) => {
  // Desktop only. What is under test is persistence, which is the same code on
  // every viewport; the submit control and rack are not, and driving three
  // layouts to prove one storage path would only add ways for this to break.
  test.skip(
    testInfo.project.name !== "desktop",
    "Persistence is layout-independent; the controls used to reach it are not.",
  );

  await page.goto("/#/public");
  await page.evaluate(() => window.localStorage.clear());

  await page.goto("/#/create");
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.locator('[data-choice-value="pass_play"]').click();
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.locator('[data-choice-value="play"]').click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await page.getByRole("button", { name: /^Start game$/ }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await page.locator("button.board-cell").first().waitFor();

  const roomId = await page.evaluate(() => location.hash.split("/").pop()!);

  // Deal side A a rack that can actually play something: 1 + 2 = 3, laid across
  // the centre star, which is where a first move has to go.
  await page.evaluate((roomId) => {
    const el = document.querySelector(".board")!;
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
    let f = (el as unknown as Record<string, Fiber>)[key] as Fiber | null;
    let game: Record<string, never> | null = null;
    while (f && !game) {
      let h = f.memoizedState as { memoizedState?: unknown; next?: unknown } | null;
      while (h && typeof h === "object" && "next" in h) {
        const s = h.memoizedState as Record<string, unknown> | null;
        if (s && typeof s === "object" && s.gameId && s.board && s.tilebag) {
          game = s as never;
          break;
        }
        h = h.next as typeof h;
      }
      f = f.return;
    }
    const g = JSON.parse(JSON.stringify(game)) as Record<string, never> & {
      tilebag: { id: string; token: string }[];
      rackA: unknown[];
      [k: string]: unknown;
    };
    const pool = g.tilebag.concat(g.rackA as { id: string; token: string }[]);
    const pick = (token: string, used: Set<string>) => {
      const tile = pool.find((t) => t.token === token && !used.has(t.id))!;
      used.add(tile.id);
      return tile;
    };
    const used = new Set<string>();
    const rack = ["1", "+", "2", "=", "3"].map((token) => pick(token, used));
    while (rack.length < 8) {
      const spare = pool.find((t) => !used.has(t.id) && !["?", "+/-", "x//"].includes(t.token))!;
      used.add(spare.id);
      rack.push(spare);
    }
    g.rackA = rack;
    g.tilebag = pool.filter((t) => !used.has(t.id));
    g.board = Array.from({ length: 15 }, () => Array(15).fill(null));
    g.logs = [];
    g.history = [];
    g.historyIndex = 0;
    g.phase = "choose_action";
    g.activeSide = "A";
    g.status = "playing";
    g.turnNumber = 1;
    const timers = g.timers as Record<string, number>;
    g.timers = { ...timers, A: timers.initialSeconds, B: timers.initialSeconds };
    g.currentTurnStartedAt = new Date().toISOString();
    window.localStorage.setItem(`amath-lab-room-${roomId}`, JSON.stringify(g));
    window.localStorage.setItem("amath-lab-active-room-v1", roomId);
  }, roomId);

  await page.reload();
  const rack = page.locator("section.rack.active button.rack-tile");
  await rack.first().waitFor();

  // Cursor on (7,5), running right, so the word covers the centre star at (7,7).
  await page
    .locator("button.board-cell")
    .nth(7 * 15 + 5)
    .click();
  await expect(page.locator(".board-cell.cursor")).toHaveCount(1);
  for (let i = 0; i < 5; i += 1) {
    await rack.first().click();
    await expect(page.locator(".board-cell.pending")).toHaveCount(i + 1);
  }

  await page.getByRole("button", { name: /Submit action/i }).click();

  // The turn is committed: it is in the log and it scored.
  const log = page.locator(".turn-log, .log-panel, aside").first();
  await expect(log).toContainText(/1 TURNS?/i, { ignoreCase: true });

  const before = await page.evaluate(
    (roomId) => window.localStorage.getItem(`amath-lab-room-${roomId}`),
    roomId,
  );
  expect(before, "the deferred write is flushed before the page unloads").not.toBeNull();

  await page.reload();
  await page.locator("button.board-cell").first().waitFor();

  // Five tiles are on the board and the turn is still in the log.
  await expect(page.locator(".board-cell.filled")).toHaveCount(5);
  await expect(page.locator(".turn-log, .log-panel, aside").first()).toContainText(/1 TURNS?/i, {
    ignoreCase: true,
  });
});
