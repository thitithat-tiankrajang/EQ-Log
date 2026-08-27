import { useEffect, useId } from "react";
import { X } from "lucide-react";
import { type GameState, type TileInstance } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { ACTION_LABELS } from "../../uiText";
import { TurnDetail } from "../replay/TurnDetail";
import { TurnRecordList } from "./TurnRecordList";
import { useDialogBehavior } from "../ui/useDialogBehavior";

export function LogModal({
  game,
  open,
  selectedLogId,
  onClose,
  onSelectLog,
  onStarsChange,
  onNoteChange,
  currentTurnRack,
  readOnly = false,
}: {
  game: GameState;
  open: boolean;
  selectedLogId: string | null;
  onClose: () => void;
  onSelectLog: (logId: string | null) => void;
  onStarsChange: (logId: string, stars: number) => void;
  onNoteChange: (logId: string, note: string) => void;
  currentTurnRack?: TileInstance[];
  readOnly?: boolean;
}) {
  // When the log opens, jump straight to the latest turn's detail.
  useEffect(() => {
    if (open && !selectedLogId && game.logs.length > 0) {
      onSelectLog(game.logs[game.logs.length - 1].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLElement>({ open, onClose });

  if (!open) return null;
  const selectedLog = selectedLogId ? game.logs.find((log) => log.id === selectedLogId) : null;

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
            <span className="eyebrow">Review</span>
            <h2 id={titleId}>Turn Log · {game.logs.length} turns</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
            Close
          </button>
        </header>

        <div className="modal-body">
          <div className="modal-log-list">
            {game.logs.length === 0 && (currentTurnRack?.length ?? 0) < RACK_SIZE && (
              <p className="empty-text">No turn records yet.</p>
            )}
            <TurnRecordList
              currentTurnRack={currentTurnRack}
              game={game}
              selectedLogId={selectedLogId}
              toggleSelection={false}
              onSelectLog={onSelectLog}
            />
          </div>

          <div className="modal-log-detail">
            {selectedLog ? (
              <>
                <TurnDetail game={game} log={selectedLog} />
                <div className="log-edit">
                  <div className="score-field review-stars">
                    <span>Your review</span>
                    <div className="star-row" role="radiogroup" aria-label="Review rating">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={`star ${(selectedLog.stars ?? 0) >= n ? "on" : ""}`}
                          disabled={readOnly}
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
                      disabled={readOnly}
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
