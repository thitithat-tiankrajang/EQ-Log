import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/migrations/20260928120000_plan_timeline.sql`,
  "utf8",
);
const hardening = readFileSync(
  `${process.cwd()}/supabase/migrations/20260928110000_bot_catalog_privileges.sql`,
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", migration.indexOf("$$", start) + 2);
  return migration.slice(start, end);
}

describe("plan timeline migration", () => {
  it("counts calendar months on Bangkok's calendar from the chain anchor", () => {
    const addMonths = functionBody("plan_add_months");
    expect(addMonths).toContain(
      "(anchor at time zone 'Asia/Bangkok') + make_interval(months => n)",
    );
    expect(addMonths).not.toMatch(/interval '30 days'|\* 30/);

    const rebuild = functionBody("rebuild_plan_timeline");
    // Ends are always anchor + total months, never previous end + months.
    expect(rebuild).toContain("pro_end := public.plan_add_months(pro_anchor, pro_months)");
    expect(rebuild).toContain("plus_end := public.plan_add_months(plus_anchor, plus_months)");
    expect(rebuild).not.toMatch(/plan_add_months\((pro|plus)_end,/);
    // Replayed in recording order; reads neither the clock nor approval.
    expect(rebuild).toContain("order by p.activated_at, p.seq");
    expect(rebuild).not.toMatch(/\bnow\(\)|current_timestamp|clock_timestamp|profiles|status/);
  });

  it("encodes no Plus to Pro upgrade or conversion", () => {
    expect(migration).not.toMatch(/upgrade_conversion|converted_from|admin_upgrade_plus_to_pro/);
    expect(migration).toContain("kind text not null check (kind in ('grant'))");
    const grant = functionBody("admin_grant_plan");
    expect(grant).toContain("plus_active:");
    expect(grant).toContain("a Plus to Pro upgrade is not available until its terms are decided");
  });

  it("sets no product month range, only a technical range guard", () => {
    expect(migration).not.toMatch(/between 0 and 120|between 1 and 120|120\)/);
    expect(migration).toContain("constraint plan_pass_months_positive check (months >= 1)");
    const grant = functionBody("admin_grant_plan");
    expect(grant).toContain("if target_months is null or target_months < 1 then");
    expect(grant).toContain("technical guard: the plan timeline must end before year 10000");
    expect(grant).toContain(
      "exception when datetime_field_overflow or numeric_value_out_of_range or interval_field_overflow",
    );
  });

  it("refuses a reused request id with any different payload", () => {
    const grant = functionBody("admin_grant_plan");
    expect(grant).toContain("on conflict (idempotency_key) do nothing");
    for (const field of ["user_id", "plan_key", "months", "kind", "reason", "created_by"]) {
      expect(grant).toContain(`previous.${field} is distinct from`);
    }
    expect(grant).toContain("idempotency_conflict:");
  });

  it("allows only one complete revocation of an otherwise immutable fact", () => {
    expect(migration).toMatch(
      /revoked_at is not null and revoked_by is not null\s+and length\(btrim\(coalesce\(revoke_reason, ''\)\)\) between 1 and 500/,
    );
    const protect = functionBody("protect_plan_pass");
    expect(protect).toContain("plan passes are durable facts and cannot be deleted");
    expect(protect).toContain("if old.revoked_at is not null\n     or new.revoked_at is null");
    for (const column of [
      "seq",
      "user_id",
      "plan_key",
      "kind",
      "months",
      "source",
      "idempotency_key",
      "activated_at",
      "reason",
      "created_by",
      "created_at",
    ]) {
      expect(protect).toContain(`new.${column} is distinct from old.${column}`);
    }
  });

  it("seeds only decided capability values and resolves everything else fail-closed", () => {
    expect(migration).toContain("('free', 'stage_plan_ceiling', 'decided', '20'");
    expect(migration).toContain("('plus', 'stage_plan_ceiling', 'decided', '40'");
    expect(migration).toContain("('pro', 'stage_plan_ceiling', 'decided', '50'");
    expect(migration).toContain("('free', 'private_drive_limit', 'undecided', null");
    expect(migration).toContain("('plus', 'private_drive_limit', 'undecided', null");
    expect(migration).toContain("('pro', 'private_drive_limit', 'same_as', null, 'plus'");
    const resolve = functionBody("plan_capability");
    expect(resolve).toContain("if not found or row_.status = 'undecided' then");
    expect(resolve).toContain("jsonb_build_object('status', 'invalid')");
    expect(resolve).not.toMatch(/unlimited/);
  });

  it("gives no core feature a plan capability", () => {
    const defs = migration.slice(
      migration.indexOf("insert into public.plan_capability_defs"),
      migration.indexOf("on conflict (capability_key) do nothing;"),
    );
    expect(defs.match(/\('([a-z_]+)', '(integer|boolean)'/g)).toEqual([
      "('stage_plan_ceiling', 'integer'",
      "('private_drive_limit', 'integer'",
    ]);
    expect(defs).not.toMatch(/host|annotate|ranked|study|analysis|lock|bot/i);
  });

  it("keeps plan tables, their sequence and internal functions away from API roles", () => {
    expect(migration).toMatch(
      /revoke all on table public\.plan_catalog, public\.plan_capability_defs, public\.plan_capabilities,\s+public\.plan_passes, public\.plan_segments\s+from public, anon, authenticated, service_role;/,
    );
    expect(migration).toContain("pg_get_serial_sequence('public.plan_passes', 'seq')");
    for (const internal of [
      "plan_add_months(timestamptz, integer)",
      "rebuild_plan_timeline(uuid)",
      "plan_capability(text, text)",
      "plan_effective(uuid, timestamptz)",
    ]) {
      expect(migration).toContain(`revoke all on function public.${internal}`);
      expect(migration).not.toContain(`grant execute on function public.${internal}`);
    }
    // Every definer function pins pg_temp last.
    const definers = migration.match(/security definer set search_path = [^\n]+/g) ?? [];
    expect(definers.length).toBeGreaterThan(10);
    for (const line of definers) expect(line).toContain("search_path = public, pg_temp");
  });

  it("takes service_role off the Phase 1 bot tables and their sequence", () => {
    expect(hardening).toContain(
      "revoke all on table public.bot_catalog, public.bot_catalog_audit, public.room_creation_requests\n  from public, anon, authenticated, service_role;",
    );
    expect(hardening).toContain(
      "revoke all on sequence public.bot_catalog_audit_id_seq from public, anon, authenticated, service_role;",
    );
    expect(hardening).toContain("alter function public.derive_live_bot_config() security definer;");
    expect(hardening).not.toMatch(/\bgrant\b/);
  });
});
