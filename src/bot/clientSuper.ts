// ── Running Super on the player's device ─────────────────────────────────────
//
// The whole client-side turn, in one place:
//
//     config  →  calibration  →  build request  →  search in worker
//                                                       ↓
//     apply  ←  same shape the backend returns  ←  server legality check
//
// The output is a `BotMoveResult` — the SAME type the backend's `/bot-move`
// endpoint returns. That is the design decision this file exists to enforce:
// everything downstream (`toBotResponse`, `mapBotResponse`, `applyBotResult`,
// the validator, the commit) is untouched and cannot tell where the move came
// from. A path that produced its own shape would need its own application code,
// and the application step is where a wrong move actually corrupts a game.
//
// ── Why the backend is still asked about the move ───────────────────────────
//
// Not for anti-cheat. The Champion group is trusted, the weights are public,
// and a determined client could commit whatever it liked — as it could before
// any of this. The check earns its keep against the three ways a
// client-computed move actually goes wrong:
//
//   • the engine returns something the rules reject (a bug),
//   • this tab's rack has drifted from the server's (a desync), and
//   • the position moved while the search ran (an ordinary race).
//
// All three are silent failures that the client's own validator either shares
// the bug with or cannot see. One round trip of a few milliseconds, once per
// bot turn, against a search measured in tens of seconds.
import type { GameState } from "../game";
import { EngineApiError, validateBotMove, type BotMoveResult } from "./engineApi";
import { deviceCalibration, type DeviceCalibration } from "./calibration";
import { configForGame, type SuperConfig } from "./superConfig";
import { buildSuperRequest } from "./superRequest";
import { SuperEngineError, isSuperEngineSupported, think } from "./superEngine";
import type { BotProgress } from "./types";

/** How many ranked alternatives to read back — matches `BOT_REPORT_TOP_N` in
 *  the service, so the "why this move" panel shows the same depth on both
 *  paths. */
const CLIENT_SUPER_TOP_N = 24;

export type ClientSuperDecision = {
  /** Ready to hand to `toBotResponse` exactly like a server answer. */
  result: BotMoveResult;
  /** What actually ran, for the record and for the benchmark. */
  telemetry: {
    engineVersion: string;
    weightsVersion: string;
    /** Overrides the engine confirmed applying. A pinned weights version that
     *  comes back 0 means the engine ran its compiled defaults — the retune did
     *  not happen, and no A/B conclusion drawn from this game is valid. */
    weightsApplied: number;
    /** `null` is the full Super schedule, which is the only value the default
     *  configuration produces. */
    sampleCap: number | null;
    /** True when the EXPERIMENTAL adaptive budget capped this search, so these
     *  numbers describe a deliberately weaker bot than Super. Recorded because a
     *  latency reading that does not say which schedule produced it is not a
     *  reading of anything. */
    adaptiveBudgetApplied: boolean;
    tier: DeviceCalibration["tier"];
    /** What the player waited for the search, measured in the worker. */
    wallMs: number;
    /** The engine's own clock. The gap to `wallMs` is the WASM boundary. */
    engineMs: number;
    nodes: number;
    samples: number;
    validationMs: number;
  };
};

export class ClientSuperUnavailable extends Error {
  constructor(
    // Every reason here is a CAPABILITY or a CONFIGURATION failure — the
    // browser cannot run a worker, the rollout is off, the config could not be
    // fetched, the pinned version is gone. There is deliberately no
    // `device_too_slow`: slowness is not a reason to refuse Super, it is a
    // reason to warn about the wait. See `calibration.ts`.
    readonly reason:
      | "unsupported"
      | "disabled"
      | "config_unavailable"
      | "pinned_version_missing",
    message: string,
  ) {
    super(message);
    this.name = "ClientSuperUnavailable";
  }
}

export class ClientSuperIllegalMove extends Error {
  constructor(readonly detail: string) {
    super(`The local engine produced a move the server rejects: ${detail}`);
    this.name = "ClientSuperIllegalMove";
  }
}

/**
 * The legality check could not be REACHED — as distinct from answering "no".
 *
 * A separate kind because the two want opposite handling. An illegal move means
 * the search was wrong; an unreachable checker means nothing about the move at
 * all. This one sends the turn to the backend engine, which computes its own
 * move and needs no permission from anybody, rather than dropping a guarantee
 * quietly or re-running a search that already produced a perfectly good answer.
 */
export class ClientSuperValidationUnreachable extends Error {
  constructor(readonly cause: unknown) {
    super("The move could not be checked against the server.");
    this.name = "ClientSuperValidationUnreachable";
  }
}

/** How many times to re-ask for a verdict before giving up on the local path.
 *  Small: the move is already computed and the checker is milliseconds of work,
 *  so a failure that survives two quick retries is not transient. */
const VALIDATION_ATTEMPTS = 3;
const VALIDATION_RETRY_MS = 400;

/**
 * Ask the server whether the move is legal, retrying a transport failure.
 *
 * Retried at all because the alternative was expensive and silly: a
 * `queue_full` on a check that runs no search would have thrown the whole
 * search away and made the device do it again.
 *
 * NOT retried for a desync (`stale_revision`, `turn_rule`). Those are answers,
 * not failures — the position moved, and asking again with the same numbers
 * cannot help. They are rethrown so the caller's existing desync handling waits
 * for state to catch up, exactly as it does on the backend path.
 */
async function checkLegality(options: {
  gameId: string;
  expectedRevision: number;
  move: { type: "place" | "exchange" | "pass"; placements: BotMoveResult["move"]["placements"]; exchange: string[] };
  signal?: AbortSignal;
}) {
  let last: unknown;
  for (let attempt = 0; attempt < VALIDATION_ATTEMPTS; attempt += 1) {
    try {
      return await validateBotMove(options);
    } catch (failure) {
      if (
        failure instanceof EngineApiError &&
        (failure.code === "stale_revision" || failure.code === "turn_rule")
      ) {
        throw failure;
      }
      last = failure;
      if (options.signal?.aborted) throw failure;
      if (attempt < VALIDATION_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, VALIDATION_RETRY_MS));
      }
    }
  }
  throw new ClientSuperValidationUnreachable(last);
}

/** The pin a game carries, if it has started a client-side Super turn. */
export type SuperPin = { engineVersion?: string; weightsVersion?: string };

export type ClientSuperReadiness = {
  available: boolean;
  reason?: ClientSuperUnavailable["reason"];
  config?: SuperConfig;
  calibration?: DeviceCalibration;
};

/**
 * Can this device play this game's Super turns locally?
 *
 * Answered before a turn rather than during one, so a room can decide which
 * path it is on while the player is still looking at the board — and so a
 * device that cannot is told once, not on every move.
 *
 * Every "no" here is a fallback to the backend engine, never a refusal to play.
 * And every "no" here is about CAPABILITY, never about speed: a slow device
 * gets `available: true` with a long estimate attached, because the answer to
 * a slow device is a longer wait and a warning, not a different bot.
 */
export async function clientSuperReadiness(pin: SuperPin): Promise<ClientSuperReadiness> {
  if (!isSuperEngineSupported()) {
    return { available: false, reason: "unsupported" };
  }
  let config: SuperConfig;
  try {
    config = await configForGame(pin);
  } catch (error) {
    // A pinned version this deployment no longer carries comes back as a
    // `bad_request`. That is not a config outage — it is a game this client can
    // no longer reproduce, and it must fall back rather than silently play
    // under different weights.
    const reason =
      error instanceof EngineApiError && error.code === "bad_request"
        ? "pinned_version_missing"
        : "config_unavailable";
    return { available: false, reason };
  }
  if (!config.clientSuperEnabled) {
    return { available: false, reason: "disabled", config };
  }

  let calibration: DeviceCalibration;
  try {
    calibration = await deviceCalibration(config);
  } catch {
    // A device that cannot even be measured cannot be trusted to run a search
    // for a minute. The backend path is right there.
    return { available: false, reason: "unsupported", config };
  }
  // No gate on the measurement. A device that will take ten minutes is a device
  // that will take ten minutes, and it plays the same Super as everybody else —
  // the calibration is carried out so the UI can say so, not so anything here
  // can act on it.
  return { available: true, config, calibration };
}

/**
 * Compute one Super move on this device.
 *
 * `revision` is carried through every stage and back out on the result. A move
 * is an answer to ONE position, and the search takes long enough that the
 * position can genuinely move underneath it — so the revision travels with the
 * answer and `applyBotResult` refuses anything that does not match. The
 * server's validation checks it a second time against authoritative state.
 */
export async function runClientSuper(options: {
  game: GameState;
  roomId: string;
  revision: number;
  pin: SuperPin;
  onProgress?: (progress: BotProgress) => void;
  signal?: AbortSignal;
}): Promise<ClientSuperDecision> {
  const readiness = await clientSuperReadiness(options.pin);
  if (!readiness.available || !readiness.config || !readiness.calibration) {
    throw new ClientSuperUnavailable(
      readiness.reason ?? "config_unavailable",
      "The local engine is not available for this game.",
    );
  }
  const { config, calibration } = readiness;
  const botSide = options.game.botSide ?? "B";

  const request = buildSuperRequest(options.game, {
    roomId: options.roomId,
    revision: options.revision,
    sampleCap: calibration.sampleCap,
    weights: config.weights,
    topN: CLIENT_SUPER_TOP_N,
  });

  const outcome = await think({
    request,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const response = outcome.response;

  const move = {
    type: response.type,
    placements: response.placements,
    exchange: response.exchange,
    score: response.score,
  };

  // The server's word on the move, against the position it is actually
  // holding. A stale revision or a moved turn surfaces here as an
  // `EngineApiError` and is handled by the caller's existing desync logic — the
  // same logic the backend path already uses, because it is the same error.
  const validationStarted = performance.now();
  const verdict = await checkLegality({
    gameId: options.roomId,
    expectedRevision: options.revision,
    move: { type: move.type, placements: move.placements, exchange: move.exchange },
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const validationMs = Math.round(performance.now() - validationStarted);
  if (!verdict.valid) {
    // Never applied, and never converted into a pass. A pass is a scoring,
    // irreversible action, and an engine that produced an illegal move is no
    // evidence that passing is the right one.
    throw new ClientSuperIllegalMove(verdict.reason ?? "no reason given");
  }

  const result: BotMoveResult = {
    revision: options.revision,
    gameId: options.roomId,
    side: botSide,
    move,
    solver: response.solver,
    endgameSolved: response.endgameSolved,
    stats: {
      elapsedMs: Math.round(response.stats.elapsedMs),
      nodes: response.stats.nodes,
      samples: response.stats.samples,
    },
    localEngine: {
      engineVersion: config.engineVersion,
      weightsVersion: config.weightsVersion,
    },
    // The ranking this search already produced, kept rather than dropped.
    //
    // It used to be discarded here, which is why the "why this move" panel was
    // empty for EVERY Super turn: it asks the backend, and the backend never ran
    // this search. The engine was asked for `CLIENT_SUPER_TOP_N` alternatives
    // for exactly this purpose, so throwing them away paid the cost of the wider
    // report and kept none of the benefit.
    ...(response.candidates && response.candidates.length > 0
      ? {
          localReasoning: {
            gameId: options.roomId,
            revision: options.revision,
            side: botSide,
            difficulty: "super",
            solver: response.solver,
            endgameSolved: response.endgameSolved,
            ...(response.expectedFinalDiff != null
              ? { expectedFinalDiff: response.expectedFinalDiff }
              : {}),
            score: response.score,
            equity: response.equity,
            stats: {
              moves: response.stats.moves,
              nodes: response.stats.nodes,
              elapsedMs: Math.round(response.stats.elapsedMs),
              candidates: response.stats.candidates,
              samples: response.stats.samples,
              ...(response.stats.genCalls != null
                ? { genCalls: response.stats.genCalls }
                : {}),
            },
            candidates: response.candidates,
          },
        }
      : {}),
  };

  return {
    result,
    telemetry: {
      engineVersion: config.engineVersion,
      weightsVersion: config.weightsVersion,
      weightsApplied: response.stats.weightsApplied ?? 0,
      sampleCap: calibration.sampleCap,
      adaptiveBudgetApplied: calibration.adaptiveBudgetApplied,
      tier: calibration.tier,
      wallMs: outcome.wallMs,
      engineMs: Math.round(response.stats.elapsedMs),
      nodes: response.stats.nodes,
      samples: response.stats.samples,
      validationMs,
    },
  };
}

/** Whether a client-side failure should send this turn to the backend engine
 *  instead of retrying locally.
 *
 *  Everything that is not a cancellation does. The fallback path is the whole
 *  reason the backend engine was left in place, and a Champion whose device
 *  cannot finish a search should get a slower move, not no move. */
export function shouldFallBackToBackend(error: unknown): boolean {
  if (error instanceof ClientSuperUnavailable) return true;
  if (error instanceof ClientSuperIllegalMove) return true;
  // The move may well be fine; nobody could confirm it. The backend engine
  // computes its own move and needs no confirmation, so the turn goes there
  // rather than being applied unchecked.
  if (error instanceof ClientSuperValidationUnreachable) return true;
  if (error instanceof SuperEngineError) return error.code !== "cancelled";
  // A desync or a stale revision is not a reason to change engines: the
  // position itself was wrong, and the caller re-derives it and asks again.
  if (error instanceof EngineApiError) return false;
  return true;
}
