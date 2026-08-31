import type { GameState, TileInstance } from "../../game";
import type { TilebagCountKind, TilebagListKind } from "../../gameplay/tilebag";
import { TILEBAG_COUNT_LABELS } from "../../uiText";
import { PanelHeading } from "../layout/PanelHeading";
import { Tilebag } from "../board/Tilebag";

export function PlayRail({
  tilebag,
  tilebagCount,
  /** What the number means — see `TilebagView.kind`. The heading is its label,
   *  so it can never claim "Tilebag" over a count that is not the bag. */
  tilebagKind,
  tilebagListKind,
  tilebagDisabled,
  onPickTile,
}: {
  game: GameState;
  tilebag: TileInstance[];
  tilebagCount?: number;
  tilebagKind: TilebagCountKind;
  tilebagListKind: TilebagListKind;
  tilebagDisabled: boolean;
  onPickTile: (tile: TileInstance) => void;
}) {
  return (
    <aside className="play-rail">
      <section className="tilebag-panel rail-panel">
        <PanelHeading
          title={TILEBAG_COUNT_LABELS[tilebagKind]}
          detail={`${tilebagCount ?? tilebag.length} tiles`}
        />
        <Tilebag
          disabled={tilebagDisabled}
          listKind={tilebagListKind}
          tilebag={tilebag}
          onPick={onPickTile}
        />
      </section>
    </aside>
  );
}
