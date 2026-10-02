import { useState } from "react";
import { Board } from "../components/board/Board";
import { Rack } from "../components/board/Rack";
import type { RankedTurnView } from "../features/ranked/publicView";
import {
  getAssignmentOptions,
  validateMove,
  type PendingPlacement,
  type TileInstance,
} from "../game";

/** A disposable draft of the authorized before-board and ONE own rack. No
 * canonical decoder, opponent rack, bag, draws, persistence or live mutation. */
export function LivePractice({
  log,
  onClose,
  onSubmit,
  busy = false,
}: {
  log: RankedTurnView;
  onClose(): void;
  onSubmit?(placements: PendingPlacement[]): void;
  busy?: boolean;
}) {
  const [placements, setPlacements] = useState<PendingPlacement[]>([]);
  const [selected, setSelected] = useState<TileInstance | null>(null);
  const validation = validateMove(log.boardBefore!, placements);
  return (
    <section aria-label="Own-rack live practice" className="pregame-card live-practice">
      <div className="live-practice-head">
        <h2>Practice T{log.turnNumber}</h2>
        <button type="button" className="eq-button eq-button-secondary" onClick={onClose}>
          Close practice
        </button>
      </div>
      <p className="live-tool-note">
        This draft uses your historical rack and the public board. Replacement draws are unavailable
        while the game is live.
      </p>
      <Board
        board={log.boardBefore!}
        pendingPlacements={placements}
        selectedRackTileId={selected?.id ?? null}
        selectedPendingTileId={null}
        onCellClick={(row, col) => {
          if (log.boardBefore![row][col]) return;
          const existing = placements.find((p) => p.row === row && p.col === col);
          if (existing) {
            setPlacements((ps) => ps.filter((p) => p !== existing));
            return;
          }
          if (selected) {
            setPlacements((ps) => [
              ...ps,
              { tile: selected, row, col, assignedToken: getAssignmentOptions(selected.token)[0] },
            ]);
            setSelected(null);
          }
        }}
        onPendingAssignmentEdit={(id) =>
          setPlacements((ps) =>
            ps.map((p) => {
              if (p.tile.id !== id) return p;
              const options = getAssignmentOptions(p.tile.token);
              return {
                ...p,
                assignedToken:
                  options[(options.indexOf(p.assignedToken ?? "") + 1) % options.length],
              };
            }),
          )
        }
      />
      <Rack
        rack={log.rackBefore!.map((t) => (placements.some((p) => p.tile.id === t.id) ? null : t))}
        side={log.side}
        label="Practice rack"
        active
        selectedRackTileId={selected?.id ?? null}
        exchangeOutgoingIds={[]}
        onTileClick={(tile) => setSelected(tile)}
      />
      <p className="live-tool-note" role="status">
        {validation.isValid
          ? `Valid draft · ${validation.score} points`
          : validation.errors.join(" · ")}
      </p>
      <div className="live-tool-actions">
        <button
          type="button"
          className="eq-button eq-button-secondary"
          onClick={() => {
            setPlacements([]);
            setSelected(null);
          }}
        >
          Clear practice draft
        </button>
        {onSubmit && (
          <button
            type="button"
            className="eq-button eq-button-primary"
            disabled={busy || !validation.isValid}
            onClick={() => onSubmit(placements)}
          >
            Submit puzzle placement
          </button>
        )}
      </div>
    </section>
  );
}
