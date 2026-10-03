import { EXCHANGE_MIN_RESERVE, RACK_SIZE } from "../../constants/gameRules";
import type { BoardSnapshot, Side, TileInstance } from "../../game";
import type { RankedMatchView, RankedTurnView } from "../../features/ranked/publicView";
import type { RankedAction } from "../../features/ranked/rules";
import type { PlayTool } from "../../playModeTools";
import type { HostedAction } from "../hostedAdmin";
import type { LiveControl } from "../controls";
import type { PhysicalAction } from "../physical";
import type { LiveGameView } from "../projection";
import { deriveLastMove, type LastMove } from "./derive";

/** The transport a match screen talks to: the live client, Ranked, or a dev source. */
export type MatchClient = {
  read(id: string): Promise<{ match: RankedMatchView }>;
  action(
    id: string,
    revision: number,
    action: RankedAction,
    commandId?: string,
  ): Promise<{ match: RankedMatchView }>;
  ready(id: string): Promise<{ match: RankedMatchView }>;
  cancel(id: string): Promise<unknown>;
  control?: (
    id: string,
    revision: number,
    action: LiveControl,
  ) => Promise<{ match: RankedMatchView }>;
  administer?: (
    id: string,
    revision: number,
    action: HostedAction,
  ) => Promise<{ match: RankedMatchView }>;
  subscribe?: (id: string, refresh: () => void) => () => void;
  botTurn?: (id: string, revision: number) => Promise<{ match: RankedMatchView }>;
  physical?: (
    id: string,
    revision: number,
    action: PhysicalAction,
  ) => Promise<{ match: RankedMatchView }>;
  record?: (
    id: string,
    revision: number,
    side: Side,
    move: RankedAction,
  ) => Promise<{ match: RankedMatchView }>;
  handoff?: (id: string, revision: number, side: Side) => Promise<{ match: RankedMatchView }>;
};

/**
 * What the shell may OFFER. Every value comes from the recipient projection the
 * server built (its `can*` flags, `directPause`, `hostRacks`, `localHandoff`,
 * `practiceBot`, the seat) or from the server's mode-tool catalog. The server
 * still authorizes every command; a capability only decides whether a control
 * is rendered. INTERIM (until the projected capability block of Phase B):
 * `match.surrender`, `match.coffee` and `tools.*` mirror the current client
 * rules exactly as RankedMatchPage applied them.
 */
export type ShellCapabilities = {
  turn: { act: boolean; exchange: boolean; recordForActiveSide: boolean };
  match: {
    coffee: boolean;
    requestPause: boolean;
    respondPause: boolean;
    resumeDirect: boolean;
    rename: boolean;
    saveExit: boolean;
    surrender: boolean;
    hostLifecycle: boolean;
  };
  record: {
    turnLog: boolean;
    undo: boolean;
    redo: boolean;
    history: boolean;
    branches: boolean;
    correctScore: boolean;
    physicalIntake: boolean;
  };
  tools: { analysis: boolean; practice: boolean };
  workspace: { notes: boolean; persistence: "local" | "memory" | "none" };
};

export type ViewerRole = "player" | "physical-host" | "spectator";
export type TurnRole = "active" | "thinking" | "watching";
export type PauseCause = "agreement" | "host" | "saved";

export type ShellClock = { seconds: number; running: boolean; untimed: boolean };

export type ShellModel = {
  id: string;
  revision: number;
  name: string;
  modeKey: string;
  ranked: boolean;
  role: ViewerRole;
  /** The seat whose tiles this viewer plays or records (null for spectators). */
  rackSide: Side | null;
  yourSide: Side | null;
  perspective: { top: Side | null; bottom: Side };
  solo: boolean;
  players: Record<Side, string>;
  bot: { side: Side; where: "server" | "device" } | null;
  botThinking: boolean;
  activeSide: Side;
  turnNumber: number;
  status: RankedMatchView["status"];
  finished: boolean;
  paused: PauseCause | null;
  blocked: boolean;
  /** Physical draw pending: the move is recorded, the refill is not. */
  awaitingRefill: boolean;
  turnRole: TurnRole;
  /** Changes exactly when the turn (or the line of play) changes. */
  turnKey: string;
  scores: Record<Side, number>;
  clocks: Record<Side, ShellClock>;
  board: BoardSnapshot;
  rack: TileInstance[];
  hostRacks?: Record<Side, TileInstance[]>;
  bagCount: number;
  rackCount: Record<Side, number>;
  logs: RankedTurnView[];
  lastMove: LastMove | null;
  pause: {
    incoming: { id: string; by: Side } | null;
    outgoing: boolean;
    answer: { id: string; accepted: boolean; blocked: boolean } | null;
    blockedUntil: number | null;
  };
  result: RankedMatchView["result"];
  ratingChange?: RankedMatchView["ratingChange"];
  caps: ShellCapabilities;
  live: LiveGameView | null;
};

const SOLO_MODES = new Set(["solo_practice"]);

function isLive(view: RankedMatchView, ranked: boolean): view is LiveGameView {
  return !ranked && "mode" in view;
}

/** Remaining time shown now: the stored remainder minus the running turn's elapsed time. */
export function visibleClocks(view: RankedMatchView, now: number): Record<Side, ShellClock> {
  const live = "clockPolicy" in view ? (view as LiveGameView) : null;
  const paused = Boolean(live?.paused);
  const clock = (side: Side): ShellClock => {
    const untimed = Boolean(live?.clockPolicy.untimed[side]);
    const running = view.status === "playing" && !paused && view.activeSide === side && !untimed;
    const elapsed = running
      ? Math.max(0, Math.floor((now - Date.parse(view.clockStartedAt)) / 1000))
      : 0;
    return {
      seconds: Math.max(live?.clockPolicy.minSeconds ?? 0, view.timers[side] - elapsed),
      running,
      untimed,
    };
  };
  return { A: clock("A"), B: clock("B") };
}

export function toShellModel(
  view: RankedMatchView,
  options: {
    ranked: boolean;
    now: number;
    playTools: ReadonlySet<PlayTool>;
    client: MatchClient;
  },
): ShellModel {
  const { ranked, client } = options;
  const live = isLive(view, ranked) ? view : null;
  const physicalHost = Boolean(live?.hostRacks);
  const role: ViewerRole = physicalHost ? "physical-host" : view.yourSide ? "player" : "spectator";
  const rackSide: Side | null = physicalHost ? view.activeSide : view.yourSide;
  const modeKey = live ? String(live.mode) : ranked ? "ranked" : "";
  const solo = SOLO_MODES.has(modeKey);
  const finished = view.status === "finished";
  const blocked = Boolean(live?.continuationBlocked);
  const pausedFlag = Boolean(live?.paused) && view.status === "playing";
  const paused: PauseCause | null = !pausedFlag
    ? null
    : live?.directPause && live.matchControl?.stoppedBy
      ? "agreement"
      : live?.canAdminister || modeKey === "hosted_versus" || solo
        ? "host"
        : "saved";
  const awaitingRefill = Boolean(live?.tileDrawMode === "manual" && live.phase === "refill");
  const playing = view.status === "playing" && !pausedFlag && !blocked;
  const act = Boolean(
    playing && (view.yourSide === view.activeSide || physicalHost) && !awaitingRefill,
  );
  const turnRole: TurnRole =
    role === "spectator" ? "watching" : act || (physicalHost && playing) ? "active" : "thinking";
  const exchangeSide = physicalHost ? view.activeSide : view.yourSide;
  const opponent: Side = exchangeSide === "A" ? "B" : "A";
  const canExchange =
    view.tilebagCount + view.rackCount[opponent] - RACK_SIZE >= EXCHANGE_MIN_RESERVE;
  // Rename, direct pause and history exist only while the game can continue.
  const continuing = Boolean(live && client.control && !blocked && !finished);
  const directPause = Boolean(continuing && live?.directPause);
  const control = live?.matchControl;
  const blockedUntil = Date.parse(control?.stopBlockedUntilBySide?.[view.yourSide ?? "A"] ?? "");
  const incoming =
    directPause && control?.stopRequest && control.stopRequest.requestedBy !== view.yourSide
      ? { id: control.stopRequest.id, by: control.stopRequest.requestedBy }
      : null;
  const answer =
    directPause && control?.stopResponse && control.stopResponse.requestedBy === view.yourSide
      ? {
          id: control.stopResponse.id,
          accepted: control.stopResponse.accepted,
          blocked: Boolean(control.stopResponse.blockedForMs),
        }
      : null;
  const hostLifecycle = Boolean(live && live.canAdminister && client.administer && !finished);
  const persistence: ShellCapabilities["workspace"]["persistence"] =
    role === "spectator" ? "none" : live?.localHandoff ? "memory" : "local";
  const caps: ShellCapabilities = {
    turn: { act, exchange: canExchange, recordForActiveSide: physicalHost },
    match: {
      coffee: !ranked && !finished,
      requestPause: directPause && !pausedFlag,
      respondPause: directPause,
      resumeDirect: directPause && pausedFlag,
      rename: Boolean(continuing && live?.canRename),
      saveExit: Boolean(live?.canSaveExit && client.control && !finished),
      surrender: view.status === "playing" && Boolean(view.yourSide) && !blocked,
      hostLifecycle,
    },
    record: {
      turnLog: true,
      undo: Boolean(continuing && live?.canUndo),
      redo: Boolean(continuing && live?.canRedo),
      history: Boolean(continuing && live?.canEditHistory),
      branches: Boolean(continuing && live?.canEditHistory && options.playTools.has("multiverse")),
      correctScore: Boolean(hostLifecycle && pausedFlag),
      physicalIntake: Boolean(
        live &&
        client.physical &&
        (live.hostRacks ||
          (live.localHandoff && live.localConfirmed && live.tileDrawMode === "manual")),
      ),
    },
    tools: {
      analysis: !ranked && options.playTools.has("analysis"),
      practice: !ranked && options.playTools.has("replay"),
    },
    workspace: { notes: role !== "spectator", persistence },
  };
  const bot =
    live?.botSide !== undefined
      ? {
          side: live.botSide,
          where: live.mode === "stage5b_standard" ? ("device" as const) : ("server" as const),
        }
      : null;
  const bottom: Side = rackSide && role === "player" ? rackSide : "A";
  return {
    id: view.id,
    revision: view.revision,
    name: live?.name ?? (ranked ? "Ranked match" : "Live game"),
    modeKey,
    ranked,
    role,
    rackSide,
    yourSide: view.yourSide,
    perspective: { top: solo ? null : bottom === "A" ? "B" : "A", bottom },
    solo,
    players: view.players,
    bot,
    botThinking: Boolean(live?.botTurn),
    activeSide: view.activeSide,
    turnNumber: view.turnNumber,
    status: view.status,
    finished,
    paused,
    blocked,
    awaitingRefill,
    turnRole,
    turnKey: [
      view.activeSide,
      view.turnNumber,
      view.logs.length,
      view.yourSide ?? "-",
      live?.localConfirmed ? "c" : "",
      view.logs.at(-1)?.id ?? "",
    ].join(":"),
    scores: view.scores,
    clocks: visibleClocks(view, options.now),
    board: view.board,
    rack: physicalHost ? live!.hostRacks![view.activeSide] : view.yourRack,
    hostRacks: live?.hostRacks,
    bagCount: view.tilebagCount,
    rackCount: view.rackCount,
    logs: view.logs,
    lastMove: deriveLastMove(view.logs),
    pause: {
      incoming,
      outgoing: Boolean(directPause && control?.stopRequest?.requestedBy === view.yourSide),
      answer,
      blockedUntil: Number.isFinite(blockedUntil) ? blockedUntil : null,
    },
    result: view.result,
    ratingChange: view.ratingChange,
    caps,
    live,
  };
}
