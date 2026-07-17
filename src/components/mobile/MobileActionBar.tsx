import {
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Package,
  RefreshCcw,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import type {
  ActionType,
  GameStatus,
  MoveValidation,
  TileDrawMode,
} from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";

type ActionMode = "none" | ActionType;

type MobileActionBarProps = {
  actionMode: ActionMode;
  canChooseAction: boolean;
  canExchange: boolean;
  canEditRefill: boolean;
  canPickFromTilebag: boolean;
  canUndoPlacement: boolean;
  exchangeCount: number;
  exchangeReady: boolean;
  gameFinished: boolean;
  gameStatus: GameStatus;
  pendingCount: number;
  rackCount: number;
  readOnly: boolean;
  refillNeeded: boolean;
  replayIndex: number;
  replayTotalSteps: number;
  reviewing: boolean;
  tileDrawMode: TileDrawMode;
  validation: MoveValidation;
  onCancelAction: () => void;
  onConfirmExchange: () => void;
  onConfirmPass: () => void;
  onConfirmPlace: () => void;
  onEditRefill: () => void;
  onOpenBag: () => void;
  onReplayExit: () => void;
  onReplayNext: () => void;
  onReplayPrev: () => void;
  onStartAction: (action: ActionType) => void;
  onUndoPlacement: () => boolean;
};

// Mobile-only contextual control strip that lives in the fixed bottom dock,
// directly above the rack. Hidden on desktop via CSS (see 99-mobile-play.css).
// One row, three zones max, every target ≥ 48px tall.
export function MobileActionBar({
  actionMode,
  canChooseAction,
  canExchange,
  canEditRefill,
  canPickFromTilebag,
  canUndoPlacement,
  exchangeCount,
  exchangeReady,
  gameFinished,
  gameStatus,
  pendingCount,
  rackCount,
  readOnly,
  refillNeeded,
  replayIndex,
  replayTotalSteps,
  reviewing,
  tileDrawMode,
  validation,
  onCancelAction,
  onConfirmExchange,
  onConfirmPass,
  onConfirmPlace,
  onEditRefill,
  onOpenBag,
  onReplayExit,
  onReplayNext,
  onReplayPrev,
  onStartAction,
  onUndoPlacement,
}: MobileActionBarProps) {
  if (reviewing) {
    return (
      <div className="mobile-action-bar">
        <button
          aria-label="Previous step"
          className="mab-btn icon"
          disabled={replayIndex <= 0}
          type="button"
          onClick={onReplayPrev}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="mab-status info">
          <strong>
            Replay {Math.max(1, replayIndex + 1)}/{Math.max(1, replayTotalSteps)}
          </strong>
          <span>{replayIndex % 2 === 0 ? "Rack ready" : "Action applied"}</span>
        </div>
        <button
          aria-label="Next step"
          className="mab-btn icon"
          disabled={replayIndex >= replayTotalSteps - 1}
          type="button"
          onClick={onReplayNext}
        >
          <ChevronRight size={22} />
        </button>
        <button className="mab-btn" type="button" onClick={onReplayExit}>
          <X size={18} />
          Exit
        </button>
      </div>
    );
  }

  if (gameFinished) {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info wide">
          <strong>Game finished</strong>
          <span>Result and Replay are in the top bar.</span>
        </div>
      </div>
    );
  }

  if (gameStatus === "draft") {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info wide">
          <strong>Draft · paused</strong>
          <span>Press Resume in the top bar to continue.</span>
        </div>
      </div>
    );
  }

  if (canEditRefill) {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info">
          <strong>Rack ready</strong>
          <span>Waiting for the player</span>
        </div>
        <button className="mab-btn primary grow" type="button" onClick={onEditRefill}>
          <RefreshCcw size={18} />
          Edit refill
        </button>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info wide">
          <strong>Watching live</strong>
          <span>Waiting for the active player…</span>
        </div>
      </div>
    );
  }

  if (refillNeeded && actionMode === "none") {
    if (tileDrawMode === "play") {
      return (
        <div className="mobile-action-bar">
          <div className="mab-status info wide">
            <strong>Drawing tiles…</strong>
            <span>The queue refills the rack automatically.</span>
          </div>
        </div>
      );
    }
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info">
          <strong>
            Rack {rackCount}/{RACK_SIZE}
          </strong>
          <span>Pick tiles before acting</span>
        </div>
        <button
          className="mab-btn primary grow"
          disabled={!canPickFromTilebag}
          type="button"
          onClick={onOpenBag}
        >
          <Package size={20} />
          Pick tiles
        </button>
      </div>
    );
  }

  if (actionMode === "none") {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status info">
          <strong>Your move</strong>
          <span>Tap a square, then rack tiles</span>
        </div>
        <button
          className="mab-btn"
          disabled={!canChooseAction || !canExchange}
          type="button"
          onClick={() => onStartAction("exchange")}
        >
          <ArrowLeftRight size={18} />
          Exchange
        </button>
        <button
          className="mab-btn"
          disabled={!canChooseAction}
          type="button"
          onClick={() => onStartAction("pass")}
        >
          <SkipForward size={18} />
          Pass
        </button>
      </div>
    );
  }

  if (actionMode === "place_equation") {
    const statusClass = validation.isValid ? "valid" : "invalid";
    return (
      <div className="mobile-action-bar">
        <button aria-label="Cancel placement" className="mab-btn icon" type="button" onClick={onCancelAction}>
          <X size={22} />
        </button>
        <button
          aria-label="Undo last placed tile"
          className="mab-btn icon"
          disabled={!canUndoPlacement}
          title="Undo last tile"
          type="button"
          onClick={onUndoPlacement}
        >
          <Undo2 size={21} />
        </button>
        <div className={`mab-status ${statusClass}`}>
          <strong>{validation.isValid ? `${validation.score} pts` : `${pendingCount} tile(s)`}</strong>
          <span>
            {validation.isValid
              ? validation.bingoBonus > 0
                ? "Valid · Bingo bonus!"
                : "Valid equation"
              : validation.errors[0] ?? "Place tiles to form an equation"}
          </span>
        </div>
        <button
          className="mab-btn primary"
          disabled={!validation.isValid}
          type="button"
          onClick={onConfirmPlace}
        >
          <Check size={20} />
          Submit
        </button>
      </div>
    );
  }

  if (actionMode === "exchange") {
    return (
      <div className="mobile-action-bar">
        <button aria-label="Cancel exchange" className="mab-btn icon" type="button" onClick={onCancelAction}>
          <X size={22} />
        </button>
        <div className={`mab-status ${exchangeReady ? "valid" : "info"}`}>
          <strong>{exchangeCount} selected</strong>
          <span>Tap rack tiles to swap out</span>
        </div>
        <button
          className="mab-btn primary"
          disabled={!exchangeReady}
          type="button"
          onClick={onConfirmExchange}
        >
          <Check size={20} />
          Exchange
        </button>
      </div>
    );
  }

  if (actionMode === "pass") {
    return (
      <div className="mobile-action-bar">
        <button aria-label="Cancel pass" className="mab-btn icon" type="button" onClick={onCancelAction}>
          <X size={22} />
        </button>
        <button className="mab-btn primary grow" type="button" onClick={onConfirmPass}>
          <Check size={20} />
          Confirm pass
        </button>
      </div>
    );
  }

  return null;
}
