import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RACK_SIZE } from "../../constants/gameRules";
import {
  tileNeedsAssignment,
  validateMove,
  type BoardSnapshot,
  type PendingPlacement,
  type TileInstance,
} from "../../game";
import type { RankedAction } from "../../features/ranked/rules";
import { resolveRackTile, tileRequestFromStroke } from "../../gameplay/rackResolution";
import { resolveStudyKey } from "../../gameplay/tileKeys";

export type Direction = "right" | "down" | "left" | "up";
export type Cursor = { row: number; col: number; dir: Direction };
export type DraftMode = "none" | "exchange" | "pass";
export type RackSlot = { tile: TileInstance | null; exposed: TileInstance | null };
export type KeyNotice =
  | { kind: "blank" }
  | { kind: "missing"; face: string }
  | { kind: "viaBlank"; face: string }
  | { kind: "viaChoice"; face: string };

const DIRECTIONS: Direction[] = ["right", "down", "left", "up"];

function advance(
  cursor: Cursor,
  board: BoardSnapshot,
  placements: PendingPlacement[],
): Cursor | null {
  let { row, col } = cursor;
  const taken = new Set(placements.map((item) => `${item.row}:${item.col}`));
  for (;;) {
    if (cursor.dir === "right") col += 1;
    else if (cursor.dir === "left") col -= 1;
    else if (cursor.dir === "down") row += 1;
    else row -= 1;
    if (row < 0 || col < 0 || row >= board.length || col >= board.length) return null;
    if (!board[row][col] && !taken.has(`${row}:${col}`)) return { row, col, dir: cursor.dir };
  }
}

function inEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable),
  );
}

/**
 * The local turn draft: tentative tiles, the board cursor, the rack selection
 * and the Exchange / Pass choice. Purely local — nothing here is sent until
 * Commit, Exchange or Pass, and then only the typed action.
 *
 * A new TURN (or line of play) clears the draft. Any other new revision — a
 * pause request, an annotation, a rename — only drops what became impossible,
 * so it can never wipe the active player's tiles.
 */
export function useTurnDraft({
  board,
  rack,
  order,
  setOrder,
  canPlay,
  turnKey,
  bagCount,
  onSubmit,
}: {
  board: BoardSnapshot | null;
  rack: TileInstance[];
  order: (string | null)[];
  setOrder(next: (string | null)[]): void;
  /** ACTIVE, not reviewing, not mid-command. */
  canPlay: boolean;
  turnKey: string;
  bagCount: number;
  onSubmit(action: RankedAction): void;
}) {
  const [placements, setPlacements] = useState<PendingPlacement[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null);
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(null);
  const [exchangeIds, setExchangeIds] = useState<string[]>([]);
  const [mode, setMode] = useState<DraftMode>("none");
  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);
  /** The tentative tile whose alternative value is being chosen (FacePicker). */
  const [pickerId, setPickerId] = useState<string | null>(null);
  const blankArmed = useRef(false);

  const reset = useCallback(() => {
    setPlacements([]);
    setSelectedTileId(null);
    setSelectedPendingId(null);
    setExchangeIds([]);
    setMode("none");
    setKeyNotice(null);
    setPickerId(null);
    blankArmed.current = false;
  }, []);

  // A new turn starts a clean draft; the cursor stays where the player was looking.
  const [draftTurn, setDraftTurn] = useState(turnKey);
  if (draftTurn !== turnKey) {
    setDraftTurn(turnKey);
    reset();
  }

  // Other revisions keep the draft, minus anything no longer possible.
  const rackIds = useMemo(() => new Set(rack.map((tile) => tile.id)), [rack]);
  const livePlacements = useMemo(
    () =>
      board
        ? placements.filter((item) => rackIds.has(item.tile.id) && !board[item.row]?.[item.col])
        : [],
    [placements, rackIds, board],
  );
  const liveExchange = useMemo(
    () => exchangeIds.filter((id) => rackIds.has(id)),
    [exchangeIds, rackIds],
  );
  const staged = new Set(livePlacements.map((item) => item.tile.id));
  const slots: RackSlot[] = Array.from({ length: RACK_SIZE }, (_, index) => {
    const id = order[index] ?? null;
    const tile = id ? (rack.find((item) => item.id === id) ?? null) : null;
    return tile && staged.has(tile.id) ? { tile: null, exposed: tile } : { tile, exposed: null };
  });
  const unstaged = rack.filter((tile) => !staged.has(tile.id));
  const validation = useMemo(
    () => (board && livePlacements.length ? validateMove(board, livePlacements) : null),
    [board, livePlacements],
  );

  const placeTileAt = useCallback(
    (tile: TileInstance, at: Cursor, assignedToken?: string) => {
      if (!board || !canPlay || mode !== "none") return;
      if (board[at.row]?.[at.col]) return;
      if (
        livePlacements.some((p) => p.tile.id === tile.id || (p.row === at.row && p.col === at.col))
      )
        return;
      // No silent default value: a tile with alternatives that was placed by
      // hand opens the picker; a typed face (keyboard) is already the choice.
      const placement: PendingPlacement = {
        tile,
        row: at.row,
        col: at.col,
        ...(assignedToken ? { assignedToken } : {}),
        cursorDir: at.dir,
      };
      const next = [...livePlacements, placement];
      setPlacements(next);
      setSelectedTileId(null);
      // Opening the picker does not select the tile: dismissing the picker by
      // tapping elsewhere must never move it.
      setSelectedPendingId(null);
      setPickerId(!assignedToken && tileNeedsAssignment(tile.token) ? tile.id : null);
      setCursor(advance(at, board, next) ?? at);
    },
    [board, canPlay, mode, livePlacements],
  );

  const swapSlots = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || to < 0 || from >= RACK_SIZE || to >= RACK_SIZE) return;
      const ids = Array.from({ length: RACK_SIZE }, (_, index) => order[index] ?? null);
      [ids[from], ids[to]] = [ids[to], ids[from]];
      setOrder(ids);
    },
    [order, setOrder],
  );
  const slotOf = (id: string) => order.indexOf(id);

  const recallTile = useCallback((id: string) => {
    setPickerId((current) => (current === id ? null : current));
    setPlacements((items) => items.filter((item) => item.tile.id !== id));
    setSelectedPendingId(null);
  }, []);

  function onCellClick(row: number, col: number) {
    if (!board) return;
    if (pickerId) {
      // Light dismiss: with the value picker open, a tap elsewhere only closes
      // it — unless it is on another tentative alternative tile, which switches.
      const other = livePlacements.find(
        (item) =>
          item.row === row &&
          item.col === col &&
          item.tile.id !== pickerId &&
          tileNeedsAssignment(item.tile.token),
      );
      setSelectedPendingId(null);
      setPickerId(other && canPlay ? other.tile.id : null);
      return;
    }
    if (!canPlay || mode !== "none") {
      // THINKING and modes: the board is for looking. The cursor marks the square.
      setCursor((current) => ({ row, col, dir: current?.dir ?? "right" }));
      return;
    }
    const pending = livePlacements.find((item) => item.row === row && item.col === col);
    if (pending) {
      if (selectedPendingId && selectedPendingId !== pending.tile.id) {
        const moving = livePlacements.find((item) => item.tile.id === selectedPendingId)!;
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
      const replacement = selectedTileId ? rack.find((item) => item.id === selectedTileId) : null;
      if (replacement) {
        setPlacements((items) =>
          items.map((item) =>
            item === pending ? { ...item, tile: replacement, assignedToken: undefined } : item,
          ),
        );
        setSelectedTileId(null);
        if (tileNeedsAssignment(replacement.token)) setPickerId(replacement.id);
      } else if (tileNeedsAssignment(pending.tile.token)) {
        // One tap on an alternative tile opens its value picker. (Drag moves it.)
        setSelectedPendingId(null);
        setPickerId(pending.tile.id);
      } else setSelectedPendingId((id) => (id === pending.tile.id ? null : pending.tile.id));
      return;
    }
    if (board[row]?.[col]) {
      setCursor((current) => ({ row, col, dir: current?.dir ?? "right" }));
      return;
    }
    if (selectedPendingId) {
      setPlacements((items) =>
        items.map((item) => (item.tile.id === selectedPendingId ? { ...item, row, col } : item)),
      );
      setSelectedPendingId(null);
      return;
    }
    const tile = rack.find((item) => item.id === selectedTileId);
    if (!tile) {
      if (cursor?.row === row && cursor.col === col) {
        const index = DIRECTIONS.indexOf(cursor.dir);
        setCursor({ row, col, dir: DIRECTIONS[(index + 1) % DIRECTIONS.length] });
      } else setCursor({ row, col, dir: cursor?.dir ?? "right" });
      return;
    }
    placeTileAt(tile, { row, col, dir: cursor?.dir ?? "right" });
  }

  function onTileClick(tile: TileInstance) {
    if (mode === "pass") return;
    if (pickerId) {
      setPickerId(null);
      return;
    }
    if (mode === "exchange") {
      if (!canPlay) return;
      setExchangeIds((ids) =>
        ids.includes(tile.id) ? ids.filter((id) => id !== tile.id) : [...ids, tile.id],
      );
      return;
    }
    // Reorder works in every state: select one tile, then another to swap them.
    if (selectedTileId && selectedTileId !== tile.id) {
      const from = slotOf(selectedTileId),
        to = slotOf(tile.id);
      if (from >= 0 && to >= 0 && !(canPlay && cursor && !board?.[cursor.row]?.[cursor.col])) {
        swapSlots(from, to);
        setSelectedTileId(null);
        return;
      }
    }
    if (canPlay && cursor && board && !board[cursor.row]?.[cursor.col]) {
      placeTileAt(tile, cursor);
      return;
    }
    setSelectedTileId((id) => (id === tile.id ? null : tile.id));
    setSelectedPendingId(null);
  }

  function onSlotClick(index: number) {
    setPickerId(null);
    const slot = slots[index];
    if (slot?.exposed) {
      recallTile(slot.exposed.id);
      return;
    }
    if (selectedPendingId) {
      recallTile(selectedPendingId);
      return;
    }
    if (selectedTileId) {
      const from = slotOf(selectedTileId);
      if (from >= 0) swapSlots(from, index);
      setSelectedTileId(null);
    }
  }

  /** Pointer drag: rack→rack reorders (any state); onto the board only while ACTIVE. */
  function onDrop(id: string, target: { row: number; col: number } | { slot: number }) {
    const tile = rack.find((item) => item.id === id);
    if (!tile) return;
    if ("slot" in target) {
      const from = slotOf(id);
      if (from >= 0) swapSlots(from, target.slot);
      if (livePlacements.some((p) => p.tile.id === id)) recallTile(id);
      setSelectedTileId(null);
      return;
    }
    if (!board || !canPlay || mode !== "none" || board[target.row]?.[target.col]) return;
    setPickerId(null);
    const moving = livePlacements.find((p) => p.tile.id === id);
    const occupant = livePlacements.find((p) => p.row === target.row && p.col === target.col);
    if (moving)
      setPlacements((items) =>
        items.map((p) =>
          p.tile.id === id
            ? { ...p, ...target }
            : occupant && p.tile.id === occupant.tile.id
              ? { ...p, row: moving.row, col: moving.col }
              : p,
        ),
      );
    else if (occupant) {
      setPlacements((items) =>
        items.map((p) => (p === occupant ? { ...p, tile, assignedToken: undefined } : p)),
      );
      if (tileNeedsAssignment(tile.token)) setPickerId(tile.id);
    } else placeTileAt(tile, { ...target, dir: cursor?.dir ?? "right" });
  }

  /** Open the direct value picker for a tentative alternative tile (E, or a tap). */
  const editFace = useCallback(
    (tileId: string) => {
      const target = livePlacements.find((item) => item.tile.id === tileId);
      if (!target || !tileNeedsAssignment(target.tile.token)) return;
      setPickerId(tileId);
    },
    [livePlacements],
  );
  /** One choice sets the value: no cycling through options. */
  const chooseFace = useCallback((tileId: string, face: string) => {
    setPlacements((items) =>
      items.map((item) =>
        item.tile.id === tileId
          ? { ...item, assignedToken: face, tile: { ...item.tile, assignedToken: face } }
          : item,
      ),
    );
    setPickerId(null);
    setSelectedPendingId(null);
  }, []);
  const closePicker = useCallback(() => setPickerId(null), []);
  /** Exchange selection by tap or by dragging across the rack. */
  const markExchange = useCallback(
    (ids: string[], value: boolean) => {
      if (!canPlay) return;
      setExchangeIds((current) =>
        value ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.includes(id)),
      );
    },
    [canPlay],
  );

  const placeAction = (): RankedAction => ({
    kind: "place",
    placements: livePlacements.map((item) => ({
      tileId: item.tile.id,
      row: item.row,
      col: item.col,
      assignedToken: item.assignedToken,
    })),
  });
  const exchangeReady = liveExchange.length > 0 && liveExchange.length <= bagCount;
  function commit() {
    if (canPlay && validation?.isValid) onSubmit(placeAction());
  }
  function confirmExchange() {
    if (canPlay && mode === "exchange" && exchangeReady)
      onSubmit({ kind: "exchange", tileIds: liveExchange });
  }
  function confirmPass() {
    if (canPlay && mode === "pass") onSubmit({ kind: "pass" });
  }
  function recallAll() {
    setPickerId(null);
    setPlacements([]);
    setSelectedPendingId(null);
    setKeyNotice(null);
  }
  function startExchange() {
    recallAll();
    setSelectedTileId(null);
    setExchangeIds([]);
    setMode("exchange");
  }
  function startPass() {
    recallAll();
    setMode("pass");
  }
  function cancelMode() {
    setMode("none");
    setExchangeIds([]);
  }

  // One window listener; the handler reads the latest render through a ref.
  const keyRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (event: KeyboardEvent) => {
    if (!board || inEditable(event.target) || event.metaKey || event.ctrlKey || event.altKey)
      return;
    // The value picker handles its own keys (arrows, Enter, Escape).
    if ((event.target as HTMLElement | null)?.closest?.("[data-face-picker]")) return;
    const consumed = () => {
      event.preventDefault();
      // Keep focus inside the board grid so screen readers follow the cursor.
      const active = document.activeElement as HTMLElement | null;
      if (active && !active.closest("[data-live-board]")) active.blur?.();
    };
    const action = resolveStudyKey(event, blankArmed.current);
    if (action?.kind === "move") {
      if (!cursor) return;
      consumed();
      const row = cursor.row + (action.dir === "down" ? 1 : action.dir === "up" ? -1 : 0);
      const col = cursor.col + (action.dir === "right" ? 1 : action.dir === "left" ? -1 : 0);
      if (row >= 0 && col >= 0 && row < board.length && col < board.length)
        setCursor({ row, col, dir: cursor.dir });
      return;
    }
    if (!canPlay) return;
    if ((event.key === "Backspace" || event.key === "Delete") && mode === "none") {
      const last =
        event.key === "Backspace"
          ? livePlacements.at(-1)
          : livePlacements.find((item) => item.row === cursor?.row && item.col === cursor?.col);
      if (!last) return;
      consumed();
      recallTile(last.tile.id);
      setCursor({ row: last.row, col: last.col, dir: last.cursorDir ?? cursor?.dir ?? "right" });
      return;
    }
    // E (or Enter on an alternative tile under the cursor) opens its value picker.
    const atCursor = livePlacements.find(
      (item) => item.row === cursor?.row && item.col === cursor?.col,
    );
    const faceTarget = selectedPendingId ?? atCursor?.tile.id ?? null;
    if ((event.key === "e" || event.key === "E") && faceTarget) {
      consumed();
      editFace(faceTarget);
      return;
    }
    if (!action) return;
    if (action.kind === "confirmStep") {
      if (mode === "none" && validation?.isValid) {
        consumed();
        commit();
      } else if (mode === "exchange" && exchangeReady) {
        consumed();
        confirmExchange();
      } else if (mode === "pass") {
        consumed();
        confirmPass();
      }
      return;
    }
    if (action.kind === "cancel") {
      consumed();
      if (blankArmed.current) blankArmed.current = false;
      else if (pickerId) setPickerId(null);
      else if (mode !== "none") cancelMode();
      else if (livePlacements.length) recallAll();
      else setCursor(null);
      setKeyNotice(null);
      return;
    }
    if (mode !== "none") return;
    if (action.kind === "armBlank") {
      consumed();
      blankArmed.current = true;
      setKeyNotice({ kind: "blank" });
      return;
    }
    if (action.kind === "toggleDirection") {
      if (!cursor) return;
      consumed();
      const directions = action.cycleAll ? DIRECTIONS : DIRECTIONS.slice(0, 2);
      setCursor({
        ...cursor,
        dir: directions[(directions.indexOf(cursor.dir) + 1) % directions.length],
      });
      return;
    }
    if (action.kind !== "tile" && action.kind !== "bareBlank") return;
    consumed();
    blankArmed.current = false;
    if (action.kind === "bareBlank") {
      setKeyNotice(null);
      return;
    }
    const request = tileRequestFromStroke(action.stroke);
    if (!request) return;
    const resolved = resolveRackTile(unstaged, request);
    if (!resolved) {
      setKeyNotice({ kind: "missing", face: request.face });
      return;
    }
    setKeyNotice(
      resolved.via === "exact"
        ? null
        : { kind: resolved.via === "blank" ? "viaBlank" : "viaChoice", face: request.face },
    );
    if (cursor) placeTileAt(resolved.tile, cursor, resolved.assignedToken);
    else onTileClick(resolved.tile);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return {
    placements: livePlacements,
    cursor,
    setCursor,
    selectedTileId,
    selectedPendingId,
    exchangeIds: liveExchange,
    exchangeReady,
    mode,
    keyNotice,
    validation,
    slots,
    unstagedCount: unstaged.length,
    onCellClick,
    onTileClick,
    onSlotClick,
    onDrop,
    editFace,
    pickerId,
    /** A placed alternative tile still has no chosen value. */
    unchosen: livePlacements.some(
      (item) => tileNeedsAssignment(item.tile.token) && !item.assignedToken,
    ),
    pickerTile: pickerId
      ? (livePlacements.find((item) => item.tile.id === pickerId) ?? null)
      : null,
    chooseFace,
    closePicker,
    markExchange,
    swapSlots,
    recallAll,
    commit,
    startExchange,
    startPass,
    cancelMode,
    confirmExchange,
    confirmPass,
    reset,
  };
}

export type TurnDraft = ReturnType<typeof useTurnDraft>;
