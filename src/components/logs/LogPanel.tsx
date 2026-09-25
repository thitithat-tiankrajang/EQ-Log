import { memo } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  GitBranch,
  Network,
} from "lucide-react";
import { type GameState, type TileInstance, type TurnLog } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import type { TimelineStatus } from "../../timelineStore";
import { PanelHeading } from "../layout/PanelHeading";
import { TurnDetail } from "../replay/TurnDetail";
import type { BranchOption, ForkIndex } from "./branchView";
import { TurnRecordList } from "./TurnRecordList";

export type TurnStep = "first" | "prev" | "next" | "last" | "live";

/** "Continue from here" for the viewer. `available: false` hides it (spectators, finished games). */
export type BranchControl = {
  readonly available: boolean;
  /** Why it cannot be pressed right now, when it cannot. */
  readonly blockedReason: string | null;
  readonly busy: boolean;
};

/** Present while viewing a line other than the one being played. */
export type LineView = {
  /** The last turn it shares with the line being played; `null` when it splits at the start. */
  readonly forkTurn: number | null;
};

// Always-on turn log (left rail), and the quick half of branching.
//
// It lists ONE line — the one on the board — so however much the game has branched, it never
// grows sideways. Rows where another move was tried carry a small fork badge that opens the
// alternatives in place; the whole tree is the map's job (`TurnLogMap`), one button away.
// Clicking a row, or stepping with the navigator, shows that turn on the board; "continue from
// here" plays on from exactly what the board is showing.
type LogPanelProps = {
  game: GameState;
  /** The line being viewed: the one being played, unless `lineView` says otherwise. */
  logs: readonly TurnLog[];
  selectedLogId: string | null;
  replayPhase: "before" | "after";
  forks: ForkIndex;
  lineView: LineView | null;
  lineCount: number;
  timelineStatus: TimelineStatus;
  branch: BranchControl;
  onSelectLog: (logId: string | null) => void;
  onStarsChange: (logId: string, stars: number) => void;
  onNoteChange: (logId: string, note: string) => void;
  onStep: (step: TurnStep) => void;
  onSetPhase: (phase: "before" | "after") => void;
  onOpenMap?: () => void;
  onViewOption: (option: BranchOption) => void;
  onContinue: () => void;
  currentTurnRack?: TileInstance[];
  readOnly?: boolean;
};

function sameLogPanel(a: LogPanelProps, b: LogPanelProps): boolean {
  return (
    a.game.logs === b.game.logs &&
    a.logs === b.logs &&
    a.game.players === b.game.players &&
    a.game.activeSide === b.game.activeSide &&
    a.game.status === b.game.status &&
    a.game.turnNumber === b.game.turnNumber &&
    a.game.tilebag === b.game.tilebag &&
    a.game.timers.initialSeconds === b.game.timers.initialSeconds &&
    a.game.timers.initialSecondsBySide === b.game.timers.initialSecondsBySide &&
    a.currentTurnRack === b.currentTurnRack &&
    a.selectedLogId === b.selectedLogId &&
    a.replayPhase === b.replayPhase &&
    a.forks === b.forks &&
    a.lineView === b.lineView &&
    a.lineCount === b.lineCount &&
    a.timelineStatus === b.timelineStatus &&
    a.branch === b.branch &&
    a.readOnly === b.readOnly &&
    a.onSelectLog === b.onSelectLog &&
    a.onStarsChange === b.onStarsChange &&
    a.onNoteChange === b.onNoteChange &&
    a.onStep === b.onStep &&
    a.onSetPhase === b.onSetPhase &&
    a.onOpenMap === b.onOpenMap &&
    a.onViewOption === b.onViewOption &&
    a.onContinue === b.onContinue
  );
}

export const LogPanel = memo(function LogPanel({
  game,
  logs,
  selectedLogId,
  replayPhase,
  forks,
  lineView,
  lineCount,
  timelineStatus,
  branch,
  onSelectLog,
  onStarsChange,
  onNoteChange,
  onStep,
  onSetPhase,
  onOpenMap,
  onViewOption,
  onContinue,
  currentTurnRack,
  readOnly = false,
}: LogPanelProps) {
  const selectedIndex = selectedLogId ? logs.findIndex((log) => log.id === selectedLogId) : -1;
  const reviewing = selectedIndex >= 0;
  const shown = reviewing ? logs[selectedIndex]! : lineView ? null : (logs.at(-1) ?? null);
  // A game's own logs; the viewed line only borrows the rest of the game for context.
  const viewGame = logs === game.logs ? game : { ...game, logs: logs as TurnLog[] };

  return (
    <section className={`log-panel${lineView ? " is-viewing-line" : ""}`}>
      <PanelHeading
        title="Turn Log"
        detail={`${logs.length} turns`}
        actions={
          onOpenMap ? (
            <button
              type="button"
              className={`log-map-button${lineCount > 1 ? " has-lines" : ""}`}
              aria-label={
                lineCount > 1 ? `เปิด Turn Log Map · ${lineCount} เส้นทาง` : "เปิด Turn Log Map"
              }
              title="Turn Log Map — ดูทุกเส้นทางของเกมนี้"
              onClick={onOpenMap}
            >
              <Network size={14} aria-hidden />
              Map
              {lineCount > 1 && <b className="log-map-count">{lineCount}</b>}
              {timelineStatus === "loading" && <i className="log-map-loading" aria-hidden />}
            </button>
          ) : undefined
        }
      />

      {lineView && (
        <div className="log-line-banner" role="status">
          <GitBranch size={13} aria-hidden />
          <span>
            {lineView.forkTurn === null
              ? "กำลังดูอีกเส้นทาง · แยกตั้งแต่ตาแรก"
              : `กำลังดูอีกเส้นทาง · แยกหลังตา ${lineView.forkTurn}`}
          </span>
          <button type="button" onClick={() => onStep("live")}>
            กลับเส้นที่เล่นอยู่
          </button>
        </div>
      )}

      <div className="log-list">
        {logs.length === 0 && (currentTurnRack?.length ?? 0) < RACK_SIZE && (
          <p className="empty-text">No turn records yet.</p>
        )}
        <TurnRecordList
          currentTurnRack={currentTurnRack}
          game={game}
          logs={logs}
          forks={forks}
          showLive={!lineView}
          selectedLogId={selectedLogId}
          onSelectLog={onSelectLog}
          onViewOption={onViewOption}
        />
      </div>

      {logs.length > 0 && (
        <TurnNavigator
          index={selectedIndex}
          total={logs.length}
          viewingLine={Boolean(lineView)}
          onStep={onStep}
        />
      )}

      {shown && (
        <div className="log-detail">
          {reviewing ? (
            <div className="log-review-head">
              <div className="log-phase" role="group" aria-label="มุมมองของตานี้บนกระดาน">
                <button
                  type="button"
                  aria-pressed={replayPhase === "before"}
                  onClick={() => onSetPhase("before")}
                >
                  ก่อนเดิน
                </button>
                <button
                  type="button"
                  aria-pressed={replayPhase === "after"}
                  onClick={() => onSetPhase("after")}
                >
                  หลังเดิน
                </button>
              </div>
              {branch.available && (
                <button
                  type="button"
                  className="log-continue"
                  disabled={Boolean(branch.blockedReason) || branch.busy}
                  title={
                    branch.blockedReason ??
                    (replayPhase === "before"
                      ? `เล่นตา ${shown.turnNumber} ใหม่จากกระดานก่อนเดิน — ตาเดิมเก็บไว้เป็นอีกเส้นทาง`
                      : `เล่นต่อจากหลังตา ${shown.turnNumber} — ตาที่เล่นไปแล้วเก็บไว้เป็นอีกเส้นทาง`)
                  }
                  onClick={onContinue}
                >
                  <GitBranch size={14} aria-hidden />
                  {branch.busy ? "กำลังแตกกิ่ง…" : "เล่นต่อจากตรงนี้"}
                </button>
              )}
            </div>
          ) : (
            <span className="log-live-tag">Live | Last turn</span>
          )}
          {reviewing && branch.available && branch.blockedReason && (
            <p className="log-continue-note">{branch.blockedReason}</p>
          )}
          <TurnDetail game={viewGame} log={shown} />
          <div className="log-edit">
            <div className="score-field review-stars">
              <span>Your review</span>
              <div className="star-row" role="radiogroup" aria-label="Review rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`star ${(shown.stars ?? 0) >= n ? "on" : ""}`}
                    disabled={readOnly || Boolean(lineView)}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    onClick={() => onStarsChange(shown.id, (shown.stars ?? 0) === n ? 0 : n)}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
            <label className="note-field">
              Turn note
              <textarea
                disabled={readOnly || Boolean(lineView)}
                rows={2}
                value={shown.note ?? ""}
                onChange={(event) => onNoteChange(shown.id, event.target.value)}
              />
            </label>
          </div>
        </div>
      )}
    </section>
  );
}, sameLogPanel);

/**
 * Step through turns without hunting for rows: first, back, forward, last, and back to live.
 *
 * Whole turns, so a long game is a few taps end to end. The before/after half of a turn is the
 * detail's toggle, not another stop on the way.
 */
function TurnNavigator({
  index,
  total,
  viewingLine,
  onStep,
}: {
  index: number;
  total: number;
  viewingLine: boolean;
  onStep: (step: TurnStep) => void;
}) {
  const live = index < 0 && !viewingLine;
  const atStart = index === 0;
  const atEnd = index === total - 1;
  return (
    <nav className="turn-nav" aria-label="เลื่อนดูตา">
      <button type="button" aria-label="ตาแรก" disabled={atStart} onClick={() => onStep("first")}>
        <ChevronsLeft size={15} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="ตาก่อนหน้า"
        disabled={atStart}
        onClick={() => onStep("prev")}
      >
        <ChevronLeft size={15} aria-hidden />
      </button>
      <span className="turn-nav-label" aria-live="polite">
        {live ? `สด · ${total} ตา` : index < 0 ? `— / ${total}` : `ตา ${index + 1} / ${total}`}
      </span>
      <button
        type="button"
        aria-label="ตาถัดไป"
        disabled={live || (atEnd && viewingLine)}
        onClick={() => onStep("next")}
      >
        <ChevronRight size={15} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="ตาล่าสุด"
        disabled={live || atEnd}
        onClick={() => onStep("last")}
      >
        <ChevronsRight size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="turn-nav-live"
        aria-label="กลับไปที่ตาปัจจุบัน"
        disabled={live}
        onClick={() => onStep("live")}
      >
        สด
      </button>
    </nav>
  );
}
