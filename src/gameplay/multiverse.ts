// Every line a game has been played along, not only the one on the board.
//
// A transcriber walks back to turn nine, tries the move that should have been played, and wants
// the move that WAS played kept too. A player against the bot wonders what would have happened
// if they had exchanged instead. Both are the same shape: a tree of turns, of which exactly one
// path is being played right now.
//
// ── The rule everything else rests on ──────────────────────────────────────────
//
// `game.logs` is ALWAYS one straight line: the line being played. Nothing in the game — scoring,
// the bot, the end-of-game rules, the archive, the stats — ever sees a branch, because none of it
// is handed one. The other lines are PARKED in a document beside the game (`Multiverse`), and a
// move never has to carry them: they are written when a line is parked or restored, and not on
// any ordinary turn. That is what keeps branching out of the speed of play.
//
// ── What a parked line is ───────────────────────────────────────────────────────
//
// The turns after a fork point, in order, plus the exact position each one was committed with,
// plus the position the line was LEFT at. Positions are never re-derived from moves: a position
// is copied from `game.history` — the snapshot the game pushed the moment each turn committed —
// so returning to a line is restoring what was, not simulating what might have been. A turn with
// no such snapshot can be looked at but not continued from, and says so.
//
// ── What keeps it from exploding ────────────────────────────────────────────────
//
//   • Continuing from a position creates nothing until a move is actually played there. Jumping
//     around never leaves empty branches behind.
//   • Playing a move that already exists at that point FOLLOWS it instead of copying it
//     (`equivalentParkedChild`): replaying a line walks back into it.
//   • Returning to a parked line un-parks it: the document never holds the line being played.
//   • Hard caps (`MULTIVERSE_LIMITS`) refuse to grow past a size the map can still show.
import {
  aggregatePendingExchangeReturns,
  calculateTotals,
  makeSnapshot,
  type BoardSnapshot,
  type ExchangeDetail,
  type GameSnapshot,
  type GameState,
  type GameStatus,
  type Phase,
  type PlaceEquationDetail,
  type Side,
  type TileInstance,
  type TurnLog,
} from "../game";
import { getPendingExchangeReturnBySide } from "../game";
import { inventoryFrom } from "../domain/projection";
import { clearTileAssignment } from "./tiles";

/**
 * A playable position, exactly as the game held it.
 *
 * Everything that changes from turn to turn and nothing that does not: players, clocks' initial
 * settings, room identity and the rest stay with the game and are never rolled back by moving
 * between lines.
 */
export type Position = {
  board: BoardSnapshot;
  rackA: TileInstance[];
  rackB: TileInstance[];
  tilebag: TileInstance[];
  pendingExchangeReturnBySide: Record<Side, TileInstance[]>;
  /** Remaining clock per side at this position. */
  timers: Record<Side, number>;
  scores: Record<Side, number>;
  turnNumber: number;
  activeSide: Side;
  phase: Phase;
  status: GameStatus;
  faceDownCount?: Partial<Record<Side, number>>;
};

/** A line that is not being played. */
export type ParkedLine = {
  /** Stable for the life of the line, including across being split by a later fork. */
  readonly id: string;
  /** The turn this line continues from; `null` means from the start of the game. */
  readonly from: string | null;
  /** At least one turn, oldest first. */
  readonly logs: readonly TurnLog[];
  /**
   * The position each turn was committed with, aligned with `logs`. `null` where the game never
   * recorded one — that turn can still be viewed, but not continued from.
   */
  readonly after: readonly (Position | null)[];
  /** Where the line was left: the live position at the moment it was parked. */
  readonly tip: Position;
  readonly parkedAt: string;
};

export type Multiverse = {
  /** Bumped by every change. Matches `TimelineRef.version` on the position committed with it. */
  readonly version: number;
  readonly lines: readonly ParkedLine[];
};

export const EMPTY_MULTIVERSE: Multiverse = { version: 0, lines: [] };

/**
 * How big the parked document may grow.
 *
 * Not a storage limit — the table allows far more — but the size past which the map stops being
 * a picture and the document stops being cheap to fetch. Refusing is the honest answer: the
 * player can delete lines they are done with and carry on.
 */
export const MULTIVERSE_LIMITS = { lines: 40, parkedTurns: 600 } as const;

// ── The tree ─────────────────────────────────────────────────────────────────────

export type TreeNode = {
  readonly id: string;
  readonly log: TurnLog;
  /** `null` for a first move. */
  readonly parentId: string | null;
  /** The continuation along this node's own line comes first; other lines after it. */
  readonly childIds: readonly string[];
  /** 0 for a first move: how many turns stand before this one on its path. */
  readonly depth: number;
  /** `null` on the line being played; otherwise the parked line holding it. */
  readonly lineId: string | null;
  /** Position within `game.logs` or within its parked line's `logs`. */
  readonly index: number;
};

export type MultiverseTree = {
  readonly nodes: ReadonlyMap<string, TreeNode>;
  /** First moves, the one being played first. */
  readonly rootChildIds: readonly string[];
  /** The line being played, oldest first. */
  readonly activeIds: readonly string[];
  /** Parked lines that could not be attached, with why. Never silently dropped. */
  readonly problems: readonly string[];
};

type MutableNode = Omit<TreeNode, "childIds"> & { childIds: string[] };

export function buildTree(activeLogs: readonly TurnLog[], multiverse: Multiverse): MultiverseTree {
  const nodes = new Map<string, MutableNode>();
  const rootChildIds: string[] = [];
  const problems: string[] = [];

  const attach = (node: MutableNode) => {
    nodes.set(node.id, node);
    if (node.parentId === null) rootChildIds.push(node.id);
    else nodes.get(node.parentId)!.childIds.push(node.id);
  };

  activeLogs.forEach((log, index) => {
    if (nodes.has(log.id)) {
      problems.push(`Turn ${log.id} appears twice in the line being played.`);
      return;
    }
    const parentId = index === 0 ? null : activeLogs[index - 1]!.id;
    attach({ id: log.id, log, parentId, childIds: [], depth: index, lineId: null, index });
  });

  // A parked line can hang off another parked line, so attach whatever can be attached until a
  // pass attaches nothing. What is left refers to a turn this game does not have.
  let pending = multiverse.lines.slice();
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    const waiting: ParkedLine[] = [];
    for (const line of pending) {
      if (line.from !== null && !nodes.has(line.from)) {
        waiting.push(line);
        continue;
      }
      progressed = true;
      let parentId = line.from;
      for (let index = 0; index < line.logs.length; index += 1) {
        const log = line.logs[index]!;
        if (nodes.has(log.id)) {
          problems.push(`Parked line ${line.id} repeats turn ${log.id}; the rest of it is hidden.`);
          break;
        }
        const depth = parentId === null ? 0 : nodes.get(parentId)!.depth + 1;
        attach({ id: log.id, log, parentId, childIds: [], depth, lineId: line.id, index });
        parentId = log.id;
      }
    }
    pending = waiting;
  }
  for (const line of pending) {
    problems.push(`Parked line ${line.id} continues from a turn this game does not have.`);
  }

  return {
    nodes,
    rootChildIds,
    activeIds: activeLogs.map((log) => log.id),
    problems,
  };
}

/** The turns from the first move down to `nodeId`, oldest first. Empty for the start. */
export function pathTo(tree: MultiverseTree, nodeId: string | null): TurnLog[] {
  const chain: TurnLog[] = [];
  let cursor = nodeId;
  while (cursor !== null) {
    const node = tree.nodes.get(cursor);
    if (!node) break;
    chain.push(node.log);
    cursor = node.parentId;
  }
  return chain.reverse();
}

/** Children of a node, or the first moves when `nodeId` is `null`. */
export function childrenOf(tree: MultiverseTree, nodeId: string | null): readonly string[] {
  if (nodeId === null) return tree.rootChildIds;
  return tree.nodes.get(nodeId)?.childIds ?? [];
}

/** The other moves tried where this one was played. */
export function siblingsOf(tree: MultiverseTree, nodeId: string): string[] {
  const node = tree.nodes.get(nodeId);
  if (!node) return [];
  return childrenOf(tree, node.parentId).filter((id) => id !== nodeId);
}

/**
 * The end of the line a node sits on: follow each node's own continuation until there is none.
 *
 * This is what "the universe this turn belongs to" means, and what a view of that universe
 * shows — the node, what led to it, and everything played after it along the same line.
 */
export function lineTipOf(tree: MultiverseTree, nodeId: string): string {
  let cursor = nodeId;
  for (;;) {
    const next = tree.nodes.get(cursor)?.childIds[0];
    if (next === undefined) return cursor;
    cursor = next;
  }
}

/**
 * How many lines a player would count: the places a line ends.
 *
 * Not the number of parked documents. One explored line can be stored as several pieces after
 * later forks split it, and it is still one line to anybody looking at the map. And standing
 * at a fork without having played from it yet is not a line either — nothing exists there yet.
 */
export function lineCount(tree: MultiverseTree): number {
  let ends = 0;
  for (const node of tree.nodes.values()) if (node.childIds.length === 0) ends += 1;
  return Math.max(1, ends);
}

// ── Positions ────────────────────────────────────────────────────────────────────

/** The position a snapshot holds. Shares arrays with it: nothing here mutates. */
export function positionOf(snapshot: GameSnapshot): Position {
  const pending = getPendingExchangeReturnBySide(snapshot);
  return {
    board: snapshot.board,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    tilebag: snapshot.tilebag,
    pendingExchangeReturnBySide: { A: pending.A, B: pending.B },
    timers: { A: snapshot.timers.A, B: snapshot.timers.B },
    scores: snapshot.scores,
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    ...(snapshot.faceDownCount ? { faceDownCount: snapshot.faceDownCount } : {}),
  };
}

/**
 * The position the game held the moment `logs[index]` was committed.
 *
 * `history` receives a snapshot on every commit, so this is a lookup, not a reconstruction. The
 * FIRST snapshot with exactly that many turns is the commit itself; later ones with the same
 * count are pauses and resumes on the same position.
 */
function committedPosition(
  history: readonly GameSnapshot[],
  logs: readonly TurnLog[],
  index: number,
): Position | null {
  const id = logs[index]?.id;
  if (id === undefined) return null;
  for (const snapshot of history) {
    if (snapshot.logs.length === index + 1 && snapshot.logs[index]?.id === id) {
      return positionOf(snapshot);
    }
  }
  return null;
}

function startPosition(game: GameState): Position | null {
  const first = game.history[0];
  return first && first.logs.length === 0 ? positionOf(first) : null;
}

function lineById(multiverse: Multiverse, id: string): ParkedLine | undefined {
  return multiverse.lines.find((line) => line.id === id);
}

/** The position right after a turn, as it was left — or the start of the game for `null`. */
export function positionAfter(
  game: GameState,
  multiverse: Multiverse,
  tree: MultiverseTree,
  nodeId: string | null,
): Position | null {
  if (nodeId === null) return startPosition(game);
  const node = tree.nodes.get(nodeId);
  if (!node) return null;
  if (node.lineId === null) {
    return node.index === game.logs.length - 1
      ? positionOf(game)
      : committedPosition(game.history, game.logs, node.index);
  }
  const line = lineById(multiverse, node.lineId);
  if (!line) return null;
  return node.index === line.logs.length - 1 ? line.tip : (line.after[node.index] ?? null);
}

/**
 * The position a turn was played FROM: its side to move, its rack full, nothing yet on the board.
 *
 * Read off the turn itself. A turn records its own before-state — board, the mover's rack, the
 * bag, the clocks — and everything it did not touch (the opponent's rack, the opponent's tiles
 * waiting to go back) is taken from the snapshot of its commit, which that turn could not have
 * changed. The result is proven against the physical set before it is returned, so a record that
 * does not add up to the hundred tiles is refused rather than played on.
 */
export function positionBefore(
  game: GameState,
  multiverse: Multiverse,
  tree: MultiverseTree,
  nodeId: string,
): Position | null {
  const node = tree.nodes.get(nodeId);
  if (!node || node.log.action === "end_game") return null;
  let committed: Position | null;
  if (node.lineId === null) {
    committed =
      committedPosition(game.history, game.logs, node.index) ??
      (node.index === game.logs.length - 1 ? positionOf(game) : null);
  } else {
    const line = lineById(multiverse, node.lineId);
    committed =
      line?.after[node.index] ?? (line && node.index === line.logs.length - 1 ? line.tip : null);
  }
  if (!committed) return null;
  return revertTurn(committed, node.log, calculateTotals(pathTo(tree, node.parentId)));
}

function revertTurn(
  committed: Position,
  log: TurnLog,
  scoresBefore: Record<Side, number>,
): Position | null {
  const side = log.side;
  const pending: Record<Side, TileInstance[]> = {
    A: [...committed.pendingExchangeReturnBySide.A],
    B: [...committed.pendingExchangeReturnBySide.B],
  };
  if (log.action === "exchange") {
    const outgoing = new Set((log.actionDetail as ExchangeDetail).outgoingTiles.map((t) => t.id));
    pending[side] = pending[side].filter((tile) => !outgoing.has(tile.id));
  }
  const rack = log.rackBefore.map(clearTileAssignment);
  const position: Position = {
    ...committed,
    board: log.boardBefore,
    rackA: side === "A" ? rack : committed.rackA,
    rackB: side === "B" ? rack : committed.rackB,
    tilebag: log.tilebagBefore,
    pendingExchangeReturnBySide: pending,
    timers: { A: log.timerBefore.A, B: log.timerBefore.B },
    scores: scoresBefore,
    turnNumber: log.turnNumber,
    activeSide: side,
    phase: "choose_action",
    status: "playing",
  };
  return isPhysicalSet(position) ? position : null;
}

function isPhysicalSet(position: Position): boolean {
  try {
    inventoryFrom({
      tilebag: position.tilebag,
      rackA: position.rackA,
      rackB: position.rackB,
      board: position.board,
      pendingReturnA: position.pendingExchangeReturnBySide.A,
      pendingReturnB: position.pendingExchangeReturnBySide.B,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Moving between lines ─────────────────────────────────────────────────────────

/**
 * A position to play on from.
 *
 * `after` a turn is the board once it was played; `before` it is the board it was played on —
 * "play this turn differently". `nodeId: null` with `after` is the start of the game.
 */
export type ContinueTarget = { nodeId: string | null; phase: "after" | "before" };

export type ContinueResult =
  | {
      readonly ok: true;
      /** False when the target already is the live position: nothing to write. */
      readonly changed: boolean;
      readonly game: GameState;
      readonly multiverse: Multiverse;
      /** The line the previous live turns were parked into, if any were. */
      readonly parkedLineId: string | null;
    }
  | { readonly ok: false; readonly reason: string };

export type ContinueOptions = {
  now?: string;
  /** Injected so tests can name lines; production uses random ids. */
  newLineId?: () => string;
};

/**
 * Make `target` the live position, keeping every turn that stops being live.
 *
 * The turns of the live line past the point where it and the target's path part ways are parked
 * as one new line, together with the exact live position they reached. The turns on the target's
 * path that were parked are taken out of their lines and become live; whatever those lines held
 * past the target stays parked, now hanging off the target. Nothing is copied and nothing is lost:
 * every turn is in exactly one place before and after.
 *
 * Pure. The caller commits the returned game and multiverse together, or neither.
 */
export function continueFrom(
  game: GameState,
  multiverse: Multiverse,
  target: ContinueTarget,
  options: ContinueOptions = {},
): ContinueResult {
  if (game.status === "finished") return fail("เกมนี้จบแล้ว เล่นต่อจากตำแหน่งเก่าไม่ได้");
  const tree = buildTree(game.logs, multiverse);

  let anchorId: string | null;
  let position: Position | null;
  if (target.phase === "before") {
    if (target.nodeId === null) return fail("ไม่มีตาก่อนเริ่มเกม");
    const node = tree.nodes.get(target.nodeId);
    if (!node) return fail("ไม่พบตานี้ในเกมแล้ว");
    anchorId = node.parentId;
    position = positionBefore(game, multiverse, tree, target.nodeId);
  } else {
    if (target.nodeId !== null && !tree.nodes.has(target.nodeId))
      return fail("ไม่พบตานี้ในเกมแล้ว");
    anchorId = target.nodeId;
    position = positionAfter(game, multiverse, tree, target.nodeId);
  }
  if (!position) return fail("ตานี้ไม่ได้บันทึกตำแหน่งไว้ครบพอจะเล่นต่อ ดูได้อย่างเดียว");
  if (position.status === "finished") return fail("ตำแหน่งนี้จบเกมไปแล้ว");

  const path = pathTo(tree, anchorId);
  let common = 0;
  while (
    common < path.length &&
    common < game.logs.length &&
    path[common]!.id === game.logs[common]!.id
  ) {
    common += 1;
  }
  const liveTail = game.logs.slice(common);
  const isLiveAlready = target.phase === "after" && liveTail.length === 0 && common === path.length;
  if (isLiveAlready) {
    return { ok: true, changed: false, game, multiverse, parkedLineId: null };
  }

  const now = options.now ?? new Date().toISOString();
  const takenIds = new Set(multiverse.lines.map((line) => line.id));
  const newLineId =
    options.newLineId ??
    (() => {
      let id: string;
      do id = crypto.randomUUID().slice(0, 8);
      while (takenIds.has(id));
      return id;
    });

  // 1) Park the live turns that the target's path does not keep.
  let lines: ParkedLine[] = multiverse.lines.slice();
  let parkedLineId: string | null = null;
  if (liveTail.length > 0) {
    parkedLineId = newLineId();
    takenIds.add(parkedLineId);
    lines.push({
      id: parkedLineId,
      from: common > 0 ? game.logs[common - 1]!.id : null,
      logs: liveTail,
      after: liveTail.map((_, offset) =>
        committedPosition(game.history, game.logs, common + offset),
      ),
      tip: positionOf(game),
      parkedAt: now,
    });
  }

  // 2) Un-park the turns on the target's path. Each parked stretch of the path is a prefix of one
  //    line (its first turn hangs off a turn that is live by then); what that line holds past the
  //    stretch stays parked, hanging off the stretch's last turn.
  const restored: { log: TurnLog; after: Position | null }[] = [];
  let cursor = common;
  while (cursor < path.length) {
    const node = tree.nodes.get(path[cursor]!.id);
    const line = node?.lineId ? lines.find((candidate) => candidate.id === node.lineId) : undefined;
    if (!node || !line || line.logs[0]?.id !== node.id) {
      return fail("เส้นทางที่เก็บไว้ไม่ต่อเนื่อง ลองโหลดใหม่");
    }
    let taken = 0;
    while (
      cursor + taken < path.length &&
      taken < line.logs.length &&
      line.logs[taken]!.id === path[cursor + taken]!.id
    ) {
      restored.push({ log: line.logs[taken]!, after: line.after[taken] ?? null });
      taken += 1;
    }
    lines = lines.filter((candidate) => candidate.id !== line.id);
    if (taken < line.logs.length) {
      lines.push({
        ...line,
        from: line.logs[taken - 1]!.id,
        logs: line.logs.slice(taken),
        after: line.after.slice(taken),
      });
    }
    cursor += taken;
  }

  const logs = [...game.logs.slice(0, common), ...restored.map((entry) => entry.log)];
  const parkedTurns = lines.reduce((total, line) => total + line.logs.length, 0);
  if (lines.length > MULTIVERSE_LIMITS.lines || parkedTurns > MULTIVERSE_LIMITS.parkedTurns) {
    return fail(
      `เก็บเส้นทางไว้เต็มแล้ว (${MULTIVERSE_LIMITS.lines} เส้น) — ลบเส้นที่ไม่ใช้แล้วในแผนที่ก่อน`,
    );
  }

  const version = multiverse.version + 1;
  const pendingBySide = position.pendingExchangeReturnBySide;
  const live: GameState = {
    ...game,
    board: position.board,
    rackA: position.rackA,
    rackB: position.rackB,
    tilebag: position.tilebag,
    pendingExchangeReturnBySide: pendingBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    timers: { ...game.timers, A: position.timers.A, B: position.timers.B },
    scores: position.scores,
    turnNumber: position.turnNumber,
    activeSide: position.activeSide,
    phase: position.phase,
    status: "playing",
    faceDownCount: position.faceDownCount,
    logs,
    // The clock restarts from here. Restoring the anchor too would charge the time spent away
    // from this position a second time.
    currentTurnStartedAt: now,
    lastSavedAt: now,
    timelineRef: { version, lines: lines.length },
  };
  if (!isPhysicalSet(positionOf(live))) {
    return fail("ตำแหน่งนี้เบี้ยไม่ครบ 100 ตัว เล่นต่อไม่ได้");
  }

  // 3) History that agrees with the new line: the shared prefix, the restored turns' commit
  //    snapshots, and the live position last. Every entry's turns are a prefix of `logs`, which
  //    is what the codec's shared-log catalog relies on.
  const identity = { ...live } as Omit<GameState, "history" | "historyIndex" | "lastSavedAt">;
  const history: GameSnapshot[] = game.history.filter(
    (snapshot) =>
      snapshot.logs.length <= common &&
      snapshot.logs.every((log, index) => log.id === logs[index]?.id),
  );
  restored.forEach((entry, offset) => {
    if (!entry.after) return;
    history.push(
      makeSnapshot({
        ...identity,
        ...snapshotFields(entry.after, game.timers),
        logs: logs.slice(0, common + offset + 1),
      }),
    );
  });
  history.push(makeSnapshot(identity));

  return {
    ok: true,
    changed: true,
    game: { ...live, history, historyIndex: history.length - 1 },
    multiverse: { version, lines },
    parkedLineId,
  };
}

function snapshotFields(position: Position, timers: GameState["timers"]) {
  const pendingBySide = position.pendingExchangeReturnBySide;
  return {
    timers: { ...timers, A: position.timers.A, B: position.timers.B },
    board: position.board,
    rackA: position.rackA,
    rackB: position.rackB,
    tilebag: position.tilebag,
    pendingExchangeReturnBySide: pendingBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    scores: position.scores,
    turnNumber: position.turnNumber,
    activeSide: position.activeSide,
    phase: position.phase,
    status: position.status,
    faceDownCount: position.faceDownCount,
  };
}

function fail(reason: string): ContinueResult {
  return { ok: false, reason };
}

/**
 * Forget a parked line, and every line that continued from one of its turns.
 *
 * Those lines cannot outlive it: they hang off turns that would no longer exist.
 */
export function pruneLine(multiverse: Multiverse, lineId: string): Multiverse {
  const doomed = new Set([lineId]);
  let grew = true;
  while (grew) {
    grew = false;
    const doomedTurns = new Set(
      multiverse.lines
        .filter((line) => doomed.has(line.id))
        .flatMap((line) => line.logs.map((log) => log.id)),
    );
    for (const line of multiverse.lines) {
      if (!doomed.has(line.id) && line.from !== null && doomedTurns.has(line.from)) {
        doomed.add(line.id);
        grew = true;
      }
    }
  }
  return {
    version: multiverse.version + 1,
    lines: multiverse.lines.filter((line) => !doomed.has(line.id)),
  };
}

// ── Not repeating what already exists ────────────────────────────────────────────

/**
 * A parked continuation of `parentId` that is the same move as `log`, if there is one.
 *
 * "The same" is what a player would call the same: the same faces on the same squares, the same
 * faces sent back, or a pass. Which physical copy of a `5` was used is not a different idea.
 */
export function equivalentParkedChild(
  tree: MultiverseTree,
  parentId: string | null,
  log: TurnLog,
): string | null {
  for (const childId of childrenOf(tree, parentId)) {
    const child = tree.nodes.get(childId);
    if (child && child.lineId !== null && sameMove(child.log, log)) return child.id;
  }
  return null;
}

export function sameMove(a: TurnLog, b: TurnLog): boolean {
  if (a.action !== b.action || a.side !== b.side) return false;
  switch (a.action) {
    case "pass":
      return true;
    case "exchange":
      return (
        moveKey((a.actionDetail as ExchangeDetail).outgoingTiles.map((t) => t.token)) ===
        moveKey((b.actionDetail as ExchangeDetail).outgoingTiles.map((t) => t.token))
      );
    case "place_equation":
      return placementKey(a) === placementKey(b);
    default:
      return false;
  }
}

function placementKey(log: TurnLog): string {
  return moveKey(
    (log.actionDetail as PlaceEquationDetail).placedTiles.map(
      (tile) => `${tile.row}:${tile.col}:${tile.token}:${tile.assignedToken ?? ""}`,
    ),
  );
}

function moveKey(parts: string[]): string {
  return [...parts].sort().join("|");
}
