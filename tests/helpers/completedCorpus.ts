import {
  calculateTotals,
  createInitialTilebag,
  createNewGame,
  deepClone,
  displayToken,
  getAssignmentOptions,
  makeSnapshot,
  validateMove,
  type GameState,
  type PendingPlacement,
  type TileInstance,
} from "../../src/game";
import { applyRankedAction } from "../../src/features/ranked/rules";
import { vi } from "vitest";
import { inventoryFrom } from "../../src/domain/projection";
import longTrace from "../fixtures/completed-legal-long.json";
import rackoutTrace from "../fixtures/completed-legal-rackout.json";

type FrozenAction =
  | { kind: "place"; placements: Array<{ kind: string; row: number; col: number; face: string }> }
  | { kind: "exchange"; kinds: string[] }
  | { kind: "pass" };

/** Frozen engine-selected intents; each is rechecked by EQ-Lab's current validator. */
export function frozenLegalGame(
  kind: "long" | "rackout",
  requestedTurns: number,
  finish = false,
): GameState {
  const source = kind === "long" ? longTrace : rackoutTrace;
  if (requestedTurns > source.actions.length)
    throw new RangeError("Frozen trace is shorter than requested.");
  let randomState = source.seed >>> 0;
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const values = array as Uint32Array;
    for (let index = 0; index < values.length; index++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      values[index] = randomState;
    }
    return array;
  });
  try {
    let current = createNewGame({
      name: "Frozen legal game",
      playerA: "Ann",
      playerB: "Ben",
      startingSide: "A",
      tileDrawMode: "play",
      minutes: 20,
    });
    current.gameId = "frozen-legal-game";
    current.createdAt = "2026-01-01T00:00:00.000Z";
    current.currentTurnStartedAt = current.createdAt;
    current.history = [makeSnapshot(current)];
    current.history[0]!.commitId = "genesis";
    current.historyIndex = 0;
    for (let index = 0; index < requestedTurns; index++) {
      if (current.status !== "playing") throw new Error("Frozen trace continues after completion.");
      const frozen = source.actions[index] as FrozenAction;
      const rack = current.activeSide === "A" ? current.rackA : current.rackB;
      let action: Parameters<typeof applyRankedAction>[2];
      if (frozen.kind === "place") {
        const used = new Set<string>();
        const placements = frozen.placements.map(({ kind: token, row, col, face }) => {
          const tile = rack.find(
            (candidate) => candidate.token === token && !used.has(candidate.id),
          );
          if (!tile) throw new Error(`Frozen trace lacks physical tile ${token}.`);
          used.add(tile.id);
          return {
            tileId: tile.id,
            row,
            col,
            assignedToken: getAssignmentOptions(tile.token).length ? face : undefined,
          };
        });
        const verdict = validateMove(
          current.board,
          placements.map((placement) => ({
            ...placement,
            tile: rack.find((tile) => tile.id === placement.tileId)!,
          })),
        );
        if (!verdict.isValid)
          throw new Error(`Frozen placement ${index + 1} is illegal: ${verdict.errors.join(" ")}`);
        action = { kind: "place", placements };
      } else if (frozen.kind === "exchange") {
        const used = new Set<string>();
        action = {
          kind: "exchange",
          tileIds: frozen.kinds.map((kind) => {
            const tile = rack.find(
              (candidate) => candidate.token === kind && !used.has(candidate.id),
            );
            if (!tile) throw new Error(`Frozen exchange lacks physical tile ${kind}.`);
            used.add(tile.id);
            return tile.id;
          }),
        };
      } else {
        action = { kind: "pass" };
      }
      const now = new Date(Date.parse(current.createdAt) + (index + 1) * 1000).toISOString();
      const next = applyRankedAction(current, current.activeSide, action, now);
      const log = next.logs[current.logs.length]!;
      if (action.kind === "place") {
        const sameVerdict = validateMove(
          current.board,
          action.placements.map((placement) => ({
            ...placement,
            tile: rack.find((tile) => tile.id === placement.tileId)!,
          })),
        );
        if (log.calculatedScore !== sameVerdict.score || log.finalScore !== sameVerdict.score)
          throw new Error(`Frozen placement ${index + 1} score drifted.`);
      }
      log.id = `turn-${index + 1}`;
      if (next.status === "finished") {
        const end = next.logs.at(-1)!;
        end.id = `end-${index + 1}`;
        end.endedAt = now;
      }
      next.currentTurnStartedAt = now;
      next.history = [...current.history, makeSnapshot(next)];
      next.history.at(-1)!.commitId = `snapshot-${index + 1}`;
      next.historyIndex = next.history.length - 1;
      inventoryFrom(next);
      const totals = calculateTotals(next.logs);
      if (next.scores.A !== totals.A || next.scores.B !== totals.B)
        throw new Error(`Frozen action ${index + 1} total score drifted.`);
      current = next;
    }
    if (finish && current.status === "playing") {
      const now = new Date(
        Date.parse(current.createdAt) + (requestedTurns + 1) * 1000,
      ).toISOString();
      const next = applyRankedAction(current, current.activeSide, { kind: "resign" }, now);
      next.logs.at(-1)!.id = `end-${requestedTurns + 1}`;
      next.logs.at(-1)!.endedAt = now;
      next.currentTurnStartedAt = now;
      next.history = [...current.history, makeSnapshot(next)];
      next.history.at(-1)!.commitId = `snapshot-${requestedTurns + 1}`;
      next.historyIndex = next.history.length - 1;
      inventoryFrom(next);
      current = next;
    }
    return current;
  } finally {
    random.mockRestore();
  }
}

type Placement = { tileId: string; row: number; col: number; assignedToken?: string };
const equations: string[][] = (() => {
  const result: string[][] = [];
  for (let a = 0; a <= 20; a++) {
    for (let b = 0; b <= 20; b++) {
      for (const [symbol, answer] of [
        ["+", a + b],
        ["-", a - b],
        ["×", a * b],
      ] as const) {
        if (answer >= 0 && answer <= 20)
          result.push([String(a), symbol, String(b), "=", String(answer)]);
      }
    }
  }
  return result;
})();

/** Fixture-only candidate search. validateMove and applyRankedAction remain the rules authority. */
function legalPlacement(game: GameState, salt: number): Placement[] | null {
  const rack = game.activeSide === "A" ? game.rackA : game.rackB;
  const occupied = game.board.some((row) => row.some(Boolean));
  let chosen: { action: Placement[]; rank: number } | null = null;
  for (const vertical of [false, true]) {
    for (let lane = 0; lane < 15; lane++) {
      for (let start = 0; start <= 10; start++) {
        if (!occupied && lane !== 7) continue;
        if (!occupied && !(start <= 7 && start + 4 >= 7)) continue;
        const cells = Array.from({ length: 5 }, (_, offset) => ({
          row: vertical ? start + offset : lane,
          col: vertical ? lane : start + offset,
        }));
        const old = cells.map(({ row, col }) => game.board[row]![col]);
        const oldCount = old.filter(Boolean).length;
        const needed = 5 - oldCount;
        if (needed < 1 || needed > rack.length || (occupied && oldCount === 0)) continue;
        for (
          let patternIndex = salt % equations.length, seen = 0;
          seen < equations.length;
          seen++, patternIndex = (patternIndex + 1) % equations.length
        ) {
          const pattern = equations[patternIndex]!;
          if (old.some((cell, index) => cell && displayToken(cell.tile) !== pattern[index]))
            continue;
          const used = new Set<string>();
          const pending: PendingPlacement[] = [];
          for (let index = 0; index < 5; index++) {
            if (old[index]) continue;
            const face = pattern[index]!;
            const tile = rack.find(
              (candidate) =>
                !used.has(candidate.id) &&
                (displayToken(candidate) === face ||
                  getAssignmentOptions(candidate.token).includes(face)),
            );
            if (!tile) break;
            used.add(tile.id);
            const assignedToken = getAssignmentOptions(tile.token).length ? face : undefined;
            pending.push({ tile, ...cells[index]!, assignedToken });
          }
          if (pending.length !== needed || !validateMove(game.board, pending).isValid) continue;
          const rank = needed * 1000 + ((patternIndex + salt * 17 + lane * 23 + start * 31) % 997);
          if (!chosen || rank < chosen.rank) {
            chosen = {
              rank,
              action: pending.map(({ tile, row, col, assignedToken }) => ({
                tileId: tile.id,
                row,
                col,
                assignedToken,
              })),
            };
          }
          // A one-tile move is already the minimum; avoid searching the full catalog.
          if (needed === 1) return chosen.action;
        }
      }
    }
  }
  return chosen?.action ?? null;
}

/** Seeded initial deal and seeded production draw/exchange shuffles; no fabricated actions. */
export function legalPlacementGame(seed: number, requestedTurns: number): GameState {
  let randomState = seed >>> 0;
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const values = array as Uint32Array;
    for (let index = 0; index < values.length; index++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      values[index] = randomState;
    }
    return array;
  });
  try {
    let current = createNewGame({
      name: `Legal placement corpus ${seed}`,
      playerA: "Ann",
      playerB: "Ben",
      startingSide: "A",
      tileDrawMode: "play",
      minutes: 20,
    });
    current.gameId = `legal-placement-${seed}`;
    current.createdAt = "2026-01-01T00:00:00.000Z";
    current.currentTurnStartedAt = current.createdAt;
    current.history = [makeSnapshot(current)];
    current.history[0]!.commitId = "genesis";
    current.historyIndex = 0;
    let noScore = 0;
    for (let index = 0; index < requestedTurns && current.status === "playing"; index++) {
      const now = new Date(Date.parse(current.createdAt) + (index + 1) * 1000).toISOString();
      const move = legalPlacement(current, seed + index * 13);
      const scheduledNoScore = index > 0 && index % 3 !== 0 && noScore < 4;
      const action =
        scheduledNoScore || !move
          ? index % 7 === 2 && current.tilebag.length >= 6
            ? {
                kind: "exchange" as const,
                tileIds: [(current.activeSide === "A" ? current.rackA : current.rackB)[0]!.id],
              }
            : { kind: "pass" as const }
          : { kind: "place" as const, placements: move };
      const next = applyRankedAction(current, current.activeSide, action, now);
      noScore = action.kind === "place" ? 0 : noScore + 1;
      next.currentTurnStartedAt = now;
      next.logs.at(-1)!.id = `turn-${index + 1}`;
      next.history = [...current.history, makeSnapshot(next)];
      next.history.at(-1)!.commitId = `snapshot-${index + 1}`;
      next.historyIndex = next.history.length - 1;
      current = next;
    }
    return current;
  } finally {
    random.mockRestore();
  }
}

/** Deterministic legal-action corpus. Passes are legal; deliberately label them pass-heavy. */
export function legalPassGame(turns: number): GameState {
  const game = createNewGame({
    name: "Legal pass-heavy corpus",
    playerA: "Ann",
    playerB: "Ben",
    startingSide: "A",
    tileDrawMode: "play",
    minutes: 20,
  });
  const inventory = createInitialTilebag();
  game.rackA = inventory.slice(0, 8);
  game.rackB = inventory.slice(8, 16);
  game.tilebag = inventory.slice(16);
  game.gameId = "corpus-legal-pass";
  game.currentTurnStartedAt = "2026-01-01T00:00:00.000Z";
  game.createdAt = game.currentTurnStartedAt;
  game.history = [makeSnapshot(game)];
  game.history[0]!.commitId = "genesis";
  game.historyIndex = 0;
  let current = game;
  for (let index = 0; index < turns; index++) {
    const now = new Date(Date.parse(game.createdAt) + (index + 1) * 1000).toISOString();
    const next = applyRankedAction(current, current.activeSide, { kind: "pass" }, now);
    next.currentTurnStartedAt = now;
    next.logs.at(-1)!.id = `turn-${index + 1}`;
    next.history = [...current.history, makeSnapshot(next)];
    next.history.at(-1)!.commitId = `snapshot-${index + 1}`;
    next.historyIndex = next.history.length - 1;
    next.lastSavedAt = now;
    current = next;
  }
  return current;
}

/** One equation validated by the same production action path. */
export function legalEquationGame(): GameState {
  const game = legalPassGame(0);
  const all = createInitialTilebag();
  const used = new Set<string>();
  const take = (token: string): TileInstance => {
    const tile = all.find((candidate) => candidate.token === token && !used.has(candidate.id));
    if (!tile) throw new Error(`Missing ${token}`);
    used.add(tile.id);
    return tile;
  };
  game.rackA = [
    take("1"),
    take("+"),
    take("1"),
    take("="),
    take("2"),
    take("3"),
    take("4"),
    take("5"),
  ];
  game.rackB = [
    take("6"),
    take("7"),
    take("8"),
    take("9"),
    take("0"),
    take("-"),
    take("x"),
    take("/"),
  ];
  game.tilebag = all.filter((tile) => !used.has(tile.id));
  game.history = [makeSnapshot(game)];
  const placements = game.rackA
    .slice(0, 5)
    .map((tile, col) => ({ tileId: tile.id, row: 7, col: 5 + col }));
  const next = applyRankedAction(
    game,
    "A",
    { kind: "place", placements },
    "2026-01-01T00:00:01.000Z",
  );
  next.currentTurnStartedAt = "2026-01-01T00:00:01.000Z";
  next.logs[0]!.id = "equation-1";
  next.history = [deepClone(game.history[0]!), makeSnapshot(next)];
  next.historyIndex = 1;
  return next;
}

export function finishedLegalPassGame(turns: number): GameState {
  const game = legalPassGame(turns);
  const now = new Date(Date.parse(game.createdAt) + (turns + 1) * 1000).toISOString();
  const next = applyRankedAction(game, game.activeSide, { kind: "resign" }, now);
  next.logs.at(-1)!.id = `finish-${turns + 1}`;
  next.currentTurnStartedAt = now;
  next.history = [...game.history, makeSnapshot(next)];
  next.history.at(-1)!.commitId = `snapshot-${turns + 1}`;
  next.historyIndex = next.history.length - 1;
  next.lastSavedAt = now;
  return next;
}
