import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import {
  PlanGrantsAdminPanel,
  type AdminUserPlan,
} from "../src/components/admin/PlanGrantsAdminPanel";

const plusPlan: AdminUserPlan = {
  evaluated_at: "2027-01-01T00:00:00Z",
  effective: {
    plan_key: "plus",
    display_name: "EQ Plus",
    effective_start: "2027-01-01T00:00:00Z",
    effective_end: "2027-03-01T00:00:00Z",
    capabilities: { stage_plan_ceiling: { status: "decided", value: 40 } },
  },
  segments: [
    { plan_key: "plus", starts_at: "2027-01-01T00:00:00Z", ends_at: "2027-03-01T00:00:00Z" },
  ],
  passes: [
    {
      id: "pass-1",
      plan_key: "plus",
      kind: "grant",
      months: 2,
      source: "admin",
      activated_at: "2027-01-01T00:00:00Z",
      reason: "testing",
      revoked_at: null,
      revoked_by: null,
      revoke_reason: null,
    },
  ],
};

describe("Admin plan grants", () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "list_profiles_admin") {
        return {
          data: [
            { id: "u-1", email: "a@example.test", display_name: "Ada", status: "approved" },
            { id: "u-2", email: "p@example.test", display_name: "Pending", status: "pending" },
          ],
          error: null,
        };
      }
      if (name === "admin_get_user_plan") return { data: plusPlan, error: null };
      return { data: null, error: null };
    });
  });
  afterEach(cleanup);

  it("grants through the audited RPC with a reason and a request id, never an activation time", async () => {
    const user = userEvent.setup();
    render(<PlanGrantsAdminPanel />);

    await user.click(await screen.findByRole("combobox", { name: "Account" }));
    await user.click(await screen.findByRole("option", { name: /Ada/ }));
    expect(await screen.findByTestId("admin-plan-effective")).toHaveTextContent("EQ Plus");
    // Only approved accounts are offered.
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Grant/ }));
    const sheet = await screen.findByRole("dialog");
    await user.type(within(sheet).getByRole("textbox"), "QA pass");
    await user.click(within(sheet).getByRole("button", { name: "Grant" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_grant_plan", {
        target_user: "u-1",
        target_plan: "plus",
        target_months: 1,
        target_reason: "QA pass",
        target_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
  });

  it("offers no Plus to Pro upgrade while its terms are undecided", async () => {
    const user = userEvent.setup();
    render(<PlanGrantsAdminPanel />);
    await user.click(await screen.findByRole("combobox", { name: "Account" }));
    await user.click(await screen.findByRole("option", { name: /Ada/ }));
    expect(await screen.findByTestId("admin-plan-effective")).toHaveTextContent("EQ Plus");
    expect(screen.queryByRole("button", { name: /upgrade/i })).not.toBeInTheDocument();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("admin_upgrade_plus_to_pro");
  });
});
