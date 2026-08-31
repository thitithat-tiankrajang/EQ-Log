import type { ReactNode } from "react";

// ── One bar, two homes, two activities ───────────────────────────────────────
//
// The bot thinking and the turn analysis are the same shape of thing — a named
// piece of engine work with a percentage, an estimate, and sometimes a way out
// — so they render through one component and differ only in colour and copy.
//
// **Where it lives is the point.** This used to be `position: fixed`, floated
// over the top of the board, which cost the player the part of the board it
// covered on desktop and rendered nothing at all on mobile: the card is drawn
// inside the control panel, and the mobile layout hides that whole rail, so a
// fixed child of a `display: none` ancestor is still `display: none`. Players
// concluded the engine was not working.
//
// So it is not floated anywhere any more. It is drawn in the ACTION slot, in
// place of the Exchange and Pass buttons, on both layouts:
//
//   • On the bot's turn those buttons are unusable by design — the human no
//     longer plays the bot's move — so the slot is free and already the place
//     the player is looking.
//   • During an analysis the same slot carries the search, and the cancel
//     button in it is the way back to playing.
//
// Nothing here invents a number: `percent === null` renders an indeterminate
// sliver rather than a 0% nobody computed.

export type EngineActivityTone = "running" | "queued" | "reconnecting";

/** Which visual family to use. They are deliberately different colours: a
 *  player should be able to tell the bot's turn from their own analysis before
 *  reading a word of it. */
export type EngineActivityKind = "bot" | "analysis";

const TONE_CLASS: Record<EngineActivityTone, string> = {
  running: "",
  queued: " is-queued",
  reconnecting: " is-reconnecting",
};

export function EngineActivityBar({
  kind,
  variant,
  tone,
  label,
  phase,
  meter,
  percent,
  cancelLabel,
  note,
  onCancel,
}: {
  kind: EngineActivityKind;
  /** `panel` is the desktop/tablet control panel; `mobile` is the one-row
   *  bottom dock, where there is room for a status, a number and one button. */
  variant: "panel" | "mobile";
  tone: EngineActivityTone;
  /** Who is working, e.g. "Aether กำลังคิด". */
  label: string;
  /** What it is doing right now. Dropped on mobile, where the row cannot hold
   *  a third line and the percentage is what answers "is this stuck?". */
  phase?: string;
  /** The number: "47% · ~35s", or a queue position. */
  meter?: ReactNode;
  /** `null` means the engine has not reported one yet. */
  percent: number | null;
  cancelLabel?: string;
  /** Panel only: an extra sentence under the bar (the slow-device warning). */
  note?: ReactNode;
  onCancel?: () => void;
}) {
  const width = percent === null ? undefined : `${Math.max(0, Math.min(100, percent))}%`;

  if (variant === "mobile") {
    return (
      <div
        className={`mobile-action-bar is-engine-activity is-${kind}${TONE_CLASS[tone]}`}
        role="status"
        aria-live="polite"
        data-phase={tone}
      >
        <div className="mab-status info wide">
          <strong>{label}</strong>
          <span>{meter ?? phase ?? "เริ่มต้น…"}</span>
        </div>
        {onCancel && cancelLabel && (
          <button className="mab-btn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
        {/* A hairline across the foot of the row rather than a third zone: the
            row has no width to spare and a progress bar does not need any. */}
        <div className="mab-progress" aria-hidden="true">
          <div
            className={`mab-progress-fill${percent === null ? " is-indeterminate" : ""}`}
            {...(width ? { style: { width } } : {})}
          />
        </div>
      </div>
    );
  }

  const root = kind === "bot" ? "bot-thinking-card" : "analysis-running";
  const head = kind === "bot" ? "bot-thinking-head" : "analysis-running-head";
  const name = kind === "bot" ? "bot-thinking-name" : "analysis-running-label";
  const eta = kind === "bot" ? "bot-thinking-eta" : "analysis-running-eta";

  return (
    <div
      className={`${root} engine-activity${TONE_CLASS[tone]}`}
      role="status"
      aria-live="polite"
      data-phase={tone}
    >
      <div className={head}>
        <span className={name}>
          <span className="bot-thinking-dot" aria-hidden="true" />
          {label}
        </span>
        {phase && <span className="bot-thinking-phase">{phase}</span>}
        {meter && <span className={eta}>{meter}</span>}
        {onCancel && cancelLabel && (
          <button type="button" className="analysis-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
        )}
      </div>
      <div className="bot-thinking-track">
        <div
          className={`bot-thinking-fill${percent === null ? " is-indeterminate" : ""}`}
          {...(width ? { style: { width } } : {})}
        />
      </div>
      {note}
    </div>
  );
}
