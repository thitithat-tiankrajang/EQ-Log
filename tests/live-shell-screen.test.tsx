import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchClient } from "../src/liveGame/shell/model";
import { useState } from "react";
import { LeftoverNotes } from "../src/liveGame/shell/LeftoverNotes";

// Full-screen renders on the real reducers; the first test also warms modules.
vi.setConfig({ testTimeout: 20_000 });
const cue = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/liveGame/shell/attention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/liveGame/shell/attention")>();
  return {
    ...actual,
    playTurnCue: () => {
      cue.calls += 1;
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
import { WORKSPACE_PREFIX, workspaceKey } from "../src/liveGame/shell/workspace";
import { SOUND_KEY } from "../src/liveGame/shell/attention";

type Session = ReturnType<typeof createFixtureSession>;
const calls: unknown[][] = [];

function spied(client: MatchClient): MatchClient {
  const wrapped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(client))
    wrapped[name] =
      typeof value === "function"
        ? (...args: unknown[]) => {
            calls.push([name, ...args]);
            return (value as (...a: unknown[]) => unknown)(...args);
          }
        : value;
  return wrapped as MatchClient;
}

function renderScreen(session: Session, viewer = "a", id = "game-1") {
  const client = spied(session.clientFor(viewer));
  return render(<LiveGameScreen matchId={id} client={client} ranked={false} />);
}

const turnOf = () => document.querySelector(".lg-shell")?.getAttribute("data-turn");
const tentative = () => document.querySelectorAll(".lg-cell.is-tentative").length;
const rackLabels = () =>
  [...document.querySelectorAll<HTMLElement>(".lg-rack-tile")].map((tile) =>
    tile.getAttribute("aria-label"),
  );
const cell = (row: number, col: number) =>
  screen.getByRole("button", { name: new RegExp(`^${"ABCDEFGHIJKLMNO"[col - 1]}${row},`) });
/** A click carrying an explicit event time (the board reads the tap's own timestamp). */
function tapAt(element: HTMLElement, at: number) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "timeStamp", { value: at });
  fireEvent(element, event);
}

const key = (k: string, code = k) => fireEvent.keyDown(window, { key: k, code });

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

async function placeSevenEqualsFivePlusTwo() {
  fireEvent.click(cell(7, 7));
  key(" ", "Space");
  for (const [k, code] of [
    ["7", "Digit7"],
    ["5", "Digit5"],
    ["p", "KeyP"],
    ["2", "Digit2"],
  ])
    key(k, code);
}

beforeEach(() => {
  window.localStorage.clear();
  calls.length = 0;
  cue.calls = 0;
  setViewport(1440, 790);
});
afterEach(cleanup);

describe("ACTIVE turn", () => {
  it("offers Exchange and Pass, switches to Recall and Commit once a tile is placed, and commits the typed move", async () => {
    const session = createFixtureSession("active");
    renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    expect(turnOf()).toBe("active");
    expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Commit/ })).toBeNull();
    // There is no Place button: placing a tile is the intent.
    expect(screen.queryByRole("button", { name: /^Place/ })).toBeNull();

    await placeSevenEqualsFivePlusTwo();
    expect(tentative()).toBe(4);
    expect(screen.queryByRole("button", { name: "Exchange" })).toBeNull();
    expect(screen.getByRole("button", { name: "Recall" })).toBeEnabled();
    const commit = screen.getByRole("button", { name: "Commit +12" });
    expect(commit).toBeEnabled();
    const before = session.game.logs.length;
    fireEvent.click(commit);
    await waitFor(() => expect(session.game.logs.length).toBe(before + 1));
    expect(session.game.logs.at(-1)!.action).toBe("place_equation");
    await waitFor(() => expect(turnOf()).toBe("thinking"));
    expect(screen.getByText("Pim is thinking")).toBeInTheDocument();
  });

  it("Recall returns every tentative tile to its slot", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    await placeSevenEqualsFivePlusTwo();
    // A tile on the board leaves its slot empty (no ghost).
    expect(document.querySelectorAll(".lg-rack-tile.is-empty")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Recall" }));
    expect(tentative()).toBe(0);
    expect(document.querySelectorAll(".lg-rack-tile.is-empty")).toHaveLength(0);
  });

  it("keeps tentative tiles when a revision is not a new turn (a pause request arrives)", async () => {
    const session = createFixtureSession("active");
    renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    await placeSevenEqualsFivePlusTwo();
    act(() => session.control("b", { kind: "request-pause" }));
    await screen.findByText("Pim asks to pause");
    expect(tentative()).toBe(4);
    expect(screen.getByRole("button", { name: "Commit +12" })).toBeEnabled();
  });
});

describe("THINKING turn", () => {
  it("keeps the whole game usable: board, own rack, reorder, bag, record and notes; no game-changing action", async () => {
    renderScreen(createFixtureSession("thinking"));
    await screen.findByText("Pim is thinking");
    expect(turnOf()).toBe("thinking");
    for (const name of ["Exchange", "Pass", "Recall", /Commit/])
      expect(screen.queryByRole("button", { name })).toBeNull();
    // No overlay, nothing covering or disabling the board.
    expect(screen.queryByRole("dialog")).toBeNull();
    const cells = within(screen.getByRole("grid", { name: /Board/ })).getAllByRole("button");
    expect(cells).toHaveLength(225);
    expect(cells.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    // Own rack readable and reorderable.
    const tiles = document.querySelectorAll<HTMLButtonElement>(".lg-rack-tile");
    expect(tiles).toHaveLength(8);
    expect([...tiles].every((tile) => !tile.disabled)).toBe(true);
    const [first, second] = rackLabels();
    fireEvent.click(tiles[0]);
    fireEvent.click(tiles[1]);
    expect(rackLabels()[0]).toBe(
      first!.replace("Slot 1", "Slot 1").replace(/: .*/, ": ") + second!.split(": ")[1],
    );
    // Bag and record and notes are all there.
    // Unseen is always visible on desktop: no tab to open.
    expect(screen.queryByRole("tab", { name: /Bag/ })).toBeNull();
    expect(screen.getByRole("region", { name: "Tile bag" })).toBeVisible();
    expect(screen.getByLabelText("Private notes")).toBeEnabled();
    // Clicking the board only moves the cursor; nothing is placed.
    fireEvent.click(cell(10, 3));
    expect(tentative()).toBe(0);
  });

  it("rack order survives the turn change and reopening the game; Alt+arrow moves a tile", async () => {
    const session = createFixtureSession("thinking");
    const view = renderScreen(session);
    await screen.findByText("Pim is thinking");
    const tiles = document.querySelectorAll<HTMLButtonElement>(".lg-rack-tile");
    tiles[0].focus();
    fireEvent.keyDown(tiles[0], { key: "ArrowRight", altKey: true });
    const moved = rackLabels().map((label) => label!.split(": ")[1]);
    act(() => session.act("B", { kind: "pass" }));
    await screen.findByRole("button", { name: "Exchange" });
    expect(rackLabels().map((label) => label!.split(": ")[1])).toEqual(moved);
    // Wait for the debounced write rather than a fixed sleep.
    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(workspaceKey("anonymous", "game-1", "A")) ?? "{}")
          .rackOrder?.length,
      ).toBe(8),
    );
    view.unmount();
    renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    await waitFor(() => expect(rackLabels().map((label) => label!.split(": ")[1])).toEqual(moved));
  });
});

describe("turn transitions", () => {
  it("converge to the newest state at once: no queued overlay, no stale turn, no delay before acting", async () => {
    const session = createFixtureSession("active");
    renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    // Three turns land at once (A, B, A pass): the screen shows only the newest.
    act(() => {
      session.act("A", { kind: "pass" });
      session.act("B", { kind: "pass" });
      session.act("A", { kind: "pass" });
    });
    await waitFor(() => expect(turnOf()).toBe("thinking"));
    expect(document.querySelectorAll(".lg-turn-sweep").length).toBeLessThanOrEqual(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => session.act("B", { kind: "pass" }));
    // The turn controls are usable the moment the state says so: no timers advanced.
    const pass = await screen.findByRole("button", { name: "Pass" });
    expect(turnOf()).toBe("active");
    expect(document.querySelectorAll(".lg-turn-sweep").length).toBeLessThanOrEqual(1);
    fireEvent.click(pass);
    fireEvent.click(screen.getByRole("button", { name: "Confirm pass" }));
    await waitFor(() => expect(session.game.activeSide).toBe("B"));
  });

  it("ignores a stale read that arrives after a newer one", async () => {
    const session = createFixtureSession("active");
    const client = session.clientFor("a");
    const stale = await client.read("x");
    act(() => session.act("A", { kind: "pass" }));
    let first = true;
    const racing: MatchClient = {
      ...client,
      read: async (id) => {
        if (first) {
          first = false;
          return client.read(id);
        }
        return stale;
      },
    };
    render(<LiveGameScreen matchId="race" client={racing} ranked={false} />);
    await waitFor(() => expect(turnOf()).toBe("thinking"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    window.dispatchEvent(new Event("focus"));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(turnOf()).toBe("thinking");
  });

  it("plays the your-turn cue once when the turn arrives, and never when muted; announces without moving focus", async () => {
    const session = createFixtureSession("thinking");
    renderScreen(session);
    await screen.findByText("Pim is thinking");
    const notes = screen.getByLabelText("Private notes");
    notes.focus();
    act(() => session.act("B", { kind: "pass" }));
    await screen.findByRole("button", { name: "Exchange" });
    expect(cue.calls).toBe(1);
    expect(document.activeElement).toBe(notes);
    await waitFor(() =>
      expect(document.querySelector(".lg-shell > [aria-live='polite']")?.textContent).toMatch(
        /Your turn\./,
      ),
    );
    cleanup();

    window.localStorage.setItem(SOUND_KEY, "off");
    const muted = createFixtureSession("thinking");
    renderScreen(muted, "a", "game-2");
    await screen.findByText("Pim is thinking");
    act(() => muted.act("B", { kind: "pass" }));
    await screen.findByRole("button", { name: "Exchange" });
    expect(cue.calls).toBe(1);
    expect(screen.getByRole("button", { name: "Turn on your-turn sound" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("pause", () => {
  it("an incoming request is visible and actionable without blocking the game", async () => {
    const session = createFixtureSession("pause-request");
    renderScreen(session);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Pim asks to pause");
    expect(screen.queryByRole("dialog")).toBeNull();
    // The player on move can keep playing underneath it.
    expect(screen.getByRole("button", { name: "Pass" })).toBeEnabled();
    fireEvent.click(cell(7, 7));
    key("7", "Digit7");
    expect(tentative()).toBe(1);
    fireEvent.click(within(alert).getByRole("button", { name: "Pause" }));
    await screen.findByText("Paused by agreement");
    expect(session.game.status).toBe("draft");
    expect(turnOf()).toBe("paused");
    expect(screen.getByRole("button", { name: "Resume game" })).toBeEnabled();
    // Paused: clocks frozen, rack still reorderable, no turn actions.
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
  });
});

describe("Last Move", () => {
  it.each([
    ["active", /^Last move, turn 4: Pim, 1\+8=9/],
    ["exchanged", /^Last move, turn 2: Pim, Exchanged 4 tiles/],
    ["thinking", /^Last move, turn 5: You, Passed/],
  ])("%s", async (state, name) => {
    renderScreen(createFixtureSession(state));
    expect(await screen.findByRole("button", { name })).toBeInTheDocument();
  });

  it("never records a tentative placement", async () => {
    renderScreen(createFixtureSession("active"));
    await screen.findByRole("button", { name: "Exchange" });
    await placeSevenEqualsFivePlusTwo();
    expect(
      screen.getByRole("button", { name: /^Last move, turn 4: Pim, 1\+8=9/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 turns")).toBeInTheDocument();
  });
});

describe("Notes", () => {
  it("does not resurrect Notes when Replay renders before the Result unmount cleanup", async () => {
    const session = createFixtureSession("finished");
    const client = session.clientFor("a");
    const savedKey = workspaceKey("anonymous", "result-flow", "A");
    window.localStorage.setItem(
      savedKey,
      JSON.stringify({
        v: 1,
        rackOrder: [],
        notes: "already seen",
        updatedAt: new Date().toISOString(),
      }),
    );
    function Flow() {
      const [replay, setReplay] = useState(false);
      return replay ? (
        <LeftoverNotes gameId="result-flow" />
      ) : (
        <LiveGameScreen
          matchId="result-flow"
          client={client}
          ranked={false}
          onOpenReplay={() => setReplay(true)}
        />
      );
    }
    render(<Flow />);
    expect(await screen.findByLabelText("Private notes")).toHaveValue("already seen");
    fireEvent.click(screen.getByRole("button", { name: "Open Replay" }));
    expect(screen.queryByText("already seen")).toBeNull();
    await waitFor(() => expect(window.localStorage.getItem(savedKey)).toBeNull());
  });
  it("stay on this device, survive reopening, never reach the client, and leave with the Result", async () => {
    const session = createFixtureSession("active");
    const first = renderScreen(session);
    await screen.findByRole("button", { name: "Exchange" });
    const sentinel = "SECRET-NOTE-7f3a";
    fireEvent.change(screen.getByLabelText("Private notes"), { target: { value: sentinel } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const key = workspaceKey("anonymous", "game-1", "A");
    expect(window.localStorage.getItem(key)).toContain(sentinel);
    first.unmount();
    renderScreen(session);
    expect(await screen.findByLabelText("Private notes")).toHaveValue(sentinel);
    expect(JSON.stringify(calls)).not.toContain(sentinel);

    act(() => session.act("B", { kind: "resign" }));
    await screen.findByText("You won");
    expect(screen.getByLabelText("Private notes")).toHaveValue(sentinel);
    expect(window.localStorage.getItem(key)).toContain(sentinel);
    cleanup();
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(JSON.stringify(calls)).not.toContain(sentinel);
  });

  it("are not offered to a spectator, who gets no rack and no turn actions", async () => {
    renderScreen(createFixtureSession("active"), "host");
    await screen.findByText("Nok to move");
    expect(screen.queryByLabelText("Private notes")).toBeNull();
    expect(document.querySelector(".lg-rack")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    expect(Object.keys(window.localStorage).some((name) => name.startsWith(WORKSPACE_PREFIX))).toBe(
      false,
    );
  });
});

describe("Match controls", () => {
  it("Surrender sits in Match controls behind a confirmation sheet, never window.confirm", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const session = createFixtureSession("active");
    renderScreen(session);
    const actions = await screen.findByRole("group", { name: "Turn actions" });
    expect(within(actions).queryByRole("button", { name: /Surrender/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Match controls" }));
    const menu = screen.getByRole("dialog", { name: "Match" });
    for (const item of ["Coffee Break", "Request pause", "Leave board", "Surrender"])
      expect(within(menu).getByRole("button", { name: new RegExp(item) })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("button", { name: /Surrender/ }));
    const sheet = await screen.findByRole("dialog", { name: "Surrender this game?" });
    fireEvent.click(within(sheet).getByRole("button", { name: "Surrender" }));
    await waitFor(() => expect(session.game.status).toBe("finished"));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("names every board cell and exposes one tab stop in the grid", async () => {
    renderScreen(createFixtureSession("active"));
    const grid = await screen.findByRole("grid", { name: /Board/ });
    expect(within(grid).getAllByRole("gridcell")).toHaveLength(225);
    expect(
      within(grid).getByRole("button", {
        name: /^F4, 1, 1 point, played by Pim, last move$/,
      }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: /^D1, double piece, empty$/ }),
    ).toBeInTheDocument();
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });
});

describe("legacy frozen game", () => {
  it("explains that it is read-only and offers no game-changing action", async () => {
    const base = createFixtureSession("active").clientFor("a");
    const view = (await base.read("x")).match;
    const frozen: MatchClient = {
      ...base,
      read: async () => ({ match: { ...view, continuationBlocked: true } as typeof view }),
    };
    render(<LiveGameScreen matchId="legacy" client={frozen} ranked={false} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This legacy game is read-only and cannot continue after the security upgrade.",
    );
    for (const name of ["Exchange", "Pass", /Commit/])
      expect(screen.queryByRole("button", { name })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Match controls" }));
    expect(
      within(screen.getByRole("dialog", { name: "Match" })).queryByRole("button", {
        name: /Surrender/,
      }),
    ).toBeNull();
  });
});

describe("alternative tiles: direct choice, never cycling", () => {
  const rackTile = (name: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>(".lg-rack-tile")].find((tile) =>
      name.test(tile.getAttribute("aria-label") ?? ""),
    )!;

  it("a placed blank has no silent value; one tap on 20 chooses it", async () => {
    renderScreen(createFixtureSession("alternatives"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(rackTile(/blank, value not chosen/));
    fireEvent.click(cell(7, 7));
    // The picker opens at once with every legal value; nothing was assumed.
    const picker = screen.getByRole("dialog", { name: "Blank: choose its value" });
    expect(within(picker).getAllByRole("button", { name: /^Play as / })).toHaveLength(26);
    expect(cell(7, 7)).toHaveAccessibleName(/^G7, blank, value not chosen, your tentative tile$/);
    expect(screen.getByRole("button", { name: "Commit" })).toBeDisabled();
    fireEvent.click(within(picker).getByRole("button", { name: "Play as 20" }));
    expect(screen.queryByRole("dialog", { name: /Blank/ })).toBeNull();
    expect(cell(7, 7)).toHaveAccessibleName(/^G7, blank played as 20, your tentative tile$/);
  });

  it("+/− and ×/÷ offer exactly their two signs; the choice is shown as chosen", async () => {
    renderScreen(createFixtureSession("alternatives"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(rackTile(/\+ \/ - tile/));
    fireEvent.click(cell(7, 7));
    const picker = screen.getByRole("dialog", { name: "Choose the sign" });
    const options = within(picker).getAllByRole("button", { name: /^Play as / });
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "Play as plus",
      "Play as minus",
    ]);
    fireEvent.click(within(picker).getByRole("button", { name: "Play as minus" }));
    expect(cell(7, 7)).toHaveAccessibleName(/^G7, -, chosen from \+ \/ -, your tentative tile$/);
    // A single tap selects the tile (to move it); a double tap reopens the
    // picker with the current choice marked. Nothing cycles the value.
    tapAt(cell(7, 7), 1000);
    expect(screen.queryByRole("dialog", { name: "Choose the sign" })).toBeNull();
    tapAt(cell(7, 7), 1150);
    const again = screen.getByRole("dialog", { name: "Choose the sign" });
    expect(within(again).getByRole("button", { name: "Play as minus" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(cell(7, 7)).toHaveAccessibleName(/^G7, -, chosen from/);
  });

  it("dismisses on an outside tap without moving the tile; E reopens it from the keyboard", async () => {
    renderScreen(createFixtureSession("alternatives"));
    await screen.findByRole("button", { name: "Exchange" });
    fireEvent.click(rackTile(/× \/ ÷ tile/));
    fireEvent.click(cell(7, 7));
    expect(screen.getByRole("dialog", { name: "Choose the sign" })).toBeInTheDocument();
    fireEvent.click(cell(10, 3));
    expect(screen.queryByRole("dialog", { name: "Choose the sign" })).toBeNull();
    expect(cell(7, 7)).toHaveAccessibleName(/your tentative tile/);
    expect(cell(10, 3)).toHaveAccessibleName(/empty$/);
    expect(screen.getAllByText("Double-tap the tile to choose its value").length).toBeGreaterThan(
      0,
    );
    tapAt(cell(7, 7), 5000);
    tapAt(cell(7, 7), 5150);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Choose the sign" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Choose the sign" })).toBeNull();
    // With the arrow off, focus stays on the placed tile: E reopens its picker.
    key("e", "KeyE");
    expect(screen.getByRole("dialog", { name: "Choose the sign" })).toBeInTheDocument();
  });
});

describe("game HUD", () => {
  it("shows both players' score and clock in one scoreboard; the margin once, from my side", async () => {
    renderScreen(createFixtureSession("thinking"));
    const board = await screen.findByRole("region", { name: "Score" });
    const rows = within(board).getAllByRole("group");
    expect(rows).toHaveLength(2);
    // Nok (A, me) leads 25–10; Pim (B) is to move. The margin is on my row only.
    expect(rows[0]).toHaveAccessibleName(/^Nok, You, 25 points, leads by 15, .* left$/);
    expect(rows[1]).toHaveAccessibleName(/^Pim, 10 points, .* left, To move$/);
    expect(rows[0].querySelector(".lg-sb-diff.is-lead.is-mine")).toHaveTextContent("+15");
    expect(rows[1].querySelector(".lg-sb-diff")).toHaveClass("is-none");
    expect(rows[1].querySelector(".lg-sb-diff")).toHaveTextContent("");
    expect(rows[1]).toHaveAttribute("data-to-move", "true");
    expect(rows[0]).not.toHaveAttribute("data-to-move");
  });

  it("keeps Unseen visible on a phone without opening anything", async () => {
    setViewport(390, 844);
    renderScreen(createFixtureSession("active"));
    const unseen = await screen.findByRole("button", { name: /tiles unseen/ });
    expect(unseen).toHaveAccessibleName(/^79 tiles unseen: .* 71 in the bag/);
    expect(unseen).toHaveTextContent("79");
    fireEvent.click(unseen);
    expect(screen.getByRole("tab", { name: /Bag/ })).toHaveAttribute("aria-selected", "true");
  });
});
