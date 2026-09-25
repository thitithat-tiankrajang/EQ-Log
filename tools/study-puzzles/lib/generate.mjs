// One set, generated: self-play → analyse → filter → keep, until the target or
// Stop (DESIGN.md §7). No attempt limit; memory is bounded by the games in
// flight, because a game keeps only its own state and turn records and every
// engine result is reduced to what a puzzle needs.
//
// Games run `parallelGames` at a time but are COMMITTED IN GAME ORDER, so a set
// is decided by its configuration and seed, never by which game finished first.
import { join } from "node:path";
import { analyzePlacement, difficultyFeatures, nearBestOf, rackDifficulty } from "./analysis.mjs";
import { commitPuzzle, readJson, writeManifest } from "./archive.mjs";
import { configFrom } from "./config.mjs";
import { seedFor } from "./engine.mjs";
import { bestPlayRejections, positionRejections } from "./filters.mjs";
import { replayStudyLog } from "./provenance.mjs";
import { buildPuzzle, positionHash, summaryOf } from "./record.mjs";
import { playGame } from "./selfplay.mjs";
import { constructBranch } from "./branch.mjs";
import { candidateRacks, rackCanSatisfy, RACK_SEARCH_VERSION } from "./racks.mjs";
import { geometryFeasibility, legalRackFeasibility } from "./feasibility.mjs";
import { positionOf } from "./provenance.mjs";
import { studyRequestFor, EngineStopped } from "./engine.mjs";
import { canonicalJson, sha256 } from "../../survival-generator/lib/canonical.mjs";
import { within } from "./filters.mjs";
import { verifyProvenance } from "./verify.mjs";
import { legalPlacementCount } from "./mobility.mjs";

// This many games failing in a row means the engine is broken, not the games.
const MAX_CONSECUTIVE_ABANDONED = 5;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The seed of game `index` in a set seeded `setSeed`. */
export const gameSeed = (setSeed, index) => seedFor(`study:${setSeed}:game`, index);

/**
 * Generates the set whose manifest is `dir/set.json` (status "running").
 * `emit` receives { type: "progress" | "accepted" | "log" | "finished", … }.
 * `signal` aborting is the admin's Stop. Resolves with the final manifest.
 */
export async function generateSet({ dir, engine, emit = () => {}, signal }) {
  const manifest = await readJson(join(dir, "set.json"));
  // A pre-guided manifest retains the old behavior if it is ever resumed.
  const config = configFrom({
    ...manifest.config,
    search: manifest.config.search ?? { strategy: "AUTHENTIC_ONLY" },
  });
  const guided = config.search.strategy === "GUIDED";
  const counters = manifest.counters;
  counters.matchingPositions ??= 0;
  const startedAt = Date.now();
  const committedHashes = new Set();
  const results = new Map();
  let nextGame = 0;
  let nextCommit = 0;
  let consecutiveAbandoned = 0;
  let stopping = null;
  let commitChain = Promise.resolve();
  const evaluated = new Set();
  const cacheVersion = sha256(
    canonicalJson({ engine: manifest.engine, config, version: RACK_SEARCH_VERSION }),
  );

  const log = (message) => emit({ type: "log", message });
  const reject = (reasons) => {
    if (!guided) counters.rejectedPositions += 1;
    for (const reason of reasons)
      counters.rejections[reason] = (counters.rejections[reason] ?? 0) + 1;
  };
  const stop = (why) => {
    if (stopping !== null) return;
    stopping = why;
    engine.killAll();
  };
  if (signal?.aborted) stop("stopped");
  signal?.addEventListener("abort", () => stop("stopped"), { once: true });

  async function analyze(request, purpose) {
    if (stopping !== null) throw new EngineStopped();
    const started = performance.now();
    emit({ type: "search", phase: "stage5b", purpose });
    try {
      if (stopping !== null) throw new EngineStopped();
      counters.stage5bEvaluations++;
      counters[purpose === "source" ? "sourceStage5bEvaluations" : "guidedStage5bEvaluations"]++;
      const result = await engine.analyze(request);
      if (purpose === "source") counters.positionsAnalyzed++;
      return result;
    } catch (error) {
      if (!error.stopped) counters.engineErrors++;
      throw error;
    } finally {
      counters.stage5bMs += performance.now() - started;
    }
  }

  async function consider(gameIndex, sourceSeed, context) {
    if (!guided) counters.positionsInspected += 1;
    const { position, request, result, studyPosition } = context;
    const best = result.candidates?.[0] ?? { type: "pass" };
    const early = positionRejections(config, { position, request, best });
    if (early.length > 0) {
      reject(early);
      return null;
    }
    counters.positionsEligible += 1;

    const placements = best.placements.map((p) => ({
      r: p.r,
      c: p.c,
      kind: p.kind,
      face: p.token,
    }));
    const analysis = analyzePlacement(position.board, placements);
    if (!analysis.valid) {
      reject(["rules.eqlabRefused"]);
      log(
        `game ${gameIndex} turn ${position.turnNumber}: EQ-Lab refused Stage 5B's move (${analysis.errors.join("; ")})`,
      );
      return null;
    }
    counters.candidatesEvaluated += 1;
    const nearBest = nearBestOf(result.candidates);
    const reasons = [];
    if (analysis.score !== best.score) reasons.push("rules.scoreMismatch");
    reasons.push(
      ...bestPlayRejections(config, {
        analysis,
        nearBest,
        rackIndex: rackDifficulty(position.rack).index,
        rack: position.rack,
      }),
    );
    let mobility = context.mobility ?? null;
    const wantedMobility = config.mobility.legalPlacements;
    if (!reasons.length && (wantedMobility.min !== null || wantedMobility.max !== null)) {
      mobility ??= await legalPlacementCount(context.state, { max: wantedMobility.max, signal });
      if (mobility.overMax) reasons.push("mobility.tooManyLegalPlacements");
      else {
        if (!mobility.exact) mobility = await legalPlacementCount(context.state, { signal });
        if (!mobility.exact) reasons.push("mobility.countUnavailable");
        else if (!within(mobility.count, wantedMobility))
          reasons.push(mobility.count < (wantedMobility.min ?? 0) ? "mobility.tooFewLegalPlacements" : "mobility.tooManyLegalPlacements");
      }
    }
    if (committedHashes.has(positionHash(position))) reasons.push("duplicate");
    if (reasons.length > 0) {
      reject(reasons);
      return null;
    }

    // Only a match pays for the C++ check and the two replays.
    const cli = await engine.validate(request, { type: "place", placements: best.placements });
    if (!cli.valid || cli.score !== best.score) {
      reject(["rules.validatorDisagreed"]);
      log(
        `game ${gameIndex} turn ${position.turnNumber}: amath_cli says ${JSON.stringify(cli)} for a ${best.score}-point move`,
      );
      return null;
    }
    let sourceLog;
    try {
      sourceLog = context.sourceLog();
      replayStudyLog(sourceLog, "seed");
      replayStudyLog(sourceLog, "log");
    } catch (error) {
      reject(["provenance.replayFailed"]);
      log(
        `game ${gameIndex} turn ${position.turnNumber}: the source log does not replay (${error.message})`,
      );
      return null;
    }
    counters.matchingPositions += 1;
    counters.stage5bMatches++;
    const puzzle = buildPuzzle({
      setId: manifest.id,
      gameIndex,
      sourceSeed,
      log: sourceLog,
      position,
      studyPosition,
      request,
      result,
      best,
      analysis,
      nearBest,
      checks: { stage5b: best.score, eqlab: analysis.score, amathCli: cli.score },
      features: {
        ...difficultyFeatures({
        position,
        candidates: result.candidates,
        legalMoves: result.stats?.moves ?? null,
        analysis,
        nearBest,
        }),
        ...(mobility?.exact ? { legalPlacementCount: mobility.count, legalPlacementCountExact: true } : {}),
      },
      provenance: context.provenance,
    });
    if (!verifyProvenance(puzzle).ok) {
      counters.matchingPositions--;
      counters.stage5bMatches--;
      reject(["provenance.replayFailed"]);
      return null;
    }
    return puzzle;
  }

  async function searchPosition(gameIndex, sourceSeed, context) {
    emit({ type: "search", phase: "position", game: gameIndex, turn: context.position.turnNumber });
    if (stopping !== null) return null;
    counters.positionsInspected++;
    const { position } = context;
    const early = [];
    if (!position.board.length) early.push("position.opening");
    else if (!within(position.board.length, config.position.boardTiles))
      early.push("position.boardTiles");
    if (
      position.oppRackCount !== context.request.oppRackCount ||
      position.bagCount !== context.request.bagCount
    )
      early.push("position.inconsistent");
    const geometry = early.length ? early : geometryFeasibility(position, config).reasons;
    if (geometry.length) {
      counters.positionsGeometryPruned++;
      counters.rejectedPositions++;
      reject(geometry);
      return null;
    }
    const remember = (candidate) => {
      const key = `${cacheVersion}:${positionHash(candidate)}`;
      if (evaluated.has(key)) {
        counters.duplicateRacksSkipped++;
        return false;
      }
      evaluated.add(key);
      return true;
    };
    if (rackCanSatisfy(position.rack, config)) {
      if (remember(position)) {
        const mobility = config.mobility.legalPlacements.max === null ? null : await legalPlacementCount(context.state, { max: config.mobility.legalPlacements.max, signal });
        if (mobility?.overMax) { reject(["mobility.tooManyLegalPlacements"]); }
        else {
        const result = await context.analyzeSource();
        const found = await consider(gameIndex, sourceSeed, {
          ...context,
          result,
          best: result.candidates?.[0] ?? { type: "pass" },
          mobility,
        });
        if (found) return found;
        }
      }
    } else {
      counters.authenticRacksCompositionPruned++;
      reject(["rack.authenticComposition"]);
    }

    for (const candidate of candidateRacks(context.state, config, {
      onDuplicate: () => counters.duplicateRacksSkipped++,
    })) {
      if (stopping !== null) break;
      counters.guidedRacksGenerated++;
      emit({
        type: "search",
        phase: "rack",
        game: gameIndex,
        turn: position.turnNumber,
        candidateIndex: candidate.candidateIndex,
      });
      // Yield also makes Stop observable during a run of entirely cheap prunes.
      await new Promise((resolve) => setImmediate(resolve));
      if (stopping !== null) break;
      const branch = constructBranch(context.state, candidate.rack, candidate);
      const branchPosition = positionOf(branch.state);
      if (!remember(branchPosition)) continue;
      const mobility = config.mobility.legalPlacements.max === null ? null : await legalPlacementCount(branch.state, { max: config.mobility.legalPlacements.max, signal });
      if (stopping !== null) break;
      if (mobility?.overMax) { counters.guidedRacksCheapPruned++; reject(["mobility.tooManyLegalPlacements"]); continue; }
      const feasible = await legalRackFeasibility(branch.state, config, { signal });
      counters.cheapCheckMs += feasible.elapsedMs;
      if (stopping !== null) break;
      if (feasible.possible === false) {
        counters.guidedRacksCheapPruned++;
        reject([feasible.reason]);
        continue;
      }
      const input = studyRequestFor({
        board: branchPosition.board,
        rack: branchPosition.rack,
        scoreSelf: branchPosition.scores.self,
        scoreOpponent: branchPosition.scores.opponent,
      });
      let result;
      try {
        result = await analyze(input.request, "guided");
      } catch (error) {
        if (error.stopped) break;
        throw error;
      }
      const found = await consider(gameIndex, sourceSeed, {
        ...context,
        ...input,
        position: branchPosition,
        result,
        best: result.candidates?.[0] ?? { type: "pass" },
        provenance: branch.provenance,
        state: branch.state,
        mobility,
      });
      if (found) return found;
    }
    counters.rejectedPositions++;
    return null;
  }

  async function runGame(gameIndex) {
    const sourceSeed = gameSeed(config.seed, gameIndex);
    counters.gamesStarted += 1;
    const matches = [];
    try {
      const outcome = await playGame({
        seed: sourceSeed,
        engine: { ...engine, analyze: (request) => analyze(request, "source") },
        shouldStop: () => stopping !== null || (guided && matches.length >= config.maxPerGame),
        onSourcePosition: guided
          ? async (context) => {
              const puzzle = await searchPosition(gameIndex, sourceSeed, context);
              if (puzzle) matches.push(puzzle);
            }
          : undefined,
        onPosition: guided
          ? undefined
          : async (context) => {
              const puzzle = await consider(gameIndex, sourceSeed, context);
              if (puzzle) matches.push(puzzle);
            },
      });
      if (outcome.reason !== "stopped") counters.gamesFinished += 1;
      consecutiveAbandoned = 0;
    } catch (error) {
      if (!error.stopped) {
        counters.gamesAbandoned += 1;
        consecutiveAbandoned += 1;
        log(`game ${gameIndex} abandoned: ${error.message}`);
        if (consecutiveAbandoned >= MAX_CONSECUTIVE_ABANDONED) {
          throw new Error(`${consecutiveAbandoned} games in a row failed; last: ${error.message}`);
        }
      }
    }
    // Up to maxPerGame of this game's matches, picked by the set's seed, in turn order.
    const picked = shuffled(matches, mulberry32(seedFor(`study:${config.seed}:pick`, gameIndex)))
      .slice(0, config.maxPerGame)
      .sort((a, b) => a.canonical.position.turnNumber - b.canonical.position.turnNumber);
    for (let i = picked.length; i < matches.length; i += 1) reject(["perGameLimit"]);
    return picked;
  }

  /** Commit finished games in game order; after a stop, every finished game in order. */
  function drain(final = false) {
    commitChain = commitChain.then(async () => {
      for (;;) {
        let index = null;
        if (results.has(nextCommit)) index = nextCommit;
        else if (final && results.size > 0) index = Math.min(...results.keys());
        if (index === null) break;
        const picks = results.get(index);
        results.delete(index);
        nextCommit = index + 1;
        for (const puzzle of picks) {
          if (manifest.puzzles.length >= config.target) break;
          if (committedHashes.has(puzzle.hashes.position)) {
            reject(["duplicate"]);
            continue;
          }
          puzzle.index = manifest.puzzles.length;
          committedHashes.add(puzzle.hashes.position);
          await commitPuzzle(dir, manifest, puzzle, summaryOf(puzzle));
          counters.matched = manifest.puzzles.length;
          counters[
            puzzle.canonical.provenance?.origin === "CONFIG_GUIDED_RACK"
              ? "acceptedGuided"
              : "acceptedAuthentic"
          ]++;
          emit({
            type: "accepted",
            puzzle: summaryOf(puzzle),
            matched: counters.matched,
            target: config.target,
          });
        }
        if (manifest.puzzles.length >= config.target) stop("complete");
      }
    });
    return commitChain;
  }

  async function worker() {
    while (stopping === null) {
      const index = nextGame;
      nextGame += 1;
      results.set(index, await runGame(index));
      await drain();
    }
  }

  const tick = () => emit({ type: "progress", counters, elapsedMs: Date.now() - startedAt });
  const progress = setInterval(tick, 1000);
  const persist = setInterval(() => {
    commitChain = commitChain.then(() => writeManifest(dir, manifest));
  }, 5000);
  let fatal = null;
  try {
    const workers = Array.from({ length: config.parallelGames }, () =>
      worker().catch((error) => {
        fatal ??= error;
        stop("failed");
      }),
    );
    // Every worker must unwind before final draining or partial matches could
    // arrive after the terminal manifest has already been written.
    await Promise.all(workers);
  } catch (error) {
    fatal = error;
    stop("failed");
  } finally {
    clearInterval(progress);
    clearInterval(persist);
  }
  try {
    await drain(true);
  } catch (error) {
    fatal ??= error;
  }

  manifest.status = fatal
    ? "failed"
    : manifest.puzzles.length >= config.target
      ? "complete"
      : "stopped";
  manifest.finishedAt = new Date().toISOString();
  manifest.error = fatal ? fatal.message : null;
  manifest.durationMs = Date.now() - startedAt;
  counters.matched = manifest.puzzles.length;
  await writeManifest(dir, manifest);
  tick();
  emit({
    type: "finished",
    status: manifest.status,
    matched: manifest.puzzles.length,
    target: config.target,
    error: manifest.error,
  });
  return manifest;
}
