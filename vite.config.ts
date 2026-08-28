import { defineConfig } from "vite";

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

export default defineConfig({
  worker: { format: "es" },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
