// @vitest-environment node
import { expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  call,
  env,
  player,
  policy,
  service,
  settings,
  sql,
} from "./live-security-browser/fixtures";

const enabled = Boolean(process.env.LIVE_SECURITY_STATUS_FILE);
const local = enabled ? it : it.skip;
const workerEnvFile = process.env.LIVE_SECURITY_WORKER_ENV_FILE;
const children = new Set<ChildProcess>();
async function until(check: () => Promise<boolean>, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Recovery condition did not complete");
}
function worker(configured = true) {
  if (configured && !workerEnvFile) throw new Error("Private local worker configuration required");
  const child = spawn(
    process.execPath,
    [...(configured ? [`--env-file=${workerEnvFile}`] : []), "services/trusted-bot/worker.mjs"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      detached: true,
      env: configured ? process.env : { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  children.add(child);
  return child;
}
function kill(child: ChildProcess) {
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* Already exited. */
    }
  }
  children.delete(child);
}
async function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", resolve));
}
async function job(id: string) {
  const result = await service.from("live_bot_jobs").select("*").eq("room_id", id).single();
  if (result.error) throw result.error;
  return result.data;
}
async function privateCall(operation: string, j: any, move?: unknown) {
  const secret = readFileSync(workerEnvFile!, "utf8").match(/^LIVE_BOT_SECRET=(.+)$/m)![1]!;
  const response = await fetch(`${env.API_URL}/functions/v1/live-game`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`,
      "X-Live-Bot-Secret": secret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operation, jobId: j.id, leaseToken: j.lease_token, move }),
  });
  return { status: response.status, body: await response.json() };
}

local.each(["authur"] as const)(
  "%s recovers initialization failure, crash, expired lease and lost acknowledgement without a browser or extra charge",
  async (engine) => {
    const owner = await player("plus");
    let id: string | undefined;
    try {
      const created = await call(owner, {
        operation: "create",
        settings: {
          ...settings(owner),
          botEngine: engine,
          botDifficulty: "super",
        },
        policy: policy("private"),
        requestId: crypto.randomUUID(),
        funding: engine === "authur" ? "allowance" : undefined,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      id = created.body.id;
      const started = await call(owner, { operation: "ready", id });
      const command = {
        operation: "action",
        id,
        revision: started.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      };
      const played = await call(owner, command);
      expect(played.status).toBe(200);
      expect(played.body.match.botTurn).toBe(true);
      const revision = played.body.match.revision;
      const funding = () =>
        sql(`select count(*) from public.probot_consumptions where room_id='${id}'`);
      expect(funding()).toBe("1");
      expect((await job(id!)).status).toBe("queued");

      // Fail before claiming any work. No browser read or retry is needed afterwards.
      const invalid = worker(false);
      expect(await exitCode(invalid)).not.toBe(0);
      kill(invalid);
      expect((await job(id!)).status).toBe("queued");
      expect((await call(owner, command)).status).toBe(200);

      // A process dies while holding a real lease. Kill the process group, including
      // its engine child; simulate passage of the production ten-minute lease.
      const first = worker();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Worker never claimed the game")), 30000);
        first.stdout!.on("data", (chunk) => {
          if (String(chunk).includes('"bot-claimed"') && String(chunk).includes(id!)) {
            kill(first);
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      const old = await job(id!);
      expect(old.status).toBe("running");
      expect(sql(`select revision from public.room_live where room_id='${id}'`)).toBe(
        String(revision),
      );
      sql(
        `update public.live_bot_jobs set lease_expires_at=now()-interval '1 second' where id='${old.id}'`,
      );
      const next = worker();
      await until(async () => (await job(id!)).attempts >= 2);
      expect((await privateCall("bot-result", old, { type: "pass" })).status).toBe(409);
      await until(async () => (await job(id!)).status === "done");
      kill(next);
      const done = await job(id!);
      const read = await call(owner, { operation: "read", id });
      expect(read.body.match.revision).toBe(revision + 1);
      expect(read.body.match.logs.filter((log: any) => log.side === "B")).toHaveLength(1);
      expect(
        sql(
          `select count(*) from public.live_game_events where game_id='${id}' and command_id='${done.id}'`,
        ),
      ).toBe("1");
      for (let attempt = 0; attempt < 3; attempt++)
        expect((await privateCall("bot-result", done, { type: "pass" })).body).toEqual({
          ok: true,
        });
      expect((await call(owner, { ...command, commandId: crypto.randomUUID() })).status).toBe(409);
      expect((await call(owner, command)).status).toBe(200);
      expect(funding()).toBe("1");
      expect(JSON.stringify(read.body)).not.toMatch(
        /"(?:rackA|rackB|tilebag|canonical|history|session)"\s*:/,
      );
      expect(
        (
          await call(owner, {
            operation: "bot-observation",
            jobId: done.id,
            leaseToken: done.lease_token,
          })
        ).status,
      ).toBe(401);
    } finally {
      for (const child of children) kill(child);
      if (id) {
        const read = await call(owner, { operation: "read", id });
        if (read.status === 200)
          await call(owner, {
            operation: "action",
            id,
            revision: read.body.match.revision,
            commandId: crypto.randomUUID(),
            action: { kind: "resign" },
          });
      }
    }
  },
  180000,
);

local(
  "queues a bot turn atomically with its stored revision even when Edge never enqueues, and retries transient failures",
  async () => {
    const owner = await player("plus");
    const created = await call(owner, {
      operation: "create",
      settings: settings(owner),
      policy: policy("private"),
      requestId: crypto.randomUUID(),
      funding: "allowance",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.id;
    try {
      await call(owner, { operation: "ready", id });
      // Trusted DB fixture performs the room transaction directly, then disappears.
      // No human read/enqueue request is sent between commit and job inspection.
      sql(`begin; update public.room_live set revision=revision+1,
      state=jsonb_set(state,'{activeSide}','"B"'), canonical=jsonb_set(canonical,'{activeSide}','"B"')
      where room_id='${id}'; commit;`);
      const queued = await job(id);
      expect(queued.status).toBe("queued");
      expect(queued.request).toEqual({});
      const claimed = await service.rpc("claim_live_bot_job");
      expect(claimed.error).toBeNull();
      expect(claimed.data[0].id).toBe(queued.id);
      await service
        .from("live_bot_jobs")
        .update({ status: "failed", next_attempt_at: new Date(0).toISOString() })
        .eq("id", queued.id);
      const retry = await service.rpc("claim_live_bot_job");
      expect(retry.error).toBeNull();
      expect(retry.data[0].id).toBe(queued.id);
      expect(retry.data[0].attempts).toBe(2);
      expect(retry.data[0].lease_token).not.toBe(claimed.data[0].lease_token);
      const observation = await privateCall("bot-observation", retry.data[0]);
      expect(observation.status).toBe(200);
      expect(Object.keys(observation.body.request).sort()).toEqual(
        [
          "roomId",
          "revision",
          "seed",
          "side",
          "board",
          "rack",
          "ownPending",
          "opponentRackCount",
          "opponentPendingCount",
          "bagCount",
          "scores",
          "turnNumber",
          "noScoreTail",
        ].sort(),
      );
      expect((await call(owner, { operation: "read", id })).body.match.revision).toBe(
        queued.revision,
      );
    } finally {
      const read = await call(owner, { operation: "read", id });
      await call(owner, {
        operation: "action",
        id,
        revision: read.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "resign" },
      });
    }
  },
  30000,
);
