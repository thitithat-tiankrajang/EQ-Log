import { useCallback, useEffect, useRef, useState } from "react";

import {
  ANALYSIS_LEVELS,
  EngineApiError,
  requestAnalysis,
  type AnalysisLevel,
  type AnalysisResult,
  type EngineProgress,
} from "../../bot/engineApi";
import { TurnAnalysisPanel } from "./TurnAnalysisPanel";

// The Analyze control and everything that can go wrong behind it.
//
// The rule this component is built around: an analysis is about a POSITION, not
// about a game. It is computed for one revision, and the moment the game leaves
// that revision the answer stops being an answer. So the revision it was asked
// for is carried all the way through and compared on the way out — a result for
// revision N can never be shown as though it applied to N+1.
//
// That single rule covers most of the cases that look separate: the player moved
// while it was running, the opponent moved, the room resynchronised, a
// reconnect replaced the state. All of them are "the revision changed".
//
// The second rule, new since the engine moved to a shared server: **a request
// that has been accepted has not necessarily started**. The server has a finite
// number of CPUs and a queue in front of them, so "asked" and "computing" are
// now different states and the player is told which one they are in. A queued
// analysis showing a progress bar at 0% would look frozen and would be lying
// about what the server is doing; a queued analysis that says it is queued is
// neither.

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

/**
 * The lifecycle of one analysis request, as the server actually reports it.
 *
 * `queued` and `running` are separate because on the server they are separate:
 * one means no CPU has been given to this yet, the other means a process is
 * searching. `stale` is its own outcome rather than an error, because nobody
 * did anything wrong — the game simply moved on.
 */
type AnalysisPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "queued"; position: number | null }
  | { kind: "running"; progress: EngineProgress | null };

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
      return "ติดต่อเซิร์ฟเวอร์วิเคราะห์ไม่ได้ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่";
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
}: {
  /** The LIVE ROOM's id (`room_live.room_id`, this app's `activeRoomId`) — not
   *  `GameState.gameId`, which is a client-generated UUID the server has never
   *  seen. Named `roomId` here precisely so the two cannot be confused: passing
   *  the game blob's id returned `not_found` on every analysis request. */
  roomId: string;
  revision: number;
  playerName: string;
  /** The frontend's own view of whether this turn can be analysed. Convenience
   *  only — the backend decides, and refuses regardless of what is rendered. */
  disabled: boolean;
  disabledReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AnalysisLevel>("quick");
  const [phase, setPhase] = useState<AnalysisPhase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  // Whether the result panel is on screen. Kept apart from `result` so closing
  // the panel does not throw away an analysis the player may want again — the
  // search cost real server time.
  const [panelOpen, setPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inFlight = phase.kind !== "idle";

  const cancel = useCallback(() => {
    // Aborting releases the server's reference to the search. A job still in
    // the queue gives its place back at once; a job already running has its
    // engine process killed once nobody is waiting on it.
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "idle" });
  }, []);

  // The game moved on. Anything on screen or in flight describes a board that
  // no longer exists, so it goes — silently, because the player did not do
  // anything wrong by moving.
  useEffect(() => {
    if (result && result.revision !== revision) {
      setResult(null);
      setPanelOpen(false);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase({ kind: "idle" });
    setError(null);
    // `phase` is deliberately absent: this must fire on revision changes, not
    // when a run it started advances its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, roomId]);

  // Leaving the screen must not leave a search running on the server with
  // nobody waiting for it.
  useEffect(() => () => abortRef.current?.abort(), []);

  const analyze = useCallback(
    async (chosen: AnalysisLevel) => {
      const requestedRevision = revision;
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: "requesting" });
      setError(null);
      setResult(null);
      setOpen(false);

      try {
        const analysis = await requestAnalysis({
          // The service's path segment is named `gameId`; the value it wants
          // is the room id. See engineApi.ts for why those are different words
          // for the same thing here.
          gameId: roomId,
          expectedRevision: requestedRevision,
          level: chosen,
          // Each of these is a transition the server reported. None is a timer
          // on this side pretending to know what the server is doing.
          onQueued: (state) => {
            if (controller.signal.aborted) return;
            setPhase({ kind: "queued", position: state.position > 0 ? state.position : null });
          },
          onRunning: () => {
            if (controller.signal.aborted) return;
            setPhase({ kind: "running", progress: null });
          },
          onProgress: (progress) => {
            if (controller.signal.aborted) return;
            setPhase({ kind: "running", progress });
          },
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        // The guard that matters. Between asking and answering the game may
        // have advanced — a move by either side, a resync, a reconnect. The
        // server answered the question we asked; it is no longer the question
        // worth answering.
        if (analysis.revision !== requestedRevision) {
          setError("กระดานเปลี่ยนไปแล้วระหว่างวิเคราะห์ — กดวิเคราะห์อีกครั้งเพื่อดูตาปัจจุบัน");
          return;
        }
        setResult(analysis);
        setPanelOpen(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(
          failure instanceof EngineApiError
            ? messageFor(failure)
            : "วิเคราะห์ไม่สำเร็จ — ลองใหม่อีกครั้ง",
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPhase({ kind: "idle" });
        }
      }
    },
    [roomId, revision],
  );

  // A result is only ever rendered for the revision it was computed at. Two
  // checks say the same thing on purpose: one when it arrives, one when it is
  // drawn, so no later state change can slip a stale panel back on screen.
  const showable = result && result.revision === revision ? result : null;

  if (inFlight) {
    // Waiting for a CPU is not analysing, and saying so is the whole point of
    // this branch: a queued request drawn as a stalled progress bar looks
    // broken, and looking broken is how a working server loses a user.
    const queued = phase.kind === "queued" ? phase : null;
    const progress = phase.kind === "running" ? phase.progress : null;
    const eta = progress && progress.etaMs > 500 ? Math.ceil(progress.etaMs / 1000) : null;
    return (
      <div
        className={`analysis-running${queued ? " is-queued" : ""}`}
        role="status"
        aria-live="polite"
        data-phase={phase.kind}
      >
        <div className="analysis-running-head">
          <span className="analysis-running-label">
            <span className="bot-thinking-dot" aria-hidden="true" />
            {queued
              ? `กำลังรอคิววิเคราะห์ (${LEVEL_LABEL[level]})`
              : `กำลังวิเคราะห์ (${LEVEL_LABEL[level]})`}
          </span>
          <span className="analysis-running-eta">
            {queued
              ? // Only shown when the server gave a place in line it stands
                // behind. Never a fabricated position, and never a time — a
                // bot turn may legitimately overtake this.
                queued.position !== null && queued.position > 1
                ? `คิวที่ ${queued.position}`
                : "รอเครื่องว่าง"
              : eta !== null
                ? `~${eta}s`
                : progress
                  ? `${(progress.elapsedMs / 1000).toFixed(1)}s`
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
              onClick={() => {
                setLevel(option);
                void analyze(option);
              }}
            >
              <span className="analysis-level-name">{LEVEL_LABEL[option]}</span>
              <span className="analysis-level-hint">{LEVEL_HINT[option]}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="analysis-error" role="alert">
          {error}
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
