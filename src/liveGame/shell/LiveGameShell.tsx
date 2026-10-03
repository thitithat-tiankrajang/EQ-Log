import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { LayoutGrid, Trophy } from "lucide-react";
import { RACK_SIZE } from "../../constants/gameRules";
import type { BoardSnapshot, Side } from "../../game";
import { rankTier } from "../../features/ranked/rating";
import { useLocale } from "../../i18n/LocaleProvider";
import { Sheet } from "../../components/ui/Sheet";
import type { AnalysisLevel } from "../../bot/engineApi";
import type { HostedAction } from "../hostedAdmin";
import type { LiveControl } from "../controls";
import type { PhysicalAction } from "../physical";
import type { LiveLayout } from "./layout";
import { LiveBoard, type OpponentTentative } from "./LiveBoard";
import { LiveRack } from "./LiveRack";
import { MatchControls, SoundToggle } from "./MatchControls";
import type { ShellModel } from "./model";
import { EventLine, LastMovePanel, NotesPad, TileBagPanel } from "./panels";
import { PlayerCard } from "./PlayerCard";
import {
  GameTools,
  PanelTabs,
  PhysicalConsole,
  RecordTools,
  type PanelTab,
  type ReviewState,
} from "./tools";
import { TurnActions } from "./TurnActions";
import type { TurnDraft } from "./useTurnDraft";

const NO_OPPONENT_TENTATIVE: OpponentTentative[] = [];

export type ShellHandlers = {
  onControl(action: LiveControl): void;
  onHosted(action: HostedAction): void;
  onPhysical(action: PhysicalAction): void;
  onSurrender(): void;
  onLeave(coffee: boolean): void;
  onOpenReplay?: () => void;
  onSelectLog(id: string | null): void;
  onReviewPhase(phase: "before" | "after"): void;
  onPractice(): void;
  onAnalysisLevel(level: AnalysisLevel): void;
  onAnalyze(): void;
  onRetryBot?: () => void;
  onCellClick(row: number, col: number): void;
  onCellFocus(row: number, col: number): void;
  onEditFace(tileId: string): void;
};

function ResultPanel({
  model,
  onLeave,
  onOpenReplay,
}: {
  model: ShellModel;
  onLeave(): void;
  onOpenReplay?: () => void;
}) {
  const { t } = useLocale();
  const winner = model.result?.winner ?? null;
  const reason = model.result?.reason;
  return (
    <section className="lg-result" aria-label={t("live.result.title")} role="status">
      <Trophy size={20} aria-hidden="true" />
      <div className="lg-result-head">
        <strong>
          {winner
            ? winner === model.yourSide && model.role === "player"
              ? t("live.result.youWon")
              : t("live.result.won", { name: model.players[winner] })
            : t("live.result.draw")}
        </strong>
        <small>
          {model.scores.A} – {model.scores.B}
          {reason ? ` · ${t(`live.result.reason.${reason}`)}` : ""}
        </small>
        {model.ratingChange && (
          <small>
            {rankTier(model.ratingChange.after)} · {model.ratingChange.before} →{" "}
            {model.ratingChange.after}
          </small>
        )}
      </div>
      <div className="lg-result-actions">
        {onOpenReplay && (
          <button type="button" className="lg-btn" onClick={onOpenReplay}>
            {t("live.result.replay")}
          </button>
        )}
        <button type="button" className="lg-btn lg-btn-primary" onClick={onLeave}>
          {model.ranked ? t("live.match.backRanked") : t("live.result.leave")}
        </button>
      </div>
    </section>
  );
}

export function LiveGameShell({
  model,
  layout,
  draft,
  canPlay,
  busy,
  error,
  review,
  shownBoard,
  workspace,
  analysis,
  botBusy,
  sound,
  transitionKey,
  announcement,
  handlers,
}: {
  model: ShellModel;
  layout: LiveLayout;
  draft: TurnDraft;
  canPlay: boolean;
  busy: boolean;
  error: string | null;
  review: ReviewState;
  shownBoard: BoardSnapshot;
  workspace: { notes: string; setNotes(value: string): void; mode: "local" | "memory" | "none" };
  analysis: { level: AnalysisLevel; running: boolean; result: string | null };
  botBusy: boolean;
  sound: { on: boolean; toggle(): void };
  transitionKey: number;
  announcement: string;
  handlers: ShellHandlers;
}) {
  const { t } = useLocale();
  const [moreOpen, setMoreOpen] = useState(false);
  const [tab, setTab] = useState("record");
  const stack = layout.mode === "stack" || layout.mode === "stack-landscape";
  const reviewing = Boolean(review.log);
  const top = model.perspective.top;
  const bottom = model.perspective.bottom;

  const lastMoveKeys = useMemo(
    () =>
      new Set(
        (reviewing ? [] : (model.lastMove?.cells ?? [])).map((cell) => `${cell.row}:${cell.col}`),
      ),
    [model.lastMove, reviewing],
  );
  const scoreBadge = useMemo(() => {
    const last = draft.placements.at(-1);
    return last && draft.validation?.isValid
      ? { row: last.row, col: last.col, value: draft.validation.score }
      : null;
  }, [draft.placements, draft.validation]);

  const board = (
    <div className={`lg-board-wrap${reviewing ? " is-review" : ""}`}>
      <LiveBoard
        board={shownBoard}
        placements={reviewing ? [] : draft.placements}
        opponentTentative={NO_OPPONENT_TENTATIVE}
        lastMove={lastMoveKeys}
        lastMoveSide={reviewing ? null : (model.lastMove?.side ?? null)}
        cursor={draft.cursor}
        placing={canPlay && draft.mode === "none"}
        selectedPendingId={draft.selectedPendingId}
        players={model.players}
        yourSide={model.yourSide}
        score={reviewing ? null : scoreBadge}
        labels={layout.label > 0}
        onCellClick={handlers.onCellClick}
        onCellFocus={handlers.onCellFocus}
        onEditFace={handlers.onEditFace}
      />
      {transitionKey > 0 && (
        <span key={transitionKey} className="lg-turn-sweep" aria-hidden="true" />
      )}
      {reviewing && review.log && (
        <div className="lg-review-banner" role="status">
          <span>{t("live.record.reviewing", { turn: review.log.turnNumber })}</span>
          <button
            type="button"
            className="lg-btn lg-btn-small lg-btn-primary"
            onClick={() => handlers.onSelectLog(null)}
          >
            {model.caps.turn.act ? t("live.record.yourTurnBack") : t("live.record.backToLive")}
          </button>
        </div>
      )}
    </div>
  );

  const replayRack = review.log
    ? review.log.side === model.yourSide && model.role === "player"
      ? ((review.phase === "before" ? review.log.rackBefore : review.log.rackAfter) ?? [])
      : null
    : undefined;
  const rack =
    model.rackSide === null ? null : replayRack === null ? (
      <LiveRack
        slots={[]}
        active={false}
        mode="none"
        selectedTileId={null}
        exchangeIds={[]}
        hiddenCount={RACK_SIZE}
        label={t("live.rack.replayClosed")}
        onTileClick={() => undefined}
        onSlotClick={() => undefined}
        onMove={() => undefined}
      />
    ) : replayRack ? (
      <LiveRack
        slots={Array.from({ length: RACK_SIZE }, (_, index) => ({
          tile: replayRack[index] ?? null,
          exposed: null,
        }))}
        active={false}
        mode="none"
        selectedTileId={null}
        exchangeIds={[]}
        label={t("live.rack.replay")}
        onTileClick={() => undefined}
        onSlotClick={() => undefined}
        onMove={() => undefined}
      />
    ) : (
      <LiveRack
        slots={draft.slots}
        active={canPlay}
        mode={draft.mode}
        selectedTileId={draft.selectedTileId}
        exchangeIds={draft.exchangeIds}
        label={
          model.role === "physical-host"
            ? t("live.rack.hostRack", { name: model.players[model.activeSide] })
            : t("live.rack.yours")
        }
        onTileClick={draft.onTileClick}
        onSlotClick={draft.onSlotClick}
        onMove={draft.swapSlots}
      />
    );

  const actions = model.blocked ? (
    <section className="lg-result is-blocked" role="alert">
      <p className="lg-blocked-text">{t("live.blocked.message")}</p>
      <div className="lg-result-actions">
        <button type="button" className="lg-btn" onClick={() => handlers.onLeave(false)}>
          {t("live.match.leave")}
        </button>
      </div>
    </section>
  ) : model.finished ? (
    <ResultPanel
      model={model}
      onLeave={() => handlers.onLeave(false)}
      onOpenReplay={handlers.onOpenReplay}
    />
  ) : (
    <TurnActions model={model} draft={draft} canPlay={canPlay} busy={busy} reviewing={reviewing} />
  );
  const lastMove = (
    <LastMovePanel
      move={model.lastMove}
      players={model.players}
      yourSide={model.yourSide}
      compact={stack}
      onOpen={(id) => {
        handlers.onSelectLog(id);
        if (stack) {
          setTab("record");
          setMoreOpen(true);
        }
      }}
    />
  );
  const event = (
    <EventLine
      model={model}
      busy={busy}
      error={error}
      keyNotice={draft.keyNotice}
      moveHint={
        stack && draft.placements.length && draft.validation && !draft.validation.isValid
          ? draft.validation.errors[0]
          : null
      }
      onControl={handlers.onControl}
      fallback={stack && !layout.compact ? lastMove : undefined}
    />
  );
  const notes = model.caps.workspace.notes ? (
    <NotesPad
      notes={workspace.notes}
      onChange={workspace.setNotes}
      memoryOnly={workspace.mode === "memory"}
      readOnlyHint={model.finished ? t("live.notes.finished") : undefined}
    />
  ) : null;

  const tabs: PanelTab[] = [
    {
      id: "record",
      label: t("live.tabs.record"),
      badge: reviewing ? `T${review.log!.turnNumber}` : undefined,
      content: (
        <RecordTools
          model={model}
          busy={busy}
          review={review}
          onSelectLog={handlers.onSelectLog}
          onReviewPhase={handlers.onReviewPhase}
          onPractice={() => {
            setMoreOpen(false);
            handlers.onPractice();
          }}
          onControl={handlers.onControl}
          onHosted={handlers.onHosted}
        />
      ),
    },
    {
      id: "bag",
      label: t("live.tabs.bag"),
      badge: String(model.bagCount),
      content: <TileBagPanel model={model} />,
    },
    {
      id: "tools",
      label: t("live.tabs.tools"),
      content: (
        <GameTools
          model={model}
          busy={busy}
          review={review}
          analysis={analysis}
          onAnalysisLevel={handlers.onAnalysisLevel}
          onAnalyze={handlers.onAnalyze}
          botBusy={botBusy}
          onRetryBot={handlers.onRetryBot}
        />
      ),
    },
    ...(model.caps.record.physicalIntake
      ? [
          {
            id: "physical",
            label: t("live.tabs.physical"),
            content: <PhysicalConsole model={model} busy={busy} onPhysical={handlers.onPhysical} />,
          },
        ]
      : []),
  ];
  const tabsWithNotes: PanelTab[] =
    notes && layout.mode !== "duo"
      ? [...tabs, { id: "notes", label: t("live.tabs.notes"), content: notes }]
      : tabs;

  const matchBar = (
    <div className="lg-matchbar">
      <div className="lg-title">
        <strong>{model.name}</strong>
        <small>{t("live.title.turn", { turn: model.turnNumber })}</small>
      </div>
      <SoundToggle on={sound.on} onToggle={sound.toggle} />
      <MatchControls
        model={model}
        busy={busy}
        onControl={handlers.onControl}
        onHosted={handlers.onHosted}
        onSurrender={handlers.onSurrender}
        onLeave={handlers.onLeave}
      />
    </div>
  );
  const card = (side: Side | null, position: "top" | "bottom", compact = false): ReactNode =>
    side ? <PlayerCard model={model} side={side} position={position} compact={compact} /> : null;

  const style = {
    "--lg-cell": `${layout.cell}px`,
    "--lg-label": `${layout.label}px`,
    "--lg-board": `${layout.board}px`,
    "--lg-rack-tile": `${layout.rackTile}px`,
    "--lg-gutter": `${layout.gutter}px`,
  } as CSSProperties;
  const shellProps = {
    className: "lg-shell",
    "data-layout": layout.mode,
    "data-rack": layout.rack,
    "data-compact": layout.compact || undefined,
    "data-turn": model.finished ? "finished" : model.paused ? "paused" : model.turnRole,
    "data-to-move": model.activeSide.toLowerCase(),
    "data-perspective": bottom.toLowerCase(),
    style,
  };
  const live = (
    <div className="lg-visually-hidden" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>
  );

  if (layout.mode === "duo")
    return (
      <main {...shellProps}>
        <aside className="lg-gutter lg-left" aria-label={t("live.regions.players")}>
          {matchBar}
          {card(top, "top")}
          <div className="lg-left-fill">{notes}</div>
          {card(bottom, "bottom")}
        </aside>
        <section className="lg-center" aria-label={t("live.regions.board")}>
          {board}
          {layout.rack === "below" && <div className="lg-rack-row">{rack}</div>}
        </section>
        <aside className="lg-gutter lg-right" aria-label={t("live.regions.info")}>
          {event}
          {lastMove}
          <div className="lg-right-fill">
            <PanelTabs
              tabs={tabsWithNotes}
              selected={tab}
              onSelect={setTab}
              label={t("live.regions.info")}
            />
          </div>
          {layout.rack === "gutter" && <div className="lg-rack-row is-gutter">{rack}</div>}
          {actions}
        </aside>
        {live}
      </main>
    );

  if (layout.mode === "column")
    return (
      <main {...shellProps}>
        <section className="lg-center" aria-label={t("live.regions.board")}>
          {board}
          {layout.rack === "below" && <div className="lg-rack-row">{rack}</div>}
        </section>
        <aside className="lg-gutter lg-right" aria-label={t("live.regions.info")}>
          {matchBar}
          <div className="lg-duel">
            {card(top, "top", true)}
            {card(bottom, "bottom", true)}
          </div>
          {event}
          {lastMove}
          <div className="lg-right-fill">
            <PanelTabs
              tabs={tabsWithNotes}
              selected={tab}
              onSelect={setTab}
              label={t("live.regions.info")}
            />
          </div>
          {layout.rack === "gutter" && <div className="lg-rack-row is-gutter">{rack}</div>}
          {actions}
        </aside>
        {live}
      </main>
    );

  const more = (
    <Sheet open={moreOpen} title={t("live.more.title")} onClose={() => setMoreOpen(false)}>
      <PanelTabs
        tabs={tabsWithNotes}
        selected={tab}
        onSelect={setTab}
        label={t("live.more.title")}
      />
    </Sheet>
  );
  const moreButton = (
    <button
      type="button"
      className="lg-icon-btn lg-more-btn"
      aria-haspopup="dialog"
      aria-label={t("live.more.open")}
      onClick={() => setMoreOpen(true)}
    >
      <LayoutGrid size={18} aria-hidden="true" />
      <span>{t("live.more.short")}</span>
    </button>
  );

  if (layout.mode === "stack-landscape")
    return (
      <main {...shellProps}>
        <aside className="lg-gutter lg-left">
          {matchBar}
          {card(top, "top", true)}
          {card(bottom, "bottom", true)}
          {event}
        </aside>
        <section className="lg-center">{board}</section>
        <aside className="lg-gutter lg-right">
          {rack}
          <div className="lg-actionbar">
            {moreButton}
            {actions}
          </div>
        </aside>
        {more}
        {live}
      </main>
    );

  return (
    <main {...shellProps}>
      <header className="lg-strip lg-strip-top">
        {card(top, "top", true) ?? <div className="lg-title">{model.name}</div>}
        <SoundToggle on={sound.on} onToggle={sound.toggle} />
        <MatchControls
          model={model}
          busy={busy}
          onControl={handlers.onControl}
          onHosted={handlers.onHosted}
          onSurrender={handlers.onSurrender}
          onLeave={handlers.onLeave}
        />
      </header>
      {board}
      {!layout.compact && (
        <div className="lg-strip lg-strip-self">
          {card(bottom, "bottom", true)}
          <div className="lg-strip-event">{event}</div>
        </div>
      )}
      {layout.compact && <div className="lg-strip-event is-compact">{event}</div>}
      {rack && <div className="lg-rack-row">{rack}</div>}
      <div className="lg-actionbar">
        {moreButton}
        {layout.compact && card(bottom, "bottom", true)}
        {actions}
      </div>
      {more}
      {live}
    </main>
  );
}
