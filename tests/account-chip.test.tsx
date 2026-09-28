import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, rpc } = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    rpc,
  },
}));

import { AccountChip, AuthGate, AuthProvider } from "../src/auth";
import { PrimaryNavigation } from "../src/app/shells/PrimaryNavigation";
import { LocaleProvider } from "../src/i18n/LocaleProvider";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { parseHash } from "../src/router";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE = {
  id: USER_ID,
  email: "ada@example.test",
  display_name: "Ada",
  status: "approved",
  is_admin: false,
  region_id: null,
  region_name: null,
};

function renderWithAccount(children: ReactNode) {
  return render(
    <LocaleProvider>
      <AuthProvider>{children}</AuthProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID } } } });
  rpc.mockReset().mockResolvedValue({ data: PROFILE, error: null });
});

afterEach(cleanup);

describe("the header account chip", () => {
  it("opens Me", async () => {
    renderWithAccount(<AccountChip />);
    const chip = await screen.findByRole("link", { name: "Your account: Ada" });
    expect(chip).toHaveAttribute("href", "#/me");
    expect(parseHash(chip.getAttribute("href")!).kind).toBe("me");
  });

  it("names itself in Thai when the player chose Thai", async () => {
    chooseLocale("th");
    renderWithAccount(<AccountChip />);
    expect(await screen.findByRole("link", { name: "บัญชีของคุณ: Ada" })).toHaveAttribute(
      "href",
      "#/me",
    );
  });

  it("leaves #/profile an address of its own", () => {
    expect(parseHash("#/profile")).toEqual({ kind: "profile" });
    // The old per-space statistics addresses still land on it too.
    expect(parseHash("#/public/stats")).toEqual({ kind: "profile" });
  });
});

describe("creating behind the approval gate", () => {
  it("offers no Create action to an account waiting for approval", async () => {
    rpc.mockResolvedValue({ data: { ...PROFILE, status: "pending" }, error: null });
    renderWithAccount(
      <AuthGate>
        <PrimaryNavigation />
      </AuthGate>,
    );
    expect(await screen.findByRole("heading", { name: "Approval pending" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Create game" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers it once the account is approved", async () => {
    renderWithAccount(
      <AuthGate>
        <PrimaryNavigation />
      </AuthGate>,
    );
    expect(await screen.findByRole("link", { name: "Create game" })).toBeVisible();
  });
});
