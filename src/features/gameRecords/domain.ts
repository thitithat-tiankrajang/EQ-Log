import type { EndGameDetail, GameState, Side } from "../../game";

export type CompletionKind = "natural" | "terminated";
export type CompletionReason =
  | "rack_out"
  | "no_score_streak"
  | "perfect_game"
  | "surrender"
  | "manual"
  | "admin"
  | "timeout"
  | "disconnect"
  | "legacy_finished"
  | "other";

export type GameCompletion = {
  kind: CompletionKind;
  reason: CompletionReason;
  surrenderedSide: Side | null;
};

export type ModeKey =
  | "local_versus"
  | "online_versus"
  | "hosted_versus"
  | "solo_practice"
  | "aether_easy"
  | "aether_medium"
  | "aether_hard"
  | "aether_max";

export type ProfileModeKey = Exclude<ModeKey, `aether_${string}`> | "aether";

export const MODE_CATALOG: ReadonlyArray<{
  key: ProfileModeKey;
  label: string;
  family: "versus" | "solo";
}> = [
  { key: "local_versus", label: "Pass & Play", family: "versus" },
  { key: "online_versus", label: "Online Versus", family: "versus" },
  { key: "hosted_versus", label: "Hosted Versus", family: "versus" },
  { key: "solo_practice", label: "Solo Practice", family: "solo" },
  { key: "aether", label: "Aether", family: "versus" },
];

const NATURAL_REASONS = new Set<CompletionReason>(["rack_out", "no_score_streak", "perfect_game"]);

export function deriveModeKey(
  game: Pick<
    GameState,
    "botSide" | "botDifficulty" | "emailPlayMode" | "gameMode" | "playerUserIds"
  >,
): ModeKey {
  if (game.botSide) return `aether_${game.botDifficulty ?? "medium"}`;
  if (game.gameMode === "solo") return "solo_practice";
  if (game.emailPlayMode === "direct") return "online_versus";
  if (game.emailPlayMode === "hosted" && (game.playerUserIds?.A || game.playerUserIds?.B)) {
    return "hosted_versus";
  }
  return "local_versus";
}

export function isModeInProfileGroup(modeKey: ModeKey, profileKey: ProfileModeKey): boolean {
  return profileKey === "aether" ? modeKey.startsWith("aether_") : modeKey === profileKey;
}

export function deriveCompletion(game: Pick<GameState, "logs" | "matchControl">): GameCompletion {
  const endLog = [...game.logs].reverse().find((log) => log.action === "end_game");
  const detail = endLog?.actionDetail as Partial<EndGameDetail> | undefined;
  const surrenderedSide = detail?.surrenderedSide ?? game.matchControl?.surrenderedSide ?? null;
  const rawReason = surrenderedSide ? "surrender" : detail?.reason;
  const reason = isCompletionReason(rawReason) ? rawReason : "manual";
  return {
    kind: NATURAL_REASONS.has(reason) ? "natural" : "terminated",
    reason,
    surrenderedSide,
  };
}

export function isTrainableCompletion(completion: Pick<GameCompletion, "kind">): boolean {
  return completion.kind === "natural";
}

function isCompletionReason(value: unknown): value is CompletionReason {
  return (
    typeof value === "string" &&
    [
      "rack_out",
      "no_score_streak",
      "perfect_game",
      "surrender",
      "manual",
      "admin",
      "timeout",
      "disconnect",
      "legacy_finished",
      "other",
    ].includes(value)
  );
}
