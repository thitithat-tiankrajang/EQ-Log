import { describe, expect, it } from "vitest";
import { createNewGame, makeSnapshot, pushActionSnapshot } from "../src/game";
import { encodeGame, decodeGame } from "../src/codec";
import { applyRankedAction } from "../src/features/ranked/rules";
import { applyLiveControl, canControlLive } from "../src/liveGame/controls";
import { resolveLiveCapabilities } from "../src/liveGame/capabilities";
import { projectLiveGame } from "../src/liveGame/projection";
import { ownAnalysisRequest } from "../src/liveGame/analysis";
import { EMPTY_MULTIVERSE } from "../src/gameplay/multiverse";
const now = "2026-10-01T12:00:00Z";
const facts = {
  ownerId: "host",
  seats: { A: "a", B: "b" },
  revision: 2,
  mode: "hosted_versus",
  purpose: "normal",
  authorityProtocol: "server-v1",
};
const game = () =>
  createNewGame({
    name: "History",
    playerA: "A",
    playerB: "B",
    playerAUserId: "a",
    playerBUserId: "b",
    emailPlayMode: "hosted",
    tileDrawMode: "play",
    startingSide: "A",
    untimed: true,
  });
describe("private compatibility authority", () => {
  it("waiting configuration cannot inject draw policy, bot identity, mode or hidden position", () => {
    const prior = { ...game(), roomStage: "waiting" as const };
    const caps = resolveLiveCapabilities(facts, prior, "host");
    const settings = {
      name: "Configured",
      playerA: "A",
      playerB: "B",
      playerAUserId: "a",
      playerBUserId: "b",
      startingSide: "A" as const,
      timerMinutes: { A: 1, B: null },
    };
    for (const key of [
      "tileDrawMode",
      "gameMode",
      "botEngine",
      "botSide",
      "rackA",
      "tilebag",
      "seed",
    ])
      expect(() =>
        applyLiveControl(
          prior,
          EMPTY_MULTIVERSE,
          facts,
          caps,
          { kind: "configure", settings: { ...settings, [key]: "forged" } },
          now,
        ),
      ).toThrow("Invalid waiting settings");
  });
  it("undo/redo survives the real codec without restoring name or elapsed clock", () => {
    let prior = game();
    prior.history = [makeSnapshot(prior)];
    prior = pushActionSnapshot({
      ...applyRankedAction(prior, "A", { kind: "pass" }, now, "normal"),
      history: prior.history,
    });
    prior = { ...prior, name: "Renamed", timers: { ...prior.timers, A: 321 } };
    const caps = resolveLiveCapabilities(facts, prior, "host");
    const undone = applyLiveControl(
      prior,
      EMPTY_MULTIVERSE,
      facts,
      caps,
      { kind: "undo" },
      now,
    ).game;
    expect(undone.logs).toHaveLength(0);
    expect(undone.name).toBe("Renamed");
    expect(undone.timers.A).toBe(321);
    const reloaded = decodeGame(encodeGame(undone));
    const redone = applyLiveControl(
      reloaded,
      EMPTY_MULTIVERSE,
      facts,
      caps,
      { kind: "redo" },
      now,
    ).game;
    expect(redone.logs).toHaveLength(1);
    expect(redone.activeSide).toBe("B");
    expect(() =>
      applyLiveControl(redone, EMPTY_MULTIVERSE, facts, caps, { kind: "redo" }, now),
    ).toThrow();
  });
  it("only stored owner capabilities authorize editing; Direct seats cannot undo", () => {
    const prior = game();
    for (const actor of ["a", "b", "spectator"])
      expect(
        canControlLive(facts, prior, resolveLiveCapabilities(facts, prior, actor), actor, "undo"),
      ).toBe(false);
    const direct = { ...prior, emailPlayMode: "direct" as const };
    expect(
      canControlLive(
        { ...facts, ownerId: "a" },
        direct,
        resolveLiveCapabilities({ ...facts, ownerId: "a" }, direct, "a"),
        "a",
        "undo",
      ),
    ).toBe(false);
    expect(
      canControlLive(
        facts,
        { ...prior, status: "finished" },
        resolveLiveCapabilities(facts, prior, "host"),
        "host",
        "undo",
      ),
    ).toBe(false);
  });
  it("Direct requests preserve decline/block/ack/resume semantics and actor identities", () => {
    const source = { ...facts, ownerId: "a" };
    let prior = { ...game(), emailPlayMode: "direct" as const };
    const act = (actor: string, action: Parameters<typeof applyLiveControl>[4], at = now) => {
      const caps = resolveLiveCapabilities(source, prior, actor);
      prior = applyLiveControl(prior, EMPTY_MULTIVERSE, source, caps, action, at).game;
    };
    act("a", { kind: "request-pause" });
    const requestId = prior.matchControl!.stopRequest!.id;
    expect(() => act("a", { kind: "respond-pause", requestId, accept: true })).toThrow();
    act("b", { kind: "respond-pause", requestId, accept: false, blockFiveMinutes: true });
    expect(prior.status).toBe("playing");
    expect(() => act("a", { kind: "request-pause" })).toThrow();
    act("a", { kind: "acknowledge-pause", responseId: prior.matchControl!.stopResponse!.id });
    const later = "2026-10-01T12:05:01Z";
    act("a", { kind: "request-pause" }, later);
    act(
      "b",
      { kind: "respond-pause", requestId: prior.matchControl!.stopRequest!.id, accept: true },
      later,
    );
    expect(prior.timers.paused).toBe(true);
    act("a", { kind: "resume-direct" }, later);
    expect(prior.status).toBe("playing");
  });
  it("live history/practice/analysis projections are invariant under opponent historical secrets", () => {
    const prior = game();
    const next = applyRankedAction(prior, "A", { kind: "pass" }, now, "normal");
    next.history = [makeSnapshot(prior), makeSnapshot(next)];
    const other = structuredClone(next);
    other.tilebag.reverse();
    other.history.forEach((snapshot) => {
      snapshot.rackB = snapshot.rackB.map((t) => ({ ...t, token: "20" }));
    });
    const a = projectLiveGame("id", 2, next, "A", "hosted_versus"),
      b = projectLiveGame("id", 2, other, "A", "hosted_versus");
    // Counts are public; changing identities, while retaining count, cannot
    // change a permitted analysis. No canonical source enters the engine.
    expect(ownAnalysisRequest(a, { logId: a.logs[0].id, level: "quick" })).toEqual(
      ownAnalysisRequest(b, { logId: b.logs[0].id, level: "quick" }),
    );
    expect(() => ownAnalysisRequest({ ...a, yourSide: "B" }, { logId: a.logs[0].id })).toThrow();
    expect(() => ownAnalysisRequest(a, { logId: "unknown-turn" })).toThrow();
    expect(JSON.stringify(a)).not.toMatch(/"(?:history|tilebag|canonical|seed|rng)"\s*:/);
  });
  it("ArchBot's current search rack is a stored normal-practice owner exception only", () => {
    const prior = createNewGame({
      name: "ArchBot",
      playerA: "A",
      playerB: "ArchBot",
      playerAUserId: "a",
      botSide: "B",
      botEngine: "stage5b",
      botDifficulty: "stage5b64",
      startingSide: "B",
      tileDrawMode: "play",
      untimed: true,
    });
    const archFacts = { ...facts, mode: "stage5b_standard", ownerId: "a", seats: { A: "a" } };
    const owner = projectLiveGame(
      "arch",
      2,
      prior,
      "A",
      archFacts.mode,
      false,
      false,
      undefined,
      undefined,
      archFacts,
    );
    expect(owner.practiceBot?.request.rack).toEqual(prior.rackB.map((t) => t.token));
    expect(JSON.stringify(owner)).not.toMatch(
      /"(?:tilebag|history|canonical|rngStep|decisionSeed)"\s*:/,
    );
    for (const denied of [
      { ...archFacts, ownerId: "other" },
      { ...archFacts, purpose: "stage" },
      { ...archFacts, mode: "online_versus" },
      { ...archFacts, mode: "authur_strong" },
    ])
      expect(
        projectLiveGame(
          "arch",
          2,
          prior,
          "A",
          denied.mode,
          false,
          false,
          undefined,
          undefined,
          denied,
        ).practiceBot,
      ).toBeUndefined();
    expect(
      projectLiveGame(
        "arch",
        2,
        prior,
        null,
        archFacts.mode,
        false,
        false,
        undefined,
        undefined,
        archFacts,
      ).practiceBot,
    ).toBeUndefined();
  });
});
