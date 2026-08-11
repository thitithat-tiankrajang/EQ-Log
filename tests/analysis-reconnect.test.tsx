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

const { attachAnalysis } = vi.hoisted(() => ({ attachAnalysis: vi.fn() }));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, attachAnalysis };
});

import * as analysisCache from "../src/analysisSessionCache";
import type { AnalysisResult, SseOutcome } from "../src/bot/engineApi";
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
  attachAnalysis.mockReset();
  attachAnalysis.mockResolvedValue({ kind: "idle" } satisfies SseOutcome<AnalysisResult>);
  analysisCache.clearInFlight(ROOM_ID);
  analysisCache.clearResult(ROOM_ID);
});

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
  it("reconnects to the in-flight search and shows its result when it lands", async () => {
    analysisCache.markInFlight(ROOM_ID, { revision: 7, level: "quick" });
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
    // The result surfaces on its own, and the in-flight marker is cleared.
    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());
    expect(analysisCache.getInFlight(ROOM_ID)).toBeUndefined();
  });

  it("does not reconnect to an analysis from a different revision", () => {
    analysisCache.markInFlight(ROOM_ID, { revision: 7, level: "quick" });
    render(
      <TurnAnalysisLauncher roomId={ROOM_ID} revision={9} playerName="Player" disabled={false} />,
    );
    expect(attachAnalysis).not.toHaveBeenCalled();
    // A stale marker is cleared so it cannot mislead a later mount.
    expect(analysisCache.getInFlight(ROOM_ID)).toBeUndefined();
  });
});
