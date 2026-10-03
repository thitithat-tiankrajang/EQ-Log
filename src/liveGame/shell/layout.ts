/**
 * Board-first geometry for the live game shell.
 *
 * The board is square, so past a point extra width on a landscape screen (or
 * extra height on a portrait one) no longer makes it bigger. This module finds
 * the arrangement whose BOARD is largest for the viewport, then hands the
 * left-over space to secondary information. Every number is an integer pixel so
 * the 15×15 grid and the tile glyphs stay crisp.
 *
 *  duo              board centred, a gutter on each side (desktop)
 *  column           board left, one side column (tablet landscape, narrow laptops)
 *  stack            strips above and below the board (phones, tablet portrait)
 *  stack-landscape  phone on its side: board in the middle, strips beside it
 *
 * `rack: "gutter"` moves the rack beside the board, into the lower right gutter,
 * when the viewport is so short that a rack row under the board would cost the
 * board materially (≥ 6%) and the gutter has room for eight readable tiles.
 */

export type LayoutMode = "duo" | "column" | "stack" | "stack-landscape";
export type RackPlacement = "below" | "gutter" | "side";

export type LiveLayout = {
  mode: LayoutMode;
  rack: RackPlacement;
  /** Board cell edge in px. */
  cell: number;
  /** Coordinate label band in px (0 when labels are hidden). */
  label: number;
  /** Outer edge of the square board frame in px (cells + labels + border). */
  board: number;
  rackTile: number;
  /** Width of the side gutter(s) in px (0 in stack). */
  gutter: number;
  /** Stack only: the self strip folds into the action row to give the board height. */
  compact: boolean;
};

export type LayoutInput = { width: number; height: number };

const BORDER = 2;
const MIN_CELL = 14;
/** Narrowest useful side gutter for player cards, Last Move and tools. */
const DUO_GUTTER = 280;
const COLUMN_WIDTH = 300;
/** A rack row below the board costs about 1.15 cells plus padding. */
const RACK_ROW_RATIO = 1.15;
const PAD = 12;
const GAP = 8;
/** Rack tray padding and border on both sides (live-shell.css). */
const RACK_CHROME = 12;
/** A rack row under the board is kept unless it would push cells below this. */
const SHORT_CELL = 36;

const LABEL_RATIO = 0.55;

function frame(cell: number, labels: boolean) {
  const label = labels ? Math.round(cell * LABEL_RATIO) : 0;
  return { label, board: cell * 15 + label + BORDER };
}

function clampCell(value: number) {
  return Math.max(MIN_CELL, Math.floor(value));
}

type Candidate = LiveLayout & { score: number; rank: number };

function desktopCandidates({ width, height }: LayoutInput): Candidate[] {
  const out: Candidate[] = [];
  const perCell = 15 + LABEL_RATIO;
  // Height-bound cell with the rack row under the board.
  const belowCell = clampCell((height - 2 * PAD - GAP - 12 - BORDER) / (perCell + RACK_ROW_RATIO));
  // Height-bound cell with the rack moved into a gutter.
  const gutterCell = clampCell((height - 2 * PAD - BORDER) / perCell);
  for (const [mode, sideSpace, rank] of [
    ["duo", 2 * DUO_GUTTER, 0],
    ["column", COLUMN_WIDTH + PAD, 1],
  ] as const) {
    const widthCell = clampCell((width - 2 * PAD - sideSpace - BORDER) / perCell);
    const cell = Math.min(widthCell, belowCell);
    const { label, board } = frame(cell, true);
    const gutter =
      mode === "duo"
        ? Math.floor((width - board - 2 * PAD) / 2)
        : Math.floor(width - board - 3 * PAD);
    const rackTile = Math.max(30, Math.min(64, Math.round(cell * RACK_ROW_RATIO)));
    out.push({
      mode,
      rack: "below",
      cell,
      label,
      board,
      rackTile,
      gutter,
      compact: false,
      score: board,
      rank,
    });

    // The short-window variant: rack into the lower right gutter.
    const tall = Math.min(widthCell, gutterCell);
    const moved = frame(tall, true);
    const movedGutter =
      mode === "duo"
        ? Math.floor((width - moved.board - 2 * PAD) / 2)
        : Math.floor(width - moved.board - 3 * PAD);
    const tile = Math.min(52, Math.floor((movedGutter - 24 - 7 * 4) / 8));
    // Only a genuinely short window: below ~36 px cells the rack row costs too much.
    if (belowCell < SHORT_CELL && tile >= 34 && moved.board >= board * 1.06)
      out.push({
        mode,
        rack: "gutter",
        cell: tall,
        label: moved.label,
        board: moved.board,
        rackTile: tile,
        gutter: movedGutter,
        compact: false,
        score: moved.board,
        rank: rank + 0.5,
      });
  }
  return out;
}

function stackCandidate({ width, height }: LayoutInput): Candidate {
  const phone = width < 600;
  const margin = phone ? 4 : 16;
  const labels = !phone;
  const tileGap = phone ? 4 : 6;
  const rackTile = Math.max(
    30,
    Math.min(phone ? 52 : 64, Math.floor((width - 2 * margin - 7 * tileGap - RACK_CHROME) / 8)),
  );
  const opp = phone ? 44 : 56;
  const self = phone ? 40 : 48;
  const actions = phone ? 52 : 56;
  const rackRow = rackTile + 10;
  const gaps = phone ? 12 : 24;
  const perCell = 15 + (labels ? LABEL_RATIO : 0);
  const widthCell = clampCell((width - 2 * margin - BORDER) / perCell);
  const fullCell = clampCell((height - (opp + self + rackRow + actions + gaps) - BORDER) / perCell);
  // Height-bound: fold the self strip into the action row instead of shrinking the board.
  const compactCell = clampCell((height - (opp + rackRow + actions + gaps) - BORDER) / perCell);
  const compact = fullCell < widthCell && phone;
  const cell = Math.min(widthCell, compact ? compactCell : fullCell);
  const { label, board } = frame(cell, labels);
  return {
    mode: "stack",
    rack: "below",
    cell,
    label,
    board,
    rackTile,
    gutter: 0,
    compact,
    score: board,
    rank: 2,
  };
}

function landscapePhoneCandidate({ width, height }: LayoutInput): Candidate | null {
  if (height >= 520 || width <= height) return null;
  const cell = clampCell((height - 8 - BORDER) / 15);
  const { label, board } = frame(cell, false);
  const gutter = Math.floor((width - board - 16) / 2);
  if (gutter < 150) return null;
  const rackTile = Math.max(30, Math.min(48, Math.floor((gutter - 12 - 3 * 4) / 4)));
  return {
    mode: "stack-landscape",
    rack: "side",
    cell,
    label,
    board,
    rackTile,
    gutter,
    compact: false,
    score: board,
    rank: 3,
  };
}

/** The arrangement with the largest square board; ties prefer duo, column, stack. */
export function computeLiveLayout(input: LayoutInput): LiveLayout {
  const width = Math.max(240, Math.floor(input.width));
  const height = Math.max(240, Math.floor(input.height));
  const viewport = { width, height };
  const candidates: Candidate[] = [stackCandidate(viewport)];
  if (width >= 700 && height >= 380) candidates.push(...desktopCandidates(viewport));
  const landscape = landscapePhoneCandidate(viewport);
  if (landscape) candidates.push(landscape);
  candidates.sort((a, b) => b.score - a.score || a.rank - b.rank);
  // A desktop gutter narrower than its minimum is not a layout, just leftovers.
  const usable = candidates.find(
    (item) =>
      (item.mode !== "duo" || item.gutter >= DUO_GUTTER - 16) &&
      (item.mode !== "column" || item.gutter >= COLUMN_WIDTH - 16),
  )!;
  return {
    mode: usable.mode,
    rack: usable.rack,
    cell: usable.cell,
    label: usable.label,
    board: usable.board,
    rackTile: usable.rackTile,
    gutter: usable.gutter,
    compact: usable.compact,
  };
}
