import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "node_modules/",
      ".wrangler/",
      "worker-configuration.d.ts",
      "eslint.config.mjs",
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // `tsc` already enforces noUnusedLocals/noUnusedParameters.
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  prettierConfig,
);
