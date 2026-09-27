import { useEffect, useState } from "react";
import { Ban, Check, RefreshCw } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { TextPromptSheet } from "../ui/Sheet";

/** One row of `admin_list_bots()`. */
export type AdminBotRow = {
  bot_key: string;
  display_name: string;
  engine_family: string;
  difficulty: string;
  mode_key: string;
  execution_type: "CLIENT" | "SERVER" | "HYBRID";
  access_tier: "free" | "pro";
  access_tier_status: "provisional" | "decided";
  enabled: boolean;
  new_rooms_allowed: boolean;
  lifecycle: "active" | "pending" | "retired";
  config_version: number;
  sort_order: number;
  updated_at: string;
  live_rooms: number;
};

const LIFECYCLE_LABEL: Record<AdminBotRow["lifecycle"], string> = {
  active: "Active product",
  pending: "Disabled · awaiting Phase 3b",
  retired: "Retired · legacy rooms only",
};

const EXECUTION_LABEL: Record<AdminBotRow["execution_type"], string> = {
  CLIENT: "Runs on the player's device",
  SERVER: "Runs on the engine server",
  HYBRID: "Browser or server",
};

/**
 * The Admin Bot Collection.
 *
 * Every bot a room can name, read from `bot_catalog` through `admin_list_bots`.
 * The one action here is the hard switch: disabling refuses new games with the
 * bot and pauses the bot's turns in every existing game until it is enabled
 * again. Each switch asks for a reason, which the database keeps in the audit.
 *
 * Access tier is shown, not edited: the seeded tiers are a backward-
 * compatibility default ("provisional") until the Product Owner classifies the
 * bots.
 */
export function BotCollectionAdminPanel() {
  const [rows, setRows] = useState<AdminBotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, setPending] = useState<AdminBotRow | null>(null);

  async function load() {
    if (!supabase) return;
    setError(null);
    const { data, error: loadError } = await supabase.rpc("admin_list_bots");
    if (loadError) {
      setError(loadError.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as AdminBotRow[]);
  }

  useEffect(() => {
    void load();
  }, []);

  async function setEnabled(row: AdminBotRow, enabled: boolean, reason: string) {
    if (!supabase) return;
    setBusyKey(row.bot_key);
    setError(null);
    const { error: updateError } = await supabase.rpc("admin_set_bot_enabled", {
      target_bot_key: row.bot_key,
      target_enabled: enabled,
      target_reason: reason,
    });
    setBusyKey(null);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  return (
    <section className="eq-section eq-feature-section" aria-labelledby="admin-bots-title">
      <div className="eq-section-heading eq-section-heading-actions">
        <div>
          <span className="eq-eyebrow">Catalog</span>
          <h2 id="admin-bots-title">Bots</h2>
          <p>{rows?.length ?? 0} bots</p>
        </div>
        <button className="eq-button eq-button-secondary" type="button" onClick={() => void load()}>
          <RefreshCw aria-hidden size={16} /> Refresh
        </button>
      </div>

      {error && (
        <div className="eq-alert eq-alert-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      {rows === null ? (
        <div className="eq-state">
          <p>Loading bots…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="eq-state">
          <h3>No bots</h3>
          <p>The bot catalog is empty or could not be read.</p>
        </div>
      ) : (
        <div className="eq-admin-users">
          {rows.map((row) => (
            <article className="eq-admin-user" key={row.bot_key} data-bot-key={row.bot_key}>
              <div className="eq-admin-identity">
                <span className="eq-avatar" aria-hidden>
                  {row.display_name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{row.display_name}</strong>
                  <small>
                    {row.bot_key} · {row.engine_family} {row.difficulty} ·{" "}
                    {EXECUTION_LABEL[row.execution_type]}
                  </small>
                  <small>
                    {row.access_tier === "pro" ? "Pro" : "Free"}
                    {row.access_tier_status === "provisional"
                      ? " (provisional default)"
                      : ""} · {LIFECYCLE_LABEL[row.lifecycle]} ·{" "}
                    {row.new_rooms_allowed ? "open to new games" : "closed to new games"} ·{" "}
                    {row.live_rooms} rooms
                  </small>
                </div>
              </div>
              <span className={`eq-status eq-status-${row.enabled ? "approved" : "blocked"}`}>
                {row.enabled ? "enabled" : "disabled"}
              </span>
              <div className="eq-admin-row-actions">
                <button
                  className={`eq-button ${row.enabled ? "eq-button-danger" : "eq-button-primary"}`}
                  type="button"
                  disabled={busyKey === row.bot_key || (row.lifecycle === "pending" && !row.enabled)}
                  title={
                    row.lifecycle === "pending" && !row.enabled
                      ? "Not playable yet (awaiting its client, Phase 3b)"
                      : undefined
                  }
                  onClick={() => setPending(row)}
                >
                  {row.enabled ? (
                    <>
                      <Ban size={15} /> Disable
                    </>
                  ) : (
                    <>
                      <Check size={15} /> Enable
                    </>
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <TextPromptSheet
        open={pending !== null}
        title={
          pending?.enabled
            ? `Disable ${pending.display_name}?`
            : `Enable ${pending?.display_name ?? "bot"}?`
        }
        label={
          pending?.enabled
            ? "Reason (kept in the audit). New games are refused and existing games pause on the bot's turn."
            : "Reason (kept in the audit). Paused games continue from where they stopped."
        }
        initialValue=""
        submitLabel={pending?.enabled ? "Disable bot" : "Enable bot"}
        onCancel={() => setPending(null)}
        onSubmit={(reason) => {
          const row = pending;
          setPending(null);
          if (row) void setEnabled(row, !row.enabled, reason);
        }}
      />
    </section>
  );
}
