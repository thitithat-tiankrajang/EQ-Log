import { BookOpen, Square } from "lucide-react";
import type {
  GeneratorCounters,
  PuzzleSummary,
  StudyPuzzleJob,
} from "../../features/studyPuzzles/api";
import { HOOK_TEXT, ORIGIN_TEXT, formatDuration, reasonText } from "./studyPuzzleLabels";

export function PuzzleSummaryLine({ puzzle }: { puzzle: PuzzleSummary }) {
  return (
    <span className="eq-study-summary-line">
      <span>ตา {puzzle.turn}</span>
      <small>{ORIGIN_TEXT[puzzle.origin ?? "AUTHENTIC_SEEDED"]}</small>
      <b>{puzzle.score} แต้ม</b>
      <span>ลง {puzzle.tilesPlaced}</span>
      <span className="eq-study-labels">
        {puzzle.moveTypes.map((type) => (
          <em key={type} className={`is-${type.toLowerCase()}`}>
            {type}
          </em>
        ))}
      </span>
      {puzzle.hooks.length > 0 && (
        <span>{puzzle.hooks.map((hook) => HOOK_TEXT[hook]).join(", ")}</span>
      )}
      <code>{puzzle.pattern}</code>
    </span>
  );
}

/** The numbers an admin watches while a search runs (and reads after it stops). */
export function CountersView({
  counters,
  elapsedMs,
}: {
  counters: GeneratorCounters;
  elapsedMs?: number;
}) {
  const minutes = elapsedMs ? elapsedMs / 60000 : 0;
  const rate = minutes > 0 ? Math.round(counters.positionsInspected / minutes) : null;
  const reasons = Object.entries(counters.rejections)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const base = Math.max(1, counters.positionsInspected);
  return (
    <div className="eq-study-counters">
      <dl>
        <div>
          <dt>เกม self-play</dt>
          <dd>
            {counters.gamesStarted} เริ่ม · {counters.gamesFinished} จบ
            {counters.gamesAbandoned > 0 && ` · ${counters.gamesAbandoned} ทิ้ง`}
          </dd>
        </div>
        <div>
          <dt>ตำแหน่งที่ตรวจ</dt>
          <dd>
            {counters.positionsInspected.toLocaleString()}
            <small> (Stage 5B วิเคราะห์ {counters.positionsAnalyzed.toLocaleString()})</small>
          </dd>
        </div>
        <div>
          <dt>เข้าเกณฑ์ตำแหน่ง</dt>
          <dd>{counters.positionsEligible.toLocaleString()}</dd>
        </div>
        <div>
          <dt>ตรงทุกเงื่อนไข</dt>
          <dd>{(counters.matchingPositions ?? 0).toLocaleString()}</dd>
        </div>
        <div>
          <dt>รับเข้าชุด</dt>
          <dd>{counters.matched}</dd>
        </div>
        {elapsedMs !== undefined && (
          <div>
            <dt>เวลา</dt>
            <dd>
              {formatDuration(elapsedMs)}
              {rate !== null && <small> · {rate} ตำแหน่ง/นาที</small>}
            </dd>
          </div>
        )}
      </dl>
      {counters.stage5bEvaluations !== undefined && (
        <details className="eq-study-advanced">
          <summary>รายละเอียดการค้นหา</summary>
          <dl>
            <div>
              <dt>ตำแหน่งที่ข้ามก่อนจัดเบี้ย</dt>
              <dd>{counters.positionsGeometryPruned ?? 0}</dd>
            </div>
            <div>
              <dt>มือจริงมีชนิดเบี้ยไม่พอ</dt>
              <dd>{counters.authenticRacksCompositionPruned ?? 0}</dd>
            </div>
            <div>
              <dt>ชุดเบี้ยที่ทดลองจัด</dt>
              <dd>{counters.guidedRacksGenerated ?? 0}</dd>
            </div>
            <div>
              <dt>ตัดก่อนเรียก Stage 5B</dt>
              <dd>
                {counters.guidedRacksCheapPruned ?? 0} / {counters.guidedRacksGenerated ?? 0}
              </dd>
            </div>
            <div>
              <dt>Stage 5B ทั้งหมด</dt>
              <dd>
                {counters.stage5bEvaluations} ครั้ง · เล่นเกม{" "}
                {counters.sourceStage5bEvaluations ?? 0} · ทดลองมือ{" "}
                {counters.guidedStage5bEvaluations ?? 0}
              </dd>
            </div>
            <div>
              <dt>เวลา Stage 5B เฉลี่ย</dt>
              <dd>
                {counters.stage5bEvaluations
                  ? ((counters.stage5bMs ?? 0) / counters.stage5bEvaluations / 1000).toFixed(2)
                  : "—"}{" "}
                วินาที/ครั้ง
              </dd>
            </div>
            <div>
              <dt>โจทย์ต่อการเรียก Stage 5B</dt>
              <dd>
                {counters.matched} / {counters.stage5bEvaluations}
              </dd>
            </div>
            <div>
              <dt>รับเข้าชุดตามที่มา</dt>
              <dd>
                แจกตาม seed {counters.acceptedAuthentic ?? 0} · จัดชุดเบี้ย{" "}
                {counters.acceptedGuided ?? 0}
              </dd>
            </div>
            <div>
              <dt>ชุดเบี้ยซ้ำที่ข้าม</dt>
              <dd>{counters.duplicateRacksSkipped ?? 0}</dd>
            </div>
            <div>
              <dt>Engine ผิดพลาด</dt>
              <dd>{counters.engineErrors ?? 0}</dd>
            </div>
          </dl>
        </details>
      )}
      {reasons.length > 0 && (
        <div className="eq-study-reasons">
          <h4>เหตุที่ตัดทิ้ง (หนึ่งตำแหน่งตัดได้หลายเหตุ)</h4>
          <ul>
            {reasons.map(([code, count]) => (
              <li key={code}>
                <span>{reasonText(code)}</span>
                <b>{count.toLocaleString()}</b>
                <i style={{ width: `${Math.min(100, (count / base) * 100)}%` }} aria-hidden />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function StudyPuzzleJobPanel({
  job,
  busy,
  onStop,
  onOpen,
}: {
  job: StudyPuzzleJob;
  busy: boolean;
  onStop: () => void;
  onOpen: (id: string) => void;
}) {
  const title = job.config.label || "ชุดโจทย์";
  const running = job.state === "running";
  return (
    <div className={`eq-study-job is-${job.state}`} role="status" aria-live="polite">
      <div className="eq-study-job-line">
        {running && <span className="eq-study-job-dot" aria-hidden />}
        <p>
          {running ? (
            <>
              กำลังค้นหา “{title}” ในเกม self-play · พบแล้ว{" "}
              <b>
                {job.matched}/{job.target}
              </b>{" "}
              ข้อ
              {job.stopRequested && " · กำลังหยุด…"}
            </>
          ) : job.state === "complete" ? (
            <>
              ครบแล้ว: “{title}” ได้{" "}
              <b>
                {job.matched}/{job.target}
              </b>{" "}
              ข้อ
            </>
          ) : job.state === "stopped" ? (
            <>
              หยุดแล้ว: “{title}” เก็บไว้{" "}
              <b>
                {job.matched}/{job.target}
              </b>{" "}
              ข้อ
            </>
          ) : (
            <>
              {job.state === "failed" ? "สร้างไม่สำเร็จ" : "ถูกตัดกลางทาง"}:{" "}
              {job.error ?? "ไม่ทราบสาเหตุ"}
              {job.matched > 0 && ` · เก็บไว้ ${job.matched} ข้อ`}
            </>
          )}
        </p>
        {running ? (
          <button
            className="eq-button eq-button-secondary"
            type="button"
            disabled={busy || job.stopRequested}
            onClick={onStop}
          >
            <Square aria-hidden size={14} /> หยุดและเก็บข้อที่ได้
          </button>
        ) : (
          job.matched > 0 && (
            <button
              className="eq-button eq-button-primary"
              type="button"
              onClick={() => onOpen(job.id)}
            >
              <BookOpen aria-hidden size={15} /> เปิดชุดนี้
            </button>
          )
        )}
      </div>
      {job.counters && <CountersView counters={job.counters} elapsedMs={job.elapsedMs} />}
      {job.recent.length > 0 && (
        <ul className="eq-study-recent" aria-label="ข้อที่ได้ล่าสุด">
          {job.recent.map((puzzle) => (
            <li key={puzzle.id}>
              <PuzzleSummaryLine puzzle={puzzle} />
            </li>
          ))}
        </ul>
      )}
      {job.logs.length > 0 && (
        <details className="eq-study-log">
          <summary>บันทึกการทำงาน ({job.logs.length} บรรทัด)</summary>
          <pre>{job.logs.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
