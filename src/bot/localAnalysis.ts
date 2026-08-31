// ── Running the top analysis level on the player's device ────────────────────
//
// `max` used to go to the backend like every other level, and the backend runs
// one OS process per request with no `threads` field — a single core, 160
// samples, up to 330 seconds of it. On the same machine the browser can put
// eight threads on the identical schedule, because the Super bot already does.
// The level that costs the most was the only one not using the hardware.
//
// So `max` is computed here now, on the same threaded WASM engine, at the same
// full Super schedule. Everything else — quick, normal, deep — still goes to the
// service, and `max` falls back to it whenever the device cannot run the search.
//
// ── What is NOT different from the backend ──────────────────────────────────
//
// The description. `analysisReport.ts` next to the engine artifact is the
// service's own module, vendored by `make deploy-ui`, so the factors, the notes
// and the summary paragraph are produced by the same code that produces them for
// "ลึก". Two copies of that prose would drift, and the drift would look like the
// engine disagreeing with itself.
//
// ── What has no equivalent here ─────────────────────────────────────────────
//
// The server's permission gate ("analysis is for a turn a human is playing, and
// for the caller who controls it"). A search on the player's own CPU cannot be
// gated by anyone, and pretending otherwise by asking permission first would
// buy a round trip and prevent nothing.
//
// What DOES have to hold is the hidden-information rule, and it is structural
// rather than checked: `buildAnalysisRequest` puts exactly one rack on the wire
// and the opponent reaches the engine as an integer. The client holds both racks
// — it always has — so this is the one place a careless field would hand the
// player an oracle. `tests/analysis-request.test.ts` is what holds it.
import type { GameState, Side } from "../game";
import type { AnalysisLevel, AnalysisResult } from "./engineApi";
import type { BotProgress } from "./types";
import {
  AnalysisReportUnavailable,
  describeSearch,
  type AnalysisMethod,
  type ReportResponse,
} from "./engine/analysisReport";
import { buildAnalysisRequest } from "./superRequest";
import { planSuperThreads, readThreadEnvironment } from "./superThreads";
import { SuperEngineError, think } from "./superEngine";
import { clientSuperReadiness, type SuperPin } from "./clientSuper";

/**
 * The level that runs on the device.
 *
 * One, and named rather than inferred: `max` is the level whose cost justified
 * moving it, and the others answer fast enough on a shared core that spending a
 * player's own CPU (and their phone's battery) on them would be a worse trade.
 */
export const LOCAL_ANALYSIS_LEVEL: AnalysisLevel = "max";

/** The full Super schedule, which is exactly what the `max` level asks for. */
export const LOCAL_ANALYSIS_SAMPLES = 160;

/** How much of the ranking to read back. Matches `ANALYSIS_LEVEL_CONFIG.max.topN`
 *  in the service, so the two paths show the same depth of alternatives. */
const LOCAL_ANALYSIS_TOP_N = 24;

export class LocalAnalysisUnavailable extends Error {
  constructor(
    readonly reason: "unsupported" | "disabled" | "config_unavailable" | "pinned_version_missing",
    message: string,
  ) {
    super(message);
    this.name = "LocalAnalysisUnavailable";
  }
}

/** Whether this device can be asked for the top level at all. Same answer, and
 *  the same reasons, as for the Super bot — it is the same engine. */
export async function localAnalysisReadiness(pin: SuperPin): Promise<boolean> {
  const readiness = await clientSuperReadiness(pin);
  return readiness.available;
}

/**
 * Analyse the side on move, here, and describe it exactly as the service would.
 *
 * `method.complete` is always true: this search runs the full schedule with no
 * wall-clock ceiling, so unlike the backend's `max` it cannot be cut short. The
 * badge on the result reads that field rather than assuming either way.
 */
export async function runLocalAnalysis(options: {
  game: GameState;
  /** The side on move — the human's. Never the bot's; the caller checks. */
  side: Side;
  roomId: string;
  revision: number;
  turnNumber: number;
  pin: SuperPin;
  onProgress?: (progress: BotProgress) => void;
  signal?: AbortSignal;
}): Promise<AnalysisResult> {
  const readiness = await clientSuperReadiness(options.pin);
  if (!readiness.available || !readiness.config) {
    throw new LocalAnalysisUnavailable(
      readiness.reason ?? "config_unavailable",
      "The local engine is not available for this game.",
    );
  }

  const request = buildAnalysisRequest(options.game, {
    side: options.side,
    roomId: options.roomId,
    revision: options.revision,
    weights: readiness.config.weights,
    topN: LOCAL_ANALYSIS_TOP_N,
  });

  const outcome = await think({
    request,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const described = (() => {
    try {
      // `requestedSamples` is the schedule this search actually ran, so
      // `complete` is decided by the same comparison the service makes rather
      // than by a claim made here.
      return describeSearch(outcome.response as ReportResponse, LOCAL_ANALYSIS_SAMPLES);
    } catch (error) {
      if (error instanceof AnalysisReportUnavailable) {
        // The same shape of answer the service gives for the same position: not
        // a failure of the search, an absence of anything to compare.
        throw new SuperEngineError("engine_failed", error.message);
      }
      throw error;
    }
  })();

  const [recommendation, ...alternatives] = described.candidates;
  if (!recommendation) {
    throw new SuperEngineError("engine_failed", "The engine reported no chosen move.");
  }

  return {
    level: LOCAL_ANALYSIS_LEVEL,
    gameId: options.roomId,
    revision: options.revision,
    turnNumber: options.turnNumber,
    side: options.side,
    recommendation,
    alternatives,
    summary: described.summary,
    localEngine: {
      engineVersion: readiness.config.engineVersion,
      weightsVersion: readiness.config.weightsVersion,
      // The same plan the worker sizes its pool from, so the badge reports the
      // threads that actually ran rather than the ones this device could offer.
      threads: planSuperThreads(readThreadEnvironment()).threads,
    },
    method: described.method satisfies AnalysisMethod,
  };
}
