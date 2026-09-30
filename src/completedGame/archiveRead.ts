import {
  authorizeCompletedReplay,
  projectStoredCompletedGame,
  type CompletedReplayAccess,
  type CompletedReplayProjection,
  type CompletedReplayViewer,
} from "./projection";

/** The trusted reader constructs these from database rows, never request JSON. */
export type ArchiveCandidate = {
  scope: "public" | "region" | "private" | "stage" | "recent" | "saved";
  gameId: string;
  name: string;
  ownerId: string;
  regionId?: string;
  finishedAt: string;
  snapshot: unknown;
};

export type SafeArchiveReplay = {
  archive: {
    gameId: string;
    name: string;
    scope: ArchiveCandidate["scope"];
    finishedAt: string;
  };
  replay: CompletedReplayProjection;
};

/**
 * The trusted reader orders candidates. The owner's immutable Saved source
 * takes precedence; an ineligible Region row cannot hide an owned replay.
 */
export async function projectFirstAuthorizedArchive(
  candidates: readonly ArchiveCandidate[],
  viewer: CompletedReplayViewer,
): Promise<SafeArchiveReplay | null> {
  for (const row of candidates) {
    const access: CompletedReplayAccess = {
      scope: row.scope === "recent" || row.scope === "saved" ? "private" : row.scope,
      ownerId: row.ownerId,
      participantIds: [],
      regionId: row.regionId,
      published: row.scope === "public" || row.scope === "region",
    };
    if (!authorizeCompletedReplay(access, viewer)) continue;
    const replay = await projectStoredCompletedGame(row.snapshot, access, viewer);
    return {
      archive: {
        gameId: row.gameId,
        name: row.name,
        scope: row.scope,
        finishedAt: row.finishedAt,
      },
      replay,
    };
  }
  return null;
}
