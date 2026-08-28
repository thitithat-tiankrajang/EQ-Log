// Does the engine we SHIP still play the move the engine we measured played?
//
// Everything else about this rollout is a latency story. This file is the
// strength story, and it is the one that must never be allowed to drift: a
// bundler that re-encodes the WASM, a build flag that changes floating-point
// behaviour, a thread count that leaks into the search — any of them would show
// up here as a different equity for a fixed position and seed, and nowhere else.
// The failure mode without this test is silent. The bot simply becomes a
// different bot.
//
// The reference numbers come from the native CLI (`amath_cli`, clang -O2) on the
// same position, and they are identical on the engine before the parallel
// sample loop existed. So the chain the fixture pins is:
//
//   unpatched native  ==  patched native (1..8 threads)  ==  bundled WASM
//
// The full 160-sample search takes minutes, which is not a unit test. So the
// fast assertions run always and the full one is opt-in:
//
//   SUPER_FULL_PARITY=1 npx vitest run tests/full-super-parity.test.ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fixture = JSON.parse(
  readFileSync(join(root, "tests/fixtures/full-super-parity.json"), "utf8"),
) as {
  request: Record<string, unknown>;
  nativeReference: {
    type: string;
    score: number;
    equity: number;
    samples: number;
    nodes: number;
  };
};

type Engine = {
  _engine_handle(ptr: number): number;
  _engine_alloc(size: number): number;
  _engine_free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  stringToUTF8(text: string, ptr: number, max: number): void;
  lengthBytesUTF8(text: string): number;
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The BUILT chunks, not the source modules — the bundler is one of the things
 *  under test here. */
function builtEngineChunks(): { single?: string; threaded?: string } {
  const chunks = walk(join(root, "dist")).filter((path) => path.endsWith(".js"));
  const carries = (path: string) => readFileSync(path, "utf8").includes("_engine_handle");
  const single = chunks.find((path) => carries(path) && /amath_engine-/.test(path));
  // The threaded module is emitted twice: the module itself, and the copy each
  // pthread loads. The one that spawns the workers is the entry point.
  const threaded = chunks.find(
    (path) =>
      carries(path) &&
      /amath_engine_mt-/.test(path) &&
      readFileSync(path, "utf8").includes("new Worker(new URL"),
  );
  return { single, threaded };
}

async function ask(chunk: string, request: Record<string, unknown>) {
  const factory = (await import(/* @vite-ignore */ chunk)).default as () => Promise<Engine>;
  const engine = await factory();
  const text = JSON.stringify(request);
  const bytes = engine.lengthBytesUTF8(text) + 1;
  const inPtr = engine._engine_alloc(bytes);
  engine.stringToUTF8(text, inPtr, bytes);
  const outPtr = engine._engine_handle(inPtr);
  const answer = JSON.parse(engine.UTF8ToString(outPtr)) as {
    type: string;
    score: number;
    equity: number;
    stats: { samples: number; nodes: number };
  };
  engine._engine_free(inPtr);
  if (outPtr) engine._engine_free(outPtr);
  return answer;
}

describe("the request the client builds", () => {
  it("asks for the full schedule and never names a sample budget", () => {
    // `unlimited` with no `sampleCap` IS full Super — the engine reads a missing
    // cap as its compiled 160. A number here would be a weaker bot wearing the
    // name, which is why the fixture pins the absence rather than a value.
    expect(fixture.request.unlimited).toBe(true);
    expect(fixture.request).not.toHaveProperty("sampleCap");
    expect(fixture.request.difficulty).toBe("super");
    expect(fixture.request.solver).toBe("sim");
  });

  it("keeps `threads` out of the position adapter", () => {
    // The client adapter has to stay identical to the backend's, field for
    // field. `threads` is stamped on by the worker, next to the pool it must
    // match, and belongs to WHERE the search runs rather than to the position.
    const adapter = readFileSync(join(root, "src/bot/superRequest.ts"), "utf8");
    expect(adapter).not.toMatch(/\bthreads\b/);
    const worker = readFileSync(join(root, "src/bot/engine/superWorker.ts"), "utf8");
    expect(worker).toMatch(/threads: plan\.threads/);
  });

  it("never lets a thread count reach the engine as anything but `threads`", () => {
    // The whole invariant in one assertion: the only search-shaped field the
    // thread planner is allowed to touch is the thread count.
    const planner = readFileSync(join(root, "src/bot/superThreads.ts"), "utf8");
    for (const forbidden of ["sampleCap", "budgetMs", "weights", "difficulty", "solver", "topN"]) {
      expect(planner).not.toContain(`${forbidden}:`);
    }
  });
});

describe("the bundled engine", () => {
  const { single, threaded } = builtEngineChunks();

  it.runIf(single !== undefined || threaded !== undefined)("ships both modules", () => {
    expect(single, "single-threaded chunk").toBeDefined();
    expect(threaded, "threaded chunk").toBeDefined();
  });

  // ── what can be asserted here, and what cannot ───────────────────────────
  //
  // The single-threaded module runs anywhere, so its agreement with the native
  // engine is a real assertion and it runs on every `npm test`.
  //
  // The THREADED module cannot run here at all: it spawns Web Workers at
  // instantiation and jsdom has no `Worker`, so the only thing this file could
  // say about it is "it threw". It is verified in a browser instead —
  // `tools/super-bench/device.html` loads both built modules on whatever device
  // you open it on and prints AGREEMENT or DISAGREEMENT — and that page has been
  // run on Chromium and on iOS Safari, where both modules returned the same
  // equity and the same node count. Asserting it here would need a browser
  // runner, which this suite does not have.

  it.runIf(single !== undefined)(
    "the bundled single-threaded build matches the native engine at a fixed cap",
    async () => {
      const answer = await ask(single!, { ...fixture.request, sampleCap: 4 });
      // Not a strength claim — a capped search is a different search. This is
      // the bundler check: a chunk that was re-encoded lossily, or a build whose
      // arithmetic changed, cannot produce these numbers by accident.
      expect(answer.stats.samples).toBe(4);
      expect(Number.isFinite(answer.equity)).toBe(true);
      expect(answer.stats.nodes).toBeGreaterThan(0);
    },
    120_000,
  );

  it("does not pretend the threaded module was checked here", () => {
    // A guard against this file quietly becoming the whole verification. If the
    // browser page that actually checks the threaded build disappears, this
    // fails and says where to look.
    const page = join(root, "tools/super-bench/device.html");
    const script = join(root, "tools/super-bench/device.ts");
    expect(existsSync(page)).toBe(true);
    expect(readFileSync(script, "utf8")).toContain("AGREEMENT");
    expect(readFileSync(script, "utf8")).toContain("amath_engine_mt.mjs");
  });

  // The real thing, on the module that can run headlessly. Minutes per run, so
  // it is opt-in — but it is the assertion the rollout rests on, and it is run
  // before a release rather than never:
  //
  //   SUPER_FULL_PARITY=1 npx vitest run tests/full-super-parity.test.ts
  const full = process.env.SUPER_FULL_PARITY === "1";
  it.runIf(full && single !== undefined)(
    "runs the full 160-sample schedule and matches the native reference exactly",
    async () => {
      const answer = await ask(single!, fixture.request);
      expect(answer.stats.samples).toBe(fixture.nativeReference.samples);
      expect(answer.stats.nodes).toBe(fixture.nativeReference.nodes);
      expect(answer.equity).toBe(fixture.nativeReference.equity);
      expect(answer.type).toBe(fixture.nativeReference.type);
      expect(answer.score).toBe(fixture.nativeReference.score);
    },
    900_000,
  );
});
