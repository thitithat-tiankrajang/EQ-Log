import {
  Download,
  Flag,
  List,
  LayoutGrid,
  Play,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { ActionPanel } from "./components/ActionPanel";
import { Board } from "./components/Board";
import { Lobby } from "./components/Lobby";
import { LogModal } from "./components/LogModal";
import { LogPanel } from "./components/LogPanel";
import { PlayRail } from "./components/PlayRail";
import { Rack } from "./components/Rack";
import { Scoreboard } from "./components/Scoreboard";
import { Tile } from "./components/Tile";
import { useAuth } from "./auth";
import {
  ActionType,
  BoardSnapshot,
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
  isRackReady,
  otherSide,
  phaseForNextSide,
  pushActionSnapshot,
  setRack,
  tileNeedsAssignment,
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

type AssignmentRequest =
  | {
      kind: "place";
      tile: TileInstance;
      row: number;
      col: number;
    }
  | {
      kind: "swapPending";
      tile: TileInstance;
      pendingTileId: string;
    };

type RefillBaseline = {
  gameId: string;
  ids: string[];
  side: Side;
  turnNumber: number;
};

// One undoable "record": the full game + draft state at a single step.
type UndoSnap = {
  game: GameState;
  actionMode: ActionMode;
  pendingPlacements: PendingPlacement[];
  exchangeDraft: ExchangeDraft;
};

function App() {
  const { configured: authConfigured, isApproved, profile, userId } = useAuth();
  const remoteEnabled = isSupabaseConfigured;
  const [rooms, setRooms] = useState<RoomMeta[]>(() => (remoteEnabled ? [] : roomStore.listRooms()));
  const [roomsLoading, setRoomsLoading] = useState(remoteEnabled);
  const [syncError, setSyncError] = useState<string | null>(null);
  const route = useRoute();
  const [game, setGame] = useState<GameState | null>(() => {
    if (remoteEnabled) return null;
    const id = route.kind === "room" ? route.roomId : roomStore.getActiveRoomId();
    if (!id) return null;
    const saved = roomStore.readRoom(id);
    return saved && !hasDuplicateTileIds(saved) ? saved : null;
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
  const [exchangeDraft, setExchangeDraft] = useState<ExchangeDraft>({
    outgoingIds: [],
    incomingTiles: [],
  });
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [assignmentRequest, setAssignmentRequest] = useState<AssignmentRequest | null>(null);
  const [boardCell, setBoardCell] = useState(34);
  const refillBaselineRef = useRef<RefillBaseline | null>(null);
  const boardZoneRef = useRef<HTMLElement | null>(null);
  const activeRoomIdRef = useRef<string | null>(activeRoomId);
  const isOwnerRef = useRef(false);
  const pendingSessionEventRef = useRef<RoomSessionEvent | null>(null);
  const lastAppliedStateKeyRef = useRef<string>("");
  const undoStackRef = useRef<UndoSnap[]>([]);
  const redoStackRef = useRef<UndoSnap[]>([]);
  const lastSnapRef = useRef<UndoSnap | null>(null);
  const lastMutationKeyRef = useRef<string>("");
  const restoringUndoRef = useRef(false);
  const [, bumpUndoVersion] = useState(0);

  const activeRoomMeta = activeRoomId ? rooms.find((room) => room.id === activeRoomId) ?? null : null;
  const canCreateRoom = !remoteEnabled || Boolean(userId && isApproved);
  const canPlayActiveRoom = !remoteEnabled || Boolean(userId && activeRoomMeta?.ownerId === userId);
  const readOnly = remoteEnabled && !canPlayActiveRoom;
  const roleLabel = !remoteEnabled ? "Local Control" : canPlayActiveRoom ? "Owner Control" : "Spectator Live";
  const createDisabledReason = authConfigured
    ? !userId
      ? "Sign in to create a room."
      : !isApproved
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
  const liveSessionKey = useMemo(
    () =>
      JSON.stringify({
        actionMode,
        exchangeDraft,
        pendingPlacements,
        selectedPendingTileId,
        selectedRackTileId,
      }),
    [actionMode, exchangeDraft, pendingPlacements, selectedPendingTileId, selectedRackTileId],
  );
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
    (async () => {
      try {
        const remotePayload = remoteEnabled ? await remoteRooms.readRoom(route.roomId) : null;
        const saved = remotePayload?.game ?? roomStore.readRoom(route.roomId);
        if (cancelled) return;
        if (!saved || hasDuplicateTileIds(saved)) {
          navigate({ kind: "lobby" }, true);
          return;
        }
        if (!remoteEnabled) roomStore.setActiveRoomId(route.roomId);
        setActiveRoomId(route.roomId);
        setGame(saved);
        lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
        if (remotePayload) applyRemoteSession(remotePayload.session);
        setShowResult(saved.status === "finished");
      } catch (error) {
        if (!cancelled) setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
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
    if (!remoteEnabled) return;
    return remoteRooms.subscribeToRooms((payload) => {
      void remoteRooms
        .listRooms()
        .then(setRooms)
        .catch((error: Error) => setSyncError(error.message));

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
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled]);

  useEffect(() => {
    if (view !== "game" || !game || game.status !== "playing" || game.timers.paused || game.timers.untimed)
      return;
    const intervalId = window.setInterval(() => {
      setGame((current) => {
        if (!current || current.status !== "playing" || current.timers.paused) return current;
        const side = current.activeSide;
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
  }, [view, game?.activeSide, game?.status, game?.timers.paused]);

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
    const event = pendingSessionEventRef.current ?? "state";
    pendingSessionEventRef.current = null;
    void remoteRooms
      .updateRoomState({
        id: activeRoomId,
        game,
        session: liveSession,
        event,
      })
      .then(() => setSyncError(null))
      .catch((error: Error) => setSyncError(error.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteEnabled, activeRoomId, canPlayActiveRoom, remoteStateKey]);

  // Supabase live draft sync: lets spectators see pending placement/exchange state.
  useEffect(() => {
    if (!remoteEnabled || !activeRoomId || !canPlayActiveRoom) return;
    void remoteRooms
      .updateRoomSession(activeRoomId, liveSession)
      .then(() => setSyncError(null))
      .catch((error: Error) => setSyncError(error.message));
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
    if (!game || view !== "game" || game.status !== "playing" || game.phase !== "refill") {
      refillBaselineRef.current = null;
      return;
    }
    const current = refillBaselineRef.current;
    if (
      current &&
      current.gameId === game.gameId &&
      current.side === game.activeSide &&
      current.turnNumber === game.turnNumber
    ) {
      return;
    }
    refillBaselineRef.current = {
      gameId: game.gameId,
      ids: getRack(game, game.activeSide).map((tile) => tile.id),
      side: game.activeSide,
      turnNumber: game.turnNumber,
    };
  }, [game, view]);

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
      const labelGutter = 22; // room for the R / C number gutters around the board
      const sizeByWidth = (w - 4 - labelGutter) / 15;
      const sizeByHeight = (h - rackChrome - labelGutter) / (15 + rackHeightRatio);
      const size = Math.max(16, Math.min(72, Math.floor(Math.min(sizeByWidth, sizeByHeight))));
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
  const effectiveTilebag = useMemo(() => {
    if (!game) return [];
    return game.tilebag;
  }, [game]);

  const validation = useMemo(() => {
    if (!game || actionMode !== "place_equation") {
      return { isValid: false, errors: [], equations: [], score: 0, bingoBonus: 0 };
    }
    return validateMove(game.board, pendingPlacements);
  }, [actionMode, game, pendingPlacements]);

  const selectedLog = useMemo(() => {
    if (!game || !selectedLogId) return null;
    return game.logs.find((log) => log.id === selectedLogId) ?? null;
  }, [game, selectedLogId]);

  if (view !== "game" || !game) {
    return (
      <Lobby
        canCreate={canCreateRoom}
        createDisabledReason={createDisabledReason}
        loading={roomsLoading}
        rooms={rooms}
        syncError={syncError}
        getRoomRole={getRoomRole}
        onOpen={openRoom}
        onCreate={createAndOpenRoom}
        onRename={renameRoomById}
        onDuplicate={duplicateRoomById}
        onDelete={deleteRoomById}
        onExport={exportRoomById}
        onImport={importRoomGame}
      />
    );
  }

  async function openRoom(id: string) {
    try {
      const remotePayload = remoteEnabled ? await remoteRooms.readRoom(id) : null;
      const saved = remotePayload?.game ?? roomStore.readRoom(id);
      if (!saved || hasDuplicateTileIds(saved)) {
        window.alert("This room cannot be opened because its data is damaged.");
        return;
      }
      cancelDraftOnly();
      setSelectedLogId(null);
      if (!remoteEnabled) roomStore.setActiveRoomId(id);
      setActiveRoomId(id);
      setGame(saved);
      lastAppliedStateKeyRef.current = makeRemoteStateKey(saved);
      if (remotePayload) applyRemoteSession(remotePayload.session);
      navigate({ kind: "room", roomId: id });
      setShowResult(saved.status === "finished");
      setSyncError(null);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to open this room.");
    }
  }

  async function createAndOpenRoom(newSettings: NewGameSettings) {
    if (!canCreateRoom) {
      window.alert(createDisabledReason ?? "You cannot create a room right now.");
      return;
    }
    const created = createNewGame(newSettings);
    try {
      if (remoteEnabled) {
        if (!userId) return;
        const session = remoteRooms.emptyLiveSession(userId);
        const { id, meta } = await remoteRooms.createRoom(created, userId, session);
        setRooms((current) => [meta, ...current.filter((room) => room.id !== id)]);
        setActiveRoomId(id);
        cancelDraftOnly();
        setSelectedLogId(null);
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
      setSelectedLogId(null);
      setGame(created);
      navigate({ kind: "room", roomId: id });
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to create this room.");
    }
  }

  function goToLobby() {
    cancelDraftOnly();
    setSelectedLogId(null);
    setShowResult(false);
    if (remoteEnabled) {
      void remoteRooms
        .listRooms()
        .then(setRooms)
        .catch((error: Error) => setSyncError(error.message));
    } else {
      setRooms(roomStore.listRooms());
    }
    navigate({ kind: "lobby" });
  }

  async function renameRoomById(id: string, name: string) {
    if (!canManageRoom(id)) return;
    const trimmed = name.trim();
    if (!trimmed) return;
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
  }

  async function duplicateRoomById(id: string) {
    if (!canCreateRoom || !canManageRoom(id)) return;
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
  }

  async function deleteRoomById(id: string) {
    if (!canManageRoom(id)) return;
    const meta = rooms.find((room) => room.id === id);
    if (!window.confirm(`Delete "${meta?.name ?? ""}"? This cannot be undone.`)) return;
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
  }

  async function exportRoomById(id: string) {
    const saved = remoteEnabled ? (await remoteRooms.readRoom(id))?.game ?? null : roomStore.readRoom(id);
    if (saved) downloadGame(saved);
  }

  async function importRoomGame(imported: GameState) {
    if (!canCreateRoom) {
      window.alert(createDisabledReason ?? "You cannot import a room right now.");
      return;
    }
    if (remoteEnabled) {
      if (!userId) return;
      const copy = deepClone(imported);
      copy.gameId = crypto.randomUUID();
      const session = remoteRooms.emptyLiveSession(userId);
      const { meta } = await remoteRooms.createRoom(copy, userId, session);
      await remoteRooms.appendRoomSession(meta.id, copy, session, "import");
      setRooms((current) => [meta, ...current]);
      return;
    }
    const { index } = roomStore.importRoom(imported);
    setRooms(index);
  }

  function getRoomRole(room: RoomMeta) {
    const canManage = canManageRoom(room.id);
    return {
      canManage,
      canCreate: canCreateRoom,
      label: !remoteEnabled ? "Local" : canManage ? "Owner" : "Spectator",
    };
  }

  function canManageRoom(id: string): boolean {
    if (!remoteEnabled) return true;
    const room = rooms.find((item) => item.id === id);
    return Boolean(userId && room?.ownerId === userId);
  }

  function applyRemotePayload(payload: remoteRooms.RemoteRoomPayload) {
    if (hasDuplicateTileIds(payload.game)) throw new Error("Live room data is damaged.");
    const key = makeRemoteStateKey(payload.game);
    if (key !== lastAppliedStateKeyRef.current) {
      // Real state change (move / pause / end / etc.) — adopt the authoritative game.
      // Session-only updates (tile selection, drafts) skip this, so the spectator's
      // locally-ticking clock keeps running between moves (live countdown).
      lastAppliedStateKeyRef.current = key;
      setGame(payload.game);
    }
    applyRemoteSession(payload.session);
    setSyncError(null);
  }

  function applyRemoteSession(session: LiveRoomSession) {
    setActionMode(session.actionMode);
    setPendingPlacements(session.pendingPlacements);
    setExchangeDraft(session.exchangeDraft);
    setSelectedRackTileId(session.selectedRackTileId);
    setSelectedPendingTileId(session.selectedPendingTileId);
    setAssignmentRequest(null);
    setActionStart(null);
  }

  const reviewBoard = selectedLog?.boardAfter;
  const boardToRender =
    reviewBoard ??
    (actionMode === "place_equation"
      ? boardWithPending(game.board, pendingPlacements, game.turnNumber, game.activeSide)
      : game.board);
  const reviewing = Boolean(selectedLog);
  const canChooseAction =
    canPlayActiveRoom &&
    game.status === "playing" &&
    !reviewing &&
    actionMode === "none" &&
    (game.phase === "choose_action" || isRackReady(game));

  function startAction(action: ActionType) {
    if (!game || !canChooseAction || readOnly) return;
    pendingSessionEventRef.current = "state";
    setActionMode(action);
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
    setSelectedLogId(null);
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
      const rack = [
        ...getRack(game, game.activeSide).map(clearTileAssignment),
        ...pendingPlacements.map((item) => clearTileAssignment(item.tile)),
      ];
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
  }

  function refillFromBag(tile: TileInstance) {
    if (!game || readOnly || reviewing || game.status !== "playing") return;
    if (actionMode !== "none") return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    if (rack.length >= 8) return;
    const nextRack = [...rack, tile];
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

  function returnRackTileToBag(tile: TileInstance) {
    if (!game || readOnly || reviewing || actionMode !== "none") return;
    pendingSessionEventRef.current = "state";
    if (game.phase !== "refill") return;
    const refillBaseline = refillBaselineRef.current;
    const baselineIds =
      refillBaseline &&
      refillBaseline.gameId === game.gameId &&
      refillBaseline.side === game.activeSide &&
      refillBaseline.turnNumber === game.turnNumber
        ? refillBaseline.ids
        : getRack(game, game.activeSide).map((rackTile) => rackTile.id);
    if (baselineIds.includes(tile.id)) return;
    const rack = getRack(game, game.activeSide);
    const nextRack = rack.filter((candidate) => candidate.id !== tile.id);
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

  function placeRackTileOnBoard(tile: TileInstance, row: number, col: number) {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "state";
    const rack = getRack(game, game.activeSide);
    if (!rack.some((candidate) => candidate.id === tile.id)) return;
    const placement: PendingPlacement = {
      tile,
      row,
      col,
      assignedToken: tile.assignedToken,
    };
    setPendingPlacements((current) => [...current, placement]);
    setGame(
      setRack(
        {
          ...game,
          lastSavedAt: new Date().toISOString(),
        },
        game.activeSide,
        rack.filter((candidate) => candidate.id !== tile.id),
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
    const returningTile = {
      ...pending.tile,
      assignedToken: pending.assignedToken ?? pending.tile.assignedToken,
    };
    const nextRack = rack.map((candidate, index) => (index === rackIndex ? returningTile : candidate));
    setPendingPlacements((current) =>
      current.map((placement) =>
        placement.tile.id === pending.tile.id
          ? {
              ...placement,
              tile: rackTile,
              assignedToken: rackTile.assignedToken,
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
        nextRack,
      ),
    );
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
  }

  function handleRackTileClick(tile: TileInstance, side: Side) {
    if (!game || readOnly || reviewing || game.status !== "playing") return;
    if (side !== game.activeSide) return;
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
        const selectedIndex = rack.findIndex((candidate) => candidate.id === selectedRackTileId);
        const targetIndex = rack.findIndex((candidate) => candidate.id === tile.id);
        if (selectedIndex >= 0 && targetIndex >= 0) {
          const nextRack = [...rack];
          [nextRack[selectedIndex], nextRack[targetIndex]] = [nextRack[targetIndex], nextRack[selectedIndex]];
          setGame(
            setRack(
              {
                ...game,
                lastSavedAt: new Date().toISOString(),
              },
              game.activeSide,
              nextRack,
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
        const baselineIds =
          refillBaseline &&
          refillBaseline.gameId === game.gameId &&
          refillBaseline.side === game.activeSide &&
          refillBaseline.turnNumber === game.turnNumber
            ? refillBaseline.ids
            : [];
        if (!baselineIds.includes(tile.id)) {
          returnRackTileToBag(tile);
          return;
        }
      }
      if (selectedRackTileId && selectedRackTileId !== tile.id) {
        const rack = getRack(game, game.activeSide);
        const selectedIndex = rack.findIndex((candidate) => candidate.id === selectedRackTileId);
        const targetIndex = rack.findIndex((candidate) => candidate.id === tile.id);
        if (selectedIndex >= 0 && targetIndex >= 0) {
          const nextRack = [...rack];
          [nextRack[selectedIndex], nextRack[targetIndex]] = [nextRack[targetIndex], nextRack[selectedIndex]];
          setGame(
            setRack(
              {
                ...game,
                lastSavedAt: new Date().toISOString(),
              },
              game.activeSide,
              nextRack,
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

  function handleBoardCellClick(row: number, col: number) {
    if (!game || readOnly || reviewing || actionMode !== "place_equation") return;
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
      if (!selectedPendingTileId) {
        setSelectedRackTileId(null);
        setSelectedPendingTileId(pending.tile.id);
        return;
      }
      setPendingPlacements((current) =>
        current.filter((item) => item.tile.id !== pending.tile.id),
      );
      setGame(
        setRack(
          {
            ...game,
            lastSavedAt: new Date().toISOString(),
          },
          game.activeSide,
          [
            ...getRack(game, game.activeSide),
            { ...pending.tile, assignedToken: pending.assignedToken ?? pending.tile.assignedToken },
          ],
        ),
      );
      setSelectedPendingTileId(null);
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
    if (requestAssignmentForTile(tile, { kind: "place", tile, row, col })) return;
    placeRackTileOnBoard(tile, row, col);
  }

  function updatePendingAssignment(tileId: string, assignedToken: string) {
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

  function confirmAssignment(value: string) {
    if (!assignmentRequest || readOnly) return;
    pendingSessionEventRef.current = "state";
    const assignedTile = {
      ...assignmentRequest.tile,
      assignedToken: value,
    };
    if (assignmentRequest.kind === "place") {
      placeRackTileOnBoard(assignedTile, assignmentRequest.row, assignmentRequest.col);
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
    const logs = [...game.logs, log];
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
        phase: "refill" as Phase,
        currentTurnStartedAt: new Date().toISOString(),
        lastSavedAt: new Date().toISOString(),
      },
      game.activeSide,
      rackAfter,
    );
    const nextGame = {
      ...switchedBase,
      phase: phaseForNextSide(switchedBase),
    };
    setGame(pushActionSnapshot(nextGame));
    setActionMode("none");
    setActionStart(null);
    setPendingPlacements([]);
    setExchangeDraft({ outgoingIds: [], incomingTiles: [] });
    setSelectedRackTileId(null);
    setSelectedPendingTileId(null);
    setAssignmentRequest(null);
  }

  function confirmPlace() {
    if (readOnly || !game || !actionStart || actionMode !== "place_equation" || !validation.isValid) return;
    const now = new Date().toISOString();
    const boardAfter = boardWithPending(game.board, pendingPlacements, game.turnNumber, game.activeSide);
    const rackAfter = deepClone(getRack(game, game.activeSide)).map(clearTileAssignment);
    const detail: PlaceEquationDetail = createPlaceDetail(validation, pendingPlacements);
    const log = createTurnLog({
      game,
      action: "place_equation",
      actionStart,
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
    if (exchangeDraft.outgoingIds.length === 0) return;
    const outgoingSet = new Set(exchangeDraft.outgoingIds);
    const outgoingTiles = getRack(game, game.activeSide).filter((tile) => outgoingSet.has(tile.id));
    const rackAfter = getRack(game, game.activeSide).filter((tile) => !outgoingSet.has(tile.id));
    const tilebagAfter = game.tilebag;
    const floatingTiles = outgoingTiles.map((tile) => ({ ...tile, assignedToken: undefined }));
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
    commitLog(log, game.board, rackAfter, tilebagAfter, floatingTiles);
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
    setSelectedLogId(null);
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
    const confirmed = window.confirm("End this game? You can reopen and continue it later.");
    if (!confirmed) return;
    cancelDraftOnly();
    setSelectedLogId(null);
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

  // Owner reopens a finished game to keep playing; new turns append to the log.
  function resumeGame() {
    if (!game || readOnly) return;
    pendingSessionEventRef.current = "resume_game";
    setShowResult(false);
    setSelectedLogId(null);
    cancelDraftOnly();
    setGame(
      pushActionSnapshot({
        ...game,
        status: "playing",
        lastSavedAt: new Date().toISOString(),
      }),
    );
  }

  function exportGame() {
    if (game) downloadGame(game);
  }

  function startReplay() {
    if (!game || game.logs.length === 0) return;
    setShowResult(false);
    setSelectedLogId(game.logs[0].id);
  }

  // Step the replay across the turn log (board renders the selected log's boardAfter).
  function replayStep(delta: number) {
    if (!game) return;
    const ids = game.logs.map((log) => log.id);
    const idx = selectedLogId ? ids.indexOf(selectedLogId) : -1;
    const next = idx + delta;
    if (next < 0) return;
    if (next >= ids.length) {
      setSelectedLogId(null); // past the last move → back to the final/live board
      return;
    }
    setSelectedLogId(ids[next]);
  }

  const replayIndex = selectedLogId ? game.logs.findIndex((log) => log.id === selectedLogId) : -1;
  const latestLog = game.logs.at(-1) ?? null;
  const showViewPanel = reviewing || readOnly;
  const viewPanelLog = reviewing ? selectedLog : latestLog;
  const refillNeeded = game.phase === "refill" && game.status === "playing";
  const exchangeReady =
    actionMode === "exchange" &&
    exchangeDraft.outgoingIds.length > 0;
  const canPickFromTilebag =
    canPlayActiveRoom &&
    game.status === "playing" &&
    !reviewing &&
    actionMode === "none" &&
    activeRack.length < 8;
  const selectedRackTile =
    activeRack.find((tile) => tile.id === selectedRackTileId) ??
    pendingPlacements.find((placement) => placement.tile.id === selectedPendingTileId)?.tile;
  const currentTurnLogRack = actionStart?.rackBefore ?? activeRack;
  // Show one rack at a time — the side whose turn it is (or the reviewed side).
  const rackSide: Side = reviewing && selectedLog ? selectedLog.side : game.activeSide;
  const rackConfigs = [
    {
      active: canPlayActiveRoom && !reviewing && game.status === "playing" && game.activeSide === rackSide,
      exchangeOutgoingIds: rackSide === game.activeSide ? exchangeDraft.outgoingIds : [],
      label: game.players[rackSide],
      rack: reviewing && selectedLog ? selectedLog.rackAfter : getRack(game, rackSide),
      side: rackSide,
    },
  ];

  return (
    <main className="app-shell">
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
          <button className="icon-button" type="button" onClick={goToLobby}>
            <LayoutGrid size={18} />
            Rooms
          </button>
          <button className="icon-button" type="button" onClick={() => setLogModalOpen(true)}>
            <List size={18} />
            Log
          </button>
          {game.status === "playing" ? (
            <button className="danger-button top-end-game" disabled={readOnly} type="button" onClick={endGame}>
              <Flag size={18} />
              End Game
            </button>
          ) : (
            <button className="resume-button top-end-game" disabled={readOnly} type="button" onClick={resumeGame}>
              <Play size={18} />
              Resume Game
            </button>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="log-rail">
          <Scoreboard game={game} readOnly={readOnly} onToggleTimer={toggleTimer} />
          <LogPanel
            game={game}
            selectedLogId={selectedLogId}
            onSelectLog={setSelectedLogId}
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
              pendingPlacements={reviewing ? [] : pendingPlacements}
              selectedPendingTileId={selectedPendingTileId}
              selectedRackTileId={selectedRackTileId}
              onCellClick={handleBoardCellClick}
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
              ) : game.status === "finished" ? (
                <span className="pc-actions">
                  <button type="button" onClick={() => setShowResult(true)}>
                    Result
                  </button>
                  <button type="button" disabled={game.logs.length === 0} onClick={startReplay}>
                    ▶ Replay
                  </button>
                </span>
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
              exchangeOutgoingIds={rackConfigs[0].exchangeOutgoingIds}
              label={rackConfigs[0].label}
              rack={rackConfigs[0].rack}
              selectedRackTileId={selectedRackTileId}
              side={rackConfigs[0].side}
              onTileClick={handleRackTileClick}
            />
          </div>
        </section>

        <aside className="right-rail">
          <PlayRail
            game={game}
            tilebag={effectiveTilebag}
            tilebagDisabled={!canPickFromTilebag}
            onPickTile={refillFromBag}
          />

          <ActionPanel
            activeRack={activeRack}
            actionMode={actionMode}
            canChooseAction={canChooseAction}
            exchangeDraft={exchangeDraft}
            exchangeReady={exchangeReady}
            game={game}
            pendingPlacements={pendingPlacements}
            readOnly={readOnly}
            refillNeeded={refillNeeded}
            replayIndex={replayIndex}
            reviewing={reviewing}
            showViewPanel={showViewPanel}
            validation={validation}
            viewPanelLog={viewPanelLog}
            onCancelAction={cancelAction}
            onConfirmExchange={confirmExchange}
            onConfirmPass={confirmPass}
            onConfirmPlace={confirmPlace}
            onReplayExit={() => setSelectedLogId(null)}
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
        onSelectLog={setSelectedLogId}
      />

      {assignmentRequest && (
        <AssignmentModal
          request={assignmentRequest}
          onCancel={() => setAssignmentRequest(null)}
          onSelect={confirmAssignment}
        />
      )}

      {showResult && game.status === "finished" && (
        <ResultModal
          game={game}
          onClose={() => setShowResult(false)}
          onReplay={() => {
            setShowResult(false);
            startReplay();
          }}
          canResume={!readOnly}
          onResume={resumeGame}
        />
      )}
    </main>
  );
}

function clearTileAssignment(tile: TileInstance): TileInstance {
  return { ...tile, assignedToken: undefined };
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
  canResume,
  onClose,
  onReplay,
  onResume,
}: {
  game: GameState;
  canResume: boolean;
  onClose: () => void;
  onReplay: () => void;
  onResume: () => void;
}) {
  const { A, B } = game.scores;
  const winner = A === B ? null : A > B ? "A" : "B";
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-modal="true"
        className="result-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <div>
            <span className="eyebrow">Final Result</span>
            <h2>{game.name}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={18} />
            Close
          </button>
        </header>

        <div className="result-body">
          <div className={`result-side ${winner === "A" ? "win" : ""}`}>
            <span>{game.players.A}</span>
            <strong>{A}</strong>
            {winner === "A" && <em>Winner</em>}
          </div>
          <div className="result-vs">{winner === null ? "Draw" : "vs"}</div>
          <div className={`result-side ${winner === "B" ? "win" : ""}`}>
            <span>{game.players.B}</span>
            <strong>{B}</strong>
            {winner === "B" && <em>Winner</em>}
          </div>
        </div>

        <div className="result-meta">
          {game.turnNumber - 1} turns · {game.logs.length} actions
        </div>

        <div className="result-actions">
          <button className="primary-action" type="button" onClick={onReplay}>
            <Play size={18} />
            Start Replay
          </button>
          {canResume && (
            <button className="icon-button" type="button" onClick={onResume}>
              <Undo2 size={18} />
              Resume Game
            </button>
          )}
          <button className="icon-button" type="button" onClick={onClose}>
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
  detail: PlaceEquationDetail | ExchangeDetail | PassDetail;
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
    tilebag: game.tilebag,
    timers: {
      initialSeconds: game.timers.initialSeconds,
      minSeconds: game.timers.minSeconds,
      paused: game.timers.paused,
    },
    turnNumber: game.turnNumber,
  });
}

export default App;
