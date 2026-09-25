// Importing a board into Study, end to end, with fake evidence in place of a
// recogniser.
//
// The claim being tested is the architectural one: vision is an INPUT ADAPTER.
// A board that arrives as evidence, is verified and confirmed, must continue
// through the ordinary wizard and reach the engine as exactly the request the
// same board typed by hand produces.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boardEvidenceFromFixture } from "../src/features/boardVision/evidence";
import type { BoardEvidenceSource } from "../src/features/boardVision/types";
import sampleBoard from "../src/features/boardVision/fixtures/sampleBoard.json";

const { listStudyRecords, deleteStudyRecord, requestStudyAnalysis, sources } = vi.hoisted(() => ({
  listStudyRecords: vi.fn(),
  deleteStudyRecord: vi.fn(),
  requestStudyAnalysis: vi.fn(),
  sources: { current: [] as BoardEvidenceSource[] },
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

// The producers are the one thing replaced: the image entry is wired to the
// fixture, which is exactly how V1 will connect a real one.
vi.mock("../src/components/pages/study/boardEvidenceSources", () => ({
  get BOARD_EVIDENCE_SOURCES() {
    return sources.current;
  },
  isSourceShown: (source: BoardEvidenceSource) => Boolean(source.produce),
}));

import { StudyPage } from "../src/components/pages/study/StudyPage";

const imageSource = (fixture: unknown): BoardEvidenceSource => ({
  id: "image",
  label: "นำเข้าจากรูป",
  produce: async () => boardEvidenceFromFixture(fixture),
});

const cellsOf = (container: HTMLElement) =>
  container.querySelectorAll<HTMLButtonElement>(".board-cell");

type User = ReturnType<typeof userEvent.setup>;

/** Rack, review, level — the rest of the wizard, the same for both routes. */
async function analyseWithRack(user: User) {
  await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
  await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
  await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
  await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
  await user.click(screen.getByRole("button", { name: /Fast/ }));
  await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalled());
  return requestStudyAnalysis.mock.calls.at(-1)?.[0] as Record<string, unknown>;
}

/** Open one square in the verification view and give it a face. */
async function chooseFace(
  user: User,
  container: HTMLElement,
  row: number,
  col: number,
  face: string,
) {
  await user.click(cellsOf(container)[row * 15 + col]!);
  const inspector = screen.getByRole("region", { name: `ช่อง R${row + 1} C${col + 1}` });
  await user.click(
    within(within(inspector).getByRole("group", { name: "วางเป็น" })).getByRole("button", {
      name: face,
    }),
  );
}

// These walk the whole page, twice in one case, and share the machine with
// every other suite; the default 5 s is tight for that under full parallel load.
describe("importing a board into Study", { timeout: 20_000 }, () => {
  afterEach(cleanup);

  beforeEach(() => {
    window.location.hash = "#/study";
    vi.clearAllMocks();
    listStudyRecords.mockResolvedValue([]);
    requestStudyAnalysis.mockResolvedValue({
      recordId: "study-1",
      saveError: null,
      level: "medium",
      position: {
        scoreSelf: 0,
        scoreOpponent: 0,
        board: [],
        rack: ["1"],
        oppRackCount: 8,
        bagCount: 77,
      },
      summary: "",
      method: null,
      candidates: [],
    });
    sources.current = [imageSource(sampleBoard)];
  });

  it("shows no import entry at all when no producer exists", () => {
    sources.current = [
      { id: "image", label: "นำเข้าจากรูป" },
      { id: "camera", label: "สแกนด้วยกล้อง" },
    ];
    render(<StudyPage />);
    expect(screen.queryByRole("group", { name: "นำเข้ากระดาน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /นำเข้าจากรูป/ })).not.toBeInTheDocument();
  });

  it("sends the same request for an imported board as for the same board typed by hand", async () => {
    const user = userEvent.setup({ delay: null });

    // ── A: typed, with the editor's own keys ──────────────────────────────
    const typed = render(<StudyPage />);
    const cells = cellsOf(typed.container);
    const type = (key: string, code: string, shiftKey = false) =>
      fireEvent.keyDown(window, { key, code, shiftKey });

    await user.click(cells[7 * 15 + 5]!); // → across row 8
    type("8", "Digit8");
    type("X", "KeyX", true); // ×/÷ tile, as ×
    type("3", "Digit3");
    type("=", "Equal");
    type("2", "Digit2");
    type("4", "Digit4");

    await user.click(cells[3 * 15 + 7]!);
    await user.click(cells[3 * 15 + 7]!); // ↓ down column 8
    type("b", "KeyB");
    type("2", "Digit2"); // blank, as 2
    type("P", "KeyP", true); // ± tile, as +
    type("1", "Digit1");
    type("=", "Equal");

    await user.click(cells[3 * 15 + 9]!);
    await user.click(cells[3 * 15 + 9]!); // ↓ down column 10
    type("t", "KeyT"); // 20
    type("/", "Slash");
    type(")", "Digit0", true); // 10
    type("=", "Equal");

    const typedRequest = await analyseWithRack(user);
    typed.unmount();

    // ── B: imported, verified, confirmed ──────────────────────────────────
    const imported = render(<StudyPage />);
    await user.click(screen.getByRole("button", { name: /นำเข้าจากรูป/ }));
    await screen.findByRole("region", { name: "ตรวจกระดานที่นำเข้า" });
    const confirm = screen.getByRole("button", { name: "ใช้กระดานนี้" });
    expect(confirm).toBeDisabled();

    await chooseFace(user, imported.container, 3, 7, "2");
    await chooseFace(user, imported.container, 4, 7, "+");
    expect(confirm).toBeDisabled();
    await chooseFace(user, imported.container, 7, 6, "×");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    // Back in the ordinary editor, holding the imported board.
    expect(screen.queryByRole("region", { name: "ตรวจกระดานที่นำเข้า" })).not.toBeInTheDocument();
    expect(imported.container.querySelectorAll(".board-cell.filled")).toHaveLength(14);
    expect(imported.container.querySelectorAll(".board-cell.marked")).toHaveLength(0);

    const importedRequest = await analyseWithRack(user);

    // Everything that goes on the wire. The lifecycle callbacks are each
    // page instance's own state setters, so they are not comparable.
    const wire = (request: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(request).filter(([, value]) => typeof value !== "function"),
      );
    expect(Object.keys(wire(typedRequest)).sort()).toEqual([
      "board",
      "level",
      "rack",
      "scoreOpponent",
      "scoreSelf",
    ]);
    expect(wire(importedRequest)).toEqual(wire(typedRequest));
    expect(importedRequest.board).toEqual([
      { r: 3, c: 7, kind: "?", token: "2" },
      { r: 3, c: 9, kind: "20", token: "20" },
      { r: 4, c: 7, kind: "+/-", token: "+" },
      { r: 4, c: 9, kind: "/", token: "/" },
      { r: 5, c: 7, kind: "1", token: "1" },
      { r: 5, c: 9, kind: "10", token: "10" },
      { r: 6, c: 7, kind: "=", token: "=" },
      { r: 6, c: 9, kind: "=", token: "=" },
      { r: 7, c: 5, kind: "8", token: "8" },
      { r: 7, c: 6, kind: "x//", token: "×" },
      { r: 7, c: 7, kind: "3", token: "3" },
      { r: 7, c: 8, kind: "=", token: "=" },
      { r: 7, c: 9, kind: "2", token: "2" },
      { r: 7, c: 10, kind: "4", token: "4" },
    ]);
  });

  it("opens the alternatives instead of removing the tile, and lets one be chosen", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    await user.click(screen.getByRole("button", { name: /นำเข้าจากรูป/ }));
    await screen.findByRole("region", { name: "ตรวจกระดานที่นำเข้า" });

    const eight = () => cellsOf(container)[7 * 15 + 5]!;
    expect(eight().className).toContain("mark-caution");
    expect(cellsOf(container)[3 * 15 + 7]!.className).toContain("mark-danger");

    await user.click(eight());
    // Still there: in verification a tap inspects, it does not erase.
    expect(eight().className).toContain("filled");
    const inspector = screen.getByRole("region", { name: "ช่อง R8 C6" });
    const options = within(within(inspector).getByRole("group", { name: "ระบบเห็นเป็น" }))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(options).toEqual(["8 51%", "3 31%", "9 12%", "ว่าง 2%", "ลบเบี้ย"]);
    expect(within(inspector).getByRole("button", { name: "8 51%" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Typing does nothing while verifying — it would edit the hidden editor.
    fireEvent.keyDown(window, { key: "5", code: "Digit5" });

    await user.click(within(inspector).getByRole("button", { name: "3 31%" }));
    expect(within(inspector).getByRole("button", { name: "3 31%" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A person's choice is no longer "uncertain"; the square is now only selected.
    await user.click(within(inspector).getByRole("button", { name: "ปิด" }));
    expect(eight().className).not.toContain("marked");
  });

  it("blocks confirmation while the set is overspent, and not after it is fixed", async () => {
    sources.current = [
      imageSource({
        format: "eq-lab/board-evidence-fixture@1",
        cells: [0, 1, 2, 3, 4].map((c) => ({
          r: 7,
          c,
          p: c === 4 ? { "9": 0.7, "6": 0.3 } : { "9": 0.99 },
        })),
      }),
    ];
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    await user.click(screen.getByRole("button", { name: /นำเข้าจากรูป/ }));
    await screen.findByRole("region", { name: "ตรวจกระดานที่นำเข้า" });

    expect(screen.getByText("9 มี 5 ตัว แต่ชุดเบี้ยมีแค่ 4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ใช้กระดานนี้" })).toBeDisabled();

    await user.click(cellsOf(container)[7 * 15 + 4]!);
    await user.click(screen.getByRole("button", { name: "6 30%" }));
    expect(screen.getByRole("button", { name: "ใช้กระดานนี้" })).toBeEnabled();
  });

  it("leaves the board being typed alone when an import is cancelled", async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<StudyPage />);
    await user.click(cellsOf(container)[7 * 15 + 7]!);
    fireEvent.keyDown(window, { key: "5", code: "Digit5" });

    await user.click(screen.getByRole("button", { name: /นำเข้าจากรูป/ }));
    await screen.findByRole("region", { name: "ตรวจกระดานที่นำเข้า" });
    await user.click(screen.getByRole("button", { name: /ยกเลิกการนำเข้า/ }));

    const filled = container.querySelectorAll(".board-cell.filled");
    expect(filled).toHaveLength(1);
    expect(filled[0]).toBe(cellsOf(container)[7 * 15 + 7]);
  });
});

describe("which import entries are drawn", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("hides a producer that does not exist in production, and shows one that does", async () => {
    const { isSourceShown } = await vi.importActual<
      typeof import("../src/components/pages/study/boardEvidenceSources")
    >("../src/components/pages/study/boardEvidenceSources");
    vi.stubEnv("DEV", false);
    expect(isSourceShown({ id: "image", label: "นำเข้าจากรูป" })).toBe(false);
    expect(isSourceShown(imageSource(sampleBoard))).toBe(true);
    vi.stubEnv("DEV", true);
    expect(isSourceShown({ id: "image", label: "นำเข้าจากรูป" })).toBe(true);
  });
});
