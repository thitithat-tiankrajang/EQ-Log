import type { GameState } from "../../game";
import { EngineApiError, validateBotMove, type BotMoveResult, type EngineProgress } from "../engineApi";
import { buildAuthurRequest } from "./request";

export async function runAuthur(options: {
  game: GameState;
  roomId: string;
  revision: number;
  signal: AbortSignal;
  onProgress: (progress: EngineProgress) => void;
}): Promise<BotMoveResult> {
  if (options.signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const request = buildAuthurRequest(options.game, options.roomId, options.revision);
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  let settled = false;
  const answer = await new Promise<BotMoveResult>((resolve, reject) => {
    const finish = (result: BotMoveResult | Error) => {
      if (settled) return;
      settled = true;
      options.signal.removeEventListener("abort", abort);
      worker.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("Cancelled", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<
      | { type: "progress"; progress: EngineProgress }
      | { type: "result"; result: BotMoveResult }
      | { type: "error"; message: string }
    >) => {
      const message = event.data;
      if (message.type === "progress") options.onProgress(message.progress);
      else if (message.type === "result") finish(message.result);
      else finish(new EngineApiError("engine_failed", message.message));
    };
    worker.onerror = (event) => finish(new EngineApiError("engine_failed", event.message));
    try {
      worker.postMessage({ type: "think", request });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  // Authur never falls through to Aether.
  //
  // THE SHARED VALIDATOR IS A SECOND OPINION, NOT A DEPENDENCY. Authur thinks on this device,
  // so asking the engine service to check its answer against the committed room catches a
  // client whose view of the position has drifted — worth having whenever the service is
  // there. It is not worth REQUIRING: requiring it makes the client-side bot stop playing the
  // moment a server it otherwise does not need is down, which is exactly what it did.
  //
  // Nothing reaches the board unchecked either way. `applyBotResult` runs EQ-Lab's own
  // official `validateMove` on every bot answer before committing it, and an answer that fails
  // is rejected and retried rather than played. Without the service the move is checked once
  // instead of twice; it is never checked zero times.
  //
  // So only an answer we actually RECEIVED may reject the move. Failing to obtain one — the
  // service refused the connection, is not configured, or errored — is not evidence about the
  // move, and is not treated as any.
  let verdict: Awaited<ReturnType<typeof validateBotMove>> | null = null;
  try {
    verdict = await validateBotMove({
      gameId: options.roomId,
      expectedRevision: options.revision,
      move: {
        type: answer.move.type,
        placements: answer.move.placements,
        exchange: answer.move.exchange,
      },
      signal: options.signal,
    });
  } catch (error) {
    // A cancellation is the caller changing their mind, not a validator outage.
    if (options.signal.aborted) throw error;
    unreachableValidator(error);
  }
  if (verdict && !verdict.valid) {
    throw new EngineApiError("engine_failed", `Authur move rejected: ${verdict.reason ?? "invalid"}`);
  }
  return answer;
}

/** Said once per session, so a missing engine service is visible without filling the console. */
let warnedAboutValidator = false;
function unreachableValidator(error: unknown): void {
  if (warnedAboutValidator) return;
  warnedAboutValidator = true;
  const why = error instanceof EngineApiError ? error.code : (error as Error)?.message;
  console.warn(
    `Authur: the engine service could not check this move (${why}). ` +
      "Playing on — EQ-Lab's own validator still checks every bot move before it is committed.",
  );
}
