import type { ActionType, GameState, MoveValidation, PendingPlacement, Side, TileInstance } from "../game";
import { PanelHeading } from "./PanelHeading";
import { Tilebag } from "./Tilebag";
import { LiveMoveAid } from "./LiveMoveAid";

type ActionMode = "none" | ActionType;

type RackConfig = {
  active: boolean;
  exchangeOutgoingIds: string[];
  label: string;
  rack: TileInstance[];
  side: Side;
};

export function PlayRail({
  game,
  tilebag,
  tilebagDisabled,
  onPickTile,
  rackConfigs,
  selectedRackTileId,
  onRackTileClick,
  actionMode,
  activeRackCount,
  refillNeeded,
  selectedTile,
  pendingPlacements,
  validation,
  exchangeCounts,
  reviewing,
}: {
  game: GameState;
  tilebag: TileInstance[];
  tilebagDisabled: boolean;
  onPickTile: (tile: TileInstance) => void;
  rackConfigs: RackConfig[];
  selectedRackTileId: string | null;
  onRackTileClick: (tile: TileInstance, side: Side) => void;
  actionMode: ActionMode;
  activeRackCount: number;
  refillNeeded: boolean;
  selectedTile?: TileInstance;
  pendingPlacements: PendingPlacement[];
  validation: MoveValidation;
  exchangeCounts: { outgoing: number; incoming: number };
  reviewing: boolean;
}) {
  return (
    <aside className="play-rail">
      <section className="tilebag-panel rail-panel">
        <PanelHeading title="Tilebag" detail={`${tilebag.length} tiles`} />
        <Tilebag disabled={tilebagDisabled} tilebag={tilebag} onPick={onPickTile} />
      </section>

      <LiveMoveAid
        actionMode={actionMode}
        activeRackCount={activeRackCount}
        exchangeCounts={exchangeCounts}
        game={game}
        pendingPlacements={pendingPlacements}
        refillNeeded={refillNeeded}
        reviewing={reviewing}
        selectedTile={selectedTile}
        validation={validation}
      />
    </aside>
  );
}
