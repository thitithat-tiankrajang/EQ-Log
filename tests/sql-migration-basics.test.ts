import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPaths = [
  "supabase/user_invites_migration.sql",
  "supabase/region_visibility_migration.sql",
  "supabase/game_archives_migration.sql",
];

describe("documented migration sequence", () => {
  for (const path of migrationPaths) {
    it(`${path} terminates PL/pgSQL blocks before the dollar quote closes`, () => {
      const sql = readFileSync(`${process.cwd()}/${path}`, "utf8");
      expect(sql).not.toMatch(/\bend[\t ]+\$\$;/i);
    });
  }
});
