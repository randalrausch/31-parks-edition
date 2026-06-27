/**
 * Whether multiplayer is configured — derived from env only, with NO import of
 * @supabase/supabase-js. The eager (solo) code path imports this instead of
 * supabaseClient.ts so the Supabase SDK stays out of the initial bundle.
 */
const env = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env;
export const multiplayerEnabled = Boolean(
  env?.VITE_SUPABASE_URL && env?.VITE_SUPABASE_KEY,
);
