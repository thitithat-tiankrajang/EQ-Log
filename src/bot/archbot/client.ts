// ── One ArchBot turn ─────────────────────────────────────────────────────────
//
//   game → request (own rack only) → worker (Stage 5B) → answer for THIS
//   room and revision → the BotMoveResult every bot path produces
//
// From there the move goes through exactly what every other bot move goes
// through: `applyBotResult` maps it onto the real rack, re-checks it with the
// game's own validator, refuses it if the revision moved, and commits it through
// the ordinary conditional command path.
//
// There is no fallback. If this device cannot run ArchBot, the turn fails with a
// reason and the room says so: it is never handed to the engine service, to
// Authur, or to anything weaker, and nothing is charged — ArchBot is free and the
// server never sees the search.
import { archBotModelPath } from "./identity";
import { buildArchBotRequest } from "./request";
import {
  ArchBotEngine,
  ArchBotError,
  type ArchBotAnswer,
  type ArchBotPhase,
  type ArchBotWorkerLike,
} from "./engine";
import type { GameState } from "../../game";
import type { BotMoveResult } from "../engineApi";

export { ArchBotError, type ArchBotPhase } from "./engine";

let engine: ArchBotEngine | null = null;

/** Whether this browser can run ArchBot at all: a module worker and Web Crypto. */
export function isArchBotSupported(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle?.digest === "function"
  );
}

function sharedEngine(): ArchBotEngine {
  engine ??= new ArchBotEngine({
    createWorker: () =>
      new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
        name: "archbot",
      }) as unknown as ArchBotWorkerLike,
    modelPath: archBotModelPath(import.meta.env.BASE_URL),
  });
  return engine;
}

/** Tests only: replace the shared engine. */
export function setArchBotEngineForTests(replacement: ArchBotEngine | null): void {
  engine?.dispose();
  engine = replacement;
}

/** Start the worker and the model download while the player looks at the board. */
export function warmUpArchBot(): void {
  if (isArchBotSupported()) sharedEngine().warm();
}

/** Turn a Stage 5B answer into the result shape the app applies. */
export function toArchBotMoveResult(answer: ArchBotAnswer, side: "A" | "B"): BotMoveResult {
  const { decision } = answer;
  return {
    gameId: answer.key.roomId,
    revision: answer.key.revision,
    side,
    move: {
      type: decision.type,
      placements: decision.placements.map(({ r, c, kind, token }) => ({ r, c, kind, token })),
      exchange: [...decision.exchange],
      score: decision.score,
    },
    solver: "stage5b",
    endgameSolved: false,
    stats: {
      elapsedMs: Math.round(answer.wallMs),
      nodes: decision.stats.nodes,
      samples: 0,
    },
    // Deliberately no `localReasoning`: the "why this move" panel is built on
    // value terms Stage 5B does not produce, and ArchBot does not fill them in.
  };
}

/**
 * Compute ArchBot's move for `game` at `revision`, on this device.
 *
 * The position is read once, here. The answer is refused unless it is about the
 * same room and revision it was asked about — the engine guarantees it, and this
 * checks it, because applying a move to the wrong position is the most damaging
 * thing this path could do.
 */
export async function runArchBot(options: {
  game: GameState;
  roomId: string;
  revision: number;
  signal?: AbortSignal;
  onPhase?: (phase: ArchBotPhase) => void;
}): Promise<BotMoveResult> {
  if (!isArchBotSupported()) {
    throw new ArchBotError("unsupported", "This browser cannot run ArchBot.");
  }
  const side = options.game.botSide;
  if (!side) throw new ArchBotError("compute_failed", "This game has no bot seat.");
  let request;
  try {
    request = buildArchBotRequest(options.game, options.roomId, options.revision);
  } catch (error) {
    throw new ArchBotError(
      "compute_failed",
      `ArchBot could not read the position: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const answer = await sharedEngine().decide({
    key: { roomId: options.roomId, revision: options.revision },
    request,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onPhase ? { onPhase: options.onPhase } : {}),
  });
  if (answer.key.roomId !== options.roomId || answer.key.revision !== options.revision) {
    throw new ArchBotError("compute_failed", "ArchBot answered a different position.");
  }
  return toArchBotMoveResult(answer, side);
}
