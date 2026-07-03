/**
 * Guards the fix for the critical "anon-callable SECURITY DEFINER RPC" hole.
 *
 * Postgres grants EXECUTE to PUBLIC on a new function by default, and PostgREST
 * exposes public-schema functions at /rest/v1/rpc. So any SECURITY DEFINER
 * function in `public` that isn't explicitly revoked from anon is callable by a
 * client holding only the public key — bypassing the Edge Function authority.
 *
 * This test parses the SQL we ship and fails if any SECURITY DEFINER function in
 * the `public` schema lacks a `revoke execute ... from ... anon`. It runs in CI
 * (no database needed), so a future definer RPC added without a revoke can't
 * merge silently.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(join(here, "schema.sql"), "utf8");
const migrationsDir = join(here, "migrations");
const migrationsSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

/** Names of SECURITY DEFINER functions in the `public` schema within `sql`. */
function definerFunctions(sql: string): string[] {
  const names: string[] = [];
  const re =
    /create\s+(?:or\s+replace\s+)?function\s+(public\.\w+)\s*\([^)]*\)([\s\S]*?)\$\$;/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const [, name, body] = m;
    if (/security\s+definer/i.test(body)) names.push(name);
  }
  return names;
}

/** True if `sql` revokes EXECUTE on `fnName` from anon. */
function revokesFromAnon(sql: string, fnName: string): boolean {
  const escaped = fnName.replace(/[.]/g, "\\.");
  const re = new RegExp(
    `revoke\\s+execute\\s+on\\s+function\\s+${escaped}\\s*\\([^)]*\\)[^;]*?\\banon\\b`,
    "i",
  );
  return re.test(sql);
}

describe("Supabase RPC EXECUTE grants", () => {
  it("finds the known SECURITY DEFINER functions in schema.sql", () => {
    // Guards the parser itself: if these stop being detected, the test above is
    // vacuously passing and must be fixed.
    expect(definerFunctions(schemaSql).sort()).toEqual([
      "public.commit_game",
      "public.incr_if_below",
    ]);
  });

  it("revokes EXECUTE from anon for every SECURITY DEFINER function (schema.sql)", () => {
    for (const fn of definerFunctions(schemaSql)) {
      expect(revokesFromAnon(schemaSql, fn), `${fn} must revoke EXECUTE from anon`).toBe(true);
    }
  });

  it("revokes EXECUTE from anon via the migration path too", () => {
    // The `supabase db push` path applies migrations, not schema.sql, so the
    // revoke must be present there as well (for both known definer functions).
    for (const fn of ["public.commit_game", "public.incr_if_below"]) {
      expect(revokesFromAnon(migrationsSql, fn), `${fn} revoke missing from migrations`).toBe(
        true,
      );
    }
  });
});
