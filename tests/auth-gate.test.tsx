import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, signInWithOAuth } = vi.hoisted(() => ({
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signInWithOAuth,
      signOut: vi.fn(),
    },
  },
}));

import { AuthGate, AuthProvider } from "../src/auth";

describe("AuthGate", () => {
  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: null } });
  });

  it("does not mount remote game data routes for a signed-out visitor", async () => {
    render(
      <AuthProvider>
        <AuthGate>
          <div>Protected game data route</div>
        </AuthGate>
      </AuthProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeVisible();
    expect(screen.queryByText("Protected game data route")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
  });
});
