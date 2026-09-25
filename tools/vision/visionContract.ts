// The vision training contract, built from the runtime's own modules. Pure:
// `exportContract.ts` writes it out; `tests/board-vision-contract.test.ts` pins it.

import { BOARD_SIZE } from "../../src/constants/gameRules";
import { AMATH_TOKENS } from "../../src/constants/tileDefinitions";
import { TILE_COUNT, manifestFingerprint } from "../../src/domain/tiles";
import {
  CELL_CLASSES,
  EMPTY,
  TILE_KINDS,
  UNKNOWN,
  vocabularyFingerprint,
} from "../../src/features/boardVision/vocabulary";
import {
  BOARD_LAYOUT,
  displayToken,
  getAssignmentOptions,
  tileNeedsAssignment,
  tilePoint,
} from "../../src/game";
import { SLOT_LABELS } from "../../src/uiText";
import { CROP_CONTRACT } from "../../src/features/boardVision/crops";

export const CONTRACT_SCHEMA_VERSION = 1;

export function visionContract() {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source: "EQ-Lab tools/vision/exportContract.ts",
    manifestFingerprint: manifestFingerprint(),
    vocabularyFingerprint: vocabularyFingerprint(),
    cellClasses: [...CELL_CLASSES],
    emptyClass: EMPTY,
    unknownClass: UNKNOWN,
    totalTiles: TILE_COUNT,
    boardSize: BOARD_SIZE,
    tiles: TILE_KINDS.map((kind) => {
      const tile = { id: "contract", token: kind };
      return {
        kind,
        // What is PRINTED on the physical tile. A face someone assigns is
        // never printed, so it is never here.
        printed: kind === "?" ? "" : displayToken(tile),
        point: tilePoint(tile),
        count: AMATH_TOKENS[kind].count,
        type: AMATH_TOKENS[kind].type,
        assignable: tileNeedsAssignment(kind),
        faces: [...getAssignmentOptions(kind)],
      };
    }),
    boardLayout: BOARD_LAYOUT,
    slotLabels: SLOT_LABELS,
    // How the runtime cuts square crops (features/boardVision/crops.ts). The
    // training side reads these instead of restating them; a model's meta.json
    // repeats them and `checkClassifierMeta` refuses any that differ.
    crop: { ...CROP_CONTRACT },
  };
}
