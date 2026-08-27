import { X } from "lucide-react";
import { useId } from "react";
import { getAssignmentOptions, type TileInstance } from "../../game";
import { Tile } from "../board/Tile";
import { useDialogBehavior } from "../ui/useDialogBehavior";

export type AssignmentRequest =
  | {
      kind: "place";
      tile: TileInstance;
      row: number;
      col: number;
      dir?: "right" | "down" | "left" | "up";
      rackSlot?: number;
    }
  | {
      kind: "swapPending";
      tile: TileInstance;
      pendingTileId: string;
    }
  | {
      kind: "editPending";
      tile: TileInstance;
      pendingTileId: string;
    };

export function AssignmentModal({
  request,
  onCancel,
  onSelect,
}: {
  request: AssignmentRequest;
  onCancel: () => void;
  onSelect: (value: string) => void;
}) {
  const options = getAssignmentOptions(request.tile.token);
  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLElement>({ onClose: onCancel });
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="assignment-modal"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">Tile Assignment</span>
            <h2 id={titleId}>Choose the tile value</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel}>
            <X size={18} />
            Cancel
          </button>
        </header>
        <div className="assignment-body">
          <Tile tile={request.tile} />
          <div className="assignment-options">
            {options.map((option) => (
              <button key={option} type="button" onClick={() => onSelect(option)}>
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

