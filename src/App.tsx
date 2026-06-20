import {
  Download,
  Flag,
  LayoutGrid,
  List,
  LogOut,
  Pause,
  Play,
  Redo2,
  Trophy,
  Undo2,
  X,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel } from "./components/actions/ActionPanel";
import { Board, type BoardScoreAnchor } from "./components/board/Board";
import { Lobby } from "./components/pages/Lobby";
import { LogModal } from "./components/logs/LogModal";
import { LogPanel } from "./components/logs/LogPanel";
import { PlayRail } from "./components/rail/PlayRail";
import { RailDivider } from "./components/rail/RailDivider";
import { Rack } from "./components/board/Rack";
import { Scoreboard } from "./components/game/Scoreboard";
import { Tile } from "./components/board/Tile";
import { useAuth } from "./auth";
import {
  ActionType,
  BoardSnapshot,
  EndGameDetail,
  EquationDetection,
  ExchangeDetail,
  GameState,
  NewGameSettings,
  PassDetail,
  PendingPlacement,
  Phase,
  PlaceEquationDetail,
  Side,
  TileInstance,
  TurnLog,
  aggregatePendingExchangeReturns,
  boardWithPending,
  calculateTotals,
  createNewGame,
  createPlaceDetail,
  deepClone,
  getPendingExchangeReturnBySide,
  getAssignmentOptions,
  getRack,
  getTileDrawMode,
  isRackReady,
  otherSide,
  phaseForNextSide,
  pushActionSnapshot,
  setRack,
  shuffleTilebagQueue,
  tileNeedsAssignment,
  tilePoint,
  TurnActionDetail,
  updateLogNote,
  validateMove,
} from "./game";
import * as roomStore from "./rooms";
import type { RoomMeta } from "./rooms";
import * as remoteRooms from "./remoteRooms";
import type { LiveRoomSession, RoomSessionEvent } from "./remoteRooms";
import { navigate, useRoute } from "./router";
import { isSupabaseConfigured } from "./supabaseClient";
import { ACTION_LABELS } from "./uiText";

type ActionMode = "none" | ActionType;

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

type TilebagView = {
  tiles: TileInstance[];
  remainingCount: number;
};

type AssignmentRequest =
  | {
      kind: "place";
      tile: TileInstance;
      row: number;
      col: number;
      dir?: "right" | "down" | "left" | "up";
      rackSlot?: number;
    }
  | {
      kind: "swapPending";
      tile: TileInstance;
      pendingTileId: string;
    }
  | {
      kind: "editPending";
      tile: TileInstance;
      pendingTileId: string;
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

function refillBaselineMatchesTurn(baseline: RefillBaseline | null, game: GameState): baseline is RefillBaseline {
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

function App() {
  const { configured: authConfigured, isApproved, profile, userId } = useAuth();
  const remoteEnabled = isSupabaseConfigured;
  const [rooms, setRooms] = useState<RoomMeta[]>(() => (remoteEnabled ? [] : roomStore.listRooms()));
  const [roomsLoading, setRoomsLoading] = useState(remoteEnabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [foregroundLoading, setForegroundLoading] = useState<string | null>(null);
  const [backgroundSyncCount, setBackgroundSyncCount] = useState(0);
  const route = useRoute();
  const [game, setGame] = useState<GameState | null>(() => {
    if (remoteEnabled) return null;
    const id = route.kind === "room" ? route.roomId : roomStore.getActiveRoomId();
    if (!id) return null;
    const saved = roomStore.readRoom(id);
    return saved && !hasDuplicateTileIds(saved) ? normalizeFinishedGame(saved) : null;
  });
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => {
    if (route.kind === "room") return route.roomId;
    if (remoteEnabled) return null;
    const id = roomStore.getActiveRoomId();
    return id && roomStore.readRoom(id) ? id : null;
  });
  const view: "lobby" | "game" = route.kind === "room" ? "game" : "lobby";
  const [actionMode, setActionMode] = useState<ActionMode>("none");
  const [actionStart, setActionStart] = useState<ActionStart | null>(null);
  const [selectedRackTileId, setSelectedRackTileId] = useState<string | null>(null);
  const [selectedPendingTileId, setSelectedPendingTileId] = useState<string | null>(null);
  const [pendingPlacements, setPendingPlacements] = useState<PendingPlacement[]>([]);
  // Directional placement cursor. Clicking an empty cell cycles
  // right → down → left → up → cancel. Pressing 1–8 (or clicking a rack
  // tile) places that tile at the cursor and advances over any filled /
  // pending cells in the direction.
  const [placementCursor, setPlacementCursor] = useState<
    { row: number; col: number; dir: "right" | "down" | "left" | "up" } | null
  >(null);
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
    A: Array(8).fill(null),
    B: Array(8).fill(null),
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
  const [assignmentRequest, setAssignmentRequest] = useState<AssignmentRequest | null>(null);
  const [boardCell, setBoardCell] = useState(34);
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
  const activeRoomIdRef = useRef<string | null>(activeRoomId);
  const isOwnerRef = useRef(false);
  const pendingSessionEventRef = useRef<RoomSessionEvent | null>(null);
  const lastAppliedStateKeyRef = useRef<string>("");
  const lastAppliedSessionKeyRef = useRef<string>("");
  const foregroundOperationRef = useRef(0);
  const liveSessionSyncTimerRef = useRef<number | null>(null);
  const undoStackRef = useRef<UndoSnap[]>([]);
  const redoStackRef = useRef<UndoSnap[]>([]);
  const lastSnapRef = useRef<UndoSnap | null>(null);
  const lastMutationKeyRef = useRef<string>("");
  const restoringUndoRef = useRef(false);
  const [, bumpUndoVersion] = useState(0);

  const activeRoomMeta = activeRoomId ? rooms.find((room) => room.id === activeRoomId) ?? null : null;
  const hasAdminAccess = remoteEnabled && Boolean(userId && profile?.is_admin);
  const canCreateRoom = !remoteEnabled || Boolean(userId && (isApproved || hasAdminAccess));
  const canPlayActiveRoom =
    !remoteEnabled || Boolean(userId && (hasAdminAccess || activeRoomMeta?.ownerId === userId));
  const readOnly = remoteEnabled && !canPlayActiveRoom;
  const roleLabel = !remoteEnabled
    ? "Local Control"
    : hasAdminAccess
      ? "Admin Control"
      : canPlayActiveRoom
        ? "Owner Control"
        : "Spectator Live";
  const createDisabledReason = authConfigured
    ? !userId
      ? "Sign in to create a room."
      : !isApproved && !hasAdminAccess
        ? "Your account must be approved before creating a room."
        : null
    : null;
  const liveSession = useMemo(
    () =>
      remoteRooms.makeLiveSession({
        actorId: userId,
        actionMode,
        pendingPlacements,
        exchangeDraft,
        selectedRackTileId,
        selectedPendingTileId,
      }),
    [actionMode, exchangeDraft, pendingPlacements, selectedPendingTileId, selectedRackTileId, userId],
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
    isOwnerRef.current = canPlayActiveRoom;
  }, [activeRoomId, canPlayActiveRoom]);

  // Reconcile route changes (browser back/forward, manual hash edit) with state.
  // Owner-initiated openRoom/createAndOpenRoom already sync everything *before*
  // calling navigate(), so this effect mostly handles external hash changes.
  useEffect(() => {
    if (route.kind === "lobby") return;
    if (route.roomId === activeRoomId && game) return;
    let cancelled = false;
    const finishLoading = startForegroundLoading("Opening room...");
    (async () => {
      try {
        const remotePayload = remoteEnabled ? await remoteRooms.readRoom(route.roomId) : null;
        const storedGame = remotePayload?.game ?? roomStore.readRoom(route.roomId);
        if (cancelled) return;
        if (!storedGame || hasDuplicateTileIds(storedGame)) {
          navigate({ kind: "lobby" }, true);
          return;
        }
        const saved = normalizeFinishedGame(storedGame);
        if (!remoteEnabled) roomStore.setActiveRoomId(route.roomId);
        setActiveRoomId(route.roomId);
        setGame(saved);
        lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
        if (remotePayload) applyRemoteSession(remotePayload.session);
        setShowResult(isFinishedGame(saved));
      } catch (error) {
        if (!cancelled) setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
      } finally {
        finishLoading();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind === "room" ? route.roomId : null]);

  useEffect(() => {
    if (!remoteEnabled) return;
    let active = true;
    setRoomsLoading(true);
    remoteRooms
      .listRooms()
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
  }, [remoteEnabled, userId]);

  useEffect(() => {
    if (!remoteEnabled || !activeRoomId) return;
    return remoteRooms.subscribeToRoom(activeRoomId, (payload) => {
      const newRecord = payload.new as { id?: string } | null | undefined;
      const oldRecord = payload.old as { id?: string } | null | undefined;
      const changedId = newRecord?.id ?? oldRecord?.id;
      if (!changedId || changedId !== activeRoomIdRef.current) return;
      if (payload.eventType === "DELETE") {
        setActiveRoomId(null);
        setGame(null);
        navigate({ kind: "lobby" });
        cancelDraftOnly();
        return;
      }
      if (isOwnerRef.current || !payload.new) return;
      try {
        applyRemotePayload(remoteRooms.payloadFromRow(payload.new as Parameters<typeof remoteRooms.payloadFromRow>[0]));
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to read live room update.");
      }
    }, (session) => {
      if (!isOwnerRef.current) applyRemoteSession(session);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, activeRoomId]);

  useEffect(() => {
    if (view !== "game" || !game || game.status !== "playing" || game.timers.paused) return;
    if (game.timers.untimed || game.timers.sideUntimed?.[game.activeSide]) return;
    const intervalId = window.setInterval(() => {
      setGame((current) => {
        if (!current || current.status !== "playing" || current.timers.paused) return current;
        const side = current.activeSide;
        if (current.timers.untimed || current.timers.sideUntimed?.[side]) return current;
        const nextValue = Math.max(current.timers[side] - 1, current.timers.minSeconds);
        if (nextValue === current.timers[side]) return current;
        return {
          ...current,
          timers: {
            ...current.timers,
            [side]: nextValue,
          },
          lastSavedAt: new Date().toISOString(),
        };
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [view, game?.activeSide, game?.status, game?.timers.paused, game?.timers.untimed, game?.timers.sideUntimed]);

  // Persist the active room's full state locally on every change (incl. timer ticks).
  useEffect(() => {
    if (remoteEnabled) return;
    if (!game || !activeRoomId) return;
    if (hasDuplicateTileIds(game)) return;
    roomStore.saveRoomState(activeRoomId, game);
  }, [game, activeRoomId, remoteEnabled]);

  // Supabase state sync: excludes timer-only ticks, but includes submitted turns,
  // undo/redo, score edits, pause/resume, end/resume, and room metadata changes.
  useEffect(() => {
    if (!remoteEnabled || !game || !activeRoomId || !canPlayActiveRoom) return;
    if (hasDuplicateTileIds(game)) return;
    if (remoteStateKey === lastAppliedStateKeyRef.current) return;
    const event = pendingSessionEventRef.current ?? "state";
    pendingSessionEventRef.current = null;
    lastAppliedStateKeyRef.current = remoteStateKey;
    setBackgroundSyncCount((count) => count + 1);
    void remoteRooms
      .updateRoomState({
        id: activeRoomId,
        game,
        session: liveSession,
        event,
      })
      .then(() => {
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
      .catch((error: Error) => setSyncError(error.message))
      .finally(() => setBackgroundSyncCount((count) => Math.max(0, count - 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, activeRoomId, canPlayActiveRoom, remoteStateKey]);

  // Supabase live draft sync: lets spectators see pending placement/exchange state.
  useEffect(() => {
    if (!remoteEnabled || !activeRoomId || !canPlayActiveRoom) return;
    if (liveSessionKey === lastAppliedSessionKeyRef.current) return;
    lastAppliedSessionKeyRef.current = liveSessionKey;
    if (liveSessionSyncTimerRef.current !== null) window.clearTimeout(liveSessionSyncTimerRef.current);
    liveSessionSyncTimerRef.current = window.setTimeout(() => {
      liveSessionSyncTimerRef.current = null;
      void remoteRooms
        .updateRoomSession(activeRoomId, liveSession)
        .then(() => setSyncError(null))
        .catch((error: Error) => setSyncError(error.message));
    }, 50);
    return () => {
      if (liveSessionSyncTimerRef.current !== null) {
        window.clearTimeout(liveSessionSyncTimerRef.current);
        liveSessionSyncTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, activeRoomId, canPlayActiveRoom, liveSessionKey]);

  // Refresh the lobby summary only when meaningful fields change (not per second).
  useEffect(() => {
    if (remoteEnabled) return;
    if (!game || !activeRoomId) return;
    setRooms(roomStore.touchRoomMeta(activeRoomId, game));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, activeRoomId, game?.name, game?.turnNumber, game?.scores.A, game?.scores.B, game?.status]);

  useEffect(() => {
    if (
      !game ||
      view !== "game" ||
      game.status !== "playing" ||
      (game.phase !== "refill" && game.phase !== "choose_action")
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
      const rackHeightRatio = 1.42;
      const rackChrome = 34;
      const rowLabelWidth = 34;
      const colLabelHeight = 22;
      const boardBorderTotal = 4;
      const labelGutterX = rowLabelWidth + boardBorderTotal;
      const labelGutterY = colLabelHeight + boardBorderTotal;
      const safetyInset = 18;
      const sizeByWidth = (w - labelGutterX - safetyInset * 2) / 15;
      const sizeByHeight = (h - rackChrome - labelGutterY - safetyInset) / (15 + rackHeightRatio);
      const size = Math.max(15, Math.min(68, Math.floor(Math.min(sizeByWidth, sizeByHeight) * 0.96)));
      setBoardCell((prev) => (prev === size ? prev : size));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    // Layout may not be stable on the first paint — measure again next frame.
    const rafId = window.requestAnimationFrame(measure);
    return () => {
      observer.disconnect();
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
          if (replaySlot >= 0 && replaySlot < 8) replayRack[replaySlot] = last.tile;
          else replayRack.push(last.tile);
          setReplayDraft({
            rack: replayRack,
            placements: replayDraft.placements.slice(0, -1),
          });
          setSelectedRackTileId(null);
          setSelectedPendingTileId(null);
          setPlacementCursor((cur) => ({ row: last.row, col: last.col, dir: last.cursorDir ?? cur?.dir ?? "right" }));
          return;
        }
        // Live: read from refs so multiple Backspaces in quick succession
        // each pop the actual latest placement, not a stale closure copy.
        const currentGame = gameRef.current;
        const currentPendings = pendingsRef.current;
        const last = currentPendings.at(-1);
        if (!last || actionModeRef.current !== "place_equation" || !currentGame) {
          if (actionModeRef.current === "place_equation") consumed();
          return;
        }
        consumed();
        const newPendings = currentPendings.slice(0, -1);
        const returningTile = { ...last.tile, assignedToken: last.assignedToken ?? last.tile.assignedToken };
        const restoredLayout = fillRackLayoutSlot(currentGame.activeSide, last.rackSlot ?? -1, returningTile.id);
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
        const newCursor = { row: last.row, col: last.col, dir: last.cursorDir ?? cursorRef.current?.dir ?? "right" } as const;
        // Sync refs first so the next keystroke sees the fresh state.
        pendingsRef.current = newPendings;
        gameRef.current = newGame;
        cursorRef.current = newCursor;
        setPendingPlacements(newPendings);
        setGame(newGame);
        setPlacementCursor(newCursor);
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        return;
      }

      const digit = parseInt(event.key, 10);
      if (!Number.isFinite(digit) || digit < 1 || digit > 8) return;

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
      const tile = rackSlotsFrom(currentGame, currentGame.activeSide, rackLayoutRef.current)[rackSlot];

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
            const actionGame = { ...currentGame, phase: "perform_action" as Phase, lastSavedAt: new Date().toISOString() };
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
          if (nr < 0 || nc < 0 || nr >= 15 || nc >= 15) {
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
        const finalGame = autoStartedPlace ? { ...newGame, phase: "perform_action" as Phase } : newGame;
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
  }, [view, game?.gameId, readOnly, replayCursor, replayDraft, selectedPendingTileId, assignmentRequest]);

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
    const ref = useThis ? selectedLog : game.logs[logIdx - 1] ?? null;
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
      : ref?.timerAfter ?? initialTimers;
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
        const rack = getRack(game, side);
        const presentIds = new Set(rack.map((tile) => tile.id));
        // Vacate slots whose tiles are no longer in the rack.
        next[side] = next[side].map((id) => (id && presentIds.has(id) ? id : null));
        // Add new tiles to the first empty slot.
        const knownIds = new Set(next[side].filter(Boolean) as string[]);
        for (const tile of rack) {
          if (knownIds.has(tile.id)) continue;
          const emptyIdx = next[side].indexOf(null);
          if (emptyIdx >= 0) {
            next[side][emptyIdx] = tile.id;
            knownIds.add(tile.id);
          }
        }
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

  if (view !== "game" || !game) {
    if (view === "game") {
      return <LoadingScreen message={foregroundLoading ?? "Opening room..."} />;
    }
    return (
      <>
        <Lobby
          canCreate={canCreateRoom}
          createDisabledReason={createDisabledReason}
          loading={roomsLoading}
          rooms={rooms}
          syncError={syncError}
          canManageMembers={canCreateRoom}
          getRoomRole={getRoomRole}
          onOpen={openRoom}
          onCreate={createAndOpenRoom}
          onRename={renameRoomById}
          onDuplicate={duplicateRoomById}
          onDelete={deleteRoomById}
          onExport={exportRoomById}
          onImport={importRoomGame}
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncCount > 0} />
      </>
    );
  }

  function startForegroundLoading(message: string): () => void {
    const operationId = ++foregroundOperationRef.current;
    const startedAt = Date.now();
    setForegroundLoading(message);
    return () => {
      const clear = () => {
        if (foregroundOperationRef.current === operationId) setForegroundLoading(null);
      };
      const remainingMs = 240 - (Date.now() - startedAt);
      if (remainingMs > 0) {
        window.setTimeout(clear, remainingMs);
      } else {
        clear();
      }
    };
  }

  async function openRoom(id: string) {
    const finishLoading = startForegroundLoading("Opening room...");
    try {
      const remotePayload = remoteEnabled ? await remoteRooms.readRoom(id) : null;
      const storedGame = remotePayload?.game ?? roomStore.readRoom(id);
      if (!storedGame || hasDuplicateTileIds(storedGame)) {
        window.alert("This room cannot be opened because its data is damaged.");
        return;
      }
      const saved = normalizeFinishedGame(storedGame);
      cancelDraftOnly();
      setReplayCursor(null);
      if (!remoteEnabled) roomStore.setActiveRoomId(id);
      setActiveRoomId(id);
      setGame(saved);
      lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
      if (remotePayload) applyRemoteSession(remotePayload.session);
      navigate({ kind: "room", roomId: id });
      setShowResult(isFinishedGame(saved));
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
    } finally {
      finishLoading();
    }
  }

  async function createAndOpenRoom(newSettings: NewGameSettings) {
    if (!canCreateRoom) {
      window.alert(createDisabledReason ?? "You cannot create a room right now.");
      return;
    }
    const created = createNewGame(newSettings);
    const finishLoading = startForegroundLoading("Creating room...");
    try {
      if (remoteEnabled) {
        if (!userId) return;
        const session = remoteRooms.emptyLiveSession(userId);
        const { id, meta } = await remoteRooms.createRoom(created, userId, session);
        setRooms((current) => [meta, ...current.filter((room) => room.id !== id)]);
        setActiveRoomId(id);
        lastAppliedStateKeyRef.current = makeRemoteStateKey(created);
        lastAppliedSessionKeyRef.current = makeLiveSessionKey(session);
        cancelDraftOnly();
        setReplayCursor(null);
        setGame(created);
        navigate({ kind: "room", roomId: id });
        setSyncError(null);
        return;
      }
      const { id, index } = roomStore.createRoom(created);
      setRooms(index);
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

  function goToLobby() {
    cancelDraftOnly();
    setReplayCursor(null);
    setShowResult(false);
    if (remoteEnabled) {
      setRoomsLoading(true);
      void remoteRooms
        .listRooms()
        .then(setRooms)
        .catch((error: Error) => setSyncError(error.message))
        .finally(() => setRoomsLoading(false));
    } else {
      setRooms(roomStore.listRooms());
    }
    navigate({ kind: "lobby" });
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
        await remoteRooms.updateRoomState({
          id,
          game: nextGame,
          session: id === activeRoomId ? liveSession : remoteRooms.emptyLiveSession(userId),
          event: "rename",
        });
        setRooms(await remoteRooms.listRooms());
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
        const { meta } = await remoteRooms.createRoom(copy, userId, session);
        setRooms((current) => [meta, ...current]);
        return;
      }
      const result = roomStore.duplicateRoom(id);
      if (result) setRooms(result.index);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to duplicate this room.");
    } finally {
      finishLoading();
    }
  }

  async function deleteRoomById(id: string) {
    if (!canManageRoom(id)) return;
    const meta = rooms.find((room) => room.id === id);
    if (!window.confirm(`Delete "${meta?.name ?? ""}"? This cannot be undone.`)) return;
    const finishLoading = startForegroundLoading("Deleting room...");
    try {
      if (remoteEnabled) {
        await remoteRooms.deleteRoom(id);
        setRooms((current) => current.filter((room) => room.id !== id));
        if (id === activeRoomId) {
          setActiveRoomId(null);
          setGame(null);
          navigate({ kind: "lobby" });
        }
        return;
      }
      const index = roomStore.deleteRoom(id);
      setRooms(index);
      if (id === activeRoomId) {
        setActiveRoomId(null);
        setGame(null);
        navigate({ kind: "lobby" });
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
      const saved = remoteEnabled ? (await remoteRooms.readRoom(id))?.game ?? null : roomStore.readRoom(id);
      if (saved) downloadGame(saved);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to export this room.");
    } finally {
      finishLoading();
    }
  }

  async function importRoomGame(imported: GameState) {
    if (!canCreateRoom) {
      window.alert(createDisabledReason ?? "You cannot import a room right now.");
      return;
    }
    const finishLoading = startForegroundLoading("Importing room...");
    try {
      if (remoteEnabled) {
        if (!userId) return;
        const copy = deepClone(imported);
        copy.gameId = crypto.randomUUID();
        const session = remoteRooms.emptyLiveSession(userId);
        const { meta } = await remoteRooms.createRoom(copy, userId, session);
        setRooms((current) => [meta, ...current]);
        return;
      }
      const { index } = roomStore.importRoom(imported);
      setRooms(index);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to import this room.");
    } finally {
      finishLoading();
    }
  }

  function getRoomRole(room: RoomMeta) {
    const canManage = canManageRoom(room.id);
    return {
      canManage,
      canCreate: canCreateRoom,
      label: !remoteEnabled
        ? "Local"
        : hasAdminAccess
          ? room.ownerId === userId
            ? "Admin · Owner"
            : "Admin"
          : canManage
            ? "Owner"
            : "Spectator",
    };
  }

  function canManageRoom(id: string): boolean {
    if (!remoteEnabled) return true;
    const room = rooms.find((item) => item.id === id);
    return Boolean(userId && (hasAdminAccess || room?.ownerId === userId));
  }

  function applyRemotePayload(payload: remoteRooms.RemoteRoomPayload) {
    if (hasDuplicateTileIds(payload.game)) throw new Error("Live room data is damaged.");
    const remoteGame = normalizeFinishedGame(payload.game);
    const key = makeRemoteStateKey(remoteGame);
    if (key !== lastAppliedStateKeyRef.current) {
      // Real state change (move / pause / end / etc.) — adopt the authoritative game.
      // Session-only updates (tile selection, drafts) skip this, so the spectator's
      // locally-ticking clock keeps running between moves (live countdown).
      lastAppliedStateKeyRef.current = key;
      setGame(remoteGame);
    }
    setSyncError(null);
  }

  function applyRemoteSession(session: LiveRoomSession) {
    const key = makeLiveSessionKey(session);
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

  function rackSlotsFrom(
    sourceGame: GameState,
    side: Side,
    layout: Record<Side, (string | null)[]> = rackLayoutRef.current,
  ): (TileInstance | null)[] {
    const tilesById = new Map(getRack(sourceGame, side).map((tile) => [tile.id, tile]));
    return layout[side].map((id) => (id ? tilesById.get(id) ?? null : null));
  }

  function rackFromSlots(sourceRack: TileInstance[], side: Side, layout: Record<Side, (string | null)[]>): TileInstance[] {
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

  function applyRackLayout(updater: (current: Record<Side, (string | null)[]>) => Record<Side, (string | null)[]>) {
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
      const target = slot >= 0 && slot < 8 ? slot : slots.indexOf(null);
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

  function rackSlotForTile(side: Side, tileId: string, layout: Record<Side, (string | null)[]> = rackLayoutRef.current) {
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
    canPlayActiveRoom &&
    game.status === "playing" &&
    !reviewing &&
    actionMode === "none" &&
    (game.phase === "choose_action" || isRackReady(game));
  const exchangeRule = getExchangeRule(game);
  const canStartExchange = canChooseAction && exchangeRule.allowed;
  const refillBaseline = refillBaselineRef.current;
  const canEditRefill =
    canChooseAction &&
    game.phase === "choose_action" &&
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

  function cancelAction() {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "state";
    if (actionMode === "place_equation" && pendingPlacements.length > 0) {
      const returningTiles = pendingPlacements.map((item) => clearTileAssignment(item.tile));
      let nextLayout = rackLayoutRef.current;
      for (const item of pendingPlacements) {
        const tile = clearTileAssignment(item.tile);
        const slots = nextLayout[game.activeSide].map((id) => (id === tile.id ? null : id));
        const target = item.rackSlot !== undefined && item.rackSlot >= 0 && item.rackSlot < 8 ? item.rackSlot : slots.indexOf(null);
        if (target >= 0) slots[target] = tile.id;
        nextLayout = { ...nextLayout, [game.activeSide]: slots };
      }
      rackLayoutRef.current = nextLayout;
      setRackLayout(nextLayout);
      const rack = rackFromSlots(
        [...getRack(game, game.activeSide).map(clearTileAssignment), ...returningTiles],
        game.activeSide,
        nextLayout,
      );
      setGame({
        ...setRack(game, game.activeSide, rack),
        phase: isRackReady({ ...setRack(game, game.activeSide, rack), phase: "refill" }) ? "choose_action" : "refill",
        lastSavedAt: new Date().toISOString(),
      });
    } else {
      setGame({
        ...game,
        phase: isRackReady(game) ? "choose_action" : "refill",
        lastSavedAt: new Date().toISOString(),
      });
    }
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
    if (!game || readOnly || reviewing || game.status !== "playing") return;
    if (getTileDrawMode(game) === "play") return;
    if (actionMode !== "none") return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    if (rack.length >= 8) return;
    const currentBaseline = refillBaselineRef.current;
    if (
      !currentBaseline ||
      !refillBaselineMatchesTurn(currentBaseline, game)
    ) {
      refillBaselineRef.current = captureRefillBaseline(game);
    }
    const nextRack = [...rack, tile];
    fillRackLayoutSlot(game.activeSide, rackLayoutRef.current[game.activeSide].indexOf(null), tile.id);
    const nextTilebag = game.tilebag.filter((candidate) => candidate.id !== tile.id);
    const rackReady = nextRack.length >= 8 || nextTilebag.length === 0;
    const pendingBySide = getPendingExchangeReturnBySide(game);
    const pendingReturn = rackReady ? pendingBySide[game.activeSide] : [];
    const nextPendingBySide = rackReady
      ? { ...pendingBySide, [game.activeSide]: [] }
      : pendingBySide;
    const finalTilebag = pendingReturn.length > 0 ? [...nextTilebag, ...pendingReturn] : nextTilebag;
    const nextGame = setRack(
      {
        ...game,
        tilebag: finalTilebag,
        pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
        pendingExchangeReturnBySide: nextPendingBySide,
        phase: rackReady ? "choose_action" : "refill",
        lastSavedAt: new Date().toISOString(),
      },
      game.activeSide,
      nextRack,
    );
    setGame(nextGame);
  }

  function editRefill() {
    if (!game || readOnly || reviewing || actionMode !== "none") return;
    if (game.phase !== "choose_action") return;
    const baseline = refillBaselineRef.current;
    if (!refillBaselineMatchesTurn(baseline, game)) return;
    pendingSessionEventRef.current = "state";
    const pendingBySide = deepClone(baseline.pendingExchangeReturnBySide);
    const baselineIdSet = new Set(baseline.ids);
    applyRackLayout((current) => ({
      ...current,
      [game.activeSide]: current[game.activeSide].map((id) => (id && baselineIdSet.has(id) ? id : null)),
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
    if (!game || readOnly || reviewing || actionMode !== "none") return;
    if (getTileDrawMode(game) === "play") return;
    pendingSessionEventRef.current = "state";
    if (game.phase !== "refill") return;
    const refillBaseline = refillBaselineRef.current;
    const baselineIds =
      refillBaselineMatchesTurn(refillBaseline, game)
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
          phase: nextRack.length >= 8 ? "choose_action" : "refill",
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
    setGame(
      setRack(
        {
          ...game,
          lastSavedAt: new Date().toISOString(),
        },
        game.activeSide,
        rackFromSlots(
          rack.filter((candidate) => candidate.id !== tile.id),
          game.activeSide,
          nextLayout,
        ),
      ),
    );
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
    const nextRack = rack.map((candidate, index) => (index === rackIndex ? returningTile : candidate));
    const nextLayout = fillRackLayoutSlot(game.activeSide, rackSlot ?? pending.rackSlot ?? -1, returningTile.id);
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
    setGame(
      setRack(
        {
          ...game,
          lastSavedAt: new Date().toISOString(),
        },
        game.activeSide,
        rackFromSlots(nextRack, game.activeSide, nextLayout),
      ),
    );
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
        setAssignmentRequest({ kind: "place", tile, row: target.row, col: target.col, dir: target.dir, rackSlot });
        return;
      }
      const rackSlot = replayDraft.rack.findIndex((t) => t?.id === tile.id);
      const nextPlacements: PendingPlacement[] = [
        ...replayDraft.placements,
        { tile, row: target.row, col: target.col, assignedToken: tile.assignedToken, cursorDir: target.dir, rackSlot },
      ];
      const nextRack = replayDraft.rack.map((t) => (t?.id === tile.id ? null : t));
      setReplayDraft({ rack: nextRack, placements: nextPlacements });
      setSelectedRackTileId(null);
      setSelectedPendingTileId(null);
      setPlacementCursor(advanceReplayCursor(target, nextPlacements));
      return;
    }
    if (selectedPendingTileId) {
      const pending = replayDraft.placements.find((placement) => placement.tile.id === selectedPendingTileId);
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
      const sameCell = placementCursor && placementCursor.row === row && placementCursor.col === col;
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
          setAssignmentRequest({ kind: "swapPending", tile: rackTile, pendingTileId: pending.tile.id });
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
    const target = index >= 0 && index < 8 ? index : nextRack.indexOf(null);
    if (target >= 0) {
      const displaced = nextRack[target];
      nextRack[target] = returningTile;
      if (displaced && displaced.id !== returningTile.id) {
        const emptyIndex = nextRack.findIndex((tile, tileIndex) => tileIndex !== target && tile === null);
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
    const pendingKeys = new Set(extraPending.map((placement) => `${placement.row}:${placement.col}`));
    while (true) {
      if (dir === "right") col += 1;
      else if (dir === "left") col -= 1;
      else if (dir === "down") row += 1;
      else row -= 1;
      if (row < 0 || col < 0 || row >= 15 || col >= 15) return null;
      const cellTaken = Boolean(selectedLog.boardBefore[row][col]) || pendingKeys.has(`${row}:${col}`);
      if (!cellTaken) return { row, col, dir };
    }
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
    const returningTile = { ...item.tile, assignedToken: item.assignedToken ?? item.tile.assignedToken };
    const nextLayout = fillRackLayoutSlot(side, index, returningTile.id);
    const nextRack = rackFromSlots(
      [...getRack(game, game.activeSide), returningTile],
      game.activeSide,
      nextLayout,
    );
    setPendingPlacements((current) => current.filter((p) => p.tile.id !== targetId));
    setGame(
      setRack(
        { ...game, lastSavedAt: new Date().toISOString() },
        game.activeSide,
        nextRack,
      ),
    );
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
    if (placementCursor && (actionMode === "none" ? canChooseAction : actionMode === "place_equation")) {
      if (actionMode === "none") startAction("place_equation");
      const target = placementCursor;
      const rackSlot = rackSlotForTile(game.activeSide, tile.id);
      if (requestAssignmentForTile(tile, { kind: "place", tile, row: target.row, col: target.col, dir: target.dir, rackSlot })) {
        // Need a value first; advance the cursor over this cell so the user
        // can continue placing once they pick a value.
        return;
      }
      placeRackTileOnBoard(tile, target.row, target.col, { cursorDir: target.dir, rackSlot });
      // Compute "next pending" inline so advanceCursor can skip the just-placed cell.
      const next = [
        ...pendingPlacements,
        { tile, row: target.row, col: target.col, assignedToken: tile.assignedToken, cursorDir: target.dir, rackSlot },
      ];
      const advanced = advanceCursor(target, next);
      setPlacementCursor(advanced);
      return;
    }
    if (actionMode === "place_equation") {
      if (selectedPendingTileId) {
        const pending = pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId);
        const rack = getRack(game, game.activeSide);
        const rackIndex = rack.findIndex((candidate) => candidate.id === tile.id);
        if (pending && rackIndex >= 0) {
          if (requestAssignmentForTile(tile, { kind: "swapPending", tile, pendingTileId: pending.tile.id })) return;
          swapRackTileWithPending(tile, pending);
          return;
        }
      }
      if (selectedRackTileId && selectedRackTileId !== tile.id) {
        const rack = getRack(game, game.activeSide);
        if (rack.some((candidate) => candidate.id === selectedRackTileId) && rack.some((candidate) => candidate.id === tile.id)) {
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
        if (refillBaselineMatchesTurn(refillBaseline, game) && refillBaseline.ids.includes(tile.id)) {
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
        if (rack.some((candidate) => candidate.id === selectedRackTileId) && rack.some((candidate) => candidate.id === tile.id)) {
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
      if (row < 0 || col < 0 || row >= 15 || col >= 15) return null;
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
    const occupied = Boolean(game.board[row][col]) ||
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
      const sameCell = placementCursor && placementCursor.row === row && placementCursor.col === col;
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
          if (requestAssignmentForTile(rackTile, { kind: "swapPending", tile: rackTile, pendingTileId: pending.tile.id })) return;
          swapRackTileWithPending(rackTile, pending);
        }
        return;
      }
      if (selectedPendingTileId && selectedPendingTileId !== pending.tile.id) {
        const selected = pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId);
        if (selected) {
          setPendingPlacements((current) =>
            current.map((placement) => {
              if (placement.tile.id === selected.tile.id) return { ...placement, row: pending.row, col: pending.col };
              if (placement.tile.id === pending.tile.id) return { ...placement, row: selected.row, col: selected.col };
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
      const selected = pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId);
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
    if (requestAssignmentForTile(tile, { kind: "place", tile, row, col, rackSlot: rackSlotForTile(game.activeSide, tile.id) })) return;
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
    const placements = replayPractice ? replayDraft?.placements ?? [] : pendingPlacements;
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
        const nextRack = replayDraft.rack.map((tile) => (tile?.id === assignedTile.id ? null : tile));
        setReplayDraft({ rack: nextRack, placements: nextPlacements });
        setSelectedRackTileId(null);
        setSelectedPendingTileId(null);
        if (assignmentRequest.dir) {
          setPlacementCursor(
            advanceReplayCursor(
              { row: assignmentRequest.row, col: assignmentRequest.col, dir: assignmentRequest.dir },
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
      const pending = replayDraft.placements.find((placement) => placement.tile.id === assignmentRequest.pendingTileId);
      if (pending) swapReplayRackTileWithPending(assignedTile, pending);
    } else {
      const pending = pendingPlacements.find((placement) => placement.tile.id === assignmentRequest.pendingTileId);
      if (pending) swapRackTileWithPending(assignedTile, pending);
    }
    setAssignmentRequest(null);
  }

  function commitLog(log: TurnLog, boardAfter: BoardSnapshot, rackAfter: TileInstance[], tilebagAfter: TileInstance[], floatingTiles?: TileInstance[]) {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "submit_action";
    const nextSide = otherSide(game.activeSide);
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
    const switchedBase = setRack(
      {
        ...game,
        board: boardAfter,
        tilebag: tilebagAfter,
        pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
        pendingExchangeReturnBySide: nextPendingBySide,
        logs,
        scores: calculateTotals(logs),
        activeSide: nextSide,
        turnNumber: game.turnNumber + 1,
        status: endGameLog ? "finished" : game.status,
        timers: endGameLog ? { ...game.timers, paused: true } : game.timers,
        phase: endGameLog ? "choose_action" as Phase : "refill" as Phase,
        currentTurnStartedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
      },
      game.activeSide,
      rackAfter,
    );
    let nextGame: GameState = {
      ...switchedBase,
      phase: endGameLog ? switchedBase.phase : phaseForNextSide(switchedBase),
    };
    if (
      !endGameLog &&
      getTileDrawMode(nextGame) === "play" &&
      nextGame.phase === "refill" &&
      !isRackReady(nextGame)
    ) {
      refillBaselineRef.current = captureRefillBaseline(nextGame);
      nextGame = refillRackFromQueue(nextGame);
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
    const effectiveActionStart =
      actionStart ?? {
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
    const boardAfter = boardWithPending(game.board, pendingPlacements, game.turnNumber, game.activeSide);
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
    // Keep the live clock — undo rewinds the play, not the timer.
    setGame(game ? { ...snap.game, timers: game.timers, lastSavedAt: new Date().toISOString() } : snap.game);
  }

  function undo() {
    if (readOnly || undoStackRef.current.length === 0) return;
    pendingSessionEventRef.current = "undo";
    const target = undoStackRef.current.pop()!;
    if (lastSnapRef.current) redoStackRef.current.push(lastSnapRef.current);
    applyUndoSnap(target);
    bumpUndoVersion((value) => value + 1);
  }

  function redo() {
    if (readOnly || redoStackRef.current.length === 0) return;
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
    if (!game || readOnly) return;
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
    if (!game || readOnly) return;
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

  function toggleTimer() {
    if (!game || readOnly || game.status !== "playing") return;
    pendingSessionEventRef.current = "timer_toggle";
    setGame({
      ...game,
      timers: {
        ...game.timers,
        paused: !game.timers.paused,
      },
      lastSavedAt: new Date().toISOString(),
    });
  }

  function endGame() {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "end_game";
    const confirmed = window.confirm(
      "End this game? It will be locked as finished — you can replay it later but cannot continue playing.",
    );
    if (!confirmed) return;
    cancelDraftOnly();
    setReplayCursor(null);
    // Snapshot the finish so undo/redo can step across it.
    setGame(
      pushActionSnapshot({
        ...game,
        status: "finished",
        timers: { ...game.timers, paused: true },
        lastSavedAt: new Date().toISOString(),
      }),
    );
    setShowResult(true);
  }

  // Resume a *drafted* game (the user previously hit Save & Exit). Finished
  // games are locked and never come back through here.
  function resumeGame() {
    if (!game || readOnly) return;
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
        currentTurnStartedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
      }),
    );
  }

  // Finished games and spectator views exit without touching persisted state.
  // Only a live, owner-controlled game is converted to a saved draft.
  function saveAndExit() {
    if (!game || readOnly || isFinishedGame(game)) {
      goToLobby();
      return;
    }
    if (game.status === "playing") {
      pendingSessionEventRef.current = "state";
      cancelDraftOnly();
      setReplayCursor(null);
      setGame({
        ...game,
        status: "draft",
        timers: { ...game.timers, paused: true },
        lastSavedAt: new Date().toISOString(),
      });
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
  const showViewPanel = reviewing || readOnly;
  const viewPanelLog = reviewing ? selectedLog : latestLog;
  const refillNeeded = game.phase === "refill" && game.status === "playing" && !isRackReady(game);
  const carriedOverTileIds = (() => {
    if (game.phase !== "refill" || game.status !== "playing") return new Set<string>();
    const baseline = refillBaselineRef.current;
    if (!refillBaselineMatchesTurn(baseline, game)) return new Set<string>();
    return new Set(baseline.ids);
  })();
  const tilebagView = getTilebagView({
    game,
    refillNeeded,
    reviewing,
    selectedLog,
  });
  const exchangeReady =
    actionMode === "exchange" &&
    exchangeDraft.outgoingIds.length > 0;
  const canPickFromTilebag =
    getTileDrawMode(game) !== "play" &&
    canPlayActiveRoom &&
    game.status === "playing" &&
    !reviewing &&
    refillNeeded &&
    actionMode === "none" &&
    activeRack.length < 8;
  const selectedRackTile =
    activeRack.find((tile) => tile.id === selectedRackTileId) ??
    pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId)?.tile;
  const currentTurnLogRack = actionStart?.rackBefore ?? activeRack;
  // Show one rack at a time — the side whose turn it is (or the reviewed side).
  const rackSide: Side = reviewing && selectedLog ? selectedLog.side : game.activeSide;
  // Build the 8-slot display rack from the layout so empty slots stay in
  // place when tiles leave for the board.
  const displayRack: (TileInstance | null)[] = (() => {
    if (reviewing && selectedLog) {
      const sourceRack =
        replayPhase === "before" ? replayDraft?.rack ?? selectedLog.rackBefore : selectedLog.rackAfter;
      return [...sourceRack, null, null, null, null, null, null, null, null].slice(0, 8);
    }
    const live = getRack(game, rackSide);
    const tilesById = new Map(live.map((tile) => [tile.id, tile]));
    return rackLayout[rackSide].map((id) => (id ? tilesById.get(id) ?? null : null));
  })();
  const rackConfigs = [
    {
      active: canPlayActiveRoom && !reviewing && game.status === "playing" && game.activeSide === rackSide,
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
          <span className={`role-badge ${readOnly ? "spectator" : "owner"}`}>{roleLabel}</span>
          <button
            className="icon-button"
            disabled={readOnly || undoStackRef.current.length === 0}
            title="Undo"
            type="button"
            onClick={undo}
          >
            <Undo2 size={18} />
            Undo
          </button>
          <button
            className="icon-button"
            disabled={readOnly || redoStackRef.current.length === 0}
            title="Redo"
            type="button"
            onClick={redo}
          >
            <Redo2 size={18} />
            Redo
          </button>
          <button className="icon-button" type="button" onClick={exportGame}>
            <Download size={18} />
            Export
          </button>
          <button
            className="icon-button top-save-exit"
            type="button"
            title={
              gameFinished
                ? "Exit this finished game and return to the lobby."
                : readOnly
                ? "Leave this room and return to the lobby."
                : game.status === "playing"
                  ? "Pause the clock, save the room as a draft, and go back to the lobby."
                  : "Save and return to the lobby."
            }
            onClick={saveAndExit}
          >
            <LogOut size={18} />
            {gameFinished || readOnly ? "Exit" : "Save or Exit"}
          </button>
          <button className="icon-button" type="button" onClick={() => setLogModalOpen(true)}>
            <List size={18} />
            Log
          </button>
          {!(game.timers.untimed || (game.timers.sideUntimed?.A && game.timers.sideUntimed?.B)) && (
            <button
              className={`icon-button top-stop-time ${game.timers.paused ? "paused" : "running"}`}
              disabled={readOnly || game.status !== "playing"}
              title={
                readOnly
                  ? "Only the room owner can control the clock."
                  : game.timers.paused
                    ? "Resume the clock"
                    : "Stop the clock"
              }
              type="button"
              onClick={toggleTimer}
            >
              {game.timers.paused ? <Play size={18} /> : <Pause size={18} />}
              {game.timers.paused ? "Resume" : "Stop"}
            </button>
          )}
          {/* Lifecycle button — its meaning depends on game.status.
              playing  → "End Game"        (danger, ends the match)
              draft    → "Resume"          (un-pauses + flips back to playing)
              finished → "Result + Replay" (no resume; this match is locked in) */}
          {!gameFinished && game.status === "playing" && (
            <button className="danger-button top-end-game" disabled={readOnly} type="button" onClick={endGame}>
              <Flag size={18} />
              End Game
            </button>
          )}
          {!gameFinished && game.status === "draft" && (
            <button
              className="resume-button top-end-game"
              disabled={readOnly}
              type="button"
              title="Resume this drafted game and start the clock again."
              onClick={resumeGame}
            >
              <Play size={18} />
              Resume
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
          <LogPanel
            game={game}
            selectedLogId={selectedLogId}
            onSelectLog={selectLog}
            onStarsChange={updateLogStars}
            onNoteChange={updateNote}
            currentTurnRack={currentTurnLogRack}
            readOnly={readOnly}
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
                    ? replayDraft?.placements ?? []
                    : []
                  : pendingPlacements
              }
              placementCursor={placementCursor}
              scoreAnchor={(() => {
                const placements = reviewing
                  ? replayPhase === "before"
                    ? replayDraft?.placements ?? []
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
                    .reduce((acc: typeof validation.equations[number] | null, eq) =>
                      !acc || eq.cells.length > acc.cells.length ? eq : acc, null);
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
                  isValid: validation.isValid,
                });
              })()}
              scoringKeys={scoringKeys}
              selectedPendingTileId={selectedPendingTileId}
              selectedRackTileId={selectedRackTileId}
              onCellClick={handleBoardCellClick}
              onPendingAssignmentEdit={openPendingAssignmentEditor}
            />
          </div>

          <div className="play-bar">
            <div className="play-caption">
              <span className="pc-room">{game.name}</span>
              <span className={`pc-rack-side side-${rackSide.toLowerCase()}`}>{game.players[rackSide]} Rack</span>
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
                    ? `Refill ${activeRack.length}/8`
                    : actionMode === "none"
                      ? "Choose action"
                      : ACTION_LABELS[actionMode]}
                </span>
              )}
            </div>
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
            tilebag={tilebagView.tiles}
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
        readOnly={readOnly}
        onSelectLog={selectLog}
      />

      {assignmentRequest && (
        <AssignmentModal
          request={assignmentRequest}
          onCancel={() => setAssignmentRequest(null)}
          onSelect={confirmAssignment}
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
    </main>
  );
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <main className="loading-screen" aria-busy="true">
      <div className="loading-panel" role="status" aria-live="polite">
        <span className="loading-kicker">Equation Board</span>
        <strong>{message}</strong>
        <LoadingTrack />
      </div>
    </main>
  );
}

function GlobalActivity({
  error,
  foreground,
  syncing,
}: {
  error?: string | null;
  foreground: string | null;
  syncing: boolean;
}) {
  if (foreground) {
    return (
      <div className="loading-overlay" aria-busy="true">
        <div className="loading-panel" role="status" aria-live="polite">
          <span className="loading-kicker">Please wait</span>
          <strong>{foreground}</strong>
          <LoadingTrack />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="network-activity error" role="alert">
        <strong>Sync failed</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (!syncing) return null;
  return (
    <div className="network-activity" role="status" aria-live="polite">
      <strong>Saving changes...</strong>
      <LoadingTrack />
    </div>
  );
}

function LoadingTrack() {
  return (
    <span className="loading-track" aria-hidden="true">
      <span />
    </span>
  );
}

function clearTileAssignment(tile: TileInstance): TileInstance {
  return { ...tile, assignedToken: undefined };
}

function refillRackFromQueue(game: GameState): GameState {
  const rack = getRack(game, game.activeSide);
  const pendingBySide = getPendingExchangeReturnBySide(game);
  const needed = Math.max(0, 8 - rack.length);
  const drawnTiles = game.tilebag.slice(0, needed).map(clearTileAssignment);
  const remainingQueue = game.tilebag.slice(drawnTiles.length);
  const rackAfter = [...rack, ...drawnTiles];
  const pendingReturn = pendingBySide[game.activeSide].map(clearTileAssignment);
  const nextPendingBySide = { ...pendingBySide, [game.activeSide]: [] };
  const rackReady = rackAfter.length >= 8 || remainingQueue.length === 0;
  const tilebagAfter = shuffleTilebagQueue([...remainingQueue, ...pendingReturn]);

  return setRack(
    {
      ...game,
      tilebag: tilebagAfter,
      pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
      pendingExchangeReturnBySide: nextPendingBySide,
      phase: rackReady ? "choose_action" : "refill",
      lastSavedAt: new Date().toISOString(),
    },
    game.activeSide,
    rackAfter,
  );
}

function getTilebagView({
  game,
  refillNeeded,
  reviewing,
  selectedLog,
}: {
  game: GameState;
  refillNeeded: boolean;
  reviewing: boolean;
  selectedLog: TurnLog | null;
}): TilebagView {
  if (reviewing && selectedLog) {
    return getReplayTilebagView(game, selectedLog);
  }
  if (refillNeeded) {
    return {
      tiles: game.tilebag,
      remainingCount: game.tilebag.length,
    };
  }
  return getActionTilebagView({
    opponentRack: getRack(game, otherSide(game.activeSide)),
    tilebag: game.tilebag,
  });
}

function getReplayTilebagView(game: GameState, selectedLog: TurnLog): TilebagView {
  const logIndex = game.logs.findIndex((log) => log.id === selectedLog.id);
  const previousLog = getLastPlayableLogBefore(game.logs, logIndex);
  const opponent = otherSide(selectedLog.side);
  const opponentRack = previousLog?.side === opponent ? previousLog.rackAfter : [];
  return getActionTilebagView({
    opponentRack,
    tilebag: selectedLog.tilebagBefore,
  });
}

function getActionTilebagView({
  opponentRack,
  tilebag,
}: {
  opponentRack: TileInstance[];
  tilebag: TileInstance[];
}): TilebagView {
  return {
    tiles: [...tilebag, ...opponentRack],
    remainingCount: getAnalysisRemainingCount(tilebag.length, opponentRack.length),
  };
}

function getAnalysisRemainingCount(
  tilebagCount: number,
  opponentRackCount: number,
): number {
  return Math.max(tilebagCount + opponentRackCount - 8, 0);
}

function getLastPlayableLogBefore(logs: TurnLog[], beforeIndex: number): TurnLog | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const log = logs[index];
    if (log.action !== "end_game") return log;
  }
  return null;
}

function getExchangeRule(game: GameState): { allowed: boolean; reserve: number; reason?: string } {
  const opponentRackCount = getRack(game, otherSide(game.activeSide)).length;
  const reserve = game.tilebag.length + opponentRackCount - 8;
  if (reserve >= 5) return { allowed: true, reserve };
  return {
    allowed: false,
    reserve,
    reason: `Exchange locked: tilebag (${game.tilebag.length}) + opponent rack (${opponentRackCount}) - 8 = ${reserve}; minimum is 5.`,
  };
}

function sumTilePoints(tiles: TileInstance[]): number {
  return tiles.reduce((sum, tile) => sum + tilePoint(tile), 0);
}

function createAutomaticEndGameLog({
  boardAfter,
  game,
  logs,
  normalLog,
  rackAfter,
  tilebagAfter,
}: {
  boardAfter: BoardSnapshot;
  game: GameState;
  logs: TurnLog[];
  normalLog: TurnLog;
  rackAfter: TileInstance[];
  tilebagAfter: TileInstance[];
}): TurnLog | null {
  const activeSide = game.activeSide;
  const opponentSide = otherSide(activeSide);
  const opponentRack = getRack(game, opponentSide);
  const now = new Date().toISOString();

  if (normalLog.action === "place_equation" && rackAfter.length === 0) {
    const remainingOpponentAndBag = opponentRack.length + tilebagAfter.length;
    if (remainingOpponentAndBag <= 8) {
      const opponentRackPoints = sumTilePoints(opponentRack);
      const tilebagPoints = sumTilePoints(tilebagAfter);
      const bonusPoints = (opponentRackPoints + tilebagPoints) * 2;
      const detail: EndGameDetail = {
        reason: "rack_out",
        description: `${game.players[activeSide]} emptied the rack. ${game.players[opponentSide]}'s rack and the tilebag contain ${remainingOpponentAndBag} tile(s).`,
        bonusSide: activeSide,
        bonusPoints,
        opponentRackPoints,
        tilebagPoints,
      };
      return createEndGameLog({
        boardAfter,
        detail,
        endedAt: now,
        game,
        rack: rackAfter,
        side: activeSide,
        tilebagAfter,
      });
    }
  }

  if (isNoScoreAction(normalLog.action) && hasSixTurnNoScoreStreak(logs)) {
    const rackBySide: Record<Side, TileInstance[]> = {
      A: activeSide === "A" ? rackAfter : getRack(game, "A"),
      B: activeSide === "B" ? rackAfter : getRack(game, "B"),
    };
    const rackPoints: Record<Side, number> = {
      A: sumTilePoints(rackBySide.A),
      B: sumTilePoints(rackBySide.B),
    };
    const bonusSide: Side | undefined =
      rackPoints.A === rackPoints.B ? undefined : rackPoints.A < rackPoints.B ? "A" : "B";
    const bonusPoints = bonusSide ? Math.abs(rackPoints.A - rackPoints.B) : 0;
    const scoringSide = bonusSide ?? activeSide;
    const detail: EndGameDetail = {
      reason: "no_score_streak",
      description: bonusSide
        ? `Six consecutive non-scoring turns. ${game.players[bonusSide]} has the lower rack total and receives ${bonusPoints} point(s).`
        : "Six consecutive non-scoring turns. Rack totals are tied, so no bonus is awarded.",
      bonusSide,
      bonusPoints,
      rackPoints,
      noScoreStreak: 6,
    };
    return createEndGameLog({
      boardAfter,
      detail,
      endedAt: now,
      game,
      rack: rackBySide[scoringSide],
      side: scoringSide,
      tilebagAfter,
    });
  }

  return null;
}

function isNoScoreAction(action: ActionType): boolean {
  return action === "pass" || action === "exchange";
}

function hasSixTurnNoScoreStreak(logs: TurnLog[]): boolean {
  const lastSix = logs.slice(-6);
  if (lastSix.length < 6) return false;
  if (!lastSix.every((log) => isNoScoreAction(log.action))) return false;
  const counts = lastSix.reduce<Record<Side, number>>(
    (total, log) => ({ ...total, [log.side]: total[log.side] + 1 }),
    { A: 0, B: 0 },
  );
  return counts.A === 3 && counts.B === 3;
}

function createEndGameLog({
  boardAfter,
  detail,
  endedAt,
  game,
  rack,
  side,
  tilebagAfter,
}: {
  boardAfter: BoardSnapshot;
  detail: EndGameDetail;
  endedAt: string;
  game: GameState;
  rack: TileInstance[];
  side: Side;
  tilebagAfter: TileInstance[];
}): TurnLog {
  return {
    id: crypto.randomUUID(),
    turnNumber: game.turnNumber,
    side,
    action: "end_game",
    startedAt: endedAt,
    endedAt,
    timerBefore: {
      A: game.timers.A,
      B: game.timers.B,
    },
    timerAfter: {
      A: game.timers.A,
      B: game.timers.B,
    },
    rackBefore: deepClone(rack),
    rackAfter: deepClone(rack),
    boardBefore: deepClone(boardAfter),
    boardAfter: deepClone(boardAfter),
    tilebagBefore: deepClone(tilebagAfter),
    tilebagAfter: deepClone(tilebagAfter),
    actionDetail: detail,
    calculatedScore: detail.bonusPoints,
    finalScore: detail.bonusPoints,
  };
}

function AssignmentModal({
  request,
  onCancel,
  onSelect,
}: {
  request: AssignmentRequest;
  onCancel: () => void;
  onSelect: (value: string) => void;
}) {
  const options = getAssignmentOptions(request.tile.token);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        aria-modal="true"
        className="assignment-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">Tile Assignment</span>
            <h2>Choose the tile value</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel}>
            <X size={18} />
            Cancel
          </button>
        </header>
        <div className="assignment-body">
          <Tile tile={request.tile} />
          <div className="assignment-options">
            {options.map((option) => (
              <button key={option} type="button" onClick={() => onSelect(option)}>
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function ResultModal({
  game,
  onClose,
  onReplay,
}: {
  game: GameState;
  onClose: () => void;
  onReplay: () => void;
}) {
  const { A, B } = game.scores;
  const winner = A === B ? null : A > B ? "A" : "B";
  const winnerName = winner ? game.players[winner] : null;
  const scoreMargin = Math.abs(A - B);
  const turnCount = Math.max(0, game.turnNumber - 1);
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="result-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head result-modal-head">
          <div>
            <span className="eyebrow">Final Result</span>
            <h2>{game.name}</h2>
          </div>
          <button className="result-close" type="button" aria-label="Close final result" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={`result-outcome ${winner ? `side-${winner.toLowerCase()}` : "draw"}`}>
          <span className="result-outcome-icon" aria-hidden="true">
            <Trophy size={22} />
          </span>
          <div>
            <span>{winner ? "Match winner" : "Match complete"}</span>
            <strong>{winnerName ?? "Draw"}</strong>
          </div>
          <em>{winner ? `+${scoreMargin} pts` : "Scores tied"}</em>
        </div>

        <div className="result-body">
          <div className={`result-side side-a ${winner === "A" ? "win" : ""}`}>
            <span className="result-side-label">Side A</span>
            <strong>{A}</strong>
            <span className="result-player-name">{game.players.A}</span>
            {winner === "A" && <em>Winner</em>}
          </div>
          <div className="result-vs">
            <strong>{winner === null ? "=" : "–"}</strong>
            <span>Final</span>
          </div>
          <div className={`result-side side-b ${winner === "B" ? "win" : ""}`}>
            <span className="result-side-label">Side B</span>
            <strong>{B}</strong>
            <span className="result-player-name">{game.players.B}</span>
            {winner === "B" && <em>Winner</em>}
          </div>
        </div>

        <div className="result-meta">
          <span><strong>{turnCount}</strong> turns</span>
          <span><strong>{game.logs.length}</strong> actions</span>
        </div>

        {/* Finished games are locked — only Replay / View Board are offered.
            Save & Exit lives in the top bar for going back to the lobby. */}
        <div className="result-actions">
          <button
            className="primary-action"
            type="button"
            disabled={game.logs.length === 0}
            onClick={onReplay}
          >
            <Play size={18} />
            Start Replay
          </button>
          <button className="result-view-board" type="button" onClick={onClose}>
            <LayoutGrid size={17} />
            View Board
          </button>
        </div>
      </section>
    </div>
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

function hasDuplicateTileIds(game: GameState): boolean {
  const ids = new Set<string>();
  const tiles: TileInstance[] = [
    ...game.tilebag,
    ...aggregatePendingExchangeReturns(getPendingExchangeReturnBySide(game)),
    ...game.rackA,
    ...game.rackB,
    ...game.board.flat().flatMap((cell) => (cell ? [cell.tile] : [])),
  ];
  for (const tile of tiles) {
    if (ids.has(tile.id)) return true;
    ids.add(tile.id);
  }
  return false;
}

function makeRemoteStateKey(game: GameState): string {
  return JSON.stringify({
    activeSide: game.activeSide,
    board: game.board,
    historyIndex: game.historyIndex,
    logs: game.logs,
    name: game.name,
    phase: game.phase,
    players: game.players,
    pendingExchangeReturn: aggregatePendingExchangeReturns(getPendingExchangeReturnBySide(game)),
    pendingExchangeReturnBySide: getPendingExchangeReturnBySide(game),
    rackA: game.rackA,
    rackB: game.rackB,
    scores: game.scores,
    status: game.status,
    tileDrawMode: getTileDrawMode(game),
    tilebag: game.tilebag,
    timers: {
      initialSeconds: game.timers.initialSeconds,
      initialSecondsBySide: game.timers.initialSecondsBySide,
      sideUntimed: game.timers.sideUntimed,
      minSeconds: game.timers.minSeconds,
      paused: game.timers.paused,
      untimed: game.timers.untimed,
    },
    turnNumber: game.turnNumber,
  });
}

function makeLiveSessionKey(session: LiveRoomSession): string {
  return JSON.stringify({
    actionMode: session.actionMode,
    exchangeDraft: session.exchangeDraft,
    pendingPlacements: session.pendingPlacements,
    selectedPendingTileId: session.selectedPendingTileId,
    selectedRackTileId: session.selectedRackTileId,
  });
}

export default App;
