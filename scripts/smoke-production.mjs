import { spawn } from "node:child_process";
import { once } from "node:events";

const port = "3100";
const server = spawn(
  process.execPath,
  ["node_modules/vinext/dist/cli.js", "start"],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: port,
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
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
  let response;

  while (Date.now() < deadline) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  if (!response?.ok) {
    throw new Error(`Production server did not return HTTP 200.\n${output}`);
  }

  console.log(`Production smoke test passed: HTTP ${response.status}`);
} finally {
  server.kill();
  await once(server, "exit");
}
