import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";

export type OverflowItem = {
  icon?: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Visible explanation when disabled. */
  disabledReason?: string;
  onSelect: () => void;
};

/**
 * "⋯" button that opens a Sheet of labeled actions. Keeps rare/destructive
 * actions off the card surface (smaller cards, no accidental deletes) while
 * every action still has a readable label — no icon-only buttons.
 */
export function OverflowMenu({ label, items }: { label: string; items: OverflowItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="overflow-menu-trigger"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      <Sheet open={open} title={label} onClose={() => setOpen(false)}>
        <div className="overflow-menu-items">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`overflow-menu-item ${item.danger ? "danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon && <span className="overflow-menu-icon">{item.icon}</span>}
              <span className="overflow-menu-copy">
                {item.label}
                {item.disabled && item.disabledReason && <em>{item.disabledReason}</em>}
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
