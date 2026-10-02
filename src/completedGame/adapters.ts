import { calculateTotals, makeSnapshot, type GameState } from "../game";
import { canonicalFromSnapshot, encodeCanonical } from "../domain/projection";
import type { Multiverse } from "../gameplay/multiverse";
import {
  buildCompletedGameRecord,
  canonicalCompletedJSON,
  type CompletedGameRecordV1,
  type CompletedProvenance,
} from "./record";

export type StageSealedStart = {
  inventory: unknown[];
  scores: { A: number; B: number };
  activeSide: string;
  turnNumber: number;
  startingSide: string;
};

function canonicalStageStart(game: GameState): StageSealedStart {
  const encoded = encodeCanonical(canonicalFromSnapshot(game.history[0]!, 1)) as StageSealedStart;
  return {
    inventory: encoded.inventory,
    scores: encoded.scores,
    activeSide: encoded.activeSide,
    turnNumber: encoded.turnNumber,
    startingSide: encoded.startingSide,
  };
}

/** The server's sealed start is an input fact, never regenerated from a seed here. */
export async function buildStageCompletedGameRecord(
  game: GameState,
  source: {
    completionAuthority?: "client-reported" | "server-reduced";
    levelId: string;
    seed: number;
    sealedStart: StageSealedStart;
    bot: NonNullable<CompletedProvenance["bot"]>;
    branches?: Multiverse;
  },
): Promise<CompletedGameRecordV1> {
  if (game.status !== "finished" || !game.history.length)
    throw new Error("Stage completion and its first position are required.");
  const actual = canonicalStageStart(game);
  if (canonicalCompletedJSON(actual) !== canonicalCompletedJSON(source.sealedStart))
    throw new Error("Stage genesis differs from the server-sealed start.");
  const earned = calculateTotals(game.logs);
  if (
    game.scores.A !== game.history[0]!.scores.A + earned.A ||
    game.scores.B !== game.history[0]!.scores.B + earned.B
  )
    throw new Error("Stage completion lost its sealed score baseline.");
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalCompletedJSON(source.sealedStart)),
  );
  const sealedStartDigest = Array.from(new Uint8Array(digestBytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return buildCompletedGameRecord(game, source.branches, {
    mode: "stage",
    completionAuthority: source.completionAuthority ?? "client-reported",
    stage: {
      levelId: source.levelId,
      seed: source.seed,
      sealedStartDigest,
      sourceVersion: "stage-seal-v1",
    },
    bot: source.bot,
  });
}

/**
 * A capture boundary for the server's private authoritative Ranked revisions.
 * Today's ranked_matches.state retains only the latest state, so old matches
 * without this capture must remain legacy/readable rather than inventing turns.
 */
export async function buildRankedCompletedGameRecord(
  authoritativeStates: readonly GameState[],
): Promise<CompletedGameRecordV1> {
  const first = authoritativeStates[0];
  const final = authoritativeStates.at(-1);
  if (!first || !final || first.logs.length !== 0 || final.status !== "finished")
    throw new Error("Ranked capture requires a zero-log playing start and finished private tip.");
  if (first.status !== "playing" || first.roomStage !== "playing")
    throw new Error("Ranked capture must start after readiness.");
  if (authoritativeStates.some((state) => state.gameId !== first.gameId))
    throw new Error("Ranked capture crossed game identities.");
  for (let index = 1; index < authoritativeStates.length; index++) {
    const prior = authoritativeStates[index - 1]!;
    const next = authoritativeStates[index]!;
    const added = next.logs.length - prior.logs.length;
    if (added < 1 || added > 2 || (added === 2 && next.logs.at(-1)?.action !== "end_game"))
      throw new Error("Ranked capture is missing an authoritative action revision.");
  }
  const snapshots = authoritativeStates.map((state) => makeSnapshot(state));
  const captured: GameState = {
    ...final,
    history: snapshots,
    historyIndex: snapshots.length - 1,
  };
  return buildCompletedGameRecord(captured, undefined, {
    mode: "ranked",
    completionAuthority: "server-reduced",
  });
}

export type CapturedRankedRevision = {
  match_id: string;
  revision: number;
  state: GameState;
};

/** Service-side adapter for rows captured by the ranked commit transaction. */
export async function buildCapturedRankedCompletedGameRecord(
  rows: readonly CapturedRankedRevision[],
): Promise<CompletedGameRecordV1> {
  const first = rows[0];
  if (!first || !first.match_id || !Number.isSafeInteger(first.revision))
    throw new Error("Ranked capture has no authoritative starting revision.");
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    if (
      row.match_id !== first.match_id ||
      row.revision !== first.revision + index ||
      row.state.gameId !== first.state.gameId
    )
      throw new Error("Ranked private revisions are missing, repeated or cross-match.");
  }
  return buildRankedCompletedGameRecord(rows.map((row) => row.state));
}
