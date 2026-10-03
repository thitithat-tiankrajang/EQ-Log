import { useEffect, useRef, type CSSProperties } from "react";
import { X } from "lucide-react";
import { getAssignmentOptions, type TileInstance } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import { Glyph, normalizeFace } from "./TileGlyph";

/**
 * Direct choice of an alternative tile's value: one tap, never cycling.
 *
 *  +/−, ×/÷   two large buttons
 *  blank      every legal value at once (0–9, 10–20, + − × ÷ =)
 *
 * Not a modal: the board stays visible and usable. On desktop it is anchored
 * beside the tile; on a phone it docks over the rack/actions area, where
 * buttons can be thumb-sized. Escape or the close button dismisses it; tapping
 * elsewhere on the board also closes it (the turn draft owns that).
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
  const style =
    anchor && placement === "anchor"
      ? ({ "--r": anchor.row, "--c": anchor.col, "--cols": columns } as CSSProperties)
      : ({ "--cols": columns } as CSSProperties);
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
      <div className="lg-picker-head">
        <strong>{blank ? t("live.picker.blank") : t("live.picker.choice")}</strong>
        <button
          type="button"
          className="lg-picker-close"
          aria-label={t("live.picker.close")}
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
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
              <Glyph face={face} />
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
