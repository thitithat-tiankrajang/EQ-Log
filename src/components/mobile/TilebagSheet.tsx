import { Check } from "lucide-react";
import type { TileInstance } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { Tile } from "../board/Tile";
import { Tilebag } from "../board/Tilebag";
import { useDraggableBottomSheet } from "./useDraggableBottomSheet";

// Mobile-only bottom sheet for the manual tile-draw ("หยิบเบี้ย") phase.
// Top strip mirrors the 8 rack slots: freshly drawn tiles can be tapped to
// return to the bag; tiles held from the previous turn are locked. Below it,
// the full tilebag as large tap targets (reuses the Tilebag stacks + filter).
export function TilebagSheet({
  carriedOverTileIds,
  onClose,
  onPick,
  onReturn,
  rackSlots,
  remainingCount,
  tilebag,
}: {
  carriedOverTileIds: Set<string>;
  onClose: () => void;
  onPick: (tile: TileInstance) => void;
  onReturn: (tile: TileInstance) => void;
  rackSlots: (TileInstance | null)[];
  remainingCount: number;
  tilebag: TileInstance[];
}) {
  const filled = rackSlots.filter(Boolean).length;
  const done = filled >= RACK_SIZE;
  const remainingNeeded = Math.max(0, RACK_SIZE - filled);
  const sheet = useDraggableBottomSheet({ onClose });

  return (
    <div
      className="bag-sheet-backdrop"
      role="presentation"
      style={sheet.backdropStyle}
      onClick={sheet.requestClose}
    >
      <section
        aria-label="Pick tiles from the bag"
        aria-modal="true"
        className={`bag-sheet tile-pick-sheet ${sheet.dragging ? "is-dragging" : ""} ${sheet.closing ? "is-closing" : ""}`}
        ref={sheet.sheetRef}
        role="dialog"
        style={sheet.sheetStyle}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          aria-label="Drag down to close tilebag"
          className="bag-sheet-drag-zone"
          {...sheet.dragHandleProps}
        >
          <div aria-hidden="true" className="bag-sheet-grabber" />
          <header className="bag-sheet-head">
            <div className="bag-sheet-title">
              <strong>Pick tiles</strong>
              <span aria-live="polite">
                {done ? "Rack full" : `Choose ${remainingNeeded} more`} · {remainingCount} left
              </span>
            </div>
          </header>
        </div>
        <div className="mobile-tilebag-rack-block">
          <div className="bag-sheet-rack-label">
            <strong>Your rack</strong>
            <span>{filled}/{RACK_SIZE}</span>
          </div>
          <div aria-label="Your rack" className="bag-sheet-rack">
            {rackSlots.map((tile, index) => {
              if (!tile) {
                return (
                  <div className="bag-rack-slot empty" key={`empty-${index}`}>
                    <span>{index + 1}</span>
                  </div>
                );
              }
              if (carriedOverTileIds.has(tile.id)) {
                return (
                  <div
                    aria-label={`Rack slot ${index + 1}, held from previous turn`}
                    className="bag-rack-slot locked"
                    key={tile.id}
                    title="Held from previous turn"
                  >
                    <Tile tile={tile} />
                  </div>
                );
              }
              return (
                <button
                  className="bag-rack-slot drawn"
                  key={tile.id}
                  aria-label={`Return tile in rack slot ${index + 1} to the bag`}
                  title="Tap to return this tile to the bag"
                  type="button"
                  onClick={() => onReturn(tile)}
                >
                  <Tile tile={tile} />
                  <span aria-hidden="true" className="bag-rack-return">
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bag-sheet-body">
          <Tilebag disabled={done} tilebag={tilebag} onPick={onPick} />
        </div>
        <button className="bag-sheet-done" type="button" onClick={sheet.requestClose}>
          <Check size={20} />
          {done ? "Done — rack is full" : `Close for now · ${remainingNeeded} to go`}
        </button>
      </section>
    </div>
  );
}
