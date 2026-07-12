import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        chrome: "readonly",
        window: "readonly",
        navigator: "readonly",
        document: "readonly",
        alert: "readonly",
        setTimeout: "readonly",
        console: "readonly",
        URL: "readonly",
        JSON: "readonly",
        Map: "readonly",
        Set: "readonly",
        Promise: "readonly",
        String: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    ignores: ["node_modules/", "fonts/", "*.png"],
  },
];
