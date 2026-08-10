import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RoomsView, partitionLiveRooms } from "../src/components/pages/lobby/RoomsView";
import type { RoomMeta } from "../src/rooms";

function room(id: string, status: RoomMeta["status"], hasOpponent: boolean): RoomMeta {
  return {
    id,
    name: `Game ${id}`,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    playerA: "Alice",
    playerB: "Bob",
    gameMode: "versus",
    turnNumber: 4,
    scoreA: 10,
    scoreB: 8,
    status,
    visibility: "public",
    joinPolicy: "open",
    hasOpponent,
  };
}

describe("public and region game tables", () => {
  it("separates open seats from matched games and excludes finished games", () => {
    const open = room("open", "draft", false);
    const waitingMatched = room("waiting-matched", "draft", true);
    const playing = room("playing", "playing", false);
    const finished = room("finished", "finished", true);

    expect(partitionLiveRooms([open, waitingMatched, playing, finished])).toEqual({
      openSeats: [open],
      matched: [waitingMatched, playing],
    });
  });

  it("opens or joins only from explicit row action buttons", () => {
    const onOpen = vi.fn();
    render(
      <RoomsView
        rooms={[room("open", "draft", false), room("matched", "draft", true)]}
        loading={false}
        getRoomRole={() => ({ canManage: false, canCreate: true, label: "Spectator" })}
        onOpen={onOpen}
        onJoinWithCode={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByRole("table", { name: "Waiting for an opponent" })).toBeVisible();
    expect(screen.getByRole("table", { name: "Matched & in progress" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Finished" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More filters" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    fireEvent.click(screen.getByRole("button", { name: "View game" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
