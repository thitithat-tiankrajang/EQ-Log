import { Crown, Pause } from "lucide-react";
import { formatSeconds, type Side } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import type { ShellModel } from "./model";

/**
 * The game HUD: both players in one table, read at a glance.
 *
 *   ▌ Nok  you    +15   25   ● 20:22     ← side to move: tinted row, heavy clock, pulsing mark
 *   ▌ Pim         −15   10     22:00
 *
 * Two different facts, two different treatments:
 *  - TURN is the side colour (row tint, thick bar, running mark, bold clock);
 *  - LEAD is neutral (a dark "+15" chip on the leader, a muted "−15" on the other).
 * They never share a colour, so "Pim to move" and "Nok leads" can both be true
 * without the eye confusing them. A and B keep their seats (A above B) so the
 * table never reorders between perspectives.
 */
export function Scoreboard({
  model,
  compact = false,
  tight = false,
}: {
  model: ShellModel;
  /** One row, players side by side (phone landscape). */
  compact?: boolean;
  /** Two rows in small type (very short phones). */
  tight?: boolean;
}) {
  const { t } = useLocale();
  const sides: Side[] = model.solo ? ["A"] : ["A", "B"];
  const lead = model.scores.A - model.scores.B;
  return (
    <section
      className={`lg-scoreboard${compact ? " is-compact" : ""}${tight ? " is-tight" : ""}${
        model.solo ? " is-solo" : ""
      }`}
      aria-label={t("live.score.label")}
    >
      {sides.map((side) => {
        const clock = model.clocks[side];
        const toMove = !model.finished && !model.blocked && model.activeSide === side;
        const running = toMove && clock.running && !model.paused;
        const you = model.yourSide === side && model.role === "player";
        const bot = model.bot?.side === side;
        const diff = model.solo ? 0 : side === "A" ? lead : -lead;
        const winner = model.finished && model.result?.winner === side;
        const low = running && !clock.untimed && clock.seconds <= 60;
        const time = clock.untimed ? "—" : formatSeconds(clock.seconds);
        const spoken = [
          model.players[side],
          you ? t("live.card.you") : bot ? t("live.card.bot") : "",
          t("live.card.score", { count: model.scores[side] }),
          model.solo
            ? ""
            : diff > 0
              ? t("live.score.leads", { count: diff })
              : diff < 0
                ? t("live.score.trails", { count: -diff })
                : t("live.score.level"),
          clock.untimed ? t("live.card.untimed") : t("live.card.clock", { time }),
          toMove ? (you ? t("live.card.yourMove") : t("live.card.toMove")) : "",
          winner ? t("live.card.winner") : "",
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={side}
            className={`lg-sb-row side-${side.toLowerCase()}${toMove ? " is-to-move" : ""}${
              running ? " is-running" : ""
            }${winner ? " is-winner" : ""}`}
            role="group"
            aria-label={spoken}
            data-to-move={toMove || undefined}
          >
            <span className="lg-sb-bar" aria-hidden="true" />
            <span className="lg-sb-name" aria-hidden="true">
              <strong>{model.players[side]}</strong>
              {(you || bot) && <em>{you ? t("live.card.you") : t("live.card.bot")}</em>}
              {winner && <Crown size={13} />}
            </span>
            {!model.solo && (
              <span
                className={`lg-sb-diff${diff > 0 ? " is-lead" : diff < 0 ? " is-trail" : " is-level"}`}
                aria-hidden="true"
              >
                {diff > 0 ? `+${diff}` : diff < 0 ? `−${-diff}` : "±0"}
              </span>
            )}
            <span className="lg-sb-score" aria-hidden="true">
              {model.scores[side]}
            </span>
            <span
              className={`lg-sb-clock${low ? " is-low" : ""}${clock.seconds < 0 ? " is-over" : ""}`}
              aria-hidden="true"
            >
              {model.paused && !model.finished ? (
                <Pause size={11} />
              ) : (
                <span className="lg-run-dot" />
              )}
              {time}
            </span>
          </div>
        );
      })}
    </section>
  );
}
