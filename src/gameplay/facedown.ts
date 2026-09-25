// Writing down a game you are watching, where most of the tiles are face down.
//
// Playing and transcribing differ in one thing: INFORMATION. A player is dealt tiles and finds
// out what the opponent holds when they play it. A transcriber sees eight tiles go onto a rack
// across the table and learns what five of them were only when they land on the board.
//
// So a rack here is not a list of tiles. It is the tiles that have been NAMED, plus a COUNT of
// slots that are held but still face down. That distinction is the whole module:
//
//   * the rack is always the right SIZE, which is what every rule and the bot read;
//   * nothing is invented, because an unnamed slot names nothing — the tile is still in the
//     unseen pool, and the pool is what the bot reasons about;
//   * naming is a separate step and an optional one. When the opponent played `12 = 4 x 3` you
//     know those five tiles and nothing else about their hand, so you name five and leave
//     three face down;
//   * a move can only be entered out of the NAMED half of a rack. You cannot play a tile
//     nobody has identified, and neither can the bot — which is why it refuses a position
//     whose side to move still holds face-down slots.
//
// The alternative — dealing a real tile from the bag and hiding it — would be a lie that gets
// believed. The bag would lose a tile nobody saw leave, and every count the bot reads would be
// wrong in a way no later correction could reach.
import type { Side, TileInstance } from "../game";

/** Slots a side holds but has not identified. Absent means none, which is the normal game. */
export type FaceDownCounts = Partial<Record<Side, number>>;

export type FaceDownRack = {
  /** Tiles whose identity is known. These are the only ones that can be played. */
  readonly named: readonly TileInstance[];
  /** Held, unidentified, still part of the unseen pool. */
  readonly faceDown: number;
};

export function faceDownCount(counts: FaceDownCounts | undefined, side: Side): number {
  return Math.max(0, counts?.[side] ?? 0);
}

/** What the rules and the bot must read: named tiles plus the slots nobody has looked at. */
export function rackSize(named: readonly TileInstance[], faceDown: number): number {
  return named.length + Math.max(0, faceDown);
}

/**
 * Deal `count` slots to a side without deciding what they are.
 *
 * The bag is NOT touched. At the table both racks refill whether or not you can see what
 * arrived, and the tiles that arrived are exactly as unseen afterwards as they were before —
 * they have moved from one part of the unseen pool to another, and the pool is what the bot
 * counts. Taking a tile out of the bag here would move it out of the pool, which is a different
 * position from the one being recorded.
 */
export function dealFaceDown(counts: FaceDownCounts, side: Side, count: number): FaceDownCounts {
  if (count < 0) throw new Error("Cannot deal a negative number of tiles");
  return { ...counts, [side]: faceDownCount(counts, side) + count };
}

export type NameResult = {
  readonly counts: FaceDownCounts;
  readonly rack: TileInstance[];
  readonly pool: TileInstance[];
};

/**
 * Turn one face-down slot into a tile whose identity is now known.
 *
 * `tile` must come from the unseen pool, because that is the only place an unnamed tile can
 * have been. Naming it takes it out of the pool and puts it on the rack, and the slot count
 * drops by one — the rack's SIZE does not change, which is the invariant that keeps every rule
 * reading the same number before and after.
 */
export function nameFaceDown(options: {
  counts: FaceDownCounts;
  side: Side;
  rack: readonly TileInstance[];
  pool: readonly TileInstance[];
  tileId: string;
}): NameResult {
  const held = faceDownCount(options.counts, options.side);
  if (held === 0) throw new Error(`${options.side} has no face-down tile to name`);
  const at = options.pool.findIndex((tile) => tile.id === options.tileId);
  if (at < 0) throw new Error(`Tile ${options.tileId} is not in the unseen pool`);
  const tile = options.pool[at]!;
  return {
    counts: { ...options.counts, [options.side]: held - 1 },
    rack: [...options.rack, tile],
    pool: [...options.pool.slice(0, at), ...options.pool.slice(at + 1)],
  };
}

/**
 * Put a named tile back to face down — the correction for naming the wrong one.
 *
 * Reversing it has to be possible, because a transcriber reads a photograph of a rack and gets
 * one wrong, and the alternative is re-entering the game from the turn where the mistake was
 * made.
 */
export function unnameTile(options: {
  counts: FaceDownCounts;
  side: Side;
  rack: readonly TileInstance[];
  pool: readonly TileInstance[];
  tileId: string;
}): NameResult {
  const at = options.rack.findIndex((tile) => tile.id === options.tileId);
  if (at < 0) throw new Error(`Tile ${options.tileId} is not on ${options.side}'s rack`);
  return {
    counts: { ...options.counts, [options.side]: faceDownCount(options.counts, options.side) + 1 },
    rack: [...options.rack.slice(0, at), ...options.rack.slice(at + 1)],
    pool: [...options.pool, options.rack[at]!],
  };
}

/**
 * Record handing in tiles nobody identified.
 *
 * An exchange at the table is tiles going face down and other tiles coming back. Which ones
 * left is not something the table gets to see, so a count is the whole truth of it. Refusing to
 * record that — turning the turn into a pass, or demanding names nobody has — loses a turn that
 * really happened and shifts every later turn number by one.
 */
export function exchangeFaceDown(
  counts: FaceDownCounts,
  side: Side,
  count: number,
): FaceDownCounts {
  const held = faceDownCount(counts, side);
  if (count < 0) throw new Error("Cannot exchange a negative number of tiles");
  if (count > held) throw new Error(`${side} holds ${held} face-down tiles, not ${count}`);
  // The slots go out and the same number comes back, still unnamed. The count is unchanged,
  // and saying so explicitly is clearer than a no-op nobody can find later.
  return { ...counts, [side]: held };
}

/**
 * Whether the bot may be asked about this position.
 *
 * It may not, while the side to move holds a slot nobody has identified. The bot would have to
 * pick a move out of a rack whose contents are partly imagined, and the move it named could
 * use a tile that is not there. Asking is a question with no honest answer, so it is refused
 * rather than answered badly.
 */
export function botCanDecide(counts: FaceDownCounts | undefined, sideToMove: Side): boolean {
  return faceDownCount(counts, sideToMove) === 0;
}

export function whyBotCannotDecide(
  counts: FaceDownCounts | undefined,
  sideToMove: Side,
): string | null {
  const held = faceDownCount(counts, sideToMove);
  if (held === 0) return null;
  return `${sideToMove} still holds ${held} face-down tile${held === 1 ? "" : "s"} — name them before asking the bot.`;
}

/** The tiles a move may be built from: the named half, never the count. */
export function playableTiles(rack: readonly TileInstance[]): readonly TileInstance[] {
  return rack;
}

/**
 * Does this side's rack add up?
 *
 * The one arithmetic that has to hold whatever was named: named tiles plus face-down slots is
 * the rack size the rules expect. A transcriber who names a tile the rack never held, or deals
 * twice by accident, breaks this — and it is much cheaper to catch here than to discover from
 * a bot that starts refusing positions three turns later.
 */
export function rackConserves(options: {
  named: readonly TileInstance[];
  faceDown: number;
  expected: number;
}): boolean {
  return rackSize(options.named, options.faceDown) === options.expected;
}
