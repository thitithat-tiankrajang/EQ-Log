// Exercise the actual release guard on disposable temporary tables, including
// SQL NULL canonical values preserved by to_jsonb as JSON null.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { localEnvironment } from "../phase-a/local.mjs";

const source = readFileSync("tools/live-security/production-deploy-check.sql", "utf8");
const guard = source.match(
  /if exists\(select 1 from public\.room_live l left join private\.live_legacy_quarantine q[\s\S]*?raise exception 'legacy private preservation mismatch';\s*end if;/,
)?.[0];
if (!guard) throw new Error("Release preservation guard was not found.");
const isolated = guard
  .replaceAll("public.room_live", "pg_temp.legacy_live")
  .replaceAll("private.live_legacy_quarantine", "pg_temp.legacy_quarantine");
const summary = source.match(
  /select count\(\*\) as legacy_live,[\s\S]*?where l\.authority_protocol='legacy-client';/,
)?.[0];
if (!summary) throw new Error("Release preservation summary was not found.");
const isolatedSummary = summary
  .replaceAll("public.room_live", "pg_temp.legacy_live")
  .replaceAll("private.live_legacy_quarantine", "pg_temp.legacy_quarantine")
  .replace(/;$/, "");
const sql = `begin;
create temporary table legacy_live(room_id uuid, authority_protocol text, state jsonb, canonical jsonb);
create temporary table legacy_quarantine(room_id uuid, room_row jsonb);
do $test$
declare item record; refused boolean; summary_row record;
begin
 for item in select * from (values
  ('preserved null canonical', '{}', null, '{"state":{},"canonical":null}', false),
  ('preserved canonical', '{}', '{"v":1}', '{"state":{},"canonical":{"v":1}}', false),
  ('changed canonical', '{}', '{"v":2}', '{"state":{},"canonical":{"v":1}}', true),
  ('changed state', '{"changed":true}', null, '{"state":{},"canonical":null}', true),
  ('missing quarantine', '{}', null, null, true),
  ('missing canonical key', '{}', null, '{"state":{}}', true),
  ('object is not null', '{}', null, '{"state":{},"canonical":{}}', true)
 ) cases(name, live_state, live_canonical, preserved, should_refuse)
 loop
  truncate pg_temp.legacy_live, pg_temp.legacy_quarantine;
  insert into pg_temp.legacy_live values('00000000-0000-4000-8000-000000000001', 'legacy-client', item.live_state::jsonb, item.live_canonical::jsonb);
  if item.preserved is not null then
   insert into pg_temp.legacy_quarantine values('00000000-0000-4000-8000-000000000001', item.preserved::jsonb);
  end if;
  refused := false;
  begin
   ${isolated}
  exception when raise_exception then
   refused := true;
  end;
  if refused is distinct from item.should_refuse then
   raise exception 'Incorrect preservation verdict: % (refused=%)', item.name, refused;
  end if;
  select * into summary_row from (${isolatedSummary}) summary;
  if (summary_row.preserved = summary_row.legacy_live) is distinct from not item.should_refuse then
   raise exception 'Incorrect preservation summary: %', item.name;
  end if;
  raise notice 'PASS: %', item.name;
 end loop;
end $test$;
rollback;
`;
const result = spawnSync("psql", [localEnvironment().DB_URL, "-v", "ON_ERROR_STOP=1"], {
  input: sql,
  encoding: "utf8",
});
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.status ?? 1;
