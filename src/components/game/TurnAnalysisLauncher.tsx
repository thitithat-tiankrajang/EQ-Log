import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  ANALYSIS_LEVELS,
  EngineApiError,
  type AnalysisLevel,
  type AnalysisResult,
} from "../../bot/engineApi";
import * as analysisCache from "../../analysisSessionCache";
import * as engineSessions from "../../engineSessions";
import { TurnAnalysisPanel } from "./TurnAnalysisPanel";

// The Analyze control and everything that can go wrong behind it.
//
// The rule this component is built around: an analysis is about a POSITION, not
// about a game. It is computed for one revision, and the moment the game leaves
// that revision the answer stops being an answer. So the revision it was asked
// for is carried all the way through and compared on the way out — a result for
// revision N can never be shown as though it applied to N+1.
//
// The second rule, new since the engine moved to a shared server: **a request
// that has been accepted has not necessarily started**. The server has a finite
// number of CPUs and a queue in front of them, so "asked" and "computing" are
// now different states and the player is told which one they are in.
//
// The third rule, and the one that took the longest to get right: **this
// component does not own the search.** It used to hold the connection, the
// progress and the only pointer to the running job — all in React state, all
// destroyed the moment the player navigated away. Recovering meant remembering
// the level in session storage, and anything that lost that note (a second tab,
// a reload, a mistimed reset) stranded a live search behind a button the player
// had to press and pay for again.
//
// Now `engineSessions` owns the observation and outlives every mount, and the
// SERVER owns discovery: `GET /jobs` answers "what is running for this
// position?" without the browser having to remember. What is left here is
// rendering, and choosing a level.

const LEVEL_LABEL: Record<AnalysisLevel, string> = {
  quick: "เร็ว",
  normal: "ปกติ",
  deep: "ลึก",
  max: "สูงสุด",
};

const LEVEL_HINT: Record<AnalysisLevel, string> = {
  quick: "~5 วินาที",
  normal: "~15 วินาที",
  deep: "~45 วินาที",
  max: "หลายนาที",
};

/** Failures the player can do something about, phrased as what happened rather
 *  than as an error code. Nothing here quotes the server: no status codes, no
 *  queue internals, no infrastructure. */
function messageFor(error: EngineApiError): string {
  switch (error.code) {
    case "stale_revision":
      return "กระดานเปลี่ยนไปแล้วระหว่างวิเคราะห์ — กดวิเคราะห์อีกครั้งเพื่อดูตาปัจจุบัน";
    case "analysis_not_allowed":
      return "วิเคราะห์ได้เฉพาะในตาของผู้เล่นที่เป็นมนุษย์ และต้องเป็นตาของคุณเอง";
    case "turn_rule":
      return "ตอนนี้ยังวิเคราะห์ไม่ได้ — เกมยังไม่ถึงจังหวะที่ต้องตัดสินใจ";
    case "engine_timeout":
      return "การคำนวณใช้เวลานานเกินกำหนดและถูกหยุดไว้ — ลองระดับที่เบากว่านี้";
    case "budget_exhausted": {
      const seconds = Math.ceil((error.detail?.retryAfterMs ?? 0) / 1000);
      return seconds > 0
        ? `ใช้โควตาการวิเคราะห์ครบแล้ว — ลองใหม่ในอีก ${seconds} วินาที`
        : "ใช้โควตาการวิเคราะห์ครบแล้ว — ลองใหม่อีกครั้งภายหลัง";
    }
    case "analysis_in_progress":
      return "มีการวิเคราะห์ที่กำลังทำงานอยู่แล้ว";
    case "queue_full":
      return "ขณะนี้มีการใช้งานบอทจำนวนมาก กรุณาลองใหม่อีกครั้ง";
    case "analysis_unavailable":
      return "ตานี้ไม่มีทางเลือกให้เปรียบเทียบ";
    case "unauthenticated":
      return "เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่";
    case "forbidden":
    case "not_found":
      return "ไม่มีสิทธิ์วิเคราะห์เกมนี้";
    case "unconfigured":
      return "ระบบวิเคราะห์ยังไม่ได้เปิดใช้งานในเซิร์ฟเวอร์นี้";
    case "offline":
      return "การเชื่อมต่อกับงานวิเคราะห์ขาดหาย — ระบบจะเชื่อมต่องานเดิมให้อัตโนมัติเมื่อกลับมา";
    case "invalid_state":
      return "สถานะเกมบนเซิร์ฟเวอร์ไม่สมบูรณ์ จึงวิเคราะห์ไม่ได้";
    default:
      return "วิเคราะห์ไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }
}

export function TurnAnalysisLauncher({
  roomId,
  revision,
  playerName,
  disabled,
  disabledReason,
  reconnectEpoch = 0,
}: {
  /** The LIVE ROOM's id (`room_live.room_id`, this app's `activeRoomId`) — not
   *  `GameState.gameId`, which is a client-generated UUID the server has never
   *  seen. Named `roomId` here precisely so the two cannot be confused. */
  roomId: string;
  revision: number;
  playerName: string;
  /** The frontend's own view of whether this turn can be analysed. Convenience
   *  only — the backend decides, and refuses regardless of what is rendered. */
  disabled: boolean;
  disabledReason?: string;
  /** Increments whenever the browser wakes from the background. The revision
   * may be unchanged, but the old SSE connection may no longer exist. */
  reconnectEpoch?: number;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AnalysisLevel>("quick");
  const [panelOpen, setPanelOpen] = useState(false);
  // Seeded from the session cache so a result the engine already computed for
  // THIS position is offered again without pressing Analyze. A result for a
  // revision the game has left is ignored — checked here and again on render.
  const [result, setResult] = useState<AnalysisResult | null>(() => {
    const cached = analysisCache.getResult(roomId);
    return cached && cached.revision === revision ? cached : null;
  });

  // The single source of truth for "is something running": a store that outlives
  // this component. Nothing below writes progress; it only reads it.
  useSyncExternalStore(
    engineSessions.subscribe,
    engineSessions.getVersion,
    engineSessions.getVersion,
  );
  const session = engineSessions.analysisFor(roomId, revision);

  // Ask the SERVER what exists for this position. This is what makes recovery
  // work without a local pointer: after a navigation, a reload, in a second tab,
  // or on a device that has never seen this game, the answer is the same.
  useEffect(() => {
    let cancelled = false;
    const hints = engineSessions.restoreHints(roomId);
    void engineSessions.discover({ roomId, revision, hints }).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [roomId, revision, reconnectEpoch]);

  // The position moved on. Anything for another revision is no longer about
  // this turn: stop watching it and stop showing its answer. Note what this does
  // NOT do — it never cancels, because the job may still be wanted by another
  // observer, and it is keyed on the revision rather than on this component's
  // lifetime.
  useEffect(() => {
    engineSessions.dropStale(roomId, revision);
    if (result && result.revision !== revision) {
      setResult(null);
      setPanelOpen(false);
      analysisCache.clearResult(roomId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, revision]);

  // A finished session becomes a result. Reading it here rather than in the
  // click handler is what makes "it finished while you were away" work: the
  // session completed with nobody rendering, and this picks it up on return.
  useEffect(() => {
    if (session?.status.kind !== "completed" || !session.result) return;
    const analysis = session.result as AnalysisResult;
    if (analysis.revision !== revision) return;
    analysisCache.rememberResult(roomId, analysis);
    setResult(analysis);
    setPanelOpen(true);
    setLevel(analysis.level);
  }, [session?.key, session?.status.kind, revision, roomId, session]);

  const analyze = useCallback(
    (chosen: AnalysisLevel) => {
      setLevel(chosen);
      setOpen(false);
      setResult(null);
      // Fire and forget: the store owns the request from here, so navigating
      // away mid-search costs nothing.
      void engineSessions.startAnalysis({ roomId, revision, level: chosen });
    },
    [roomId, revision],
  );

  const cancel = useCallback(() => {
    if (session) engineSessions.cancel(session.key);
  }, [session]);

  // A result is only ever rendered for the revision it was computed at. Two
  // checks say the same thing on purpose: one when it arrives, one when it is
  // drawn, so no later state change can slip a stale panel back on screen.
  const showable = result && result.revision === revision ? result : null;
  const status = session?.status;
  const inFlight =
    status !== undefined && status.kind !== "completed" && status.kind !== "failed";
  const failure =
    status?.kind === "failed" ? messageFor(new EngineApiError(status.code, status.message)) : null;

  if (inFlight) {
    // Waiting for a CPU is not analysing, and saying so is the whole point of
    // this branch: a queued request drawn as a stalled progress bar looks
    // broken, and looking broken is how a working server loses a user.
    const queued = status.kind === "queued" ? status : null;
    const reconnecting = status.kind === "reconnecting";
    const progress = session?.progress ?? null;
    const percent = progress ? Math.round(Math.max(0, Math.min(100, progress.percent))) : null;
    const eta = progress && progress.etaMs > 500 ? Math.ceil(progress.etaMs / 1000) : null;
    const runningLevel = session?.level ?? level;
    return (
      <div
        className={`analysis-running engine-activity-dock${queued ? " is-queued" : ""}${reconnecting ? " is-reconnecting" : ""}`}
        role="status"
        aria-live="polite"
        data-phase={status.kind}
      >
        <div className="analysis-running-head">
          <span className="analysis-running-label">
            <span className="bot-thinking-dot" aria-hidden="true" />
            {queued
              ? `กำลังรอคิววิเคราะห์ (${LEVEL_LABEL[runningLevel]})`
              : reconnecting
                ? "กำลังเชื่อมต่องานวิเคราะห์เดิม"
                : `กำลังวิเคราะห์ (${LEVEL_LABEL[runningLevel]})`}
          </span>
          <span className="analysis-running-eta">
            {queued
              ? // Only shown when the server gave a place in line it stands
                // behind. Never a fabricated position, and never a time — a
                // bot turn may legitimately overtake this.
                queued.position !== null && queued.position > 1
                ? `คิวที่ ${queued.position}`
                : "รอเครื่องว่าง"
              : progress
                ? `${percent}% · ${eta !== null ? `~${eta}s` : `${(progress.elapsedMs / 1000).toFixed(1)}s`}`
                : reconnecting
                  ? "เรียกสถานะล่าสุด…"
                  : "เริ่มต้น…"}
          </span>
          <button type="button" className="analysis-cancel" onClick={cancel}>
            ยกเลิก
          </button>
        </div>
        <div className="bot-thinking-track">
          {progress ? (
            <div
              className="bot-thinking-fill"
              style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
            />
          ) : (
            // Indeterminate: nothing has produced a percentage yet, so nothing
            // here claims one.
            <div className="bot-thinking-fill is-indeterminate" />
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="analysis-launcher">
        <button
          type="button"
          className="bot-why-btn analysis-btn"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          🔎 วิเคราะห์ตานี้
        </button>
        {showable && !panelOpen && (
          <button type="button" className="analysis-reopen" onClick={() => setPanelOpen(true)}>
            ดูผลล่าสุด
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="analysis-levels" role="group" aria-label="ระดับการวิเคราะห์">
          {ANALYSIS_LEVELS.map((option) => (
            <button
              key={option}
              type="button"
              className={`analysis-level${option === level ? " active" : ""}`}
              onClick={() => analyze(option)}
            >
              <span className="analysis-level-name">{LEVEL_LABEL[option]}</span>
              <span className="analysis-level-hint">{LEVEL_HINT[option]}</span>
            </button>
          ))}
        </div>
      )}

      {failure && (
        <div className="analysis-error" role="alert">
          {failure}
        </div>
      )}

      {showable && panelOpen && (
        <TurnAnalysisPanel
          analysis={showable}
          playerName={playerName}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}
