import { useMemo, useState } from "react";
import { ArrowLeft, Download, Eye, EyeOff, FileText, GraduationCap } from "lucide-react";
import { Board, type BoardCellMark } from "../board/Board";
import { Tile } from "../board/Tile";
import { AMATH_TOKENS, tileNeedsAssignment, type AmathToken } from "../../game";
import { boardFromStudyCells, type StudyBoardCell } from "../../features/study/position";
import { useBoardStyles } from "../pages/study/useBoardStyles";
import type {
  LegacyMode,
  LegacyPuzzle,
  LegacySet,
  StudyPuzzleSource,
} from "../../features/studyPuzzles/api";

export const MODE_LABELS: Record<LegacyMode, string> = {
  any: "ผสมหลายแบบ",
  cross: "ลงไขว้",
  "fraction-sum": "บวกลบเศษส่วน",
  fraction: "หารแล้วได้เศษส่วน",
  large: "มีเลขหลักร้อย",
  bingo: "ลงครบ 8 เบี้ย",
  arithmetic: "คำนวณหลายขั้น",
};

const RACK_ORIGIN: Record<string, string> = {
  original: "มือจริงจากเกม",
  operator: "สุ่มมือใหม่ เน้นเครื่องหมาย",
  division: "สุ่มมือใหม่ เน้นการหาร",
  duplicate: "สุ่มมือใหม่ มีเลขซ้ำ",
};

const FACTOR_LABELS: Record<string, string> = {
  "immediate-score": "แต้มตานี้",
  "area-potential": "พื้นที่",
  "unseen-potential": "โอกาสเบี้ย",
  leave: "เบี้ยเหลือ",
  "future-access": "ทางเล่นต่อ",
  exposure: "ช่องเปิด",
  "nn-value": "Stage 5A",
};

// The board is read-only here; `Board` still wants a stable handler.
const NO_CELL_CLICK = () => {};

/**
 * The squares as the board draws them. The generator writes the face of a plain
 * `×` or `÷` into `token` as well; only a tile with a choice (blank, `+/-`,
 * `×/÷`) keeps a face of its own, so that is the only one given one here.
 */
function puzzleBoard(cells: readonly StudyBoardCell[]) {
  return boardFromStudyCells(
    cells.map((cell) =>
      tileNeedsAssignment(cell.kind as AmathToken) ? cell : { ...cell, token: cell.kind },
    ),
  );
}

/**
 * The equation a turn makes, read off the board along the line it was laid in,
 * with neighbouring number tiles joined into the number they form (`8` `0` is
 * 80). A single tile is read along whichever of its two lines is longer.
 */
export function equationOf(
  board: readonly StudyBoardCell[],
  placements: readonly StudyBoardCell[],
): string {
  const cells = new Map<string, StudyBoardCell>();
  for (const cell of [...board, ...placements]) cells.set(`${cell.r}:${cell.c}`, cell);
  const start = placements[0];
  if (!start) return "";
  const line = (dr: number, dc: number) => {
    let r = start.r;
    let c = start.c;
    while (cells.has(`${r - dr}:${c - dc}`)) {
      r -= dr;
      c -= dc;
    }
    const tokens: string[] = [];
    for (let cell = cells.get(`${r}:${c}`); cell; cell = cells.get(`${r}:${c}`)) {
      tokens.push(cell.token);
      r += dr;
      c += dc;
    }
    return tokens;
  };
  const rows = new Set(placements.map((cell) => cell.r)).size;
  const across = line(0, 1);
  const down = line(1, 0);
  const tokens =
    placements.length > 1
      ? rows === 1
        ? across
        : down
      : across.length >= down.length
        ? across
        : down;
  const grouped: string[] = [];
  for (const token of tokens) {
    const previous = grouped.at(-1);
    if (/^\d+$/.test(token) && previous !== undefined && /^\d+$/.test(previous)) {
      grouped[grouped.length - 1] = previous + token;
    } else {
      grouped.push(token);
    }
  }
  return grouped.join(" ");
}

/** Where a turn goes, in the board's own labels: `R3–R12 · C5`, `R8 · C2–C9`. */
export function placeOf(placements: readonly StudyBoardCell[]): string {
  const rows = [...new Set(placements.map((cell) => cell.r + 1))].sort((a, b) => a - b);
  const cols = [...new Set(placements.map((cell) => cell.c + 1))].sort((a, b) => a - b);
  const span = (axis: "R" | "C", values: number[]) =>
    values.length > 1 ? `${axis}${values[0]}–${axis}${values.at(-1)}` : `${axis}${values[0]}`;
  return `${span("R", rows)} · ${span("C", cols)}`;
}

export function puzzleTags(puzzle: LegacyPuzzle): string[] {
  const { features } = puzzle;
  return [
    features.bingo && "บิงโก",
    features.cross >= 1 && `ไขว้ ${features.cross} จุด`,
    features.fractionSum ? "บวกลบเศษส่วน" : features.fraction && "หารไม่ลงตัว",
    features.large && "เลขสามหลัก",
    features.arithmetic && "คำนวณซับซ้อน",
  ].filter((tag): tag is string => Boolean(tag));
}

function formatDuration(ms: number | null): string | null {
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} วิ` : `${Math.floor(seconds / 60)} นาที ${seconds % 60} วิ`;
}

export function StudyPuzzleSetViewer({
  set,
  source,
  onClose,
}: {
  set: LegacySet;
  source: StudyPuzzleSource;
  onClose: () => void;
}) {
  useBoardStyles();
  const [index, setIndex] = useState(0);
  const puzzle = set.puzzles[Math.min(index, set.puzzles.length - 1)];
  const duration = formatDuration(set.durationMs);
  const seed = set.config?.seed;

  return (
    <section className="eq-section eq-study-set" aria-labelledby="study-set-title">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">ชุดโจทย์ · Find Best Play</span>
          <h2 id="study-set-title">
            {set.label || MODE_LABELS[(set.mode ?? "any") as LegacyMode]}
          </h2>
          <p>
            {set.count}/{set.requested} ข้อ · {MODE_LABELS[(set.mode ?? "any") as LegacyMode]} ·
            สร้างเมื่อ{" "}
            {new Date(set.createdAt).toLocaleString("th-TH", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {duration && ` · ใช้เวลา ${duration}`}
            {set.scanned !== null && ` · ตรวจ ${set.scanned} สถานการณ์`}
            {seed !== undefined && ` · เลขสุ่ม ${seed}`}
          </p>
        </div>
        <div className="eq-study-set-actions">
          <button className="eq-button eq-button-secondary" type="button" onClick={onClose}>
            <ArrowLeft aria-hidden size={16} /> กลับไปที่คลัง
          </button>
          <a
            className="eq-button eq-button-secondary"
            href={source.fileUrl(set.id, "student.html")}
            target="_blank"
            rel="noreferrer"
          >
            <FileText aria-hidden size={16} /> โจทย์สำหรับเด็ก
          </a>
          <a
            className="eq-button eq-button-secondary"
            href={source.fileUrl(set.id, "teacher.html")}
            target="_blank"
            rel="noreferrer"
          >
            <GraduationCap aria-hidden size={16} /> เฉลยผู้สอน
          </a>
          <a
            className="eq-button eq-button-secondary"
            href={source.fileUrl(set.id, "puzzles.json")}
            download
          >
            <Download aria-hidden size={16} /> JSON
          </a>
        </div>
      </div>

      {set.puzzles.length > 1 && (
        <div className="eq-segmented-control" role="tablist" aria-label="เลือกข้อ">
          {set.puzzles.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={itemIndex === index}
              className={itemIndex === index ? "is-active" : ""}
              onClick={() => setIndex(itemIndex)}
            >
              ข้อ {itemIndex + 1}
            </button>
          ))}
        </div>
      )}

      {puzzle && <PuzzleView key={puzzle.id} number={index + 1} puzzle={puzzle} />}
    </section>
  );
}

function PuzzleView({ puzzle, number }: { puzzle: LegacyPuzzle; number: number }) {
  const [revealed, setRevealed] = useState(false);
  // Which of the near-equal turns the board shows; the first is the answer.
  const [shown, setShown] = useState(0);
  const moves = puzzle.nearBest.length > 0 ? puzzle.nearBest : [puzzle.answer];
  const move = revealed ? (moves[shown] ?? puzzle.answer) : null;

  const board = useMemo(
    () => puzzleBoard(move ? [...puzzle.board, ...move.placements] : puzzle.board),
    [puzzle.board, move],
  );
  const marks = useMemo(() => {
    const map = new Map<string, BoardCellMark>();
    for (const cell of move?.placements ?? []) {
      map.set(`${cell.r}:${cell.c}`, {
        tone: "selected",
        label: shown === 0 ? "ตาที่บอทเลือก" : `ตาที่ค่าใกล้กัน #${shown + 1}`,
      });
    }
    return map;
  }, [move, shown]);
  const rack = puzzle.rack.filter((kind): kind is AmathToken => kind in AMATH_TOKENS);
  const tags = puzzleTags(puzzle);
  const best = puzzle.answer;

  return (
    <div className="eq-study-puzzle">
      <div className="eq-study-puzzle-board">
        <p className="eq-study-puzzle-prompt">
          <strong>ข้อ {number}.</strong> จากกระดานและเบี้ยในมือนี้ จะลงตาไหนให้คุ้มค่าที่สุด?
        </p>
        <p className="eq-study-puzzle-context">
          แต้มเรา {puzzle.scores.self} · แต้มคู่แข่ง {puzzle.scores.opponent} · เบี้ยในถุง{" "}
          {puzzle.bagCount}
        </p>
        <div className="study-board is-readonly">
          <Board
            board={board}
            pendingPlacements={[]}
            cellMarks={marks}
            selectedRackTileId={null}
            selectedPendingTileId={null}
            onCellClick={NO_CELL_CLICK}
          />
        </div>
        <div className="study-rack eq-study-puzzle-rack" role="list" aria-label="เบี้ยในมือ">
          {rack.map((kind, slot) => (
            <span key={`${kind}-${slot}`} role="listitem">
              <Tile tile={{ id: `rack-${slot}`, token: kind }} />
            </span>
          ))}
        </div>
      </div>

      <aside className="eq-study-puzzle-side" aria-label={`เฉลยข้อ ${number}`}>
        <button
          className={`eq-button ${revealed ? "eq-button-secondary" : "eq-button-primary"}`}
          type="button"
          aria-pressed={revealed}
          onClick={() => {
            setRevealed((value) => !value);
            setShown(0);
          }}
        >
          {revealed ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
          {revealed ? "ซ่อนเฉลย" : "แสดงเฉลย"}
        </button>

        {revealed ? (
          <div className="eq-study-answer">
            <h3>เฉลยที่บอทเลือก</h3>
            <p className="eq-study-answer-score">
              <b>{best.score} แต้ม</b> · ลง {best.placements.length} เบี้ย · ค่าประเมิน{" "}
              {best.value.toFixed(2)}
            </p>
            <p>สมการหลัก: {equationOf(puzzle.board, best.placements)}</p>
            {tags.length > 0 && (
              <ul className="eq-study-tags" aria-label="ลักษณะของตานี้">
                {tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
            {best.components && best.components.length > 0 && (
              <dl className="eq-study-factors">
                {best.components.map((part) => (
                  <div key={part.name}>
                    <dt>{FACTOR_LABELS[part.name] ?? part.name}</dt>
                    <dd>{part.points.toFixed(1)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <h4>ตาที่ค่าใกล้กัน (ห่างไม่เกิน 0.5) · {moves.length} ตา</h4>
            <ol className="eq-study-near" aria-label="ตาที่ค่าใกล้กัน">
              {moves.map((candidate, rank) => (
                <li key={rank}>
                  <button
                    type="button"
                    className={rank === shown ? "is-active" : ""}
                    aria-pressed={rank === shown}
                    onClick={() => setShown(rank)}
                  >
                    <span>#{rank + 1}</span>
                    <strong>{equationOf(puzzle.board, candidate.placements)}</strong>
                    <em>
                      ลง {candidate.placements.length} เบี้ย · {placeOf(candidate.placements)} ·{" "}
                      {candidate.score} แต้ม
                      {rank > 0 && ` · ห่าง ${(best.value - candidate.value).toFixed(2)}`}
                    </em>
                  </button>
                </li>
              ))}
            </ol>
            <p className="eq-study-muted">
              {puzzle.alternative
                ? `ทางเลือกอันดับ 2: ${puzzle.alternative.score} แต้ม · ค่าประเมิน ${puzzle.alternative.value.toFixed(2)}`
                : "ไม่มีทางเลือกอันดับ 2"}
            </p>
          </div>
        ) : (
          <p className="eq-study-muted">
            เฉลยซ่อนอยู่ กด “แสดงเฉลย” เพื่อดูตาที่บอทเลือกและตาที่ค่าใกล้กัน
          </p>
        )}

        <p className="eq-study-muted">
          ที่มา: เกม self-play #{puzzle.source.game} ตา {puzzle.source.turn} ·{" "}
          {RACK_ORIGIN[puzzle.source.profile] ?? puzzle.source.profile} · Stage 5B ตรวจ{" "}
          {puzzle.search.legalMoves.toLocaleString()} ตา เชิงลึก {puzzle.search.deepTop} ตา
        </p>
        <p className="eq-study-muted">
          เฉลยคือตาที่ Stage 5B ให้ค่าสูงสุด เป็นการจัดอันดับโดยประมาณ
          ไม่ใช่การพิสูจน์ว่าไม่มีตาที่ดีกว่า ควรตรวจก่อนนำไปสอน
        </p>
      </aside>
    </div>
  );
}
