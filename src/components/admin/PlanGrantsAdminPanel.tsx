import { useEffect, useState } from "react";
import { Ban, Coins, Plus, RefreshCw } from "lucide-react";
import type { ProBotStatus } from "../../bot/catalog";
import { supabase } from "../../supabaseClient";
import type { Profile } from "../../auth";
import { SelectControl } from "../ui/SelectControl";
import { TextPromptSheet } from "../ui/Sheet";

type PaidPlan = "plus" | "pro";

/** The shape `admin_get_user_plan` returns. */
export type AdminUserPlan = {
  evaluated_at: string;
  effective: {
    plan_key: string;
    display_name: string;
    effective_start: string | null;
    effective_end: string | null;
    capabilities: Record<
      string,
      { status: "decided" | "undecided"; value?: unknown; via?: string[] }
    >;
  };
  segments: Array<{ plan_key: string; starts_at: string; ends_at: string }>;
  passes: Array<{
    id: string;
    plan_key: string;
    kind: "grant";
    months: number;
    source: string;
    activated_at: string;
    reason: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revoke_reason: string | null;
  }>;
};

const PLAN_LABEL: Record<string, string> = { free: "Free", plus: "EQ Plus", pro: "EQ Pro" };

function when(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" }) + " (Bangkok)";
}

type Pending =
  | { kind: "grant"; plan: PaidPlan; months: number }
  | { kind: "revoke"; passId: string }
  | { kind: "credits"; amount: number };

/** `admin_get_user_economy`: the user's Pro-Bot status plus recent ledger rows. */
export type AdminUserEconomy = ProBotStatus & {
  consumptions: Array<{
    id: string;
    room_id: string;
    bot_key: string;
    funding: "allowance" | "credit";
    plan_key_at_use: string;
    consumed_at: string;
  }>;
  credit_entries: Array<{
    id: string;
    delta: number;
    reason: string;
    note: string;
    balance_after: number;
    created_at: string;
  }>;
};

/**
 * Administrative plan grants: how EQ Plus and EQ Pro are tested before
 * payments exist. Every action is a durable, zero-price pass fact with a
 * reason, and goes through the same timeline as a purchase will. Not a trial.
 */
export function PlanGrantsAdminPanel() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userId, setUserId] = useState("");
  const [plan, setPlan] = useState<AdminUserPlan | null>(null);
  const [grantPlan, setGrantPlan] = useState<PaidPlan>("plus");
  const [months, setMonths] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  // One id per intended grant: a double submit or a retry cannot grant twice.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [economy, setEconomy] = useState<AdminUserEconomy | null>(null);
  const [creditAmount, setCreditAmount] = useState(1);
  const [creditRequestId, setCreditRequestId] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("list_profiles_admin").then(({ data, error: loadError }) => {
      if (loadError) setError(loadError.message);
      else setProfiles(((data ?? []) as Profile[]).filter((p) => p.status === "approved"));
    });
  }, []);

  async function loadPlan(target: string) {
    if (!supabase || !target) return;
    setError(null);
    const { data, error: loadError } = await supabase.rpc("admin_get_user_plan", {
      target_user: target,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setPlan(data as AdminUserPlan);
    const { data: economyData, error: economyError } = await supabase.rpc(
      "admin_get_user_economy",
      { target_user: target },
    );
    if (economyError) setError(economyError.message);
    else setEconomy(economyData as AdminUserEconomy);
  }

  useEffect(() => {
    setPlan(null);
    setEconomy(null);
    if (userId) void loadPlan(userId);
  }, [userId]);

  async function run(action: Pending, reason: string) {
    if (!supabase || !userId) return;
    setBusy(true);
    setError(null);
    const { error: actionError } =
      action.kind === "grant"
        ? await supabase.rpc("admin_grant_plan", {
            target_user: userId,
            target_plan: action.plan,
            target_months: action.months,
            target_reason: reason,
            target_request_id: requestId,
          })
        : action.kind === "credits"
          ? await supabase.rpc("admin_grant_credits", {
              target_user: userId,
              target_amount: action.amount,
              target_reason: reason,
              target_request_id: creditRequestId,
            })
          : await supabase.rpc("admin_revoke_pass", {
              target_pass: action.passId,
              target_reason: reason,
            });
    setBusy(false);
    if (actionError) {
      setError(actionError.message);
      return;
    }
    if (action.kind === "grant") setRequestId(crypto.randomUUID());
    if (action.kind === "credits") setCreditRequestId(crypto.randomUUID());
    await loadPlan(userId);
  }

  const effective = plan?.effective;

  return (
    <section className="eq-section eq-feature-section" aria-labelledby="admin-plans-title">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">Administrative grants · no payment</span>
          <h2 id="admin-plans-title">Plans</h2>
          <p>Grant EQ Plus or EQ Pro months to an approved account. Every grant needs a reason.</p>
        </div>
        {userId && (
          <button
            className="eq-button eq-button-secondary"
            type="button"
            onClick={() => void loadPlan(userId)}
          >
            <RefreshCw aria-hidden size={16} /> Refresh
          </button>
        )}
      </div>

      {error && (
        <div className="eq-alert eq-alert-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="eq-compact-field">
        <span id="admin-plan-user-label">Account</span>
        <SelectControl<string>
          id="admin-plan-user"
          ariaLabelledBy="admin-plan-user-label"
          value={userId}
          placeholder="Choose an approved account"
          options={profiles.map((p) => ({
            value: p.id,
            label: `${p.display_name ?? "Name not set"} · ${p.email}`,
          }))}
          onChange={(value) => setUserId(value)}
        />
      </div>

      {effective && (
        <>
          <div className="eq-state" data-testid="admin-plan-effective">
            <h3>{PLAN_LABEL[effective.plan_key] ?? effective.display_name}</h3>
            <p>
              {effective.plan_key === "free"
                ? effective.effective_end
                  ? `Free until ${when(effective.effective_end)}`
                  : "Free"
                : `Until ${when(effective.effective_end)}`}
            </p>
          </div>

          <form
            className="eq-admin-row-actions"
            onSubmit={(event) => {
              event.preventDefault();
              setPending({ kind: "grant", plan: grantPlan, months });
            }}
          >
            <SelectControl<PaidPlan>
              ariaLabel="Plan to grant"
              value={grantPlan}
              options={[
                { value: "plus", label: "EQ Plus" },
                { value: "pro", label: "EQ Pro" },
              ]}
              onChange={(value) => value && setGrantPlan(value)}
            />
            <label className="eq-compact-field">
              <span>Months</span>
              <input
                type="number"
                min={1}
                value={months}
                onChange={(event) => setMonths(Number(event.target.value))}
              />
            </label>
            <button className="eq-button eq-button-primary" type="submit" disabled={busy}>
              <Plus size={15} /> Grant
            </button>
          </form>

          <h3>Timeline</h3>
          <ul data-testid="admin-plan-segments">
            {plan.segments.map((s) => (
              <li key={`${s.plan_key}-${s.starts_at}`}>
                {PLAN_LABEL[s.plan_key] ?? s.plan_key}: {when(s.starts_at)} → {when(s.ends_at)}
              </li>
            ))}
          </ul>

          {economy && (
            <section aria-labelledby="admin-probot-title" data-testid="admin-probot">
              <h3 id="admin-probot-title">Pro-Bot</h3>
              <p>
                Allowance {economy.allowance.available}/{economy.allowance.capacity} (
                {economy.allowance.reason}) · week {economy.weekly.used}/{economy.weekly.cap} ·
                Credits {economy.credits} · boards {economy.boards.active}/
                {economy.boards.limit ?? "–"}
              </p>
              <form
                className="eq-admin-row-actions"
                onSubmit={(event) => {
                  event.preventDefault();
                  setPending({ kind: "credits", amount: creditAmount });
                }}
              >
                <label className="eq-compact-field">
                  <span>Credits to grant</span>
                  <input
                    type="number"
                    min={1}
                    value={creditAmount}
                    onChange={(event) => setCreditAmount(Number(event.target.value))}
                  />
                </label>
                <button className="eq-button eq-button-primary" type="submit" disabled={busy}>
                  <Coins size={15} /> Grant Credits
                </button>
              </form>
              <ul>
                {economy.credit_entries.map((entry) => (
                  <li key={entry.id}>
                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta} · {entry.reason}
                    {entry.note ? ` · ${entry.note}` : ""} · balance {entry.balance_after} ·{" "}
                    {when(entry.created_at)}
                  </li>
                ))}
                {economy.consumptions.map((c) => (
                  <li key={c.id}>
                    {c.bot_key} · {c.funding} · {c.plan_key_at_use} · {when(c.consumed_at)}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <h3>Pass facts</h3>
          <div className="eq-admin-users">
            {plan.passes.map((p) => (
              <article className="eq-admin-user" key={p.id}>
                <div className="eq-admin-identity">
                  <div>
                    <strong>
                      {PLAN_LABEL[p.plan_key] ?? p.plan_key} · {p.months} mo
                    </strong>
                    <small>
                      {when(p.activated_at)} · {p.source} · {p.reason}
                    </small>
                    {p.revoked_at && <small>Revoked: {p.revoke_reason}</small>}
                  </div>
                </div>
                <span className={`eq-status eq-status-${p.revoked_at ? "blocked" : "approved"}`}>
                  {p.revoked_at ? "revoked" : "active fact"}
                </span>
                {!p.revoked_at && (
                  <div className="eq-admin-row-actions">
                    <button
                      className="eq-button eq-button-danger"
                      type="button"
                      disabled={busy}
                      onClick={() => setPending({ kind: "revoke", passId: p.id })}
                    >
                      <Ban size={15} /> Revoke
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}

      <TextPromptSheet
        open={pending !== null}
        title={
          pending?.kind === "grant"
            ? `Grant ${pending.months} month(s) of ${PLAN_LABEL[pending.plan]}?`
            : pending?.kind === "credits"
              ? `Grant ${pending.amount} Pro-Bot Credit(s)?`
              : "Revoke this pass?"
        }
        label="Reason (kept with the pass)"
        initialValue=""
        submitLabel={
          pending?.kind === "grant"
            ? "Grant"
            : pending?.kind === "credits"
              ? "Grant Credits"
              : "Revoke"
        }
        onCancel={() => setPending(null)}
        onSubmit={(reason) => {
          const action = pending;
          setPending(null);
          if (action) void run(action, reason);
        }}
      />
    </section>
  );
}
