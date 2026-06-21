import { useCallback, useEffect, useRef, useState } from "react";
import { GripHorizontal } from "lucide-react";
import { ACTION_PANEL_MIN_HEIGHT_PX, TILEBAG_PANEL_MIN_HEIGHT_PX } from "../../constants/layout";
import { STORAGE_KEYS } from "../../constants/storage";

// A horizontal grab-handle that sits between Tilebag (above) and Action card
// (below) in the right rail. Dragging it sets `--actions-height` on the rail
// element, which the rail CSS reads to size the actions row.
//
// The split is persisted to localStorage so the user's preference survives
// reloads. Default is 50% if no preference exists.
export function RailDivider({ railRef }: { railRef: React.RefObject<HTMLElement | null> }) {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  // Apply persisted split on mount.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const saved = window.localStorage.getItem(STORAGE_KEYS.railSplit);
    const initial = saved ? parseFloat(saved) : NaN;
    if (Number.isFinite(initial) && initial > 0) {
      rail.style.setProperty("--actions-height", `${initial}px`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      const railRect = rail.getBoundingClientRect();
      const delta = event.clientY - startY.current;
      // Dragging the handle UP grows the actions panel; DOWN shrinks it.
      const next = startHeight.current - delta;
      const min = ACTION_PANEL_MIN_HEIGHT_PX;
      const max = Math.max(min + 1, railRect.height - TILEBAG_PANEL_MIN_HEIGHT_PX);
      const clamped = Math.max(min, Math.min(max, next));
      rail.style.setProperty("--actions-height", `${clamped}px`);
    },
    [railRef],
  );

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
      const rail = railRef.current;
      setDragging(false);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (rail) {
        const final = rail.style.getPropertyValue("--actions-height");
        if (final) window.localStorage.setItem(STORAGE_KEYS.railSplit, final.replace("px", ""));
      }
      // Release pointer capture even if React already cleaned up the target.
      try {
        (event.target as Element | null)?.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore */
      }
    },
    [onPointerMove, railRef],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const rail = railRef.current;
    if (!rail) return;
    event.preventDefault();
    setDragging(true);
    startY.current = event.clientY;
    // Measure the current actions row height so we drag relative to it.
    const actions = rail.querySelector<HTMLElement>(".right-rail-actions, .control-panel");
    startHeight.current = actions ? actions.getBoundingClientRect().height : rail.getBoundingClientRect().height / 2;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  return (
    <div
      aria-label="Resize Tilebag and Action panels"
      aria-orientation="horizontal"
      className={`rail-divider ${dragging ? "dragging" : ""}`}
      role="separator"
      tabIndex={0}
      title="Drag to resize"
      onPointerDown={onPointerDown}
    >
      <GripHorizontal size={14} />
    </div>
  );
}
