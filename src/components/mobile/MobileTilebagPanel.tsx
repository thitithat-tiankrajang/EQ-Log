import { Package } from "lucide-react";
import { useState } from "react";
import { RACK_SIZE } from "../../constants/gameRules";
import type { TileInstance } from "../../game";
import type { TilebagCountKind, TilebagListKind } from "../../gameplay/tilebag";
import { TILEBAG_COUNT_LABELS } from "../../uiText";
import { Tile } from "../board/Tile";
import { Tilebag } from "../board/Tilebag";
import { useDraggableBottomSheet } from "./useDraggableBottomSheet";

export function MobileTilebagPanel({
  kind,
  listKind,
  rackSlots,
  remainingCount,
  tiles,
}: {
  kind: TilebagCountKind;
  listKind: TilebagListKind;
  rackSlots: (TileInstance | null)[];
  remainingCount: number;
  tiles: TileInstance[];
}) {
  const countLabel = TILEBAG_COUNT_LABELS[kind];
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
        aria-label={`Open tilebag, ${remainingCount} in ${countLabel.toLowerCase()}`}
        className="mobile-tilebag-trigger"
        type="button"
        onClick={() => setOpen(true)}
      >
        <Package size={18} />
        <span>{countLabel}</span>
        <strong>{remainingCount} tiles</strong>
      </button>

      {open && (
        <div
          className="bag-sheet-backdrop mobile-tilebag-backdrop"
          ref={sheet.backdropRef}
          role="presentation"
          style={sheet.backdropStyle}
          {...sheet.backdropGestureProps}
        >
          <section
            aria-label="Tiles not yet visible"
            aria-modal="true"
            className={`bag-sheet mobile-tilebag-sheet ${sheet.opening ? "is-opening" : ""} ${sheet.dragging ? "is-dragging" : ""} ${sheet.closing ? "is-closing" : ""}`}
            ref={sheet.sheetRef}
            role="dialog"
            style={sheet.sheetStyle}
            tabIndex={-1}
            {...sheet.dragSurfaceProps}
            onClick={(event) => event.stopPropagation()}
          >
            <div aria-label="Drag tilebag up or down" className="bag-sheet-drag-zone">
              <div aria-hidden="true" className="bag-sheet-grabber" />
              <header className="bag-sheet-head">
                <div className="bag-sheet-title">
                  <strong>{countLabel}</strong>
                  <span>
                    {kind === "bag"
                      ? `${remainingCount} tiles left in the bag`
                      : kind === "opponent-rack"
                        ? `${remainingCount} tiles in the opponent's rack`
                        : `${remainingCount} tiles you cannot see`}
                  </span>
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
                listKind={listKind}
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
