// Postbuild: inject the EXACT Azure Functions origin into the built Static Web
// Apps CSP's connect-src, so the deployed policy names only this app's Function
// App instead of the whole *.azurewebsites.net multi-tenant domain.
//
// The committed public/staticwebapp.config.json ships a Supabase-only
// connect-src (the secure default). When building for Azure, VITE_API_BASE is
// set (e.g. https://func-xxx.azurewebsites.net/api) and we append just that
// origin. No-op when VITE_API_BASE is unset (Supabase / other hosts) or isn't an
// azurewebsites.net URL.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const file = "dist/staticwebapp.config.json";
const base = process.env.VITE_API_BASE;
if (!existsSync(file) || !base) process.exit(0);

let origin;
try {
  const u = new URL(base);
  if (!/\.azurewebsites\.net$/.test(u.hostname)) process.exit(0);
  origin = u.origin;
} catch {
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(file, "utf8"));
const csp = cfg.globalHeaders?.["Content-Security-Policy"];
if (!csp || csp.includes(origin)) process.exit(0);

cfg.globalHeaders["Content-Security-Policy"] = csp.replace(
  /connect-src ([^;]*)/,
  (_m, sources) => `connect-src ${sources.trim()} ${origin}`,
);
writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log(`patch-swa-csp: added ${origin} to connect-src`);
