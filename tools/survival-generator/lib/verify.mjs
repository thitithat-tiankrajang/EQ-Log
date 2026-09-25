// Cross-check a simulated placement against the LIVE game's rules.
//
// The simulator scores moves with the bot-lab environment. Survival levels are
// played in EQ-Lab, whose `validateMove` is the rule that actually decides a
// player's move. Every placement the generator applies is re-validated here;
// any disagreement in legality or score is reported, never smoothed over.
import { tileNeedsAssignment, validateMove } from "../.vendor/eqlab-rules.mjs";

const SIZE = 15;

function tileOf(id, kind, face) {
  return tileNeedsAssignment(kind) ? { id, token: kind, assignedToken: face } : { id, token: kind };
}

/** `state` is the position BEFORE the move; `envScore` is what the simulator awarded. */
export function verifyPlacement(state, action, envScore) {
  const board = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => null));
  state.board.forEach((cell, index) => {
    if (!cell) return;
    board[Math.floor(index / SIZE)][index % SIZE] = {
      tile: tileOf(cell.tileId, cell.kind, cell.face),
      side: cell.side,
      placedTurn: cell.turn,
    };
  });
  const pending = action.placements.map((p) => ({
    tile: { id: p.tileId, token: p.kind },
    row: Math.floor(p.cell / SIZE),
    col: p.cell % SIZE,
    ...(tileNeedsAssignment(p.kind) ? { assignedToken: p.face } : {}),
  }));
  const result = validateMove(board, pending);
  return {
    ok: result.isValid && result.score === envScore,
    valid: result.isValid,
    eqlabScore: result.score,
    envScore,
    errors: result.errors,
  };
}
