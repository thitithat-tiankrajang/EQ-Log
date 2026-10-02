// @vitest-environment node
import { expect, it } from "vitest";
import { authorityTestEnabled, call, player, policy, sql, stage } from "./helpers/liveAuthority";
import type { Player } from "./live-security-browser/fixtures";
const local = authorityTestEnabled
  ? (name: string, test: () => Promise<void>) => it(name, test, 60000)
  : it.skip;
function safe(view: any) {
  expect(JSON.stringify(view)).not.toMatch(
    /"(?:canonical|tilebag|tilebagBefore|tilebagAfter|history|seed|rng|futureDraws|local_claim_token)"\s*:/,
  );
}
async function cmd(who: Player, view: any, action: any, operation = "control") {
  const request = {
    id: view.id,
    revision: view.revision,
    commandId: crypto.randomUUID(),
    operation,
    action,
  };
  const result = await call(who, request);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const duplicate = await call(who, request);
  expect(duplicate.status, JSON.stringify(duplicate.body)).toBe(200);
  expect(duplicate.body.match.revision).toBe(result.body.match.revision);
  safe(result.body.match);
  return result.body.match;
}
async function hosted(manual = false) {
  const h = await player(),
    a = await player(),
    b = await player();
  const created = await call(h, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("private"),
    settings: {
      name: "Milestone S",
      playerA: "A",
      playerB: "B",
      playerAUserId: a.id,
      playerBUserId: b.id,
      emailPlayMode: "hosted",
      tileDrawMode: manual ? "manual" : "play",
      startingSide: "A",
      untimed: true,
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const view = (await call(h, { operation: "read", id: created.body.id })).body.match;
  return { h, a, b, view };
}
async function launch(h: Player, view: any) {
  const launched = await cmd(h, view, { kind: "launch" });
  const early = await call(h, {
    operation: "control",
    id: view.id,
    revision: launched.revision,
    commandId: crypto.randomUUID(),
    action: { kind: "start" },
  });
  expect(early.status).toBe(400);
  safe(early.body);
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const started = await cmd(h, launched, { kind: "start" });
  expect(started.status).toBe("playing");
  return started;
}
local(
  "waiting configuration, Unready, role-gated launch/countdown, metadata and stale revisions",
  async () => {
    const { h, a, b, view: initial } = await hosted();
    let view = initial;
    const configured = {
      ...view.waitingSettings,
      name: "Reconfigured",
      startingSide: "B",
      timerMinutes: { A: 2, B: null },
    };
    const forged = await call(h, {
      operation: "control",
      id: view.id,
      revision: view.revision,
      commandId: crypto.randomUUID(),
      action: {
        kind: "configure",
        settings: {
          ...configured,
          tileDrawMode: "manual",
          botSide: "B",
          botEngine: "stage5b",
          gameMode: "solo",
        },
      },
    });
    expect(forged.status).toBe(400);
    expect(
      (await call(h, { operation: "read", id: view.id })).body.match.hostRacks,
    ).toBeUndefined();
    view = await cmd(h, view, { kind: "configure", settings: configured });
    expect(view.yourRack).toEqual([]);
    expect(view.clockPolicy.untimed.B).toBe(true);
    view = await cmd(a, view, { kind: "ready", ready: true });
    view = await cmd(a, view, { kind: "ready", ready: false });
    expect(view.readyBySide.A).toBe(false);
    view = await cmd(a, view, { kind: "ready", ready: true });
    view = await cmd(b, view, { kind: "ready", ready: true });
    expect(view.status).toBe("matched");
    expect(
      (
        await call(a, {
          operation: "control",
          id: view.id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "launch" },
          role: "host",
        })
      ).status,
    ).toBe(403);
    const started = await launch(h, view);
    expect(started.activeSide).toBe("B");
    view = await cmd(h, started, { kind: "rename", name: "Live name" });
    expect(view.name).toBe("Live name");
    const stale = await call(h, {
      operation: "control",
      id: view.id,
      revision: started.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "rename", name: "Stale" },
    });
    expect(stale.status).toBe(409);
    expect((await call(h, { operation: "read", id: view.id })).body.match.name).toBe("Live name");
    const raw = await a.client.rpc("set_room_ready", {
      target_room_id: view.id,
      target_side: "A",
      target_ready: true,
    });
    expect(raw.error).not.toBeNull();
  },
);
local(
  "Physical Hosted history edits restore both current racks privately, with undo/redo, branches, annotations and terminal lock",
  async () => {
    const { h, a, b, view: initial } = await hosted(true);
    let view = initial;
    view = await cmd(a, view, { kind: "ready", ready: true });
    view = await cmd(b, view, { kind: "ready", ready: true });
    view = await launch(h, view);
    for (const side of ["A", "B"])
      view = await cmd(
        h,
        view,
        { kind: "refill", side, tokens: ["1", "+", "2", "=", "3", "4", "5", "6"] },
        "physical",
      );
    const racks = view.hostRacks;
    const ids = ["1", "+", "2", "=", "3"].map(
      (token) => racks.A.find((tile: any) => tile.token === token).id,
    );
    view = await cmd(
      h,
      view,
      {
        kind: "record",
        side: "A",
        move: {
          kind: "place",
          placements: ids.map((tileId, index) => ({ tileId, row: 7, col: 5 + index })),
        },
      },
      "admin",
    );
    expect(view.board[7][5]).not.toBeNull();
    expect(view.hostRacks.A).toHaveLength(3);
    view = await cmd(
      h,
      view,
      { kind: "refill", side: "A", tokens: ["0", "7", "8", "9", "10"] },
      "physical",
    );
    const refilled = view.hostRacks;
    const logId = view.logs[0].id;
    const undoRevision = view.revision + 1;
    view = await cmd(h, view, { kind: "undo" });
    expect(view.revision).toBe(undoRevision);
    expect(view.logs).toHaveLength(1);
    expect(view.hostRacks.A).toHaveLength(3);
    view = await cmd(h, view, { kind: "undo" });
    expect(view.logs).toHaveLength(0);
    expect(view.board.flat().filter(Boolean)).toHaveLength(0);
    expect(view.hostRacks).toEqual(racks);
    view = (await call(h, { operation: "read", id: view.id })).body.match;
    expect(view.canRedo).toBe(true);
    view = await cmd(h, view, { kind: "redo" });
    expect(view.logs[0].id).toBe(logId);
    view = await cmd(h, view, { kind: "redo" });
    expect(view.hostRacks).toEqual(refilled);
    for (const who of [a, b]) {
      const recipient = (await call(who, { operation: "read", id: view.id, role: "host" })).body
        .match;
      safe(recipient);
      expect(recipient.hostRacks).toBeUndefined();
      expect(
        recipient.logs
          .filter((l: any) => l.side !== recipient.yourSide)
          .every((l: any) => !l.rackBefore && !l.rackAfter),
      ).toBe(true);
      expect(
        (
          await call(who, {
            operation: "control",
            id: view.id,
            revision: view.revision,
            commandId: crypto.randomUUID(),
            action: { kind: "undo" },
          })
        ).status,
      ).toBe(403);
    }
    view = await cmd(h, view, { kind: "annotate", logId, note: "Public review", stars: 4 });
    expect(view.logs[0].note).toBe("Public review");
    view = await cmd(h, view, { kind: "continue", target: { nodeId: logId, phase: "before" } });
    expect(view.logs).toHaveLength(0);
    expect(view.timeline.lines).toHaveLength(1);
    expect(view.timeline.lines[0].logs[0].rackBefore).toBeUndefined();
    view = await cmd(h, view, { kind: "continue", target: { nodeId: logId, phase: "after" } });
    expect(view.logs[0].stars).toBe(4);
    view = await cmd(h, view, { kind: "continue", target: { nodeId: logId, phase: "before" } });
    const line = view.timeline.lines[0].id;
    view = await cmd(h, view, { kind: "prune", lineId: line });
    expect(view.timeline.lines).toHaveLength(0);
    const table = await a.client.from("game_timelines").select("doc").eq("game_id", view.id);
    expect(table.error).not.toBeNull();
    const finished = await call(h, {
      operation: "admin",
      id: view.id,
      revision: view.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "finish" },
    });
    expect(finished.status).toBe(200);
    expect(sql(`select count(*) from public.room_live where room_id='${view.id}'`)).toBe("0");
    expect(
      (
        await call(h, {
          operation: "control",
          id: view.id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "undo" },
        })
      ).status,
    ).toBe(404);
  },
);
local(
  "Direct pause request/decline/block/ack/accept/resume persists across reconnect",
  async () => {
    const a = await player(),
      b = await player();
    const created = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Direct negotiation",
        playerA: "A",
        playerB: "B",
        playerAUserId: a.id,
        playerBUserId: b.id,
        emailPlayMode: "direct",
        tileDrawMode: "play",
        startingSide: "A",
        timerMinutes: { A: 1, B: null },
      },
    });
    expect(created.status).toBe(200);
    let view = (await call(a, { operation: "read", id: created.body.id })).body.match;
    view = await cmd(b, view, { kind: "ready", ready: true });
    view = await launch(a, view);
    view = await cmd(a, view, { kind: "request-pause" });
    const requestId = view.matchControl.stopRequest.id;
    expect(
      (
        await call(a, {
          operation: "control",
          id: view.id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "respond-pause", requestId, accept: true },
        })
      ).status,
    ).toBe(400);
    view = await cmd(b, view, {
      kind: "respond-pause",
      requestId,
      accept: false,
      blockFiveMinutes: true,
    });
    view = (await call(a, { operation: "read", id: view.id })).body.match;
    expect(view.matchControl.stopResponse.blockedForMs).toBe(300000);
    view = await cmd(a, view, {
      kind: "acknowledge-pause",
      responseId: view.matchControl.stopResponse.id,
    });
    expect(
      (
        await call(a, {
          operation: "control",
          id: view.id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "request-pause" },
        })
      ).status,
    ).toBe(400);
    view = await cmd(b, view, { kind: "request-pause" });
    view = await cmd(a, view, {
      kind: "respond-pause",
      requestId: view.matchControl.stopRequest.id,
      accept: true,
    });
    expect(view.paused).toBe(true);
    const paused = view.timers.A;
    await new Promise((r) => setTimeout(r, 1100));
    view = await cmd(b, view, { kind: "resume-direct" });
    expect(view.timers.A).toBe(paused);
    expect(view.paused).toBe(false);
  },
);
local(
  "Stage inherited undo/redo/annotations/alternate restore retains sealed opening and private bot history",
  async () => {
    const owner = await player("pro");
    const created = await stage(owner);
    let view = created.match;
    const openingBoard = view.board,
      initialLogs = view.logs.length;
    view = await cmd(owner, view, { kind: "pass" }, "action");
    const logId = view.logs.at(-1).id;
    view = await cmd(owner, view, { kind: "undo" });
    expect(view.board).toEqual(openingBoard);
    expect(view.logs).toHaveLength(initialLogs);
    view = await cmd(owner, view, { kind: "redo" });
    expect(view.logs.at(-1).id).toBe(logId);
    view = await cmd(owner, view, { kind: "annotate", logId, note: "Stage review", stars: 5 });
    view = await cmd(owner, view, { kind: "continue", target: { nodeId: logId, phase: "before" } });
    expect(view.scores.A).toBeGreaterThanOrEqual(created.match.scores.A);
    view = await cmd(owner, view, { kind: "continue", target: { nodeId: logId, phase: "after" } });
    expect(
      view.logs
        .filter((l: any) => l.side !== view.yourSide)
        .every((l: any) => !l.rackBefore && !l.rackAfter),
    ).toBe(true);
    const raw = await owner.client.rpc("trusted_commit_live_capability", {
      p_actor_id: owner.id,
      p_room_id: view.id,
      p_revision: view.revision,
      p_command_id: crypto.randomUUID(),
      p_action: { kind: "undo" },
      p_canonical: {},
      p_state: {},
      p_timeline: null,
      p_timeline_version: 0,
    });
    expect(raw.error).not.toBeNull();
  },
);
