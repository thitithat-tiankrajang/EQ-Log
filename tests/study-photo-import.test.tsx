// The photo import, end to end inside Study:
//   photo → corners → recognition (two passes) → evidence → verification →
//   BoardSnapshot → the ordinary Study request.
//
// Two things are stood in, and only two: decoding the file (jsdom has no image
// decoder) and the worker boundary (jsdom has no workers). The stand-in
// recogniser runs the REAL `observeImage` — real crops, real two-pass
// orientation, real evidence — on a synthetic photo, with the oracle as the
// model. The ONNX model itself is covered by board-vision-onnx-parity.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CornerPicker, defaultQuad } from "../src/components/pages/study/import/CornerPicker";
import type { Quad } from "../src/features/boardVision/geometry";
import { readingQuad } from "../src/features/boardVision/geometry";
import type { Photo } from "../src/features/boardVision/photo";
import { observeImage } from "../src/features/boardVision/recognize";
import { oracleClassifier, photograph, type TruthSquare } from "./helpers/boardPhoto";

const {
  listStudyRecords,
  deleteStudyRecord,
  requestStudyAnalysis,
  recognizePhoto,
  decodePhoto,
  truth,
} = vi.hoisted(() => ({
  listStudyRecords: vi.fn(),
  deleteStudyRecord: vi.fn(),
  requestStudyAnalysis: vi.fn(),
  recognizePhoto: vi.fn(),
  decodePhoto: vi.fn(),
  truth: { current: [] as TruthSquare[] },
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
vi.mock("../src/features/boardVision/recognizerClient", () => ({
  VISION_MODEL_VERSION: "0.1.0",
  recognizePhoto,
}));
vi.mock("../src/features/boardVision/photo", async () => {
  const actual = await vi.importActual<typeof import("../src/features/boardVision/photo")>(
    "../src/features/boardVision/photo",
  );
  return { ...actual, decodePhoto };
});

import { StudyPage } from "../src/components/pages/study/StudyPage";

/** Where the grid really is in the synthetic photo. */
const GRID: Quad = [
  [150, 110],
  [770, 140],
  [800, 700],
  [110, 660],
];

function photo(): Photo {
  const img = photograph(GRID, 900, 760);
  const data = new Uint8ClampedArray(900 * 760 * 4);
  for (let i = 0; i < 900 * 760; i += 1)
    data.set([img.data[i * 3]!, img.data[i * 3 + 1]!, img.data[i * 3 + 2]!, 255], i * 4);
  return {
    width: 900,
    height: 760,
    channels: 4,
    data,
    name: "table.jpg",
    orientation: 6,
    orientedBy: "app",
    scale: 1,
  };
}

beforeEach(() => {
  window.location.hash = "#/study";
  vi.clearAllMocks();
  listStudyRecords.mockResolvedValue([]);
  requestStudyAnalysis.mockResolvedValue({
    recordId: "s",
    saveError: null,
    level: "medium",
    position: {
      scoreSelf: 0,
      scoreOpponent: 0,
      board: [],
      rack: ["1"],
      oppRackCount: 8,
      bagCount: 70,
    },
    summary: "",
    method: null,
    candidates: [],
  });
  decodePhoto.mockImplementation(async () => photo());
  // The worker, stood in: the real pipeline, the oracle as the model. The
  // person's corners are used as given — here, deliberately starting at the
  // wrong corner, so the recogniser has to find row 1 itself.
  recognizePhoto.mockImplementation(async (image, _quad: Quad) =>
    observeImage(image, readingQuad(GRID, 2), oracleClassifier(truth.current), {
      frameId: "p",
      source: "image",
    }),
  );
});
afterEach(cleanup);

async function openPhotoImport(user: ReturnType<typeof userEvent.setup>) {
  render(<StudyPage />);
  await user.click(await screen.findByRole("button", { name: /นำเข้าจากรูป/ }));
  const input = await screen.findByLabelText("ไฟล์รูปกระดาน");
  await user.upload(
    input,
    new File([new Uint8Array([0xff, 0xd8])], "table.jpg", { type: "image/jpeg" }),
  );
  return screen.findByRole("region", { name: "วางมุมของตาราง" });
}

describe("importing a board from a photo", () => {
  it("goes photo → corners → recognition → verification → Study, and sends the board that is in the photo", async () => {
    truth.current = Array.from({ length: 225 }, () => null);
    // 5 × 3 = 15 across row 8, upright.
    (["5", "x", "3", "=", "15"] as const).forEach(
      (kind, i) => (truth.current[7 * 15 + 5 + i] = { kind, turn: 0 }),
    );
    const user = userEvent.setup({ delay: null });
    await openPhotoImport(user);
    await user.click(screen.getByRole("button", { name: "อ่านกระดาน" }));

    const verification = await screen.findByRole(
      "region",
      { name: "ตรวจกระดานที่นำเข้า" },
      { timeout: 15_000 },
    );
    expect(
      // Names the recogniser that actually read the photo — here the stand-in.
      within(verification).getByText(/อ่านจาก table\.jpg ด้วยตัวอ่านภาพรุ่น oracle/),
    ).toBeInTheDocument();
    expect(recognizePhoto).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "ใช้กระดานนี้" }));
    await user.click(screen.getByRole("button", { name: "ยืนยันกระดาน" }));
    await user.click(screen.getByRole("button", { name: /^1 เหลือ/ }));
    await user.click(screen.getByRole("button", { name: "ยืนยันเบี้ยในมือ" }));
    await user.click(screen.getByRole("button", { name: /ไปเลือกระดับบอท/ }));
    await user.click(screen.getByRole("button", { name: /Fast/ }));
    await waitFor(() => expect(requestStudyAnalysis).toHaveBeenCalled());
    const sent = requestStudyAnalysis.mock.calls[0]![0] as { board: unknown };
    expect(sent.board).toEqual([
      { r: 7, c: 5, kind: "5", token: "5" },
      { r: 7, c: 6, kind: "x", token: "x" },
      { r: 7, c: 7, kind: "3", token: "3" },
      { r: 7, c: 8, kind: "=", token: "=" },
      { r: 7, c: 9, kind: "15", token: "15" },
    ]);
  }, 30_000);

  it("asks which side is row 1 instead of guessing when the tiles cannot tell", async () => {
    truth.current = Array.from({ length: 225 }, () => null);
    truth.current[112] = { kind: "7", turn: 0 }; // one tile: not enough to know which way is up
    const user = userEvent.setup({ delay: null });
    await openPhotoImport(user);
    await user.click(screen.getByRole("button", { name: "อ่านกระดาน" }));
    expect(
      await screen.findByRole("region", { name: "ด้านบนของกระดาน" }, { timeout: 15_000 }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ใช้ตามนี้" }));
    expect(await screen.findByText(/ทิศของกระดานมาจากการวางมุมของคุณ/)).toBeInTheDocument();
  }, 30_000);
});

describe("the corner picker", () => {
  const small = { ...photo(), width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4) };

  it("draws the photo under its overlay", () => {
    // Regression: the photo canvas was once lost in a refactor, leaving an
    // overlay of zero height over nothing — invisible to jsdom's layout, so
    // asserted structurally here.
    const { container } = render(
      <CornerPicker photo={small} busy={false} onConfirm={vi.fn()} onBack={vi.fn()} />,
    );
    const stage = container.querySelector(".corner-picker-stage")!;
    expect(stage.querySelector("canvas.corner-picker-photo")).not.toBeNull();
    expect(stage.querySelector("svg.corner-picker-overlay")).not.toBeNull();
    expect(stage.querySelectorAll(".corner-handle")).toHaveLength(4);
  });

  it("refuses mirrored or crossed corners instead of re-ordering them", () => {
    const [tl, tr, br, bl] = defaultQuad(400, 300);
    render(
      <CornerPicker
        photo={small}
        initial={[tl, bl, br, tr]}
        busy={false}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/ไขว้กันหรือเรียงกลับด้าน/);
    expect(screen.getByRole("button", { name: "อ่านกระดาน" })).toBeDisabled();
  });

  it("moves the chosen corner one photo pixel per arrow, ten with Shift", async () => {
    const onConfirm = vi.fn();
    const quad = defaultQuad(400, 300);
    render(
      <CornerPicker
        photo={small}
        initial={quad}
        busy={false}
        onConfirm={onConfirm}
        onBack={vi.fn()}
      />,
    );
    const corner2 = screen.getByRole("button", { name: "มุม 2" });
    fireEvent.click(corner2);
    fireEvent.keyDown(corner2, { key: "ArrowLeft" });
    fireEvent.keyDown(corner2, { key: "ArrowDown", shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: /ขยับมุม 2 → 1 พิกเซล/ }));
    fireEvent.click(screen.getByRole("button", { name: "อ่านกระดาน" }));
    const [moved] = onConfirm.mock.calls[0]!;
    expect(moved[1]).toEqual([quad[1][0] - 1 + 1, quad[1][1] + 10]);
    expect(moved[0]).toEqual(quad[0]);
  });

  it("warns when the board is too small in the photo to read well", () => {
    const tiny: Quad = [
      [10, 10],
      [200, 10],
      [200, 200],
      [10, 200],
    ];
    render(
      <CornerPicker
        photo={small}
        initial={tiny}
        busy={false}
        onConfirm={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText(/กระดานในรูปเล็ก/)).toBeInTheDocument();
  });
});
