import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRiotHandler } from "./handler";

const id = "11111111-1111-4111-8111-111111111111";
const getUser = vi.fn(),
  provider = vi.fn(),
  rpc = vi.fn(),
  writes = vi.fn();
let member = true,
  available = true,
  cached = false;
const profile = {
  id,
  owner_id: "owner",
  puuid: "verified-player",
  platform: "euw1",
};
function table(name: string) {
  let operation = "select";
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    upsert: vi.fn((data: unknown) => {
      writes(name, data);
      operation = "write";
      return query;
    }),
    update: vi.fn((data: unknown) => {
      writes(name, data);
      operation = "write";
      return query;
    }),
    single: vi.fn(async () => ({ data: { id }, error: null })),
    maybeSingle: vi.fn(async () => ({
      data:
        name === "owner_memberships"
          ? member
            ? { enabled: true }
            : null
          : name === "league_profiles"
            ? available
              ? profile
              : null
            : cached
              ? { match_id: "EUW1_1" }
              : null,
      error: null,
    })),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: operation === "write" ? null : [],
        error: null,
      }).then(resolve),
  };
  return query;
}
const handler = createRiotHandler({
  env: (key) => (key === "RIOT_API_KEY" ? "private-riot-key" : "backend"),
  createClient: () =>
    ({ auth: { getUser }, from: table, rpc }) as unknown as SupabaseClient,
  fetch: provider,
  sleep: async () => {},
});
const request = (body: unknown, jwt = "owner-jwt") =>
  handler(
    new Request("https://example.test/riot", {
      method: "POST",
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  member = true;
  available = true;
  cached = false;
  getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  rpc.mockImplementation(async (name) => ({
    data: name === "reserve_riot_request" ? 0 : true,
    error: null,
  }));
  provider.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/ids?")
            ? ["EUW1_1"]
            : url.includes("/matches/EUW1_1")
              ? {
                  metadata: { matchId: "EUW1_1" },
                  info: {
                    queueId: 420,
                    gameCreation: 123,
                    gameDuration: 1200,
                    gameVersion: "16.17",
                    participants: [
                      {
                        puuid: "verified-player",
                        championId: 103,
                        kills: 3,
                        unusedPrivateField: "omit",
                      },
                    ],
                  },
                }
              : url.includes("/summoners/")
                ? { profileIconId: 1, summonerLevel: 10 }
                : url.includes("/entries/")
                  ? []
                  : {
                      puuid: "verified-player",
                      gameName: "A Name",
                      tagLine: "EUW",
                    },
        ),
      ),
  );
});
it("rejects anonymous, invalid JWT and disabled owners before accessing Riot", async () => {
  expect((await request({ action: "connect" }, "")).status).toBe(401);
  getUser.mockResolvedValueOnce({ data: { user: null }, error: {} });
  expect((await request({ action: "connect" })).status).toBe(401);
  member = false;
  expect((await request({ action: "connect" })).status).toBe(403);
  expect(provider).not.toHaveBeenCalled();
});
it("ignores a supplied owner and uses verified identity, encoded Riot ID and regional/platform hosts", async () => {
  const response = await request({
    action: "connect",
    platform: "euw1",
    riotId: "A Name#EUW",
    ownerId: "attacker",
  });
  expect(response.status).toBe(200);
  expect(provider.mock.calls[0][0]).toBe(
    "https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/A%20Name/EUW",
  );
  expect(provider.mock.calls[1][0]).toContain(
    "https://euw1.api.riotgames.com/lol/summoner/",
  );
  expect(writes.mock.calls[0][1].owner_id).toBe("owner");
  expect(JSON.stringify(await response.json())).not.toContain(
    "private-riot-key",
  );
});
it("rejects invalid regions and mismatched Riot accounts without saving a profile", async () => {
  expect(
    (
      await request({
        action: "connect",
        platform: "https://evil.test",
        riotId: "A#B",
      })
    ).status,
  ).toBe(400);
  provider.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ puuid: "someone", gameName: "Other", tagLine: "EUW" }),
    ),
  );
  expect(
    (
      await request({
        action: "connect",
        platform: "euw1",
        riotId: "A Name#EUW",
      })
    ).status,
  ).toBe(502);
  expect(writes).not.toHaveBeenCalled();
});
it("rejects cross-owner profile access before Riot requests", async () => {
  available = false;
  expect(
    (await request({ action: "sync", profileId: id, start: 0 })).status,
  ).toBe(404);
  expect(provider).not.toHaveBeenCalled();
});
it("stores API match fields idempotently, strips unused fields and advances the cursor only on a completed page", async () => {
  const response = await request({ action: "sync", profileId: id, start: 0 });
  expect(await response.json()).toEqual({ nextStart: 1, hasMore: false });
  const stored = writes.mock.calls.find(
    (call) => call[0] === "league_matches",
  )![1];
  expect(stored.match.participants[0]).toEqual({
    puuid: "verified-player",
    championId: 103,
    kills: 3,
  });
  expect(rpc).toHaveBeenCalledWith("complete_league_sync", {
    p_profile: id,
    p_owner: "owner",
    p_cursor: 1,
  });
  expect(writes).toHaveBeenLastCalledWith("league_profiles", {
    sync_until: null,
  });
});
it("does not refetch immutable cached matches", async () => {
  cached = true;
  expect(
    (await request({ action: "sync", profileId: id, start: 5 })).status,
  ).toBe(200);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("releases the sync lock on rate limits and does not advance the cursor or echo secrets", async () => {
  provider.mockResolvedValueOnce(
    new Response("{}", { status: 429, headers: { "Retry-After": "60" } }),
  );
  const response = await request({ action: "sync", profileId: id, start: 5 });
  expect(response.status).toBe(429);
  expect(await response.text()).toContain("60 seconds");
  expect(rpc.mock.calls.some((c) => c[0] === "complete_league_sync")).toBe(
    false,
  );
  expect(writes).toHaveBeenLastCalledWith("league_profiles", {
    sync_until: null,
  });
});
it("returns a safe key-expiry message and respects profile sync exclusion", async () => {
  provider.mockResolvedValueOnce(
    new Response("private-riot-key", { status: 403 }),
  );
  const response = await request({ action: "sync", profileId: id, start: 0 });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-riot-key");
  rpc.mockImplementation(async (name) => ({
    data: name === "claim_league_sync" ? false : 0,
    error: null,
  }));
  expect(
    (await request({ action: "sync", profileId: id, start: 0 })).status,
  ).toBe(409);
});
