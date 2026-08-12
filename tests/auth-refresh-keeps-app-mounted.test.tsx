// A token refresh must not take the application off screen.
//
// This is the root cause of a bug that looked nothing like an auth problem: a
// player pressed Analyze, switched to another tab, came straight back, and the
// progress bar was gone — while the engine went on burning CPU on an answer that
// could no longer be delivered, and their analysis budget stayed spent.
//
// The chain: Supabase refreshes the session whenever the tab regains focus and
// raises `TOKEN_REFRESHED`. The provider answered every auth event by reloading
// the profile, and reloading the profile raised `profileLoading`, and `AuthGate`
// renders a splash INSTEAD of its children while that flag is up. So returning
// to the tab unmounted the whole game and mounted a fresh one — every ref reset,
// the position re-seeded from cache, and the shell committed that seed back as a
// revision the player never caused. A new revision retires the engine work keyed
// to the old one.
//
// So the property pinned here is deliberately about IDENTITY, not appearance:
// the children must be the SAME mount throughout, because remounting is the
// whole failure. Asserting only that the text is still present would pass
// against the bug.
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, rpc, authStateHandlers } = vi.hoisted(() => ({
  getSession: vi.fn(),
  rpc: vi.fn(),
  authStateHandlers: [] as Array<(event: string, session: unknown) => void>,
}));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: vi.fn((handler: (event: string, session: unknown) => void) => {
        authStateHandlers.push(handler);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    rpc,
  },
}));

import { AuthGate, AuthProvider } from "../src/auth";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION = { user: { id: USER_ID }, access_token: "token-1" };
const PROFILE = {
  id: USER_ID,
  email: "owner@example.test",
  display_name: "Owner",
  status: "approved",
  is_admin: false,
  region_id: null,
  region_name: null,
};

/** Counts how many times it has been MOUNTED, and holds a value across renders
 *  the way the game shell holds its refs. A remount resets the ref and bumps the
 *  count; a mere re-render does neither. */
function MountWitness({ onMount }: { onMount: () => void }) {
  const survived = useRef(Math.random());
  const [seen] = useState(() => {
    onMount();
    return survived.current;
  });
  useEffect(() => undefined, []);
  return <div data-testid="witness">{`instance:${seen}`}</div>;
}

afterEach(cleanup);
beforeEach(() => {
  authStateHandlers.length = 0;
  getSession.mockReset().mockResolvedValue({ data: { session: SESSION } });
  rpc.mockReset().mockResolvedValue({ data: PROFILE, error: null });
});

describe("a session refresh while the game is on screen", () => {
  it("keeps the same mount alive through TOKEN_REFRESHED", async () => {
    const mounts = vi.fn();
    render(
      <AuthProvider>
        <AuthGate>
          <MountWitness onMount={mounts} />
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("witness")).toBeInTheDocument());
    const firstInstance = screen.getByTestId("witness").textContent;
    expect(mounts).toHaveBeenCalledTimes(1);

    // The profile fetch must be IN FLIGHT while we look, or this test proves
    // nothing: an instantly-resolved mock lets React collapse the loading flag
    // up and down inside one commit, so the splash never renders and even the
    // broken version looks fine. A real fetch takes a network round trip, and
    // that whole window is time the application spends unmounted.
    let finishRefresh!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise((resolve) => (finishRefresh = resolve)));

    // Coming back to the tab. Supabase refreshes the session for the SAME user.
    await act(async () => {
      for (const handler of authStateHandlers) handler("TOKEN_REFRESHED", SESSION);
      await Promise.resolve();
    });

    // Never replaced by the account splash, and never rebuilt.
    expect(screen.queryByText("Checking account…")).not.toBeInTheDocument();
    expect(screen.getByTestId("witness").textContent).toBe(firstInstance);
    expect(mounts).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRefresh({ data: PROFILE, error: null });
      await Promise.resolve();
    });
    // And still the same mount once the refresh lands.
    expect(screen.getByTestId("witness").textContent).toBe(firstInstance);
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("refreshes the profile in the background rather than skipping it", async () => {
    render(
      <AuthProvider>
        <AuthGate>
          <MountWitness onMount={() => undefined} />
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("witness")).toBeInTheDocument());
    const callsAfterMount = rpc.mock.calls.length;

    await act(async () => {
      for (const handler of authStateHandlers) handler("TOKEN_REFRESHED", SESSION);
      await Promise.resolve();
    });

    // Silent means "do not block on it", not "do not do it": an account whose
    // approval was revoked must still stop being approved here.
    expect(rpc.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("still checks the account when a DIFFERENT user signs in", async () => {
    const mounts = vi.fn();
    render(
      <AuthProvider>
        <AuthGate>
          <MountWitness onMount={mounts} />
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("witness")).toBeInTheDocument());

    // A different person. Their approval is genuinely unknown, so showing the
    // previous player's game while it is fetched would be wrong.
    let resolveProfile!: (value: unknown) => void;
    rpc.mockImplementation(() => new Promise((resolve) => (resolveProfile = resolve)));
    const otherSession = { user: { id: "22222222-2222-4222-8222-222222222222" } };
    await act(async () => {
      for (const handler of authStateHandlers) handler("SIGNED_IN", otherSession);
      await Promise.resolve();
    });

    expect(screen.getByText("Checking account…")).toBeInTheDocument();
    expect(screen.queryByTestId("witness")).not.toBeInTheDocument();
    await act(async () => {
      resolveProfile({ data: PROFILE, error: null });
      await Promise.resolve();
    });
  });
});
