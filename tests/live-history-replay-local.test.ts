// @vitest-environment node
import { expect, it } from "vitest";
import {
  authorityTestEnabled,
  call,
  player,
  policy,
  resign,
  service,
  settings,
} from "./helpers/liveAuthority";
import type { Player } from "./live-security-browser/fixtures";

// End-to-end through the real Edge bundle and database: history controls that
// would restore the ordered bag are refused before anything is committed.
const local = authorityTestEnabled
  ? (name: string, test: () => Promise<void>) => it(name, test, 60000)
  : it.skip;

async function read(who: Player, id: string) {
  const reply = await call(who, { operation: "read", id });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body.match;
}
function send(who: Player, view: any, operation: string, action: unknown) {
  return call(who, {
    operation,
    id: view.id,
    revision: view.revision,
    commandId: crypto.randomUUID(),
    action,
  });
}
async function act(who: Player, view: any, action: unknown) {
  const reply = await send(who, view, "action", action);
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  return reply.body.match;
}
/** The database mirror refuses the same history kinds even for a service caller. */
async function expectDatabaseRefuses(owner: Player, id: string) {
  const view = await read(owner, id);
  const direct = await service.rpc("trusted_commit_live_capability", {
    p_actor_id: owner.id,
    p_room_id: id,
    p_revision: view.revision,
    p_command_id: crypto.randomUUID(),
    p_action: { kind: "undo" },
    p_canonical: {},
    p_state: {},
    p_timeline: null,
    p_timeline_version: 0,
  });
  expect(direct.error?.message).toContain("capability required");
  expect((await read(owner, id)).revision).toBe(view.revision);
}
async function expectRewindRefused(who: Player, id: string) {
  const view = await read(who, id);
  expect(view.canEditHistory).toBe(false);
  for (const action of [
    { kind: "continue", target: { nodeId: view.logs[0].id, phase: "before" } },
    { kind: "undo" },
    { kind: "redo" },
  ]) {
    const reply = await send(who, view, "control", action);
    expect(reply.status, `${action.kind}: ${JSON.stringify(reply.body)}`).toBe(403);
  }
  expect((await read(who, id)).revision, "refused controls must not commit").toBe(view.revision);
}
function expectNoTilesOf(view: unknown, tiles: { id: string }[]) {
  const text = JSON.stringify(view);
  for (const tile of tiles) expect(text).not.toContain(`"id":"${tile.id}"`);
}

async function hostedAppDrawn(seatOwner: boolean) {
  const host = await player(),
    a = seatOwner ? host : await player(),
    b = await player();
  const created = await call(host, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("private"),
    settings: {
      name: "Replay secrecy",
      playerA: "A",
      playerB: "B",
      playerAUserId: a.id,
      playerBUserId: b.id,
      emailPlayMode: "hosted",
      tileDrawMode: "play",
      startingSide: "A",
      untimed: true,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = created.body.id;
  // The fixture's ready helper launches and starts the game once both seats are ready.
  for (const who of [a, b]) expect((await call(who, { operation: "ready", id })).status).toBe(200);
  expect((await read(host, id)).status).toBe("playing");
  return { host, a, b, id };
}

/** A passes, then B swaps its whole rack for hidden draws. */
async function opponentDrawsHiddenTiles(a: Player, b: Player, id: string) {
  await act(a, await read(a, id), { kind: "pass" });
  const before = await read(b, id);
  const after = await act(b, before, {
    kind: "exchange",
    tileIds: before.yourRack.map((tile: { id: string }) => tile.id),
  });
  return after.yourRack as { id: string }[];
}

for (const seatOwner of [true, false])
  local(
    `app-drawn Hosted (${seatOwner ? "owner seated as A" : "unseated host"}) refuses rewinds that would replay the ordered bag`,
    async () => {
      const { host, a, b, id } = await hostedAppDrawn(seatOwner);
      const victimRack = await opponentDrawsHiddenTiles(a, b, id);
      await expectRewindRefused(host, id);
      await expectDatabaseRefuses(host, id);
      for (const who of seatOwner ? [b] : [a, b]) await expectRewindRefused(who, id);
      expectNoTilesOf(await read(a, id), victimRack);
      if (!seatOwner) expectNoTilesOf(await read(host, id), victimRack);
    },
  );

local("Authur rooms refuse rewinds past Authur's hidden tiles", async () => {
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
  const started = await call(owner, { operation: "ready", id });
  expect(started.status, JSON.stringify(started.body)).toBe(200);
  const played = await act(owner, started.body.match, { kind: "pass" });
  expect(played.botTurn).toBe(true);
  await expectRewindRefused(owner, id);
  await expectDatabaseRefuses(owner, id);
  await resign(owner, await read(owner, id));
});

local("Direct rooms refuse history edits in the database mirror too", async () => {
  const a = await player(),
    b = await player();
  const created = await call(a, {
    operation: "create",
    settings: settings(a, b),
    policy: policy("private"),
    requestId: crypto.randomUUID(),
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const id = created.body.id;
  for (const who of [a, b]) expect((await call(who, { operation: "ready", id })).status).toBe(200);
  await act(a, await read(a, id), { kind: "pass" });
  await expectRewindRefused(a, id);
  await expectDatabaseRefuses(a, id);
});

for (const room of ["ArchBot practice", "Solo"] as const)
  local(`${room} keeps undo through the Edge and the database mirror`, async () => {
    const owner = await player();
    const created = await call(owner, {
      operation: "create",
      settings:
        room === "Solo"
          ? {
              name: "Solo history",
              playerA: "A",
              playerB: "",
              gameMode: "solo",
              untimed: true,
              startingSide: "A",
              tileDrawMode: "play",
            }
          : { ...settings(owner), botEngine: "stage5b", botDifficulty: "stage5b64" },
      policy: policy("private"),
      requestId: crypto.randomUUID(),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.id;
    const started = await call(owner, { operation: "ready", id });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const played = await act(owner, started.body.match, { kind: "pass" });
    expect(played.canEditHistory).toBe(true);
    const undone = await send(owner, played, "control", { kind: "undo" });
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(undone.body.match.logs).toHaveLength(0);
  });
