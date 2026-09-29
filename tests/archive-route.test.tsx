import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const gameId = "77777777-7777-4777-8777-777777777777";
const mocked = vi.hoisted(() => ({ live: false }));

vi.mock("../src/router", () => ({
  useRoute: () => ({ kind: "play", roomId: "77777777-7777-4777-8777-777777777777" }),
}));
vi.mock("../src/supabaseClient", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: mocked.live ? { room_id: gameId } : null,
            error: null,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("../src/App", () => ({ default: () => <div>Live play</div> }));
vi.mock("../src/app/NonPlayApplication", () => ({ default: () => <div>Non-play</div> }));
vi.mock("../src/components/pages/ArchiveReplayPage", () => ({
  default: ({ initialReplay }: { initialReplay?: { archive: { name: string } } }) => (
    <div>Safe replay: {initialReplay?.archive.name ?? "fetched"}</div>
  ),
}));

import { AppRoot } from "../src/app/AppRoot";

describe("completed-game deep links", () => {
  beforeEach(() => {
    mocked.live = false;
  });

  it("routes a missing live row to the safe replay viewer", async () => {
    render(<AppRoot />);
    expect(await screen.findByText("Safe replay: fetched")).toBeInTheDocument();
  });

  it("hands a finalized live game directly to its safe projection", async () => {
    mocked.live = true;
    render(<AppRoot />);
    expect(await screen.findByText("Live play")).toBeInTheDocument();
    window.dispatchEvent(
      new CustomEvent("eq-lab:archive-replay-ready", {
        detail: { archive: { gameId, name: "Finished game" } },
      }),
    );
    await waitFor(() => expect(screen.getByText("Safe replay: Finished game")).toBeInTheDocument());
  });
});
