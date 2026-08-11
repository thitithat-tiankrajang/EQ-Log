// Returning to Play must not throw away an analysis. Two ways it survives:
//
//   • A finished analysis for THIS position is offered again without pressing
//     Analyze — the search cost real server time and the position has not moved.
//   • An analysis that was still running when the panel unmounted is REJOINED on
//     the server, restoring its running state and delivering the result when it
//     lands — no second search, no re-press.
//
// Both are driven off the session cache, which outlives the component the way it
// must in the app; each test clears it so one cannot leak into the next.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachAnalysis, listJobs } = vi.hoisted(() => ({
  attachAnalysis: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, attachAnalysis, listJobs, isEngineApiConfigured: true };
});

import * as analysisCache from "../src/analysisSessionCache";
import * as engineSessions from "../src/engineSessions";
import type { AnalysisLevel, AnalysisResult, SseOutcome } from "../src/bot/engineApi";
import { TurnAnalysisLauncher } from "../src/components/game/TurnAnalysisLauncher";

const ROOM_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

function analysisAt(revision: number): AnalysisResult {
  return {
    level: "quick",
    gameId: "g1",
    revision,
    turnNumber: 4,
    side: "A",
    recommendation: {
      rank: 1,
      kind: "place",
      placements: [{ r: 7, c: 7, kind: "5", token: "5" }],
      exchange: [],
      immediateScore: 24,
      evaluation: 24.1,
      evaluationGap: 0,
      factors: [{ key: "score", label: "Points this turn", value: 24 }],
      provenMargin: null,
      recommended: true,
      note: "Best overall balance.",
    },
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

afterEach(cleanup);
beforeEach(() => {
  engineSessions.resetForTests();
  window.sessionStorage.clear();
  attachAnalysis.mockReset();
  attachAnalysis.mockResolvedValue({ kind: "idle" } satisfies SseOutcome<AnalysisResult>);
  listJobs.mockReset().mockResolvedValue([]);
  analysisCache.clearResult(ROOM_ID);
});

/** What the server reports for a running analysis at `revision`. This is the
 *  whole recovery story: the client asks by POSITION and is told the level. */
function runningJob(level: AnalysisLevel = "quick", percent?: number) {
  return [
    {
      kind: "analysis" as const,
      level,
      status: "running" as const,
      ...(percent === undefined
        ? {}
        : {
            progress: {
              phase: "sim" as const,
              percent,
              elapsedMs: 5_000,
              etaMs: 5_000,
              detail: "samples=2/4",
            },
          }),
    },
  ];
}

describe("returning to a finished analysis", () => {
  it("offers a remembered result for this revision without pressing Analyze", () => {
    analysisCache.rememberResult(ROOM_ID, analysisAt(7));
    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    // The "see latest result" affordance appears from the seed alone.
    expect(screen.getByRole("button", { name: /ดูผลล่าสุด/ })).toBeInTheDocument();
  });

  it("ignores a remembered result from a revision the game has left", () => {
    analysisCache.rememberResult(ROOM_ID, analysisAt(7));
    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={8} playerName="Player" disabled={false} />,
    );
    expect(screen.queryByRole("button", { name: /ดูผลล่าสุด/ })).not.toBeInTheDocument();
  });
});

describe("returning to a running analysis", () => {
  it("rediscovers a running analysis with no local pointer at all", async () => {
    // The core fix. Nothing in this tab knows an analysis exists — no session
    // storage, no in-memory note, and crucially no LEVEL, which cannot be
    // derived from the game. Previously that made a live search unreachable and
    // the only way forward was to press Analyze and pay for it again. The
    // server is asked instead, and it knows.
    listJobs.mockResolvedValue(runningJob("deep", 50));
    attachAnalysis.mockImplementation(() => new Promise(() => undefined));

    const view = render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );

    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    // Attached at the level the SERVER named, not one this tab remembered.
    expect(attachAnalysis.mock.calls[0][0]).toMatchObject({
      gameId: ROOM_ID,
      expectedRevision: 7,
      level: "deep",
    });
    // And the server's own percentage is on the first frame — no fabricated
    // zero, no indeterminate flash while a stream opens.
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect((view.container.querySelector(".bot-thinking-fill") as HTMLElement).style.width).toBe(
      "50%",
    );
  });

  it("renders the persisted percentage immediately after a page refresh", async () => {
    // A reload destroys the store before the server can be asked. The mirror in
    // session storage is a PAINT HINT for exactly that gap: it shows the last
    // real number for the one round trip discovery takes.
    window.sessionStorage.setItem(
      `eq-lab:engine-session:v1:${ROOM_ID}`,
      JSON.stringify([
        {
          key: `analysis:${ROOM_ID}:7:quick`,
          kind: "analysis",
          roomId: ROOM_ID,
          revision: 7,
          level: "quick",
          progress: {
            phase: "sim",
            percent: 50,
            elapsedMs: 5_000,
            etaMs: 5_000,
            detail: "samples=2/4",
          },
          startedAt: Date.now(),
        },
      ]),
    );
    listJobs.mockResolvedValue(runningJob("quick"));
    attachAnalysis.mockImplementation(() => new Promise(() => undefined));

    const view = render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );

    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/กำลังเชื่อมต่องานวิเคราะห์เดิม/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect((view.container.querySelector(".bot-thinking-fill") as HTMLElement).style.width).toBe(
      "50%",
    );
  });

  it("survives a page the player navigated away from and back to", async () => {
    // Unmounting Play must not end the observation. The store is a module, so
    // the stream stays open, progress keeps arriving with nothing rendered, and
    // the remount reads the current value instead of re-establishing anything.
    let report!: (progress: {
      phase: string;
      percent: number;
      elapsedMs: number;
      etaMs: number;
      detail: string;
    }) => void;
    listJobs.mockResolvedValue(runningJob("quick"));
    attachAnalysis.mockImplementation(
      (options: { onProgress?: (progress: never) => void }) =>
        new Promise<never>(() => {
          report = options.onProgress as typeof report;
        }),
    );

    const view = render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    report({ phase: "sim", percent: 20, elapsedMs: 1_000, etaMs: 4_000, detail: "samples=1/4" });
    await waitFor(() => expect(screen.getByText(/20%/)).toBeInTheDocument());

    // Leave Play. React throws the tree away; the search does not notice.
    view.unmount();
    report({ phase: "sim", percent: 71, elapsedMs: 4_000, etaMs: 1_000, detail: "samples=3/4" });

    // Come back.
    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    // The percentage that was reached while away, on the first frame. Not 0%,
    // not "reconnecting", and no second attach.
    expect(screen.getByText(/71%/)).toBeInTheDocument();
    expect(attachAnalysis).toHaveBeenCalledTimes(1);
  });

  it("shows a result that landed while the player was away", async () => {
    listJobs.mockResolvedValue(runningJob("quick"));
    let finish!: (outcome: SseOutcome<AnalysisResult>) => void;
    attachAnalysis.mockImplementation(
      () =>
        new Promise<SseOutcome<AnalysisResult>>((resolve) => {
          finish = resolve;
        }),
    );

    const view = render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));

    view.unmount();
    finish({ kind: "result", result: analysisAt(7) });
    await Promise.resolve();

    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());
  });

  it("reconnects to the in-flight search and shows its result when it lands", async () => {
    listJobs.mockResolvedValue(runningJob("quick"));
    attachAnalysis.mockImplementation(
      async (options: { onRunning?: () => void }): Promise<SseOutcome<AnalysisResult>> => {
        options.onRunning?.();
        return { kind: "result", result: analysisAt(7) };
      },
    );

    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );

    // It reconnected rather than starting a new search.
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    expect(attachAnalysis.mock.calls[0][0]).toMatchObject({
      gameId: ROOM_ID,
      expectedRevision: 7,
      level: "quick",
    });
    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());
  });

  it("does not reconnect to an analysis from a different revision", async () => {
    // Discovery is revision-scoped on the server, so a job for revision 7 is
    // simply not among the answers for revision 9.
    listJobs.mockResolvedValue([]);
    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={9} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    expect(listJobs.mock.calls[0][0]).toMatchObject({ revision: 9 });
    expect(attachAnalysis).not.toHaveBeenCalled();
  });
});
