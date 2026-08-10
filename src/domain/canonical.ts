// ── Canonical committed state and the only way to change it ──────────────────
//
// One value is the truth about a live game: `CanonicalState` at revision N.
// Every player, bot, spectator, refreshed tab and late joiner that holds
// revision N holds the same bytes — canonical state is normalized, so equality
// is decidable by comparison instead of by heuristics about who is "ahead".
//
// State changes only through `commit`, which is a pure function:
//
//   commit(state, envelope) -> Committed { state@N+1, event } | Rejected
//
// Properties `commit` guarantees, by construction:
//
//   • ATOMIC        The next state is built as a fresh value and returned only
//                   after the physical invariant has been re-proven on it. A
//                   rejected command yields no state at all, so a partial
//                   transition — some tiles moved, some not — cannot be
//                   observed or persisted.
//   • MONOTONIC     Every accepted command produces exactly revision + 1.
//   • CONDITIONAL   A command names the revision it was composed against.
//                   Composed against a revision that is no longer current, it
//                   is rejected rather than blindly applied.
//   • IDEMPOTENT    A command id that has already been applied is a no-op that
//                   returns the current state. Retries and duplicate delivery
//                   cannot double-apply a physical move.
//   • DETERMINISTIC The reducer reads only its arguments. Replaying the same
//                   ordered events over the same genesis reproduces the state
//                   exactly, on any client.
//
// Local interaction — dragging, selecting, previewing, arranging a rack — is
// deliberately absent from this module. Those live in `draft.ts` and reference
// tiles by ordinal without ever moving them. A tile leaves a player's rack at
// exactly one moment: when a command is committed here.

import { RACK_SIZE } from "../constants/gameRules";
import {
  type Inventory,
  InventoryError,
  type Side,
  type TileMove,
  applyMoves,
  assertInventory,
  bagOrder,
  createInventory,
  normalizeInventory,
  pendingReturnOrder,
  rackOrder,
} from "./inventory";
import { type TileOrdinal, tileIdOf, tokenAcceptsAssignment, tokenOfOrdinal } from "./tiles";

export type GameMode = "versus" | "solo";
export type DrawMode = "manual" | "play";
export type Phase = "refill" | "choose_action" | "perform_action";
export type Status = "playing" | "draft" | "finished";
export type EndReason = "rack_out" | "no_score_streak" | "perfect_game" | "manual" | "surrender";

/** How many recent command ids are remembered for duplicate suppression. A
 *  command older than this window is also older than any retry that could
 *  still be in flight. */
export const COMMAND_MEMORY = 64;

export type CanonicalState = {
  readonly gameId: string;
  /** Monotonic. Genesis is 0; every committed command adds exactly 1. */
  readonly revision: number;
  readonly inventory: Inventory;
  readonly gameMode: GameMode;
  readonly drawMode: DrawMode;
  readonly startingSide: Side;
  readonly turnNumber: number;
  readonly activeSide: Side;
  readonly phase: Phase;
  readonly status: Status;
  readonly scores: Readonly<Record<Side, number>>;
  /** Ids of recently applied commands, oldest first. Duplicate suppression. */
  readonly appliedCommands: readonly string[];
};

// ── Commands ─────────────────────────────────────────────────────────────────

export type PlaceSpec = {
  ordinal: TileOrdinal;
  row: number;
  col: number;
  /** Face chosen for a blank or choice tile. */
  assigned?: string;
};

export type Command =
  /** Manual draw: the player physically picks named tiles out of the bag. */
  | { kind: "draw"; tiles: readonly TileOrdinal[] }
  /** Put hand-picked tiles back before the draw is finished. */
  | { kind: "returnDraw"; tiles: readonly TileOrdinal[] }
  /** Automatic draw: fill the active rack from the head of the bag, then let
   *  this side's exchanged-out tiles re-enter the bag. */
  | { kind: "refill" }
  /** Commit a played equation. `score` is supplied by the caller's rules pass
   *  and recorded; the physical move is owned here. */
  | { kind: "place"; placements: readonly PlaceSpec[]; score: number }
  /** Swap tiles out of the rack. They wait in `pendingReturn` until this side
   *  finishes its next draw, so they cannot be drawn straight back. */
  | { kind: "exchange"; tiles: readonly TileOrdinal[] }
  | { kind: "pass" }
  | { kind: "endGame"; reason: EndReason; scoreAdjustments?: Readonly<Partial<Record<Side, number>>> };

export type CommandEnvelope = {
  /** Stable per intent. Retrying the same intent MUST reuse it. */
  readonly commandId: string;
  /** The revision this command was composed against. */
  readonly expectedRevision: number;
  readonly issuedBy: Side | "host";
  readonly command: Command;
  readonly issuedAt: string;
};

// ── Events ───────────────────────────────────────────────────────────────────

/** An accepted command, in commit order. `revision` is the revision the state
 *  reached BY this event, so events are self-ordering and gap-detectable. */
export type CommittedEvent = {
  readonly revision: number;
  readonly gameId: string;
  readonly commandId: string;
  readonly issuedBy: Side | "host";
  readonly command: Command;
  readonly committedAt: string;
};

export type RejectionReason =
  /** Composed against a revision that is no longer current. */
  | "stale_revision"
  /** The command is not legal in this state. */
  | "illegal"
  /** Applying it would break the physical invariant. Reported, never repaired. */
  | "invariant";

export type Rejected = {
  readonly ok: false;
  readonly reason: RejectionReason;
  readonly message: string;
  readonly details?: readonly string[];
  /** The revision the state is actually at, so a caller can resynchronize. */
  readonly currentRevision: number;
};

export type Accepted = {
  readonly ok: true;
  readonly state: CanonicalState;
  /** Null when the command was recognized as an already-applied duplicate. */
  readonly event: CommittedEvent | null;
  readonly duplicate: boolean;
};

export type CommitResult = Accepted | Rejected;

// ── Genesis ──────────────────────────────────────────────────────────────────

export type GenesisSpec = {
  gameId: string;
  gameMode: GameMode;
  drawMode: DrawMode;
  startingSide: Side;
  /** Draw order of the full physical set: a permutation of all 100 ordinals. */
  bagOrder: readonly TileOrdinal[];
};

export function createCanonicalState(spec: GenesisSpec): CanonicalState {
  const startingSide = spec.gameMode === "solo" ? "A" : spec.startingSide;
  return freezeState({
    gameId: spec.gameId,
    revision: 0,
    inventory: assertInventory(createInventory(spec.bagOrder), "new game"),
    gameMode: spec.gameMode,
    drawMode: spec.drawMode,
    startingSide,
    turnNumber: 1,
    activeSide: startingSide,
    phase: "refill",
    status: "playing",
    scores: { A: 0, B: 0 },
    appliedCommands: [],
  });
}

function freezeState(state: CanonicalState): CanonicalState {
  return Object.freeze({ ...state, scores: Object.freeze({ ...state.scores }) });
}

// ── Commit ───────────────────────────────────────────────────────────────────

export function commit(state: CanonicalState, envelope: CommandEnvelope): CommitResult {
  if (state.appliedCommands.includes(envelope.commandId)) {
    // Already applied. Returning the current state (rather than re-running the
    // command) is what makes at-least-once delivery safe.
    return { ok: true, state, event: null, duplicate: true };
  }
  if (envelope.expectedRevision !== state.revision) {
    return {
      ok: false,
      reason: "stale_revision",
      message: `Command was composed against revision ${envelope.expectedRevision} but the game is at revision ${state.revision}.`,
      currentRevision: state.revision,
    };
  }
  if (state.status === "finished") {
    return {
      ok: false,
      reason: "illegal",
      message: "The game is finished; no further command can change it.",
      currentRevision: state.revision,
    };
  }

  let next: CanonicalState;
  try {
    next = reduce(state, envelope);
  } catch (error) {
    if (error instanceof InventoryError) {
      return {
        ok: false,
        reason: "invariant",
        message: error.message,
        details: error.details,
        currentRevision: state.revision,
      };
    }
    if (error instanceof IllegalCommandError) {
      return {
        ok: false,
        reason: "illegal",
        message: error.message,
        currentRevision: state.revision,
      };
    }
    throw error;
  }

  // Belt and braces: the inventory was already proven inside `applyMoves`, but
  // a transition that never touched a tile still has to leave a lawful state.
  assertInventory(next.inventory, "committed state");

  const committed = freezeState({
    ...next,
    revision: state.revision + 1,
    appliedCommands: Object.freeze(
      [...state.appliedCommands, envelope.commandId].slice(-COMMAND_MEMORY),
    ),
  });

  return {
    ok: true,
    duplicate: false,
    state: committed,
    event: Object.freeze({
      revision: committed.revision,
      gameId: committed.gameId,
      commandId: envelope.commandId,
      issuedBy: envelope.issuedBy,
      command: envelope.command,
      committedAt: envelope.issuedAt,
    }),
  };
}

export class IllegalCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IllegalCommandError";
  }
}

function illegal(message: string): never {
  throw new IllegalCommandError(message);
}

// ── Reducer ──────────────────────────────────────────────────────────────────

function reduce(state: CanonicalState, envelope: CommandEnvelope): CanonicalState {
  const { command } = envelope;
  switch (command.kind) {
    case "draw":
      return reduceDraw(state, command.tiles);
    case "returnDraw":
      return reduceReturnDraw(state, command.tiles);
    case "refill":
      return reduceRefill(state);
    case "place":
      return reducePlace(state, command.placements, command.score);
    case "exchange":
      return reduceExchange(state, command.tiles);
    case "pass":
      return afterAction(state);
    case "endGame":
      return reduceEndGame(state, command.scoreAdjustments);
    default:
      return illegal(`Unknown command "${(command as { kind: string }).kind}".`);
  }
}

function requirePlaying(state: CanonicalState): void {
  if (state.status !== "playing") illegal("The game is not in progress.");
}

function reduceDraw(state: CanonicalState, tiles: readonly TileOrdinal[]): CanonicalState {
  requirePlaying(state);
  if (state.drawMode !== "manual") illegal("This game draws tiles automatically.");
  if (state.phase !== "refill") illegal("Tiles can only be drawn during a refill.");
  if (tiles.length === 0) illegal("A draw must take at least one tile.");

  const side = state.activeSide;
  const rack = rackOrder(state.inventory, side);
  if (rack.length + tiles.length > RACK_SIZE) {
    illegal(`Drawing ${tiles.length} tiles would overfill rack ${side}.`);
  }
  for (const ordinal of tiles) {
    if (state.inventory[ordinal]?.at !== "bag") {
      illegal(`${tileIdOf(ordinal)} is not in the bag and cannot be drawn.`);
    }
  }

  let seq = rack.length;
  const moves: TileMove[] = tiles.map((ordinal) => ({
    ordinal,
    to: { at: "rack", side, seq: seq++ },
  }));
  const inventory = applyMoves(state.inventory, moves, "draw");
  return settleDraw({ ...state, inventory });
}

function reduceReturnDraw(state: CanonicalState, tiles: readonly TileOrdinal[]): CanonicalState {
  requirePlaying(state);
  if (state.drawMode !== "manual") illegal("This game draws tiles automatically.");
  if (state.phase !== "refill") illegal("Tiles can only be put back during a refill.");

  const side = state.activeSide;
  let seq = bagOrder(state.inventory).length;
  const moves: TileMove[] = tiles.map((ordinal) => {
    const placement = state.inventory[ordinal];
    if (placement?.at !== "rack" || placement.side !== side) {
      illegal(`${tileIdOf(ordinal)} is not on rack ${side} and cannot be put back.`);
    }
    return { ordinal, to: { at: "bag", seq: seq++ } } satisfies TileMove;
  });
  const inventory = applyMoves(state.inventory, moves, "return draw");
  return { ...state, inventory, phase: "refill" };
}

function reduceRefill(state: CanonicalState): CanonicalState {
  requirePlaying(state);
  if (state.phase !== "refill") illegal("The active side is not refilling.");

  const side = state.activeSide;
  const rack = rackOrder(state.inventory, side);
  const bag = bagOrder(state.inventory);
  const needed = Math.max(0, RACK_SIZE - rack.length);
  const drawn = bag.slice(0, needed);

  let rackSeq = rack.length;
  const moves: TileMove[] = drawn.map((ordinal) => ({
    ordinal,
    to: { at: "rack", side, seq: rackSeq++ },
  }));

  const inventory = applyMoves(state.inventory, moves, "refill");
  return settleDraw({ ...state, inventory });
}

/**
 * Close out a draw.
 *
 * The refill ends once the rack is full or the bag is empty, and only then do
 * this side's exchanged-out tiles rejoin the bag — the physical rule that you
 * cannot draw straight back what you just gave up. Both the hand-picked and the
 * automatic draw funnel through here so the two modes cannot drift apart.
 */
function settleDraw(state: CanonicalState): CanonicalState {
  const side = state.activeSide;
  const rack = rackOrder(state.inventory, side).length;
  const bag = bagOrder(state.inventory).length;
  if (rack < RACK_SIZE && bag > 0) return { ...state, phase: "refill" };

  const returning = pendingReturnOrder(state.inventory, side);
  if (returning.length === 0) return { ...state, phase: "choose_action" };

  let bagSeq = bag;
  const inventory = applyMoves(
    state.inventory,
    returning.map((ordinal) => ({ ordinal, to: { at: "bag", seq: bagSeq++ } }) satisfies TileMove),
    "return exchanged tiles",
  );
  return { ...state, inventory, phase: "choose_action" };
}

function reducePlace(
  state: CanonicalState,
  placements: readonly PlaceSpec[],
  score: number,
): CanonicalState {
  requirePlaying(state);
  if (state.phase !== "choose_action" && state.phase !== "perform_action") {
    illegal("The active side must finish its refill before playing.");
  }
  if (placements.length === 0) illegal("A play must place at least one tile.");
  if (!Number.isFinite(score)) illegal("A play must record a finite score.");

  const side = state.activeSide;
  const squares = new Set<string>();
  const moves: TileMove[] = placements.map((spec) => {
    const placement = state.inventory[spec.ordinal];
    if (placement?.at !== "rack" || placement.side !== side) {
      illegal(`${tileIdOf(spec.ordinal)} is not on rack ${side} and cannot be played.`);
    }
    const square = `${spec.row}:${spec.col}`;
    if (squares.has(square)) {
      illegal(`Two tiles were played onto square (${spec.row}, ${spec.col}).`);
    }
    squares.add(square);
    const token = tokenOfOrdinal(spec.ordinal);
    if (spec.assigned !== undefined && !tokenAcceptsAssignment(token)) {
      illegal(`${tileIdOf(spec.ordinal)} is a fixed "${token}" tile and has no face to choose.`);
    }
    if (spec.assigned === undefined && tokenAcceptsAssignment(token)) {
      illegal(`${tileIdOf(spec.ordinal)} must be played as a specific face.`);
    }
    return {
      ordinal: spec.ordinal,
      to: {
        at: "board",
        row: spec.row,
        col: spec.col,
        placedTurn: state.turnNumber,
        by: side,
        ...(spec.assigned === undefined ? {} : { assigned: spec.assigned }),
      },
    } satisfies TileMove;
  });

  // Squares already carrying a committed tile are rejected by `applyMoves`'s
  // invariant pass, which reports the collision rather than overwriting.
  const inventory = applyMoves(state.inventory, moves, "play");
  return afterAction({
    ...state,
    inventory,
    scores: { ...state.scores, [side]: state.scores[side] + score },
  });
}

function reduceExchange(state: CanonicalState, tiles: readonly TileOrdinal[]): CanonicalState {
  requirePlaying(state);
  if (state.phase !== "choose_action" && state.phase !== "perform_action") {
    illegal("The active side must finish its refill before exchanging.");
  }
  if (tiles.length === 0) illegal("An exchange must give up at least one tile.");

  const side = state.activeSide;
  let seq = pendingReturnOrder(state.inventory, side).length;
  const moves: TileMove[] = tiles.map((ordinal) => {
    const placement = state.inventory[ordinal];
    if (placement?.at !== "rack" || placement.side !== side) {
      illegal(`${tileIdOf(ordinal)} is not on rack ${side} and cannot be exchanged.`);
    }
    return { ordinal, to: { at: "pendingReturn", side, seq: seq++ } } satisfies TileMove;
  });

  const inventory = applyMoves(state.inventory, moves, "exchange");
  return afterAction({ ...state, inventory });
}

/**
 * The mover keeps the turn until its rack is restored, so the incoming side
 * always begins from a settled position and every observer counts the same
 * number of tiles in the bag.
 */
function afterAction(state: CanonicalState): CanonicalState {
  const rack = rackOrder(state.inventory, state.activeSide).length;
  const bag = bagOrder(state.inventory).length;
  const needsRefill = rack < RACK_SIZE && bag > 0;

  if (state.drawMode === "manual") {
    return needsRefill ? { ...state, phase: "refill" } : handOff(state);
  }
  if (!needsRefill) return handOff(state);
  return handOff(reduceRefill({ ...state, phase: "refill" }));
}

function handOff(state: CanonicalState): CanonicalState {
  const nextSide: Side = state.gameMode === "solo" ? "A" : state.activeSide === "A" ? "B" : "A";
  const handed: CanonicalState = {
    ...state,
    activeSide: nextSide,
    turnNumber: state.turnNumber + 1,
    phase: "choose_action",
  };
  const rack = rackOrder(handed.inventory, nextSide).length;
  const bag = bagOrder(handed.inventory).length;
  return rack < RACK_SIZE && bag > 0 ? { ...handed, phase: "refill" } : handed;
}

function reduceEndGame(
  state: CanonicalState,
  adjustments: Readonly<Partial<Record<Side, number>>> = {},
): CanonicalState {
  return {
    ...state,
    status: "finished",
    phase: "choose_action",
    scores: {
      A: state.scores.A + (adjustments.A ?? 0),
      B: state.scores.B + (adjustments.B ?? 0),
    },
  };
}

// ── Deterministic reconstruction ─────────────────────────────────────────────

/**
 * Rebuild state from genesis and an ordered event log.
 *
 * Any client can run this and reach byte-identical state, which is what lets a
 * spectator hold a snapshot plus a handful of deltas instead of being sent the
 * whole game on every move.
 */
export function replay(
  genesis: CanonicalState,
  events: readonly CommittedEvent[],
): CanonicalState {
  let state = genesis;
  for (const event of events) {
    if (event.gameId !== state.gameId) {
      throw new IllegalCommandError(
        `Event for game ${event.gameId} cannot be replayed onto game ${state.gameId}.`,
      );
    }
    if (event.revision !== state.revision + 1) {
      throw new IllegalCommandError(
        `Event log is not contiguous: expected revision ${state.revision + 1}, found ${event.revision}.`,
      );
    }
    const result = commit(state, {
      commandId: event.commandId,
      expectedRevision: state.revision,
      issuedBy: event.issuedBy,
      command: event.command,
      issuedAt: event.committedAt,
    });
    if (!result.ok) {
      throw new IllegalCommandError(
        `Replaying revision ${event.revision} failed: ${result.message}`,
      );
    }
    state = result.state;
  }
  return state;
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Canonical wire form. Key order is fixed and the inventory is normalized, so
 * two observers at the same revision produce identical strings — the practical
 * test for "everyone sees the same game".
 */
export function canonicalStateDigest(state: CanonicalState): string {
  return JSON.stringify([
    state.gameId,
    state.revision,
    normalizeInventory(state.inventory),
    state.gameMode,
    state.drawMode,
    state.startingSide,
    state.turnNumber,
    state.activeSide,
    state.phase,
    state.status,
    [state.scores.A, state.scores.B],
  ]);
}

export function sameCanonicalState(first: CanonicalState, second: CanonicalState): boolean {
  return canonicalStateDigest(first) === canonicalStateDigest(second);
}
