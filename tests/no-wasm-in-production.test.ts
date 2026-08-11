// The migration's headline claim, asserted rather than assumed:
// the engine implementation is not shipped to the browser.
//
// This is checked three ways, because each catches a different regression:
//
//   1. the built bundle contains no engine,
//   2. no application module imports one, and
//   3. the bot path reaches the engine over HTTP instead of instantiating one.
//
// (1) is the property that actually matters, but it only holds if `dist/` is
// current, so (2) and (3) hold the line on every run.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

/** Symbols that only exist in an Emscripten build of this engine. Matching any
 *  of them in shipped output means the engine came along. */
const ENGINE_MARKERS = [
  "_engine_handle",
  "_engine_alloc",
  "_engine_free",
  "amath_engine",
  "__amathProgress",
];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe("the production bundle", () => {
  const distFiles = walk(join(root, "dist")).filter(
    (path) => path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".wasm"),
  );

  it.runIf(distFiles.length > 0)("carries no compiled engine", () => {
    const offenders: string[] = [];
    for (const path of distFiles) {
      const source = readFileSync(path, "utf8");
      for (const marker of ENGINE_MARKERS) {
        if (source.includes(marker)) offenders.push(`${path} contains "${marker}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it.runIf(distFiles.length > 0)("ships no WebAssembly at all", () => {
    expect(distFiles.filter((path) => path.endsWith(".wasm"))).toEqual([]);
  });
});

describe("the application module graph", () => {
  const sourceFiles = walk(join(root, "src")).filter(
    (path) => /\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts"),
  );

  it("has no module that imports the WASM engine", () => {
    // Vite bundles what is reachable from src/. While the artifact lived in
    // src/bot/, only the absence of an import kept a 252 KB engine out of
    // production — and an import is one autocomplete away.
    const offenders = sourceFiles.filter((path) => {
      const source = readFileSync(path, "utf8");
      return /from\s+["'][^"']*amath_engine/.test(source) || source.includes("engineWorker");
    });
    expect(offenders).toEqual([]);
  });

  it("constructs no Web Worker for the engine", () => {
    const offenders = sourceFiles.filter((path) =>
      /new\s+Worker\s*\(/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the WASM artifact outside the bundled source tree", () => {
    // Kept for engine regression comparison, deliberately somewhere Vite does
    // not resolve. See tools/engine-wasm/README.md.
    expect(existsSync(join(root, "tools/engine-wasm/amath_engine.mjs"))).toBe(true);
    expect(existsSync(join(root, "src/bot/amath_engine.mjs"))).toBe(false);
  });

  it("reaches the engine over HTTP from the bot path", () => {
    const controller = readFileSync(join(root, "src/bot/botController.ts"), "utf8");
    expect(controller).toContain("engineApi");
    const api = readFileSync(join(root, "src/bot/engineApi.ts"), "utf8");
    expect(api).toContain("fetch(");
    expect(api).toContain("/bot-move");
  });
});

describe("the engine still builds for regression comparison", () => {
  // Removing the WASM target would remove the only independent check on the
  // native build. The target must survive the migration even though production
  // no longer uses it.
  it("keeps a wasm build target in the engine Makefile", () => {
    const makefile = join(root, "../amath-engine/Makefile");
    if (!existsSync(makefile)) return;
    const source = readFileSync(makefile, "utf8");
    expect(source).toMatch(/^wasm:/m);
    // And it deploys to the tools directory, not back into src/.
    expect(source).toContain("tools/engine-wasm/amath_engine.mjs");
    expect(source).not.toContain("EQ-Lab/src/bot/amath_engine.mjs");
  });

  it("keeps the native CLI, benchmarks and golden corpus generator", () => {
    const cli = join(root, "../amath-engine/src/cli.cpp");
    if (!existsSync(cli)) return;
    const source = readFileSync(cli, "utf8");
    for (const mode of ["bench", "selfplay", "golden", "request", "worker"]) {
      expect(source).toContain(`mode == "${mode}"`);
    }
  });
});

// A whole human-vs-AI game is NOT asserted here, deliberately.
//
// `amath_cli selfplay` is the natural way to play one, but the engine's
// `configFor` ignores the difficulty string entirely — strength is steered by
// `budgetMs`, which selfplay does not send — so every move runs at the full
// 120-second midgame ceiling and one game takes over an hour. A measured run
// was cut off at 11 minutes having played a handful of moves.
//
// Rather than ship a test nobody will run, whole-game coverage stays where it
// can actually be exercised:
//
//   • `make test-bot` in the engine repository (engine-vs-engine, full rules,
//     rejects any illegal move), and
//   • the per-turn integration path here — bot move → validator → commit —
//     which is what a game is a repetition of.
//
// This is a real gap and is reported as one rather than papered over.
