// Analysis-only reallocations. Never borrow mutable arrays, maps, or RNG state
// from the source, and never apply a branch action back to the source game.
import { env, positionOf, sortKinds } from "./provenance.mjs";
import { positionHash } from "./record.mjs";
import { stateHash } from "../../survival-generator/lib/sourcelog.mjs";

export const BRANCH_VERSION = "study-rack-allocation-v1";
export const countsOf = (kinds) => {
  const counts = {};
  for (const kind of sortKinds(kinds)) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
};

/** Available for reallocation = both racks + bag (NOT the board).
 * The player's original rack returns to this pool before selecting another.
 * No known set-aside tiles may be redistributed.
 */
export function availableKinds(state) {
  if (state.pendingReturn.A.length || state.pendingReturn.B.length)
    throw new Error("cannot branch with known set-aside tiles");
  return sortKinds(
    [...state.racks.A, ...state.racks.B, ...state.bag].map((id) => state.manifest.kindOf.get(id)),
  );
}

export function constructBranch(
  source,
  rack,
  {
    candidateSeed = 0,
    candidateIndex = 0,
    family = "composition",
    strategyVersion = "study-guided-racks-v1",
  } = {},
) {
  availableKinds(source);
  const side = source.activeSide;
  const opponent = side === "A" ? "B" : "A";
  if (rack.length !== source.racks[side].length)
    throw new Error("constructed rack size differs from source rack size");
  const original = positionOf(source);
  const branch = structuredClone(source);
  // Canonical physical-id allocation is independent of the authentic bag order.
  const pool = [...branch.racks.A, ...branch.racks.B, ...branch.bag].sort();
  branch.racks[side] = sortKinds(rack).map((kind) => {
    const index = pool.findIndex((id) => branch.manifest.kindOf.get(id) === kind);
    if (index < 0) throw new Error(`rack exceeds available inventory: ${kind}`);
    return pool.splice(index, 1)[0];
  });
  branch.racks[opponent] = pool.splice(0, source.racks[opponent].length);
  branch.bag = pool;
  // Reuse canonical conservation validation without replacing the deep copy.
  env.envStateFrom(branch);
  const position = positionOf(branch);
  return {
    state: branch,
    provenance: {
      origin: "CONFIG_GUIDED_RACK",
      version: BRANCH_VERSION,
      sourceTurn: source.turnNumber,
      sourcePositionHash: positionHash(original),
      sourceStateHash: stateHash(source),
      originalRack: original.rack,
      constructedRack: position.rack,
      remainingUnseen: position.unseen,
      candidateIndex,
      candidateSeed,
      family,
      strategyVersion,
      puzzlePositionHash: positionHash(position),
    },
  };
}
