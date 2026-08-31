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
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { attachAnalysis, listJobs, requestAnalysis } = vi.hoisted(() => ({
  attachAnalysis: vi.fn(),
  listJobs: vi.fn(),
  requestAnalysis: vi.fn(),
}));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, attachAnalysis, listJobs, requestAnalysis, isEngineApiConfigured: true };
});

import * as analysisCache from "../src/analysisSessionCache";
import * as engineSessions from "../src/engineSessions";
import { EngineApiError } from "../src/bot/engineApi";
import type { AnalysisLevel, AnalysisResult, SseOutcome } from "../src/bot/engineApi";
import { TurnAnalysisBar, TurnAnalysisLauncher } from "../src/components/game/TurnAnalysisLauncher";

const ROOM_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/**
 * The launcher and the running bar, composed the way Play composes them.
 *
 * They are two components now: the launcher sits with the other per-turn
 * insights, and the running bar is drawn in the ACTION slot, in place of
 * Exchange and Pass. Both read the same row out of `engineSessions`, so this
 * wrapper is the whole of what the shell does to put them together.
 */
function AnalysisSurface(props: ComponentProps<typeof TurnAnalysisLauncher>) {
  return (
    <>
      <TurnAnalysisLauncher {...props} />
      <TurnAnalysisBar roomId={props.roomId} revision={props.revision} />
    </>
  );
}

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
  requestAnalysis.mockReset().mockImplementation(() => new Promise(() => undefined));
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
    render(<AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />);
    // The "see latest result" affordance appears from the seed alone.
    expect(screen.getByRole("button", { name: /ดูผลล่าสุด/ })).toBeInTheDocument();
  });

  it("ignores a remembered result from a revision the game has left", () => {
    analysisCache.rememberResult(ROOM_ID, analysisAt(7));
    render(<AnalysisSurface roomId={ROOM_ID} revision={8} playerName="Player" disabled={false} />);
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
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
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

  it("renders the persisted percentage without waiting for the server", async () => {
    // A reload destroys the store, and asking the server takes a round trip. The
    // bug: for the whole of that round trip the player got the Analyze button
    // back, having watched a bar reach 50% a second earlier. The number was in
    // hand the entire time and nothing was allowed to draw it.
    //
    // `listJobs` is deliberately left hanging FOREVER here. Everything below has
    // to work off storage alone, which is the property that was missing: the
    // stored hint records the level, so attaching needs no discovery at all.
    listJobs.mockImplementation(() => new Promise(() => undefined));
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
    attachAnalysis.mockImplementation(() => new Promise(() => undefined));

    const view = render(
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );

    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    // Rejoined at the level STORAGE remembered, with no discovery answer at all.
    expect(attachAnalysis.mock.calls[0][0]).toMatchObject({
      gameId: ROOM_ID,
      expectedRevision: 7,
      level: "quick",
    });
    expect(screen.getByText(/กำลังเชื่อมต่องานวิเคราะห์เดิม/)).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect((view.container.querySelector(".bot-thinking-fill") as HTMLElement).style.width).toBe(
      "50%",
    );
    // And the Analyze button was never offered back for work still running.
    expect(screen.queryByRole("button", { name: /วิเคราะห์ตานี้/ })).not.toBeInTheDocument();
  });

  it("drops a restored hint the server turns out not to have", async () => {
    // The other half. A hint is evidence, not authority: rejoining it must not
    // be able to leave a phantom bar filling for a search that finished, aged
    // out, or never existed. The attach IS the confirmation, and `idle` retires
    // the session — which is also what puts the Analyze button back honestly.
    listJobs.mockImplementation(() => new Promise(() => undefined));
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
    attachAnalysis.mockResolvedValue({ kind: "idle" } satisfies SseOutcome<AnalysisResult>);

    render(<AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
    expect(engineSessions.analysisFor(ROOM_ID, 7)).toBeUndefined();
    // Retired from storage too, so the next mount does not resurrect it.
    expect(engineSessions.restoreHints(ROOM_ID)).toEqual([]);
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
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    report({ phase: "sim", percent: 20, elapsedMs: 1_000, etaMs: 4_000, detail: "samples=1/4" });
    await waitFor(() => expect(screen.getByText(/20%/)).toBeInTheDocument());

    // Leave Play. React throws the tree away; the search does not notice.
    view.unmount();
    report({ phase: "sim", percent: 71, elapsedMs: 4_000, etaMs: 1_000, detail: "samples=3/4" });

    // Come back.
    render(<AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />);
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
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));

    view.unmount();
    finish({ kind: "result", result: analysisAt(7) });
    await Promise.resolve();

    render(<AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />);
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

    render(<AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />);

    // It reconnected rather than starting a new search.
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));
    expect(attachAnalysis.mock.calls[0][0]).toMatchObject({
      gameId: ROOM_ID,
      expectedRevision: 7,
      level: "quick",
    });
    await waitFor(() => expect(screen.getByText("A summary.")).toBeInTheDocument());
  });

  it("survives a mount whose revision is briefly a turn behind", async () => {
    // The bug this exists to prevent, and it is subtle enough to have shipped
    // once already: a returning mount is seeded from the snapshot cache, and
    // that seed can be one revision behind the server for the moment before
    // reconcile corrects it. When the panel acted on that number it dropped the
    // live session — permanently. Correcting the revision a moment later cannot
    // resurrect an observation that has been thrown away, so the bar went out
    // and stayed out.
    //
    // Retiring work now belongs to the shell, which only acts on a CONFIRMED
    // revision. A component that is merely handed the wrong number stops
    // DISPLAYING, which is reversible.
    let report!: (progress: {
      phase: string;
      percent: number;
      elapsedMs: number;
      etaMs: number;
      detail: string;
    }) => void;
    requestAnalysis.mockImplementation(
      (options: { onProgress?: (progress: never) => void }) =>
        new Promise<never>(() => {
          report = options.onProgress as typeof report;
        }),
    );
    void engineSessions.startAnalysis({ roomId: ROOM_ID, revision: 7, level: "quick" });
    report({ phase: "sim", percent: 42, elapsedMs: 1_000, etaMs: 1_000, detail: "samples=2/4" });

    const view = render(
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );
    await waitFor(() => expect(screen.getByText(/42%/)).toBeInTheDocument());

    // Leave, and come back onto a seed that lags by one.
    view.unmount();
    const back = render(
      <AnalysisSurface roomId={ROOM_ID} revision={6} playerName="Player" disabled={false} />,
    );
    await Promise.resolve();
    // Reconcile corrects the revision.
    back.rerender(
      <AnalysisSurface roomId={ROOM_ID} revision={7} playerName="Player" disabled={false} />,
    );

    expect(engineSessions.analysisFor(ROOM_ID, 7)).toBeDefined();
    expect(screen.getByText(/42%/)).toBeInTheDocument();
  });

  it("rejoins a search whose stream died while the tab was in the background", async () => {
    // The reported bug, and the reason it was so hard to see: nothing in the
    // client drops the session, so the tab switch itself is innocent. What
    // happens is that Chrome freezes a backgrounded tab and the SSE stream dies
    // with it. That is `offline`, the one failure the player is explicitly
    // promised recovery from — "ระบบจะเชื่อมต่องานเดิมให้อัตโนมัติเมื่อกลับมา".
    //
    // The promise could not be kept. A settled session stays in the map forever,
    // and discovery skips every key the map already holds, so the still-running
    // job on the server was permanently invisible to `GET /jobs`. The player got
    // the plain Analyze button back and paying again was the only way forward.
    //
    // Note it never reproduced after a refresh: `persist` stores only pending
    // sessions, so a reload cleared the tombstone. It needed the module to
    // SURVIVE — which is exactly what switching tabs does.
    let fail!: (error: unknown) => void;
    requestAnalysis.mockImplementation(
      () =>
        new Promise<never>((_resolve, reject) => {
          fail = reject;
        }),
    );
    void engineSessions.startAnalysis({ roomId: ROOM_ID, revision: 7, level: "quick" });
    const view = render(
      <AnalysisSurface
        roomId={ROOM_ID}
        revision={7}
        playerName="Player"
        disabled={false}
        reconnectEpoch={0}
      />,
    );

    // The tab is frozen; the connection goes, and the one immediate re-attach
    // fires while the tab is still away, so it finds nothing.
    attachAnalysis.mockResolvedValue({ kind: "idle" } satisfies SseOutcome<AnalysisResult>);
    fail(new EngineApiError("offline", "The engine connection was lost."));
    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(1));

    // The player comes back. The search never stopped: the server has it at 60%.
    listJobs.mockResolvedValue(runningJob("quick", 60));
    attachAnalysis.mockImplementation(() => new Promise(() => undefined));
    view.rerender(
      <AnalysisSurface
        roomId={ROOM_ID}
        revision={7}
        playerName="Player"
        disabled={false}
        reconnectEpoch={1}
      />,
    );

    await waitFor(() => expect(attachAnalysis).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/60%/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /วิเคราะห์ตานี้/ })).not.toBeInTheDocument();
  });

  it("leaves a refused search refused instead of re-attaching to it", async () => {
    // The other half of the rule. Only a LOST VIEW is reclaimable. A search the
    // server turned down has an answer, and reconnecting to it in a loop would
    // replace a clear message with a bar that never fills.
    requestAnalysis.mockRejectedValue(
      new EngineApiError("budget_exhausted", "Out of analysis budget."),
    );
    void engineSessions.startAnalysis({ roomId: ROOM_ID, revision: 7, level: "quick" });
    const view = render(
      <AnalysisSurface
        roomId={ROOM_ID}
        revision={7}
        playerName="Player"
        disabled={false}
        reconnectEpoch={0}
      />,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    listJobs.mockResolvedValue(runningJob("quick", 60));
    view.rerender(
      <AnalysisSurface
        roomId={ROOM_ID}
        revision={7}
        playerName="Player"
        disabled={false}
        reconnectEpoch={1}
      />,
    );
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    expect(attachAnalysis).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not reconnect to an analysis from a different revision", async () => {
    // Discovery is revision-scoped on the server, so a job for revision 7 is
    // simply not among the answers for revision 9.
    listJobs.mockResolvedValue([]);
    render(<AnalysisSurface roomId={ROOM_ID} revision={9} playerName="Player" disabled={false} />);
    await waitFor(() => expect(listJobs).toHaveBeenCalled());
    expect(listJobs.mock.calls[0][0]).toMatchObject({ revision: 9 });
    expect(attachAnalysis).not.toHaveBeenCalled();
  });
});
