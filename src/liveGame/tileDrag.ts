import { useEffect, useRef } from "react";

/** Draft drag/drop carries only an ID already in the authorized rack. */
export function useLiveTileDrag(
  enabled: boolean,
  onDrop: (id: string, target: { row: number; col: number } | { slot: number }) => void,
) {
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    if (!enabled) return;
    let pending: { id: string; x: number; y: number; pointer: number; moved: boolean } | null =
      null;
    let suppressClick = false;
    let suppressTimer: ReturnType<typeof setTimeout> | undefined;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const tile = (event.target as Element).closest<HTMLElement>("[data-draft-tile-id]");
      if (tile)
        pending = {
          id: tile.dataset.draftTileId!,
          x: event.clientX,
          y: event.clientY,
          pointer: event.pointerId,
          moved: false,
        };
    };
    const move = (event: PointerEvent) => {
      if (
        pending &&
        pending.pointer === event.pointerId &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) >= 8
      )
        pending.moved = true;
    };
    const up = (event: PointerEvent) => {
      const current = pending;
      pending = null;
      if (!current || current.pointer !== event.pointerId || !current.moved) return;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-board-row], [data-rack-slot]");
      if (!target) return;
      suppressClick = true;
      clearTimeout(suppressTimer);
      suppressTimer = setTimeout(() => {
        suppressClick = false;
      }, 0);
      if (target.dataset.rackSlot !== undefined)
        drop.current(current.id, { slot: Number(target.dataset.rackSlot) });
      else
        drop.current(current.id, {
          row: Number(target.dataset.boardRow),
          col: Number(target.dataset.boardCol),
        });
    };
    const click = (event: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const cancel = () => {
      pending = null;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("click", click, true);
    return () => {
      clearTimeout(suppressTimer);
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("click", click, true);
    };
  }, [enabled]);
}
