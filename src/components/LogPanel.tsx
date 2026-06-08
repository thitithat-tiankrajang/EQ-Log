import { type GameState, type TileInstance } from "../game";
import { PanelHeading } from "./PanelHeading";
import { TurnDetail } from "./TurnDetail";
import { TurnRecordList } from "./TurnRecordList";

// Always-on live turn log (left rail). Shows the latest turn's full detail by
// default and updates on every submit; clicking a row reviews that turn (which
// drives the board replay via selectedLogId). No "open" click needed.
export function LogPanel({
  game,
  selectedLogId,
  onSelectLog,
  onStarsChange,
  onNoteChange,
  currentTurnRack,
  readOnly = false,
}: {
  game: GameState;
  selectedLogId: string | null;
  onSelectLog: (logId: string | null) => void;
  onStarsChange: (logId: string, stars: number) => void;
  onNoteChange: (logId: string, note: string) => void;
  currentTurnRack?: TileInstance[];
  readOnly?: boolean;
}) {
  const reviewing = Boolean(selectedLogId);
  const shown = selectedLogId
    ? game.logs.find((log) => log.id === selectedLogId) ?? game.logs.at(-1) ?? null
    : game.logs.at(-1) ?? null;

  return (
    <section className="log-panel">
      <PanelHeading title="Turn Log" detail={`${game.logs.length} turns`} />

      <div className="log-list">
        {game.logs.length === 0 && (currentTurnRack?.length ?? 0) < 8 && (
          <p className="empty-text">No turn records yet.</p>
        )}
        <TurnRecordList
          currentTurnRack={currentTurnRack}
          game={game}
          selectedLogId={selectedLogId}
          onSelectLog={onSelectLog}
        />
      </div>

      {shown && (
        <div className="log-detail">
          {reviewing ? (
            <button className="log-live-btn" type="button" onClick={() => onSelectLog(null)}>
              Reviewing - Back to live
            </button>
          ) : (
            <span className="log-live-tag">Live | Last turn</span>
          )}
          <TurnDetail game={game} log={shown} />
          <div className="log-edit">
            <div className="score-field review-stars">
              <span>Your review</span>
              <div className="star-row" role="radiogroup" aria-label="Review rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`star ${(shown.stars ?? 0) >= n ? "on" : ""}`}
                    disabled={readOnly}
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
                disabled={readOnly}
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
}
