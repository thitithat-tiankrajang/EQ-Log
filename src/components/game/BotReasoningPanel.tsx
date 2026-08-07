import { useMemo } from "react";
import type { BotCandidate, BotResponse } from "../../bot/types";

// A full, deliberately un-simplified look inside the engine's decision: the
// move it played, every alternative it weighed, and the exact value terms that
// separated them. Adapts to which solver produced the move (sim / greedy /
// endgame) so the numbers are always labelled truthfully.

const SOLVER_LABEL: Record<BotResponse["solver"], string> = {
  sim: "จำลองตาต่อไป (Monte-Carlo 2 ply)",
  endgame: "แก้ท้ายเกมแบบ exact (พิสูจน์ทุกเส้นทาง)",
  greedy: "ประเมินแบบ static (greedy)",
};

/** Board coordinate as A-Math notation: column A–O, row 1–15 (center = H8). */
function coordLabel(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

/** A short human-readable label for one candidate move. */
function moveLabel(cand: BotCandidate): string {
  if (cand.type === "pass") return "ผ่าน (Pass)";
  if (cand.type === "exchange") {
    return `เปลี่ยนไทล์ ${cand.exchange.length} ตัว: ${cand.exchange.join(" ") || "—"}`;
  }
  const cells = [...cand.placements].sort((a, b) => a.r - b.r || a.c - b.c);
  const tokens = cells.map((p) => p.token).join(" ");
  const from = cells[0];
  const to = cells[cells.length - 1];
  const where =
    cells.length > 1 ? `${coordLabel(from.r, from.c)}–${coordLabel(to.r, to.c)}` : coordLabel(from.r, from.c);
  return `วาง ${tokens}  @ ${where}`;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** Name the single value term that most separates the chosen move from the runner-up. */
function dominantReason(chosen: BotCandidate, runner: BotCandidate): string {
  const contributions: Array<[number, string]> = [
    [chosen.scoreComp - runner.scoreComp, "ทำแต้มทันทีได้มากกว่า"],
    [chosen.leave - runner.leave, "ไทล์ที่เหลือในมือ (leave) ดีกว่า"],
    [chosen.potential - runner.potential, "เปิดโอกาสทำแต้มตาถัดไปได้มากกว่า"],
    [runner.oppReply - chosen.oppReply, "เปิดช่องให้คู่ต่อสู้สวนกลับน้อยกว่า"],
    [runner.stddev - chosen.stddev, "ความเสี่ยง (ความผันผวน) ต่ำกว่า"],
  ];
  contributions.sort((a, b) => b[0] - a[0]);
  return contributions[0][1];
}

export function BotReasoningPanel({
  playerName,
  turnNumber,
  response,
  onClose,
}: {
  playerName: string;
  turnNumber: number;
  response: BotResponse;
  onClose: () => void;
}) {
  const candidates = response.candidates ?? [];
  const isEndgame = response.solver === "endgame";
  const isGreedy = response.solver === "greedy";
  const chosen = useMemo(
    () => candidates.find((c) => c.chosen) ?? candidates[0],
    [candidates],
  );
  const runnerUp = useMemo(
    () => candidates.find((c) => c !== chosen),
    [candidates, chosen],
  );

  return (
    <div className="bot-reason-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="bot-reason-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bot-reason-head">
          <div>
            <div className="bot-reason-title">🧠 ทำไม {playerName} เลือกตานี้</div>
            <div className="bot-reason-sub">
              ตาที่ {turnNumber} · {SOLVER_LABEL[response.solver]}
            </div>
          </div>
          <button className="bot-reason-close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>

        {/* Endgame verdict banner: a proven, tile-independent outcome. */}
        {isEndgame && (
          <div
            className={`bot-reason-banner ${
              (response.expectedFinalDiff ?? 0) > 0
                ? "win"
                : (response.expectedFinalDiff ?? 0) < 0
                  ? "lose"
                  : "draw"
            }`}
          >
            {response.endgameSolved ? (
              (response.expectedFinalDiff ?? 0) > 0 ? (
                <>🏆 พิสูจน์แล้วว่า <b>ชนะแน่นอน 100%</b> — ผลต่างสุดท้าย <b>+{response.expectedFinalDiff}</b> แต้ม ไม่ว่าคู่ต่อสู้จะเล่นแบบไหน</>
              ) : (response.expectedFinalDiff ?? 0) < 0 ? (
                <>พิสูจน์แล้วว่าตกเป็นรอง (ผลต่างสุดท้าย {response.expectedFinalDiff}) — เลือกทางที่เสียน้อยที่สุด</>
              ) : (
                <>พิสูจน์แล้วว่าผลลัพธ์ดีสุดคือ <b>เสมอ</b> (0)</>
              )
            ) : (
              <>คำนวณท้ายเกมแบบประมาณ (beam) — ตัวเลขผลต่างเป็นค่าที่ค้นได้ในงบเวลา ไม่ใช่การพิสูจน์ครบทุกทาง</>
            )}
          </div>
        )}

        {/* Headline numbers about the decision itself. */}
        <div className="bot-reason-stats">
          <Stat label="แต้มตานี้" value={String(response.score)} />
          <Stat
            label={isEndgame ? "ผลต่างสุดท้าย" : "Value (คุ้มค่า)"}
            value={isEndgame ? fmt(response.equity, 0) : fmt(response.equity, 2)}
          />
          <Stat label="พิจารณาทั้งหมด" value={`${response.stats.candidates || response.stats.moves} ทาง`} />
          {!isEndgame && !isGreedy && (
            <Stat label="สุ่มคู่ต่อสู้" value={`${response.stats.samples} ครั้ง`} />
          )}
          <Stat label="Node ที่ค้น" value={response.stats.nodes.toLocaleString()} />
          <Stat label="เวลาคิด" value={`${(response.stats.elapsedMs / 1000).toFixed(1)}s`} />
        </div>

        {/* Plain-language summary of the head-to-head. */}
        {isGreedy ? (
          <p className="bot-reason-verdict">
            โหมด <b>greedy</b>: ตอนนี้คู่ต่อสู้ไม่มีเบี้ยให้จำลองตาต่อไป เอนจินจึงจัดอันดับด้วยค่า{" "}
            <b>static equity</b> = แต้มที่ได้ + คุณค่าไทล์ที่เหลือ (leave) − การเปิดช่องให้ฝ่ายตรงข้าม
            {chosen && (
              <>
                {" "}— เลือก <b>{moveLabel(chosen)}</b> เพราะได้ค่าสูงสุด <b>{fmt(chosen.value, 2)}</b>.
              </>
            )}
          </p>
        ) : isEndgame ? (
          <p className="bot-reason-verdict">
            ทุกช่องด้านล่างคือ <b>ผลต่างแต้มสุดท้ายที่พิสูจน์ได้</b> (แต้มรวมเรา − แต้มรวมคู่ต่อสู้ จนจบเกม)
            {chosen && runnerUp && (
              <>
                {" "}— เลือก <b>{moveLabel(chosen)}</b> (จบที่ {fmt(chosen.value, 0)}) ดีกว่าทางรอง{" "}
                {moveLabel(runnerUp)} ({fmt(runnerUp.value, 0)}) อยู่ {fmt(chosen.value - runnerUp.value, 0)} แต้ม.
              </>
            )}
          </p>
        ) : chosen && runnerUp ? (
          <p className="bot-reason-verdict">
            เลือก <b>{moveLabel(chosen)}</b> เพราะได้ค่า value{" "}
            <b>{fmt(chosen.value, 2)}</b> สูงกว่าอันดับ 2 ({moveLabel(runnerUp)} ={" "}
            {fmt(runnerUp.value, 2)}) อยู่ <b>{fmt(chosen.value - runnerUp.value, 2)}</b> — จุดที่เหนือกว่าหลักๆ คือ{" "}
            <b>{dominantReason(chosen, runnerUp)}</b>.
          </p>
        ) : chosen ? (
          <p className="bot-reason-verdict">
            เลือก <b>{moveLabel(chosen)}</b> — เป็นทางเดียวที่ประเมินไว้.
          </p>
        ) : (
          <p className="bot-reason-verdict">
            เส้นทางนี้ไม่ได้ไล่เทียบทางเลือกทีละทาง — ค่าที่ใช้ตัดสินคือ {fmt(response.equity, 2)} ข้างบน.
          </p>
        )}

        {candidates.length > 0 && (
          <div className="bot-reason-tablewrap">
            <table className="bot-reason-table">
              <thead>
                {isEndgame ? (
                  <tr>
                    <th>#</th>
                    <th className="al">ทางเลือก</th>
                    <th>แต้มตานี้</th>
                    <th>ผลต่างสุดท้าย</th>
                    <th>Δ</th>
                    <th>ผล</th>
                  </tr>
                ) : (
                  <tr>
                    <th>#</th>
                    <th className="al">ทางเลือก</th>
                    <th>Value</th>
                    <th>Δ</th>
                    <th>แต้ม</th>
                    <th>Leave</th>
                    {!isGreedy && <th>Potential</th>}
                    <th>{isGreedy ? "เปิดช่อง" : "−คู่สวน"}</th>
                    {!isGreedy && <th>Mean</th>}
                    {!isGreedy && <th>±Risk</th>}
                  </tr>
                )}
              </thead>
              <tbody>
                {candidates.map((c, i) =>
                  isEndgame ? (
                    <tr key={i} className={c.chosen ? "chosen" : undefined}>
                      <td>{i + 1}</td>
                      <td className="al">
                        {c.chosen && <span className="bot-reason-pick">เลือก</span>}
                        {moveLabel(c)}
                      </td>
                      <td>{fmt(c.scoreComp, 0)}</td>
                      <td className="strong">{fmt(c.value, 0)}</td>
                      <td className={c.chosen ? "" : "neg"}>
                        {chosen ? (c === chosen ? "—" : fmt(c.value - chosen.value, 0)) : ""}
                      </td>
                      <td>{c.value > 0 ? "ชนะ" : c.value < 0 ? "แพ้" : "เสมอ"}</td>
                    </tr>
                  ) : (
                    <tr key={i} className={c.chosen ? "chosen" : undefined}>
                      <td>{i + 1}</td>
                      <td className="al">
                        {c.chosen && <span className="bot-reason-pick">เลือก</span>}
                        {moveLabel(c)}
                      </td>
                      <td className="strong">{fmt(c.value, 2)}</td>
                      <td className={c.chosen ? "" : "neg"}>
                        {chosen ? (c === chosen ? "—" : fmt(c.value - chosen.value, 2)) : ""}
                      </td>
                      <td>{fmt(c.scoreComp, 0)}</td>
                      <td>{fmt(c.leave)}</td>
                      {!isGreedy && <td>{fmt(c.potential)}</td>}
                      <td>{fmt(c.oppReply)}</td>
                      {!isGreedy && <td>{fmt(c.mean)}</td>}
                      {!isGreedy && <td className="dim">±{fmt(c.stddev)}</td>}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="bot-reason-legend">
          {isEndgame ? (
            <>
              <b>ผลต่างสุดท้าย</b> = แต้มรวมของเราลบแต้มรวมคู่ต่อสู้เมื่อเล่นจนจบเกมแบบดีที่สุดทั้งสองฝ่าย (บวก = เราชนะ).
              ตัวเลขของทางที่เลือกเป็นค่าที่ <b>พิสูจน์ครบทุกเส้นทาง</b>; ทางอื่นเป็นขอบเขตล่างจากการตัด alpha-beta.
            </>
          ) : isGreedy ? (
            <>
              <b>Value</b> = static equity ที่ใช้จัดอันดับ. <b>แต้ม</b> = แต้มที่ได้ทันที. <b>Leave</b> = คุณค่าไทล์ที่เหลือในมือ.{" "}
              <b>เปิดช่อง</b> = โทษจากการเปิดช่องดีให้ฝ่ายตรงข้าม (ยิ่งน้อยยิ่งดี). โหมดนี้ไม่ได้จำลองตาต่อไปเพราะคู่ต่อสู้ยังไม่มีเบี้ย.
            </>
          ) : (
            <>
              <b>ความหมายของค่า</b> — <b>Value</b> = ค่าที่ใช้จัดอันดับจริง (mean − λ·risk, λ โตขึ้นเมื่อนำอยู่).{" "}
              <b>แต้ม</b> = แต้มที่ได้ทันทีจากการวาง. <b>Leave</b> = คุณค่าของไทล์ที่เหลือในมือหลังเดิน.{" "}
              <b>Potential</b> = แต้มที่ไทล์ในมือคาดว่าจะทำได้ในตาถัดไป (ถ่วงน้ำหนักแล้ว).{" "}
              <b>−คู่สวน</b> = ค่าตาที่ดีที่สุดของคู่ต่อสู้ที่ถูกหักออก (ยิ่งน้อยยิ่งดี).{" "}
              <b>Mean</b> = ค่าสุทธิเฉลี่ยจากการสุ่มมือคู่ต่อสู้. <b>±Risk</b> = ส่วนเบี่ยงเบน (ความผันผวน).
            </>
          )}
        </div>
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
