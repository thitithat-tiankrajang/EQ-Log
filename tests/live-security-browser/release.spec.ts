import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { decodeGame, encodeGame, LEGACY_TOKEN_TABLE } from "../../src/codec";
import {
  available,
  browserCall,
  call,
  observe,
  player,
  policy,
  service,
  settings,
  signIn,
  sql,
} from "./fixtures";

test.skip(!available, "Disposable local stack required");
const forbidden =
  /"(?:rackA|rackB|tilebag|canonical|history|session|incomingTiles|outgoingTiles)"\s*:/;

test("Hosted public administration works across host and two player browsers without hidden state", async ({
  browser,
}) => {
  const host = await player(),
    a = await player(),
    b = await player();
  const created = await call(host, {
    operation: "create",
    requestId: randomUUID(),
    policy: policy(),
    settings: { ...settings(a, b), emailPlayMode: "hosted" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = created.body.id;
  await call(a, { operation: "ready", id });
  await call(b, { operation: "ready", id });
  const contexts = await Promise.all([host, a, b].map(() => browser.newContext()));
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [ph, pa, pb] = pages;
    const seen = pages.map(observe);
    await Promise.all(
      pages.map(async (page, index) => {
        await signIn(page, [host, a, b][index]!);
        await page.goto(`/#/play/${id}`);
      }),
    );
    // Host lifecycle lives in Match controls.
    await ph!.getByRole("button", { name: "Match controls", exact: true }).click();
    await expect(ph!.getByRole("button", { name: /^Pause game/ })).toBeVisible();
    await ph!.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      (
        await browserCall(pa!, a, {
          operation: "admin",
          id,
          revision: (await call(a, { operation: "read", id })).body.match.revision,
          commandId: randomUUID(),
          action: { kind: "finish" },
        })
      ).status,
    ).toBe(403);
    let read = await call(a, { operation: "read", id });
    expect(
      (
        await browserCall(pa!, a, {
          operation: "action",
          id,
          revision: read.body.match.revision,
          commandId: randomUUID(),
          action: { kind: "pass" },
        })
      ).status,
    ).toBe(200);
    await expect(ph!.locator(".lg-title small")).toContainText("Turn 2");
    await ph!.getByRole("button", { name: "Match controls", exact: true }).click();
    await ph!.getByRole("button", { name: /^Pause game/ }).click();
    await expect(ph!.getByRole("status").filter({ hasText: "Paused by the host" })).toBeVisible();
    // Paused: no game-changing turn action is offered to the player.
    await expect(pb!.getByText("Paused by the host")).toBeVisible();
    await expect(pb!.getByRole("button", { name: "Pass", exact: true })).toHaveCount(0);
    await ph!.getByLabel("Public turn to correct").selectOption({ index: 1 });
    await ph!.getByLabel("Corrected score").fill("7");
    await ph!.getByRole("button", { name: "Correct score", exact: true }).click();
    await expect
      .poll(async () => (await call(host, { operation: "read", id })).body.match.scores.A)
      .toBe(7);
    read = await call(host, { operation: "read", id });
    expect(
      (
        await browserCall(ph!, host, {
          operation: "admin",
          id,
          revision: read.body.match.revision - 1,
          commandId: randomUUID(),
          action: { kind: "resume" },
        })
      ).status,
    ).toBe(409);
    await ph!.reload();
    await ph!.getByRole("button", { name: "Match controls", exact: true }).click();
    await ph!.getByRole("button", { name: /^Resume game/ }).click();
    await expect(pb!.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    for (let index = 0; index < pages.length; index++) {
      await seen[index]!.flush();
      const stored = await pages[index]!.evaluate(() => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
        captured: (window as any).captured,
      }));
      expect(JSON.stringify(seen[index]!.responses)).not.toMatch(forbidden);
      expect(JSON.stringify(stored)).not.toMatch(
        /"(?:rackA|rackB|tilebag|canonical|history|incomingTiles|outgoingTiles)"\s*:/,
      );
      const view = (
        await browserCall(pages[index]!, [host, a, b][index]!, { operation: "read", id })
      ).body.match;
      if (index === 0) {
        expect(view.yourRack).toEqual([]);
        expect(view.logs.every((log: any) => !log.rackBefore && !log.rackAfter)).toBe(true);
      }
    }
    await ph!.getByRole("button", { name: "Match controls", exact: true }).click();
    await ph!.getByRole("button", { name: /^Finish game/ }).click();
    await ph!
      .getByRole("dialog", { name: "Finish game" })
      .getByRole("button", { name: "Finish game", exact: true })
      .click();
    await expect
      .poll(() => sql(`select count(*) from public.game_history where source_id='${id}'`))
      .toBe("2");
    expect(sql(`select count(*) from public.room_live where room_id='${id}'`)).toBe("0");
    for (const who of [a, b]) {
      const replay = await call(who, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.finalRacks.A).toBeDefined();
      expect(replay.body.replay.finalRacks.B).toBeDefined();
      expect(replay.body.replay.positions.length).toBeGreaterThan(1);
      expect(
        replay.body.replay.positions.every((position: any) => position.racks.A && position.racks.B),
      ).toBe(true);
    }
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("legacy v2 and v3 games load/reconnect safely, freeze all writers and preserve stored state", async ({
  browser,
}) => {
  const a = await player(),
    b = await player();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, a);
    const seen = observe(page);
    for (const version of [2, 3]) {
      const created = await call(a, {
        operation: "create",
        requestId: randomUUID(),
        policy: policy("private"),
        settings: settings(a, b),
      });
      expect(created.status).toBe(200);
      const id = created.body.id;
      await call(a, { operation: "ready", id });
      await call(b, { operation: "ready", id });
      const row = await service
        .from("room_live")
        .select("state,canonical,revision")
        .eq("room_id", id)
        .single();
      const game = decodeGame(row.data!.state);
      let legacy: any = encodeGame(game);
      if (version === 2) {
        legacy = {
          ...legacy,
          v: 2,
          board: [],
          logs: [],
          history: [],
          historyLogs: [],
          historyIndex: 0,
          rackA: game.rackA.map((tile) => LEGACY_TOKEN_TABLE.indexOf(tile.token)),
          rackB: game.rackB.map((tile) => LEGACY_TOKEN_TABLE.indexOf(tile.token)),
          tilebag: game.tilebag.map((tile) => LEGACY_TOKEN_TABLE.indexOf(tile.token)),
        };
      }
      const changed = await service
        .from("room_live")
        .update({ authority_protocol: "legacy-client", state: legacy })
        .eq("room_id", id);
      expect(changed.error).toBeNull();
      const before = sql(
        `select md5(state::text)||':'||revision from public.room_live where room_id='${id}'`,
      );
      await page.goto(`/#/play/${id}`);
      await expect(
        page.getByRole("alert").filter({ hasText: "legacy game is read-only" }),
      ).toBeVisible();
      await page.reload();
      await context.setOffline(true);
      await context.setOffline(false);
      await page.reload();
      for (const who of [a, b]) {
        const read = await browserCall(page, who, { operation: "read", id });
        expect(read.status).toBe(200);
        expect(read.body.match.continuationBlocked).toBe(true);
        expect(JSON.stringify(read.body)).not.toMatch(forbidden);
        for (const kind of ["pass", "resign"])
          expect(
            (
              await browserCall(page, who, {
                operation: "action",
                id,
                revision: read.body.match.revision,
                commandId: randomUUID(),
                action: { kind },
              })
            ).status,
          ).toBe(409);
      }
      // Actual old browser protocols are revoked at the backend, regardless of bundle cache.
      expect(
        (await a.client.from("room_live").select("state,canonical,session").eq("room_id", id))
          .error,
      ).not.toBeNull();
      expect(
        (
          await a.client.rpc("commit_live_game_command", {
            target_game_id: id,
            target_expected_revision: row.data!.revision,
            target_command_id: randomUUID(),
            target_issued_by: "A",
            target_command: { kind: "pass" },
            target_canonical: row.data!.canonical,
            target_canonical_digest: null,
            target_state: legacy,
            target_session: {},
          })
        ).error,
      ).not.toBeNull();
      expect((await call(a, { gameId: id }, "archive-replay")).status).toBe(404);
      expect(
        sql(`select md5(state::text)||':'||revision from public.room_live where room_id='${id}'`),
      ).toBe(before);
      expect(sql(`select count(*) from public.game_history where source_id='${id}'`)).toBe("0");
      await seen.flush();
      expect(JSON.stringify(seen.responses)).not.toMatch(forbidden);
    }
  } finally {
    await context.close();
  }
});
