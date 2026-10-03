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

/** The placement arrow points right or down. */
export type Direction = "right" | "down";
/**
 * The board cursor: the square the player is looking at (keyboard focus) and
 * the placement arrow there. dir "off": the player turned the arrow off; the
 * square stays the focus position.
 */
export type Cursor = { row: number; col: number; dir: Direction | "off" };
export type Arrow = { row: number; col: number; dir: Direction };
export type DraftMode = "none" | "exchange" | "pass";
export type RackSlot = { tile: TileInstance | null; exposed: TileInstance | null };
export type KeyNotice =
  | { kind: "blank" }
  | { kind: "missing"; face: string }
  | { kind: "viaBlank"; face: string }
  | { kind: "viaChoice"; face: string };

/** Two taps within this window on the same tentative tile open its value picker. */
export const DOUBLE_TAP_MS = 400;

/** The next free square after `cursor` in its direction, or null at the board edge. */
function advance(
  cursor: Arrow,
  board: BoardSnapshot,
  placements: PendingPlacement[],
): Arrow | null {
  let { row, col } = cursor;
  const taken = new Set(placements.map((item) => `${item.row}:${item.col}`));
  for (;;) {
    if (cursor.dir === "right") col += 1;
    else row += 1;
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
 * The local turn draft: tentative tiles, the board cursor, the selection and
 * the Exchange / Pass choice. Purely local — nothing here is sent until
 * Commit, Exchange or Pass, and then only the typed action.
 *
 * Interaction model — like moving physical tiles: select a tile, then the
 * place it goes. One selection at a time, from the rack or from the board.
 *
 *   NORMAL (my turn)
 *     rack tile        arrow showing → placed at the arrow; else select it
 *                      (another rack tile selected → the two swap slots;
 *                       a board tile selected → the selection moves here)
 *     board tentative  rack tile selected → takes that square, the board
 *                      tile goes home; board tile selected → they swap;
 *                      nothing selected → select it. A second tap on the
 *                      same alternative tile within DOUBLE_TAP_MS opens its
 *                      value picker (a single tap never does).
 *     empty square     selection → it goes there; else the arrow: RIGHT on a
 *                      new square, then DOWN, then OFF on the same square
 *     empty rack slot  board tile selected → it returns into THAT slot;
 *                      rack tile selected → it moves into that slot
 *   EXCHANGE           only the rack responds: tap or drag marks tiles
 *   PASS               nothing on the board or rack responds
 *   VALUE PICKER OPEN  any board or rack tap only closes it (never moves)
 *   THINKING           rack reorder; the arrow can be prepared on empty squares
 *
 * The arrow is never drawn under a tile: placing on its square advances it,
 * and a square that becomes occupied any other way pushes it forward (off at
 * the board edge).
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
  onPlace,
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
  /** One physical placement on the board (a tile put down or moved), for the sound. */
  onPlace?: () => void;
}) {
  const [placements, setPlacements] = useState<PendingPlacement[]>([]);
  const [rawCursor, setCursor] = useState<Cursor | null>(null);
  const [selected, setSelected] = useState<{ kind: "rack" | "board"; id: string } | null>(null);
  const [exchangeIds, setExchangeIds] = useState<string[]>([]);
  const [mode, setMode] = useState<DraftMode>("none");
  const [keyNotice, setKeyNotice] = useState<KeyNotice | null>(null);
  /** The tentative tile whose alternative value is being chosen (FacePicker). */
  const [pickerId, setPickerId] = useState<string | null>(null);
  const blankArmed = useRef(false);
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const placeSound = useRef(onPlace);
  placeSound.current = onPlace;

  const reset = useCallback(() => {
    setPlacements([]);
    setSelected(null);
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
  const selectedTileId =
    selected?.kind === "rack" && unstaged.some((tile) => tile.id === selected.id)
      ? selected.id
      : null;
  const selectedPendingId =
    selected?.kind === "board" && staged.has(selected.id) ? selected.id : null;
  const occupied = (row: number, col: number, items: PendingPlacement[] = livePlacements) =>
    Boolean(board?.[row]?.[col]) || items.some((item) => item.row === row && item.col === col);
  // The arrow is drawn on a free square only: from a square that is occupied
  // (a tile placed or moved there, an opponent's commit) it moves on in its
  // direction, and disappears at the board edge.
  const cursor: Arrow | null = useMemo(() => {
    if (!rawCursor || rawCursor.dir === "off" || !board) return null;
    const arrow = { row: rawCursor.row, col: rawCursor.col, dir: rawCursor.dir };
    const taken =
      board[arrow.row]?.[arrow.col] ||
      livePlacements.some((item) => item.row === arrow.row && item.col === arrow.col);
    return taken ? advance(arrow, board, livePlacements) : arrow;
  }, [rawCursor, board, livePlacements]);
  /** After the tiles change: an arrow now under a tile moves on (off at the edge). */
  const settleCursor = (next: PendingPlacement[]) => {
    if (!board || !cursor || !occupied(cursor.row, cursor.col, next)) return;
    const moved = advance(cursor, board, next);
    setCursor(moved ?? { row: cursor.row, col: cursor.col, dir: "off" });
  };

  const placeTileAt = useCallback(
    (tile: TileInstance, at: Arrow, assignedToken?: string) => {
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
      // Opening the picker does not select the tile: dismissing the picker by
      // tapping elsewhere must never move it.
      setSelected(null);
      setPickerId(!assignedToken && tileNeedsAssignment(tile.token) ? tile.id : null);
      // The arrow (if showing) moves past the tile just placed; it is never
      // covered, and an arrow the player turned off stays off.
      if (cursor) {
        const moved = advance({ row: at.row, col: at.col, dir: cursor.dir }, board, next);
        setCursor(moved ?? { row: at.row, col: at.col, dir: "off" });
      } else setCursor({ row: at.row, col: at.col, dir: "off" }); // focus follows, no arrow
      placeSound.current?.();
    },
    [board, canPlay, mode, livePlacements, cursor],
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
    setSelected(null);
  }, []);

  /** The arrow on an empty square: RIGHT on a new square, then DOWN, then OFF, then RIGHT. */
  function arrowTap(row: number, col: number) {
    if (cursor?.row === row && cursor.col === col)
      setCursor({ row, col, dir: cursor.dir === "right" ? "down" : "off" });
    else setCursor({ row, col, dir: cursor?.dir ?? "right" });
  }

  /** `at`: when the tap happened (event time), so a slow render never splits a double tap. */
  function onCellClick(row: number, col: number, at?: number) {
    if (!board) return;
    const tapped = lastTap.current;
    lastTap.current = null;
    if (pickerId) {
      // Light dismiss: with the value picker open, a tap only closes it.
      setPickerId(null);
      return;
    }
    if (mode !== "none") return;
    if (!canPlay) {
      // THINKING: the board is for looking; the arrow can be prepared.
      if (!occupied(row, col)) arrowTap(row, col);
      return;
    }
    const pending = livePlacements.find((item) => item.row === row && item.col === col);
    if (pending) {
      const id = pending.tile.id;
      if (selectedPendingId && selectedPendingId !== id) {
        // Two tentative tiles trade squares.
        const moving = livePlacements.find((item) => item.tile.id === selectedPendingId)!;
        setPlacements((items) =>
          items.map((item) =>
            item.tile.id === moving.tile.id
              ? { ...item, row, col }
              : item.tile.id === id
                ? { ...item, row: moving.row, col: moving.col }
                : item,
          ),
        );
        setSelected(null);
        placeSound.current?.();
        return;
      }
      const replacement = selectedTileId ? rack.find((item) => item.id === selectedTileId) : null;
      if (replacement) {
        // The rack tile takes the square; the board tile goes back to its slot.
        setPlacements((items) =>
          items.map((item) =>
            item === pending ? { ...item, tile: replacement, assignedToken: undefined } : item,
          ),
        );
        setSelected(null);
        if (tileNeedsAssignment(replacement.token)) setPickerId(replacement.id);
        placeSound.current?.();
        return;
      }
      const now = at ?? performance.now();
      if (
        tapped?.id === id &&
        now - tapped.at <= DOUBLE_TAP_MS &&
        tileNeedsAssignment(pending.tile.token)
      ) {
        // Second tap on the same alternative tile: edit its value.
        setSelected(null);
        setPickerId(id);
        return;
      }
      lastTap.current = { id, at: now };
      setSelected(selectedPendingId === id ? null : { kind: "board", id });
      return;
    }
    if (board[row]?.[col]) return;
    if (selectedPendingId) {
      const next = livePlacements.map((item) =>
        item.tile.id === selectedPendingId ? { ...item, row, col } : item,
      );
      setPlacements(next);
      setSelected(null);
      settleCursor(next);
      placeSound.current?.();
      return;
    }
    const tile = selectedTileId ? rack.find((item) => item.id === selectedTileId) : null;
    if (!tile) {
      arrowTap(row, col);
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
      if (from >= 0 && to >= 0) swapSlots(from, to);
      setSelected(null);
      return;
    }
    if (selectedTileId === tile.id) {
      setSelected(null);
      return;
    }
    if (!selectedPendingId && canPlay && cursor && board) {
      placeTileAt(tile, cursor);
      return;
    }
    setSelected({ kind: "rack", id: tile.id });
  }

  /** A slot with no tile in it (empty, or the home of a tile now on the board). */
  function onSlotClick(index: number) {
    if (pickerId) {
      setPickerId(null);
      return;
    }
    if (mode !== "none" || index < 0 || index >= RACK_SIZE) return;
    const moving = selectedPendingId ?? selectedTileId;
    if (!moving) return;
    // The selected tile goes into THIS slot. Whatever home the slot held (a
    // tile still on the board) moves to the selected tile's old slot, so every
    // tile keeps exactly one slot.
    const from = slotOf(moving);
    if (from >= 0) swapSlots(from, index);
    if (selectedPendingId) recallTile(selectedPendingId);
    setSelected(null);
  }

  /** Pointer drag: rack→rack reorders (any state); onto the board only while ACTIVE. */
  function onDrop(id: string, target: { row: number; col: number } | { slot: number }) {
    const tile = rack.find((item) => item.id === id);
    if (!tile) return;
    if ("slot" in target) {
      const from = slotOf(id);
      if (from >= 0) swapSlots(from, target.slot);
      if (livePlacements.some((p) => p.tile.id === id)) recallTile(id);
      setSelected(null);
      return;
    }
    if (!board || !canPlay || mode !== "none" || board[target.row]?.[target.col]) return;
    setPickerId(null);
    const moving = livePlacements.find((p) => p.tile.id === id);
    const occupant = livePlacements.find((p) => p.row === target.row && p.col === target.col);
    setSelected(null);
    if (moving) {
      const next = livePlacements.map((p) =>
        p.tile.id === id
          ? { ...p, ...target }
          : occupant && p.tile.id === occupant.tile.id
            ? { ...p, row: moving.row, col: moving.col }
            : p,
      );
      setPlacements(next);
      settleCursor(next);
      placeSound.current?.();
    } else if (occupant) {
      setPlacements((items) =>
        items.map((p) => (p === occupant ? { ...p, tile, assignedToken: undefined } : p)),
      );
      if (tileNeedsAssignment(tile.token)) setPickerId(tile.id);
      placeSound.current?.();
    } else placeTileAt(tile, { ...target, dir: cursor?.dir ?? "right" });
  }

  /** Open the direct value picker for a tentative alternative tile (E, or a double tap). */
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
    setSelected(null);
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
  /** Every tentative tile back to its slot (no sound); a showing arrow returns to where the play began. */
  function recallAll() {
    const first = livePlacements[0];
    setPickerId(null);
    setPlacements([]);
    setSelected(null);
    setKeyNotice(null);
    if (first && cursor) setCursor({ row: first.row, col: first.col, dir: cursor.dir });
  }
  function startExchange() {
    recallAll();
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
    // The value picker handles its own keys (arrows, Enter, Escape); an open
    // sheet owns the keyboard too — its buttons never type tiles.
    if ((event.target as HTMLElement | null)?.closest?.("[data-face-picker], [role='dialog']"))
      return;
    const consumed = () => {
      event.preventDefault();
      // Keep focus inside the board grid so screen readers follow the cursor.
      const active = document.activeElement as HTMLElement | null;
      if (active && !active.closest("[data-live-board]")) active.blur?.();
    };
    const action = resolveStudyKey(event, blankArmed.current);
    if (action?.kind === "move") {
      if (!rawCursor) return;
      consumed();
      const row = rawCursor.row + (action.dir === "down" ? 1 : action.dir === "up" ? -1 : 0);
      const col = rawCursor.col + (action.dir === "right" ? 1 : action.dir === "left" ? -1 : 0);
      if (row >= 0 && col >= 0 && row < board.length && col < board.length)
        setCursor({ row, col, dir: rawCursor.dir });
      return;
    }
    if (!canPlay) return;
    if ((event.key === "Backspace" || event.key === "Delete") && mode === "none") {
      const last =
        event.key === "Backspace"
          ? livePlacements.at(-1)
          : livePlacements.find(
              (item) => item.row === rawCursor?.row && item.col === rawCursor?.col,
            );
      if (!last) return;
      consumed();
      recallTile(last.tile.id);
      const dir: Direction = last.cursorDir === "down" ? "down" : "right";
      setCursor({ row: last.row, col: last.col, dir: cursor?.dir ?? dir });
      return;
    }
    // E (or Enter on an alternative tile under the cursor) opens its value picker.
    const atCursor = livePlacements.find(
      (item) => item.row === rawCursor?.row && item.col === rawCursor?.col,
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
      if (!rawCursor) return;
      consumed();
      setCursor({ ...rawCursor, dir: rawCursor.dir === "right" ? "down" : "right" });
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
    /** The placement arrow, on a free square (null when off or nowhere free). */
    cursor,
    /** The square the player is looking at (keyboard focus), arrow or not. */
    focus: rawCursor,
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
