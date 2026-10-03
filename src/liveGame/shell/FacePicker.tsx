import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { getAssignmentOptions, type TileInstance } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import { FaceArt, normalizeFace } from "./TileGlyph";

/**
 * Direct choice of an alternative tile's value: one tap, never cycling.
 *
 *  +/−, ×/÷   two large buttons
 *  blank      every legal value at once (0–9, 10–20, + − × ÷ =)
 *
 * Not a modal: the board stays visible. On desktop it is anchored beside the
 * tile; on a phone it docks over the rack/actions area, where buttons can be
 * thumb-sized, with a handle: swipe it down to dismiss. There is no close
 * button: Escape, a swipe, or a tap anywhere else closes it — a tap on the
 * board or rack only closes it (the turn draft owns that), never moves a tile.
 */
export function FacePicker({
  tile,
  placement,
  anchor,
  boardCells,
  onChoose,
  onClose,
}: {
  tile: Pick<TileInstance, "id" | "token" | "assignedToken">;
  /** dock: phone, over the rack/actions; anchor: beside the tile; inline: in flow. */
  placement: "dock" | "anchor" | "inline";
  anchor: { row: number; col: number } | null;
  boardCells: number;
  onChoose(face: string): void;
  onClose(): void;
}) {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const options = getAssignmentOptions(tile.token);
  const blank = tile.token === "?";
  const current = tile.assignedToken ? normalizeFace(tile.assignedToken) : null;
  const columns = blank ? 7 : 2;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pull, setPull] = useState(0);
  const swipe = useRef<{ pointer: number; y: number; t: number } | null>(null);

  // A press anywhere outside the picker, the board and the rack closes it.
  // (Board and rack taps close it through the turn draft, without moving.)
  useEffect(() => {
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest || target.closest("[data-face-picker], [data-live-board], .lg-rack"))
        return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);
  const onSwipeDown = (event: PointerEvent<HTMLDivElement>) => {
    swipe.current = { pointer: event.pointerId, y: event.clientY, t: event.timeStamp };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {}
  };
  const onSwipeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (swipe.current?.pointer !== event.pointerId) return;
    setPull(Math.max(0, event.clientY - swipe.current.y));
  };
  const onSwipeEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = swipe.current;
    if (start?.pointer !== event.pointerId) return;
    swipe.current = null;
    const distance = event.clientY - start.y;
    const speed = distance / Math.max(1, event.timeStamp - start.t);
    setPull(0);
    if (distance > 44 || (distance > 12 && speed > 0.6)) onClose();
  };

  // Move focus into the picker so keyboard users can choose at once.
  useEffect(() => {
    const root = ref.current;
    const target =
      root?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      root?.querySelector<HTMLElement>("[data-face]");
    target?.focus({ preventScroll: true });
  }, [tile.id]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>("[data-face]") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? columns
            : event.key === "ArrowUp"
              ? -columns
              : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    buttons[Math.max(0, Math.min(buttons.length - 1, index + step))]?.focus();
  };

  // Arrow keys move between options; Escape closes. Native listener: the
  // dialog container is not itself interactive.
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  useEffect(() => {
    const root = ref.current;
    const listener = (event: KeyboardEvent) => keyRef.current(event);
    root?.addEventListener("keydown", listener);
    return () => root?.removeEventListener("keydown", listener);
  }, []);

  const below = !anchor || anchor.row < boardCells - 5;
  const style = {
    "--cols": columns,
    ...(anchor && placement === "anchor" ? { "--r": anchor.row, "--c": anchor.col } : {}),
    ...(pull ? { transform: `translateY(${pull}px)`, transition: "none" } : {}),
  } as CSSProperties;
  return (
    <div
      ref={ref}
      className={`lg-picker is-${placement}${below ? " is-below" : " is-above"}${
        blank ? " is-blank" : " is-choice"
      }`}
      style={style}
      role="dialog"
      aria-modal="false"
      aria-label={blank ? t("live.picker.blank") : t("live.picker.choice")}
      data-face-picker
    >
      <div
        className="lg-picker-head"
        {...(placement === "dock"
          ? {
              onPointerDown: onSwipeDown,
              onPointerMove: onSwipeMove,
              onPointerUp: onSwipeEnd,
              onPointerCancel: onSwipeEnd,
            }
          : {})}
      >
        {placement === "dock" && <span className="lg-sheet-handle" aria-hidden="true" />}
        <strong>{blank ? t("live.picker.blank") : t("live.picker.choice")}</strong>
      </div>
      <div className="lg-picker-grid" role="group">
        {options.map((option) => {
          const face = normalizeFace(option);
          return (
            <button
              key={option}
              type="button"
              className="lg-picker-option"
              data-face={face}
              aria-pressed={current === face}
              aria-label={t("live.picker.option", { face: spokenFace(face, t) })}
              onClick={() => onChoose(option)}
            >
              <FaceArt face={face} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const SPOKEN = { "+": "plus", "-": "minus", "×": "times", "÷": "divide", "=": "equals" } as const;
/** A face as read aloud: operators by name, numbers as themselves. */
export function spokenFace(face: string, t: ReturnType<typeof useLocale>["t"]) {
  const name = SPOKEN[normalizeFace(face) as keyof typeof SPOKEN];
  return name ? t(`live.glyph.${name}`) : face;
}
