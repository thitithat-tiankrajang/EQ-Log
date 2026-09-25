// ── Verifying an imported board ─────────────────────────────────────────────
//
// The board a recogniser proposes, drawn on the ordinary Study board, with the
// squares that need a person marked. Tapping a square here does NOT remove its
// tile the way it does while typing a board: it opens what the evidence thought
// the square might be, so the person can pick, give a blank or choice tile its
// face, or clear it.
//
// This is not a second editor. It only settles what the evidence left open;
// anything else — a tile the recogniser missed entirely, a board rearranged — is
// done afterwards in the normal editor, which is where confirming lands.
//
// Loaded lazily: nothing here is fetched unless an import actually happens.

import { useCallback, useMemo, useState } from "react";
import { Check, TriangleAlert, X } from "lucide-react";

import { AMATH_TOKENS } from "../../../constants/tileDefinitions";
import {
  correctCell,
  provisionalBoard,
  reconstruct,
} from "../../../features/boardVision/reconstruct";
import {
  confirmationBlockers,
  toStudyBoard,
  type ConfirmationBlocker,
} from "../../../features/boardVision/toStudyBoard";
import type {
  BoardEvidence,
  CellCorrection,
  CellFlag,
  ReconstructedCell,
  Reconstruction,
} from "../../../features/boardVision/types";
import { buildAnnotation, type ImportContext } from "../../../features/boardVision/annotation";
import {
  EMPTY,
  TILE_KINDS,
  UNKNOWN,
  isTileKind,
  type CellClass,
} from "../../../features/boardVision/vocabulary";
import { getAssignmentOptions, tileNeedsAssignment, type BoardSnapshot } from "../../../game";
import { Board, type BoardCellMark } from "../../board/Board";
import { Tile } from "../../board/Tile";

const FLAG_TEXT: Record<CellFlag, string> = {
  unreadable: "อ่านไม่ออกว่าเป็นเบี้ยอะไร",
  faceUnresolved: "ต้องเลือกว่าเบี้ยนี้วางเป็นอะไร",
  overspent: "เบี้ยชนิดนี้เกินจำนวนที่มีในชุด",
  uncertain: "ระบบไม่แน่ใจ",
  ruleOverride: "ค่านี้ถูกเปลี่ยนตามกฎ ไม่ใช่สิ่งที่ภาพบอก",
};

const BLOCKING: ReadonlySet<CellFlag> = new Set(["unreadable", "faceUnresolved", "overspent"]);

const cellName = (row: number, col: number) => `R${row + 1} C${col + 1}`;

/** What a reading is called on a button. Kinds use the tile's printed name. */
function readingName(reading: CellClass): string {
  if (reading === EMPTY) return "ว่าง";
  if (reading === UNKNOWN) return "ไม่ทราบ";
  if (reading === "?") return "Blank";
  return AMATH_TOKENS[reading].token;
}

function marksOf(
  cells: readonly ReconstructedCell[],
  selected: { row: number; col: number } | null,
): Map<string, BoardCellMark> {
  const marks = new Map<string, BoardCellMark>();
  for (const cell of cells) {
    const key = `${cell.row}:${cell.col}`;
    if (selected && selected.row === cell.row && selected.col === cell.col) {
      marks.set(key, { tone: "selected", label: `${cellName(cell.row, cell.col)} (กำลังตรวจ)` });
      continue;
    }
    if (cell.flags.length === 0) continue;
    marks.set(key, {
      tone: cell.flags.some((flag) => BLOCKING.has(flag)) ? "danger" : "caution",
      label: cell.flags.map((flag) => FLAG_TEXT[flag]).join(" · "),
    });
  }
  return marks;
}

function blockerText(blocker: ConfirmationBlocker): string {
  switch (blocker.reason) {
    case "unreadable":
      return `${cellName(blocker.row, blocker.col)} — ${FLAG_TEXT.unreadable}`;
    case "faceUnresolved":
      return `${cellName(blocker.row, blocker.col)} — ${readingName(blocker.kind)}: ${FLAG_TEXT.faceUnresolved}`;
    case "faceInvalid":
      return `${cellName(blocker.row, blocker.col)} — วางเป็น ${blocker.face} ไม่ได้`;
    case "overspent":
      return `${readingName(blocker.kind)} มี ${blocker.used} ตัว แต่ชุดเบี้ยมีแค่ ${blocker.available}`;
  }
}

export default function BoardVerification({
  evidence,
  context = null,
  onConfirm,
  onCancel,
}: {
  evidence: BoardEvidence;
  /** Where the evidence came from, when it came from a photo. */
  context?: ImportContext | null;
  onConfirm: (board: BoardSnapshot) => void;
  onCancel: () => void;
}) {
  const [reconstruction, setReconstruction] = useState(() => reconstruct(evidence));
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  /** Annotation mode (development): squares the annotator cannot vouch for. */
  const [unsure, setUnsure] = useState<ReadonlySet<number>>(new Set());

  const board = useMemo(() => provisionalBoard(reconstruction), [reconstruction]);
  const marks = useMemo(
    () => marksOf(reconstruction.cells, selected),
    [reconstruction.cells, selected],
  );
  const blockers = useMemo(() => confirmationBlockers(reconstruction), [reconstruction]);
  const uncertainCount = reconstruction.cells.filter((cell) =>
    cell.flags.includes("uncertain"),
  ).length;

  // `Board` ignores callback identity; hand it a stable one (see Board.tsx).
  const select = useCallback((row: number, col: number) => setSelected({ row, col }), []);

  const apply = (correction: CellCorrection) => {
    if (!selected) return;
    setReconstruction((current) => correctCell(current, selected.row, selected.col, correction));
  };

  const confirm = () => {
    const result = toStudyBoard(reconstruction);
    if (result.ok) onConfirm(result.board);
  };

  const cell = selected ? reconstruction.cells[selected.row * 15 + selected.col] : undefined;

  return (
    <section className="study-step study-verify" aria-label="ตรวจกระดานที่นำเข้า">
      <h2 className="study-heading">ตรวจกระดานที่นำเข้า</h2>
      {context && (
        <p className="info-banner">
          อ่านจาก {context.photoName} ด้วยตัวอ่านภาพรุ่น {context.modelVersion}{" "}
          ซึ่งฝึกด้วยภาพจำลองเท่านั้น และยังไม่ได้วัดความแม่นยำกับรูปจริง —
          ตรวจทุกช่องกับกระดานจริงก่อนยืนยัน
          {!context.reading.decided && " · ทิศของกระดานมาจากการวางมุมของคุณ ไม่ใช่จากการอ่าน"}
        </p>
      )}
      <p className="study-hint">
        แตะช่องที่มีกรอบสีเพื่อดูว่าระบบเห็นอะไร แล้วเลือกให้ถูก · กรอบแดงต้องแก้ก่อนยืนยัน ·
        กรอบเหลืองคือช่องที่ระบบไม่แน่ใจ
      </p>

      <div className="study-board study-verify-board">
        <Board
          board={board}
          pendingPlacements={NO_PENDING}
          cellMarks={marks}
          selectedRackTileId={null}
          selectedPendingTileId={null}
          onCellClick={select}
        />
      </div>

      {cell && <CellInspector cell={cell} onCorrect={apply} onClose={() => setSelected(null)} />}

      {import.meta.env.DEV && context && (
        <AnnotationTools
          reconstruction={reconstruction}
          context={context}
          unsure={unsure}
          selected={selected}
          onToggleUnsure={(index) =>
            setUnsure((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
        />
      )}

      <div className="study-verify-summary" role="status">
        {blockers.length > 0 ? (
          <>
            <p>
              <TriangleAlert size={16} aria-hidden /> ต้องแก้ก่อนยืนยัน {blockers.length} จุด
            </p>
            <ul>
              {blockers.map((blocker) => (
                <li key={blockerText(blocker)}>
                  {"row" in blocker ? (
                    <button type="button" onClick={() => select(blocker.row, blocker.col)}>
                      {blockerText(blocker)}
                    </button>
                  ) : (
                    blockerText(blocker)
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            <Check size={16} aria-hidden /> ไม่มีจุดที่ต้องแก้แล้ว
          </p>
        )}
        {uncertainCount > 0 && <p>ช่องที่ระบบไม่แน่ใจ {uncertainCount} ช่อง — ควรตรวจดู</p>}
        {reconstruction.equationIssues.length > 0 && (
          <ul className="study-verify-equations">
            {reconstruction.equationIssues.map((issue) => (
              <li key={`${issue.direction}:${issue.cells[0]?.row}:${issue.cells[0]?.col}`}>
                <code>{issue.expressionText}</code> — {issue.error}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="study-actions">
        <button type="button" className="ghost-button" onClick={onCancel}>
          <X size={16} aria-hidden /> ยกเลิกการนำเข้า
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={blockers.length > 0}
          onClick={confirm}
        >
          ใช้กระดานนี้
        </button>
      </div>
    </section>
  );
}

const NO_PENDING: never[] = [];

/**
 * Development only: turn a verified photo import into an evaluation label for
 * the real-photo benchmark (amath-vision-training realeval.py). Downloads
 * `<photo>.json`, to be saved next to the photo in data/real/<set>/.
 */
function AnnotationTools({
  reconstruction,
  context,
  unsure,
  selected,
  onToggleUnsure,
}: {
  reconstruction: Reconstruction;
  context: ImportContext;
  unsure: ReadonlySet<number>;
  selected: { row: number; col: number } | null;
  onToggleUnsure: (index: number) => void;
}) {
  const download = () => {
    const annotation = buildAnnotation(reconstruction, context, unsure);
    const blob = new Blob([`${JSON.stringify(annotation, null, 2)}\n`], {
      type: "application/json",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${context.photoName.replace(/\.[^.]+$/, "")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const index = selected ? selected.row * 15 + selected.col : null;
  return (
    <details className="study-annotation">
      <summary>ป้ายกำกับสำหรับวัดผลกับรูปจริง (dev)</summary>
      <p className="study-hint">
        แก้ทุกช่องให้ตรงกับกระดานจริงก่อน (ค่าเริ่มต้นมาจากตัวอ่านภาพ) ·
        ช่องที่ดูไม่ออกให้ทำเครื่องหมาย “ไม่แน่ใจ” แล้วจะไม่ถูกนับคะแนน · ใช้เพื่อวัดผลเท่านั้น
        ห้ามใช้ฝึก
      </p>
      <div className="study-actions">
        <button
          type="button"
          className="ghost-button"
          disabled={index === null}
          onClick={() => index !== null && onToggleUnsure(index)}
        >
          {index !== null && unsure.has(index)
            ? "เลิกทำเครื่องหมายไม่แน่ใจ"
            : "ทำเครื่องหมายช่องนี้ว่าไม่แน่ใจ"}
        </button>
        <button type="button" className="ghost-button" onClick={download}>
          ดาวน์โหลด {context.photoName.replace(/\.[^.]+$/, "")}.json ({unsure.size} ช่องไม่แน่ใจ)
        </button>
      </div>
    </details>
  );
}

function CellInspector({
  cell,
  onCorrect,
  onClose,
}: {
  cell: ReconstructedCell;
  onCorrect: (correction: CellCorrection) => void;
  onClose: () => void;
}) {
  const faces =
    isTileKind(cell.reading) && tileNeedsAssignment(cell.reading)
      ? getAssignmentOptions(cell.reading)
      : [];
  const choices = cell.alternatives.filter((alternative) => alternative.reading !== UNKNOWN);
  const heading = `ช่อง ${cellName(cell.row, cell.col)}`;

  return (
    <section className="study-inspector" aria-label={heading}>
      <header>
        <h3>{heading}</h3>
        <button type="button" className="ghost-button" onClick={onClose} aria-label="ปิด">
          <X size={16} aria-hidden />
        </button>
      </header>

      {cell.flags.length > 0 && (
        <p className="study-hint">{cell.flags.map((flag) => FLAG_TEXT[flag]).join(" · ")}</p>
      )}

      <div className="study-inspector-options" role="group" aria-label="ระบบเห็นเป็น">
        {choices.map((alternative) => {
          const percent = `${Math.round(alternative.probability * 100)}%`;
          return (
            <button
              key={alternative.reading}
              type="button"
              aria-pressed={cell.reading === alternative.reading}
              aria-label={`${readingName(alternative.reading)} ${percent}`}
              onClick={() => onCorrect({ reading: alternative.reading })}
            >
              {isTileKind(alternative.reading) ? (
                <Tile tile={{ id: `alt-${alternative.reading}`, token: alternative.reading }} />
              ) : (
                <span className="study-inspector-empty">{readingName(alternative.reading)}</span>
              )}
              <small>{percent}</small>
            </button>
          );
        })}
        {isTileKind(cell.reading) && (
          <button type="button" onClick={() => onCorrect({ reading: EMPTY })}>
            ลบเบี้ย
          </button>
        )}
      </div>

      {faces.length > 0 && (
        <div className="study-faces" role="group" aria-label="วางเป็น">
          <span>วางเป็น:</span>
          {faces.map((face) => (
            <button
              key={face}
              type="button"
              className={cell.face === face ? "is-active" : ""}
              aria-pressed={cell.face === face}
              onClick={() => onCorrect({ face })}
            >
              {face}
            </button>
          ))}
        </div>
      )}

      <details className="study-inspector-other">
        <summary>เป็นเบี้ยอื่น</summary>
        <div className="study-palette-grid">
          {TILE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className="study-palette-tile"
              aria-label={`เปลี่ยนเป็น ${readingName(kind)}`}
              onClick={() => onCorrect({ reading: kind })}
            >
              <Tile tile={{ id: `other-${kind}`, token: kind }} />
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}
