import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

const statusFile = process.env.LIVE_SECURITY_STATUS_FILE;
export const available = Boolean(statusFile);
export const env = statusFile ? JSON.parse(readFileSync(statusFile, "utf8")) : {};
if (
  available &&
  (env.API_URL !== "http://127.0.0.1:54521" || !env.DB_URL?.includes("127.0.0.1:54522"))
)
  throw new Error("Disposable security stack required.");
export const service = available
  ? createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null!;
export const sql = (query: string) =>
  execFileSync("psql", [env.DB_URL, "-v", "ON_ERROR_STOP=1", "-Atc", query], {
    encoding: "utf8",
  }).trim();

export async function player(plan?: "plus" | "pro") {
  const email = `live-browser-${randomUUID()}@example.test`,
    password = `Local-only-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error;
  const id = created.data.user.id;
  sql(
    `update public.profiles set status='approved',display_name='Security ${id.slice(0, 8)}' where id='${id}'`,
  );
  if (plan)
    sql(`insert into public.plan_passes(user_id,plan_key,kind,months,source,idempotency_key,activated_at,reason,created_by)
    values('${id}','${plan}','grant',1,'admin','browser:${randomUUID()}',now(),'isolated security test','${id}');select public.rebuild_plan_timeline('${id}');`);
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error || !signed.data.session) throw signed.error;
  return { id, client, session: signed.data.session };
}
export type Player = Awaited<ReturnType<typeof player>>;
const owners = new Map<string, Player>();
export async function call(who: Player, body: Record<string, unknown>, name = "live-game") {
  if (name === "live-game" && body.operation === "ready") {
    const read = await call(who, { operation: "read", id: body.id });
    if (read.status !== 200) return read;
    const ready = await call(who, {
      operation: "control",
      id: body.id,
      revision: read.body.match.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "ready", ready: true },
    });
    if (ready.status !== 200) return ready;
    await launchFixture(String(body.id));
    return call(who, { operation: "read", id: body.id });
  }
  const result = await fetch(`${env.API_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${who.session.access_token}`,
      apikey: env.ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await result.json();
  if (name === "live-game" && body.operation === "create" && result.status === 200)
    owners.set(payload.id, who);
  return { status: result.status, body: payload };
}
async function launchFixture(id: string) {
  const owner = owners.get(id);
  if (!owner) return;
  const read = await call(owner, { operation: "read", id });
  if (!read.body.match?.canLaunch) return;
  const launch = await call(owner, {
    operation: "control",
    id,
    revision: read.body.match.revision,
    commandId: crypto.randomUUID(),
    action: { kind: "launch" },
  });
  if (launch.status !== 200) throw new Error("Fixture host launch failed");
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const current = await call(owner, { operation: "read", id });
  if (current.body.match?.status === "playing") return;
  const start = await call(owner, {
    operation: "control",
    id,
    revision: launch.body.match.revision,
    commandId: crypto.randomUUID(),
    action: { kind: "start" },
  });
  if (start.status !== 200) throw new Error("Fixture countdown start failed");
}
export const policy = (scope = "public") => ({
  accessScope: scope,
  archivePolicy: scope,
  joinPolicy: "invite_only",
  regionId: null,
});
export const settings = (a: Player, b?: Player) => ({
  name: "Security browser gate",
  playerA: "A",
  playerB: b ? "B" : "Authur",
  playerAUserId: a.id,
  playerBUserId: b?.id ?? null,
  startingSide: "A",
  untimed: true,
  tileDrawMode: "play",
  emailPlayMode: "direct",
  ...(!b ? { botSide: "B", botEngine: "authur", botDifficulty: "super" } : {}),
});

export async function signIn(page: Page, who: Player) {
  await page.addInitScript((session) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    const root = window as unknown as { captured: unknown[] };
    root.captured = [];
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      root.captured.push([key, value]);
      save.call(this, key, value);
    };
    for (const method of ["add", "put"] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (...args: Parameters<typeof original>) {
        root.captured.push(args);
        return original.apply(this, args);
      };
    }
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        super(...args);
        this.addEventListener("message", (event) => root.captured.push(event.data));
      }
      postMessage(...args: Parameters<Worker["postMessage"]>) {
        root.captured.push(args[0]);
        super.postMessage(...args);
      }
    };
  }, who.session);
}

export async function browserCall(
  page: Page,
  who: Player,
  body: Record<string, unknown>,
  name = "live-game",
) {
  if (name === "live-game" && body.operation === "ready") {
    const view = await browserCall(page, who, { operation: "read", id: body.id });
    const ready = await browserCall(page, who, {
      operation: "control",
      id: body.id,
      revision: view.body.match.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "ready", ready: true },
    });
    if (ready.status !== 200) return ready;
    await launchFixture(String(body.id));
    return browserCall(page, who, { operation: "read", id: body.id });
  }
  return page.evaluate(
    async ({ api, anon, token, body, name }) => {
      const result = await fetch(`${api}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: result.status, body: await result.json() };
    },
    { api: env.API_URL, anon: env.ANON_KEY, token: who.session.access_token, body, name },
  );
}

export function observe(page: Page) {
  const responses: unknown[] = [];
  const realtime: string[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (response) => {
    if (
      response.url().includes("/functions/v1/live-game") ||
      response.url().includes("/functions/v1/ranked")
    )
      pending.push(
        response
          .json()
          .then((data) => {
            responses.push(data);
          })
          .catch(() => undefined),
      );
  });
  page.on("websocket", (socket) =>
    socket.on("framereceived", (frame) => realtime.push(String(frame.payload))),
  );
  return { responses, realtime, flush: () => Promise.all(pending) };
}
