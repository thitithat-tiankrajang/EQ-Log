import {
  createInitialTilebag,
  createNewGame,
  makeSnapshot,
  tileNeedsAssignment,
  type AmathToken,
  type GameState,
  type TileInstance,
} from "../../game";
import reference from "./reference-endgame.json";

function random(seed: number): () => number {
  let n = seed >>> 0;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

function kindOf(id: string): AmathToken {
  return id.slice(0, id.lastIndexOf("#")) as AmathToken;
}

/** A draft stage from a real endgame: the seed redistributes its nine unplayed tiles. */
export function createSurvivalTestGame(
  seed: number,
  playerName: string,
  userId?: string,
): GameState {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("Stage seed must be a whole number.");
  const game = createNewGame({
    name: `Survival test · seed ${seed}`,
    playerA: playerName,
    playerB: "Authur",
    ...(userId ? { playerAUserId: userId } : {}),
    startingSide: "A",
    botSide: "B",
    botEngine: "authur",
    botDifficulty: "super",
    tileDrawMode: "play",
    untimed: true,
  });
  const copies = new Map<AmathToken, TileInstance[]>();
  for (const tile of createInitialTilebag()) {
    const list = copies.get(tile.token) ?? [];
    list.push(tile);
    copies.set(tile.token, list);
  }
  const take = (kind: AmathToken, face?: string): TileInstance => {
    const tile = copies.get(kind)?.shift();
    if (!tile) throw new Error(`Stage inventory mismatch: ${kind}`);
    return tileNeedsAssignment(kind) ? { ...tile, assignedToken: face } : tile;
  };
  game.board = reference.board.reduce<GameState["board"]>((board, placed, cell) => {
    if (placed) {
      board[Math.floor(cell / 15)]![cell % 15] = {
        tile: take(placed.kind as AmathToken, placed.face),
        side: placed.side as "A" | "B",
        placedTurn: placed.turn,
      };
    }
    return board;
  }, game.board);
  const remaining = [...reference.racks.A, ...reference.racks.B].map(kindOf);
  const next = random(seed);
  for (let index = remaining.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [remaining[index], remaining[swap]] = [remaining[swap]!, remaining[index]!];
  }
  game.rackA = remaining.slice(0, reference.racks.A.length).map((kind) => take(kind));
  game.rackB = remaining.slice(reference.racks.A.length).map((kind) => take(kind));
  if ([...copies.values()].some((tiles) => tiles.length > 0)) {
    throw new Error("Stage did not allocate all 100 tiles.");
  }
  game.tilebag = [];
  game.scores = { A: reference.scores.A, B: reference.scores.B };
  game.turnNumber = reference.turnNumber;
  game.activeSide = "A";
  game.phase = "choose_action";
  game.history = [makeSnapshot(game)];
  game.historyIndex = 0;
  return game;
}
