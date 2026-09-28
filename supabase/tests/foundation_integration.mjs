// Platform Foundation integration against a LOCAL Supabase stack (`supabase
// start`): the real Ranked Edge Function bundle, PostgREST, Auth and the
// migrated database, driven through supabase-js as signed-in players.
//
//   LOCAL_SUPABASE_URL=http://127.0.0.1:54321 \
//   LOCAL_SUPABASE_ANON_KEY=... LOCAL_SUPABASE_SERVICE_ROLE_KEY=... \
//   node supabase/tests/foundation_integration.mjs
//
// Never point this at a hosted project: it creates users and grants plans.
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL ?? "";
const anonKey = process.env.LOCAL_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey || !serviceKey) {
  console.error(
    "Refusing to run: LOCAL_SUPABASE_URL must be a local http://127.0.0.1:<port> stack.",
  );
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, serviceKey, options);
const run = Date.now().toString(36);
let failures = 0;
let passes = 0;

function check(label, condition, detail) {
  if (condition) {
    passes += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${error.message} (${error.code ?? "no code"})`);
  return data;
}

/** A signed-in player: their own supabase-js client, as the browser has it. */
async function player(tag, { status = "approved", name = tag } = {}) {
  const email = `${tag}-${run}@foundation.test`;
  const password = `pw-${run}-${tag}`;
  const user = await must(admin.auth.admin.createUser({ email, password, email_confirm: true }));
  await must(
    admin
      .from("profiles")
      .update({ status, display_name: `${name} ${run}` })
      .eq("id", user.user.id),
  );
  const client = createClient(url, anonKey, options);
  await must(client.auth.signInWithPassword({ email, password }));
  return { id: user.user.id, name: `${name} ${run}`, client };
}

/** The Ranked function exactly as the browser calls it; errors come back as data. */
async function ranked(who, body) {
  const { data, error } = await who.client.functions.invoke("ranked", { body });
  if (!error) return { status: 200, body: data };
  const response = error.context;
  const detail = response instanceof Response ? await response.json().catch(() => null) : null;
  return { status: response?.status ?? 0, body: detail ?? { error: error.message } };
}

async function rating(id) {
  const row = await must(
    admin.from("ranked_ratings").select("rating").eq("player_id", id).maybeSingle(),
  );
  return row?.rating ?? 1000;
}

async function setRating(id, value) {
  await must(admin.from("ranked_ratings").upsert({ player_id: id, rating: value }));
}

async function matchRow(id) {
  return must(admin.from("ranked_matches").select("*").eq("id", id).maybeSingle());
}

/** Matched or playing Ranked matches the player sits in (C7's "active"). */
async function activeCount(id) {
  const rows = await must(
    admin
      .from("ranked_matches")
      .select("id")
      .in("status", ["matched", "playing"])
      .or(`player_a_id.eq.${id},player_b_id.eq.${id}`),
  );
  return rows.length;
}

async function main() {
  console.log(`Foundation integration run ${run} against ${url}`);
  const a = await player("alice");
  const b = await player("bob");
  const c = await player("carol");
  const pending = await player("pat", { status: "pending" });
  const anon = { client: createClient(url, anonKey, options) };

  console.log("Edge Function gatekeeping");
  let res = await ranked(anon, { operation: "list" });
  check(
    "unauthenticated is refused with sign_in_required",
    res.status === 401 && res.body.code === "sign_in_required",
    res,
  );
  res = await ranked(pending, { operation: "list" });
  check(
    "unapproved account is refused with approval_required",
    res.status === 403 && res.body.code === "approval_required",
    res,
  );
  res = await ranked(a, { operation: "nope" });
  check(
    "unknown operation is refused",
    res.status === 400 && res.body.code === "ranked_invalid_request",
    res,
  );

  console.log("supabase-js .rpc(...).single() against the real database");
  // A waiting room for the RPC checks, written by the function itself.
  res = await ranked(c, { operation: "create", minutesA: 10, minutesB: 10 });
  check("C creates a Ranked room", res.status === 200 && res.body.match?.status === "waiting", res);
  const rpcRoom = res.body.match.id;
  const stakesSingle = await admin
    .rpc("ranked_stakes", { target_match_id: rpcRoom, target_player_id: b.id })
    .single();
  check(
    "ranked_stakes .single() returns one object with a basis",
    !stakesSingle.error &&
      !Array.isArray(stakesSingle.data) &&
      /^rs1:/.test(stakesSingle.data?.basis ?? ""),
    stakesSingle,
  );
  const stakesError = await admin
    .rpc("ranked_stakes", { target_match_id: rpcRoom, target_player_id: c.id })
    .single();
  check(
    "ranked_stakes .single() surfaces a snake_code refusal as error.message",
    Boolean(stakesError.error) && /^ranked_own_room:/.test(stakesError.error.message),
    stakesError.error,
  );
  const claimStale = await admin
    .rpc("ranked_claim_match_v2", {
      target_match_id: rpcRoom,
      target_player_id: b.id,
      target_player_name: b.name,
      target_stakes_basis: "rs1:stale",
      target_now: new Date().toISOString(),
    })
    .single();
  check(
    "ranked_claim_match_v2 .single() refuses a stale basis with ranked_stakes_changed",
    Boolean(claimStale.error) && /^ranked_stakes_changed:/.test(claimStale.error.message),
    claimStale.error,
  );
  check("…and claims nothing", (await matchRow(rpcRoom)).player_b_id === null);
  res = await ranked(c, { operation: "cancel", id: rpcRoom });
  check("C cancels the RPC-check room", res.status === 200 && res.body.cancelled === true, res);

  console.log("Real Ranked flow");
  res = await ranked(a, { operation: "create", minutesA: 10, minutesB: 10 });
  check("A creates a Ranked room", res.status === 200 && res.body.match?.status === "waiting", res);
  const room = res.body.match.id;
  res = await ranked(a, { operation: "create", minutesA: 10, minutesB: 10 });
  check(
    "A cannot hold two waiting rooms",
    res.status === 409 && res.body.code === "ranked_already_waiting",
    res,
  );
  check("a waiting room is not an active Ranked match", (await activeCount(a.id)) === 0);

  res = await ranked(b, { operation: "list" });
  check(
    "B discovers A's room",
    res.status === 200 && res.body.open.some((r) => r.id === room),
    res.body,
  );
  res = await ranked(a, { operation: "list" });
  check(
    "A's waiting room is in A's mine",
    res.body.mine?.some((m) => m.id === room && m.status === "waiting"),
    res.body,
  );

  res = await ranked(b, { operation: "preview", id: room });
  check(
    "B receives the authoritative preview",
    res.status === 200 && /^rs1:/.test(res.body.preview?.basis ?? ""),
    res,
  );
  const first = res.body.preview;
  const direct = await must(
    admin.rpc("ranked_stakes", { target_match_id: room, target_player_id: b.id }).single(),
  );
  check(
    "the preview is exactly the database's stakes",
    first.rating === direct.viewer_rating &&
      first.after.win === direct.win_rating &&
      first.after.loss === direct.loss_rating &&
      first.basis === direct.basis,
    { first, direct },
  );
  check(
    "the preview names A as the opponent",
    first.opponent?.id === a.id && first.opponent?.name === a.name,
    first,
  );

  res = await ranked(b, { operation: "join", id: room });
  check(
    "join without a basis is refused",
    res.status === 400 && res.body.code === "ranked_stakes_required",
    res,
  );

  // The stakes move between preview and confirmation: A's rating changes.
  await setRating(a.id, 1180);
  res = await ranked(b, { operation: "join", id: room, basis: first.basis });
  check(
    "a stale basis is refused with ranked_stakes_changed",
    res.status === 409 && res.body.code === "ranked_stakes_changed",
    res,
  );
  check(
    "…with a fresh preview",
    /^rs1:/.test(res.body.preview?.basis ?? "") && res.body.preview.basis !== first.basis,
    res.body,
  );
  check(
    "…and B claimed nothing",
    (await matchRow(room)).player_b_id === null && (await activeCount(b.id)) === 0,
  );
  const fresh = res.body.preview;

  // Duplicate tabs: the same confirmation sent twice at once, and C racing for the room.
  res = await ranked(c, { operation: "preview", id: room });
  const cBasis = res.body.preview?.basis;
  const [tab1, tab2, rival] = await Promise.all([
    ranked(b, { operation: "join", id: room, basis: fresh.basis }),
    ranked(b, { operation: "join", id: room, basis: fresh.basis }),
    ranked(c, { operation: "join", id: room, basis: cBasis }),
  ]);
  const winners = [tab1, tab2, rival].filter((r) => r.status === 200);
  const row = await matchRow(room);
  check(
    "exactly one player holds the room",
    row.status === "matched" && [b.id, c.id].includes(row.player_b_id),
    row,
  );
  const holder = row.player_b_id === b.id ? b : c;
  console.log(`       (race won by ${holder === b ? "B" : "C"})`);
  const loser = holder === b ? c : b;
  check(
    "the loser of the race is refused, not seated",
    holder === b ? rival.status === 409 : tab1.status === 409 && tab2.status === 409,
    { tab1, tab2, rival },
  );
  check(
    "B's duplicate tab never created a second acquisition",
    (await activeCount(holder.id)) === 1 && (await activeCount(loser.id)) === 0,
  );
  check(
    "the successful joins return the matched room",
    winners.every((r) => r.body.match?.id === room),
    winners,
  );

  // The rest of the flow runs with whoever won; normally B.
  const joiner = holder;
  res = await ranked(joiner, { operation: "join", id: room, basis: "rs1:anything" });
  check(
    "resuming an already-held match works and acquires nothing new",
    res.status === 200 && res.body.match?.id === room && (await activeCount(joiner.id)) === 1,
    res,
  );

  res = await ranked(a, { operation: "preview", id: room });
  check(
    "the creator sees their own Ready stakes",
    res.status === 200 && res.body.preview?.opponent?.id === joiner.id,
    res,
  );
  const creatorStakes = res.body.preview;
  res = await ranked(joiner, { operation: "preview", id: room });
  const joinerStakes = res.body.preview;

  // One active Ranked match: the joiner cannot take a second.
  const other = await player("dan");
  res = await ranked(other, { operation: "create", minutesA: 10, minutesB: 10 });
  const otherRoom = res.body.match.id;
  res = await ranked(joiner, { operation: "preview", id: otherRoom });
  const otherBasis = res.body.preview?.basis;
  res = await ranked(joiner, { operation: "join", id: otherRoom, basis: otherBasis });
  check(
    "one active Ranked match per player holds",
    res.status === 409 && res.body.code === "ranked_already_active",
    res,
  );
  res = await ranked(a, { operation: "preview", id: otherRoom });
  res = await ranked(a, { operation: "join", id: otherRoom, basis: res.body.preview?.basis });
  check(
    "…for the creator too",
    res.status === 409 && res.body.code === "ranked_already_active",
    res,
  );

  res = await ranked(a, { operation: "ready", id: room });
  check(
    "A readies",
    res.status === 200 && res.body.match?.readyBySide?.[res.body.match.yourSide] === true,
    res,
  );
  res = await ranked(joiner, { operation: "ready", id: room });
  check(
    "both Ready starts the match",
    res.status === 200 && res.body.match?.status === "playing",
    res,
  );
  let view = res.body.match;
  check("the match is playing in the database", (await matchRow(room)).status === "playing");
  check(
    "the player sees their own rack only",
    view.yourRack.length > 0 && !("rackA" in view) && !("rackB" in view),
    Object.keys(view),
  );

  const mover = view.activeSide === view.yourSide ? joiner : a;
  const waiter = mover === a ? joiner : a;
  res = await ranked(waiter, {
    operation: "action",
    id: room,
    revision: view.revision,
    action: { kind: "pass" },
  });
  check("out of turn is refused by the rules", res.status === 400, res);
  res = await ranked(mover, {
    operation: "action",
    id: room,
    revision: view.revision - 1,
    action: { kind: "pass" },
  });
  check(
    "a stale revision is refused",
    res.status === 409 && res.body.code === "ranked_position_changed",
    res,
  );
  res = await ranked(mover, {
    operation: "action",
    id: room,
    revision: view.revision,
    action: { kind: "pass" },
  });
  check(
    "the normal action path commits a pass",
    res.status === 200 && res.body.match.revision === view.revision + 1,
    res,
  );
  view = res.body.match;

  res = await ranked(waiter, {
    operation: "action",
    id: room,
    revision: view.revision,
    action: { kind: "resign" },
  });
  check(
    "resigning finishes the match",
    res.status === 200 && res.body.match?.status === "finished",
    res,
  );
  const finished = await matchRow(room);
  check("the database records the match finished", finished.status === "finished", finished.status);
  const result = await must(
    admin.from("ranked_results").select("*").eq("match_id", room).maybeSingle(),
  );
  check("a result row is written once", Boolean(result) && result.reason === "resign", result);
  const winnerStakes = mover === a ? creatorStakes : joinerStakes;
  const loserStakes = mover === a ? joinerStakes : creatorStakes;
  check(
    "the winner's new rating is the win the preview showed",
    (await rating(mover.id)) === winnerStakes.after.win,
    {
      now: await rating(mover.id),
      preview: winnerStakes,
    },
  );
  check(
    "the loser's new rating is the loss the preview showed",
    (await rating(waiter.id)) === loserStakes.after.loss,
    {
      now: await rating(waiter.id),
      preview: loserStakes,
    },
  );
  check(
    "no one holds an active Ranked match any more",
    (await activeCount(a.id)) === 0 && (await activeCount(joiner.id)) === 0,
  );
  res = await ranked(waiter, {
    operation: "action",
    id: room,
    revision: finished.revision,
    action: { kind: "pass" },
  });
  check("a finished match takes no more actions", res.status === 400 || res.status === 409, res);

  console.log("Room becomes unavailable");
  res = await ranked(other, { operation: "cancel", id: otherRoom });
  check("the creator cancels a waiting room", res.status === 200, res);
  res = await ranked(b, { operation: "preview", id: otherRoom });
  check(
    "preview of a vanished room is refused, not invented",
    res.status === 404 && res.body.code === "ranked_room_not_found",
    res,
  );

  console.log("Active-board limit still applies to Ranked");
  const busy = await player("erin");
  for (let n = 0; n < 3; n += 1) {
    await must(
      busy.client.rpc("create_live_game", {
        target_state: { name: `board ${n}`, gameMode: "solo", players: { A: busy.name } },
        target_access_scope: "public",
        target_archive_policy: "public",
        target_region_id: null,
        target_join_policy: "invite_only",
        target_private_parent_id: null,
      }),
    );
  }
  res = await ranked(busy, { operation: "create", minutesA: 10, minutesB: 10 });
  check(
    "creating Ranked at the board limit is refused with active_board_limit",
    res.status === 409 && res.body.code === "active_board_limit",
    res,
  );
  res = await ranked(c, { operation: "create", minutesA: 10, minutesB: 10 });
  const cRoom = res.body.match?.id;
  res = await ranked(busy, { operation: "preview", id: cRoom });
  res = await ranked(busy, { operation: "join", id: cRoom, basis: res.body.preview?.basis });
  check(
    "joining Ranked at the board limit is refused with active_board_limit",
    res.status === 409 && res.body.code === "active_board_limit",
    res,
  );
  check("…and claims nothing", (await matchRow(cRoom)).player_b_id === null);
  res = await ranked(c, { operation: "list" });
  check(
    "the creator's waiting room still counts in their list",
    res.body.mine?.some((m) => m.id === cRoom),
    res.body,
  );

  console.log("No raw server errors");
  res = await ranked(a, { operation: "preview", id: "00000000-0000-4000-8000-000000000000" });
  check(
    "a missing room is a structured refusal",
    res.status === 404 && res.body.code === "ranked_room_not_found",
    res,
  );
  const leaked = JSON.stringify(res.body);
  check("…without SQL text", !/select|relation|constraint|violates|PGRST/i.test(leaked), leaked);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
