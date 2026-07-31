import { spawn } from "node:child_process";
import { once } from "node:events";

const port = "4173";
const baseUrl = `http://127.0.0.1:${port}`;
const pageUrl = `${baseUrl}/gwase-teuk-checker/`;
const server = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "preview",
    "--config",
    "vite.pages.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const deadline = Date.now() + 15_000;

try {
  let pageResponse;

  while (Date.now() < deadline) {
    try {
      pageResponse = await fetch(pageUrl);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  if (!pageResponse?.ok) {
    throw new Error(`GitHub Pages preview did not return HTTP 200.\n${output}`);
  }

  const html = await pageResponse.text();
  const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
    (match) => match[1],
  );

  if (assetPaths.length < 2) {
    throw new Error("GitHub Pages build did not include JavaScript and CSS assets.");
  }

  for (const assetPath of assetPaths) {
    const response = await fetch(new URL(assetPath, baseUrl));
    if (!response.ok) {
      throw new Error(`Static asset failed to load: ${assetPath}`);
    }
  }

  console.log(`GitHub Pages smoke test passed: HTTP ${pageResponse.status}`);
} finally {
  server.kill();
  await once(server, "exit");
}
