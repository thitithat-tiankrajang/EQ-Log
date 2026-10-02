// @vitest-environment node
import { expect, it } from "vitest";
import { authorityTestEnabled, call, player, policy, service, sql } from "./helpers/liveAuthority";
import type { Player } from "./live-security-browser/fixtures";
const local = authorityTestEnabled ? it : it.skip;
function safe(view: unknown) {
  expect(JSON.stringify(view)).not.toMatch(
    /"(?:canonical|tilebag|tilebagBefore|tilebagAfter|seed|rng|history|local_claim_token)"\s*:/,
  );
}
async function command(who: Player, view: any, operation: string, action: unknown, extra = {}) {
  const body = {
    operation,
    id: view.id,
    revision: view.revision,
    commandId: crypto.randomUUID(),
    action,
    ...extra,
  };
  const reply = await call(who, body);
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  const duplicate = await call(who, body);
  expect(duplicate.status, "Lost acknowledgements return the same revision").toBe(200);
  expect(duplicate.body.match.revision).toBe(reply.body.match.revision);
  safe(reply.body.match);
  return reply.body.match;
}
for (const role of ["host", "A+host", "B+host"])
  local(
    `Physical Hosted: ${role} current racks, recording/correction/completion and full Replay`,
    async () => {
      const host = await player(),
        a = role === "A+host" ? host : await player(),
        b = role === "B+host" ? host : await player();
      const created = await call(host, {
        operation: "create",
        requestId: crypto.randomUUID(),
        policy: policy("private"),
        settings: {
          name: "Physical capability lifecycle",
          gameMode: "versus",
          playerA: "A",
          playerB: "B",
          playerAUserId: a.id,
          playerBUserId: b.id,
          startingSide: "A",
          emailPlayMode: "hosted",
          tileDrawMode: "manual",
          untimed: true,
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id;
      await call(a, { operation: "ready", id });
      await call(b, { operation: "ready", id });
      let view = (await call(host, { operation: "read", id })).body.match;
      view = await command(host, view, "physical", {
        kind: "refill",
        side: "A",
        tokens: ["1", "+", "2", "=", "3", "4", "5", "6"],
      });
      view = await command(host, view, "physical", {
        kind: "refill",
        side: "B",
        tokens: ["1", "+", "2", "=", "3", "4", "5", "6"],
      });
      expect(view.hostRacks.A).toHaveLength(8);
      expect(view.hostRacks.B).toHaveLength(8);
      for (const [who, side, other] of [
        [a, "A", "B"],
        [b, "B", "A"],
      ] as const) {
        const read = await call(who, {
          operation: "read",
          id,
          host: true,
          role: "Host",
          side: other,
        });
        expect(read.status).toBe(200);
        safe(read.body.match);
        expect(read.body.match.yourRack).toEqual(view.hostRacks[side]);
        if (who.id !== host.id) {
          expect(read.body.match.hostRacks).toBeUndefined();
          expect(
            (
              await call(who, {
                operation: "physical",
                id,
                revision: view.revision,
                commandId: crypto.randomUUID(),
                role: "Host",
                action: { kind: "refill", side: other, tokens: [] },
              })
            ).status,
          ).toBe(403);
        }
      }
      const tokens = ["1", "+", "2", "=", "3"];
      view = await command(host, view, "admin", {
        kind: "record",
        side: "A",
        move: {
          kind: "place",
          placements: tokens.map((token, i) => ({
            tileId: view.hostRacks.A.find((t: any) => t.token === token).id,
            row: 7,
            col: 5 + i,
          })),
        },
      });
      expect(view.phase).toBe("refill");
      expect(view.activeSide).toBe("A");
      view = await command(host, view, "physical", {
        kind: "refill",
        side: "A",
        tokens: ["1", "2", "3", "4", "5"],
      });
      expect(view.activeSide).toBe("B");
      view = await command(host, view, "admin", {
        kind: "record",
        side: "B",
        move: { kind: "exchange", tileIds: [view.hostRacks.B[0].id] },
      });
      view = await command(host, view, "physical", { kind: "refill", side: "B", tokens: ["7"] });
      expect(view.activeSide).toBe("A");
      view = await command(host, view, "admin", { kind: "pause" });
      view = await command(host, view, "physical", {
        kind: "return-tile",
        side: "A",
        tileId: view.hostRacks.A[0].id,
      });
      view = await command(host, view, "physical", {
        kind: "correct-rack",
        side: "A",
        tokens: ["1", "+", "2", "=", "3", "4", "5", "6"],
      });
      view = await command(host, view, "admin", {
        kind: "correct-score",
        logId: view.logs[0].id,
        score: 12,
      });
      expect(view.scores.A).toBe(12);
      view = await command(host, view, "admin", { kind: "resume" });
      view = await command(host, view, "admin", {
        kind: "record",
        side: "A",
        move: { kind: "pass" },
      });
      // Terminal capture removes the live source. Its receipt is tested separately.
      const finished = await call(host, {
        operation: "admin",
        id,
        revision: view.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "finish" },
      });
      expect(finished.status, JSON.stringify(finished.body)).toBe(200);
      expect(sql(`select count(*) from public.room_live where room_id='${id}'`)).toBe("0");
      const replay = await call(a, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(
        replay.body.replay.positions.some(
          (p: any) => p.racks.A.length === 8 && p.racks.B.length === 8,
        ),
      ).toBe(true);
      expect(replay.body.replay.finalScores.A).toBe(12);
      expect(
        sql(
          `select count(*) from public.game_history where source_id='${id}' and participant_id='${a.id}'`,
        ),
      ).toBe("1");
    },
    45000,
  );

for (const draw of ["play", "manual"])
  local(
    `Pass & Play ${draw}: rotating owner-only handoff, concealed turns and persisted full Replay`,
    async () => {
      const owner = await player(),
        other = await player();
      const created = await call(owner, {
        operation: "create",
        requestId: crypto.randomUUID(),
        policy: policy("public"),
        settings: {
          name: "Pass & Play capability",
          gameMode: "versus",
          playerA: "A",
          playerB: "B",
          tileDrawMode: draw,
          startingSide: "A",
          untimed: true,
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id;
      let view = (await call(owner, { operation: "ready", id })).body.match;
      expect(view.mode).toBe("local_versus");
      expect(view.yourRack).toEqual([]);
      expect(view.canHandoff).toBe(true);
      expect(
        (await call(other, { operation: "handoff", id, revision: view.revision, side: "A" }))
          .status,
      ).toBe(409);
      expect((await other.client.rpc("join_live_game", { target_game_id: id })).error).toBeTruthy();
      const spectator = await call(other, { operation: "read", id });
      expect(spectator.body.match.yourRack).toEqual([]);
      expect(spectator.body.match.canHandoff).toBe(false);
      let expired: string | undefined;
      for (let turn = 0; turn < 4; turn++) {
        const side = view.activeSide;
        let handoff = await call(owner, {
          operation: "handoff",
          id,
          revision: view.revision,
          side,
        });
        expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
        if (expired)
          expect(
            (await call(owner, { operation: "read", id, handoffToken: expired })).body.match
              .yourRack,
          ).toEqual([]);
        let token = handoff.body.handoffToken;
        view = handoff.body.match;
        safe(view);
        expect(view.hostRacks).toBeUndefined();
        if (draw === "manual" && view.phase === "refill") {
          view = await command(
            owner,
            view,
            "physical",
            { kind: "refill", side, tokens: ["1", "+", "2", "=", "3", "4", "5", "6"] },
            { handoffToken: token },
          );
          expect(view.yourRack).toEqual([]);
          handoff = await call(owner, { operation: "handoff", id, revision: view.revision, side });
          token = handoff.body.handoffToken;
          view = handoff.body.match;
        }
        expect(view.yourSide).toBe(side);
        expect(view.yourRack).toHaveLength(8);
        expect((await call(owner, { operation: "read", id })).body.match.yourRack).toEqual([]); // reload/another tab has no in-memory claim
        const rotated = await call(owner, {
          operation: "handoff",
          id,
          revision: view.revision,
          side,
        });
        expect(
          (await call(owner, { operation: "read", id, handoffToken: token })).body.match.yourRack,
        ).toEqual([]);
        token = rotated.body.handoffToken;
        view = await command(owner, view, "action", { kind: "pass" }, { handoffToken: token });
        expect(view.yourRack).toEqual([]);
        expect(view.localConfirmed).toBe(false);
        expect(view.activeSide).not.toBe(side);
        expired = token;
      }
      const done = await call(owner, {
        operation: "admin",
        id,
        revision: view.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "finish" },
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const replay = await call(owner, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.turns).toHaveLength(4);
      expect(
        replay.body.replay.positions.some(
          (p: any) => p.racks.A.length === 8 && p.racks.B.length === 8,
        ),
      ).toBe(true);
      expect((await service.from("room_live").select("room_id").eq("room_id", id)).data).toEqual(
        [],
      );
    },
    45000,
  );
