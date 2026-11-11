import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRiotHandler } from "./handler";
import { webcrypto } from "node:crypto";
import { decryptToken } from "./tokens";
const encryptionSecret = Buffer.alloc(32, 7).toString("base64");
let credential: { encrypted_token: string; updated_at: string } | null = null;

const id = "11111111-1111-4111-8111-111111111111";
const getUser = vi.fn(),
  provider = vi.fn(),
  rpc = vi.fn(),
  writes = vi.fn();
let member = true,
  available = true,
  cached: boolean | "no-level" = false,
  viewed = false;
const profile = () => ({
  id,
  owner_id: "owner",
  puuid: "verified-player",
  platform: "euw1",
  profile: viewed ? { viewed: true } : {},
});
function table(name: string) {
  let operation = "select";
  const query = {
    delete: vi.fn(() => {
      writes(name, { deleted: true });
      operation = "write";
      return query;
    }),
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    insert: vi.fn((data: unknown) => {
      writes(name, data);
      operation = "write";
      return query;
    }),
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
              ? profile()
              : null
            : name === "riot_credentials"
              ? credential
              : cached
                ? {
                    match_id: "EUW1_1",
                    match: {
                      participants: [
                        cached === "no-level" ? {} : { summonerLevel: 10 },
                      ],
                    },
                  }
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
  env: (key) =>
    key === "RIOT_TOKEN_ENCRYPTION_KEY"
      ? encryptionSecret
      : key === "RIOT_API_KEY"
        ? "private-riot-key"
        : "backend",
  createClient: () =>
    ({ auth: { getUser }, from: table, rpc }) as unknown as SupabaseClient,
  fetch: provider,
  sleep: async () => {},
  crypto: webcrypto as unknown as Crypto,
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
  credential = null;
  member = true;
  available = true;
  cached = false;
  viewed = false;
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
                        summonerLevel: 150,
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
    summonerLevel: 150,
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
it("fetches a cached game once more when it was saved without account levels", async () => {
  cached = "no-level";
  expect(
    (await request({ action: "sync", profileId: id, start: 5 })).status,
  ).toBe(200);
  expect(provider).toHaveBeenCalledTimes(2);
  const stored = writes.mock.calls.find(
    (call) => call[0] === "league_matches",
  )![1];
  expect(stored.match.participants[0].summonerLevel).toBe(150);
});
it("opens another player by account id as a removable viewed profile", async () => {
  available = false;
  const puuid = "p".repeat(78);
  const response = await request({
    action: "view-player",
    platform: "euw1",
    puuid,
    ownerId: "attacker",
  });
  expect(response.status).toBe(200);
  expect(provider.mock.calls[0][0]).toBe(
    `https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
  );
  const saved = writes.mock.calls.find(
    (call) => call[0] === "league_profiles",
  )![1];
  expect(saved).toMatchObject({ owner_id: "owner", puuid, platform: "euw1" });
  expect(saved.profile.viewed).toBe(true);
});
it("returns an already saved player without asking Riot and rejects malformed account ids", async () => {
  const puuid = "p".repeat(78);
  expect(
    await (
      await request({ action: "view-player", platform: "euw1", puuid })
    ).json(),
  ).toEqual({ id });
  expect(provider).not.toHaveBeenCalled();
  for (const bad of ["short", "../etc/passwd", 7, undefined])
    expect(
      (await request({ action: "view-player", platform: "euw1", puuid: bad }))
        .status,
    ).toBe(400);
});
it("keeps a looked-up player marked as viewed when their profile is refreshed", async () => {
  viewed = true;
  expect(
    (await request({ action: "refresh-profile", profileId: id })).status,
  ).toBe(200);
  const update = writes.mock.calls.find(
    (call) => call[0] === "league_profiles" && call[1].profile,
  )![1];
  expect(update.profile.viewed).toBe(true);
  viewed = false;
  writes.mockClear();
  await request({ action: "refresh-profile", profileId: id });
  expect(
    writes.mock.calls.find(
      (call) => call[0] === "league_profiles" && call[1].profile,
    )![1].profile.viewed,
  ).toBeUndefined();
});
it("removes only players that were looked up, never your own accounts", async () => {
  expect(
    (await request({ action: "remove-profile", profileId: id })).status,
  ).toBe(400);
  expect(writes).not.toHaveBeenCalled();
  viewed = true;
  expect(
    (await request({ action: "remove-profile", profileId: id })).status,
  ).toBe(200);
  expect(writes).toHaveBeenCalledWith("league_profiles", { deleted: true });
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

it("verifies a personal token before saving only encrypted data under the verified owner", async () => {
  const token = "RGAPI-" + "a".repeat(36);
  const response = await request({
    action: "save-token",
    token,
    platform: "euw1",
    ownerId: "attacker",
  });
  expect(response.status).toBe(200);
  expect(provider.mock.calls[0][0]).toBe(
    "https://euw1.api.riotgames.com/lol/status/v4/platform-data",
  );
  expect(provider.mock.calls[0][1].headers["X-Riot-Token"]).toBe(token);
  const stored = writes.mock.calls.find((c) => c[0] === "riot_credentials")![1];
  expect(stored.owner_id).toBe("owner");
  expect(JSON.stringify(stored)).not.toContain(token);
  expect(
    await decryptToken(
      stored.encrypted_token,
      encryptionSecret,
      webcrypto as unknown as Crypto,
    ),
  ).toBe(token);
  expect(await response.text()).not.toContain(token);
  credential = {
    encrypted_token: stored.encrypted_token,
    updated_at: "2026-11-10",
  };
  const status = await request({ action: "token-status" });
  expect(await status.json()).toEqual({
    configured: true,
    sharedDefault: true,
    updatedAt: "2026-11-10",
  });
  const sync = await request({ action: "sync", profileId: id, start: 0 });
  expect(sync.status).toBe(200);
  expect(provider.mock.calls.at(-1)![1].headers["X-Riot-Token"]).toBe(token);
});
it("saves a replacement with a propagation warning when Riot hasn't accepted it yet", async () => {
  provider.mockResolvedValueOnce(new Response("do-not-echo", { status: 403 }));
  const response = await request({
    action: "save-token",
    token: "RGAPI-" + "b".repeat(36),
    platform: "euw1",
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.verified).toBe(false);
  expect(result.warning).toContain("a few minutes");
  expect(JSON.stringify(result)).not.toContain("do-not-echo");
  const stored = writes.mock.calls.find((c) => c[0] === "riot_credentials")![1];
  expect(
    await decryptToken(
      stored.encrypted_token,
      encryptionSecret,
      webcrypto as unknown as Crypto,
    ),
  ).toBe("RGAPI-" + "b".repeat(36));
});
it("removes only the verified owner token and never calls Riot for status or removal", async () => {
  expect(
    (await request({ action: "remove-token", ownerId: "attacker" })).status,
  ).toBe(200);
  expect(writes).toHaveBeenCalledWith("riot_credentials", { deleted: true });
  expect(provider).not.toHaveBeenCalled();
});
