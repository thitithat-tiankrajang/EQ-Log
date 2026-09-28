import type { AnalysisLevel } from "../../bot/engineApi";
import { useBotNames } from "../../bot/botIdentity";
import { useLocale } from "../../i18n/LocaleProvider";

// The same labels in the launcher, its progress bar and the result panel: one
// search, read out at different depths, so one name for each depth.
const ENGINE_LEVEL_LABEL: Record<Exclude<AnalysisLevel, "stage5b64">, string> = {
  quick: "เร็ว",
  normal: "ปกติ",
  deep: "ลึก",
  max: "สูงสุด (Super)",
};

/** The deepest ArchBot level searches up to this many turns ahead. */
export const ARCHBOT_ANALYSIS_DEPTH = 64;

/**
 * The player-facing name of an analysis level. The ArchBot level is named after
 * the bot through the server catalogue; its identifier (`stage5b64`) is what
 * requests and stored results keep.
 */
export function useAnalysisLevelLabel(): (level: AnalysisLevel) => string {
  const botName = useBotNames();
  const { t } = useLocale();
  return (level) =>
    level === "stage5b64"
      ? t("analysis.botLevel", { bot: botName(level), depth: ARCHBOT_ANALYSIS_DEPTH })
      : ENGINE_LEVEL_LABEL[level];
}
