import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 내장 맞춤법 사전과 엠스크립튼 엔진(외부 산출물)은 검사하지 않는다.
    "public/dict/**",
    "pages-dist/**",
  ]),
]);

export default eslintConfig;
