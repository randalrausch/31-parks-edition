import { describe, it, expect, vi, afterEach } from "vitest";
import { makeGameApi } from "./azureClient";

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("azureClient makeGameApi", () => {
  it("POSTs create to {base}/game and returns the body", async () => {
    const fetchFn = stubFetch(200, {
      gameId: "g1",
      code: "ABCDE",
      seatIndex: 0,
      seatToken: "t",
    });
    const api = makeGameApi("https://x/api");
    const r = await api.create({
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
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://x/api/game");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      op: "create",
    });
  });

  it("uppercases + trims the join code", async () => {
    const fetchFn = stubFetch(200, {
      gameId: "g",
      seatIndex: 1,
      seatToken: "t",
    });
    await makeGameApi("/api").join(" abcde ", "Pat");
    const body = JSON.parse(
      (fetchFn.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body).toMatchObject({ op: "join", code: "ABCDE", name: "Pat" });
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
