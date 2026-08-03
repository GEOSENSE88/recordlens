import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./github-pages", import.meta.url)),
  base: "/recordlens/",
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
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
