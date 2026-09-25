import { useId } from "react";
import {
  ANALYSIS_LEVEL_SAMPLES,
  type AnalysisCandidate,
  type AnalysisResult,
} from "../../bot/engineApi";
import { useDialogBehavior } from "../ui/useDialogBehavior";

// The player's own turn, analysed. Reuses the "why this move" panel's visual
// language on purpose: the two answer the same question about different turns,
// and giving them different chrome would suggest they came from different
// engines. They do not — it is one search, read out at different depths.
//
// Every number shown here is one the engine produced. Nothing on this screen is
// computed for presentation.

const SOLVER_LABEL: Record<AnalysisResult["method"]["solver"], string> = {
  sim: "ลองเดินเกมหลายแบบ",
  endgame: "คำนวณจนจบเกม",
  greedy: "เทียบทางเลือกที่เห็น",
  stage5b: "Stage 5B + โมเดล Stage 5A",
};

const LEVEL_LABEL: Record<AnalysisResult["level"], string> = {
  quick: "เร็ว",
  normal: "ปกติ",
  deep: "ลึก",
  max: "สูงสุด (Super)",
  stage5b64: "Stage 5B · 64 ตา",
};

/**
 * Where these numbers came from, in one line.
 *
 * Worth saying because the same level can now run in two places under two
 * different ceilings: on the device it runs its schedule to the end, and on the
 * service a 330-second timeout can stop it partway. The sample count is written
 * as a fraction of the level's full schedule so a truncated run reads as a
 * truncated run rather than as a shorter level.
 */
function provenanceLine(analysis: AnalysisResult): string {
  const { method, level } = analysis;
  if (method.solver === "stage5b") {
    return `คำนวณบนเซิร์ฟเวอร์ · ตรวจเชิงลึกสูงสุด ${method.depth ?? 64} ตา`;
  }
  const samples = `${method.samples}/${ANALYSIS_LEVEL_SAMPLES[level]} รอบ`;
  if (analysis.localEngine) {
    return `คำนวณบนเครื่องนี้ · ${samples}`;
  }
  return method.complete
    ? `คำนวณบนเซิร์ฟเวอร์ · ${samples}`
    : `คำนวณบนเซิร์ฟเวอร์ · ${samples} · ครบเวลาที่กำหนด`;
}

/** Board coordinate as A-Math notation: column A–O, row 1–15 (center = H8). */
function coordLabel(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

function moveLabel(candidate: AnalysisCandidate): string {
  if (candidate.kind === "pass") return "ผ่าน (Pass)";
  if (candidate.kind === "exchange") {
    return `เปลี่ยนไทล์ ${candidate.exchange.length} ตัว: ${candidate.exchange.join(" ") || "—"}`;
  }
  const cells = [...candidate.placements].sort((a, b) => a.r - b.r || a.c - b.c);
  const tokens = cells.map((cell) => cell.token).join(" ");
  const from = cells[0];
  const to = cells[cells.length - 1];
  if (!from || !to) return "วาง —";
  const where =
    cells.length > 1
      ? `${coordLabel(from.r, from.c)}–${coordLabel(to.r, to.c)}`
      : coordLabel(from.r, from.c);
  return `วาง ${tokens} ที่ ${where}`;
}

function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

function signed(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function TurnAnalysisPanel({
  analysis,
  playerName,
  onClose,
}: {
  analysis: AnalysisResult;
  playerName: string;
  onClose: () => void;
}) {
  const { recommendation, alternatives, method } = analysis;
  const isEndgame = method.solver === "endgame";
  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLDivElement>({ onClose });

  return (
    <div className="bot-reason-overlay" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="bot-reason-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="bot-reason-head">
          <div>
            <div className="bot-reason-title" id={titleId}>
              🔎 วิเคราะห์ตาของ {playerName}
            </div>
            <div className="bot-reason-sub">
              ตาที่ {analysis.turnNumber} · ระดับ {LEVEL_LABEL[analysis.level]} ·{" "}
              {SOLVER_LABEL[method.solver]}
            </div>
          </div>
          <button className="bot-reason-close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>

        {/* A proven endgame result is a different kind of claim from an
            estimate, and is labelled as one. */}
        {isEndgame && method.proven && (
          <div
            className={`bot-reason-banner ${
              (recommendation.provenMargin ?? 0) > 0
                ? "win"
                : (recommendation.provenMargin ?? 0) < 0
                  ? "lose"
                  : "draw"
            }`}
          >
            {(recommendation.provenMargin ?? 0) > 0 ? (
              <>
                🏆 พิสูจน์แล้ว: ทางนี้ <b>ชนะแน่นอน</b> ด้วยผลต่าง{" "}
                <b>+{recommendation.provenMargin}</b> แต้ม ไม่ว่าคู่ต่อสู้จะเล่นแบบไหน
              </>
            ) : (recommendation.provenMargin ?? 0) < 0 ? (
              <>
                พิสูจน์แล้วว่าตกเป็นรอง (ผลต่างสุดท้าย {recommendation.provenMargin}) —
                ทางนี้เสียน้อยที่สุด
              </>
            ) : (
              <>
                พิสูจน์แล้วว่าผลลัพธ์ดีที่สุดคือ <b>เสมอ</b> (0)
              </>
            )}
          </div>
        )}

        {!method.complete && (
          <div className="bot-reason-banner draw">
            ⏱ การค้นหาหมดเวลาก่อนจะจำลองครบทุกกรณี — อันดับด้านล่างเป็นผลเบื้องต้น ไม่ใช่ข้อสรุป
          </div>
        )}

        {/* The recommendation, given its own block so it is never mistaken for
            one row among equals. */}
        <div className="analysis-pick">
          <div className="analysis-pick-tag">แนะนำ</div>
          <div className="analysis-pick-move">{moveLabel(recommendation)}</div>
          <div className="analysis-pick-score">
            {recommendation.kind === "place" ? `${recommendation.immediateScore} แต้ม` : "0 แต้ม"}
          </div>
        </div>

        <p className="bot-reason-verdict">{analysis.summary}</p>

        <details className="analysis-technical">
          <summary>ดูรายละเอียดการคำนวณ</summary>
          <div className="bot-reason-sub analysis-provenance">{provenanceLine(analysis)}</div>
          <div className="bot-reason-stats">
            <Stat label="แต้มตานี้" value={String(recommendation.immediateScore)} />
            <Stat
              label={isEndgame ? "ผลต่างสุดท้าย" : method.solver === "stage5b" ? "ค่าประเมิน" : "แต้มคาดการณ์"}
              value={
                isEndgame ? fmt(recommendation.evaluation, 0) : fmt(recommendation.evaluation, 2)
              }
            />
            <Stat label="ทางเลือกที่ถูกกฎทั้งหมด" value={`${method.legalMoves} ทาง`} />
            {method.solver === "sim" && <Stat label="รอบจำลอง" value={`${method.samples} ครั้ง`} />}
            <Stat label="จุดที่คำนวณ" value={method.nodes.toLocaleString()} />
            <Stat label="เวลาคิด" value={`${(method.elapsedMs / 1000).toFixed(1)}s`} />
          </div>
        </details>

        <div className="analysis-factors">
          <div className="analysis-factors-title">ทำไมถึงแนะนำทางนี้</div>
          <ul>
            {recommendation.factors.map((factor) => (
              <li key={factor.key}>
                <span className="analysis-factor-label">{factor.label}</span>
                <span className="analysis-factor-value">{fmt(factor.value, 2)}</span>
              </li>
            ))}
          </ul>
        </div>

        {alternatives.length > 0 && (
          <>
            <div className="analysis-alt-title">ทางเลือกอื่นที่พิจารณา</div>
            <p className="bot-reason-scroll-hint">เลื่อนตารางเพื่อดูข้อมูลอีก →</p>
            <div className="bot-reason-tablewrap">
              <table className="bot-reason-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="al">ทางเลือก</th>
                    <th>แต้ม</th>
                    <th>{isEndgame ? "ผลต่างสุดท้าย" : "ค่าประเมิน"}</th>
                    <th>ห่างจากที่แนะนำ</th>
                    <th className="al">เหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="chosen">
                    <td>1</td>
                    <td className="al">
                      <span className="bot-reason-pick">แนะนำ</span>
                      {moveLabel(recommendation)}
                    </td>
                    <td>{recommendation.immediateScore}</td>
                    <td className="strong">
                      {isEndgame
                        ? fmt(recommendation.evaluation, 0)
                        : fmt(recommendation.evaluation, 2)}
                    </td>
                    <td>—</td>
                    <td className="al">{recommendation.note}</td>
                  </tr>
                  {alternatives.map((candidate) => (
                    <tr key={candidate.rank}>
                      <td>{candidate.rank}</td>
                      <td className="al">{moveLabel(candidate)}</td>
                      <td>{candidate.immediateScore}</td>
                      <td className="strong">
                        {isEndgame ? fmt(candidate.evaluation, 0) : fmt(candidate.evaluation, 2)}
                      </td>
                      <td className="neg">{signed(-candidate.evaluationGap, isEndgame ? 0 : 2)}</td>
                      <td className="al">{candidate.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <details className="bot-reason-technical">
          <summary>วิธีอ่านตัวเลข</summary>
          <div className="bot-reason-legend">
            {isEndgame ? (
              <>
                <b>ผลต่างสุดท้าย</b> คือแต้มของเราลบแต้มคู่ต่อสู้เมื่อจบเกม
                ตัวเลขนี้คำนวณจากการเดินที่ดีที่สุดของทั้งสองฝ่าย
              </>
            ) : (
              <>
                <b>ค่าประเมิน</b> ใช้เรียงทางเลือก โดยดูแต้มที่ได้ทันที ไทล์ที่เหลือ โอกาสในตาถัดไป
                และทางสวนของคู่ต่อสู้ ตัวเลขบวกมากกว่าหมายถึงทางเลือกที่น่าเล่นกว่า
              </>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bot-reason-stat">
      <div className="bot-reason-stat-val">{value}</div>
      <div className="bot-reason-stat-lbl">{label}</div>
    </div>
  );
}
