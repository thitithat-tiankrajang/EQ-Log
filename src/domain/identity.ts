// ── Recovering physical identity from token-only data ────────────────────────
//
// Everything stored before revisions recorded a tile as its FACE ("this is a
// 5") and threw away which physical 5 it was, then minted a fresh random label
// on the way back in. That is the mechanism by which a tile could change
// identity between two readers of the same saved game.
//
// Identity cannot be read back out of such data, but it does not need to be
// guessed either: the set is closed, so the multiset of faces determines the
// multiset of tiles exactly. There are five physical "0" tiles and no others.
// Assigning the k-th "0" in a fixed traversal to the k-th "0" of the manifest
// is therefore a canonical relabelling, not an invention — and because the
// traversal is fixed, every client that reads the same saved game recovers the
// same assignment.
//
// The relabelling happens once, on the way in. From then on the id is carried
// verbatim and never regenerated.

import type { AmathToken } from "../constants/tileDefinitions";
import { InventoryError } from "./inventory";
import { TILE_COUNT, TILE_TOKENS, type TileOrdinal } from "./tiles";

const ORDINALS_BY_TOKEN: ReadonlyMap<AmathToken, readonly TileOrdinal[]> = (() => {
  const grouped = new Map<AmathToken, TileOrdinal[]>();
  TILE_TOKENS.forEach((token, ordinal) => {
    const bucket = grouped.get(token);
    if (bucket) bucket.push(ordinal);
    else grouped.set(token, [ordinal]);
  });
  return grouped;
})();

/**
 * Hands out the physical tiles of a given face, in manifest order, without
 * repeating. Running out means the data claims more copies of a face than the
 * physical set contains — reported, never papered over.
 */
export function createIdentityAllocator(options: { strict?: boolean } = {}) {
  const used = new Map<AmathToken, number>();
  const overdrawn: string[] = [];
  return {
    /** The next unused physical tile with this face. */
    take(token: AmathToken): TileOrdinal {
      const copies = ORDINALS_BY_TOKEN.get(token);
      if (!copies) {
        throw new InventoryError(`"${token}" is not a face in the physical set.`);
      }
      const index = used.get(token) ?? 0;
      used.set(token, index + 1);
      const ordinal = copies[index];
      if (ordinal === undefined) {
        const message = `The saved game claims ${index + 1} "${token}" tiles but the set has ${copies.length}.`;
        if (options.strict !== false) throw new InventoryError(message);
        overdrawn.push(message);
        // Non-strict callers (historical logs) reuse the last copy rather than
        // failing: a log is a record of the past, not authoritative state.
        return copies[copies.length - 1];
      }
      return ordinal;
    },
    /** Total tiles handed out so far. */
    count(): number {
      let total = 0;
      for (const value of used.values()) total += value;
      return total;
    },
    problems(): string[] {
      return overdrawn;
    },
    /** Prove the allocation consumed the whole physical set. */
    assertComplete(context: string): void {
      const handed = this.count();
      if (handed === TILE_COUNT && overdrawn.length === 0) return;
      const problems = [...overdrawn];
      if (handed !== TILE_COUNT) {
        problems.push(`It accounts for ${handed} tiles; the physical set has ${TILE_COUNT}.`);
      }
      throw new InventoryError(`The ${context} does not describe the 100-tile set`, problems);
    },
  };
}

export type IdentityAllocator = ReturnType<typeof createIdentityAllocator>;
