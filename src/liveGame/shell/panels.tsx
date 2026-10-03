import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Pause, Repeat2, SkipForward, WifiOff } from "lucide-react";
import { AMATH_TOKENS, type AmathToken, type Side, type TileInstance } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import { ConfirmBottomSheet } from "./BottomSheet";
import type { LiveControl } from "../controls";
import { TOKEN_ORDER, unseenPool, type LastMove } from "./derive";
import { LiveTile } from "./LiveBoard";
import { Expression, Glyph } from "./TileGlyph";
import type { ShellModel } from "./model";
import { NOTES_MAX } from "./workspace";
import type { KeyNotice } from "./useTurnDraft";

/**
 * One fixed-size slot for the most important transient event. It replaces its
 * content and never pushes the board. Priority: incoming pause request, paused,
 * a pause answer, an error, a typing hint. An incoming request is announced
 * (role=alert) without taking focus, and the game keeps running underneath it.
 */
export function EventLine({
  model,
  busy,
  error,
  keyNotice,
  onControl,
  fallback,
  moveHint,
}: {
  model: ShellModel;
  busy: boolean;
  error: string | null;
  keyNotice: KeyNotice | null;
  /** Why the tentative tiles cannot be committed yet. */
  moveHint?: string | null;
  onControl(action: LiveControl): void;
  fallback?: React.ReactNode;
}) {
  const { t } = useLocale();
  const [blockOpen, setBlockOpen] = useState(false);
  const { incoming, answer } = model.pause;
  if (incoming && model.caps.match.respondPause)
    return (
      <div className="lg-event is-request" role="alert">
        <Pause size={16} aria-hidden="true" />
        <span className="lg-event-text">
          {t("live.pause.incoming", { name: model.players[incoming.by] })}
        </span>
        <span className="lg-event-actions">
          <button
            type="button"
            className="lg-btn lg-btn-small lg-btn-primary"
            disabled={busy}
            onClick={() =>
              onControl({ kind: "respond-pause", requestId: incoming.id, accept: true })
            }
          >
            {t("live.pause.accept")}
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-small"
            disabled={busy}
            onClick={() =>
              onControl({ kind: "respond-pause", requestId: incoming.id, accept: false })
            }
          >
            {t("live.pause.decline")}
          </button>
          <button
            type="button"
            className="lg-btn lg-btn-small lg-btn-quiet"
            aria-label={t("live.pause.more")}
            disabled={busy}
            onClick={() => setBlockOpen(true)}
          >
            ⋯
          </button>
        </span>
        <ConfirmBottomSheet
          open={blockOpen}
          title={t("live.pause.blockTitle")}
          consequence={t("live.pause.blockConsequence")}
          confirmLabel={t("live.pause.block")}
          cancelLabel={t("live.actions.cancel")}
          busy={busy}
          onCancel={() => setBlockOpen(false)}
          onConfirm={() => {
            setBlockOpen(false);
            onControl({
              kind: "respond-pause",
              requestId: incoming.id,
              accept: false,
              blockFiveMinutes: true,
            });
          }}
        />
      </div>
    );
  if (model.paused && !model.finished)
    return (
      <div className="lg-event is-paused" role="status">
        <Pause size={16} aria-hidden="true" />
        <span className="lg-event-text">{t(`live.pause.by.${model.paused}`)}</span>
        {model.caps.match.resumeDirect && (
          <span className="lg-event-actions">
            <button
              type="button"
              className="lg-btn lg-btn-small lg-btn-primary"
              disabled={busy}
              onClick={() => onControl({ kind: "resume-direct" })}
            >
              {t("live.pause.resume")}
            </button>
          </span>
        )}
      </div>
    );
  if (answer)
    return (
      <div className="lg-event" role="status">
        <Pause size={16} aria-hidden="true" />
        <span className="lg-event-text">
          {answer.accepted
            ? t("live.pause.accepted")
            : answer.blocked
              ? t("live.pause.declinedBlocked")
              : t("live.pause.declined")}
        </span>
        <span className="lg-event-actions">
          <button
            type="button"
            className="lg-btn lg-btn-small"
            disabled={busy}
            onClick={() => onControl({ kind: "acknowledge-pause", responseId: answer.id })}
          >
            {t("live.pause.ok")}
          </button>
        </span>
      </div>
    );
  if (model.pause.outgoing)
    return (
      <div className="lg-event" role="status">
        <Pause size={16} aria-hidden="true" />
        <span className="lg-event-text">{t("live.pause.waiting")}</span>
      </div>
    );
  if (error)
    return (
      <div className="lg-event is-error" role="alert">
        {/offline|network|fetch/i.test(error) ? (
          <WifiOff size={16} aria-hidden="true" />
        ) : (
          <AlertTriangle size={16} aria-hidden="true" />
        )}
        <span className="lg-event-text">{error}</span>
      </div>
    );
  if (keyNotice)
    return (
      <div className="lg-event is-hint" role="status">
        <span className="lg-event-text">
          {keyNotice.kind === "blank"
            ? t("live.keys.blank")
            : keyNotice.kind === "missing"
              ? t("live.keys.missing", { face: keyNotice.face })
              : keyNotice.kind === "viaBlank"
                ? t("live.keys.viaBlank", { face: keyNotice.face })
                : t("live.keys.viaChoice", { face: keyNotice.face })}
        </span>
      </div>
    );
  if (moveHint)
    return (
      <div className="lg-event is-hint is-move" role="status">
        <span className="lg-event-text">{moveHint}</span>
      </div>
    );
  return fallback ? <>{fallback}</> : null;
}

/** The previous committed action, readable at a glance. Never a tentative tile. */
export function LastMovePanel({
  move,
  players,
  yourSide,
  compact = false,
  onOpen,
}: {
  move: LastMove | null;
  players: Record<Side, string>;
  yourSide: Side | null;
  compact?: boolean;
  onOpen?(logId: string): void;
}) {
  const { t } = useLocale();
  if (!move)
    return (
      <div className={`lg-last${compact ? " is-compact" : ""} is-none`}>
        <span className="lg-last-what">{t("live.last.none")}</span>
      </div>
    );
  const who = move.side === yourSide ? t("live.last.you") : players[move.side];
  const what =
    move.kind === "place"
      ? (move.expression ?? t("live.last.placed"))
      : move.kind === "exchange"
        ? t("live.last.exchanged", { count: move.exchangedCount })
        : t("live.last.passed");
  const content = (
    <>
      <span className="lg-last-label">{compact ? t("live.last.short") : t("live.last.title")}</span>
      <span className="lg-last-who">
        <i className="lg-side-dot" aria-hidden="true" />
        {who}
      </span>
      <span className="lg-last-what">
        {move.kind === "exchange" ? (
          <Repeat2 size={14} aria-hidden="true" />
        ) : move.kind === "pass" ? (
          <SkipForward size={14} aria-hidden="true" />
        ) : null}
        {move.kind === "place" && move.faces.length ? <Expression faces={move.faces} /> : what}
      </span>
      {move.kind === "place" && <span className="lg-last-score">+{move.score}</span>}
    </>
  );
  const className = `lg-last side-${move.side.toLowerCase()} kind-${move.kind}${compact ? " is-compact" : ""}`;
  return onOpen ? (
    <button
      type="button"
      className={className}
      aria-label={t("live.last.aria", { who, what, turn: move.turnNumber, score: move.score })}
      onClick={() => onOpen(move.id)}
    >
      {content}
    </button>
  ) : (
    <div
      className={className}
      aria-label={t("live.last.aria", { who, what, turn: move.turnNumber, score: move.score })}
    >
      {content}
    </div>
  );
}

const GROUPS: { key: "light" | "heavy" | "ops"; tokens: AmathToken[] }[] = [
  {
    key: "light",
    tokens: TOKEN_ORDER.filter((token) => AMATH_TOKENS[token].type === "lightNumber"),
  },
  {
    key: "heavy",
    tokens: TOKEN_ORDER.filter((token) => AMATH_TOKENS[token].type === "heavyNumber"),
  },
  {
    key: "ops",
    tokens: TOKEN_ORDER.filter(
      (token) => !["lightNumber", "heavyNumber"].includes(AMATH_TOKENS[token].type),
    ),
  },
];

/**
 * Bag count from the server, and the unseen distribution derived locally from
 * the public board and the racks this viewer may see. Never an order.
 */
export function TileBagPanel({ model }: { model: ShellModel }) {
  const { t } = useLocale();
  const known: TileInstance[][] = model.hostRacks
    ? [model.hostRacks.A, model.hostRacks.B]
    : model.rackSide && model.role === "player"
      ? [model.rack]
      : [];
  const pool = unseenPool(model.board, known);
  const label = model.hostRacks ? t("live.bag.inBag") : t("live.bag.unseen");
  return (
    <section className="lg-bag" aria-label={t("live.bag.title")}>
      <div className="lg-bag-counts">
        <span>
          <strong>{model.bagCount}</strong> {t("live.bag.inBagShort")}
        </span>
        <span>
          <strong>{pool.total}</strong> {label}
        </span>
      </div>
      {GROUPS.map((group) => (
        <ul className="lg-bag-grid" key={group.key} aria-label={t(`live.bag.group.${group.key}`)}>
          {group.tokens.map((token) => {
            const count = pool.counts.get(token) ?? 0;
            return (
              <li key={token} className={count === 0 ? "is-out" : undefined}>
                <LiveTile tile={{ token }} size="mini" />
                <span className="lg-bag-count">
                  <span className="lg-visually-hidden">{AMATH_TOKENS[token].token}: </span>
                  {count}
                </span>
              </li>
            );
          })}
        </ul>
      ))}
    </section>
  );
}

/** Private scratch paper. Local to this browser; never sent to anyone. */
export function NotesPad({
  notes,
  onChange,
  memoryOnly,
  readOnlyHint,
}: {
  notes: string;
  onChange(value: string): void;
  memoryOnly: boolean;
  readOnlyHint?: string;
}) {
  const { t } = useLocale();
  const id = useId();
  return (
    <section className="lg-notes">
      <label htmlFor={id} className="lg-notes-label">
        {t("live.notes.title")}
      </label>
      <textarea
        id={id}
        value={notes}
        maxLength={NOTES_MAX}
        spellCheck={false}
        placeholder={t("live.notes.placeholder")}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <small id={`${id}-hint`} className="lg-notes-hint">
        {readOnlyHint ?? (memoryOnly ? t("live.notes.memoryOnly") : t("live.notes.private"))}
      </small>
    </section>
  );
}

type UnseenGroup = "digits" | "heavy" | "ops" | "equals" | "blank";
const GROUP_OF: Record<string, UnseenGroup> = {
  lightNumber: "digits",
  heavyNumber: "heavy",
  operator: "ops",
  choice: "ops",
  equals: "equals",
  Blank: "blank",
};

/** Unseen counts grouped the way players think about them. Public by derivation only. */
export function unseenSummary(model: ShellModel) {
  const known: TileInstance[][] = model.hostRacks
    ? [model.hostRacks.A, model.hostRacks.B]
    : model.rackSide && model.role === "player"
      ? [model.rack]
      : [];
  const pool = unseenPool(model.board, known);
  const groups: Record<UnseenGroup, number> = { digits: 0, heavy: 0, ops: 0, equals: 0, blank: 0 };
  for (const [token, count] of pool.counts) groups[GROUP_OF[AMATH_TOKENS[token].type]] += count;
  return { total: pool.total, groups };
}

/**
 * Always-visible Unseen: the total and the groups that decide plays, in one
 * compact row. Tapping it opens the full per-tile distribution. Derived from
 * the public board and the racks this viewer may see; never a bag order.
 */
export function UnseenStrip({ model, onOpen }: { model: ShellModel; onOpen?: () => void }) {
  const { t } = useLocale();
  const { total, groups } = unseenSummary(model);
  const chips: { key: UnseenGroup; label: ReactNode }[] = [
    { key: "digits", label: "0–9" },
    { key: "heavy", label: "10–20" },
    {
      key: "ops",
      label: (
        <span className="lg-chip-ops">
          <Glyph face="+" />
          <Glyph face="×" />
        </span>
      ),
    },
    { key: "equals", label: <Glyph face="=" /> },
    { key: "blank", label: <span className="lg-chip-blank" /> },
  ];
  const spoken = t("live.unseen.aria", {
    total,
    digits: groups.digits,
    heavy: groups.heavy,
    ops: groups.ops,
    equals: groups.equals,
    blank: groups.blank,
    bag: model.bagCount,
  });
  const content = (
    <>
      <span className="lg-unseen-total">
        <strong>{total}</strong>
        <span className="lg-unseen-labels">
          <small>{model.hostRacks ? t("live.bag.inBagShort") : t("live.bag.unseen")}</small>
          {!model.hostRacks && (
            <small className="lg-unseen-bag">
              {t("live.unseen.bag", { count: model.bagCount })}
            </small>
          )}
        </span>
      </span>
      <span className="lg-unseen-chips">
        {chips.map((chip) => (
          <span key={chip.key} className={`lg-chip${groups[chip.key] === 0 ? " is-out" : ""}`}>
            <span className="lg-chip-label">{chip.label}</span>
            <b>{groups[chip.key]}</b>
          </span>
        ))}
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" className="lg-unseen" aria-label={spoken} onClick={onOpen}>
      {content}
    </button>
  ) : (
    <div className="lg-unseen" role="group" aria-label={spoken}>
      {content}
    </div>
  );
}
