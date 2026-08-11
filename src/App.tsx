import {
  Ban,
  Clock3,
  Coffee,
  Download,
  Flag,
  List,
  LogOut,
  Play,
  Redo2,
  Send,
  Square,
  Trophy,
  Undo2,
} from "lucide-react";
import "./play-styles.css";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel } from "./components/actions/ActionPanel";
import { Board, type BoardScoreAnchor } from "./components/board/Board";
import { GlobalActivity, LoadingScreen } from "./components/feedback/LoadingActivity";
import { Lobby } from "./components/pages/Lobby";
import { CreateRoomPage } from "./components/pages/pregame/CreateRoomPage";
import { JoinRoomPage } from "./components/pages/pregame/JoinRoomPage";
import { WaitingRoomPage } from "./components/pages/pregame/WaitingRoomPage";
import { LogModal } from "./components/logs/LogModal";
import { LogPanel } from "./components/logs/LogPanel";
import { PlayRail } from "./components/rail/PlayRail";
import { RailDivider } from "./components/rail/RailDivider";
import { Rack } from "./components/board/Rack";
import { Scoreboard } from "./components/game/Scoreboard";
import { AssignmentModal, type AssignmentRequest } from "./components/modals/AssignmentModal";
import { MobileActionBar } from "./components/mobile/MobileActionBar";
import { MobileTilebagPanel } from "./components/mobile/MobileTilebagPanel";
import { TilebagSheet } from "./components/mobile/TilebagSheet";
import { ResultModal } from "./components/modals/ResultModal";
import { ConfirmSheet, Sheet } from "./components/ui/Sheet";
import { useAuth } from "./auth";
import { AdminPage } from "./admin";
import {
  ActionType,
  BoardSnapshot,
  EquationDetection,
  ExchangeDetail,
  GameState,
  MatchControl,
  NewGameSettings,
  PassDetail,
  PendingPlacement,
  Phase,
  PlaceEquationDetail,
  Side,
  TileInstance,
  TurnLog,
  advanceToOpponentTurn,
  aggregatePendingExchangeReturns,
  boardWithPending,
  calculateTotals,
  createPlaceDetail,
  deepClone,
  finalizeRefillTransition,
  getPendingExchangeReturnBySide,
  getGameMode,
  getRack,
  getTileDrawMode,
  isRackReady,
  normalizeEmail,
  normalizeUserId,
  pushActionSnapshot,
  setRack,
  tileNeedsAssignment,
  TurnActionDetail,
  updateLogNote,
  validateMove,
} from "./game";
import * as roomStore from "./rooms";
import { canonicalStringify, makeRemoteStateKey } from "./stateKey";
import type { RoomMeta } from "./rooms";
import * as remoteRooms from "./remoteRooms";
import type { LiveRoomSession, RoomSessionEvent } from "./remoteRooms";
import { navigate, useRoute } from "./router";
import { getRoomActorCapabilities } from "./roomAccess";
import { isRemoteGameAhead, isRemoteGameStale, revisionOf, withRevision } from "./gameSync";
import { applyCanonicalToSnapshot, decodeCanonical, inventoryFrom } from "./domain/projection";
import {
  createWaitingGame,
  getRoomStage,
  resolveRoomCode,
  startWaitingGame,
  updateWaitingGame,
} from "./pregame";
import { isSupabaseConfigured } from "./supabaseClient";
import { ACTION_LABELS } from "./uiText";
import { BOARD_SIZE, RACK_SIZE, STOP_REQUEST_BLOCK_MS } from "./constants/gameRules";
import {
  BOARD_CELL_MAX_PX,
  BOARD_CELL_MIN_PX,
  BOARD_CELL_SCALE,
  BOARD_BORDER_TOTAL_PX,
  BOARD_COLUMN_LABEL_HEIGHT_PX,
  BOARD_RACK_CHROME_PX,
  BOARD_ROW_LABEL_WIDTH_PX,
  BOARD_SAFETY_INSET_PX,
  MOBILE_BOARD_INSET_PX,
  MOBILE_CHROME_BASE_PX,
  MOBILE_LAYOUT_MAX_PX,
  RACK_HEIGHT_TO_CELL_RATIO,
} from "./constants/layout";
import {
  LIVE_RECONCILE_INTERVAL_MS,
  LIVE_SESSION_SYNC_DEBOUNCE_MS,
  REALTIME_RETRY_MS,
  TIMER_TICK_MS,
  WAKE_DEBOUNCE_MS,
} from "./constants/network";
import { STORAGE_KEYS } from "./constants/storage";
import { createAutomaticEndGameLog, createSurrenderEndGameLog } from "./gameplay/endGame";
import { getExchangeRule, getTilebagView, refillRackFromQueue } from "./gameplay/tilebag";
import { advanceRunningClock } from "./gameplay/timer";
import { clearTileAssignment } from "./gameplay/tiles";
import {
  isDesyncBotFailure,
  isRetryableBotFailure,
  mapBotResponse,
  thinkWithBot,
  warmUpBotEngine,
  type BotThinkHandle,
  type BotThinkingState,
} from "./bot/botController";
import { EngineApiError, isEngineApiConfigured } from "./bot/engineApi";
import type { BotResponse } from "./bot/types";
import { botRecordFromGame, recordBotGame } from "./botStats";
import { BotThinkingCard } from "./components/game/BotThinkingCard";
import { BotReasoningPanel } from "./components/game/BotReasoningPanel";
import { TurnAnalysisLauncher } from "./components/game/TurnAnalysisLauncher";
import { makeRoomScope, type RoomScope, type RoomVisibility } from "./roomScope";

type ActionMode = "none" | ActionType;

/**
 * How long to wait before asking the engine again after a transient refusal.
 *
 * The length of this array is also the retry LIMIT. Three attempts over about
 * fourteen seconds covers the case this exists for — a burst of other people's
 * searches on a one-CPU server — without letting the bot sit forever on a
 * service that is genuinely down.
 */
const BOT_RETRY_DELAYS_MS = [1_500, 4_000, 8_000] as const;

/**
 * What to tell the player about an engine problem, in one line.
 *
 * Deliberately says nothing about queues, concurrency, status codes, hosts or
 * the shape of the backend. The player needs to know why the bot has not moved
 * and whether to wait; everything else is our problem.
 */
function botNoticeFor(error: unknown): string {
  if (error instanceof EngineApiError) {
    switch (error.code) {
      case "queue_full":
        return "ขณะนี้มีการใช้งานบอทจำนวนมาก กำลังลองใหม่ให้อัตโนมัติ";
      case "offline":
        return "ติดต่อเซิร์ฟเวอร์บอทไม่ได้ กำลังลองใหม่ให้อัตโนมัติ";
      case "engine_timeout":
        return "การคำนวณของบอทใช้เวลานานเกินกำหนดและถูกหยุดไว้ — บอทจึงผ่านตานี้";
      case "budget_exhausted":
        return "ใช้โควตาการคำนวณครบแล้ว — บอทจึงผ่านตานี้";
      case "unauthenticated":
        return "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่";
      case "unconfigured":
        return "ระบบบอทยังไม่ได้เปิดใช้งานในเซิร์ฟเวอร์นี้";
      default:
        return "บอทคำนวณตานี้ไม่สำเร็จ — บอทจึงผ่านตานี้";
    }
  }
  return "บอทคำนวณตานี้ไม่สำเร็จ — บอทจึงผ่านตานี้";
}

type ActionStart = {
  startedAt: string;
  rackBefore: TileInstance[];
  boardBefore: BoardSnapshot;
  tilebagBefore: TileInstance[];
  timerBefore: Record<Side, number>;
};

type ExchangeDraft = {
  outgoingIds: string[];
  incomingTiles: TileInstance[];
};

type RefillBaseline = {
  gameId: string;
  ids: string[];
  pendingExchangeReturnBySide: ReturnType<typeof getPendingExchangeReturnBySide>;
  rack: TileInstance[];
  side: Side;
  tilebag: TileInstance[];
  turnNumber: number;
};

function captureRefillBaseline(game: GameState): RefillBaseline {
  return {
    gameId: game.gameId,
    ids: getRack(game, game.activeSide).map((tile) => tile.id),
    pendingExchangeReturnBySide: deepClone(getPendingExchangeReturnBySide(game)),
    rack: deepClone(getRack(game, game.activeSide)),
    side: game.activeSide,
    tilebag: deepClone(game.tilebag),
    turnNumber: game.turnNumber,
  };
}

function refillBaselineMatchesTurn(
  baseline: RefillBaseline | null,
  game: GameState,
): baseline is RefillBaseline {
  return Boolean(
    baseline &&
    baseline.gameId === game.gameId &&
    baseline.side === game.activeSide &&
    baseline.turnNumber === game.turnNumber,
  );
}

// One undoable "record": the full game + draft state at a single step.
type UndoSnap = {
  game: GameState;
  actionMode: ActionMode;
  pendingPlacements: PendingPlacement[];
  exchangeDraft: ExchangeDraft;
};

type ScoreAnchorCell = { row: number; col: number };

function getScoreAnchorCells({
  board,
  equations,
  orientation,
  placements,
}: {
  board: BoardSnapshot;
  equations: EquationDetection[];
  orientation: "horizontal" | "vertical";
  placements: PendingPlacement[];
}): ScoreAnchorCell[] {
  const primaryEquation = equations
    .filter((equation) => equation.isValid && equation.direction === orientation)
    .reduce<EquationDetection | null>(
      (longest, equation) =>
        !longest || equation.cells.length > longest.cells.length ? equation : longest,
      null,
    );
  if (primaryEquation) return primaryEquation.cells;
  if (placements.length === 0) return [];

  if (orientation === "horizontal") {
    const row = placements[0].row;
    let start = Math.min(...placements.map((placement) => placement.col));
    let end = Math.max(...placements.map((placement) => placement.col));
    while (start > 0 && board[row]?.[start - 1]) start -= 1;
    while (end < board.length - 1 && board[row]?.[end + 1]) end += 1;
    return Array.from({ length: end - start + 1 }, (_, offset) => ({ row, col: start + offset }));
  }

  const col = placements[0].col;
  let start = Math.min(...placements.map((placement) => placement.row));
  let end = Math.max(...placements.map((placement) => placement.row));
  while (start > 0 && board[start - 1]?.[col]) start -= 1;
  while (end < board.length - 1 && board[end + 1]?.[col]) end += 1;
  return Array.from({ length: end - start + 1 }, (_, offset) => ({ row: start + offset, col }));
}

function createBoardScoreAnchor({
  cells,
  isValid,
  orientation,
  score,
}: {
  cells: ScoreAnchorCell[];
  isValid: boolean;
  orientation: "horizontal" | "vertical";
  score: number;
}): BoardScoreAnchor | null {
  if (cells.length === 0) return null;
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);

  if (orientation === "horizontal") {
    // Prefer the equation end. If it touches the board edge, attach to the
    // start instead so the badge still points to an equation endpoint.
    const side = maxCol === 14 && minCol > 0 ? "left" : "right";
    const alignY = minRow >= 13 ? "end" : "start";
    return {
      row: minRow,
      col: side === "left" ? minCol : maxCol,
      orientation,
      side,
      alignX: "start",
      alignY,
      score,
      isValid,
    };
  }

  const side = maxRow === 14 && minRow > 0 ? "above" : "below";
  const alignX = minCol >= 13 ? "end" : "start";
  return {
    row: side === "above" ? minRow : maxRow,
    col: minCol,
    orientation,
    side,
    alignX,
    alignY: "start",
    score,
    isValid,
  };
}

function isFinishedGame(game: Pick<GameState, "status" | "logs">): boolean {
  return game.status === "finished" || game.logs.some((log) => log.action === "end_game");
}

function normalizeFinishedGame(game: GameState): GameState {
  if (!isFinishedGame(game) || (game.status === "finished" && game.timers.paused)) return game;
  return {
    ...game,
    status: "finished",
    timers: { ...game.timers, paused: true },
  };
}

function CoffeeReturnButton({ roomName, onReturn }: { roomName: string; onReturn: () => void }) {
  return (
    <button
      aria-label={`Return to ${roomName}`}
      className="coffee-return-button"
      title={`Return to ${roomName}`}
      type="button"
      onClick={onReturn}
    >
      <Coffee size={20} />
      <span>Return to game</span>
    </button>
  );
}

function App() {
  const { configured: authConfigured, isApproved, profile, userId } = useAuth();
  const remoteEnabled = isSupabaseConfigured;
  const route = useRoute();
  const initialLobbyVisibility =
    route.kind === "home" || route.kind === "create" || route.kind === "join"
      ? route.visibility
      : "public";
  const [lobbyVisibility, setLobbyVisibility] = useState<RoomVisibility>(initialLobbyVisibility);
  const [rooms, setRooms] = useState<RoomMeta[]>(() =>
    remoteEnabled ? [] : roomStore.listRooms({ visibility: "public", regionId: null }),
  );
  const [roomsLoading, setRoomsLoading] = useState(remoteEnabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [foregroundLoading, setForegroundLoading] = useState<string | null>(null);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);
  const routeRoomId = route.kind === "room" || route.kind === "play" ? route.roomId : null;
  const [game, setGame] = useState<GameState | null>(() => {
    if (remoteEnabled) return null;
    const id = routeRoomId ?? roomStore.getActiveRoomId();
    if (!id) return null;
    const saved = roomStore.readRoom(id);
    return saved && !hasDuplicateTileIds(saved)
      ? advanceRunningClock(normalizeFinishedGame(saved))
      : null;
  });
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    if (routeRoomId) return routeRoomId;
    if (remoteEnabled) return null;
    const id = roomStore.getActiveRoomId();
    return id && roomStore.readRoom(id) ? id : null;
  });
  const view: "lobby" | "game" = route.kind === "play" ? "game" : "lobby";
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [actionStart, setActionStart] = useState<ActionStart | null>(null);
  const [selectedRackTileId, setSelectedRackTileId] = useState<string | null>(null);
  const [selectedPendingTileId, setSelectedPendingTileId] = useState<string | null>(null);
  const [pendingPlacements, setPendingPlacements] = useState<PendingPlacement[]>([]);
  // Directional placement cursor. Clicking an empty cell cycles
  // right → down → left → up → cancel. Pressing 1–8 (or clicking a rack
  // tile) places that tile at the cursor and advances over any filled /
  // pending cells in the direction.
  const [placementCursor, setPlacementCursor] = useState<{
    row: number;
    col: number;
    dir: "right" | "down" | "left" | "up";
  } | null>(null);
  // Replay practice sandbox. When the user enters a "before" half-step in
  // replay, this captures a mutable copy of that turn's rackBefore + an empty
  // placements list. The user can shuffle / place / assign exactly like a
  // live turn, but the Submit action is disabled — it's exploratory only.
  // Resets whenever the replay cursor moves.
  const [replayDraft, setReplayDraft] = useState<{
    rack: (TileInstance | null)[];
    placements: PendingPlacement[];
  } | null>(null);
  // Per-side stable rack layout — 8 slots, holding tile ids. When a tile
  // leaves rackA/rackB (e.g. dropped on the board) its slot becomes null so
  // the remaining tiles stay in their positions instead of sliding left.
  // Kept in sync with game.rackA / rackB via an effect below.
  const [rackLayout, setRackLayout] = useState<Record<Side, (string | null)[]>>({
    A: Array(RACK_SIZE).fill(null),
    B: Array(RACK_SIZE).fill(null),
  });
  const [exchangeDraft, setExchangeDraft] = useState<ExchangeDraft>({
    outgoingIds: [],
    incomingTiles: [],
  });
  // Replay cursor: null = not replaying, otherwise an integer in [0, 2N-1]
  // where every log contributes two steps:
  //   step 2i   → "rack ready, waiting for action" (log[i].boardBefore, rackBefore)
  //   step 2i+1 → "action applied"                 (log[i].boardAfter,  rackAfter)
  const [replayCursor, setReplayCursor] = useState<number | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [showResult, setShowResult] = useState(false);
  // In-app confirmations for lifecycle actions (never window.confirm — native
  // dialogs are blocked in some in-app browsers and can't explain outcomes).
  const [lifecycleConfirm, setLifecycleConfirm] = useState<"stop" | "end" | null>(null);
  // Stop-response the requester has already acknowledged (local only).
  const [seenStopResponseId, setSeenStopResponseId] = useState<string | null>(null);
  const [assignmentRequest, setAssignmentRequest] = useState<AssignmentRequest | null>(null);
  const [boardCell, setBoardCell] = useState(34);
  // Mobile tile-pick bottom sheet (manual draw mode). Auto-opens once per
  // turn when the active player needs to refill; see the effect below.
  const [mobileBagOpen, setMobileBagOpen] = useState(false);
  const [coffeeRoomId, setCoffeeRoomId] = useState<string | null>(() =>
    window.localStorage.getItem(STORAGE_KEYS.coffeeRoom),
  );
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  const bagAutoOpenKeyRef = useRef<string>("");
  const refillBaselineRef = useRef<RefillBaseline | null>(null);
  const boardZoneRef = useRef<HTMLElement | null>(null);
  const rightRailRef = useRef<HTMLElement | null>(null);
  // Fast-path refs for rapid keyboard placement. Updated synchronously inside
  // handlers so back-to-back keystrokes always read fresh state instead of
  // stale closures. Re-synced on every render via the assignments below.
  const cursorRef = useRef(placementCursor);
  const pendingsRef = useRef(pendingPlacements);
  const gameRef = useRef<GameState | null>(game);
  const actionModeRef = useRef(actionMode);
  const rackLayoutRef = useRef(rackLayout);
  cursorRef.current = placementCursor;
  pendingsRef.current = pendingPlacements;
  gameRef.current = game;
  actionModeRef.current = actionMode;
  rackLayoutRef.current = rackLayout;
  const readOnlyRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(activeRoomId);
  const pendingSessionEventRef = useRef<RoomSessionEvent | null>(null);
  const lastAppliedStateKeyRef = useRef<string>("");
  const lastAppliedSessionKeyRef = useRef<string>("");
  const lastAppliedSessionUpdatedAtRef = useRef("");
  const lastAppliedSessionScopeRef = useRef("");
  const lastAppliedSessionActorIdRef = useRef<string | null>(null);
  const deferredRemoteSessionRef = useRef<LiveRoomSession | null>(null);
  const shouldFlushEmptyLiveSessionRef = useRef(false);
  // Command id per outgoing position, so a retry of the same intent reuses its
  // id and the server can recognize and ignore the duplicate.
  const commandIdsByStateKeyRef = useRef(new Map<string, string>());
  const foregroundOperationRef = useRef(0);
  const liveSessionSyncTimerRef = useRef<number | null>(null);
  const compactedRoomIdsRef = useRef(new Set<string>());
  const inviteRepairRoomIdsRef = useRef(new Set<string>());
  const undoStackRef = useRef<UndoSnap[]>([]);
  const redoStackRef = useRef<UndoSnap[]>([]);
  const lastSnapRef = useRef<UndoSnap | null>(null);
  const lastMutationKeyRef = useRef<string>("");
  const restoringUndoRef = useRef(false);
  const [, bumpUndoVersion] = useState(0);

  const activeRoomMeta = activeRoomId
    ? (rooms.find((room) => room.id === activeRoomId) ?? null)
    : null;
  const regionId = profile?.region_id ?? null;
  const regionName = profile?.region_name ?? null;
  const requestedLobbyVisibility =
    route.kind === "home" || route.kind === "create" || route.kind === "join"
      ? route.visibility
      : lobbyVisibility;
  const requestedLobbyScope = makeRoomScope(requestedLobbyVisibility, regionId);
  const hasAdminAccess = remoteEnabled && Boolean(userId && profile?.is_admin);
  const canCreateRoom = !remoteEnabled || Boolean(userId && (isApproved || hasAdminAccess));
  const accountEmail = normalizeEmail(profile?.email);
  const inviteUserAId = activeRoomMeta?.inviteUserAId ?? game?.playerUserIds?.A ?? null;
  const inviteUserBId = activeRoomMeta?.inviteUserBId ?? game?.playerUserIds?.B ?? null;
  const inviteEmailA = normalizeEmail(activeRoomMeta?.inviteEmailA ?? game?.playerEmails?.A);
  const inviteEmailB = normalizeEmail(activeRoomMeta?.inviteEmailB ?? game?.playerEmails?.B);
  const hasReservedPlayerSeats = Boolean(game && (getGameMode(game) === "solo" || game.botSide));
  const isEmailRoom =
    !hasReservedPlayerSeats &&
    Boolean(inviteUserAId || inviteUserBId || inviteEmailA || inviteEmailB);
  const invitedSides: Side[] = [
    ...(accountMatchesInvite(inviteUserAId, inviteEmailA, userId, accountEmail)
      ? (["A"] as Side[])
      : []),
    ...(accountMatchesInvite(inviteUserBId, inviteEmailB, userId, accountEmail)
      ? (["B"] as Side[])
      : []),
  ];
  const accountPlayerSide = invitedSides.length === 1 ? invitedSides[0] : null;
  const canManageActiveRoom =
    !remoteEnabled || Boolean(userId && (hasAdminAccess || activeRoomMeta?.ownerId === userId));
  const isActiveRoomOwner = !remoteEnabled || Boolean(userId && activeRoomMeta?.ownerId === userId);
  // Infer legacy rooms only for their owner: an owner assigned to a side was
  // the old direct-email shape; otherwise old email rooms remain hosted.
  const emailPlayMode = isEmailRoom
    ? (game?.emailPlayMode ??
      (canManageActiveRoom && invitedSides.length > 0 ? "direct" : "hosted"))
    : null;
  const isDirectEmailRoom = emailPlayMode === "direct";
  // Direct email matches keep database ownership for persistence, but have no
  // host/admin gameplay controller. Both accounts are ordinary side players.
  const canControlActiveGame = canManageActiveRoom && !isDirectEmailRoom;
  const isSelfDirectedSolo = Boolean(game && getGameMode(game) === "solo" && !isEmailRoom);
  const hasGameplayHost = Boolean(game && !isDirectEmailRoom && !isSelfDirectedSolo);
  const canHostLifecycleControl = hasGameplayHost && canManageActiveRoom;
  const canSoloLifecycleControl = isSelfDirectedSolo && canManageActiveRoom;
  const canDirectLifecycleControl = isDirectEmailRoom && accountPlayerSide !== null;
  const canStopLifecycle =
    canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl;
  const canEndLifecycle =
    canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl;
  const canConfigureWaitingRoom = canManageActiveRoom && (!isDirectEmailRoom || isActiveRoomOwner);
  // Existing rooms showed the active rack, so undefined remains backward-compatible.
  const emailPlayersCanSeeOpponentRack = game?.emailPlayersCanSeeOpponentRack ?? true;
  const canWriteActiveRoom =
    !remoteEnabled ||
    Boolean(
      userId &&
      (isDirectEmailRoom
        ? invitedSides.length > 0
        : canManageActiveRoom || invitedSides.length > 0),
    );
  const actorCapabilities = getRoomActorCapabilities({
    game,
    emailPlayMode,
    invitedSides,
    isAdmin: hasAdminAccess,
    isOwner: isActiveRoomOwner,
    remoteEnabled,
  });
  const canActActiveSide = actorCapabilities.canAct;
  const canRefillActiveRack = actorCapabilities.canRefill;
  const canPlayActiveRoom = actorCapabilities.canInteract;
  const readOnly = remoteEnabled && !canPlayActiveRoom;
  readOnlyRef.current = readOnly;
  const roleLabel = (() => {
    if (!remoteEnabled) return "Local Control";
    if (isDirectEmailRoom) {
      if (invitedSides.length === 0) return "Spectator Live";
      return game?.status === "playing" && invitedSides.includes(game.activeSide)
        ? `Side ${game.activeSide} · Your turn`
        : `Side ${invitedSides.join("/")} · Waiting`;
    }
    if (hasAdminAccess) return "Admin Control";
    if (emailPlayMode === "hosted" && canManageActiveRoom) {
      return game?.phase === "refill" && getTileDrawMode(game) === "manual"
        ? `Host · Refill Side ${game.activeSide}`
        : `Host · Waiting for Side ${game?.activeSide ?? "A"}`;
    }
    if (canManageActiveRoom) return "Owner Control";
    if (invitedSides.length === 0) return "Spectator Live";
    if (
      game?.status === "playing" &&
      invitedSides.includes(game.activeSide) &&
      game.phase !== "refill"
    ) {
      return `Side ${game.activeSide} · Your turn`;
    }
    return game?.phase === "refill" && getTileDrawMode(game) === "manual"
      ? `Side ${invitedSides.join("/")} · Waiting for host refill`
      : `Side ${invitedSides.join("/")} · Waiting`;
  })();
  const createDisabledReason = authConfigured
    ? !userId
      ? "Sign in to create a room."
      : !isApproved && !hasAdminAccess
        ? "Your account must be approved before creating a room."
        : requestedLobbyVisibility === "region" && !regionId
          ? "An admin must assign your account to a region before you can create a region room."
          : null
    : null;
  const canCreateInScope = canCreateRoom && requestedLobbyScope !== null;
  const liveSession = useMemo(
    () =>
      remoteRooms.makeLiveSession({
        actorId: userId,
        gameId: game?.gameId ?? null,
        turnNumber: game?.turnNumber ?? null,
        activeSide: game?.activeSide ?? null,
        actionMode,
        pendingPlacements,
        exchangeDraft,
        selectedRackTileId,
        selectedPendingTileId,
      }),
    [
      actionMode,
      exchangeDraft,
      game?.activeSide,
      game?.gameId,
      game?.turnNumber,
      pendingPlacements,
      selectedPendingTileId,
      selectedRackTileId,
      userId,
    ],
  );
  const liveSessionKey = useMemo(() => makeLiveSessionKey(liveSession), [liveSession]);
  const remoteStateKey = useMemo(() => (game ? makeRemoteStateKey(game) : ""), [game]);
  // Signature of everything that counts as an undoable mutation (excludes the
  // per-second timer tick and pure tile-selection highlights).
  const undoMutationKey = useMemo(() => {
    if (!game) return "";
    return JSON.stringify({
      board: game.board,
      rackA: game.rackA,
      rackB: game.rackB,
      tilebag: game.tilebag,
      logs: game.logs.length,
      phase: game.phase,
      turnNumber: game.turnNumber,
      activeSide: game.activeSide,
      status: game.status,
      actionMode,
      pendingPlacements,
      exchangeDraft,
    });
  }, [game, actionMode, pendingPlacements, exchangeDraft]);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    if (route.kind === "home" || route.kind === "create" || route.kind === "join") {
      setLobbyVisibility(route.visibility);
    }
  }, [route]);

  // Direct-room creators still own the database row, but not the gameplay.
  // Repair only the relational email mapping here so legacy malformed rooms
  // become joinable without overwriting a player's concurrent Ready update.
  useEffect(() => {
    if (
      !remoteEnabled ||
      route.kind !== "room" ||
      !activeRoomId ||
      !game ||
      !isDirectEmailRoom ||
      !canConfigureWaitingRoom ||
      inviteRepairRoomIdsRef.current.has(activeRoomId)
    ) {
      return;
    }
    inviteRepairRoomIdsRef.current.add(activeRoomId);
    setBackgroundSyncCount((count) => count + 1);
    void remoteRooms
      .repairRoomInvites(activeRoomId, game)
      .then(() => setSyncError(null))
      .catch((error: Error) => {
        inviteRepairRoomIdsRef.current.delete(activeRoomId);
        setSyncError(error.message);
      })
      .finally(() => setBackgroundSyncCount((count) => Math.max(0, count - 1)));
  }, [activeRoomId, canConfigureWaitingRoom, game, isDirectEmailRoom, remoteEnabled, route.kind]);

  // Stamp the route on <body> so page-scoped CSS (e.g. the play-view scroll
  // lock in 99-mobile-play.css) can't leak into other pages.
  useEffect(() => {
    document.body.dataset.route = route.kind;
    return () => {
      delete document.body.dataset.route;
    };
  }, [route.kind]);

  // ── Sync resilience ───────────────────────────────────────────────────────
  // Phones freeze JS and drop the realtime websocket when the screen turns
  // off, the tab is swiped to the app switcher, or the browser is
  // backgrounded — and missed postgres_changes are never replayed. Every
  // "wake" signal therefore (1) catches the local clock up, (2) rebuilds the
  // realtime channel, and (3) re-reads the authoritative room row.
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
  const reconcilingRef = useRef(false);
  const resubscribeTimerRef = useRef<number | null>(null);
  const lastWakeAtRef = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;
  const coffeeRoomIdRef = useRef<string | null>(coffeeRoomId);
  coffeeRoomIdRef.current = coffeeRoomId;

  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      const now = Date.now();
      if (now - lastWakeAtRef.current < WAKE_DEBOUNCE_MS) return;
      lastWakeAtRef.current = now;
      // Catch the visible clock up immediately so the pre-sleep time never
      // flashes while the network round-trip is in flight.
      setGame((current) => (current ? advanceRunningClock(current) : current));
      const currentRoute = routeRef.current;
      if (!remoteEnabled) return;
      if (currentRoute.kind === "play" || currentRoute.kind === "room") {
        setSubscriptionEpoch((epoch) => epoch + 1);
        void reconcileActiveRoom();
        if (currentRoute.kind === "play" && coffeeRoomIdRef.current === currentRoute.roomId) {
          // Back at the board — the implicit coffee break is over.
          rememberCoffeeRoom(null);
        }
      } else if (currentRoute.kind === "home") {
        const scope = makeRoomScope(currentRoute.visibility, profile?.region_id);
        if (!scope) return;
        void remoteRooms
          .listRooms(scope)
          .then(setRooms)
          .catch(() => undefined);
      }
    };
    const hide = () => {
      // Swiping the web away or turning the screen off mid-game counts as a
      // coffee break, exactly like pressing the Break button. Only
      // localStorage is reliable inside pagehide, so mark the room here and
      // let the next launch show the return chip.
      const currentRoute = routeRef.current;
      const currentGame = gameRef.current;
      if (
        currentRoute.kind === "play" &&
        currentGame?.status === "playing" &&
        !readOnlyRef.current &&
        activeRoomIdRef.current
      ) {
        rememberCoffeeRoom(activeRoomIdRef.current);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
      else hide();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // bfcache restore: the JS heap is pre-sleep state; treat it as a wake.
      if (event.persisted) wake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", hide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled]);

  // Reconcile route changes (browser back/forward, manual hash edit) with state.
  // Owner-initiated openRoom/createAndOpenRoom already sync everything *before*
  // calling navigate(), so this effect mostly handles external hash changes.
  useEffect(() => {
    if (!routeRoomId) return;
    if (routeRoomId === activeRoomId && game) {
      if (route.kind === "room" && getRoomStage(game) === "playing") {
        navigate({ kind: "play", roomId: routeRoomId }, true);
      } else if (route.kind === "play" && getRoomStage(game) === "waiting") {
        navigate({ kind: "room", roomId: routeRoomId }, true);
      }
      return;
    }
    let cancelled = false;
    const finishLoading = startForegroundLoading("Opening room...");
    (async () => {
      try {
        const remotePayload = remoteEnabled ? await remoteRooms.readRoom(routeRoomId) : null;
        const storedGame = remotePayload?.game ?? roomStore.readRoom(routeRoomId);
        if (cancelled) return;
        if (!storedGame || hasDuplicateTileIds(storedGame)) {
          navigate({ kind: "home", visibility: lobbyVisibility }, true);
          return;
        }
        const saved = advanceRunningClock(normalizeFinishedGame(storedGame));
        resetRemoteRoomTracking();
        if (!remoteEnabled) roomStore.setActiveRoomId(routeRoomId);
        setActiveRoomId(routeRoomId);
        setGame(saved);
        lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
        if (remotePayload) {
          setLobbyVisibility(remotePayload.meta.visibility ?? "public");
          setRooms((current) => upsertRoomMeta(current, remotePayload.meta));
          applyRemoteSession(remotePayload.session, saved);
          compactRemoteRoomIfNeeded(remotePayload, saved);
        }
        setShowResult(isFinishedGame(saved));
        if (route.kind === "room" && getRoomStage(saved) === "playing") {
          navigate({ kind: "play", roomId: routeRoomId }, true);
        } else if (route.kind === "play" && getRoomStage(saved) === "waiting") {
          navigate({ kind: "room", roomId: routeRoomId }, true);
        }
      } catch (error) {
        if (!cancelled)
          setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
      } finally {
        finishLoading();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeRoomId]);

  useEffect(() => {
    // AppRoot mounts this application for the Play route only. Loading lobby
    // summaries here can replace the active room's full metadata (including
    // owner/player ids) with the privacy-safe listing projection and turn the
    // owner into a read-only spectator while a game is open.
    if (!remoteEnabled || view !== "lobby") return;
    if (!requestedLobbyScope) {
      setRooms([]);
      setRoomsLoading(false);
      return;
    }
    let active = true;
    setRoomsLoading(true);
    remoteRooms
      .listRooms(requestedLobbyScope)
      .then((nextRooms) => {
        if (active) {
          setRooms(nextRooms);
          setSyncError(null);
        }
      })
      .catch((error: Error) => {
        if (active) setSyncError(error.message);
      })
      .finally(() => {
        if (active) setRoomsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [remoteEnabled, view, requestedLobbyScope?.visibility, requestedLobbyScope?.regionId, userId]);

  // Spectators follow the broadcast topic instead of the room row: one publish
  // per move, a payload bounded by the size of the physical set rather than by
  // the length of the game, and no per-observer work on the authoritative side.
  // A read-only observer never writes, so this is the whole of its sync path
  // apart from the snapshot it fetched when it opened the room.
  useEffect(() => {
    if (!remoteEnabled || view !== "game" || !activeRoomId || !readOnly) return;
    let disposed = false;
    const unsubscribe = remoteRooms.subscribeToGameCommits(
      activeRoomId,
      (commit) => {
        if (disposed || commit.gameId !== activeRoomIdRef.current) return;
        const local = gameRef.current;
        if (!local) return;
        // An older or already-applied revision carries nothing new.
        if (commit.revision <= revisionOf(local)) return;
        try {
          const canonical = decodeCanonical(commit.canonical);
          setGame(
            withRevision(applyCanonicalToSnapshot(local, canonical), commit.revision) as GameState,
          );
          setSyncError(null);
        } catch (error) {
          // The broadcast did not describe the physical set. Say so and fall
          // back to authoritative data rather than rendering it.
          setSyncError(
            error instanceof Error ? error.message : "Unable to read the live game update.",
          );
          void reconcileActiveRoom();
        }
      },
      (status) => {
        if (disposed) return;
        // A fresh subscription pulls whatever the socket missed while it was down.
        if (status === "SUBSCRIBED") void reconcileActiveRoom();
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, view, activeRoomId, readOnly, subscriptionEpoch]);

  useEffect(() => {
    if (!remoteEnabled || view !== "game" || !activeRoomId) return;
    let disposed = false;
    const unsubscribe = remoteRooms.subscribeToRoom(
      activeRoomId,
      (payload) => {
        const newRecord = payload.new as { id?: string } | null | undefined;
        const oldRecord = payload.old as { id?: string } | null | undefined;
        const changedId = newRecord?.id ?? oldRecord?.id;
        if (!changedId || changedId !== activeRoomIdRef.current) return;
        if (payload.eventType === "DELETE") {
          // Finalization atomically replaces room_live with an archive snapshot.
          // Re-read through the room adapter before treating DELETE as a cancel.
          void remoteRooms.readRoom(changedId).then((archived) => {
            if (archived) {
              applyRemotePayload(archived, { allowRollback: true });
              setShowResult(true);
              return;
            }
            setActiveRoomId(null);
            setGame(null);
            navigate({ kind: "home", visibility: lobbyVisibility });
            cancelDraftOnly();
          });
          return;
        }
        if (!payload.new) return;
        try {
          applyRemotePayload(
            remoteRooms.payloadFromRow(
              payload.new as Parameters<typeof remoteRooms.payloadFromRow>[0],
            ),
          );
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : "Unable to read live room update.");
        }
      },
      (session) => {
        applyIncomingRemoteSession(session);
      },
      (status) => handleChannelStatus(status, () => disposed),
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, view, activeRoomId, userId, subscriptionEpoch]);

  // Realtime is the fast path, while this authoritative read heals a change
  // dropped by a socket that still appears connected after a device wake.
  useEffect(() => {
    if (!remoteEnabled || view !== "game" || !activeRoomId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) {
        void reconcileActiveRoom();
      }
    }, LIVE_RECONCILE_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, view, activeRoomId]);

  // Waiting rooms reuse the existing room-row subscription. Gameplay keeps
  // its original subscription above; this listener exists only before Start.
  useEffect(() => {
    if (!remoteEnabled || route.kind !== "room" || !activeRoomId) return;
    let disposed = false;
    const unsubscribe = remoteRooms.subscribeToRoom(
      activeRoomId,
      (payload) => {
        const record = payload.new as remoteRooms.RemoteRoomRecord | null | undefined;
        if (payload.eventType === "DELETE") {
          setActiveRoomId(null);
          setGame(null);
          navigate({ kind: "home", visibility: lobbyVisibility });
          return;
        }
        if (!record) return;
        try {
          const next = remoteRooms.payloadFromRow(record);
          setRooms((current) => upsertRoomMeta(current, next.meta));
          setGame(next.game);
          lastAppliedStateKeyRef.current = makeRemoteStateKey(next.game);
          if (getRoomStage(next.game) === "playing") {
            navigate({ kind: "play", roomId: activeRoomId }, true);
          }
        } catch (error) {
          setSyncError(
            error instanceof Error ? error.message : "Unable to read waiting room update.",
          );
        }
      },
      () => undefined,
      (status) => handleChannelStatus(status, () => disposed),
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId, remoteEnabled, route.kind, subscriptionEpoch]);

  useEffect(() => {
    if (view !== "game" || !game || game.status !== "playing" || game.timers.paused) return;
    if (game.timers.untimed || game.timers.sideUntimed?.[game.activeSide]) return;
    const intervalId = window.setInterval(() => {
      setGame((current) => (current ? advanceRunningClock(current) : current));
    }, TIMER_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [
    view,
    game?.activeSide,
    game?.status,
    game?.timers.paused,
    game?.timers.untimed,
    game?.timers.sideUntimed,
  ]);

  useEffect(() => {
    if (view !== "game" || !game?.matchControl) return;
    const blockedUntil = Object.values(game.matchControl.stopBlockedUntilBySide ?? {})
      .map((value) => Date.parse(value ?? ""))
      .filter(Number.isFinite);
    if (!game.matchControl.stopRequest && !blockedUntil.some((value) => value > Date.now())) return;
    setLifecycleNow(Date.now());
    const intervalId = window.setInterval(() => setLifecycleNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [
    view,
    game?.matchControl?.stopRequest?.id,
    game?.matchControl?.stopBlockedUntilBySide?.A,
    game?.matchControl?.stopBlockedUntilBySide?.B,
  ]);

  // Persist the active room's full state locally on every change (incl. timer ticks).
  useEffect(() => {
    if (remoteEnabled) return;
    if (!game || !activeRoomId) return;
    if (hasDuplicateTileIds(game)) return;
    if (game.status === "playing" && (actionMode !== "none" || pendingPlacements.length > 0))
      return;
    roomStore.saveRoomState(activeRoomId, game);
  }, [game, activeRoomId, remoteEnabled, actionMode, pendingPlacements.length]);

  // Supabase state sync: excludes timer-only ticks, but includes submitted turns,
  // undo/redo, score edits, pause/resume, end/resume, and room metadata changes.
  useEffect(() => {
    if (view !== "game" || !remoteEnabled || !game || !activeRoomId || !canWriteActiveRoom) return;
    if (hasDuplicateTileIds(game)) return;
    // While a turn action is being composed, `game` is intentionally a local
    // working copy: pending place removes tiles from the rack before the board
    // move is committed. Persisting that half-state makes other clients see
    // tiles disappear if the room row arrives before the live draft row.
    if (game.status === "playing" && (actionMode !== "none" || pendingPlacements.length > 0))
      return;
    if (remoteStateKey === lastAppliedStateKeyRef.current) return;
    const event = pendingSessionEventRef.current ?? "state";
    pendingSessionEventRef.current = null;
    lastAppliedStateKeyRef.current = remoteStateKey;
    // One intent, one id. If this effect retries the same position the server
    // recognizes the id and refuses to apply the change a second time.
    const commandId = commandIdFor(commandIdsByStateKeyRef.current, remoteStateKey);
    const expectedRevision = revisionOf(game);
    setBackgroundSyncCount((count) => count + 1);
    void remoteRooms
      .commitRoomState({
        id: activeRoomId,
        game,
        session: liveSession,
        event,
        expectedRevision,
        commandId,
        issuedBy: invitedSides.length === 1 ? invitedSides[0] : "host",
      })
      .then((result) => {
        if (result.outcome === "conflict") {
          // Someone else committed against this revision first. This client's
          // change was not applied and must not be retried on top of a position
          // it was never composed against: take authoritative state instead.
          setSyncError(null);
          lastAppliedStateKeyRef.current = "";
          void reconcileActiveRoom();
          return;
        }
        // Adopt the confirmed position so the next commit names it. The content
        // is unchanged, so this cannot disturb anything on screen.
        setGame((current) =>
          current && current.gameId === game.gameId && revisionOf(current) < result.revision
            ? withRevision(current, result.revision)
            : current,
        );
        setSyncError(null);
        setRooms((current) =>
          current.map((room) =>
            room.id === activeRoomId
              ? {
                  ...room,
                  name: game.name,
                  playerA: game.players.A,
                  playerB: game.players.B,
                  memberAId: game.playerMembers?.A ?? null,
                  memberBId: game.playerMembers?.B ?? null,
                  inviteUserAId: game.playerUserIds?.A ?? null,
                  inviteUserBId: game.playerUserIds?.B ?? null,
                  inviteEmailA: game.playerEmails?.A ?? null,
                  inviteEmailB: game.playerEmails?.B ?? null,
                  startingSide: game.startingSide,
                  turnNumber: game.turnNumber,
                  scoreA: game.scores.A,
                  scoreB: game.scores.B,
                  status: game.status,
                  updatedAt: game.lastSavedAt,
                }
              : room,
          ),
        );
      })
      .catch(async (error: Error) => {
        setSyncError(error.message);
        try {
          const authoritative = await remoteRooms.readRoom(activeRoomId);
          if (authoritative) applyRemotePayload(authoritative, { allowRollback: true });
        } catch {
          // Keep the original write error visible when recovery cannot load.
        }
      })
      .finally(() => setBackgroundSyncCount((count) => Math.max(0, count - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    remoteEnabled,
    activeRoomId,
    canWriteActiveRoom,
    remoteStateKey,
    actionMode,
    pendingPlacements.length,
  ]);

  // Supabase live draft sync: lets spectators see pending placement/exchange state.
  useEffect(() => {
    const sessionIsEmpty = isEmptyLiveSession(liveSession);
    const canPublishLiveSession =
      canPlayActiveRoom || (sessionIsEmpty && shouldFlushEmptyLiveSessionRef.current);
    if (view !== "game" || !remoteEnabled || !activeRoomId || !canPublishLiveSession) return;
    if (liveSessionKey === lastAppliedSessionKeyRef.current) return;
    lastAppliedSessionKeyRef.current = liveSessionKey;
    if (liveSessionSyncTimerRef.current !== null)
      window.clearTimeout(liveSessionSyncTimerRef.current);
    const syncLiveSession = () => {
      liveSessionSyncTimerRef.current = null;
      void remoteRooms
        .updateRoomSession(activeRoomId, liveSession)
        .then(() => {
          if (sessionIsEmpty) shouldFlushEmptyLiveSessionRef.current = false;
          setSyncError(null);
        })
        .catch((error: Error) => setSyncError(error.message));
    };
    if (sessionIsEmpty) syncLiveSession();
    else
      liveSessionSyncTimerRef.current = window.setTimeout(
        syncLiveSession,
        LIVE_SESSION_SYNC_DEBOUNCE_MS,
      );
    return () => {
      if (liveSessionSyncTimerRef.current !== null) {
        window.clearTimeout(liveSessionSyncTimerRef.current);
        liveSessionSyncTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, remoteEnabled, activeRoomId, canPlayActiveRoom, liveSessionKey]);

  // Refresh the lobby summary only when meaningful fields change (not per second).
  useEffect(() => {
    if (remoteEnabled) return;
    if (!game || !activeRoomId) return;
    setRooms(roomStore.touchRoomMeta(activeRoomId, game));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    remoteEnabled,
    activeRoomId,
    game?.name,
    game?.turnNumber,
    game?.scores.A,
    game?.scores.B,
    game?.status,
  ]);

  useEffect(() => {
    if (
      !game ||
      view !== "game" ||
      game.status !== "playing" ||
      (game.phase !== "refill" && game.phase !== "choose_action" && game.phase !== "perform_action")
    ) {
      refillBaselineRef.current = null;
      return;
    }
    const current = refillBaselineRef.current;
    if (refillBaselineMatchesTurn(current, game)) return;
    if (game.phase !== "refill") return;
    // Play mode captures the pre-draw rack synchronously before auto-refill runs.
    if (getTileDrawMode(game) === "play") return;
    refillBaselineRef.current = captureRefillBaseline(game);
  }, [game, view]);

  useEffect(() => {
    if (!game || view !== "game" || readOnly || replayCursor !== null) return;
    if (restoringUndoRef.current) return;
    if (getTileDrawMode(game) !== "play") return;
    if (game.status !== "playing" || actionMode !== "none" || game.phase !== "refill") return;
    if (isRackReady(game)) return;
    if (!refillBaselineMatchesTurn(refillBaselineRef.current, game)) {
      refillBaselineRef.current = captureRefillBaseline(game);
    }
    pendingSessionEventRef.current = "state";
    setGame(refillRackFromQueue(game));
  }, [actionMode, game, readOnly, replayCursor, view]);

  // Mobile tile-pick sheet lifecycle: auto-open once per manual refill. The
  // sheet owns its close animation, so a completed rack must not unmount it
  // from here before the downward transition has finished.
  useEffect(() => {
    if (view !== "game" || !game) return;
    const pickable =
      getTileDrawMode(game) !== "play" &&
      !readOnly &&
      replayCursor === null &&
      game.status === "playing" &&
      game.phase === "refill" &&
      actionMode === "none" &&
      getRack(game, game.activeSide).length < RACK_SIZE &&
      game.tilebag.length > 0;
    if (!pickable) {
      return;
    }
    const key = `${game.gameId}:${game.turnNumber}:${game.activeSide}`;
    if (bagAutoOpenKeyRef.current === key) return;
    bagAutoOpenKeyRef.current = key;
    if (window.matchMedia(`(max-width: ${MOBILE_LAYOUT_MAX_PX}px)`).matches) {
      setMobileBagOpen(true);
    }
  }, [actionMode, game, readOnly, replayCursor, view]);

  // Size the board from the whole board zone so the bottom rack stays in the
  // same viewport while the board remains as large as the available height allows.
  useEffect(() => {
    if (view !== "game") return;
    const el = boardZoneRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      // Phone layout: labels are hidden and the rack lives in a fixed bottom
      // dock, so size purely from viewport width/height so the whole board is
      // visible above the dock without scrolling.
      if (window.matchMedia(`(max-width: ${MOBILE_LAYOUT_MAX_PX}px)`).matches) {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const dockRackHeight = (window.innerWidth - 48) / RACK_SIZE;
        // MOBILE_BOARD_INSET_PX already represents every pixel outside the
        // 15 cells (board border + grid-wrap padding). Keep the fractional
        // result so the board reaches both viewport edges instead of losing
        // as much as 14px to Math.floor rounding.
        const sizeByWidth = (w - MOBILE_BOARD_INSET_PX) / BOARD_SIZE;
        const sizeByHeight = (viewportHeight - MOBILE_CHROME_BASE_PX - dockRackHeight) / BOARD_SIZE;
        const rawSize = Math.max(
          BOARD_CELL_MIN_PX,
          Math.min(BOARD_CELL_MAX_PX, Math.min(sizeByWidth, sizeByHeight)),
        );
        const size = Math.floor(rawSize * 100) / 100;
        setBoardCell((prev) => (prev === size ? prev : size));
        return;
      }
      const labelGutterX = BOARD_ROW_LABEL_WIDTH_PX + BOARD_BORDER_TOTAL_PX;
      const labelGutterY = BOARD_COLUMN_LABEL_HEIGHT_PX + BOARD_BORDER_TOTAL_PX;
      const sizeByWidth = (w - labelGutterX - BOARD_SAFETY_INSET_PX * 2) / BOARD_SIZE;
      const sizeByHeight =
        (h - BOARD_RACK_CHROME_PX - labelGutterY - BOARD_SAFETY_INSET_PX) /
        (BOARD_SIZE + RACK_HEIGHT_TO_CELL_RATIO);
      const size = Math.max(
        BOARD_CELL_MIN_PX,
        Math.min(
          BOARD_CELL_MAX_PX,
          Math.floor(Math.min(sizeByWidth, sizeByHeight) * BOARD_CELL_SCALE),
        ),
      );
      setBoardCell((prev) => (prev === size ? prev : size));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // Mobile sizing reads window.innerHeight, which can change (URL bar,
    // rotation) without resizing the observed element — listen directly.
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    // Layout may not be stable on the first paint — measure again next frame.
    const rafId = window.requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.cancelAnimationFrame(rafId);
    };
  }, [view, game?.gameId]);

  // Keyboard 1–8 acts like clicking that rack slot (live play OR replay
  // practice). Backspace removes the most-recently placed pending tile AND
  // moves the cursor back to that cell so the user can immediately re-place.
  // Ignored when typing in a field.
  //
  // Rapid-fire safety: the live 1–8 path reads its state from refs (kept in
  // sync with React state on every render) and updates those refs inline so
  // back-to-back keystrokes never see stale closure data. Without this, two
  // fast presses can both target the same cursor cell.
  useEffect(() => {
    if (view !== "game" || !game) return;
    const isReplayBefore = replayCursor !== null && replayCursor % 2 === 0 && Boolean(replayDraft);
    if (readOnly && !isReplayBefore) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (target?.isContentEditable ?? false)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const consumed = () => {
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
      };

      if ((event.key === "e" || event.key === "E") && selectedPendingTileId && !assignmentRequest) {
        if (openPendingAssignmentEditor(selectedPendingTileId)) {
          consumed();
          return;
        }
      }

      // Backspace / Delete: undo the last placement (LIFO) and rewind the
      // cursor to that cell so the next key/click can immediately re-place.
      if (event.key === "Backspace" || event.key === "Delete") {
        if (isReplayBefore && replayDraft) {
          const last = replayDraft.placements.at(-1);
          if (!last) return;
          consumed();
          const replayRack = replayDraft.rack.slice();
          const replaySlot = last.rackSlot ?? replayRack.indexOf(null);
          if (replaySlot >= 0 && replaySlot < RACK_SIZE) replayRack[replaySlot] = last.tile;
          else replayRack.push(last.tile);
          setReplayDraft({
            rack: replayRack,
            placements: replayDraft.placements.slice(0, -1),
          });
          setSelectedRackTileId(null);
          setSelectedPendingTileId(null);
          setPlacementCursor((cur) => ({
            row: last.row,
            col: last.col,
            dir: last.cursorDir ?? cur?.dir ?? "right",
          }));
          return;
        }
        const handled = undoLastLivePlacement();
        if (handled || actionModeRef.current === "place_equation") consumed();
        return;
      }

      const digit = parseInt(event.key, 10);
      if (!Number.isFinite(digit) || digit < 1 || digit > RACK_SIZE) return;

      // Replay path: keep using the simple click handler — replayDraft state
      // is locked to whatever the cursor moment was, so race isn't an issue.
      if (isReplayBefore) {
        if (selectedPendingTileId) {
          consumed();
          returnReplayPendingToRackSlot(digit - 1);
          return;
        }
        const tile = replayDraft!.rack[digit - 1];
        if (!tile) return;
        consumed();
        handleRackTileClick(tile, game.activeSide);
        return;
      }

      // Live path — read from refs for race safety.
      const currentGame = gameRef.current;
      if (!currentGame) return;
      const currentCursor = cursorRef.current;
      const currentPendings = pendingsRef.current;
      const rack = getRack(currentGame, currentGame.activeSide);
      const rackSlot = digit - 1;
      const tile = rackSlotsFrom(currentGame, currentGame.activeSide, rackLayoutRef.current)[
        rackSlot
      ];

      if (selectedPendingTileId) {
        consumed();
        handleEmptyRackSlotClick(digit - 1, currentGame.activeSide);
        return;
      }
      if (!tile) return;
      if (
        currentGame.phase === "refill" &&
        refillBaselineMatchesTurn(refillBaselineRef.current, currentGame) &&
        refillBaselineRef.current.ids.includes(tile.id)
      ) {
        return;
      }

      // Fast atomic cursor placement: read+update refs in one pass.
      if (currentCursor) {
        const cellOccupied =
          Boolean(currentGame.board[currentCursor.row][currentCursor.col]) ||
          currentPendings.some((p) => p.row === currentCursor.row && p.col === currentCursor.col);
        if (cellOccupied) {
          // The cursor cell got filled between renders — fall through to the
          // generic handler, which will select the tile or skip the place.
          consumed();
          handleRackTileClick(tile, currentGame.activeSide);
          return;
        }
        if (tileNeedsAssignment(tile.token) && !tile.assignedToken) {
          consumed();
          if (actionModeRef.current === "none") {
            beginPlaceActionFromGame(currentGame, false);
            const actionGame = {
              ...currentGame,
              phase: "perform_action" as Phase,
              lastSavedAt: new Date().toISOString(),
            };
            gameRef.current = actionGame;
            setGame(actionGame);
          }
          setSelectedRackTileId(null);
          setSelectedPendingTileId(null);
          setAssignmentRequest({
            kind: "place",
            tile,
            row: currentCursor.row,
            col: currentCursor.col,
            dir: currentCursor.dir,
            rackSlot,
          });
          return;
        }
        consumed();
        // Compute new state from refs (not closure).
        const placement: PendingPlacement = {
          tile,
          row: currentCursor.row,
          col: currentCursor.col,
          assignedToken: tile.assignedToken,
          cursorDir: currentCursor.dir,
          rackSlot,
        };
        const newPendings = [...currentPendings, placement];
        const nextLayout = removeTileFromRackLayout(currentGame.activeSide, tile.id);
        const newRack = rackFromSlots(
          rack.filter((t) => t.id !== tile.id),
          currentGame.activeSide,
          nextLayout,
        );
        const newGame = setRack(
          { ...currentGame, lastSavedAt: new Date().toISOString() },
          currentGame.activeSide,
          newRack,
        );
        // Walk the cursor forward past occupied cells using the FRESH list.
        const taken = new Set(newPendings.map((p) => `${p.row}:${p.col}`));
        let next: typeof currentCursor | null = { ...currentCursor };
        while (next) {
          let nr: number = next.row;
          let nc: number = next.col;
          if (next.dir === "right") nc += 1;
          else if (next.dir === "left") nc -= 1;
          else if (next.dir === "down") nr += 1;
          else nr -= 1;
          if (nr < 0 || nc < 0 || nr >= BOARD_SIZE || nc >= BOARD_SIZE) {
            next = null;
            break;
          }
          const blocked = Boolean(newGame.board[nr][nc]) || taken.has(`${nr}:${nc}`);
          if (!blocked) {
            next = { row: nr, col: nc, dir: next.dir };
            break;
          }
          next = { row: nr, col: nc, dir: next.dir };
        }
        // Auto-start Place mode if needed, then sync refs first — the next
        // keystroke (even in the same tick) gets fresh state.
        const autoStartedPlace = actionModeRef.current === "none";
        if (autoStartedPlace) {
          beginPlaceActionFromGame(currentGame);
        }
        const finalGame = autoStartedPlace
          ? { ...newGame, phase: "perform_action" as Phase }
          : newGame;
        pendingsRef.current = newPendings;
        gameRef.current = finalGame;
        cursorRef.current = next;
        // Then trigger React updates.
        setPendingPlacements(newPendings);
        setGame(finalGame);
        setPlacementCursor(next);
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        return;
      }

      // No cursor → fall back to the generic click handler (selects the tile).
      consumed();
      handleRackTileClick(tile, currentGame.activeSide);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    view,
    game?.gameId,
    readOnly,
    replayCursor,
    replayDraft,
    selectedPendingTileId,
    assignmentRequest,
  ]);

  // Reset the undo timeline whenever a different game is opened/created/closed.
  // Declared BEFORE the capture effect so it clears state before capture runs.
  useEffect(() => {
    resetUndoHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.gameId]);

  // Capture every mutation as an undoable record (draw, place, swap, remove,
  // exchange pick, commit…). One undo steps back one record; past the first
  // record of a turn it continues into the previous turn.
  useEffect(() => {
    if (!game || view !== "game") return;
    const snap: UndoSnap = { game, actionMode, pendingPlacements, exchangeDraft };
    if (restoringUndoRef.current) {
      restoringUndoRef.current = false;
      lastSnapRef.current = snap;
      lastMutationKeyRef.current = undoMutationKey;
      return;
    }
    if (lastSnapRef.current === null || lastMutationKeyRef.current === "") {
      lastSnapRef.current = snap;
      lastMutationKeyRef.current = undoMutationKey;
      return;
    }
    if (undoMutationKey === lastMutationKeyRef.current) {
      lastSnapRef.current = snap;
      return;
    }
    undoStackRef.current.push(lastSnapRef.current);
    if (undoStackRef.current.length > 250) undoStackRef.current.shift();
    redoStackRef.current = [];
    lastSnapRef.current = snap;
    lastMutationKeyRef.current = undoMutationKey;
    bumpUndoVersion((value) => value + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoMutationKey, view]);

  const activeRack = game ? getRack(game, game.activeSide) : [];

  const validation = useMemo(() => {
    if (!game) return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    // Replay practice (before-phase) validates against the log's boardBefore
    // using the draft placements. Live play validates against the live board.
    if (replayCursor !== null) {
      const idx = Math.floor(replayCursor / 2);
      const log = game.logs[idx];
      if (replayCursor % 2 === 0 && log && replayDraft && replayDraft.placements.length > 0) {
        return validateMove(log.boardBefore, replayDraft.placements);
      }
      return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    }
    if (actionMode !== "place_equation") {
      return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    }
    return validateMove(game.board, pendingPlacements);
  }, [actionMode, game, pendingPlacements, replayCursor, replayDraft]);

  // Derived replay state from the cursor.
  const replayPhase: "before" | "after" =
    replayCursor !== null && replayCursor % 2 === 0 ? "before" : "after";
  const selectedLog = useMemo(() => {
    if (!game || replayCursor === null) return null;
    const idx = Math.floor(replayCursor / 2);
    return game.logs[idx] ?? null;
  }, [game, replayCursor]);
  const selectedLogId = selectedLog?.id ?? null;
  const reviewing = Boolean(selectedLog);

  // Replay-time score / timer overrides. This hook must stay before the
  // lobby/loading return so App calls the same hooks in every render.
  const replayOverrides = useMemo(() => {
    if (!game || !selectedLog) return null;
    const logIdx = game.logs.findIndex((log) => log.id === selectedLog.id);
    if (logIdx < 0) return null;
    // "before" phase: state right after refill, BEFORE the action.
    // Equivalent to the AFTER state of the previous log (or initial if none).
    // "after" phase: state right after the action (this log's after).
    const useThis = replayPhase === "after";
    const ref = useThis ? selectedLog : (game.logs[logIdx - 1] ?? null);
    // Sum finalScore per side over all logs whose state is "included" at this point.
    const upTo = useThis ? logIdx : logIdx - 1;
    const scores: Record<Side, number> = { A: 0, B: 0 };
    for (let i = 0; i <= upTo; i += 1) {
      const entry = game.logs[i];
      if (!entry) break;
      scores[entry.side] += entry.finalScore;
    }
    // Timers: snapshot of each side's clock at this half-step. "after" uses
    // this log's timerAfter; "before" uses prior log's timerAfter (or initial).
    const initialSeconds = game.timers.initialSeconds;
    const initialTimers: Record<Side, number> = game.timers.initialSecondsBySide ?? {
      A: initialSeconds,
      B: initialSeconds,
    };
    const timers: Record<Side, number> = useThis
      ? selectedLog.timerAfter
      : (ref?.timerAfter ?? initialTimers);
    return { scores, timers };
  }, [game, selectedLog, replayPhase]);

  // Sync the per-side display layout with the underlying game.rackA / rackB.
  // Rules:
  //  • Tiles that are still in the rack keep their slot.
  //  • Tiles that have left the rack vacate their slot (slot → null).
  //  • New tiles take the first empty slot.
  // Result: empty slots stay in place, no left-shift "collapse".
  useEffect(() => {
    if (!game) return;
    setRackLayout((current) => {
      const next: Record<Side, (string | null)[]> = { A: current.A.slice(), B: current.B.slice() };
      for (const side of ["A", "B"] as Side[]) {
        next[side] = reconcileRackLayout(current[side], getRack(game, side));
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.rackA, game?.rackB, game?.gameId]);

  // Reset / seed the replay practice sandbox whenever the cursor changes.
  useEffect(() => {
    if (replayCursor === null) {
      setReplayDraft(null);
      setPlacementCursor(null);
      return;
    }
    const idx = Math.floor(replayCursor / 2);
    const log = game?.logs[idx];
    if (!log) {
      setReplayDraft(null);
      return;
    }
    const isBeforePhase = replayCursor % 2 === 0;
    if (isBeforePhase) {
      // Seed a sandbox with this turn's rack-before; no placements yet.
      setReplayDraft({ rack: log.rackBefore.slice(), placements: [] });
    } else {
      setReplayDraft(null);
    }
    setPlacementCursor(null);
  }, [replayCursor, game?.gameId, game?.logs.length]);

  // ── Bot match: the engine plays its side automatically ─────────────────────
  //
  // The engine is a shared server-side resource now, not this tab's CPU, so a
  // bot turn can be QUEUED before it is COMPUTED and can be refused because
  // other people are using the engine. Two consequences are handled here:
  //
  //   • The player is told which of the two is happening. An unmoving board
  //     with no explanation is indistinguishable from a broken app.
  //   • Overload is retried, not treated as a verdict. Falling back to a pass
  //     is a real, scoring, irreversible game action; "the server was busy for
  //     four seconds" is not a reason to take one.
  const [botStatus, setBotStatus] = useState<BotThinkingState | null>(null);
  /** A line explaining an engine problem the player can otherwise only observe
   *  as the bot not moving. Cleared as soon as the bot moves. */
  const [botNotice, setBotNotice] = useState<string | null>(null);
  // Reasoning behind the bot's most recent move, kept so the player can open a
  // full "why this move" breakdown (chosen move + every alternative weighed).
  const [botReasoning, setBotReasoning] = useState<{
    logId: string;
    turnNumber: number;
    playerName: string;
    response: BotResponse;
  } | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const botTurnRef = useRef<string | null>(null);
  const botShouldMove = Boolean(
    game &&
    game.botSide &&
    game.status === "playing" &&
    getRoomStage(game) === "playing" &&
    game.activeSide === game.botSide &&
    game.phase === "choose_action" &&
    !reviewing &&
    canControlActiveGame &&
    !readOnly,
  );
  useEffect(() => {
    if (game?.botSide) warmUpBotEngine();
  }, [game?.gameId, game?.botSide]);

  // ── Turn analysis availability ─────────────────────────────────────────────
  //
  // Analysis assists a HUMAN decision, so it is offered on any turn a human is
  // on move and the viewer is the one who controls it. That covers every mode
  // where it means anything: pass-and-play, hosted, direct, solo, and the human
  // side of an Aether match. It is never offered on the bot's turn.
  //
  // These flags decide what is RENDERED. They are not the decision — the
  // backend re-derives all of it from the room row and refuses a request that
  // does not satisfy it, whether or not a button was ever drawn.
  const analysisTurnIsBot = Boolean(game?.botSide && game.activeSide === game.botSide);
  const analysisAvailable = Boolean(
    game &&
    isEngineApiConfigured &&
    remoteEnabled &&
    game.status === "playing" &&
    getRoomStage(game) === "playing" &&
    !reviewing,
  );
  const canAnalyzeTurn = Boolean(
    analysisAvailable &&
    game &&
    !analysisTurnIsBot &&
    canActActiveSide &&
    game.phase !== "refill",
  );
  const analysisDisabledReason = analysisTurnIsBot
    ? "วิเคราะห์ได้เฉพาะตาของผู้เล่นที่เป็นมนุษย์"
    : !canActActiveSide
      ? "วิเคราะห์ได้เฉพาะตาของคุณเอง"
      : game?.phase === "refill"
        ? "จั่วไทล์ให้ครบก่อนจึงจะวิเคราะห์ได้"
        : undefined;
  // When a bot match finishes, append its summary to whichever stat folder the
  // admin currently has open (the server no-ops if none is open). Only games we
  // watched go from in-progress → finished this session are recorded, so merely
  // opening an old finished bot game never re-logs it into a newer folder. The
  // RPC also upserts by (folder, game) as a second guard against double-counting.
  const recordedBotGamesRef = useRef<Set<string>>(new Set());
  const sawLiveBotGameRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!game?.botSide) return;
    if (game.status !== "finished") {
      sawLiveBotGameRef.current.add(game.gameId);
      return;
    }
    if (!sawLiveBotGameRef.current.has(game.gameId)) return; // loaded, not just played
    if (recordedBotGamesRef.current.has(game.gameId)) return;
    const record = botRecordFromGame(game, activeRoomIdRef.current);
    if (!record) return;
    recordedBotGamesRef.current.add(game.gameId);
    void recordBotGame(record).catch(() => {
      // Best effort: allow a later render to retry if the write failed.
      recordedBotGamesRef.current.delete(game.gameId);
    });
  }, [game?.gameId, game?.botSide, game?.status]);
  useEffect(() => {
    if (!botShouldMove || !game) return;
    const commitId = game.commitId;
    if (botTurnRef.current === commitId) return;
    botTurnRef.current = commitId;
    let alive = true;
    let handle: BotThinkHandle | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (tries: number) => {
      // Re-read the game each time rather than closing over it: a retry must
      // ask about the position as it stands, and if the game has moved on this
      // effect's work is already void.
      const current = gameRef.current;
      if (!alive || !current || current.commitId !== commitId) return;

      setBotStatus({ kind: "requesting" });
      // The request names the game and its revision; the backend reads the
      // position for itself. Nothing about the board, the racks or the bag is
      // described by this client any more.
      handle = thinkWithBot(current, (state) => {
        if (alive) setBotStatus(state);
      });
      handle.promise
        .then((response) => {
          if (!alive) return;
          setBotStatus(null);
          setBotNotice(null);
          if (gameRef.current?.commitId === commitId) commitBotResponse(response);
        })
        .catch((error: unknown) => {
          if (!alive) return;
          setBotStatus(null);
          // The game moved on under us. Whatever came back describes a board
          // that no longer exists, and the effect for the new position is
          // already running.
          if (gameRef.current?.commitId !== commitId) return;

          if (isDesyncBotFailure(error)) {
            // The server's view of this game is ahead of ours. Committing
            // anything — including a pass — would write into a position we do
            // not actually have. Wait for sync to catch up instead.
            setBotNotice("กระดานบนเซิร์ฟเวอร์เปลี่ยนไปแล้ว — กำลังรอข้อมูลล่าสุด");
            return;
          }

          if (isRetryableBotFailure(error) && tries < BOT_RETRY_DELAYS_MS.length) {
            setBotNotice(botNoticeFor(error));
            retryTimer = setTimeout(
              () => attempt(tries + 1),
              BOT_RETRY_DELAYS_MS[tries] ?? 8_000,
            );
            return;
          }

          console.error("Bot engine failed; falling back to pass.", error);
          setBotNotice(botNoticeFor(error));
          commitBotResponse(null);
        });
    };

    attempt(0);

    return () => {
      alive = false;
      handle?.cancel();
      if (retryTimer) clearTimeout(retryTimer);
      if (botTurnRef.current === commitId) botTurnRef.current = null;
      setBotStatus(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botShouldMove, game?.commitId]);

  // Set the selection from a log id (called by TurnRecordList / LogPanel).
  // Selecting a log opens the "action applied" view of that log.
  function selectLog(logId: string | null) {
    if (logId === null || !game) {
      setReplayCursor(null);
      return;
    }
    const idx = game.logs.findIndex((log) => log.id === logId);
    if (idx < 0) {
      setReplayCursor(null);
      return;
    }
    setReplayCursor(idx * 2 + 1);
  }

  const coffeeReturn =
    coffeeRoomId && route.kind !== "play" ? (
      <CoffeeReturnButton
        roomName={rooms.find((room) => room.id === coffeeRoomId)?.name ?? "paused game"}
        onReturn={() => void returnToCoffeeRoom()}
      />
    ) : null;

  if (route.kind === "admin") {
    return <AdminPage section={route.section} />;
  }

  if (route.kind === "home") {
    return (
      <>
        <Lobby
          visibility={route.visibility}
          section={route.section ?? "rooms"}
          regionName={regionName}
          regionAvailable={Boolean(userId && regionId)}
          loading={roomsLoading}
          rooms={rooms}
          syncError={syncError}
          getRoomRole={getRoomRole}
          onOpen={openRoom}
          onJoinRoom={() => {
            setJoinError(null);
            navigate({ kind: "join", visibility: route.visibility });
          }}
          onRename={renameRoomById}
          onDelete={deleteRoomById}
          onExport={exportRoomById}
          onChangeSection={(section) =>
            navigate({ kind: "home", visibility: route.visibility, section })
          }
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncCount > 0} />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "create") {
    return (
      <>
        <CreateRoomPage
          key={`${route.visibility}:${route.preset ?? "room"}`}
          canCreate={canCreateInScope}
          createDisabledReason={createDisabledReason}
          visibility={route.visibility}
          regionAvailable={Boolean(userId && regionId)}
          regionId={regionId}
          regionName={regionName}
          preset={route.preset}
          submitting={Boolean(foregroundLoading)}
          onBack={() => navigate({ kind: "home", visibility: route.visibility })}
          onCreate={createAndOpenRoom}
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncCount > 0} />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "join") {
    return (
      <>
        <JoinRoomPage
          busy={Boolean(foregroundLoading)}
          error={joinError}
          visibility={route.visibility}
          regionName={regionName}
          onBack={() => navigate({ kind: "home", visibility: route.visibility })}
          onJoin={joinRoomByCode}
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncCount > 0} />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "room") {
    if (!game || !activeRoomMeta) {
      return <LoadingScreen message={foregroundLoading ?? "Opening waiting room..."} />;
    }
    return (
      <>
        <WaitingRoomPage
          busy={Boolean(foregroundLoading)}
          game={game}
          meta={activeRoomMeta}
          onBack={() => void leaveActiveWaitingRoom()}
          onCancel={() => void cancelWaitingRoom()}
          onReady={(side, ready) => void updateWaitingReady(side, ready)}
          onSaveConfig={(settings) => void saveWaitingRoomConfig(settings)}
          onShare={shareWaitingRoom}
          onStart={() => void startActiveWaitingRoom()}
        />
        <GlobalActivity
          error={syncError}
          foreground={foregroundLoading}
          syncing={backgroundSyncCount > 0}
        />
        {coffeeReturn}
      </>
    );
  }

  if (view !== "game" || !game) {
    return <LoadingScreen message={foregroundLoading ?? "Opening room..."} />;
  }

  function startForegroundLoading(message: string): () => void {
    const operationId = ++foregroundOperationRef.current;
    setForegroundLoading(message);
    return () => {
      if (foregroundOperationRef.current === operationId) setForegroundLoading(null);
    };
  }

  function resetRemoteRoomTracking() {
    lastAppliedSessionKeyRef.current = "";
    lastAppliedSessionUpdatedAtRef.current = "";
    lastAppliedSessionScopeRef.current = "";
    lastAppliedSessionActorIdRef.current = null;
    deferredRemoteSessionRef.current = null;
  }

  async function openRoom(id: string): Promise<boolean> {
    const finishLoading = startForegroundLoading("Opening room...");
    try {
      const remotePayload = remoteEnabled ? await remoteRooms.readRoom(id) : null;
      const storedGame = remotePayload?.game ?? roomStore.readRoom(id);
      if (!storedGame || hasDuplicateTileIds(storedGame)) {
        setSyncError("This room cannot be opened because its data is damaged.");
        return false;
      }
      const saved = advanceRunningClock(normalizeFinishedGame(storedGame));
      resetRemoteRoomTracking();
      cancelDraftOnly();
      setReplayCursor(null);
      if (!remoteEnabled) roomStore.setActiveRoomId(id);
      setActiveRoomId(id);
      setGame(saved);
      lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
      if (remotePayload) {
        setLobbyVisibility(remotePayload.meta.visibility ?? "public");
        setRooms((current) => upsertRoomMeta(current, remotePayload.meta));
        applyRemoteSession(remotePayload.session, saved);
        compactRemoteRoomIfNeeded(remotePayload, saved);
      }
      navigate(
        getRoomStage(saved) === "waiting"
          ? { kind: "room", roomId: id }
          : { kind: "play", roomId: id },
      );
      setShowResult(isFinishedGame(saved));
      setSyncError(null);
      return true;
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
      return false;
    } finally {
      finishLoading();
    }
  }

  async function createAndOpenRoom(
    newSettings: NewGameSettings,
    policy?: remoteRooms.CreateRoomPolicy,
  ) {
    const visibility =
      policy?.accessScope === "region"
        ? "region"
        : route.kind === "create"
          ? route.visibility
          : lobbyVisibility;
    const roomScope = makeRoomScope(visibility, regionId);
    if (!canCreateRoom || !roomScope) {
      setSyncError(createDisabledReason ?? "You cannot create a room right now.");
      return;
    }
    const isSoloRoom = getGameMode(newSettings) === "solo";
    const playerUserAId = normalizeUserId(newSettings.playerAUserId);
    const playerUserBId = isSoloRoom ? null : normalizeUserId(newSettings.playerBUserId);
    const playerEmailA = normalizeEmail(newSettings.playerAEmail);
    const playerEmailB = isSoloRoom ? null : normalizeEmail(newSettings.playerBEmail);
    const usesEmailPlay = Boolean(playerUserAId || playerUserBId || playerEmailA || playerEmailB);
    const requestedEmailMode = newSettings.emailPlayMode ?? "hosted";
    const creatorAssigned = Boolean(
      (userId && [playerUserAId, playerUserBId].includes(userId)) ||
      (accountEmail && [playerEmailA, playerEmailB].includes(accountEmail)),
    );
    const invalidDirectRoom =
      requestedEmailMode === "direct" &&
      (isSoloRoom ||
        !playerUserAId ||
        !playerUserBId ||
        playerUserAId === playerUserBId ||
        !creatorAssigned);
    const invalidHostedRoom =
      requestedEmailMode === "hosted" &&
      (!playerUserAId ||
        (!isSoloRoom && (!playerUserBId || playerUserAId === playerUserBId)) ||
        creatorAssigned);
    if (remoteEnabled && usesEmailPlay && (!userId || invalidDirectRoom || invalidHostedRoom)) {
      setSyncError(
        requestedEmailMode === "direct"
          ? "A direct match requires two different registered players, including your account."
          : isSoloRoom
            ? "A hosted solo room requires one registered player different from the host."
            : "A hosted match requires two different registered players, neither of whom is the host.",
      );
      return;
    }
    const waitingGame = createWaitingGame({
      ...newSettings,
      playerAUserId: playerUserAId,
      playerBUserId: playerUserBId,
      playerAEmail: playerEmailA,
      playerBEmail: playerEmailB,
      tileDrawMode:
        requestedEmailMode === "direct" || (isSoloRoom && !usesEmailPlay)
          ? "play"
          : newSettings.tileDrawMode,
    });
    const created = markOwnerSideReady(waitingGame, userId, accountEmail);
    const finishLoading = startForegroundLoading("Creating room...");
    try {
      if (remoteEnabled) {
        if (!userId) return;
        const session = remoteRooms.emptyLiveSession(userId);
        const {
          id,
          meta,
          game: remoteGame,
        } = await remoteRooms.createRoom(created, userId, session, roomScope, policy);
        resetRemoteRoomTracking();
        setRooms((current) => [meta, ...current.filter((room) => room.id !== id)]);
        setActiveRoomId(id);
        lastAppliedStateKeyRef.current = makeRemoteStateKey(remoteGame);
        lastAppliedSessionKeyRef.current = makeLiveSessionKey(session);
        cancelDraftOnly();
        setReplayCursor(null);
        setGame(remoteGame);
        navigate({ kind: "room", roomId: id });
        setSyncError(null);
        return;
      }
      const { id } = roomStore.createRoom(created, roomScope);
      resetRemoteRoomTracking();
      setRooms(roomStore.listRooms(roomScope));
      roomStore.setActiveRoomId(id);
      setActiveRoomId(id);
      cancelDraftOnly();
      setReplayCursor(null);
      setGame(created);
      navigate({ kind: "room", roomId: id });
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to create this room.");
    } finally {
      finishLoading();
    }
  }

  async function joinRoomByCode(value: string) {
    setJoinError(null);
    let availableRooms = rooms;
    const sharedMatch = value.match(/#\/(?:room|play)\/([^/?#]+)/i);
    const sharedId = sharedMatch?.[1] ? decodeURIComponent(sharedMatch[1]) : null;
    const directId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value.trim()) ? value.trim() : null;
    let id =
      resolveRoomCode(
        value,
        availableRooms.map((room) => room.id),
      ) ??
      sharedId ??
      directId;
    if (!id && remoteEnabled) {
      try {
        if (!requestedLobbyScope) {
          setJoinError("Your account does not have access to a region yet.");
          return;
        }
        availableRooms = await remoteRooms.listRooms(requestedLobbyScope);
        setRooms(availableRooms);
        id = resolveRoomCode(
          value,
          availableRooms.map((room) => room.id),
        );
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : "Unable to look up this room.");
        return;
      }
    }
    if (!id) {
      setJoinError("Room code not found. Check the code or ask the room creator for a new link.");
      return;
    }
    const opened = await openRoom(id);
    if (!opened) setJoinError("Unable to open this room. It may have been cancelled.");
  }

  async function saveWaitingRoomConfig(settings: NewGameSettings) {
    if (!game || !activeRoomId || !canConfigureWaitingRoom || getRoomStage(game) !== "waiting")
      return;
    const finishLoading = startForegroundLoading("Saving configuration...");
    try {
      const next = markOwnerSideReady(updateWaitingGame(game, settings), userId, accountEmail);
      await persistWaitingGame(next);
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to save room configuration.");
    } finally {
      finishLoading();
    }
  }

  async function updateWaitingReady(side: Side, ready: boolean) {
    if (!game || !activeRoomId || getRoomStage(game) !== "waiting") return;
    if (!invitedSides.includes(side) || canConfigureWaitingRoom) return;
    const finishLoading = startForegroundLoading(ready ? "Marking ready..." : "Updating status...");
    const previous = game;
    const next = {
      ...game,
      lobbyReadyBySide: { ...game.lobbyReadyBySide, [side]: ready },
    };
    setGame(next);
    try {
      if (remoteEnabled) await remoteRooms.updateRoomReady(activeRoomId, side, ready);
      else setRooms(roomStore.writeRoom(activeRoomId, next));
      setSyncError(null);
    } catch (error) {
      setGame(previous);
      setSyncError(error instanceof Error ? error.message : "Unable to update ready status.");
    } finally {
      finishLoading();
    }
  }

  async function startActiveWaitingRoom() {
    if (!game || !activeRoomId || !canConfigureWaitingRoom || getRoomStage(game) !== "waiting")
      return;
    const ownerEmail = normalizeEmail(activeRoomMeta?.ownerEmail);
    const waitingSides = getRequiredReadySides(
      game,
      activeRoomMeta?.ownerId ?? null,
      ownerEmail,
    ).filter((side) => !game.lobbyReadyBySide?.[side]);
    if (waitingSides.length > 0) return;
    const finishLoading = startForegroundLoading("Starting game...");
    try {
      const next = startWaitingGame(game);
      await persistWaitingGame(next);
      navigate({ kind: "play", roomId: activeRoomId });
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to start this game.");
    } finally {
      finishLoading();
    }
  }

  async function cancelWaitingRoom() {
    if (!activeRoomId || !canConfigureWaitingRoom) return;
    // WaitingRoomPage's in-app ConfirmSheet already asked; don't ask twice.
    await deleteRoomById(activeRoomId);
  }

  async function leaveActiveWaitingRoom() {
    if (!game || !activeRoomId || canConfigureWaitingRoom || invitedSides.length === 0) {
      navigate({ kind: "home", visibility: lobbyVisibility });
      return;
    }
    try {
      for (const side of invitedSides) {
        if (!game.lobbyReadyBySide?.[side]) continue;
        if (remoteEnabled) await remoteRooms.updateRoomReady(activeRoomId, side, false);
        else {
          const next = {
            ...game,
            lobbyReadyBySide: { ...game.lobbyReadyBySide, [side]: false },
          };
          setRooms(roomStore.writeRoom(activeRoomId, next));
          setGame(next);
        }
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to clear ready status.");
    } finally {
      navigate({ kind: "home", visibility: lobbyVisibility });
    }
  }

  async function shareWaitingRoom() {
    if (!activeRoomId) return;
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}#/room/${encodeURIComponent(activeRoomId)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: game?.name ?? "Equation Lab room", url });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        throw error;
      }
      return;
    }
    await copyText(url);
  }

  async function persistWaitingGame(next: GameState) {
    if (!activeRoomId) return;
    if (remoteEnabled) {
      await remoteRooms.commitRoomState({
        id: activeRoomId,
        game: next,
        session: remoteRooms.emptyLiveSession(userId),
        event: "state",
      });
      lastAppliedStateKeyRef.current = makeRemoteStateKey(next);
    } else {
      setRooms(roomStore.writeRoom(activeRoomId, next));
    }
    setGame(next);
    setRooms((current) =>
      current.map((room) =>
        room.id === activeRoomId
          ? {
              ...room,
              name: next.name,
              playerA: next.players.A,
              playerB: next.players.B,
              gameMode: getGameMode(next),
              inviteUserAId: next.playerUserIds?.A ?? null,
              inviteUserBId: next.playerUserIds?.B ?? null,
              inviteEmailA: next.playerEmails?.A ?? null,
              inviteEmailB: next.playerEmails?.B ?? null,
              status: next.status,
              updatedAt: new Date().toISOString(),
            }
          : room,
      ),
    );
  }

  function goToLobby() {
    cancelDraftOnly();
    setReplayCursor(null);
    setShowResult(false);
    if (remoteEnabled) {
      // Keep the already-rendered lobby list in place while refreshing it.
      // Replacing the whole list with a loading state on every exit makes
      // navigation feel like a reload even though usable data is available.
      if (rooms.length === 0) setRoomsLoading(true);
      const scope = makeRoomScope(lobbyVisibility, regionId);
      if (!scope) {
        setRooms([]);
        setRoomsLoading(false);
        navigate({ kind: "home", visibility: lobbyVisibility });
        return;
      }
      void remoteRooms
        .listRooms(scope)
        .then(setRooms)
        .catch((error: Error) => setSyncError(error.message))
        .finally(() => setRoomsLoading(false));
    } else {
      const scope = makeRoomScope(lobbyVisibility, regionId);
      setRooms(scope ? roomStore.listRooms(scope) : []);
    }
    navigate({ kind: "home", visibility: lobbyVisibility });
  }

  function rememberCoffeeRoom(roomId: string | null) {
    setCoffeeRoomId(roomId);
    if (roomId) window.localStorage.setItem(STORAGE_KEYS.coffeeRoom, roomId);
    else window.localStorage.removeItem(STORAGE_KEYS.coffeeRoom);
  }

  async function takeCoffeeBreak() {
    if (!activeRoomId || !game || game.status !== "playing") return;
    if (remoteEnabled && canPlayActiveRoom && !isEmptyLiveSession(liveSession)) {
      const session = remoteRooms.emptyLiveSession(userId);
      const finishLoading = startForegroundLoading("Leaving the board open...");
      try {
        await remoteRooms.updateRoomSession(activeRoomId, session);
        lastAppliedSessionKeyRef.current = makeLiveSessionKey(session);
        setSyncError(null);
      } catch (error) {
        setSyncError(
          error instanceof Error ? error.message : "Unable to leave this board cleanly.",
        );
        finishLoading();
        return;
      }
      finishLoading();
    }
    rememberCoffeeRoom(activeRoomId);
    goToLobby();
  }

  async function returnToCoffeeRoom() {
    if (!coffeeRoomId) return;
    const opened = await openRoom(coffeeRoomId);
    if (opened) rememberCoffeeRoom(null);
  }

  async function renameRoomById(id: string, name: string) {
    if (!canManageRoom(id)) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const finishLoading = startForegroundLoading("Renaming room...");
    try {
      if (remoteEnabled) {
        const target = id === activeRoomId && game ? game : (await remoteRooms.readRoom(id))?.game;
        if (!target) return;
        const nextGame = { ...target, name: trimmed, lastSavedAt: new Date().toISOString() };
        if (id === activeRoomId) {
          pendingSessionEventRef.current = "rename";
          setGame(nextGame);
          return;
        }
        await remoteRooms.commitRoomState({
          id,
          game: nextGame,
          session: id === activeRoomId ? liveSession : remoteRooms.emptyLiveSession(userId),
          event: "rename",
        });
        const scope = roomScopeFromMeta(rooms.find((room) => room.id === id));
        setRooms(await remoteRooms.listRooms(scope));
        return;
      }
      setRooms(roomStore.renameRoom(id, name));
      if (id === activeRoomId && game) setGame({ ...game, name: trimmed || game.name });
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to rename this room.");
    } finally {
      finishLoading();
    }
  }

  async function duplicateRoomById(id: string) {
    if (!canCreateRoom || !canManageRoom(id)) return;
    const finishLoading = startForegroundLoading("Duplicating room...");
    try {
      if (remoteEnabled) {
        const payload = await remoteRooms.readRoom(id);
        if (!payload || !userId) return;
        const copy = deepClone(payload.game);
        copy.gameId = crypto.randomUUID();
        copy.name = `${payload.game.name} (Copy)`;
        const session = remoteRooms.emptyLiveSession(userId);
        const roomScope = roomScopeFromMeta(payload.meta);
        const { meta } = await remoteRooms.createRoom(copy, userId, session, roomScope);
        setRooms((current) => [meta, ...current]);
        return;
      }
      const result = roomStore.duplicateRoom(id);
      if (result) {
        const scope = roomScopeFromMeta(result.index.find((room) => room.id === result.id));
        setRooms(roomStore.listRooms(scope));
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to duplicate this room.");
    } finally {
      finishLoading();
    }
  }

  // Every caller confirms through an in-app ConfirmSheet first (RoomCard's
  // "⋯ → Delete" and the waiting room's Delete option).
  async function deleteRoomById(id: string) {
    if (!canManageRoom(id)) return;
    const finishLoading = startForegroundLoading("Deleting room...");
    try {
      if (remoteEnabled) {
        await remoteRooms.deleteRoom(id);
        setRooms((current) => current.filter((room) => room.id !== id));
        if (id === activeRoomId) {
          setActiveRoomId(null);
          setGame(null);
          navigate({ kind: "home", visibility: lobbyVisibility });
        }
        return;
      }
      const index = roomStore.deleteRoom(id);
      const scope = makeRoomScope(lobbyVisibility, regionId);
      setRooms(
        scope
          ? index.filter((room) => {
              const roomScope = roomScopeFromMeta(room);
              return (
                roomScope.visibility === scope.visibility && roomScope.regionId === scope.regionId
              );
            })
          : [],
      );
      if (id === activeRoomId) {
        setActiveRoomId(null);
        setGame(null);
        navigate({ kind: "home", visibility: lobbyVisibility });
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to delete this room.");
    } finally {
      finishLoading();
    }
  }

  async function exportRoomById(id: string) {
    const finishLoading = startForegroundLoading("Preparing export...");
    try {
      const saved = remoteEnabled
        ? ((await remoteRooms.readRoom(id))?.game ?? null)
        : roomStore.readRoom(id);
      if (saved) downloadGame(saved);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to export this room.");
    } finally {
      finishLoading();
    }
  }

  async function importRoomGame(imported: GameState) {
    const roomScope = makeRoomScope(lobbyVisibility, regionId);
    if (!canCreateRoom || !roomScope) {
      setSyncError(createDisabledReason ?? "You cannot import a room right now.");
      return;
    }
    const finishLoading = startForegroundLoading("Importing room...");
    try {
      if (remoteEnabled) {
        if (!userId) return;
        const copy = deepClone(imported);
        copy.gameId = crypto.randomUUID();
        const session = remoteRooms.emptyLiveSession(userId);
        const { meta } = await remoteRooms.createRoom(copy, userId, session, roomScope);
        setRooms((current) => [meta, ...current]);
        return;
      }
      roomStore.importRoom(imported, roomScope);
      setRooms(roomStore.listRooms(roomScope));
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to import this room.");
    } finally {
      finishLoading();
    }
  }

  function getRoomRole(room: RoomMeta) {
    const canManage = canManageRoom(room.id);
    const roomInviteSides = [
      ...(accountMatchesInvite(room.inviteUserAId, room.inviteEmailA, userId, accountEmail)
        ? (["A"] as Side[])
        : []),
      ...(accountMatchesInvite(room.inviteUserBId, room.inviteEmailB, userId, accountEmail)
        ? (["B"] as Side[])
        : []),
    ];
    const roomOwnerEmail = normalizeEmail(room.ownerEmail);
    const isDirectRoom = Boolean(
      (room.ownerId && [room.inviteUserAId, room.inviteUserBId].includes(room.ownerId)) ||
      (roomOwnerEmail &&
        [normalizeEmail(room.inviteEmailA), normalizeEmail(room.inviteEmailB)].includes(
          roomOwnerEmail,
        )),
    );
    return {
      canManage,
      canCreate: canCreateRoom,
      label: !remoteEnabled
        ? "Local"
        : isDirectRoom
          ? roomInviteSides.length > 0
            ? `Player ${roomInviteSides.join("/")}${room.ownerId === userId ? " · Creator" : ""}`
            : "Spectator"
          : hasAdminAccess
            ? room.ownerId === userId
              ? "Admin · Owner"
              : "Admin"
            : canManage
              ? roomInviteSides.length > 0
                ? `Owner · Player ${roomInviteSides.join("/")}`
                : "Owner"
              : roomInviteSides.length > 0
                ? `Player ${roomInviteSides.join("/")}`
                : "Spectator",
    };
  }

  function canManageRoom(id: string): boolean {
    if (!remoteEnabled) return true;
    const room = rooms.find((item) => item.id === id);
    return Boolean(userId && (hasAdminAccess || room?.ownerId === userId));
  }

  function compactRemoteRoomIfNeeded(payload: remoteRooms.RemoteRoomPayload, saved: GameState) {
    if (
      (!payload.needsCompaction && !payload.needsInviteRepair) ||
      compactedRoomIdsRef.current.has(payload.meta.id)
    ) {
      return;
    }
    if (!userId || (!hasAdminAccess && payload.meta.ownerId !== userId)) return;
    compactedRoomIdsRef.current.add(payload.meta.id);
    setBackgroundSyncCount((count) => count + 1);
    const repair = payload.needsCompaction
      ? remoteRooms.commitRoomState({
          id: payload.meta.id,
          game: saved,
          session: payload.session,
          event: "state",
        })
      : remoteRooms.repairRoomInvites(payload.meta.id, saved);
    void repair
      .then(() => setSyncError(null))
      .catch((error: Error) => {
        compactedRoomIdsRef.current.delete(payload.meta.id);
        setSyncError(error.message);
      })
      .finally(() => setBackgroundSyncCount((count) => Math.max(0, count - 1)));
  }

  function shouldDeferRemoteGameWhileComposing(remoteGame: GameState): boolean {
    const localGame = gameRef.current;
    if (!localGame || readOnlyRef.current || localGame.status !== "playing") return false;
    const composing = actionModeRef.current !== "none" || pendingsRef.current.length > 0;
    if (!composing) return false;
    // Lifecycle flips (the opponent stopped, paused, or finished the game)
    // must be adopted immediately — the draft belongs to a game that is no
    // longer running.
    if (remoteGame.status !== localGame.status) return false;
    if (remoteGame.timers.paused !== localGame.timers.paused) return false;
    return !isRemoteGameAhead(localGame, remoteGame);
  }

  // Channel lifecycle from Supabase realtime. SUBSCRIBED (first connect OR a
  // silent reconnect) pulls anything the socket missed; error states rebuild
  // the channel after a short backoff instead of leaving the room deaf.
  function handleChannelStatus(status: remoteRooms.RoomChannelStatus, isDisposed: () => boolean) {
    if (isDisposed()) return;
    if (status === "SUBSCRIBED") {
      void reconcileActiveRoom();
      return;
    }
    if (resubscribeTimerRef.current !== null) return;
    resubscribeTimerRef.current = window.setTimeout(() => {
      resubscribeTimerRef.current = null;
      setSubscriptionEpoch((epoch) => epoch + 1);
    }, REALTIME_RETRY_MS);
  }

  // Fetch the authoritative room row and fold it in. applyRemotePayload keeps
  // local state that is ahead (its write is still pending) and adopts remote
  // state that is ahead — the same rules the realtime path applies, so a
  // reconcile can never lose a committed turn.
  async function reconcileActiveRoom() {
    const id = activeRoomIdRef.current;
    if (!remoteEnabled || !id || reconcilingRef.current) return;
    reconcilingRef.current = true;
    try {
      const payload = await remoteRooms.readRoom(id);
      if (payload && activeRoomIdRef.current === id) {
        const reconciledGame = applyRemotePayload(payload);
        if (reconciledGame) {
          applyIncomingRemoteSession(payload.session, reconciledGame);
        }
        const stage = getRoomStage(payload.game);
        const currentRoute = routeRef.current;
        if (currentRoute.kind === "room" && currentRoute.roomId === id && stage === "playing") {
          navigate({ kind: "play", roomId: id }, true);
        } else if (
          currentRoute.kind === "play" &&
          currentRoute.roomId === id &&
          stage === "waiting"
        ) {
          navigate({ kind: "room", roomId: id }, true);
        }
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to refresh this room.");
    } finally {
      reconcilingRef.current = false;
    }
  }

  /**
   * Fold an authoritative room row into local state.
   *
   * Ordering is decided by the server-assigned revision and nothing else. The
   * content key is used only for the question it can actually answer — "is this
   * byte-for-byte what I already have?" — which is how this client recognizes
   * its own write coming back without mistaking it for someone else's move.
   */
  function applyRemotePayload(
    payload: remoteRooms.RemoteRoomPayload,
    options: { allowRollback?: boolean } = {},
  ): GameState | null {
    const remoteGame = advanceRunningClock(normalizeFinishedGame(payload.game));
    const key = makeRemoteStateKey(remoteGame);
    setRooms((current) => upsertRoomMeta(current, payload.meta));
    const localGame = gameRef.current;
    const sameGame = Boolean(localGame && localGame.gameId === remoteGame.gameId);

    if (!options.allowRollback && localGame && isRemoteGameStale(localGame, remoteGame)) {
      // A lower revision carries nothing this client has not already applied.
      // Delayed delivery, duplicate delivery and a slow read racing a fast one
      // all land here, and none of them can undo a committed turn.
      setSyncError(null);
      return null;
    }

    if (localGame && sameGame && makeRemoteStateKey(localGame) === key) {
      // Identical position: this is this client's own commit echoing back, or a
      // redelivery. Take the confirmed revision and leave everything else —
      // including a draft in progress — exactly as it is.
      if (isRemoteGameAhead(localGame, remoteGame)) {
        setGame(withRevision(localGame, revisionOf(remoteGame)));
      }
      lastAppliedStateKeyRef.current = key;
      applyDeferredRemoteSession(remoteGame);
      setSyncError(null);
      return remoteGame;
    }

    if (shouldDeferRemoteGameWhileComposing(remoteGame)) {
      // Board and rack stay local while composing, but match-control metadata
      // (an incoming stop request, or the answer to ours) must land
      // immediately — otherwise the two players deadlock waiting on each
      // other whenever one of them has tiles on the board.
      const localGame = gameRef.current;
      if (
        localGame &&
        canonicalStringify(localGame.matchControl ?? null) !==
          canonicalStringify(remoteGame.matchControl ?? null)
      ) {
        setGame({
          ...localGame,
          matchControl: remoteGame.matchControl,
          lastSavedAt: remoteGame.lastSavedAt,
        });
      }
      setSyncError(null);
      return null;
    }
    if (key !== lastAppliedStateKeyRef.current) {
      // A position this client has not reached — adopt it wholesale. Session-only
      // updates (tile selection, drafts) never get here, so the spectator's
      // locally-ticking clock keeps running between moves (live countdown).
      lastAppliedStateKeyRef.current = key;
      setGame(remoteGame);
      cancelDraftOnly();
      if (isFinishedGame(remoteGame)) setShowResult(true);
      applyDeferredRemoteSession(remoteGame);
    }
    setSyncError(null);
    return remoteGame;
  }

  function applyIncomingRemoteSession(session: LiveRoomSession, targetGame = gameRef.current) {
    if (userId && session.actorId === userId) return;
    // A remote session mirrors the actor's draft for spectators. Never let it
    // overwrite a draft this client is composing itself.
    if (
      !readOnlyRef.current &&
      (actionModeRef.current !== "none" || pendingsRef.current.length > 0)
    ) {
      return;
    }
    applyRemoteSession(session, targetGame);
  }

  function applyRemoteSession(session: LiveRoomSession, targetGame = gameRef.current) {
    const currentGame = targetGame;
    if (
      currentGame &&
      ((session.gameId !== null && session.gameId !== currentGame.gameId) ||
        (session.turnNumber !== null && session.turnNumber !== currentGame.turnNumber) ||
        (session.activeSide !== null && session.activeSide !== currentGame.activeSide))
    ) {
      if (
        session.gameId === currentGame.gameId &&
        session.turnNumber !== null &&
        session.turnNumber > currentGame.turnNumber
      ) {
        deferredRemoteSessionRef.current = session;
      }
      return;
    }
    // Older/empty sessions do not carry turn metadata. Treat them as scoped to
    // the game currently being viewed so a clear event still orders correctly
    // against delayed draft events from that same turn.
    const scope = `${session.gameId ?? currentGame?.gameId ?? "legacy"}:${
      session.turnNumber ?? currentGame?.turnNumber ?? "legacy"
    }:${session.activeSide ?? currentGame?.activeSide ?? "legacy"}`;
    if (scope !== lastAppliedSessionScopeRef.current) {
      lastAppliedSessionScopeRef.current = scope;
      lastAppliedSessionUpdatedAtRef.current = "";
      lastAppliedSessionKeyRef.current = "";
      lastAppliedSessionActorIdRef.current = null;
    }
    if (
      session.actorId === lastAppliedSessionActorIdRef.current &&
      lastAppliedSessionUpdatedAtRef.current &&
      Date.parse(session.updatedAt) <= Date.parse(lastAppliedSessionUpdatedAtRef.current)
    ) {
      return;
    }
    const key = makeLiveSessionKey(session);
    lastAppliedSessionUpdatedAtRef.current = session.updatedAt;
    lastAppliedSessionActorIdRef.current = session.actorId;
    if (key === lastAppliedSessionKeyRef.current) return;
    lastAppliedSessionKeyRef.current = key;
    setActionMode(session.actionMode);
    setPendingPlacements(session.pendingPlacements);
    setExchangeDraft(session.exchangeDraft);
    setSelectedRackTileId(session.selectedRackTileId);
    setSelectedPendingTileId(session.selectedPendingTileId);
    setAssignmentRequest(null);
    setActionStart(null);
  }

  function applyDeferredRemoteSession(targetGame: GameState) {
    const deferred = deferredRemoteSessionRef.current;
    if (!deferred) return;
    if (
      deferred.gameId !== targetGame.gameId ||
      (deferred.turnNumber !== null && deferred.turnNumber < targetGame.turnNumber)
    ) {
      deferredRemoteSessionRef.current = null;
      return;
    }
    if (
      deferred.turnNumber === targetGame.turnNumber &&
      (deferred.activeSide === null || deferred.activeSide === targetGame.activeSide)
    ) {
      deferredRemoteSessionRef.current = null;
      applyRemoteSession(deferred, targetGame);
    }
  }

  function rackSlotsFrom(
    sourceGame: GameState,
    side: Side,
    layout: Record<Side, (string | null)[]> = rackLayoutRef.current,
  ): (TileInstance | null)[] {
    const tilesById = new Map(getRack(sourceGame, side).map((tile) => [tile.id, tile]));
    return layout[side].map((id) => (id ? (tilesById.get(id) ?? null) : null));
  }

  function rackFromSlots(
    sourceRack: TileInstance[],
    side: Side,
    layout: Record<Side, (string | null)[]>,
  ): TileInstance[] {
    const tilesById = new Map(sourceRack.map((tile) => [tile.id, tile]));
    const used = new Set<string>();
    const ordered: TileInstance[] = [];
    for (const id of layout[side]) {
      if (!id) continue;
      const tile = tilesById.get(id);
      if (!tile || used.has(id)) continue;
      ordered.push(tile);
      used.add(id);
    }
    for (const tile of sourceRack) {
      if (!used.has(tile.id)) ordered.push(tile);
    }
    return ordered;
  }

  function applyRackLayout(
    updater: (current: Record<Side, (string | null)[]>) => Record<Side, (string | null)[]>,
  ) {
    const next = updater(rackLayoutRef.current);
    rackLayoutRef.current = next;
    setRackLayout(next);
    return next;
  }

  function removeTileFromRackLayout(side: Side, tileId: string) {
    return applyRackLayout((current) => ({
      ...current,
      [side]: current[side].map((id) => (id === tileId ? null : id)),
    }));
  }

  function fillRackLayoutSlot(side: Side, slot: number, tileId: string) {
    return applyRackLayout((current) => {
      const slots = current[side].map((id) => (id === tileId ? null : id));
      const target = slot >= 0 && slot < RACK_SIZE ? slot : slots.indexOf(null);
      if (target >= 0) slots[target] = tileId;
      return { ...current, [side]: slots };
    });
  }

  function swapRackLayoutTiles(side: Side, firstId: string, secondId: string) {
    return applyRackLayout((current) => {
      const slots = current[side].slice();
      const firstIndex = slots.indexOf(firstId);
      const secondIndex = slots.indexOf(secondId);
      if (firstIndex < 0 || secondIndex < 0) return current;
      [slots[firstIndex], slots[secondIndex]] = [slots[secondIndex], slots[firstIndex]];
      return { ...current, [side]: slots };
    });
  }

  function rackSlotForTile(
    side: Side,
    tileId: string,
    layout: Record<Side, (string | null)[]> = rackLayoutRef.current,
  ) {
    const index = layout[side].indexOf(tileId);
    return index >= 0 ? index : undefined;
  }

  function beginPlaceActionFromGame(sourceGame: GameState, clearAssignment = true) {
    pendingSessionEventRef.current = "state";
    actionModeRef.current = "place_equation";
    setActionMode("place_equation");
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    if (clearAssignment) setAssignmentRequest(null);
    setReplayCursor(null);
    setActionStart({
      startedAt: sourceGame.currentTurnStartedAt,
      rackBefore: deepClone(getRack(sourceGame, sourceGame.activeSide)),
      boardBefore: deepClone(sourceGame.board),
      tilebagBefore: deepClone(sourceGame.tilebag),
      timerBefore: { A: sourceGame.timers.A, B: sourceGame.timers.B },
    });
  }

  const reviewBoard = selectedLog
    ? replayPhase === "before"
      ? // Overlay any practice placements the user has dropped during replay.
        replayDraft && replayDraft.placements.length > 0
        ? boardWithPending(
            selectedLog.boardBefore,
            replayDraft.placements,
            selectedLog.turnNumber,
            selectedLog.side,
          )
        : selectedLog.boardBefore
      : selectedLog.boardAfter
    : undefined;
  const boardToRender =
    reviewBoard ??
    (actionMode === "place_equation"
      ? boardWithPending(game.board, pendingPlacements, game.turnNumber, game.activeSide)
      : game.board);

  const canChooseAction =
    canActActiveSide &&
    game.status === "playing" &&
    !reviewing &&
    actionMode === "none" &&
    (game.phase === "choose_action" || isRackReady(game));
  const exchangeRule = getExchangeRule(game);
  const canStartExchange = canChooseAction && exchangeRule.allowed;
  const refillBaseline = refillBaselineRef.current;
  const canEditRefill =
    canRefillActiveRack &&
    game.phase === "choose_action" &&
    actionMode === "none" &&
    !reviewing &&
    Boolean(
      refillBaseline &&
      refillBaselineMatchesTurn(refillBaseline, game) &&
      activeRack.some((tile) => !refillBaseline.ids.includes(tile.id)),
    );

  function startAction(action: ActionType) {
    if (!game || !canChooseAction || readOnly) return;
    if (action === "end_game") return;
    if (action === "exchange" && !exchangeRule.allowed) return;
    pendingSessionEventRef.current = "state";
    setActionMode(action);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setReplayCursor(null);
    setActionStart({
      startedAt: game.currentTurnStartedAt,
      rackBefore: deepClone(getRack(game, game.activeSide)),
      boardBefore: deepClone(game.board),
      tilebagBefore: deepClone(game.tilebag),
      timerBefore: { A: game.timers.A, B: game.timers.B },
    });
    setGame({
      ...game,
      phase: "perform_action",
      lastSavedAt: new Date().toISOString(),
    });
  }

  function buildGameAfterCancelingAction(sourceGame: GameState): {
    game: GameState;
    layout: Record<Side, (string | null)[]>;
  } {
    if (actionMode !== "place_equation" || pendingPlacements.length === 0) {
      return {
        game: {
          ...sourceGame,
          phase: isRackReady(sourceGame) ? "choose_action" : "refill",
          lastSavedAt: new Date().toISOString(),
        },
        layout: rackLayoutRef.current,
      };
    }
    const returningTiles = pendingPlacements.map((item) => clearTileAssignment(item.tile));
    let nextLayout = rackLayoutRef.current;
    for (const item of pendingPlacements) {
      const tile = clearTileAssignment(item.tile);
      const slots = nextLayout[sourceGame.activeSide].map((id) => (id === tile.id ? null : id));
      const target =
        item.rackSlot !== undefined && item.rackSlot >= 0 && item.rackSlot < RACK_SIZE
          ? item.rackSlot
          : slots.indexOf(null);
      if (target >= 0) slots[target] = tile.id;
      nextLayout = { ...nextLayout, [sourceGame.activeSide]: slots };
    }
    const rack = rackFromSlots(
      [...getRack(sourceGame, sourceGame.activeSide).map(clearTileAssignment), ...returningTiles],
      sourceGame.activeSide,
      nextLayout,
    );
    const restored = setRack(sourceGame, sourceGame.activeSide, rack);
    return {
      game: {
        ...restored,
        phase: isRackReady(restored) ? "choose_action" : "refill",
        lastSavedAt: new Date().toISOString(),
      },
      layout: nextLayout,
    };
  }

  function cancelAction() {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "state";
    shouldFlushEmptyLiveSessionRef.current = true;
    const canceled = buildGameAfterCancelingAction(game);
    rackLayoutRef.current = canceled.layout;
    setRackLayout(canceled.layout);
    setGame(canceled.game);
    setActionMode("none");
    setActionStart(null);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setPendingPlacements([]);
    setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
    setPlacementCursor(null);
  }

  function refillFromBag(tile: TileInstance) {
    if (!game || !canRefillActiveRack || reviewing || game.status !== "playing") return;
    if (getTileDrawMode(game) === "play") return;
    if (actionMode !== "none") return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    if (rack.length >= RACK_SIZE) return;
    const currentBaseline = refillBaselineRef.current;
    if (!currentBaseline || !refillBaselineMatchesTurn(currentBaseline, game)) {
      refillBaselineRef.current = captureRefillBaseline(game);
    }
    const nextRack = [...rack, tile];
    fillRackLayoutSlot(
      game.activeSide,
      rackLayoutRef.current[game.activeSide].indexOf(null),
      tile.id,
    );
    const nextTilebag = game.tilebag.filter((candidate) => candidate.id !== tile.id);
    const rackReady = nextRack.length >= RACK_SIZE || nextTilebag.length === 0;
    const pendingBySide = getPendingExchangeReturnBySide(game);
    const pendingReturn = rackReady ? pendingBySide[game.activeSide] : [];
    const nextPendingBySide = rackReady
      ? { ...pendingBySide, [game.activeSide]: [] }
      : pendingBySide;
    const finalTilebag =
      pendingReturn.length > 0 ? [...nextTilebag, ...pendingReturn] : nextTilebag;
    const filledGame = setRack(
      {
        ...game,
        tilebag: finalTilebag,
        pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
        pendingExchangeReturnBySide: nextPendingBySide,
        phase: "refill" as Phase,
        lastSavedAt: new Date().toISOString(),
      },
      game.activeSide,
      nextRack,
    );
    // A ready rack ends this refill: a closing refill (the side already acted)
    // hands the turn to the opponent; an opening refill drops into choose_action.
    const nextGame = rackReady ? finalizeRefillTransition(filledGame) : filledGame;
    setGame(nextGame);
  }

  function editRefill() {
    if (!game || !canRefillActiveRack || reviewing || actionMode !== "none") return;
    if (game.phase !== "choose_action") return;
    const baseline = refillBaselineRef.current;
    if (!refillBaselineMatchesTurn(baseline, game)) return;
    pendingSessionEventRef.current = "state";
    const pendingBySide = deepClone(baseline.pendingExchangeReturnBySide);
    const baselineIdSet = new Set(baseline.ids);
    applyRackLayout((current) => ({
      ...current,
      [game.activeSide]: current[game.activeSide].map((id) =>
        id && baselineIdSet.has(id) ? id : null,
      ),
    }));
    setGame(
      setRack(
        {
          ...game,
          tilebag: deepClone(baseline.tilebag),
          pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
          pendingExchangeReturnBySide: pendingBySide,
          phase: "refill",
          lastSavedAt: new Date().toISOString(),
        },
        game.activeSide,
        deepClone(baseline.rack),
      ),
    );
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setPendingPlacements([]);
    setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
  }

  function returnRackTileToBag(tile: TileInstance) {
    if (!game || !canRefillActiveRack || reviewing || actionMode !== "none") return;
    if (getTileDrawMode(game) === "play") return;
    pendingSessionEventRef.current = "state";
    if (game.phase !== "refill") return;
    const refillBaseline = refillBaselineRef.current;
    const baselineIds = refillBaselineMatchesTurn(refillBaseline, game)
      ? refillBaseline.ids
      : getRack(game, game.activeSide).map((rackTile) => rackTile.id);
    if (baselineIds.includes(tile.id)) return;
    const rack = getRack(game, game.activeSide);
    const nextLayout = removeTileFromRackLayout(game.activeSide, tile.id);
    const nextRack = rackFromSlots(
      rack.filter((candidate) => candidate.id !== tile.id),
      game.activeSide,
      nextLayout,
    );
    setGame(
      setRack(
        {
          ...game,
          tilebag: [...game.tilebag, tile],
          phase: nextRack.length >= RACK_SIZE ? "choose_action" : "refill",
          lastSavedAt: new Date().toISOString(),
        },
        game.activeSide,
        nextRack,
      ),
    );
  }

  function requestAssignmentForTile(tile: TileInstance, request: AssignmentRequest): boolean {
    if (!tileNeedsAssignment(tile.token) || tile.assignedToken) return false;
    setAssignmentRequest(request);
    return true;
  }

  function placeRackTileOnBoard(
    tile: TileInstance,
    row: number,
    col: number,
    options: { cursorDir?: "right" | "down" | "left" | "up"; rackSlot?: number } = {},
  ) {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    if (!rack.some((candidate) => candidate.id === tile.id)) return;
    const rackSlot = options.rackSlot ?? rackSlotForTile(game.activeSide, tile.id);
    const placement: PendingPlacement = {
      tile,
      row,
      col,
      assignedToken: tile.assignedToken,
      cursorDir: options.cursorDir,
      rackSlot,
    };
    setPendingPlacements((current) => [...current, placement]);
    const nextLayout = removeTileFromRackLayout(game.activeSide, tile.id);
    // Functional update: startAction("place_equation") may have queued a
    // phase change in this same batch — build on it instead of clobbering
    // it with the stale closure copy of `game`.
    setGame((current) => {
      const base = current ?? game;
      return setRack(
        {
          ...base,
          lastSavedAt: new Date().toISOString(),
        },
        base.activeSide,
        rackFromSlots(
          getRack(base, base.activeSide).filter((candidate) => candidate.id !== tile.id),
          base.activeSide,
          nextLayout,
        ),
      );
    });
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
  }

  function swapRackTileWithPending(rackTile: TileInstance, pending: PendingPlacement) {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    const rackIndex = rack.findIndex((candidate) => candidate.id === rackTile.id);
    if (rackIndex < 0) return;
    const rackSlot = rackSlotForTile(game.activeSide, rackTile.id);
    const returningTile = {
      ...pending.tile,
      assignedToken: pending.assignedToken ?? pending.tile.assignedToken,
    };
    const nextLayout = fillRackLayoutSlot(
      game.activeSide,
      rackSlot ?? pending.rackSlot ?? -1,
      returningTile.id,
    );
    setPendingPlacements((current) =>
      current.map((placement) =>
        placement.tile.id === pending.tile.id
          ? {
              ...placement,
              tile: rackTile,
              assignedToken: rackTile.assignedToken,
              rackSlot,
            }
          : placement,
      ),
    );
    // Functional update: keep any phase change startAction queued this batch.
    setGame((current) => {
      const base = current ?? game;
      const baseRack = getRack(base, base.activeSide);
      const nextRack = baseRack.map((candidate) =>
        candidate.id === rackTile.id ? returningTile : candidate,
      );
      return setRack(
        {
          ...base,
          lastSavedAt: new Date().toISOString(),
        },
        base.activeSide,
        rackFromSlots(nextRack, base.activeSide, nextLayout),
      );
    });
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
  }

  // Replay practice — operates entirely in client state. Allows shuffling
  // the rack and dropping tiles on the board against the boardBefore state.
  function handleReplayRackTileClick(tile: TileInstance) {
    if (!selectedLog || replayPhase !== "before" || !replayDraft) return;
    // Cursor active → drop the tile at the cursor.
    if (placementCursor) {
      const target = placementCursor;
      const occupied =
        Boolean(selectedLog.boardBefore[target.row][target.col]) ||
        replayDraft.placements.some((p) => p.row === target.row && p.col === target.col);
      if (occupied) return;
      if (tileNeedsAssignment(tile.token) && !tile.assignedToken) {
        const rackSlot = replayDraft.rack.findIndex((t) => t?.id === tile.id);
        setAssignmentRequest({
          kind: "place",
          tile,
          row: target.row,
          col: target.col,
          dir: target.dir,
          rackSlot,
        });
        return;
      }
      const rackSlot = replayDraft.rack.findIndex((t) => t?.id === tile.id);
      const nextPlacements: PendingPlacement[] = [
        ...replayDraft.placements,
        {
          tile,
          row: target.row,
          col: target.col,
          assignedToken: tile.assignedToken,
          cursorDir: target.dir,
          rackSlot,
        },
      ];
      const nextRack = replayDraft.rack.map((t) => (t?.id === tile.id ? null : t));
      setReplayDraft({ rack: nextRack, placements: nextPlacements });
      setSelectedRackTileId(null);
      setSelectedPendingTileId(null);
      setPlacementCursor(advanceReplayCursor(target, nextPlacements));
      return;
    }
    if (selectedPendingTileId) {
      const pending = replayDraft.placements.find(
        (placement) => placement.tile.id === selectedPendingTileId,
      );
      const rackSlot = replayDraft.rack.findIndex((candidate) => candidate?.id === tile.id);
      if (pending && rackSlot >= 0) {
        if (tileNeedsAssignment(tile.token) && !tile.assignedToken) {
          setAssignmentRequest({ kind: "swapPending", tile, pendingTileId: pending.tile.id });
          return;
        }
        swapReplayRackTileWithPending(tile, pending);
        return;
      }
    }
    // Swap two rack tiles (existing selection → swap; no selection → select).
    if (selectedRackTileId && selectedRackTileId !== tile.id) {
      const a = replayDraft.rack.findIndex((t) => t?.id === selectedRackTileId);
      const b = replayDraft.rack.findIndex((t) => t?.id === tile.id);
      if (a >= 0 && b >= 0) {
        const next = replayDraft.rack.slice();
        [next[a], next[b]] = [next[b], next[a]];
        setReplayDraft({ ...replayDraft, rack: next });
        setSelectedRackTileId(null);
        return;
      }
    }
    setSelectedRackTileId((current) => (current === tile.id ? null : tile.id));
  }

  function handleReplayBoardClick(row: number, col: number) {
    if (!selectedLog || replayPhase !== "before" || !replayDraft) return;
    const occupied =
      Boolean(selectedLog.boardBefore[row][col]) ||
      replayDraft.placements.some((p) => p.row === row && p.col === col);
    // Cursor cycling on empty cells: right → down → left → up → cancel.
    if (!selectedRackTileId && !selectedPendingTileId && !occupied) {
      const cycle: Array<"right" | "down" | "left" | "up"> = ["right", "down", "left", "up"];
      const sameCell =
        placementCursor && placementCursor.row === row && placementCursor.col === col;
      if (!sameCell) {
        setPlacementCursor({ row, col, dir: "right" });
      } else {
        const i = cycle.indexOf(placementCursor!.dir);
        const next = i < cycle.length - 1 ? cycle[i + 1] : null;
        setPlacementCursor(next ? { row, col, dir: next } : null);
      }
      return;
    }
    // Selected pending tile + empty cell → move pending to that cell.
    if (selectedPendingTileId && !occupied) {
      setReplayDraft({
        ...replayDraft,
        placements: replayDraft.placements.map((p) =>
          p.tile.id === selectedPendingTileId ? { ...p, row, col } : p,
        ),
      });
      setSelectedPendingTileId(null);
      return;
    }
    if (selectedRackTileId && !occupied) {
      const tile = replayDraft.rack.find((t) => t?.id === selectedRackTileId);
      if (!tile) return;
      if (tileNeedsAssignment(tile.token) && !tile.assignedToken) {
        const rackSlot = replayDraft.rack.findIndex((t) => t?.id === tile.id);
        setAssignmentRequest({ kind: "place", tile, row, col, rackSlot });
        return;
      }
      const rackSlot = replayDraft.rack.findIndex((t) => t?.id === tile.id);
      const nextPlacements: PendingPlacement[] = [
        ...replayDraft.placements,
        { tile, row, col, assignedToken: tile.assignedToken, rackSlot },
      ];
      const nextRack = replayDraft.rack.map((t) => (t?.id === tile.id ? null : t));
      setReplayDraft({ rack: nextRack, placements: nextPlacements });
      setSelectedRackTileId(null);
      return;
    }
    // Tap on a pending placement: select it (or deselect if already selected);
    // moving the tile back to the rack now requires Cancel.
    const pending = replayDraft.placements.find((p) => p.row === row && p.col === col);
    if (pending) {
      if (selectedRackTileId) {
        // Selected rack tile + tap pending → swap them.
        const rackTile = replayDraft.rack.find((t) => t?.id === selectedRackTileId);
        if (!rackTile) return;
        if (tileNeedsAssignment(rackTile.token) && !rackTile.assignedToken) {
          setAssignmentRequest({
            kind: "swapPending",
            tile: rackTile,
            pendingTileId: pending.tile.id,
          });
          return;
        }
        swapReplayRackTileWithPending(rackTile, pending);
        return;
      }
      if (selectedPendingTileId && selectedPendingTileId !== pending.tile.id) {
        // Swap two pending tiles' positions.
        const other = replayDraft.placements.find((p) => p.tile.id === selectedPendingTileId);
        if (!other) return;
        setReplayDraft({
          ...replayDraft,
          placements: replayDraft.placements.map((p) => {
            if (p.tile.id === other.tile.id) return { ...p, row: pending.row, col: pending.col };
            if (p.tile.id === pending.tile.id) return { ...p, row: other.row, col: other.col };
            return p;
          }),
        });
        setSelectedPendingTileId(null);
        return;
      }
      setSelectedRackTileId(null);
      setSelectedPendingTileId((cur) => (cur === pending.tile.id ? null : pending.tile.id));
    }
  }

  function swapReplayRackTileWithPending(rackTile: TileInstance, pending: PendingPlacement) {
    if (!replayDraft) return;
    const rackSlot = replayDraft.rack.findIndex((candidate) => candidate?.id === rackTile.id);
    if (rackSlot < 0) return;
    const returningTile = {
      ...pending.tile,
      assignedToken: pending.assignedToken ?? pending.tile.assignedToken,
    };
    setReplayDraft({
      rack: replayDraft.rack.map((tile) => (tile?.id === rackTile.id ? returningTile : tile)),
      placements: replayDraft.placements.map((placement) =>
        placement.tile.id === pending.tile.id
          ? { ...placement, tile: rackTile, assignedToken: rackTile.assignedToken, rackSlot }
          : placement,
      ),
    });
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
  }

  function returnReplayPendingToRackSlot(index: number) {
    if (!replayDraft) return;
    const targetId = selectedPendingTileId ?? replayDraft.placements.at(-1)?.tile.id;
    if (!targetId) return;
    const item = replayDraft.placements.find((placement) => placement.tile.id === targetId);
    if (!item) return;
    const returningTile = {
      ...item.tile,
      assignedToken: item.assignedToken ?? item.tile.assignedToken,
    };
    const nextRack = replayDraft.rack.slice();
    const target = index >= 0 && index < RACK_SIZE ? index : nextRack.indexOf(null);
    if (target >= 0) {
      const displaced = nextRack[target];
      nextRack[target] = returningTile;
      if (displaced && displaced.id !== returningTile.id) {
        const emptyIndex = nextRack.findIndex(
          (tile, tileIndex) => tileIndex !== target && tile === null,
        );
        if (emptyIndex >= 0) nextRack[emptyIndex] = displaced;
        else nextRack.push(displaced);
      }
    } else {
      nextRack.push(returningTile);
    }
    setReplayDraft({
      rack: nextRack,
      placements: replayDraft.placements.filter((placement) => placement.tile.id !== targetId),
    });
    setSelectedPendingTileId(null);
  }

  function advanceReplayCursor(
    cursor: { row: number; col: number; dir: "right" | "down" | "left" | "up" },
    extraPending: PendingPlacement[],
  ): { row: number; col: number; dir: "right" | "down" | "left" | "up" } | null {
    if (!selectedLog) return null;
    let { row, col } = cursor;
    const dir = cursor.dir;
    const pendingKeys = new Set(
      extraPending.map((placement) => `${placement.row}:${placement.col}`),
    );
    while (true) {
      if (dir === "right") col += 1;
      else if (dir === "left") col -= 1;
      else if (dir === "down") row += 1;
      else row -= 1;
      if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
      const cellTaken =
        Boolean(selectedLog.boardBefore[row][col]) || pendingKeys.has(`${row}:${col}`);
      if (!cellTaken) return { row, col, dir };
    }
  }

  function undoLastLivePlacement(): boolean {
    // Read and update the refs synchronously so rapid mobile taps and desktop
    // Backspaces always pop distinct placements in LIFO order.
    const currentGame = gameRef.current;
    const currentPendings = pendingsRef.current;
    const last = currentPendings.at(-1);
    if (!last || actionModeRef.current !== "place_equation" || !currentGame) return false;

    const newPendings = currentPendings.slice(0, -1);
    const returningTile = {
      ...last.tile,
      assignedToken: last.assignedToken ?? last.tile.assignedToken,
    };
    const restoredLayout = fillRackLayoutSlot(
      currentGame.activeSide,
      last.rackSlot ?? -1,
      returningTile.id,
    );
    const restoredRack = rackFromSlots(
      [...getRack(currentGame, currentGame.activeSide), returningTile],
      currentGame.activeSide,
      restoredLayout,
    );
    const newGame = setRack(
      { ...currentGame, lastSavedAt: new Date().toISOString() },
      currentGame.activeSide,
      restoredRack,
    );
    const newCursor = {
      row: last.row,
      col: last.col,
      dir: last.cursorDir ?? cursorRef.current?.dir ?? "right",
    } as const;

    pendingsRef.current = newPendings;
    gameRef.current = newGame;
    cursorRef.current = newCursor;
    setPendingPlacements(newPendings);
    setGame(newGame);
    setPlacementCursor(newCursor);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    return true;
  }

  // Clicking an empty rack slot returns the currently-selected pending tile
  // to the rack at that position (or the most recent pending if none is
  // explicitly selected). Empty slot click is the "put it back" action — it
  // mirrors clicking an empty board cell when a pending tile is selected.
  function handleEmptyRackSlotClick(index: number, side: Side) {
    if (!game) return;
    // Empty slots are inert while the directional placement cursor is active.
    // Use the ref so rapid keyboard input cannot observe an older cursor state.
    if (cursorRef.current) return;
    // Replay practice flow.
    if (reviewing) {
      returnReplayPendingToRackSlot(index);
      return;
    }
    if (readOnly) return;
    if (game.status !== "playing") return;
    if (actionMode !== "place_equation") return;
    const targetId = selectedPendingTileId ?? pendingPlacements.at(-1)?.tile.id;
    if (!targetId) return;
    const item = pendingPlacements.find((p) => p.tile.id === targetId);
    if (!item) return;
    const returningTile = {
      ...item.tile,
      assignedToken: item.assignedToken ?? item.tile.assignedToken,
    };
    const nextLayout = fillRackLayoutSlot(side, index, returningTile.id);
    const nextRack = rackFromSlots(
      [...getRack(game, game.activeSide), returningTile],
      game.activeSide,
      nextLayout,
    );
    setPendingPlacements((current) => current.filter((p) => p.tile.id !== targetId));
    setGame(setRack({ ...game, lastSavedAt: new Date().toISOString() }, game.activeSide, nextRack));
    setSelectedPendingTileId(null);
  }

  function handleRackTileClick(tile: TileInstance, side: Side) {
    if (!game) return;
    // Replay practice flow — runs regardless of live game.status (a finished
    // game is the most common thing to replay).
    if (reviewing) {
      handleReplayRackTileClick(tile);
      return;
    }
    if (readOnly) return;
    if (game.status !== "playing") return;
    if (side !== game.activeSide) return;
    // Placement cursor active: place the tile at the cursor and advance —
    // this fully moves the tile from rack onto the board via the existing
    // placeRackTileOnBoard helper (which removes the tile from the rack).
    if (
      placementCursor &&
      (actionMode === "none" ? canChooseAction : actionMode === "place_equation")
    ) {
      if (actionMode === "none") startAction("place_equation");
      const target = placementCursor;
      const rackSlot = rackSlotForTile(game.activeSide, tile.id);
      if (
        requestAssignmentForTile(tile, {
          kind: "place",
          tile,
          row: target.row,
          col: target.col,
          dir: target.dir,
          rackSlot,
        })
      ) {
        // Need a value first; advance the cursor over this cell so the user
        // can continue placing once they pick a value.
        return;
      }
      placeRackTileOnBoard(tile, target.row, target.col, { cursorDir: target.dir, rackSlot });
      // Compute "next pending" inline so advanceCursor can skip the just-placed cell.
      const next = [
        ...pendingPlacements,
        {
          tile,
          row: target.row,
          col: target.col,
          assignedToken: tile.assignedToken,
          cursorDir: target.dir,
          rackSlot,
        },
      ];
      const advanced = advanceCursor(target, next);
      setPlacementCursor(advanced);
      return;
    }
    if (actionMode === "place_equation") {
      if (selectedPendingTileId) {
        const pending = pendingPlacements.find(
          (placement) => placement.tile.id === selectedPendingTileId,
        );
        const rack = getRack(game, game.activeSide);
        const rackIndex = rack.findIndex((candidate) => candidate.id === tile.id);
        if (pending && rackIndex >= 0) {
          if (
            requestAssignmentForTile(tile, {
              kind: "swapPending",
              tile,
              pendingTileId: pending.tile.id,
            })
          )
            return;
          swapRackTileWithPending(tile, pending);
          return;
        }
      }
      if (selectedRackTileId && selectedRackTileId !== tile.id) {
        const rack = getRack(game, game.activeSide);
        if (
          rack.some((candidate) => candidate.id === selectedRackTileId) &&
          rack.some((candidate) => candidate.id === tile.id)
        ) {
          const nextLayout = swapRackLayoutTiles(game.activeSide, selectedRackTileId, tile.id);
          setGame(
            setRack(
              {
                ...game,
                lastSavedAt: new Date().toISOString(),
              },
              game.activeSide,
              rackFromSlots(rack, game.activeSide, nextLayout),
            ),
          );
          setSelectedRackTileId(null);
          return;
        }
      }
      setSelectedPendingTileId(null);
      setSelectedRackTileId((current) => (current === tile.id ? null : tile.id));
      return;
    }
    if (actionMode === "none") {
      if (game.phase === "refill") {
        const refillBaseline = refillBaselineRef.current;
        if (
          refillBaselineMatchesTurn(refillBaseline, game) &&
          refillBaseline.ids.includes(tile.id)
        ) {
          return;
        }
        if (getTileDrawMode(game) !== "play") {
          returnRackTileToBag(tile);
          return;
        }
        return;
      }
      if (selectedRackTileId && selectedRackTileId !== tile.id) {
        const rack = getRack(game, game.activeSide);
        if (
          rack.some((candidate) => candidate.id === selectedRackTileId) &&
          rack.some((candidate) => candidate.id === tile.id)
        ) {
          const nextLayout = swapRackLayoutTiles(game.activeSide, selectedRackTileId, tile.id);
          setGame(
            setRack(
              {
                ...game,
                lastSavedAt: new Date().toISOString(),
              },
              game.activeSide,
              rackFromSlots(rack, game.activeSide, nextLayout),
            ),
          );
          setSelectedRackTileId(null);
          return;
        }
      }
      if (selectedRackTileId === tile.id) {
        setSelectedRackTileId(null);
        return;
      }
      setSelectedPendingTileId(null);
      setSelectedRackTileId(tile.id);
      return;
    }
    if (actionMode === "exchange") {
      setExchangeDraft((current) => {
        const isOutgoing = current.outgoingIds.includes(tile.id);
        const outgoingIds = isOutgoing
          ? current.outgoingIds.filter((id) => id !== tile.id)
          : [...current.outgoingIds, tile.id];
        return {
          outgoingIds,
          incomingTiles: current.incomingTiles.slice(0, outgoingIds.length),
        };
      });
      return;
    }
    returnRackTileToBag(tile);
  }

  // Advance the directional cursor one cell, skipping cells already filled
  // (board) or already pending. Returns null if the cursor falls off the board.
  function advanceCursor(
    cursor: { row: number; col: number; dir: "right" | "down" | "left" | "up" },
    extraPending: PendingPlacement[],
  ): { row: number; col: number; dir: "right" | "down" | "left" | "up" } | null {
    if (!game) return null;
    let { row, col } = cursor;
    const dir = cursor.dir;
    const pendingKeys = new Set(extraPending.map((p) => `${p.row}:${p.col}`));
    while (true) {
      if (dir === "right") col += 1;
      else if (dir === "left") col -= 1;
      else if (dir === "down") row += 1;
      else row -= 1;
      if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
      const cellTaken = Boolean(game.board[row][col]) || pendingKeys.has(`${row}:${col}`);
      if (!cellTaken) return { row, col, dir };
    }
  }

  function handleBoardCellClick(row: number, col: number) {
    if (!game) return;
    if (reviewing) {
      handleReplayBoardClick(row, col);
      return;
    }
    if (readOnly) return;
    const occupied =
      Boolean(game.board[row][col]) ||
      pendingPlacements.some((p) => p.row === row && p.col === col);
    // Empty cell with no selection (rack or pending) → cursor cycling
    // through 4 directions: right → down → left → up → cancel.
    if (
      !selectedRackTileId &&
      !selectedPendingTileId &&
      !occupied &&
      (actionMode === "none" ? canChooseAction : actionMode === "place_equation")
    ) {
      const cycle: Array<"right" | "down" | "left" | "up"> = ["right", "down", "left", "up"];
      const sameCell =
        placementCursor && placementCursor.row === row && placementCursor.col === col;
      if (!sameCell) {
        setPlacementCursor({ row, col, dir: "right" });
      } else {
        const i = cycle.indexOf(placementCursor!.dir);
        const next = i < cycle.length - 1 ? cycle[i + 1] : null;
        setPlacementCursor(next ? { row, col, dir: next } : null);
      }
      return;
    }
    // Auto-start Place mode the first time the user interacts with the board.
    if (actionMode === "none") {
      if (!canChooseAction) return;
      if (!selectedRackTileId) return;
      startAction("place_equation");
    } else if (actionMode !== "place_equation") {
      return;
    }
    const pending = pendingPlacements.find((item) => item.row === row && item.col === col);
    if (pending) {
      if (selectedRackTileId) {
        const rack = getRack(game, game.activeSide);
        const rackTile = rack.find((candidate) => candidate.id === selectedRackTileId);
        if (rackTile) {
          if (
            requestAssignmentForTile(rackTile, {
              kind: "swapPending",
              tile: rackTile,
              pendingTileId: pending.tile.id,
            })
          )
            return;
          swapRackTileWithPending(rackTile, pending);
        }
        return;
      }
      if (selectedPendingTileId && selectedPendingTileId !== pending.tile.id) {
        const selected = pendingPlacements.find(
          (placement) => placement.tile.id === selectedPendingTileId,
        );
        if (selected) {
          setPendingPlacements((current) =>
            current.map((placement) => {
              if (placement.tile.id === selected.tile.id)
                return { ...placement, row: pending.row, col: pending.col };
              if (placement.tile.id === pending.tile.id)
                return { ...placement, row: selected.row, col: selected.col };
              return placement;
            }),
          );
          setSelectedPendingTileId(null);
        }
        return;
      }
      // Tap on a pending tile: SELECT it (first tap) or DESELECT (second tap
      // on the same tile). Pulling the tile back to the rack is reserved for
      // Cancel — selection only here so a follow-up empty-cell click can move
      // the tile rather than accidentally remove it.
      setSelectedRackTileId(null);
      setSelectedPendingTileId((cur) => (cur === pending.tile.id ? null : pending.tile.id));
      return;
    }
    if (game.board[row][col]) return;
    if (selectedPendingTileId) {
      const selected = pendingPlacements.find(
        (placement) => placement.tile.id === selectedPendingTileId,
      );
      if (selected) {
        setPendingPlacements((current) =>
          current.map((placement) =>
            placement.tile.id === selected.tile.id ? { ...placement, row, col } : placement,
          ),
        );
        setSelectedPendingTileId(null);
      }
      return;
    }
    if (!selectedRackTileId) return;
    const rack = getRack(game, game.activeSide);
    const tile = rack.find((candidate) => candidate.id === selectedRackTileId);
    if (!tile) return;
    if (
      requestAssignmentForTile(tile, {
        kind: "place",
        tile,
        row,
        col,
        rackSlot: rackSlotForTile(game.activeSide, tile.id),
      })
    )
      return;
    placeRackTileOnBoard(tile, row, col);
  }

  function updatePendingAssignment(tileId: string, assignedToken: string) {
    if (reviewing && replayPhase === "before" && replayDraft) {
      setReplayDraft({
        ...replayDraft,
        placements: replayDraft.placements.map((placement) =>
          placement.tile.id === tileId
            ? { ...placement, tile: { ...placement.tile, assignedToken }, assignedToken }
            : placement,
        ),
      });
      return;
    }
    if (readOnly) return;
    pendingSessionEventRef.current = "state";
    setPendingPlacements((current) =>
      current.map((placement) =>
        placement.tile.id === tileId
          ? { ...placement, tile: { ...placement.tile, assignedToken }, assignedToken }
          : placement,
      ),
    );
  }

  function openPendingAssignmentEditor(tileId: string): boolean {
    const replayPractice = reviewing && replayPhase === "before" && Boolean(replayDraft);
    if (!replayPractice && readOnly) return false;
    const placements = replayPractice ? (replayDraft?.placements ?? []) : pendingPlacements;
    const pending = placements.find((placement) => placement.tile.id === tileId);
    if (!pending || !tileNeedsAssignment(pending.tile.token)) return false;
    setSelectedRackTileId(null);
    setSelectedPendingTileId(pending.tile.id);
    setAssignmentRequest({
      kind: "editPending",
      tile: {
        ...pending.tile,
        assignedToken: pending.assignedToken ?? pending.tile.assignedToken,
      },
      pendingTileId: pending.tile.id,
    });
    return true;
  }

  function confirmAssignment(value: string) {
    const isReplayAssignment = reviewing && replayPhase === "before" && Boolean(replayDraft);
    if (!assignmentRequest || (readOnly && !isReplayAssignment)) return;
    if (!isReplayAssignment) pendingSessionEventRef.current = "state";
    const assignedTile = {
      ...assignmentRequest.tile,
      assignedToken: value,
    };
    if (assignmentRequest.kind === "editPending") {
      updatePendingAssignment(assignmentRequest.pendingTileId, value);
      setAssignmentRequest(null);
      return;
    }
    if (assignmentRequest.kind === "place") {
      const placement: PendingPlacement = {
        tile: assignedTile,
        row: assignmentRequest.row,
        col: assignmentRequest.col,
        assignedToken: value,
        cursorDir: assignmentRequest.dir,
        rackSlot: assignmentRequest.rackSlot,
      };
      if (reviewing && replayPhase === "before" && replayDraft && selectedLog) {
        const nextPlacements = [
          ...replayDraft.placements.filter((item) => item.tile.id !== assignedTile.id),
          placement,
        ];
        const nextRack = replayDraft.rack.map((tile) =>
          tile?.id === assignedTile.id ? null : tile,
        );
        setReplayDraft({ rack: nextRack, placements: nextPlacements });
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        if (assignmentRequest.dir) {
          setPlacementCursor(
            advanceReplayCursor(
              {
                row: assignmentRequest.row,
                col: assignmentRequest.col,
                dir: assignmentRequest.dir,
              },
              nextPlacements,
            ),
          );
        }
        setAssignmentRequest(null);
        return;
      }
      placeRackTileOnBoard(assignedTile, assignmentRequest.row, assignmentRequest.col, {
        cursorDir: assignmentRequest.dir,
        rackSlot: assignmentRequest.rackSlot,
      });
      if (assignmentRequest.dir) {
        setPlacementCursor(
          advanceCursor(
            { row: assignmentRequest.row, col: assignmentRequest.col, dir: assignmentRequest.dir },
            [...pendingPlacements, placement],
          ),
        );
      }
    } else if (reviewing && replayPhase === "before" && replayDraft) {
      const pending = replayDraft.placements.find(
        (placement) => placement.tile.id === assignmentRequest.pendingTileId,
      );
      if (pending) swapReplayRackTileWithPending(assignedTile, pending);
    } else {
      const pending = pendingPlacements.find(
        (placement) => placement.tile.id === assignmentRequest.pendingTileId,
      );
      if (pending) swapRackTileWithPending(assignedTile, pending);
    }
    setAssignmentRequest(null);
  }

  function commitLog(
    log: TurnLog,
    boardAfter: BoardSnapshot,
    rackAfter: TileInstance[],
    tilebagAfter: TileInstance[],
    floatingTiles?: TileInstance[],
  ) {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "submit_action";
    shouldFlushEmptyLiveSessionRef.current = true;
    const normalLogs = [...game.logs, log];
    const endGameLog = createAutomaticEndGameLog({
      boardAfter,
      game,
      normalLog: log,
      rackAfter,
      tilebagAfter,
      logs: normalLogs,
    });
    const logs = endGameLog ? [...normalLogs, endGameLog] : normalLogs;
    const pendingBySide = getPendingExchangeReturnBySide(game);
    const nextPendingBySide = floatingTiles
      ? { ...pendingBySide, [game.activeSide]: floatingTiles }
      : pendingBySide;
    // Record the action but keep the mover active: the turn is not over until
    // this player has refilled, so the opponent always begins from a
    // post-refill (correct bag count) state.
    const movedGame: GameState = setRack(
      {
        ...game,
        board: boardAfter,
        tilebag: tilebagAfter,
        pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
        pendingExchangeReturnBySide: nextPendingBySide,
        logs,
        scores: calculateTotals(logs),
        status: endGameLog ? "finished" : game.status,
        timers: endGameLog ? { ...game.timers, paused: true } : game.timers,
        lastSavedAt: new Date().toISOString(),
      },
      game.activeSide,
      rackAfter,
    );
    let nextGame: GameState;
    if (endGameLog) {
      // Game over: no refill, no hand-off.
      nextGame = { ...movedGame, phase: "choose_action" as Phase };
    } else if (getTileDrawMode(movedGame) === "play") {
      // Auto draw: refill the mover's rack now, then pass the turn.
      const refilled = isRackReady(movedGame) ? movedGame : refillRackFromQueue(movedGame);
      nextGame = advanceToOpponentTurn(refilled);
    } else if (!isRackReady(movedGame)) {
      // Manual draw: the mover hand-picks replacements (interactive "refill"
      // phase on the SAME side) before the turn passes; the hand-off happens
      // once the rack is ready (see finalizeRefillTransition).
      refillBaselineRef.current = captureRefillBaseline(movedGame);
      nextGame = { ...movedGame, phase: "refill" as Phase };
    } else {
      // Manual draw but nothing left to draw (bag empty): pass the turn.
      nextGame = advanceToOpponentTurn(movedGame);
    }
    setGame(pushActionSnapshot(nextGame));
    if (endGameLog) setShowResult(true);
    setActionMode("none");
    setActionStart(null);
    setPendingPlacements([]);
    setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
  }

  function confirmPlace() {
    if (readOnly || !game || actionMode !== "place_equation" || !validation.isValid) return;
    const effectiveActionStart = actionStart ?? {
      startedAt: game.currentTurnStartedAt,
      rackBefore: [
        ...deepClone(getRack(game, game.activeSide)),
        ...pendingPlacements.map((placement) => deepClone(placement.tile)),
      ],
      boardBefore: deepClone(game.board),
      tilebagBefore: deepClone(game.tilebag),
      timerBefore: { A: game.timers.A, B: game.timers.B },
    };
    const now = new Date().toISOString();
    const boardAfter = boardWithPending(
      game.board,
      pendingPlacements,
      game.turnNumber,
      game.activeSide,
    );
    const rackAfter = deepClone(getRack(game, game.activeSide)).map(clearTileAssignment);
    const detail: PlaceEquationDetail = createPlaceDetail(validation, pendingPlacements);
    const log = createTurnLog({
      game,
      action: "place_equation",
      actionStart: effectiveActionStart,
      endedAt: now,
      rackAfter,
      boardAfter,
      tilebagAfter: game.tilebag,
      detail,
      calculatedScore: validation.score,
    });
    commitLog(log, boardAfter, rackAfter, game.tilebag);
  }

  function confirmExchange() {
    if (readOnly || !game || !actionStart || actionMode !== "exchange") return;
    if (!exchangeRule.allowed) return;
    if (exchangeDraft.outgoingIds.length === 0) return;
    const outgoingSet = new Set(exchangeDraft.outgoingIds);
    const outgoingTiles = getRack(game, game.activeSide).filter((tile) => outgoingSet.has(tile.id));
    const rackAfter = getRack(game, game.activeSide).filter((tile) => !outgoingSet.has(tile.id));
    const returnedTiles = outgoingTiles.map(clearTileAssignment);
    const tilebagAfter = game.tilebag;
    const detail: ExchangeDetail = {
      outgoingTiles,
      incomingTiles: [],
    };
    const log = createTurnLog({
      game,
      action: "exchange",
      actionStart,
      endedAt: new Date().toISOString(),
      rackAfter,
      boardAfter: game.board,
      tilebagAfter,
      detail,
      calculatedScore: 0,
    });
    commitLog(log, game.board, rackAfter, tilebagAfter, returnedTiles);
  }

  function confirmPass() {
    if (readOnly || !game || !actionStart || actionMode !== "pass") return;
    const rackAfter = deepClone(getRack(game, game.activeSide));
    const detail: PassDetail = {};
    const log = createTurnLog({
      game,
      action: "pass",
      actionStart,
      endedAt: new Date().toISOString(),
      rackAfter,
      boardAfter: game.board,
      tilebagAfter: game.tilebag,
      detail,
      calculatedScore: 0,
    });
    commitLog(log, game.board, rackAfter, game.tilebag);
  }

  // Commit an engine response as the bot side's turn. Every placement passes
  // through the official validator first — an engine bug can therefore never
  // corrupt a match (it degrades to a pass instead). `response === null`
  // forces the pass fallback.
  function commitBotResponse(response: BotResponse | null) {
    const g = gameRef.current;
    if (!g || !g.botSide || g.status !== "playing" || g.activeSide !== g.botSide) return;
    const now = new Date().toISOString();
    const botActionStart: ActionStart = {
      startedAt: g.currentTurnStartedAt,
      rackBefore: deepClone(getRack(g, g.activeSide)),
      boardBefore: deepClone(g.board),
      tilebagBefore: deepClone(g.tilebag),
      timerBefore: { A: g.timers.A, B: g.timers.B },
    };
    const mapped = response ? mapBotResponse(g, response) : null;
    // Tie the reasoning to the log this move produces, so the "why" panel shows
    // it only while that bot move is the latest one on the board.
    const recordReasoning = (logId: string) => {
      if (response && g.botSide) {
        setBotReasoning({
          logId,
          turnNumber: g.turnNumber,
          playerName: g.players[g.botSide] || "Aether",
          response,
        });
      }
    };

    if (mapped?.kind === "place") {
      const validation = validateMove(g.board, mapped.placements);
      if (validation.isValid) {
        const boardAfter = boardWithPending(g.board, mapped.placements, g.turnNumber, g.activeSide);
        const usedIds = new Set(mapped.placements.map((placement) => placement.tile.id));
        const rackAfter = getRack(g, g.activeSide)
          .filter((tile) => !usedIds.has(tile.id))
          .map(clearTileAssignment);
        const detail: PlaceEquationDetail = createPlaceDetail(validation, mapped.placements);
        const log = createTurnLog({
          game: g,
          action: "place_equation",
          actionStart: botActionStart,
          endedAt: now,
          rackAfter,
          boardAfter,
          tilebagAfter: g.tilebag,
          detail,
          calculatedScore: validation.score,
        });
        commitLog(log, boardAfter, rackAfter, g.tilebag);
        recordReasoning(log.id);
        return;
      }
      console.error("Bot move rejected by the official validator:", validation.errors);
    }

    if (
      mapped?.kind === "exchange" &&
      mapped.outgoingIds.length > 0 &&
      getExchangeRule(g).allowed
    ) {
      const outgoingSet = new Set(mapped.outgoingIds);
      const outgoingTiles = getRack(g, g.activeSide).filter((tile) => outgoingSet.has(tile.id));
      const rackAfter = getRack(g, g.activeSide).filter((tile) => !outgoingSet.has(tile.id));
      const returnedTiles = outgoingTiles.map(clearTileAssignment);
      const detail: ExchangeDetail = { outgoingTiles, incomingTiles: [] };
      const log = createTurnLog({
        game: g,
        action: "exchange",
        actionStart: botActionStart,
        endedAt: now,
        rackAfter,
        boardAfter: g.board,
        tilebagAfter: g.tilebag,
        detail,
        calculatedScore: 0,
      });
      commitLog(log, g.board, rackAfter, g.tilebag, returnedTiles);
      recordReasoning(log.id);
      return;
    }

    const rackAfter = deepClone(getRack(g, g.activeSide));
    const detail: PassDetail = {};
    const log = createTurnLog({
      game: g,
      action: "pass",
      actionStart: botActionStart,
      endedAt: now,
      rackAfter,
      boardAfter: g.board,
      tilebagAfter: g.tilebag,
      detail,
      calculatedScore: 0,
    });
    commitLog(log, g.board, rackAfter, g.tilebag);
    recordReasoning(log.id);
  }

  function applyUndoSnap(snap: UndoSnap) {
    restoringUndoRef.current = true;
    setActionMode(snap.actionMode);
    setActionStart(null);
    setPendingPlacements(snap.pendingPlacements);
    setExchangeDraft(snap.exchangeDraft);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setReplayCursor(null);
    setShowResult(false);
    // Keep the live clock. Reset its timestamp anchor so restoring an older
    // snapshot cannot charge the elapsed time a second time.
    const now = new Date().toISOString();
    setGame(
      game
        ? {
            ...snap.game,
            timers: game.timers,
            currentTurnStartedAt: now,
            lastSavedAt: now,
          }
        : snap.game,
    );
  }

  function undo() {
    if (!canControlActiveGame || undoStackRef.current.length === 0) return;
    pendingSessionEventRef.current = "undo";
    const target = undoStackRef.current.pop()!;
    if (lastSnapRef.current) redoStackRef.current.push(lastSnapRef.current);
    applyUndoSnap(target);
    bumpUndoVersion((value) => value + 1);
  }

  function redo() {
    if (!canControlActiveGame || redoStackRef.current.length === 0) return;
    pendingSessionEventRef.current = "redo";
    const target = redoStackRef.current.pop()!;
    if (lastSnapRef.current) undoStackRef.current.push(lastSnapRef.current);
    applyUndoSnap(target);
    bumpUndoVersion((value) => value + 1);
  }

  function resetUndoHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    lastSnapRef.current = null;
    lastMutationKeyRef.current = "";
    restoringUndoRef.current = false;
    bumpUndoVersion((value) => value + 1);
  }

  function cancelDraftOnly() {
    setActionMode("none");
    setActionStart(null);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setPendingPlacements([]);
    setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
    setPlacementCursor(null);
  }

  function updateNote(logId: string, note: string) {
    if (!game || !canControlActiveGame) return;
    pendingSessionEventRef.current = "note";
    const logs = updateLogNote(game.logs, logId, note);
    const history = game.history.map((snapshot) => {
      if (!snapshot.logs.some((log) => log.id === logId)) return snapshot;
      return {
        ...snapshot,
        logs: updateLogNote(snapshot.logs, logId, note),
      };
    });
    setGame({ ...game, logs, history, lastSavedAt: new Date().toISOString() });
  }

  // Self-review star rating saved on the turn log (does NOT change the game score).
  function updateLogStars(logId: string, stars: number) {
    if (!game || !canControlActiveGame) return;
    pendingSessionEventRef.current = "note";
    const apply = (log: TurnLog) => (log.id === logId ? { ...log, stars } : log);
    setGame({
      ...game,
      logs: game.logs.map(apply),
      history: game.history.map((snapshot) =>
        snapshot.logs.some((log) => log.id === logId)
          ? { ...snapshot, logs: snapshot.logs.map(apply) }
          : snapshot,
      ),
      lastSavedAt: new Date().toISOString(),
    });
  }

  function lifecycleBaseGame(): GameState | null {
    if (!game) return null;
    shouldFlushEmptyLiveSessionRef.current = true;
    const canceled = buildGameAfterCancelingAction(game);
    rackLayoutRef.current = canceled.layout;
    setRackLayout(canceled.layout);
    cancelDraftOnly();
    setReplayCursor(null);
    return canceled.game;
  }

  function stopGameImmediately(stoppedBy: Side | "host") {
    if (!game) return;
    const base = lifecycleBaseGame();
    if (!base) return;
    pendingSessionEventRef.current = "stop_game";
    const now = new Date().toISOString();
    setGame(
      pushActionSnapshot({
        ...base,
        status: "draft",
        timers: { ...base.timers, paused: true },
        matchControl: {
          ...base.matchControl,
          stopRequest: undefined,
          stoppedBy,
        },
        lastSavedAt: now,
      }),
    );
  }

  // Write a lifecycle-only change (stop request / response) NOW, even while a
  // move is being composed. The regular sync effect refuses to write during
  // composition because the draft-shaped game has tiles missing from the
  // rack; this helper writes a sanitized copy (draft returned to the rack)
  // and leaves the local draft untouched — so a player who is mid-move can
  // still send and answer stop requests, on any device.
  async function writeLifecycleStateNow(nextGame: GameState, event: RoomSessionEvent) {
    const roomId = activeRoomIdRef.current;
    if (!remoteEnabled || !roomId || !canWriteActiveRoom) return;
    const key = makeRemoteStateKey(nextGame);
    lastAppliedStateKeyRef.current = key;
    setBackgroundSyncCount((count) => count + 1);
    try {
      await remoteRooms.commitRoomState({
        id: roomId,
        game: nextGame,
        session: liveSession,
        event,
      });
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to sync the stop request.");
      try {
        const authoritative = await remoteRooms.readRoom(roomId);
        if (authoritative) applyRemotePayload(authoritative, { allowRollback: true });
      } catch {
        // Keep the original write error visible when recovery cannot load.
      }
    } finally {
      setBackgroundSyncCount((count) => Math.max(0, count - 1));
    }
  }

  function requestOrStopGame() {
    if (!game || game.status !== "playing" || !canStopLifecycle) return;
    if (canHostLifecycleControl || canSoloLifecycleControl) {
      setLifecycleConfirm("stop");
      return;
    }
    if (!isDirectEmailRoom || !accountPlayerSide) return;
    const blockedUntil = Date.parse(
      game.matchControl?.stopBlockedUntilBySide?.[accountPlayerSide] ?? "",
    );
    if (Number.isFinite(blockedUntil) && blockedUntil > Date.now()) return;
    if (game.matchControl?.stopRequest) return;
    const now = new Date().toISOString();
    const nextMatchControl: MatchControl = {
      ...game.matchControl,
      stopRequest: {
        id: crypto.randomUUID(),
        requestedBy: accountPlayerSide,
        requestedAt: now,
      },
      stopResponse: undefined,
    };
    // Metadata-only change: keep any placed-but-unsubmitted tiles on the board.
    pendingSessionEventRef.current = null;
    setGame({ ...game, matchControl: nextMatchControl, lastSavedAt: now });
    const sanitized = buildGameAfterCancelingAction(game).game;
    void writeLifecycleStateNow(
      { ...sanitized, matchControl: nextMatchControl, lastSavedAt: now },
      "stop_request",
    );
  }

  function respondToStopRequest(accept: boolean, blockFiveMinutes = false) {
    if (!game || !accountPlayerSide || !isDirectEmailRoom) return;
    const request = game.matchControl?.stopRequest;
    if (!request || request.requestedBy === accountPlayerSide) return;
    if (accept) {
      stopGameImmediately(accountPlayerSide);
      return;
    }
    const now = new Date().toISOString();
    const blockedUntil = blockFiveMinutes
      ? new Date(Date.now() + STOP_REQUEST_BLOCK_MS).toISOString()
      : undefined;
    const nextMatchControl: MatchControl = {
      ...game.matchControl,
      stopRequest: undefined,
      // The requester's device may be asleep right now — the response is
      // persisted, not just broadcast, so they see it whenever they wake.
      stopResponse: {
        id: crypto.randomUUID(),
        requestId: request.id,
        requestedBy: request.requestedBy,
        respondedBy: accountPlayerSide,
        accepted: false,
        blockedForMs: blockFiveMinutes ? STOP_REQUEST_BLOCK_MS : undefined,
        respondedAt: now,
      },
      stopBlockedUntilBySide: blockedUntil
        ? {
            ...game.matchControl?.stopBlockedUntilBySide,
            [request.requestedBy]: blockedUntil,
          }
        : game.matchControl?.stopBlockedUntilBySide,
    };
    pendingSessionEventRef.current = null;
    setGame({ ...game, matchControl: nextMatchControl, lastSavedAt: now });
    const sanitized = buildGameAfterCancelingAction(game).game;
    void writeLifecycleStateNow(
      { ...sanitized, matchControl: nextMatchControl, lastSavedAt: now },
      "stop_response",
    );
  }

  // Requester taps "Keep playing" on the declined notice: clear the persisted
  // response so it never pops up again (e.g. after a reload on any device).
  function acknowledgeStopResponse() {
    const response = game?.matchControl?.stopResponse;
    if (!game || !response) return;
    setSeenStopResponseId(response.id);
    if (!accountPlayerSide || response.requestedBy !== accountPlayerSide) return;
    const now = new Date().toISOString();
    const nextMatchControl: MatchControl = {
      ...game.matchControl,
      stopResponse: undefined,
    };
    pendingSessionEventRef.current = null;
    setGame({ ...game, matchControl: nextMatchControl, lastSavedAt: now });
    const sanitized = buildGameAfterCancelingAction(game).game;
    void writeLifecycleStateNow(
      { ...sanitized, matchControl: nextMatchControl, lastSavedAt: now },
      "stop_response",
    );
  }

  function endGame() {
    if (!game || !canEndLifecycle) return;
    setLifecycleConfirm("end");
  }

  function performEndGame() {
    if (!game || !canEndLifecycle) return;
    const isSurrender = !hasGameplayHost && getGameMode(game) !== "solo";
    const base = lifecycleBaseGame();
    if (!base) return;
    pendingSessionEventRef.current = isSurrender ? "surrender" : "end_game";
    if (isSurrender && accountPlayerSide) {
      const surrenderLog = createSurrenderEndGameLog(base, accountPlayerSide);
      const logs = [...base.logs, surrenderLog];
      setGame(
        pushActionSnapshot({
          ...base,
          logs,
          scores: calculateTotals(logs),
          status: "finished",
          timers: { ...base.timers, paused: true },
          matchControl: {
            ...base.matchControl,
            stopRequest: undefined,
            surrenderedSide: accountPlayerSide,
          },
          lastSavedAt: new Date().toISOString(),
        }),
      );
      setShowResult(true);
      return;
    }
    setGame(
      pushActionSnapshot({
        ...base,
        status: "finished",
        timers: { ...base.timers, paused: true },
        matchControl: { ...base.matchControl, stopRequest: undefined },
        lastSavedAt: new Date().toISOString(),
      }),
    );
    setShowResult(true);
  }

  // Resume a *drafted* game (the user previously hit Save & Exit). Finished
  // games are locked and never come back through here.
  function resumeGame() {
    if (!game || !(canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl))
      return;
    if (isFinishedGame(game) || game.status !== "draft") return;
    pendingSessionEventRef.current = "resume_game";
    setShowResult(false);
    setReplayCursor(null);
    cancelDraftOnly();
    setGame(
      pushActionSnapshot({
        ...game,
        status: "playing",
        // Wake the clock up so the side whose turn it is starts ticking again.
        timers: { ...game.timers, paused: false },
        matchControl: { ...game.matchControl, stoppedBy: undefined },
        currentTurnStartedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
      }),
    );
  }

  // Email-room exits keep the room playing. A user clears a live draft only
  // while they currently control the active phase.
  async function saveAndExit() {
    if (!game || isFinishedGame(game)) {
      goToLobby();
      return;
    }
    if (isEmailRoom) {
      if (remoteEnabled && activeRoomId && canPlayActiveRoom && !isEmptyLiveSession(liveSession)) {
        const session = remoteRooms.emptyLiveSession(userId);
        const finishLoading = startForegroundLoading("Leaving room...");
        try {
          await remoteRooms.updateRoomSession(activeRoomId, session);
          lastAppliedSessionKeyRef.current = makeLiveSessionKey(session);
          setSyncError(null);
        } catch (error) {
          setSyncError(
            error instanceof Error ? error.message : "Unable to leave this room cleanly.",
          );
          finishLoading();
          return;
        }
        finishLoading();
      }
      goToLobby();
      return;
    }
    if (!canManageActiveRoom) {
      goToLobby();
      return;
    }
    if (game.status === "playing") {
      pendingSessionEventRef.current = "state";
      const canceled = buildGameAfterCancelingAction(game);
      const draftGame: GameState = {
        ...canceled.game,
        status: "draft",
        timers: { ...canceled.game.timers, paused: true },
        lastSavedAt: new Date().toISOString(),
      };
      if (remoteEnabled && activeRoomId && canWriteActiveRoom) {
        const session = remoteRooms.emptyLiveSession(userId);
        const draftKey = makeRemoteStateKey(draftGame);
        const finishLoading = startForegroundLoading("Saving room...");
        try {
          await remoteRooms.commitRoomState({
            id: activeRoomId,
            game: draftGame,
            session,
            event: "state",
          });
          await remoteRooms.updateRoomSession(activeRoomId, session);
          shouldFlushEmptyLiveSessionRef.current = false;
          lastAppliedStateKeyRef.current = draftKey;
          lastAppliedSessionKeyRef.current = makeLiveSessionKey(session);
          setSyncError(null);
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : "Unable to save this room.");
          finishLoading();
          return;
        }
        finishLoading();
      }
      rackLayoutRef.current = canceled.layout;
      setRackLayout(canceled.layout);
      cancelDraftOnly();
      setReplayCursor(null);
      setGame(draftGame);
    }
    goToLobby();
  }

  function exportGame() {
    if (game) downloadGame(game);
  }

  function startReplay() {
    if (!game || game.logs.length === 0) return;
    setShowResult(false);
    // Start at the very first step: turn 1, rack ready, before action.
    setReplayCursor(0);
  }

  // Step the replay forward/back by ONE half-step. We clamp at both ends —
  // we do NOT auto-exit at the last step, so the user can still undo while
  // viewing it.
  function replayStep(delta: number) {
    if (!game || replayCursor === null) return;
    const total = game.logs.length * 2;
    if (total === 0) return;
    const next = Math.max(0, Math.min(total - 1, replayCursor + delta));
    setReplayCursor(next);
  }

  const replayTotalSteps = game.logs.length * 2;
  const replayIndex = replayCursor ?? -1;
  const latestLog = game.logs.at(-1) ?? null;
  const showViewPanel = reviewing || (readOnly && !canEditRefill);
  const viewPanelLog = reviewing ? selectedLog : latestLog;
  const refillNeeded = game.phase === "refill" && game.status === "playing" && !isRackReady(game);
  const carriedOverTileIds = (() => {
    if (game.phase !== "refill" || game.status !== "playing") return new Set<string>();
    const baseline = refillBaselineRef.current;
    if (refillBaselineMatchesTurn(baseline, game)) return new Set(baseline.ids);

    // Effects capture the local baseline after the first refill render. Use the
    // active player's latest completed rack so the first frame and spectators
    // still get the carried-over count immediately.
    const latestActiveSideLog = [...game.logs]
      .reverse()
      .find((log) => log.side === game.activeSide && log.action !== "end_game");
    return new Set(latestActiveSideLog?.rackAfter.map((tile) => tile.id) ?? []);
  })();
  const concealDirectOpponentRack = isDirectEmailRoom && !emailPlayersCanSeeOpponentRack;
  const tilebagView = getTilebagView({
    game,
    refillNeeded,
    reviewing,
    selectedLog,
    concealOpponentRack: concealDirectOpponentRack,
    viewerSide: accountPlayerSide,
  });
  const exchangeReady = actionMode === "exchange" && exchangeDraft.outgoingIds.length > 0;
  const canPickFromTilebag =
    getTileDrawMode(game) !== "play" &&
    canRefillActiveRack &&
    game.status === "playing" &&
    !reviewing &&
    refillNeeded &&
    actionMode === "none" &&
    activeRack.length < RACK_SIZE;
  // Concealed direct matches show an aggregate unseen pool, but an
  // interactive refill must only ever receive tile IDs from the real bag.
  const displayedOrPickableTilebag = canPickFromTilebag ? game.tilebag : tilebagView.tiles;
  const selectedRackTile =
    activeRack.find((tile) => tile.id === selectedRackTileId) ??
    pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId)?.tile;
  const currentTurnLogRack = actionStart?.rackBefore ?? activeRack;
  // Email players either follow the active rack (sharing on) or keep their own
  // rack visible while waiting (sharing off). Direct matches never grant an
  // owner/admin exception because they have no gameplay host.
  const rackSide: Side =
    reviewing && selectedLog
      ? selectedLog.side
      : isEmailRoom &&
          !emailPlayersCanSeeOpponentRack &&
          accountPlayerSide &&
          (isDirectEmailRoom || !hasAdminAccess)
        ? accountPlayerSide
        : game.activeSide;
  // Build the 8-slot display rack from the layout so empty slots stay in
  // place when tiles leave for the board.
  const displayRack: (TileInstance | null)[] = (() => {
    if (reviewing && selectedLog) {
      const sourceRack =
        replayPhase === "before"
          ? (replayDraft?.rack ?? selectedLog.rackBefore)
          : selectedLog.rackAfter;
      return [...sourceRack, ...Array<TileInstance | null>(RACK_SIZE).fill(null)].slice(
        0,
        RACK_SIZE,
      );
    }
    const live = getRack(game, rackSide);
    const tilesById = new Map(live.map((tile) => [tile.id, tile]));
    // Supabase decoding intentionally creates fresh tile ids. Reconcile here,
    // not only in the effect above, so the first remote render never shows an
    // empty/incomplete rack while React waits to run that effect.
    const slots = reconcileRackLayout(rackLayout[rackSide], live).map((id) =>
      id ? (tilesById.get(id) ?? null) : null,
    );
    if (rackSide === game.activeSide && actionMode === "place_equation") {
      for (const placement of pendingPlacements) {
        if (
          placement.rackSlot !== undefined &&
          placement.rackSlot >= 0 &&
          placement.rackSlot < RACK_SIZE
        ) {
          slots[placement.rackSlot] = null;
        }
      }
    }
    return slots;
  })();
  const rackConfigs = [
    {
      active:
        canPlayActiveRoom &&
        !reviewing &&
        game.status === "playing" &&
        game.activeSide === rackSide,
      exchangeOutgoingIds: rackSide === game.activeSide ? exchangeDraft.outgoingIds : [],
      label: game.players[rackSide],
      rack: displayRack,
      side: rackSide,
    },
  ];
  const scoringEquations =
    reviewing && replayPhase === "after" && selectedLog?.action === "place_equation"
      ? (selectedLog.actionDetail as PlaceEquationDetail).equationsDetected
      : validation.equations;
  const scoringKeys = new Set(
    scoringEquations
      .filter((eq) => eq.isValid)
      .flatMap((eq) => eq.cells.map((cell) => `${cell.row}:${cell.col}`)),
  );
  const gameFinished = isFinishedGame(game);
  const stopRequest = game.matchControl?.stopRequest;
  const incomingStopRequest = Boolean(
    stopRequest && accountPlayerSide && stopRequest.requestedBy !== accountPlayerSide,
  );
  const ownStopBlockedUntil = accountPlayerSide
    ? Date.parse(game.matchControl?.stopBlockedUntilBySide?.[accountPlayerSide] ?? "")
    : Number.NaN;
  const stopRequestBlocked =
    Number.isFinite(ownStopBlockedUntil) && ownStopBlockedUntil > lifecycleNow;
  const stopBlockSeconds = stopRequestBlocked
    ? Math.max(1, Math.ceil((ownStopBlockedUntil - lifecycleNow) / 1000))
    : 0;
  const stopRequestedByMe = Boolean(
    stopRequest && accountPlayerSide && stopRequest.requestedBy === accountPlayerSide,
  );
  const stopResponse = game.matchControl?.stopResponse;
  const stopResponseForMe = Boolean(
    stopResponse &&
    !stopResponse.accepted &&
    accountPlayerSide &&
    stopResponse.requestedBy === accountPlayerSide &&
    stopResponse.id !== seenStopResponseId &&
    game.status === "playing",
  );
  const endIsSurrender = !hasGameplayHost && getGameMode(game) !== "solo";
  const canResumeLifecycle =
    canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl;

  return (
    <main className="app-shell">
      <GlobalActivity
        error={syncError}
        foreground={foregroundLoading}
        syncing={backgroundSyncCount > 0}
      />
      <header className="top-bar">
        <div className="title-block">
          <h1>{game.name}</h1>
        </div>
        <div className="top-actions">
          <span
            className={`role-badge ${
              canControlActiveGame ? "owner" : invitedSides.length > 0 ? "invitee" : "spectator"
            }`}
          >
            {roleLabel}
          </span>
          {hasGameplayHost && (
            <>
              <button
                className="icon-button"
                disabled={!canControlActiveGame || undoStackRef.current.length === 0}
                title="Undo"
                type="button"
                onClick={undo}
              >
                <Undo2 size={18} />
                Undo
              </button>
              <button
                className="icon-button"
                disabled={!canControlActiveGame || redoStackRef.current.length === 0}
                title="Redo"
                type="button"
                onClick={redo}
              >
                <Redo2 size={18} />
                Redo
              </button>
            </>
          )}
          {gameFinished && (
            <button className="icon-button" type="button" onClick={exportGame}>
              <Download size={18} />
              Export
            </button>
          )}
          {game.status === "playing" ? (
            <button
              className="icon-button top-save-exit top-coffee-break"
              title="Leave this board open and browse other games."
              type="button"
              onClick={() => void takeCoffeeBreak()}
            >
              <Coffee size={18} />
              Break
            </button>
          ) : (
            <button
              className="icon-button top-save-exit"
              type="button"
              title={
                gameFinished ? "Exit this finished game." : "Exit and keep this stopped game saved."
              }
              onClick={saveAndExit}
            >
              <LogOut size={18} />
              {gameFinished ? "Exit" : "Exit & Save"}
            </button>
          )}
          <button className="icon-button" type="button" onClick={() => setLogModalOpen(true)}>
            <List size={18} />
            Log
          </button>
          {!gameFinished && game.status === "playing" && canStopLifecycle && (
            <button
              aria-label={
                stopRequestBlocked
                  ? `Stop requests blocked for ${stopBlockSeconds} seconds`
                  : stopRequestedByMe
                    ? "Stop request pending"
                    : isDirectEmailRoom
                      ? "Request to stop game"
                      : "Stop game"
              }
              className={`icon-button top-stop-time running ${
                stopRequestBlocked
                  ? "stop-blocked"
                  : stopRequestedByMe
                    ? "stop-requested"
                    : isDirectEmailRoom
                      ? "stop-request"
                      : "stop-immediate"
              }`}
              disabled={Boolean(stopRequest) || stopRequestBlocked}
              title={
                stopRequestBlocked
                  ? `Stop requests are blocked for ${stopBlockSeconds} more second(s).`
                  : stopRequestedByMe
                    ? "Waiting for the other player."
                    : isDirectEmailRoom
                      ? "Ask the other player to stop the game."
                      : "Stop and save the game."
              }
              type="button"
              onClick={requestOrStopGame}
            >
              {stopRequestBlocked ? (
                <Ban size={18} />
              ) : stopRequestedByMe ? (
                <Clock3 size={18} />
              ) : isDirectEmailRoom ? (
                <Send size={18} />
              ) : (
                <Square size={18} />
              )}
              {stopRequestedByMe
                ? "Requested"
                : stopRequestBlocked
                  ? `${stopBlockSeconds}s`
                  : isDirectEmailRoom
                    ? "Request"
                    : "Stop"}
            </button>
          )}
          {!gameFinished && game.status === "draft" && canResumeLifecycle && (
            <button
              className="resume-button top-stop-time paused"
              type="button"
              title="Resume this stopped game."
              onClick={resumeGame}
            >
              <Play size={18} />
              Resume
            </button>
          )}
          {!gameFinished && game.status === "playing" && canEndLifecycle && (
            <button className="danger-button top-end-game" type="button" onClick={endGame}>
              <Flag size={18} />
              {!hasGameplayHost && getGameMode(game) !== "solo" ? "Surrender" : "End Game"}
            </button>
          )}
          {gameFinished && (
            <>
              <button
                className="icon-button"
                type="button"
                title="Open the final result summary."
                onClick={() => setShowResult(true)}
              >
                <Trophy size={18} />
                Result
              </button>
              <button
                className="resume-button top-end-game"
                type="button"
                disabled={game.logs.length === 0}
                title={
                  game.logs.length === 0
                    ? "Nothing to replay — this game has no recorded turns."
                    : "Step through every move from the beginning."
                }
                onClick={startReplay}
              >
                <Play size={18} />
                Replay
              </button>
            </>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="log-rail">
          <Scoreboard
            game={game}
            scoresOverride={replayOverrides?.scores}
            timersOverride={replayOverrides?.timers}
          />
          <MobileTilebagPanel
            rackSlots={displayRack}
            remainingCount={tilebagView.remainingCount}
            tiles={tilebagView.tiles}
          />
          <LogPanel
            game={game}
            selectedLogId={selectedLogId}
            onSelectLog={selectLog}
            onStarsChange={updateLogStars}
            onNoteChange={updateNote}
            currentTurnRack={currentTurnLogRack}
            readOnly={!canControlActiveGame}
          />
        </aside>

        <section
          className="board-zone"
          ref={boardZoneRef}
          style={{ ["--cell"]: `${boardCell}px` } as CSSProperties}
        >
          <div className="board-stage">
            <Board
              board={boardToRender}
              pendingPlacements={
                reviewing
                  ? replayPhase === "before"
                    ? (replayDraft?.placements ?? [])
                    : []
                  : pendingPlacements
              }
              placementCursor={placementCursor}
              scoreAnchor={(() => {
                // The board badge is a submit preview, so keep it hidden until
                // the current placement passes the same validation as Submit.
                if (!validation.isValid) return null;
                const placements = reviewing
                  ? replayPhase === "before"
                    ? (replayDraft?.placements ?? [])
                    : []
                  : pendingPlacements;
                if (placements.length === 0) return null;
                // Determine if the play forms a single horizontal or vertical
                // line. If it doesn't (or has only one tile), pick orientation
                // from the longest matched equation.
                const rows = new Set(placements.map((p) => p.row));
                const cols = new Set(placements.map((p) => p.col));
                let orientation: "horizontal" | "vertical" | null = null;
                if (rows.size === 1 && cols.size > 1) orientation = "horizontal";
                else if (cols.size === 1 && rows.size > 1) orientation = "vertical";
                else if (placements.length === 1) {
                  const longest = validation.equations
                    .filter((e) => e.isValid)
                    .reduce(
                      (acc: (typeof validation.equations)[number] | null, eq) =>
                        !acc || eq.cells.length > acc.cells.length ? eq : acc,
                      null,
                    );
                  orientation = longest?.direction ?? "horizontal";
                }
                if (!orientation) return null;
                const cells = getScoreAnchorCells({
                  board: boardToRender,
                  equations: validation.equations,
                  orientation,
                  placements,
                });
                return createBoardScoreAnchor({
                  cells,
                  orientation,
                  score: validation.score,
                  isValid: true,
                });
              })()}
              scoringKeys={scoringKeys}
              selectedPendingTileId={selectedPendingTileId}
              selectedRackTileId={selectedRackTileId}
              onCellClick={handleBoardCellClick}
              onPendingAssignmentEdit={openPendingAssignmentEditor}
            />
          </div>

          {botStatus && game.botSide && !reviewing && (
            <BotThinkingCard
              state={botStatus}
              botName={game.players[game.botSide] || "Aether"}
            />
          )}

          {/* Why the bot has not moved. Shown while a retry is pending and
              after a failure that ended in a pass, so the board never simply
              sits there with no explanation. */}
          {botNotice && game.botSide && !reviewing && (
            <div className="bot-notice" role="status" aria-live="polite">
              {botNotice}
            </div>
          )}

          {!botStatus &&
            !reviewing &&
            game.botSide &&
            botReasoning &&
            game.logs[game.logs.length - 1]?.id === botReasoning.logId && (
              <button type="button" className="bot-why-btn" onClick={() => setReasoningOpen(true)}>
                🧠 ทำไม {botReasoning.playerName} เลือกตานี้?
              </button>
            )}

          {/* Analyse this turn. Shown wherever a human is on move and the
              viewer is the one who controls that turn — pass-and-play, hosted,
              direct, solo, and the human side of an Aether match alike.
              `canActActiveSide` is the same flag the action controls use, so
              the button cannot appear on a turn the player could not take.

              This is a convenience gate. The backend enforces the same rule and
              refuses regardless of what is rendered here, which is why hiding
              the button is not relied on for anything. */}
          {analysisAvailable && game.gameId && (
            <TurnAnalysisLauncher
              gameId={game.gameId}
              revision={game.revision ?? 0}
              playerName={game.players[game.activeSide] || game.activeSide}
              disabled={!canAnalyzeTurn}
              disabledReason={analysisDisabledReason}
            />
          )}

          <div className="play-bar">
            <div className="play-caption">
              <span className="pc-room">{game.name}</span>
              <span className={`pc-rack-side side-${rackSide.toLowerCase()}`}>
                {game.players[rackSide]} Rack
              </span>
              {reviewing ? (
                <span className="pc-hint">
                  Replay {replayIndex + 1}/{game.logs.length}
                </span>
              ) : gameFinished ? (
                <span className="pc-hint">Finished · use the top bar for Result / Replay</span>
              ) : game.status === "draft" ? (
                <span className="pc-hint">Draft · paused, press Resume to continue</span>
              ) : (
                <span className="pc-hint">
                  {game.players[game.activeSide]} ·{" "}
                  {refillNeeded
                    ? `Refill ${activeRack.length}/${RACK_SIZE}`
                    : actionMode === "none"
                      ? "Choose action"
                      : ACTION_LABELS[actionMode]}
                </span>
              )}
            </div>
            <MobileActionBar
              actionMode={actionMode}
              canChooseAction={canChooseAction}
              canEditRefill={canEditRefill}
              canExchange={canStartExchange}
              canPickFromTilebag={canPickFromTilebag}
              canUndoPlacement={pendingPlacements.length > 0}
              exchangeCount={exchangeDraft.outgoingIds.length}
              exchangeReady={exchangeReady}
              gameFinished={gameFinished}
              gameStatus={game.status}
              pendingCount={pendingPlacements.length}
              rackCount={activeRack.length}
              readOnly={readOnly}
              refillNeeded={refillNeeded}
              replayIndex={replayIndex}
              replayTotalSteps={replayTotalSteps}
              reviewing={reviewing}
              tileDrawMode={getTileDrawMode(game)}
              validation={validation}
              onCancelAction={cancelAction}
              onConfirmExchange={confirmExchange}
              onConfirmPass={confirmPass}
              onConfirmPlace={confirmPlace}
              onEditRefill={editRefill}
              onOpenBag={() => setMobileBagOpen(true)}
              onReplayExit={() => setReplayCursor(null)}
              onReplayNext={() => replayStep(1)}
              onReplayPrev={() => replayStep(-1)}
              onStartAction={startAction}
              onUndoPlacement={undoLastLivePlacement}
            />
            <Rack
              actionMode={actionMode}
              active={rackConfigs[0].active}
              carriedOverTileIds={carriedOverTileIds}
              exchangeOutgoingIds={rackConfigs[0].exchangeOutgoingIds}
              label={rackConfigs[0].label}
              rack={rackConfigs[0].rack}
              selectedRackTileId={selectedRackTileId}
              side={rackConfigs[0].side}
              onEmptySlotClick={handleEmptyRackSlotClick}
              onTileClick={handleRackTileClick}
            />
          </div>
        </section>

        <aside className="right-rail" ref={rightRailRef}>
          <PlayRail
            game={game}
            tilebag={displayedOrPickableTilebag}
            tilebagCount={tilebagView.remainingCount}
            tilebagDisabled={!canPickFromTilebag}
            onPickTile={refillFromBag}
          />

          <RailDivider railRef={rightRailRef} />

          <ActionPanel
            activeRack={activeRack}
            actionMode={actionMode}
            canChooseAction={canChooseAction}
            canEditRefill={canEditRefill}
            canExchange={canStartExchange}
            exchangeDisabledReason={exchangeRule.reason}
            exchangeDraft={exchangeDraft}
            exchangeReady={exchangeReady}
            game={game}
            pendingPlacements={pendingPlacements}
            readOnly={readOnly}
            refillNeeded={refillNeeded}
            replayIndex={replayIndex}
            replayPhase={replayPhase}
            replayTotalSteps={replayTotalSteps}
            reviewing={reviewing}
            showViewPanel={showViewPanel}
            validation={validation}
            viewPanelLog={viewPanelLog}
            onCancelAction={cancelAction}
            onConfirmExchange={confirmExchange}
            onConfirmPass={confirmPass}
            onConfirmPlace={confirmPlace}
            onEditRefill={editRefill}
            onReplayExit={() => setReplayCursor(null)}
            onReplayNext={() => replayStep(1)}
            onReplayPrev={() => replayStep(-1)}
            onStartAction={startAction}
            onUpdatePendingAssignment={updatePendingAssignment}
          />
        </aside>
      </div>

      <LogModal
        game={game}
        open={logModalOpen}
        selectedLogId={selectedLogId}
        onClose={() => setLogModalOpen(false)}
        onStarsChange={updateLogStars}
        currentTurnRack={currentTurnLogRack}
        onNoteChange={updateNote}
        readOnly={!canControlActiveGame}
        onSelectLog={selectLog}
      />

      {assignmentRequest && (
        <AssignmentModal
          request={assignmentRequest}
          onCancel={() => setAssignmentRequest(null)}
          onSelect={confirmAssignment}
        />
      )}

      {reasoningOpen && botReasoning && (
        <BotReasoningPanel
          playerName={botReasoning.playerName}
          turnNumber={botReasoning.turnNumber}
          response={botReasoning.response}
          onClose={() => setReasoningOpen(false)}
        />
      )}

      {mobileBagOpen && (
        <TilebagSheet
          carriedOverTileIds={carriedOverTileIds}
          rackSlots={displayRack}
          remainingCount={tilebagView.remainingCount}
          tilebag={game.tilebag}
          onClose={() => setMobileBagOpen(false)}
          onPick={refillFromBag}
          onReturn={returnRackTileToBag}
        />
      )}

      {showResult && gameFinished && (
        <ResultModal
          game={game}
          onClose={() => setShowResult(false)}
          onReplay={() => {
            setShowResult(false);
            startReplay();
          }}
        />
      )}

      <Sheet
        dismissible={false}
        open={incomingStopRequest}
        title="Stop game request"
        onClose={() => undefined}
      >
        <p className="ui-confirm-consequence">
          {stopRequest
            ? `${game.players[stopRequest.requestedBy]} wants to stop and save this game.`
            : "The other player wants to stop this game."}
        </p>
        <div className="ui-sheet-actions stop-request-actions">
          <button
            className="ui-button-primary"
            type="button"
            onClick={() => respondToStopRequest(true)}
          >
            Accept stop
          </button>
          <button
            className="ui-button-ghost"
            type="button"
            onClick={() => respondToStopRequest(false)}
          >
            Reject
          </button>
          <button
            className="ui-button-danger"
            type="button"
            onClick={() => respondToStopRequest(false, true)}
          >
            Reject for 5 min
          </button>
        </div>
      </Sheet>

      {/* The answer to MY stop request — persisted in matchControl so it
          still arrives if this device was asleep when the opponent replied. */}
      <Sheet
        open={stopResponseForMe}
        title="Stop request declined"
        onClose={acknowledgeStopResponse}
      >
        <p className="ui-confirm-consequence">
          {stopResponse
            ? `${game.players[stopResponse.respondedBy] || `Side ${stopResponse.respondedBy}`} wants to keep playing.`
            : "The other player wants to keep playing."}
          {stopResponse?.blockedForMs ? " New stop requests are blocked for 5 minutes." : ""}
        </p>
        <div className="ui-sheet-actions">
          <button className="ui-button-primary" type="button" onClick={acknowledgeStopResponse}>
            Keep playing
          </button>
        </div>
      </Sheet>

      <ConfirmSheet
        open={lifecycleConfirm === "stop"}
        title="Stop game"
        consequence="Stop this game and save its current state? You can resume it later."
        confirmLabel="Stop & save"
        onCancel={() => setLifecycleConfirm(null)}
        onConfirm={() => {
          setLifecycleConfirm(null);
          stopGameImmediately(canHostLifecycleControl ? "host" : "A");
        }}
      />

      <ConfirmSheet
        open={lifecycleConfirm === "end"}
        title={endIsSurrender ? "Surrender match" : "End game"}
        consequence={
          endIsSurrender
            ? "Surrender this match? Your opponent wins immediately."
            : "End this game? It will be locked as finished and cannot be resumed."
        }
        confirmLabel={endIsSurrender ? "Surrender" : "End game"}
        onCancel={() => setLifecycleConfirm(null)}
        onConfirm={() => {
          setLifecycleConfirm(null);
          performEndGame();
        }}
      />

      {coffeeReturn}
    </main>
  );
}

function createTurnLog(args: {
  game: GameState;
  action: ActionType;
  actionStart: ActionStart;
  endedAt: string;
  rackAfter: TileInstance[];
  boardAfter: BoardSnapshot;
  tilebagAfter: TileInstance[];
  detail: TurnActionDetail;
  calculatedScore: number;
}): TurnLog {
  return {
    id: crypto.randomUUID(),
    turnNumber: args.game.turnNumber,
    side: args.game.activeSide,
    action: args.action,
    startedAt: args.actionStart.startedAt,
    endedAt: args.endedAt,
    timerBefore: args.actionStart.timerBefore,
    timerAfter: {
      A: args.game.timers.A,
      B: args.game.timers.B,
    },
    rackBefore: args.actionStart.rackBefore,
    rackAfter: deepClone(args.rackAfter),
    boardBefore: args.actionStart.boardBefore,
    boardAfter: deepClone(args.boardAfter),
    tilebagBefore: args.actionStart.tilebagBefore,
    tilebagAfter: deepClone(args.tilebagAfter),
    actionDetail: args.detail,
    calculatedScore: args.calculatedScore,
    finalScore: args.calculatedScore,
  };
}

function downloadGame(game: GameState) {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${game.name.replace(/[^a-z0-9]+/gi, "-") || "amath-lab"}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Why this position cannot be the physical set, or null when it can be.
 *
 * The old check only looked for repeated ids, which catches a duplicated tile
 * but not a lost one, an invented one, or a tile whose face no longer matches
 * its identity. This proves the whole thing: 100 tiles, each of them one of the
 * manifest tiles, each in exactly one place.
 */
function physicalSetProblem(game: GameState): string | null {
  try {
    inventoryFrom({
      tilebag: game.tilebag,
      rackA: game.rackA,
      rackB: game.rackB,
      board: game.board,
      pendingReturnA: getPendingExchangeReturnBySide(game).A,
      pendingReturnB: getPendingExchangeReturnBySide(game).B,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "This game is not a valid set of 100 tiles.";
  }
}

function hasDuplicateTileIds(game: GameState): boolean {
  return physicalSetProblem(game) !== null;
}

function upsertRoomMeta(rooms: RoomMeta[], incoming: RoomMeta): RoomMeta[] {
  const existing = rooms.find((room) => room.id === incoming.id);
  const merged = existing
    ? {
        ...existing,
        ...incoming,
        ownerName: incoming.ownerName ?? existing.ownerName,
        ownerEmail: incoming.ownerEmail ?? existing.ownerEmail,
        roomCode: incoming.roomCode ?? existing.roomCode,
      }
    : incoming;
  return [merged, ...rooms.filter((room) => room.id !== incoming.id)];
}

function roomScopeFromMeta(room: RoomMeta | null | undefined): RoomScope {
  return room?.visibility === "region" && room.regionId
    ? { visibility: "region", regionId: room.regionId }
    : { visibility: "public", regionId: null };
}

function markOwnerSideReady(
  game: GameState,
  ownerId: string | null,
  ownerEmail: string | null,
): GameState {
  if (!ownerId && !ownerEmail) return game;
  const ready = { ...game.lobbyReadyBySide };
  for (const side of ["A", "B"] as Side[]) {
    if (accountMatchesGameSide(game, side, ownerId, ownerEmail)) ready[side] = true;
  }
  return { ...game, lobbyReadyBySide: ready };
}

function getRequiredReadySides(
  game: GameState,
  ownerId: string | null,
  ownerEmail: string | null,
): Side[] {
  return (["A", "B"] as Side[]).filter((side) => {
    if (getGameMode(game) === "solo" && side === "B") return false;
    const hasIdentity = Boolean(
      game.playerUserIds?.[side] || normalizeEmail(game.playerEmails?.[side]),
    );
    return hasIdentity && !accountMatchesGameSide(game, side, ownerId, ownerEmail);
  });
}

function accountMatchesGameSide(
  game: GameState,
  side: Side,
  userId: string | null,
  email: string | null,
): boolean {
  return accountMatchesInvite(game.playerUserIds?.[side], game.playerEmails?.[side], userId, email);
}

function accountMatchesInvite(
  invitedUserId: string | null | undefined,
  invitedEmail: string | null | undefined,
  userId: string | null,
  email: string | null,
): boolean {
  if (invitedUserId) return Boolean(userId && invitedUserId === userId);
  return Boolean(email && normalizeEmail(invitedEmail) === email);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

/**
 * The command id for a given outgoing position, minted once and reused.
 *
 * Retrying a write with a fresh id would let the server apply the same physical
 * move twice; reusing it lets the server recognize the retry and return the
 * effect it already produced.
 */
function commandIdFor(ids: Map<string, string>, stateKey: string): string {
  const existing = ids.get(stateKey);
  if (existing) return existing;
  const id = crypto.randomUUID();
  ids.set(stateKey, id);
  while (ids.size > 32) {
    const oldest = ids.keys().next().value as string | undefined;
    if (!oldest) break;
    ids.delete(oldest);
  }
  return id;
}


function reconcileRackLayout(current: (string | null)[], rack: TileInstance[]): (string | null)[] {
  const presentIds = new Set(rack.map((tile) => tile.id));
  const next = [...current, ...Array<string | null>(RACK_SIZE).fill(null)]
    .slice(0, RACK_SIZE)
    .map((id) => (id && presentIds.has(id) ? id : null));
  const knownIds = new Set(next.filter((id): id is string => id !== null));
  for (const tile of rack) {
    if (knownIds.has(tile.id)) continue;
    const emptyIndex = next.indexOf(null);
    if (emptyIndex < 0) break;
    next[emptyIndex] = tile.id;
    knownIds.add(tile.id);
  }
  return next;
}

function makeLiveSessionKey(session: LiveRoomSession): string {
  return canonicalStringify({
    activeSide: session.activeSide,
    actionMode: session.actionMode,
    exchangeDraft: session.exchangeDraft,
    gameId: session.gameId,
    pendingPlacements: session.pendingPlacements,
    selectedPendingTileId: session.selectedPendingTileId,
    selectedRackTileId: session.selectedRackTileId,
    turnNumber: session.turnNumber,
  });
}

function isEmptyLiveSession(session: LiveRoomSession): boolean {
  return (
    session.actionMode === "none" &&
    session.pendingPlacements.length === 0 &&
    session.exchangeDraft.outgoingIds.length === 0 &&
    session.exchangeDraft.incomingTiles.length === 0 &&
    session.selectedRackTileId === null &&
    session.selectedPendingTileId === null
  );
}

export default App;
