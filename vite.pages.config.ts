import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./github-pages", import.meta.url)),
  base: "/recordlens/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [
    react(),
    {
      /*
       * hunspell-asm 과 emscripten-wasm-loader 는 nanoid 를 네임스페이스로 불러
       * 함수처럼 호출한다(`import * as nanoid` 후 `nanoid(45)`). CommonJS 시절에는
       * 동작했지만 ESM 번들에서는 네임스페이스가 함수가 아니라서 브라우저에서
       * `t is not a function` 으로 사전 로딩이 통째로 실패한다. default import 로 바꾼다.
       */
      name: "fix-hunspell-nanoid-interop",
      transform(code: string, id: string) {
        if (!id.includes("hunspell-asm") && !id.includes("emscripten-wasm-loader")) return null;
        if (!code.includes("import * as nanoid")) return null;
        return code.replace("import * as nanoid from 'nanoid';", "import nanoid from 'nanoid';");
      },
    },
  ],
  build: {
    outDir: fileURLToPath(new URL("./pages-dist", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        /*
         * pdf.js 워커는 `.mjs` 로 배포된다. GitHub Pages를 비롯한 일부 정적 호스팅은
         * `.mjs` 를 자바스크립트가 아닌 형식으로 내려보내, 브라우저가 모듈 실행을 거부한다.
         * 내용은 그대로 두고 확장자만 `.js` 로 바꿔 내보낸다.
         */
        assetFileNames: (asset) =>
          asset.names?.some((name) => name.endsWith(".mjs"))
            ? "assets/[name]-[hash].js"
            : "assets/[name]-[hash][extname]",
      },
    },
  },
  resolve: {
    alias: {
      "@": projectRoot,
    },
  },
});
