import { defineConfig } from "vite";

/**
 * This project ran without a Vite config for a long time, and everything in it
 * is still on the default. One thing had to change.
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
 * Nothing else is configured here on purpose. Every other default is what this
 * project has been building with, and a config file is a good place to
 * accidentally change three things while fixing one.
 */
export default defineConfig({
  worker: { format: "es" },
});
