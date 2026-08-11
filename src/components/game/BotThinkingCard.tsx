import type { BotThinkingState } from "../../bot/botController";
import type { BotProgress } from "../../bot/types";

const PHASE_LABELS: Record<BotProgress["phase"], string> = {
  movegen: "กำลังไล่ทุกตาที่เล่นได้",
  sim: "กำลังจำลองการตอบของคู่แข่ง",
  endgame: "กำลังไขเกมท้ายแบบแม่นตรง",
};

/**
 * Inline status card shown while the bot's turn is being computed.
 *
 * Three states, because the engine now lives on a shared server and they are
 * genuinely different things:
 *
 *   requesting  the request is going out
 *   queued      the server accepted it and is waiting for a free CPU
 *   running     an engine process is actually searching
 *
 * A queued bot is the state this card exists for. Without it a player watching
 * an unmoving board has no way to tell "the server is busy" from "the app is
 * broken", and the honest answer costs one line of copy.
 *
 * Nothing here invents a number. The bar is only drawn once the engine has
 * reported its own progress; before that the card animates without claiming a
 * percentage, and a queued job shows no bar at all because there is nothing to
 * be a fraction of.
 */
export function BotThinkingCard({
  state,
  botName,
}: {
  state: BotThinkingState;
  botName: string;
}) {
  if (state.kind === "queued") {
    return (
      <div
        className="bot-thinking-card engine-activity-dock is-queued"
        role="status"
        aria-live="polite"
        data-phase="queued"
      >
        <div className="bot-thinking-head">
          <span className="bot-thinking-name">
            <span className="bot-thinking-dot" aria-hidden="true" />
            {botName} กำลังรอคิว
          </span>
          <span className="bot-thinking-phase">
            {state.position !== null && state.position > 1
              ? `รออีก ${state.position - 1} งานก่อนหน้า`
              : "รอเครื่องว่าง"}
          </span>
        </div>
        <div className="bot-thinking-track">
          <div className="bot-thinking-fill is-indeterminate" />
        </div>
      </div>
    );
  }

  const progress = state.kind === "running" || state.kind === "reconnecting" ? state.progress : null;
  const reconnecting = state.kind === "reconnecting";
  const percent = progress ? Math.round(Math.max(0, Math.min(100, progress.percent))) : null;
  const timing = progress
    ? progress.etaMs > 500
      ? `~${Math.ceil(progress.etaMs / 1000)}s`
      : `${(progress.elapsedMs / 1000).toFixed(1)}s`
    : null;

  return (
    <div
      className={`bot-thinking-card engine-activity-dock${reconnecting ? " is-reconnecting" : ""}`}
      role="status"
      aria-live="polite"
      data-phase={state.kind}
    >
      <div className="bot-thinking-head">
        <span className="bot-thinking-name">
          <span className="bot-thinking-dot" aria-hidden="true" />
          {reconnecting ? `${botName} กำลังกลับไปคิดต่อ` : `${botName} กำลังคิด`}
        </span>
        <span className="bot-thinking-phase">
          {reconnecting
            ? "กำลังเชื่อมต่องานเดิม"
            : progress
              ? (PHASE_LABELS[progress.phase] ?? progress.phase)
              : "กำลังเริ่มคำนวณ"}
        </span>
        {progress ? (
          <span className="bot-thinking-eta">
            <strong>{percent}%</strong>
            {timing ? ` · ${timing}` : null}
          </span>
        ) : null}
      </div>
      <div className="bot-thinking-track">
        {progress ? (
          <div
            className="bot-thinking-fill"
            style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
          />
        ) : (
          // Indeterminate on purpose: the engine has not reported a percentage
          // yet, and drawing 0% would be a number nobody produced.
          <div className="bot-thinking-fill is-indeterminate" />
        )}
      </div>
    </div>
  );
}
