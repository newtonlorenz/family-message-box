import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/data/**",
      "**/.pio/**",
      "**/.worktrees/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/work/**",
      "firmware/enclosure/exports/**",
      "firmware/enclosure/print-ready/**",
      "firmware/enclosure/sd-card-ready/**",
      "output/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
    }
  },
  {
    files: ["apps/admin/src/**/*.tsx"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { "no-undef": "off" }
  },
  {
    files: ["scripts/**/*.mjs", "firmware/enclosure/**/*.mjs"],
    languageOptions: {
      globals: { Buffer: "readonly", console: "readonly", process: "readonly", URL: "readonly" }
    }
  }
);
