// ── The physical tile set ────────────────────────────────────────────────────
//
// An A-Math set is a CLOSED physical inventory of exactly 100 tiles. This
// module is the single definition of that inventory and of physical tile
// identity.
//
// Two properties are established here and relied on by everything downstream:
//
//   1. Identity is an ORDINAL. Every physical tile owns a fixed ordinal in
//      [0, 100). The ordinal is the tile — not a label attached to it. Nothing
//      mints, regenerates, or renumbers tile identity at runtime.
//
//   2. The intrinsic token is DERIVED from the ordinal, never stored beside it.
//      `tokenOfOrdinal(o)` is a total function over a frozen table, so a tile
//      cannot silently change what kind of tile it is: there is no field to
//      write. Only *how a tile is being used* (a blank's assigned face) is
//      mutable, and that lives on the placement, not on the tile.
//
// The string form (`n0_1`, `eq_11`, `blank_4`) is the wire/storage form and
// is byte-for-byte identical to the ids the legacy `createInitialTilebag`
// produced, so states that never round-tripped through the old codec already
// carry canonical identity.

import { AMATH_TOKENS, type AmathToken } from "../constants/tileDefinitions";

/** The physical set contains exactly this many tiles. Not a tunable. */
export const TILE_COUNT = 100;

/** A tile's permanent identity: an index into the frozen manifest. */
export type TileOrdinal = number;

/** The stable external name of a physical tile. */
export type TileId = string;

/** Declaration order of the manifest. Explicit so it can never drift with
 *  JavaScript's integer-key ordering rules for object literals. */
const TOKEN_ORDER: readonly AmathToken[] = [
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
  "+", "-", "x", "/", "+/-", "x//", "=", "?",
];

const TOKEN_ID_PREFIX: Record<AmathToken, string> = {
  "0": "n0", "1": "n1", "2": "n2", "3": "n3", "4": "n4",
  "5": "n5", "6": "n6", "7": "n7", "8": "n8", "9": "n9",
  "10": "n10", "11": "n11", "12": "n12", "13": "n13", "14": "n14",
  "15": "n15", "16": "n16", "17": "n17", "18": "n18", "19": "n19",
  "20": "n20",
  "+": "plus", "-": "minus", x: "mul", "/": "div",
  "+/-": "plusminus", "x//": "muldiv", "=": "eq", "?": "blank",
};

function buildManifest(): { ids: string[]; tokens: AmathToken[] } {
  const ids: string[] = [];
  const tokens: AmathToken[] = [];
  for (const token of TOKEN_ORDER) {
    const { count } = AMATH_TOKENS[token];
    for (let copy = 1; copy <= count; copy += 1) {
      ids.push(`${TOKEN_ID_PREFIX[token]}_${copy}`);
      tokens.push(token);
    }
  }
  return { ids, tokens };
}

const MANIFEST = buildManifest();

if (MANIFEST.ids.length !== TILE_COUNT) {
  // A build-time contradiction between the token table and the physical set.
  // Failing here is the only safe outcome: every invariant below assumes 100.
  throw new Error(
    `The tile manifest describes ${MANIFEST.ids.length} tiles but the physical set has ${TILE_COUNT}.`,
  );
}

/** Ordinal → stable tile id. Frozen; index is identity. */
export const TILE_IDS: readonly TileId[] = Object.freeze(MANIFEST.ids);

/** Ordinal → intrinsic token. Frozen; the tile's type cannot be reassigned. */
export const TILE_TOKENS: readonly AmathToken[] = Object.freeze(MANIFEST.tokens);

const ORDINAL_BY_ID: ReadonlyMap<TileId, TileOrdinal> = new Map(
  TILE_IDS.map((id, ordinal) => [id, ordinal]),
);

/** Every ordinal, in manifest order. Useful as an iteration domain. */
export const ALL_ORDINALS: readonly TileOrdinal[] = Object.freeze(
  Array.from({ length: TILE_COUNT }, (_, ordinal) => ordinal),
);

export function isTileOrdinal(value: unknown): value is TileOrdinal {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) < TILE_COUNT;
}

export function tileIdOf(ordinal: TileOrdinal): TileId {
  const id = TILE_IDS[ordinal];
  if (id === undefined) throw new UnknownTileError(`Tile ordinal ${ordinal} is outside the set.`);
  return id;
}

export function tokenOfOrdinal(ordinal: TileOrdinal): AmathToken {
  const token = TILE_TOKENS[ordinal];
  if (token === undefined) throw new UnknownTileError(`Tile ordinal ${ordinal} is outside the set.`);
  return token;
}

export function tokenOfTileId(id: TileId): AmathToken {
  return tokenOfOrdinal(ordinalOfTileId(id));
}

/** Resolve a stable id to its ordinal. Unknown ids are a hard failure — they
 *  represent a tile that is not part of the physical set. */
export function ordinalOfTileId(id: TileId): TileOrdinal {
  const ordinal = ORDINAL_BY_ID.get(id);
  if (ordinal === undefined) {
    throw new UnknownTileError(`"${id}" is not a tile in the physical set.`);
  }
  return ordinal;
}

export function tryOrdinalOfTileId(id: TileId): TileOrdinal | null {
  return ORDINAL_BY_ID.get(id) ?? null;
}

/** Raised when something claims to be a physical tile but is not one. */
export class UnknownTileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownTileError";
  }
}

/** Tokens whose face is chosen at placement time (blank and the two choice
 *  tiles). The chosen face is a property of the PLACEMENT, never of the tile. */
export function tokenAcceptsAssignment(token: AmathToken): boolean {
  return token === "?" || token === "+/-" || token === "x//";
}

/** Stable fingerprint of the manifest. Pinned by a test so a change to the
 *  token table that would silently re-identify every physical tile fails
 *  loudly instead of migrating live games into a different set. */
export function manifestFingerprint(): string {
  let hash = 0x811c9dc5;
  for (const id of TILE_IDS) {
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2c;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
