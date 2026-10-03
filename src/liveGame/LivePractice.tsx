import { useCallback, useMemo, useState } from "react";
import "./shell/live-shell.css";
import type { RankedTurnView } from "../features/ranked/publicView";
import {
  getAssignmentOptions,
  validateMove,
  type PendingPlacement,
  type TileInstance,
} from "../game";
import { RACK_SIZE } from "../constants/gameRules";
import { Sheet } from "../components/ui/Sheet";
import { LiveBoard, type OpponentTentative } from "./shell/LiveBoard";
import { LiveRack } from "./shell/LiveRack";

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
  const board = log.boardBefore!;
  const validation = validateMove(board, placements);
  const onCellClick = useCallback(
    (row: number, col: number) => {
      if (board[row][col]) return;
      setPlacements((current) => {
        const existing = current.find((p) => p.row === row && p.col === col);
        if (existing) return current.filter((p) => p !== existing);
        if (!selected) return current;
        setSelected(null);
        return [
          ...current,
          { tile: selected, row, col, assignedToken: getAssignmentOptions(selected.token)[0] },
        ];
      });
    },
    [board, selected],
  );
  const onEditFace = useCallback(
    (id: string) =>
      setPlacements((current) =>
        current.map((p) => {
          if (p.tile.id !== id) return p;
          const options = getAssignmentOptions(p.tile.token);
          return {
            ...p,
            assignedToken: options[(options.indexOf(p.assignedToken ?? "") + 1) % options.length],
          };
        }),
      ),
    [],
  );
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
            placing={false}
            selectedPendingId={null}
            players={players}
            yourSide={log.side}
            score={null}
            labels={false}
            onCellClick={onCellClick}
            onCellFocus={noop}
            onEditFace={onEditFace}
          />
        </div>
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
            if (exposed)
              setPlacements((current) => current.filter((p) => p.tile.id !== exposed.id));
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
