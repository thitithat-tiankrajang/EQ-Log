// The three decisions the client-side Super bot makes before it thinks, and the
// one it makes about the position itself.
//
//   • which engine version and weights this GAME plays under  (pinning)
//   • how fast this DEVICE is, and whether that is fast enough (calibration)
//   • what the engine is told about the position                (the adapter)
//
// The adapter is the one with a silent failure mode, and it is the reason this
// file exists at all. The server builds the same request from canonical state
// in `service/src/adapter.ts`. Where the two disagree, the bot plays
// differently depending on where it thought — two legal moves, both plausible,
// no error anywhere and nothing on screen to notice.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { classify } from "../src/bot/calibration";
import { buildSuperRequest, seedFor, trailingNoScoreStreak } from "../src/bot/superRequest";
import { configForGame, invalidateConfigCache, currentConfig } from "../src/bot/superConfig";
import type { BotConfigResponse } from "../src/bot/engineApi";
import type { CalibrationResult } from "../src/bot/superTypes";
import { createNewGame, type GameState } from "../src/game";

vi.mock("../src/bot/engineApi", async () => {
  const actual =
    await vi.importActual<typeof import("../src/bot/engineApi")>("../src/bot/engineApi");
  return { ...actual, fetchBotConfig: vi.fn() };
});
const { fetchBotConfig } = await import("../src/bot/engineApi");

// A stand-in for the signed-in session, so a test can switch accounts.
let sessionUserId: string | null = null;
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
      }),
    },
  },
}));

const REFERENCE_CONFIG: BotConfigResponse = {
  clientSuperEnabled: true,
  engineVersion: "super-v8",
  weightsVersion: "v1",
  weights: {},
  calibration: {
    benchmark: "gen-nodes-v1",
    reference: {
      benchmark: "gen-nodes-v1",
      device: "reference",
      nodesPerSec: 5_730_000,
      // Round numbers, so the arithmetic under test is legible rather than
      // hidden behind the real measurements. The shape is the real one: a full
      // Super move is MINUTES, an order of magnitude past any latency target a
      // player would have been promised.
      fullSuper: { p50Ms: 200_000, p95Ms: 300_000, positions: 13 },
    },
    tiers: [
      { tier: "EXCELLENT", maxEstimatedMoveMs: 30_000 },
      { tier: "GOOD", maxEstimatedMoveMs: 120_000 },
      { tier: "SLOW", maxEstimatedMoveMs: 600_000 },
      { tier: "NOT_RECOMMENDED", maxEstimatedMoveMs: null },
    ],
    warnAboveMs: 60_000,
    // Off, as it is in production. The one test that exercises it turns it on
    // explicitly, which is the only way it is ever meant to come on. Note that
    // the latency targets live in HERE — the default path is handed none.
    adaptiveBudget: {
      enabled: false,
      targets: { p50Ms: 15_000, p95Ms: 30_000 },
      budgets: [
        { sampleCap: 4, p50Ms: 5_000, p95Ms: 11_000 },
        { sampleCap: 8, p50Ms: 10_000, p95Ms: 20_000 },
        { sampleCap: 16, p50Ms: 20_000, p95Ms: 40_000 },
        { sampleCap: null, p50Ms: 200_000, p95Ms: 300_000 },
      ],
    },
  },
};

function calibrationAt(nodesPerSec: number): CalibrationResult {
  return {
    mode: "calibrate",
    benchmark: "gen-nodes-v1",
    nodes: 2_000_000,
    elapsedMs: (2_000_000 / nodesPerSec) * 1000,
    nodesPerSec,
    moves: 493,
    capBound: true,
  };
}

describe("device calibration", () => {
  // The product requirement these tests exist to defend, in one sentence: Super
  // plays the same on every device, and only the WAIT changes.
  //
  // The requirement is here rather than in a design document because it has
  // already been broken once. An earlier revision scaled a table of per-budget
  // latencies and handed each device the largest sample cap that fitted a
  // 15s/30s latency target, which gave a reference-speed M3 8 of Super's 160
  // samples while the backend fallback ran all 160. Nothing failed; the bot was
  // just quietly weaker on slower hardware.
  //
  // Super is the strongest bot on offer, and searching exhaustively is what
  // makes it that. A player who does not want to wait picks `max`, `hard` or
  // `medium` — a choice they make, rather than one their laptop makes for them.

  it("gives a reference-speed device the FULL Super schedule", () => {
    const tiered = classify(calibrationAt(5_730_000), REFERENCE_CONFIG);
    // `null` is the full schedule, and the request omits the field entirely so
    // the engine falls through to all 160 samples.
    expect(tiered.sampleCap).toBeNull();
    expect(tiered.adaptiveBudgetApplied).toBe(false);
    // The estimate is of the full schedule — the thing this device will really
    // run — so it is minutes, and it says so rather than quoting the latency of
    // a smaller search nobody is going to perform.
    expect(tiered.estimatedMoveMs).toEqual({ p50: 200_000, p95: 300_000 });
  });

  it("makes a slower device WAIT longer, not search less", () => {
    const full = classify(calibrationAt(5_730_000), REFERENCE_CONFIG);
    const half = classify(calibrationAt(2_865_000), REFERENCE_CONFIG);

    // The only thing that changed is the clock.
    expect(half.estimatedMoveMs.p50).toBe(full.estimatedMoveMs.p50 * 2);
    expect(half.sampleCap).toBe(full.sampleCap);
    expect(half.sampleCap).toBeNull();
  });

  it("scales by measured throughput, not by what the CPU is called", () => {
    const quick = classify(calibrationAt(57_300_000), REFERENCE_CONFIG);
    expect(quick.estimatedMoveMs).toEqual({ p50: 20_000, p95: 30_000 });
    expect(quick.tier).toBe("EXCELLENT");
    // A fast device gets the same schedule as a slow one. It simply finishes it
    // sooner, which is the entire benefit a fast device is supposed to confer.
    expect(quick.sampleCap).toBeNull();
  });

  it("still runs full Super on a device that will take many minutes", () => {
    // The case an earlier revision refused outright, and the one the
    // requirement is most specific about: a very slow device runs the SAME full
    // Super and may take several minutes over it.
    const crawling = classify(calibrationAt(400_000), REFERENCE_CONFIG);
    expect(crawling.tier).toBe("NOT_RECOMMENDED");
    expect(crawling.sampleCap).toBeNull();
    expect(crawling.adaptiveBudgetApplied).toBe(false);
    // `NOT_RECOMMENDED` is a description of a wait, not a refusal. Nothing on
    // this object can stop the search — there is no `allowed` field to set.
    expect("allowed" in crawling).toBe(false);
    expect(crawling.estimatedMoveMs.p50).toBeGreaterThan(600_000);
  });

  it("warns about a long wait instead of shortening it", () => {
    const slow = classify(calibrationAt(400_000), REFERENCE_CONFIG);
    const quick = classify(calibrationAt(57_300_000), REFERENCE_CONFIG);
    // The ONLY consequence of measuring slow: a line of copy.
    expect(slow.warnAboutWait).toBe(true);
    expect(quick.warnAboutWait).toBe(false);
    // And it costs the search nothing — both devices run the same schedule.
    expect(slow.sampleCap).toBe(quick.sampleCap);
  });

  it("never divides by a zero throughput", () => {
    const broken = classify(calibrationAt(0), REFERENCE_CONFIG);
    expect(Number.isFinite(broken.estimatedMoveMs.p50)).toBe(true);
    expect(broken.sampleCap).toBeNull();
  });

  describe("the experimental adaptive budget", () => {
    // It still exists, because the latency measurements behind it are real and
    // a future strength experiment would need them. What it must never be is
    // on by default — so what is tested is precisely that: off unless asked,
    // and self-identifying when asked.
    const ADAPTIVE_CONFIG: BotConfigResponse = {
      ...REFERENCE_CONFIG,
      calibration: {
        ...REFERENCE_CONFIG.calibration,
        adaptiveBudget: { ...REFERENCE_CONFIG.calibration.adaptiveBudget, enabled: true },
      },
    };

    it("does nothing at all while the flag is off", () => {
      // Same device, same budget table, and the table is simply not consulted.
      expect(classify(calibrationAt(5_730_000), REFERENCE_CONFIG).sampleCap).toBeNull();
    });

    it("caps the schedule when explicitly switched on, and says that it did", () => {
      const tiered = classify(calibrationAt(5_730_000), ADAPTIVE_CONFIG);
      expect(tiered.sampleCap).toBe(8);
      // The flag that keeps a capped run out of any average of "Super latency".
      // Without it a 10-second reading from a 5%-strength search would sit in
      // the same column as a 200-second reading from the real thing.
      expect(tiered.adaptiveBudgetApplied).toBe(true);
      expect(tiered.estimatedMoveMs).toEqual({ p50: 10_000, p95: 20_000 });
    });

    it("leaves the full schedule alone when no cap fits either", () => {
      // Nothing on the table fits, so there is no weaker-but-acceptable option
      // to take. The device runs full Super and is judged on that.
      const slow = classify(calibrationAt(400_000), ADAPTIVE_CONFIG);
      expect(slow.sampleCap).toBeNull();
      expect(slow.adaptiveBudgetApplied).toBe(false);
    });
  });
});

describe("version pinning", () => {
  beforeEach(() => {
    invalidateConfigCache();
    sessionUserId = null;
    vi.mocked(fetchBotConfig).mockReset();
    vi.mocked(fetchBotConfig).mockResolvedValue(REFERENCE_CONFIG);
  });

  // ── the rollout flag is now a PER-USER answer ────────────────────────────
  //
  // `clientSuperEnabled` is `true` for a Champion and `false` for everybody
  // else, and this cache lives in `localStorage`. Both facts together are the
  // hazard these two tests exist for: a shared laptop, a demo machine or an
  // ordinary account switch would otherwise let a general user inherit a
  // Champion's rollout flag for the ten minutes of the TTL, and spend them
  // running Super locally.

  it("does not serve one user's rollout flag to the next user", async () => {
    sessionUserId = "champion-1";
    vi.mocked(fetchBotConfig).mockResolvedValue({ ...REFERENCE_CONFIG, clientSuperEnabled: true });
    expect((await currentConfig()).clientSuperEnabled).toBe(true);

    // Same browser, same storage, different person.
    sessionUserId = "general-user-2";
    vi.mocked(fetchBotConfig).mockResolvedValue({ ...REFERENCE_CONFIG, clientSuperEnabled: false });
    expect((await currentConfig()).clientSuperEnabled).toBe(false);
    // Re-fetched rather than read from the Champion's entry.
    expect(vi.mocked(fetchBotConfig)).toHaveBeenCalledTimes(2);
  });

  it("still caches within one signed-in user", async () => {
    // The fix must not cost the thing the cache is for: a bot turn never pays
    // a config round trip.
    sessionUserId = "champion-1";
    await currentConfig();
    await currentConfig();
    expect(vi.mocked(fetchBotConfig)).toHaveBeenCalledTimes(1);
  });

  it("fetches once and serves the rest from cache", async () => {
    await currentConfig();
    await currentConfig();
    await currentConfig();
    // A bot move must never cost a config round trip: the point of the whole
    // exercise is that the turn does not need the network.
    expect(vi.mocked(fetchBotConfig)).toHaveBeenCalledTimes(1);
  });

  it("uses the current version for a game with no pin", async () => {
    const config = await configForGame({});
    expect(config.weightsVersion).toBe("v1");
    expect(vi.mocked(fetchBotConfig).mock.calls[0]![0].weightsVersion).toBeUndefined();
  });

  it("asks for the PINNED version when the default has moved on", async () => {
    vi.mocked(fetchBotConfig).mockImplementation(async (options) =>
      options.weightsVersion === "v1"
        ? { ...REFERENCE_CONFIG, weightsVersion: "v1" }
        : { ...REFERENCE_CONFIG, weightsVersion: "v2", weights: { heavyBurden: 4 } },
    );
    // Current is v2 now.
    expect((await currentConfig()).weightsVersion).toBe("v2");
    // A game pinned to v1 still gets v1 — this is the whole point. A game that
    // switched evaluators mid-match was played by two opponents and no record
    // written afterwards could say which move belonged to which.
    const pinned = await configForGame({ weightsVersion: "v1" });
    expect(pinned.weightsVersion).toBe("v1");
    expect(pinned.weights).toEqual({});
  });
});

describe("the client-side adapter", () => {
  it("hashes the seed exactly as the service does", () => {
    // Copied from `seedFor` in service/src/adapter.ts, constants and all. It is
    // what makes a device-computed move and a server-computed move the SAME
    // move for the same position — without which the fallback path would be a
    // second opponent rather than a fallback.
    const fnv = (text: string) => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0) % 2147483647 || 1;
    };
    for (const [room, revision] of [
      ["11111111-2222-3333-4444-555555555555", 0],
      ["11111111-2222-3333-4444-555555555555", 41],
      ["a", 999999],
    ] as const) {
      expect(seedFor(room, revision)).toBe(fnv(`${room}:${revision}`));
    }
  });

  it("keys the seed on revision, so one turn's two positions differ", () => {
    expect(seedFor("room", 12)).not.toBe(seedFor("room", 13));
  });

  function botGame(): GameState {
    return createNewGame({
      name: "bench",
      playerA: "Human",
      playerB: "Aether",
      startingSide: "A",
      botSide: "B",
      botDifficulty: "super",
      tileDrawMode: "play",
    });
  }

  it("describes the position the way the engine expects", () => {
    const game = { ...botGame(), activeSide: "B" as const };
    const request = buildSuperRequest(game, {
      roomId: "room-1",
      revision: 5,
      sampleCap: null,
      weights: undefined,
      topN: 24,
    });

    expect(request.difficulty).toBe("super");
    expect(request.solver).toBe("sim");
    // What makes `super` `super`: the search stops when its schedule is
    // finished, not when a deadline fires.
    expect(request.unlimited).toBe(true);
    // No cap at the top tier — the full schedule.
    expect(request.sampleCap).toBeUndefined();
    expect(request.seed).toBe(seedFor("room-1", 5));
    expect(request.rack.length).toBeGreaterThan(0);
    // The opponent reaches the engine as a COUNT, never as tiles.
    expect(typeof request.oppRackCount).toBe("number");
  });

  it("counts pending exchange returns as unseen, like the service does", () => {
    // A swapped tile is off-board and out of every rack, but it is still
    // UNSEEN and rejoins the bag. Counting it is what keeps
    // `unseen.total == oppRackCount + bagCount`, the exact predicate the engine
    // uses to decide a position is endgame-eligible. Dropping it makes the
    // engine decline endgames it could have proven.
    const base = botGame();
    const returned = base.tilebag.slice(0, 2);
    const game: GameState = {
      ...base,
      tilebag: base.tilebag.slice(2),
      pendingExchangeReturnBySide: { A: returned, B: [] },
    };
    const request = buildSuperRequest(game, {
      roomId: "room-1",
      revision: 1,
      sampleCap: null,
      weights: undefined,
      topN: 24,
    });
    expect(request.bagCount).toBe(game.tilebag.length + 2);
  });

  it("asks for FULL Super — no sample cap — on a default device", () => {
    // The requirement, at the exact boundary where it would be violated.
    //
    // `sampleCap` must be ABSENT, not zero and not 160: the engine reads a
    // missing field as `cfg.simSamples` and runs the whole 160-sample schedule
    // (amath-engine/src/engine.cpp:1972). A present-but-smaller number here is
    // the entire mechanism by which a device could get a weaker bot, so this
    // asserts on the property rather than on the value.
    const request = buildSuperRequest(botGame(), {
      roomId: "r",
      revision: 1,
      sampleCap: null,
      weights: undefined,
      topN: 24,
    });
    expect("sampleCap" in request).toBe(false);
    // And the search runs to the END of its schedule rather than to a deadline,
    // which is what turns a slow device into a long wait instead of a small
    // search.
    expect(request.unlimited).toBe(true);
  });

  it("sends a sample cap only when the device was explicitly given one", () => {
    const capped = buildSuperRequest(botGame(), {
      roomId: "r",
      revision: 1,
      sampleCap: 8,
      weights: undefined,
      topN: 24,
    });
    expect(capped.sampleCap).toBe(8);
  });

  it("omits weights entirely when there are none, rather than sending {}", () => {
    const game = botGame();
    const none = buildSuperRequest(game, {
      roomId: "r",
      revision: 1,
      sampleCap: null,
      weights: {},
      topN: 24,
    });
    // The engine reports how many overrides it applied, and the client reads
    // that back to tell "the pinned version ran" from "the engine used its
    // compiled defaults". An empty object would muddy nothing here, but sending
    // one implies a tuning document that does not exist.
    expect(none.weights).toBeUndefined();

    const tuned = buildSuperRequest(game, {
      roomId: "r",
      revision: 1,
      sampleCap: null,
      weights: { heavyBurden: 4 },
      topN: 24,
    });
    expect(tuned.weights).toEqual({ heavyBurden: 4 });
  });

  it("counts the trailing scoreless run the way the rules end a game on", () => {
    const base = botGame();
    const log = (action: "place_equation" | "pass" | "exchange" | "end_game") =>
      ({ action }) as GameState["logs"][number];
    expect(trailingNoScoreStreak({ ...base, logs: [] })).toBe(0);
    expect(trailingNoScoreStreak({ ...base, logs: [log("pass"), log("pass")] })).toBe(2);
    // A scoring move resets it.
    expect(
      trailingNoScoreStreak({ ...base, logs: [log("pass"), log("place_equation"), log("pass")] }),
    ).toBe(1);
    // `end_game` is bookkeeping and is skipped, not counted and not a reset.
    expect(trailingNoScoreStreak({ ...base, logs: [log("pass"), log("end_game")] })).toBe(1);
  });
});
