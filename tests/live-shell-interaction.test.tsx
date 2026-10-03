import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phone review round 2 — the interaction contracts of the live shell, on the
 * real reducers and recipient projection (dev fixtures):
 * select a tile, then where it goes; arrow RIGHT → DOWN → OFF that never sits
 * under a tile; double tap to edit an alternative; board → specific empty
 * rack slot; timerless HUD; one-perspective margin; the Turn Log reads
 * without entering review; local placement sound only.
 */
// Full-screen renders on the real reducers; the first test also warms modules.
vi.setConfig({ testTimeout: 20_000 });
const sound = vi.hoisted(() => ({ cue: 0, place: 0 }));
vi.mock("../src/liveGame/shell/attention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/liveGame/shell/attention")>();
  return {
    ...actual,
    playTurnCue: () => {
      sound.cue += 1;
      return true;
    },
    playPlaceSound: () => {
      sound.place += 1;
      return true;
    },
  };
});
vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: null, isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

import { LiveGameScreen } from "../src/liveGame/shell/LiveGameScreen";
import { createFixtureSession } from "../src/liveGame/shell/dev/ShellFixture";
import { DOUBLE_TAP_MS } from "../src/liveGame/shell/useTurnDraft";
import { SOUND_KEY } from "../src/liveGame/shell/attention";

type Session = ReturnType<typeof createFixtureSession>;
function renderScreen(session: Session, viewer = "a", id = "game-1") {
  return render(<LiveGameScreen matchId={id} client={session.clientFor(viewer)} ranked={false} />);
}
function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}
const cell = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });
/** A click carrying an explicit event time (the board reads the tap's own timestamp). */
function tapAt(element: HTMLElement, at: number) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: at });
  fireEvent(element, event);
}

const slots = () => [...document.querySelectorAll<HTMLButtonElement>(".lg-rack-tile")];
const rackTile = (name: RegExp) =>
  slots().find((tile) => name.test(tile.getAttribute("aria-label") ?? ""))!;
const tentativeIds = () =>
  [...document.querySelectorAll<HTMLElement>(".lg-cell.is-tentative")].map(
    (item) => item.dataset.draftTileId!,
  );
const rackIds = () => slots().map((tile) => tile.dataset.tileId ?? null);
/** Every tile is in exactly one place: the rack or the board. */
function expectNoLossOrDuplicate(total = 8) {
  const all = [...tentativeIds(), ...rackIds().filter(Boolean)];
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(total);
}
const arrowAt = () => {
  const item = document.querySelector<HTMLElement>(".lg-cell.is-cursor");
  return item
    ? `${"ABCDEFGHIJKLMNO"[Number(item.dataset.boardCol)]}${Number(item.dataset.boardRow) + 1}:${
        item.classList.contains("dir-down") ? "down" : "right"
      }`
    : null;
};

beforeEach(() => {
  window.localStorage.clear();
  sound.cue = 0;
  sound.place = 0;
  setViewport(1440, 790);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("placement arrow: RIGHT → DOWN → OFF, never under a tile", () => {
  it("cycles on the same empty square and can be turned off", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    expect(arrowAt()).toBeNull();
    fireEvent.click(cell("C12"));
    expect(arrowAt()).toBe("C12:right");
    expect(cell("C12")).toHaveAccessibleName(/placement arrow, right$/);
    fireEvent.click(cell("C12"));
    expect(arrowAt()).toBe("C12:down");
    fireEvent.click(cell("C12"));
    expect(arrowAt()).toBeNull();
    fireEvent.click(cell("C12"));
    expect(arrowAt()).toBe("C12:right");
    // No left/up states exist.
    expect(document.querySelector(".dir-left, .dir-up")).toBeNull();
  });

  it("advances past a tile placed on it (RIGHT: H8 → I8; DOWN: H8 → H9) and turns off at the edge", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(cell("C12"));
    fireEvent.click(slots()[0]);
    expect(cell("C12")).toHaveAccessibleName(/your tentative tile/);
    expect(arrowAt()).toBe("D12:right");
    fireEvent.click(cell("D12"));
    expect(arrowAt()).toBe("D12:down");
    fireEvent.click(slots()[1]);
    expect(arrowAt()).toBe("D13:down");
    // Down to the bottom edge: the arrow turns off instead of hiding under a tile.
    fireEvent.click(slots()[2]);
    fireEvent.click(slots()[3]);
    fireEvent.click(slots()[4]);
    expect(cell("D15")).toHaveAccessibleName(/your tentative tile/);
    expect(arrowAt()).toBeNull();
    expectNoLossOrDuplicate();
  });

  it("a tile moved onto the arrow's square pushes the arrow on", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(cell("C12"));
    fireEvent.click(slots()[0]); // C12, arrow → D12
    fireEvent.click(cell("C12")); // select the tentative tile
    fireEvent.click(cell("F3")); // move it far away
    fireEvent.click(cell("F3")); // select again
    fireEvent.click(cell("D12")); // onto the arrow's square
    expect(cell("D12")).toHaveAccessibleName(/your tentative tile/);
    expect(arrowAt()).toBe("E12:right");
  });
});

describe("select, then where it goes", () => {
  it("rack → board, board → board, board → a chosen empty rack slot; no tile lost or duplicated", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    const id = slots()[2].dataset.tileId!;
    fireEvent.click(slots()[2]);
    expect(slots()[2]).toHaveClass("is-selected");
    fireEvent.click(cell("C12"));
    expect(tentativeIds()).toEqual([id]);
    // Its slot is now an empty recess, not a ghost tile.
    expect(slots()[2]).toHaveClass("is-empty");
    expect(slots()[2].querySelector(".lg-tile")).toBeNull();
    expectNoLossOrDuplicate();

    // Board → board.
    fireEvent.click(cell("C12"));
    expect(cell("C12")).toHaveClass("is-selected");
    expect(slots()[2]).toHaveClass("is-target");
    fireEvent.click(cell("E10"));
    expect(cell("E10")).toHaveAccessibleName(/your tentative tile/);
    expect(cell("C12")).toHaveAccessibleName(/empty/);
    expectNoLossOrDuplicate();

    // Make another empty slot: move slot 6's tile to the board, then return the
    // first tile into slot 6 (not its own old slot 3).
    fireEvent.click(slots()[5]);
    fireEvent.click(cell("A1"));
    expect(slots()[5]).toHaveClass("is-empty");
    fireEvent.click(cell("E10"));
    expect(slots()[5]).toHaveAccessibleName(/empty, put the selected tile here$/);
    fireEvent.click(slots()[5]);
    expect(slots()[5].dataset.tileId).toBe(id);
    expect(slots()[2]).toHaveClass("is-empty");
    expect(cell("E10")).toHaveAccessibleName(/empty/);
    expectNoLossOrDuplicate();

    // An occupied slot does not swallow a selected board tile: the selection moves.
    fireEvent.click(cell("A1"));
    fireEvent.click(slots()[0]);
    expect(slots()[0]).toHaveClass("is-selected");
    expect(tentativeIds()).toHaveLength(1);
    expectNoLossOrDuplicate();

    // Recall: everything home.
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    expect(tentativeIds()).toEqual([]);
    expect(document.querySelectorAll(".lg-rack-tile.is-empty")).toHaveLength(0);
    expectNoLossOrDuplicate();
  });

  it("Exchange mode: the rack marks tiles and the board ignores taps", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(screen.getByRole("button", { name: "Exchange" }));
    fireEvent.click(slots()[0]);
    expect(slots()[0]).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(cell("C12"));
    expect(tentativeIds()).toEqual([]);
    expect(arrowAt()).toBeNull();
  });
});

describe("alternative tiles: single tap moves, double tap edits", () => {
  it("an unassigned alternative opens the picker when placed; the assigned one selects on one tap and edits on a double tap", async () => {
    renderScreen(createFixtureSession("alternatives"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(rackTile(/\+ \/ - tile/));
    fireEvent.click(cell("G7"));
    const picker = screen.getByRole("dialog", { name: "Choose the sign" });
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    fireEvent.click(within(picker).getByRole("button", { name: "Play as minus" }));
    expect(cell("G7")).toHaveAccessibleName(/^G7, -, chosen from/);

    // Single tap: selected for movement, no picker.
    fireEvent.click(cell("G7"));
    expect(screen.queryByRole("dialog", { name: "Choose the sign" })).toBeNull();
    expect(cell("G7")).toHaveClass("is-selected");
    // …and the next tap on an empty square moves it, keeping its value.
    fireEvent.click(cell("B14"));
    expect(cell("B14")).toHaveAccessibleName(/^B14, -, chosen from/);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Double tap: the picker, current choice marked.
    tapAt(cell("B14"), 1000);
    tapAt(cell("B14"), 1150);
    const again = screen.getByRole("dialog", { name: "Choose the sign" });
    expect(within(again).getByRole("button", { name: "Play as minus" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A tap elsewhere only closes it: nothing moves.
    fireEvent.click(cell("A1"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(cell("B14")).toHaveAccessibleName(/your tentative tile/);
    expect(cell("A1")).toHaveAccessibleName(/empty/);
  });

  it("two taps further apart than the double-tap window select, then deselect — no picker", async () => {
    renderScreen(createFixtureSession("alternatives"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(rackTile(/blank, value not chosen/));
    fireEvent.click(cell("G7"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Play as 20" }));
    tapAt(cell("G7"), 1000);
    expect(cell("G7")).toHaveClass("is-selected");
    tapAt(cell("G7"), 1000 + DOUBLE_TAP_MS + 50);
    expect(cell("G7")).not.toHaveClass("is-selected");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("HUD", () => {
  it("an untimed game shows no clock at all — no dash, no empty timer", async () => {
    renderScreen(createFixtureSession("untimed"));
    const board = await screen.findByRole("region", { name: "Score" });
    expect(board).toHaveClass("is-untimed");
    expect(board.querySelectorAll(".lg-sb-clock")).toHaveLength(0);
    expect(board.textContent).not.toMatch(/—|--:--/);
    for (const row of within(board).getAllByRole("group"))
      expect(row.getAttribute("aria-label")).not.toMatch(/left|Untimed/);
  });

  it("a spectator sees the leader's margin on the leader's row; nobody is called 'You'", async () => {
    renderScreen(createFixtureSession("active"), "host");
    const board = await screen.findByRole("region", { name: "Score" });
    const rows = within(board).getAllByRole("group");
    expect(rows[0].querySelector(".lg-sb-diff")).toHaveTextContent("+15");
    expect(rows[0].querySelector(".lg-sb-diff")).not.toHaveClass("is-mine");
    expect(rows[1].querySelector(".lg-sb-diff")).toHaveClass("is-none");
    expect(board.textContent).not.toMatch(/you/i);
  });
});

describe("Turn Log", () => {
  it("opening the log never enters review; only View position does", async () => {
    setViewport(390, 844);
    renderScreen(createFixtureSession("long"));
    await screen.findByRole("button", { name: "Exchange" });
    // The Last Move strip opens the log, not a replay.
    fireEvent.click(screen.getByRole("button", { name: /^Last move, turn/ }));
    const sheet = screen.getByRole("dialog", { name: "Game" });
    expect(within(sheet).getByRole("tab", { name: "Record" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.querySelector(".lg-board-wrap.is-review")).toBeNull();
    const entries = sheet.querySelectorAll(".lg-tl-entry");
    expect(entries.length).toBeGreaterThan(25);
    // The long equation is one entry, intact, in a sideways-scrolling line.
    const long = [...sheet.querySelectorAll(".lg-tl-expr")].find(
      (item) => (item.textContent ?? "").length >= 13,
    );
    expect(long).toBeTruthy();
    expect(document.querySelector(".lg-board-wrap.is-review")).toBeNull();
    fireEvent.click(within(sheet).getByRole("button", { name: "View position, turn 5" }));
    expect(document.querySelector(".lg-board-wrap.is-review")).not.toBeNull();
    expect(screen.getAllByText("Reviewing turn 5").length).toBeGreaterThan(0);
    // (The sheet lowering to its peek height needs real layout: browser spec.)
  });
});

describe("placement sound", () => {
  it("one sound per local placement or move; none for selecting, recalling, or the opponent's play", async () => {
    const session = createFixtureSession("active");
    renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(slots()[0]);
    expect(sound.place).toBe(0); // selecting
    fireEvent.click(cell("C12"));
    expect(sound.place).toBe(1); // placed
    fireEvent.click(cell("C12"));
    fireEvent.click(cell("E10"));
    expect(sound.place).toBe(2); // moved on the board
    fireEvent.click(slots()[1]);
    fireEvent.click(cell("F10"));
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    expect(sound.place).toBe(3); // Recall: silent
    fireEvent.click(screen.getByRole("button", { name: "Pass" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm pass" }));
    await screen.findByText("Pim is thinking");
    act(() => session.act("B", { kind: "pass" }));
    await screen.findByRole("button", { name: "Exchange" });
    expect(sound.place).toBe(3); // remote updates: silent
  });

  it("is silent when sound is off", async () => {
    window.localStorage.setItem(SOUND_KEY, "off");
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(slots()[0]);
    fireEvent.click(cell("C12"));
    expect(cell("C12")).toHaveAccessibleName(/your tentative tile/);
    expect(sound.place).toBe(0);
  });
});
