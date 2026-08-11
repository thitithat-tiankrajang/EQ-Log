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
      // Emscripten output. A generated artifact kept for engine regression
      // comparison — see tools/engine-wasm/README.md. Not application code and
      // not worth linting.
      "tools/engine-wasm/amath_engine.mjs",
      // The browser worker that used to drive that WASM build. Dead in
      // production, kept beside the artifact it belongs to.
      "tools/engine-wasm/engineWorker.ts",
      "tools/engine-wasm/wasm.d.ts",
      "src/App.tsx",
      "src/bot/**",
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
    // Development scripts, run by Node directly rather than bundled.
    files: ["tools/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
