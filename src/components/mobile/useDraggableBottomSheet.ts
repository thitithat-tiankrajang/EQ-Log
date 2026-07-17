import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEventHandler,
} from "react";

const CLOSE_DURATION_MS = 240;
const SNAP_DURATION_MS = 210;

type DragSession = {
  pointerId: number;
  startY: number;
  startOffset: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
};

export function useDraggableBottomSheet({
  active = true,
  onClose,
}: {
  active?: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const offsetRef = useRef(0);
  const dragRef = useRef<DragSession | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const sheetHeightRef = useRef(640);
  const [offsetY, setOffsetY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  onCloseRef.current = onClose;

  const moveSheet = useCallback((nextOffset: number) => {
    const safeOffset = Math.max(0, nextOffset);
    offsetRef.current = safeOffset;
    setOffsetY(safeOffset);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    dragRef.current = null;
    setDragging(false);
    setClosing(true);
    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    sheetHeightRef.current = sheetHeight;
    moveSheet(sheetHeight + 32);
    closeTimerRef.current = window.setTimeout(() => {
      onCloseRef.current();
    }, CLOSE_DURATION_MS);
  }, [moveSheet]);

  useEffect(() => {
    if (!active) {
      closingRef.current = false;
      dragRef.current = null;
      setClosing(false);
      setDragging(false);
      moveSheet(0);
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => sheetRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    };
  }, [active, moveSheet, requestClose]);

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (closingRef.current || event.button !== 0) return;
    const now = performance.now();
    sheetHeightRef.current = sheetRef.current?.getBoundingClientRect().height ?? 640;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: offsetRef.current,
      lastY: event.clientY,
      lastAt: now,
      velocityY: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(now - drag.lastAt, 1);
    drag.velocityY = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    moveSheet(drag.startOffset + event.clientY - drag.startY);
  };

  const finishDrag = (event: Parameters<PointerEventHandler<HTMLElement>>[0]) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);

    const closeThreshold = Math.min(180, sheetHeightRef.current * 0.28);
    const fastDownwardFlick = offsetRef.current >= 36 && drag.velocityY >= 0.5;
    if (offsetRef.current >= closeThreshold || fastDownwardFlick) {
      requestClose();
      return;
    }
    moveSheet(0);
  };

  const cancelDrag: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    moveSheet(0);
  };

  const revealProgress = Math.min(
    offsetY / Math.max(sheetHeightRef.current * 0.58, 1),
    1,
  );
  const backdropAlpha = Math.max(0.02, 0.45 * (1 - revealProgress));
  const sheetStyle: CSSProperties = {
    transform: `translate3d(0, ${offsetY}px, 0)`,
    transition: dragging
      ? "none"
      : `transform ${closing ? CLOSE_DURATION_MS : SNAP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  };
  const backdropStyle: CSSProperties = {
    backgroundColor: `rgba(15, 23, 31, ${backdropAlpha})`,
  };

  return {
    backdropStyle,
    closing,
    dragHandleProps: {
      onPointerCancel: cancelDrag,
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
    },
    dragging,
    requestClose,
    sheetRef,
    sheetStyle,
  };
}
