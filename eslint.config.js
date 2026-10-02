import js from "@eslint/js";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "coverage",
      "test-results",
      "playwright-report",
      "decode_game.mts",
      "export_turns.mts",
      // Emscripten output. Generated, shipped, and 250 KB of machine-written
      // JavaScript — see tools/engine-wasm/README.md for what it is and how it
      // gets here. Linting it would report thousands of findings about code
      // nobody edits.
      "src/bot/engine/amath_engine.mjs",
      // The cross-check harness. A development tool, not application code.
      "tools/engine-wasm/parity.mjs",
      "src/App.tsx",
      // Everything under src/bot except ArchBot, which is new code and is linted
      // (all but its generated core).
      "src/bot/*.ts",
      "src/bot/authur/**",
      "src/bot/engine/**",
      "src/bot/archbot/core/**",
      "src/codec.ts",
      "src/components/actions/**",
      "src/components/board/**",
      "src/components/game/**",
      "src/components/layout/**",
      "src/components/logs/**",
      "src/components/mobile/**",
      "src/components/modals/**",
      "src/components/rail/**",
      "src/components/replay/**",
      // Build output: the Edge Function ships the esbuild bundle of index.ts
      // (`npm run build:ranked`); index.ts is the source that is linted.
      "supabase/functions/**/index.js",
      // Local-only generated material (each directory ignores itself in git).
      "tools/survival-generator/.vendor/**",
      "tools/survival-generator/out/**",
      "tools/study-puzzles/archive/**",
      // The ArchBot browser harness build (playwright.archbot.config.ts).
      "tools/archbot/bench/dist/**",
      // The offline Survival level generator. It is never bundled or deployed,
      // has its own node:test suite, and its outstanding findings (unused
      // locals in experiment scripts) are left for the Survival owner.
      "tools/survival-generator/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "jsx-a11y": jsxA11y, "react-hooks": reactHooks },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    // Development scripts and local-stack tests, run by Node directly rather than bundled.
    files: ["tools/**/*.mjs", "supabase/tests/**/*.mjs", "services/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
