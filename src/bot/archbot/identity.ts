// ── Who ArchBot is ───────────────────────────────────────────────────────────
//
// Players meet ArchBot. Everything underneath keeps the names it already has in
// the catalog, the database and the engine records — `stage5b`, `stage5b64`,
// `stage5b_standard` — because those identify a model and a configuration, and
// renaming them would orphan every record that already uses them. The internal
// names must never be shown to a player; `ARCHBOT_NAME` is what is.
//
// Availability is NOT decided here. Whether ArchBot can be chosen for a new game,
// and how it is funded and where it runs, is read from the server's bot catalog
// (`list_bots`), which is the only authority on it.

export const ARCHBOT_NAME = "ArchBot";

export const ARCHBOT_BOT_KEY = "stage5b";
export const ARCHBOT_ENGINE = "stage5b";
export const ARCHBOT_DIFFICULTY = "stage5b64";
export const ARCHBOT_MODE_KEY = "stage5b_standard";

/**
 * The Stage 5A value model ArchBot evaluates with, exactly as the production
 * Stage 5B service ships it. The directory is named after the weights' hash so
 * a new model is a new URL, and every byte is checked against these digests
 * before it is used — a model that does not match is not loaded.
 */
export const ARCHBOT_MODEL = {
  version: "95ba8c0d",
  modelJsonSha256: "0bd5dd416a57dd7236998e3e14dc99b27e50aebcb51f2877ef91e763e59e99ca",
  weightsSha256: "95ba8c0d3e7040234dc02940ec09fe18f8478d78c8f2cfe65cc42452a65d6c52",
  weightsBytes: 4005988,
} as const;

/** Site-relative directory holding `model.json` and `weights.bin`. */
export function archBotModelPath(baseUrl: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}models/archbot/${ARCHBOT_MODEL.version}/`;
}

/**
 * The name to show for a bot seat. Every player-facing label goes through here
 * so an internal engine name cannot reach the screen by accident.
 */
export function botDisplayName(engine: string | undefined): string {
  if (engine === ARCHBOT_ENGINE) return ARCHBOT_NAME;
  if (engine === "aether") return "Aether";
  return "Authur";
}
