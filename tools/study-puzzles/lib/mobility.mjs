// Count only distinct canonical placement actions. The canonical generator
// already deduplicates; the ID set below is a second guard at this boundary.
import { env } from "./provenance.mjs";

export async function legalPlacementCount(state, { max = null, signal, generate = env.completeRootActions } = {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) controller.abort();
  let bounded = false;
  try {
    const result = await generate(state, {
      signal: controller.signal,
      onProgress: (uniqueCount) => {
        // The generator's movesFound is its deduplicating collector.size.
        if (max !== null && uniqueCount > max) { bounded = true; controller.abort(); }
      },
    });
    const seen = new Set(result.places.map((place) => place.id));
    const count = seen.size;
    if (bounded && count <= max) {
      // A cancelled generator may snapshot just before the callback. Its own
      // unique collector count still proved max+1 distinct placements.
      return { exact: false, lowerBound: max + 1, count: null, overMax: true };
    }
    if (count > max && max !== null) return { exact: false, lowerBound: count, count: null, overMax: true };
    if (result.complete && !result.truncated) return { exact: true, lowerBound: count, count, overMax: max !== null && count > max };
    return { exact: false, lowerBound: count, count: null, overMax: false };
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
