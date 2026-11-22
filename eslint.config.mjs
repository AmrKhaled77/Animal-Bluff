import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: { "no-undef": "off" },
  },
  {
    files: ["apps/web/**/*.{js,jsx,ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
