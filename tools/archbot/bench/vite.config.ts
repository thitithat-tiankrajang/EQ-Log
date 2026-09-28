// Production build of the ArchBot browser harness: the shipped worker and model,
// built by the same Vite/esbuild pipeline and module-worker format as the app,
// served with the same cross-origin isolation headers. Used by
// playwright.archbot.config.ts for browser parity and benchmarks; never deployed.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: here,
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  worker: { format: "es" },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    // Diagnostic switch: rule the minifier in or out of a parity question.
    ...(process.env.ARCHBOT_BENCH_NO_MINIFY ? { minify: false } : {}),
  },
  preview: { headers, host: "127.0.0.1", port: 4373, strictPort: true },
  server: { headers },
});
