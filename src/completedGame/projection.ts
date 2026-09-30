import { displayToken, type BoardSnapshot, type GameState, type Side } from "../game";
import type { Multiverse } from "../gameplay/multiverse";
import { decodeMultiverse, type EncodedMultiverse } from "../gameplay/multiverseCodec";
import {
  readCompletedGame,
  readCompletedGameRecord,
  type CompletedGameRecordV1,
  type CompletedProvenance,
} from "./record";

/** Values must come from the trusted archive envelope and membership lookup. */
export type CompletedReplayAccess = {
  scope: "public" | "region" | "private" | "ranked" | "stage";
  ownerId: string;
  participantIds: string[];
  regionId?: string;
  /** Server-controlled publication decision, never a value from the record. */
  published: boolean;
};
export type CompletedReplayViewer = {
  userId: string | null;
  regionIds: string[];
  approved: boolean;
  admin: boolean;
};

export type PublicBoardCell = {
  row: number;
  col: number;
  /** The visible tile kind, including a blank or choice tile. Never its ID. */
  kind: string;
  face: string;
  side: Side;
  turn: number;
};
export type CompletedReplayProjection = {
  format: 1;
  mode: CompletedGameRecordV1["provenance"]["mode"];
  status: "finished";
  players: Record<Side, string>;
  startingBoard: PublicBoardCell[];
  finalBoard: PublicBoardCell[];
  finalScores: Record<Side, number>;
  /** Sorted face multisets: rack ordering cannot encode hidden draw order. */
  finalRacks: Record<Side, string[]>;
  clocks: { initial: Record<Side, number>; final: Record<Side, number> };
  bot?: { displayName: string; version: string; difficulty?: string; modelLevel?: string };
  stage?: { levelId: string };
  /** Every saved revision, projected without racks, bag or physical identities. */
  positions: Array<{
    board: PublicBoardCell[];
    scores: Record<Side, number>;
    clocks: Record<Side, number>;
    turn: number;
    side: Side;
  }>;
  branches?: Array<{
    /** Null only when a legacy line refers to a missing fork node. */
    fromTurn: number | null;
    positions: Array<{
      board: PublicBoardCell[];
      scores: Record<Side, number> | null;
      clocks: Record<Side, number>;
      turn: number;
    }>;
  }>;
  turns: Array<{
    turn: number;
    side: Side;
    action: "place_equation" | "exchange" | "pass" | "end_game";
    score: number;
    board: PublicBoardCell[];
    clockBefore: Record<Side, number>;
    clockAfter: Record<Side, number>;
    startedAt: string;
    endedAt: string;
  }>;
};

const PUBLIC_BOT_NAMES: Record<string, string> = {
  authur: "Authur",
  authur_strong: "Authur",
  stage5b: "ArchBot",
};

function publicBoard(board: BoardSnapshot): PublicBoardCell[] {
  const cells: PublicBoardCell[] = [];
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row]!.length; col++) {
      const cell = board[row]![col];
      if (cell)
        cells.push({
          row,
          col,
          kind: cell.tile.token,
          face: displayToken(cell.tile),
          side: cell.side,
          turn: cell.placedTurn,
        });
    }
  }
  return cells;
}

/** Pure policy check; the trusted server must obtain access/viewer from its own rows. */
export function authorizeCompletedReplay(
  access: CompletedReplayAccess,
  viewer: CompletedReplayViewer,
): boolean {
  const userId = viewer.userId;
  if (!userId) return false;
  if (access.scope === "private") return userId === access.ownerId;
  if (access.scope === "ranked")
    return access.participantIds.includes(userId) || (access.published && viewer.approved);
  if (access.scope === "stage")
    return userId === access.ownerId || (access.published && viewer.approved);
  if (!access.published || (!viewer.approved && !viewer.admin)) return false;
  if (access.scope === "region")
    return viewer.admin || Boolean(access.regionId && viewer.regionIds.includes(access.regionId));
  return access.scope === "public";
}

/** Trusted-server boundary. Never send the internal record to a browser. */
export async function projectCompletedGame(
  record: CompletedGameRecordV1,
  access: CompletedReplayAccess,
  viewer: CompletedReplayViewer,
): Promise<CompletedReplayProjection> {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (
    (access.scope === "ranked" && record.provenance.mode !== "ranked") ||
    (access.scope === "stage" && record.provenance.mode !== "stage") ||
    (record.provenance.mode === "ranked" && access.scope !== "ranked") ||
    (record.provenance.mode === "stage" && access.scope !== "stage")
  )
    throw new Error("Replay scope does not match game provenance.");
  const { game, branches } = await readCompletedGameRecord(record);
  return projectDecodedGame(game, access, viewer, record.provenance, branches);
}

/** Legacy and Compact dispatch for a trusted archive reader. */
export async function projectStoredCompletedGame(
  stored: unknown,
  access: CompletedReplayAccess,
  viewer: CompletedReplayViewer,
): Promise<CompletedReplayProjection> {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (stored && typeof stored === "object" && "format" in stored)
    return projectCompletedGame(stored as CompletedGameRecordV1, access, viewer);
  const raw = typeof stored === "string" ? stored : JSON.stringify(stored);
  const storedObject = stored && typeof stored === "object" ? stored : null;
  const timeline =
    storedObject && "timeline" in storedObject
      ? (storedObject.timeline as EncodedMultiverse)
      : null;
  const read = await readCompletedGame(raw, timeline ? decodeMultiverse(timeline) : undefined);
  return projectDecodedGame(
    read.game,
    access,
    viewer,
    read.kind === "compact" ? read.provenance : undefined,
    read.branches,
  );
}

function projectDecodedGame(
  game: GameState,
  access: CompletedReplayAccess,
  viewer: CompletedReplayViewer,
  provenance: CompletedProvenance | undefined,
  branches: Multiverse | null,
): CompletedReplayProjection {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (game.status !== "finished") throw new Error("Only finished games may be projected.");
  const bot = provenance?.bot;
  const mode =
    provenance?.mode ?? (game.gameMode === "solo" ? "solo" : game.botSide ? "bot" : "standard");
  const history = game.history.length ? game.history : [game];
  const visiblePositions = history.map((position) => ({
    board: publicBoard(position.board),
    scores: { A: position.scores.A, B: position.scores.B },
    clocks: { A: position.timers.A, B: position.timers.B },
    turn: position.turnNumber,
    side: position.activeSide,
  }));
  visiblePositions.push({
    board: publicBoard(game.board),
    scores: { A: game.scores.A, B: game.scores.B },
    clocks: { A: game.timers.A, B: game.timers.B },
    turn: game.turnNumber,
    side: game.activeSide,
  });
  // A rack reorder or bag-only correction is a canonical archive fact, but it
  // must not change what a replay viewer sees or reveal that hidden edit.
  const projectedPositions = visiblePositions.filter(
    (position, index) =>
      index === 0 || JSON.stringify(position) !== JSON.stringify(visiblePositions[index - 1]),
  );
  type BranchPosition = NonNullable<
    CompletedReplayProjection["branches"]
  >[number]["positions"][number];
  const forkPositions = new Map<string, BranchPosition>();
  for (const log of game.logs) {
    const saved = history.find((position) => position.logs.at(-1)?.id === log.id);
    forkPositions.set(log.id, {
      board: publicBoard(saved?.board ?? log.boardAfter),
      scores: saved ? { A: saved.scores.A, B: saved.scores.B } : null,
      clocks: saved
        ? { A: saved.timers.A, B: saved.timers.B }
        : { A: log.timerAfter.A, B: log.timerAfter.B },
      turn: log.turnNumber,
    });
  }
  for (const line of branches?.lines ?? [])
    line.logs.forEach((log, index) => {
      const saved = line.after[index];
      forkPositions.set(log.id, {
        board: publicBoard(saved?.board ?? log.boardAfter),
        scores: saved ? { A: saved.scores.A, B: saved.scores.B } : null,
        clocks: saved
          ? { A: saved.timers.A, B: saved.timers.B }
          : { A: log.timerAfter.A, B: log.timerAfter.B },
        turn: log.turnNumber,
      });
    });
  return {
    format: 1,
    mode,
    status: "finished",
    players: { A: game.players.A, B: game.players.B },
    startingBoard: publicBoard(history[0]!.board),
    finalBoard: publicBoard(game.board),
    finalScores: { A: game.scores.A, B: game.scores.B },
    finalRacks: {
      A: game.rackA.map(displayToken).sort(),
      B: game.rackB.map(displayToken).sort(),
    },
    clocks: {
      initial: { A: history[0]!.timers.A, B: history[0]!.timers.B },
      final: { A: game.timers.A, B: game.timers.B },
    },
    ...(bot && game.botSide
      ? {
          bot: {
            displayName: PUBLIC_BOT_NAMES[bot.catalogId] ?? "Bot",
            version: bot.catalogVersion,
            ...(bot.catalogId !== "stage5b" && bot.difficulty
              ? { difficulty: bot.difficulty }
              : {}),
            ...(bot.catalogId !== "stage5b" && bot.modelLevel
              ? { modelLevel: bot.modelLevel }
              : {}),
          },
        }
      : {}),
    ...(provenance?.mode === "stage" && provenance.stage
      ? { stage: { levelId: provenance.stage.levelId } }
      : {}),
    positions: projectedPositions,
    ...(branches?.lines.length
      ? {
          branches: branches.lines.map((line) => {
            const fork = line.from
              ? forkPositions.get(line.from)
              : {
                  board: publicBoard(history[0]!.board),
                  scores: { A: history[0]!.scores.A, B: history[0]!.scores.B },
                  clocks: { A: history[0]!.timers.A, B: history[0]!.timers.B },
                  turn: history[0]!.turnNumber,
                };
            return {
              fromTurn: fork?.turn ?? null,
              positions: [
                ...(fork ? [fork] : []),
                ...line.logs.map((log) => forkPositions.get(log.id)!),
              ],
            };
          }),
        }
      : {}),
    turns: game.logs.map((log) => ({
      turn: log.turnNumber,
      side: log.side,
      action: log.action,
      score: log.finalScore,
      board: publicBoard(log.boardAfter),
      clockBefore: { A: log.timerBefore.A, B: log.timerBefore.B },
      clockAfter: { A: log.timerAfter.A, B: log.timerAfter.B },
      startedAt: log.startedAt,
      endedAt: log.endedAt,
    })),
  };
}
