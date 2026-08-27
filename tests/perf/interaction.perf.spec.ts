// ── Interaction latency benchmark ────────────────────────────────────────────
//
// Measures the interaction the player performs most, and complained about most:
// moving a single tile from the rack onto the board.
//
// Every click is a REAL trusted click. Programmatic `element.click()` is not a
// substitute: in the production build React does not respond to it at all, so an
// instrument built on it measures an app that never ran.
//
// Two controlled variables:
//   • HISTORY SIZE — every TurnLog carries two full board snapshots and two full
//     tilebags, so anything that walks the game per interaction gets more
//     expensive as the match runs. 0 / 10 / 20 / 40 turns separates "slow" from
//     "slows down".
//   • CPU — Pass & Play is described in the app as "two players share this
//     phone", so desktop-speed numbers are not the numbers the player lives
//     with. Every measurement is repeated at 1x and at 6x throttling.
//
// The headline metric is the synchronous span from React's handler to the end of
// its commit, captured in-page. Event Timing and Long Animation Frames are
// recorded alongside it as an independent check.

import { expect, test } from "@playwright/test";
import { HARNESS, SEED_FN } from "./harness";

const HISTORY_SIZES = [0, 10, 20, 40];
const CPU_RATES = [1, 6];
const PLACEMENTS = 6;
const RACK = "section.rack.active button.rack-tile";

test.describe.configure({ mode: "serial", timeout: 600_000 });

test("tile placement latency vs history and CPU", async ({ page }) => {
  await page.addInitScript(HARNESS);
  await page.goto("/#/public");
  await page.evaluate(() => window.localStorage.clear());

  // One real match created through the UI, so the seed is a genuine GameState.
  await page.goto("/#/create");
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("button", { name: /^Match/ }).click();
  await page.locator('[data-choice-value="pass_play"]').click();
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await page.locator('[data-choice-value="play"]').click();
  await page.getByRole("button", { name: /Create match room/i }).click();
  await expect(page).toHaveURL(/#\/room\//);
  await page.getByRole("button", { name: /^Start game$/ }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await page.locator("button.board-cell").first().waitFor();

  const roomId = await page.evaluate(() => location.hash.split("/").pop()!);
  const readGame = () =>
    page.evaluate(() => {
      const el = document.querySelector(".board")!;
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))!;
      let f: any = (el as any)[key];
      while (f) {
        let h = f.memoizedState;
        while (h && typeof h === "object" && "next" in h) {
          const s = h.memoizedState;
          if (s && typeof s === "object" && s.gameId && s.board && s.tilebag) return s;
          h = h.next;
        }
        f = f.return;
      }
      throw new Error("GameState not found in fiber tree");
    });

  const base = await readGame();
  const cdp = await page.context().newCDPSession(page);
  const rows: string[] = [];

  for (const cpu of CPU_RATES) {
    for (const turns of HISTORY_SIZES) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await page.evaluate(
        ({ roomId, base, turns, seedFn }) => {
          const seed = eval(`${seedFn}; seedGame`);
          const game = seed(base, turns, 80);
          window.localStorage.setItem(`amath-lab-room-${roomId}`, JSON.stringify(game));
          window.localStorage.setItem("amath-lab-active-room-v1", roomId);
        },
        { roomId, base, turns, seedFn: SEED_FN },
      );

      await page.reload();
      await page.locator(RACK).first().waitFor();
      await page.waitForTimeout(600); // boot settles; it is not what we measure

      const loaded = await readGame();
      expect(loaded.logs.length, `history seeded (${turns})`).toBe(turns);

      // Throttle only around the measurement, so seeding and boot stay quick.
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await page.evaluate(() => (window as any).__EQPERF.reset());

      // Row 7 is left empty by the seed, so its cells are always placeable.
      // Arm the placement cursor, then click rack tiles: each rack click MOVES a
      // tile out of the rack onto the board.
      await page.evaluate(() => (window as any).__EQPERF.mark("cursor"));
      await page
        .locator("button.board-cell")
        .nth(7 * 15 + 1)
        .click();
      await expect(page.locator(".board-cell.cursor")).toHaveCount(1);

      await page.evaluate(() => (window as any).__EQPERF.mark("place"));
      for (let i = 0; i < PLACEMENTS; i += 1) {
        await page.locator(RACK).first().click();
        await expect(page.locator(".board-cell.pending")).toHaveCount(i + 1);
      }

      // Idle: no input at all. Whatever this costs is work the app does to
      // itself — above all the once-a-second clock rewrite of the game object.
      // Run idle at a much harsher throttle than the clicks. The clock tick is
      // only a few milliseconds of render, so at 6x it hides under the noise
      // floor; at 20x a redraw the app did not need becomes a dropped frame.
      let idle = null;
      if (turns === 40) {
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
        idle = await page.evaluate(() => (window as any).__EQPERF.idle(8));
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      }
      // ── Rapid, continuous input ──────────────────────────────────────────
      //
      // A player mid-turn does not pause between tiles. Fire clicks as fast as
      // they can be dispatched and check two things: that the app keeps up
      // (per-click cost does not degrade as the queue builds), and that nothing
      // is DROPPED — the last click must be the state on screen.
      let stress = null;
      if (turns === 40) {
        await page.evaluate(() => (window as any).__EQPERF.mark("stress"));
        const cells = page.locator("button.board-cell");
        const t0 = Date.now();
        // Columns 8-14 of row 7: still empty, because the placements above
        // filled leftward from column 1. Clicking an occupied square is a
        // different interaction (it picks the pending tile up), which would make
        // this measure something other than input throughput.
        const first = 7 * 15 + 8;
        const span = 7;
        for (let i = 0; i < 30; i += 1) {
          await cells.nth(first + (i % span)).click({ noWaitAfter: true });
        }
        const wall = Date.now() - t0;
        // Whatever the queue did, the app must have landed on the last click.
        await expect(page.locator(".board-cell.cursor")).toHaveCount(1);
        const landed = await page.evaluate(() => {
          const cell = document.querySelector(".board-cell.cursor");
          const all = [...document.querySelectorAll("button.board-cell")];
          return all.indexOf(cell as Element);
        });
        const s = await page.evaluate(() => (window as any).__EQPERF.stats("stress"));
        stress = { wall, landed, expected: 7 * 15 + 8 + ((30 - 1) % 7), ...s };
      }

      const place = await page.evaluate(() => (window as any).__EQPERF.stats("place"));
      const loaf = await page.evaluate(() => (window as any).__EQPERF.loafSummary());
      const events = await page.evaluate(() => (window as any).__EQPERF.eventStats());
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

      rows.push(
        `cpu=${cpu}x history=${String(turns).padStart(2)}  ` +
          `place p50=${String(place.p50).padStart(7)}ms p95=${String(place.p95).padStart(7)}ms ` +
          `max=${String(place.max).padStart(7)}ms  commits=${place.commitsPerClick}  ` +
          `INP>16ms=${events.slowInteractions} worst=${events.worst}ms  ` +
          `LoAF=${loaf.frames} blocking=${loaf.blocking}ms` +
          (stress
            ? `\n      STRESS 30 rapid clicks (wall ${stress.wall}ms is dispatch-bound): ` +
              `p50=${stress.p50}ms p95=${stress.p95}ms max=${stress.max}ms  ` +
              `landed=${stress.landed === stress.expected ? "last click (nothing dropped)" : `WRONG (${stress.landed} vs ${stress.expected})`}`
            : "") +
          (idle
            ? `\n      IDLE 8s: commits=${idle.commits} LoAF=${idle.loafFrames} ` +
              `blocking=${idle.loafBlocking}ms worst=${idle.loafWorst}ms ` +
              `frameGap p95=${idle.frameGapP95}ms max=${idle.frameGapMax}ms` +
              (idle.worstScripts ? `\n        worst frame scripts: ${idle.worstScripts}` : "")
            : "") +
          (loaf.byFn.length
            ? `\n      scripts: ${loaf.byFn.map(([f, d]: any) => `${f}=${d}ms`).join(", ")}`
            : ""),
      );
    }
  }

  console.log("\n===== TILE PLACEMENT LATENCY =====\n" + rows.join("\n") + "\n");
});
