import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag, LogOut } from "lucide-react";
import "../../../play-styles.css";
import { Board } from "../../board/Board";
import { Rack } from "../../board/Rack";
import { MobileActionBar } from "../../mobile/MobileActionBar";
import { Scoreboard } from "../../game/Scoreboard";
import { ActionPanel } from "../../actions/ActionPanel";
import { PanelHeading } from "../../layout/PanelHeading";
import { PreGameShell } from "../pregame/PreGameShell";
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

export function RankedMatchPage({ matchId }: { matchId: string }) {
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
  const blankArmedRef = useRef(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const { match: next } = await rankedClient.read(matchId);
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
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [matchId]);

  useEffect(() => {
    setMode("none");
    setSelectedTileId(null);
    setSelectedCell(null);
    setSelectedPendingId(null);
    setPlacements([]);
    setExchangeIds([]);
    setSelectedLogId(null);
    blankArmedRef.current = false;
    setKeyNotice(null);
  }, [match?.revision]);

  const visibleTime = useCallback(
    (side: Side) => {
      if (!match) return 0;
      const elapsed =
        match.status === "playing" && match.activeSide === side
          ? Math.max(0, Math.floor((clockTick - Date.parse(match.clockStartedAt)) / 1000))
          : 0;
      return Math.max(0, match.timers[side] - elapsed);
    },
    [clockTick, match],
  );
  const timers = { A: visibleTime("A"), B: visibleTime("B") };
  const uiGame = match ? playUiGame(match, timers) : null;
  const selectedLog = match?.logs.find((log) => log.id === selectedLogId) ?? null;
  const stagedIds = new Set(placements.map((item) => item.tile.id));
  const rackSlots = match?.yourRack.map((tile) => (stagedIds.has(tile.id) ? null : tile)) ?? [];
  const unstagedRack = match?.yourRack.filter((tile) => !stagedIds.has(tile.id)) ?? [];
  const isMyTurn = Boolean(
    match?.status === "playing" && match.yourSide === match.activeSide && !selectedLog,
  );
  const canExchange = Boolean(
    match &&
    match.tilebagCount + match.rackCount[match.yourSide === "A" ? "B" : "A"] - RACK_SIZE >=
      EXCHANGE_MIN_RESERVE,
  );
  const validation = useMemo(
    () => (match ? validateMove(match.board, placements) : null),
    [match, placements],
  );
  const shownBoard =
    selectedLog?.boardAfter ??
    (match ? boardWithPending(match.board, placements, match.turnNumber, match.activeSide) : null);

  async function run(task: () => Promise<{ match: RankedMatchView }>) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const { match: next } = await task();
      setMatch(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ");
      const fresh = await rankedClient.read(matchId).catch(() => null);
      if (fresh) setMatch(fresh.match);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function submit(action: RankedAction) {
    if (!match) return;
    await run(() => rankedClient.action(match.id, match.revision, action));
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
      if (selectedTileId) {
        const replacement = match.yourRack.find((item) => item.id === selectedTileId);
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
    const tile = match.yourRack.find((item) => item.id === selectedTileId);
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
  const emptySlotRef = useRef(() => {
    if (selectedPendingId) {
      setPlacements((items) => items.filter((item) => item.tile.id !== selectedPendingId));
      setSelectedPendingId(null);
    }
  });
  cellClickRef.current = onCellClick;
  tileClickRef.current = onTileClick;
  emptySlotRef.current = () => {
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
  const onRackEmptySlotClick = useCallback(() => emptySlotRef.current(), []);
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
        eyebrow="Ranked"
        title="กำลังเปิดห้อง"
        onBack={() => navigate({ kind: "ranked" })}
      >
        {error ? <p role="alert">{error}</p> : <p role="status">กำลังโหลด…</p>}
      </PreGameShell>
    );
  if (match.status === "waiting" || match.status === "matched")
    return (
      <PreGameShell
        eyebrow="Ranked"
        title="ห้องจัดอันดับ"
        subtitle={`${match.players.A} vs ${match.players.B}`}
        onBack={() => navigate({ kind: "ranked" })}
        variant="waiting"
      >
        {error && (
          <p className="sync-banner" role="alert">
            {error}
          </p>
        )}
        <div className="pregame-card">
          <h2>{match.status === "waiting" ? "รอผู้เล่นคนที่สอง" : "ครบสองคนแล้ว"}</h2>
          <p>
            {match.status === "waiting"
              ? "ผู้เล่นที่ได้รับอนุมัติคนใดก็ได้เข้าร่วม"
              : `A ${match.readyBySide.A ? "พร้อม" : "ยังไม่พร้อม"} · B ${match.readyBySide.B ? "พร้อม" : "ยังไม่พร้อม"}`}
          </p>
          <p>เวลา {Math.round(match.timers.A / 60)} นาทีต่อฝ่าย · กติกาแข่ง · เบี้ยคู่แข่งปิด</p>
          <div className="ranked-actions">
            {match.status === "matched" && match.yourSide && !match.readyBySide[match.yourSide] && (
              <button
                className="eq-button eq-button-primary"
                type="button"
                disabled={busy}
                onClick={() => void run(() => rankedClient.ready(match.id))}
              >
                พร้อมเริ่ม
              </button>
            )}
            <button
              className="eq-button"
              type="button"
              onClick={() => void navigator.clipboard.writeText(window.location.href)}
            >
              คัดลอกลิงก์
            </button>
            <button
              className="eq-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void rankedClient
                  .cancel(match.id)
                  .then(() => navigate({ kind: "ranked" }))
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "ยกเลิกห้องไม่สำเร็จ"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              ยกเลิกก่อนเริ่ม
            </button>
          </div>
        </div>
      </PreGameShell>
    );

  const rackSide = match.yourSide ?? "A";
  const replayRack = selectedLog?.side === match.yourSide ? (selectedLog.rackBefore ?? []) : [];
  return (
    <main className="app-shell ranked-play">
      <header className="top-bar">
        <div className="title-block">
          <h1>Ranked match</h1>
          <span className="topbar-status">
            ตา {match.turnNumber} · {match.players[match.activeSide]} ·{" "}
            {match.status === "finished" ? "จบเกม" : "กำลังเล่น"}
          </span>
        </div>
        <div className="top-actions">
          <span className="role-badge">ถุง {match.tilebagCount}</span>
          {match.ratingChange && (
            <span className="role-badge owner">
              {rankTier(match.ratingChange.after)} {match.ratingChange.before} →{" "}
              {match.ratingChange.after}
            </span>
          )}
          {match.status === "playing" && (
            <button
              className="danger-button top-end-game"
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("ยอมแพ้เกมจัดอันดับนี้?")) void submit({ kind: "resign" });
              }}
            >
              <Flag size={18} /> ยอมแพ้
            </button>
          )}
          <button
            className="icon-button top-save-exit"
            type="button"
            onClick={() => navigate({ kind: "ranked" })}
          >
            <LogOut size={18} /> ห้องและอันดับ
          </button>
        </div>
      </header>
      {error && (
        <p className="sync-banner" role="alert">
          {error}
        </p>
      )}
      {keyNotice && (
        <p className="sync-banner" role="status">
          {keyNotice}
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
      <div className="workspace">
        <aside className="log-rail">
          <Scoreboard game={uiGame} />
          <section className="log-panel">
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
                <button type="button" onClick={() => setSelectedLogId(null)}>
                  กลับกระดานปัจจุบัน
                </button>
                <p>
                  {selectedLog.side === match.yourSide
                    ? "เบี้ยของคุณในตานี้"
                    : "เบี้ยคู่แข่งถูกปิด"}
                </p>
              </div>
            )}
          </section>
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
              <span className="pc-room">Ranked match</span>
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
        <aside className="right-rail">
          <section className="tilebag-panel rail-panel">
            <PanelHeading title="Tilebag" detail={`${match.tilebagCount} tiles`} />
            <p>เบี้ยในถุงถูกปิดระหว่างการแข่งขัน</p>
            <p>
              Rack A {match.rackCount.A} · Rack B {match.rackCount.B}
            </p>
          </section>
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
    </main>
  );
}
