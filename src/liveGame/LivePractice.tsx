import { useCallback, useMemo, useState } from "react";
import "./shell/live-shell.css";
import type { RankedTurnView } from "../features/ranked/publicView";
import {
  tileNeedsAssignment,
  validateMove,
  type PendingPlacement,
  type TileInstance,
} from "../game";
import { RACK_SIZE } from "../constants/gameRules";
import { Sheet } from "../components/ui/Sheet";
import { LiveBoard, type OpponentTentative } from "./shell/LiveBoard";
import { LiveRack } from "./shell/LiveRack";
import { FacePicker } from "./shell/FacePicker";

const NONE: OpponentTentative[] = [];
const NO_MARKS = new Set<string>();

/** A disposable draft of the authorized before-board and ONE own rack. No
 * canonical decoder, opponent rack, bag, draws, persistence or live mutation. */
export function LivePractice({
  log,
  onClose,
  onSubmit,
  busy = false,
}: {
  log: RankedTurnView;
  onClose(): void;
  onSubmit?(placements: PendingPlacement[]): void;
  busy?: boolean;
}) {
  const [placements, setPlacements] = useState<PendingPlacement[]>([]);
  const [selected, setSelected] = useState<TileInstance | null>(null);
  const [pickerId, setPickerId] = useState<string | null>(null);
  const board = log.boardBefore!;
  const validation = validateMove(board, placements);
  const onCellClick = useCallback(
    (row: number, col: number) => {
      if (board[row][col]) return;
      const existing = placements.find((p) => p.row === row && p.col === col);
      if (existing) {
        // An alternative tile opens its value picker; any other tile goes back.
        if (tileNeedsAssignment(existing.tile.token))
          setPickerId((id) => (id === existing.tile.id ? null : existing.tile.id));
        else setPlacements((current) => current.filter((p) => p !== existing));
        return;
      }
      setPickerId(null);
      if (!selected) return;
      setSelected(null);
      setPlacements((current) => [...current, { tile: selected, row, col }]);
      if (tileNeedsAssignment(selected.token)) setPickerId(selected.id);
    },
    [board, placements, selected],
  );
  const picking = placements.find((p) => p.tile.id === pickerId) ?? null;
  const noop = useCallback(() => undefined, []);
  const players = useMemo(() => ({ A: "A", B: "B" }), []);
  const slots = Array.from({ length: RACK_SIZE }, (_, index) => {
    const tile = log.rackBefore?.[index] ?? null;
    const staged = tile && placements.some((p) => p.tile.id === tile.id);
    return staged ? { tile: null, exposed: tile } : { tile, exposed: null };
  });
  return (
    <Sheet open title="Own-rack live practice" closeLabel="Close practice" onClose={onClose}>
      <section className="lg-practice">
        <div className="lg-practice-head">
          <h2>Practice T{log.turnNumber}</h2>
        </div>
        <p className="live-tool-note">
          This draft uses your historical rack and the public board. Replacement draws are
          unavailable while the game is live.
        </p>
        <div className="lg-practice-board">
          <LiveBoard
            board={board}
            placements={placements}
            opponentTentative={NONE}
            lastMove={NO_MARKS}
            lastMoveSide={null}
            cursor={null}
            arrow="none"
            selectedPendingId={null}
            players={players}
            yourSide={log.side}
            score={null}
            labels={false}
            onCellClick={onCellClick}
            onCellFocus={noop}
          />
        </div>
        {picking && (
          <FacePicker
            tile={{ ...picking.tile, assignedToken: picking.assignedToken }}
            placement="inline"
            anchor={null}
            boardCells={15}
            onChoose={(face) => {
              setPlacements((current) =>
                current.map((p) =>
                  p.tile.id === picking.tile.id ? { ...p, assignedToken: face } : p,
                ),
              );
              setPickerId(null);
            }}
            onClose={() => setPickerId(null)}
          />
        )}
        <LiveRack
          slots={slots}
          active
          mode="none"
          selectedTileId={selected?.id ?? null}
          exchangeIds={[]}
          label="Practice rack"
          onTileClick={(tile) => setSelected(tile)}
          onSlotClick={(index) => {
            const exposed = slots[index]?.exposed;
            if (exposed) {
              setPlacements((current) => current.filter((p) => p.tile.id !== exposed.id));
              if (pickerId === exposed.id) setPickerId(null);
            }
          }}
          onMove={noop}
        />
        <p className="live-tool-note" role="status">
          {validation.isValid
            ? `Valid draft · ${validation.score} points`
            : validation.errors.join(" · ")}
        </p>
        <div className="live-tool-actions">
          <button
            type="button"
            className="lg-btn"
            onClick={() => {
              setPlacements([]);
              setSelected(null);
            }}
          >
            Clear practice draft
          </button>
          {onSubmit && (
            <button
              type="button"
              className="lg-btn lg-btn-primary"
              disabled={busy || !validation.isValid}
              onClick={() => onSubmit(placements)}
            >
              Submit puzzle placement
            </button>
          )}
        </div>
      </section>
    </Sheet>
  );
}
