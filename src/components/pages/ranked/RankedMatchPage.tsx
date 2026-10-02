import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coffee, Flag, LogOut, Pause, Pencil, Play } from "lucide-react";
import "../../../play-styles.css";
import { Board } from "../../board/Board";
import { Rack } from "../../board/Rack";
import { MobileActionBar } from "../../mobile/MobileActionBar";
import { Scoreboard } from "../../game/Scoreboard";
import { ActionPanel } from "../../actions/ActionPanel";
import { PanelHeading } from "../../layout/PanelHeading";
import { PreGameShell } from "../pregame/PreGameShell";
import { OverflowMenu, type OverflowItem } from "../../ui/OverflowMenu";
import { TextPromptSheet } from "../../ui/Sheet";
import { RankedReadyConfirmation } from "./RankedStakes";
import { rankedClient } from "../../../features/ranked/client";
import { rankTier } from "../../../features/ranked/rating";
import type { RankedMatchView } from "../../../features/ranked/publicView";
import type { RankedAction } from "../../../features/ranked/rules";
import {
  boardWithPending,
  getAssignmentOptions,
  validateMove,
  type GameState,
  type PendingPlacement,
  type Side,
  type TileInstance,
} from "../../../game";
import { EXCHANGE_MIN_RESERVE, RACK_SIZE } from "../../../constants/gameRules";
import { resolveRackTile, tileRequestFromStroke } from "../../../gameplay/rackResolution";
import { resolveStudyKey } from "../../../gameplay/tileKeys";
import { navigate } from "../../../router";
import { analyzeOwnTurn } from "../../../liveGame/analysis";

import { HostedControls } from "../../../liveGame/HostedControls";
import type { HostedAction } from "../../../liveGame/hostedAdmin";
import { PhysicalControls } from "../../../liveGame/PhysicalControls";
import type { PhysicalAction } from "../../../liveGame/physical";
import type { LiveGameView } from "../../../liveGame/projection";
import { concealLocalView } from "../../../liveGame/client";
import { botDisplayName } from "../../../bot/archbot/identity";
import {
  HistoryControls,
  PauseSheets,
  WaitingControls,
} from "../../../liveGame/CompatibilityControls";
import { ContextTools, ToolSection, useMobilePlay } from "../../../liveGame/ContextTools";
import type { LiveControl } from "../../../liveGame/controls";
import { STORAGE_KEYS } from "../../../constants/storage";
import { ANALYSIS_LEVELS, type AnalysisLevel } from "../../../bot/engineApi";
import { LivePractice } from "../../../liveGame/LivePractice";
import { useLiveTileDrag } from "../../../liveGame/tileDrag";
import { loadPlayTools, type PlayTool } from "../../../playModeTools";

type ActionMode = "none" | "place_equation" | "exchange" | "pass";
type Direction = "right" | "down" | "left" | "up";
type PlacementCursor = { row: number; col: number; dir: Direction };
const DIRECTIONS: Direction[] = ["right", "down", "left", "up"];

function advanceCursor(
  cursor: PlacementCursor,
  board: RankedMatchView["board"],
  placements: PendingPlacement[],
): PlacementCursor | null {
  let { row, col } = cursor;
  const taken = new Set(placements.map((item) => `${item.row}:${item.col}`));
  while (true) {
    if (cursor.dir === "right") col += 1;
    else if (cursor.dir === "left") col -= 1;
    else if (cursor.dir === "down") row += 1;
    else row -= 1;
    if (row < 0 || col < 0 || row >= board.length || col >= board.length) return null;
    if (!board[row][col] && !taken.has(`${row}:${col}`)) return { row, col, dir: cursor.dir };
  }
}

// UI components receive only the public projection. Empty private collections
// are deliberate: the complete ranked state stays in the Edge Function.
function playUiGame(view: RankedMatchView, timers: Record<Side, number>): GameState {
  const now = new Date().toISOString();
  return {
    commitId: "",
    gameId: view.id,
    revision: view.revision,
    name: "Ranked match",
    gameMode: "versus",
    players: view.players,
    playerUserIds: { A: view.playerAId, ...(view.playerBId ? { B: view.playerBId } : {}) },
    emailPlayersCanSeeOpponentRack: false,
    roomStage: view.status === "waiting" || view.status === "matched" ? "waiting" : "playing",
    startingSide: view.startingSide,
    tileDrawMode: "play",
    turnNumber: view.turnNumber,
    activeSide: view.activeSide,
    phase: "choose_action",
    status:
      view.status === "finished" ? "finished" : view.status === "playing" ? "playing" : "draft",
    boardSize: view.board.length,
    board: view.board,
    rackA: view.yourSide === "A" ? view.yourRack : [],
    rackB: view.yourSide === "B" ? view.yourRack : [],
    tilebag: [],
    pendingExchangeReturn: [],
    timers: {
      A: timers.A,
      B: timers.B,
      initialSeconds: Math.max(timers.A, timers.B),
      paused: view.status !== "playing",
      minSeconds: 0,
    },
    scores: view.scores,
    logs: [],
    currentTurnStartedAt: view.clockStartedAt,
    createdAt: now,
    history: [],
    historyIndex: 0,
    lastSavedAt: now,
  };
}

/** The waiting room's clock line for a live room; untimed sides say so. */
function liveClockLine(view: LiveGameView) {
  const minutes = (side: Side) =>
    view.clockPolicy.untimed[side] ? null : Math.round(view.timers[side] / 60);
  const a = minutes("A"),
    b = minutes("B");
  if (a === null && b === null) return "ไม่จับเวลา";
  if (a === b) return `เวลา ${a} นาทีต่อฝ่าย`;
  const label = (value: number | null) => (value === null ? "ไม่จับเวลา" : `${value} นาที`);
  return `เวลา A ${label(a)} · B ${label(b)}`;
}

type MatchClient = Pick<typeof rankedClient, "read" | "action" | "ready" | "cancel"> & {
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

export function RankedMatchPage({
  matchId,
  client = rankedClient,
  title = "Ranked match",
  ranked = true,
}: {
  matchId: string;
  client?: MatchClient;
  title?: string;
  ranked?: boolean;
}) {
  const [match, setMatch] = useState<RankedMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clockTick, setClockTick] = useState(Date.now());
  const [mode, setMode] = useState<ActionMode>("none");
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<PlacementCursor | null>(null);
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);
  const [placements, setPlacements] = useState<PendingPlacement[]>([]);
  const [exchangeIds, setExchangeIds] = useState<string[]>([]);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [keyNotice, setKeyNotice] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [botBusy, setBotBusy] = useState(false);
  const [analysisLevel, setAnalysisLevel] = useState<AnalysisLevel>("quick");
  const [replayPhase, setReplayPhase] = useState<"before" | "after">("after");
  const [practice, setPractice] = useState(false);
  const [rackOrder, setRackOrder] = useState<(string | null)[]>([]);
  const [renaming, setRenaming] = useState(false);
  const isMobilePlay = useMobilePlay();
  const [playTools, setPlayTools] = useState<ReadonlySet<PlayTool>>(new Set());
  const toolMode = !ranked && match && "mode" in match ? String(match.mode) : "";
  useEffect(() => {
    let alive = true;
    setPlayTools(new Set());
    if (toolMode)
      void loadPlayTools(toolMode === "stage" ? "authur_strong" : toolMode).then((tools) => {
        if (alive) setPlayTools(tools);
      });
    return () => {
      alive = false;
    };
  }, [toolMode]);
  const analysisAbort = useRef<AbortController | null>(null);
  const blankArmedRef = useRef(false);
  const submittingRef = useRef(false);

  const botId = match?.id;
  const botRevision = match?.revision;
  const shouldRunBot = Boolean(match && "botTurn" in match && match.botTurn && match.yourSide);
  useEffect(() => {
    if (!botId || botRevision === undefined || !shouldRunBot || !client.botTurn) return;
    let alive = true;
    setBotBusy(true);
    void client
      .botTurn(botId, botRevision)
      .then(({ match: next }) => {
        if (alive)
          setMatch((current) => (current && current.revision > next.revision ? current : next));
      })
      .catch(
        (cause) =>
          alive &&
          setError(
            cause instanceof Error ? cause.message : "Bot turn unavailable. Reload and retry.",
          ),
      )
      .finally(() => {
        if (alive) setBotBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [client, botId, botRevision, shouldRunBot]);

  useEffect(() => {
    analysisAbort.current?.abort();
    setAnalyzing(false);
    setAnalysis(null);
    let alive = true;
    const refresh = async () => {
      try {
        const { match: next } = await client.read(matchId);
        if (alive)
          setMatch((current) =>
            current?.revision && current.revision > next.revision ? current : next,
          );
        if (alive) setError(null);
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "เปิดห้องจัดอันดับไม่สำเร็จ");
      }
    };
    void refresh();
    const unsubscribe = client.subscribe?.(matchId, () => void refresh());
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
      unsubscribe?.();
    };
  }, [matchId, client]);

  useEffect(() => {
    setMode("none");
    analysisAbort.current?.abort();
    setAnalysis(null);
    setAnalyzing(false);
    setPractice(false);
    setRackOrder([]);
    setSelectedTileId(null);
    setSelectedCell(null);
    setSelectedPendingId(null);
    setPlacements([]);
    setExchangeIds([]);
    setSelectedLogId(null);
    blankArmedRef.current = false;
    setKeyNotice(null);
  }, [match?.revision]);

  useEffect(() => () => analysisAbort.current?.abort(), []);
  useEffect(() => {
    if (
      !client.control ||
      !match ||
      !("launchAt" in match) ||
      !match.launchAt ||
      !("canConfigure" in match && match.canConfigure)
    )
      return;
    const timer = window.setTimeout(
      () => {
        void client.control!(match.id, match.revision, { kind: "start" })
          .then(({ match: next }) =>
            setMatch((current) => (current && current.revision > next.revision ? current : next)),
          )
          .catch((cause) => setError(String(cause)));
      },
      Math.max(0, Date.parse(String(match.launchAt)) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [client, match]);

  const visibleTime = useCallback(
    (side: Side) => {
      if (!match) return 0;
      const policy =
        "clockPolicy" in match
          ? (match.clockPolicy as { minSeconds: number; untimed: Partial<Record<Side, boolean>> })
          : null;
      const elapsed =
        match.status === "playing" &&
        !("paused" in match && match.paused) &&
        match.activeSide === side &&
        !policy?.untimed[side]
          ? Math.max(0, Math.floor((clockTick - Date.parse(match.clockStartedAt)) / 1000))
          : 0;
      return Math.max(policy?.minSeconds ?? 0, match.timers[side] - elapsed);
    },
    [clockTick, match],
  );
  const timers = { A: visibleTime("A"), B: visibleTime("B") };
  const uiGame = match ? playUiGame(match, timers) : null;
  const live = !ranked && match ? (match as LiveGameView) : null;
  const physicalHost = Boolean(live?.hostRacks);
  const currentRack = physicalHost ? live!.hostRacks![match!.activeSide] : (match?.yourRack ?? []);
  const selectedLog =
    [...(match?.logs ?? []), ...(live?.timeline?.lines.flatMap((line) => line.logs) ?? [])].find(
      (log) => log.id === selectedLogId,
    ) ?? null;
  const stagedIds = new Set(placements.map((item) => item.tile.id));
  const orderedIds = [
    ...rackOrder.filter((id) => id === null || currentRack.some((tile) => tile.id === id)),
    ...currentRack.filter((tile) => !rackOrder.includes(tile.id)).map((tile) => tile.id),
  ].slice(0, RACK_SIZE);
  const rackSlots = orderedIds.map((id) =>
    id && !stagedIds.has(id) ? currentRack.find((tile) => tile.id === id)! : null,
  );
  const unstagedRack = currentRack.filter((tile) => !stagedIds.has(tile.id));
  const isMyTurn = Boolean(
    match?.status === "playing" &&
    !("paused" in match && match.paused) &&
    !("continuationBlocked" in match && match.continuationBlocked) &&
    (match.yourSide === match.activeSide || physicalHost) &&
    !(live?.tileDrawMode === "manual" && live.phase === "refill") &&
    !selectedLog,
  );
  const canExchange = Boolean(
    match &&
    match.tilebagCount +
      match.rackCount[(physicalHost ? match.activeSide : match.yourSide) === "A" ? "B" : "A"] -
      RACK_SIZE >=
      EXCHANGE_MIN_RESERVE,
  );
  const validation = useMemo(
    () => (match ? validateMove(match.board, placements) : null),
    [match, placements],
  );
  const shownBoard =
    (selectedLog
      ? replayPhase === "before"
        ? (selectedLog.boardBefore ?? selectedLog.boardAfter)
        : selectedLog.boardAfter
      : null) ??
    (match ? boardWithPending(match.board, placements, match.turnNumber, match.activeSide) : null);

  useLiveTileDrag(isMyTurn && !busy && mode !== "exchange" && mode !== "pass", (id, target) => {
    const tile = currentRack.find((t) => t.id === id);
    if (!tile) return;
    const moving = placements.find((p) => p.tile.id === id);
    if ("slot" in target) {
      const ids = Array.from({ length: RACK_SIZE }, (_, index) => orderedIds[index] ?? null);
      const from = ids.indexOf(id);
      if (from < 0 || target.slot < 0 || target.slot >= RACK_SIZE) return;
      ids[from] = ids[target.slot];
      ids[target.slot] = id;
      setRackOrder(ids);
      setPlacements((ps) => ps.filter((p) => p.tile.id !== id));
      setSelectedTileId(null);
      setSelectedPendingId(null);
      return;
    }
    if (match!.board[target.row]?.[target.col]) return;
    const occupant = placements.find((p) => p.row === target.row && p.col === target.col);
    if (moving)
      setPlacements((ps) =>
        ps.map((p) =>
          p.tile.id === id
            ? { ...p, ...target }
            : occupant && p.tile.id === occupant.tile.id
              ? { ...p, row: moving.row, col: moving.col }
              : p,
        ),
      );
    else if (occupant)
      setPlacements((ps) =>
        ps.map((p) =>
          p === occupant ? { ...p, tile, assignedToken: getAssignmentOptions(tile.token)[0] } : p,
        ),
      );
    else placeTileAt(tile, { ...target, dir: "right" });
  });

  async function run(task: () => Promise<{ match: RankedMatchView }>) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    if (live?.localHandoff) {
      analysisAbort.current?.abort();
      setAnalysis(null);
      setPractice(false);
      setRackOrder([]);
      setMatch(concealLocalView(live));
    }
    try {
      const { match: next } = await task();
      setMatch((current) => (current && current.revision > next.revision ? current : next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ");
      const fresh = await client.read(matchId).catch(() => null);
      if (fresh)
        setMatch((current) =>
          current && current.revision > fresh.match.revision ? current : fresh.match,
        );
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }
  async function control(action: LiveControl) {
    if (!match || !client.control) return;
    analysisAbort.current?.abort();
    setAnalysis(null);
    setPractice(false);
    cancelAction();
    if (live?.localHandoff) setMatch(concealLocalView(live));
    await run(() => client.control!(match.id, match.revision, action));
  }
  async function leaveBoard(coffee: boolean) {
    if (!match) return;
    analysisAbort.current?.abort();
    cancelAction();
    setSelectedLogId(null);
    setPractice(false);
    setAnalysis(null);
    if (live?.localHandoff) setMatch(concealLocalView(live));
    try {
      if (!coffee && live?.canSaveExit && client.control)
        await client.control(match.id, match.revision, { kind: "save-exit" });
      if (coffee) window.localStorage.setItem(STORAGE_KEYS.coffeeRoom, match.id);
      navigate({ kind: ranked ? "ranked" : "arena" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to leave the game.");
    }
  }

  async function submit(action: RankedAction) {
    if (!match) return;
    if (live?.localHandoff) {
      analysisAbort.current?.abort();
      setAnalysis(null);
      setPlacements([]);
      setSelectedLogId(null);
      setExchangeIds([]);
      setSelectedTileId(null);
      setSelectedPendingId(null);
      setSelectedCell(null);
      setMode("none");
      setKeyNotice(null);
      blankArmedRef.current = false;
      setMatch(concealLocalView(live));
    }
    await run(() =>
      physicalHost && client.record
        ? client.record(match.id, match.revision, match.activeSide, action)
        : client.action(match.id, match.revision, action),
    );
  }

  function confirmSelectedAction() {
    if (!isMyTurn || busy || submittingRef.current) return;
    if (mode === "place_equation" && validation?.isValid) {
      void submit({
        kind: "place",
        placements: placements.map((item) => ({
          tileId: item.tile.id,
          row: item.row,
          col: item.col,
          assignedToken: item.assignedToken,
        })),
      });
    } else if (
      mode === "exchange" &&
      exchangeIds.length > 0 &&
      exchangeIds.length <= match!.tilebagCount
    ) {
      void submit({ kind: "exchange", tileIds: exchangeIds });
    } else if (mode === "pass") {
      void submit({ kind: "pass" });
    }
  }

  function placeTileAt(tile: TileInstance, cursor: PlacementCursor, assignedToken?: string) {
    if (!match || !isMyTurn || busy || (mode !== "none" && mode !== "place_equation")) return;
    if (match.board[cursor.row]?.[cursor.col]) return;
    if (
      placements.some(
        (item) => item.tile.id === tile.id || (item.row === cursor.row && item.col === cursor.col),
      )
    )
      return;
    const options = getAssignmentOptions(tile.token);
    const placement: PendingPlacement = {
      tile,
      row: cursor.row,
      col: cursor.col,
      ...(assignedToken || options.length ? { assignedToken: assignedToken ?? options[0] } : {}),
      cursorDir: cursor.dir,
    };
    const next = [...placements, placement];
    setPlacements(next);
    setMode("place_equation");
    setSelectedTileId(null);
    setSelectedPendingId(null);
    setSelectedCell(advanceCursor(cursor, match.board, next));
  }

  function onCellClick(row: number, col: number) {
    if (!match || !isMyTurn || busy) return;
    if (mode === "exchange" || mode === "pass") return;
    const pending = placements.find((item) => item.row === row && item.col === col);
    if (pending) {
      if (selectedPendingId && selectedPendingId !== pending.tile.id) {
        const moving = placements.find((item) => item.tile.id === selectedPendingId)!;
        setPlacements((items) =>
          items.map((item) =>
            item.tile.id === moving.tile.id
              ? { ...item, row, col }
              : item.tile.id === pending.tile.id
                ? { ...item, row: moving.row, col: moving.col }
                : item,
          ),
        );
        setSelectedPendingId(null);
        return;
      }
      if (selectedTileId) {
        const replacement = currentRack.find((item) => item.id === selectedTileId);
        if (replacement) {
          setPlacements((items) =>
            items.map((item) =>
              item === pending
                ? {
                    ...item,
                    tile: replacement,
                    assignedToken: getAssignmentOptions(replacement.token)[0],
                  }
                : item,
            ),
          );
          setSelectedTileId(null);
        }
      } else {
        setSelectedPendingId((id) => (id === pending.tile.id ? null : pending.tile.id));
      }
      return;
    }
    if (match.board[row]?.[col]) return;
    if (selectedPendingId) {
      setPlacements((items) =>
        items.map((item) => (item.tile.id === selectedPendingId ? { ...item, row, col } : item)),
      );
      setSelectedPendingId(null);
      return;
    }
    const tile = currentRack.find((item) => item.id === selectedTileId);
    if (!tile) {
      if (selectedCell?.row === row && selectedCell.col === col) {
        const index = DIRECTIONS.indexOf(selectedCell.dir);
        setSelectedCell(
          index === DIRECTIONS.length - 1 ? null : { row, col, dir: DIRECTIONS[index + 1] },
        );
      } else {
        setSelectedCell({ row, col, dir: "right" });
      }
      setMode("place_equation");
      return;
    }
    placeTileAt(tile, { row, col, dir: selectedCell?.dir ?? "right" });
  }

  function onTileClick(tile: TileInstance) {
    if (!isMyTurn || busy) return;
    if (mode === "pass") return;
    if (mode === "exchange") {
      setExchangeIds((ids) =>
        ids.includes(tile.id) ? ids.filter((id) => id !== tile.id) : [...ids, tile.id],
      );
    } else {
      if (selectedTileId && selectedTileId !== tile.id && !selectedCell) {
        const ids = Array.from({ length: RACK_SIZE }, (_, index) => orderedIds[index] ?? null);
        const from = ids.indexOf(selectedTileId),
          to = ids.indexOf(tile.id);
        if (from >= 0 && to >= 0) {
          [ids[from], ids[to]] = [ids[to], ids[from]];
          setRackOrder(ids);
          setSelectedTileId(null);
          return;
        }
      }
      if (selectedCell) {
        placeTileAt(tile, selectedCell);
        return;
      }
      setMode("place_equation");
      setSelectedTileId((id) => (id === tile.id ? null : tile.id));
      setSelectedPendingId(null);
    }
  }

  function cancelAction() {
    setMode("none");
    setPlacements([]);
    setExchangeIds([]);
    setSelectedTileId(null);
    setSelectedCell(null);
    setSelectedPendingId(null);
    blankArmedRef.current = false;
    setKeyNotice(null);
  }

  // Board and Rack memoize their picture and require stable callback identities.
  const cellClickRef = useRef(onCellClick);
  const tileClickRef = useRef(onTileClick);
  const emptySlotRef = useRef((_index: number) => {
    if (selectedPendingId) {
      setPlacements((items) => items.filter((item) => item.tile.id !== selectedPendingId));
      setSelectedPendingId(null);
    }
  });
  cellClickRef.current = onCellClick;
  tileClickRef.current = onTileClick;
  emptySlotRef.current = (index: number) => {
    if (selectedTileId) {
      const next = Array.from({ length: RACK_SIZE }, (_, i) => orderedIds[i] ?? null);
      const from = next.indexOf(selectedTileId);
      if (from >= 0) {
        next[from] = next[index];
        next[index] = selectedTileId;
        setRackOrder(next);
        setSelectedTileId(null);
      }
    }
    if (selectedPendingId) {
      setPlacements((items) => items.filter((item) => item.tile.id !== selectedPendingId));
      setSelectedPendingId(null);
    }
  };
  const onBoardCellClick = useCallback(
    (row: number, col: number) => cellClickRef.current(row, col),
    [],
  );
  const onRackTileClick = useCallback((tile: TileInstance) => tileClickRef.current(tile), []);
  const onRackEmptySlotClick = useCallback((index: number) => emptySlotRef.current(index), []);
  const onExchangeSelectTiles = useCallback(
    (ids: string[], additive: boolean) =>
      setExchangeIds((current) => (additive ? [...new Set([...current, ...ids])] : ids)),
    [],
  );
  const onPendingAssignmentEdit = useCallback((tileId: string) => {
    setPlacements((items) =>
      items.map((item) => {
        if (item.tile.id !== tileId) return item;
        const options = getAssignmentOptions(item.tile.token);
        if (options.length < 2) return item;
        const next = options[(options.indexOf(item.assignedToken ?? "") + 1) % options.length];
        return { ...item, assignedToken: next, tile: { ...item.tile, assignedToken: next } };
      }),
    );
  }, []);

  function handleKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT" ||
      target?.isContentEditable ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      !match ||
      !isMyTurn ||
      busy
    )
      return;
    const consumed = () => {
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
    };
    if ((event.key === "Backspace" || event.key === "Delete") && mode === "place_equation") {
      const last =
        event.key === "Backspace"
          ? placements.at(-1)
          : placements.find(
              (item) => item.row === selectedCell?.row && item.col === selectedCell?.col,
            );
      if (!last) return;
      consumed();
      setPlacements((items) => items.filter((item) => item.tile.id !== last.tile.id));
      setSelectedCell({
        row: last.row,
        col: last.col,
        dir: last.cursorDir ?? selectedCell?.dir ?? "right",
      });
      setSelectedPendingId(null);
      return;
    }
    if ((event.key === "e" || event.key === "E") && selectedPendingId) {
      consumed();
      onPendingAssignmentEdit(selectedPendingId);
      return;
    }
    const action = resolveStudyKey(event, blankArmedRef.current);
    if (!action) return;
    if (action.kind === "confirmStep") {
      if (
        (mode === "place_equation" && validation?.isValid) ||
        (mode === "exchange" &&
          exchangeIds.length > 0 &&
          exchangeIds.length <= match.tilebagCount) ||
        mode === "pass"
      ) {
        consumed();
        confirmSelectedAction();
      }
      return;
    }
    if (mode === "exchange" || mode === "pass") return;
    if (action.kind === "armBlank") {
      consumed();
      blankArmedRef.current = true;
      setKeyNotice("Blank: พิมพ์ค่าเบี้ยที่จะใช้แทน");
      return;
    }
    if (action.kind === "cancel") {
      consumed();
      if (blankArmedRef.current) blankArmedRef.current = false;
      else setSelectedCell(null);
      setKeyNotice(null);
      return;
    }
    if (action.kind === "toggleDirection") {
      if (!selectedCell) return;
      consumed();
      const directions = action.cycleAll ? DIRECTIONS : DIRECTIONS.slice(0, 2);
      const index = directions.indexOf(selectedCell.dir);
      setSelectedCell({ ...selectedCell, dir: directions[(index + 1) % directions.length] });
      return;
    }
    if (action.kind === "move") {
      if (!selectedCell) return;
      consumed();
      const row = selectedCell.row + (action.dir === "down" ? 1 : action.dir === "up" ? -1 : 0);
      const col = selectedCell.col + (action.dir === "right" ? 1 : action.dir === "left" ? -1 : 0);
      if (row >= 0 && col >= 0 && row < match.board.length && col < match.board.length)
        setSelectedCell({ row, col, dir: selectedCell.dir });
      return;
    }
    if (action.kind !== "tile" && action.kind !== "bareBlank") return;
    consumed();
    blankArmedRef.current = false;
    if (action.kind === "bareBlank") {
      setKeyNotice(null);
      return;
    }
    const request = tileRequestFromStroke(action.stroke);
    if (!request) return;
    const resolved = resolveRackTile(unstagedRack, request);
    if (!resolved) {
      setKeyNotice(`ไม่มีเบี้ยที่เล่นเป็น ${request.face} ได้ในมือ`);
      return;
    }
    setKeyNotice(
      resolved.via === "exact"
        ? null
        : resolved.via === "blank"
          ? `ใช้ Blank แทน ${request.face}`
          : `ใช้เบี้ยสองหน้าเป็น ${request.face}`,
    );
    if (selectedCell) placeTileAt(resolved.tile, selectedCell, resolved.assignedToken);
    else onTileClick(resolved.tile);
  }
  const keyHandlerRef = useRef(handleKeyDown);
  keyHandlerRef.current = handleKeyDown;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!match || !uiGame)
    return (
      <PreGameShell
        eyebrow={ranked ? "Ranked" : "Live game"}
        title="กำลังเปิดห้อง"
        onBack={() => navigate({ kind: ranked ? "ranked" : "arena" })}
      >
        {error ? <p role="alert">{error}</p> : <p role="status">กำลังโหลด…</p>}
      </PreGameShell>
    );
  if (match.status === "waiting" || match.status === "matched") {
    const roomActions = (
      <>
        <button
          className="eq-button eq-button-secondary"
          type="button"
          onClick={() => void navigator.clipboard.writeText(window.location.href)}
        >
          คัดลอกลิงก์
        </button>
        <button
          className="eq-button eq-button-secondary"
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void client
              .cancel(match.id)
              .then(() => navigate({ kind: ranked ? "ranked" : "arena" }))
              .catch((cause) =>
                setError(cause instanceof Error ? cause.message : "ยกเลิกห้องไม่สำเร็จ"),
              )
              .finally(() => setBusy(false));
          }}
        >
          ยกเลิกก่อนเริ่ม
        </button>
      </>
    );
    return (
      <PreGameShell
        eyebrow={ranked ? "Ranked" : "Live game"}
        title={title}
        subtitle={`${match.players.A} vs ${match.players.B}`}
        onBack={() => navigate({ kind: ranked ? "ranked" : "arena" })}
        variant="waiting"
      >
        {error && (
          <p className="sync-banner" role="alert">
            {error}
          </p>
        )}
        <div className="pregame-card live-waiting-card">
          <div className="eq-section-heading">
            <div>
              <h2>{match.status === "waiting" ? "รอผู้เล่นคนที่สอง" : "ครบสองคนแล้ว"}</h2>
              <p>
                {match.status === "waiting"
                  ? "ผู้เล่นที่ได้รับอนุมัติคนใดก็ได้เข้าร่วม"
                  : `A ${match.readyBySide.A ? "พร้อม" : "ยังไม่พร้อม"} · B ${match.readyBySide.B ? "พร้อม" : "ยังไม่พร้อม"}`}
              </p>
              <p>
                {live
                  ? liveClockLine(live)
                  : `เวลา ${Math.round(match.timers.A / 60)} นาทีต่อฝ่าย · กติกาแข่ง · เบี้ยคู่แข่งปิด`}
              </p>
            </div>
          </div>
          {match.status === "matched" &&
            ranked &&
            match.yourSide &&
            !match.readyBySide[match.yourSide] &&
            // Each player sees their own stakes; Ready is the confirmation.
            (ranked ? (
              <RankedReadyConfirmation
                matchId={match.id}
                busy={busy}
                onReady={() => void run(() => client.ready(match.id))}
              />
            ) : (
              <button
                type="button"
                className="eq-button"
                disabled={busy}
                onClick={() => void run(() => client.ready(match.id))}
              >
                Ready
              </button>
            ))}
          {live && client.control ? (
            <WaitingControls
              key={match.revision}
              match={live}
              busy={busy}
              onAction={(action) => void control(action)}
              onLeave={() => {
                if (live.yourSide && live.readyBySide[live.yourSide])
                  void client.control!(match.id, match.revision, { kind: "ready", ready: false })
                    .then(() => navigate({ kind: "arena" }))
                    .catch((cause) => setError(String(cause)));
                else navigate({ kind: "arena" });
              }}
            >
              {roomActions}
            </WaitingControls>
          ) : (
            <div className="ranked-actions">{roomActions}</div>
          )}
        </div>
      </PreGameShell>
    );
  }

  if (live?.canHandoff && !live.localConfirmed && match.status !== "finished")
    return (
      <PreGameShell
        eyebrow="Pass & Play"
        title={`Hand the device to ${match.players[match.activeSide]}`}
        onBack={() => navigate({ kind: "arena" })}
      >
        <div className="pregame-card live-handoff-card">
          <div className="eq-section-heading">
            <div>
              <p>
                The previous rack is concealed. Confirm only when the next player has the device.
              </p>
              <p>
                Shared-device play cannot isolate private information from someone with unrestricted
                device access.
              </p>
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="live-tool-actions">
            <button
              type="button"
              className="eq-button eq-button-primary"
              disabled={busy || !client.handoff}
              onClick={() =>
                void run(() => client.handoff!(match.id, match.revision, match.activeSide))
              }
            >
              {match.players[match.activeSide]} — confirm handoff
            </button>
          </div>
        </div>
      </PreGameShell>
    );
  const rackSide = physicalHost ? match.activeSide : (match.yourSide ?? "A");
  const replayRack =
    selectedLog?.side === match.yourSide
      ? replayPhase === "before"
        ? (selectedLog.rackBefore ?? [])
        : (selectedLog.rackAfter ?? [])
      : [];
  const paused = "paused" in match && Boolean(match.paused);
  // Rename, direct pause and history editing exist only while the game can continue.
  const liveTools =
    live && client.control && !live.continuationBlocked && match.status !== "finished"
      ? live
      : null;
  const pauseRequest = liveTools?.directPause ? liveTools.matchControl?.stopRequest : undefined;
  const pauseBlocked =
    Date.parse(liveTools?.matchControl?.stopBlockedUntilBySide?.[liveTools.yourSide!] ?? "") >
    Date.now();
  const gameMenu: OverflowItem[] = [
    {
      icon: <Coffee size={18} />,
      label: "Coffee Break",
      disabled: busy,
      onSelect: () => void leaveBoard(true),
    },
    ...(liveTools?.directPause && !liveTools.paused
      ? [
          {
            icon: <Pause size={18} />,
            label: "Request pause",
            disabled: busy || Boolean(pauseRequest) || pauseBlocked,
            disabledReason: pauseRequest
              ? "Waiting for a response"
              : pauseBlocked
                ? "Pause requests are blocked for now"
                : undefined,
            onSelect: () => void control({ kind: "request-pause" }),
          },
        ]
      : []),
    ...(liveTools?.canRename
      ? [
          {
            icon: <Pencil size={18} />,
            label: "Rename game",
            disabled: busy,
            onSelect: () => setRenaming(true),
          },
        ]
      : []),
    { icon: <LogOut size={18} />, label: "ห้องและอันดับ", onSelect: () => void leaveBoard(false) },
  ];
  const analysisTool =
    !ranked &&
    playTools.has("analysis") &&
    Boolean(isMyTurn || (selectedLog?.side === match.yourSide && selectedLog?.rackBefore));
  const historyTool = Boolean(liveTools?.canEditHistory);
  const hostedTool = Boolean(
    !ranked &&
    "canAdminister" in match &&
    match.canAdminister &&
    client.administer &&
    match.status !== "finished",
  );
  const physicalTool = Boolean(
    live &&
    client.physical &&
    (live.hostRacks ||
      (live.localHandoff && live.localConfirmed && live.tileDrawMode === "manual")),
  );
  const botTool = "botTurn" in match && Boolean(match.botTurn);
  // Per-turn inputs first; history and administration after them.
  const toolNames = [
    physicalTool && "Physical draws",
    (analysisTool || analysis) && "Analysis",
    botTool && "Bot turn",
    historyTool && "History",
    hostedTool && "Administration",
  ].filter((name): name is string => Boolean(name));
  function analyzeTurn() {
    if (!match) return;
    const controller = new AbortController();
    analysisAbort.current?.abort();
    analysisAbort.current = controller;
    setAnalyzing(true);
    void analyzeOwnTurn(match, controller.signal, {
      level: analysisLevel,
      ...(selectedLog ? { logId: selectedLog.id } : {}),
    })
      .then(({ response }) => {
        if (!controller.signal.aborted)
          setAnalysis(`Own-rack analysis: ${response.type} · ${response.score} points`);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Analysis unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setAnalyzing(false);
      });
  }
  const tools =
    toolNames.length > 0 ? (
      <ContextTools mobile={isMobilePlay} summary={toolNames.join(" · ")}>
        {physicalTool && live && (
          <PhysicalControls
            match={live}
            busy={busy}
            onAction={(action) =>
              void run(() => client.physical!(match.id, match.revision, action))
            }
          />
        )}
        {(analysisTool || analysis) && (
          <ToolSection title="Analysis">
            {analysisTool && (
              <>
                <label className="eq-field">
                  Analysis level
                  <select
                    value={analysisLevel}
                    onChange={(e) => setAnalysisLevel(e.target.value as AnalysisLevel)}
                  >
                    {ANALYSIS_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level === "stage5b64" ? "ArchBot" : level}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="live-tool-actions">
                  <button
                    type="button"
                    className="eq-button eq-button-primary"
                    disabled={busy || analyzing}
                    onClick={analyzeTurn}
                  >
                    {analyzing
                      ? "Analyzing your rack…"
                      : selectedLog
                        ? "Analyze my historical turn"
                        : "Analyze my turn"}
                  </button>
                </div>
              </>
            )}
            {analysis && (
              <p className="live-tool-note" role="status">
                {analysis}
              </p>
            )}
          </ToolSection>
        )}
        {botTool && (
          <ToolSection title="Bot turn">
            <p className="live-tool-note" role="status">
              {botDisplayName(live?.mode === "stage5b_standard" ? "stage5b" : "authur")} is thinking{" "}
              {live?.mode === "stage5b_standard" ? "on this device" : "on the server"}…
            </p>
            {client.botTurn && (
              <div className="live-tool-actions">
                <button
                  type="button"
                  className="eq-button eq-button-secondary"
                  disabled={busy || botBusy}
                  onClick={() => void run(() => client.botTurn!(match.id, match.revision))}
                >
                  Retry bot turn
                </button>
              </div>
            )}
          </ToolSection>
        )}
        {historyTool && liveTools && (
          <HistoryControls
            key={`${match.revision}:${selectedLogId ?? ""}`}
            match={liveTools}
            busy={busy}
            selectedLog={selectedLog}
            allowBranches={playTools.has("multiverse")}
            onAction={(action) => void control(action)}
            onSelectLog={setSelectedLogId}
          />
        )}
        {hostedTool && (
          <HostedControls
            match={match}
            busy={busy}
            onAction={(action) =>
              void run(() => client.administer!(match.id, match.revision, action))
            }
          />
        )}
      </ContextTools>
    ) : null;
  const turnLog = (
    <section className={isMobilePlay ? "log-panel live-mobile-log" : "log-panel"}>
      <PanelHeading title="Turn Log" detail={`${match.logs.length} turns`} />
      <div className="log-list">
        <div className="turn-record-list">
          {match.logs.map((log) => (
            <section
              className={`turn-record-group side-${log.side.toLowerCase()} ${selectedLogId === log.id ? "selected" : ""}`}
              key={log.id}
            >
              <div className="turn-record-row">
                <button
                  className="turn-record-summary"
                  type="button"
                  aria-current={selectedLogId === log.id}
                  onClick={() => setSelectedLogId(log.id)}
                >
                  <span className="trs-turn">T{log.turnNumber}</span>
                  <span className="trs-side">{match.players[log.side]}</span>
                  <span className="trs-action">
                    {log.action === "place_equation"
                      ? `วางเบี้ย · ${log.score} แต้ม`
                      : log.action === "exchange"
                        ? `เปลี่ยน ${log.exchangedCount} ตัว`
                        : log.action === "pass"
                          ? "ผ่าน"
                          : "จบเกม"}
                  </span>
                  <span>ดูช็อต</span>
                </button>
              </div>
            </section>
          ))}
        </div>
      </div>
      {selectedLog && (
        <div className="ranked-log-detail">
          <div className="live-tool-actions">
            <button
              type="button"
              className="eq-button eq-button-secondary"
              onClick={() => setReplayPhase("before")}
            >
              Before this turn
            </button>
            <button
              type="button"
              className="eq-button eq-button-secondary"
              onClick={() => setReplayPhase("after")}
            >
              After this turn
            </button>
            {playTools.has("replay") &&
              selectedLog.rackBefore &&
              selectedLog.side === match.yourSide && (
                <button
                  type="button"
                  className="eq-button eq-button-secondary"
                  onClick={() => setPractice(!practice)}
                >
                  Practice this position
                </button>
              )}
            <button
              type="button"
              className="eq-button eq-button-secondary"
              onClick={() => setSelectedLogId(null)}
            >
              กลับกระดานปัจจุบัน
            </button>
          </div>
          {selectedLog.note && <p>{selectedLog.note}</p>}
          {selectedLog.stars !== undefined && <p>Stars: {selectedLog.stars}</p>}
          <p>{selectedLog.side === match.yourSide ? "เบี้ยของคุณในตานี้" : "เบี้ยคู่แข่งถูกปิด"}</p>
        </div>
      )}
    </section>
  );
  const tilebagPanel = (
    <section className="tilebag-panel rail-panel">
      <PanelHeading title="Tilebag" detail={`${match.tilebagCount} tiles`} />
      <p>เบี้ยในถุงถูกปิดระหว่างการแข่งขัน</p>
      <p>
        Rack A {match.rackCount.A} · Rack B {match.rackCount.B}
      </p>
    </section>
  );
  return (
    <main className="app-shell ranked-play">
      <header className="top-bar">
        <div className="title-block">
          <h1>{live?.name ?? title}</h1>
          <span className="topbar-status">
            ตา {match.turnNumber} · {match.players[match.activeSide]} ·{" "}
            {match.status === "finished" ? "จบเกม" : "กำลังเล่น"}
          </span>
        </div>
        <div className="top-actions">
          {paused && (
            <span className="role-badge live-status-badge" role="status">
              Game paused
            </span>
          )}
          {!paused && pauseRequest && (
            <span className="role-badge live-status-badge" role="status">
              Pause requested
            </span>
          )}
          <span className="role-badge">ถุง {match.tilebagCount}</span>
          {match.ratingChange && (
            <span className="role-badge owner">
              {rankTier(match.ratingChange.after)} {match.ratingChange.before} →{" "}
              {match.ratingChange.after}
            </span>
          )}
          {liveTools?.directPause && liveTools.paused && (
            <button
              className="resume-button"
              type="button"
              disabled={busy}
              onClick={() => void control({ kind: "resume-direct" })}
            >
              <Play size={18} /> Resume game
            </button>
          )}
          {match.status === "playing" &&
            match.yourSide &&
            !("continuationBlocked" in match && match.continuationBlocked) && (
              <button
                className="danger-button top-end-game"
                type="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("ยอมแพ้เกมนี้?")) void submit({ kind: "resign" });
                }}
              >
                <Flag size={18} /> ยอมแพ้
              </button>
            )}
          {ranked ? (
            <button
              className="icon-button top-save-exit"
              type="button"
              onClick={() => void leaveBoard(false)}
            >
              <LogOut size={18} /> ห้องและอันดับ
            </button>
          ) : (
            <OverflowMenu
              label="Game menu"
              triggerClassName="icon-button top-game-menu"
              items={gameMenu}
            >
              Game menu
            </OverflowMenu>
          )}
        </div>
      </header>
      {error && (
        <p className="sync-banner" role="alert">
          {error}
        </p>
      )}
      {"continuationBlocked" in match && Boolean(match.continuationBlocked) && (
        <p role="alert">
          This legacy game is read-only and cannot continue after the security upgrade. Its previous
          record is preserved privately, without a result or completed Replay. Refresh EQ Lab and
          start a new game.
        </p>
      )}
      {match.status === "finished" && (
        <p className="ranked-result" role="status">
          {match.result?.winner ? `${match.players[match.result.winner]} ชนะ` : "เสมอ"}
          {match.ratingChange
            ? ` · Rating ${match.ratingChange.before} → ${match.ratingChange.after}`
            : ""}
        </p>
      )}
      {/* A toast, as in the legacy board: a row here would push the board down. */}
      {keyNotice && (
        <div className="key-notice" role="status">
          {keyNotice}
        </div>
      )}
      {liveTools && (
        <PauseSheets match={liveTools} busy={busy} onAction={(action) => void control(action)} />
      )}
      {liveTools?.canRename && (
        <TextPromptSheet
          open={renaming}
          title="Rename game"
          label="Game name"
          initialValue={liveTools.name}
          submitLabel="Rename game"
          onCancel={() => setRenaming(false)}
          onSubmit={(name) => {
            setRenaming(false);
            void control({ kind: "rename", name });
          }}
        />
      )}
      <div className="workspace">
        <aside className="log-rail">
          <Scoreboard game={uiGame} />
          {!isMobilePlay && turnLog}
        </aside>
        <section className="board-zone">
          <div className="board-stage">
            <Board
              board={shownBoard!}
              pendingPlacements={selectedLog ? [] : placements}
              placementCursor={selectedCell}
              selectedRackTileId={selectedTileId}
              selectedPendingTileId={selectedPendingId}
              onCellClick={onBoardCellClick}
              onPendingAssignmentEdit={onPendingAssignmentEdit}
            />
          </div>
          <div className="play-bar">
            <div className="play-caption">
              <span className="pc-room">{title}</span>
              <span className={`pc-rack-side side-${rackSide.toLowerCase()}`}>
                {selectedLog ? match.players[selectedLog.side] : match.players[rackSide]} Rack
              </span>
              <span className="pc-hint">
                {selectedLog
                  ? `ช็อตตา ${selectedLog.turnNumber}`
                  : isMyTurn
                    ? "คลิกช่องแล้วพิมพ์เบี้ย · Space เปลี่ยนทิศ · Enter ยืนยัน"
                    : "รอตาคู่แข่ง"}
              </span>
            </div>
            <MobileActionBar
              actionMode={mode}
              canChooseAction={isMyTurn && !busy}
              canExchange={canExchange}
              canEditRefill={false}
              canPickFromTilebag={false}
              canUndoPlacement={placements.length > 0}
              exchangeCount={exchangeIds.length}
              exchangeReady={exchangeIds.length > 0 && exchangeIds.length <= match.tilebagCount}
              gameFinished={match.status === "finished"}
              finishedMessage="ดูผลด้านบนและเลือกตาจาก Turn Log"
              gameStatus={uiGame.status}
              pendingCount={placements.length}
              rackCount={unstagedRack.length}
              readOnly={!isMyTurn || busy}
              refillNeeded={false}
              replayIndex={
                selectedLog ? match.logs.findIndex((log) => log.id === selectedLog.id) : -1
              }
              replayTotalSteps={match.logs.length}
              reviewing={Boolean(selectedLog)}
              tileDrawMode="play"
              validation={validation!}
              onCancelAction={cancelAction}
              onConfirmExchange={() => void submit({ kind: "exchange", tileIds: exchangeIds })}
              onConfirmPass={() => void submit({ kind: "pass" })}
              onConfirmPlace={() =>
                void submit({
                  kind: "place",
                  placements: placements.map((item) => ({
                    tileId: item.tile.id,
                    row: item.row,
                    col: item.col,
                    assignedToken: item.assignedToken,
                  })),
                })
              }
              onEditRefill={() => {}}
              onOpenBag={() => {}}
              onReplayExit={() => setSelectedLogId(null)}
              onReplayNext={() => {
                const index = match.logs.findIndex((log) => log.id === selectedLog?.id);
                setSelectedLogId(
                  match.logs[Math.min(index + 1, match.logs.length - 1)]?.id ?? null,
                );
              }}
              onReplayPrev={() => {
                const index = match.logs.findIndex((log) => log.id === selectedLog?.id);
                setSelectedLogId(match.logs[Math.max(index - 1, 0)]?.id ?? null);
              }}
              onStartAction={(action) => {
                if (action === "place_equation" || action === "exchange" || action === "pass") {
                  cancelAction();
                  setMode(action);
                }
              }}
              onUndoPlacement={() => {
                if (!placements.length) return false;
                setPlacements((items) => items.slice(0, -1));
                return true;
              }}
            />
            {selectedLog && selectedLog.side !== match.yourSide ? (
              <div aria-label="เบี้ยคู่แข่งปิด">
                <Rack
                  rack={[]}
                  hiddenCount={RACK_SIZE}
                  side={selectedLog.side}
                  label="Replay rack"
                  active={false}
                  selectedRackTileId={null}
                  exchangeOutgoingIds={[]}
                  onTileClick={onRackTileClick}
                />
              </div>
            ) : (
              <Rack
                rack={selectedLog ? replayRack : rackSlots}
                side={selectedLog?.side ?? rackSide}
                label={selectedLog ? "Replay rack" : "Your rack"}
                active={isMyTurn && !selectedLog}
                selectedRackTileId={selectedTileId}
                exchangeOutgoingIds={exchangeIds}
                actionMode={mode}
                onTileClick={onRackTileClick}
                onEmptySlotClick={onRackEmptySlotClick}
                onExchangeSelectTiles={onExchangeSelectTiles}
              />
            )}
          </div>
        </section>
        {isMobilePlay && tools}
        {isMobilePlay && turnLog}
        <aside className="right-rail">
          {tools && !isMobilePlay ? (
            <div className="live-rail-stack">
              {tilebagPanel}
              {tools}
            </div>
          ) : (
            tilebagPanel
          )}
          <ActionPanel
            activeRack={unstagedRack}
            actionMode={mode}
            canChooseAction={isMyTurn && !busy}
            canEditRefill={false}
            canExchange={canExchange}
            exchangeDraft={{ outgoingIds: exchangeIds, incomingTiles: [] }}
            exchangeReady={exchangeIds.length > 0 && exchangeIds.length <= match.tilebagCount}
            game={uiGame}
            pendingPlacements={placements}
            readOnly={!isMyTurn || busy}
            refillNeeded={false}
            replayIndex={-1}
            replayPhase="after"
            replayTotalSteps={0}
            reviewing={false}
            showViewPanel={Boolean(selectedLog)}
            viewOnlyMessage={
              selectedLog ? (
                <p>กำลังดูช็อตตา {selectedLog.turnNumber} · เลือกกลับกระดานปัจจุบันเพื่อเล่นต่อ</p>
              ) : undefined
            }
            validation={validation!}
            viewPanelLog={null}
            onCancelAction={cancelAction}
            onConfirmExchange={() => void submit({ kind: "exchange", tileIds: exchangeIds })}
            onConfirmPass={() => void submit({ kind: "pass" })}
            onConfirmPlace={() =>
              void submit({
                kind: "place",
                placements: placements.map((item) => ({
                  tileId: item.tile.id,
                  row: item.row,
                  col: item.col,
                  assignedToken: item.assignedToken,
                })),
              })
            }
            onEditRefill={() => {}}
            onReplayExit={() => setSelectedLogId(null)}
            onReplayNext={() => {}}
            onReplayPrev={() => {}}
            onStartAction={(action) => {
              if (action === "place_equation" || action === "exchange" || action === "pass") {
                cancelAction();
                setMode(action);
              }
            }}
            onUpdatePendingAssignment={(tileId, value) =>
              setPlacements((items) =>
                items.map((item) =>
                  item.tile.id === tileId
                    ? {
                        ...item,
                        assignedToken: value,
                        tile: { ...item.tile, assignedToken: value },
                      }
                    : item,
                ),
              )
            }
          />
        </aside>
      </div>
      {practice &&
        selectedLog?.rackBefore &&
        selectedLog.boardBefore &&
        selectedLog.side === match.yourSide && (
          <LivePractice
            key={`${match.revision}:${selectedLog.id}`}
            log={selectedLog}
            onClose={() => setPractice(false)}
          />
        )}
    </main>
  );
}
