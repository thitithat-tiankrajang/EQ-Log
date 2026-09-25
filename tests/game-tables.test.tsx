import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveView } from "../src/components/pages/lobby/ArchiveView";
import { RoomsView, partitionLiveRooms } from "../src/components/pages/lobby/RoomsView";
import type { ArchiveGame } from "../src/features/gameRecords/repository";
import type { RoomMeta } from "../src/rooms";

vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: null }),
}));

function room(id: string, status: RoomMeta["status"], hasOpponent: boolean): RoomMeta {
  return {
    id,
    name: `Game ${id}`,
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    playerA: "Alice",
    playerB: "Bob",
    ownerName: "Creator Account",
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
  afterEach(cleanup);
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
    expect(screen.getAllByRole("columnheader", { name: "Created by" })).toHaveLength(2);
    expect(screen.getAllByText("Creator Account")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    fireEvent.click(screen.getByRole("button", { name: "View game" }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("shows the source account that created an archived game record", () => {
    const archivedGame = {
      gameId: "archive-1",
      regionId: null,
      creatorName: "Original Creator",
      name: "Finished game",
      playerA: "Alice",
      playerB: "Bob",
      gameMode: "versus",
      modeKey: "local_versus",
      turnNumber: 8,
      scoreA: 20,
      scoreB: 15,
      completionKind: "terminated",
      completionReason: "manual",
      surrenderedSide: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      finishedAt: "2026-08-10T00:30:00.000Z",
      archivedAt: "2026-08-10T00:30:00.000Z",
    } satisfies ArchiveGame & { creatorName: string };

    render(
      <ArchiveView
        games={[archivedGame]}
        total={1}
        loading={false}
        loadingMore={false}
        scope="public"
        onSave={vi.fn()}
      />,
    );

    const archiveTable = screen.getByRole("table", { name: "Game history" });
    expect(within(archiveTable).getByRole("columnheader", { name: "Created by" })).toBeVisible();
    expect(screen.getByText("Original Creator")).toBeVisible();
    expect(screen.getByRole("link", { name: /View replay/ })).toHaveAttribute(
      "href",
      "#/play/archive-1?from=public%2Fhistory",
    );
  });

  it("confirms a replay was saved and avoids duplicate saves", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <ArchiveView
        games={[
          {
            gameId: "archive-1",
            regionId: null,
            creatorName: "Alice",
            name: "Finished game",
            playerA: "Alice",
            playerB: "Bob",
            gameMode: "versus",
            modeKey: "local_versus",
            turnNumber: 8,
            scoreA: 20,
            scoreB: 15,
            completionKind: "natural",
            completionReason: "natural_finish",
            surrenderedSide: null,
            createdAt: "2026-08-10T00:00:00.000Z",
            finishedAt: "2026-08-10T00:30:00.000Z",
            archivedAt: "2026-08-10T00:30:00.000Z",
          },
        ]}
        total={1}
        loading={false}
        loadingMore={false}
        scope="public"
        onSave={onSave}
      />,
    );
    expect(screen.getByRole("link", { name: "Open replay Finished game" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save copy" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
