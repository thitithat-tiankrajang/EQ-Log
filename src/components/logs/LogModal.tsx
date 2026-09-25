import { useEffect, useId } from "react";
import { GitBranch, Network, X } from "lucide-react";
import { type GameState, type TileInstance, type TurnLog } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { ACTION_LABELS } from "../../uiText";
import { TurnDetail } from "../replay/TurnDetail";
import { TurnRecordList } from "./TurnRecordList";
import { useDialogBehavior } from "../ui/useDialogBehavior";
import type { BranchOption, ForkIndex } from "./branchView";
import type { BranchControl } from "./LogPanel";

// The turn log as a dialog: the phone's way in (the rail log is hidden there), and a bigger view
// on any screen. It carries the same quick branching as the rail — fork badges, the map, and
// "continue from here" — because on a phone this is the only turn log there is.
export function LogModal({
  game,
  logs = game.logs,
  open,
  selectedLogId,
  replayPhase = "after",
  forks,
  lineCount = 1,
  branch,
  onClose,
  onSelectLog,
  onStarsChange,
  onNoteChange,
  onSetPhase,
  onOpenMap,
  onViewOption,
  onContinue,
  currentTurnRack,
  readOnly = false,
}: {
  game: GameState;
  /** The line being viewed. Defaults to the one being played. */
  logs?: readonly TurnLog[];
  open: boolean;
  selectedLogId: string | null;
  replayPhase?: "before" | "after";
  forks?: ForkIndex;
  lineCount?: number;
  branch?: BranchControl;
  onClose: () => void;
  onSelectLog: (logId: string | null) => void;
  onStarsChange: (logId: string, stars: number) => void;
  onNoteChange: (logId: string, note: string) => void;
  onSetPhase?: (phase: "before" | "after") => void;
  onOpenMap?: () => void;
  onViewOption?: (option: BranchOption) => void;
  onContinue?: () => void;
  currentTurnRack?: TileInstance[];
  readOnly?: boolean;
}) {
  // When the log opens, jump straight to the latest turn's detail.
  useEffect(() => {
    if (open && !selectedLogId && logs.length > 0) {
      onSelectLog(logs[logs.length - 1]!.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLElement>({ open, onClose });

  if (!open) return null;
  const selectedLog = selectedLogId ? logs.find((log) => log.id === selectedLogId) : null;
  const viewing = logs !== game.logs;
  const viewGame = viewing ? { ...game, logs: logs as TurnLog[] } : game;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="log-modal"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">{viewing ? "อีกเส้นทาง" : "Review"}</span>
            <h2 id={titleId}>Turn Log · {logs.length} turns</h2>
          </div>
          <div className="modal-head-actions">
            {onOpenMap && (
              <button className="icon-button log-map-button" type="button" onClick={onOpenMap}>
                <Network size={16} aria-hidden />
                Map
                {lineCount > 1 && <b className="log-map-count">{lineCount}</b>}
              </button>
            )}
            <button className="icon-button" type="button" onClick={onClose}>
              <X size={18} />
              Close
            </button>
          </div>
        </header>

        <div className="modal-body">
          <div className="modal-log-list">
            {logs.length === 0 && (currentTurnRack?.length ?? 0) < RACK_SIZE && (
              <p className="empty-text">No turn records yet.</p>
            )}
            <TurnRecordList
              currentTurnRack={currentTurnRack}
              game={game}
              logs={logs}
              forks={forks}
              showLive={!viewing}
              selectedLogId={selectedLogId}
              toggleSelection={false}
              onSelectLog={onSelectLog}
              onViewOption={onViewOption}
            />
          </div>

          <div className="modal-log-detail">
            {selectedLog ? (
              <>
                {onSetPhase && (
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
                    {branch?.available && onContinue && (
                      <button
                        type="button"
                        className="log-continue"
                        disabled={Boolean(branch.blockedReason) || branch.busy}
                        title={branch.blockedReason ?? undefined}
                        onClick={onContinue}
                      >
                        <GitBranch size={14} aria-hidden />
                        {branch.busy ? "กำลังแตกกิ่ง…" : "เล่นต่อจากตรงนี้"}
                      </button>
                    )}
                  </div>
                )}
                {branch?.available && branch.blockedReason && (
                  <p className="log-continue-note">{branch.blockedReason}</p>
                )}
                <TurnDetail game={viewGame} log={selectedLog} />
                <div className="log-edit">
                  <div className="score-field review-stars">
                    <span>Your review</span>
                    <div className="star-row" role="radiogroup" aria-label="Review rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`star ${(selectedLog.stars ?? 0) >= n ? "on" : ""}`}
                          disabled={readOnly || viewing}
                          aria-label={`${n} star${n > 1 ? "s" : ""}`}
                          onClick={() => onStarsChange(selectedLog.id, (selectedLog.stars ?? 0) === n ? 0 : n)}
                        >
                          ★
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="note-field">
                    Turn note
                    <textarea
                      disabled={readOnly || viewing}
                      rows={2}
                      value={selectedLog.note ?? ""}
                      onChange={(event) => onNoteChange(selectedLog.id, event.target.value)}
                    />
                  </label>
                  {readOnly && <p className="empty-text">Read-only spectator mode.</p>}
                </div>
              </>
            ) : (
              <p className="empty-text">Select a turn to inspect its tiles, equation, and scoring.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export function LogSummary({ game, onOpen }: { game: GameState; onOpen: () => void }) {
  const latestLog = game.logs.at(-1);
  return (
    <section className="log-summary">
      <div>
        <span>Turn Log</span>
        <strong>{game.logs.length} turns</strong>
      </div>
      {latestLog ? (
        <p>
          Latest turn: T{latestLog.turnNumber} · {game.players[latestLog.side]} ·{" "}
          {ACTION_LABELS[latestLog.action]} · {latestLog.finalScore} pts
        </p>
      ) : (
        <p>No action logs yet.</p>
      )}
      <button className="icon-button" type="button" onClick={onOpen}>
        Open Log
      </button>
    </section>
  );
}
