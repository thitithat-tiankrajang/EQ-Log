import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { decodeGame } from "../../src/codec";
import { buildSync } from "esbuild";
import {
  available,
  browserCall,
  call,
  env,
  observe,
  player,
  policy,
  service,
  settings,
  signIn,
  sql,
  type Player,
} from "./fixtures";

test.skip(!available, "Requires the disposable local security stack and trusted worker.");

// Bundle this trusted fixture for Node, where JSON modules require attributes.
// It is never imported in either browser context.
const fixtureModule = { exports: {} as { stageStartCanonical(seed: number): unknown } };
new Function(
  "module",
  "exports",
  buildSync({
    entryPoints: ["src/features/survival/sealedStart.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0]!.text,
)(fixtureModule, fixtureModule.exports);
const { stageStartCanonical } = fixtureModule.exports;

const forbidden =
  /"(?:rackA|rackB|tilebag|tilebagBefore|tilebagAfter|canonical|inventory|rngStep|winning_replays|start_canonical|outgoingTiles|incomingTiles|session)"\s*:/;
async function safe(page: Page, who: Player, id: string, seen: ReturnType<typeof observe>) {
  const read = await browserCall(page, who, { operation: "read", id });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const row = await service.from("room_live").select("state").eq("room_id", id).single();
  if (row.error) throw row.error;
  const game = decodeGame(row.data.state);
  const opponent =
    read.body.match.yourSide === "A"
      ? game.rackB
      : read.body.match.yourSide === "B"
        ? game.rackA
        : [...game.rackA, ...game.rackB];
  const bag = game.tilebag;
  await seen.flush();
  const stored = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    captured: (window as unknown as { captured: unknown[] }).captured,
  }));
  const projectionTraffic = JSON.stringify(seen.responses);
  expect(projectionTraffic).not.toMatch(forbidden);
  // Stored authentication sessions are lawful own credentials, not game sessions.
  expect(JSON.stringify(stored)).not.toMatch(
    /"(?:rackA|rackB|tilebag|inventory|rngStep|canonical)"\s*:/,
  );
  const all = projectionTraffic + JSON.stringify(stored) + seen.realtime.join("");
  const ownKnown = new Set<string>(read.body.match.yourRack.map((tile: { id: string }) => tile.id));
  for (const log of read.body.match.logs)
    for (const tile of [...(log.rackBefore ?? []), ...(log.rackAfter ?? [])]) ownKnown.add(tile.id);
  for (const tile of [...opponent, ...bag])
    if (!ownKnown.has(tile.id)) expect(all).not.toContain(`"${tile.id}"`);
  for (const log of read.body.match.logs)
    if (log.side !== read.body.match.yourSide) {
      expect(log).not.toHaveProperty("rackBefore");
      expect(log).not.toHaveProperty("rackAfter");
    }
  const attempts = await page.evaluate(
    async ({ api, key, token, id }) => {
      const headers = { apikey: key, Authorization: `Bearer ${token}` };
      const targets = [
        "room_live?select=state,canonical,session",
        "game_timelines?select=*",
        "live_game_events?select=*",
        "live_bot_jobs?select=*",
        "ranked_private_revisions?select=*",
      ];
      const results = await Promise.all(
        targets.map(
          async (target) => (await fetch(`${api}/rest/v1/${target}`, { headers })).status,
        ),
      );
      for (const name of [
        "get_live_game_snapshot",
        "get_live_game_engine_context",
        "list_live_game_events",
      ])
        results.push(
          (
            await fetch(`${api}/rest/v1/rpc/${name}`, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/json" },
              body: JSON.stringify({ target_game_id: id }),
            })
          ).status,
        );
      return results;
    },
    { api: env.API_URL, key: env.ANON_KEY, token: who.session.access_token, id },
  );
  expect(attempts.every((status) => status >= 400)).toBe(true);
  expect((await browserCall(page, who, { gameId: id }, "archive-replay")).status).toBe(404);
  expect(
    (
      await browserCall(page, who, {
        operation: "bot-result",
        jobId: randomUUID(),
        move: { type: "pass" },
      })
    ).status,
  ).toBe(401);
  return read.body.match;
}
async function pass(page: Page) {
  await page.getByRole("button", { name: "Pass", exact: true }).click();
  await page.getByRole("button", { name: "Submit Pass", exact: true }).click();
}
async function finish(page: Page, who: Player, id: string, name = "live-game") {
  const read = await browserCall(page, who, { operation: "read", id }, name);
  const done = await browserCall(
    page,
    who,
    {
      operation: "action",
      id,
      revision: read.body.match.revision,
      commandId: randomUUID(),
      action: { kind: "resign" },
    },
    name,
  );
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  const replay = await browserCall(page, who, { gameId: id }, "archive-replay");
  expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  expect(replay.body.replay.positions[0].racks.A.length).toBeGreaterThan(0);
  expect(replay.body.replay.positions[0].racks.B.length).toBeGreaterThan(0);
  return replay;
}

test("two browsers: public/private Normal, exchange, reconnect/reload/second tab/stale and completion", async ({
  browser,
}) => {
  const a = await player(),
    b = await player(),
    spectator = await player();
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  await signIn(pa, a);
  await signIn(pb, b);
  for (const scope of ["public", "private"]) {
    const made = await call(a, {
      operation: "create",
      requestId: randomUUID(),
      settings: settings(a, b),
      policy: policy(scope),
    });
    expect(made.status, JSON.stringify(made.body)).toBe(200);
    const id = made.body.id,
      oa = observe(pa),
      ob = observe(pb);
    await Promise.all([pa.goto(`/#/play/${id}`), pb.goto(`/#/play/${id}`)]);
    await pa.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pb.getByText("A พร้อม · B ยังไม่พร้อม", { exact: true })).toBeVisible();
    await pb.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Launch game", exact: true })).toBeEnabled();
    await pa.getByRole("button", { name: "Launch game", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 15_000,
    });
    const initial = await safe(pa, a, id, oa);
    await safe(pb, b, id, ob);
    expect((await call(spectator, { operation: "read", id })).status).toBe(
      scope === "public" ? 200 : 404,
    );
    // Use the lawful own-rack IDs; authoritative exchange contents stay private.
    const exchanged = await browserCall(pa, a, {
      operation: "action",
      id,
      revision: initial.revision,
      commandId: randomUUID(),
      action: { kind: "exchange", tileIds: [initial.yourRack[0].id] },
    });
    expect(exchanged.status, JSON.stringify(exchanged.body)).toBe(200);
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await pass(pb);
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    const stale = await browserCall(pa, a, {
      operation: "action",
      id,
      revision: initial.revision,
      commandId: randomUUID(),
      action: { kind: "pass" },
    });
    expect(stale.status).toBe(409);
    expect(stale.body.match.yourSide).toBe("A");
    await ca.setOffline(true);
    expect(await pa.evaluate(() => navigator.onLine)).toBe(false);
    const beforeOffline = await call(a, { operation: "read", id });
    await pass(pa);
    await expect(pa.getByRole("alert")).toBeVisible();
    expect((await call(a, { operation: "read", id })).body.match.revision).toBe(
      beforeOffline.body.match.revision,
    );
    await ca.setOffline(false);
    await pa.reload();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    const tab = await ca.newPage();
    await signIn(tab, a);
    const ot = observe(tab);
    await tab.goto(`/#/play/${id}`);
    await safe(tab, a, id, ot);
    await tab.close();
    await safe(pa, a, id, oa);
    await safe(pb, b, id, ob);
    // Hold the terminal transaction before History persistence and poll through
    // the hold. MVCC must expose only the still-live row until commit.
    sql(
      `create function public.live_browser_terminal_hold() returns trigger language plpgsql as $$ begin if new.source_id='${id}'::uuid then perform pg_sleep(1); end if; return new; end $$;create trigger live_browser_terminal_hold before insert on public.recent_game_payloads for each row execute function public.live_browser_terminal_hold();`,
    );
    try {
      const view = await call(a, { operation: "read", id });
      const terminal = call(a, {
        operation: "action",
        id,
        revision: view.body.match.revision,
        commandId: randomUUID(),
        action: { kind: "resign" },
      });
      const reads = await Promise.all(
        Array.from({ length: 5 }, () => call(b, { gameId: id }, "archive-replay")),
      );
      expect(reads.every((result) => result.status === 404)).toBe(true);
      expect((await terminal).status).toBe(200);
    } finally {
      sql(
        "drop trigger live_browser_terminal_hold on public.recent_game_payloads;drop function public.live_browser_terminal_hold();",
      );
    }
    const replay = await browserCall(pb, b, { gameId: id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(replay.body.replay.positions[0].racks.A).toHaveLength(8);
    expect(replay.body.replay.positions[0].racks.B).toHaveLength(8);
    await pa.reload();
    await expect(pa.getByRole("region", { name: "Completed game replay" })).toBeVisible();
  }
  await ca.close();
  await cb.close();
});

test("full-strength trusted Authur and Stage: real bot move, concurrent retry, reload and terminal Replay", async ({
  browser,
}) => {
  const a = await player(),
    observer = await player();
  sql(
    `select public.economy_post('${a.id}','probot_credit',2,'admin_grant','admin_request','browser','browser:${randomUUID()}','${a.id}','isolated fixture')`,
  );
  const ca = await browser.newContext(),
    co = await browser.newContext();
  const pa = await ca.newPage(),
    po = await co.newPage();
  await signIn(pa, a);
  await signIn(po, observer);
  const before = Number(
    sql(
      `select balance from public.economy_balances where user_id='${a.id}' and currency='probot_credit'`,
    ),
  );
  const requestId = randomUUID(),
    body = {
      operation: "create",
      requestId,
      settings: settings(a),
      policy: policy(),
      funding: "credit",
    };
  const created = await Promise.all([call(a, body), call(a, body), call(a, body)]);
  expect(created.map((result) => result.status)).toEqual([200, 200, 200]);
  expect(new Set(created.map((result) => result.body.id)).size).toBe(1);
  const id = created[0].body.id,
    oa = observe(pa),
    oo = observe(po);
  await pa.goto(`/#/play/${id}`);
  await po.goto(`/#/play/${id}`);
  await pa.getByRole("button", { name: "Ready", exact: true }).click();
  await expect(pa.getByRole("button", { name: "Launch game", exact: true })).toBeEnabled();
  await pa.getByRole("button", { name: "Launch game", exact: true }).click();
  await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
    timeout: 15_000,
  });
  await pass(pa);
  const bot = await browserCall(pa, a, { operation: "read", id });
  expect(bot.status).toBe(200);
  await expect
    .poll(() => Number(sql(`select count(*) from public.live_bot_jobs where room_id='${id}'`)))
    .toBe(1);
  const revision = Number(sql(`select revision from public.live_bot_jobs where room_id='${id}'`));
  const retries = await Promise.all(
    Array.from({ length: 4 }, () => browserCall(pa, a, { operation: "bot-turn", id, revision })),
  );
  expect(retries.every((result) => result.status === 200 || result.status === 409)).toBe(true);
  await pa.reload();
  await expect
    .poll(
      () =>
        Number(
          sql(`select count(*) from public.live_bot_jobs where room_id='${id}' and status='done'`),
        ),
      { timeout: 180_000 },
    )
    .toBe(1);
  const row = await service.from("room_live").select("state,revision").eq("room_id", id).single();
  expect(row.error).toBeNull();
  const state = decodeGame(row.data.state);
  expect(state.logs.filter((log) => log.side === "B")).toHaveLength(1);
  expect(["place_equation", "exchange", "pass"]).toContain(
    state.logs.find((log) => log.side === "B")?.action,
  );
  expect(row.data.revision).toBe(revision + 1);
  expect(
    Number(
      sql(
        `select balance from public.economy_balances where user_id='${a.id}' and currency='probot_credit'`,
      ),
    ),
  ).toBe(before - 1);
  expect(
    Number(sql(`select count(*) from public.probot_consumptions where user_id='${a.id}'`)),
  ).toBe(1);
  expect(Number(sql(`select count(*) from public.live_bot_jobs where room_id='${id}'`))).toBe(1);
  await safe(pa, a, id, oa);
  const watching = await safe(po, observer, id, oo);
  expect(watching.yourRack).toEqual([]);
  const job = await service.from("live_bot_jobs").select("request").eq("room_id", id).single();
  expect(Object.keys(job.data.request).sort()).toEqual(
    [
      "bagCount",
      "board",
      "noScoreTail",
      "opponentPendingCount",
      "opponentRackCount",
      "ownPending",
      "rack",
      "revision",
      "roomId",
      "scores",
      "seed",
      "side",
      "turnNumber",
    ].sort(),
  );
  // Private engine input is a bot observation, never the true human rack/queue.
  expect(JSON.stringify(job.data.request)).not.toMatch(
    /rackA|rackB|tilebag|canonical|inventory|rngStep/,
  );
  // A second owner tab can request the next job. Once queued, it must commit
  // once even while the player's entire browser is offline.
  const secondTab = await ca.newPage();
  await signIn(secondTab, a);
  await secondTab.goto(`/#/play/${id}`);
  await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
  const nextHuman = await browserCall(pa, a, {
    operation: "action",
    id,
    revision: row.data.revision,
    commandId: randomUUID(),
    action: { kind: "pass" },
  });
  expect(nextHuman.status).toBe(200);
  await browserCall(secondTab, a, {
    operation: "bot-turn",
    id,
    revision: nextHuman.body.match.revision,
  });
  await ca.setOffline(true);
  await expect
    .poll(
      () =>
        Number(
          sql(`select count(*) from public.live_bot_jobs where room_id='${id}' and status='done'`),
        ),
      { timeout: 180_000 },
    )
    .toBe(2);
  await ca.setOffline(false);
  await pa.reload();
  await safe(pa, a, id, oa);
  expect(
    Number(sql(`select count(*) from public.probot_consumptions where user_id='${a.id}'`)),
  ).toBe(1);
  expect(Number(sql(`select count(*) from public.live_bot_jobs where room_id='${id}'`))).toBe(2);
  await secondTab.close();
  await finish(pa, a, id);

  const levelId = randomUUID();
  sql(`update public.profiles set is_admin=true where id='${a.id}'`);
  const level = await service.from("survival_levels").insert({
    id: levelId,
    season_key: `browser-${levelId}`,
    level_no: 1,
    seed: 17,
    reference_key: "endgame-v1",
    sample_policy: "test",
    sample_count: 3,
    win_count: 3,
    winning_replays: [{}, {}, {}],
    immediate_winning_moves: 0,
    shortest_winning_replay_turns: 5,
    start_canonical: stageStartCanonical(17),
    start_sealed_at: new Date().toISOString(),
    status: "approved",
    admin_note: "Disposable browser fixture",
    approved_by: a.id,
    approved_at: new Date().toISOString(),
  });
  expect(level.error).toBeNull();
  const stage = await call(a, {
    operation: "create-stage",
    requestId: randomUUID(),
    levelId,
    playerName: "A",
  });
  expect(stage.status, JSON.stringify(stage.body)).toBe(200);
  const stageId = stage.body.id,
    os = observe(pa);
  await pa.goto(`/#/play/${stageId}`);
  await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
  await pa.getByRole("button", { name: "Analyze my turn", exact: true }).click();
  await expect(pa.getByText(/^Own-rack analysis:/)).toBeVisible({ timeout: 120_000 });
  await pass(pa);
  await expect
    .poll(
      () =>
        Number(
          sql(
            `select count(*) from public.live_bot_jobs where room_id='${stageId}' and status='done'`,
          ),
        ),
      { timeout: 180_000 },
    )
    .toBe(1);
  const stageRow = await service
    .from("room_live")
    .select("state")
    .eq("room_id", stageId)
    .maybeSingle();
  if (stageRow.data) {
    const stageState = decodeGame(stageRow.data.state);
    expect(stageState.logs.filter((log) => log.side === "B")).toHaveLength(1);
    await safe(pa, a, stageId, os);
    await finish(pa, a, stageId);
  } else {
    const replay = await call(a, { gameId: stageId }, "archive-replay");
    expect(replay.status).toBe(200);
  }
  expect((await call(observer, { gameId: stageId }, "archive-replay")).status).toBe(404);
  expect(
    Number(sql(`select count(*) from public.probot_consumptions where user_id='${a.id}'`)),
  ).toBe(1);
  const attempt = await service
    .from("survival_attempts")
    .select("finished_at,result,result_authority")
    .eq("room_id", stageId)
    .single();
  expect(attempt.error).toBeNull();
  expect(attempt.data.finished_at).toBeTruthy();
  expect(attempt.data.result_authority).toBe("server_reduced");
  await ca.close();
  await co.close();
});

test("Ranked two-client authority and Hosted automatic projection; physical creation uses its dedicated capability path", async ({
  browser,
}) => {
  const a = await player(),
    b = await player(),
    host = await player();
  const ca = await browser.newContext(),
    cb = await browser.newContext(),
    ch = await browser.newContext();
  const pa = await ca.newPage(),
    pb = await cb.newPage(),
    ph = await ch.newPage();
  await signIn(pa, a);
  await signIn(pb, b);
  await signIn(ph, host);
  const ranked = await call(a, { operation: "create", minutesA: 10, minutesB: 10 }, "ranked");
  expect(ranked.status).toBe(200);
  const id = ranked.body.match.id,
    preview = await call(b, { operation: "preview", id }, "ranked");
  expect(
    (await call(b, { operation: "join", id, basis: preview.body.preview.basis }, "ranked")).status,
  ).toBe(200);
  await call(a, { operation: "ready", id }, "ranked");
  const ready = await call(b, { operation: "ready", id }, "ranked");
  await pa.goto(`/#/ranked/${id}`);
  await pb.goto(`/#/ranked/${id}`);
  const onMove = ready.body.match.activeSide === "A" ? pa : pb;
  await expect(onMove.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
  await pass(onMove);
  await expect
    .poll(async () => (await call(a, { operation: "read", id }, "ranked")).body.match.revision)
    .toBe(ready.body.match.revision + 1);
  const stale = await browserCall(
    pa,
    a,
    { operation: "action", id, revision: ready.body.match.revision, action: { kind: "pass" } },
    "ranked",
  );
  expect(stale.status).toBe(409);
  const opponent = await browserCall(
    ready.body.match.activeSide === "A" ? pb : pa,
    ready.body.match.activeSide === "A" ? b : a,
    { operation: "read", id },
    "ranked",
  );
  expect(opponent.body.match.logs[0]).not.toHaveProperty("rackBefore");
  expect(JSON.stringify(opponent.body)).not.toMatch(forbidden);
  await finish(pb, b, id, "ranked");
  const hosted = { ...settings(a, b), emailPlayMode: "hosted" };
  const manual = await call(host, {
    operation: "create",
    requestId: randomUUID(),
    settings: { ...hosted, tileDrawMode: "manual" },
    policy: policy(),
  });
  // The revised product contract authorizes physical Host current racks.
  // Full physical role/lifecycle/browser assertions are in capabilities.spec.ts.
  expect(manual.status, JSON.stringify(manual.body)).toBe(200);
  expect((await call(host, { operation: "cancel", id: manual.body.id })).status).toBe(200);
  const made = await call(host, {
    operation: "create",
    requestId: randomUUID(),
    settings: hosted,
    policy: policy(),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(200);
  const hostedId = made.body.id;
  await call(a, { operation: "ready", id: hostedId });
  await call(b, { operation: "ready", id: hostedId });
  const oh = observe(ph);
  await ph.goto(`/#/play/${hostedId}`);
  const hostView = await safe(ph, host, hostedId, oh);
  expect(hostView.yourSide).toBeNull();
  expect(hostView.yourRack).toEqual([]);
  const row = await service.from("room_live").select("state").eq("room_id", hostedId).single();
  expect(decodeGame(row.data.state).emailPlayMode).toBe("hosted");
  expect(
    (
      await browserCall(ph, host, {
        operation: "action",
        id: hostedId,
        revision: hostView.revision,
        commandId: randomUUID(),
        side: "A",
        action: { kind: "pass" },
      })
    ).status,
  ).toBe(403);
  await pa.goto(`/#/play/${hostedId}`);
  await pb.goto(`/#/play/${hostedId}`);
  await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
  await pass(pa);
  await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
  await finish(pb, b, hostedId);
  await ca.close();
  await cb.close();
  await ch.close();
});
