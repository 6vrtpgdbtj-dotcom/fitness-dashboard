import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  tseslint.configs.recommended,
  nextPlugin.flatConfig.recommended,
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts", ".playwright-cli/**", "output/playwright/**", "outputs/**"]
  }
);
