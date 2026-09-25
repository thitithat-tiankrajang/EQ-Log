import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SurvivalReplayViewer } from "../src/components/admin/SurvivalReplayViewer";
import type { SurvivalLevel } from "../src/features/survival/repository";
import poc from "../docs/survival-poc-results.json";

it("replays a winning game one turn at a time on the board", () => {
  const replay = poc.levels[0]!.winningReplays[0]! as SurvivalLevel["winning_replays"][number];
  render(<SurvivalReplayViewer replay={replay} />);
  expect(screen.getByText("ตำแหน่งเริ่มต้น")).toBeInTheDocument();
  const first = replay.actions[0]!;
  expect(first.type).toBe("place");
  const placed = first.move.placements![0]!;
  fireEvent.click(screen.getByRole("button", { name: "ตาถัดไป" }));
  expect(
    screen.getByTitle(
      `${String.fromCharCode(65 + (placed.cell % 15))}${Math.floor(placed.cell / 15) + 1}`,
    ),
  ).toHaveTextContent(placed.face);
  expect(screen.getByText(/ผู้เล่น:/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ตาถัดไป" }));
  expect(screen.getByText(/Authur:/)).toBeInTheDocument();
});
