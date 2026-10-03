import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: "user-1", isApproved: true }),
}));

import { GuardedButton } from "../src/liveGame/shell/GuardedButton";
import {
  ORPHAN_DAYS,
  WORKSPACE_PREFIX,
  forgetUserWorkspaces,
  reconcileRackOrder,
  sweepWorkspaces,
  useLiveWorkspace,
  workspaceKey,
} from "../src/liveGame/shell/workspace";
import { LeftoverNotes } from "../src/liveGame/shell/LeftoverNotes";
import { deriveLastMove, unseenPool } from "../src/liveGame/shell/derive";
import { toShellModel } from "../src/liveGame/shell/model";
import { createFixtureSession } from "../src/liveGame/shell/dev/ShellFixture";
import { createRankedGame } from "../src/features/ranked/rules";
import { rankedPublicView } from "../src/features/ranked/publicView";
import type { LiveGameView } from "../src/liveGame/projection";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
const frame = () => act(() => new Promise((resolve) => setTimeout(resolve, 40)));

describe("GuardedButton (no blanket delay)", () => {
  it("ignores a pointer press that began before the button was painted", async () => {
    const onPress = vi.fn();
    render(<GuardedButton onPress={onPress}>Pass</GuardedButton>);
    const button = screen.getByRole("button", { name: "Pass" });
    // A pointer already moving when the control appears: down before paint.
    fireEvent.pointerDown(button);
    await frame();
    fireEvent.click(button, { detail: 1 });
    // A click whose press started somewhere else entirely.
    fireEvent.click(button, { detail: 1 });
    expect(onPress).not.toHaveBeenCalled();
  });

  it("honours a fresh press immediately, and keyboard activation always", async () => {
    const onPress = vi.fn();
    render(<GuardedButton onPress={onPress}>Pass</GuardedButton>);
    const button = screen.getByRole("button", { name: "Pass" });
    fireEvent.click(button, { detail: 0 });
    expect(onPress).toHaveBeenCalledTimes(1);
    await frame();
    fireEvent.pointerDown(button);
    fireEvent.click(button, { detail: 1 });
    expect(onPress).toHaveBeenCalledTimes(2);
  });
});

describe("rack order reconciliation", () => {
  it("keeps saved slots, fills holes left by departed tiles first, and keeps deliberate holes", () => {
    expect(reconcileRackOrder(["a", null, "b", "c"], ["c", "a", "b", "d"])).toEqual([
      "a",
      "d",
      "b",
      "c",
      null,
      null,
      null,
      null,
    ]);
    // b and c were played; x and y arrive into their holes, not the deliberate one at 1.
    expect(reconcileRackOrder(["a", null, "b", "c", "e"], ["a", "e", "x", "y"])).toEqual([
      "a",
      null,
      "x",
      "y",
      "e",
      null,
      null,
      null,
    ]);
    expect(reconcileRackOrder([], ["p", "q"])).toEqual([
      "p",
      "q",
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("workspace lifecycle", () => {
  it("local mode persists; memory mode (Pass & Play) never touches storage", async () => {
    const local = renderHook(() =>
      useLiveWorkspace({
        userId: "u",
        gameId: "g",
        slot: "A",
        mode: "local",
        rackIds: ["a", "b"],
        finished: false,
      }),
    );
    act(() => local.result.current.setNotes("plan"));
    act(() => local.result.current.setOrder(["b", "a"]));
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    local.unmount();
    const again = renderHook(() =>
      useLiveWorkspace({
        userId: "u",
        gameId: "g",
        slot: "A",
        mode: "local",
        rackIds: ["a", "b"],
        finished: false,
      }),
    );
    expect(again.result.current.notes).toBe("plan");
    expect(again.result.current.order.slice(0, 2)).toEqual(["b", "a"]);

    window.localStorage.clear();
    const memory = renderHook(() =>
      useLiveWorkspace({
        userId: "u",
        gameId: "pp",
        slot: "A",
        mode: "memory",
        rackIds: ["a", "b"],
        finished: false,
      }),
    );
    act(() => memory.result.current.setOrder(["b", "a"]));
    act(() => memory.result.current.setNotes("hidden"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    expect(window.localStorage.length).toBe(0);
    expect(memory.result.current.order.slice(0, 2)).toEqual(["b", "a"]);
  });

  it("a player who was away sees the notes on the completed-game page once; leaving deletes them", async () => {
    const key = workspaceKey("user-1", "done", "B");
    window.localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        rackOrder: [],
        notes: "watch the 3E",
        updatedAt: new Date().toISOString(),
      }),
    );
    const view = render(<LeftoverNotes gameId="done" />);
    expect(screen.getByText("watch the 3E")).toBeInTheDocument();
    view.unmount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(window.localStorage.getItem(key)).toBeNull();
    render(<LeftoverNotes gameId="done" />);
    expect(screen.queryByText("watch the 3E")).toBeNull();
  });

  it("sweeps orphans after the bounded period and forgets a signed-out user's workspaces", () => {
    const old = new Date(Date.now() - (ORPHAN_DAYS + 1) * 86400000).toISOString();
    window.localStorage.setItem(
      workspaceKey("u", "old", "A"),
      JSON.stringify({ v: 1, rackOrder: [], notes: "x", updatedAt: old }),
    );
    window.localStorage.setItem(
      workspaceKey("u", "new", "A"),
      JSON.stringify({ v: 1, rackOrder: [], notes: "y", updatedAt: new Date().toISOString() }),
    );
    window.localStorage.setItem("unrelated", "keep");
    sweepWorkspaces();
    expect(window.localStorage.getItem(workspaceKey("u", "old", "A"))).toBeNull();
    expect(window.localStorage.getItem(workspaceKey("u", "new", "A"))).not.toBeNull();
    forgetUserWorkspaces("u");
    expect(
      Object.keys(window.localStorage).filter((name) => name.startsWith(WORKSPACE_PREFIX)),
    ).toEqual([]);
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});

describe("derived public information", () => {
  it("Last Move covers placement, Exchange N and Pass, skipping the end-of-game entry", async () => {
    const active = (await createFixtureSession("active").clientFor("a").read("x")).match;
    expect(deriveLastMove(active.logs)).toMatchObject({
      kind: "place",
      expression: "1+8=9",
      score: 10,
    });
    const exchanged = (await createFixtureSession("exchanged").clientFor("a").read("x")).match;
    expect(deriveLastMove(exchanged.logs)).toMatchObject({ kind: "exchange", exchangedCount: 4 });
    const thinking = (await createFixtureSession("thinking").clientFor("a").read("x")).match;
    expect(deriveLastMove(thinking.logs)).toMatchObject({ kind: "pass", side: "A" });
    const finished = (await createFixtureSession("finished").clientFor("a").read("x")).match;
    expect(finished.logs.at(-1)!.action).toBe("end_game");
    expect(deriveLastMove(finished.logs)).toMatchObject({ kind: "place", expression: "1+8=9" });
  });

  it("the unseen pool is exactly bag + opponent rack, derived without any bag data", async () => {
    const session = createFixtureSession("active");
    const view = (await session.clientFor("a").read("x")).match;
    const pool = unseenPool(view.board, [view.yourRack]);
    expect(pool.total).toBe(view.tilebagCount + view.rackCount.B);
    expect(JSON.stringify(view)).not.toMatch(/"tilebag"\s*:/);
    // Token by token it matches the true hidden inventory (checked server-side here only).
    const hidden = [...session.game.tilebag, ...session.game.rackB];
    for (const [token, count] of pool.counts)
      expect(count).toBe(hidden.filter((tile) => tile.token === token).length);
  });
});

describe("capabilities come from the projection", () => {
  const options = (ranked: boolean) => ({
    ranked,
    now: Date.now(),
    playTools: new Set(["analysis", "replay"] as const),
    client: {} as never,
  });

  it("Ranked: no Coffee Break, no analysis, surrender for a seated player", () => {
    const game = createRankedGame("me", "Me", 15, 15, "A");
    game.playerUserIds = { A: "me", B: "them" };
    game.status = "playing";
    game.roomStage = "playing";
    const model = toShellModel(rankedPublicView("m", 3, game, "me"), options(true));
    expect(model.caps.match.coffee).toBe(false);
    expect(model.caps.tools.analysis).toBe(false);
    expect(model.caps.match.surrender).toBe(true);
    expect(model.caps.match.requestPause).toBe(false);
  });

  it("Pass & Play keeps its workspace in memory; spectators get none", async () => {
    const view = (await createFixtureSession("active").clientFor("a").read("x"))
      .match as LiveGameView;
    expect(
      toShellModel({ ...view, localHandoff: true }, options(false)).caps.workspace.persistence,
    ).toBe("memory");
    const spectator = (await createFixtureSession("active").clientFor("host").read("x")).match;
    const model = toShellModel(spectator, options(false));
    expect(model.role).toBe("spectator");
    expect(model.caps.workspace).toEqual({ notes: false, persistence: "none" });
    expect(model.caps.turn.act).toBe(false);
  });

  it("a Physical host records for the side to move and sees both current racks", async () => {
    const view = (await createFixtureSession("physical").clientFor("host").read("x")).match;
    const model = toShellModel(view, {
      ...options(false),
      client: { physical: vi.fn(), administer: vi.fn() } as never,
    });
    expect(model.role).toBe("physical-host");
    expect(model.caps.turn.recordForActiveSide).toBe(true);
    expect(model.caps.record.physicalIntake).toBe(true);
    expect(model.caps.match.hostLifecycle).toBe(true);
    expect(model.hostRacks?.A).toHaveLength(8);
  });
});
