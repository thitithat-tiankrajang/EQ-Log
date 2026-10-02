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
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

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
const TOOLS = ["Physical game controls", "Tournament administration", "History"];

it("keeps live tools in the play grid's rail and secondary actions in the game menu", async () => {
  const { container } = renderHost();
  const tools = await screen.findByRole("region", { name: "Game tools" });
  expect(tools.closest(".workspace .right-rail")).not.toBeNull();
  for (const name of TOOLS) expect(within(tools).getByRole("region", { name })).toBeVisible();
  // Nothing is mounted between the header and the play grid.
  const main = container.querySelector("main.ranked-play")!;
  expect([...main.children].map((child) => child.className)).toEqual(["top-bar", "workspace"]);
  const header = container.querySelector("header")!;
  expect(within(header).queryByRole("button", { name: "Coffee Break" })).toBeNull();
  fireEvent.click(within(header).getByRole("button", { name: "Game menu" }));
  const menu = screen.getByRole("dialog", { name: "Game menu" });
  for (const item of ["Coffee Break", "Rename game", "ห้องและอันดับ"])
    expect(within(menu).getByRole("button", { name: item })).toBeEnabled();
});

it("puts the tools and turn log below the board on phones, never above it", async () => {
  window.matchMedia = (query: string) =>
    ({
      matches: query === "(max-width: 759px)",
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  const { container } = renderHost();
  const open = await screen.findByRole("button", { name: "Game tools" });
  const board = container.querySelector(".board-zone")!;
  const follows = (element: Element | null) =>
    Boolean(element && board.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
  expect(follows(open.closest(".mobile-play-tools"))).toBe(true);
  expect(follows(container.querySelector(".live-mobile-log"))).toBe(true);
  expect(container.querySelector(".log-rail .log-panel")).toBeNull();
  for (const name of TOOLS) expect(screen.queryByRole("region", { name })).toBeNull();
  fireEvent.click(open);
  const sheet = screen.getByRole("dialog", { name: "Game tools" });
  for (const name of TOOLS) expect(within(sheet).getByRole("region", { name })).toBeVisible();
});
