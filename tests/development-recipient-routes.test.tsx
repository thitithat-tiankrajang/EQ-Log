import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PlayerPuzzle } from "../src/features/studyPuzzles/api";
import type { SurvivalView } from "../src/features/survivalPlay/api";
import puzzleFixture from "./fixtures/study-puzzles/v2-hook-set.json";
import survivalFixture from "./fixtures/survival-play/takeover.json";
const source = vi.hoisted(() => ({
  play: vi.fn(),
  submit: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  move: vi.fn(),
  authur: vi.fn(),
}));
vi.mock("../src/features/studyPuzzles/api", () => ({
  studyPuzzleSource: { play: source.play, submit: source.submit },
}));
vi.mock("../src/features/survivalPlay/api", () => ({ survivalPlaytestSource: source }));
vi.mock("../src/components/pages/ranked/RankedMatchPage", () => ({
  RankedMatchPage: ({ client }: { client: { read(): Promise<unknown> } }) => {
    void client.read().then((r) => {
      window.dispatchEvent(new CustomEvent("dev-recipient-test", { detail: r }));
    });
    return <p>Recipient playtest</p>;
  },
}));
import DevelopmentSources from "../src/liveGame/DevelopmentSources";
afterEach(cleanup);
it("Study preview renders only its player position and own rack without opening the archive or legacy App", async () => {
  source.play.mockResolvedValue(puzzleFixture.player as PlayerPuzzle);
  window.localStorage.clear();
  render(<DevelopmentSources roomId="study:set-id:puzzle-id" />);
  expect(
    await screen.findByText(`Practice T${puzzleFixture.player.position.turnNumber}`),
  ).toBeInTheDocument();
  expect(source.play).toHaveBeenCalledWith("set-id", "puzzle-id");
  expect(screen.queryByText("Analyze my turn")).not.toBeInTheDocument();
  expect(window.localStorage.length).toBe(0);
});
it("Survival playtest reconnects to the existing recipient source with one rack and public log", async () => {
  source.read.mockResolvedValue(survivalFixture as SurvivalView);
  const reply = new Promise<any>((resolve) =>
    window.addEventListener(
      "dev-recipient-test",
      (event) => resolve((event as CustomEvent).detail),
      { once: true },
    ),
  );
  render(<DevelopmentSources roomId="survival:attempt:fixture" />);
  const { match } = await reply;
  expect(match.yourSide).toBe("B");
  expect(match.yourRack).toHaveLength(survivalFixture.rack.length);
  expect(JSON.stringify(match)).not.toMatch(/"(?:canonical|rackA|rackB|tilebag|seed|history)"\s*:/);
  expect(
    match.logs
      .filter((log: any) => log.side !== match.yourSide)
      .every((log: any) => !log.rackBefore && !log.rackAfter),
  ).toBe(true);
});
