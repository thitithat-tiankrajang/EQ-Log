// ── Will Super thread on THIS device? ────────────────────────────────────────
//
// A page rather than a test, because the devices that matter cannot run the test
// suite: a phone, a tablet, somebody's work laptop with a policy that withholds
// SharedArrayBuffer. Everything it needs to say, it says on screen, so the
// answer survives being read off a photograph of a handset.
//
// It answers three questions in order, and the order matters:
//
//   1. can this browser have SharedArrayBuffer at all (is the page isolated),
//   2. does the threaded module INSTANTIATE — which on WebKit means: do nested
//      workers work, since the engine already lives in one,
//   3. does it then compute the same answer as everything else.
//
// (3) is the one that would otherwise be assumed. A module that starts and
// returns a different move is worse than one that refuses to start.
import { planSuperThreads, readThreadEnvironment } from "../../src/bot/superThreads";
import type { SuperEngineRequest } from "../../src/bot/superTypes";

const out = document.getElementById("out")!;
const lines: string[] = [];
const say = (line: string) => {
  lines.push(line);
  out.textContent = lines.join("\n");
};
const ok = (yes: boolean) => (yes ? "YES" : "NO");

/** A small capped search. The point here is agreement, not strength: every
 *  device runs the full 160 in a real game, and a 4-sample run is enough to
 *  prove this build computes what the others compute. */
const PROBE: SuperEngineRequest & { sampleCap: number; threads?: number } = {
  board: [
    { r: 7, c: 7, kind: "8", token: "8" },
    { r: 7, c: 8, kind: "+", token: "+" },
    { r: 7, c: 9, kind: "9", token: "9" },
    { r: 7, c: 10, kind: "=", token: "=" },
    { r: 7, c: 11, kind: "17", token: "17" },
  ],
  rack: ["2", "5", "11", "x", "-", "=", "3", "0"],
  bagCount: 46,
  oppRackCount: 8,
  myScore: 74,
  oppScore: 66,
  noScoreStreak: 0,
  exchangeAllowed: true,
  difficulty: "super",
  solver: "sim",
  unlimited: true,
  sampleCap: 4,
  topN: 4,
  seed: 20260827,
};

type Engine = {
  _engine_handle(ptr: number): number;
  _engine_alloc(size: number): number;
  _engine_free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(text: string, ptr: number, max: number): void;
  lengthBytesUTF8(text: string): number;
};

function run(engine: Engine, request: unknown) {
  const text = JSON.stringify(request);
  const bytes = engine.lengthBytesUTF8(text) + 1;
  const inPtr = engine._engine_alloc(bytes);
  engine.stringToUTF8(text, inPtr, bytes);
  const outPtr = engine._engine_handle(inPtr);
  const answer = JSON.parse(engine.UTF8ToString(outPtr)) as {
    equity: number;
    score: number;
    type: string;
    stats: { samples: number; nodes: number };
  };
  engine._engine_free(inPtr);
  if (outPtr) engine._engine_free(outPtr);
  return answer;
}

(async () => {
  const env = readThreadEnvironment();
  const plan = planSuperThreads(env);
  say(`UA        ${navigator.userAgent}`);
  say(`isolated  ${ok(env.crossOriginIsolated === true)}`);
  say(`SAB       ${ok(env.sharedArrayBuffer === true)}`);
  say(`cores     ${env.cores ?? "not reported"}`);
  say(`memory    ${env.memoryGb != null ? `${env.memoryGb} GB` : "not reported"}`);
  say(`plan      ${plan.threads} thread(s), threaded=${ok(plan.threaded)} — ${plan.reason}`);
  say("");

  // The single-threaded module is the floor: if this fails, the device gets no
  // client-side Super at all and falls back to the backend engine.
  let single: { equity: number; nodes: number } | null = null;
  try {
    say("single-threaded module: loading…");
    (globalThis as Record<string, unknown>).__amathThreads = 1;
    const create = (await import("../../src/bot/engine/amath_engine.mjs")).default;
    const engine = (await create()) as unknown as Engine;
    const answer = run(engine, PROBE);
    single = { equity: answer.equity, nodes: answer.stats.nodes };
    say(`single-threaded module: OK — equity ${answer.equity}, nodes ${answer.stats.nodes}`);
  } catch (error) {
    say(`single-threaded module: FAILED — ${error instanceof Error ? error.message : String(error)}`);
  }
  say("");

  if (!plan.threaded) {
    say("threaded module: not attempted — this device runs the single-threaded engine.");
    say("");
    say("Super still runs the FULL 160-sample search here. It just takes longer.");
    return;
  }

  // The interesting one on WebKit: the engine already runs inside a Worker, and
  // pthreads spawn Workers from there. Nested workers are the thing to find out
  // about, and instantiation is where it would fail.
  try {
    say(`threaded module (${plan.threads} threads): loading…`);
    (globalThis as Record<string, unknown>).__amathThreads = plan.threads;
    const create = (await import("../../src/bot/engine/amath_engine_mt.mjs")).default;
    const engine = (await create()) as unknown as Engine;
    say("threaded module: instantiated — nested workers work here");
    const answer = run(engine, { ...PROBE, threads: plan.threads });
    say(`threaded module: OK — equity ${answer.equity}, nodes ${answer.stats.nodes}`);
    if (single) {
      const agrees = single.equity === answer.equity && single.nodes === answer.stats.nodes;
      say("");
      say(
        agrees
          ? "AGREEMENT: both modules returned the same equity and the same node count."
          : "DISAGREEMENT: the two modules did not return the same answer. Do not ship this.",
      );
    }
  } catch (error) {
    say(`threaded module: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    say("");
    say("This device falls back to the single-threaded engine and still runs the");
    say("FULL 160-sample search. The only consequence is a longer wait.");
  }
})();
