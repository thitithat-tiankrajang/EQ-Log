// Offline Survival playtest — its own Vite page. Local and disposable.
//
//   node node_modules/vite/bin/vite.js --config tools/survival-generator/playtest/vite.config.mjs
//   → http://127.0.0.1:5190/
//
// The page reuses EQ-Lab's Board / Rack / Tile and stylesheets straight from
// src/ (nothing there changes). The game lives in this dev server's Node process
// (server/api.mjs); the browser only ever receives the player's view.
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite bundles a config before running it; `import.meta.url` still names this file.
const here = fileURLToPath(new URL(".", import.meta.url));

function playtestApi() {
  let api = null;
  return {
    name: "survival-playtest-api",
    async configureServer(server) {
      // Loaded at runtime rather than bundled into the config, so the engine
      // (Authur, the rules bundles) runs as ordinary Node modules.
      const { createPlaytestApi } = await import(pathToFileURL(resolve(here, "server/api.mjs")).href);
      api = await createPlaytestApi();
      server.middlewares.use(api.middleware);
      server.httpServer?.once("close", () => api?.close());
      console.log(`  ➜  Survival playtest: ${api.levels.size} levels loaded and replay-verified`);
    },
  };
}

export default defineConfig({
  root: resolve(here, "ui"),
  // Its own dependency cache, so the app's dev server cache is left alone.
  cacheDir: resolve(here, "../out/playtest/.vite"),
  plugins: [react(), playtestApi()],
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  build: { outDir: resolve(here, "../out/playtest/build"), emptyOutDir: true },
  clearScreen: false,
});
