import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { RACK_SIZE } from "../../constants/gameRules";
import { displayToken, tilePoint, type TileInstance } from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import { LiveTile } from "./LiveBoard";
import type { DraftMode, RackSlot } from "./useTurnDraft";

/**
 * The player's rack: at most eight tiles, every face and point value legible.
 * Reordering works in every seated state — ACTIVE, THINKING, paused — by drag,
 * by selecting two tiles, or with Alt+← / Alt+→ on a focused tile. Only placing
 * a tile on the board, Exchange and Pass need the turn.
 */
export function LiveRack({
  slots,
  active,
  mode,
  selectedTileId,
  exchangeIds,
  hiddenCount,
  label,
  onTileClick,
  onSlotClick,
  onMove,
}: {
  slots: RackSlot[];
  /** ACTIVE: tiles may go to the board. */
  active: boolean;
  mode: DraftMode;
  selectedTileId: string | null;
  exchangeIds: string[];
  /** Closed slots for a replayed opponent turn; no tile identities are supplied. */
  hiddenCount?: number;
  label: string;
  onTileClick(tile: TileInstance): void;
  onSlotClick(index: number): void;
  onMove(from: number, to: number): void;
}) {
  const { t } = useLocale();
  const [focus, setFocus] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const tileCount = hiddenCount ?? slots.filter((slot) => slot.tile || slot.exposed).length;
  const focusSlot = (index: number) =>
    window.requestAnimationFrame?.(() =>
      listRef.current?.querySelector<HTMLElement>(`[data-rack-slot="${index}"]`)?.focus(),
    );

  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const step = event.key === "ArrowLeft" ? -1 : 1;
    const target = index + step;
    if (target < 0 || target >= RACK_SIZE) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.altKey && slots[index]?.tile) onMove(index, target);
    setFocus(target);
    focusSlot(target);
  };

  if (hiddenCount !== undefined)
    return (
      <div className="lg-rack is-closed" role="group" aria-label={label}>
        {Array.from({ length: RACK_SIZE }, (_, index) => (
          <span key={index} className="lg-rack-slot">
            {index < hiddenCount && <span className="lg-tile-back" aria-hidden="true" />}
          </span>
        ))}
        <span className="lg-visually-hidden">{t("live.rack.closed")}</span>
      </div>
    );

  return (
    <div
      className={`lg-rack${active ? " is-active" : ""}${mode === "exchange" ? " is-exchange" : ""}`}
      role="group"
      aria-label={`${label} · ${tileCount}/${RACK_SIZE}`}
      aria-describedby="lg-rack-help"
      ref={listRef}
    >
      {slots.map((slot, index) => {
        const tile = slot.tile;
        const marked = tile ? exchangeIds.includes(tile.id) : false;
        const selected = tile?.id === selectedTileId;
        const name = tile
          ? `${t("live.rack.slot", { index: index + 1 })}: ${displayToken(tile)}, ${t(
              "live.board.points",
              {
                count: tilePoint(tile),
              },
            )}${selected ? `, ${t("live.rack.selected")}` : ""}${marked ? `, ${t("live.rack.marked")}` : ""}`
          : slot.exposed
            ? `${t("live.rack.slot", { index: index + 1 })}: ${t("live.rack.onBoard", { tile: displayToken(slot.exposed) })}`
            : `${t("live.rack.slot", { index: index + 1 })}: ${t("live.rack.empty")}`;
        return (
          <span key={tile?.id ?? slot.exposed?.id ?? `slot-${index}`} className="lg-rack-slot">
            <button
              type="button"
              className={`lg-rack-tile${tile ? "" : slot.exposed ? " is-exposed" : " is-empty"}${
                selected ? " is-selected" : ""
              }${marked ? " is-marked" : ""}`}
              tabIndex={index === focus ? 0 : -1}
              aria-label={name}
              aria-pressed={tile ? selected || marked : undefined}
              data-rack-slot={index}
              data-tile-id={tile?.id}
              data-draft-tile-id={tile && mode !== "exchange" ? tile.id : undefined}
              onFocus={() => setFocus(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onClick={() => (tile ? onTileClick(tile) : onSlotClick(index))}
            >
              {tile ? (
                <LiveTile tile={tile} size="rack" />
              ) : slot.exposed ? (
                <span className="lg-exposed-ghost" aria-hidden="true">
                  {displayToken(slot.exposed)}
                </span>
              ) : null}
            </button>
          </span>
        );
      })}
      <span id="lg-rack-help" className="lg-visually-hidden">
        {t("live.rack.help")}
      </span>
    </div>
  );
}
