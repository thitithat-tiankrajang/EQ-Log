import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  subscribe: vi.fn(),
  remove: vi.fn(),
  event: null as null | (() => void),
  decide: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../src/bot/archbot/client", () => ({
  createArchBotEngine: () => ({ decide: mock.decide, dispose: mock.dispose }),
}));
vi.mock("../src/supabaseClient", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    channel: vi.fn(() => ({
      on: (_name: string, _filter: unknown, cb: () => void) => {
        mock.event = cb;
        return { subscribe: mock.subscribe };
      },
    })),
    removeChannel: mock.remove,
  },
}));
import { liveGameClient } from "../src/liveGame/client";
import type { LiveGameView } from "../src/liveGame/projection";
beforeEach(() => {
  mock.invoke.mockReset();
  mock.remove.mockReset();
  mock.subscribe.mockReset();
  mock.decide.mockReset();
  mock.dispose.mockReset();
  window.localStorage.clear();
  mock.subscribe.mockReturnValue({ channel: "notifications" });
});
it("shares a browser ArchBot calculation across polls and retries its proposal/UUID after a lost acknowledgement", async () => {
  const match = {
    id: "arch-retry",
    revision: 2,
    practiceBot: { side: "B", request: { rack: ["1"] } },
  };
  mock.decide.mockResolvedValue({ decision: { type: "pass", placements: [], exchange: [] } });
  mock.invoke.mockImplementation(async (_name, { body }) =>
    body.operation === "read"
      ? { data: { match }, error: null }
      : { data: null, error: { message: "Lost acknowledgement" } },
  );
  const first = liveGameClient.botTurn(match.id, 2),
    second = liveGameClient.botTurn(match.id, 2);
  expect(first).toBe(second);
  await first.catch(() => null);
  mock.invoke.mockImplementation(async (_name, { body }) => ({
    data: {
      match: body.operation === "read" ? match : { ...match, revision: 3, practiceBot: undefined },
    },
    error: null,
  }));
  await liveGameClient.botTurn(match.id, 2);
  const proposals = mock.invoke.mock.calls
    .map((c) => c[1].body)
    .filter((b) => b.operation === "practice-bot");
  expect(mock.decide).toHaveBeenCalledTimes(1);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
  expect(proposals).toHaveLength(2);
  expect(proposals[0]).toEqual(proposals[1]);
  expect(window.localStorage.length).toBe(0);
});
it("reuses the same command intent after a lost response and never persists a full game", async () => {
  mock.invoke
    .mockResolvedValueOnce({ data: null, error: { message: "Network unavailable" } })
    .mockResolvedValueOnce({
      data: { match: { id: "room", revision: 4, yourSide: "A", yourRack: [] } },
      error: null,
    });
  await liveGameClient.action("room", 3, { kind: "pass" }).catch(() => null);
  await liveGameClient.action("room", 3, { kind: "pass" });
  const bodies = mock.invoke.mock.calls.map((call) => call[1].body);
  expect(bodies[0].commandId).toBe(bodies[1].commandId);
  expect(Object.keys(bodies[0]).sort()).toEqual(
    ["operation", "id", "revision", "commandId", "action"].sort(),
  );
  expect(window.localStorage.length).toBe(0);
});
it("conceals a late Pass & Play read, including outgoing rack history in parked lines", async () => {
  const rack = [{ id: "outgoing-private-tile", token: "1" }];
  const log = { id: "own-log", side: "A", rackBefore: rack, rackAfter: rack };
  const view = {
    id: "late-local-read",
    revision: 4,
    localHandoff: true,
    localConfirmed: true,
    yourSide: "A",
    yourRack: rack,
    logs: [log],
    timeline: { version: 1, lines: [{ id: "parked", logs: [log] }] },
  } as unknown as LiveGameView;
  let deliver!: (result: unknown) => void;
  mock.invoke.mockImplementation(async (_name, { body }) =>
    body.operation === "read"
      ? new Promise((resolve) => {
          deliver = resolve;
        })
      : { data: { match: { ...view, revision: 5 } }, error: null },
  );
  const late = liveGameClient.read(view.id);
  await liveGameClient.action(view.id, 4, { kind: "pass" });
  deliver({ data: { match: view }, error: null });
  const concealed = (await late).match;
  expect(concealed.yourSide).toBeNull();
  expect(concealed.localConfirmed).toBe(false);
  expect(JSON.stringify(concealed)).not.toContain("outgoing-private-tile");
  expect(concealed.timeline?.lines[0].logs[0].id).toBe("own-log");
  expect(concealed.timeline?.version).toBe(1);
});
it("reconciles on reconnect, focus and revision-only notifications, without adopting event state", () => {
  const refresh = vi.fn();
  const stop = liveGameClient.subscribe("room", refresh);
  mock.event!();
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("focus"));
  expect(refresh).toHaveBeenCalledTimes(3);
  stop();
  window.dispatchEvent(new Event("online"));
  expect(refresh).toHaveBeenCalledTimes(3);
  expect(mock.remove).toHaveBeenCalled();
});
