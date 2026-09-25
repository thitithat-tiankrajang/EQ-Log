// Synthetic "photographs" for Board Vision geometry tests, and an oracle
// recogniser that reads them. Test doubles only.
import { BOARD_SIZE } from "../../src/constants/gameRules";
import {
  CROP_CONTRACT,
  type PixelImage,
  type SquareCrop,
} from "../../src/features/boardVision/crops";
import {
  applyHomography,
  boardToImage,
  invertHomography,
  physicalSquare,
  turnInReading,
  type Quad,
} from "../../src/features/boardVision/geometry";
import type {
  ClassifierMeta,
  SquareClassifier,
  SquareReading,
} from "../../src/features/boardVision/classifier";
import {
  CELL_CLASSES,
  EMPTY,
  UNKNOWN,
  type CellClass,
} from "../../src/features/boardVision/vocabulary";

export const OUTSIDE = 255;

/** A flat board seen through `quad`: square (r, c) is painted R = r·15 + c,
 *  G = 255 − R, B = 77; everything off the grid is R = 255. */
export function photograph(quad: Quad, width: number, height: number): PixelImage {
  const toBoard = invertHomography(boardToImage(quad));
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [u, v] = applyHomography(toBoard, [x + 0.5, y + 0.5]);
      const inside = u >= 0 && v >= 0 && u < BOARD_SIZE && v < BOARD_SIZE;
      const id = inside ? Math.floor(v) * BOARD_SIZE + Math.floor(u) : OUTSIDE;
      const o = (y * width + x) * 3;
      data[o] = id;
      data[o + 1] = 255 - id;
      data[o + 2] = 77;
    }
  }
  return { width, height, channels: 3, data };
}

/** The physical square a crop of `photograph` is centred on, read off its pixels. */
export function centreId(crop: Uint8Array): number {
  const D = CROP_CONTRACT.cropSize;
  return crop[((D / 2) * D + D / 2) * 3]!;
}

export const MODEL_CLASSES: readonly CellClass[] = CELL_CLASSES.filter((c) => c !== UNKNOWN);

export const ORACLE_META: ClassifierMeta = {
  modelVersion: "oracle",
  vocabularyFingerprint: "test",
  classes: MODEL_CLASSES,
  temperature: 1,
  topK: 3,
  domain: "test double",
};

export type TruthSquare = { kind: CellClass; turn: number } | null;

/**
 * A recogniser that KNOWS the board: it finds the physical square from the
 * crop's painted centre and reports that square's true kind with `confidence`,
 * and the true turn as it appears in the crop. It uses the crop's (row, col)
 * only to work out the reading — something a real recogniser never gets.
 */
export function oracleClassifier(
  truth: readonly TruthSquare[],
  confidence = 0.97,
): SquareClassifier {
  const read = (crop: SquareCrop): SquareReading => {
    const id = centreId(crop.pixels);
    const square = id < 225 ? truth[id] : null;
    const kinds = MODEL_CLASSES.map(() => (1 - confidence) / (MODEL_CLASSES.length - 1));
    kinds[MODEL_CLASSES.indexOf(square ? square.kind : EMPTY)] = confidence;
    let turn = 0;
    if (square && id < 225) {
      const k = [0, 1, 2, 3].find((s) => {
        const [r, c] = physicalSquare(s, crop.row, crop.col);
        return r * BOARD_SIZE + c === id;
      });
      turn = turnInReading(k ?? 0, square.turn);
    }
    const turns = [0.01, 0.01, 0.01, 0.01] as [number, number, number, number];
    turns[turn] = 0.97;
    return { kinds, turns };
  };
  return { meta: ORACLE_META, classify: async (crops) => crops.map(read) };
}
