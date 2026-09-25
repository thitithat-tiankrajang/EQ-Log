import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, type Plugin } from "vite";

/**
 * This project ran without a Vite config for a long time, and everything in it
 * is still on the default. Two things had to change.
 *
 * ── 1. Module workers ───────────────────────────────────────────────────────
 *
 * `worker.format` defaults to `"iife"`, and an IIFE cannot be code-split. The
 * Super engine's Web Worker (`src/bot/engine/superWorker.ts`) reaches the ~250 KB
 * WASM module through a dynamic `import()` precisely so that the engine is a
 * chunk fetched when a Super game starts rather than part of anyone's first
 * load — and the build fails outright rather than silently inlining it:
 *
 *   Invalid value "iife" for option "worker.format" —
 *   UMD and IIFE output formats are not supported for code-splitting builds.
 *
 * Module workers are the only format that can do it. Browser support is
 * Chrome 80+, Safari 15+, Firefox 114+; anything older fails to construct the
 * worker, `superEngine`'s `onerror` fires, and that game's Super turns fall
 * back to the backend engine — which is exactly what the fallback is for.
 *
 * ── 2. Cross-origin isolation ───────────────────────────────────────────────
 *
 * The threaded engine (`amath_engine_mt.mjs`, two to four times faster on the
 * same search) needs `SharedArrayBuffer`, and a browser only hands that out to
 * a cross-origin-isolated page. Without these headers `crossOriginIsolated` is
 * false, `superThreads.ts` reports "page is not cross-origin isolated", and
 * every device runs the single-threaded module — correctly, just slowly.
 *
 * **These headers are dev-server and preview only. Production hosting still has
 * to send them, and as of this commit it does not.** Until it does, the
 * threaded engine is unreachable in production by construction, which is the
 * safe direction for it to be wrong in: the fallback is the module that has
 * always shipped.
 *
 * The blast radius was checked before adding them, because COEP breaks any
 * cross-origin subresource that does not opt in:
 *
 *   index.html          same-origin only (/icons, /manifest.webmanifest)
 *   Supabase            CORS `fetch`, which `require-corp` allows
 *   Google sign-in      `signInWithOAuth` with `redirectTo` — a full-page
 *                       redirect, so `COOP: same-origin` severing `opener` costs
 *                       nothing. A popup + postMessage flow would NOT survive.
 *
 * Anything added later that loads a cross-origin image, font or script has to
 * carry `Cross-Origin-Resource-Policy` or it will stop loading here first.
 *
 * Nothing else is configured here on purpose. Every other default is what this
 * project has been building with, and a config file is a good place to
 * accidentally change three things while fixing one.
 */
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

type LocalToolApi = {
  middleware: (req: unknown, res: unknown, next: () => void) => void;
  close: () => Promise<unknown>;
};

/**
 * DEV ONLY — a local tool's HTTP API, mounted into the dev server.
 *
 * Nothing is loaded until the first request under `mount`, so an ordinary
 * `npm run dev` starts none of these tools, and `vite build` never sees any of
 * it (`apply: "serve"`).
 */
function localToolApi(tool: {
  name: string;
  mount: string;
  /** Relative to this file. */
  module: string;
  /** The module's export that builds the API. */
  factory: string;
}): Plugin {
  const serverModule = resolve(fileURLToPath(new URL(".", import.meta.url)), tool.module);
  let api: Promise<LocalToolApi> | null = null;
  return {
    name: tool.name,
    apply: "serve",
    configureServer(server) {
      if (!existsSync(serverModule)) return;
      server.middlewares.use(tool.mount, (req, res, next) => {
        api ??= import(pathToFileURL(serverModule).href).then(
          (module: Record<string, () => LocalToolApi | Promise<LocalToolApi>>) =>
            module[tool.factory]!(),
        );
        api.then(
          (ready) => ready.middleware(req, res, next),
          (error: Error) => {
            api = null;
            res.statusCode = 503;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ error: `${tool.name} unavailable: ${error.message}` }));
          },
        );
      });
      server.httpServer?.once("close", () => void api?.then((ready) => ready.close()));
    },
  };
}

/**
 * The offline Survival playtest engine, at /survival-playtest.
 *
 * A Survival level is played on the Play page against a server that holds the
 * whole game (tools/survival-generator/playtest/server): the bag order and
 * Authur's rack never reach the browser. For now that server is this dev
 * server; `src/features/survivalPlay/api.ts` is the only thing that knows.
 */
const survivalPlaytest = localToolApi({
  name: "Survival playtest server",
  mount: "/survival-playtest",
  module: "tools/survival-generator/playtest/server/api.mjs",
  factory: "createPlaytestApi",
});

/**
 * Study puzzle sets for the admin page, at /study-puzzles.
 *
 * Runs the Find Best Play generator from the amath-engine checkout
 * (`AMATH_ENGINE_DIR`, else ../amath-engine) and keeps every set it makes in
 * tools/study-puzzles/archive/. `src/features/studyPuzzles/api.ts` is the only
 * thing in the app that knows.
 */
const studyPuzzles = localToolApi({
  name: "Study puzzle server",
  mount: "/study-puzzles",
  module: "tools/study-puzzles/server/api.mjs",
  factory: "createStudyPuzzleApi",
});

export default defineConfig({
  plugins: [survivalPlaytest, studyPuzzles],
  worker: { format: "es" },
  // Dev server only. ONNX Runtime is reached solely through a dynamic import in
  // the board-recognition worker, so Vite would otherwise discover it on the
  // first recognition, re-optimise, and RELOAD the page mid-import. Declaring
  // it up front avoids that; production builds are unaffected.
  optimizeDeps: { include: ["onnxruntime-web/wasm"] },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
