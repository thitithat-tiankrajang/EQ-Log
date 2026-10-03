import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RankedMatchPage } from "../src/components/pages/ranked/RankedMatchPage";
import { createNewGame } from "../src/game";
import { resolveLiveCapabilities } from "../src/liveGame/capabilities";
import { applyPhysicalAction } from "../src/liveGame/physical";
import { projectLiveGame } from "../src/liveGame/projection";

vi.mock("../src/auth", () => ({
  AccountChip: () => null,
  useAuth: () => ({ userId: "host", isApproved: true }),
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null }));

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  H = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
afterEach(cleanup);

/** A Physical Hosted game as its unseated host receives it: both current racks,
 * administration and history, the largest set of live tools. */
function renderHost() {
  let game = createNewGame({
    name: "Physical",
    gameMode: "versus",
    playerA: "A",
    playerB: "B",
    playerAUserId: A,
    playerBUserId: B,
    emailPlayMode: "hosted",
    tileDrawMode: "manual",
    startingSide: "A",
    untimed: true,
  });
  for (const side of ["A", "B"] as const)
    game = applyPhysicalAction(game, {
      kind: "refill",
      side,
      tokens: ["1", "2", "+", "=", "3", "4", "5", "6"],
    });
  const facts = {
    ownerId: H,
    seats: { A, B },
    revision: 7,
    mode: "hosted_versus",
    purpose: "normal",
    authorityProtocol: "server-v1",
  };
  const caps = resolveLiveCapabilities(facts, game, H);
  const view = projectLiveGame(
    "room",
    7,
    game,
    caps.side,
    "hosted_versus",
    caps.administer,
    false,
    caps,
  );
  const client = {
    read: vi.fn().mockResolvedValue({ match: view }),
    action: vi.fn(),
    ready: vi.fn(),
    cancel: vi.fn(),
    control: vi.fn(),
    administer: vi.fn(),
    physical: vi.fn(),
    record: vi.fn(),
  };
  return render(
    <RankedMatchPage matchId="room" client={client as never} title="Live game" ranked={false} />,
  );
}
const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
};

it("separates the host's controls: Physical console and Record tabs beside the board, lifecycle in Match controls", async () => {
  setViewport(1440, 790);
  const { container } = renderHost();
  const info = await screen.findByRole("complementary", { name: "Game information" });
  // Mode-specific console, record tools and game tools are separate tabs, not one grab-bag.
  for (const name of ["Record", "Tools", "Physical"])
    expect(within(info).getByRole("tab", { name })).toBeInTheDocument();
  // The unseen distribution is always visible beside the board, not behind a tab.
  expect(within(info).getByRole("region", { name: "Tile bag" })).toBeVisible();
  fireEvent.click(within(info).getByRole("tab", { name: "Physical" }));
  expect(within(info).getByRole("region", { name: "Physical game controls" })).toBeVisible();
  // Nothing sits between the gutters and the board; the board is the centre column.
  const shell = container.querySelector("main.lg-shell")!;
  expect(shell.getAttribute("data-layout")).toBe("duo");
  expect([...shell.children].map((child) => child.className)).toEqual([
    "lg-gutter lg-left",
    "lg-center",
    "lg-gutter lg-right",
    "lg-visually-hidden",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Match controls" }));
  const menu = screen.getByRole("dialog", { name: "Match" });
  for (const item of [/Coffee Break/, /Pause game/, /Finish game/, /Rename game/, /Leave board/])
    expect(within(menu).getByRole("button", { name: item })).toBeEnabled();
  // The host is not seated: no Surrender.
  expect(within(menu).queryByRole("button", { name: /Surrender/ })).toBeNull();
});

it("keeps every capability on a phone, behind More and Match, with nothing above the board", async () => {
  setViewport(390, 664);
  const { container } = renderHost();
  const more = await screen.findByRole("button", { name: "Record, bag, notes and tools" });
  const board = container.querySelector(".lg-board-wrap")!;
  const follows = (element: Element | null) =>
    Boolean(element && board.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(container.querySelector("main.lg-shell")!.getAttribute("data-layout")).toBe("stack");
  expect(follows(more)).toBe(true);
  expect(follows(container.querySelector(".lg-rack"))).toBe(true);
  expect(screen.queryByRole("region", { name: "Physical game controls" })).toBeNull();
  fireEvent.click(more);
  const sheet = screen.getByRole("dialog", { name: "Game" });
  for (const name of ["Record", /Bag/, "Tools", "Physical", "Notes"])
    expect(within(sheet).getByRole("tab", { name })).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("tab", { name: "Physical" }));
  expect(within(sheet).getByRole("region", { name: "Physical game controls" })).toBeVisible();
});
