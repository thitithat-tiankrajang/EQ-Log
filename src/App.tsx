import {
  Ban,
  Clock3,
  Coffee,
  BrainCircuit,
  ChevronRight,
  Download,
  Flag,
  FlaskConical,
  GitBranch,
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
import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActionPanel } from "./components/actions/ActionPanel";
import {
  cachedPlayTools,
  defaultPlayTools,
  loadPlayTools,
  playModeKey,
  type PlayTool,
} from "./playModeTools";
import { Board, type BoardScoreAnchor } from "./components/board/Board";
import { GlobalActivity, LoadingScreen } from "./components/feedback/LoadingActivity";
import { Lobby } from "./components/pages/Lobby";
import { CreateRoomPage } from "./components/pages/pregame/CreateRoomPage";
import { JoinRoomPage } from "./components/pages/pregame/JoinRoomPage";
import { WaitingRoomPage } from "./components/pages/pregame/WaitingRoomPage";
import { LogModal } from "./components/logs/LogModal";
import {
  LogPanel,
  type BranchControl,
  type LineView,
  type TurnStep,
} from "./components/logs/LogPanel";
import { TurnLogMap } from "./components/logs/TurnLogMap";
import {
  buildForkIndex,
  divergence,
  NO_FORKS,
  type BranchOption,
} from "./components/logs/branchView";
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
import { recordSurvivalPracticeResult } from "./features/survival/repository";
import { rankedClient } from "./features/ranked/client";
import { survivalPlaytestSource, type SurvivalView } from "./features/survivalPlay/api";
import { parseSurvivalRoomId, survivalAttemptRoomId } from "./features/survivalPlay/route";
import {
  survivalGameFromView,
  survivalMoveFromLog,
  survivalTilebagView,
  type SurvivalGame,
} from "./features/survivalPlay/projection";
import { studyPuzzleSource, type PlayerPuzzle } from "./features/studyPuzzles/api";
import {
  parseStudyPuzzleRoomId,
  studyPlacementsFromLog,
  studyPuzzleGame,
  studyTilebagView,
  type StudyPuzzleGame,
} from "./features/studyPuzzles/play";
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
import { canonicalStringify, createRemoteStateKeyCache, makeRemoteStateKey } from "./stateKey";
import * as engineTrace from "./engineTrace";
import type { RoomMeta } from "./rooms";
import * as remoteRooms from "./remoteRooms";
import type { LiveRoomSession, RoomSessionEvent } from "./remoteRooms";
import { navigate, useRoute } from "./router";
import { getRoomActorCapabilities } from "./roomAccess";
import { isRemoteGameAhead, isRemoteGameStale, revisionOf, withRevision } from "./gameSync";
import * as playSnapshotCache from "./playSnapshotCache";
import { decodeCanonical, inventoryFrom } from "./domain/projection";
import { spectatorPreview } from "./spectatorPreview";
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
import { typeKey, type Slot } from "./gameplay/rackTyping";
import { advanceRunningClock } from "./gameplay/timer";
import {
  buildTree,
  continueFrom,
  equivalentParkedChild,
  lineCount,
  lineTipOf,
  pathTo,
  pruneLine,
  type ContinueTarget,
  type Multiverse,
} from "./gameplay/multiverse";
import { encodeMultiverse } from "./gameplay/multiverseCodec";
import * as timelineStore from "./timelineStore";
import { clearTileAssignment } from "./gameplay/tiles";
import {
  isDesyncBotFailure,
  botRetryDelay,
  BOT_ESCAPE_AFTER_FAILURES,
  isRetryableBotFailure,
  mapBotResponse,
  toBotResponse,
  warmUpBotEngine,
} from "./bot/botController";
import { EngineApiError, isEngineApiConfigured, type BotMoveResult } from "./bot/engineApi";
import { clientSuperReadiness, type ClientSuperReadiness } from "./bot/clientSuper";
import { planSuperThreads, readThreadEnvironment } from "./bot/superThreads";
import {
  cancel as cancelSuperEngine,
  initialize as initializeSuperEngine,
} from "./bot/superEngine";
import { installConsoleHandle as installTelemetryHandle } from "./bot/superTelemetry";
import type { BotResponse } from "./bot/types";
import * as engineDebug from "./engineDebug";
import * as engineSessions from "./engineSessions";
import type { LocalAnalysisContext } from "./engineSessions";
import { botRecordFromGame, recordBotGame } from "./botStats";
import { BotStuckNotice } from "./components/game/BotStuckNotice";
import { BotThinkingCard } from "./components/game/BotThinkingCard";
import { BotReasoningPanel } from "./components/game/BotReasoningPanel";
import { TurnAnalysisBar, TurnAnalysisLauncher } from "./components/game/TurnAnalysisLauncher";
import { resolveStudyKey } from "./gameplay/tileKeys";
import {
  resolveDrawnTile,
  resolveRackTile,
  tileRequestFromStroke,
} from "./gameplay/rackResolution";
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
        return "การคำนวณของบอทใช้เวลานานเกินกำหนด — ยังไม่เดินหมาก กำลังลองใหม่";
      case "budget_exhausted":
        return "ใช้โควตาการคำนวณครบแล้ว — ยังไม่เดินหมาก กำลังลองใหม่";
      case "unauthenticated":
        return "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่";
      case "unconfigured":
        return "ระบบบอทยังไม่ได้เปิดใช้งานในเซิร์ฟเวอร์นี้";
      default:
        return "บอทคำนวณตานี้ไม่สำเร็จ — ยังไม่เดินหมาก กำลังลองใหม่";
    }
  }
  return "บอทคำนวณตานี้ไม่สำเร็จ — ยังไม่เดินหมาก กำลังลองใหม่";
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

const NO_LOGS: TurnLog[] = [];

/** A Study puzzle is answered with one placement. */
const STUDY_PLACEMENT_ONLY = "โจทย์นี้ตอบได้ด้วยการลงเบี้ยเท่านั้น (แลกหรือผ่านไม่ได้)";

/**
 * Where a room's parked lines are read from: `game_timelines` for a live room, the room's own
 * local-storage entry without Supabase. A finished game's lines arrive inside its archive
 * payload instead and are adopted there, never loaded through this.
 */
function timelineLoaderFor(remote: boolean): timelineStore.TimelineLoader {
  if (remote) return (roomId) => remoteRooms.readTimeline(roomId);
  return async (roomId) => {
    const doc = roomStore.readTimelineDoc(roomId) as { version?: number } | null;
    return doc ? { version: Number(doc.version ?? 0), doc } : null;
  };
}

/** Take a finished game's parked lines from its archive payload, if it carried any. */
function adoptArchivedTimeline(roomId: string, payload: remoteRooms.RemoteRoomPayload | null) {
  if (payload?.archivedTimeline)
    timelineStore.adoptStoredTimeline(roomId, payload.archivedTimeline);
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
      : route.kind === "play" && route.returnTo?.kind === "home"
        ? route.returnTo.visibility
        : "public";
  const [lobbyVisibility, setLobbyVisibility] = useState<RoomVisibility>(initialLobbyVisibility);
  const [rooms, setRooms] = useState<RoomMeta[]>(() =>
    remoteEnabled ? [] : roomStore.listRooms({ visibility: "public", regionId: null }),
  );
  const [roomsLoading, setRoomsLoading] = useState(remoteEnabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [blankArmed, setBlankArmed] = useState(false);
  /**
   * Which rack slot the keyboard is filling, or null when typing mode is off.
   *
   * Only meaningful while refilling by hand. The rack shows it in yellow, because typing takes
   * over keys that mean other things on this page and a mode you cannot see is a mode that
   * surprises you.
   */
  const [rackTypingFocus, setRackTypingFocus] = useState<number | null>(null);
  const rackTypingFocusRef = useRef<number | null>(null);
  rackTypingFocusRef.current = rackTypingFocus;
  /** One line about what the last keystroke did, when it did something the
   *  player would not otherwise see — spending a blank, or finding nothing in
   *  hand that could play the face they asked for. Clears itself. */
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [foregroundLoading, setForegroundLoading] = useState<string | null>(null);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const [joinError, setJoinError] = useState<string | null>(null);
  // A Survival level on the Play page is addressed like a room but is not one:
  // its game lives on the Survival server (src/features/survivalPlay), so the
  // room machinery below — open, subscribe, persist — must never see its id.
  const survivalRoute = route.kind === "play" ? parseSurvivalRoomId(route.roomId) : null;
  // A Study puzzle preview is the same kind of guest: one position from the Study
  // puzzle server (src/features/studyPuzzles), no room behind it.
  const studyPuzzleRoute = route.kind === "play" ? parseStudyPuzzleRoomId(route.roomId) : null;
  const routeRoomId =
    (route.kind === "room" || route.kind === "play") && !survivalRoute && !studyPuzzleRoute
      ? route.roomId
      : null;
  // On a remount for the Play route, seed the board from the last authoritative
  // snapshot this session held for the room, so returning renders the game at
  // once instead of a blank loader. The seed is revalidated in the background
  // (see the mount effect below); it never authorises anything.
  const seededRemoteGame =
    remoteEnabled && routeRoomId ? (playSnapshotCache.get(routeRoomId) ?? null) : null;
  const [game, setGame] = useState<GameState | null>(() => {
    if (survivalRoute || studyPuzzleRoute) return null;
    if (remoteEnabled) return seededRemoteGame;
    const id = routeRoomId ?? roomStore.getActiveRoomId();
    if (!id) return null;
    const saved = roomStore.readRoom(id);
    return saved && !hasDuplicateTileIds(saved)
      ? advanceRunningClock(normalizeFinishedGame(saved))
      : null;
  });
  // True only for the first mount that rendered a cached seed, so that mount can
  // kick a single background revalidation. Cleared once fired.
  const seededFromCacheRef = useRef(seededRemoteGame !== null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    if (survivalRoute || studyPuzzleRoute) return null;
    if (routeRoomId) return routeRoomId;
    if (remoteEnabled) return null;
    const id = roomStore.getActiveRoomId();
    return id && roomStore.readRoom(id) ? id : null;
  });
  const view: "lobby" | "game" = route.kind === "play" ? "game" : "lobby";
  // ── Survival session (see src/features/survivalPlay) ───────────────────────
  // The real game is on the Survival server. `survival.game` is the player's view
  // of it in Play-page form; every move goes to the server and comes back as a new
  // view. Nothing on this side ever holds the bag order or Authur's rack.
  const [survival, setSurvival] = useState<SurvivalGame | null>(null);
  const survivalRef = useRef<SurvivalGame | null>(null);
  survivalRef.current = survival;
  const [survivalBusy, setSurvivalBusy] = useState<"loading" | "move" | "authur" | null>(null);
  const survivalBusyRef = useRef<"loading" | "move" | "authur" | null>(null);
  survivalBusyRef.current = survivalBusy;
  const [survivalError, setSurvivalError] = useState<string | null>(null);
  const [survivalRetry, setSurvivalRetry] = useState(0);
  const survivalLoadRef = useRef<{ key: string; promise: Promise<SurvivalView> } | null>(null);
  // ── Study puzzle preview (see src/features/studyPuzzles) ───────────────────
  // One position, one placement. The server holds the answer; this side only
  // ever holds the player projection, and a submission comes back as the
  // player's own score — never the engine's answer. Nothing replies to it.
  const [studyPuzzle, setStudyPuzzle] = useState<StudyPuzzleGame | null>(null);
  const studyPuzzleRef = useRef<StudyPuzzleGame | null>(null);
  studyPuzzleRef.current = studyPuzzle;
  const [studyPuzzleBusy, setStudyPuzzleBusy] = useState<"loading" | "submit" | null>(null);
  const studyPuzzleBusyRef = useRef<"loading" | "submit" | null>(null);
  studyPuzzleBusyRef.current = studyPuzzleBusy;
  const [studyPuzzleError, setStudyPuzzleError] = useState<string | null>(null);
  const [studyPuzzleRetry, setStudyPuzzleRetry] = useState(0);
  const [studyPuzzleSubmitted, setStudyPuzzleSubmitted] = useState<{
    score: number;
    equations: { text: string; score: number }[];
  } | null>(null);
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
  // The line on the board while reviewing one that is not being played, named by its last turn.
  // Only means anything while `replayCursor` is set: every way out of the replay is also a way
  // back to the live line, without each of them having to say so.
  const [viewTipId, setViewTipId] = useState<string | null>(null);
  // The room whose Turn Log Map is open. A room id rather than a flag, so a map can never stay
  // open over a different room.
  const [mapRoomId, setMapRoomId] = useState<string | null>(null);
  const [branchBusy, setBranchBusy] = useState(false);
  const branchBusyRef = useRef(false);
  branchBusyRef.current = branchBusy;
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [showResult, setShowResult] = useState(false);
  // In-app confirmations for lifecycle actions (never window.confirm — native
  // dialogs are blocked in some in-app browsers and can't explain outcomes).
  const [lifecycleConfirm, setLifecycleConfirm] = useState<"stop" | "end" | null>(null);
  // Stop-response the requester has already acknowledged (local only).
  const [seenStopResponseId, setSeenStopResponseId] = useState<string | null>(null);
  const [assignmentRequest, setAssignmentRequest] = useState<AssignmentRequest | null>(null);
  const [boardCell, setBoardCell] = useState(34);
  const [isMobilePlay, setIsMobilePlay] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 759px)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 759px)");
    const update = () => setIsMobilePlay(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  // Mobile tile-pick bottom sheet (manual draw mode). Auto-opens once per
  // turn when the active player needs to refill; see the effect below.
  const [mobileBagOpen, setMobileBagOpen] = useState(false);
  const [coffeeRoomId, setCoffeeRoomId] = useState<string | null>(() =>
    window.localStorage.getItem(STORAGE_KEYS.coffeeRoom),
  );
  const [lifecycleNow, setLifecycleNow] = useState(() => Date.now());
  const bagAutoOpenKeyRef = useRef<string>("");
  const refillBaselineRef = useRef<RefillBaseline | null>(null);
  // State, not a ref: the sizing effect must run when the board MOUNTS. Opening a room from the
  // lobby sets the game while the lobby is still on screen, so an effect keyed only on the game
  // ran against no board, returned, and never ran again — the board stayed at the default cell
  // size (shrunk) until a reload.
  const [boardZone, setBoardZone] = useState<HTMLElement | null>(null);
  const rightRailRef = useRef<HTMLElement | null>(null);
  // Fast-path refs for rapid keyboard placement. Updated synchronously inside
  // handlers so back-to-back keystrokes always read fresh state instead of
  // stale closures. Re-synced on every render via the assignments below.
  const keyNoticeTimerRef = useRef<number | null>(null);
  /** Show one line and let it fade. Declared as a callback rather than inline so
   *  the key handler, which runs from a window listener, is not rebuilt for it. */
  const showKeyNotice = useCallback((message: string) => {
    setKeyNotice(message);
    if (keyNoticeTimerRef.current !== null) window.clearTimeout(keyNoticeTimerRef.current);
    keyNoticeTimerRef.current = window.setTimeout(() => setKeyNotice(null), 2_500);
  }, []);

  const cursorRef = useRef(placementCursor);
  const pendingsRef = useRef(pendingPlacements);
  /** Whether `B` is waiting for the face a blank will stand in for. A ref as
   *  well as state, because the key handler reads it in the same tick it is
   *  set. */
  const blankArmedRef = useRef(false);
  /** Whether Enter would actually submit — the same condition `confirmPlace`
   *  checks. Kept so a stray Enter is not swallowed on a turn that has nothing
   *  to submit: preventing the default there would eat the keystroke of
   *  whatever button happens to hold focus. */
  const submitReadyRef = useRef(false);
  /** The `confirmPlace` of the latest render, for Enter. The key handler is not
   *  re-created as tiles go down, so its own copy of `confirmPlace` still sees
   *  the turn before any were placed and returns without submitting. */
  const confirmPlaceRef = useRef<() => void>(() => {});
  const gameRef = useRef<GameState | null>(game);
  const actionModeRef = useRef(actionMode);
  const rackLayoutRef = useRef(rackLayout);
  cursorRef.current = placementCursor;
  pendingsRef.current = pendingPlacements;
  gameRef.current = game;
  actionModeRef.current = actionMode;
  rackLayoutRef.current = rackLayout;

  // ── Stable handlers for the memoized board and rack ───────────────────────
  //
  // `Board` and `Rack` skip re-rendering when the picture has not changed (see
  // `sameBoardPicture` / `sameRack`), and a handler recreated on every render
  // would make that comparison fail every time — the board is 225 buttons, so
  // that is the difference between reconciling the grid on every clock tick and
  // reconciling it when a square actually changes.
  //
  // The identity is fixed for the life of the component; the BEHAVIOUR is not.
  // Each render points the ref at that render's closure, so the callback always
  // runs against current state — the same render-phase ref assignment this
  // component already uses for `gameRef`, `cursorRef` and the rest above.
  //
  // The handlers are function declarations further down the body, so they are
  // hoisted and can be captured here; they are only ever CALLED from an event,
  // by which time every value they close over exists.
  const boardCellClickRef = useRef<(row: number, col: number) => void>(() => {});
  const pendingAssignmentEditRef = useRef<(tileId: string) => boolean | void>(() => {});
  const rackTileClickRef = useRef<(tile: TileInstance, side: Side) => void>(() => {});
  const exchangeSelectTilesRef = useRef<(ids: string[], additive: boolean) => void>(() => {});
  const selectLogRef = useRef<(id: string | null) => void>(() => {});
  const updateLogStarsRef = useRef<(id: string, stars: number) => void>(() => {});
  const updateLogNoteRef = useRef<(id: string, note: string) => void>(() => {});
  const emptyRackSlotClickRef = useRef<(index: number, side: Side) => void>(() => {});
  const stepTurnRef = useRef<(step: TurnStep) => void>(() => {});
  const setReplayPhaseRef = useRef<(phase: "before" | "after") => void>(() => {});
  const viewOptionRef = useRef<(option: BranchOption) => void>(() => {});
  const continueFromViewRef = useRef<() => void>(() => {});
  const mapViewRef = useRef<(nodeId: string | null) => void>(() => {});
  const mapContinueRef = useRef<(target: ContinueTarget) => void>(() => {});
  const mapPruneRef = useRef<(lineId: string) => void>(() => {});
  const retryTimelineRef = useRef<() => void>(() => {});
  stepTurnRef.current = stepTurn;
  setReplayPhaseRef.current = setReplayPhase;
  viewOptionRef.current = (option) => viewTurn(option.id, "after");
  continueFromViewRef.current = continueFromView;
  mapViewRef.current = viewFromMap;
  mapContinueRef.current = continueFromMap;
  mapPruneRef.current = (lineId) => void pruneTimelineLine(lineId);
  retryTimelineRef.current = retryTimeline;
  boardCellClickRef.current = handleBoardCellClick;
  pendingAssignmentEditRef.current = openPendingAssignmentEditor;
  rackTileClickRef.current = handleRackTileClick;
  exchangeSelectTilesRef.current = selectExchangeTiles;
  selectLogRef.current = selectLog;
  updateLogStarsRef.current = updateLogStars;
  updateLogNoteRef.current = updateNote;
  emptyRackSlotClickRef.current = handleEmptyRackSlotClick;
  const onBoardCellClick = useCallback(
    (row: number, col: number) => boardCellClickRef.current(row, col),
    [],
  );
  const onPendingAssignmentEdit = useCallback((tileId: string) => {
    pendingAssignmentEditRef.current(tileId);
  }, []);
  const onRackTileClick = useCallback(
    (tile: TileInstance, side: Side) => rackTileClickRef.current(tile, side),
    [],
  );
  const onExchangeSelectTiles = useCallback(
    (ids: string[], additive: boolean) => exchangeSelectTilesRef.current(ids, additive),
    [],
  );
  const onSelectLog = useCallback((id: string | null) => selectLogRef.current(id), []);
  const onUpdateLogStars = useCallback(
    (id: string, stars: number) => updateLogStarsRef.current(id, stars),
    [],
  );
  const onUpdateLogNote = useCallback(
    (id: string, note: string) => updateLogNoteRef.current(id, note),
    [],
  );
  const onEmptyRackSlotClick = useCallback(
    (index: number, side: Side) => emptyRackSlotClickRef.current(index, side),
    [],
  );
  /** Aim the typing caret. Stable, because `Rack` compares its callbacks by identity. */
  const onRackSlotFocus = useCallback((index: number) => setRackTypingFocus(index), []);
  const onStepTurn = useCallback((step: TurnStep) => stepTurnRef.current(step), []);
  const onSetReplayPhase = useCallback(
    (phase: "before" | "after") => setReplayPhaseRef.current(phase),
    [],
  );
  const onViewOption = useCallback((option: BranchOption) => viewOptionRef.current(option), []);
  const onContinueFromView = useCallback(() => continueFromViewRef.current(), []);
  const onMapView = useCallback((nodeId: string | null) => mapViewRef.current(nodeId), []);
  const onMapContinue = useCallback((target: ContinueTarget) => mapContinueRef.current(target), []);
  const onMapPrune = useCallback((lineId: string) => mapPruneRef.current(lineId), []);
  const onRetryTimeline = useCallback(() => retryTimelineRef.current(), []);
  const onCloseMap = useCallback(() => setMapRoomId(null), []);
  const openMap = useCallback(() => setMapRoomId(activeRoomIdRef.current), []);

  const readOnlyRef = useRef(false);
  const activeRoomIdRef = useRef<string | null>(activeRoomId);
  const pendingSessionEventRef = useRef<RoomSessionEvent | null>(null);
  // Seeded, not empty, whenever this mount rendered a cached snapshot.
  //
  // The sync effect below treats "the key differs from the last applied one" as
  // "the player changed something, push it". An empty ref makes a cache-seeded
  // mount look exactly like that, so it committed a position the server already
  // held — a write that changes nothing and yet MINTS A REVISION.
  //
  // That is not a harmless no-op. The revision is the identity every engine job
  // is keyed on, so a phantom bump silently retires the analysis or bot search
  // in flight, and the server goes on computing an answer that can no longer be
  // delivered. Every snapshot in the cache came from the authority (see the
  // `remember` call sites), so seeding this ref with it is simply telling the
  // truth: that position has already been applied.
  const lastAppliedStateKeyRef = useRef<string>(
    seededRemoteGame ? makeRemoteStateKey(seededRemoteGame) : "",
  );
  const lastAppliedSessionKeyRef = useRef<string>("");
  const lastAppliedSessionUpdatedAtRef = useRef("");
  const lastAppliedSessionScopeRef = useRef("");
  const lastAppliedSessionActorIdRef = useRef<string | null>(null);
  const deferredRemoteSessionRef = useRef<LiveRoomSession | null>(null);
  const shouldFlushEmptyLiveSessionRef = useRef(false);
  // Command id per outgoing position, so a retry of the same intent reuses its
  // id and the server can recognize and ignore the duplicate.
  const commandIdsByStateKeyRef = useRef(new Map<string, string>());
  // This tab's own position write, while the server has not answered it: which room, and the
  // revision it was composed on. A read at that revision or older can only undo it — the server
  // has not applied it yet — so `applyRemotePayload` leaves such reads alone until it settles.
  const inFlightCommitRef = useRef<{ roomId: string; revision: number } | null>(null);
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
  const modeKey = game ? playModeKey(game, activeRoomMeta?.modeKey) : null;
  const [modeToolState, setModeToolState] = useState<{
    key: string | null;
    tools: ReadonlySet<PlayTool>;
    loading: boolean;
  }>(() => ({
    key: !remoteEnabled ? modeKey : null,
    tools: !remoteEnabled && modeKey ? defaultPlayTools(modeKey) : new Set(),
    loading: remoteEnabled,
  }));
  useEffect(() => {
    if (!modeKey) return;
    if (!remoteEnabled) {
      setModeToolState({ key: modeKey, tools: defaultPlayTools(modeKey), loading: false });
      return;
    }
    const cached = cachedPlayTools(modeKey);
    setModeToolState({ key: modeKey, tools: cached ?? new Set(), loading: !cached });
    if (cached) return;
    let active = true;
    void loadPlayTools(modeKey).then((tools) => {
      if (active) setModeToolState({ key: modeKey, tools, loading: false });
    });
    return () => {
      active = false;
    };
  }, [modeKey, remoteEnabled]);
  // A Survival session's tools are fixed here and never read from the catalog.
  const playTools = survival
    ? defaultPlayTools("survival_playtest")
    : studyPuzzle
      ? defaultPlayTools("study_puzzle")
      : modeToolState.key === modeKey
      ? modeToolState.tools
      : defaultPlayTools("");
  const modeToolsLoading = Boolean(
    !survival &&
    !studyPuzzle &&
    remoteEnabled &&
    modeKey &&
    (modeToolState.key !== modeKey || modeToolState.loading),
  );
  const canUseTool = (tool: PlayTool) => playTools.has(tool);
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
  // A Survival level has no host: nobody undoes, branches or edits its log.
  const canControlActiveGame =
    !survival && !studyPuzzle && canManageActiveRoom && !isDirectEmailRoom;
  const isSelfDirectedSolo = Boolean(game && getGameMode(game) === "solo" && !isEmailRoom);
  const hasGameplayHost = Boolean(game && !isDirectEmailRoom && !isSelfDirectedSolo);
  const canHostLifecycleControl = hasGameplayHost && canManageActiveRoom;
  const canSoloLifecycleControl = isSelfDirectedSolo && canManageActiveRoom;
  const canDirectLifecycleControl = isDirectEmailRoom && accountPlayerSide !== null;
  const canStopLifecycle =
    !survival &&
    !studyPuzzle &&
    (canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl);
  const canEndLifecycle =
    !survival &&
    !studyPuzzle &&
    (canHostLifecycleControl || canSoloLifecycleControl || canDirectLifecycleControl);
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
  // In Survival the player acts on their own turn only, and never while a move is in flight.
  const survivalCanAct = Boolean(
    survival &&
    game?.status === "playing" &&
    game.activeSide === survival.humanSide &&
    survivalBusy === null,
  );
  // A Study puzzle takes exactly one placement; nothing is played after it is submitted.
  const studyPuzzleCanAct = Boolean(
    studyPuzzle && !studyPuzzleSubmitted && studyPuzzleBusy === null,
  );
  const actorCapabilities = survival
    ? { canAct: survivalCanAct, canInteract: survivalCanAct, canRefill: false }
    : studyPuzzle
      ? { canAct: studyPuzzleCanAct, canInteract: studyPuzzleCanAct, canRefill: false }
      : getRoomActorCapabilities({
        game,
        emailPlayMode,
        invitedSides,
        isAdmin: hasAdminAccess,
        isOwner: isActiveRoomOwner,
        remoteEnabled,
      });
  const canActActiveSide = actorCapabilities.canAct;
  const canRefillActiveRack = actorCapabilities.canRefill;
  const canRefillActiveRackRef = useRef(false);
  canRefillActiveRackRef.current = canRefillActiveRack;
  const canPlayActiveRoom = actorCapabilities.canInteract;
  const readOnly =
    survival || studyPuzzle ? !canPlayActiveRoom : remoteEnabled && !canPlayActiveRoom;
  readOnlyRef.current = readOnly;
  const roleLabel = (() => {
    if (survival) {
      if (game?.status === "finished") return "Survival · Finished";
      return survivalBusy === "authur" ? "Survival · Authur thinking" : "Survival · Your turn";
    }
    if (studyPuzzle) {
      return studyPuzzleSubmitted ? "Study puzzle · Submitted" : "Study puzzle · Your move";
    }
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
  // `makeRemoteStateKey` walks the whole match — every turn log carries two full
  // board snapshots and two full bags — so it must run when the POSITION
  // changes, not on every new `game` object. The running clock produces one of
  // those a second, and none of what it changes is in the key.
  const remoteStateKeyCache = useRef(createRemoteStateKeyCache());
  const remoteStateKey = remoteStateKeyCache.current(game);
  /**
   * The content key of the last position the SERVER acknowledged.
   *
   * Distinct from `lastAppliedStateKeyRef`, which is set optimistically before a
   * write so the echo can be recognised. This one is set only by an answer: a
   * successful commit, an authoritative read, or an adopted realtime update. The
   * gap between them is exactly the window in which a human move exists locally
   * and nowhere else — the window the bot must not act in.
   */
  const [confirmedStateKey, setConfirmedStateKey] = useState("");
  const positionIsConfirmed = remoteStateKey !== "" && confirmedStateKey === remoteStateKey;
  /** Set once the room row has been read, so "ownership unknown" can be told
   *  apart from "not the owner". See `roomFactsResolved`. */
  const roomMetaReadRef = useRef(false);
  /**
   * The revision this tab watched the server admit, from its own commit.
   *
   * This is the only circumstance in which skipping the discovery round trip is
   * provably safe: we saw the position come into existence a moment ago, so no
   * job can predate it, and the attach that used to precede every bot POST could
   * only ever have answered `idle`.
   *
   * Anything else — a remount, a reload, a revision learned from a read or from
   * realtime — makes no such claim. A job may well exist there (this tab may
   * have started it before navigating away), and attaching is what rejoins it
   * instead of paying for a second search.
   */
  const selfAdmittedRevisionRef = useRef<number | null>(null);
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
  const lastFullReconcileRef = useRef<{ roomId: string; at: number } | null>(null);
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
        navigate({ kind: "play", roomId: routeRoomId, returnTo: route.returnTo }, true);
      } else if (route.kind === "play" && getRoomStage(game) === "waiting") {
        navigate({ kind: "room", roomId: routeRoomId, returnTo: route.returnTo }, true);
      }
      return;
    }
    let cancelled = false;
    const finishLoading = startForegroundLoading("Opening room...");
    (async () => {
      try {
        const remotePayload = remoteEnabled ? await remoteRooms.readRoom(routeRoomId) : null;
        adoptArchivedTimeline(routeRoomId, remotePayload);
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
        const savedKey = makeRemoteStateKey(saved);
        lastAppliedStateKeyRef.current = savedKey;
        // Read straight from the authority: this position is confirmed by
        // definition.
        setConfirmedStateKey(savedKey);
        roomMetaReadRef.current = true;
        if (remoteEnabled) playSnapshotCache.remember(routeRoomId, saved);
        if (remotePayload) {
          setLobbyVisibility(remotePayload.meta.visibility ?? "public");
          setRooms((current) => upsertRoomMeta(current, remotePayload.meta));
          applyRemoteSession(remotePayload.session, saved);
          compactRemoteRoomIfNeeded(remotePayload, saved);
        }
        setShowResult(isFinishedGame(saved));
        if (route.kind === "room" && getRoomStage(saved) === "playing") {
          navigate({ kind: "play", roomId: routeRoomId, returnTo: route.returnTo }, true);
        } else if (route.kind === "play" && getRoomStage(saved) === "waiting") {
          navigate({ kind: "room", roomId: routeRoomId, returnTo: route.returnTo }, true);
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

  // Open a Survival level (a fresh attempt) or an attempt already under way.
  const survivalKey = survivalRoute
    ? survivalRoute.kind === "level"
      ? `level:${survivalRoute.levelId}`
      : `attempt:${survivalRoute.attemptId}`
    : null;
  useEffect(() => {
    if (!survivalRoute || !survivalKey) {
      if (survivalRef.current) {
        survivalRef.current = null;
        setSurvival(null);
        setSurvivalBusy(null);
        setSurvivalError(null);
      }
      return;
    }
    // A level link is replaced by its attempt's id once the attempt exists.
    if (
      survivalRoute.kind === "attempt" &&
      survivalRef.current?.attemptId === survivalRoute.attemptId
    ) {
      return;
    }
    let cancelled = false;
    setActiveRoomId(null);
    setGame(null);
    setShowResult(false);
    setSurvivalError(null);
    setSurvivalBusy("loading");
    // One request per link, even when React runs this effect twice.
    if (survivalLoadRef.current?.key !== survivalKey) {
      survivalLoadRef.current = {
        key: survivalKey,
        promise:
          survivalRoute.kind === "level"
            ? survivalPlaytestSource.start(survivalRoute.levelId)
            : survivalPlaytestSource.read(survivalRoute.attemptId),
      };
    }
    const load = survivalLoadRef.current.promise;
    load
      .then((next) => {
        if (cancelled) return;
        adoptSurvivalView(next);
        // Cleared here, not in `finally`: replacing a level link with its attempt's
        // id re-runs this effect, and the cleanup would leave "loading" set forever.
        setSurvivalBusy(null);
        if (survivalRoute.kind === "level") {
          navigate({ kind: "play", roomId: survivalAttemptRoomId(next.attemptId) }, true);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSurvivalError(error instanceof Error ? error.message : String(error));
        setSurvivalBusy(null);
      })
      .finally(() => {
        if (survivalLoadRef.current?.promise === load) survivalLoadRef.current = null;
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survivalKey, survivalRetry]);

  // Authur moves whenever it is Authur's turn — on the server, never on this side.
  useEffect(() => {
    const session = survivalRef.current;
    if (!session || session.status !== "authur-to-move") return;
    let cancelled = false;
    setSurvivalBusy("authur");
    setSurvivalError(null);
    survivalPlaytestSource
      .authur(session.attemptId)
      .then((next) => {
        if (!cancelled) adoptSurvivalView(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSurvivalError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setSurvivalBusy(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [survival?.attemptId, survival?.status, survival?.game.revision, survivalRetry]);

  // Open a Study puzzle: the player projection, nothing more.
  const studyPuzzleKey = studyPuzzleRoute
    ? `${studyPuzzleRoute.setId}:${studyPuzzleRoute.puzzleId}`
    : null;
  useEffect(() => {
    if (!studyPuzzleRoute || !studyPuzzleKey) {
      if (studyPuzzleRef.current) {
        studyPuzzleRef.current = null;
        setStudyPuzzle(null);
        setStudyPuzzleBusy(null);
        setStudyPuzzleError(null);
        setStudyPuzzleSubmitted(null);
        setGame(null);
      }
      return;
    }
    let cancelled = false;
    setStudyPuzzleError(null);
    setStudyPuzzleSubmitted(null);
    setStudyPuzzleBusy("loading");
    studyPuzzleSource
      .play(studyPuzzleRoute.setId, studyPuzzleRoute.puzzleId)
      .then((projection: PlayerPuzzle) => {
        if (cancelled) return;
        const projected = studyPuzzleGame(projection, {
          playerName: profile?.display_name?.trim() || "คุณ",
        });
        studyPuzzleRef.current = projected;
        setStudyPuzzle(projected);
        setGame(projected.game);
        setStudyPuzzleBusy(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStudyPuzzleError(error instanceof Error ? error.message : String(error));
        setStudyPuzzleBusy(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyPuzzleKey, studyPuzzleRetry]);

  // A mount that rendered a cached snapshot shows the board immediately, then
  // revalidates once against the authoritative room row — silently, without the
  // full-screen loader. The revision-guarded reconcile adopts newer state and
  // discards anything older, so the seed can only ever be corrected forward.
  useEffect(() => {
    if (!seededFromCacheRef.current) return;
    seededFromCacheRef.current = false;
    if (remoteEnabled && activeRoomId) void reconcileActiveRoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Waiting rooms also need the full room metadata loaded above. Lobby
    // summaries omit ownership and invitation fields, so fetching them here
    // can replace the waiting room's metadata before its host can start.
    if (!remoteEnabled || view !== "lobby" || route.kind === "room") return;
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
  }, [
    remoteEnabled,
    view,
    route.kind,
    requestedLobbyScope?.visibility,
    requestedLobbyScope?.regionId,
    userId,
  ]);

  // Spectators follow the broadcast topic instead of the room row: one publish
  // per move, a payload bounded by the size of the physical set rather than by
  // the length of the game, and no per-observer work on the authoritative side.
  // A read-only observer never writes, so this is the whole of its sync path
  // apart from the snapshot it fetched when it opened the room.
  //
  // "Spectator" means somebody who cannot write this room — not a player who cannot act right
  // now. `readOnly` also turns on for the owner the moment a game finishes or pauses, and using
  // it here subscribed the owner as a spectator exactly then: the subscription's first reconcile
  // read the room before the server had archived it, found the pre-finish row, and put the
  // finished game back into play — the end-of-game screen flickered and the finish replayed.
  const isSpectator = remoteEnabled && !canWriteActiveRoom;
  useEffect(() => {
    if (!remoteEnabled || view !== "game" || !activeRoomId || !isSpectator) return;
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
          setGame((current) =>
            current ? spectatorPreview(current, canonical, commit.revision) : current,
          );
          // This fast picture has no new turn log or clock. The room-row listener
          // still adopts the complete revision; a missed row is caught by probe.
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
  }, [remoteEnabled, view, activeRoomId, isSpectator, subscriptionEpoch]);

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
          // Whether this tab already showed the game ending. It usually did — the finishing
          // move is played here and opens the result at once — and a player who has since
          // closed the result must not have it thrown back at them when the archive lands.
          const alreadyFinished = gameRef.current ? isFinishedGame(gameRef.current) : false;
          void remoteRooms.readRoom(changedId).then((archived) => {
            if (archived) {
              applyRemotePayload(archived, { allowRollback: true });
              if (!alreadyFinished) setShowResult(true);
              return;
            }
            playSnapshotCache.forget(changedId);
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

  // Realtime is the fast path. Poll the small canonical head to detect a missed
  // commit; read the full room only when it changed. A slower full read also
  // heals session-only changes that a socket missed.
  useEffect(() => {
    if (!remoteEnabled || view !== "game" || !activeRoomId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine !== false) {
        void probeActiveRoom();
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
          if (activeRoomId) playSnapshotCache.forget(activeRoomId);
          setActiveRoomId(null);
          setGame(null);
          navigate({ kind: "home", visibility: lobbyVisibility });
          return;
        }
        if (!record) return;
        try {
          const next = remoteRooms.payloadFromRow(record);
          const adopted = applyRemotePayload(next);
          if (adopted && getRoomStage(adopted) === "playing") {
            navigate(
              {
                kind: "play",
                roomId: activeRoomId,
                returnTo: routeRef.current.kind === "room" ? routeRef.current.returnTo : undefined,
              },
              true,
            );
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
  // Keyed on the POSITION, not on the game object.
  //
  // The running clock produces a new game object every second, and this effect
  // used to fire on every one of them — validating the whole 100-tile inventory
  // and encoding the entire match to localStorage, once a second, forever.
  //
  // None of that is needed to survive a reload. The visible clock is DERIVED on
  // load from `currentTurnStartedAt` (see `advanceRunningClock`), so persisting
  // a tick tells the next load nothing the previous write did not already say:
  // anchor + elapsed gives the same number either way. What has to be written is
  // a change to the position, and that is exactly what `remoteStateKey` tracks.
  useEffect(() => {
    if (remoteEnabled) return;
    const current = gameRef.current;
    if (!current || !activeRoomId) return;
    if (hasDuplicateTileIds(current)) return;
    if (current.status === "playing" && (actionMode !== "none" || pendingPlacements.length > 0))
      return;
    roomStore.saveRoomState(activeRoomId, current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteStateKey, activeRoomId, remoteEnabled, actionMode, pendingPlacements.length]);

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
    // The clock on the human's move being ACCEPTED. This is the step that mints
    // the revision, so it is the floor under every "why did the bot take so long
    // to start" question: nothing can be asked of the engine before it finishes.
    const commitTraceKey = `commit:${activeRoomId}:${expectedRevision}`;
    engineTrace.begin(commitTraceKey, `commit r${expectedRevision}`);
    setBackgroundSyncCount((count) => count + 1);
    const inFlight = { roomId: activeRoomId, revision: expectedRevision };
    inFlightCommitRef.current = inFlight;
    const settled = () => {
      if (inFlightCommitRef.current === inFlight) inFlightCommitRef.current = null;
    };
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
        engineTrace.end(commitTraceKey, result.outcome);
        // Before anything below reads the room again: a conflict's reconcile must be allowed
        // to adopt what the server has.
        settled();
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
        // The server now holds this position. Anything gated on the position
        // being real — the bot's turn above all — is unblocked here and not one
        // moment earlier.
        setConfirmedStateKey(remoteStateKey);
        // We watched this revision come into existence, so nothing can already
        // be running for it: the bot may POST straight away instead of asking.
        selfAdmittedRevisionRef.current = result.revision;
        // Keep the render seed at the CONFIRMED revision. Without this the cache
        // holds the position with its pre-commit revision, so a later remount
        // paints a board that is a turn behind — and everything keyed on the
        // revision (which engine job is ours, whether one is stale) is briefly
        // asking about the wrong turn.
        const confirmed = gameRef.current;
        if (confirmed && confirmed.gameId === game.gameId) {
          playSnapshotCache.remember(activeRoomId, withRevision(confirmed, result.revision));
        }
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
        engineTrace.end(commitTraceKey, "failed");
        settled();
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

  // Practice telemetry only. Official survival results will require a server
  // reducer so the client cannot report its own win or see Authur's hidden rack.
  useEffect(() => {
    if (
      !remoteEnabled ||
      !userId ||
      !activeRoomId ||
      game?.status !== "finished" ||
      !game.name.startsWith("Survival test · seed ")
    )
      return;
    void recordSurvivalPracticeResult(activeRoomId, game.scores.A, game.scores.B).catch(
      (error: Error) => console.error("Survival practice result was not recorded", error),
    );
  }, [
    activeRoomId,
    game?.name,
    game?.status,
    game?.scores.A,
    game?.scores.B,
    remoteEnabled,
    userId,
  ]);

  // Supabase live draft sync: lets spectators see pending placement/exchange state.
  useEffect(() => {
    // Finalization removes room_live. A trailing empty draft would be queued
    // behind that delete and fail against a room that no longer exists.
    if (game?.status === "finished") {
      shouldFlushEmptyLiveSessionRef.current = false;
      return;
    }
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
  }, [view, remoteEnabled, activeRoomId, canPlayActiveRoom, liveSessionKey, game?.status]);

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
    const el = boardZone;
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
  }, [view, game?.gameId, boardZone]);

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

      // ── typing a rack ──────────────────────────────────────────────────────
      //
      // F2 toggles it, the way F2 has meant "edit this in place" for thirty years, and the one
      // key here that nothing else on the page claims. While it is on the rack owns the
      // keyboard: `1` then `8` is the tile 18, and `p` is the plus tile rather than whatever
      // `p` means elsewhere. Esc leaves, and so does F2.
      if (event.key === "F2") {
        if (rackTypingFocusRef.current !== null) {
          setRackTypingFocus(null);
          showKeyNotice("ออกจากโหมดพิมพ์");
        } else if (canRefillActiveRackRef.current) {
          setRackTypingFocus(0);
          showKeyNotice("โหมดพิมพ์ · 1 แล้ว 8 = 18 · Space ข้าม · ⌫ ลบ · F2 หรือ Esc ออก");
        } else {
          showKeyNotice("โหมดพิมพ์ใช้ได้ตอนเติมเบี้ยเข้ามือเท่านั้น");
        }
        consumed();
        return;
      }
      if (rackTypingFocusRef.current !== null) {
        if (event.key === "Escape") {
          setRackTypingFocus(null);
          consumed();
          return;
        }
        const outcome = handleRackTypingKey(event);
        if (outcome) consumed();
        return;
      }

      // ── the key table ──────────────────────────────────────────────────────
      //
      // `1`–`8` used to name a RACK SLOT. They now name the tile itself, and so
      // does every other key: the same table Study uses, resolved against the
      // rack. See gameplay/tileKeys.ts for the table and gameplay/rackResolution
      // for which tile in hand answers a given face.
      const keyAction = resolveStudyKey(event, blankArmedRef.current);
      if (!keyAction) return;

      if (keyAction.kind === "armBlank") {
        consumed();
        blankArmedRef.current = true;
        setBlankArmed(true);
        return;
      }
      if (keyAction.kind === "cancel") {
        consumed();
        if (blankArmedRef.current) {
          blankArmedRef.current = false;
          setBlankArmed(false);
        } else {
          cursorRef.current = null;
          setPlacementCursor(null);
        }
        return;
      }
      if (keyAction.kind === "toggleDirection") {
        consumed();
        setPlacementCursor((current) => {
          if (!current) return current;
          const cycle = ["right", "down", "left", "up"] as const;
          const next = keyAction.cycleAll
            ? cycle[(cycle.indexOf(current.dir) + 1) % cycle.length]!
            : current.dir === "right"
              ? ("down" as const)
              : ("right" as const);
          const moved = { ...current, dir: next };
          cursorRef.current = moved;
          return moved;
        });
        return;
      }
      if (keyAction.kind === "move") {
        consumed();
        setPlacementCursor((current) => {
          if (!current) return current;
          const step: Record<"right" | "down" | "left" | "up", readonly [number, number]> = {
            right: [0, 1],
            down: [1, 0],
            left: [0, -1],
            up: [-1, 0],
          };
          const [dr, dc] = step[keyAction.dir];
          const row = current.row + dr;
          const col = current.col + dc;
          if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return current;
          // Moving does not re-aim: nudging the cursor into place leaves the
          // typing direction alone.
          const moved = { row, col, dir: current.dir };
          cursorRef.current = moved;
          return moved;
        });
        return;
      }
      if (keyAction.kind === "confirmStep") {
        // Enter submits, and only when the same validation the Submit button
        // uses already passes. It is the most repeated action in a game; the
        // gate is what keeps a stray Enter from spending a turn.
        if (!submitReadyRef.current) return;
        consumed();
        confirmPlaceRef.current();
        return;
      }
      if (keyAction.kind !== "tile" && keyAction.kind !== "bareBlank") return;

      // A blank in hand has no face; a blank ON THE BOARD is playing as
      // something. `B B` is meaningful in Study and meaningless here.
      const request =
        keyAction.kind === "bareBlank" ? null : tileRequestFromStroke(keyAction.stroke);
      const clearArmed = () => {
        if (!blankArmedRef.current) return;
        blankArmedRef.current = false;
        setBlankArmed(false);
      };
      if (!request) {
        consumed();
        clearArmed();
        return;
      }

      // Replay path: keep using the simple click handler — replayDraft state
      // is locked to whatever the cursor moment was, so race isn't an issue.
      if (isReplayBefore) {
        const found = resolveRackTile(replayDraft!.rack, request);
        if (!found) return;
        consumed();
        clearArmed();
        handleRackTileClick(found.tile, game.activeSide);
        return;
      }

      // Live path — read from refs for race safety.
      const currentGame = gameRef.current;
      if (!currentGame) return;
      const currentCursor = cursorRef.current;
      const currentPendings = pendingsRef.current;
      // Manual refill: the tile the player is naming is in the BAG, not in hand.
      // Same key, same resolver, different pile — an exception here is exactly
      // what would make `5` mean two things and get mis-keyed.
      if (
        currentGame.phase === "refill" &&
        getTileDrawMode(currentGame) === "manual" &&
        actionModeRef.current === "none"
      ) {
        // No prediction here — see `resolveDrawnTile`. A draw records which
        // tile came out of the bag; substituting one would record a fiction.
        const drawn = resolveDrawnTile(currentGame.tilebag, request);
        consumed();
        clearArmed();
        if (!drawn) {
          showKeyNotice(`ไม่มีเบี้ย ${request.face} เหลือในถุง`);
          return;
        }
        refillFromBag(drawn);
        return;
      }

      const rack = getRack(currentGame, currentGame.activeSide);
      const slots = rackSlotsFrom(currentGame, currentGame.activeSide, rackLayoutRef.current);
      const found = resolveRackTile(slots, request);
      if (!found) {
        consumed();
        clearArmed();
        // Saying nothing here reads as a broken keyboard.
        showKeyNotice(`ไม่มีเบี้ยที่เล่นเป็น ${request.face} ได้ในมือ`);
        return;
      }
      const tile = found.tile;
      const rackSlot = slots.findIndex((slot) => slot?.id === tile.id);
      // The face is already known from the keystroke, so the assignment dialog
      // that a CLICK still opens never appears on this path — which is most of
      // what makes typing faster than clicking.
      const assignedToken = found.assignedToken ?? tile.assignedToken;
      clearArmed();
      if (found.via !== "exact") {
        // Spending a blank without noticing is the one way the prediction can
        // cost a player something, so it is never silent.
        showKeyNotice(
          found.via === "blank"
            ? `ใช้ Blank แทน ${request.face}`
            : `ใช้เบี้ยสองหน้าเป็น ${request.face}`,
        );
      }

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
        if (tileNeedsAssignment(tile.token) && !assignedToken) {
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
          assignedToken,
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

  // ── Branches ────────────────────────────────────────────────────────────────
  //
  // `game.logs` is always the line being played; every other line is parked beside the game
  // (see `gameplay/multiverse.ts`). They are loaded only once the game says it has some, after
  // the board is already on screen, and nothing about a move depends on them.
  useSyncExternalStore(timelineStore.subscribe, timelineStore.getVersion, timelineStore.getVersion);
  const timelineEntry = timelineStore.getTimeline(activeRoomId);
  const multiverse = timelineEntry.multiverse;
  const timelineWanted = game?.timelineRef?.version ?? 0;
  useEffect(() => {
    if (!activeRoomId || timelineWanted === 0 || !canUseTool("multiverse")) return;
    void timelineStore.ensureTimeline(
      activeRoomId,
      timelineWanted,
      timelineLoaderFor(remoteEnabled),
    );
  }, [activeRoomId, timelineWanted, remoteEnabled, playTools]);

  const gameLogs = game?.logs ?? NO_LOGS;
  const multiverseTree = useMemo(() => buildTree(gameLogs, multiverse), [gameLogs, multiverse]);
  // The line on the board: the one being played, unless a parked line is being reviewed.
  const viewLineTip =
    replayCursor !== null && viewTipId !== null && multiverseTree.nodes.has(viewTipId)
      ? viewTipId
      : null;
  const viewLogs = useMemo(
    () => (viewLineTip ? pathTo(multiverseTree, viewLineTip) : gameLogs),
    [viewLineTip, multiverseTree, gameLogs],
  );
  const viewGame = useMemo(
    () => (game && viewLogs !== game.logs ? { ...game, logs: viewLogs } : game),
    [game, viewLogs],
  );
  const forks = useMemo(
    () => (playTools.has("multiverse") ? buildForkIndex(multiverseTree, viewLogs) : NO_FORKS),
    [multiverseTree, viewLogs, playTools],
  );
  const lineView = useMemo<LineView | null>(
    () => (viewLineTip ? { forkTurn: divergence(multiverseTree, viewLogs).forkTurn } : null),
    [viewLineTip, multiverseTree, viewLogs],
  );
  const lineTotal = lineCount(multiverseTree);

  // Who may play on from another position: whoever may undo — a room's host, never a
  // spectator, and not the two players of a direct match, who share no host to agree on it.
  const branchAvailable = Boolean(
    game &&
    playTools.has("multiverse") &&
    hasGameplayHost &&
    canControlActiveGame &&
    !isFinishedGame(game),
  );
  const branchBlockedReason = !branchAvailable
    ? null
    : game?.status !== "playing"
      ? "เกมหยุดอยู่ — กด Resume ก่อนเล่นต่อจากตาอื่น"
      : actionMode !== "none" || pendingPlacements.length > 0
        ? "ยกเลิกการวางเบี้ยที่ค้างอยู่ก่อน"
        : timelineWanted > 0 && timelineEntry.status === "error"
          ? "โหลดเส้นทางที่เก็บไว้ไม่สำเร็จ — เปิด Map แล้วกดลองใหม่"
          : null;
  const branchControl = useMemo<BranchControl>(
    () => ({ available: branchAvailable, blockedReason: branchBlockedReason, busy: branchBusy }),
    [branchAvailable, branchBlockedReason, branchBusy],
  );

  const liveBoard = game?.board;
  const validation = useMemo(() => {
    if (!liveBoard) return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    // Replay practice (before-phase) validates against the log's boardBefore
    // using the draft placements. Live play validates against the live board.
    if (replayCursor !== null) {
      const idx = Math.floor(replayCursor / 2);
      const log = viewLogs[idx];
      if (replayCursor % 2 === 0 && log && replayDraft && replayDraft.placements.length > 0) {
        return validateMove(log.boardBefore, replayDraft.placements);
      }
      return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    }
    if (actionMode !== "place_equation") {
      return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    }
    return validateMove(liveBoard, pendingPlacements);
  }, [actionMode, liveBoard, pendingPlacements, replayCursor, replayDraft, viewLogs]);
  submitReadyRef.current =
    !readOnly && Boolean(game) && actionMode === "place_equation" && validation.isValid;
  confirmPlaceRef.current = confirmPlace;

  // Derived replay state from the cursor.
  const replayPhase: "before" | "after" =
    replayCursor !== null && replayCursor % 2 === 0 ? "before" : "after";
  const selectedLog = useMemo(() => {
    if (!game || replayCursor === null) return null;
    const idx = Math.floor(replayCursor / 2);
    return viewLogs[idx] ?? null;
  }, [game, replayCursor, viewLogs]);
  const selectedLogId = selectedLog?.id ?? null;
  const reviewing = Boolean(selectedLog);

  // Replay-time score / timer overrides. This hook must stay before the
  // lobby/loading return so App calls the same hooks in every render.
  const replayOverrides = useMemo(() => {
    if (!game || !selectedLog) return null;
    const logIdx = viewLogs.findIndex((log) => log.id === selectedLog.id);
    if (logIdx < 0) return null;
    // "before" phase: state right after refill, BEFORE the action.
    // Equivalent to the AFTER state of the previous log (or initial if none).
    // "after" phase: state right after the action (this log's after).
    const useThis = replayPhase === "after";
    const ref = useThis ? selectedLog : (viewLogs[logIdx - 1] ?? null);
    // Sum finalScore per side over all logs whose state is "included" at this point.
    const upTo = useThis ? logIdx : logIdx - 1;
    const scores: Record<Side, number> = { A: 0, B: 0 };
    for (let i = 0; i <= upTo; i += 1) {
      const entry = viewLogs[i];
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
  }, [game, selectedLog, replayPhase, viewLogs]);

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
    const log = viewLogs[idx];
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
    // Length and line, not the array: a note or a star replaces `logs` without changing any
    // position, and must not wipe a practice move laid out on the board.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayCursor, game?.gameId, viewLogs.length, viewLineTip]);

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
  // The progress bar is a projection of `engineSessions`, which lives outside
  // this component. Leaving Play and coming back does not interrupt the
  // observation, so there is nothing to restore and no window in which the
  // percentage is unknown.
  const sessionVersion = useSyncExternalStore(
    engineSessions.subscribe,
    engineSessions.getVersion,
    engineSessions.getVersion,
  );
  const botSession =
    activeRoomId && game ? engineSessions.botFor(activeRoomId, game.revision ?? 0) : undefined;
  const botStatus =
    botSession && botSession.status.kind !== "completed" && botSession.status.kind !== "failed"
      ? botSession.status
      : null;
  // Read here rather than inside the launcher because the RUNNING bar is drawn
  // in the action slot now, and the shell is what owns that slot. Both this and
  // the launcher read the same store row, so there is nothing to keep in sync.
  const analysisSession =
    activeRoomId && game ? engineSessions.analysisFor(activeRoomId, game.revision ?? 0) : undefined;
  const analysisRunning = Boolean(
    analysisSession &&
    analysisSession.status.kind !== "completed" &&
    analysisSession.status.kind !== "failed",
  );
  /** A line explaining an engine problem the player can otherwise only observe
   *  as the bot not moving. Cleared as soon as the bot moves. */
  const [botNotice, setBotNotice] = useState<string | null>(null);
  /**
   * Consecutive engine failures on the CURRENT bot turn.
   *
   * The retry loop below never gives up — a pass is irreversible and no amount
   * of server trouble is evidence that passing is right — and until now the way
   * out of a wedged bot turn was that the room owner could simply play the move
   * themselves. That is gone: the human no longer acts on the bot's turn. So the
   * escape hatch has to be explicit, and this is what opens it.
   *
   * A desync does NOT count. It resolves itself the moment sync delivers the
   * real revision, so counting it would put an emergency button in front of a
   * player whose connection merely hiccuped.
   */
  const [botFailures, setBotFailures] = useState(0);
  /**
   * The revision on which the player took the bot's turn over by hand.
   *
   * Set only by pressing the escape button, and it STOPS the retry loop rather
   * than racing it: a bot search that finally succeeded while the player was
   * halfway through choosing an exchange would be two moves for one turn, which
   * is the one thing every revision guard in this file exists to prevent.
   */
  const [botManualRevision, setBotManualRevision] = useState<number | null>(null);
  // Reasoning behind the bot's most recent move, kept so the player can open a
  // full "why this move" breakdown (chosen move + every alternative weighed).
  const [botReasoning, setBotReasoning] = useState<{
    logId: string;
    turnNumber: number;
    playerName: string;
    response: BotResponse;
  } | null>(null);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  /**
   * Whether this client's view of the room is settled enough to act on.
   *
   * `activeRoomMeta` supplies ownership, and on the Play route it arrives one
   * round trip after the board does — the snapshot cache paints instantly, the
   * metadata does not. Until it lands, `isOwner` is false, so every
   * capability-derived flag reads as "spectator".
   *
   * That is an ABSENCE OF INFORMATION, and treating it as an answer is what
   * erased a running bot search on every return to Play: the teardown below saw
   * `botShouldMove === false`, concluded the bot's turn was over, and deleted
   * the progress the player came back to look at.
   *
   * So: "not known yet" is its own state. Nothing destructive runs until the
   * room row has actually been read, whatever it then says.
   */
  const roomFactsResolved =
    !remoteEnabled || hasAdminAccess || activeRoomMeta !== null || roomMetaReadRef.current;
  const botShouldMove = Boolean(
    game &&
    game.botSide &&
    // The engine reads the position out of Postgres for itself, so it can only
    // play a room that exists there. Without a live room id there is nothing to
    // ask about.
    remoteEnabled &&
    activeRoomId &&
    game.status === "playing" &&
    getRoomStage(game) === "playing" &&
    game.activeSide === game.botSide &&
    game.phase === "choose_action" &&
    !reviewing &&
    roomFactsResolved &&
    canControlActiveGame &&
    !readOnly &&
    // Handed to the player after three failures; asking again behind their back
    // is how the same turn gets played twice.
    botManualRevision !== (game.revision ?? 0) &&
    // The whole correctness fix. A local move is not a move the server has
    // accepted: until the commit is acknowledged, `game.revision` still names
    // the position BEFORE the human played, and asking the engine about it gets
    // either "not your turn" or "stale" — one of which used to cost the bot its
    // turn. Wait for the revision that actually contains the human's move.
    positionIsConfirmed,
  );
  useEffect(() => {
    if (game?.botSide) warmUpBotEngine();
  }, [game?.gameId, game?.botSide]);

  // ── Is this room's Super bot allowed to think on this device? ──────────────
  //
  // Decided once per room rather than per turn, and BEFORE the first turn, so
  // that the ~250 KB engine chunk downloads and the WASM module instantiates
  // while the player is still looking at the board. The alternative — deciding
  // on the first bot turn — spends the download and the instantiation inside
  // the move the player is already waiting for.
  //
  // `null` means "not decided yet", which is not the same as "no": a turn that
  // arrives before readiness settles takes the backend path, which is correct
  // and merely slower.
  const [clientSuper, setClientSuper] = useState<ClientSuperReadiness | null>(null);
  useEffect(() => {
    setClientSuper(null);
    if (
      !game?.botSide ||
      game.botEngine === "authur" ||
      game.botDifficulty !== "super" ||
      !isEngineApiConfigured
    )
      return;
    let alive = true;
    // Read through the ref rather than from the render's `game`, so this effect
    // does not have to depend on the pin. It must not: the pin is WRITTEN by
    // the first local move, so depending on it would tear the engine down and
    // re-resolve readiness immediately after every game's first Super turn —
    // for a value this very config supplied.
    const current = gameRef.current;
    const pin = {
      ...(current?.superEngineVersion ? { engineVersion: current.superEngineVersion } : {}),
      ...(current?.superWeightsVersion ? { weightsVersion: current.superWeightsVersion } : {}),
    };
    void clientSuperReadiness(pin).then((readiness) => {
      if (!alive) return;
      setClientSuper(readiness);
      // Instantiate now rather than on the first turn. Costs nothing when the
      // module is already warm, and removes a one-off from the first move.
      if (readiness.available) {
        initializeSuperEngine();
        // The beta's data-collection path. See the function's own comment for
        // why this is a console handle and not a screen.
        installTelemetryHandle();
      }
    });
    return () => {
      alive = false;
      // Leaving a Super room stops whatever the device was computing for it.
      // Nothing else can: the search is a synchronous call inside a worker and
      // only terminating the worker ends it.
      cancelSuperEngine();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.gameId, game?.botSide, game?.botEngine, game?.botDifficulty]);
  // Ask the server what is already running for this position, as soon as the
  // position is one the server agrees exists.
  //
  // Deliberately at the shell level rather than inside a panel: whether a bot
  // search can be rediscovered must not depend on which components happen to be
  // rendered. `discover` shares one round trip between callers and never
  // disturbs an observation already under way.
  useEffect(() => {
    if (!remoteEnabled || !activeRoomId) return;
    // A finished game has no live row — finalizing moves it into the archive — so the engine
    // cannot find it and answers 404, and nothing can be running for it: there is no one left
    // on move. Neither rejoin old work nor ask about new work.
    const finished = game ? isFinishedGame(game) : false;
    // Deliberately ahead of the confirmation guard below. Rejoining work this tab
    // was ALREADY watching is read out of storage: it needs no revision and no
    // room row, so making it wait for one leaves the bar blank through the very
    // round trip it exists to cover. The bot's bar felt this worst — its only
    // discovery call is this one, so a refresh mid-search showed nothing at all
    // until the room row came back.
    if (!finished) engineSessions.adoptHints(activeRoomId);
    engineDebug.note("shell_effect", {
      positionIsConfirmed,
      gameRevision: game?.revision ?? null,
      subscriptionEpoch,
    });
    if (!positionIsConfirmed || !game) return;
    const revision = game.revision ?? 0;
    // Retiring work is gated on the revision being CONFIRMED, and lives here
    // rather than in the panels for one reason: a component is handed a
    // revision, and on a snapshot-seeded mount that number can briefly be a turn
    // behind the server. Dropping a session from an unconfirmed revision killed
    // live searches on return — permanently, because correcting the revision a
    // moment later cannot resurrect an observation that has been thrown away.
    //
    // Dropped, never cancelled: another observer may still want the answer.
    engineSessions.dropStale(activeRoomId, revision);
    if (finished) return;
    void engineSessions.discover({
      roomId: activeRoomId,
      revision,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    remoteEnabled,
    activeRoomId,
    positionIsConfirmed,
    game?.revision,
    game?.status,
    subscriptionEpoch,
  ]);

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
    playTools.has("analysis") &&
    isEngineApiConfigured &&
    remoteEnabled &&
    game.status === "playing" &&
    getRoomStage(game) === "playing" &&
    !reviewing,
  );
  const canAnalyzeTurn = Boolean(
    analysisAvailable && game && !analysisTurnIsBot && canActActiveSide && game.phase !== "refill",
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
  // ── Driving the bot's turn ─────────────────────────────────────────────────
  //
  // What this effect does NOT do is as important as what it does. It does not
  // own the search (`engineSessions` observes it, the server owns it), it does
  // not own the progress (the session holds it), and it cannot end the turn by
  // giving it away. Its whole job is: make sure a session exists for this
  // confirmed position, and apply the answer when it arrives.
  useEffect(() => {
    if (!botShouldMove || !game || !activeRoomId) return;
    const revision = game.revision ?? 0;
    const roomId = activeRoomId;

    let alive = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const attempt = (tries: number) => {
      if (!alive) return;
      const current = gameRef.current;
      if (!current || (current.revision ?? 0) !== revision) return;
      setBotNotice(null);
      engineTrace.begin(`apply:${roomId}:${revision}`, `bot apply r${revision}`);

      // `freshlyAdmitted` on the first attempt: this position was confirmed by
      // the server moments ago, so no earlier job for this exact revision can
      // exist and the discovery round trip would be a guaranteed `idle`. A retry
      // makes no such claim — by then a job may well exist, including one this
      // tab started before the connection dropped.
      void engineSessions
        .observeBot({
          roomId,
          revision,
          freshlyAdmitted: tries === 0 && selfAdmittedRevisionRef.current === revision,
          // The device computes this turn when the room is a Super room and
          // this device measured fast enough. The position is read HERE, once,
          // from the same ref the revision check above used — so the engine is
          // asked about exactly the position this attempt is for, and a later
          // render cannot change the question mid-search.
          ...(current.botEngine !== "authur" &&
          clientSuper?.available &&
          current.botDifficulty === "super"
            ? {
                local: {
                  game: current,
                  pin: {
                    ...(current.superEngineVersion
                      ? { engineVersion: current.superEngineVersion }
                      : {}),
                    ...(current.superWeightsVersion
                      ? { weightsVersion: current.superWeightsVersion }
                      : {}),
                  },
                },
              }
            : {}),
        })
        .then((session) => {
          if (!alive) return;
          if (session.status.kind === "completed" && session.result) {
            setBotNotice(null);
            const outcome = applyBotResult(
              toBotResponse(session.result as BotMoveResult),
              revision,
            );
            if (outcome === "applied") {
              engineTrace.end(`apply:${roomId}:${revision}`, "applied");
              return;
            }
            if (outcome === "stale") {
              engineTrace.end(`apply:${roomId}:${revision}`, "stale");
              return;
            }
            // A legal-looking answer can still fail the final rack/board map.
            // A completed session caches that answer, so it must be dropped
            // before a retry or every attempt would replay the same failure.
            engineSessions.drop(session.key);
            setBotFailures((count) => count + 1);
            const error = new EngineApiError("engine_failed", "Bot move could not be applied");
            retryTimer = setTimeout(() => attempt(tries + 1), botRetryDelay(error, tries));
            engineTrace.end(`apply:${roomId}:${revision}`, "rejected");
            return;
          }
          if (session.status.kind !== "failed") return;

          const error = new EngineApiError(session.status.code, session.status.message);
          // The session settled unhappily. Forget it so the next attempt opens a
          // clean observation rather than reading this one's corpse.
          engineSessions.drop(session.key);

          if (isDesyncBotFailure(error)) {
            // Not counted. See `botFailures`: this one fixes itself.
            // The server and this client disagree about the position. Asking
            // again with the same numbers cannot help; wait for sync to deliver
            // the real revision, which re-runs this effect.
            setBotNotice("กระดานบนเซิร์ฟเวอร์เปลี่ยนไปแล้ว — กำลังรอข้อมูลล่าสุด");
            return;
          }
          setBotFailures((count) => count + 1);
          if (!isRetryableBotFailure(error)) return;

          // NOTHING here ends the turn. A pass is a scoring, irreversible move,
          // and no amount of server trouble is evidence that passing is the
          // right one — so the bot keeps asking, tells the player why, and waits
          // for a human or the network to resolve it. The delay grows and then
          // holds; it never gives up, because giving up meant giving the turn
          // away.
          setBotNotice(botNoticeFor(error));
          retryTimer = setTimeout(() => attempt(tries + 1), botRetryDelay(error, tries));
        });
    };

    setBotFailures(0);
    attempt(0);

    return () => {
      alive = false;
      if (retryTimer) clearTimeout(retryTimer);
      // Deliberately does not touch the session. Unmounting this component, or
      // navigating away from Play, stops nothing: the observation outlives the
      // tree, which is the only reason returning shows the real percentage.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botShouldMove, activeRoomId, game?.revision, clientSuper?.available]);

  // Set the selection from a log id (called by TurnRecordList / LogPanel).
  // Selecting a log opens the "action applied" view of that log.
  function selectLog(logId: string | null) {
    if (logId === null || !game) {
      setReplayCursor(null);
      return;
    }
    if (!canUseTool("replay")) return;
    const idx = viewLogs.findIndex((log) => log.id === logId);
    if (idx >= 0) {
      setReplayCursor(idx * 2 + 1);
      return;
    }
    if (multiverseTree.nodes.has(logId)) {
      viewTurn(logId, "after");
      return;
    }
    setReplayCursor(null);
  }

  // ── Moving through the lines ─────────────────────────────────────────────────

  /**
   * Show a turn on the board, on whichever line it belongs to: the line being played, or a parked
   * one — which the log then lists instead, end to end, so it can be stepped through like any
   * other. `null` is the start of the game.
   */
  function viewTurn(nodeId: string | null, phase: "before" | "after" = "after") {
    if (!game || !canUseTool("replay")) return;
    if (nodeId === null) {
      setViewTipId(null);
      setReplayCursor(game.logs.length > 0 ? 0 : null);
      return;
    }
    const node = multiverseTree.nodes.get(nodeId);
    if (!node) return;
    const onLiveLine = node.lineId === null;
    const tip = onLiveLine ? null : lineTipOf(multiverseTree, nodeId);
    const line = tip ? pathTo(multiverseTree, tip) : game.logs;
    const index = line.findIndex((log) => log.id === nodeId);
    if (index < 0) return;
    setViewTipId(tip);
    setReplayCursor(index * 2 + (phase === "after" ? 1 : 0));
  }

  /** The log's navigator: whole turns along the line on the board, and back to live. */
  function stepTurn(step: TurnStep) {
    if (!game) return;
    if (step === "live") {
      setViewTipId(null);
      setReplayCursor(null);
      return;
    }
    const total = viewLogs.length;
    if (total === 0) return;
    const current = replayCursor === null ? total : Math.floor(replayCursor / 2);
    const next =
      step === "first"
        ? 0
        : step === "last"
          ? total - 1
          : step === "prev"
            ? Math.max(0, current - 1)
            : current + 1;
    if (next >= total) {
      // Past the last turn of the line being played is the live position itself.
      if (!viewLineTip) setReplayCursor(null);
      return;
    }
    setReplayCursor(next * 2 + 1);
  }

  function setReplayPhase(phase: "before" | "after") {
    if (replayCursor === null) return;
    setReplayCursor(Math.floor(replayCursor / 2) * 2 + (phase === "after" ? 1 : 0));
  }

  /** "Continue from here" in the log: from exactly what the board is showing. */
  function continueFromView() {
    if (!selectedLog) return;
    void continueFromTarget({ nodeId: selectedLog.id, phase: replayPhase });
  }

  function viewFromMap(nodeId: string | null) {
    setMapRoomId(null);
    viewTurn(nodeId, "after");
  }

  function continueFromMap(target: ContinueTarget) {
    void continueFromTarget(target).then((moved) => {
      if (moved) setMapRoomId(null);
    });
  }

  function retryTimeline() {
    if (!activeRoomId) return;
    void timelineStore.ensureTimeline(
      activeRoomId,
      Math.max(timelineWanted, 1),
      timelineLoaderFor(remoteEnabled),
      { force: true },
    );
  }

  /** Make `target` the live position, parking whatever stops being live. */
  async function continueFromTarget(target: ContinueTarget): Promise<boolean> {
    const current = gameRef.current;
    const roomId = activeRoomIdRef.current;
    if (!current || !roomId || branchBusyRef.current || !branchAvailable) return false;
    if (branchBlockedReason) {
      showKeyNotice(branchBlockedReason);
      return false;
    }
    // Whatever is parked must be known before anything is parked beside it.
    const wanted = current.timelineRef?.version ?? 0;
    let entry = timelineStore.getTimeline(roomId);
    if (wanted > 0 && (entry.status !== "ready" || entry.multiverse.version < wanted)) {
      await timelineStore.ensureTimeline(roomId, wanted, timelineLoaderFor(remoteEnabled), {
        force: true,
      });
      entry = timelineStore.getTimeline(roomId);
      if (entry.status !== "ready" || entry.multiverse.version < wanted) {
        setSyncError(entry.error ?? "โหลดเส้นทางที่เก็บไว้ไม่สำเร็จ");
        return false;
      }
    }
    // Loading may have taken a moment; plan from the position as it is now, not as it was.
    const latest = gameRef.current;
    if (!latest || latest.gameId !== current.gameId) return false;
    const result = continueFrom(latest, entry.multiverse, target);
    if (!result.ok) {
      showKeyNotice(result.reason);
      return false;
    }
    if (!result.changed) {
      setViewTipId(null);
      setReplayCursor(null);
      return true;
    }
    return applyTimelineChange(roomId, latest, result.game, entry.multiverse, result.multiverse);
  }

  /**
   * Land a new live position together with the parked lines it was built with.
   *
   * Shown at once, like every move; written as ONE conditional commit, so the server either takes
   * both or neither. If anything moved first the change is dropped and the authority's state
   * adopted — the player tries again from what is really there.
   */
  async function applyTimelineChange(
    roomId: string,
    base: GameState,
    next: GameState,
    previous: Multiverse,
    parked: Multiverse,
  ): Promise<boolean> {
    // A different position now: leave the replay, any draft, and an undo history that belongs
    // to the line just parked.
    cancelDraftOnly();
    setViewTipId(null);
    setReplayCursor(null);
    setShowResult(false);
    resetUndoHistory();
    const nextKey = makeRemoteStateKey(next);
    // The ordinary sync effect must not write this position on its own: it goes out with its
    // lines, below, or not at all.
    lastAppliedStateKeyRef.current = nextKey;
    pendingSessionEventRef.current = null;
    setGame(next);
    timelineStore.adoptTimeline(roomId, parked);
    if (!remoteEnabled) {
      // The position and its lines on disk together, now: a tab closed in between must not keep
      // lines that park turns its saved game still plays.
      roomStore.writeTimelineDoc(roomId, encodeMultiverse(parked));
      roomStore.saveRoomState(roomId, next);
      roomStore.flushRoomWrites();
      return true;
    }

    setBranchBusy(true);
    setBackgroundSyncCount((count) => count + 1);
    try {
      const result = await remoteRooms.commitTimelineChange({
        id: roomId,
        game: next,
        session: liveSession,
        event: "timeline",
        expectedRevision: revisionOf(base),
        commandId: crypto.randomUUID(),
        issuedBy: invitedSides.length === 1 ? invitedSides[0] : "host",
        timeline: encodeMultiverse(parked),
        expectedTimelineVersion: previous.version,
      });
      if (result.outcome === "committed" || result.outcome === "duplicate") {
        setGame((current) =>
          current && current.gameId === next.gameId && revisionOf(current) < result.revision
            ? withRevision(current, result.revision)
            : current,
        );
        setConfirmedStateKey(nextKey);
        selfAdmittedRevisionRef.current = result.revision;
        playSnapshotCache.remember(roomId, withRevision(next, result.revision));
        timelineStore.adoptTimeline(roomId, { ...parked, version: result.timelineVersion });
        setSyncError(null);
        return true;
      }
      showKeyNotice(
        result.outcome === "timeline_conflict"
          ? "เส้นทางถูกเปลี่ยนจากอีกเครื่อง — ลองอีกครั้ง"
          : "เกมเดินต่อไปแล้วจากอีกเครื่อง — ลองอีกครั้ง",
      );
      await rollBackTimelineChange(roomId, previous);
      return false;
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "แตกกิ่งไม่สำเร็จ");
      await rollBackTimelineChange(roomId, previous);
      return false;
    } finally {
      setBranchBusy(false);
      setBackgroundSyncCount((count) => Math.max(0, count - 1));
    }
  }

  /** Nothing was written: put back the lines this tab showed, then take the authority's. */
  async function rollBackTimelineChange(roomId: string, previous: Multiverse) {
    timelineStore.adoptTimeline(roomId, previous);
    lastAppliedStateKeyRef.current = "";
    try {
      const authoritative = await remoteRooms.readRoom(roomId);
      if (authoritative) applyRemotePayload(authoritative, { allowRollback: true });
    } catch {
      // The write error already on screen is the one worth reading.
    }
    await timelineStore.ensureTimeline(
      roomId,
      Math.max(previous.version, 1),
      timelineLoaderFor(remoteEnabled),
      { force: true },
    );
  }

  /** Forget a parked line (and what continues from it). Never moves the live position. */
  async function pruneTimelineLine(lineId: string) {
    const roomId = activeRoomIdRef.current;
    if (!roomId || !branchAvailable || branchBusyRef.current) return;
    const entry = timelineStore.getTimeline(roomId);
    if (entry.status !== "ready") return;
    const previous = entry.multiverse;
    const pruned = pruneLine(previous, lineId);
    timelineStore.adoptTimeline(roomId, pruned);
    if (!remoteEnabled) {
      roomStore.writeTimelineDoc(roomId, encodeMultiverse(pruned));
      return;
    }
    setBranchBusy(true);
    try {
      const result = await remoteRooms.pruneTimeline(
        roomId,
        encodeMultiverse(pruned),
        previous.version,
      );
      if (result.outcome === "committed") {
        timelineStore.adoptTimeline(roomId, { ...pruned, version: result.timelineVersion });
        return;
      }
      timelineStore.adoptTimeline(roomId, previous);
      showKeyNotice("เส้นทางถูกเปลี่ยนจากอีกเครื่อง — ลองอีกครั้ง");
      await timelineStore.ensureTimeline(
        roomId,
        result.timelineVersion,
        timelineLoaderFor(remoteEnabled),
        {
          force: true,
        },
      );
    } catch (error) {
      timelineStore.adoptTimeline(roomId, previous);
      setSyncError(error instanceof Error ? error.message : "ลบเส้นทางไม่สำเร็จ");
    } finally {
      setBranchBusy(false);
    }
  }

  /**
   * The parked continuation of the live position that is the same move as `log`, if any.
   *
   * Replaying a line walks back into it instead of copying it: the map keeps one branch per idea,
   * however many times the idea is played.
   */
  function findParkedTwin(log: TurnLog): string | null {
    if (!game || !branchAvailable || branchBusyRef.current) return null;
    if (timelineEntry.status !== "ready" || multiverse.version < timelineWanted) return null;
    if (multiverse.lines.length === 0) return null;
    return equivalentParkedChild(multiverseTree, game.logs.at(-1)?.id ?? null, log);
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
          onCreateRanked={async (minutes) => {
            const { match } = await rankedClient.create(minutes, minutes);
            navigate({ kind: "ranked", matchId: match.id });
          }}
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

  if (survivalRoute && !game && survivalError) {
    return (
      <div className="eq-alert eq-alert-error" role="alert" style={{ margin: 24 }}>
        <p>เปิดด่าน Survival ไม่ได้: {survivalError}</p>
        <button
          type="button"
          className="eq-button eq-button-primary"
          onClick={() => setSurvivalRetry((count) => count + 1)}
        >
          ลองอีกครั้ง
        </button>{" "}
        <button type="button" className="eq-button" onClick={() => navigate({ kind: "survival" })}>
          กลับหน้า Survival
        </button>
      </div>
    );
  }

  if (studyPuzzleRoute && !game && studyPuzzleError) {
    return (
      <div className="eq-alert eq-alert-error" role="alert" style={{ margin: 24 }}>
        <p>เปิดโจทย์ไม่ได้: {studyPuzzleError}</p>
        <button
          type="button"
          className="eq-button eq-button-primary"
          onClick={() => setStudyPuzzleRetry((count) => count + 1)}
        >
          ลองอีกครั้ง
        </button>{" "}
        <button
          type="button"
          className="eq-button"
          onClick={() => navigate({ kind: "admin", section: "study" })}
        >
          กลับหน้าโจทย์ Study
        </button>
      </div>
    );
  }

  if (view !== "game" || !game) {
    return (
      <LoadingScreen
        message={
          foregroundLoading ??
          (survivalRoute
            ? "Opening Survival level..."
            : studyPuzzleRoute
              ? "Opening puzzle..."
              : "Opening room...")
        }
      />
    );
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
      adoptArchivedTimeline(id, remotePayload);
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
    if (
      newSettings.botSide &&
      (newSettings.botEngine ?? "authur") === "authur" &&
      (!remoteEnabled || !isEngineApiConfigured)
    ) {
      setSyncError("Authur ต้องใช้เซิร์ฟเวอร์เกมที่เชื่อมต่ออยู่");
      return;
    }
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
    let admitted = next;
    if (remoteEnabled) {
      const result = await remoteRooms.commitRoomState({
        id: activeRoomId,
        game: next,
        session: remoteRooms.emptyLiveSession(userId),
        event: "state",
      });
      if (result.outcome === "conflict") {
        const authoritative = await remoteRooms.readRoom(activeRoomId);
        if (authoritative) applyRemotePayload(authoritative, { allowRollback: true });
        throw new Error("This room changed. Review its latest state and try again.");
      }
      admitted = withRevision(next, result.revision);
      lastAppliedStateKeyRef.current = makeRemoteStateKey(next);
      setConfirmedStateKey(lastAppliedStateKeyRef.current);
      selfAdmittedRevisionRef.current = result.revision;
      playSnapshotCache.remember(activeRoomId, admitted);
    } else {
      setRooms(roomStore.writeRoom(activeRoomId, next));
    }
    setGame(admitted);
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
    if (survivalRef.current || survivalRoute) {
      navigate({ kind: "survival" });
      return;
    }
    if (studyPuzzleRef.current || studyPuzzleRoute) {
      navigate({ kind: "admin", section: "study" });
      return;
    }
    const destination =
      route.kind === "play"
        ? (route.returnTo ?? {
            kind: "home" as const,
            visibility: lobbyVisibility,
            section: "live" as const,
          })
        : { kind: "home" as const, visibility: lobbyVisibility, section: "live" as const };
    if (destination.kind === "private") {
      navigate(destination);
      return;
    }
    if (remoteEnabled) {
      // Keep the already-rendered lobby list in place while refreshing it.
      // Replacing the whole list with a loading state on every exit makes
      // navigation feel like a reload even though usable data is available.
      if (rooms.length === 0) setRoomsLoading(true);
      const scope = makeRoomScope(destination.visibility, regionId);
      if (!scope) {
        setRooms([]);
        setRoomsLoading(false);
        navigate(destination);
        return;
      }
      void remoteRooms
        .listRooms(scope)
        .then(setRooms)
        .catch((error: Error) => setSyncError(error.message))
        .finally(() => setRoomsLoading(false));
    } else {
      const scope = makeRoomScope(destination.visibility, regionId);
      setRooms(scope ? roomStore.listRooms(scope) : []);
    }
    navigate(destination);
  }

  function rememberCoffeeRoom(roomId: string | null) {
    setCoffeeRoomId(roomId);
    if (roomId) window.localStorage.setItem(STORAGE_KEYS.coffeeRoom, roomId);
    else window.localStorage.removeItem(STORAGE_KEYS.coffeeRoom);
  }

  async function takeCoffeeBreak() {
    // A Survival attempt is held by its server, not by a room: stepping away leaves it as it is.
    // So is a Study puzzle.
    if (survivalRef.current || studyPuzzleRef.current) {
      goToLobby();
      return;
    }
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
        lastFullReconcileRef.current = { roomId: id, at: Date.now() };
        const reconciledGame = applyRemotePayload(payload);
        if (reconciledGame) {
          applyIncomingRemoteSession(payload.session, reconciledGame);
        }
        const stage = getRoomStage(payload.game);
        const currentRoute = routeRef.current;
        if (currentRoute.kind === "room" && currentRoute.roomId === id && stage === "playing") {
          navigate({ kind: "play", roomId: id, returnTo: currentRoute.returnTo }, true);
        } else if (
          currentRoute.kind === "play" &&
          currentRoute.roomId === id &&
          stage === "waiting"
        ) {
          navigate({ kind: "room", roomId: id, returnTo: currentRoute.returnTo }, true);
        }
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to refresh this room.");
    } finally {
      reconcilingRef.current = false;
    }
  }

  async function probeActiveRoom() {
    const id = activeRoomIdRef.current;
    if (!remoteEnabled || !id || reconcilingRef.current) return;
    const last = lastFullReconcileRef.current;
    if (!last || last.roomId !== id || Date.now() - last.at >= 30_000) {
      await reconcileActiveRoom();
      return;
    }
    try {
      const head = await remoteRooms.readGameSnapshot(id);
      if (activeRoomIdRef.current !== id) return;
      if (!head || !gameRef.current || head.revision > revisionOf(gameRef.current)) {
        await reconcileActiveRoom();
      }
    } catch {
      await reconcileActiveRoom();
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
    adoptArchivedTimeline(payload.meta.id, payload);
    const key = makeRemoteStateKey(remoteGame);
    // Whatever this payload turns out to say about the board, the room row has
    // now been read — ownership is known rather than merely absent.
    roomMetaReadRef.current = true;
    setLobbyVisibility(payload.meta.visibility ?? "public");
    setRooms((current) => upsertRoomMeta(current, payload.meta));
    const localGame = gameRef.current;
    const sameGame = Boolean(localGame && localGame.gameId === remoteGame.gameId);

    const inFlight = inFlightCommitRef.current;
    if (
      !options.allowRollback &&
      localGame &&
      sameGame &&
      inFlight &&
      inFlight.roomId === payload.meta.id &&
      revisionOf(remoteGame) <= inFlight.revision
    ) {
      // This tab has written a change on top of this revision and the server has not answered
      // yet. The payload is the position BEFORE that change; adopting it would put the board
      // back a move (at the end of a game: un-finish it) until the answer arrives. The answer
      // settles it either way — confirmed, or a conflict that reads the room again.
      return null;
    }
    if (!options.allowRollback && localGame && isRemoteGameStale(localGame, remoteGame)) {
      // A lower revision carries nothing this client has not already applied.
      // Delayed delivery, duplicate delivery and a slow read racing a fast one
      // all land here, and none of them can undo a committed turn.
      //
      // Deliberately does NOT touch `confirmedStateKey`: this payload describes
      // an OLDER position, and letting it overwrite the confirmation of a newer
      // one would un-confirm a position the server has already accepted and
      // stall the bot until the next read.
      setSyncError(null);
      return null;
    }

    // Past the staleness gate, this content is the authority's and is at least
    // as new as ours. Confirming it here — rather than in each branch below —
    // keeps "the server holds this position" independent of whether this client
    // happens to be rendering it (it may be composing a draft on top).
    setConfirmedStateKey(key);

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
      if (activeRoomIdRef.current) playSnapshotCache.remember(activeRoomIdRef.current, remoteGame);
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
      const wasFinished = localGame ? isFinishedGame(localGame) : false;
      lastAppliedStateKeyRef.current = key;
      setGame(remoteGame);
      cancelDraftOnly();
      // Only on the way INTO the finished state: a finished game read again is not news.
      if (isFinishedGame(remoteGame) && !wasFinished) setShowResult(true);
      applyDeferredRemoteSession(remoteGame);
    }
    setSyncError(null);
    if (activeRoomIdRef.current) playSnapshotCache.remember(activeRoomIdRef.current, remoteGame);
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

  /**
   * The bot's turn is the bot's.
   *
   * The room owner used to be able to place, exchange or pass ON THE BOT'S
   * BEHALF — the capability model grants `canAct` to the owner and never asked
   * whose turn it was. That is now closed at the UI layer, deliberately rather
   * than in `getRoomActorCapabilities`: `canAct` also feeds `canInteract` and
   * therefore `readOnly`, and a `readOnly` bot turn would disable the very
   * commit path the bot uses to play its own move.
   *
   * `botManualRevision` is the one way through, and only after the engine has
   * failed three times on this turn.
   */
  // Only while the game is being played. A game-ending move is never handed over — a finished
  // game has nobody to hand it to — so after the BOT ends a game it is still `activeSide`, and
  // without this the board sat on "thinking" over a game that was already over. A paused game
  // has nobody thinking either.
  const botTurn = Boolean(
    game.botSide && game.activeSide === game.botSide && game.status === "playing" && !reviewing,
  );
  const botTurnLocked = botTurn && botManualRevision !== (game.revision ?? 0);

  const canChooseAction =
    canActActiveSide &&
    !botTurnLocked &&
    game.status === "playing" &&
    !reviewing &&
    actionMode === "none" &&
    (game.phase === "choose_action" || isRackReady(game));
  const exchangeRule = getExchangeRule(game);
  const canStartExchange = canChooseAction && exchangeRule.allowed && !studyPuzzle;
  const refillBaseline = refillBaselineRef.current;
  /**
   * The top analysis level, run here rather than on the service.
   *
   * Offered only when the device could run a Super search — it is the same
   * engine, so the answer is the same answer — and only on a turn a human is
   * actually taking. The position is read INSIDE the callback, at the moment the
   * player presses the level, so the search is about the board they are looking
   * at rather than the one that happened to be current a render earlier.
   */
  const localAnalysisReady = Boolean(clientSuper?.available && canAnalyzeTurn);
  const localAnalysisHint =
    localAnalysisReady && clientSuper?.calibration
      ? {
          estimatedMs: clientSuper.calibration.estimatedMoveMs.p50,
          threads: planSuperThreads(readThreadEnvironment()).threads,
        }
      : null;
  // A plain function, not a `useCallback`: everything from here down runs after
  // the shell's early returns, so this region must not call hooks.
  const makeLocalAnalysis = (): LocalAnalysisContext | null => {
    const current = gameRef.current;
    if (!current || !localAnalysisReady) return null;
    // Never the bot's rack. `canAnalyzeTurn` already refuses the bot's turn;
    // this is the second reading of the same rule, at the point the position is
    // actually handed over.
    if (current.botSide && current.activeSide === current.botSide) return null;
    return {
      game: current,
      side: current.activeSide,
      turnNumber: current.turnNumber,
      pin: {
        ...(current.superEngineVersion ? { engineVersion: current.superEngineVersion } : {}),
        ...(current.superWeightsVersion ? { weightsVersion: current.superWeightsVersion } : {}),
      },
    };
  };

  const botName = game.botSide
    ? game.players[game.botSide] || (game.botEngine === "authur" ? "Authur" : "Aether")
    : "Aether";
  /** Hand the turn back: the loop restarts, and any half-built draft the player
   *  had started on the bot's behalf is dropped so two moves cannot collide. */
  const returnTurnToBot = () => {
    if (actionMode !== "none") cancelAction();
    setBotManualRevision(null);
    setBotFailures(0);
  };
  /**
   * What occupies the action slot instead of Exchange and Pass.
   *
   * One decision, rendered twice — the desktop panel and the mobile dock ask for
   * the same thing in their own shape. The order is the order of urgency: a
   * wedged turn needs its way out before anything else, the bot's own turn
   * outranks an analysis (they cannot both be live), and an ordinary turn gets
   * the buttons back by returning nothing.
   */
  const engineActivityFor = (variant: "panel" | "mobile"): ReactNode => {
    // A rack that still needs tiles outranks everything: nothing is thinking
    // yet, and in a legacy manual-draw bot room the human drawing for the bot is
    // the only thing that can move the turn on. That carve-out is the reason the
    // draw itself is not blocked with the rest of the bot turn.
    if (refillNeeded) return undefined;
    if (botTurnLocked && botFailures >= BOT_ESCAPE_AFTER_FAILURES) {
      return (
        <BotStuckNotice
          botName={botName}
          variant={variant}
          onTakeOver={() => setBotManualRevision(game.revision ?? 0)}
          onRetry={returnTurnToBot}
        />
      );
    }
    if (botTurnLocked) {
      return (
        <BotThinkingCard
          // No session yet means the request has not gone out, or a retry is
          // pending. Both are "working on it" and neither has a percentage.
          state={botStatus ?? { kind: "requesting" }}
          botName={botName}
          variant={variant}
          slowDevice={
            clientSuper?.available && clientSuper.calibration?.warnAboutWait
              ? { estimatedP50Ms: clientSuper.calibration.estimatedMoveMs.p50 }
              : null
          }
        />
      );
    }
    if (analysisRunning && activeRoomId) {
      return (
        <TurnAnalysisBar roomId={activeRoomId} revision={game.revision ?? 0} variant={variant} />
      );
    }
    return undefined;
  };

  const canEditRefill =
    canRefillActiveRack &&
    // Editing a refill is fixing a draw that already happened, not a way to
    // unstick a wedged bot turn — so unlike the draw itself it stays closed.
    !botTurnLocked &&
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
    // A Study puzzle is answered with one placement: no exchange, no pass.
    if (studyPuzzleRef.current && action !== "place_equation") {
      setStudyPuzzleError(STUDY_PLACEMENT_ONLY);
      return;
    }
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

  /**
   * One keystroke in typing mode.
   *
   * Typing does not get its own way into the rack. It resolves a keystroke to a TOKEN and then
   * takes a tile of that token out of the bag through `refillFromBag` — the same function the
   * tile bag\'s own buttons call. So every rule about what may be drawn, when a rack is full,
   * and what a completed refill does is written once and obeyed by both.
   *
   * Returns true when the key belonged to the rack, so the caller can stop the page acting on
   * it as well.
   */
  function handleRackTypingKey(event: KeyboardEvent): boolean {
    const at = rackTypingFocusRef.current;
    if (at === null || !game) return false;
    // Slot-indexed, not packed: a rack being typed has holes in it, and slot 3 must stay slot 3
    // while slots 1 and 2 are still empty.
    const bySlot = rackSlotsFrom(game, game.activeSide);
    const slots: Slot[] = Array.from(
      { length: RACK_SIZE },
      (_, index) => bySlot[index]?.token ?? null,
    );
    const outcome = typeKey({ slots, focus: at }, event);
    if (!outcome.handled) return false;

    setRackTypingFocus(outcome.state.focus);
    const wanted = outcome.state.slots[at];
    const had = slots[at];
    if (wanted === had) return true;

    // Whatever is being replaced goes back to the bag FIRST. Growing `1` into `18` is a return
    // and a draw, and doing them the other way round would put nine tiles in a rack of eight.
    const occupant = bySlot[at];
    if (occupant) returnRackTileToBag(occupant);
    if (wanted === null) return true;

    const fromBag = game.tilebag.find((candidate) => candidate.token === wanted);
    if (!fromBag) {
      showKeyNotice(`ไม่มีเบี้ย ${wanted} เหลือในกอง`);
      return true;
    }
    refillFromBag(fromBag);
    return true;
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
    // Covers the keyboard too: every key that touches a tile lands here.
    if (botTurnLocked) return;
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

  function selectExchangeTiles(ids: string[], additive: boolean) {
    if (!game || readOnly || actionMode !== "exchange") return;
    const rackIds = new Set(getRack(game, game.activeSide).map((tile) => tile.id));
    const picked = ids.filter((id) => rackIds.has(id) && !carriedOverTileIds.has(id));
    if (picked.length === 0) return;
    setExchangeDraft((current) => {
      const outgoingIds = additive
        ? [...new Set([...current.outgoingIds, ...picked])]
        : [...new Set(picked)];
      return {
        outgoingIds,
        incomingTiles: current.incomingTiles.slice(0, outgoingIds.length),
      };
    });
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
    if (botTurnLocked) return;
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

  /** Take a view from the Survival server as the game on screen. */
  function adoptSurvivalView(next: SurvivalView) {
    const wasFinished = survivalRef.current?.status === "finished";
    const projected = survivalGameFromView(next, {
      playerName: profile?.display_name?.trim() || "คุณ",
    });
    survivalRef.current = projected;
    setSurvival(projected);
    setGame(projected.game);
    if (projected.status === "finished" && !wasFinished) setShowResult(true);
  }

  /** A Survival move goes to the server; the board changes when the server answers. */
  function submitSurvivalMove(log: TurnLog) {
    const session = survivalRef.current;
    const move = survivalMoveFromLog(log);
    if (!session || !move || survivalBusyRef.current) return;
    survivalBusyRef.current = "move";
    setSurvivalBusy("move");
    setSurvivalError(null);
    survivalPlaytestSource
      .move(session.attemptId, move)
      .then((next) => {
        setActionMode("none");
        setActionStart(null);
        setPendingPlacements([]);
        setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        setAssignmentRequest(null);
        adoptSurvivalView(next);
      })
      .catch((error: unknown) => {
        // The move stays composed on the board, so the player sees what was refused.
        setSurvivalError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        survivalBusyRef.current = null;
        setSurvivalBusy(null);
      });
  }

  /** A Study puzzle's one placement goes to the server; the puzzle ends there. */
  function submitStudyPuzzleMove(log: TurnLog, boardAfter: BoardSnapshot, rackAfter: TileInstance[]) {
    const session = studyPuzzleRef.current;
    const placements = studyPlacementsFromLog(log);
    if (!session || studyPuzzleBusyRef.current) return;
    if (!placements) {
      setStudyPuzzleError(STUDY_PLACEMENT_ONLY);
      return;
    }
    studyPuzzleBusyRef.current = "submit";
    setStudyPuzzleBusy("submit");
    setStudyPuzzleError(null);
    studyPuzzleSource
      .submit(session.setId, session.puzzleId, placements)
      .then((result) => {
        setActionMode("none");
        setActionStart(null);
        setPendingPlacements([]);
        setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        setAssignmentRequest(null);
        // The player's own move stays on the board, with the player's own score.
        const next: GameState = {
          ...session.game,
          board: boardAfter,
          rackA: rackAfter,
          scores: { ...session.game.scores, A: session.game.scores.A + result.score },
          revision: (session.game.revision ?? 0) + 1,
          lastSavedAt: new Date().toISOString(),
        };
        const updated = { ...session, game: next };
        studyPuzzleRef.current = updated;
        setStudyPuzzle(updated);
        setGame(next);
        setStudyPuzzleSubmitted({ score: result.score, equations: result.yourEquations });
      })
      .catch((error: unknown) => {
        // The move stays composed on the board, so the player sees what was refused.
        setStudyPuzzleError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        studyPuzzleBusyRef.current = null;
        setStudyPuzzleBusy(null);
      });
  }

  function commitLog(
    log: TurnLog,
    boardAfter: BoardSnapshot,
    rackAfter: TileInstance[],
    tilebagAfter: TileInstance[],
    floatingTiles?: TileInstance[],
    /**
     * Extra game fields to write in the SAME commit as this action.
     *
     * Exists for the client-side engine's version pin, and the "same commit"
     * is the whole requirement: the pin has to reach the server attached to
     * the move that used those versions. Written separately it would be a
     * second round trip that can fail on its own, leaving a game whose record
     * says one thing and whose moves say another.
     */
    extra?: Partial<GameState>,
  ) {
    if (!game || readOnly) return;
    if (survivalRef.current) {
      submitSurvivalMove(log);
      return;
    }
    if (studyPuzzleRef.current) {
      submitStudyPuzzleMove(log, boardAfter, rackAfter);
      return;
    }
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
    // The same move already exists here, parked: walk back into that line rather than copy it.
    // Decided now, from the pure model, so that if following it is not possible the move is
    // simply played as a new one below — a submitted move is never swallowed.
    const twin = endGameLog ? null : findParkedTwin(log);
    const roomForTwin = activeRoomIdRef.current;
    if (twin && roomForTwin) {
      const followed = continueFrom(game, multiverse, { nodeId: twin, phase: "after" });
      if (followed.ok && followed.changed) {
        void applyTimelineChange(roomForTwin, game, followed.game, multiverse, followed.multiverse);
        return;
      }
    }
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
        ...extra,
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

  /**
   * Stop an analysis of the position the player is about to leave.
   *
   * Playing a move IS the answer to "what should I play here", so a search that
   * is still working on it has nothing left to tell anybody — and on the top
   * level it is holding this tab's only engine worker, which the bot needs back
   * within the second. Cancelling here is what lets the player keep placing
   * tiles while an analysis runs (the board is never locked) without the two
   * competing for the same core.
   */
  function cancelAnalysisForThisTurn(): void {
    if (!activeRoomId || !analysisSession) return;
    engineSessions.cancel(analysisSession.key);
  }

  function confirmPlace() {
    cancelAnalysisForThisTurn();
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
    cancelAnalysisForThisTurn();
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
    cancelAnalysisForThisTurn();
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

  /**
   * Apply an engine answer as the bot side's turn.
   *
   * Two gates stand in front of the board, and neither can be satisfied by a
   * failure:
   *
   *   • **Position.** The answer names the revision it was computed for, and it
   *     is applied only to that exact revision. A result that arrives after a
   *     resync, an undo, or another tab's move describes a board that no longer
   *     exists, and is dropped.
   *   • **Legality.** Every placement is re-validated by the official validator,
   *     so an engine bug cannot corrupt a match.
   *
   * What it will NOT do is turn a problem into a pass. A pass is a scoring,
   * irreversible action; it is played when the ENGINE chose it and at no other
   * time. If the answer cannot be honoured — an unmappable tile, a rejected
   * placement, an exchange that is no longer legal — the turn is left alone and
   * the caller is told, because a bot that has not moved yet can still move,
   * and a bot that has passed cannot take it back.
   */
  function applyBotResult(
    response: BotResponse,
    forRevision: number,
  ): "applied" | "rejected" | "stale" {
    const g = gameRef.current;
    if (!g || !g.botSide || g.status !== "playing" || g.activeSide !== g.botSide) return "stale";
    if ((g.revision ?? 0) !== forRevision || response.revision !== forRevision) {
      // Computed for a different position than the one on the board.
      return "stale";
    }
    const now = new Date().toISOString();
    const botActionStart: ActionStart = {
      startedAt: g.currentTurnStartedAt,
      rackBefore: deepClone(getRack(g, g.activeSide)),
      boardBefore: deepClone(g.board),
      tilebagBefore: deepClone(g.tilebag),
      timerBefore: { A: g.timers.A, B: g.timers.B },
    };
    const mapped = mapBotResponse(g, response);
    // Written on the FIRST device-computed move of the game and never changed
    // after: `configForGame` reads this pin back and refuses to substitute a
    // different version for it. A move the backend computed carries no
    // `localEngine`, contributes no pin, and leaves an already-pinned game
    // exactly as it was.
    const pin: Partial<GameState> | undefined = response.localEngine
      ? {
          superEngineVersion: g.superEngineVersion ?? response.localEngine.engineVersion,
          superWeightsVersion: g.superWeightsVersion ?? response.localEngine.weightsVersion,
        }
      : undefined;
    // Tie the reasoning to the log this move produces, so the "why" panel shows
    // it only while that bot move is the latest one on the board.
    const recordReasoning = (logId: string) => {
      if (g.botSide) {
        setBotReasoning({
          logId,
          turnNumber: g.turnNumber,
          playerName: g.players[g.botSide] || (g.botEngine === "authur" ? "Authur" : "Aether"),
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
        commitLog(log, boardAfter, rackAfter, g.tilebag, undefined, pin);
        recordReasoning(log.id);
        return "applied";
      }
      // The engine named a placement the rules reject. That is a bug worth
      // shouting about, but it is not a reason to spend the bot's turn: leave
      // the board alone and let the retry ask again.
      console.error("Bot move rejected by the official validator:", validation.errors);
      setBotNotice("คำตอบของบอทไม่ผ่านการตรวจกติกา — กำลังคำนวณใหม่");
      return "rejected";
    }

    if (mapped?.kind === "exchange") {
      if (mapped.outgoingIds.length === 0 || !getExchangeRule(g).allowed) {
        // The engine chose an exchange the position no longer permits. Same rule
        // as above: report it, do not convert it into a pass.
        setBotNotice("คำตอบของบอทไม่ผ่านการตรวจกติกา — กำลังคำนวณใหม่");
        return "rejected";
      }
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
      commitLog(log, g.board, rackAfter, g.tilebag, returnedTiles, pin);
      recordReasoning(log.id);
      return "applied";
    }

    if (mapped?.kind !== "pass") {
      // `mapBotResponse` could not place the engine's answer on the actual rack
      // — the two disagree about what the bot is holding. Never guess, and never
      // spend the turn guessing.
      setBotNotice("คำตอบของบอทไม่ตรงกับเบี้ยในมือ — กำลังคำนวณใหม่");
      return "rejected";
    }

    // The engine chose to pass. This is the ONLY path that plays one.
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
    commitLog(log, g.board, rackAfter, g.tilebag, undefined, pin);
    recordReasoning(log.id);
    return "applied";
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
    if (!game || game.logs.length === 0 || !canUseTool("replay")) return;
    setShowResult(false);
    // Start at the very first step: turn 1, rack ready, before action — on the line played.
    setViewTipId(null);
    setReplayCursor(0);
  }

  // Step the replay forward/back by ONE half-step. We clamp at both ends —
  // we do NOT auto-exit at the last step, so the user can still undo while
  // viewing it.
  function replayStep(delta: number) {
    if (!game || replayCursor === null) return;
    const total = viewLogs.length * 2;
    if (total === 0) return;
    const next = Math.max(0, Math.min(total - 1, replayCursor + delta));
    setReplayCursor(next);
  }

  const replayTotalSteps = viewLogs.length * 2;
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
  // Survival: always the unseen pool, never the bag alone (that would reveal Authur's rack).
  const tilebagView = survival
    ? survivalTilebagView(viewGame ?? game, survival.authurSide, reviewing ? selectedLog : null)
    : studyPuzzle
      ? studyTilebagView(viewGame ?? game)
      : getTilebagView({
        game: viewGame ?? game,
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
  const currentTurnLogRack =
    actionStart?.rackBefore ?? (survival ? getRack(game, survival.humanSide) : activeRack);
  // Email players either follow the active rack (sharing on) or keep their own
  // rack visible while waiting (sharing off). Direct matches never grant an
  // owner/admin exception because they have no gameplay host.
  const rackSide: Side =
    reviewing && selectedLog
      ? selectedLog.side
      : survival
        ? survival.humanSide
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
        !botTurnLocked &&
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
  const topbarPhase = gameFinished
    ? "จบเกม"
    : reviewing
      ? "ดูย้อนหลัง"
      : game.status === "draft"
        ? "พักเกม"
        : game.phase === "refill"
          ? "จั่วเบี้ย"
          : actionMode === "exchange"
            ? "เลือกเบี้ยแลก"
            : actionMode === "place_equation"
              ? "วางสมการ"
              : actionMode === "pass"
                ? "ผ่านตา"
                : botTurnLocked
                  ? "บอทกำลังเดิน"
                  : "พร้อมเล่น";
  const topbarStatus = syncError
    ? "ซิงก์มีปัญหา"
    : backgroundSyncCount > 0
      ? "กำลังบันทึก…"
      : topbarPhase;

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
          <span className={`topbar-status${syncError ? " has-error" : ""}`} aria-live="polite">
            {gameFinished ? "" : `ตา ${game.turnNumber} · ${game.players[game.activeSide]} · `}
            {topbarStatus}
          </span>
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
                aria-label="Undo"
                className="icon-button"
                disabled={!canControlActiveGame || undoStackRef.current.length === 0}
                title="Undo"
                type="button"
                onClick={undo}
              >
                <Undo2 size={18} />
                <span className="top-action-label">Undo</span>
              </button>
              <button
                aria-label="Redo"
                className="icon-button"
                disabled={!canControlActiveGame || redoStackRef.current.length === 0}
                title="Redo"
                type="button"
                onClick={redo}
              >
                <Redo2 size={18} />
                <span className="top-action-label">Redo</span>
              </button>
            </>
          )}
          {gameFinished && (
            <button aria-label="Export" className="icon-button" type="button" onClick={exportGame}>
              <Download size={18} />
              <span className="top-action-label">Export</span>
            </button>
          )}
          {game.status === "playing" ? (
            <button
              aria-label="Break"
              className="icon-button top-save-exit top-coffee-break"
              title="Leave this board open and browse other games."
              type="button"
              onClick={() => void takeCoffeeBreak()}
            >
              <Coffee size={18} />
              <span className="top-action-label">Break</span>
            </button>
          ) : (
            <button
              aria-label={gameFinished ? "Exit" : "Exit & Save"}
              className="icon-button top-save-exit"
              type="button"
              title={
                gameFinished ? "Exit this finished game." : "Exit and keep this stopped game saved."
              }
              onClick={saveAndExit}
            >
              <LogOut size={18} />
              <span className="top-action-label">{gameFinished ? "Exit" : "Exit & Save"}</span>
            </button>
          )}
          {modeToolsLoading && (
            <span className="play-tool-loading" role="status" aria-label="กำลังเตรียมเครื่องมือ">
              <span className="play-tool-loading-dot" aria-hidden="true" />
            </span>
          )}
          {canUseTool("turn_log") && (
            <button
              aria-label="ประวัติตา"
              className="icon-button"
              title="ดูตาที่ผ่านมา"
              type="button"
              onClick={() => setLogModalOpen(true)}
            >
              <List size={18} />
              <span className="top-action-label">ประวัติ</span>
            </button>
          )}
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
              <span className="top-action-label">
                {stopRequestedByMe
                  ? "Requested"
                  : stopRequestBlocked
                    ? `${stopBlockSeconds}s`
                    : isDirectEmailRoom
                      ? "Request"
                      : "Stop"}
              </span>
            </button>
          )}
          {!gameFinished && game.status === "draft" && canResumeLifecycle && (
            <button
              aria-label="Resume"
              className="resume-button top-stop-time paused"
              type="button"
              title="Resume this stopped game."
              onClick={resumeGame}
            >
              <Play size={18} />
              <span className="top-action-label">Resume</span>
            </button>
          )}
          {!gameFinished && game.status === "playing" && canEndLifecycle && (
            <button
              aria-label={
                !hasGameplayHost && getGameMode(game) !== "solo" ? "Surrender" : "End Game"
              }
              className="danger-button top-end-game"
              type="button"
              onClick={endGame}
            >
              <Flag size={18} />
              <span className="top-action-label">
                {!hasGameplayHost && getGameMode(game) !== "solo" ? "Surrender" : "End Game"}
              </span>
            </button>
          )}
          {gameFinished && (
            <>
              <button
                aria-label="Result"
                className="icon-button"
                type="button"
                title="Open the final result summary."
                onClick={() => setShowResult(true)}
              >
                <Trophy size={18} />
                <span className="top-action-label">Result</span>
              </button>
              {canUseTool("replay") && (
                <button
                  aria-label="Replay"
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
                  <span className="top-action-label">Replay</span>
                </button>
              )}
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
            kind={tilebagView.kind}
            listKind={tilebagView.listKind}
            rackSlots={displayRack}
            remainingCount={tilebagView.remainingCount}
            tiles={tilebagView.tiles}
          />
          {canUseTool("turn_log") && (
            <LogPanel
              game={game}
              logs={viewLogs}
              selectedLogId={selectedLogId}
              replayPhase={replayPhase}
              forks={forks}
              lineView={lineView}
              lineCount={lineTotal}
              timelineStatus={timelineEntry.status}
              branch={branchControl}
              onSelectLog={onSelectLog}
              onStarsChange={onUpdateLogStars}
              onNoteChange={onUpdateLogNote}
              onStep={onStepTurn}
              onSetPhase={onSetReplayPhase}
              onOpenMap={canUseTool("multiverse") ? openMap : undefined}
              onViewOption={onViewOption}
              onContinue={onContinueFromView}
              currentTurnRack={currentTurnLogRack}
              readOnly={!canControlActiveGame}
            />
          )}
        </aside>

        <section
          className="board-zone"
          ref={setBoardZone}
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
              onCellClick={onBoardCellClick}
              onPendingAssignmentEdit={onPendingAssignmentEdit}
            />
          </div>

          <div className="play-bar">
            <div className="play-caption">
              <span className="pc-room">{game.name}</span>
              <span className={`pc-rack-side side-${rackSide.toLowerCase()}`}>
                {game.players[rackSide]} Rack
              </span>
              {reviewing ? (
                <span className="pc-hint">
                  Replay {Math.floor(replayIndex / 2) + 1}/{viewLogs.length}
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
              engineActivity={engineActivityFor("mobile")}
              actionMode={actionMode}
              canChooseAction={canChooseAction}
              canEditRefill={canEditRefill}
              canExchange={canStartExchange}
              canPass={!studyPuzzle}
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
              typing={
                rackTypingFocus !== null && rackConfigs[0].side === game.activeSide
                  ? { focus: rackTypingFocus }
                  : null
              }
              onEmptySlotClick={onEmptyRackSlotClick}
              onSlotFocus={onRackSlotFocus}
              onTileClick={onRackTileClick}
              onExchangeSelectTiles={onExchangeSelectTiles}
            />
          </div>
        </section>

        {isMobilePlay &&
          (canUseTool("multiverse") ||
            analysisAvailable ||
            (botNotice && game.botSide && !reviewing) ||
            (!botStatus &&
              canUseTool("bot_insight") &&
              botReasoning &&
              activeRoomId &&
              game.logs.at(-1)?.id === botReasoning.logId)) && (
            <section className="mobile-play-tools" aria-label="เครื่องมือระหว่างเล่น">
              <div className="mobile-play-tools-head">
                <span className="mobile-play-tools-title">
                  <FlaskConical size={15} aria-hidden /> เครื่องมือ
                </span>
                <span className="mobile-play-tools-context">สำหรับโหมดนี้</span>
              </div>
              <div className="mobile-play-tool-list">
                {canUseTool("multiverse") && (
                  <button type="button" className="mobile-tool-button" onClick={openMap}>
                    <span className="mobile-tool-icon">
                      <GitBranch size={17} aria-hidden />
                    </span>
                    <span className="mobile-tool-copy">
                      <strong>เส้นทางเกม</strong>
                      <small>ดูตาที่ผ่านมา</small>
                    </span>
                    <ChevronRight className="mobile-tool-arrow" size={15} aria-hidden />
                  </button>
                )}
                {!botStatus &&
                  canUseTool("bot_insight") &&
                  botReasoning &&
                  activeRoomId &&
                  game.logs.at(-1)?.id === botReasoning.logId && (
                    <button
                      type="button"
                      className="mobile-tool-button"
                      onClick={() => setReasoningOpen(true)}
                    >
                      <span className="mobile-tool-icon">
                        <BrainCircuit size={17} aria-hidden />
                      </span>
                      <span className="mobile-tool-copy">
                        <strong>เหตุผลของบอท</strong>
                        <small>ทำไมเลือกตานี้</small>
                      </span>
                      <ChevronRight className="mobile-tool-arrow" size={15} aria-hidden />
                    </button>
                  )}
                {analysisAvailable && activeRoomId && (
                  <div className="mobile-analysis-tool">
                    <TurnAnalysisLauncher
                      roomId={activeRoomId}
                      authur={game.botEngine === "authur"}
                      revision={game.revision ?? 0}
                      reconnectEpoch={subscriptionEpoch}
                      playerName={game.players[game.activeSide] || game.activeSide}
                      disabled={!canAnalyzeTurn}
                      disabledReason={analysisDisabledReason}
                      makeLocal={makeLocalAnalysis}
                      localHint={localAnalysisHint}
                      mobileTool
                    />
                  </div>
                )}
              </div>
              {botNotice && game.botSide && !reviewing && (
                <div className="bot-notice" role="status">
                  {botNotice}
                </div>
              )}
            </section>
          )}

        {/* A toast, not a row. `position: fixed` keeps it out of the layout
            entirely — `.board-zone` is a two-row grid whose board is sized from
            the viewport, so anything that takes height in there is drawn over
            the board rather than beside it. */}
        {(blankArmed || keyNotice) && (
          <div className={`key-notice${blankArmed ? " is-armed" : ""}`} role="status">
            {blankArmed ? "Blank พร้อมแล้ว — กดปุ่มของหน้าที่จะให้มันแทน · Esc ยกเลิก" : keyNotice}
          </div>
        )}

        <aside className="right-rail" ref={rightRailRef}>
          <PlayRail
            game={game}
            tilebag={displayedOrPickableTilebag}
            tilebagCount={tilebagView.remainingCount}
            tilebagKind={tilebagView.kind}
            // The rail swaps the pooled list for the real bag while a manual
            // draw is open, so the list's own label has to swap with it.
            tilebagListKind={canPickFromTilebag ? "bag" : tilebagView.listKind}
            tilebagDisabled={!canPickFromTilebag}
            onPickTile={refillFromBag}
          />

          <RailDivider railRef={rightRailRef} />

          <ActionPanel
            // A spectator's panel is the live view, not the actions, so there is
            // no slot to take over — the bar falls back into `insights` for them
            // below. Watching a bot think is the one thing a spectator came for.
            engineActivity={showViewPanel ? undefined : engineActivityFor("panel")}
            detailOverride={
              survival
                ? survivalBusy === "authur"
                  ? "Authur thinking"
                  : undefined
                : studyPuzzle
                  ? studyPuzzleSubmitted
                    ? "ส่งคำตอบแล้ว"
                    : undefined
                  : botTurnLocked
                  ? `${botName} thinking`
                  : botTurn
                    ? `Manual · ${botName}`
                    : undefined
            }
            // A submitted Study puzzle is over: say so, rather than "analysis tools go here".
            viewOnlyMessage={
              studyPuzzle && studyPuzzleSubmitted ? (
                <div className="analysis-panel is-empty">
                  <p className="analysis-empty">
                    ส่งคำตอบแล้ว · โจทย์นี้ตอบได้ตาเดียว และคำตอบของคุณถูกบันทึกไว้แล้ว
                  </p>
                </div>
              ) : undefined
            }
            // Rendered by the control panel rather than under the board: see
            // `insights` in ActionPanel for why the board zone cannot hold them.
            insights={
              <>
                <KeyboardChangeNotice />
                {/* The thinking bar is normally NOT here. It is drawn in the
                    action slot, in place of Exchange and Pass — see
                    `engineActivityFor`. Here it floated over the board on
                    desktop and rendered nowhere at all on mobile.
                    The exception is a panel showing the live view or a replay
                    instead of the actions: there is no action slot to take over
                    then, and a spectator should still see the bot thinking. */}
                {showViewPanel && engineActivityFor("panel")}

                {/* The turn was handed to the player after three failures. This
                    is the only way to give it back. */}
                {botTurn && !botTurnLocked && !reviewing && (
                  <button type="button" className="bot-why-btn" onClick={returnTurnToBot}>
                    ให้ {botName} ลองอีกครั้ง
                  </button>
                )}

                {survival && survivalBusy === "authur" && (
                  <div className="bot-notice" role="status" aria-live="polite">
                    Authur กำลังคิด…
                  </div>
                )}
                {survival && survivalError && (
                  <div className="bot-notice" role="alert">
                    {survivalError}
                    {game.status === "playing" &&
                      game.activeSide === survival.authurSide &&
                      survivalBusy === null && (
                        <button
                          type="button"
                          className="bot-why-btn"
                          onClick={() => setSurvivalRetry((count) => count + 1)}
                        >
                          ให้ Authur ลองอีกครั้ง
                        </button>
                      )}
                  </div>
                )}

                {studyPuzzle && studyPuzzleBusy === "submit" && (
                  <div className="bot-notice" role="status" aria-live="polite">
                    กำลังส่งคำตอบ…
                  </div>
                )}
                {studyPuzzle && studyPuzzleSubmitted && (
                  <div className="bot-notice" role="status" aria-live="polite">
                    ส่งคำตอบแล้ว · ตานี้ได้ {studyPuzzleSubmitted.score} แต้ม (
                    {studyPuzzleSubmitted.equations.map((equation) => equation.text).join(" · ")}) ·
                    โจทย์นี้จบแล้ว
                  </div>
                )}
                {studyPuzzle && studyPuzzleError && (
                  <div className="bot-notice" role="alert">
                    {studyPuzzleError}
                  </div>
                )}

                {/* Why the bot has not moved. Shown while a retry is pending and
                    after a failure that ended in a pass, so the board never simply
                    sits there with no explanation. */}
                {botNotice && game.botSide && !reviewing && (
                  <div className="bot-notice" role="status" aria-live="polite">
                    {botNotice}
                  </div>
                )}

                {!isMobilePlay &&
                  !botStatus &&
                  !reviewing &&
                  game.botSide &&
                  botReasoning &&
                  canUseTool("bot_insight") &&
                  // The report is read back from the engine service by room id, so a
                  // button with no room behind it could only open an empty panel.
                  activeRoomId &&
                  game.logs[game.logs.length - 1]?.id === botReasoning.logId && (
                    <button
                      type="button"
                      className="bot-why-btn"
                      onClick={() => setReasoningOpen(true)}
                    >
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
                {!isMobilePlay && analysisAvailable && activeRoomId && (
                  <TurnAnalysisLauncher
                    roomId={activeRoomId}
                    authur={game.botEngine === "authur"}
                    revision={game.revision ?? 0}
                    reconnectEpoch={subscriptionEpoch}
                    playerName={game.players[game.activeSide] || game.activeSide}
                    disabled={!canAnalyzeTurn}
                    disabledReason={analysisDisabledReason}
                    makeLocal={makeLocalAnalysis}
                    localHint={localAnalysisHint}
                  />
                )}
              </>
            }
            activeRack={survival ? getRack(game, survival.humanSide) : activeRack}
            actionMode={actionMode}
            canChooseAction={canChooseAction}
            canEditRefill={canEditRefill}
            canExchange={canStartExchange}
            canPass={!studyPuzzle}
            exchangeDisabledReason={studyPuzzle ? STUDY_PLACEMENT_ONLY : exchangeRule.reason}
            exchangeDraft={exchangeDraft}
            exchangeReady={exchangeReady}
            // While reviewing another line, its replay reads that line's turns, not the live ones.
            game={reviewing ? (viewGame ?? game) : game}
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

      <TurnLogMap
        open={canUseTool("multiverse") && mapRoomId !== null && mapRoomId === activeRoomId}
        game={game}
        tree={multiverseTree}
        status={timelineEntry.status}
        error={timelineEntry.error}
        viewedId={selectedLogId}
        canBranch={branchAvailable}
        branchBlockedReason={branchBlockedReason}
        busy={branchBusy}
        onClose={onCloseMap}
        onView={onMapView}
        onContinue={onMapContinue}
        onPrune={onMapPrune}
        onRetry={onRetryTimeline}
      />

      {canUseTool("turn_log") && (
        <LogModal
          game={game}
          logs={viewLogs}
          open={logModalOpen}
          selectedLogId={selectedLogId}
          replayPhase={replayPhase}
          forks={forks}
          lineCount={lineTotal}
          branch={branchControl}
          onClose={() => setLogModalOpen(false)}
          onStarsChange={onUpdateLogStars}
          currentTurnRack={currentTurnLogRack}
          onNoteChange={onUpdateLogNote}
          onSetPhase={onSetReplayPhase}
          onOpenMap={
            canUseTool("multiverse")
              ? () => {
                  // One dialog at a time: the map replaces the log rather than stacking on it.
                  setLogModalOpen(false);
                  openMap();
                }
              : undefined
          }
          onViewOption={onViewOption}
          onContinue={() => {
            if (!selectedLog) return;
            void continueFromTarget({ nodeId: selectedLog.id, phase: replayPhase }).then(
              (moved) => {
                // The board is the answer now, and on a phone the log is covering it.
                if (moved) setLogModalOpen(false);
              },
            );
          }}
          readOnly={!canControlActiveGame}
          onSelectLog={onSelectLog}
        />
      )}

      {assignmentRequest && (
        <AssignmentModal
          request={assignmentRequest}
          onCancel={() => setAssignmentRequest(null)}
          onSelect={confirmAssignment}
        />
      )}

      {reasoningOpen && canUseTool("bot_insight") && botReasoning && activeRoomId && (
        <BotReasoningPanel
          gameId={activeRoomId}
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

/**
 * Said once, to anyone who learned the old keys.
 *
 * `1`–`8` named a rack SLOT for as long as this app has had a keyboard. They
 * now name the tile, which is more direct but breaks the one thing a fast
 * player does not think about. A line they can dismiss costs a sentence; saying
 * nothing costs them a turn placed with the wrong tile.
 */
const KEYBOARD_CHANGE_KEY = "eq-lab:keys-name-tiles-notice";

function KeyboardChangeNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(KEYBOARD_CHANGE_KEY) === "seen";
    } catch {
      // Private windows and blocked site data throw. A missing preference just
      // means the notice shows again; it must never break the play screen.
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <div className="keys-changed-notice" role="status">
      <p>
        คีย์บอร์ดเปลี่ยนแล้ว: <kbd>1</kbd>–<kbd>8</kbd> ไม่ใช่ "ช่องที่ N" อีกต่อไป แต่คือ{" "}
        <b>เบี้ยเลขนั้น</b> · เครื่องหมายใช้ <kbd>P</kbd> <kbd>M</kbd> <kbd>X</kbd> <kbd>D</kbd> ·{" "}
        <kbd>Space</kbd> สลับทิศ · <kbd>Enter</kbd> ส่งตา
      </p>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(KEYBOARD_CHANGE_KEY, "seen");
          } catch {
            // Dismissed for this session either way.
          }
        }}
      >
        เข้าใจแล้ว
      </button>
    </div>
  );
}
