import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEventHandler,
  type WheelEventHandler,
} from "react";

const CLOSE_DURATION_MS = 240;
const DRAG_START_THRESHOLD_PX = 5;
const SNAP_DURATION_MS = 210;

type DragSession = {
  pointerId: number;
  startY: number;
  startOffset: number;
  lastY: number;
  lastAt: number;
  velocityY: number;
  moved: boolean;
};

type BackdropScrollSession = {
  pointerId: number;
  startY: number;
  startScrollY: number;
  moved: boolean;
};

export function useDraggableBottomSheet({
  active = true,
  onClose,
}: {
  active?: boolean;
  onClose: () => void;
}) {
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const offsetRef = useRef(0);
  const dragRef = useRef<DragSession | null>(null);
  const backdropScrollRef = useRef<BackdropScrollSession | null>(null);
  const suppressSheetClickRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const closingRef = useRef(false);
  const sheetHeightRef = useRef(640);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  onCloseRef.current = onClose;

  // Pointer moves paint directly to compositor-only styles. Re-rendering the
  // tile list for every touchmove made reverse drags visibly stutter.
  const paintOffset = useCallback((nextOffset: number) => {
    const safeOffset = Math.max(0, nextOffset);
    offsetRef.current = safeOffset;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translate3d(0, ${safeOffset}px, 0)`;
    }
    const revealProgress = Math.min(
      safeOffset / Math.max(sheetHeightRef.current * 0.58, 1),
      1,
    );
    const backdropAlpha = Math.max(0.02, 0.45 * (1 - revealProgress));
    if (backdropRef.current) {
      backdropRef.current.style.backgroundColor = `rgba(15, 23, 31, ${backdropAlpha})`;
    }
  }, []);

  const paintNextFrame = useCallback((offset: number) => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      paintOffset(offset);
    });
  }, [paintOffset]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    dragRef.current = null;
    backdropScrollRef.current = null;
    setDragging(false);
    setClosing(true);
    const sheetHeight = sheetRef.current?.getBoundingClientRect().height ?? window.innerHeight;
    sheetHeightRef.current = sheetHeight;
    paintNextFrame(sheetHeight + 32);
    closeTimerRef.current = window.setTimeout(() => {
      onCloseRef.current();
    }, CLOSE_DURATION_MS);
  }, [paintNextFrame]);

  useLayoutEffect(() => {
    if (!active) {
      closingRef.current = false;
      dragRef.current = null;
      backdropScrollRef.current = null;
      setClosing(false);
      setDragging(false);
      paintOffset(0);
      return;
    }

    document.body.classList.add("mobile-sheet-open");
    const focusFrame = window.requestAnimationFrame(() => sheetRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.classList.remove("mobile-sheet-open");
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", handleKeyDown);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      closeTimerRef.current = null;
      animationFrameRef.current = null;
    };
  }, [active, paintOffset, requestClose]);

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
      moved: false,
    };
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const nextOffset = drag.startOffset + event.clientY - drag.startY;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < DRAG_START_THRESHOLD_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(now - drag.lastAt, 1);
    drag.velocityY = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    paintOffset(nextOffset);
  };

  const finishDrag: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (!drag.moved) return;
    suppressSheetClickRef.current = true;
    setDragging(false);

    const closeThreshold = Math.min(180, sheetHeightRef.current * 0.28);
    const fastDownwardFlick = offsetRef.current >= 36 && drag.velocityY >= 0.5;
    if (offsetRef.current >= closeThreshold || fastDownwardFlick) {
      requestClose();
      return;
    }
    paintNextFrame(0);
  };

  const cancelDrag: PointerEventHandler<HTMLElement> = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) setDragging(false);
    paintNextFrame(0);
  };

  const suppressClickAfterDrag: PointerEventHandler<HTMLElement> = (event) => {
    if (!suppressSheetClickRef.current) return;
    suppressSheetClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onBackdropPointerDown: PointerEventHandler<HTMLDivElement> = (event) => {
    if (closingRef.current || event.button !== 0 || event.target !== event.currentTarget) return;
    backdropScrollRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startScrollY: window.scrollY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onBackdropPointerMove: PointerEventHandler<HTMLDivElement> = (event) => {
    const scroll = backdropScrollRef.current;
    if (!scroll || scroll.pointerId !== event.pointerId) return;
    const distance = event.clientY - scroll.startY;
    if (!scroll.moved && Math.abs(distance) < DRAG_START_THRESHOLD_PX) return;
    scroll.moved = true;
    event.preventDefault();
    window.scrollTo({ top: scroll.startScrollY - distance, behavior: "auto" });
  };

  const finishBackdropGesture: PointerEventHandler<HTMLDivElement> = (event) => {
    const scroll = backdropScrollRef.current;
    if (!scroll || scroll.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    backdropScrollRef.current = null;
    if (!scroll.moved) requestClose();
  };

  const cancelBackdropGesture: PointerEventHandler<HTMLDivElement> = (event) => {
    const scroll = backdropScrollRef.current;
    if (!scroll || scroll.pointerId !== event.pointerId) return;
    backdropScrollRef.current = null;
  };

  const onBackdropWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    window.scrollBy({ top: event.deltaY, behavior: "auto" });
  };

  const sheetStyle: CSSProperties = {
    transform: `translate3d(0, ${offsetRef.current}px, 0)`,
    transition: dragging
      ? "none"
      : `transform ${closing ? CLOSE_DURATION_MS : SNAP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
  };
  const backdropStyle: CSSProperties = {
    backgroundColor: "rgba(15, 23, 31, 0.45)",
  };

  return {
    backdropRef,
    backdropGestureProps: {
      onPointerCancel: cancelBackdropGesture,
      onPointerDown: onBackdropPointerDown,
      onPointerMove: onBackdropPointerMove,
      onPointerUp: finishBackdropGesture,
      onWheel: onBackdropWheel,
    },
    backdropStyle,
    closing,
    dragSurfaceProps: {
      onClickCapture: suppressClickAfterDrag,
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
