// ── Local, non-authoritative interaction state ───────────────────────────────
//
// Everything a player does before committing — picking up a tile, dropping it
// on a square, choosing a blank's face, selecting tiles to exchange, reordering
// a rack — happens here.
//
// A draft REFERENCES tiles by ordinal. It never moves them. While a draft holds
// eight tiles "on the board", the canonical inventory still has all eight on
// that player's rack, because nothing has been committed yet. This is the
// difference between a tile being staged and a tile having physically moved,
// and keeping it explicit is what stops a half-composed turn from ever being
// mistaken for game state — by this client, by a spectator, or by persistence.
//
// A draft is also scoped: it belongs to one game, one revision, one side. The
// moment the canonical state moves past it, `draftAppliesTo` reports false and
// the draft is discarded rather than reinterpreted against a board it was not
// composed on.

import type { CanonicalState } from "./canonical";
import { type Side, rackOrder } from "./inventory";
import { type TileOrdinal, tokenAcceptsAssignment, tokenOfOrdinal } from "./tiles";

export type DraftMode = "none" | "place" | "exchange" | "pass";

export type DraftPlacement = {
  ordinal: TileOrdinal;
  row: number;
  col: number;
  /** Face chosen for a blank or choice tile; undefined until the player picks. */
  assigned?: string;
  /** Which rack slot the tile came from, so it can go back where it was. */
  rackSlot?: number;
};

export type Draft = {
  readonly gameId: string;
  /** The revision this draft was composed against. */
  readonly baseRevision: number;
  readonly turnNumber: number;
  readonly side: Side;
  readonly mode: DraftMode;
  readonly placements: readonly DraftPlacement[];
  readonly exchangeOrdinals: readonly TileOrdinal[];
  readonly selectedRackOrdinal: TileOrdinal | null;
  readonly selectedPlacedOrdinal: TileOrdinal | null;
};

export function emptyDraft(state: CanonicalState, side: Side): Draft {
  return {
    gameId: state.gameId,
    baseRevision: state.revision,
    turnNumber: state.turnNumber,
    side,
    mode: "none",
    placements: [],
    exchangeOrdinals: [],
    selectedRackOrdinal: null,
    selectedPlacedOrdinal: null,
  };
}

export function isEmptyDraft(draft: Draft): boolean {
  return (
    draft.mode === "none" && draft.placements.length === 0 && draft.exchangeOrdinals.length === 0
  );
}

/**
 * Whether a draft still describes a turn that can be played.
 *
 * A draft composed against revision N is meaningful at revision N+1 only if
 * nothing about whose turn it is has changed — the player may have refilled or
 * the opponent may have done nothing at all. Any change of game, turn or side
 * invalidates it outright.
 */
export function draftAppliesTo(draft: Draft, state: CanonicalState): boolean {
  return (
    draft.gameId === state.gameId &&
    draft.turnNumber === state.turnNumber &&
    draft.side === state.activeSide &&
    state.status === "playing"
  );
}

/** Tiles the draft is holding out of the rack for display purposes. */
export function stagedOrdinals(draft: Draft): TileOrdinal[] {
  return draft.mode === "place" ? draft.placements.map((placement) => placement.ordinal) : [];
}

/**
 * The rack as the player sees it while composing: the canonical rack minus the
 * tiles currently staged on the board. The canonical rack itself is unchanged.
 */
export function visibleRack(
  state: CanonicalState,
  draft: Draft | null,
  side: Side,
): TileOrdinal[] {
  const rack = rackOrder(state.inventory, side);
  if (!draft || !draftAppliesTo(draft, state) || draft.side !== side) return rack;
  const staged = new Set(stagedOrdinals(draft));
  return rack.filter((ordinal) => !staged.has(ordinal));
}

export type DraftProblem = string;

/**
 * Structural checks a draft must pass before it can become a command. Rules
 * checks (does it form a valid equation, does it connect, does it score) belong
 * to the rules engine; this only proves the draft describes a physically
 * possible move by this player right now.
 */
export function draftProblems(draft: Draft, state: CanonicalState): DraftProblem[] {
  const problems: DraftProblem[] = [];
  if (!draftAppliesTo(draft, state)) {
    problems.push("This draft belongs to a turn that has already moved on.");
    return problems;
  }
  const rack = new Set(rackOrder(state.inventory, draft.side));
  const seen = new Set<TileOrdinal>();
  const squares = new Set<string>();

  const stakeTile = (ordinal: TileOrdinal, what: string) => {
    if (!rack.has(ordinal)) {
      problems.push(`A ${what} names a tile that is not on rack ${draft.side}.`);
      return;
    }
    if (seen.has(ordinal)) {
      problems.push(`A tile is used twice in the same ${what}.`);
      return;
    }
    seen.add(ordinal);
  };

  if (draft.mode === "place") {
    for (const placement of draft.placements) {
      stakeTile(placement.ordinal, "placement");
      const square = `${placement.row}:${placement.col}`;
      if (squares.has(square)) {
        problems.push(`Two tiles are staged on square (${placement.row}, ${placement.col}).`);
      }
      squares.add(square);
      const token = tokenOfOrdinal(placement.ordinal);
      if (tokenAcceptsAssignment(token) && placement.assigned === undefined) {
        problems.push(`A "${token}" tile still needs a face.`);
      }
      if (!tokenAcceptsAssignment(token) && placement.assigned !== undefined) {
        problems.push(`A fixed "${token}" tile cannot be given a face.`);
      }
    }
  }

  if (draft.mode === "exchange") {
    for (const ordinal of draft.exchangeOrdinals) stakeTile(ordinal, "exchange");
    if (draft.exchangeOrdinals.length === 0) {
      problems.push("An exchange must give up at least one tile.");
    }
  }

  return problems;
}
