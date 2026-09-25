// A Study puzzle on the Play page: one position, one placement, then done.
//
// Addressed like a room, in its own namespace, so the router needs no new shape
// and the room machinery can tell at once that it must stay out of the way:
//
//   #/play/study:<setId>:<puzzleId>
//
// The page is given only the player projection (api.ts `PlayerPuzzle`): the
// board, the player's own rack, the scores and the unseen tiles as ONE pool.
// Splitting that pool into a bag and an opponent rack below is a stand-in that
// only makes the counts right — nobody is ever shown the two halves apart.
import {
  AMATH_TOKENS,
  createBoard,
  type AmathToken,
  type GameState,
  type PlaceEquationDetail,
  type TileInstance,
  type TurnLog,
} from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import type { TilebagView } from "../../gameplay/tilebag";
import type { PlayerPuzzle, PuzzleCell } from "./api";

const PREFIX = "study:";
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CHOICE_KINDS = new Set(["?", "+/-", "x//"]);
const KINDS = Object.keys(AMATH_TOKENS) as AmathToken[];
const RANK = new Map(KINDS.map((kind, index) => [kind, index]));

export type StudyPuzzleRoute = { setId: string; puzzleId: string };

export function studyPuzzleRoomId(setId: string, puzzleId: string): string {
  return `${PREFIX}${setId}:${puzzleId}`;
}

export function parseStudyPuzzleRoomId(roomId: string | null | undefined): StudyPuzzleRoute | null {
  if (!roomId?.startsWith(PREFIX)) return null;
  const [setId, puzzleId, ...rest] = roomId.slice(PREFIX.length).split(":");
  if (!setId || !puzzleId || rest.length > 0 || !ID.test(setId) || !ID.test(puzzleId)) return null;
  return { setId, puzzleId };
}

export type StudyPuzzleGame = {
  game: GameState;
  setId: string;
  puzzleId: string;
  /** The player always sits at A. */
  humanSide: "A";
};

const tile = (id: string, kind: string): TileInstance => ({ id, token: kind as AmathToken });

/** The projection as a Play-page game: the player (A) to move, nothing played yet. */
export function studyPuzzleGame(
  puzzle: PlayerPuzzle,
  {
    playerName = "คุณ",
    now = new Date().toISOString(),
  }: { playerName?: string; now?: string } = {},
): StudyPuzzleGame {
  const { position } = puzzle;
  const board = createBoard();
  position.board.forEach((cell, index) => {
    const row = board[cell.r];
    if (!row) return;
    row[cell.c] = {
      tile: {
        id: `board-${index}`,
        token: cell.kind as AmathToken,
        ...(CHOICE_KINDS.has(cell.kind) ? { assignedToken: cell.face } : {}),
      },
      placedTurn: 0,
      side: "B",
    };
  });
  const unseen = Object.entries(position.unseen)
    .flatMap(([kind, count]) => Array.from({ length: count }, () => kind))
    .sort((a, b) => (RANK.get(a as AmathToken) ?? 0) - (RANK.get(b as AmathToken) ?? 0));
  if (unseen.length !== position.bagCount + position.oppRackCount) {
    throw new Error("the puzzle's unseen tiles do not match its counts");
  }
  const game: GameState = {
    commitId: "",
    gameId: `study-${puzzle.setId}-${puzzle.puzzleId}`,
    revision: 0,
    name: "Find Best Play",
    gameMode: "versus",
    players: { A: playerName, B: "คู่แข่ง" },
    emailPlayersCanSeeOpponentRack: false,
    roomStage: "playing",
    startingSide: "A",
    tileDrawMode: "play",
    turnNumber: position.turnNumber,
    activeSide: "A",
    phase: "choose_action",
    status: "playing",
    boardSize: board.length,
    board,
    rackA: position.rack.map((kind, index) => tile(`rack-${index}`, kind)),
    // Counts right, contents a stand-in — see the header.
    rackB: unseen.slice(position.bagCount).map((kind, index) => tile(`unseen-held-${index}`, kind)),
    tilebag: unseen.slice(0, position.bagCount).map((kind, index) => tile(`unseen-${index}`, kind)),
    pendingExchangeReturn: [],
    timers: { A: 0, B: 0, initialSeconds: 0, paused: true, minSeconds: 0, untimed: true },
    scores: { A: position.scores.self, B: position.scores.opponent },
    logs: [],
    currentTurnStartedAt: now,
    createdAt: now,
    history: [],
    historyIndex: 0,
    lastSavedAt: now,
  };
  return { game, setId: puzzle.setId, puzzleId: puzzle.puzzleId, humanSide: "A" };
}

/** The tile bag panel: the whole unseen pool, never the stand-in bag on its own. */
export function studyTilebagView(game: GameState): TilebagView {
  const held = game.rackB;
  const pooled = game.tilebag.length < RACK_SIZE - held.length;
  return {
    tiles: [...game.tilebag, ...held],
    listKind: "unseen",
    remainingCount: pooled ? game.tilebag.length + held.length : game.tilebag.length,
    kind: pooled ? (game.tilebag.length === 0 ? "opponent-rack" : "unseen") : "bag",
  };
}

/** The placement a Play-page turn made, as the server takes a submission. */
export function studyPlacementsFromLog(log: TurnLog): PuzzleCell[] | null {
  if (log.action !== "place_equation") return null;
  const detail = log.actionDetail as PlaceEquationDetail;
  return detail.placedTiles.map((placed) => ({
    r: placed.row,
    c: placed.col,
    kind: placed.token,
    face: CHOICE_KINDS.has(placed.token) ? (placed.assignedToken ?? placed.token) : placed.token,
  }));
}
