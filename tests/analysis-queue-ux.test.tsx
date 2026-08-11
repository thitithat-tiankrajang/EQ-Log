// Turn analysis, against a server that may not start the work immediately.
//
// Two properties are pinned here:
//
//   • A queued analysis LOOKS queued. Drawing a stalled progress bar for a
//     request the server has not begun makes a working system look frozen, and
//     "frozen" is the reading a player acts on.
//   • A result is only ever shown for the position it was computed at. That was
//     already true; queueing widens the window in which it can go wrong, from
//     "while the search ran" to "while the search waited AND ran".
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestAnalysis } = vi.hoisted(() => ({ requestAnalysis: vi.fn() }));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, requestAnalysis };
});

import * as analysisCache from "../src/analysisSessionCache";
import { EngineApiError, type AnalysisResult } from "../src/bot/engineApi";
import { TurnAnalysisLauncher } from "../src/components/game/TurnAnalysisLauncher";

/** The LIVE ROOM's id — what `room_live.room_id` holds and what every server
 *  RPC calls `target_game_id`. Deliberately unlike a `GameState.gameId`. */
const ROOM_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

afterEach(cleanup);
beforeEach(() => {
  requestAnalysis.mockReset();
  // The session cache is module state that outlives a single render, which is
  // the point in the app and a cross-test leak here: an analysis left in flight
  // by one test would make the next mount reconnect instead of starting fresh.
  analysisCache.clearInFlight(ROOM_ID);
  analysisCache.clearResult(ROOM_ID);
});

function analysisAt(revision: number): AnalysisResult {
  const candidate = {
    rank: 1,
    kind: "place" as const,
    placements: [{ r: 7, c: 7, kind: "5", token: "5" }],
    exchange: [],
    immediateScore: 24,
    evaluation: 24.1,
    evaluationGap: 0,
    factors: [{ key: "score" as const, label: "Points this turn", value: 24 }],
    provenMargin: null,
    recommended: true,
    note: "Best overall balance.",
  };
  return {
    level: "quick",
    gameId: "g1",
    revision,
    turnNumber: 4,
    side: "A",
    recommendation: candidate,
    alternatives: [],
    summary: "A summary.",
    method: {
      solver: "sim",
      samples: 4,
      legalMoves: 100,
      candidatesEvaluated: 8,
      nodes: 1000,
      elapsedMs: 1200,
      proven: false,
      complete: true,
    },
  };
}

/** Render the launcher and press Analyse → quick. */
async function startAnalysis(revision = 7) {
  const view = render(
    <TurnAnalysisLauncher
      roomId={ROOM_ID}
      revision={revision}
      playerName="Player"
      disabled={false}
    />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ }));
  await user.click(screen.getByText("เร็ว"));
  return { ...view, user };
}

/** A request that never settles, so its lifecycle can be driven by hand. */
function controllable() {
  const hooks: {
    onQueued?: (state: { ahead: number; position: number }) => void;
    onRunning?: () => void;
    onProgress?: (progress: unknown) => void;
  } = {};
  let settle!: (result: AnalysisResult) => void;
  let fail!: (error: unknown) => void;
  requestAnalysis.mockImplementation((options: typeof hooks) => {
    hooks.onQueued = options.onQueued;
    hooks.onRunning = options.onRunning;
    hooks.onProgress = options.onProgress;
    return new Promise<AnalysisResult>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
  });
  return {
    hooks,
    resolve: (result: AnalysisResult) => settle(result),
    reject: (error: unknown) => fail(error),
  };
}

describe("which identifier reaches the server", () => {
  it("asks about the live room, not the game blob's own id", async () => {
    // Regression. `GameState.gameId` is a client-generated UUID from
    // `createNewGame`; the engine service looks a room up by
    // `room_live.room_id`. Sending the former made every analysis request come
    // back `{"code":"not_found"}` — the server was correctly reporting that no
    // such room exists, because none does under that id.
    controllable();
    await startAnalysis(7);
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());

    const sent = requestAnalysis.mock.calls[0]?.[0] as { gameId: string };
    expect(sent.gameId).toBe(ROOM_ID);
  });
});

describe("a queued analysis", () => {
  it("says it is waiting for engine capacity, not that it is analysing", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());

    control.hooks.onQueued?.({ ahead: 0, position: 1 });
    await waitFor(() => expect(screen.getByText(/กำลังรอคิววิเคราะห์/)).toBeInTheDocument());
    expect(screen.queryByText(/^กำลังวิเคราะห์/)).not.toBeInTheDocument();
  });

  it("shows a place in line only when the server gave one it stands behind", async () => {
    const control = controllable();
    const { container } = await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());

    control.hooks.onQueued?.({ ahead: 1, position: 2 });
    await waitFor(() => expect(screen.getByText("คิวที่ 2")).toBeInTheDocument());

    // Next in line: no number, because "คิวที่ 1" adds nothing over "waiting".
    control.hooks.onQueued?.({ ahead: 0, position: 1 });
    await waitFor(() => expect(screen.getByText("รอเครื่องว่าง")).toBeInTheDocument());

    // A position the client could not trust is never rendered as a number.
    control.hooks.onQueued?.({ ahead: -1, position: -1 });
    await waitFor(() => expect(screen.getByText("รอเครื่องว่าง")).toBeInTheDocument());
    expect(container.textContent).not.toContain("คิวที่ -1");
  });

  it("does not look frozen: no stalled progress bar while it waits", async () => {
    const control = controllable();
    const { container } = await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.hooks.onQueued?.({ ahead: 2, position: 3 });

    await waitFor(() =>
      expect(container.querySelector(".analysis-running")).toHaveAttribute("data-phase", "queued"),
    );
    const fill = container.querySelector(".bot-thinking-fill") as HTMLElement;
    expect(fill).toHaveClass("is-indeterminate");
    expect(fill.style.width).toBe("");
  });

  it("can be cancelled while it is still only waiting", async () => {
    const control = controllable();
    const { user } = await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.hooks.onQueued?.({ ahead: 1, position: 2 });
    await waitFor(() => expect(screen.getByText(/กำลังรอคิววิเคราะห์/)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "ยกเลิก" }));
    // Back to the launcher: the request was withdrawn, and on the server its
    // place in the queue was handed straight back.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ })).toBeInTheDocument(),
    );
  });
});

describe("queued → running → completed", () => {
  it("turns into an analysing state when the engine actually starts", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());

    control.hooks.onQueued?.({ ahead: 1, position: 2 });
    await waitFor(() => expect(screen.getByText(/กำลังรอคิววิเคราะห์/)).toBeInTheDocument());

    control.hooks.onRunning?.();
    await waitFor(() => expect(screen.getByText(/^กำลังวิเคราะห์/)).toBeInTheDocument());
    expect(screen.queryByText(/กำลังรอคิววิเคราะห์/)).not.toBeInTheDocument();
  });

  it("stays indeterminate until the engine reports a number of its own", async () => {
    const control = controllable();
    const { container } = await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());

    control.hooks.onRunning?.();
    await waitFor(() =>
      expect(container.querySelector(".analysis-running")).toHaveAttribute("data-phase", "running"),
    );
    expect(container.querySelector(".bot-thinking-fill")).toHaveClass("is-indeterminate");

    control.hooks.onProgress?.({
      phase: "sim",
      percent: 60,
      elapsedMs: 2000,
      etaMs: 1500,
      detail: "samples=2/4",
    });
    await waitFor(() => {
      const fill = container.querySelector(".bot-thinking-fill") as HTMLElement;
      expect(fill).not.toHaveClass("is-indeterminate");
      expect(fill.style.width).toBe("60%");
    });
  });

  it("finishes into the result panel", async () => {
    const control = controllable();
    await startAnalysis(7);
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.hooks.onQueued?.({ ahead: 0, position: 1 });
    control.hooks.onRunning?.();
    control.resolve(analysisAt(7));

    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());
    expect(screen.queryByText(/กำลังรอคิววิเคราะห์/)).not.toBeInTheDocument();
  });
});

describe("overload and failure", () => {
  it("keeps the in-flight marker when the stream drops after starting", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.hooks.onRunning?.();
    control.reject(new EngineApiError("offline", "stream dropped"));

    await waitFor(() =>
      expect(screen.getByText(/กำลังเชื่อมต่องานวิเคราะห์เดิม/)).toBeInTheDocument(),
    );
    expect(analysisCache.getInFlight(ROOM_ID)).toEqual({ revision: 7, level: "quick" });
  });

  it("explains a full queue in the player's terms, with no server detail", async () => {
    const control = controllable();
    const { container } = await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.reject(new EngineApiError("queue_full", "The engine is busy."));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ขณะนี้มีการใช้งานบอทจำนวนมาก กรุณาลองใหม่อีกครั้ง");
    const text = container.textContent ?? "";
    for (const leak of ["queue_full", "503", "concurrency", "amath_cli"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("says a timeout was a calculation that ran too long and was stopped", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.reject(new EngineApiError("engine_timeout", "too long"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/ใช้เวลานานเกินกำหนดและถูกหยุดไว้/);
  });

  it("tells the player the position changed rather than showing nothing", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.reject(new EngineApiError("stale_revision", "moved on"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/กระดานเปลี่ยนไปแล้ว/);
  });

  it("returns to the launcher after a failure, so it can be tried again", async () => {
    const control = controllable();
    await startAnalysis();
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.reject(new EngineApiError("queue_full", "busy"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ })).toBeInTheDocument(),
    );
  });
});

describe("a result that is no longer about this position", () => {
  it("never shows an answer computed for a revision the game has left", async () => {
    // The whole reason a queue makes this urgent: the analysis was admitted at
    // revision 7, waited, and by the time it answered the board was at 8.
    requestAnalysis.mockResolvedValue(analysisAt(7));
    const { rerender } = await startAnalysis(7);
    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());

    rerender(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={8} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(screen.queryByText("A summary.")).not.toBeInTheDocument());
  });

  it("abandons a queued analysis the moment the game moves on", async () => {
    // Silently: the player did nothing wrong by taking their turn. The request
    // is aborted, which on the server hands its queue place straight back.
    const control = controllable();
    const { rerender } = await startAnalysis(7);
    await waitFor(() => expect(requestAnalysis).toHaveBeenCalled());
    control.hooks.onQueued?.({ ahead: 1, position: 2 });
    await waitFor(() => expect(screen.getByText(/กำลังรอคิววิเคราะห์/)).toBeInTheDocument());

    const signal = requestAnalysis.mock.calls[0]?.[0]?.signal as AbortSignal;
    rerender(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={8} playerName="Player" disabled={false} />,
    );

    await waitFor(() => expect(signal.aborted).toBe(true));
    expect(screen.queryByText(/กำลังรอคิววิเคราะห์/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
