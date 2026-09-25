// ── Where an imported board can come from ────────────────────────────────────
//
// Each entry is a producer of `BoardEvidence`. Everything after the evidence —
// reconstruction, verification, the board Study receives — is the same code
// whichever one produced it, so bringing a new producer online is filling in
// its `produce` and nothing else:
//
//   V1  image   a photo, read on this device
//   V3  camera  the live camera
//
// An entry with neither `produce` nor `flow` is not shown in a
// production build: a button that cannot do what it says is worse than no
// button. Development builds show them disabled, so the layout they will
// occupy stays visible, and add a fixture producer that exercises the whole
// path without a recogniser. The `import.meta.env.DEV` branch is removed from
// production builds, and the fixture with it.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

import type { ImportContext } from "../../../features/boardVision/annotation";
import type { BoardEvidence, BoardEvidenceSource } from "../../../features/boardVision/types";

/** What an interactive producer (one that needs its own screens) is given. */
export type ImportFlowProps = {
  onEvidence: (evidence: BoardEvidence, context?: ImportContext) => void;
  onCancel: () => void;
};

/**
 * A producer, as Study offers it: either `produce` (no UI of its own) or a
 * `flow` — a lazily loaded component that walks the person through it and
 * ends in `onEvidence`.
 */
export type StudyEvidenceSource = BoardEvidenceSource & {
  flow?: LazyExoticComponent<ComponentType<ImportFlowProps>>;
};

/** Photo import is on in development, and in a production build only when
 *  VITE_BOARD_IMPORT=1: its accuracy on real photos is not yet measured. */
const PHOTO_IMPORT = import.meta.env.DEV || import.meta.env.VITE_BOARD_IMPORT === "1";

export const BOARD_EVIDENCE_SOURCES: readonly StudyEvidenceSource[] = [
  PHOTO_IMPORT
    ? { id: "image", label: "นำเข้าจากรูป", flow: lazy(() => import("./import/ImageImportFlow")) }
    : { id: "image", label: "นำเข้าจากรูป" },
  { id: "camera", label: "สแกนด้วยกล้อง" },
  ...(import.meta.env.DEV
    ? [
        {
          id: "fixture",
          label: "กระดานตัวอย่าง (dev)",
          produce: async () => {
            const [{ boardEvidenceFromFixture }, fixture] = await Promise.all([
              import("../../../features/boardVision/evidence"),
              import("../../../features/boardVision/fixtures/sampleBoard.json"),
            ]);
            return boardEvidenceFromFixture(fixture.default);
          },
        },
      ]
    : []),
];

/** Whether an entry is drawn at all: always when it works, and in development
 *  (disabled) when it does not yet. */
export function isSourceShown(source: StudyEvidenceSource): boolean {
  return Boolean(source.produce || source.flow) || import.meta.env.DEV;
}
