import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";
import type { TileInstance } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { Tile } from "../board/Tile";
import { Tilebag } from "../board/Tilebag";

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
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="bag-sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-label="Pick tiles from the bag"
        aria-modal="true"
        className="bag-sheet"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div aria-hidden="true" className="bag-sheet-grabber" />
        <header className="bag-sheet-head">
          <div className="bag-sheet-title">
            <strong>Pick tiles</strong>
            <span aria-live="polite">
              {done ? "Rack full" : `Choose ${remainingNeeded} more`} · {remainingCount} left in bag
            </span>
          </div>
          <button aria-label="Close" className="bag-sheet-close" type="button" onClick={onClose}>
            <X size={22} />
          </button>
        </header>
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
        <div className="bag-sheet-body">
          <Tilebag disabled={done} tilebag={tilebag} onPick={onPick} />
        </div>
        <button className="bag-sheet-done" type="button" onClick={onClose}>
          <Check size={20} />
          {done ? "Done — rack is full" : `Close for now · ${remainingNeeded} to go`}
        </button>
      </section>
    </div>
  );
}
