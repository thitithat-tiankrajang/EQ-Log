// The engine's ranked opinion about a study position.
//
// Deliberately the same read-out as the in-game analysis panel: it is the same
// search, and giving a study result different chrome would suggest it came from
// a different engine. What is different is that this list is what was WRITTEN
// DOWN — ten rows, permanently — so it renders identically whether it has just
// arrived over the wire or been read back from the archive months later.

import type { AnalysisCandidate } from "../../../bot/engineApi";
import type { StudyMethod } from "../../../features/study/repository";

const SOLVER_LABEL: Record<StudyMethod["solver"], string> = {
  sim: "จำลองตาต่อไป (Monte-Carlo 2 ply)",
  endgame: "แก้ท้ายเกมแบบ exact (พิสูจน์ทุกเส้นทาง)",
  greedy: "ประเมินแบบ static (greedy)",
};

/** Board coordinate as A-Math notation: column A–O, row 1–15 (center = H8). */
function coordLabel(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

export function moveLabel(candidate: AnalysisCandidate): string {
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
  return `วาง ${tokens}  @ ${where}`;
}

export function StudyRanking({
  candidates,
  method,
  summary,
}: {
  candidates: AnalysisCandidate[];
  method: StudyMethod | null;
  summary: string;
}) {
  if (candidates.length === 0) {
    return <p className="info-banner">ไม่มีตาที่วิเคราะห์ได้ในโจทย์นี้</p>;
  }

  return (
    <div className="study-ranking">
      {summary && <p className="study-summary">{summary}</p>}

      {method && (
        <dl className="study-method">
          <Stat label="วิธีคิด" value={SOLVER_LABEL[method.solver]} />
          <Stat label="ตาที่หาได้" value={method.legalMoves.toLocaleString()} />
          <Stat label="ตาที่ชั่งน้ำหนัก" value={method.candidatesEvaluated.toLocaleString()} />
          <Stat label="สุ่มมือคู่แข่ง" value={`${method.samples} รอบ`} />
          <Stat label="เวลาที่ใช้" value={`${(method.elapsedMs / 1000).toFixed(1)} วิ`} />
          <Stat
            label="สถานะ"
            value={
              method.proven
                ? "พิสูจน์แล้ว (exact)"
                : method.complete
                  ? "คิดครบตามแผน"
                  : "หยุดกลางทาง"
            }
          />
        </dl>
      )}

      <ol className="study-candidates">
        {candidates.map((candidate) => (
          <li
            key={`${candidate.rank}:${moveLabel(candidate)}`}
            className={candidate.recommended ? "is-best" : ""}
          >
            <header>
              <span className="study-rank">#{candidate.rank}</span>
              <strong>{moveLabel(candidate)}</strong>
              {candidate.recommended && <span className="study-badge">บอทเลือกตานี้</span>}
            </header>
            <div className="study-numbers">
              <span>ได้ {candidate.immediateScore} แต้ม</span>
              <span>ค่าประเมิน {candidate.evaluation.toFixed(2)}</span>
              {candidate.evaluationGap > 0 && (
                <span className="study-gap">
                  ห่างอันดับ 1 −{candidate.evaluationGap.toFixed(2)}
                </span>
              )}
              {candidate.provenMargin !== null && (
                <span className="study-proven">พิสูจน์ผลต่าง {candidate.provenMargin}</span>
              )}
            </div>
            {candidate.note && <p className="study-note">{candidate.note}</p>}
            {candidate.factors.length > 0 && (
              <ul className="study-factors">
                {candidate.factors.map((factor) => (
                  <li key={factor.key}>
                    <span>{factor.label}</span>
                    <b>{factor.value.toFixed(1)}</b>
                    {factor.delta !== undefined && factor.delta !== 0 && (
                      <em>
                        {factor.delta > 0 ? "+" : ""}
                        {factor.delta.toFixed(1)}
                      </em>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
