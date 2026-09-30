/** Service-only bounded dry run / migration. Never returns replay bytes. */
import { createClient } from "npm:@supabase/supabase-js@2";
import { readCompletedGame } from "../../../src/completedGame/record.ts";
import { projectStoredCompletedGame } from "../../../src/completedGame/projection.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  if (request.headers.get("Authorization") !== `Bearer ${serviceKey}`)
    return respond({ error: "Service authorization required." }, 403);
  try {
    const body = (await request.json()) as {
      userId?: unknown;
      dryRun?: unknown;
      cursor?: { at?: unknown; id?: unknown; activeAfter?: unknown; capacity?: unknown };
      limit?: unknown;
    };
    const userId = body.userId;
    const limit = body.limit === undefined ? 25 : body.limit;
    const cursor = body.cursor;
    const dryRun = body.dryRun !== false;
    if (
      typeof userId !== "string" ||
      !uuid.test(userId) ||
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (cursor &&
        (typeof cursor.at !== "string" ||
          !Number.isFinite(Date.parse(cursor.at)) ||
          typeof cursor.id !== "string" ||
          !uuid.test(cursor.id) ||
          (dryRun &&
            (!Number.isInteger(cursor.activeAfter) ||
              Number(cursor.activeAfter) < 0 ||
              !Number.isInteger(cursor.capacity)))))
    )
      return respond({ error: "Invalid migration page." }, 400);
    const candidates = await db.rpc("list_private_migration_candidates", {
      p_user_id: userId,
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: limit,
    });
    if (candidates.error) throw candidates.error;
    const context = await db.rpc("saved_migration_context", { p_user_id: userId });
    if (context.error) throw context.error;
    const capacity = Number(context.data?.[0]?.capacity);
    if (dryRun && cursor && cursor.capacity !== capacity)
      return respond({ error: "Saved capacity changed; restart the dry run." }, 409);
    let simulatedActive =
      dryRun && cursor ? Number(cursor.activeAfter) : Number(context.data?.[0]?.active_count ?? 0);
    const counts = {
      eligible: 0,
      active: 0,
      overflow: 0,
      trashed: 0,
      inProgressExcluded: cursor ? 0 : Number(context.data?.[0]?.in_progress_count ?? 0),
      ambiguousExcluded: 0,
      duplicateSkipped: 0,
      alreadyProcessed: 0,
    };
    for (const row of candidates.data ?? []) {
      if (row.ledger_outcome) {
        counts.alreadyProcessed++;
        continue;
      }
      if (row.saved_state) {
        counts.duplicateSkipped++;
        continue;
      }
      if (
        row.source_scope !== "private" ||
        row.source_id !== row.game_id ||
        !row.participant_side ||
        !row.snapshot ||
        row.snapshot.v !== 3 ||
        row.snapshot.status !== "finished"
      ) {
        counts.ambiguousExcluded++;
        continue;
      }
      try {
        const decoded = await readCompletedGame(JSON.stringify(row.snapshot));
        if (decoded.game.status !== "finished") throw new Error("not a complete v3 replay");
        const side = row.participant_side as "A" | "B";
        const other = side === "A" ? "B" : "A";
        if (
          (row.score_for !== null && decoded.game.scores[side] !== row.score_for) ||
          (row.score_against !== null && decoded.game.scores[other] !== row.score_against)
        )
          throw new Error("result mismatch");
        await projectStoredCompletedGame(
          row.snapshot,
          { scope: "private", ownerId: userId, participantIds: [], published: false },
          { userId, regionIds: [], approved: false, admin: false },
        );
      } catch {
        counts.ambiguousExcluded++;
        continue;
      }
      counts.eligible++;
      if (dryRun) {
        if (row.trashed_at) counts.trashed++;
        else if (simulatedActive < capacity) {
          counts.active++;
          simulatedActive++;
        } else counts.overflow++;
      } else {
        const migrated = await db.rpc("migrate_validated_private_item", {
          p_item_id: row.item_id,
          p_digest: row.source_digest,
        });
        if (migrated.error) throw migrated.error;
        const outcome = migrated.data?.[0]?.outcome as keyof typeof counts;
        if (outcome === "active" || outcome === "overflow" || outcome === "trashed")
          counts[outcome]++;
        else counts.duplicateSkipped++;
      }
    }
    const rows = candidates.data ?? [];
    const last = rows.at(-1);
    return respond({
      dryRun,
      counts,
      capacity,
      nextCursor:
        rows.length === limit && last
          ? { at: last.created_at, id: last.item_id, activeAfter: simulatedActive, capacity }
          : null,
    });
  } catch (error) {
    console.error("Saved legacy migration failed", error);
    return respond({ error: "Migration page failed; no later page was run." }, 500);
  }
});
