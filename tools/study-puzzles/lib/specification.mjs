// Physical tile counts are always by canonical kind, never by a choice/blank's
// assigned face. These groups overlap intentionally; all supplied ranges hold.
import { env } from "./provenance.mjs";
import { categoryOf } from "./analysis.mjs";

export const GROUPS = ["digit", "heavy", "operator", "choice", "equals", "blank", "arithmetic", "operatorLike"];
export const BASE_GROUPS = GROUPS.slice(0, 6);
const physicalTiles = env.createManifest().tiles;
export const TILE_KINDS = [...new Set(physicalTiles.map((tile) => tile.kind))];
export const INVENTORY = Object.fromEntries(TILE_KINDS.map((kind) => [kind, physicalTiles.filter((tile) => tile.kind === kind).length]));
export const anyRange = () => ({ min: null, max: null });
export const within = (count, range = anyRange()) =>
  (range.min == null || count >= range.min) && (range.max == null || count <= range.max);

export function countsOf(kinds) {
  const specific = Object.fromEntries(TILE_KINDS.map((kind) => [kind, 0]));
  const groups = Object.fromEntries(GROUPS.map((group) => [group, 0]));
  for (const kind of kinds) {
    if (!(kind in specific)) throw new Error(`unknown physical tile kind ${kind}`);
    specific[kind]++;
    const group = categoryOf(kind);
    groups[group]++;
    if (group === "operator" || group === "choice") groups.arithmetic++;
    if (group === "operator" || group === "choice" || group === "equals") groups.operatorLike++;
  }
  return { specific, groups, total: kinds.length };
}

export function compositionFailures(kinds, groups = {}, specific = {}, prefix = "rack") {
  const counts = countsOf(kinds);
  const reasons = [];
  for (const [group, range] of Object.entries(groups))
    if (!within(counts.groups[group], range)) reasons.push(`${prefix}.group.${group}`);
  for (const [kind, range] of Object.entries(specific))
    if (!within(counts.specific[kind], range)) reasons.push(`${prefix}.specific.${kind}`);
  return reasons;
}

export function possibleSubset(kinds, minSize, maxSize, groups, specific) {
  // Rack size is at most eight: enumerating its 256 subsets is exact and cheap.
  for (let mask = 1; mask < 1 << kinds.length; mask++) {
    const subset = kinds.filter((_, index) => mask & (1 << index));
    if (subset.length < minSize || subset.length > maxSize) continue;
    if (!compositionFailures(subset, groups, specific).length) return true;
  }
  return false;
}

/** Exact feasibility by the six disjoint base groups, with specific-kind caps. */
export function compositionPossible({ groups = {}, specific = {}, minSize = 1, maxSize = 8, inventory = INVENTORY }) {
  if (Object.keys(inventory).some((kind) => (specific[kind]?.min ?? 0) > Math.min(inventory[kind], specific[kind]?.max ?? inventory[kind]))) return false;
  const options = BASE_GROUPS.map((group) => {
    const kinds = Object.keys(inventory).filter((kind) => categoryOf(kind) === group);
    const minimum = kinds.reduce((sum, kind) => sum + (specific[kind]?.min ?? 0), 0);
    const maximum = kinds.reduce((sum, kind) => sum + Math.min(inventory[kind], specific[kind]?.max ?? inventory[kind]), 0);
    return {
      group,
      min: Math.max(minimum, groups[group]?.min ?? 0),
      max: Math.min(maximum, groups[group]?.max ?? maxSize, maxSize),
    };
  });
  if (options.some(({ min, max }) => min > max)) return false;
  function visit(index, counts, total) {
    if (index === options.length) {
      if (total < minSize || total > maxSize) return false;
      return within(counts.operator + counts.choice, groups.arithmetic) &&
        within(counts.operator + counts.choice + counts.equals, groups.operatorLike);
    }
    const { group, min, max } = options[index];
    for (let count = min; count <= max && total + count <= maxSize; count++) {
      counts[group] = count;
      if (visit(index + 1, counts, total + count)) return true;
    }
    return false;
  }
  return visit(0, {}, 0);
}
