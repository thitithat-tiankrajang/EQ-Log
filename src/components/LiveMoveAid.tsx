import type { ActionType, GameState, MoveValidation, PendingPlacement, TileInstance } from "../game";
import { ACTION_LABELS } from "../uiText";
import { Tile } from "./Tile";

type ActionMode = "none" | ActionType;

export function LiveMoveAid({
  game,
  actionMode,
  activeRackCount,
  refillNeeded,
  selectedTile,
  pendingPlacements,
  validation,
  exchangeCounts,
  reviewing,
}: {
  game: GameState;
  actionMode: ActionMode;
  activeRackCount: number;
  refillNeeded: boolean;
  selectedTile?: TileInstance;
  pendingPlacements: PendingPlacement[];
  validation: MoveValidation;
  exchangeCounts: { outgoing: number; incoming: number };
  reviewing: boolean;
}) {
  const actionLabel = getActionLabel({
    actionMode,
    refillNeeded,
    reviewing,
  });
  const rackStatus = refillNeeded
    ? `Rack ${activeRackCount}/8 · Need ${Math.max(0, 8 - activeRackCount)}`
    : `Rack ${activeRackCount}/8`;
  const equationText = getEquationText(validation, actionMode);
  const status = actionLabel;

  return (
    <section className="live-aid">
      <div className="live-aid-head">
        <span>Live Move Aid</span>
        <strong>Turn {game.turnNumber}</strong>
      </div>
      <div className="aid-summary-line">
        <strong>Side {game.players[game.activeSide]}</strong>
        <span>{actionLabel}</span>
        <span>{rackStatus}</span>
      </div>
      <div className="aid-equation-line">
        <span>Equation</span>
        <strong>{equationText}</strong>
      </div>
      <div className="aid-status-line">
        <span>Status</span>
        <strong>{status}</strong>
      </div>
      <div className={`selected-tile-line ${selectedTile ? "" : "empty"}`}>
        <span>Selected</span>
        {selectedTile ? <Tile tile={selectedTile} /> : <strong>None</strong>}
      </div>
    </section>
  );
}

function getActionLabel({
  actionMode,
  refillNeeded,
  reviewing,
}: {
  actionMode: ActionMode;
  refillNeeded: boolean;
  reviewing: boolean;
}): string {
  if (reviewing) return "Review";
  if (refillNeeded) return "Refill Rack";
  if (actionMode === "none") return "Choose Action";
  return ACTION_LABELS[actionMode];
}

function getEquationText(validation: MoveValidation, actionMode: ActionMode): string {
  if (actionMode !== "place_equation") return "No equation draft";
  if (validation.equations.length === 0) return "No equation yet";
  return validation.equations.map((equation) => equation.expressionText).join(" / ");
}
