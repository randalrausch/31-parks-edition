import { describe, it, expect, vi, afterEach } from "vitest";
import { makeGameApi } from "./azureClient";

interface Captured {
  url?: string;
  body?: Record<string, unknown>;
}

/** Stub global fetch; capture the last call's url + parsed JSON body. */
function stubFetch(status: number, responseBody: unknown): Captured {
  const cap: Captured = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      cap.url = String(input);
      cap.body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      return new Response(JSON.stringify(responseBody), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return cap;
}

afterEach(() => vi.unstubAllGlobals());

describe("azureClient makeGameApi", () => {
  it("POSTs create to {base}/game and returns the body", async () => {
    const cap = stubFetch(200, {
      gameId: "g1",
      code: "ABCDE",
      seatIndex: 0,
      seatToken: "t",
    });
    const r = await makeGameApi("https://x/api").create({
      creatorName: "R",
      humans: 2,
      ai: [],
      options: {
        threeOfAKind: false,
        grace: true,
        knockPenalty: true,
        sound: false,
      },
    });
    expect(r.code).toBe("ABCDE");
    expect(cap.url).toBe("https://x/api/game");
    expect(cap.body).toMatchObject({ op: "create" });
  });

  it("uppercases + trims the join code", async () => {
    const cap = stubFetch(200, { gameId: "g", seatIndex: 1, seatToken: "t" });
    await makeGameApi("/api").join(" abcde ", "Pat");
    expect(cap.body).toMatchObject({ op: "join", code: "ABCDE", name: "Pat" });
  });

  it("a 409 'retry' rejects with a message containing retry (so the transport resyncs)", async () => {
    stubFetch(409, { error: "The game just changed — please retry." });
    await expect(
      makeGameApi("/api").act("g", "t", { type: "drawDeck" }),
    ).rejects.toThrow(/retry/i);
  });

  it("surfaces the server's error message on other failures", async () => {
    stubFetch(404, { error: "No game with that code." });
    await expect(makeGameApi("/api").join("ZZZZZ", "x")).rejects.toThrow(
      "No game with that code.",
    );
  });
});
