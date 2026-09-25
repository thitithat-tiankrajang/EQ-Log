import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Play, ShieldCheck } from "lucide-react";
import { Board, type BoardCellMark } from "../board/Board";
import { Tile } from "../board/Tile";
import { AMATH_TOKENS, tileNeedsAssignment, type AmathToken } from "../../game";
import { boardFromStudyCells, type StudyBoardCell } from "../../features/study/position";
import { studyPuzzleRoomId } from "../../features/studyPuzzles/play";
import { routeToHash } from "../../router";
import { useBoardStyles } from "../pages/study/useBoardStyles";
import type {
  AttemptRecord,
  PuzzleCell,
  PuzzleRecord,
  PuzzleSummary,
  SetV2,
  StudyPuzzleSource,
  VerifyResult,
} from "../../features/studyPuzzles/api";
import { CountersView, PuzzleSummaryLine } from "./StudyPuzzleJobPanel";
import { equationOf, placeOf } from "./StudyPuzzleSetViewer";
import {
  CATEGORY_TEXT,
  CONTENT_TEXT,
  HOOK_TEXT,
  MOVE_LABEL_TEXT,
  STATUS_TEXT,
  formatDuration,
  ORIGIN_TEXT,
  VERIFY_TEXT,
} from "./studyPuzzleLabels";

const NO_CELL_CLICK = () => {};

/** The squares as the board draws them: only a choice tile keeps a face of its own. */
function puzzleBoard(cells: readonly PuzzleCell[]) {
  return boardFromStudyCells(
    cells.map((cell): StudyBoardCell => ({
      r: cell.r,
      c: cell.c,
      kind: cell.kind,
      token: tileNeedsAssignment(cell.kind as AmathToken) ? cell.face : cell.kind,
    })),
  );
}

const asStudyCells = (cells: readonly PuzzleCell[]): StudyBoardCell[] =>
  cells.map((cell) => ({ r: cell.r, c: cell.c, kind: cell.kind, token: cell.face }));

function filtersSummary(set: SetV2): string {
  const { bestPlay, answer } = set.manifest.config;
  const range = (name: string, value: { min: number | null; max: number | null }) =>
    value.min === null && value.max === null
      ? null
      : `${name} ${value.min ?? "…"}–${value.max ?? "…"}`;
  return [
    bestPlay.moveTypes.length ? `ประเภท ${bestPlay.moveTypes.join(" หรือ ")}` : null,
    range("แต้ม", bestPlay.score),
    range("เบี้ยที่ลง", bestPlay.tiles),
    range("สมการ", bestPlay.equations),
    ...Object.entries(bestPlay.composition).map(([key, value]) =>
      range(CATEGORY_TEXT[key as keyof typeof CATEGORY_TEXT]?.name ?? key, value),
    ),
    ...Object.entries(bestPlay.specific ?? {}).map(([kind, value]) =>
      range(`เบี้ยใหม่ ${kind}`, value),
    ),
    ...Object.entries(set.manifest.config.rack.groups ?? {}).map(([group, value]) =>
      range(`Rack ${group}`, value),
    ),
    ...Object.entries(set.manifest.config.rack.specific ?? {}).map(([kind, value]) =>
      range(`Rack ${kind}`, value),
    ),
    set.manifest.config.geometry?.extend.shapes.length
      ? `EXTEND ${set.manifest.config.geometry.extend.shapes.join("/")}`
      : null,
    set.manifest.config.geometry?.extend.headContacts
      .map((pair) => `หัว ${pair.join("→")}`)
      .join(" · "),
    set.manifest.config.geometry?.extend.tailContacts
      .map((pair) => `ท้าย ${pair.join("→")}`)
      .join(" · "),
    set.manifest.config.equation && range("เบี้ยในสมการ", set.manifest.config.equation.tiles),
    set.manifest.config.equation &&
      range("เบี้ยเดิมในสมการ", set.manifest.config.equation.reusedBoardTiles),
    set.manifest.config.equation &&
      range("เบี้ยใหม่ในสมการ", set.manifest.config.equation.placedParticipating),
    set.manifest.config.equation?.properties.length
      ? `สมการ ${set.manifest.config.equation.properties.join("+")}`
      : null,
    set.manifest.config.mobility &&
      range("ตาที่ลงได้", set.manifest.config.mobility.legalPlacements),
    bestPlay.content !== "any" ? CONTENT_TEXT[bestPlay.content] : null,
    `ใกล้กันไม่เกิน ${answer.maxNear}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function StudyPuzzleSetView({
  set,
  source,
  onClose,
}: {
  set: SetV2;
  source: StudyPuzzleSource;
  onClose: () => void;
}) {
  useBoardStyles();
  const { manifest } = set;
  const [index, setIndex] = useState(0);
  const entry = manifest.puzzles[Math.min(index, manifest.puzzles.length - 1)];
  return (
    <section className="eq-section eq-study-set" aria-labelledby="study-set-title">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">ชุดโจทย์ · Find Best Play</span>
          <h2 id="study-set-title">{manifest.label || "ชุดโจทย์"}</h2>
          <p>
            <span className={`eq-study-status is-${set.status}`}>{STATUS_TEXT[set.status]}</span>{" "}
            {manifest.puzzles.length}/{manifest.target} ข้อ · สร้างเมื่อ{" "}
            {new Date(manifest.createdAt).toLocaleString("th-TH", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {manifest.durationMs !== undefined &&
              ` · ใช้เวลา ${formatDuration(manifest.durationMs)}`}{" "}
            · เลขสุ่ม {manifest.config.seed}
          </p>
          <p className="eq-study-muted">{filtersSummary(set)}</p>
        </div>
        <button className="eq-button eq-button-secondary" type="button" onClick={onClose}>
          <ArrowLeft aria-hidden size={16} /> กลับไปที่คลัง
        </button>
      </div>

      <details className="eq-study-advanced">
        <summary>ตัวนับของการค้นหา</summary>
        <CountersView counters={manifest.counters} elapsedMs={manifest.durationMs} />
      </details>

      {manifest.puzzles.length === 0 ? (
        <div className="eq-state">
          <h3>ชุดนี้ยังไม่มีโจทย์</h3>
          <p>{manifest.error ?? "หยุดก่อนพบตำแหน่งที่ตรงเงื่อนไข"}</p>
        </div>
      ) : (
        <>
          <ol className="eq-study-puzzle-list" aria-label="โจทย์ในชุดนี้">
            {manifest.puzzles.map((puzzle: PuzzleSummary, puzzleIndex) => (
              <li key={puzzle.id}>
                <button
                  type="button"
                  className={puzzleIndex === index ? "is-active" : ""}
                  aria-pressed={puzzleIndex === index}
                  onClick={() => setIndex(puzzleIndex)}
                >
                  <span>ข้อ {puzzleIndex + 1}</span>
                  <PuzzleSummaryLine puzzle={puzzle} />
                </button>
              </li>
            ))}
          </ol>
          {entry && (
            <PuzzleDetail
              key={entry.id}
              setId={set.id}
              entry={entry}
              number={index + 1}
              source={source}
            />
          )}
        </>
      )}
    </section>
  );
}

function PuzzleDetail({
  setId,
  entry,
  number,
  source,
}: {
  setId: string;
  entry: PuzzleSummary;
  number: number;
  source: StudyPuzzleSource;
}) {
  const [data, setData] = useState<{ puzzle: PuzzleRecord; attempts: AttemptRecord[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [shown, setShown] = useState(0);
  const [verify, setVerify] = useState<VerifyResult | "running" | null>(null);

  useEffect(() => {
    let alive = true;
    source.puzzle(setId, entry.id).then(
      (next) => alive && setData(next),
      (cause: unknown) => alive && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      alive = false;
    };
  }, [setId, entry.id, source]);

  const puzzle = data?.puzzle ?? null;
  const attempts = data?.attempts ?? [];
  const moves = useMemo(
    () =>
      puzzle ? (puzzle.answer.nearBest.length ? puzzle.answer.nearBest : [puzzle.answer.best]) : [],
    [puzzle],
  );
  const move = revealed ? (moves[shown] ?? puzzle?.answer.best ?? null) : null;
  const board = useMemo(
    () =>
      puzzle
        ? puzzleBoard(
            move
              ? [...puzzle.canonical.position.board, ...move.placements]
              : puzzle.canonical.position.board,
          )
        : null,
    [puzzle, move],
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

  if (error) return <p className="eq-alert eq-alert-error">{error}</p>;
  if (!puzzle || !board) {
    return (
      <div className="eq-skeleton-list" role="status" aria-label="กำลังโหลดโจทย์">
        <span />
      </div>
    );
  }
  const { position, source: origin } = puzzle.canonical;
  const { answer } = puzzle;
  const puzzleOrigin = puzzle.canonical.provenance?.origin ?? "AUTHENTIC_SEEDED";
  const rack = position.rack.filter((kind): kind is AmathToken => kind in AMATH_TOKENS);
  const playHref = routeToHash({ kind: "play", roomId: studyPuzzleRoomId(setId, puzzle.id) });
  const features = puzzle.features as Record<string, unknown>;

  return (
    <div className="eq-study-puzzle">
      <div className="eq-study-puzzle-board">
        <p className="eq-study-puzzle-prompt">
          <strong>ข้อ {number}.</strong> จากกระดานและเบี้ยในมือนี้ จะลงตาไหนให้คุ้มค่าที่สุด?
        </p>
        <p className="eq-study-puzzle-context">
          ตาที่ {position.turnNumber} · แต้มเรา {position.scores.self} · แต้มคู่แข่ง{" "}
          {position.scores.opponent} · เบี้ยที่มองไม่เห็น{" "}
          {position.bagCount + position.oppRackCount} (ในถุง {position.bagCount})
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
        <div className="eq-study-set-actions">
          <a
            className="eq-button eq-button-primary"
            href={playHref}
            target="_blank"
            rel="noreferrer"
          >
            <Play aria-hidden size={15} /> ลองเล่น 1 ตา
          </a>
          <button
            className="eq-button eq-button-secondary"
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
        </div>
      </div>

      <aside className="eq-study-puzzle-side" aria-label={`รายละเอียดข้อ ${number}`}>
        {revealed ? (
          <div className="eq-study-answer">
            <h3>เฉลยที่บอทเลือก</h3>
            <p className="eq-study-answer-score">
              <b>{answer.best.score} แต้ม</b> · ลง {answer.composition.total} เบี้ย · ค่าประเมิน{" "}
              {answer.best.value.toFixed(2)}
              {answer.bingoBonus > 0 && ` · บิงโก +${answer.bingoBonus}`}
            </p>
            <ul className="eq-study-tags" aria-label="ประเภทการลง">
              {answer.moveTypes.map((type) => (
                <li key={type} title={MOVE_LABEL_TEXT[type].hint}>
                  {MOVE_LABEL_TEXT[type].name}
                </li>
              ))}
            </ul>
            {answer.geometry?.extend?.shape && (
              <p className="eq-study-muted">
                EXTEND {answer.geometry.extend.shape} · หัว{" "}
                {(
                  answer.geometry.extend.headContacts ??
                  (answer.geometry.extend.headContact ? [answer.geometry.extend.headContact] : [])
                )
                  .map((pair) => pair.join(" → "))
                  .join(", ") || "—"}{" "}
                · ท้าย{" "}
                {(
                  answer.geometry.extend.tailContacts ??
                  (answer.geometry.extend.tailContact ? [answer.geometry.extend.tailContact] : [])
                )
                  .map((pair) => pair.join(" → "))
                  .join(", ") || "—"}
              </p>
            )}
            <ol className="eq-study-equations" aria-label="สมการที่ได้แต้ม">
              {answer.equations.map((equation, equationIndex) => (
                <li key={equationIndex}>
                  <span>
                    {equation.role === "main"
                      ? "หลัก"
                      : `ฮุก · ${HOOK_TEXT[equation.hookSubtype ?? "HEAD"]}`}
                  </span>
                  <strong>{equation.text}</strong>
                  <code>{equation.pattern}</code>
                  {equation.tileCount !== undefined && (
                    <small>
                      สมการ {equation.tileCount} เบี้ย · ใหม่ {equation.placedParticipating} · เดิม{" "}
                      {equation.reusedBoardTiles}
                      {equation.semantics &&
                        ` · ผล ${equation.semantics.result.numerator}/${equation.semantics.result.denominator}`}
                    </small>
                  )}
                  <em>
                    {equation.score} แต้ม{equation.multiplier > 1 && ` (×${equation.multiplier})`}
                  </em>
                </li>
              ))}
            </ol>
            <dl className="eq-study-factors">
              {(Object.keys(CATEGORY_TEXT) as (keyof typeof CATEGORY_TEXT)[]).map((key) => (
                <div key={key}>
                  <dt>{CATEGORY_TEXT[key].name}</dt>
                  <dd>{answer.composition[key]}</dd>
                </div>
              ))}
            </dl>
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
                    <strong>
                      {equationOf(asStudyCells(position.board), asStudyCells(candidate.placements))}
                    </strong>
                    <em>
                      ลง {candidate.placements.length} เบี้ย ·{" "}
                      {placeOf(asStudyCells(candidate.placements))} · {candidate.score} แต้ม
                      {rank > 0 && ` · ห่าง ${(answer.best.value - candidate.value).toFixed(2)}`}
                    </em>
                  </button>
                </li>
              ))}
            </ol>
            <p className="eq-study-muted">
              แต้มตรงกัน: Stage 5B {answer.checks.stage5b} · EQ-Lab {answer.checks.eqlab} · ตัวตรวจ
              C++ {answer.checks.amathCli}
            </p>
          </div>
        ) : (
          <p className="eq-study-muted">
            เฉลยซ่อนอยู่ กด “แสดงเฉลย” เพื่อดูตาที่บอทเลือก สมการที่ได้แต้ม และตาที่ค่าใกล้กัน
          </p>
        )}

        <details className="eq-study-advanced">
          <summary>ค่าที่วัดได้ (ยังไม่ใช่ % ความยาก)</summary>
          <dl className="eq-study-features">
            {[
              ["legalMoves", "ตาที่ลงได้ทั้งหมด"],
              ["legalPlacementCount", "จำนวนตาที่ลงได้ (นับครบ)"],
              ["valueGapToSecond", "ห่างอันดับ 2 (ค่าประเมิน)"],
              ["scoreGapToSecond", "ห่างอันดับ 2 (แต้ม)"],
              ["nearBestCount", "ตาที่ค่าใกล้กัน"],
              ["bestIsHighestScoring", "ตาที่ดีที่สุดแต้มสูงสุดด้วย"],
              ["highestScoringRank", "อันดับของตาแต้มสูงสุด"],
              ["equationCount", "สมการที่ได้แต้ม"],
              ["boardTiles", "เบี้ยบนกระดาน"],
              ["scoreDiff", "แต้มนำ/ตาม"],
              ["rackIndex", "ความติดมือ (v1)"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{formatFeature(features[key!])}</dd>
              </div>
            ))}
          </dl>
        </details>

        <div className="eq-study-provenance">
          <h4>ที่มา</h4>
          <strong>{ORIGIN_TEXT[puzzleOrigin]}</strong>
          <p className="eq-study-muted">
            เกม self-play #{origin.game} · เลขสุ่มเกม {origin.seed} · Stage 5B เล่นทั้งสองฝั่ง ·
            บันทึก {origin.log.turns.length} ตาก่อนถึงโจทย์
          </p>
          {puzzleOrigin === "CONFIG_GUIDED_RACK" && (
            <p className="eq-study-muted">
              กระดานและแต้มจากเกมต้นทาง · จัดเบี้ยใหม่จากจำนวนเบี้ยที่ยังไม่ลงกระดาน
              {puzzle.canonical.provenance?.originalRack &&
                ` · มือเดิม: ${puzzle.canonical.provenance.originalRack.join(" ")}`}
            </p>
          )}
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={verify === "running"}
            onClick={() => {
              setVerify("running");
              source.verify(setId, puzzle.id).then(setVerify, (cause: unknown) =>
                setVerify({
                  ok: false,
                  modes: {
                    seed: {
                      ok: false,
                      error: cause instanceof Error ? cause.message : String(cause),
                    },
                    log: { ok: false },
                  },
                }),
              );
            }}
          >
            <ShieldCheck aria-hidden size={15} /> ตรวจการเล่นซ้ำ
          </button>
          {verify && verify !== "running" && (
            <p className={verify.ok ? "eq-study-ok" : "eq-study-bad"} role="status">
              {verify.ok
                ? puzzleOrigin === "CONFIG_GUIDED_RACK"
                  ? `เกมต้นทางเล่นซ้ำตรง · ชุดเบี้ยที่จัดใหม่ถูกต้องและเบี้ยครบ (${verify.modes.seed.turns} ตา)`
                  : `เล่นซ้ำจากเลขสุ่มและจากบันทึกล้วน ถึงตำแหน่งโจทย์ตรงทุกเบี้ย (${verify.modes.seed.turns} ตา)`
                : `เล่นซ้ำไม่ผ่าน: ${verify.modes.seed.error ?? verify.modes.log.error ?? "ตำแหน่งไม่ตรง"}`}
            </p>
          )}
          {verify && verify !== "running" && verify.checks && (
            <ul aria-label="ผลตรวจสอบโจทย์">
              {Object.entries(verify.checks).map(([key, check]) => (
                <li key={key}>
                  {VERIFY_TEXT[key] ?? key}: {check.ok ? "PASS" : "FAIL"}
                  {check.error && ` · ${check.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>

        {attempts.length > 0 && (
          <div className="eq-study-attempts">
            <h4>คำตอบที่ส่งเข้ามา · {attempts.length}</h4>
            <ol>
              {attempts.map((attempt) => (
                <li key={attempt.id}>
                  <span>
                    {new Date(attempt.submittedAt).toLocaleString("th-TH", {
                      timeStyle: "short",
                      dateStyle: "short",
                    })}
                  </span>
                  <strong>{attempt.validation.score} แต้ม</strong>
                  <em>
                    {attempt.grade.sameAsBest
                      ? "ตรงกับตาที่บอทเลือก"
                      : attempt.grade.withinNearBest
                        ? "อยู่ในตาที่ค่าใกล้กัน"
                        : attempt.grade.engineRank
                          ? `อันดับ ${attempt.grade.engineRank} ของ engine`
                          : "นอกรายการของ engine"}
                  </em>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}

function formatFeature(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "ใช่" : "ไม่";
  if (typeof value === "number")
    return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  return String(value);
}
