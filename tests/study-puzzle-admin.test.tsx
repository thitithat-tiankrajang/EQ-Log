import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudyPuzzleAdminPanel } from "../src/components/admin/StudyPuzzleAdminPanel";
import { reasonText } from "../src/components/admin/studyPuzzleLabels";
import { equationOf, placeOf } from "../src/components/admin/StudyPuzzleSetViewer";
import type {
  AttemptRecord,
  LegacyPuzzle,
  LegacySet,
  PuzzleRecord,
  SetSummary,
  SetV2,
  StudyPuzzleJob,
  StudyPuzzleSource,
  StudyPuzzleStatus,
} from "../src/features/studyPuzzles/api";
import { parseStudyPuzzleRoomId } from "../src/features/studyPuzzles/play";
import { AMATH_TOKENS, type AmathToken } from "../src/game";
import { parseHash, routeToHash } from "../src/router";
// The generator's own normaliser: what the dev API files and the generator runs.
import { configDrift } from "../tools/study-puzzles/lib/config.mjs";
// Real output of amath-engine's Find Best Play generator (two puzzles) — a v1 set.
import generated from "./fixtures/study-puzzles/find-best-play.json";
// Real output of tools/study-puzzles: the targeted HOOK set, as the dev API serves it.
import hookFixture from "./fixtures/study-puzzles/v2-hook-set.json";
// The "26 Sep" incident: the configuration the admin entered, and the puzzle filed for it.
import observedFixture from "./fixtures/study-puzzles/v2-observed-rack-26sep.json";
// A real CONFIG_GUIDED_RACK puzzle: its constructed rack differs from its source game's.
import guidedFixture from "./fixtures/study-puzzles/v2-specific-rack.json";

const legacyPuzzles = generated.puzzles as LegacyPuzzle[];
const HOOK_SET = hookFixture.set as unknown as SetV2;
const HOOK_ADMIN = hookFixture.admin as unknown as {
  puzzle: PuzzleRecord;
  attempts: AttemptRecord[];
};
const READY = { ready: true, dir: "/engine", problems: [] };

const LEGACY_SUMMARY: SetSummary = {
  id: "set-20260925-073000-abc123",
  version: 1,
  label: "ห้องเรียนวันศุกร์",
  status: "complete",
  createdAt: "2026-09-25T07:30:00.000Z",
  count: 2,
  requested: 2,
  mode: "any",
  scoreRange: [42, 100],
};
const LEGACY_SET: LegacySet = {
  ...LEGACY_SUMMARY,
  version: 1,
  config: { seed: 7, label: "ห้องเรียนวันศุกร์" },
  durationMs: 2100,
  scanned: 4,
  errors: 0,
  puzzles: legacyPuzzles,
};
/** The archive's line for the HOOK set: the set without its manifest. */
const HOOK_SUMMARY = Object.fromEntries(
  Object.entries(HOOK_SET).filter(([key]) => key !== "manifest"),
) as SetSummary;

const COUNTERS = {
  gamesStarted: 3,
  gamesFinished: 2,
  gamesAbandoned: 0,
  positionsInspected: 1234,
  positionsAnalyzed: 1200,
  positionsEligible: 800,
  candidatesEvaluated: 800,
  matchingPositions: 2,
  matched: 1,
  rejectedPositions: 1232,
  rejections: { "bestPlay.moveType": 700, "bestPlay.composition.heavy": 90, "position.opening": 3 },
};

function job(partial: Partial<StudyPuzzleJob>): StudyPuzzleJob {
  return {
    id: "set-20260925-080000-def456",
    state: "running",
    config: { ...HOOK_SET.manifest.config, target: 3, label: "ฮุกห้องเรียน" },
    target: 3,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    finishedAt: null,
    elapsedMs: 65_000,
    matched: 1,
    counters: COUNTERS,
    recent: HOOK_SET.manifest.puzzles,
    logs: [],
    error: null,
    stopRequested: false,
    ...partial,
  };
}

/** An in-memory server; `state` is what the next status call reports. */
function fakeSource(initial: Partial<StudyPuzzleStatus> = {}, sets: SetSummary[] = []) {
  const state: { status: StudyPuzzleStatus; sets: SetSummary[] } = {
    status: { engine: READY, job: null, ...initial },
    sets,
  };
  const source = {
    status: vi.fn(async () => structuredClone(state.status)),
    sets: vi.fn(async () => state.sets),
    set: vi.fn(async (id: string) => (id === LEGACY_SET.id ? LEGACY_SET : HOOK_SET)),
    puzzle: vi.fn(async () => structuredClone(HOOK_ADMIN)),
    verify: vi.fn(async () => ({
      ok: true,
      modes: { seed: { ok: true, turns: 4 }, log: { ok: true, turns: 4 } },
    })),
    play: vi.fn(async () => {
      throw new Error("the admin page never asks for the player view");
    }),
    submit: vi.fn(async () => {
      throw new Error("the admin page never submits");
    }),
    generate: vi.fn(async () => ({ id: "set-new" })),
    cancel: vi.fn(async () => {}),
    fileUrl: (id: string, file: string) => `/files/${id}/${file}`,
  } satisfies StudyPuzzleSource;
  return { state, source };
}

const markedCells = () =>
  [...document.querySelectorAll(".board-cell.mark-selected")].map((cell) => {
    const index = [...document.querySelectorAll(".board-cell")].indexOf(cell);
    return `${Math.floor(index / 15)}:${index % 15}`;
  });
const cellsOf = (placements: { r: number; c: number }[]) =>
  placements.map((cell) => `${cell.r}:${cell.c}`).sort();

describe("Admin → Study puzzles", () => {
  afterEach(cleanup);

  it("names the expected EXTEND shape and keeps contact reasons distinct", () => {
    expect(reasonText("geometry.extend.expected.BOTH")).toBe("รูปแบบ EXTEND ต้องเป็น BOTH");
    expect(reasonText("geometry.extend.headContact")).toBe("คู่สัมผัสด้านหัวไม่ตรง");
  });

  it("is its own admin section", () => {
    expect(parseHash("#/admin/study")).toEqual({ kind: "admin", section: "study" });
    expect(routeToHash({ kind: "admin", section: "study" })).toBe("#/admin/study");
  });

  it("reads a turn as the equation it makes, with its number tiles joined", () => {
    const [first, second] = legacyPuzzles;
    expect(equationOf(first!.board, first!.answer.placements)).toBe("11 - 2 × 12 ÷ 4 = 5");
    expect(equationOf(first!.board, first!.nearBest[1]!.placements)).toBe("11 = 2 × 12 ÷ 4 + 5");
    // The generator's own text for this one is "20 ÷ 1 0 × 5 = 10": `1` and `0` are one number.
    expect(equationOf(second!.board, second!.answer.placements)).toBe("20 ÷ 10 × 5 = 10");
    expect(placeOf(first!.answer.placements)).toBe("R6–R14 · C14");
    expect(placeOf(second!.answer.placements)).toBe("R13 · C3–C9");
  });

  it("says what the engine is missing, and will not start without it", async () => {
    const { source } = fakeSource({
      engine: { ready: false, dir: "/engine", problems: ["ยังไม่ได้ build ตัวตรวจกติกา"] },
    });
    render(<StudyPuzzleAdminPanel source={source} />);
    expect(await screen.findByText(/ยังไม่ได้ build ตัวตรวจกติกา/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มค้นหา" })).toBeDisabled();
  });

  it("searches for exactly what the form says: labels are OR, ranges and tile counts as typed", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    const submit = await screen.findByRole("button", { name: "เริ่มค้นหา" });
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "ต่อ (EXTEND)" }));
    fireEvent.click(screen.getByText("3. รูปแบบการลง"));
    const extend = screen.getByRole("checkbox", { name: /^EXTEND/ });
    const hook = screen.getByRole("checkbox", { name: /^HOOK/ });
    expect(extend).toBeChecked();
    expect(hook).not.toBeChecked();
    expect(screen.queryByText(/HOOK หายาก/)).toBeNull();

    // Several boxes may be ticked; the configuration keeps the canonical order.
    fireEvent.click(hook);
    fireEvent.click(extend);
    fireEvent.click(extend);
    expect(screen.getByText(/HOOK หายาก/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("2. ตาที่ดีที่สุด · เบี้ยที่วางจริง"));
    fireEvent.change(screen.getByLabelText("จำนวนเบี้ยที่ลง ขั้นต่ำ"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("เลข 10–20 (H) ขั้นต่ำ"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("จำนวนข้อที่ต้องการ"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("ชื่อชุด (ไม่บังคับ)"), {
      target: { value: "ต่อและฮุก" },
    });
    fireEvent.click(submit);

    await waitFor(() => expect(source.generate).toHaveBeenCalledTimes(1));
    const [config] = source.generate.mock.calls[0]!;
    const any = { min: null, max: null };
    expect(config).toEqual({
      target: 2,
      label: "ต่อและฮุก",
      seed: expect.any(Number),
      maxPerGame: 1,
      parallelGames: 2,
      search: { strategy: "GUIDED", rackBudget: 24 },
      position: { boardTiles: { min: 12, max: 65 } },
      bestPlay: {
        score: { min: 40, max: null },
        tiles: { min: 5, max: null },
        equations: any,
        moveTypes: ["EXTEND", "HOOK"],
        composition: {
          digit: any,
          heavy: { min: 1, max: null },
          operator: any,
          choice: any,
          equals: any,
          blank: any,
          arithmetic: any,
          operatorLike: any,
        },
        specific: {},
        content: "any",
        excludeTrivialZero: true,
      },
      answer: { maxNear: 4 },
      rack: { minDifficulty: null, size: any, groups: {}, specific: {} },
      geometry: { extend: { shapes: [], headContacts: [], tailContacts: [] } },
      equation: {
        scope: "MAIN",
        tiles: any,
        reusedBoardTiles: any,
        placedParticipating: any,
        properties: [],
        largeIntegerThreshold: 1000,
      },
      mobility: { legalPlacements: any },
    });
    // Editing a field leaves the preset: the form no longer claims to be it.
    expect(screen.getByRole("button", { name: "ต่อ (EXTEND)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows rack, equation, geometry and mobility constraints before generation", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    await screen.findByRole("button", { name: "เริ่มค้นหา" });
    expect(screen.getByRole("region", { name: "สรุปเงื่อนไขก่อนค้นหา" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("1. Rack ของโจทย์ · เบี้ยที่มีในมือ"));
    fireEvent.change(
      screen.getByLabelText("Rack เครื่องหมายคำนวณรวมเบี้ยสองหน้า (ไม่รวม =) ขั้นต่ำ"),
      { target: { value: "2" } },
    );
    fireEvent.change(
      screen.getByLabelText("Rack เครื่องหมายคำนวณรวมเบี้ยสองหน้า (ไม่รวม =) ขั้นสูง"),
      { target: { value: "4" } },
    );
    fireEvent.change(screen.getByLabelText("Rack ชนิดเบี้ยเฉพาะ เพิ่มชนิดเบี้ย"), {
      target: { value: "x" },
    });
    fireEvent.change(screen.getByLabelText("Rack ชนิดเบี้ยเฉพาะ × ขั้นสูง"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByText("3. รูปแบบการลง"));
    fireEvent.click(screen.getByRole("checkbox", { name: "ต่อทั้งหัวและท้าย" }));
    fireEvent.click(screen.getByText("4. สมการที่เกิดขึ้น"));
    fireEvent.change(screen.getByLabelText("จำนวนเบี้ยในสมการ ขั้นต่ำ"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("จำนวนเบี้ยในสมการ ขั้นสูง"), {
      target: { value: "7" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "มีเฉพาะคูณ/หาร" }));
    fireEvent.change(screen.getByLabelText("ขอบเขตสมการ"), { target: { value: "ANY" } });
    fireEvent.click(screen.getByText("5. ความติดขัดของมือ"));
    fireEvent.change(screen.getByLabelText("จำนวนตาที่สามารถลงได้ ขั้นสูง"), {
      target: { value: "5" },
    });
    const summary = screen.getByRole("region", { name: "สรุปเงื่อนไขก่อนค้นหา" });
    expect(summary).toHaveTextContent("× = 1");
    expect(summary).toHaveTextContent("≤ 5");
    fireEvent.click(screen.getByRole("button", { name: "เริ่มค้นหา" }));
    await waitFor(() => expect(source.generate).toHaveBeenCalledTimes(1));
    const [config] = source.generate.mock.calls[0]!;
    expect(config.rack.groups?.arithmetic).toEqual({ min: 2, max: 4 });
    expect(config.rack.specific?.x).toEqual({ min: 1, max: 1 });
    expect(config.geometry?.extend.shapes).toEqual(["BOTH"]);
    expect(config.equation?.scope).toBe("ANY");
    expect(config.equation?.tiles).toEqual({ min: 7, max: 7 });
    expect(config.equation?.properties).toEqual(["MUL_DIV_ONLY"]);
    expect(config.mobility?.legalPlacements).toEqual({ min: null, max: 5 });
  });

  it("sends the 26 Sep rack specification exactly as entered, zeros included, and the generator's normaliser changes none of it", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    await screen.findByRole("button", { name: "เริ่มค้นหา" });
    fireEvent.click(screen.getByRole("button", { name: "ต่อ (EXTEND)" }));
    for (const section of [
      "1. Rack ของโจทย์ · เบี้ยที่มีในมือ",
      "2. ตาที่ดีที่สุด · เบี้ยที่วางจริง",
      "3. รูปแบบการลง",
      "4. สมการที่เกิดขึ้น",
      "5. ความติดขัดของมือ",
      "6. เงื่อนไขทั่วไป · แต้ม · ความชัดของคำตอบ",
    ])
      fireEvent.click(screen.getByText(section));
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    const range = (label: string, min: string, max: string) => {
      type(`${label} ขั้นต่ำ`, min);
      type(`${label} ขั้นสูง`, max);
    };
    type("จำนวนข้อที่ต้องการ", "10");
    type("ชื่อชุด (ไม่บังคับ)", "26 Sep");
    type("เลขสุ่ม", "1769712542");
    range("จำนวนเบี้ยในมือ", "8", "8");
    range("Rack เลข 0–9", "5", "6");
    range("Rack เลข 10–20", "0", "1");
    range("Rack + − × ÷", "1", "1");
    range("Rack เบี้ยสองหน้า", "1", "1");
    range("Rack =", "0", "0");
    // Blank exactly 0 the way an admin sets it: 0, then Exact.
    type("Rack เบี้ยว่าง ขั้นต่ำ", "0");
    fireEvent.click(
      within(screen.getByLabelText("Rack เบี้ยว่าง ขั้นต่ำ").closest(".eq-study-range")!).getByRole(
        "button",
        { name: "Exact" },
      ),
    );
    range("Rack เครื่องหมายคำนวณรวมเบี้ยสองหน้า (ไม่รวม =)", "2", "2");
    range("Rack เครื่องหมายทุกชนิดรวม =", "2", "2");
    type("Rack ชนิดเบี้ยเฉพาะ เพิ่มชนิดเบี้ย", "/");
    type("Rack ชนิดเบี้ยเฉพาะ เพิ่มชนิดเบี้ย", "x//");
    type("Rack ชนิดเบี้ยเฉพาะ ÷ ขั้นสูง", "1");
    type(`Rack ชนิดเบี้ยเฉพาะ ${AMATH_TOKENS["x//"].token} ขั้นสูง`, "1");
    range("จำนวนเบี้ยที่ลง", "5", "8");
    range("จำนวนสมการที่ได้แต้ม", "1", "1");
    fireEvent.click(screen.getByRole("checkbox", { name: "ต่อทั้งหัวและท้าย" }));
    type("ขอบเขตสมการ", "ANY");
    range("จำนวนเบี้ยในสมการ", "10", "15");
    range("เบี้ยเดิมที่ใช้ในสมการ", "5", "8");
    range("เบี้ยใหม่ที่ร่วมในสมการ", "5", "8");
    fireEvent.click(screen.getByRole("checkbox", { name: "มีเฉพาะคูณ/หาร" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "ผลลัพธ์เป็นจำนวนเต็มขนาดใหญ่" }));
    range("จำนวนตาที่สามารถลงได้", "1", "30");
    type("แต้มของตาที่ดีที่สุด ขั้นต่ำ", "60");
    expect(screen.getByRole("region", { name: "สรุปเงื่อนไขก่อนค้นหา" })).toHaveTextContent(
      "= = 0 · เบี้ยว่าง = 0",
    );
    fireEvent.click(screen.getByRole("button", { name: "เริ่มค้นหา" }));

    await waitFor(() => expect(source.generate).toHaveBeenCalledTimes(1));
    const [config] = source.generate.mock.calls[0]!;
    expect(config).toEqual(observedFixture.request);
    // Over the wire and through the generator's normaliser, nothing is added, dropped or rewritten.
    expect(configDrift(JSON.parse(JSON.stringify({ config })).config)).toEqual([]);
  }, 15_000);

  it("shows a guided puzzle's constructed Study rack, and its source game's rack only as provenance", async () => {
    const { source } = fakeSource({}, [HOOK_SUMMARY]);
    const guided = guidedFixture as unknown as PuzzleRecord;
    source.puzzle.mockResolvedValue({ puzzle: structuredClone(guided), attempts: [] });
    render(<StudyPuzzleAdminPanel source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูโจทย์" }));
    const shown = within(await screen.findByRole("list", { name: "เบี้ยในมือ" }))
      .getAllByRole("listitem")
      .map((item) => item.querySelector("b")?.textContent);
    const faces = (rack: readonly string[]) =>
      rack.map((kind) => AMATH_TOKENS[kind as AmathToken].token);
    const { position, provenance } = guided.canonical;
    expect(position.rack).toEqual(provenance!.constructedRack);
    expect(shown).toEqual(faces(position.rack));
    expect(shown).not.toEqual(faces(provenance!.originalRack!));
    expect(screen.getByText(/มือเดิม:/)).toHaveTextContent(
      `มือเดิม: ${provenance!.originalRack!.join(" ")}`,
    );
  });

  it("prevents a contradictory physical rack request before a search", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    await screen.findByRole("button", { name: "เริ่มค้นหา" });
    fireEvent.click(screen.getByText("1. Rack ของโจทย์ · เบี้ยที่มีในมือ"));
    fireEvent.change(screen.getByLabelText("Rack ชนิดเบี้ยเฉพาะ เพิ่มชนิดเบี้ย"), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Rack ชนิดเบี้ยเฉพาะ 20 ขั้นต่ำ"), {
      target: { value: "2" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("มีทั้งหมด 1 ตัว");
    expect(screen.getByRole("button", { name: "เริ่มค้นหา" })).toBeDisabled();
    expect(source.generate).not.toHaveBeenCalled();
  });

  it("rejects a best-play tile that the requested rack cannot contain", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    await screen.findByRole("button", { name: "เริ่มค้นหา" });
    fireEvent.click(screen.getByText("1. Rack ของโจทย์ · เบี้ยที่มีในมือ"));
    fireEvent.change(screen.getByLabelText("Rack + − × ÷ ขั้นสูง"), { target: { value: "0" } });
    fireEvent.click(screen.getByText("2. ตาที่ดีที่สุด · เบี้ยที่วางจริง"));
    fireEvent.change(screen.getByLabelText("ตาที่ดีที่สุดวางชนิดเบี้ยเฉพาะ เพิ่มชนิดเบี้ย"), {
      target: { value: "x" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "เบี้ยในมือไม่สามารถมีเบี้ยที่ตาที่ดีที่สุดต้องลง",
    );
    expect(screen.getByRole("button", { name: "เริ่มค้นหา" })).toBeDisabled();
    expect(source.generate).not.toHaveBeenCalled();
  });

  it("shows the live counters, stops on request, and keeps what it found", async () => {
    const { state, source } = fakeSource({ job: job({}) });
    render(<StudyPuzzleAdminPanel source={source} />);
    const panel = await screen.findByText(/กำลังค้นหา/);
    expect(panel).toHaveTextContent("กำลังค้นหา “ฮุกห้องเรียน” ในเกม self-play · พบแล้ว 1/3 ข้อ");
    expect(screen.getByRole("button", { name: "เริ่มค้นหา" })).toBeDisabled();

    // The counters an admin watches, and why positions were turned away.
    const status = panel.closest<HTMLElement>(".eq-study-job")!;
    expect(within(status).getByText("ตำแหน่งที่ตรวจ").nextElementSibling).toHaveTextContent(
      "1,234",
    );
    expect(within(status).getByText("ประเภทการลงไม่ตรง").nextElementSibling).toHaveTextContent(
      "700",
    );
    expect(within(status).getByText("เลข 10–20: จำนวนไม่อยู่ในช่วง")).toBeInTheDocument();
    expect(within(status).getByText("1 นาที 5 วิ")).toBeInTheDocument();
    // The newest find, labelled as the generator labelled it.
    const recent = within(screen.getByRole("list", { name: "ข้อที่ได้ล่าสุด" })).getAllByRole(
      "listitem",
    );
    expect(recent).toHaveLength(1);
    expect(recent[0]).toHaveTextContent("33 แต้ม");
    expect(recent[0]).toHaveTextContent("HOOK");
    expect(recent[0]).toHaveTextContent("เติมหัว");

    fireEvent.click(screen.getByRole("button", { name: "หยุดและเก็บข้อที่ได้" }));
    await waitFor(() => expect(source.cancel).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("6. เงื่อนไขทั่วไป · แต้ม · ความชัดของคำตอบ"));
    const seedBefore = Number((screen.getByLabelText("เลขสุ่ม") as HTMLInputElement).value);
    state.status = {
      engine: READY,
      job: job({ state: "stopped", stopRequested: true, finishedAt: new Date().toISOString() }),
    };
    state.sets = [HOOK_SUMMARY];
    expect(await screen.findByText(/หยุดแล้ว:/, {}, { timeout: 3000 })).toHaveTextContent(
      "หยุดแล้ว: “ฮุกห้องเรียน” เก็บไว้ 1/3 ข้อ",
    );
    // The archive is read again, and the next search will not repeat this one.
    expect(await screen.findByText("พิสูจน์ HOOK")).toBeInTheDocument();
    expect(Number((screen.getByLabelText("เลขสุ่ม") as HTMLInputElement).value)).not.toBe(
      seedBefore,
    );
    fireEvent.click(screen.getByRole("button", { name: "เปิดชุดนี้" }));
    await waitFor(() => expect(source.set).toHaveBeenCalledWith("set-20260925-080000-def456"));
  });

  it("defaults to Guided + Balanced and lets the admin select authentic-only or deeper search", async () => {
    const { source } = fakeSource();
    render(<StudyPuzzleAdminPanel source={source} />);
    await screen.findByRole("button", { name: "เริ่มค้นหา" });
    const strategy = screen.getByLabelText("รูปแบบการค้นหา");
    expect(strategy).toHaveValue("GUIDED");
    expect(screen.getByLabelText("ความละเอียดการค้นหา")).toHaveValue("24");
    expect(screen.getByText(/ใช้กระดานจากเกมจริง แล้วทดลองชุดเบี้ย/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ความละเอียดการค้นหา"), { target: { value: "64" } });
    fireEvent.click(screen.getByRole("button", { name: "เริ่มค้นหา" }));
    await waitFor(() => expect(source.generate).toHaveBeenCalled());
    expect(source.generate.mock.calls[0]![0].search).toEqual({
      strategy: "GUIDED",
      rackBudget: 64,
    });
    fireEvent.change(strategy, { target: { value: "AUTHENTIC_ONLY" } });
    expect(screen.queryByLabelText("ความละเอียดการค้นหา")).toBeNull();
    expect(screen.getByText("ใช้เฉพาะชุดเบี้ยที่แจกจริงตาม seed")).toBeInTheDocument();
  });

  it("lists v2 sets and Codex's v1 sets in one archive", async () => {
    const stopped: SetSummary = {
      ...HOOK_SUMMARY,
      id: "set-20260925-060000-000001",
      label: null,
      status: "stopped",
      count: 0,
      requested: 5,
      scoreRange: null,
      moveTypes: [],
    };
    const { source } = fakeSource({}, [HOOK_SUMMARY, stopped, LEGACY_SUMMARY]);
    render(<StudyPuzzleAdminPanel source={source} />);
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("พิสูจน์ HOOK");
    expect(rows[0]).toHaveTextContent("ครบ 1/1 ข้อ · HOOK · แต้ม 33");
    // A set stopped before it found anything is still filed, and says so.
    expect(rows[1]).toHaveTextContent("ชุดโจทย์");
    expect(rows[1]).toHaveTextContent("หยุดแล้ว (เก็บข้อที่ได้) 0/5 ข้อ");
    expect(within(rows[1]!).getByRole("button", { name: "ดูโจทย์" })).toBeDisabled();
    // Only a v1 set has classroom files of its own.
    expect(within(rows[0]!).queryByRole("link")).toBeNull();
    expect(rows[2]).toHaveTextContent("v1 · Codex");
    expect(within(rows[2]!).getByRole("link", { name: /โจทย์/ })).toHaveAttribute(
      "href",
      `/files/${LEGACY_SUMMARY.id}/student.html`,
    );
  });

  it("opens a v2 puzzle with its answer hidden until asked for", async () => {
    const { source } = fakeSource({}, [HOOK_SUMMARY]);
    render(<StudyPuzzleAdminPanel source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูโจทย์" }));
    expect(await screen.findByRole("heading", { name: "พิสูจน์ HOOK" })).toBeInTheDocument();
    expect(source.set).toHaveBeenCalledWith(HOOK_SET.id);

    const { puzzle } = HOOK_ADMIN;
    const { position } = puzzle.canonical;
    const best = puzzle.answer.best.placements;
    await waitFor(() =>
      expect(document.querySelectorAll(".board-cell.filled")).toHaveLength(position.board.length),
    );
    expect(source.puzzle).toHaveBeenCalledWith(HOOK_SET.id, puzzle.id);
    expect(document.querySelectorAll(".board-cell")).toHaveLength(225);
    expect(
      within(screen.getByRole("list", { name: "เบี้ยในมือ" })).getAllByRole("listitem"),
    ).toHaveLength(8);
    expect(markedCells()).toEqual([]);
    expect(screen.queryByText("เฉลยที่บอทเลือก")).toBeNull();
    expect(screen.queryByText("4 = 0 + 4")).toBeNull();

    // The one-turn preview is the Play page, addressed by the puzzle.
    const play = screen.getByRole("link", { name: /ลองเล่น 1 ตา/ });
    const route = parseHash(play.getAttribute("href")!);
    expect(route.kind).toBe("play");
    expect(parseStudyPuzzleRoomId(route.kind === "play" ? route.roomId : null)).toEqual({
      setId: HOOK_SET.id,
      puzzleId: puzzle.id,
    });

    fireEvent.click(screen.getByRole("button", { name: "แสดงเฉลย" }));
    expect(screen.getByText("เฉลยที่บอทเลือก")).toBeInTheDocument();
    expect(markedCells().sort()).toEqual(cellsOf(best));
    expect(document.querySelectorAll(".board-cell.filled")).toHaveLength(
      position.board.length + best.length,
    );
    // Every scored equation: the main line and the hook it made, with its pattern.
    const equations = within(screen.getByRole("list", { name: "สมการที่ได้แต้ม" })).getAllByRole(
      "listitem",
    );
    expect(equations).toHaveLength(2);
    expect(equations[0]).toHaveTextContent("หลัก4 = 0 + 4N = N O N16 แต้ม (×2)");
    expect(equations[1]).toHaveTextContent(
      "ฮุก · เติมหัว0 - 3 + 9 - 11 = - 5N O N O N O H = O N17 แต้ม",
    );
    expect(screen.getByText(/^แต้มตรงกัน:/)).toHaveTextContent(
      "แต้มตรงกัน: Stage 5B 33 · EQ-Lab 33 · ตัวตรวจ C++ 33",
    );

    // A near-equal turn can be put on the board to compare.
    const near = within(screen.getByRole("list", { name: "ตาที่ค่าใกล้กัน" }));
    fireEvent.click(near.getByRole("button", { name: /#2/ }));
    expect(markedCells().sort()).toEqual(cellsOf(puzzle.answer.nearBest[1]!.placements));

    fireEvent.click(screen.getByRole("button", { name: "ซ่อนเฉลย" }));
    expect(markedCells()).toEqual([]);

    // Provenance: replaying the source log is asked of the server.
    fireEvent.click(screen.getByRole("button", { name: /ตรวจการเล่นซ้ำ/ }));
    expect(await screen.findByText(/เล่นซ้ำจากเลขสุ่มและจากบันทึกล้วน/)).toHaveTextContent(
      "ถึงตำแหน่งโจทย์ตรงทุกเบี้ย (4 ตา)",
    );
    expect(source.verify).toHaveBeenCalledWith(HOOK_SET.id, puzzle.id);

    // Submissions, graded for the admin only.
    const attempts = screen.getByRole("heading", { name: /คำตอบที่ส่งเข้ามา/ }).parentElement!;
    expect(attempts).toHaveTextContent("คำตอบที่ส่งเข้ามา · 2");
    expect(attempts).toHaveTextContent("33 แต้มตรงกับตาที่บอทเลือก");
    expect(attempts).toHaveTextContent("22 แต้มอันดับ 26 ของ engine");
    expect(source.play).not.toHaveBeenCalled();
    expect(source.submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /กลับไปที่คลัง/ }));
    expect(await screen.findByRole("heading", { name: "คลังชุดโจทย์" })).toBeInTheDocument();
  }, 15_000);

  it("still opens a v1 set, answer hidden until asked for", async () => {
    const { source } = fakeSource({}, [LEGACY_SUMMARY]);
    render(<StudyPuzzleAdminPanel source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูโจทย์" }));
    expect(await screen.findByRole("heading", { name: "ห้องเรียนวันศุกร์" })).toBeInTheDocument();
    expect(source.set).toHaveBeenCalledWith(LEGACY_SUMMARY.id);

    const [first] = legacyPuzzles;
    expect(document.querySelectorAll(".board-cell.filled")).toHaveLength(first!.board.length);
    expect(markedCells()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "แสดงเฉลย" }));
    expect(markedCells().sort()).toEqual(cellsOf(first!.answer.placements));

    fireEvent.click(screen.getByRole("tab", { name: "ข้อ 2" }));
    expect(document.querySelectorAll(".board-cell.filled")).toHaveLength(
      legacyPuzzles[1]!.board.length,
    );
  });

  it("labels a guided puzzle and reports source replay separately from reconstructed rack verification", async () => {
    const { source } = fakeSource({}, [HOOK_SUMMARY]);
    const guided = structuredClone(HOOK_ADMIN);
    guided.puzzle.canonical.provenance = { origin: "CONFIG_GUIDED_RACK", originalRack: ["1", "2"] };
    source.puzzle.mockResolvedValue(guided);
    source.verify.mockResolvedValue({
      ok: true,
      origin: "CONFIG_GUIDED_RACK",
      modes: { seed: { ok: true, turns: 4 }, log: { ok: true, turns: 4 } },
      checks: {
        sourceReplay: { ok: true },
        tileConservation: { ok: true },
        stage5b: { ok: true },
        eqlab: { ok: true },
        amathCli: { ok: true },
      },
    } as Awaited<ReturnType<StudyPuzzleSource["verify"]>>);
    render(<StudyPuzzleAdminPanel source={source} />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูโจทย์" }));
    expect(await screen.findByText("จัดชุดเบี้ยเพื่อค้นหาโจทย์")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ตรวจการเล่นซ้ำ/ }));
    expect(await screen.findByText(/เกมต้นทางเล่นซ้ำตรง/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "ผลตรวจสอบโจทย์" })).toHaveTextContent(
      "เบี้ยครบ 100 ตัว: PASS",
    );
    expect(screen.queryByText(/ถึงตำแหน่งโจทย์ตรงทุกเบี้ย/)).toBeNull();
  });

  it("explains how to run it when there is no dev server to ask", async () => {
    const { source } = fakeSource();
    source.status.mockRejectedValue(new Error("Study puzzle server: 404 Not Found"));
    render(<StudyPuzzleAdminPanel source={source} />);
    expect(await screen.findByText(/npm run dev/, { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("Study puzzle server: 404 Not Found")).toBeInTheDocument();
  });
});
