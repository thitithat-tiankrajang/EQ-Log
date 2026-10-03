import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  available,
  call,
  env,
  player,
  policy,
  settings,
  sql,
  type Player,
} from "../live-security-browser/fixtures";

/**
 * Phase B adversarial tests directly against the REAL trusted relay (the
 * live-game Edge function on the disposable stack) and the REAL Realtime
 * authorization. No browser, no hidden controls: raw requests with genuine
 * tokens.
 */
test.skip(!available, "Existing disposable Milestone-S stack required");
const OUT = process.env.PHASE_B_EVIDENCE ?? "test-results/phase-b";
mkdirSync(OUT, { recursive: true });

async function listen(who: Player, topic: string) {
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
  await client.realtime.setAuth(who.session.access_token);
  const got: unknown[] = [];
  let status = "pending";
  client
    .channel(topic, { config: { private: true } })
    .on("broadcast", { event: "tentative" }, ({ payload }) => got.push(payload))
    .subscribe((value) => {
      status = value;
    });
  await expect.poll(() => status, { timeout: 8000 }).not.toBe("pending");
  return { got, status: () => status, close: () => client.removeAllChannels() };
}

async function liveGame() {
  const [a, b, stranger] = [await player(), await player(), await player()];
  const created = await call(a, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("public"),
    settings: settings(a, b),
  });
  const id = created.body.id as string;
  await call(a, { operation: "ready", id });
  await call(b, { operation: "ready", id });
  const view = async (who: Player) => (await call(who, { operation: "read", id })).body.match;
  const first = await view(a);
  const mover = first.activeSide === first.yourSide ? a : b;
  const waiting = mover === a ? b : a;
  return { id, mover, waiting, stranger, view };
}

test("the trusted relay refuses every invalid or unauthorized proposal", async () => {
  test.setTimeout(180_000);
  const results: Record<string, number> = {};
  const { id, mover, waiting, stranger, view } = await liveGame();
  const state = await view(mover);
  const rack = state.yourRack as { id: string; token: string }[];
  const plain = rack.find((tile) => !["+/-", "x//", "?"].includes(tile.token))!;
  const seq = () => Date.now() * 1000 + Math.floor(Math.random() * 999);
  const send = async (who: Player, body: Record<string, unknown>, name: string) => {
    const reply = await call(who, { operation: "tentative", ...body });
    results[name] = reply.status;
    return reply;
  };
  const valid = (extra: Record<string, unknown> = {}) => ({
    id,
    revision: state.revision,
    seq: seq(),
    tiles: [{ tileId: plain.id, row: 3, col: 3 }],
    ...extra,
  });

  // Listeners: the rightful recipient, the sender spying on it, a spectator.
  const rightful = await listen(waiting, `tentative:${id}:${waiting.id}`);
  const spySender = await listen(mover, `tentative:${id}:${waiting.id}`);
  const spySpectator = await listen(stranger, `tentative:${id}:${waiting.id}`);
  const spectatorOwn = await listen(stranger, `tentative:${id}:${stranger.id}`);
  const before = Number(
    sql("select count(*) from realtime.messages where topic like 'tentative:%'"),
  );

  expect((await send(mover, valid(), "valid proposal")).status).toBe(200);
  await expect.poll(() => rightful.got.length, { timeout: 8000 }).toBe(1);
  expect(rightful.got[0]).toEqual({
    gameId: id,
    revision: state.revision,
    seq: expect.any(Number),
    side: state.yourSide,
    tiles: [{ row: 3, col: 3, kind: plain.token }],
  });

  expect((await send(stranger, valid(), "non-participant")).status).toBe(403);
  expect((await send(waiting, valid(), "opponent's turn / wrong seat")).status).toBe(409);
  expect(
    (await send(mover, valid({ revision: state.revision - 1 }), "stale revision")).status,
  ).toBe(409);
  expect(
    (await send(mover, valid({ revision: state.revision + 1 }), "future revision")).status,
  ).toBe(409);
  expect(
    (await send(mover, valid({ seq: (Date.now() + 3_600_000) * 1000 }), "future sequence")).status,
  ).toBe(400);
  expect((await send(mover, valid({ seq: 1 }), "ancient sequence")).status).toBe(400);
  expect(
    (await send(mover, valid({ tiles: [{ tileId: "zz_99", row: 3, col: 3 }] }), "tile not in rack"))
      .status,
  ).toBe(400);
  expect(
    (
      await send(
        mover,
        valid({
          tiles: [
            { tileId: plain.id, row: 3, col: 3 },
            { tileId: plain.id, row: 3, col: 4 },
          ],
        }),
        "duplicate tile",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await send(
        mover,
        valid({ tiles: [{ tileId: plain.id, row: 15, col: 3 }] }),
        "illegal coordinate",
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await send(
        mover,
        valid({ tiles: [{ tileId: plain.id, row: 3, col: 3, face: "+" }] }),
        "face on a plain tile",
      )
    ).status,
  ).toBe(400);
  expect(
    (await send(mover, valid({ rack: rack.map((tile) => tile.id) }), "hidden/private field"))
      .status,
  ).toBe(400);
  expect((await send(mover, valid({ tiles: "H8" }), "malformed tiles")).status).toBe(400);
  expect(
    (
      await send(
        mover,
        valid({ tiles: [{ tileId: "x".repeat(3000), row: 3, col: 3 }] }),
        "oversized payload",
      )
    ).status,
  ).toBe(413);

  // Spam: the per-sender limit engages; the next legitimate update still works later.
  const burst = (
    await Promise.all(Array.from({ length: 40 }, () => send(mover, valid(), "burst")))
  ).map((reply) => reply.status);
  results["parallel burst of 40 → 429s"] = burst.filter((status) => status === 429).length;
  expect(results["parallel burst of 40 → 429s"]).toBeGreaterThan(0);
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // After a Pass: the old epoch is dead for both seats.
  expect(
    (
      await call(mover, {
        operation: "action",
        commandId: crypto.randomUUID(),
        id,
        revision: state.revision,
        action: { kind: "pass" },
      })
    ).status,
  ).toBe(200);
  expect((await send(mover, valid(), "after Pass (old epoch)")).status).toBe(409);
  const afterPass = await view(waiting);
  // After an Exchange by the other seat.
  const exchanged = await call(waiting, {
    operation: "action",
    commandId: crypto.randomUUID(),
    id,
    revision: afterPass.revision,
    action: { kind: "exchange", tileIds: [afterPass.yourRack[0].id] },
  });
  expect(exchanged.status).toBe(200);
  expect(
    (
      await send(
        waiting,
        { id, revision: afterPass.revision, seq: seq(), tiles: [] },
        "after Exchange (old epoch)",
      )
    ).status,
  ).toBe(409);
  // After completion: no live row any more.
  const final = await view(mover);
  expect(
    (
      await call(mover, {
        operation: "action",
        commandId: crypto.randomUUID(),
        id,
        revision: final.revision,
        action: { kind: "resign" },
      })
    ).status,
  ).toBe(200);
  expect(
    (await send(mover, { id, revision: final.revision, seq: seq(), tiles: [] }, "after completion"))
      .status,
  ).toBe(404);

  // Delivery audit: only the rightful recipient ever received anything.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  results["rightful recipient messages"] = rightful.got.length;
  results["sender spying on opponent topic"] = spySender.got.length;
  results["spectator on opponent topic"] = spySpectator.got.length;
  results["spectator on own topic"] = spectatorOwn.got.length;
  expect(spySender.got).toEqual([]);
  expect(spySpectator.got).toEqual([]);
  expect(spectatorOwn.got).toEqual([]);
  // Every received message carries only the public fields.
  for (const message of rightful.got)
    expect(Object.keys(message as object).sort()).toEqual([
      "gameId",
      "revision",
      "seq",
      "side",
      "tiles",
    ]);
  expect(JSON.stringify(rightful.got)).not.toMatch(/tileId|rack|bag|rng|canonical|history/i);
  results["tentative rows in realtime.messages"] =
    Number(sql("select count(*) from realtime.messages where topic like 'tentative:%'")) - before;
  expect(results["tentative rows in realtime.messages"]).toBe(0);
  for (const item of [rightful, spySender, spySpectator, spectatorOwn]) await item.close();
  writeFileSync(`${OUT}/boundary.json`, JSON.stringify(results, null, 2) + "\n");
});
