// "Why did the bot play that?" — the panel behind the 🧠 button.
//
// The bug this file pins down: the panel rendered from the MOVE response, and
// the move response carries the move alone. So every number in it was a
// zero nobody computed — value 0.00, "0 alternatives considered" — and the
// ranking table did not render at all. Pressing the button opened an empty box.
//
// The ranking now comes from the engine service, a page at a time. What is
// asserted here is that the panel (a) shows the real ranking, (b) asks for one
// page rather than the whole report, (c) never re-reads a page it already has,
// and (d) says plainly when there is nothing to show instead of printing zeros.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchBotReasoning } = vi.hoisted(() => ({ fetchBotReasoning: vi.fn() }));

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, fetchBotReasoning, isEngineApiConfigured: true };
});

import { toBotResponse } from "../src/bot/botController";
import { EngineApiError, type BotReasoningPage } from "../src/bot/engineApi";
import { BotReasoningPanel } from "../src/components/game/BotReasoningPanel";

const ROOM_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const REVISION = 7;

afterEach(cleanup);
beforeEach(() => {
  fetchBotReasoning.mockReset();
});

/** Exactly what the server sends back for a bot move: the move, and no
 *  evaluation detail whatsoever. */
function movePlayed() {
  return toBotResponse({
    revision: REVISION,
    gameId: ROOM_ID,
    side: "B",
    move: {
      type: "place",
      placements: [{ r: 7, c: 7, kind: "5", token: "5" }],
      exchange: [],
      score: 24,
    },
    solver: "sim",
    endgameSolved: false,
    stats: { elapsedMs: 3400, nodes: 91234, samples: 12 },
  });
}

function candidate(index: number, chosen = false) {
  return {
    type: "place" as const,
    placements: [{ r: 7, c: 7 + index, kind: "5", token: "5" }],
    exchange: [],
    score: 30 - index,
    scoreComp: 30 - index,
    leave: 8.5 - index,
    potential: 6.2,
    oppReply: 12.1,
    mean: 26.6 - index,
    stddev: 3.2,
    value: 24.1 - index,
    chosen,
  };
}

/** One page of a 20-row ranking, as the endpoint serves it. */
function pageAt(offset: number, limit = 6, total = 20): BotReasoningPage {
  return {
    gameId: ROOM_ID,
    revision: REVISION,
    side: "B",
    difficulty: "medium",
    solver: "sim",
    endgameSolved: false,
    score: 24,
    equity: 31.5,
    stats: { moves: 410, nodes: 91234, elapsedMs: 3400, candidates: 20, samples: 12 },
    page: { offset, limit, total },
    candidates: Array.from({ length: Math.min(limit, total - offset) }, (_, i) =>
      candidate(offset + i, offset + i === 0),
    ),
    chosenIndex: 0,
    chosen: candidate(0, true),
    runnerUp: candidate(1),
  };
}

function open(response = movePlayed()) {
  return render(
    <BotReasoningPanel
      gameId={ROOM_ID}
      playerName="Aether"
      turnNumber={4}
      response={response}
      onClose={() => {}}
    />,
  );
}

const rows = () => document.querySelectorAll(".bot-reason-table tbody tr");

describe("the bot reasoning panel", () => {
  it("reads the ranking the move response does not carry", async () => {
    fetchBotReasoning.mockResolvedValue(pageAt(0));
    open();

    await waitFor(() => expect(rows()).toHaveLength(6));
    // Asked for ONE page, about the revision the move was computed for.
    expect(fetchBotReasoning).toHaveBeenCalledTimes(1);
    expect(fetchBotReasoning.mock.calls[0][0]).toMatchObject({
      gameId: ROOM_ID,
      revision: REVISION,
      offset: 0,
      limit: 6,
    });
    // The engine's real numbers, where zeros used to be.
    expect(screen.getByText("31.50")).toBeInTheDocument();
    expect(screen.getByText("20 ทาง")).toBeInTheDocument();
    expect(screen.getByText("อันดับ 1–6 จาก 20")).toBeInTheDocument();
  });

  it("prints no number the move response never carried", async () => {
    // The regression itself: while the report is still loading there is no
    // equity and no candidate count, and inventing 0 for either states a
    // measurement that was never taken.
    fetchBotReasoning.mockReturnValue(new Promise(() => {}));
    open();

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0.00")).toBeNull();
    expect(screen.queryByText("0 ทาง")).toBeNull();
    // The counts the move response DOES carry are still shown, not blanked.
    expect(screen.getByText("91,234")).toBeInTheDocument();
    expect(screen.getByText("3.4s")).toBeInTheDocument();
  });

  it("explains the choice against the runner-up", async () => {
    fetchBotReasoning.mockResolvedValue(pageAt(0));
    open();

    const verdict = await screen.findByText(/สูงกว่าอันดับ 2/);
    expect(verdict).toHaveTextContent("24.10");
    // chosen 24.1 vs runner-up 23.1
    expect(verdict).toHaveTextContent("1.00");
  });

  it("pages forward without asking for the whole report", async () => {
    fetchBotReasoning.mockImplementation(({ offset }: { offset: number }) =>
      Promise.resolve(pageAt(offset)),
    );
    open();
    await waitFor(() => expect(rows()).toHaveLength(6));

    await userEvent.click(screen.getByRole("button", { name: /ถัดไป/ }));

    await screen.findByText("อันดับ 7–12 จาก 20");
    expect(fetchBotReasoning).toHaveBeenCalledTimes(2);
    expect(fetchBotReasoning.mock.calls[1][0]).toMatchObject({ offset: 6, limit: 6 });
    // Ranks are positions in the whole ranking, not in the page.
    expect(within(rows()[0] as HTMLElement).getByText("7")).toBeInTheDocument();
  });

  it("does not re-read a page it already holds", async () => {
    fetchBotReasoning.mockImplementation(({ offset }: { offset: number }) =>
      Promise.resolve(pageAt(offset)),
    );
    open();
    await waitFor(() => expect(rows()).toHaveLength(6));

    await userEvent.click(screen.getByRole("button", { name: /ถัดไป/ }));
    await screen.findByText("อันดับ 7–12 จาก 20");
    await userEvent.click(screen.getByRole("button", { name: /ก่อนหน้า/ }));
    await screen.findByText("อันดับ 1–6 จาก 20");

    expect(fetchBotReasoning).toHaveBeenCalledTimes(2);
  });

  it("stops at the ends of the ranking", async () => {
    fetchBotReasoning.mockResolvedValue(pageAt(18, 6, 20));
    open();
    await waitFor(() => expect(rows()).toHaveLength(2));

    expect(screen.getByRole("button", { name: /ถัดไป/ })).toBeDisabled();
    expect(screen.getByText("อันดับ 19–20 จาก 20")).toBeInTheDocument();
  });

  it("says the reasoning has expired rather than showing an empty table", async () => {
    fetchBotReasoning.mockRejectedValue(new EngineApiError("reasoning_unavailable", "gone"));
    open();

    expect(
      await screen.findByText(/ไม่ได้เก็บรายละเอียดการคิดของตานี้ไว้แล้ว/),
    ).toBeInTheDocument();
    expect(rows()).toHaveLength(0);
    expect(screen.queryByText("0.00")).toBeNull();
  });

  it("retries the page the player was on", async () => {
    fetchBotReasoning
      .mockRejectedValueOnce(new EngineApiError("offline", "no"))
      .mockResolvedValueOnce(pageAt(0));
    open();

    await userEvent.click(await screen.findByRole("button", { name: "ลองใหม่" }));
    await waitFor(() => expect(rows()).toHaveLength(6));
  });
});

describe("the move response itself", () => {
  it("carries no invented evaluation numbers", () => {
    const response = movePlayed();
    // Absent, not zero. A zero here is a claim; absence is the truth.
    expect(response.equity).toBeUndefined();
    expect(response.stats.candidates).toBeUndefined();
    expect(response.stats.moves).toBeUndefined();
    // What the server really does send survives untouched.
    expect(response.stats).toMatchObject({ nodes: 91234, elapsedMs: 3400, samples: 12 });
    expect(response.revision).toBe(REVISION);
  });
});
