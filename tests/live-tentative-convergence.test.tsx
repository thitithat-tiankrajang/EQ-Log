import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase B convergence: two seats of ONE game (the fixture's real reducers,
 * projection and the trusted validator), the relay network held by the test
 * so it can deliver late, out of order, twice, or not at all.
 */
vi.setConfig({ testTimeout: 30_000 });
vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: null, isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

import { LiveGameScreen } from "../src/liveGame/shell/LiveGameScreen";
import { createFixtureSession } from "../src/liveGame/shell/dev/ShellFixture";

type Session = ReturnType<typeof createFixtureSession>;
const square = (root: HTMLElement, row: number, col: number) =>
  root.querySelector<HTMLButtonElement>(`[data-board-row="${row}"][data-board-col="${col}"]`)!;
const remote = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".lg-cell.is-opponent-tentative")].map(
    (cell) => `${cell.dataset.boardRow}:${cell.dataset.boardCol}`,
  );
const mine = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".lg-cell.is-tentative")].map(
    (cell) => `${cell.dataset.boardRow}:${cell.dataset.boardCol}`,
  );
const slot = (root: HTMLElement, index: number) =>
  root.querySelectorAll<HTMLButtonElement>(".lg-rack-tile")[index]!;

function mount(session: Session, viewer: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = render(
    <LiveGameScreen matchId={`m-${viewer}`} client={session.clientFor(viewer)} ranked={false} />,
    { container },
  );
  return { root: container, unmount: () => view.unmount() };
}
async function ready(root: HTMLElement) {
  await waitFor(() => expect(root.querySelector(".lg-shell")).not.toBeNull());
}
/** Select a rack tile (by slot) and tap a square: the approved model. */
function place(root: HTMLElement, index: number, row: number, col: number) {
  fireEvent.click(slot(root, index));
  fireEvent.click(square(root, row, col));
}
function move(root: HTMLElement, from: [number, number], to: [number, number]) {
  fireEvent.click(square(root, ...from));
  fireEvent.click(square(root, ...to));
}
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 790 });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("two seats, one game", () => {
  it("place → seen; H8→I8→J8 delivered J8, I8 stays J8; add/remove converges; local stays immediate", async () => {
    const session = createFixtureSession("active");
    session.network.mode = "manual";
    const a = mount(session, "a");
    const b = mount(session, "b");
    await ready(a.root);
    await ready(b.root);
    expect(remote(b.root)).toEqual([]);

    place(a.root, 0, 11, 2);
    // Local: immediate, before any delivery.
    expect(mine(a.root)).toEqual(["11:2"]);
    await flush();
    expect(remote(b.root)).toEqual([]); // nothing delivered yet
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["11:2"]);

    move(a.root, [11, 2], [11, 3]);
    await flush();
    move(a.root, [11, 3], [11, 4]);
    await flush();
    await waitFor(() => expect(session.network.held.length).toBe(2));
    // Network reorders: newest (seq higher) first, older second.
    act(() => session.network.deliverAll([1, 0]));
    expect(remote(b.root)).toEqual(["11:4"]);
    // A duplicate of the old one changes nothing.
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["11:4"]);

    place(a.root, 1, 12, 4);
    await flush();
    // Return the first tile to an empty slot (select it, tap its old slot).
    fireEvent.click(square(a.root, 11, 4));
    fireEvent.click(slot(a.root, 0));
    await flush();
    await waitFor(() => expect(session.network.held.length).toBeGreaterThan(0));
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(mine(a.root));
    expect(mine(a.root)).toEqual(["12:4"]);

    // Recall (CLEAR): the overlay empties.
    fireEvent.click(a.root.querySelector<HTMLButtonElement>("button.lg-btn-quiet")!);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual([]);
    // A spectator never receives tentative traffic.
    const spectator = mount(session, "host");
    await ready(spectator.root);
    place(a.root, 0, 11, 2);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["11:2"]);
    expect(remote(spectator.root)).toEqual([]);
  });

  it("a dropped update is corrected by the next one", async () => {
    const session = createFixtureSession("active");
    session.network.mode = "manual";
    const a = mount(session, "a");
    const b = mount(session, "b");
    await ready(a.root);
    await ready(b.root);
    place(a.root, 0, 11, 2);
    await flush();
    session.network.held = []; // lost
    expect(remote(b.root)).toEqual([]);
    place(a.root, 1, 11, 3);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["11:2", "11:3"]);
  });

  it("Commit wins atomically; a late packet from the old epoch never comes back", async () => {
    const session = createFixtureSession("active");
    session.network.mode = "manual";
    const a = mount(session, "a");
    const b = mount(session, "b");
    await ready(a.root);
    await ready(b.root);
    // 7=5+2 down column G through the committed "=" at G8.
    fireEvent.click(square(a.root, 6, 6));
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    for (const [key, code] of [
      ["7", "Digit7"],
      ["5", "Digit5"],
      ["p", "KeyP"],
    ])
      fireEvent.keyDown(window, { key, code });
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root).length).toBe(3);
    fireEvent.keyDown(window, { key: "2", code: "Digit2" });
    await flush();
    // Hold this last pre-commit update and deliver it only AFTER the commit.
    await waitFor(() => expect(session.network.held.length).toBe(1));
    const late = session.network.held.splice(0);
    const commit = [...a.root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /^Commit \+\d+/.test(button.textContent ?? ""),
    )!;
    fireEvent.click(commit);
    await waitFor(() =>
      expect(b.root.querySelector(".lg-shell")).toHaveAttribute("data-turn", "active"),
    );
    // B: the committed tiles, no overlay — same render.
    expect(remote(b.root)).toEqual([]);
    expect(square(b.root, 6, 6).getAttribute("aria-label")).toMatch(/^G7, 7,/);
    // The delayed epoch-old packet arrives now: ignored.
    session.network.held.push(...late);
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual([]);
    expect(session.network.rejected).toEqual([]);
  });

  it("Pass ends the epoch; the opponent reconnecting gets no tentative history", async () => {
    const session = createFixtureSession("active");
    session.network.mode = "manual";
    const a = mount(session, "a");
    let b = mount(session, "b");
    await ready(a.root);
    await ready(b.root);
    place(a.root, 0, 11, 2);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["11:2"]);
    // B disconnects; A keeps changing; those messages are delivered to nobody.
    b.unmount();
    move(a.root, [11, 2], [12, 2]);
    await flush();
    act(() => session.network.deliverAll());
    b = mount(session, "b");
    await ready(b.root);
    expect(remote(b.root)).toEqual([]); // no stale pre-disconnect state, no replay
    move(a.root, [12, 2], [13, 2]);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(["13:2"]); // the current state only
    // A passes: the epoch ends, the overlay goes, and A's old tiles cannot be relayed.
    fireEvent.click(a.root.querySelector<HTMLButtonElement>("button.lg-btn-quiet")!);
    await flush();
    act(() => session.network.deliverAll());
    act(() => session.act("A", { kind: "pass" }));
    await waitFor(() =>
      expect(b.root.querySelector(".lg-shell")).toHaveAttribute("data-turn", "active"),
    );
    expect(remote(b.root)).toEqual([]);
    // B's turn now: B places; A sees it.
    place(b.root, 0, 11, 2);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(a.root)).toEqual(["11:2"]);
    expect(remote(b.root)).toEqual([]);
  });
});

describe("network impairment (seeded): reorder, duplicate, drop, rapid changes", () => {
  it("the opponent never shows a stale or impossible set and settles on the sender's latest", async () => {
    let seed = 20261003;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const session = createFixtureSession("active");
    session.network.mode = "manual";
    const a = mount(session, "a");
    const b = mount(session, "b");
    await ready(a.root);
    await ready(b.root);
    const free = [
      [11, 2],
      [11, 3],
      [11, 4],
      [12, 2],
      [12, 3],
      [13, 5],
    ] as [number, number][];
    // Every set the sender ever had: anything the opponent shows must be one of them.
    const senderSets = new Set<string>([""]);
    const record = () => senderSets.add([...mine(a.root)].sort().join(","));
    for (let step = 0; step < 60; step += 1) {
      const placed = mine(a.root);
      const action = random();
      if (placed.length < 3 && action < 0.45) {
        const target = free.find(([r, c]) => !placed.includes(`${r}:${c}`))!;
        const rackIndex = [...a.root.querySelectorAll(".lg-rack-tile")].findIndex(
          (tile) =>
            !tile.classList.contains("is-empty") &&
            !/not chosen/.test(tile.getAttribute("aria-label") ?? ""),
        );
        place(a.root, rackIndex, ...target);
      } else if (placed.length && action < 0.85) {
        const [r, c] = placed[Math.floor(random() * placed.length)]!.split(":").map(Number) as [
          number,
          number,
        ];
        const target = free.find(([fr, fc]) => !placed.includes(`${fr}:${fc}`));
        if (target) move(a.root, [r, c], target);
      } else if (placed.length) {
        fireEvent.click(a.root.querySelector<HTMLButtonElement>("button.lg-btn-quiet")!);
      }
      await flush();
      record();
      // The network delivers some of what is held, in random order, sometimes twice, sometimes never.
      const held = session.network.held.splice(0);
      const kept = held.filter(() => random() > 0.25);
      const doubled = kept.flatMap((item) => (random() < 0.3 ? [item, item] : [item]));
      doubled.sort(() => random() - 0.5);
      session.network.held.push(...doubled);
      act(() => session.network.deliverAll());
      const shown = [...remote(b.root)].sort().join(",");
      expect(senderSets.has(shown), `opponent shows a set the sender never had: ${shown}`).toBe(
        true,
      );
    }
    // One more real change, delivered: the opponent settles on exactly the sender's current set.
    const placed = mine(a.root);
    if (placed.length)
      fireEvent.click(a.root.querySelector<HTMLButtonElement>("button.lg-btn-quiet")!);
    await flush();
    const rackIndex = [...a.root.querySelectorAll(".lg-rack-tile")].findIndex(
      (tile) =>
        !tile.classList.contains("is-empty") &&
        !/not chosen/.test(tile.getAttribute("aria-label") ?? ""),
    );
    place(a.root, rackIndex, 13, 5);
    await flush();
    act(() => session.network.deliverAll());
    expect(remote(b.root)).toEqual(mine(a.root));
    expect(session.network.rejected).toEqual([]);
  });
});
