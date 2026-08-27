import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateRoomPage } from "../src/components/pages/pregame/CreateRoomPage";
import type { NewGameSettings } from "../src/game";
import type { CreateRoomPolicy } from "../src/remoteRooms";

// Locks the configuration each create path produces. The UI that collects
// these answers changed; the rooms it creates must not.

vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: null, userId: null }),
  AccountChip: () => null,
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null, AdminPage: () => null }));
vi.mock("../src/components/pages/lobby/useMembersCatalog", () => ({
  useMembersCatalog: () => ({ error: null, loading: false, members: [] }),
}));
vi.mock("../src/components/pages/lobby/useRegisteredPlayersCatalog", () => ({
  useRegisteredPlayersCatalog: () => ({ error: null, loading: false, players: [] }),
}));

afterEach(cleanup);

type Created = { settings: NewGameSettings; policy: CreateRoomPolicy };

async function createRoom(destination: RegExp, mode: RegExp): Promise<Created> {
  const user = userEvent.setup();
  const created: Created[] = [];
  const view = render(
    <CreateRoomPage
      canCreate
      createDisabledReason={null}
      visibility="public"
      regionAvailable
      regionId="region-1"
      regionName="North"
      submitting={false}
      onBack={vi.fn()}
      onCreate={(settings, policy) => created.push({ settings, policy })}
    />,
  );

  await user.click(view.getByRole("button", { name: destination }));
  await user.click(view.getByRole("button", { name: mode }));
  const form = view.getByRole("region", { name: "Room setup" });
  await user.click(within(form).getByRole("button", { name: /Create .*room|Start/i }));

  expect(created).toHaveLength(1);
  return created[0];
}

describe("create flow configuration", () => {
  it("public + match produces an open public versus room", async () => {
    const { settings, policy } = await createRoom(/^Public/, /^Match/);
    expect(settings.gameMode).toBe("versus");
    expect(settings.playerA).toBe("Player A");
    expect(settings.playerB).toBe("Player B");
    expect(settings.startingSide).toBe("A");
    expect(policy).toEqual({
      accessScope: "public",
      archivePolicy: "public",
      joinPolicy: "open",
      regionId: null,
    });
  });

  it("public + solo keeps the app-draws solo configuration", async () => {
    const { settings, policy } = await createRoom(/^Public/, /^Solo Practice/);
    expect(settings.gameMode).toBe("solo");
    // Solo seats are reserved, so the room is never open to joiners.
    expect(settings.tileDrawMode).toBe("play");
    expect(settings.startingSide).toBe("A");
    expect(settings.playerB).toBe("");
    expect(policy.joinPolicy).toBe("invite_only");
    expect(policy.accessScope).toBe("public");
  });

  it("region + match targets the region scope and archive", async () => {
    const { policy } = await createRoom(/^North/, /^Match/);
    expect(policy).toEqual({
      accessScope: "region",
      archivePolicy: "region",
      joinPolicy: "open",
      regionId: "region-1",
    });
  });

  it("private + match stays invite only and saves to the library", async () => {
    const { policy } = await createRoom(/^Private/, /^Match/);
    expect(policy).toEqual({
      accessScope: "private",
      archivePolicy: "private",
      joinPolicy: "invite_only",
      regionId: null,
    });
  });

  it("private + solo reserves the seat and the library slot", async () => {
    const { settings, policy } = await createRoom(/^Private/, /^Solo Practice/);
    expect(settings.gameMode).toBe("solo");
    expect(policy.accessScope).toBe("private");
    expect(policy.archivePolicy).toBe("private");
    expect(policy.joinPolicy).toBe("invite_only");
  });
});
