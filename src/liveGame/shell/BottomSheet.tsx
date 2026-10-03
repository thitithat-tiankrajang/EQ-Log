import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../i18n/LocaleProvider";

export type SheetSnap = "full" | "peek";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Flick speeds (px/ms) and the fraction of the lowest snap below which a release dismisses. */
const FLICK_DOWN = 0.8;
const FLICK_UP = -0.6;
const DISMISS_FRACTION = 0.55;
/** A slow drag this far (px) moves to the next snap in its direction. */
const SNAP_DISTANCE = 48;
/** A peek snap is offered only when it is meaningfully lower than the expanded sheet. */
const MIN_PEEK_GAP = 24;
const MIN_PEEK = 180;

let openSheets = 0;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The visual viewport: its height, and how much of the layout viewport the keyboard covers. */
function useVisualViewport(active: boolean) {
  const read = () => {
    const vv = window.visualViewport;
    const height = vv?.height ?? window.innerHeight;
    const inset = vv ? Math.max(0, window.innerHeight - (vv.offsetTop + vv.height)) : 0;
    return { height: Math.round(height), inset: Math.round(inset) };
  };
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (!active) return;
    const update = () =>
      setSize((current) => {
        const next = read();
        return current.height === next.height && current.inset === next.inset ? current : next;
      });
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [active]);
  return size;
}

/**
 * A mobile bottom sheet that behaves like one.
 *
 *  - The handle and title row follow the finger: drag DOWN to a lower PEEK
 *    height (the board above stays fully visible), further or flick to
 *    dismiss; drag up or flick up to expand. Release settles on the nearest
 *    snap, taking the flick velocity into account.
 *  - Only the handle/title row starts a drag. The content scrolls normally,
 *    and text fields inside it are never interrupted by the gesture.
 *  - Tap the dimmed area above the sheet to close it. That tap is consumed:
 *    it never reaches the board underneath. Escape closes it as well.
 *  - No close button. Focus moves into the sheet once, when it opens, and
 *    returns to the opener when it closes — never on a re-render, so a clock
 *    tick or a keystroke cannot steal focus from a text field.
 *  - It sits above the on-screen keyboard (visual viewport).
 *
 * The PEEK height is derived from the live board: the sheet's top edge sits
 * just under the board, so the whole board is visible while deciding.
 */
export function BottomSheet({
  open,
  title,
  onClose,
  children,
  snap: controlledSnap,
  onSnapChange,
  peek = true,
  className = "",
}: {
  open: boolean;
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Controlled snap (optional): the parent can lower the sheet to peek, e.g. to show a position. */
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  /** Offer a peek snap (default true). */
  peek?: boolean;
  className?: string;
}) {
  const { t } = useLocale();
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [ownSnap, setOwnSnap] = useState<SheetSnap>("full");
  const snap = controlledSnap ?? ownSnap;
  const setSnap = (next: SheetSnap) => {
    setOwnSnap(next);
    onSnapChange?.(next);
  };
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  /** Closed by the parent, still sliding out. The game behind is already live. */
  const [exiting, setExiting] = useState(false);
  const wasOpen = useRef(open);
  const [natural, setNatural] = useState(0);
  const [boardBottom, setBoardBottom] = useState<number | null>(null);
  const viewport = useVisualViewport(open);
  const drag = useRef<{
    pointer: number;
    startY: number;
    startHeight: number;
    startSnap: SheetSnap;
    samples: { y: number; t: number }[];
  } | null>(null);

  // Closing: the parent already knows (it set open=false); only the slide-out
  // stays on screen. Reopening during the slide-out simply shows the sheet.
  useLayoutEffect(() => {
    if (wasOpen.current && !open && !reducedMotion()) setExiting(true);
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    if (!exiting) return;
    // The slide-out normally ends with transitionend; a skipped transition must still end.
    const timer = window.setTimeout(() => setExiting(false), 320);
    return () => window.clearTimeout(timer);
  }, [exiting]);

  // A fresh opening starts expanded.
  useLayoutEffect(() => {
    if (!open) return;
    setExiting(false);
    setDragHeight(null);
    if (controlledSnap === undefined) setOwnSnap("full");
    const board = document.querySelector(".lg-board-wrap")?.getBoundingClientRect();
    setBoardBottom(board ? board.bottom : null);
    // Only when opening: a controlled snap may change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The sheet's natural height follows its content (tab switches, new log entries).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () =>
      setNatural(
        (grabRef.current?.offsetHeight ?? 0) + (contentRef.current?.offsetHeight ?? 0) + 1,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (contentRef.current) observer.observe(contentRef.current);
    if (grabRef.current) observer.observe(grabRef.current);
    return () => observer.disconnect();
  }, [open]);

  // Focus in once on open; back to the opener on close. Keyed on `open` only.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    if (openSheets === 0) document.getElementById("root")?.setAttribute("inert", "");
    openSheets += 1;
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !sheetRef.current) return;
      const items = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === sheetRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture: the sheet answers Escape/Tab before the board's key handling.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      openSheets = Math.max(0, openSheets - 1);
      if (openSheets === 0) document.getElementById("root")?.removeAttribute("inert");
      opener?.focus?.({ preventScroll: true });
    };
  }, [open]);

  const maxHeight = Math.max(MIN_PEEK, Math.round(viewport.height * 0.9) - 8);
  const fullHeight = Math.min(maxHeight, natural || maxHeight);
  const peekHeight = Math.max(
    MIN_PEEK,
    Math.min(
      fullHeight,
      boardBottom !== null && boardBottom < viewport.height - MIN_PEEK
        ? Math.round(viewport.height - boardBottom - 10)
        : Math.round(viewport.height * 0.45),
    ),
  );
  const hasPeek = peek && fullHeight - peekHeight >= MIN_PEEK_GAP;
  const settled = snap === "peek" && hasPeek ? peekHeight : fullHeight;
  const height = dragHeight ?? settled;

  // Dismissal tells the parent at once: focus returns, the board is live again,
  // and a quick re-open is never swallowed by the exit animation.
  const requestClose = () => closeRef.current();
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = {
      pointer: event.pointerId,
      startY: event.clientY,
      startHeight: height,
      startSnap: snap === "peek" && hasPeek ? "peek" : "full",
      samples: [{ y: event.clientY, t: event.timeStamp }],
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.samples.push({ y: event.clientY, t: event.timeStamp });
    if (current.samples.length > 6) current.samples.shift();
    const raw = current.startHeight - (event.clientY - current.startY);
    // Past the expanded height the sheet resists (rubber band) instead of growing.
    const next = raw > fullHeight ? fullHeight + (raw - fullHeight) * 0.2 : Math.max(0, raw);
    setDragHeight(next);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    setDragHeight(null);
    // Measured from the release itself (state can lag one move behind).
    const delta = event.clientY - current.startY;
    if (Math.abs(delta) < 4) return;
    const released = current.startHeight - delta;
    const first = current.samples[0];
    const last = current.samples[current.samples.length - 1];
    const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
    const fromPeek = current.startSnap === "peek" && hasPeek;
    const lowest = hasPeek ? peekHeight : fullHeight;
    // Flicks: down steps one snap lower (expanded → peek → closed), up expands.
    if (velocity >= FLICK_DOWN) {
      if (!fromPeek && hasPeek && released > peekHeight * DISMISS_FRACTION) setSnap("peek");
      else requestClose();
      return;
    }
    if (velocity <= FLICK_UP) return setSnap("full");
    // Slow drags: by direction and distance, like a native sheet — a deliberate
    // pull down rests at peek; well below the peek height closes it.
    if (released < lowest * DISMISS_FRACTION) return requestClose();
    if (!fromPeek && hasPeek && delta >= SNAP_DISTANCE) return setSnap("peek");
    if (fromPeek && delta <= -SNAP_DISTANCE) return setSnap("full");
    setSnap(fromPeek ? "peek" : "full");
  };

  if (!open && !exiting) return null;
  const state = !open ? "closing" : dragHeight !== null ? "dragging" : "open";
  return createPortal(
    <div
      className={`lg-sheet-backdrop is-${snap === "peek" && hasPeek ? "peek" : "full"}`}
      data-state={state}
      inert={!open}
    >
      {/* The empty area above the sheet closes it; the tap stops here and
          never reaches the board. Keyboard: Escape. */}
      <button
        type="button"
        className="lg-sheet-dismiss"
        tabIndex={-1}
        aria-label={t("live.picker.close")}
        onClick={requestClose}
      />
      <div
        ref={sheetRef}
        className={`lg-sheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-state={state}
        data-snap={snap === "peek" && hasPeek ? "peek" : "full"}
        style={{ height, maxHeight: maxHeight + 40, bottom: viewport.inset }}
        onTransitionEnd={(event) => {
          if (!open && event.target === event.currentTarget && event.propertyName === "transform")
            setExiting(false);
        }}
      >
        <div
          ref={grabRef}
          className="lg-sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="lg-sheet-handle" aria-hidden="true" />
          <h2 id={titleId}>{title}</h2>
        </div>
        <div className="lg-sheet-body">
          <div ref={contentRef} className="lg-sheet-content">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A destructive confirmation as a bottom sheet: the consequence, then the red action and Cancel. */
export function ConfirmBottomSheet({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onCancel} peek={false}>
      <p className="lg-sheet-text">{consequence}</p>
      <div className="lg-sheet-actions">
        <button type="button" className="lg-btn lg-btn-danger" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="lg-btn" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </BottomSheet>
  );
}

/** A short-text prompt (rename) as a bottom sheet. */
export function PromptBottomSheet({
  open,
  title,
  label,
  initialValue,
  submitLabel,
  cancelLabel,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  cancelLabel: string;
  onCancel(): void;
  onSubmit(value: string): void;
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onCancel} peek={false}>
      <form
        className="lg-sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          const value = String(new FormData(event.currentTarget).get("value") ?? "").trim();
          if (value) onSubmit(value);
        }}
      >
        <label className="lg-sheet-field">
          <span>{label}</span>
          <input name="value" defaultValue={initialValue} autoComplete="off" />
        </label>
        <div className="lg-sheet-actions">
          <button type="submit" className="lg-btn lg-btn-primary">
            {submitLabel}
          </button>
          <button type="button" className="lg-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
