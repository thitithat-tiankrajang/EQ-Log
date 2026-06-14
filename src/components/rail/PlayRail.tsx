import type { GameState, TileInstance } from "../../game";
import { PanelHeading } from "../layout/PanelHeading";
import { Tilebag } from "../board/Tilebag";

export function PlayRail({
  tilebag,
  tilebagCount,
  tilebagDisabled,
  onPickTile,
}: {
  game: GameState;
  tilebag: TileInstance[];
  tilebagCount?: number;
  tilebagDisabled: boolean;
  onPickTile: (tile: TileInstance) => void;
}) {
  return (
    <aside className="play-rail">
      <section className="tilebag-panel rail-panel">
        <PanelHeading title="Tilebag" detail={`${tilebagCount ?? tilebag.length} tiles`} />
        <Tilebag disabled={tilebagDisabled} tilebag={tilebag} onPick={onPickTile} />
      </section>
    </aside>
  );
}
