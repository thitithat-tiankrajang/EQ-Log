import { Check, Save, X } from "lucide-react";
import {
  type ActionType,
  type GameState,
  type MoveValidation,
  type PendingPlacement,
  type TileDrawMode,
  type TileInstance,
  type TurnLog,
  getAssignmentOptions,
  getTileDrawMode,
  tileNeedsAssignment,
} from "../../game";
import { ACTION_LABELS } from "../../uiText";
import { DraftTiles } from "../game/DraftTiles";
import { EquationPreview } from "../game/EquationPreview";
import { PanelHeading } from "../layout/PanelHeading";
import { ReplayDock } from "../replay/ReplayDock";
import { Tile } from "../board/Tile";

type ActionMode = "none" | ActionType;

type ExchangeDraft = {
  outgoingIds: string[];
  incomingTiles: TileInstance[];
};

type ActionPanelProps = {
  activeRack: TileInstance[];
  actionMode: ActionMode;
  canChooseAction: boolean;
  canEditRefill: boolean;
  canExchange: boolean;
  exchangeDisabledReason?: string;
  exchangeDraft: ExchangeDraft;
  exchangeReady: boolean;
  game: GameState;
  pendingPlacements: PendingPlacement[];
  readOnly: boolean;
  refillNeeded: boolean;
  replayIndex: number;
  replayPhase: "before" | "after";
  replayTotalSteps: number;
  reviewing: boolean;
  showViewPanel: boolean;
  validation: MoveValidation;
  viewPanelLog: TurnLog | null;
  onCancelAction: () => void;
  onConfirmExchange: () => void;
  onConfirmPass: () => void;
  onConfirmPlace: () => void;
  onEditRefill: () => void;
  onReplayExit: () => void;
  onReplayNext: () => void;
  onReplayPrev: () => void;
  onStartAction: (action: ActionType) => void;
  onUpdatePendingAssignment: (tileId: string, value: string) => void;
};

export function ActionPanel({
  activeRack,
  actionMode,
  canChooseAction,
  canEditRefill,
  canExchange,
  exchangeDisabledReason,
  exchangeDraft,
  exchangeReady,
  game,
  pendingPlacements,
  readOnly,
  refillNeeded,
  replayIndex,
  replayPhase,
  replayTotalSteps,
  reviewing,
  showViewPanel,
  validation,
  viewPanelLog,
  onCancelAction,
  onConfirmExchange,
  onConfirmPass,
  onConfirmPlace,
  onEditRefill,
  onReplayExit,
  onReplayNext,
  onReplayPrev,
  onStartAction,
  onUpdatePendingAssignment,
}: ActionPanelProps) {
  return (
    <section className="control-panel">
      <PanelHeading
        title={showViewPanel ? (reviewing ? "Replay" : "Live View") : "Actions"}
        detail={getPanelDetail({
          actionMode,
          game,
          readOnly,
          refillNeeded,
          replayIndex,
          replayPhase,
          replayTotalSteps,
          reviewing,
        })}
      />
      {showViewPanel ? (
        <ReplayDock
          game={game}
          index={reviewing ? replayIndex : Math.max(0, replayTotalSteps - 1)}
          log={viewPanelLog}
          mode={reviewing ? "replay" : "live"}
          phase={replayPhase}
          total={replayTotalSteps}
          onPrev={onReplayPrev}
          onNext={onReplayNext}
          onExit={onReplayExit}
        />
      ) : actionMode === "none" ? (
        <ActionPicker
          activeRackCount={activeRack.length}
          canChooseAction={canChooseAction}
          canEditRefill={canEditRefill}
          canExchange={canExchange}
          exchangeDisabledReason={exchangeDisabledReason}
          refillNeeded={refillNeeded}
          tileDrawMode={getTileDrawMode(game)}
          onEditRefill={onEditRefill}
          onStartAction={onStartAction}
        />
      ) : (
        <ActionDetails
          activeRack={activeRack}
          actionMode={actionMode}
          exchangeDraft={exchangeDraft}
          exchangeReady={exchangeReady}
          pendingPlacements={pendingPlacements}
          readOnly={readOnly}
          validation={validation}
          onCancelAction={onCancelAction}
          onConfirmExchange={onConfirmExchange}
          onConfirmPass={onConfirmPass}
          onConfirmPlace={onConfirmPlace}
          onUpdatePendingAssignment={onUpdatePendingAssignment}
        />
      )}
    </section>
  );
}

function getPanelDetail({
  actionMode,
  game,
  readOnly,
  refillNeeded,
  replayIndex,
  replayPhase,
  replayTotalSteps,
  reviewing,
}: {
  actionMode: ActionMode;
  game: GameState;
  readOnly: boolean;
  refillNeeded: boolean;
  replayIndex: number;
  replayPhase: "before" | "after";
  replayTotalSteps: number;
  reviewing: boolean;
}) {
  if (reviewing) {
    if (replayTotalSteps === 0) return "No turns";
    const phaseLabel = replayPhase === "before" ? "Rack" : "Action";
    return `${Math.max(1, replayIndex + 1)} / ${replayTotalSteps} · ${phaseLabel}`;
  }
  if (readOnly) return "Watching";
  if (game.status === "finished") return "Finished";
  if (actionMode === "none") return refillNeeded ? "Refill Rack" : "Choose Action";
  return ACTION_LABELS[actionMode];
}

function ActionPicker({
  activeRackCount,
  canChooseAction,
  canEditRefill,
  canExchange,
  exchangeDisabledReason,
  refillNeeded,
  tileDrawMode,
  onEditRefill,
  onStartAction,
}: {
  activeRackCount: number;
  canChooseAction: boolean;
  canEditRefill: boolean;
  canExchange: boolean;
  exchangeDisabledReason?: string;
  refillNeeded: boolean;
  tileDrawMode: TileDrawMode;
  onEditRefill: () => void;
  onStartAction: (action: ActionType) => void;
}) {
  if (refillNeeded) {
    return (
      <div className="refill-lock">
        <strong>Refill rack first</strong>
        <span>
          {tileDrawMode === "play"
            ? "Drawing tiles from the queue."
            : `Pick ${Math.max(0, 8 - activeRackCount)} tile(s) from the tilebag to unlock actions.`}
        </span>
      </div>
    );
  }

  return (
    <div className="action-picker-ready">
      <p className="action-picker-hint">
        Drop a tile on the board to start playing. Or:
      </p>
      <div className="action-buttons two">
        <button
          disabled={!canChooseAction || !canExchange}
          title={!canExchange ? exchangeDisabledReason : undefined}
          type="button"
          onClick={() => onStartAction("exchange")}
        >
          Exchange
        </button>
        <button disabled={!canChooseAction} type="button" onClick={() => onStartAction("pass")}>
          Pass
        </button>
      </div>
      {canChooseAction && !canExchange && exchangeDisabledReason && (
        <p className="action-picker-note">{exchangeDisabledReason}</p>
      )}
      {canEditRefill && (
        <button className="edit-refill-button" type="button" onClick={onEditRefill}>
          Edit Refill
        </button>
      )}
    </div>
  );
}

function ActionDetails({
  activeRack,
  actionMode,
  exchangeDraft,
  exchangeReady,
  pendingPlacements,
  readOnly,
  validation,
  onCancelAction,
  onConfirmExchange,
  onConfirmPass,
  onConfirmPlace,
  onUpdatePendingAssignment,
}: {
  activeRack: TileInstance[];
  actionMode: ActionMode;
  exchangeDraft: ExchangeDraft;
  exchangeReady: boolean;
  pendingPlacements: PendingPlacement[];
  readOnly: boolean;
  validation: MoveValidation;
  onCancelAction: () => void;
  onConfirmExchange: () => void;
  onConfirmPass: () => void;
  onConfirmPlace: () => void;
  onUpdatePendingAssignment: (tileId: string, value: string) => void;
}) {
  return (
    <div className="draft-panel">
      <div className="draft-header">
        <strong>Action Details</strong>
        <button type="button" disabled={readOnly} onClick={onCancelAction}>
          <X size={16} />
          Cancel
        </button>
      </div>

      {actionMode === "place_equation" && (
        <PlaceActionDetails
          pendingPlacements={pendingPlacements}
          readOnly={readOnly}
          validation={validation}
          onConfirmPlace={onConfirmPlace}
          onUpdatePendingAssignment={onUpdatePendingAssignment}
        />
      )}

      {actionMode === "exchange" && (
        <ExchangeActionDetails
          activeRack={activeRack}
          exchangeDraft={exchangeDraft}
          exchangeReady={exchangeReady}
          readOnly={readOnly}
          onConfirmExchange={onConfirmExchange}
        />
      )}

      {actionMode === "pass" && <PassActionDetails readOnly={readOnly} onConfirmPass={onConfirmPass} />}
    </div>
  );
}

function PlaceActionDetails({
  pendingPlacements,
  readOnly,
  validation,
  onConfirmPlace,
  onUpdatePendingAssignment,
}: {
  pendingPlacements: PendingPlacement[];
  readOnly: boolean;
  validation: MoveValidation;
  onConfirmPlace: () => void;
  onUpdatePendingAssignment: (tileId: string, value: string) => void;
}) {
  return (
    <>
      <div className={`action-status action-status-compact ${validation.isValid ? "valid" : "invalid"}`}>
        <span>Place</span>
        <div className="action-metrics">
          <strong>{validation.isValid ? "Valid" : "Draft"}</strong>
          <em>{pendingPlacements.length}/8 tiles</em>
          <em>{validation.isValid ? `${validation.score} pts` : "No score"}</em>
          {validation.bingoBonus > 0 && <em>Bingo +40</em>}
        </div>
      </div>
      <div className="place-workspace">
        <div className="pending-strip">
          <span>Placed Tiles</span>
          {pendingPlacements.length > 0 ? (
            <div className="pending-list">
              {pendingPlacements.map((placement) => (
                <PendingPlacementTile
                  key={placement.tile.id}
                  placement={placement}
                  readOnly={readOnly}
                  onUpdatePendingAssignment={onUpdatePendingAssignment}
                />
              ))}
            </div>
          ) : (
            <p className="empty-text">Place at least one tile.</p>
          )}
        </div>
        <div className="action-equation-preview">
          <span>
            {validation.isValid
              ? `${validation.equations.length} equation(s) detected`
              : validation.errors[0] ?? "Equation Preview"}
          </span>
          {validation.equations.length > 0 ? (
            <EquationPreview validation={validation} />
          ) : (
            <p className="empty-text">No equation draft yet.</p>
          )}
        </div>
      </div>
      <button
        className="primary-action"
        disabled={readOnly || !validation.isValid}
        title={readOnly ? "Only the room owner can submit actions." : undefined}
        type="button"
        onClick={onConfirmPlace}
      >
        <Check size={18} />
        Submit Action
      </button>
    </>
  );
}

function PendingPlacementTile({
  placement,
  readOnly,
  onUpdatePendingAssignment,
}: {
  placement: PendingPlacement;
  readOnly: boolean;
  onUpdatePendingAssignment: (tileId: string, value: string) => void;
}) {
  const needsAssignment = tileNeedsAssignment(placement.tile.token);
  const assignmentOptions = getAssignmentOptions(placement.tile.token);

  return (
    <div className={`pending-item ${needsAssignment ? "assignable" : "fixed"}`}>
      <span className="pending-cell-badge">
        R{placement.row + 1}·C{placement.col + 1}
      </span>
      <Tile tile={{ ...placement.tile, assignedToken: placement.assignedToken }} />
      {needsAssignment && assignmentOptions.length <= 4 ? (
        <div aria-label={`Assign ${placement.tile.token}`} className="pending-choice-options">
          {assignmentOptions.map((option) => (
            <button
              className={placement.assignedToken === option ? "active" : ""}
              disabled={readOnly}
              key={option}
              type="button"
              onClick={() => onUpdatePendingAssignment(placement.tile.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : needsAssignment ? (
        <label className="pending-select-wrap">
          <span>{placement.assignedToken ?? "Set"}</span>
          <select
            aria-label={`Assign ${placement.tile.token}`}
            disabled={readOnly}
            value={placement.assignedToken ?? ""}
            onChange={(event) => onUpdatePendingAssignment(placement.tile.id, event.target.value)}
          >
            {assignmentOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <em>Fixed</em>
      )}
    </div>
  );
}

function ExchangeActionDetails({
  activeRack,
  exchangeDraft,
  exchangeReady,
  readOnly,
  onConfirmExchange,
}: {
  activeRack: TileInstance[];
  exchangeDraft: ExchangeDraft;
  exchangeReady: boolean;
  readOnly: boolean;
  onConfirmExchange: () => void;
}) {
  return (
    <>
      <div className={`action-status action-status-compact ${exchangeReady ? "valid" : "invalid"}`}>
        <span>Exchange</span>
        <div className="action-metrics">
          <strong>{exchangeReady ? "Ready" : "Draft"}</strong>
          <em>{exchangeDraft.outgoingIds.length}/8 tiles</em>
          <em>0 pts</em>
        </div>
      </div>
      <div className="exchange-workspace">
        <DraftTiles
          title="Outgoing Tiles"
          tiles={activeRack.filter((tile) => exchangeDraft.outgoingIds.includes(tile.id))}
        />
      </div>
      <button
        className="primary-action"
        disabled={readOnly || !exchangeReady}
        title={readOnly ? "Only the room owner can submit actions." : undefined}
        type="button"
        onClick={onConfirmExchange}
      >
        <Save size={18} />
        Submit Exchange
      </button>
    </>
  );
}

function PassActionDetails({
  readOnly,
  onConfirmPass,
}: {
  readOnly: boolean;
  onConfirmPass: () => void;
}) {
  return (
    <>
      <div className="action-status valid">
        <span>Pass Status</span>
        <strong>Ready to pass this turn</strong>
      </div>
      <button className="primary-action" disabled={readOnly} type="button" onClick={onConfirmPass}>
        <Check size={18} />
        Submit Pass
      </button>
    </>
  );
}
