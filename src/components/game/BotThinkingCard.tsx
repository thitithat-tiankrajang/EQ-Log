import type { BotProgress } from "../../bot/types";

const PHASE_LABELS: Record<BotProgress["phase"], string> = {
  movegen: "Scanning every legal move",
  sim: "Simulating opponent replies",
  endgame: "Solving the endgame exactly",
};

/**
 * Inline status card shown while the engine thinks. Always tells the player
 * how long the wait will be: progress percent plus a live ETA.
 */
export function BotThinkingCard({ progress, botName }: { progress: BotProgress; botName: string }) {
  const percent = Math.max(0, Math.min(100, progress.percent));
  const etaSeconds = progress.etaMs > 500 ? Math.ceil(progress.etaMs / 1000) : null;
  return (
    <div className="bot-thinking-card" role="status" aria-live="polite">
      <div className="bot-thinking-head">
        <span className="bot-thinking-name">
          <span className="bot-thinking-dot" aria-hidden="true" />
          {botName} is thinking
        </span>
        <span className="bot-thinking-phase">{PHASE_LABELS[progress.phase] ?? progress.phase}</span>
        <span className="bot-thinking-eta">
          {etaSeconds !== null
            ? `~${etaSeconds}s left`
            : `${(progress.elapsedMs / 1000).toFixed(1)}s`}
        </span>
      </div>
      <div className="bot-thinking-track">
        <div className="bot-thinking-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
