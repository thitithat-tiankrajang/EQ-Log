import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createManifest } from "../../amath-bot-lab/src/core/tiles";
import { envStateFrom } from "../../amath-bot-lab/src/env/state";
import { applyAction } from "../../amath-bot-lab/src/env/transition";
import { completeRootActions, decideStrong } from "../../amath-bot-lab/src/strong/selector";
import type { EnvState, LegalAction } from "../../amath-bot-lab/src/env/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/authur-endgame.json"), "utf8"),
);
const midgame = JSON.parse(
  await readFile(resolve(root, "tests/fixtures/authur-midgame.json"), "utf8"),
).snapshot;
const runtime = resolve(root, "../amath-engine/service/authur/runtime.mjs");
const output = resolve(root, "docs/survival-poc-results.json");

function random(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function seededPosition(seed: number): EnvState {
  const rackIds = [...fixture.racks.A, ...fixture.racks.B] as string[];
  const next = random(seed);
  for (let index = rackIds.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [rackIds[index], rackIds[swap]] = [rackIds[swap]!, rackIds[index]!];
  }
  return envStateFrom({
    manifest: createManifest(),
    board: fixture.board,
    racks: {
      A: rackIds.slice(0, fixture.racks.A.length),
      B: rackIds.slice(fixture.racks.A.length),
    },
    bag: [],
    scores: fixture.scores,
    activeSide: "A",
    turnNumber: fixture.turnNumber,
    noScoreTail: [],
    hasPlacement: true,
    seed,
  });
}

function kind(id: string): string {
  return id.slice(0, id.lastIndexOf("#"));
}

async function serverDecision(snapshot: typeof fixture) {
  const side = snapshot.activeSide as "A" | "B";
  const other = side === "A" ? "B" : "A";
  const request = {
    side,
    seed: snapshot.seed,
    board: snapshot.board.flatMap(
      (tile: { kind: string; face: string; side: string; turn: number } | null, cell: number) =>
        tile ? [{ ...tile, cell }] : [],
    ),
    rack: snapshot.racks[side].map(kind),
    ownPending: [],
    opponentRackCount: snapshot.racks[other].length,
    opponentPendingCount: 0,
    bagCount: snapshot.bag.length,
    scores: snapshot.scores,
    turnNumber: snapshot.turnNumber,
    noScoreTail: snapshot.noScoreTail,
  };
  return await new Promise<{ wallMs: number; engineMs: number; nodes: number; candidates: number }>(
    (resolveResult, reject) => {
      const start = performance.now();
      const child = spawn(process.execPath, [runtime], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`Authur server failed: ${stderr.slice(-500)}`));
        const answer = JSON.parse(stdout);
        resolveResult({
          wallMs: Math.round(performance.now() - start),
          engineMs: Math.round(answer.stats.elapsedMs),
          nodes: answer.stats.nodes,
          candidates: answer.candidates.length,
        });
      });
      child.stdin.end(JSON.stringify(request));
    },
  );
}

type Policy = "strong" | "greedy" | "top5" | "top20";
async function play(seed: number, policy: Policy, trial: number) {
  let state = seededPosition(seed);
  const actions: Array<{
    side: "A" | "B";
    id: string;
    type: string;
    score: number;
    move: LegalAction["action"];
  }> = [];
  const botTimes: number[] = [];
  const next = random(seed ^ (trial * 0x9e3779b1));
  for (let turn = 0; turn < 24 && !state.terminal; turn++) {
    const side = state.activeSide;
    let action: LegalAction["action"];
    let id: string;
    let score = 0;
    if (side === "B" || policy === "strong") {
      const start = performance.now();
      const decision = await decideStrong(state, seed * 10_000 + trial * 50 + turn, null);
      if (
        decision.cancelled ||
        !decision.trace.generationComplete ||
        decision.trace.spaceMapTruncated
      ) {
        throw new Error("Authur returned an incomplete decision");
      }
      if (side === "B") botTimes.push(performance.now() - start);
      action = decision.action;
      id = decision.id;
      score = decision.trace.chosenImmediateScore;
    } else {
      const rootActions = await completeRootActions(state);
      if (!rootActions.complete || rootActions.truncated)
        throw new Error("Incomplete human move set");
      const ranked = [...rootActions.places].sort(
        (a, b) => b.score - a.score || a.id.localeCompare(b.id),
      );
      const choices = ranked.slice(0, policy === "greedy" ? 1 : policy === "top5" ? 5 : 20);
      const picked = choices[Math.floor(next() * choices.length)] ?? rootActions.exchanges[0];
      action = picked?.action ?? { type: "pass" };
      id = picked?.id ?? "pass";
      score = picked?.score ?? 0;
    }
    actions.push({ side, id, type: action.type, score, move: action });
    state = applyAction(state, action).state;
  }
  if (!state.terminal) throw new Error("POC match did not finish within 24 turns");
  return {
    seed,
    policy,
    trial,
    win: state.scores.A > state.scores.B,
    scores: state.scores,
    turns: actions.length,
    actions,
    botTimes,
  };
}

const serverBenchmark = [];
for (const [name, snapshot] of [
  ["endgame", fixture],
  ["midgame", midgame],
] as const) {
  const result = await serverDecision(snapshot);
  serverBenchmark.push({ name, ...result });
  console.log(`${name}: ${result.wallMs} ms wall, ${result.engineMs} ms Authur`);
}

const policies: Policy[] = ["strong", "greedy", "top5", "top20"];
const minimumSurvivalTurns = 5;
const levels = [];
const seeds =
  process.argv.length > 2 ? process.argv.slice(2).map(Number) : [5093, 5094, 5095, 5096, 5097];
for (const seed of seeds) {
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`Invalid seed: ${seed}`);
  const results: Awaited<ReturnType<typeof play>>[] = [];
  for (const policy of policies) {
    for (let trial = 0; trial < 5; trial++) results.push(await play(seed, policy, trial));
  }
  const wins = results.filter((result) => result.win);
  const initial = seededPosition(seed);
  const openings = await completeRootActions(initial);
  if (!openings.complete || openings.truncated) throw new Error("Incomplete stage opening scan");
  // The fixture has an empty bag and no no-score tail; a first-turn win can
  // only end by emptying A's rack. Check every such legal opening, not a sample.
  const immediateWinningMoves = openings.places.filter((candidate) => {
    if (
      candidate.action.type !== "place" ||
      candidate.action.placements.length !== initial.racks.A.length
    )
      return false;
    const next = applyAction(initial, candidate.action).state;
    return next.terminal !== null && next.scores.A > next.scores.B;
  }).length;
  const longWins = wins.filter((result) => result.turns >= minimumSurvivalTurns);
  const distinctWins = [
    ...new Map(
      longWins.map((result) => [result.actions.map((action) => action.id).join(","), result]),
    ).values(),
  ];
  const replayEvidence = [
    ...distinctWins.slice(0, 3),
    ...longWins.filter((result) => !distinctWins.slice(0, 3).includes(result)),
  ].slice(0, 3);
  const botTimes = results.flatMap((result) => result.botTimes);
  const sortedTimes = [...botTimes].sort((a, b) => a - b);
  levels.push({
    level: levels.length + 1,
    seed,
    positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
    samplePolicy:
      "five trials each: Authur, greedy score, random top five score, random top twenty score",
    trials: results.length,
    wins: wins.length,
    distinctWinningPaths: distinctWins.length,
    immediateWinningMoves,
    minimumSurvivalTurns,
    observedWinRate: wins.length / results.length,
    byPolicy: Object.fromEntries(
      policies.map((policy) => {
        const subset = results.filter((result) => result.policy === policy);
        return [
          policy,
          { trials: subset.length, wins: subset.filter((result) => result.win).length },
        ];
      }),
    ),
    authurDecisionMs: {
      p50: Math.round(sortedTimes[Math.floor(sortedTimes.length * 0.5)] ?? 0),
      p95: Math.round(sortedTimes[Math.floor(sortedTimes.length * 0.95)] ?? 0),
      count: sortedTimes.length,
    },
    status:
      replayEvidence.length >= 3 && immediateWinningMoves === 0
        ? "awaiting_admin_approval"
        : "needs_multi_turn_evidence",
    winningReplays: replayEvidence.map(({ policy, trial, scores, actions }) => ({
      policy,
      trial,
      scores,
      actions,
    })),
  });
  console.log(
    `seed ${seed}: ${wins.length}/${results.length} wins; ${botTimes.length} Authur moves`,
  );
}
let previous: { levels?: typeof levels } = {};
try {
  previous = JSON.parse(await readFile(output, "utf8"));
} catch {
  /* first run */
}
const merged = new Map<number, (typeof levels)[number]>();
for (const level of previous.levels ?? []) merged.set(level.seed, level);
for (const level of levels) merged.set(level.seed, level);
const ranked = [...merged.values()]
  .sort(
    (a, b) =>
      Number(b.status === "awaiting_admin_approval" && b.immediateWinningMoves === 0) -
        Number(a.status === "awaiting_admin_approval" && a.immediateWinningMoves === 0) ||
      b.observedWinRate - a.observedWinRate ||
      a.seed - b.seed,
  )
  .map((level, index) => ({ ...level, level: index + 1 }));
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify(
    { measuredAt: new Date().toISOString(), serverBenchmark, levels: ranked },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${output}`);
