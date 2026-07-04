/**
 * Resolve the real client IP from proxy headers, resistant to
 * `X-Forwarded-For` spoofing — used by both backends to key the per-IP rate
 * limits.
 *
 * A client can put anything in `X-Forwarded-For`. The hosting infra (Azure App
 * Service, the Supabase/Cloudflare edge) APPENDS the true peer IP as the
 * RIGHT-most hop, so the left-most entry is attacker-controlled and must never
 * be trusted — trusting it lets a caller rotate the fake first hop to get a
 * fresh rate-limit bucket every request. We therefore take the right-most hop,
 * preferring a platform-authoritative single-value header (e.g.
 * `cf-connecting-ip`) when the caller lists one as trusted for its environment.
 *
 * Pure and host-neutral (only needs `headers.get`), so it runs unchanged in
 * Node (Azure) and Deno (Supabase) and is bundled into the edge engine.
 */

export interface HeaderGetter {
  get(name: string): string | null | undefined;
}

/** Strip a trailing `:port` from `IPv4:port` and `[IPv6]:port`; leave bare IPs. */
function stripPort(s: string): string {
  const bracketed = s.match(/^\[(.+)\]:\d+$/); // [::1]:443 → ::1
  if (bracketed) return bracketed[1];
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s)) return s.slice(0, s.lastIndexOf(":")); // 1.2.3.4:56
  return s; // bare IPv4, or bare IPv6 (which legitimately contains colons)
}

/**
 * @param headers        anything with a case-insensitive `.get(name)`
 * @param trustedHeaders single-value headers to trust FIRST, in order — only
 *                       pass headers the platform sets and overwrites (e.g.
 *                       `cf-connecting-ip` on the Supabase/Cloudflare edge). On
 *                       Azure App Service pass none and fall through to the
 *                       right-most XFF hop, which the platform appends.
 */
export function clientIp(headers: HeaderGetter, trustedHeaders: string[] = []): string {
  for (const name of trustedHeaders) {
    const v = headers.get(name);
    if (v) {
      const ip = stripPort(v.trim());
      if (ip) return ip;
    }
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff
      .split(",")
      .map((h) => stripPort(h.trim()))
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1]; // right-most = added by infra
  }
  return "unknown";
}
