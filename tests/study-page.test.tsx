// The Study wizard, walked the way a player walks it.
//
// The flow is the feature: board → rack → review → level → answer. What these
// tests pin is that each gate actually gates (you cannot analyse a position you
// have not finished describing), and that what reaches the engine is the
// position that was typed — because a wizard that quietly sends something else
// is worse than no wizard.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listStudyRecords, deleteStudyRecord, requestStudyAnalysis } = vi.hoisted(() => ({
  listStudyRecords: vi.fn(),
  deleteStudyRecord: vi.fn(),
  requestStudyAnalysis: vi.fn(),
}));

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ configured: true, profile: { display_name: "Ada" }, userId: "user-1" }),
}));

vi.mock("../src/features/study/repository", () => ({ listStudyRecords, deleteStudyRecord }));

vi.mock("../src/bot/engineApi", async () => {
  const actual =
    await vi.importActual<typeof import("../src/bot/engineApi")>("../src/bot/engineApi");
  return { ...actual, isEngineApiConfigured: true, requestStudyAnalysis };
});

import { StudyPage } from "../src/components/pages/study/StudyPage";

function answer(overrides: Record<string, unknown> = {}) {
  return {
    recordId: "study-1",
    saveError: null,
    level: "max",
    position: {
      scoreSelf: 12,
      scoreOpponent: 0,
      board: [],
      rack: ["1"],
      oppRackCount: 8,
      bagCount: 83,
    },
    summary: "ตาที่ดีที่สุดคือวาง 1+2=3",
    method: {
      solver: "sim" as const,
      samples: 160,
      legalMoves: 84,
      candidatesEvaluated: 60,
      nodes: 1200,
      elapsedMs: 4200,
      proven: false,
      complete: true,
    },
    candidates: [
      {
        rank: 1,
        kind: "place" as const,
        placements: [{ r: 7, c: 7, kind: "1", token: "1" }],
        exchange: [],
        immediateScore: 6,
        evaluation: 9.5,
        evaluationGap: 0,
        factors: [],
        provenMargin: null,
        recommended: true,
        note: "",
      },
    ],
    ...overrides,
  };
}

describe("Study wizard", () => {
  // `delay: null` removes user-event's inter-keystroke wait. These render the
  // whole page for every step, and the default delay made them the slowest
  // files in the suite — slow enough to trip `waitFor` when the machine was
  // also running lint.
  // This suite does not run with vitest globals, so testing-library's automatic
  // cleanup never registers and each render would stack on the last one.
  afterEach(cleanup);

  beforeEach(() => {
    window.location.hash = "#/study";
    vi.clearAllMocks();
    listStudyRecords.mockResolvedValue([]);
    requestStudyAnalysis.mockResolvedValue(answer());
  });

  it("will not let a position be analysed before the rack is chosen", async () => {
    const user = userEvent.setup({ delay: null });
    render(<StudyPage />);

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    // The rack step's own gate: no tiles, no confirmation.
    expect(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" })).toBeDisabled();
  });

  it("sends the position that was typed, and shows the ranking that comes back", async () => {
    const user = userEvent.setup({ delay: null });
    render(<StudyPage />);

    const selfScore = screen.getByLabelText("แต้มของคุณ");
    await user.clear(selfScore);
    await user.type(selfScore, "12");

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));

    // Rack: two tiles from the palette.
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: /^\+ เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));

    // Review names the derived inventory, which the player never types.
    expect(screen.getByText("คู่แข่งถือ")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));

    await user.click(screen.getByRole("button", { name: /Unlimited/ }));

    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalledTimes(1));
    const sent = requestStudyAnalysis.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.scoreSelf).toBe(12);
    expect(sent.rack).toEqual(["1", "+"]);
    expect(sent.level).toBe("super");
    // The client sends no inventory: deriving it is the server's job, and a
    // client that sent one could describe a bag that cannot exist.
    expect(sent).not.toHaveProperty("bagCount");
    expect(sent).not.toHaveProperty("oppRackCount");

    await waitFor(() => expect(screen.getByText(/บันทึก 10 อันดับแรก/)).toBeInTheDocument());
    expect(screen.getByText("บอทเลือกตานี้")).toBeInTheDocument();
  });

  it("places at the cursor, from the palette and from the keyboard alike", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);

    // Board cells carry no accessible name of their own, so they are addressed
    // positionally — row 7, column 7 is H8, the star.
    const cells = container.querySelectorAll<HTMLButtonElement>(".board-cell");
    expect(cells.length).toBe(15 * 15);

    // Nothing lands until there is a cursor.
    await user.click(screen.getByRole("button", { name: /^= เหลือ/ }));
    expect(container.querySelectorAll(".board-cell.filled").length).toBe(0);

    // Click sets the cursor; the palette then drops a tile on it.
    await user.click(cells[7 * 15 + 7]!);
    await user.click(screen.getByRole("button", { name: /^= เหลือ/ }));

    // The cursor advanced one square to the right, and typing lands there.
    fireEvent.keyDown(window, { key: "5", code: "Digit5" });
    // Shift+1 is eleven, matched on the physical key so the layout cannot
    // change what it means.
    fireEvent.keyDown(window, { key: "!", code: "Digit1", shiftKey: true });

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Fast/ }));

    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalledTimes(1));
    const sent = requestStudyAnalysis.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.board).toEqual([
      { r: 7, c: 7, kind: "=", token: "=" },
      { r: 7, c: 8, kind: "5", token: "5" },
      { r: 7, c: 9, kind: "11", token: "11" },
    ]);
  });

  it("cycles the cursor direction when the same square is clicked again", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    const cells = container.querySelectorAll<HTMLButtonElement>(".board-cell");

    await user.click(cells[7 * 15 + 7]!);
    expect(cells[7 * 15 + 7]!.className).toContain("cursor-right");
    await user.click(cells[7 * 15 + 7]!);
    expect(cells[7 * 15 + 7]!.className).toContain("cursor-down");

    // Right → down → left → up → off.
    await user.click(cells[7 * 15 + 7]!);
    await user.click(cells[7 * 15 + 7]!);
    await user.click(cells[7 * 15 + 7]!);
    expect(cells[7 * 15 + 7]!.className).not.toContain("cursor");
  });

  it("re-aims the cursor with Space, so the next tiles run downwards", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    const cells = container.querySelectorAll<HTMLButtonElement>(".board-cell");

    await user.click(cells[7 * 15 + 7]!);
    fireEvent.keyDown(window, { key: "5", code: "Digit5" });
    // One tap swaps the two directions a player actually alternates between.
    // The cursor is already parked on the next square, so the re-aim only shows
    // on the tile AFTER this one — which is what makes the third tile the
    // assertion that matters.
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "6", code: "Digit6" });
    fireEvent.keyDown(window, { key: "7", code: "Digit7" });

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Fast/ }));

    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalledTimes(1));
    const sent = requestStudyAnalysis.mock.calls[0]?.[0] as Record<string, unknown>;
    // 5 at H8, cursor advances right to I8, 6 lands there — then the re-aimed
    // cursor steps DOWN, so the 7 is directly below the 6 rather than beside it.
    expect(sent.board).toEqual([
      { r: 7, c: 7, kind: "5", token: "5" },
      { r: 7, c: 8, kind: "6", token: "6" },
      { r: 8, c: 8, kind: "7", token: "7" },
    ]);
  });

  it("places a blank wearing the face typed after B", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    const cells = container.querySelectorAll<HTMLButtonElement>(".board-cell");
    await user.click(cells[7 * 15 + 7]!);

    fireEvent.keyDown(window, { key: "b", code: "KeyB" });
    // Armed state is visible: a modal prefix that says nothing is a trap.
    expect(screen.getByText(/Blank พร้อมแล้ว/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "7", code: "Digit7" });
    expect(screen.queryByText(/Blank พร้อมแล้ว/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Fast/ }));

    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalledTimes(1));
    const sent = requestStudyAnalysis.mock.calls[0]?.[0] as Record<string, unknown>;
    // The physical tile is the blank; the face it is played as is the 7.
    expect(sent.board).toEqual([{ r: 7, c: 7, kind: "?", token: "7" }]);
  });

  it("takes the step forward on Enter, but only when it is ready", async () => {
    render(<StudyPage />);
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" })).toBeInTheDocument();

    // The rack is empty, so Enter must not carry on past it.
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "9", code: "Digit9" });
    fireEvent.keyDown(window, { key: "Enter", code: "Enter" });
    expect(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ })).toBeInTheDocument();
  });

  it("types tiles straight onto the rack", async () => {
    const user = userEvent.setup({ delay: null });
    render(<StudyPage />);
    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));

    fireEvent.keyDown(window, { key: "7", code: "Digit7" });
    // Shift + an operator letter is the two-faced tile; in hand it is just that
    // tile, with no face.
    fireEvent.keyDown(window, { key: "X", code: "KeyX", shiftKey: true });
    // B arms the blank; a second B puts a bare one in hand.
    fireEvent.keyDown(window, { key: "b", code: "KeyB" });
    fireEvent.keyDown(window, { key: "b", code: "KeyB" });

    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Fast/ }));

    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalledTimes(1));
    const sent = requestStudyAnalysis.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent.rack).toEqual(["7", "x//", "?"]);
  });

  it("still shows the ranking when the server could not save it", async () => {
    requestStudyAnalysis.mockResolvedValue(
      answer({ recordId: null, saveError: "database unavailable" }),
    );
    const user = userEvent.setup({ delay: null });
    render(<StudyPage />);

    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Deep/ }));

    await waitFor(() => expect(screen.getByText(/บันทึกลงฐานข้อมูลไม่สำเร็จ/)).toBeInTheDocument());
    expect(screen.getByText("บอทเลือกตานี้")).toBeInTheDocument();
  });

  it("lists what has already been analysed", async () => {
    listStudyRecords.mockResolvedValue([
      {
        id: "record-1",
        createdAt: "2026-08-20T10:00:00.000Z",
        scoreSelf: 40,
        scoreOpponent: 55,
        board: [{ r: 7, c: 7, kind: "1", token: "1" }],
        rack: ["1", "2"],
        oppRackCount: 8,
        bagCount: 81,
        level: "hard",
        summary: "",
        method: null,
        candidates: [],
      },
    ]);
    render(<StudyPage />);

    const history = await screen.findByRole("region", { name: "โจทย์ที่วิเคราะห์ไว้" });
    expect(within(history).getByText(/1 2 · 40–55/)).toBeInTheDocument();
  });
});
