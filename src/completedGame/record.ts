/** Immutable completed-game prototype. No live room or React dependencies. */
import {
  decodeBoardCells,
  decodeTileCodes,
  encodeBoardCells,
  encodeTileCodes,
  deserializeGame,
  ORDINAL_TOKEN_TABLE,
  STORAGE_PREFIX,
  type CellCode,
  type TileCode,
} from "../codec";
import {
  aggregatePendingExchangeReturns,
  getPendingExchangeReturnBySide,
  type GameSnapshot,
  type GameState,
  type Side,
  type TurnLog,
} from "../game";
import { inventoryFrom } from "../domain/projection";
import {
  decodeMultiverse,
  encodeMultiverse,
  type EncodedMultiverse,
} from "../gameplay/multiverseCodec";
import { buildTree, type Multiverse } from "../gameplay/multiverse";
import { COMPLETED_RULES_VERSION, historicRulesFor } from "./historicRules";

export const COMPLETED_GAME_FORMAT = 1;
export { COMPLETED_RULES_VERSION } from "./historicRules";

// These are domain facts. Lobby readiness, live revision/commit, timeline pointer,
// and save time are deliberately outside the immutable game payload.
const META_KEYS = [
  "gameId",
  "name",
  "gameMode",
  "players",
  "playerMembers",
  "playerUserIds",
  "playerEmails",
  "emailPlayMode",
  "emailPlayersCanSeeOpponentRack",
  "matchControl",
  "roomStage",
  "startingSide",
  "botSide",
  "botEngine",
  "botDifficulty",
  "superEngineVersion",
  "superWeightsVersion",
  "tileDrawMode",
  "faceDownCount",
  "turnNumber",
  "activeSide",
  "phase",
  "status",
  "boardSize",
  "timers",
  "scores",
  "currentTurnStartedAt",
  "createdAt",
] as const satisfies readonly (keyof GameSnapshot)[];
type MetaKey = (typeof META_KEYS)[number];
type Meta = Pick<GameSnapshot, MetaKey>;
type Physical = {
  board: CellCode[];
  rackA: TileCode[];
  rackB: TileCode[];
  bag: TileCode[];
  pendingA: TileCode[];
  pendingB: TileCode[];
};
type Frame = { meta: Meta; physical: Physical };
type Splice = [start: number, remove: number, insert: TileCode[]];
type PhysicalDelta = {
  boardSet?: CellCode[];
  boardDrop?: number[];
  rackA?: Splice;
  rackB?: Splice;
  bag?: Splice;
  pendingA?: Splice;
  pendingB?: Splice;
};
type MetaChange = [key: MetaKey, value: unknown]; // null means remove an optional field
type LogCore = Omit<
  TurnLog,
  "rackBefore" | "rackAfter" | "boardBefore" | "boardAfter" | "tilebagBefore" | "tilebagAfter"
>;
type StoredLogCore = Omit<LogCore, "startedAt" | "timerBefore" | "turnNumber" | "side"> &
  Partial<Pick<LogCore, "startedAt" | "timerBefore" | "turnNumber" | "side">>;
type LogPhysical = { board: CellCode[]; rack: TileCode[]; bag: TileCode[] };
type LogDelta = {
  boardSet?: CellCode[];
  boardDrop?: number[];
  rack?: Splice;
  bag?: Splice;
};

function rejectUnknownKeys(value: object, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field ${key}.`);
  }
}
export type CompletedTurn = {
  core: StoredLogCore;
  /** Difference from the position immediately before this record event. */
  before?: LogDelta;
  /** Exact action outcome, before automatic refill/handoff. */
  after?: LogDelta;
};
export type CompletedEvent = {
  sequence: number;
  kind: "turn" | "annotation" | "edit";
  /** Explicit changed domain fields; includes clocks, status, score and side. */
  meta?: MetaChange[];
  position?: PhysicalDelta;
  append?: CompletedTurn[];
  /** Revisions to existing visible logs (notes, stars, manual score). */
  amend?: [index: number, core: LogCore][];
};
export type CompletedGameRecordV1 = {
  format: typeof COMPLETED_GAME_FORMAT;
  rules: string;
  tileManifestDigest: string;
  provenance: CompletedProvenance;
  genesis: Frame;
  events: CompletedEvent[];
  /** Parent turn ID + alternative suffixes; see multiverse codec. */
  branches?: EncodedMultiverse;
  finalStateDigest: string;
  digest: string;
};

/** Facts that the legacy GameState cannot carry by itself. */
export type CompletedProvenance = {
  mode: "standard" | "solo" | "hosted" | "bot" | "ranked" | "stage";
  /** Describes the completion source, not proof supplied by a browser. */
  completionAuthority?: "client-reported" | "server-reduced";
  stage?: { levelId: string; sealedStartDigest: string; seed?: number; sourceVersion?: string };
  bot?: {
    catalogId: string;
    catalogVersion: string;
    executionType?: "CLIENT" | "SERVER" | "HYBRID";
    difficulty?: string;
    modelLevel?: string;
    engineVersion?: string;
    runtimeVersion?: string;
    decisionSeed?: number;
  };
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Canonical JSON ordering for immutable record bytes and source seals. */
export const canonicalCompletedJSON = stable;

async function sha256(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function metaOf(snapshot: GameSnapshot): Meta {
  const meta = {} as Record<MetaKey, unknown>;
  for (const key of META_KEYS) {
    if (snapshot[key] !== undefined) meta[key] = snapshot[key];
  }
  // Requests, responses and retry block windows are live session state. Only
  // the completed match's stop/surrender outcome belongs to its archive.
  const matchControl = snapshot.matchControl;
  if (matchControl) {
    const outcome = {
      ...(matchControl.stoppedBy ? { stoppedBy: matchControl.stoppedBy } : {}),
      ...(matchControl.surrenderedSide ? { surrenderedSide: matchControl.surrenderedSide } : {}),
    };
    if (Object.keys(outcome).length) meta.matchControl = outcome;
    else delete meta.matchControl;
  }
  return meta as Meta;
}

function physicalOf(snapshot: GameSnapshot): Physical {
  const pending = getPendingExchangeReturnBySide(snapshot);
  return {
    board: encodeBoardCells(snapshot.board),
    rackA: encodeTileCodes(snapshot.rackA),
    rackB: encodeTileCodes(snapshot.rackB),
    bag: encodeTileCodes(snapshot.tilebag),
    pendingA: encodeTileCodes(pending.A),
    pendingB: encodeTileCodes(pending.B),
  };
}

function frameOf(snapshot: GameSnapshot): Frame {
  return { meta: metaOf(snapshot), physical: physicalOf(snapshot) };
}

function diffMeta(before: Meta, after: Meta): MetaChange[] {
  return META_KEYS.filter((key) => !same(before[key], after[key])).map((key) => [
    key,
    after[key] ?? null,
  ]);
}

function splice(before: TileCode[], after: TileCode[]): Splice | undefined {
  if (same(before, after)) return undefined;
  let start = 0;
  while (start < before.length && start < after.length && same(before[start], after[start]))
    start++;
  let suffix = 0;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    same(before[before.length - suffix - 1], after[after.length - suffix - 1])
  )
    suffix++;
  return [start, before.length - start - suffix, after.slice(start, after.length - suffix)];
}

function boardDiff(
  before: CellCode[],
  after: CellCode[],
): Pick<PhysicalDelta, "boardSet" | "boardDrop"> {
  const old = new Map(before.map((cell) => [cell[0], cell]));
  const next = new Set(after.map((cell) => cell[0]));
  const boardSet = after.filter((cell) => !same(old.get(cell[0]), cell));
  const boardDrop = before.map((cell) => cell[0]).filter((index) => !next.has(index));
  return {
    ...(boardSet.length ? { boardSet } : {}),
    ...(boardDrop.length ? { boardDrop } : {}),
  };
}

function diffPhysical(before: Physical, after: Physical): PhysicalDelta {
  const delta: PhysicalDelta = boardDiff(before.board, after.board);
  for (const key of ["rackA", "rackB", "bag", "pendingA", "pendingB"] as const) {
    const change = splice(before[key], after[key]);
    if (change) delta[key] = change;
  }
  return delta;
}

function applySplice(before: TileCode[], change?: Splice): TileCode[] {
  if (!change) return before;
  const [start, remove, insert] = change;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(remove) ||
    start < 0 ||
    remove < 0 ||
    start + remove > before.length ||
    !Array.isArray(insert)
  ) {
    throw new Error("Malformed tile sequence change.");
  }
  return [...before.slice(0, start), ...insert, ...before.slice(start + remove)];
}

function applyBoard(before: CellCode[], set?: CellCode[], drop?: number[]): CellCode[] {
  const cells = new Map(before.map((cell) => [cell[0], cell]));
  const seenSet = new Set<number>();
  for (const index of drop ?? []) {
    if (!cells.delete(index)) throw new Error("Board removal refers to an empty square.");
  }
  for (const cell of set ?? []) {
    if (
      !Array.isArray(cell) ||
      !Number.isInteger(cell[0]) ||
      cell[0] < 0 ||
      cell[0] >= 225 ||
      !Number.isInteger(cell[2]) ||
      ![0, 1].includes(cell[3]) ||
      seenSet.has(cell[0])
    )
      throw new Error("Malformed board cell.");
    seenSet.add(cell[0]);
    cells.set(cell[0], cell);
  }
  return [...cells.values()].sort((a, b) => a[0] - b[0]);
}

function applyPhysical(before: Physical, delta: PhysicalDelta = {}): Physical {
  return {
    board: applyBoard(before.board, delta.boardSet, delta.boardDrop),
    rackA: applySplice(before.rackA, delta.rackA),
    rackB: applySplice(before.rackB, delta.rackB),
    bag: applySplice(before.bag, delta.bag),
    pendingA: applySplice(before.pendingA, delta.pendingA),
    pendingB: applySplice(before.pendingB, delta.pendingB),
  };
}

function logPhysical(log: TurnLog, when: "Before" | "After"): LogPhysical {
  return {
    board: encodeBoardCells(log[`board${when}`]),
    rack: encodeTileCodes(log[`rack${when}`]),
    bag: encodeTileCodes(log[`tilebag${when}`]),
  };
}

function logBase(frame: Frame, side: Side): LogPhysical {
  return {
    board: frame.physical.board,
    rack: frame.physical[side === "A" ? "rackA" : "rackB"],
    bag: frame.physical.bag,
  };
}

function diffLog(before: LogPhysical, after: LogPhysical): LogDelta {
  return {
    ...boardDiff(before.board, after.board),
    ...(splice(before.rack, after.rack) ? { rack: splice(before.rack, after.rack) } : {}),
    ...(splice(before.bag, after.bag) ? { bag: splice(before.bag, after.bag) } : {}),
  };
}

function applyLog(before: LogPhysical, delta: LogDelta = {}): LogPhysical {
  return {
    board: applyBoard(before.board, delta.boardSet, delta.boardDrop),
    rack: applySplice(before.rack, delta.rack),
    bag: applySplice(before.bag, delta.bag),
  };
}

function coreOf(log: TurnLog): LogCore {
  const core = { ...log } as Partial<TurnLog>;
  delete core.rackBefore;
  delete core.rackAfter;
  delete core.boardBefore;
  delete core.boardAfter;
  delete core.tilebagBefore;
  delete core.tilebagAfter;
  return core as LogCore;
}

function withoutUserAnnotations(log: TurnLog): TurnLog {
  const clean = { ...log };
  delete clean.note;
  delete clean.stars;
  return clean;
}

function withoutNewAnnotations<T extends GameSnapshot>(snapshot: T): T {
  return { ...snapshot, logs: snapshot.logs.map(withoutUserAnnotations) };
}

function encodeTurn(log: TurnLog, frame: Frame): CompletedTurn {
  const base = logBase(frame, log.side);
  const before = logPhysical(log, "Before");
  const after = logPhysical(log, "After");
  const beforeDelta = diffLog(base, before);
  const afterDelta = diffLog(before, after);
  const core: StoredLogCore = { ...coreOf(log) };
  if (core.startedAt === frame.meta.currentTurnStartedAt) delete core.startedAt;
  if (same(core.timerBefore, { A: frame.meta.timers.A, B: frame.meta.timers.B }))
    delete core.timerBefore;
  if (core.turnNumber === frame.meta.turnNumber) delete core.turnNumber;
  if (core.side === frame.meta.activeSide) delete core.side;
  return {
    core,
    ...(Object.keys(beforeDelta).length ? { before: beforeDelta } : {}),
    ...(Object.keys(afterDelta).length ? { after: afterDelta } : {}),
  };
}

function decodeTurn(turn: CompletedTurn, frame: Frame): TurnLog {
  if (!turn?.core) throw new Error("Malformed completed turn.");
  const core: LogCore = {
    startedAt: frame.meta.currentTurnStartedAt,
    timerBefore: { A: frame.meta.timers.A, B: frame.meta.timers.B },
    turnNumber: frame.meta.turnNumber,
    side: frame.meta.activeSide,
    ...turn.core,
  };
  if (
    !["place_equation", "exchange", "pass", "end_game"].includes(core.action) ||
    !["A", "B"].includes(core.side) ||
    !core.id ||
    !Number.isInteger(core.turnNumber) ||
    !Number.isFinite(core.calculatedScore) ||
    !Number.isFinite(core.finalScore) ||
    !Number.isFinite(core.timerBefore?.A) ||
    !Number.isFinite(core.timerBefore?.B) ||
    !Number.isFinite(core.timerAfter?.A) ||
    !Number.isFinite(core.timerAfter?.B) ||
    !core.actionDetail ||
    typeof core.actionDetail !== "object"
  )
    throw new Error("Malformed completed turn.");
  const before = applyLog(logBase(frame, core.side), turn.before);
  const after = applyLog(before, turn.after);
  return {
    ...core,
    rackBefore: decodeTileCodes(before.rack),
    rackAfter: decodeTileCodes(after.rack),
    boardBefore: decodeBoardCells(before.board),
    boardAfter: decodeBoardCells(after.board),
    tilebagBefore: decodeTileCodes(before.bag),
    tilebagAfter: decodeTileCodes(after.bag),
  };
}

function snapshotOf(frame: Frame, logs: TurnLog[], commitId = "completed-record"): GameSnapshot {
  if (!frame?.meta || !frame.physical || typeof frame.physical !== "object")
    throw new Error("Malformed completed position.");
  rejectUnknownKeys(
    frame.physical,
    ["board", "rackA", "rackB", "bag", "pendingA", "pendingB"],
    "completed physical position",
  );
  if (
    Object.keys(frame.meta).some((key) => !META_KEYS.includes(key as MetaKey)) ||
    typeof frame.meta.gameId !== "string" ||
    !frame.meta.gameId ||
    typeof frame.meta.name !== "string" ||
    !["A", "B"].includes(frame.meta.activeSide) ||
    !["playing", "draft", "finished"].includes(frame.meta.status) ||
    !["refill", "choose_action", "perform_action"].includes(frame.meta.phase) ||
    !Number.isInteger(frame.meta.turnNumber) ||
    frame.meta.turnNumber < 1 ||
    frame.meta.boardSize !== 15 ||
    !Number.isFinite(frame.meta.scores?.A) ||
    !Number.isFinite(frame.meta.scores?.B) ||
    !Number.isFinite(frame.meta.timers?.A) ||
    !Number.isFinite(frame.meta.timers?.B)
  ) {
    throw new Error("Malformed completed position metadata.");
  }
  const p = frame.physical;
  const indexes = p.board.map((cell) => cell[0]);
  if (
    indexes.some(
      (index, at) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index >= 225 ||
        (at > 0 && index <= indexes[at - 1]!),
    )
  ) {
    throw new Error("Malformed or repeated completed board cell.");
  }
  const pendingExchangeReturnBySide = {
    A: decodeTileCodes(p.pendingA),
    B: decodeTileCodes(p.pendingB),
  };
  const snapshot: GameSnapshot = {
    ...frame.meta,
    commitId,
    board: decodeBoardCells(p.board),
    rackA: decodeTileCodes(p.rackA),
    rackB: decodeTileCodes(p.rackB),
    tilebag: decodeTileCodes(p.bag),
    pendingExchangeReturnBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingExchangeReturnBySide),
    logs,
  };
  inventoryFrom({
    ...snapshot,
    pendingReturnA: pendingExchangeReturnBySide.A,
    pendingReturnB: pendingExchangeReturnBySide.B,
  });
  return snapshot;
}

function eventOf(
  before: Frame,
  beforeLogs: TurnLog[],
  after: GameSnapshot,
  sequence: number,
): CompletedEvent {
  if (after.logs.length < beforeLogs.length)
    throw new Error("A completed active line cannot erase turns.");
  const append = after.logs.slice(beforeLogs.length).map((log) => encodeTurn(log, before));
  const amend: [number, LogCore][] = [];
  for (let index = 0; index < beforeLogs.length; index++) {
    const previous = beforeLogs[index]!;
    const updated = after.logs[index]!;
    if (
      !same(logPhysical(previous, "Before"), logPhysical(updated, "Before")) ||
      !same(logPhysical(previous, "After"), logPhysical(updated, "After"))
    ) {
      throw new Error("A saved history entry changed a past turn's physical facts.");
    }
    if (!same(coreOf(previous), coreOf(updated))) amend.push([index, coreOf(updated)]);
  }
  const next = frameOf(after);
  const meta = diffMeta(before.meta, next.meta);
  const position = diffPhysical(before.physical, next.physical);
  const kind = append.length
    ? "turn"
    : amend.length && !meta.length && !Object.keys(position).length
      ? "annotation"
      : "edit";
  return {
    sequence,
    kind,
    ...(meta.length ? { meta } : {}),
    ...(Object.keys(position).length ? { position } : {}),
    ...(append.length ? { append } : {}),
    ...(amend.length ? { amend } : {}),
  };
}

function applyEvent(
  frame: Frame,
  logs: TurnLog[],
  event: CompletedEvent,
  expected: number,
): { frame: Frame; logs: TurnLog[] } {
  if (!event || typeof event !== "object") throw new Error("Malformed completed event.");
  rejectUnknownKeys(
    event,
    ["sequence", "kind", "meta", "position", "append", "amend"],
    "completed event",
  );
  if (event.position)
    rejectUnknownKeys(
      event.position,
      ["boardSet", "boardDrop", "rackA", "rackB", "bag", "pendingA", "pendingB"],
      "completed position change",
    );
  for (const turn of event.append ?? []) {
    rejectUnknownKeys(turn, ["core", "before", "after"], "completed turn");
    if (turn.before)
      rejectUnknownKeys(
        turn.before,
        ["boardSet", "boardDrop", "rack", "bag"],
        "turn-before change",
      );
    if (turn.after)
      rejectUnknownKeys(turn.after, ["boardSet", "boardDrop", "rack", "bag"], "turn-after change");
  }
  if (event.sequence !== expected || !["turn", "annotation", "edit"].includes(event.kind))
    throw new Error("Completed event order or kind is invalid.");
  if ((event.kind === "turn") !== Boolean(event.append?.length))
    throw new Error("Turn event has no complete turn facts.");
  if (event.kind === "annotation" && (event.meta || event.position || !event.amend?.length))
    throw new Error("Annotation event contains non-annotation facts.");
  const nextLogs = [...logs];
  for (const [index, core] of event.amend ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= nextLogs.length)
      throw new Error("Log amendment index is invalid.");
    nextLogs[index] = { ...nextLogs[index]!, ...core };
  }
  for (const turn of event.append ?? []) {
    if (nextLogs.some((log) => log.id === turn.core.id))
      throw new Error("Duplicate turn identity.");
    nextLogs.push(decodeTurn(turn, frame));
  }
  const meta = { ...frame.meta } as Record<MetaKey, unknown>;
  const touched = new Set<string>();
  for (const [key, value] of event.meta ?? []) {
    if (!META_KEYS.includes(key) || touched.has(key))
      throw new Error("Invalid or repeated metadata field.");
    touched.add(key);
    if (value === null) delete meta[key];
    else meta[key] = value;
  }
  const next: Frame = {
    meta: meta as Meta,
    physical: applyPhysical(frame.physical, event.position),
  };
  snapshotOf(next, nextLogs);
  return { frame: next, logs: nextLogs };
}

function replayFrames(record: CompletedGameRecordV1): {
  frames: Frame[];
  snapshots: GameSnapshot[];
} {
  const frames = [record.genesis];
  let logs: TurnLog[] = [];
  const snapshots = [snapshotOf(record.genesis, logs, `completed:${record.digest}:0`)];
  for (let index = 0; index < record.events.length; index++) {
    const next = applyEvent(frames.at(-1)!, logs, record.events[index]!, index + 1);
    frames.push(next.frame);
    logs = next.logs;
    snapshots.push(snapshotOf(next.frame, logs, `completed:${record.digest}:${index + 1}`));
  }
  return { frames, snapshots };
}

function digestInput(record: unknown): unknown {
  return record;
}

export async function buildCompletedGameRecord(
  game: GameState,
  branches?: Multiverse,
  provenance: CompletedProvenance = {
    mode:
      game.gameMode === "solo"
        ? "solo"
        : game.botSide
          ? "bot"
          : game.emailPlayMode === "hosted"
            ? "hosted"
            : "standard",
  },
): Promise<CompletedGameRecordV1> {
  if (
    game.history.length === 0 ||
    game.history[0]!.logs.length !== 0 ||
    game.historyIndex !== game.history.length - 1
  ) {
    throw new Error(
      "Complete active history is required; keep this legacy game readable instead of inventing genesis.",
    );
  }
  const genesis = frameOf(game.history[0]!);
  snapshotOf(genesis, []);
  const events: CompletedEvent[] = [];
  let previous = genesis;
  let previousLogs: TurnLog[] = [];
  for (const rawSnapshot of game.history.slice(1)) {
    const snapshot = withoutNewAnnotations(rawSnapshot);
    const event = eventOf(previous, previousLogs, snapshot, events.length + 1);
    // Even a semantically identical history entry is an undo/review boundary.
    events.push(event);
    previous = frameOf(snapshot);
    previousLogs = snapshot.logs;
  }
  const cleanFinal = withoutNewAnnotations(game);
  const finalEvent = eventOf(previous, previousLogs, cleanFinal, events.length + 1);
  if (finalEvent.meta || finalEvent.position || finalEvent.append || finalEvent.amend) {
    events.push(finalEvent);
  }
  const partial: Omit<CompletedGameRecordV1, "digest"> = {
    format: COMPLETED_GAME_FORMAT,
    rules: COMPLETED_RULES_VERSION,
    tileManifestDigest: await sha256(ORDINAL_TOKEN_TABLE),
    provenance: {
      ...provenance,
      completionAuthority: provenance.completionAuthority ?? "client-reported",
    },
    genesis,
    events,
    ...(branches?.lines.length
      ? {
          branches: encodeMultiverse({
            ...branches,
            lines: branches.lines.map((line) => ({
              ...line,
              logs: line.logs.map(withoutUserAnnotations),
            })),
          }),
        }
      : {}),
    finalStateDigest: await sha256({
      frame: frameOf(cleanFinal),
      logs: cleanFinal.logs.map(coreOf),
    }),
  };
  const record = { ...partial, digest: await sha256(digestInput(partial)) };
  // Fail at creation rather than emit an archive that cannot be replayed.
  await validateCompletedGameRecord(record);
  return record;
}

export async function validateCompletedGameRecord(raw: unknown): Promise<CompletedGameRecordV1> {
  if (!raw || typeof raw !== "object") throw new Error("Completed record is not an object.");
  const record = raw as CompletedGameRecordV1;
  rejectUnknownKeys(
    record,
    [
      "format",
      "rules",
      "tileManifestDigest",
      "provenance",
      "genesis",
      "events",
      "branches",
      "finalStateDigest",
      "digest",
    ],
    "completed record",
  );
  if (record.format !== COMPLETED_GAME_FORMAT)
    throw new Error(`Unknown completed-game format ${String(record.format)}.`);
  historicRulesFor(record.rules);
  if (record.tileManifestDigest !== (await sha256(ORDINAL_TOKEN_TABLE)))
    throw new Error("Completed record tile manifest is not supported by this decoder.");
  if (
    !record.provenance ||
    !["standard", "solo", "hosted", "bot", "ranked", "stage"].includes(record.provenance.mode)
  )
    throw new Error("Completed mode identity is missing.");
  if (
    !["client-reported", "server-reduced"].includes(record.provenance.completionAuthority as string)
  )
    throw new Error("Missing or unknown completion authority.");
  if (record.provenance.stage && record.provenance.mode !== "stage")
    throw new Error("Stage identity has inconsistent mode provenance.");
  if (record.provenance.bot && !["bot", "stage"].includes(record.provenance.mode))
    throw new Error("Bot identity has inconsistent mode provenance.");
  if (
    (record.provenance.mode === "bot" || record.genesis?.meta?.botSide) &&
    (!record.provenance.bot?.catalogId || !record.provenance.bot.catalogVersion)
  )
    throw new Error("Bot catalog identity/version is missing.");
  if (record.provenance.mode === "bot" && !record.genesis?.meta?.botSide)
    throw new Error("Bot mode has no bot side.");
  if (
    record.provenance.bot?.executionType &&
    !["CLIENT", "SERVER", "HYBRID"].includes(record.provenance.bot.executionType)
  )
    throw new Error("Unknown bot execution type.");
  if (record.genesis?.meta?.botSide && !["bot", "stage"].includes(record.provenance.mode))
    throw new Error("Bot game has inconsistent mode provenance.");
  if (
    record.provenance.mode === "stage" &&
    (!record.provenance.stage?.levelId || !record.provenance.stage.sealedStartDigest)
  )
    throw new Error("Stage start identity is missing.");
  if (!record.genesis || !Array.isArray(record.events) || typeof record.digest !== "string")
    throw new Error("Malformed completed record.");
  const partial = { ...record } as Partial<CompletedGameRecordV1>;
  delete partial.digest;
  if ((await sha256(digestInput(partial))) !== record.digest)
    throw new Error("Completed record digest mismatch.");
  const { snapshots } = replayFrames(record);
  const last = snapshots.at(-1)!;
  if (
    (await sha256({ frame: frameOf(last), logs: last.logs.map(coreOf) })) !==
    record.finalStateDigest
  ) {
    throw new Error("Final canonical state digest mismatch.");
  }
  if (record.branches) {
    const branches = decodeMultiverse(record.branches);
    const tree = buildTree(last.logs, branches);
    if (tree.problems.length) throw new Error(`Invalid branch tree: ${tree.problems.join(" ")}`);
    const ids = new Set(last.logs.map((log) => log.id));
    for (const line of branches.lines) {
      if (line.after.length !== line.logs.length) {
        throw new Error("Branch positions do not align with branch turns.");
      }
      if (
        line.from &&
        !ids.has(line.from) &&
        !branches.lines.some((parent) => parent.logs.some((log) => log.id === line.from))
      ) {
        throw new Error("Branch parent turn does not exist.");
      }
      for (const position of [...line.after, line.tip]) {
        if (!position) continue; // historical branch is viewable, but cannot be continued here
        inventoryFrom({
          ...position,
          pendingReturnA: position.pendingExchangeReturnBySide.A,
          pendingReturnB: position.pendingExchangeReturnBySide.B,
        });
      }
    }
  }
  return record;
}

/** Storage-write gate. The general codec also handles early positions for benchmarks. */
export async function validateCanonicalCompletedGameRecord(
  raw: unknown,
): Promise<CompletedGameRecordV1> {
  const record = await validateCompletedGameRecord(raw);
  if (record.genesis.meta.status === "finished" || finalPosition(record).status !== "finished")
    throw new Error("Canonical completed record needs a finished transition.");
  return record;
}

export async function digestCompletedGameRecord(record: CompletedGameRecordV1): Promise<string> {
  const partial = { ...record } as Partial<CompletedGameRecordV1>;
  delete partial.digest;
  return sha256(digestInput(partial));
}

export async function readCompletedGameRecord(
  record: CompletedGameRecordV1,
): Promise<{ game: GameState; branches: Multiverse | null; provenance: CompletedProvenance }> {
  await validateCompletedGameRecord(record);
  const { snapshots } = replayFrames(record);
  const final = snapshots.at(-1)!;
  return {
    game: {
      ...final,
      history: snapshots,
      historyIndex: snapshots.length - 1,
      lastSavedAt: final.createdAt,
    },
    branches: record.branches ? decodeMultiverse(record.branches) : null,
    provenance: record.provenance,
  };
}

/** Position index zero is genesis; each subsequent index is one committed event. */
export function positionAt(record: CompletedGameRecordV1, eventIndex: number): GameSnapshot {
  if (!Number.isInteger(eventIndex) || eventIndex < 0 || eventIndex > record.events.length)
    throw new RangeError("Completed event index is out of range.");
  let frame = record.genesis;
  let logs: TurnLog[] = [];
  for (let index = 0; index < eventIndex; index++) {
    const next = applyEvent(frame, logs, record.events[index]!, index + 1);
    frame = next.frame;
    logs = next.logs;
  }
  return snapshotOf(frame, logs, `completed:${record.digest}:${eventIndex}`);
}

/** Display index zero is genesis; positive indexes count visible logs, not edit events. */
export function positionAtDisplayedTurn(
  record: CompletedGameRecordV1,
  displayedIndex: number,
): GameSnapshot {
  if (!Number.isInteger(displayedIndex) || displayedIndex < 0)
    throw new RangeError("Displayed turn index is out of range.");
  if (displayedIndex === 0) return positionAt(record, 0);
  let visibleLogs = 0;
  for (let index = 0; index < record.events.length; index++) {
    visibleLogs += record.events[index]!.append?.length ?? 0;
    if (visibleLogs >= displayedIndex) return positionAt(record, index + 1);
  }
  throw new RangeError("Displayed turn index is out of range.");
}

export function finalPosition(record: CompletedGameRecordV1): GameSnapshot {
  return positionAt(record, record.events.length);
}

export function replayCompletedGame(record: CompletedGameRecordV1): GameSnapshot[] {
  return replayFrames(record).snapshots;
}

export type CompletedRead =
  | {
      kind: "compact";
      game: GameState;
      branches: Multiverse | null;
      provenance: CompletedProvenance;
      fullyBranchable: true;
    }
  | {
      kind: "legacy";
      game: GameState;
      branches: Multiverse | null;
      fullyBranchable: false;
      reason: string;
    };

/** Adapter boundary for completed v1 and legacy c1/plain JSON. Never rewrites source. */
export async function readCompletedGame(
  raw: string | CompletedGameRecordV1,
  legacyBranches?: Multiverse,
): Promise<CompletedRead> {
  if (typeof raw !== "string") {
    const result = await readCompletedGameRecord(raw);
    return { kind: "compact", ...result, fullyBranchable: true };
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw.startsWith(STORAGE_PREFIX) ? raw.slice(STORAGE_PREFIX.length) : raw);
  } catch {
    throw new Error("Unreadable stored game payload.");
  }
  if (candidate && typeof candidate === "object" && "format" in candidate) {
    const result = await readCompletedGameRecord(candidate as CompletedGameRecordV1);
    return { kind: "compact", ...result, fullyBranchable: true };
  }
  if (
    candidate &&
    typeof candidate === "object" &&
    "v" in candidate &&
    ![1, 2, 3].includes((candidate as { v: number }).v)
  ) {
    throw new Error(`Unknown legacy-game format ${String((candidate as { v: unknown }).v)}.`);
  }
  const legacy = deserializeGame(raw);
  if (!legacy) throw new Error("Unreadable legacy game.");
  inventoryFrom({
    ...legacy,
    pendingReturnA: legacy.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: legacy.pendingExchangeReturnBySide?.B ?? [],
  });
  if (
    candidate &&
    typeof candidate === "object" &&
    "v" in candidate &&
    [1, 2].includes((candidate as { v: number }).v)
  ) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason:
        "Face-only legacy storage omitted physical tile identities; canonical recovery is readable but not a lossless original event record.",
    };
  }
  if (
    legacy.logs.some((log) => log.note !== undefined || log.stars !== undefined) ||
    legacyBranches?.lines.some((line) =>
      line.logs.some((log) => log.note !== undefined || log.stars !== undefined),
    )
  ) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason: "Historic annotations remain readable in their original legacy record.",
    };
  }
  try {
    const record = await buildCompletedGameRecord(legacy, legacyBranches);
    const result = await readCompletedGameRecord(record);
    return { kind: "compact", ...result, fullyBranchable: true };
  } catch (error) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason: error instanceof Error ? error.message : "Incomplete historic reconstruction facts.",
    };
  }
}
