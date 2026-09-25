import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { BotResponse } from "../../bot/types";
import {
  EngineApiError,
  fetchBotReasoning,
  pageOfBotReasoning,
  type BotReasoningCandidate,
  type BotReasoningPage,
} from "../../bot/engineApi";
import { useDialogBehavior } from "../ui/useDialogBehavior";

// A full, deliberately un-simplified look inside the engine's decision: the
// move it played, every alternative it weighed, and the exact value terms that
// separated them. Adapts to which solver produced the move (sim / greedy /
// endgame) so the numbers are always labelled truthfully.
//
// ── where the numbers come from ──────────────────────────────────────────────
//
// Not from the move. The bot-move response carries the move ALONE, so this
// panel used to render an empty shell: a value of 0.00 nobody computed, "0
// alternatives considered" about a search that had weighed dozens, and no
// table at all. The ranking is held with the completed search and read here on
// demand, ONE PAGE AT A TIME — the report is dozens of rows with a full value
// decomposition each, and paging is what keeps opening this panel a small
// request instead of a large one.
//
// Pages already fetched are kept for the life of the panel, so stepping back
// through the ranking costs nothing and re-reads nothing.
//
// ── two sources, one shape ───────────────────────────────────────────────────
//
// A Super move is searched on the player's own device, so the server never ran
// that search and answers `reasoning_unavailable` for every one of them. That
// was this panel's most visible failure in production: never a table, always the
// retention sentence, for a report the device was holding the whole time.
//
// So the ranking comes from whichever side computed the move — `localReasoning`
// on the response when it was this device, the reasoning endpoint when it was
// the backend. `pageOfBotReasoning` serves the local one with the server's own
// clamping, so everything below this line renders one shape and cannot tell the
// two apart.

const PAGE_SIZE = 6;

const SOLVER_LABEL: Record<BotResponse["solver"], string> = {
  sim: "ลองเดินเกมหลายแบบ",
  endgame: "คำนวณจนจบเกม",
  greedy: "เทียบทางเลือกที่เห็น",
  strong: "ประเมินหลายชั้น",
};

/** Board coordinate as A-Math notation: column A–O, row 1–15 (center = H8). */
function coordLabel(r: number, c: number): string {
  return `${String.fromCharCode(65 + c)}${r + 1}`;
}

/** A short human-readable label for one candidate move. */
function moveLabel(cand: BotReasoningCandidate): string {
  if (cand.type === "pass") return "ผ่าน (Pass)";
  if (cand.type === "exchange") {
    return `เปลี่ยนไทล์ ${cand.exchange.length} ตัว: ${cand.exchange.join(" ") || "—"}`;
  }
  const cells = [...cand.placements].sort((a, b) => a.r - b.r || a.c - b.c);
  const tokens = cells.map((p) => p.token).join(" ");
  const from = cells[0];
  const to = cells[cells.length - 1];
  const where =
    cells.length > 1
      ? `${coordLabel(from.r, from.c)}–${coordLabel(to.r, to.c)}`
      : coordLabel(from.r, from.c);
  return `วาง ${tokens} ที่ ${where}`;
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits);
}

/** Name the single value term that most separates the chosen move from the runner-up. */
function dominantReason(chosen: BotReasoningCandidate, runner: BotReasoningCandidate): string {
  const contributions: Array<[number, string]> = [
    [chosen.scoreComp - runner.scoreComp, "ทำแต้มทันทีได้มากกว่า"],
    [chosen.leave - runner.leave, "ไทล์ที่เหลือในมือดีกว่า"],
    [chosen.potential - runner.potential, "เปิดโอกาสทำแต้มตาถัดไปได้มากกว่า"],
    [runner.oppReply - chosen.oppReply, "เปิดช่องให้คู่ต่อสู้สวนกลับน้อยกว่า"],
    [runner.stddev - chosen.stddev, "ความเสี่ยง (ความผันผวน) ต่ำกว่า"],
  ];
  contributions.sort((a, b) => b[0] - a[0]);
  return contributions[0][1];
}

/** Why the ranking is not on screen, in the player's terms. Every branch is a
 *  real server answer; none of them is "something went wrong". */
function explainFailure(error: unknown): string {
  if (error instanceof EngineApiError) {
    switch (error.code) {
      case "reasoning_unavailable":
        return "เซิร์ฟเวอร์ไม่ได้เก็บรายละเอียดการคิดของตานี้ไว้แล้ว (เก็บไว้ราว 30 นาทีต่อหนึ่งตา หรือเซิร์ฟเวอร์เพิ่งรีสตาร์ท)";
      case "stale_revision":
        return "ตานี้ผ่านไปหลายตาแล้ว — ดูรายละเอียดได้เฉพาะตาล่าสุดของบอท";
      case "forbidden":
      case "not_found":
        return "บัญชีนี้ไม่มีสิทธิ์ดูรายละเอียดการคิดของห้องนี้";
      case "turn_rule":
        return "ห้องนี้ไม่มีผู้เล่นที่เป็นเอนจิน";
      case "unauthenticated":
        return "เซสชันหมดอายุ — เข้าสู่ระบบใหม่แล้วลองอีกครั้ง";
      case "unconfigured":
        return "ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์เอนจินสำหรับเครื่องนี้";
      case "offline":
        return "ต่อกับเซิร์ฟเวอร์เอนจินไม่ได้";
      default:
        return error.message;
    }
  }
  return "อ่านรายละเอียดการคิดไม่สำเร็จ";
}

export function BotReasoningPanel({
  gameId,
  playerName,
  turnNumber,
  response,
  onClose,
}: {
  /** The LIVE ROOM's id — the value the engine API calls `gameId`. */
  gameId: string;
  playerName: string;
  turnNumber: number;
  /** The move as applied. Supplies what the move response really does carry
   *  (score, solver, nodes, time) so the header is filled on the first frame,
   *  before the first page lands. */
  response: BotResponse;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<BotReasoningPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  /** Attempt counter: bumping it re-runs the fetch for the current offset,
   *  which is what "ลองใหม่" means. */
  const [attempt, setAttempt] = useState(0);
  // Pages already read, keyed by offset. Paging backwards must not re-ask the
  // server for something this panel is already holding.
  const cache = useRef(new Map<number, BotReasoningPage>());
  const revision = response.revision;
  // Held by the device that searched. Its presence is what decides the source.
  const localReport = response.localReasoning;

  useEffect(() => {
    const cached = cache.current.get(offset);
    if (cached) {
      setPage(cached);
      setLoading(false);
      setFailure(null);
      return;
    }
    if (localReport) {
      // No request, no failure branch, no retention window: this report cannot
      // have expired, because nothing but this tab was ever holding it.
      const served = pageOfBotReasoning(localReport, { offset, limit: PAGE_SIZE });
      cache.current.set(served.page.offset, served);
      setPage(served);
      setLoading(false);
      setFailure(null);
      if (served.page.offset !== offset) setOffset(served.page.offset);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailure(null);
    fetchBotReasoning({ gameId, revision, offset, limit: PAGE_SIZE, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        // Keyed by what the server actually served, not by what was asked for:
        // it clamps, and the clamped window is the one that is cached.
        cache.current.set(result.page.offset, result);
        setPage(result);
        setLoading(false);
        // Adopt the served window so the pager's arithmetic is about the page
        // on screen rather than the one that was asked for.
        if (result.page.offset !== offset) setOffset(result.page.offset);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure(explainFailure(error));
        setLoading(false);
      });
    return () => controller.abort();
  }, [gameId, revision, offset, attempt, localReport]);

  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLDivElement>({ onClose });
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Every summary number prefers the report, because the report is the search's
  // own account of itself. The move response fills in only what it genuinely
  // carries; anything neither of them has is shown as "—" rather than as 0.
  const solver = page?.solver ?? response.solver;
  const endgameSolved = page?.endgameSolved ?? response.endgameSolved;
  const isStrong = solver === "strong";
  const isEndgame = solver === "endgame" || (isStrong && endgameSolved);
  const isGreedy = solver === "greedy";
  const expectedFinalDiff = page?.expectedFinalDiff ?? response.expectedFinalDiff;
  const chosen = page?.chosen;
  const runnerUp = page?.runnerUp;
  const total = page?.page.total ?? 0;
  const shownFrom = page && page.candidates.length > 0 ? page.page.offset + 1 : 0;
  const shownTo = page ? page.page.offset + page.candidates.length : 0;
  const hasPrev = offset > 0;
  const hasNext = page ? shownTo < total : false;

  return (
    <div className="bot-reason-overlay" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        className="bot-reason-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bot-reason-head">
          <div>
            <div className="bot-reason-title" id={titleId}>
              🧠 ทำไม {playerName} เลือกตานี้
            </div>
            <div className="bot-reason-sub">
              ตาที่ {turnNumber} · {SOLVER_LABEL[solver]}
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
              (expectedFinalDiff ?? 0) > 0 ? "win" : (expectedFinalDiff ?? 0) < 0 ? "lose" : "draw"
            }`}
          >
            {endgameSolved ? (
              (expectedFinalDiff ?? 0) > 0 ? (
                <>
                  🏆 พิสูจน์แล้วว่า <b>ชนะแน่นอน 100%</b> — ผลต่างสุดท้าย{" "}
                  <b>+{expectedFinalDiff}</b> แต้ม ไม่ว่าคู่ต่อสู้จะเล่นแบบไหน
                </>
              ) : (expectedFinalDiff ?? 0) < 0 ? (
                <>
                  พิสูจน์แล้วว่าตกเป็นรอง (ผลต่างสุดท้าย {expectedFinalDiff}) —
                  เลือกทางที่เสียน้อยที่สุด
                </>
              ) : (
                <>
                  พิสูจน์แล้วว่าผลลัพธ์ดีสุดคือ <b>เสมอ</b> (0)
                </>
              )
            ) : (
              <>คำนวณท้ายเกมได้เพียงบางทาง — ตัวเลขผลต่างเป็นค่าประมาณ</>
            )}
          </div>
        )}

        {/* Headline numbers about the decision itself. */}
        <div className="bot-reason-stats">
          <Stat label="แต้มตานี้" value={String(page?.score ?? response.score)} />
          <Stat
            label={isEndgame ? "ผลต่างสุดท้าย" : "ความคุ้มค่า"}
            value={page ? fmt(page.equity, isEndgame ? 0 : 2) : "—"}
          />
          <Stat
            label="พิจารณาทั้งหมด"
            value={page ? `${page.stats.candidates || page.stats.moves} ทาง` : "—"}
          />
          {!isEndgame && !isGreedy && (
            <Stat
              label={isStrong ? "ครั้งที่ประเมิน" : "สุ่มคู่ต่อสู้"}
              value={`${page?.stats.samples ?? response.stats.samples} ครั้ง`}
            />
          )}
          <Stat
            label="จุดที่คำนวณ"
            value={(page?.stats.nodes ?? response.stats.nodes).toLocaleString()}
          />
          <Stat
            label="เวลาคิด"
            value={`${((page?.stats.elapsedMs ?? response.stats.elapsedMs) / 1000).toFixed(1)}s`}
          />
        </div>

        {/* Plain-language summary of the head-to-head. */}
        {failure ? (
          <p className="bot-reason-verdict is-unavailable" role="status">
            {failure}
          </p>
        ) : !page ? (
          <p className="bot-reason-verdict is-loading" role="status">
            กำลังอ่านเหตุผลของบอท…
          </p>
        ) : isGreedy ? (
          <p className="bot-reason-verdict">
            ตอนนี้คู่ต่อสู้ไม่มีเบี้ยให้จำลองตาต่อไป บอทจึงดูแต้มที่ได้ ไทล์ที่เหลือ
            และช่องที่เปิดให้ฝ่ายตรงข้าม
            {chosen && (
              <>
                {" "}
                — เลือก <b>{moveLabel(chosen)}</b> เพราะได้ค่าสูงสุด <b>{fmt(chosen.value, 2)}</b>.
              </>
            )}
          </p>
        ) : isEndgame ? (
          <p className="bot-reason-verdict">
            ทุกช่องด้านล่างคือ <b>ผลต่างแต้มสุดท้ายที่พิสูจน์ได้</b> (แต้มรวมเรา − แต้มรวมคู่ต่อสู้
            จนจบเกม)
            {chosen && runnerUp && (
              <>
                {" "}
                — เลือก <b>{moveLabel(chosen)}</b> (จบที่ {fmt(chosen.value, 0)}) ดีกว่าทางรอง{" "}
                {moveLabel(runnerUp)} ({fmt(runnerUp.value, 0)}) อยู่{" "}
                {fmt(chosen.value - runnerUp.value, 0)} แต้ม.
              </>
            )}
          </p>
        ) : isStrong && chosen && runnerUp ? (
          <p className="bot-reason-verdict">
            Authur เลือก <b>{moveLabel(chosen)}</b> ด้วยค่า <b>{fmt(chosen.value, 2)}</b> —
            เปรียบเทียบแต้มตานี้ ทางสวนของคู่แข่ง และโอกาสในตาถัดไป.
          </p>
        ) : chosen && runnerUp ? (
          <p className="bot-reason-verdict">
            เลือก <b>{moveLabel(chosen)}</b> เพราะความคุ้มค่า <b>{fmt(chosen.value, 2)}</b>{" "}
            สูงกว่าอันดับ 2 ({moveLabel(runnerUp)} = {fmt(runnerUp.value, 2)}) อยู่{" "}
            <b>{fmt(chosen.value - runnerUp.value, 2)}</b> — จุดที่เหนือกว่าหลักๆ คือ{" "}
            <b>{dominantReason(chosen, runnerUp)}</b>.
          </p>
        ) : chosen ? (
          <p className="bot-reason-verdict">
            เลือก <b>{moveLabel(chosen)}</b> — เป็นทางเดียวที่ประเมินไว้.
          </p>
        ) : (
          <p className="bot-reason-verdict">เอนจินไม่ได้รายงานทางเลือกไว้สำหรับตานี้.</p>
        )}

        {failure && (
          <div className="bot-reason-pager">
            <button type="button" className="bot-reason-pagebtn" onClick={retry}>
              ลองใหม่
            </button>
          </div>
        )}

        {page && page.candidates.length > 0 && (
          <>
            <p className="bot-reason-scroll-hint">เลื่อนตารางเพื่อดูข้อมูลอีก →</p>
            <div className="bot-reason-tablewrap" aria-busy={loading || undefined}>
              <table className="bot-reason-table">
                <thead>
                  {isEndgame ? (
                    <tr>
                      <th>#</th>
                      <th className="al">ทางเลือก</th>
                      <th>แต้มตานี้</th>
                      <th>ผลต่างสุดท้าย</th>
                      <th>ต่างจากที่เลือก</th>
                      <th>ผล</th>
                    </tr>
                  ) : isStrong ? (
                    <tr>
                      <th>#</th>
                      <th className="al">ทางเลือก</th>
                      <th>ความคุ้มค่า</th>
                      <th>ต่างจากที่เลือก</th>
                      <th>แต้ม</th>
                      <th>−คู่สวน</th>
                      <th>ตาถัดไป</th>
                      <th>ระดับ</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>#</th>
                      <th className="al">ทางเลือก</th>
                      <th>ความคุ้มค่า</th>
                      <th>ต่างจากที่เลือก</th>
                      <th>แต้ม</th>
                      <th>ไทล์ที่เหลือ</th>
                      {!isGreedy && <th>โอกาสตาถัดไป</th>}
                      <th>{isGreedy ? "เปิดช่อง" : "−คู่สวน"}</th>
                      {!isGreedy && <th>ค่าเฉลี่ย</th>}
                      {!isGreedy && <th>ความเสี่ยง</th>}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {page.candidates.map((c, i) => {
                    // The rank is the row's place in the WHOLE ranking, not in
                    // this page — otherwise page two would restart at 1.
                    const rank = page.page.offset + i + 1;
                    const gap = chosen ? c.value - chosen.value : 0;
                    return isEndgame ? (
                      <tr key={rank} className={c.chosen ? "chosen" : undefined}>
                        <td>{rank}</td>
                        <td className="al">
                          {c.chosen && <span className="bot-reason-pick">เลือก</span>}
                          {moveLabel(c)}
                        </td>
                        <td>{fmt(c.scoreComp, 0)}</td>
                        <td className="strong">{fmt(c.value, 0)}</td>
                        <td className={c.chosen ? "" : "neg"}>{c.chosen ? "—" : fmt(gap, 0)}</td>
                        <td>{c.value > 0 ? "ชนะ" : c.value < 0 ? "แพ้" : "เสมอ"}</td>
                      </tr>
                    ) : isStrong ? (
                      <tr key={rank} className={c.chosen ? "chosen" : undefined}>
                        <td>{rank}</td>
                        <td className="al">
                          {c.chosen && <span className="bot-reason-pick">เลือก</span>}
                          {moveLabel(c)}
                        </td>
                        <td className="strong">{fmt(c.value, 2)}</td>
                        <td className={c.chosen ? "" : "neg"}>{c.chosen ? "—" : fmt(gap, 2)}</td>
                        <td>{fmt(c.scoreComp, 0)}</td>
                        <td>{fmt(c.oppReply)}</td>
                        <td>{fmt(c.leave)}</td>
                        <td>{c.tier ?? "—"}</td>
                      </tr>
                    ) : (
                      <tr key={rank} className={c.chosen ? "chosen" : undefined}>
                        <td>{rank}</td>
                        <td className="al">
                          {c.chosen && <span className="bot-reason-pick">เลือก</span>}
                          {moveLabel(c)}
                        </td>
                        <td className="strong">{fmt(c.value, 2)}</td>
                        <td className={c.chosen ? "" : "neg"}>{c.chosen ? "—" : fmt(gap, 2)}</td>
                        <td>{fmt(c.scoreComp, 0)}</td>
                        <td>{fmt(c.leave)}</td>
                        {!isGreedy && <td>{fmt(c.potential)}</td>}
                        <td>{fmt(c.oppReply)}</td>
                        {!isGreedy && <td>{fmt(c.mean)}</td>}
                        {!isGreedy && <td className="dim">±{fmt(c.stddev)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* The pager. Present whenever there is a ranking to walk, so the page
            position is readable even when everything fits on one page. */}
        {page && total > 0 && (
          <div className="bot-reason-pager">
            <button
              type="button"
              className="bot-reason-pagebtn"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={!hasPrev || loading}
            >
              ← ก่อนหน้า
            </button>
            <span className="bot-reason-pagepos" role="status" aria-live="polite">
              {loading ? "กำลังโหลด…" : `อันดับ ${shownFrom}–${shownTo} จาก ${total}`}
            </span>
            <button
              type="button"
              className="bot-reason-pagebtn"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={!hasNext || loading}
            >
              ถัดไป →
            </button>
          </div>
        )}

        <details className="bot-reason-technical">
          <summary>วิธีอ่านตัวเลข</summary>
          <div className="bot-reason-legend">
            {isEndgame ? (
              <>
                <b>ผลต่างสุดท้าย</b> =
                แต้มรวมของเราลบแต้มรวมคู่ต่อสู้เมื่อเล่นจนจบเกมแบบดีที่สุดทั้งสองฝ่าย (บวก =
                เราชนะ). ตัวเลขของทางที่เลือกเป็นค่าที่ <b>พิสูจน์ครบทุกเส้นทาง</b>;
                ทางอื่นเป็นค่าขั้นต่ำที่พบ.
              </>
            ) : isStrong ? (
              <>
                <b>ค่าเลือก</b> = ค่าที่ Authur ใช้จัดอันดับจริง; แต้มตานี้ − ทางสวนของคู่แข่ง +
                โอกาสทำแต้มตาถัดไป โดยหลักฐานชั้นสูงกว่าลงรายละเอียดมากกว่า.
                ถ้ายังไม่พิสูจน์ท้ายเกมครบ ตัวเลขนี้ไม่ใช่คำรับประกันว่าชนะ.
              </>
            ) : isGreedy ? (
              <>
                <b>ความคุ้มค่า</b> ใช้จัดอันดับทางเลือก. <b>แต้ม</b> คือแต้มที่ได้ทันที.{" "}
                <b>ไทล์ที่เหลือ</b> คือคุณค่าของไทล์ในมือ. <b>เปิดช่อง</b> =
                โทษจากการเปิดช่องดีให้ฝ่ายตรงข้าม (ยิ่งน้อยยิ่งดี).
                โหมดนี้ไม่ได้จำลองตาต่อไปเพราะคู่ต่อสู้ยังไม่มีเบี้ย.
              </>
            ) : (
              <>
                <b>ความคุ้มค่า</b> ใช้จัดอันดับทางเลือก โดยรวมแต้มตานี้ ไทล์ที่เหลือ โอกาสตาถัดไป
                และทางสวนของคู่แข่ง. <b>ค่าเฉลี่ย</b> มาจากการลองมือคู่แข่งหลายแบบ.
                <b>ความเสี่ยง</b> บอกว่าผลลัพธ์อาจแกว่งมากเพียงใด.
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
