import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(root + "/package.json");
const { createClient } = require("@supabase/supabase-js");
const { buildSync } = require("esbuild");
const statusFile = process.env.LIVE_SECURITY_STATUS_FILE;
if (!statusFile) throw Error("Private disposable status file required");
const env = JSON.parse(readFileSync(statusFile, "utf8"));
if (env.API_URL !== "http://127.0.0.1:54521") throw Error("Disposable stack only");
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const file = process.env.LIVE_SECURITY_LEGACY_FILE;
if (!file || !resolve(file).startsWith("/private/tmp/"))
  throw Error("Private temporary fixture path required");
const phase = process.argv[2];
const assert = (v, msg) => {
  if (!v) throw Error(msg);
};
if (!["before", "after"].includes(phase)) throw Error("Use before or after");
if (phase === "before") {
  async function user() {
    const email = `cutover-${crypto.randomUUID()}@example.test`,
      password = `LocalOnly-${crypto.randomUUID()}`;
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error) throw made.error;
    await service.from("profiles").update({ status: "approved" }).eq("id", made.data.user.id);
    const c = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
    const signed = await c.auth.signInWithPassword({ email, password });
    if (signed.error) throw signed.error;
    return { id: made.data.user.id, token: signed.data.session.access_token, client: c };
  }
  const a = await user(),
    b = await user();
  const fixture = { exports: {} };
  const bundle = buildSync({
    stdin: {
      contents: `import {createNewGame,makeSnapshot,pushActionSnapshot} from '${root}/src/game'; import {applyRankedAction} from '${root}/src/features/ranked/rules';import {encodeGame} from '${root}/src/codec';import {canonicalFromSnapshot,encodeCanonical} from '${root}/src/domain/projection';export function make(a,b){let g=createNewGame({name:'Legacy cutover fixture',playerA:'A',playerB:'B',playerAUserId:a,playerBUserId:b,startingSide:'A',tileDrawMode:'play',emailPlayMode:'direct',untimed:true});g={...g,roomStage:'playing',status:'playing',history:[makeSnapshot(g)]};g=pushActionSnapshot(applyRankedAction(g,'A',{kind:'pass'},new Date().toISOString(),'normal'));g=pushActionSnapshot(applyRankedAction(g,'B',{kind:'pass'},new Date().toISOString(),'normal'));return {state:encodeGame(g),canonical:encodeCanonical(canonicalFromSnapshot(g,1))};}`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0].text;
  new Function("module", "exports", bundle)(fixture, fixture.exports);
  const data = fixture.exports.make(a.id, b.id);
  const created = await a.client.rpc("create_live_game", {
    target_state: data.state,
    target_access_scope: "private",
    target_archive_policy: "private",
    target_region_id: null,
    target_join_policy: "invite_only",
    target_private_parent_id: null,
  });
  if (created.error) throw created.error;
  const id = created.data[0].room_id;
  const committed = await a.client.rpc("commit_live_game_command", {
    target_game_id: id,
    target_expected_revision: 0,
    target_command_id: crypto.randomUUID(),
    target_issued_by: "A",
    target_command: { kind: "pass" },
    target_canonical: data.canonical,
    target_canonical_digest: null,
    target_state: { ...data.state, revision: 1 },
    target_session: {},
  });
  if (committed.error) throw committed.error;
  const raw = await a.client
    .from("room_live")
    .select("state,session,revision")
    .eq("room_id", id)
    .single();
  if (raw.error) throw raw.error;
  assert(raw.data.state.rackB.length > 0, "Old fixture did not expose opponent rack");
  const snapshot = await a.client.rpc("get_live_game_snapshot", { target_game_id: id });
  if (snapshot.error) throw snapshot.error;
  assert(snapshot.data[0].canonical, "Old snapshot did not expose canonical");
  writeFileSync(
    file,
    JSON.stringify({
      id,
      a: { id: a.id, token: a.token },
      b: { id: b.id, token: b.token },
      data,
      before: raw.data,
    }),
    { mode: 0o600 },
  );
  console.log(
    "OLD_BOUNDARY: genuine baseline authenticated create/commit; opponent rack readable in state and canonical readable through snapshot RPC before candidate migrations.",
  );
} else {
  const saved = JSON.parse(readFileSync(file, "utf8"));
  // A retained fixture can outlive its one-hour JWT. Refresh only these local
  // example.test actors; never interpret expiry as a projection regression.
  for (const actor of [saved.a, saved.b]) {
    const found = await service.auth.admin.getUserById(actor.id);
    const email = found.data.user?.email;
    assert(email?.endsWith("@example.test"), "Disposable fixture actor required");
    const link = await service.auth.admin.generateLink({ type: "magiclink", email });
    if (link.error) throw link.error;
    const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
    const refreshed = await client.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.data.properties.hashed_token,
    });
    if (refreshed.error) throw refreshed.error;
    actor.token = refreshed.data.session.access_token;
  }
  writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  async function edge(actor, body, name = "live-game") {
    const r = await fetch(`${env.API_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${actor.token}`,
        apikey: env.ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  }
  for (const actor of [saved.a, saved.b]) {
    const client = createClient(env.API_URL, env.ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${actor.token}` } },
    });
    const raw = await client
      .from("room_live")
      .select("state,canonical,session")
      .eq("room_id", saved.id);
    assert(raw.error, "Old raw reads survived boundary");
    assert(
      (await client.rpc("get_live_game_snapshot", { target_game_id: saved.id })).error,
      "Old canonical RPC survived boundary",
    );
    for (let reconnect = 0; reconnect < 3; reconnect++) {
      const read = await edge(actor, { operation: "read", id: saved.id });
      assert(
        read.status === 200,
        "Secure projection not readable: " + read.status + " " + String(read.body.error),
      );
      assert(read.body.match.continuationBlocked, "Legacy not frozen");
      assert(
        !/"(?:rackA|rackB|tilebag|canonical|history|session)"\s*:/.test(JSON.stringify(read.body)),
        "Secret projection field",
      );
      const move = await edge(actor, {
        operation: "action",
        id: saved.id,
        revision: read.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      });
      assert(move.status === 409, "Legacy move not frozen");
    }
    const old = await client.rpc("commit_live_game_command", {
      target_game_id: saved.id,
      target_expected_revision: saved.before.revision,
      target_command_id: crypto.randomUUID(),
      target_issued_by: "A",
      target_command: { kind: "pass" },
      target_canonical: saved.data.canonical,
      target_canonical_digest: null,
      target_state: saved.data.state,
      target_session: {},
    });
    assert(old.error, "Old writer survived");
    assert(
      (await edge(actor, { gameId: saved.id }, "archive-replay")).status === 404,
      "Live Replay exposed",
    );
  }
  const live = await service
    .from("room_live")
    .select("state,canonical,revision,authority_protocol")
    .eq("room_id", saved.id)
    .single();
  if (live.error) throw live.error;
  assert(live.data.authority_protocol === "legacy-client", "Legacy relabeled trusted");
  assert(live.data.revision === saved.before.revision, "Legacy revision changed");
  assert(
    JSON.stringify(live.data.state) === JSON.stringify(saved.before.state),
    "Legacy state overwritten",
  );
  const history = await service.from("game_history").select("source_id").eq("source_id", saved.id);
  assert(history.data.length === 0, "Frozen game manufactured completion");
  console.log(
    "NEW_BOUNDARY: both actors load/reconnect safely; old raw reads/writes revoked; next move refused409; live Replay404; private state/revision preserved; no fabricated History/Replay.",
  );
  console.log(
    "CUTOVER POLICY: legacy sessions stay frozen; restart with a fresh deal. Cutover quarantine preserves evidence, without migration or fabricated completion.",
  );
}
