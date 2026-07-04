// Postbuild: stamp a per-build tag into the service worker's cache name.
//
// public/sw.js ships `const CACHE = "parks31-v3-__BUILD__"`. Vite copies it to
// dist/ verbatim, so without this the cache name is constant across deploys and
// old content-hashed assets pile up in it forever (nothing evicts within a
// same-named cache). We replace `__BUILD__` with a short hash of the built
// index.html — which embeds every hashed asset URL, so it changes exactly when
// the build's output changes. A new tag → a new SW → activate deletes the old
// cache. No-op if there's nothing to stamp.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const htmlPath = "dist/index.html";
const swPath = "dist/sw.js";
if (!existsSync(htmlPath) || !existsSync(swPath)) process.exit(0);

const sw = readFileSync(swPath, "utf8");
if (!sw.includes("__BUILD__")) process.exit(0); // already stamped / nothing to do

const tag = createHash("sha256").update(readFileSync(htmlPath)).digest("hex").slice(0, 12);
writeFileSync(swPath, sw.replaceAll("__BUILD__", tag));
console.log(`stamped service-worker cache: parks31-v3-${tag}`);
