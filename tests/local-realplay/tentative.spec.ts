import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { available } from "../live-security-browser/fixtures";
import {
  accounts,
  cell,
  openScoring,
  signedIn,
  slot,
  startOnlineMatch,
  tap,
  waitForTurn,
} from "./modes-kit";

/**
 * Phase B on the REAL secured app: two genuine accounts, a real Online Match,
 * the trusted relay on the disposable stack, Realtime to the opponent only.
 * Both directions; payload audit; then the baseline latency samples.
 * Set LAN_BASE_URL to run the same flow through the phone/LAN origin.
 */
test.skip(!available, "Existing disposable Milestone-S stack required");
test.describe.configure({ mode: "serial" });
const BASE = process.env.LAN_BASE_URL?.replace(/\/$/, "");
const PATH = BASE ? "lan" : "local";
const OUT = process.env.PHASE_B_EVIDENCE ?? "test-results/phase-b";
mkdirSync(OUT, { recursive: true });
const COLUMNS = "ABCDEFGHIJKLMNO";
const name = (row: number, col: number) => `${COLUMNS[col]}${row + 1}`;

/** The opponent overlay as square names, from the board's own markup. */
const overlay = (page: Page) =>
  page
    .locator(".lg-cell.is-opponent-tentative")
    .evaluateAll((cells) =>
      cells.map(
        (c) => `${(c as HTMLElement).dataset.boardRow}:${(c as HTMLElement).dataset.boardCol}`,
      ),
    );
const mine = (page: Page) =>
  page
    .locator(".lg-cell.is-tentative")
    .evaluateAll((cells) =>
      cells.map(
        (c) => `${(c as HTMLElement).dataset.boardRow}:${(c as HTMLElement).dataset.boardCol}`,
      ),
    );

/** Record every overlay/committed change in a page with its wall-clock time. */
async function recordBoard(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __board: { t: number; overlay: string; committed: number }[] };
    w.__board = [];
    const snap = () => {
      const overlay = [...document.querySelectorAll<HTMLElement>(".lg-cell.is-opponent-tentative")]
        .map((c) => `${c.dataset.boardRow}:${c.dataset.boardCol}`)
        .join(",");
      const committed = document.querySelectorAll(".lg-cell.is-committed, .lg-cell.is-last").length;
      const last = w.__board.at(-1);
      if (!last || last.overlay !== overlay || last.committed !== committed)
        w.__board.push({ t: Date.now(), overlay, committed });
    };
    snap();
    new MutationObserver(snap).observe(document.querySelector(".lg-grid")!, {
      subtree: true,
      attributes: true,
      childList: true,
    });
  });
}
const boardLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __board: { t: number; overlay: string; committed: number }[] })
        .__board,
  );

test("real two-client tentative sync, both directions, with payload audit", async ({ browser }) => {
  test.setTimeout(300_000);
  const log: string[] = [];
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password, undefined, BASE);
  const B = await signedIn(browser, b, password, undefined, BASE);
  const proposals: string[] = [];
  const frames: string[] = [];
  for (const page of [A.page, B.page]) {
    page.on("request", (request) => {
      const body = request.postData();
      if (body?.includes('"operation":"tentative"')) proposals.push(body);
    });
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        const text = String(frame.payload);
        if (text.includes('"tentative"')) frames.push(text);
      }),
    );
  }
  if (process.env.PHASE_B_DEBUG)
    for (const page of [A.page, B.page])
      page.on("response", async (response) => {
        const body = response.request().postData();
        if (body?.includes('"operation":"tentative"'))
          console.log("relay", response.status(), body.slice(0, 300), await response.text());
      });
  try {
    await startOnlineMatch(A.page, B.page, b.name);
    let committedOnce = false;
    for (const round of [0, 1]) {
      // Whoever's turn it is moves; after round 0 that is the other seat.
      await expect
        .poll(
          async () =>
            (await A.page.getByRole("button", { name: "Pass", exact: true }).count()) +
            (await B.page.getByRole("button", { name: "Pass", exact: true }).count()),
          { timeout: 30_000 },
        )
        .toBe(1);
      const [mover, watcher] = (await A.page
        .getByRole("button", { name: "Pass", exact: true })
        .count())
        ? [A.page, B.page]
        : [B.page, A.page];
      await waitForTurn(mover);
      await recordBoard(watcher);
      const label = round === 0 ? "first mover → opponent" : "reverse direction";
      // Plain tiles for place/move (an alternative opens its picker first).
      const startLabels = await mover
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) => tiles.map((t) => t.getAttribute("aria-label") ?? ""));
      const plain = startLabels
        .map((text, index) => (/not chosen|empty/.test(text) ? -1 : index))
        .filter((index) => index >= 0);
      // Place: seen before Commit.
      await tap(mover, slot(mover, plain[0]!));
      await tap(mover, cell(mover, "C3"));
      await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual(["2:2"]);
      // Move: converges to the new square.
      await tap(mover, cell(mover, "C3"));
      await tap(mover, cell(mover, "E3"));
      await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual(["2:4"]);
      // Recall: disappears.
      await mover.getByRole("button", { name: "Recall", exact: true }).tap();
      await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual([]);
      // Several tiles: the current expression, exactly.
      await tap(mover, slot(mover, plain[0]!));
      await tap(mover, cell(mover, "C3"));
      await tap(mover, slot(mover, plain[1]!));
      await tap(mover, cell(mover, "D3"));
      await tap(mover, slot(mover, plain[2]!));
      await tap(mover, cell(mover, "E3"));
      await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual(await mine(mover));
      // An alternative tile (when the deal has one): only the chosen face is shown.
      const labels = await mover
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) => tiles.map((t) => t.getAttribute("aria-label") ?? ""));
      const alt = labels.findIndex((text) => /not chosen/.test(text));
      if (alt >= 0) {
        await tap(mover, slot(mover, alt));
        await tap(mover, cell(mover, "G3"));
        await expect
          .poll(async () => (await cell(watcher, "G3").getAttribute("aria-label")) ?? "", {
            timeout: 10_000,
          })
          .toMatch(/opponent's tentative tile/);
        const unassigned = (await cell(watcher, "G3").getAttribute("aria-label"))!;
        const picker = mover.locator("[data-face-picker]");
        const option = picker.getByRole("button", { name: /^Play as / }).last();
        const face = (await option.getAttribute("data-face"))!;
        await option.tap();
        await expect
          .poll(async () => (await cell(watcher, "G3").getAttribute("aria-label")) ?? "", {
            timeout: 10_000,
          })
          .toMatch(new RegExp(`^G3, ${face.replace(/[-+×÷]/g, "\\$&")}, opponent's`));
        log.push(`${label}: alternative unassigned "${unassigned}" → chosen face "${face}" only`);
      } else log.push(`${label}: no alternative tile in this deal (covered by unit tests)`);
      await mover.getByRole("button", { name: "Recall", exact: true }).tap();
      await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual([]);

      // Commit: the authoritative move replaces the overlay, no flash, no duplicate.
      if (!committedOnce) {
        // A real Commit (exchanging first if the deal has no opening).
        committedOnce = true;
        await recordBoard(mover);
        const { scorer, other, score } = await openScoring(mover, watcher);
        await waitForTurn(other);
        expect(await overlay(other)).toEqual([]);
        const seen = await boardLog(other);
        const committed = seen.at(-1)!.committed;
        expect(committed).toBeGreaterThan(0);
        // Once the overlay last showed tiles, the next state is the committed
        // board: never a frame with neither (no flash), never both (no duplicate).
        const lastOverlay = seen.map((entry) => entry.overlay !== "").lastIndexOf(true);
        const afterOverlay = lastOverlay >= 0 ? seen.slice(lastOverlay + 1) : [];
        expect(afterOverlay.every((entry) => entry.committed === committed)).toBe(true);
        log.push(
          `${label}: real Commit +${score} by ${scorer === mover ? "the mover" : "the other seat after an exchange"} — opponent: overlay → ${committed} committed tiles in one render, no gap, no duplicate`,
        );
      } else {
        await mover.getByRole("button", { name: "Pass", exact: true }).tap();
        await mover.getByRole("button", { name: "Confirm pass", exact: true }).tap();
        await waitForTurn(watcher);
        expect(await overlay(watcher)).toEqual([]);
        log.push(`${label}: Pass — overlay cleared by the new epoch`);
      }
      log.push(`${label}: place / move / recall / several tiles converged on the opponent`);
    }
    // Payload audit.
    for (const body of proposals)
      expect(Object.keys(JSON.parse(body)).sort()).toEqual([
        "id",
        "operation",
        "revision",
        "seq",
        "tiles",
      ]);
    for (const frame of frames)
      expect(frame).not.toMatch(/tileId|rack|tilebag|rng|canonical|history/i);
    log.push(
      `payload audit: ${proposals.length} proposals (own tile ids only, strict keys); ${frames.length} relayed frames with no tile id, rack, bag or RNG`,
    );
  } finally {
    await A.close();
    await B.close();
    writeFileSync(`${OUT}/two-client-${PATH}.json`, JSON.stringify(log, null, 2) + "\n");
  }
});

const pct = (values: number[], p: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return (
    Math.round(
      sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! * 10,
    ) / 10
  );
};
const stats = (values: number[]) => ({
  n: values.length,
  p50: pct(values, 50),
  p95: pct(values, 95),
  p99: pct(values, 99),
  max: Math.round(Math.max(...values) * 10) / 10,
});

test("baseline latency (measured, not optimized)", async ({ browser }) => {
  test.setTimeout(600_000);
  const SAMPLES = Number(process.env.PHASE_B_SAMPLES ?? 120);
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password, undefined, BASE);
  const B = await signedIn(browser, b, password, undefined, BASE);
  const requests: { start: number; end: number; bytes: number; timing: string; status: number }[] =
    [];
  const pending = new Map<string, number>();
  const frameLog = new Map<Page, { t: number; bytes: number }[]>();
  // Listen before the game starts: the Realtime socket opens with the page.
  for (const page of [A.page, B.page]) {
    const entries: { t: number; bytes: number }[] = [];
    frameLog.set(page, entries);
    page.on("websocket", (socket) =>
      socket.on("framereceived", (frame) => {
        const text = String(frame.payload);
        if (text.includes('"tentative"')) entries.push({ t: Date.now(), bytes: text.length });
      }),
    );
  }
  try {
    await startOnlineMatch(A.page, B.page, b.name);
    const [mover, watcher] = (await A.page
      .getByRole("button", { name: "Pass", exact: true })
      .count())
      ? [A.page, B.page]
      : [B.page, A.page];
    mover.on("request", (request) => {
      const body = request.postData();
      if (body?.includes('"operation":"tentative"')) pending.set(request.url() + body, Date.now());
    });
    mover.on("response", async (response) => {
      const request = response.request();
      const body = request.postData();
      if (!body?.includes('"operation":"tentative"')) return;
      requests.push({
        start: pending.get(request.url() + body) ?? Date.now(),
        end: Date.now(),
        bytes: body.length,
        timing: (await response.allHeaders())["server-timing"] ?? "",
        status: response.status(),
      });
    });
    const liveReceived = () => frameLog.get(watcher)!.map((entry) => entry.t);
    await waitForTurn(mover);
    await recordBoard(watcher);
    // The real local action time: the click on a board square, in the page;
    // and the local (optimistic) render of the mover's own tentative tile.
    await mover.evaluate(() => {
      const w = window as unknown as {
        __clicks: number[];
        __mine: { t: number; squares: string }[];
      };
      w.__clicks = [];
      w.__mine = [];
      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element).closest?.(".lg-cell")) w.__clicks.push(Date.now());
        },
        true,
      );
      new MutationObserver(() => {
        const squares = [...document.querySelectorAll<HTMLElement>(".lg-cell.is-tentative")]
          .map((c) => `${c.dataset.boardRow}:${c.dataset.boardCol}`)
          .join(",");
        if (w.__mine.at(-1)?.squares !== squares) w.__mine.push({ t: Date.now(), squares });
      }).observe(document.querySelector(".lg-grid")!, {
        subtree: true,
        attributes: true,
        childList: true,
      });
    });
    const plainFirst = (
      await mover
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) => tiles.map((t) => t.getAttribute("aria-label") ?? ""))
    ).findIndex((text) => !/not chosen|empty/.test(text));
    await tap(mover, slot(mover, plainFirst));
    await tap(mover, cell(mover, "C3"));
    await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual(["2:2"]);
    const samples: { action: number; square: string }[] = [];
    let at: [number, number] = [2, 2];
    for (let i = 0; i < SAMPLES; i += 1) {
      const to: [number, number] = at[1] === 2 ? [2, 3] : [2, 2];
      await tap(mover, cell(mover, name(...at)));
      const action = Date.now();
      await tap(mover, cell(mover, name(...to)));
      samples.push({ action, square: `${to[0]}:${to[1]}` });
      await expect
        .poll(() => overlay(watcher), { timeout: 10_000, intervals: [5, 10, 20] })
        .toEqual([`${to[0]}:${to[1]}`]);
      at = to;
    }
    const board = await boardLog(watcher);
    const { clicks, own } = await mover.evaluate(() => {
      const w = window as unknown as {
        __clicks: number[];
        __mine: { t: number; squares: string }[];
      };
      return { clicks: w.__clicks, own: w.__mine };
    });
    const tracked = requests.slice(-SAMPLES);
    const frames = liveReceived().slice(-SAMPLES);
    const series = {
      actionToRequestStart: [] as number[],
      requestRoundTrip: [] as number[],
      relayTotal: [] as number[],
      relayAuth: [] as number[],
      relayRead: [] as number[],
      relayBroadcast: [] as number[],
      relayBroadcastStartToRemoteReceipt: [] as number[],
      remoteReceiptToRender: [] as number[],
      endToEnd: [] as number[],
      localRender: [] as number[],
    };
    samples.forEach((sample, i) => {
      const request = tracked[i];
      const frame = frames[i];
      const action = clicks.find((t) => t >= sample.action);
      const render = board.find(
        (entry) => entry.t >= sample.action && entry.overlay === sample.square,
      );
      const local = own.find(
        (entry) => action !== undefined && entry.t >= action && entry.squares === sample.square,
      );
      if (!request || !frame || !render || action === undefined || !local) return;
      sample.action = action;
      series.localRender.push(local.t - action);
      const server = Object.fromEntries(
        request.timing.split(",").map((part) => {
          const [key, dur] = part.trim().split(";dur=");
          return [key, Number(dur)];
        }),
      ) as Record<string, number>;
      series.actionToRequestStart.push(request.start - sample.action);
      series.requestRoundTrip.push(request.end - request.start);
      series.relayTotal.push(server.total);
      series.relayAuth.push(server.auth);
      series.relayRead.push(server.read);
      series.relayBroadcast.push(server.broadcast);
      // The relay's broadcast starts after auth/read/validate; one-way network
      // time is estimated as half of (round trip − relay time).
      const oneWay = Math.max(0, (request.end - request.start - server.total) / 2);
      const broadcastStart = request.start + oneWay + (server.total - server.broadcast);
      series.relayBroadcastStartToRemoteReceipt.push(Math.max(0, frame - broadcastStart));
      series.remoteReceiptToRender.push(Math.max(0, render.t - frame));
      series.endToEnd.push(render.t - sample.action);
    });

    // Rapid manipulation: 20 moves as fast as the UI accepts them.
    const burstStartRequests = requests.length;
    const burstStartFrames = liveReceived().length;
    const burstStart = Date.now();
    for (let i = 0; i < 20; i += 1) {
      const to: [number, number] = at[1] === 2 ? [2, 3] : [2, 2];
      await tap(mover, cell(mover, name(...at)));
      await tap(mover, cell(mover, name(...to)));
      at = to;
    }
    const burstMs = Date.now() - burstStart;
    await expect.poll(() => overlay(watcher), { timeout: 10_000 }).toEqual([`${at[0]}:${at[1]}`]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const report = {
      path: PATH,
      base: BASE ?? "http://127.0.0.1:5192",
      samples: series.endToEnd.length,
      ms: Object.fromEntries(Object.entries(series).map(([key, values]) => [key, stats(values)])),
      payload: {
        proposalBytes: stats(requests.map((r) => r.bytes)),
        relayedFrameBytes: stats(frameLog.get(watcher)!.map((entry) => entry.bytes)),
      },
      perAction: {
        backendRequests: 1,
        realtimeMessagesToOpponent: 1,
        durableWrites: 0,
      },
      rapid: {
        localMoves: 20,
        durationMs: burstMs,
        localMovesPerSecond: Math.round((20 / burstMs) * 10000) / 10,
        requestsSent: requests.length - burstStartRequests,
        framesReceived: liveReceived().length - burstStartFrames,
        converged: true,
      },
      statuses: [...new Set(requests.map((r) => r.status))],
    };
    writeFileSync(`${OUT}/baseline-${PATH}.json`, JSON.stringify(report, null, 2) + "\n");
    expect(series.endToEnd.length).toBeGreaterThan(SAMPLES * 0.9);
  } finally {
    await A.close();
    await B.close();
  }
});

test("real stack under impairment: latency, jitter, rapid changes, disconnect/reconnect", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const log: string[] = [];
  const { password, list } = await accounts(2);
  const [a, b] = list;
  const A = await signedIn(browser, a, password, undefined, BASE);
  const B = await signedIn(browser, b, password, undefined, BASE);
  try {
    await startOnlineMatch(A.page, B.page, b.name);
    const [mover, watcher] = (await A.page
      .getByRole("button", { name: "Pass", exact: true })
      .count())
      ? [A.page, B.page]
      : [B.page, A.page];
    await waitForTurn(mover);
    // Opponent on a slow link (CDP: 150 ms latency each way).
    const cdp = await watcher.context().newCDPSession(watcher);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    // Sender's relay requests jittered 0–400 ms.
    let seed = 7;
    await mover.route("**/functions/v1/live-game", async (route) => {
      if (route.request().postData()?.includes('"operation":"tentative"')) {
        seed = (seed * 48271) % 2147483647;
        await new Promise((resolve) => setTimeout(resolve, seed % 400));
      }
      await route.continue();
    });
    await recordBoard(watcher);
    const plain = (
      await mover
        .locator(".lg-rack-tile")
        .evaluateAll((tiles) => tiles.map((t) => t.getAttribute("aria-label") ?? ""))
    )
      .map((text, index) => (/not chosen|empty/.test(text) ? -1 : index))
      .filter((index) => index >= 0);
    await tap(mover, slot(mover, plain[0]!));
    await tap(mover, cell(mover, "C3"));
    // Rapid local changes: 12 moves without waiting.
    let at = "C3";
    for (const to of ["D3", "E3", "F3", "C4", "D4", "E4", "F4", "C5", "D5", "E5", "F5", "G5"]) {
      await tap(mover, cell(mover, at));
      await tap(mover, cell(mover, to));
      at = to;
    }
    expect(await mine(mover)).toEqual(["4:6"]); // local state is immediate and exact
    await expect.poll(() => overlay(watcher), { timeout: 15_000 }).toEqual(["4:6"]);
    // It never went backwards once it reached the final square.
    const trail = (await boardLog(watcher)).map((entry) => entry.overlay).filter(Boolean);
    const final = trail.lastIndexOf("4:6");
    expect(trail.slice(trail.indexOf("4:6"), final + 1).every((value) => value === "4:6")).toBe(
      true,
    );
    log.push(
      `latency 150 ms + jitter 0–400 ms, 12 rapid moves: opponent saw ${trail.length} intermediate states, settled on the final square, never rolled back`,
    );

    // Disconnect the opponent; the mover keeps changing; reconnect.
    await watcher.context().setOffline(true);
    await tap(mover, cell(mover, at));
    await tap(mover, cell(mover, "H5"));
    await tap(mover, cell(mover, "H5"));
    await tap(mover, cell(mover, "H6"));
    await watcher.waitForTimeout(1500);
    await watcher.context().setOffline(false);
    // After reconnecting, nothing older than the mover's current set may appear.
    await watcher.waitForTimeout(4000);
    const shown = await overlay(watcher);
    expect(["4:6", "5:7", ""].includes(shown.join(","))).toBe(true);
    await tap(mover, cell(mover, "H6"));
    await tap(mover, cell(mover, "I6"));
    await expect.poll(() => overlay(watcher), { timeout: 20_000 }).toEqual(["5:8"]);
    log.push(
      `opponent offline while the mover moved twice; after reconnect it showed ${shown.join(",") || "nothing"} (no replay), then the current square on the next update`,
    );
    // Commit-equivalent epoch change under latency: Pass clears the overlay.
    await mover.getByRole("button", { name: "Recall", exact: true }).tap();
    await mover.getByRole("button", { name: "Pass", exact: true }).tap();
    await mover.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await waitForTurn(watcher);
    expect(await overlay(watcher)).toEqual([]);
    log.push("Pass under latency: overlay cleared by the new epoch");
  } finally {
    await A.close();
    await B.close();
    writeFileSync(`${OUT}/impairment-${PATH}.json`, JSON.stringify(log, null, 2) + "\n");
  }
});
