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
