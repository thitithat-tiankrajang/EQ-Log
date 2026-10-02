import { readFile } from "node:fs/promises";
const health = JSON.parse(await readFile("/tmp/live-bot-heartbeat", "utf8"));
if (!Number.isInteger(health.pid) || !Number.isFinite(health.at) || Date.now() - health.at > 90000)
  process.exit(1);
process.kill(health.pid, 0);
