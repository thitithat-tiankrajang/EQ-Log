import type { GameState, TileInstance } from "../game";
import { PanelHeading } from "./PanelHeading";
import { Tilebag } from "./Tilebag";

export function PlayRail({
  tilebag,
  tilebagDisabled,
  onPickTile,
}: {
  game: GameState;
  tilebag: TileInstance[];
  tilebagDisabled: boolean;
  onPickTile: (tile: TileInstance) => void;
}) {
  return (
    <aside className="play-rail">
      <section className="tilebag-panel rail-panel">
        <PanelHeading title="Tilebag" detail={`${tilebag.length} tiles`} />
        <Tilebag disabled={tilebagDisabled} tilebag={tilebag} onPick={onPickTile} />
      </section>
    </aside>
  );
}
