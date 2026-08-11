import { useCallback, useEffect, useRef, useState } from "react";

import {
  ANALYSIS_LEVELS,
  EngineApiError,
  attachAnalysis,
  cancelAnalysis,
  requestAnalysis,
  type AnalysisLevel,
  type AnalysisResult,
  type EngineProgress,
} from "../../bot/engineApi";
import * as analysisCache from "../../analysisSessionCache";
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
  | { kind: "reconnecting"; progress: EngineProgress | null }
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
      return "การเชื่อมต่อกับงานวิเคราะห์ขาดหาย — ระบบจะเชื่อมต่องานเดิมให้อัตโนมัติเมื่อกลับมา";
    case "invalid_state":
      return "สถานะเกมบนเซิร์ฟเวอร์ไม่สมบูรณ์ จึงวิเคราะห์ไม่ได้";
    default:
      return "วิเคราะห์ไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }
}

/** A broken stream does not prove the POST failed. It may have reached the
 * server and started a job before the browser suspended the connection, so the
 * reconnect descriptor must survive until a GET proves the job is idle. */
function serverMayStillBeWorking(failure: unknown): boolean {
  return failure instanceof EngineApiError && failure.code === "offline";
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
   *  seen. Named `roomId` here precisely so the two cannot be confused: passing
   *  the game blob's id returned `not_found` on every analysis request. */
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
  const initialPending = analysisCache.getInFlight(roomId);
  const initialPendingForPosition =
    initialPending?.revision === revision ? initialPending : undefined;
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<AnalysisLevel>(initialPendingForPosition?.level ?? "quick");
  const [phase, setPhase] = useState<AnalysisPhase>(() =>
    initialPendingForPosition
      ? { kind: "reconnecting", progress: initialPendingForPosition.progress ?? null }
      : { kind: "idle" },
  );
  const [error, setError] = useState<string | null>(null);
  // Seed from the session cache so returning to Play shows a result the engine
  // already computed for THIS position, without pressing Analyze again. A cached
  // result for a revision the game has since left is ignored — the same rule the
  // revision-change effect below enforces continuously.
  const [result, setResult] = useState<AnalysisResult | null>(() => {
    const cached = analysisCache.getResult(roomId);
    return cached && cached.revision === revision ? cached : null;
  });
  // Whether the result panel is on screen. Kept apart from `result` so closing
  // the panel does not throw away an analysis the player may want again — the
  // search cost real server time.
  const [panelOpen, setPanelOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastProgressRef = useRef<{
    roomId: string;
    revision: number;
    level: AnalysisLevel;
    progress: EngineProgress | null;
  } | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const inFlight = phase.kind !== "idle";

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectAttempt((attempt) => attempt + 1);
    }, 2_000);
  }, []);

  const cancel = useCallback(() => {
    // Stop watching this run, and — because the player asked to cancel, not
    // merely to look away — tell the server to stop the search too. A disconnect
    // alone would leave it running for a return that is not coming.
    abortRef.current?.abort();
    abortRef.current = null;
    lastProgressRef.current = null;
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setPhase({ kind: "idle" });
    const pending = analysisCache.getInFlight(roomId);
    analysisCache.clearInFlight(roomId);
    if (pending) {
      void cancelAnalysis({ gameId: roomId, expectedRevision: pending.revision, level: pending.level });
    }
  }, [roomId]);

  // Reconcile the panel with the position, and reconnect to work that outlived
  // the last mount. Two jobs in one effect because they share the same trigger:
  //
  //   • The game moved on → anything for a different revision is stale and goes,
  //     silently, because the player did nothing wrong by moving.
  //   • An analysis was IN FLIGHT for THIS revision when the panel unmounted →
  //     rejoin the same server job (it kept running), restoring queued/running
  //     and delivering the result when it lands. If it already finished, the
  //     server returns it from cache; if it is gone, we quietly fall back to idle.
  useEffect(() => {
    if (result && result.revision !== revision) {
      setResult(null);
      setPanelOpen(false);
      analysisCache.clearResult(roomId);
    }
    abortRef.current?.abort();
    abortRef.current = null;
    setError(null);

    const pending = analysisCache.getInFlight(roomId);
    if (!pending || pending.revision !== revision) {
      // Nothing of ours is running for this position.
      if (pending) analysisCache.clearInFlight(roomId);
      lastProgressRef.current = null;
      setPhase({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLevel(pending.level);
    const remembered =
      lastProgressRef.current?.roomId === roomId &&
      lastProgressRef.current.revision === revision &&
      lastProgressRef.current.level === pending.level
        ? lastProgressRef.current.progress
        : (pending.progress ?? null);
    lastProgressRef.current = { roomId, revision, level: pending.level, progress: remembered };
    setPhase({ kind: "reconnecting", progress: remembered });
    attachAnalysis({
      gameId: roomId,
      expectedRevision: revision,
      level: pending.level,
      onQueued: (state) => {
        if (controller.signal.aborted) return;
        setPhase({ kind: "queued", position: state.position > 0 ? state.position : null });
      },
      onRunning: () => {
        if (controller.signal.aborted) return;
        setPhase({ kind: "running", progress: remembered });
      },
      onProgress: (progress) => {
        if (controller.signal.aborted) return;
        lastProgressRef.current = { roomId, revision, level: pending.level, progress };
        analysisCache.rememberProgress(roomId, progress);
        setPhase({ kind: "running", progress });
      },
      signal: controller.signal,
    })
      .then((outcome) => {
        if (controller.signal.aborted) return;
        analysisCache.clearInFlight(roomId);
        lastProgressRef.current = null;
        if (outcome.kind === "idle" || outcome.result.revision !== revision) return;
        analysisCache.rememberResult(roomId, outcome.result);
        setResult(outcome.result);
        // The player was waiting on this one, so surface it rather than leaving
        // it behind a "see latest" button.
        setPanelOpen(true);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        // Losing the observer stream says nothing about the server-owned job.
        // Keep its address so the next focus/visibility/online wake retries GET.
        if (serverMayStillBeWorking(failure)) {
          setPhase({ kind: "reconnecting", progress: lastProgressRef.current?.progress ?? null });
          scheduleReconnect();
        } else {
          analysisCache.clearInFlight(roomId);
          lastProgressRef.current = null;
        }
      })
      .finally(() => {
        if (abortRef.current === controller) {
          abortRef.current = null;
          const stillPending = analysisCache.getInFlight(roomId);
          setPhase(
            stillPending?.revision === revision
              ? { kind: "reconnecting", progress: lastProgressRef.current?.progress ?? null }
              : { kind: "idle" },
          );
        }
      });

    return () => {
      controller.abort();
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
    // `phase`/`result` are deliberately absent: this must fire on revision or
    // room changes, not when a run it started advances its own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, roomId, reconnectEpoch, reconnectAttempt, scheduleReconnect]);

  // Leaving the screen stops this tab watching the search. It does NOT stop the
  // search: the server keeps it running, and a return reconnects to it above.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    },
    [],
  );

  const analyze = useCallback(
    async (chosen: AnalysisLevel) => {
      const requestedRevision = revision;
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase({ kind: "requesting" });
      setError(null);
      setResult(null);
      setOpen(false);
      lastProgressRef.current = { roomId, revision: requestedRevision, level: chosen, progress: null };
      // Record what is running for this position, so if the panel unmounts
      // (navigation, tab switch) a remount can reconnect to this exact search
      // instead of starting another.
      analysisCache.markInFlight(roomId, { revision: requestedRevision, level: chosen });

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
            setPhase({ kind: "running", progress: lastProgressRef.current?.progress ?? null });
          },
          onProgress: (progress) => {
            if (controller.signal.aborted) return;
            lastProgressRef.current = {
              roomId,
              revision: requestedRevision,
              level: chosen,
              progress,
            };
            analysisCache.rememberProgress(roomId, progress);
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
          analysisCache.clearInFlight(roomId);
          setError("กระดานเปลี่ยนไปแล้วระหว่างวิเคราะห์ — กดวิเคราะห์อีกครั้งเพื่อดูตาปัจจุบัน");
          return;
        }
        analysisCache.clearInFlight(roomId);
        lastProgressRef.current = null;
        analysisCache.rememberResult(roomId, analysis);
        setResult(analysis);
        setPanelOpen(true);
      } catch (failure) {
        if (controller.signal.aborted) return;
        // The POST may have been accepted before its response stream broke.
        // Only a later reconnect returning `idle` proves there is no job.
        if (serverMayStillBeWorking(failure)) {
          scheduleReconnect();
        } else {
          analysisCache.clearInFlight(roomId);
          lastProgressRef.current = null;
        }
        setError(
          failure instanceof EngineApiError
            ? messageFor(failure)
            : "วิเคราะห์ไม่สำเร็จ — ลองใหม่อีกครั้ง",
        );
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          const stillPending = analysisCache.getInFlight(roomId);
          setPhase(
            stillPending?.revision === requestedRevision
              ? { kind: "reconnecting", progress: lastProgressRef.current?.progress ?? null }
              : { kind: "idle" },
          );
        }
      }
    },
    [roomId, revision, scheduleReconnect],
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
    const reconnecting = phase.kind === "reconnecting";
    const progress =
      phase.kind === "running" || phase.kind === "reconnecting" ? phase.progress : null;
    const percent = progress ? Math.round(Math.max(0, Math.min(100, progress.percent))) : null;
    const eta = progress && progress.etaMs > 500 ? Math.ceil(progress.etaMs / 1000) : null;
    return (
      <div
        className={`analysis-running engine-activity-dock${queued ? " is-queued" : ""}${reconnecting ? " is-reconnecting" : ""}`}
        role="status"
        aria-live="polite"
        data-phase={phase.kind}
      >
        <div className="analysis-running-head">
          <span className="analysis-running-label">
            <span className="bot-thinking-dot" aria-hidden="true" />
            {queued
              ? `กำลังรอคิววิเคราะห์ (${LEVEL_LABEL[level]})`
              : reconnecting
                ? "กำลังเชื่อมต่องานวิเคราะห์เดิม"
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
