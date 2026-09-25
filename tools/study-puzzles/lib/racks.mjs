// Bounded, deterministic proposals. These propose racks, never answers: only
// an independent Stage 5B ranking may decide whether any proposal is accepted.
import { categoryOf } from "./analysis.mjs";
import { availableKinds } from "./branch.mjs";
import { CATEGORIES } from "./config.mjs";
import { seedFor } from "./engine.mjs";
import { positionOf, sortKinds } from "./provenance.mjs";
import { positionHash } from "./record.mjs";
import { canonicalJson } from "../../survival-generator/lib/canonical.mjs";
import { compositionFailures, countsOf, possibleSubset, within } from "./specification.mjs";

export const RACK_SEARCH_VERSION = "study-guided-racks-v1";
export const rackKey = (rack) => sortKinds(rack).join(",");
export function randomFor(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Does some subset of this rack satisfy the NEW-tile composition and size? */
export function rackCanSatisfy(rack, config) {
  if (!within(rack.length, config.rack?.size) || compositionFailures(rack, config.rack?.groups, config.rack?.specific).length) return false;
  const wanted = config.bestPlay;
  return possibleSubset(rack, wanted.tiles.min ?? 1, wanted.tiles.max ?? 8, wanted.composition, wanted.specific);
}

// Several proposal families deliberately include repetition and awkward mixes.
// Arithmetic identities only bias numeric values; no proposed move is passed
// to Stage 5B, and no rule/legality decision is made here.
function arithmeticHint(random) {
  const multiply = random() < 0.5;
  const a = multiply ? 2 + Math.floor(random() * 8) : 10 + Math.floor(random() * 90);
  const b = multiply ? 10 + Math.floor(random() * 390) : 10 + Math.floor(random() * 90);
  return {
    digits: [...String(a), ...String(b), ...String(multiply ? a * b : a + b)],
    choice: multiply ? "x//" : "+/-",
  };
}

export function* candidateRacks(
  state,
  config,
  { budget = config.search?.rackBudget ?? 24, onDuplicate = () => {} } = {},
) {
  const available = availableKinds(state);
  const size = state.racks[state.activeSide].length;
  if (size < (config.bestPlay.tiles.min ?? 1) || !within(size, config.rack?.size)) return;
  const baseSeed = seedFor(
    canonicalJson({
      version: RACK_SEARCH_VERSION,
      position: positionHash(positionOf(state)),
      config,
    }),
  );
  const seen = new Set([rackKey(positionOf(state).rack)]);
  const families = ["arithmetic", "diverse", "repeated", "inventory"];
  let count = 0;
  for (let attempt = 0; attempt < budget * 80 && count < budget; attempt++) {
    const candidateSeed = seedFor(String(baseSeed), attempt);
    const random = randomFor(candidateSeed);
    const family = families[attempt % families.length];
    const hint = arithmeticHint(random);
    const favored = String(Math.floor(random() * 10));
    const pool = [...available];
    const rack = [];
    const take = (category, exactKind = null) => {
      if (rack.length >= size) return false;
      let options = pool.filter((kind) => (!category || (Array.isArray(category) ? category.includes(categoryOf(kind)) : categoryOf(kind) === category)) && (!exactKind || kind === exactKind) &&
        !compositionFailures([...rack, kind], Object.fromEntries(Object.entries(config.rack.groups).map(([k, r]) => [k, { min: null, max: r.max }])), Object.fromEntries(Object.entries(config.rack.specific).map(([k, r]) => [k, { min: null, max: r.max }]))).length);
      if (!options.length) return false;
      if (family === "arithmetic") {
        const desired =
          category === "digit" ? hint.digits.shift() : category === "choice" ? hint.choice : null;
        if (desired && options.includes(desired)) options = [desired];
      } else if (family === "diverse") {
        const fresh = options.filter((kind) => !rack.includes(kind));
        if (fresh.length) options = [...new Set(fresh)];
      } else if (family === "repeated") {
        const repeated = options.filter((kind) => kind === favored || rack.includes(kind));
        if (repeated.length && random() < 0.8) options = repeated;
      }
      const kind = options[Math.floor(random() * options.length)];
      pool.splice(pool.indexOf(kind), 1);
      rack.push(kind);
      return true;
    };
    let possible = true;
    for (const kind of Object.keys(config.rack.specific))
      while (possible && (countsOf(rack).specific[kind] ?? 0) < (config.rack.specific[kind].min ?? 0)) possible = take(null, kind);
    for (const kind of Object.keys(config.bestPlay.specific))
      while (possible && (countsOf(rack).specific[kind] ?? 0) < (config.bestPlay.specific[kind].min ?? 0)) possible = take(null, kind);
    for (const category of CATEGORIES)
      while (possible && countsOf(rack).groups[category] < Math.max(config.rack.groups[category]?.min ?? 0, config.bestPlay.composition[category]?.min ?? 0)) possible = take(category);
    for (const group of ["arithmetic", "operatorLike"])
      while (possible && countsOf(rack).groups[group] < Math.max(config.rack.groups[group]?.min ?? 0, config.bestPlay.composition[group]?.min ?? 0)) {
        const category = group === "arithmetic" ? ["operator", "choice"] : ["operator", "choice", "equals"];
        possible = take(category);
      }
    const minimum = Math.max(config.bestPlay.tiles.min ?? 1, rack.length);
    while (possible && rack.length < minimum) {
      const categories = CATEGORIES.filter((key) => pool.some((k) => categoryOf(k) === key));
      if (!categories.length) {
        possible = false;
        break;
      }
      possible = take(categories[Math.floor(random() * categories.length)]);
    }
    while (possible && rack.length < size) possible = take(null);
    if (!possible || rack.length !== size || !rackCanSatisfy(rack, config)) continue;
    const key = rackKey(rack);
    if (seen.has(key)) {
      onDuplicate();
      continue;
    }
    seen.add(key);
    yield {
      rack: sortKinds(rack),
      candidateSeed,
      candidateIndex: count++,
      family,
      strategyVersion: RACK_SEARCH_VERSION,
    };
  }
}
