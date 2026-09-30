import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const statusFile = process.env.AUTHUR_LOCAL_STATUS_FILE;
const status = statusFile ? JSON.parse(readFileSync(statusFile, "utf8")) : {};
const api = status.API_URL ?? "http://127.0.0.1:54921";
const db = status.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54922/postgres";
const engine = "http://127.0.0.1:8795";
if (
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(api) ||
  !/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(db)
) {
  throw new Error("Refusing non-local fixture services");
}
test.skip(!statusFile, "requires isolated local Supabase + frontend + real engine");
const sql = (query: string) =>
  execFileSync("psql", [db, "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();
const options = { auth: { persistSession: false, autoRefreshToken: false } };

async function player(plan?: "plus" | "pro") {
  const admin = createClient(api, status.SERVICE_ROLE_KEY, options);
  const email = `authur-runtime-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  sql(
    `update public.profiles set status='approved', display_name='Runtime ${id.slice(0, 8)}' where id='${id}'`,
  );
  if (plan)
    sql(`insert into public.plan_passes(user_id,plan_key,kind,months,source,idempotency_key,activated_at,reason,created_by)
    values('${id}','${plan}','grant',1,'admin','runtime:${randomUUID()}',now(),'local runtime test','${id}');
    select public.rebuild_plan_timeline('${id}');`);
  const client = createClient(api, status.ANON_KEY, options);
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { id, client, session: signed.data.session! };
}

function grantCredit(id: string) {
  sql(
    `select public.economy_post('${id}','probot_credit',1,'admin_grant','admin_request','runtime','runtime:${randomUUID()}','${id}','local fixture')`,
  );
}
const consumptions = (id: string) =>
  Number(sql(`select count(*) from public.probot_consumptions where user_id='${id}'`));
const balance = (id: string) =>
  Number(
    sql(
      `select coalesce((select balance from public.economy_balances where user_id='${id}' and currency='probot_credit'),0)`,
    ),
  );

async function signedIn(page: Page, session: Awaited<ReturnType<typeof player>>["session"]) {
  await page.addInitScript(
    (stored) => localStorage.setItem("sb-127-auth-token", JSON.stringify(stored)),
    session,
  );
}

async function initialState(page: Page) {
  await page.goto("/");
  return page.evaluate(async () => {
    const gamePath = "/src/game.ts";
    const defaultsPath = "/src/constants/roomDefaults.ts";
    const codecPath = "/src/codec.ts";
    const { createNewGame } = await import(gamePath);
    const { DEFAULT_NEW_GAME_SETTINGS } = await import(defaultsPath);
    const { encodeGame } = await import(codecPath);
    return encodeGame(
      createNewGame({
        ...DEFAULT_NEW_GAME_SETTINGS,
        playerA: "Runtime Player",
        playerB: "Authur",
        botSide: "B",
        botEngine: "authur",
        botDifficulty: "super",
        tileDrawMode: "play",
        untimed: true,
      }),
    );
  });
}

test("real room economy: Free refusal/Credit and Plus/Pro allowance are exactly once", async ({
  page,
}) => {
  const state = await initialState(page);
  for (const plan of [undefined, "plus", "pro"] as const) {
    const who = await player(plan);
    const args = {
      target_request_id: randomUUID(),
      target_bot_key: "authur_strong",
      target_bot_side: "B",
      target_state: state,
      target_access_scope: "public",
      target_archive_policy: "public",
      target_region_id: null,
      target_join_policy: "invite_only",
      target_private_parent_id: null,
      target_funding: plan ? "allowance" : "credit",
    };
    if (!plan) {
      const refused = await who.client.rpc("create_bot_game", args);
      expect(refused.error?.message).toContain("insufficient_credits");
      expect(consumptions(who.id)).toBe(0);
      grantCredit(who.id);
    }
    const before = await who.client.rpc("get_my_probot_status");
    const created = await who.client.rpc("create_bot_game", args);
    expect(created.error).toBeNull();
    expect(created.data[0]).toMatchObject({ replayed: false, funding: args.target_funding });
    const replayed = await who.client.rpc("create_bot_game", args);
    expect(replayed.error).toBeNull();
    expect(replayed.data[0]).toMatchObject({
      room_id: created.data[0].room_id,
      replayed: true,
      consumption_id: created.data[0].consumption_id,
    });
    expect(consumptions(who.id)).toBe(1);
    const after = await who.client.rpc("get_my_probot_status");
    if (plan) expect(after.data.allowance.available).toBe(before.data.allowance.available - 1);
    else expect(balance(who.id)).toBe(0);
  }
});

const room = (roomId: string) =>
  JSON.parse(
    sql(
      `select json_build_object('revision',revision,'activeSide',canonical->>'activeSide','logs',state->'logs','bot_key',bot_key,'tier',bot_access_tier,'execution',bot_execution_type) from public.room_live where room_id='${roomId}'`,
    ),
  );
const botTurns = (roomId: string) =>
  room(roomId).logs.filter((turn: { side: string }) => turn.side === "B").length;

async function humanPasses(page: Page) {
  await page.getByRole("button", { name: "Pass", exact: true }).click({ timeout: 15000 });
  await page.getByRole("button", { name: "Submit Pass" }).click();
}

test("Authur multi-turn real browser/engine/commit, reload, second tab, stale revision and CORS", async ({
  page,
  context,
}) => {
  const who = await player();
  grantCredit(who.id);
  await signedIn(page, who.session);
  const errors: string[] = [];
  const requests: Array<{ method: string; url: string }> = [];
  page.on("console", (message) => {
    if (/CORS|budget_exhausted/i.test(message.text())) errors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().startsWith(engine))
      requests.push({ method: request.method(), url: request.url() });
  });
  await page.goto("/#/");
  await page
    .getByRole("region", { name: "Play against AI" })
    .getByRole("link", { name: /Play Authur/ })
    .click();
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("radio", { name: /ใช้ 1 เครดิต/ }).click();
  await page.getByRole("button", { name: "Start Authur match" }).click();
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  const roomId = sql(
    `select room_id from public.room_live where owner_id='${who.id}' order by created_at desc limit 1`,
  );
  expect(room(roomId)).toMatchObject({
    bot_key: "authur_strong",
    tier: "pro",
    execution: "SERVER",
  });
  expect(consumptions(who.id)).toBe(1);
  expect(balance(who.id)).toBe(0);

  const second = await context.newPage();
  for (let turn = 1; turn <= 3; turn += 1) {
    await expect.poll(() => room(roomId).activeSide, { timeout: 30000 }).toBe("A");
    await humanPasses(page);
    if (turn === 1) {
      await page.reload();
      await second.goto(page.url());
    }
    await expect.poll(() => botTurns(roomId), { timeout: 60000 }).toBe(turn);
  }
  await second.close();
  expect(consumptions(who.id)).toBe(1);
  expect(balance(who.id)).toBe(0);
  const revisions = JSON.parse(
    sql(
      `select json_agg(revision order by revision) from public.live_game_events where game_id='${roomId}'`,
    ),
  );
  expect(new Set(revisions).size).toBe(revisions.length);
  expect(
    requests.some((request) => request.method === "POST" && request.url.endsWith("/bot-move")),
  ).toBe(true);
  expect(errors).toEqual([]);

  const headers = {
    Authorization: `Bearer ${who.session.access_token}`,
    Origin: "https://eq-log.vercel.app",
    "Content-Type": "application/json",
  };
  const revision = room(roomId).revision;
  const jobs = await fetch(`${engine}/v1/games/${roomId}/jobs?revision=${revision}`, { headers });
  expect(jobs.status).toBe(200);
  const activeAnalysis = fetch(`${engine}/v1/games/${roomId}/analysis`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: revision, level: "quick" }),
  });
  await expect
    .poll(
      async () => {
        const listing = await (
          await fetch(`${engine}/v1/games/${roomId}/jobs?revision=${revision}`, { headers })
        ).json();
        return listing.jobs.some(
          (job: { kind: string; status: string }) =>
            job.kind === "analysis" && job.status === "running",
        );
      },
      { timeout: 3000 },
    )
    .toBe(true);
  const activeCancel = await fetch(`${engine}/v1/games/${roomId}/analysis/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: revision, level: "quick" }),
  });
  expect(await activeCancel.json()).toEqual({ cancelled: true });
  const cancelledResponse = await activeAnalysis;
  expect(cancelledResponse.status).toBe(499);
  expect(await cancelledResponse.json()).toMatchObject({ code: "cancelled" });
  expect(cancelledResponse.headers.get("access-control-allow-origin")).toBe(headers.Origin);
  const analysis = await fetch(`${engine}/v1/games/${roomId}/analysis`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: revision, level: "stage5b64" }),
  });
  expect(analysis.status).toBe(200);
  expect((await analysis.json()).method.solver).toBe("stage5b");
  const read = await fetch(
    `${engine}/v1/games/${roomId}/analysis?revision=${revision}&level=stage5b64`,
    { headers },
  );
  expect(read.status).toBe(200);
  expect(await read.text()).toContain("event: result");
  const settled = await fetch(`${engine}/v1/games/${roomId}/analysis/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: revision, level: "stage5b64" }),
  });
  expect(await settled.json()).toEqual({ cancelled: false });
  const budgeted = await fetch(`${engine}/v1/games/${roomId}/analysis`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: revision, level: "quick" }),
  });
  expect(budgeted.status).toBe(429);
  expect(await budgeted.json()).toMatchObject({ code: "budget_exhausted" });
  expect(budgeted.headers.get("access-control-allow-origin")).toBe(headers.Origin);
  // The retained Analysis meter is now exhausted; Authur still plays normally.
  await humanPasses(page);
  await expect.poll(() => botTurns(roomId), { timeout: 60000 }).toBe(4);
  expect(consumptions(who.id)).toBe(1);
  // A pre-economy room has valid frozen bot state and no consumption row.
  // Clone only in this disposable fixture database, under its schema owner.
  const legacyId = randomUUID();
  sql(`do $$ declare legacy public.room_live%rowtype; begin
    select * into legacy from public.room_live where room_id='${roomId}';
    legacy.room_id := '${legacyId}';
    legacy.created_at := '2026-08-01T00:00:00Z';
    legacy.room_code_hash := encode(extensions.digest(public.derive_live_room_code('${legacyId}'), 'sha256'), 'hex');
    legacy.canonical := jsonb_set(jsonb_set(legacy.canonical, '{gameId}', to_jsonb('${legacyId}'::text)), '{activeSide}', '"B"');
    legacy.state := jsonb_set(jsonb_set(legacy.state, '{id}', to_jsonb('${legacyId}'::text)), '{activeSide}', '"B"');
    insert into public.room_live select legacy.*;
  end $$;`);
  expect(sql(`select count(*) from public.probot_consumptions where room_id='${legacyId}'`)).toBe(
    "0",
  );
  const legacyMove = await fetch(`${engine}/v1/games/${legacyId}/bot-move`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: room(legacyId).revision }),
  });
  expect(legacyMove.status).toBe(200);
  expect((await legacyMove.json()).move).toBeDefined();
  expect(consumptions(who.id)).toBe(1);
  for (const path of [
    "jobs?revision=1",
    "analysis?revision=1&level=stage5b64",
    "analysis/cancel",
    "bot-move",
  ]) {
    const response = await fetch(`${engine}/v1/games/${roomId}/${path}`, {
      method: "OPTIONS",
      headers: {
        Origin: headers.Origin,
        "Access-Control-Request-Method": path.includes("?") ? "GET" : "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(headers.Origin);
  }
  const stale = await fetch(`${engine}/v1/games/${roomId}/bot-move`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: 0 }),
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "stale_revision" });
  expect(stale.headers.get("access-control-allow-origin")).toBe(headers.Origin);
  const cancel = await fetch(`${engine}/v1/games/${roomId}/analysis/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: 0, level: "stage5b64" }),
  });
  expect(cancel.status).toBe(409);
  expect(await cancel.json()).toMatchObject({ code: "stale_revision" });
  expect(consumptions(who.id)).toBe(1);
});

test("real queue overload backs off once and resumes Authur without another charge", async ({
  page,
}) => {
  const who = await player();
  grantCredit(who.id);
  await signedIn(page, who.session);
  await page.goto("/#/");
  await page
    .getByRole("region", { name: "Play against AI" })
    .getByRole("link", { name: /Play Authur/ })
    .click();
  await page.getByRole("button", { name: /^Public/ }).click();
  await page.getByRole("radio", { name: /ใช้ 1 เครดิต/ }).click();
  await page.getByRole("button", { name: "Start Authur match" }).click();
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  const roomId = sql(
    `select room_id from public.room_live where owner_id='${who.id}' order by created_at desc limit 1`,
  );
  const holders = await Promise.all([player(), player(), player()]);
  // Shift both scores equally to use uncached positions on repeated runs.
  const studyMarker = Date.now() % 8_000;
  const searches = holders.map((holder, index) =>
    fetch(`${engine}/v1/study/analysis`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${holder.session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        level: "medium",
        scoreSelf: 40 + studyMarker + index,
        scoreOpponent: 55 + studyMarker,
        board: [
          { r: 7, c: 6, kind: "2", token: "2" },
          { r: 7, c: 7, kind: "+", token: "+" },
          { r: 7, c: 8, kind: "3", token: "3" },
          { r: 7, c: 9, kind: "=", token: "=" },
          { r: 7, c: 10, kind: "5", token: "5" },
        ],
        rack: ["1", "2", "3", "+", "=", "5", "9", "?"],
      }),
    }),
  );
  await expect
    .poll(async () => (await (await fetch(`${engine}/health`)).json()).queue.waiting, {
      timeout: 3000,
    })
    .toBe(2);
  const attempts: number[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/bot-move") && request.method() === "POST")
      attempts.push(Date.now());
  });
  await humanPasses(page);
  await expect.poll(() => attempts.length, { timeout: 3000 }).toBe(1);
  const overloaded = await fetch(`${engine}/v1/games/${roomId}/bot-move`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${who.session.access_token}`,
      "Content-Type": "application/json",
      Origin: "https://eq-log.vercel.app",
    },
    body: JSON.stringify({ expectedRevision: room(roomId).revision }),
  });
  expect(overloaded.status).toBe(503);
  expect(await overloaded.json()).toMatchObject({ code: "queue_full", retryAfterMs: 10000 });
  expect(overloaded.headers.get("access-control-allow-origin")).toBe("https://eq-log.vercel.app");
  expect(overloaded.headers.get("access-control-expose-headers")).toContain("Retry-After");
  await expect.poll(() => botTurns(roomId), { timeout: 60000 }).toBe(1);
  expect(attempts.length).toBe(2);
  expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(10000);
  for (const response of await Promise.all(searches)) expect(response.status).toBe(200);
  expect(consumptions(who.id)).toBe(1);
  expect(balance(who.id)).toBe(0);
});
