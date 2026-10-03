import { Crown, Pause } from "lucide-react";
import { formatSeconds, type Side } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import type { ShellModel } from "./model";

/**
 * One side's identity, score and clock. The side to move is raised, filled with
 * its side colour and has a pulsing running-clock mark; the other side rests.
 * Resting is not disabled: nothing is greyed. The meaning survives greyscale
 * (elevation, size, the running mark) and has a text equivalent for screen
 * readers, so it never depends on colour or on reading a label.
 */
export function PlayerCard({
  model,
  side,
  position,
  compact = false,
}: {
  model: ShellModel;
  side: Side;
  position: "top" | "bottom";
  compact?: boolean;
}) {
  const { t } = useLocale();
  const clock = model.clocks[side];
  const toMove = !model.finished && model.activeSide === side && !model.blocked;
  const running = toMove && clock.running && !model.paused;
  const you = model.yourSide === side && model.role === "player";
  const winner = model.finished && model.result?.winner === side;
  const isBot = model.bot?.side === side;
  const low = clock.running && !clock.untimed && clock.seconds <= 60;
  const status = model.finished
    ? winner
      ? t("live.card.winner")
      : ""
    : model.paused
      ? t("live.card.paused")
      : toMove
        ? isBot && model.botThinking
          ? t(model.bot!.where === "device" ? "live.card.botDevice" : "live.card.botServer")
          : you
            ? t("live.card.yourMove")
            : t("live.card.toMove")
        : model.pause.incoming?.by === side
          ? t("live.card.pauseAsked")
          : "";
  return (
    <section
      className={`lg-card side-${side.toLowerCase()} pos-${position}${toMove ? " is-to-move" : ""}${
        running ? " is-running" : ""
      }${winner ? " is-winner" : ""}${compact ? " is-compact" : ""}`}
      aria-label={t("live.card.label", { name: model.players[side] })}
      data-to-move={toMove || undefined}
    >
      <span className="lg-card-identity" aria-hidden="true" />
      <div className="lg-card-name">
        <strong>{model.players[side]}</strong>
        <small>
          {you ? t("live.card.you") : isBot ? t("live.card.bot") : ""}
          {position === "top" && !model.solo && model.role !== "physical-host"
            ? `${you || isBot ? " · " : ""}${t("live.card.rack", { count: model.rackCount[side] })}`
            : ""}
        </small>
      </div>
      <div className="lg-card-score">
        {winner && <Crown size={16} aria-hidden="true" />}
        <span aria-hidden="true">{model.scores[side]}</span>
        <span className="lg-visually-hidden">
          {t("live.card.score", { count: model.scores[side] })}
        </span>
      </div>
      <div className={`lg-card-clock${low ? " is-low" : ""}${clock.seconds < 0 ? " is-over" : ""}`}>
        <span className="lg-visually-hidden">
          {clock.untimed
            ? t("live.card.untimed")
            : t("live.card.clock", { time: formatSeconds(clock.seconds) })}
          {running ? `, ${t("live.card.running")}` : ""}
        </span>
        {model.paused && !model.finished ? (
          <Pause size={13} aria-hidden="true" />
        ) : (
          <span className="lg-run-dot" aria-hidden="true" />
        )}
        <span aria-hidden="true">{clock.untimed ? "—" : formatSeconds(clock.seconds)}</span>
      </div>
      <span className="lg-card-status">{status}</span>
    </section>
  );
}
