// ── The ArchBot worker protocol ──────────────────────────────────────────────
//
//   host → worker   init      load (or reuse) the model
//                   decide    one position, tagged with the host's request id
//   worker → host   ready     the model is loaded and verified
//                   model-error  the model could not be loaded; nothing was decided
//                   decided   the answer, echoing the request id it answers
//                   failed    the request could not be answered, and why
//
// Every answer names the request it belongs to. The host only ever has one
// request in the worker at a time and discards any answer whose id is not that
// one, so a result from a cancelled or superseded request cannot be mistaken for
// the current one. Cancelling a running request terminates the worker: a Stage 5B
// decision is one synchronous call and nothing else can interrupt it.
import type { ArchBotDecision, ArchBotRequest } from "./decide";
import type { ArchBotModelErrorCode } from "./model";

export type ArchBotToWorker =
  | { type: "init"; modelPath: string }
  | { type: "decide"; id: number; modelPath: string; request: ArchBotRequest };

export type ArchBotFailureCode =
  /** The model could not be downloaded, verified or read. */
  | "model_unavailable"
  /** The decision itself threw: an inconsistent position or an engine fault. */
  | "compute_failed";

export type ArchBotFromWorker =
  | { type: "ready"; modelMs: number }
  | { type: "model-error"; code: ArchBotModelErrorCode; message: string }
  | { type: "decided"; id: number; decision: ArchBotDecision; wallMs: number; modelMs: number }
  | {
      type: "failed";
      id: number;
      code: ArchBotFailureCode;
      modelCode?: ArchBotModelErrorCode;
      message: string;
    };
