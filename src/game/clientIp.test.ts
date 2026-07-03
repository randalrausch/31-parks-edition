import { describe, expect, it } from "vitest";
import { clientIp, type HeaderGetter } from "./clientIp";

/** Build a case-sensitive-enough header bag for these tests. */
function headers(map: Record<string, string>): HeaderGetter {
  return { get: (name) => map[name.toLowerCase()] ?? null };
}

describe("clientIp", () => {
  it("ignores a spoofed left-most XFF hop and uses the right-most (infra-appended) one", () => {
    // Attacker sends a fake first entry; the real peer IP is appended last.
    const h = headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("cannot be rotated by changing the left-most hop", () => {
    const a = clientIp(headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.9" }));
    const b = clientIp(headers({ "x-forwarded-for": "8.8.8.8, 203.0.113.9" }));
    expect(a).toBe(b); // same real client → same bucket key
  });

  it("prefers a trusted single-value header when present", () => {
    const h = headers({
      "cf-connecting-ip": "198.51.100.7",
      "x-forwarded-for": "1.1.1.1, 203.0.113.9",
    });
    expect(clientIp(h, ["cf-connecting-ip", "x-real-ip"])).toBe("198.51.100.7");
  });

  it("falls back to the right-most XFF hop when the trusted header is absent", () => {
    const h = headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(clientIp(h, ["cf-connecting-ip"])).toBe("203.0.113.9");
  });

  it("does NOT consult untrusted headers when not listed", () => {
    // x-real-ip present but not in the trusted list → ignored in favor of XFF.
    const h = headers({ "x-real-ip": "6.6.6.6", "x-forwarded-for": "1.1.1.1, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("strips the port from IPv4:port", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9:54321" }))).toBe("203.0.113.9");
  });

  it("strips the port from [IPv6]:port and leaves bare IPv6 intact", () => {
    expect(clientIp(headers({ "cf-connecting-ip": "[2001:db8::1]:443" }), ["cf-connecting-ip"])).toBe(
      "2001:db8::1",
    );
    expect(clientIp(headers({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("trims whitespace around hops", () => {
    expect(clientIp(headers({ "x-forwarded-for": "  1.1.1.1 ,  203.0.113.9  " }))).toBe(
      "203.0.113.9",
    );
  });

  it("returns 'unknown' when no usable header is present", () => {
    expect(clientIp(headers({}))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
