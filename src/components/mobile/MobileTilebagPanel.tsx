import { Package } from "lucide-react";
import { useState } from "react";
import { RACK_SIZE } from "../../constants/gameRules";
import type { TileInstance } from "../../game";
import { Tile } from "../board/Tile";
import { Tilebag } from "../board/Tilebag";
import { useDraggableBottomSheet } from "./useDraggableBottomSheet";

export function MobileTilebagPanel({
  rackSlots,
  remainingCount,
  tiles,
}: {
  rackSlots: (TileInstance | null)[];
  remainingCount: number;
  tiles: TileInstance[];
}) {
  const [open, setOpen] = useState(false);
  const sheet = useDraggableBottomSheet({
    active: open,
    onClose: () => setOpen(false),
  });
  const visibleRack = [
    ...rackSlots,
    ...Array<TileInstance | null>(RACK_SIZE).fill(null),
  ].slice(0, RACK_SIZE);

  return (
    <>
      <button
        aria-label={`Open tilebag, ${remainingCount} tiles left`}
        className="mobile-tilebag-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Package size={18} />
        <span>Tilebag</span>
        <strong>{remainingCount} tiles</strong>
      </button>

      {open && (
        <div
          className="bag-sheet-backdrop mobile-tilebag-backdrop"
          role="presentation"
          style={sheet.backdropStyle}
          onClick={sheet.requestClose}
        >
          <section
            aria-label="Tiles not yet visible"
            aria-modal="true"
            className={`bag-sheet mobile-tilebag-sheet ${sheet.dragging ? "is-dragging" : ""} ${sheet.closing ? "is-closing" : ""}`}
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
                  <strong>Tilebag</strong>
                  <span>{remainingCount} tiles left in the bag</span>
                </div>
              </header>
            </div>

            <div className="mobile-tilebag-rack-block">
              <div className="bag-sheet-rack-label">
                <strong>Your rack</strong>
                <span>{visibleRack.filter(Boolean).length}/{RACK_SIZE}</span>
              </div>
              <div aria-label="Your rack" className="bag-sheet-rack">
                {visibleRack.map((tile, index) =>
                  tile ? (
                    <div className="bag-rack-slot" key={tile.id}>
                      <Tile tile={tile} />
                    </div>
                  ) : (
                    <div className="bag-rack-slot empty" key={`empty-${index}`}>
                      <span>{index + 1}</span>
                    </div>
                  ),
                )}
              </div>
            </div>

            <div className="bag-sheet-body mobile-tilebag-sheet-body">
              <Tilebag
                disabled={false}
                readOnly
                tilebag={tiles}
                onPick={() => undefined}
              />
            </div>
          </section>
        </div>
      )}
    </>
  );
}
