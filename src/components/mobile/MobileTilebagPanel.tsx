import { Package, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TileInstance } from "../../game";
import { Tilebag } from "../board/Tilebag";

export function MobileTilebagPanel({
  remainingCount,
  tiles,
}: {
  remainingCount: number;
  tiles: TileInstance[];
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
          onClick={() => setOpen(false)}
        >
          <section
            aria-label="Tiles not yet visible"
            aria-modal="true"
            className="bag-sheet mobile-tilebag-sheet"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <div aria-hidden="true" className="bag-sheet-grabber" />
            <header className="bag-sheet-head">
              <div className="bag-sheet-title">
                <strong>Tilebag</strong>
                <span>{remainingCount} tiles left in the bag</span>
              </div>
              <button
                aria-label="Close tilebag"
                className="bag-sheet-close"
                type="button"
                onClick={() => setOpen(false)}
              >
                <X size={22} />
              </button>
            </header>
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
