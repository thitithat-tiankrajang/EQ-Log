// Admin Board Labeler, through its UI: upload → corners → paint → review →
// complete, with the photo decoder stubbed (jsdom cannot decode images) and an
// in-memory store. No model anywhere.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BoardLabeler } from "../src/components/admin/BoardLabeler";
import { CROP_CONTRACT } from "../src/features/boardVision/crops";
import { indexOf, squareBoxCanonical } from "../src/features/boardVision/labeling/boardLabels";
import { memoryStore } from "../src/features/boardVision/labeling/labelStore";

vi.mock("../src/features/boardVision/photo", () => ({
  decodePhoto: async (file: File) => ({
    width: 200,
    height: 150,
    channels: 4,
    data: new Uint8ClampedArray(200 * 150 * 4).fill(128),
    name: file.name,
    orientation: 1,
    orientedBy: "none",
    scale: 0.5, // decoded at half the original size
  }),
}));

const N = CROP_CONTRACT.canonicalSize;

// jsdom's Blob has no arrayBuffer(); the browser's does
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer);
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(this);
    });
  };
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // the labels canvas is drawn at its canonical size, so client px = canonical px
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: N,
    height: N,
    right: N,
    bottom: N,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const centre = (row: number, col: number) => {
  const b = squareBoxCanonical(indexOf(row, col));
  return { clientX: b.x + b.size / 2, clientY: b.y + b.size / 2, button: 0, pointerId: 1 };
};

async function uploadOne(store = memoryStore()) {
  const user = userEvent.setup();
  const view = render(<BoardLabeler store={store} />);
  await screen.findByText("No boards yet");
  await user.upload(
    screen.getByLabelText("Add board photos"),
    new File([new Uint8Array([1, 2, 3, 4])], "board-1.jpg", { type: "image/jpeg" }),
  );
  await screen.findByText("1 / 1 boards");
  await screen.findByRole("button", { name: "Use corners → paint" }); // the photo has opened
  return { user, store, view };
}

describe("Board Labeler UI", () => {
  it("a new photo is a SEALED_TEST board, with no model output anywhere on the page", async () => {
    const { store } = await uploadOne();
    expect(screen.getByRole("note")).toHaveTextContent("SEALED TEST");
    expect(screen.getByLabelText("Dataset role")).toHaveValue("SEALED_TEST");
    const [saved] = [...store.boards.values()];
    expect(saved).toMatchObject({
      role: "SEALED_TEST",
      status: "NOT_STARTED",
      modelSuggestionsShown: false,
    });
    // original size = decoded / scale
    expect(saved!.image).toMatchObject({ name: "board-1.jpg", width: 400, height: 300, bytes: 4 });
    expect(saved!.image.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(document.body.textContent).not.toMatch(/suggest|predict|confidence|auto-?detect/i);
    expect(screen.getByLabelText("Counts")).toHaveTextContent(
      "TILE: 0EMPTY: 225UNSURE: 0TOTAL: 225",
    );
  });

  it("corners → click, drag, erase, unsure, undo/redo → review → completed, and it reloads exactly", async () => {
    const { user, store, view } = await uploadOne();
    await user.click(screen.getByRole("button", { name: "Use corners → paint" }));
    const canvas = await screen.findByLabelText(/Rectified board/);
    const id = [...store.boards.keys()][0]!;
    const saved = () => store.boards.get(id)!;

    // corners are stored in ORIGINAL pixels: the default square, ×2 (scale 0.5)
    await waitFor(() => expect(saved().corners).not.toBeNull());
    const side = 150 * 0.7;
    expect(saved().corners![0]).toEqual([((200 - side) / 2) * 2, ((150 - side) / 2) * 2]);

    // hover names the square
    fireEvent.pointerMove(canvas, centre(8, 12));
    expect(screen.getByText("R8C12")).toBeInTheDocument();

    // click paints one TILE
    fireEvent.pointerDown(canvas, centre(8, 12));
    fireEvent.pointerUp(canvas, centre(8, 12));
    expect(screen.getByLabelText("Counts")).toHaveTextContent("TILE: 1");

    // drag paints the whole row segment, as one stroke
    fireEvent.pointerDown(canvas, centre(3, 2));
    fireEvent.pointerMove(canvas, centre(3, 7));
    fireEvent.pointerUp(canvas, centre(3, 7));
    expect(screen.getByLabelText("Counts")).toHaveTextContent("TILE: 7");

    // eraser and unsure, by keyboard shortcut
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.pointerDown(canvas, centre(3, 2));
    fireEvent.pointerUp(canvas, centre(3, 2));
    fireEvent.keyDown(window, { key: "u" });
    fireEvent.pointerDown(canvas, centre(15, 15));
    fireEvent.pointerUp(canvas, centre(15, 15));
    expect(screen.getByLabelText("Counts")).toHaveTextContent(
      "TILE: 6EMPTY: 218UNSURE: 1TOTAL: 225",
    );

    // undo / redo whole strokes (button and ⌘Z / ⇧⌘Z)
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(screen.getByLabelText("Counts")).toHaveTextContent("UNSURE: 0");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Counts")).toHaveTextContent("TILE: 7");
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByLabelText("Counts")).toHaveTextContent(
      "TILE: 6EMPTY: 218UNSURE: 1TOTAL: 225",
    );

    // painting in the margin does nothing
    fireEvent.pointerDown(canvas, { clientX: 3, clientY: 3, button: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 3, clientY: 3 });
    expect(screen.getByLabelText("Counts")).toHaveTextContent("TILE: 6");

    // review: UNSURE listed; completion needs the full-review confirmation
    await user.click(screen.getByRole("button", { name: "Review →" }));
    expect(screen.getByRole("button", { name: "R15C15" })).toBeInTheDocument();
    expect(screen.getByLabelText("R15C15 UNSURE")).toBeInTheDocument();
    const completeButton = screen.getByRole("button", { name: "Mark completed" });
    expect(completeButton).toBeDisabled();
    await user.click(screen.getByLabelText(/I reviewed all 225 squares/));
    await user.click(completeButton);
    await waitFor(() => expect(saved().status).toBe("COMPLETED"));
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);

    const tiles = saved()
      .cells.filter((c) => c.occupancy === "TILE")
      .map((c) => `R${c.row}C${c.col}`);
    expect(tiles.sort()).toEqual(["R3C3", "R3C4", "R3C5", "R3C6", "R3C7", "R8C12"].sort());
    expect(saved().cells[224]!.occupancy).toBe("UNSURE");

    // a fresh labeler on the same store reopens the same board, exactly
    const before = JSON.stringify(saved());
    view.unmount();
    render(<BoardLabeler store={store} />);
    await screen.findByText("1 / 1 boards");
    await screen.findByLabelText(/Rectified board/);
    expect(screen.getByLabelText("Counts")).toHaveTextContent(
      "TILE: 6EMPTY: 218UNSURE: 1TOTAL: 225",
    );
    expect(JSON.stringify(store.boards.get(id))).toBe(before);
  });

  it("arrow nudges move the chosen corner one ORIGINAL pixel each, however fast they come", async () => {
    const { store } = await uploadOne();
    const side = 150 * 0.7;
    const start: [number, number] = [((200 - side) / 2) * 2, ((150 - side) / 2) * 2 + side * 2];
    act(() => {
      fireEvent.keyDown(window, { key: "4" });
      for (let k = 0; k < 3; k += 1) fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowUp", shiftKey: true });
    });
    await waitFor(() =>
      expect([...store.boards.values()][0]!.corners?.[3]).toEqual([start[0] + 3, start[1] - 10]),
    );
  });

  it("leaving SEALED_TEST asks first; declining keeps it sealed", async () => {
    const { user, store } = await uploadOne();
    await user.click(screen.getByRole("button", { name: "Use corners → paint" }));
    await screen.findByLabelText(/Rectified board/);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await user.selectOptions(screen.getByLabelText("Dataset role"), "TRAIN");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0]).toMatch(/SEALED_TEST/);
    expect(screen.getByLabelText("Dataset role")).toHaveValue("SEALED_TEST");
    confirm.mockReturnValue(true);
    await user.selectOptions(screen.getByLabelText("Dataset role"), "TRAIN");
    await waitFor(() => expect([...store.boards.values()][0]!.role).toBe("TRAIN"));
    expect([...store.boards.values()][0]!.roleHistory[0]).toMatchObject({
      from: "SEALED_TEST",
      to: "TRAIN",
      confirmedLeavingSealed: true,
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("Previous / Next walk the batch and show i / N", async () => {
    const store = memoryStore();
    const user = userEvent.setup();
    render(<BoardLabeler store={store} />);
    await screen.findByText("No boards yet");
    await user.upload(screen.getByLabelText("Add board photos"), [
      new File([new Uint8Array([1])], "a.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2])], "b.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([3])], "c.jpg", { type: "image/jpeg" }),
    ]);
    await screen.findByText(/3 \/ 3 boards|1 \/ 3 boards/);
    // the first added is opened
    expect(screen.getByText("1 / 3 boards")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await screen.findByText("2 / 3 boards");
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await screen.findByText("3 / 3 boards");
    expect(screen.getByRole("button", { name: "Next →" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "← Previous" }));
    await screen.findByText("2 / 3 boards");
    expect(screen.getAllByText("Not started")).toHaveLength(3 + 1); // list + header
    await act(async () => undefined);
  });
});
