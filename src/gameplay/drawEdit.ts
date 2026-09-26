// A host changing what the app drew, without inventing a tile.
//
// In an app-draws ("play") game the rack is refilled from a shuffled queue at the end of each
// turn. A host running the game sometimes needs a particular rack instead — to set up a
// position, to replay a real game's draws, to test a line. The one rule this module exists to
// keep is that the rack the host ends up with must be one the BAG COULD HAVE DEALT:
//
//   * only the tiles that arrived in the latest draw can change. A tile that was already in hand
//     before that draw was known when the previous move was chosen; changing it would rewrite a
//     turn that has already been played;
//   * a replaced tile goes back into the bag, exactly as if it had never been drawn;
//   * a replacement must come out of the bag AS IT WAS AT THE MOMENT OF THAT DRAW, and still be
//     in it now. That excludes the tiles this side just exchanged away (they were in its hand,
//     not the bag, when it drew) and anything the opponent exchanged back in since (likewise).
//     Tiles the opponent drew since are simply no longer in the bag.
//
// Every one of those facts is already in the logs: a play-mode turn is logged BEFORE its refill,
// so the side's latest log holds the rack it kept (`rackAfter`) and the bag it drew from
// (`tilebagAfter`). Nothing has to be remembered beside the game to know what may be edited —
// which is why a reload, or a second device, reaches the same answer.
import { AMATH_TOKENS, type AmathToken } from "../constants/tileDefinitions";
import {
  getRack,
  getTileDrawMode,
  setRack,
  shuffleTilebagQueue,
  type DrawEdit,
  type GameState,
  type Side,
  type TileInstance,
} from "../game";

export type { DrawEdit };

export type DrawEditWindow = {
  side: Side;
  turnNumber: number;
  /** Tiles in hand that arrived in the latest draw — the only ones that may change. */
  drawnIds: ReadonlySet<string>;
  /** Tiles in hand from before that draw. */
  heldIds: ReadonlySet<string>;
  /** Tiles now in the bag that the draw could have produced. */
  candidates: TileInstance[];
};

function latestOwnLog(game: GameState, side: Side) {
  for (let index = game.logs.length - 1; index >= 0; index -= 1) {
    const log = game.logs[index];
    if (log.action === "end_game") continue;
    if (log.side === side) return log;
  }
  return null;
}

/**
 * What the host may change right now, or `null` when nothing may.
 *
 * Open only on an app-draws game, in the active side's own turn before it has acted. A position
 * whose logs do not account for the rack in hand (an edited board, say) is closed rather than
 * guessed at: guessing is exactly how a tile gets invented.
 */
export function drawEditWindow(game: GameState): DrawEditWindow | null {
  if (getTileDrawMode(game) !== "play") return null;
  if (game.status !== "playing" || game.phase !== "choose_action") return null;
  const side = game.activeSide;
  const rack = getRack(game, side);
  const own = latestOwnLog(game, side);
  if (own && own.turnNumber >= game.turnNumber) return null; // already acted this turn

  // Before this side's first move its whole rack is the opening deal, dealt from the bag as it
  // stood before anybody drew: the first logged turn's bag, or the bag itself if nobody has moved.
  const kept = own ? own.rackAfter : [];
  const bagAtDraw = own ? own.tilebagAfter : (game.logs[0]?.tilebagBefore ?? game.tilebag);

  const rackIds = new Set(rack.map((tile) => tile.id));
  const heldIds = new Set(kept.map((tile) => tile.id));
  for (const id of heldIds) if (!rackIds.has(id)) return null;

  const drawnIds = new Set(rack.filter((tile) => !heldIds.has(tile.id)).map((tile) => tile.id));
  if (drawnIds.size === 0) return null;
  const drawable = new Set(bagAtDraw.map((tile) => tile.id));
  if (own) {
    // Every drawn tile must have come from that bag; if one did not, the logs are not this rack's.
    for (const id of drawnIds) if (!drawable.has(id)) return null;
  } else {
    // The opening deal left the bag before `logs[0]` was taken, so it is added back by hand.
    for (const id of drawnIds) drawable.add(id);
  }

  return {
    side,
    turnNumber: game.turnNumber,
    drawnIds,
    heldIds,
    candidates: game.tilebag.filter((tile) => drawable.has(tile.id)),
  };
}

/** Candidates grouped by face, in tile-set order (0–20, operators, =, blank), for the host's panel. */
export function candidateCounts(open: DrawEditWindow): { token: AmathToken; count: number }[] {
  const counts = new Map<AmathToken, number>();
  for (const tile of open.candidates) counts.set(tile.token, (counts.get(tile.token) ?? 0) + 1);
  return (Object.keys(AMATH_TOKENS) as AmathToken[])
    .filter((token) => counts.has(token))
    .map((token) => ({ token, count: counts.get(token)! }));
}

/** The edits recorded for one side's turn. */
export function drawEditsFor(game: GameState, turnNumber: number, side: Side): DrawEdit[] {
  return (game.drawEdits ?? []).filter(
    (edit) => edit.turnNumber === turnNumber && edit.side === side,
  );
}

export type DrawEditResult =
  | { ok: true; game: GameState; outgoing: TileInstance; incoming: TileInstance }
  | { ok: false; reason: string };

/**
 * Swap a drawn tile for a candidate of `token`.
 *
 * The rack keeps its order — the new tile takes the old one's index — so the slot the host was
 * looking at is the slot that changes. The outgoing tile returns to the bag and the bag is
 * reshuffled, because a play-mode bag is a queue and a tile put back at a known place would be a
 * tile whose next draw is known.
 */
export function replaceDrawnTile(
  game: GameState,
  outgoingId: string,
  token: AmathToken,
): DrawEditResult {
  const open = drawEditWindow(game);
  if (!open) return { ok: false, reason: "ตอนนี้แก้เบี้ยที่หยิบไม่ได้" };
  if (!open.drawnIds.has(outgoingId)) {
    return { ok: false, reason: "เบี้ยนี้อยู่ในมือก่อนการหยิบรอบนี้ แก้ไม่ได้" };
  }
  const rack = getRack(game, open.side);
  const index = rack.findIndex((tile) => tile.id === outgoingId);
  const outgoing = rack[index];
  if (!outgoing) return { ok: false, reason: "ไม่พบเบี้ยในมือ" };
  if (outgoing.token === token) return { ok: false, reason: "same" };

  // Prefer the tile this slot was originally dealt when the host is asking for it back, so an
  // edit that is undone leaves no trace.
  const original = drawEditsFor(game, open.turnNumber, open.side).find(
    (edit) => edit.toId === outgoingId,
  );
  const incoming =
    (original && original.from === token
      ? open.candidates.find((tile) => tile.id === original.fromId)
      : undefined) ?? open.candidates.find((tile) => tile.token === token);
  if (!incoming) return { ok: false, reason: `ไม่มี ${token} ในเบี้ยที่หยิบได้` };

  const nextRack = rack.slice();
  nextRack[index] = { id: incoming.id, token: incoming.token };
  const nextBag = shuffleTilebagQueue([
    ...game.tilebag.filter((tile) => tile.id !== incoming.id),
    { id: outgoing.id, token: outgoing.token },
  ]);

  return {
    ok: true,
    game: setRack(
      {
        ...game,
        tilebag: nextBag,
        drawEdits: recordEdit(game.drawEdits ?? [], {
          turnNumber: open.turnNumber,
          side: open.side,
          fromId: outgoing.id,
          from: outgoing.token,
          toId: incoming.id,
          to: incoming.token,
        }),
        lastSavedAt: new Date().toISOString(),
      },
      open.side,
      nextRack,
    ),
    outgoing,
    incoming,
  };
}

/**
 * Put the originally drawn tile back in a slot the host changed this turn.
 *
 * `null` when the slot was never changed — there is nothing to go back to.
 */
export function revertDrawnTile(game: GameState, tileId: string): DrawEditResult | null {
  const open = drawEditWindow(game);
  if (!open) return null;
  const edit = drawEditsFor(game, open.turnNumber, open.side).find(
    (candidate) => candidate.toId === tileId,
  );
  if (!edit) return null;
  return replaceDrawnTile(game, tileId, edit.from);
}

/**
 * Add one swap to the record, folding chains: 5 → 1 then 1 → 18 is one edit, 5 → 18, and a
 * swap back to what was dealt removes the edit entirely.
 */
function recordEdit(edits: DrawEdit[], next: DrawEdit): DrawEdit[] | undefined {
  const chained = edits.find(
    (edit) =>
      edit.turnNumber === next.turnNumber && edit.side === next.side && edit.toId === next.fromId,
  );
  const rest = edits.filter((edit) => edit !== chained);
  const merged = chained ? { ...chained, toId: next.toId, to: next.to } : next;
  const result = merged.fromId === merged.toId ? rest : [...rest, merged];
  return result.length > 0 ? result : undefined;
}
