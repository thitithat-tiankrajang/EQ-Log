import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/canonical_revision_migration.sql`,
  "utf8",
);
const revisionAclRepair = readFileSync(
  `${process.cwd()}/supabase/room_live_revision_acl_repair.sql`,
  "utf8",
);
const eventCascadeRepair = readFileSync(
  `${process.cwd()}/supabase/live_game_event_cascade_repair.sql`,
  "utf8",
);
const waitingRoomReadyRepair = readFileSync(
  `${process.cwd()}/supabase/waiting_room_ready_repair.sql`,
  "utf8",
);

function functionBody(name: string): string {
  const body = migration.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, "i"),
  )?.[0];
  expect(body, `${name} should be defined`).toBeTruthy();
  return body!;
}

describe("canonical revision migration", () => {
  it("runs as one transaction so a partial upgrade cannot be left behind", () => {
    const statements = migration
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    expect(statements[0]).toBe("begin;");
    expect(statements.at(-1)).toBe("commit;");
  });

  it("gives every live game an authoritative monotonic position", () => {
    expect(migration).toContain("add column if not exists revision bigint not null default 0");
    expect(migration).toContain("add column if not exists canonical jsonb");
    expect(migration).toContain("add column if not exists canonical_digest text");
  });

  it("keeps the opened-game read contract valid after adding revision", () => {
    expect(migration).toContain(
      "grant select (revision) on table public.room_live to authenticated",
    );
    expect(migration).not.toMatch(
      /grant select \([^)]*\b(?:canonical|canonical_digest)\b[^)]*\) on table public\.room_live to authenticated/i,
    );
  });

  it("provides a narrow repair for databases that already ran the migration", () => {
    expect(revisionAclRepair).toContain(
      "grant select (revision) on table public.room_live to authenticated",
    );
    expect(revisionAclRepair).not.toMatch(/grant select on table public\.room_live/i);
    expect(revisionAclRepair).toContain(
      "has_column_privilege(\n    'authenticated',\n    'public.room_live',\n    'revision',\n    'SELECT'",
    );
  });
});

describe("the committed event log", () => {
  it("is keyed by game and revision so ordering is a primary key, not a convention", () => {
    expect(migration).toContain("primary key (game_id, revision)");
    expect(migration).toContain("check (revision > 0)");
  });

  it("accepts a command id at most once per game", () => {
    expect(migration).toContain(
      "create unique index if not exists live_game_events_command_unique_idx",
    );
    expect(migration).toContain("on public.live_game_events (game_id, command_id)");
  });

  it("is append-only", () => {
    expect(migration).toContain("committed game events are immutable");
    expect(migration).toContain("before update on public.live_game_events");
    expect(migration).not.toMatch(/before[^;]*delete[^;]*on public\.live_game_events/i);
    expect(migration).toContain(
      "revoke all on table public.live_game_events from anon, authenticated, service_role",
    );
  });

  it("leaves event deletion to ACLs so every parent lifecycle cascade can complete", () => {
    const body = functionBody("reject_live_event_rewrite");
    expect(body).toContain("committed game events are immutable");
    expect(body).not.toContain("tg_op = 'DELETE'");

    expect(eventCascadeRepair).toContain(
      "create or replace function public.reject_live_event_rewrite",
    );
    expect(eventCascadeRepair).toContain("before update on public.live_game_events");
    expect(eventCascadeRepair).not.toMatch(/before[^;]*delete[^;]*on public\.live_game_events/i);
  });

  it("cascades away with its game so no orphan history survives", () => {
    expect(migration).toContain("references public.room_live(room_id) on delete cascade");
  });

  it("is readable only by accounts that may read the game, and writable by none", () => {
    expect(migration).toContain("alter table public.live_game_events enable row level security");
    expect(migration).toContain(
      "revoke all on table public.live_game_events from anon, authenticated, service_role",
    );
    expect(migration).toContain("grant select on table public.live_game_events to authenticated");
    expect(migration).toContain("using (public.can_read_live_game(game_id))");
  });
});

describe("commit_live_game_command", () => {
  const body = () => functionBody("commit_live_game_command");

  it("serializes commits for a game behind one row lock", () => {
    expect(body()).toContain("from public.room_live where room_id = target_game_id for update");
  });

  it("applies a command only against the revision it was composed on", () => {
    expect(body()).toContain("if live.revision is distinct from target_expected_revision then");
    expect(body()).toContain("return query select 'conflict'::text");
  });

  it("returns the earlier effect for a command id it has already committed", () => {
    expect(body()).toMatch(/where game_id = target_game_id and command_id = target_command_id/);
    expect(body()).toContain("return query select 'duplicate'::text");
  });

  it("records the event and moves the head in the same transaction", () => {
    const text = body();
    expect(text).toContain("insert into public.live_game_events");
    expect(text).toContain("set revision = next_revision");
    expect(text).toMatch(/next_revision := live\.revision \+ 1;/);
    // One update statement: state and revision can never disagree.
    expect(text.match(/update public\.room_live/g)).toHaveLength(1);
  });

  it("keeps a newly created versus room waiting so the other player can mark ready", () => {
    expect(body()).toMatch(
      /when coalesce\(target_state ->> 'roomStage', ''\) = 'waiting' then 'waiting'/,
    );
  });

  it("repairs both future commits and rooms already stranded as paused", () => {
    expect(waitingRoomReadyRepair).toMatch(
      /when coalesce\(target_state ->> 'roomStage', ''\) = 'waiting' then 'waiting'/,
    );
    expect(waitingRoomReadyRepair).toMatch(
      /update public\.room_live\s+set status = 'waiting'\s+where status = 'paused'\s+and state ->> 'roomStage' = 'waiting'/,
    );
    expect(waitingRoomReadyRepair).toContain(
      "grant execute on function public.commit_live_game_command",
    );
  });

  it("refuses writes from accounts without write access, which is every spectator", () => {
    expect(body()).toContain("if not public.can_write_live_game(target_game_id) then");
    expect(body()).toContain("live game write access required");
  });

  it("requires a stable command id and a known issuer", () => {
    expect(body()).toContain("a command must carry a stable id");
    expect(body()).toContain("target_issued_by not in ('A', 'B', 'host')");
  });

  it("is callable only by authenticated clients", () => {
    expect(migration).toContain(
      "revoke all on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)\n  from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.commit_live_game_command(uuid, bigint, text, text, jsonb, jsonb, text, jsonb, jsonb)\n  to authenticated",
    );
  });
});

describe("reading canonical truth", () => {
  it("serves one small head snapshot to joiners, refreshes and reconnects alike", () => {
    const body = functionBody("get_live_game_snapshot");
    expect(body).toContain("select l.revision, l.canonical, l.canonical_digest, l.status");
    expect(body).toContain("public.can_read_live_game(target_game_id)");
  });

  it("serves only the deltas a client is missing", () => {
    const body = functionBody("list_live_game_events");
    expect(body).toContain("e.revision > coalesce(target_since_revision, 0)");
    expect(body).toContain("order by e.revision");
    expect(body).toContain("limit least(greatest(coalesce(target_limit, 200), 1), 500)");
  });
});

describe("spectator fan-out", () => {
  it("publishes one bounded broadcast per committed move, not the full record", () => {
    const body = functionBody("broadcast_live_game_commit");
    expect(body).toContain("'game:' || target_game_id::text");
    expect(body).toContain("'canonical', head.canonical");
    expect(body).toContain("'revision', target_revision");
    // The fat record — history, per-turn board and rack copies — stays in the
    // database and is fetched only by whoever opens the replay.
    expect(body).not.toContain("head.state");
  });

  it("publishes only after the head has actually moved to that revision", () => {
    const body = functionBody("broadcast_live_game_commit");
    expect(body).toContain("if not found or head.revision is distinct from target_revision then");
    expect(functionBody("commit_live_game_command")).toContain(
      "perform public.broadcast_live_game_commit(",
    );
    // A trigger on the event insert would publish the previous revision's state.
    expect(migration).toContain("drop trigger if exists broadcast_live_game_event");
    expect(migration).not.toMatch(/create trigger broadcast_live_game_event/);
  });

  it("degrades safely where broadcast-from-database is unavailable", () => {
    expect(functionBody("broadcast_live_game_commit")).toContain(
      "if to_regproc('realtime.send') is null then",
    );
    expect(migration).toContain("if to_regclass('realtime.messages') is not null then");
  });

  it("authorizes a spectator once per topic rather than once per change", () => {
    expect(migration).toContain(
      "create policy live_game_broadcast_read on realtime.messages for select",
    );
    expect(migration).toContain(
      "public.can_read_live_game(nullif(split_part(topic, ':', 2), '')::uuid)",
    );
  });
});

describe("the unconditional write path is closed", () => {
  it("retires sync_live_game_state instead of leaving two sources of truth", () => {
    const body = functionBody("sync_live_game_state");
    expect(body).toContain("unconditional state writes are no longer accepted");
    expect(body).not.toContain("update public.room_live");
  });
});
