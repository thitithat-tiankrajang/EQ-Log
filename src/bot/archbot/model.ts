// ── Loading ArchBot's model ──────────────────────────────────────────────────
//
// ~4 MB of float32 weights, fetched once per worker and kept for the worker's
// life. The files live at a content-versioned path (`identity.ts`), so HTTP can
// cache them indefinitely; a new model is a new path, never new bytes at an old
// one. Nothing is trusted on arrival: both files are hashed and compared with the
// pinned digests, and a mismatch is a refusal to load — ArchBot then reports
// itself unavailable rather than playing with weights nobody validated.
import { loadValueModel, ValueHead } from "./core/stage5b-core.mjs";
import { ARCHBOT_MODEL } from "./identity";

export type ArchBotModelErrorCode = "model_fetch_failed" | "model_integrity" | "model_invalid";

export class ArchBotModelError extends Error {
  constructor(
    readonly code: ArchBotModelErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArchBotModelError";
  }
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchBytes(fetchImpl: typeof fetch, url: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new ArchBotModelError(
      "model_fetch_failed",
      `Could not download ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new ArchBotModelError(
      "model_fetch_failed",
      `Could not download ${url} (${response.status}).`,
    );
  }
  return response.arrayBuffer();
}

/** Check pinned bytes and build the value head. Separate from fetching so tests
 *  and tools can hand in bytes they read themselves. */
export async function valueHeadFromBytes(
  metaBytes: ArrayBuffer,
  weights: ArrayBuffer,
): Promise<ValueHead> {
  if ((await sha256Hex(metaBytes)) !== ARCHBOT_MODEL.modelJsonSha256) {
    throw new ArchBotModelError(
      "model_integrity",
      "ArchBot's model description is not the pinned one.",
    );
  }
  if (
    weights.byteLength !== ARCHBOT_MODEL.weightsBytes ||
    (await sha256Hex(weights)) !== ARCHBOT_MODEL.weightsSha256
  ) {
    throw new ArchBotModelError("model_integrity", "ArchBot's weights are not the pinned ones.");
  }
  try {
    const meta: unknown = JSON.parse(new TextDecoder().decode(metaBytes));
    return new ValueHead(loadValueModel(meta, weights));
  } catch (error) {
    throw new ArchBotModelError(
      "model_invalid",
      `ArchBot's model could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Download, verify and load the model from `modelPath` (a directory URL). */
export async function loadArchBotModel(
  modelPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ValueHead> {
  const [metaBytes, weights] = await Promise.all([
    fetchBytes(fetchImpl, `${modelPath}model.json`),
    fetchBytes(fetchImpl, `${modelPath}weights.bin`),
  ]);
  return valueHeadFromBytes(metaBytes, weights);
}
