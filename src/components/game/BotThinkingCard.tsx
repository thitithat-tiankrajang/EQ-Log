import type { EngineProgress } from "../../bot/engineApi";
import type { EngineSessionStatus } from "../../engineSessions";
import { EngineActivityBar } from "./EngineActivityBar";

/**
 * An estimated wait, in the coarsest unit that still says something.
 *
 * Rounded hard on purpose. The estimate behind it is a linear extrapolation
 * from a generation-throughput benchmark, so "ประมาณ 4 นาที" is already more
 * precision than the model can support and "4 นาที 12 วินาที" would be a
 * fabricated one.
 */
function formatWait(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${Math.max(1, seconds)} วินาที`;
  return `${Math.round(seconds / 60)} นาที`;
}

const PHASE_LABELS: Record<EngineProgress["phase"], string> = {
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
  slowDevice,
  variant = "panel",
}: {
  /** A projection of the server-owned session. This component renders it; it
   *  never owns it, and unmounting it stops nothing. */
  state: EngineSessionStatus;
  botName: string;
  /**
   * Set when this device is computing the move itself and its estimated
   * full-Super wait misses the latency targets.
   *
   * This line is the honest half of a deliberate product trade. The bot could
   * be made to answer inside the target on any hardware by giving a slower
   * device a smaller search — and it is not, because that would quietly hand
   * some players a weaker opponent than others. The wait is the price of every
   * Champion facing the same bot, so the wait is explained rather than hidden.
   */
  slowDevice?: { estimatedP50Ms: number } | null;
  /** Where it is being drawn. The mobile row has no space for the phase line
   *  or the slow-device sentence; it keeps the percentage, which is the part
   *  that answers "is it stuck?". */
  variant?: "panel" | "mobile";
}) {
  if (state.kind === "queued") {
    return (
      <EngineActivityBar
        kind="bot"
        variant={variant}
        tone="queued"
        label={`${botName} กำลังรอคิว`}
        meter={
          state.position !== null && state.position > 1
            ? `รออีก ${state.position - 1} งานก่อนหน้า`
            : "รอเครื่องว่าง"
        }
        percent={null}
      />
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
    <EngineActivityBar
      kind="bot"
      variant={variant}
      tone={reconnecting ? "reconnecting" : "running"}
      label={reconnecting ? `${botName} กำลังกลับไปคิดต่อ` : `${botName} กำลังคิด`}
      phase={
        reconnecting
          ? "กำลังเชื่อมต่องานเดิม"
          : progress
            ? (PHASE_LABELS[progress.phase] ?? progress.phase)
            : "กำลังเริ่มคำนวณ"
      }
      {...(progress
        ? {
            meter: (
              <>
                <strong>{percent}%</strong>
                {timing ? ` · ${timing}` : null}
              </>
            ),
          }
        : {})}
      percent={progress ? progress.percent : null}
      {...(slowDevice && variant === "panel"
        ? {
            note: (
              // Not `aria-live`: the card around it already announces itself, and
              // a second live region would read the same status twice.
              //
              // The order of the two clauses is deliberate. The strength
              // guarantee comes FIRST, because a player who reads only the first
              // half should come away knowing the bot is not weaker here — the
              // wait is the thing being explained, not an apology for a degraded
              // opponent.
              <p className="bot-thinking-note">
                Super คิดเต็มกำลังเท่ากันทุกเครื่อง — บนเครื่องนี้อาจใช้เวลาถึง{" "}
                {formatWait(slowDevice.estimatedP50Ms)}ต่อตา
                หากไม่อยากรอ สามารถเลือกบอทระดับอื่นที่คิดเร็วกว่าได้
              </p>
            ),
          }
        : {})}
    />
  );
}
