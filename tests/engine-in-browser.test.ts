// The engine is back in the browser — on purpose, and on a leash.
//
// This file replaces `no-wasm-in-production.test.ts`, which asserted the
// opposite invariant. That invariant was right for the backend-engine era and
// is wrong now: the Super bot runs on the player's device, so the engine MUST
// reach the browser. What has to stay true is narrower and more useful:
//
//   1. it is not in the app's first load — it is a lazily fetched chunk,
//   2. nothing on the UI thread can call it — only the worker can,
//   3. it is reached through a dynamic import, never a static one, and
//   4. the backend engine path still exists, because it is the fallback.
//
// (1) is the property a player feels. Most sessions never play Super and must
// not pay 250 KB for it. (2) is the property a player feels even more sharply:
// one Super decision is a single uninterruptible call of tens of seconds, and
// on the UI thread that is a frozen tab, not a slow one.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

/** Symbols that only exist in an Emscripten build of this engine. */
const ENGINE_MARKERS = ["_engine_handle", "_engine_alloc", "_engine_free"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function carriesEngine(path: string): boolean {
  const source = readFileSync(path, "utf8");
  return ENGINE_MARKERS.some((marker) => source.includes(marker));
}

describe("the production bundle", () => {
  const distFiles = walk(join(root, "dist")).filter(
    (path) => path.endsWith(".js") || path.endsWith(".mjs"),
  );
  const indexHtml = join(root, "dist/index.html");

  it.runIf(distFiles.length > 0)("keeps the engine out of the first load", () => {
    // Whatever index.html names is downloaded before the app renders. The
    // engine must not be among it — not as a script, not as a modulepreload.
    const html = existsSync(indexHtml) ? readFileSync(indexHtml, "utf8") : "";
    const eagerlyLoaded = distFiles.filter((path) => {
      const name = path.split("/").pop()!;
      return html.includes(name);
    });
    const offenders = eagerlyLoaded.filter(carriesEngine);
    expect(offenders).toEqual([]);
  });

  // ── the bundled engine still RUNS ────────────────────────────────────────
  //
  // Every other assertion in this file is structural — where the engine sits in
  // the graph, who imports it. This one is different, and it exists because of
  // something the build actually does to the engine.
  //
  // The source module carries its WebAssembly as a raw binary string: NUL bytes,
  // high bytes, the lot. The BUILT chunk has no NUL bytes and is ~49 KB larger,
  // so the bundler plainly re-encodes it. That re-encoding is lossless today,
  // and nothing except this test would notice if a bundler upgrade, a minifier
  // setting or a stray text transform made it lossy.
  //
  // The failure would also be quiet in the worst way: a corrupted module throws
  // on instantiation, `superEngine`'s `onerror` fires, and every Super turn
  // falls back to the backend. No error reaches a player, no test fails, and the
  // client-side rollout is simply off while the flag says it is on.
  //
  // Instantiating alone is not enough — a truncated code section can still pass
  // validation — so this runs the calibration benchmark, which exercises real
  // move generation over a real position.
  it.runIf(distFiles.length > 0)(
    "instantiates and runs from the built chunk, not just from source",
    async () => {
      const chunk = distFiles.find(carriesEngine);
      expect(chunk).toBeDefined();

      const factory = (await import(/* @vite-ignore */ chunk!)).default as () => Promise<{
        _engine_handle(ptr: number): number;
        _engine_alloc(size: number): number;
        _engine_free(ptr: number): void;
        UTF8ToString(ptr: number): string;
        stringToUTF8(text: string, ptr: number, max: number): void;
        lengthBytesUTF8(text: string): number;
      }>;
      const engine = await factory();

      const text = JSON.stringify({ mode: "calibrate" });
      const bytes = engine.lengthBytesUTF8(text) + 1;
      const inPtr = engine._engine_alloc(bytes);
      engine.stringToUTF8(text, inPtr, bytes);
      const outPtr = engine._engine_handle(inPtr);
      const result = JSON.parse(engine.UTF8ToString(outPtr)) as {
        benchmark: string;
        nodes: number;
        nodesPerSec: number;
      };
      engine._engine_free(inPtr);
      if (outPtr) engine._engine_free(outPtr);

      // Real work happened: the benchmark is the one the client calibrates
      // against, and it visited the nodes it was asked to.
      expect(result.benchmark).toBe("gen-nodes-v1");
      expect(result.nodes).toBeGreaterThan(0);
      expect(result.nodesPerSec).toBeGreaterThan(0);
    },
    30_000,
  );

  it.runIf(distFiles.length > 0)("ships the engine as its own chunk", () => {
    // The counterpart to the assertion above: it has to be SOMEWHERE, or the
    // client-side bot cannot run and the first test would pass vacuously.
    expect(distFiles.filter(carriesEngine).length).toBeGreaterThan(0);
  });
});

describe("the application module graph", () => {
  const sourceFiles = walk(join(root, "src")).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts"),
  );

  it("lets only the worker reach the engine module", () => {
    const importers = sourceFiles.filter((path) =>
      /["'][^"']*amath_engine/.test(readFileSync(path, "utf8")),
    );
    expect(importers.map((path) => path.replace(`${root}/`, ""))).toEqual([
      "src/bot/engine/superWorker.ts",
    ]);
  });

  it("reaches the engine module by dynamic import only", () => {
    const worker = readFileSync(join(root, "src/bot/engine/superWorker.ts"), "utf8");
    // A static `import ... from "./amath_engine.mjs"` would fold the engine
    // into the worker's own chunk, which is fetched as soon as the worker is
    // constructed — undoing the laziness the first test asserts.
    expect(worker).toMatch(/await import\(["']\.\/amath_engine\.mjs["']\)/);
    expect(worker).not.toMatch(/^import .*amath_engine/m);
  });

  it("keeps the single-threaded module reachable as the floor", () => {
    // The threaded module is the faster one and the OPTIONAL one: it cannot
    // instantiate at all on a page that is not cross-origin isolated. If this
    // import ever disappears, every un-isolated browser loses Super to the
    // backend fallback rather than running it slowly, which is a much worse
    // trade than the one being made here.
    const worker = readFileSync(join(root, "src/bot/engine/superWorker.ts"), "utf8");
    expect(worker).toMatch(/await import\(["']\.\/amath_engine_mt\.mjs["']\)/);
    expect(worker).toContain("plan.threaded");
    expect(existsSync(join(root, "src/bot/engine/amath_engine.mjs"))).toBe(true);
    expect(existsSync(join(root, "src/bot/engine/amath_engine_mt.mjs"))).toBe(true);
  });

  it("sizes the pthread pool from the same number it sends the engine", () => {
    // The pool and the request's `threads` must be one number. Asking the engine
    // for more threads than the pool holds makes pthread_create reach for a
    // Worker that only the host worker's event loop could spawn — and that loop
    // is blocked inside the synchronous engine call for the whole search.
    const worker = readFileSync(join(root, "src/bot/engine/superWorker.ts"), "utf8");
    expect(worker).toContain("__amathThreads");
    // Both uses read the same plan object rather than recomputing.
    expect(worker).toMatch(/__amathThreads.*=.*plan\.threads/);
    expect(worker).toMatch(/threads: plan\.threads/);
  });

  it("constructs the engine worker in exactly one place", () => {
    const offenders = sourceFiles.filter((path) =>
      /new\s+Worker\s*\(/.test(readFileSync(path, "utf8")),
    );
    expect(offenders.map((path) => path.replace(`${root}/`, ""))).toEqual([
      "src/bot/superEngine.ts",
    ]);
  });

  it("never calls the engine from the UI thread", () => {
    // `_engine_handle` is synchronous and runs for tens of seconds. The only
    // module allowed to CALL it is the one running inside a worker.
    //
    // Comments are stripped first, and deliberately: `superEngine.ts` explains
    // at length why cancellation has to be a terminate, and that explanation
    // has to name the function it is about. A test that cannot tell a call from
    // a sentence would make the honest comment the thing that fails the build.
    const offenders = sourceFiles.filter((path) => {
      if (path.endsWith("src/bot/engine/superWorker.ts")) return false;
      const code = readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      return /_engine_handle\s*\(/.test(code);
    });
    expect(offenders.map((path) => path.replace(`${root}/`, ""))).toEqual([]);
  });

  it("cancels a local search by terminating the worker", () => {
    // There is no cooperative cancel across this boundary: while the engine's
    // synchronous call runs, the worker cannot read a "stop" message. If this
    // ever becomes a postMessage, stale searches will keep burning a player's
    // CPU after the position has moved on.
    const owner = readFileSync(join(root, "src/bot/superEngine.ts"), "utf8");
    expect(owner).toContain("terminate()");
  });
});

describe("the backend engine path", () => {
  it("is still reachable, because it is the fallback", () => {
    // Every client-side refusal — flag off, device too slow, worker failed,
    // pinned weights missing — lands here. Removing it would turn a slow
    // device into an unplayable room.
    const api = readFileSync(join(root, "src/bot/engineApi.ts"), "utf8");
    expect(api).toContain("fetch(");
    expect(api).toContain("/bot-move");
    const sessions = readFileSync(join(root, "src/engineSessions.ts"), "utf8");
    expect(sessions).toContain("shouldFallBackToBackend");
    expect(sessions).toContain("requestBotMove");
  });

  it("asks the server to check the legality of a device-computed move", () => {
    const client = readFileSync(join(root, "src/bot/clientSuper.ts"), "utf8");
    expect(client).toContain("validateBotMove");
  });
});

describe("the engine still builds both ways", () => {
  it("keeps a wasm build target that deploys into the bundled source tree", () => {
    const makefile = join(root, "../amath-engine/Makefile");
    if (!existsSync(makefile)) return;
    const source = readFileSync(makefile, "utf8");
    expect(source).toMatch(/^wasm:/m);
    expect(source).toMatch(/^wasm-mt:/m);
    expect(source).toContain("src/bot/engine/amath_engine.mjs");
    expect(source).toContain("src/bot/engine/amath_engine_mt.mjs");
    // The pool is sized at RUNTIME, not baked in: every pooled worker costs
    // ~12 MB the moment the module comes up, so a build-time 8 would charge a
    // two-core phone for six workers it will never schedule.
    expect(source).toContain("PTHREAD_POOL_SIZE='globalThis.__amathThreads||1'");
  });

  it("keeps the native CLI, benchmarks and golden corpus generator", () => {
    const cli = join(root, "../amath-engine/src/cli.cpp");
    if (!existsSync(cli)) return;
    const source = readFileSync(cli, "utf8");
    for (const mode of ["bench", "selfplay", "golden", "request", "worker", "positions"]) {
      expect(source).toContain(`mode == "${mode}"`);
    }
  });
});
