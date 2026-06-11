// Workspace-wide ESLint flat config. Run from the root: pnpm lint
// Philosophy: catch real bugs (unused code, unsafe patterns), don't fight the
// codebase's established style (`as any` at framework boundaries, empty catch
// for fail-open cache paths).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/*.d.ts",
      // Archived 2026-04-16 — source frozen, not maintained
      "apps/mcp/**",
      "apps/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase deliberately uses `as any` at Fastify/Kysely boundaries
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Fail-open cache reads/writes use empty catch intentionally
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: nextPlugin.configs.recommended.rules,
  },
  {
    // Ops/analysis scripts are looser: console-driven, process.exit, etc.
    files: ["scripts/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
    },
  },
);
