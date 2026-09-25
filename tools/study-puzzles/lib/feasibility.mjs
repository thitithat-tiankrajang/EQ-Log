// Geometry is an over-approximation: contiguous spans with at most a rack of
// empty cells. It never decides arithmetic legality. All negative legal-move
// decisions below come from the existing COMPLETE canonical move generator.
import { analyzePlacement, rackDifficulty } from "./analysis.mjs";
import { bestPlayRejections, within } from "./filters.mjs";
import { env, positionOf } from "./provenance.mjs";
import { BASE_GROUPS, compositionFailures } from "./specification.mjs";

export function geometryFeasibility(position, config) {
  const occupied = new Map(position.board.map((t) => [`${t.r}:${t.c}`, t]));
  const at = (r, c) => occupied.get(`${r}:${c}`);
  const wanted = config.bestPlay;
  const minimum = Math.max(
    wanted.tiles.min ?? 1,
    BASE_GROUPS.reduce((sum, key) => sum + (wanted.composition[key]?.min ?? 0), 0),
    Object.values(wanted.specific ?? {}).reduce((sum, range) => sum + (range.min ?? 0), 0),
  );
  const maximum = Math.min(position.rack.length, wanted.tiles.max ?? 8);
  const counts = { placement: 0, moveType: 0, equations: 0, equationGeometry: 0 };
  for (const horizontal of [true, false])
    for (let line = 0; line < 15; line++) {
      const cell = (n) => (horizontal ? [line, n] : [n, line]);
      for (let start = 0; start < 15; start++) {
        if (at(...cell(start - 1))) continue;
        for (let end = start + 1; end < 15; end++) {
          if (at(...cell(end + 1))) continue;
          let fresh = 0,
            hooks = 0,
            reused = 0,
            segment = 0;
          const segments = [];
          for (let n = start; n <= end; n++) {
            const [r, c] = cell(n);
            if (at(r, c)) {
              reused++;
              segment++;
            } else {
              fresh++;
              if (segment) segments.push(segment);
              segment = 0;
              if (horizontal ? at(r - 1, c) || at(r + 1, c) : at(r, c - 1) || at(r, c + 1)) hooks++;
            }
          }
          if (segment) segments.push(segment);
          if (fresh < minimum || fresh > maximum || (!reused && !hooks)) continue;
          counts.placement++;
          const labels = [
            segments.some((n) => n >= 2) && "EXTEND",
            segments.includes(1) && "CROSS",
            hooks > 0 && "HOOK",
          ];
          if (wanted.moveTypes.length && !wanted.moveTypes.some((t) => labels.includes(t)))
            continue;
          counts.moveType++;
          if (!within(1 + hooks, wanted.equations)) continue;
          counts.equations++;
          const equation = config.equation;
          if (equation?.scope === "MAIN" &&
              (!within(end - start + 1, equation.tiles) ||
                !within(fresh, equation.placedParticipating) ||
                !within(reused, equation.reusedBoardTiles))) continue;
          counts.equationGeometry++;
          return { reasons: [] };
        }
      }
    }
  return {
    reasons: [
      !counts.placement
        ? "geometry.noPlacement"
        : !counts.moveType
          ? "geometry.moveType"
          : !counts.equations
            ? "geometry.equations"
            : "geometry.equationTiles",
    ],
  };
}

/** Incomplete/over-budget work is UNKNOWN, never proof that no move exists.
 * Blank-heavy and unrestricted searches skip this optional layer: enumerating
 * their entire move set can cost as much as the full engine analysis.
 */
export async function legalRackFeasibility(state, config, { signal, budgetMs = 80 } = {}) {
  const position = positionOf(state);
  if (signal?.aborted) return { possible: null, elapsedMs: 0 };
  const restrictive =
    (config.bestPlay.tiles.min ?? 1) >= 6 || config.bestPlay.moveTypes.includes("HOOK") ||
    (config.equation && [config.equation.tiles, config.equation.reusedBoardTiles, config.equation.placedParticipating]
      .some((range) => range.min !== null || range.max !== null));
  if (!restrictive || position.rack.includes("?")) return { possible: null, elapsedMs: 0 };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const start = performance.now();
  const timer = setTimeout(abort, budgetMs);
  try {
    const root = await env.completeRootActions(state, { signal: controller.signal, sliceMs: 5 });
    if (!root.complete || root.truncated || signal?.aborted)
      return { possible: null, elapsedMs: performance.now() - start };
    for (const place of root.places) {
      const placements = place.action.placements;
      if (
        !within(placements.length, config.bestPlay.tiles) ||
        !within(place.score, config.bestPlay.score)
      )
        continue;
      if (compositionFailures(placements.map((p) => p.kind), config.bestPlay.composition, config.bestPlay.specific).length) continue;
      const analysis = analyzePlacement(
        position.board,
        placements.map((p) => ({
          r: Math.floor(p.cell / 15),
          c: p.cell % 15,
          kind: p.kind,
          face: p.face,
        })),
      );
      if (!analysis.valid) continue;
      if (
        !bestPlayRejections(config, {
          analysis,
          nearBest: [],
          rackIndex: rackDifficulty(position.rack).index,
        }).length
      )
        return { possible: true, elapsedMs: performance.now() - start };
    }
    return {
      possible: false,
      reason: "rack.noMatchingLegalMove",
      elapsedMs: performance.now() - start,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
