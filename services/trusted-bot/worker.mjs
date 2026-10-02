// Private durable worker. No browser endpoint and no client-supplied position.
import { createClient } from "@supabase/supabase-js";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Default pins are the public, historically disclosed Authur in this tree. A
// private worker image replaces these files and bakes its own pins at
// AUTHUR_MANIFEST; every file below must be pinned there too.
const fingerprints = process.env.AUTHUR_MANIFEST
  ? JSON.parse(await readFile(process.env.AUTHUR_MANIFEST, "utf8"))
  : {
      "../../src/bot/authur/strong.mjs":
        "1bfe583051812453cd047894243ebe9b44ad0569ce977bcf28bd7ee2b533ee49",
      "models/next-turn.json": "e5af04452ede84e16aea6a52cdc582363b9b2efc90708966dcfc754b8c9be966",
      "models/reply-opponent.json":
        "6f502bf133ee2769a966ddc1b0cb219a54c0f7ac622aaba44c6aed5ac9632f7f",
      "models/reply-self.json": "b2ea60519c4566825250809a832557ac2e92f92256684b850e7219eec34b331a",
    };
for (const path of [
  "../../src/bot/authur/strong.mjs",
  "models/next-turn.json",
  "models/reply-opponent.json",
  "models/reply-self.json",
]) {
  const expected = fingerprints[path];
  const actual = createHash("sha256")
    .update(await readFile(new URL(path, import.meta.url)))
    .digest("hex");
  if (!/^[0-9a-f]{64}$/.test(expected ?? "") || actual !== expected)
    throw new Error("Pinned Authur artifact mismatch");
}
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secret = process.env.LIVE_BOT_SECRET;
if (!url || !serviceKey || !secret || secret.length < 32)
  throw new Error("Trusted bot configuration required");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

function decide(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [new URL("runtime.mjs", import.meta.url).pathname], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 360000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      try {
        if (code !== 0) throw new Error("Full-strength Authur did not complete");
        const proposal = JSON.parse(output);
        if (proposal.error) throw new Error("Authur refused position");
        resolve({
          type: proposal.type,
          placements: proposal.placements,
          exchange: proposal.exchange,
          metrics: proposal.metrics,
        });
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

let heartbeatStarted = false;
while (!stopping) {
  const claimed = await db.rpc("claim_live_bot_job");
  if (claimed.error) throw new Error("Trusted job claim failed");
  if (!heartbeatStarted) {
    heartbeatStarted = true;
    const heartbeat = () =>
      writeFile(
        "/tmp/live-bot-heartbeat",
        JSON.stringify({ pid: process.pid, at: Date.now() }),
      ).catch(() => undefined);
    await heartbeat();
    setInterval(() => void heartbeat(), 15000).unref();
    console.info(JSON.stringify({ event: "worker-ready" }));
  }
  const job = claimed.data?.[0];
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    continue;
  }
  console.info(
    JSON.stringify({ event: "bot-claimed", gameId: job.room_id, revision: job.revision }),
  );
  try {
    const observation = await fetch(`${url}/functions/v1/live-game`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "X-Live-Bot-Secret": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "bot-observation",
        jobId: job.id,
        leaseToken: job.lease_token,
      }),
    });
    if (!observation.ok) throw new Error("Trusted observation refused");
    const payload = await observation.json();
    // A prior commit with a lost acknowledgement is a receipt, not a new turn.
    if (payload.ok) continue;
    const move = await decide(payload.request);
    const result = await fetch(`${url}/functions/v1/live-game`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "X-Live-Bot-Secret": secret,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operation: "bot-result",
        jobId: job.id,
        leaseToken: job.lease_token,
        move,
      }),
    });
    if (!result.ok) throw new Error("Trusted bot commit refused");
    console.info(
      JSON.stringify({
        event: "bot-committed",
        engine: payload.engine ?? "authur",
        gameId: job.room_id,
        revision: job.revision,
        ...(move.metrics ? { metrics: move.metrics } : {}),
      }),
    );
  } catch {
    await db
      .from("live_bot_jobs")
      .update({ status: "failed" })
      .eq("id", job.id)
      .eq("lease_token", job.lease_token)
      .eq("status", "running");
    console.error(
      JSON.stringify({ event: "bot-failed", gameId: job.room_id, revision: job.revision }),
    );
  }
}
