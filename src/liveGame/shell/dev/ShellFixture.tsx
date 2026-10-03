/**
 * DEVELOPMENT ONLY — never part of a production build (AppRoot loads
 * DevelopmentSources only under import.meta.env.DEV).
 *
 * Deterministic positions for visual review of the live shell. Every view is
 * produced by the real pipeline: the trusted reducers (applyRankedAction,
 * applyLiveControl, applyPhysicalAction) change a local GameState, and the
 * browser receives only what projectLiveGame builds for the chosen viewer —
 * the same recipient projection the server returns.
 */
import { useMemo } from "react";
import { createNewGame, type AmathToken, type GameState, type Side } from "../../../game";
import { applyRankedAction, type RankedAction } from "../../../features/ranked/rules";
import { resolveLiveCapabilities, type LiveAuthorityFacts } from "../../capabilities";
import { applyLiveControl, type LiveControl } from "../../controls";
import { applyHostedAction, type HostedAction } from "../../hostedAdmin";
import { applyPhysicalAction, type PhysicalAction } from "../../physical";
import { projectLiveGame } from "../../projection";
import { EMPTY_MULTIVERSE } from "../../../gameplay/multiverse";
import { LiveGameScreen } from "../LiveGameScreen";
import type { MatchClient } from "../model";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HOST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * Put exactly these tokens on a side's rack. Tiles may come from the bag or the
 * other rack (which is topped back up from the bag), so a fixture never depends
 * on the random deal.
 */
function give(game: GameState, side: Side, tokens: AmathToken[]) {
  const own = side === "A" ? "rackA" : "rackB";
  const other = side === "A" ? "rackB" : "rackA";
  const otherSize = game[other].length;
  const pool = [...game.tilebag, ...game[own], ...game[other]];
  // Lowest ID per token, so a reloaded fixture hands out the same tiles.
  const byId = [...pool].sort((a, b) => a.id.localeCompare(b.id));
  const rack = tokens.map((token) => {
    const tile = byId.find((item) => item.token === token && pool.includes(item));
    const index = tile ? pool.indexOf(tile) : -1;
    if (index < 0) throw new Error(`fixture: no ${token} left`);
    return pool.splice(index, 1)[0]!;
  });
  const kept = game[other].filter((tile) => pool.includes(tile));
  const rest = pool.filter((tile) => !kept.includes(tile));
  game[own] = rack;
  game[other] = [...kept, ...rest.splice(0, otherSize - kept.length)];
  game.tilebag = rest;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();

type Fixture = { game: GameState; facts: LiveAuthorityFacts };

function direct(): Fixture {
  const game = createNewGame({
    name: "Friday ladder · Board 3",
    gameMode: "versus",
    playerA: "Nok",
    playerB: "Pim",
    playerAUserId: A,
    playerBUserId: B,
    emailPlayMode: "direct",
    startingSide: "A",
    timerMinutes: { A: 22, B: 22 },
  });
  game.currentTurnStartedAt = minutesAgo(9);
  return {
    game,
    facts: {
      ownerId: A,
      seats: { A, B },
      mode: "online_versus",
      purpose: "normal",
      authorityProtocol: "server-v1",
      revision: 1,
    },
  };
}

function place(
  game: GameState,
  side: Side,
  cells: [AmathToken, number, number, string?][],
  rest: AmathToken[],
  at: number,
) {
  give(game, side, [...cells.map((cell) => cell[0]), ...rest]);
  const rack = side === "A" ? game.rackA : game.rackB;
  const used = new Set<string>();
  const action: RankedAction = {
    kind: "place",
    placements: cells.map(([token, row, col, face]) => {
      const tile = rack.find((item) => item.token === token && !used.has(item.id))!;
      used.add(tile.id);
      return { tileId: tile.id, row, col, ...(face ? { assignedToken: face } : {}) };
    }),
  };
  return applyRankedAction(game, side, action, minutesAgo(at), "normal");
}

/** A short, legal opening: 12=4×3, an exchange, 9−6=3, 1+8=9. A is to move. */
function opening(): Fixture {
  const fixture = direct();
  let game = place(
    fixture.game,
    "A",
    [
      ["12", 7, 5],
      ["=", 7, 6],
      ["4", 7, 7],
      ["x", 7, 8],
      ["3", 7, 9],
    ],
    ["7", "+", "0"],
    8,
  );
  give(game, "B", ["5", "5", "/", "?", "=", "2", "6", "+"]);
  game = applyRankedAction(
    game,
    "B",
    { kind: "exchange", tileIds: game.rackB.slice(0, 3).map((tile) => tile.id) },
    minutesAgo(7),
    "normal",
  );
  game = place(
    game,
    "A",
    [
      ["9", 3, 9],
      ["-", 4, 9],
      ["6", 5, 9],
      ["=", 6, 9],
    ],
    ["2", "+", "7", "0"],
    5,
  );
  game = place(
    game,
    "B",
    [
      ["1", 3, 5],
      ["+", 3, 6],
      ["8", 3, 7],
      ["=", 3, 8],
    ],
    ["5", "?", "/", "2"],
    3,
  );
  give(game, "A", ["7", "5", "+", "2", "0", "14", "x", "="]);
  game.currentTurnStartedAt = minutesAgo(0.6);
  return { ...fixture, game };
}

/** Line extensions that keep any true equation true: after its last number, or before its first. */
const APPEND: [AmathToken, AmathToken][] = [
  ["x", "1"],
  ["+", "0"],
  ["-", "0"],
  ["/", "1"],
];
const PREPEND: [AmathToken, AmathToken][] = [
  ["1", "x"],
  ["0", "+"],
];

/** Maximal runs of two or more tiles, longest first. */
function lines(game: GameState) {
  const size = game.board.length;
  const out: { cells: [number, number][]; across: boolean }[] = [];
  for (const across of [true, false])
    for (let a = 0; a < size; a += 1) {
      let run: [number, number][] = [];
      for (let b = 0; b <= size; b += 1) {
        const [row, col] = across ? [a, b] : [b, a];
        if (b < size && game.board[row][col]) run.push([row, col]);
        else {
          if (run.length >= 2) out.push({ cells: run, across });
          run = [];
        }
      }
    }
  return out.sort((x, y) => y.cells.length - x.cells.length);
}

/** One legal scoring play that lengthens an existing equation, or null. */
function extend(game: GameState, side: Side, at: number): GameState | null {
  const size = game.board.length;
  const free = (row: number, col: number) =>
    row >= 0 && col >= 0 && row < size && col < size && !game.board[row][col];
  for (const { cells, across } of lines(game)) {
    const [r0, c0] = cells[0];
    const [r1, c1] = cells[cells.length - 1];
    const step = (row: number, col: number, n: number): [number, number] =>
      across ? [row, col + n] : [row + n, col];
    const tries: [AmathToken, number, number][][] = [
      ...APPEND.map(([op, digit]) => {
        const [ra, ca] = step(r1, c1, 1);
        const [rb, cb] = step(r1, c1, 2);
        return [
          [op, ra, ca],
          [digit, rb, cb],
        ] as [AmathToken, number, number][];
      }),
      ...PREPEND.map(([digit, op]) => {
        const [ra, ca] = step(r0, c0, -2);
        const [rb, cb] = step(r0, c0, -1);
        return [
          [digit, ra, ca],
          [op, rb, cb],
        ] as [AmathToken, number, number][];
      }),
    ];
    for (const cellsToPlace of tries) {
      if (!cellsToPlace.every(([, row, col]) => free(row, col))) continue;
      const before = structuredClone(game);
      try {
        const rest = before.tilebag.slice(0, 6).map((tile) => tile.token);
        return place(before, side, cellsToPlace, rest, at);
      } catch {
        // Not legal here (a cross-word, or the tokens are used up): try the next.
      }
    }
  }
  return null;
}

/**
 * A long game for the Turn Log: the opening, then rounds of a scoring play
 * that lengthens an equation (so one line grows long), an Exchange and a
 * Pass — never enough scoreless turns in a row to end the game.
 */
function longGame(): Fixture {
  const fixture = opening();
  let game = fixture.game;
  let minutes = 60;
  for (let round = 0; round < 40 && game.status === "playing"; round += 1) {
    const side = game.activeSide;
    minutes -= 1;
    const kind = round % 3;
    if (kind === 0) {
      const next = extend(game, side, minutes);
      if (!next) break;
      game = next;
    } else if (kind === 1) {
      const rack = side === "A" ? game.rackA : game.rackB;
      game = applyRankedAction(
        game,
        side,
        { kind: "exchange", tileIds: rack.slice(0, 2).map((tile) => tile.id) },
        minutesAgo(minutes),
        "normal",
      );
    } else game = applyRankedAction(game, side, { kind: "pass" }, minutesAgo(minutes), "normal");
  }
  if (game.activeSide !== "A")
    game = applyRankedAction(game, "B", { kind: "pass" }, minutesAgo(1), "normal");
  game.currentTurnStartedAt = minutesAgo(0.4);
  return { ...fixture, game };
}

function build(state: string): Fixture {
  if (state === "long") return longGame();
  if (state === "untimed") {
    const fixture = opening();
    fixture.game.timers = { ...fixture.game.timers, untimed: true };
    return fixture;
  }
  if (state === "exchanged") {
    const fixture = direct();
    let game = place(
      fixture.game,
      "A",
      [
        ["12", 7, 5],
        ["=", 7, 6],
        ["4", 7, 7],
        ["x", 7, 8],
        ["3", 7, 9],
      ],
      ["7", "+", "0"],
      4,
    );
    game = applyRankedAction(
      game,
      "B",
      { kind: "exchange", tileIds: game.rackB.slice(0, 4).map((tile) => tile.id) },
      minutesAgo(2),
      "normal",
    );
    game.currentTurnStartedAt = minutesAgo(0.3);
    return { ...fixture, game };
  }
  const fixture = opening();
  let game = fixture.game;
  const control = (side: Side, action: LiveControl, at: number) => {
    const caps = resolveLiveCapabilities(fixture.facts, game, side === "A" ? A : B);
    game = applyLiveControl(
      game,
      EMPTY_MULTIVERSE,
      fixture.facts,
      caps,
      action,
      minutesAgo(at),
    ).game;
  };
  if (state === "alternatives") {
    // A rack with every kind of alternative tile: +/−, ×/÷ and a blank.
    give(game, "A", ["+/-", "x//", "?", "7", "5", "2", "=", "14"]);
  } else if (state === "thinking") {
    game = applyRankedAction(game, "A", { kind: "pass" }, minutesAgo(0.5), "normal");
    game.currentTurnStartedAt = minutesAgo(0.4);
  } else if (state === "pause-request") {
    control("B", { kind: "request-pause" }, 0.2);
  } else if (state === "paused") {
    control("B", { kind: "request-pause" }, 0.3);
    control(
      "A",
      {
        kind: "respond-pause",
        requestId: game.matchControl!.stopRequest!.id,
        accept: true,
      },
      0.2,
    );
  } else if (state === "finished") {
    game = applyRankedAction(game, "B", { kind: "resign" }, minutesAgo(0.2), "normal");
  } else if (state === "physical") {
    let physical = createNewGame({
      name: "Club night · Physical board",
      gameMode: "versus",
      playerA: "Nok",
      playerB: "Pim",
      playerAUserId: A,
      playerBUserId: B,
      emailPlayMode: "hosted",
      tileDrawMode: "manual",
      startingSide: "A",
      untimed: true,
    } as Parameters<typeof createNewGame>[0]);
    for (const side of ["A", "B"] as const)
      physical = applyPhysicalAction(physical, {
        kind: "refill",
        side,
        tokens:
          side === "A"
            ? ["12", "=", "4", "x", "3", "7", "+", "0"]
            : ["1", "+", "8", "=", "9", "-", "6", "2"],
      });
    return {
      game: physical,
      facts: {
        ownerId: HOST,
        seats: { A, B },
        mode: "hosted_versus",
        purpose: "normal",
        authorityProtocol: "server-v1",
        revision: 1,
      },
    };
  }
  return { ...fixture, game };
}

const ACTORS: Record<string, string> = { a: A, b: B, host: HOST };

/**
 * One shared game with a client per viewer, like the server with several
 * browsers attached: each client reads only its own recipient projection, and
 * every commit notifies subscribers (the stand-in for the commit broadcast).
 * Players act for their own seat only, as the server enforces.
 */
export function createFixtureSession(state: string) {
  let { game, facts } = build(state);
  let revision = 10;
  const listeners = new Set<() => void>();
  const now = () => new Date().toISOString();
  const project = (viewer: string) => {
    const current = { ...facts, revision };
    const caps = resolveLiveCapabilities(current, game, ACTORS[viewer] ?? A);
    return {
      match: projectLiveGame(
        `live-shell-fixture:${state}:${viewer}`,
        revision,
        game,
        caps.side,
        current.mode,
        caps.administer,
        false,
        caps,
        EMPTY_MULTIVERSE,
        current,
      ),
    };
  };
  const commit = (next: GameState) => {
    game = next;
    revision += 1;
    facts = { ...facts, revision };
    queueMicrotask(() => listeners.forEach((listener) => listener()));
  };
  const control = (viewer: string, action: LiveControl) => {
    const caps = resolveLiveCapabilities({ ...facts, revision }, game, ACTORS[viewer] ?? A);
    commit(applyLiveControl(game, EMPTY_MULTIVERSE, facts, caps, action, now()).game);
  };
  const seatOf = (viewer: string): Side => (viewer === "b" ? "B" : "A");
  return {
    get game() {
      return game;
    },
    get revision() {
      return revision;
    },
    act(side: Side, action: RankedAction) {
      commit(applyRankedAction(game, side, action, now(), "normal"));
    },
    control,
    clientFor(viewer: string): MatchClient {
      return {
        read: async () => project(viewer),
        subscribe: (_id, refresh) => {
          listeners.add(refresh);
          return () => listeners.delete(refresh);
        },
        action: async (_id, _revision, action: RankedAction) => {
          commit(applyRankedAction(game, seatOf(viewer), action, now(), "normal"));
          return project(viewer);
        },
        record: async (_id, _revision, side: Side, action: RankedAction) => {
          commit(applyRankedAction(game, side, action, now(), "normal"));
          return project(viewer);
        },
        control: async (_id, _revision, action: LiveControl) => {
          control(viewer, action);
          return project(viewer);
        },
        administer: async (_id, _revision, action: HostedAction) => {
          commit(applyHostedAction(game, action, now()));
          return project(viewer);
        },
        physical: async (_id, _revision, action: PhysicalAction) => {
          commit(applyPhysicalAction(game, action));
          return project(viewer);
        },
        ready: async () => project(viewer),
        cancel: async () => ({}),
      };
    },
  };
}

export default function ShellFixture({ state, viewer }: { state: string; viewer: string }) {
  const client = useMemo(() => createFixtureSession(state).clientFor(viewer), [state, viewer]);
  return (
    <LiveGameScreen
      matchId={`live-shell-fixture:${state}:${viewer}`}
      client={client}
      ranked={false}
    />
  );
}
