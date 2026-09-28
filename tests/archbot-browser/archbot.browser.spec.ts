// ArchBot in a real browser (Chromium): the production-built worker must match
// the production Stage 5B runtime exactly on every corpus position, keep the
// page responsive while it searches, stop when cancelled, and refuse a model that
// is missing or altered. Timings and memory are written to
// test-results/archbot-browser-report.json for docs/archbot.md.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

type CorpusCase = {
  id: string;
  tags: string[];
  request: unknown;
  expected: { digest: string; move: unknown; equity: number; oracleMs: number; legalMoves: number };
};
const corpus = JSON.parse(
  readFileSync(resolve(here, "../fixtures/archbot/parity-corpus.json"), "utf8"),
) as { cases: CorpusCase[] };

type Decided = {
  ok: boolean;
  code?: string;
  modelCode?: string | null;
  digest?: string;
  move?: unknown;
  equity?: number;
  legalMoves?: number;
  wallMs?: number;
  modelMs?: number;
  totalMs: number;
  phases?: Array<{ phase: string; at: number }>;
  responsiveness: { maxFrameGapMs: number; frames: number; maxTimerLagMs: number };
};

const report: Record<string, unknown> = { browser: "", cases: [] as unknown[] };

async function open(page: Page) {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("ready");
}

function decide(page: Page, request: unknown, options: { cancelAfterMs?: number } = {}) {
  return page.evaluate(
    ([req, opts]) =>
      (
        window as unknown as { archbot: { decide: (r: unknown, o: unknown) => Promise<unknown> } }
      ).archbot.decide(req, opts),
    [request, options] as const,
  ) as Promise<Decided>;
}

const byId = (id: string) => corpus.cases.find((item) => item.id === id)!;

/**
 * Resident memory of Playwright's Chromium renderer processes, in MB, sampled
 * from the OS: the worker runs inside a renderer, and no page API reports a
 * worker's memory. Null where `ps` cannot see them.
 */
function rendererRssMb(): number | null {
  try {
    const rows = execFileSync("ps", ["-A", "-o", "rss=,command="], { encoding: "utf8" })
      .split("\n")
      .filter((row) => /ms-playwright/.test(row) && /--type=renderer/.test(row));
    if (rows.length === 0) return null;
    return Math.round(rows.reduce((sum, row) => sum + Number.parseInt(row.trim(), 10), 0) / 1024);
  } catch {
    return null;
  }
}

function sampleRss() {
  const baseline = rendererRssMb();
  let peak = baseline;
  const timer = setInterval(() => {
    const now = rendererRssMb();
    if (now !== null && (peak === null || now > peak)) peak = now;
  }, 100);
  return () => {
    clearInterval(timer);
    return { baselineMb: baseline, peakMb: peak };
  };
}

test.afterAll(() => {
  mkdirSync(resolve(here, "../../test-results"), { recursive: true });
  writeFileSync(
    resolve(here, "../../test-results/archbot-browser-report.json"),
    JSON.stringify(report, null, 1),
  );
});

test("the production worker matches production Stage 5B exactly on the whole corpus", async ({
  page,
  browser,
}) => {
  report.browser = `${browser.browserType().name()} ${browser.version()}`;
  await open(page);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
  const mismatches: string[] = [];
  for (const item of corpus.cases) {
    const result = await decide(page, item.request);
    expect(result.ok, `${item.id}: ${result.code}`).toBe(true);
    if (result.digest !== item.expected.digest) mismatches.push(item.id);
    expect(result.move, item.id).toEqual(item.expected.move);
    (report.cases as unknown[]).push({
      id: item.id,
      tags: item.tags,
      legalMoves: result.legalMoves,
      browserWallMs: Math.round(result.wallMs!),
      nodeOracleMs: item.expected.oracleMs,
      maxFrameGapMs: Math.round(result.responsiveness.maxFrameGapMs),
      maxTimerLagMs: Math.round(result.responsiveness.maxTimerLagMs),
      parity: result.digest === item.expected.digest,
    });
  }
  expect(mismatches).toEqual([]);
});

test("model load: cold, then from the HTTP cache in a new worker", async ({ page }) => {
  await open(page);
  const opening = byId("selfplay-11-000");
  const cold = await decide(page, opening.request);
  expect(cold.ok).toBe(true);
  expect(cold.phases?.map((p) => p.phase)).toEqual(["loading_model", "thinking"]);
  const warm = await decide(page, opening.request);
  expect(warm.modelMs).toBe(cold.modelMs); // the same worker: loaded once
  expect(warm.phases?.map((p) => p.phase)).toEqual(["thinking"]);
  await page.evaluate(() => (window as unknown as { archbot: { reset(): void } }).archbot.reset());
  const cached = await decide(page, opening.request);
  report.modelLoad = {
    coldModelMs: Math.round(cold.modelMs!),
    coldFirstDecisionTotalMs: Math.round(cold.totalMs),
    warmDecisionTotalMs: Math.round(warm.totalMs),
    newWorkerHttpCachedModelMs: Math.round(cached.modelMs!),
  };
});

test("the page stays responsive through the heaviest positions", async ({ page }) => {
  await open(page);
  await decide(page, byId("selfplay-11-000").request); // model loaded
  const heavy: Record<string, unknown> = {};
  for (const id of ["selfplay-59-003", "opening-two-blanks-two-choices-b"]) {
    const stopSampling = sampleRss();
    const result = await decide(page, byId(id).request);
    const rendererRss = stopSampling();
    // Freed worker memory reaches the OS lazily; look again a moment later.
    await page.waitForTimeout(5_000);
    const settledMb = rendererRssMb();
    expect(result.ok).toBe(true);
    expect(result.digest).toBe(byId(id).expected.digest);
    // Frames kept coming while the worker searched for seconds.
    expect(result.responsiveness.frames).toBeGreaterThan(result.wallMs! / 50);
    heavy[id] = {
      wallMs: Math.round(result.wallMs!),
      legalMoves: result.legalMoves,
      maxFrameGapMs: Math.round(result.responsiveness.maxFrameGapMs),
      maxTimerLagMs: Math.round(result.responsiveness.maxTimerLagMs),
      rendererRss: { ...rendererRss, fiveSecondsLaterMb: settledMb },
      memory: await page.evaluate(() =>
        (window as unknown as { archbot: { memory(): Promise<unknown> } }).archbot.memory(),
      ),
    };
  }
  report.heavy = heavy;
});

test("cancelling a running search stops it and the next search still works", async ({ page }) => {
  await open(page);
  await decide(page, byId("selfplay-11-000").request);
  const cancelled = await decide(page, byId("selfplay-59-003").request, { cancelAfterMs: 300 });
  expect(cancelled).toMatchObject({ ok: false, code: "cancelled" });
  expect(cancelled.totalMs).toBeLessThan(1_500);
  const next = await decide(page, byId("selfplay-23-005").request);
  expect(next.ok).toBe(true);
  expect(next.digest).toBe(byId("selfplay-23-005").expected.digest);
  report.cancellation = { cancelledAfterMs: Math.round(cancelled.totalMs), nextOk: next.ok };
});

test("a missing model makes ArchBot unavailable, and nothing is decided", async ({ page }) => {
  await page.route("**/models/archbot/**/weights.bin", (route) => route.fulfill({ status: 404 }));
  await open(page);
  const result = await decide(page, byId("selfplay-11-000").request);
  expect(result).toMatchObject({
    ok: false,
    code: "model_unavailable",
    modelCode: "model_fetch_failed",
  });
});

test("an altered model is refused, and nothing is decided", async ({ page }) => {
  const weights = readFileSync(resolve(here, "../../public/models/archbot/95ba8c0d/weights.bin"));
  weights[4096] ^= 0xff;
  await page.route("**/models/archbot/**/weights.bin", (route) =>
    route.fulfill({ status: 200, body: weights, contentType: "application/octet-stream" }),
  );
  await open(page);
  const result = await decide(page, byId("selfplay-11-000").request);
  expect(result).toMatchObject({
    ok: false,
    code: "model_unavailable",
    modelCode: "model_integrity",
  });
});
