// A Survival view as a Play-page game.
//
// The Play page renders a GameState, and a Survival session never has the real
// one on this side: the server keeps it and sends the player's view. This
// module builds a GameState from that view alone, so every Play-page component
// — board, rack, turn log, tile bag, shortcuts — works unchanged while nothing
// the player cannot see is ever in it.
//
//   board, scores, turn, the player's rack   exactly the view
//   the turn log                             rebuilt from the public moves, from
//                                            the first turn of the source game;
//                                            racks appear only on the player's
//                                            own turns after the takeover
//   tilebag + Authur's rack                  TOGETHER exactly the unseen pool
//                                            (the 100 tiles − board − your rack),
//                                            split to the right COUNTS. The split
//                                            itself is arbitrary and means
//                                            nothing: which unseen tile is in the
//                                            bag and which in Authur's hand is the
//                                            one thing the player cannot know. So
//                                            neither half may ever be shown alone —
//                                            the Play page shows the pool combined
//                                            (`survivalTilebagView`) and never
//                                            shows Authur's rack.
import {
  AMATH_TOKENS,
  boardWithPending,
  createBoard,
  createPlaceDetail,
  tileNeedsAssignment,
  validateMove,
  type AmathToken,
  type BoardSnapshot,
  type EndGameDetail,
  type ExchangeDetail,
  type GameState,
  type PassDetail,
  type PendingPlacement,
  type Side,
  type TileInstance,
  type TurnActionDetail,
  type TurnLog,
} from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import type { TilebagView } from "../../gameplay/tilebag";
import type { SurvivalEnding, SurvivalSeat, SurvivalTurn, SurvivalView } from "./api";

const SIZE = 15;
const KINDS = Object.keys(AMATH_TOKENS) as AmathToken[];
const RANK = new Map(KINDS.map((kind, index) => [kind, index]));
const NO_TIME: Record<Side, number> = { A: 0, B: 0 };

export type SurvivalGame = {
  game: GameState;
  attemptId: string;
  levelId: string;
  levelNumber: number;
  status: SurvivalView["status"];
  humanSide: Side;
  authurSide: Side;
  /** Turn number at which the player took over from Authur. */
  takeoverTurn: number;
};

type Kind = AmathToken;

/** Every tile not on `board` and not in `known`, sorted by kind. */
export function unseenPool(board: BoardSnapshot, known: readonly Kind[]): Kind[] {
  const counts = new Map<Kind, number>(KINDS.map((kind) => [kind, AMATH_TOKENS[kind].count]));
  const take = (kind: Kind) => {
    const left = (counts.get(kind) ?? 0) - 1;
    if (left < 0) throw new Error(`Survival view holds more ${kind} tiles than exist`);
    counts.set(kind, left);
  };
  for (const row of board) for (const cell of row) if (cell) take(cell.tile.token);
  for (const kind of known) take(kind);
  return KINDS.flatMap((kind) => Array<Kind>(counts.get(kind) ?? 0).fill(kind));
}

const tilesOf = (kinds: readonly Kind[], prefix: string): TileInstance[] =>
  kinds.map((kind, index) => ({ id: `${prefix}-${index}`, token: kind }));

const sortKinds = (kinds: readonly Kind[]) =>
  [...kinds].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0));

type AnyTurn = Omit<SurvivalTurn, "playedBy"> & { playedBy?: SurvivalTurn["playedBy"] };

function endingDetail(
  ending: SurvivalEnding,
  streak: number,
  view: SurvivalView,
  names: Record<SurvivalSeat, string>,
): EndGameDetail {
  const bonusSide = ending.bonusTo ? view.seats[ending.bonusTo] : undefined;
  const who = ending.bonusTo ? names[ending.bonusTo] : null;
  const description =
    ending.reason === "rack_out"
      ? `${who} ลงเบี้ยหมดราง · โบนัส +${ending.bonusPoints}`
      : who
        ? `ไม่มีแต้มติดกัน ${streak} ตา · ${who} ได้ +${ending.bonusPoints}`
        : `ไม่มีแต้มติดกัน ${streak} ตา · แต้มในรางเท่ากัน ไม่มีโบนัส`;
  return {
    reason: ending.reason,
    description,
    ...(bonusSide ? { bonusSide } : {}),
    bonusPoints: ending.bonusPoints,
    ...(ending.reason === "no_score_streak" ? { noScoreStreak: streak } : {}),
  };
}

/** The whole game, turn 1 onward, as turn logs; and the board it leads to. */
function rebuild(view: SurvivalView, names: Record<SurvivalSeat, string>, now: string) {
  const turns: { turn: AnyTurn; source: boolean }[] = [
    ...view.sourceLog.turns.map((turn) => ({ turn, source: true })),
    ...view.log.map((turn) => ({ turn, source: false })),
  ];
  const logs: TurnLog[] = [];
  let board = createBoard(SIZE);
  // The player's own rack, as far as the log has told it. Unknown (null)
  // throughout the source game: the player did not hold that seat then.
  let ownRack: Kind[] | null = null;
  for (const { turn: t, source } of turns) {
    const side = view.seats[t.seat];
    const id = `survival-${source ? "source" : view.attemptId}-t${t.turn}`;
    const own = !source && t.playedBy === "human";
    const rackBefore = own ? sortKinds((t.yourRackBefore ?? []).map((tile) => tile.kind)) : null;
    const knownBefore = rackBefore ?? ownRack ?? [];
    const before = board;
    let after = before;
    let detail: TurnActionDetail;
    if (t.type === "place") {
      const pending: PendingPlacement[] = (t.placements ?? []).map((p, index) => ({
        tile: { id: `${id}-p${index}`, token: p.kind },
        row: Math.floor(p.cell / SIZE),
        col: p.cell % SIZE,
        ...(tileNeedsAssignment(p.kind) ? { assignedToken: p.face } : {}),
      }));
      detail = createPlaceDetail(validateMove(before, pending), pending);
      after = boardWithPending(before, pending, t.turn, side);
    } else if (t.type === "exchange") {
      const exchanged: ExchangeDetail = own
        ? {
            outgoingTiles: tilesOf(
              (t.yourExchanged ?? []).map((tile) => tile.kind),
              `${id}-x`,
            ),
            incomingTiles: [],
          }
        : { outgoingTiles: [], incomingTiles: [], concealedCount: t.tilesExchanged ?? 0 };
      detail = exchanged;
    } else {
      detail = {} satisfies PassDetail;
    }
    const rackAfter = own ? sortKinds((t.yourRackAfter ?? []).map((tile) => tile.kind)) : null;
    if (rackAfter) ownRack = rackAfter;
    const knownAfter = rackAfter ?? ownRack ?? [];
    logs.push({
      id,
      turnNumber: t.turn,
      side,
      action: t.type === "place" ? "place_equation" : t.type === "exchange" ? "exchange" : "pass",
      startedAt: now,
      endedAt: now,
      timerBefore: NO_TIME,
      timerAfter: NO_TIME,
      rackBefore: rackBefore ? tilesOf(rackBefore, `${id}-rb`) : [],
      rackAfter: rackAfter ? tilesOf(rackAfter, `${id}-ra`) : [],
      // Before the takeover Authur played the player's seat too.
      ...(source && t.seat === "player" ? { playedByName: names.authur } : {}),
      boardBefore: before,
      boardAfter: after,
      // What the player could not see before and after this turn.
      tilebagBefore: tilesOf(unseenPool(before, knownBefore), `${id}-ub`),
      tilebagAfter: tilesOf(unseenPool(after, knownAfter), `${id}-ua`),
      actionDetail: detail,
      calculatedScore: t.scoreGained,
      finalScore: t.scoreGained,
    });
    if (t.ended) {
      const ending = endingDetail(t.ended, t.scorelessStreakAfter, view, names);
      logs.push({
        id: `${id}-end`,
        turnNumber: t.turn,
        side: ending.bonusSide ?? side,
        action: "end_game",
        startedAt: now,
        endedAt: now,
        timerBefore: NO_TIME,
        timerAfter: NO_TIME,
        rackBefore: [],
        rackAfter: [],
        boardBefore: after,
        boardAfter: after,
        tilebagBefore: tilesOf(unseenPool(after, knownAfter), `${id}-eb`),
        tilebagAfter: tilesOf(unseenPool(after, knownAfter), `${id}-ea`),
        actionDetail: ending,
        calculatedScore: ending.bonusPoints,
        finalScore: ending.bonusPoints,
      });
    }
    board = after;
  }
  return { logs, board };
}

/** The rebuilt board must be exactly the board the server sent. */
function assertSameBoard(board: BoardSnapshot, view: SurvivalView): void {
  let count = 0;
  for (const row of board) for (const cell of row) if (cell) count += 1;
  if (count !== view.board.length) throw new Error("Survival log does not rebuild the board");
  for (const tile of view.board) {
    const cell = board[Math.floor(tile.cell / SIZE)]?.[tile.cell % SIZE];
    const face = cell ? (cell.tile.assignedToken ?? AMATH_TOKENS[cell.tile.token].token) : null;
    const expected = tileNeedsAssignment(tile.kind) ? tile.face : AMATH_TOKENS[tile.kind].token;
    if (!cell || cell.tile.token !== tile.kind || face !== expected) {
      throw new Error(`Survival log does not rebuild the board at cell ${tile.cell}`);
    }
  }
}

export function survivalGameFromView(
  view: SurvivalView,
  {
    playerName = "คุณ",
    now = new Date().toISOString(),
  }: { playerName?: string; now?: string } = {},
): SurvivalGame {
  const human = view.seats.player;
  const authur = view.seats.authur;
  const names: Record<SurvivalSeat, string> = { player: playerName, authur: "Authur" };
  const { logs, board } = rebuild(view, names, now);
  assertSameBoard(board, view);
  const unseen = unseenPool(
    board,
    view.rack.map((tile) => tile.kind),
  );
  if (unseen.length !== view.bagCount + view.authurRackCount) {
    throw new Error("Survival view does not account for all 100 tiles");
  }
  const rack: TileInstance[] = view.rack.map((tile) => ({ id: tile.id, token: tile.kind }));
  // Counts right, contents a stand-in — see the header.
  const bag = tilesOf(unseen.slice(0, view.bagCount), "survival-unseen");
  const authurRack = tilesOf(unseen.slice(view.bagCount), "survival-unseen-held");
  const activeSide = view.status === "authur-to-move" ? authur : human;
  const racks: Record<Side, TileInstance[]> = { [human]: rack, [authur]: authurRack } as Record<
    Side,
    TileInstance[]
  >;
  const game: GameState = {
    commitId: "",
    gameId: `survival-${view.attemptId}`,
    revision: logs.length,
    name: `Survival · ด่าน ${view.level.number}`,
    gameMode: "versus",
    players: { [human]: playerName, [authur]: "Authur" } as Record<Side, string>,
    emailPlayersCanSeeOpponentRack: false,
    roomStage: "playing",
    startingSide: view.seats[view.sourceLog.start.seat],
    tileDrawMode: "play",
    turnNumber: view.turnNumber,
    activeSide,
    phase: "choose_action",
    status: view.status === "finished" ? "finished" : "playing",
    boardSize: SIZE,
    board,
    rackA: racks.A,
    rackB: racks.B,
    tilebag: bag,
    pendingExchangeReturn: [],
    timers: { A: 0, B: 0, initialSeconds: 0, paused: true, minSeconds: 0, untimed: true },
    scores: { [human]: view.scores.player, [authur]: view.scores.authur } as Record<Side, number>,
    logs,
    currentTurnStartedAt: now,
    createdAt: now,
    history: [],
    historyIndex: 0,
    lastSavedAt: now,
  };
  return {
    game,
    attemptId: view.attemptId,
    levelId: view.level.id,
    levelNumber: view.level.number,
    status: view.status,
    humanSide: human,
    authurSide: authur,
    takeoverTurn: view.sourceLog.takeover.turn,
  };
}

/**
 * The tile bag panel for a Survival game: always the unseen pool, never the
 * bag on its own (which would reveal Authur's rack by subtraction).
 *
 *   live      the pool now, counted as the real bag
 *   a turn    the pool as the player saw it before that turn
 */
export function survivalTilebagView(
  game: GameState,
  authurSide: Side,
  selectedLog: TurnLog | null,
): TilebagView {
  if (selectedLog) {
    return {
      tiles: selectedLog.tilebagBefore,
      listKind: "unseen",
      remainingCount: selectedLog.tilebagBefore.length,
      kind: "unseen",
    };
  }
  const held = authurSide === "A" ? game.rackA : game.rackB;
  // The Play page's own rule, from the player's seat: while the bag can still
  // refill Authur's rack the count is the bag; once it cannot, the only honest
  // count is the whole unseen pool, which with the bag empty IS Authur's rack.
  const pooled = game.tilebag.length < RACK_SIZE - held.length;
  return {
    tiles: [...game.tilebag, ...held],
    listKind: "unseen",
    remainingCount: pooled ? game.tilebag.length + held.length : game.tilebag.length,
    kind: pooled ? (game.tilebag.length === 0 ? "opponent-rack" : "unseen") : "bag",
  };
}

/** A committed Play-page turn as the move the server takes. */
export function survivalMoveFromLog(
  log: TurnLog,
):
  | { type: "place"; placements: { tileId: string; cell: number; face?: string }[] }
  | { type: "exchange"; tileIds: string[] }
  | { type: "pass" }
  | null {
  if (log.action === "place_equation") {
    const detail = log.actionDetail as ReturnType<typeof createPlaceDetail>;
    return {
      type: "place",
      placements: detail.placedTiles.map((tile) => ({
        tileId: tile.tileId,
        cell: tile.row * SIZE + tile.col,
        ...(tileNeedsAssignment(tile.token) && tile.assignedToken
          ? { face: tile.assignedToken }
          : {}),
      })),
    };
  }
  if (log.action === "exchange") {
    return {
      type: "exchange",
      tileIds: (log.actionDetail as ExchangeDetail).outgoingTiles.map((tile) => tile.id),
    };
  }
  if (log.action === "pass") return { type: "pass" };
  return null;
}
