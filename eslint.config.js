// ESLint flat config. Adds a static-analysis gate on top of `tsc`, and — most
// importantly for this repo — enforces the architectural boundaries the project
// depends on: the two game boards must not import each other, so shared UI has
// to live in BoardParts (or the game core) rather than being copied across.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

const decoupleBoards = (sibling) => ({
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        {
          group: [`**/${sibling}`],
          message:
            "Keep the solo and online boards decoupled — put shared UI in BoardParts (or shared logic in the game core), don't import one board from the other.",
        },
      ],
    },
  ],
});

export default tseslint.config(
  {
    // The solo presentation hook keeps a few deliberate exhaustive-deps
    // disables as defensive documentation; don't nag when they're inert.
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    ignores: [
      "dist/**",
      "api/dist/**",
      "supabase/**", // Deno runtime + the committed engine bundle
      "e2e/**", // Playwright, its own runtime/tsconfig
      "**/*.mjs",
      "**/*.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // The codebase is otherwise clean; keep `any` visible without failing CI
      // (a handful of narrowly-scoped casts live at the network boundary).
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  {
    files: ["src/components/GameBoard.tsx"],
    rules: decoupleBoards("OnlineGameBoard"),
  },
  {
    files: ["src/components/OnlineGameBoard.tsx"],
    rules: decoupleBoards("GameBoard"),
  },
);
