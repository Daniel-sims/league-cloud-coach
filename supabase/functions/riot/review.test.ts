import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRiotHandler } from "./handler";
import { reduceTimeline } from "./timeline";

const recordingId = "22222222-2222-4222-8222-222222222222";
const profileId = "11111111-1111-4111-8111-111111111111";
const match = {
  id: "EUW1_9",
  queueId: 420,
  gameVersion: "16.17.1",
  gameCreation: 1,
  gameDuration: 1800,
  participants: [
    {
      puuid: "me",
      teamId: 100,
      championId: 4,
      championName: "TwistedFate",
      teamPosition: "MIDDLE",
      riotIdGameName: "Private Name",
    },
    {
      puuid: "them",
      teamId: 200,
      championId: 103,
      championName: "Ahri",
      teamPosition: "MIDDLE",
    },
  ],
};
const frame = (id: number, extra: object = {}) => ({
  participantId: id,
  position: { x: 7000, y: 7000 },
  totalGold: 500,
  xp: 280,
  level: 2,
  minionsKilled: 3,
  jungleMinionsKilled: 0,
  championStats: { health: 600 },
  ...extra,
});
const raw = {
  info: {
    participants: [
      { participantId: 3, puuid: "me" },
      { participantId: 8, puuid: "them" },
    ],
    frames: [
      {
        timestamp: 0,
        participantFrames: {
          "3": frame(3),
          "8": frame(8),
          "9": { participantId: 9 },
        },
        events: [
          { type: "PAUSE_END", timestamp: 0, realTimestamp: 99 },
          {
            type: "ITEM_PURCHASED",
            timestamp: 10000,
            participantId: 3,
            itemId: 1056,
          },
          {
            type: "ITEM_UNDO",
            timestamp: 11000,
            participantId: 3,
            beforeId: 1056,
            afterId: 0,
          },
        ],
      },
      {
        timestamp: 60000,
        participantFrames: { "3": frame(3, { totalGold: 900 }) },
        events: [
          {
            type: "CHAMPION_KILL",
            timestamp: 61000,
            killerId: 8,
            victimId: 3,
            assistingParticipantIds: [7, 99],
            position: { x: 7100, y: 7200 },
            victimDamageReceived: [
              {
                type: "TOWER",
                physicalDamage: 300,
                magicDamage: 0,
                trueDamage: 20,
              },
              { type: "OTHER", participantId: 8, magicDamage: 400 },
            ],
          },
          {
            type: "ELITE_MONSTER_KILL",
            timestamp: 62000,
            killerId: 7,
            killerTeamId: 200,
            monsterType: "DRAGON",
            monsterSubType: "FIRE_DRAGON",
            position: { x: 9860, y: 4400 },
          },
          {
            type: "BUILDING_KILL",
            timestamp: 63000,
            teamId: 100,
            buildingType: "TOWER_BUILDING",
            towerType: "OUTER_TURRET",
            laneType: "MID_LANE",
            position: { x: 5846, y: 6396 },
            killerId: 8,
          },
        ],
      },
    ],
  },
};

it("reduces a Riot timeline to the review payload without account identities", () => {
  const payload = reduceTimeline(raw, match, "me");
  expect(payload.playerId).toBe(3);
  expect(payload.participants).toEqual([
    {
      id: 3,
      championId: 4,
      championName: "TwistedFate",
      teamId: 100,
      position: "MIDDLE",
    },
    {
      id: 8,
      championId: 103,
      championName: "Ahri",
      teamId: 200,
      position: "MIDDLE",
    },
  ]);
  expect(Object.keys(payload.frames[0].snapshots)).toEqual(["3", "8"]);
  expect(payload.frames[1].snapshots["3"].gold).toBe(900);
  expect(payload.frames[0].snapshots["3"]).toMatchObject({ xp: 280, level: 2 });
  expect(payload.kills).toEqual([
    {
      t: 61000,
      killer: 8,
      victim: 3,
      assists: [7],
      x: 7100,
      y: 7200,
      turretDamage: 320,
    },
  ]);
  expect(payload.items).toEqual([
    { t: 10000, participant: 3, item: 1056, kind: "purchased" },
    { t: 11000, participant: 3, item: 1056, kind: "undone" },
  ]);
  expect(payload.monsters[0]).toMatchObject({
    type: "DRAGON",
    subType: "FIRE_DRAGON",
    team: 200,
  });
  expect(payload.buildings[0]).toMatchObject({
    lane: "mid",
    tower: "OUTER_TURRET",
  });
  const text = JSON.stringify(payload);
  expect(text).not.toContain("Private Name");
  expect(text).not.toContain('"me"');
  expect(text).not.toContain("them");
});
it("refuses a timeline the account was not in", () => {
  expect(() => reduceTimeline(raw, match, "stranger")).toThrow(
    /wasn't in that game/,
  );
  expect(() => reduceTimeline({}, match, "me")).toThrow(/incomplete/);
});

const getUser = vi.fn(),
  provider = vi.fn(),
  rpc = vi.fn();
let ownsRecording = true,
  savedMatch: typeof match | null = match,
  savedReview: unknown = null,
  pendingRows: { match_id: string; match: typeof match }[] = [],
  pendingAfter = 0;
const updates: unknown[] = [];
function table(name: string) {
  let lim = -1;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    gte: vi.fn(() => query),
    lt: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn((n: number) => {
      lim = n;
      return query;
    }),
    update: vi.fn((v: unknown) => {
      updates.push(v);
      return query;
    }),
    then: (resolve: (v: unknown) => void) =>
      resolve(
        lim === 0
          ? { count: pendingAfter, error: null }
          : lim > 0
            ? { data: pendingRows, error: null }
            : { error: null },
      ),
    maybeSingle: vi.fn(async () => ({
      data:
        name === "owner_memberships"
          ? { enabled: true }
          : name === "league_profiles"
            ? {
                id: profileId,
                owner_id: "owner",
                puuid: "me",
                platform: "euw1",
              }
            : name === "recordings"
              ? ownsRecording
                ? { id: recordingId }
                : null
              : name === "league_matches"
                ? savedMatch && { match: savedMatch, review: savedReview }
                : null,
      error: null,
    })),
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
const request = (body: object) =>
  handler(
    new Request("https://example.test/riot", {
      method: "POST",
      headers: { Authorization: "Bearer owner-jwt" },
      body: JSON.stringify({
        action: "review-timeline",
        profileId,
        recordingId,
        matchId: "EUW1_9",
        ...body,
      }),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  ownsRecording = true;
  savedMatch = match;
  savedReview = null;
  pendingRows = [];
  pendingAfter = 0;
  updates.length = 0;
  getUser.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  rpc.mockImplementation(async (name) => ({
    data:
      name === "reserve_riot_request"
        ? 0
        : name === "claim_league_sync"
          ? true
          : null,
    error: null,
  }));
  provider.mockImplementation(async () => new Response(JSON.stringify(raw)));
});
it("fetches the timeline on the regional host and stores it for the verified owner's recording", async () => {
  const response = await request({ ownerId: "attacker" });
  expect(response.status).toBe(200);
  expect(provider.mock.calls[0][0]).toBe(
    "https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_9/timeline",
  );
  const save = rpc.mock.calls.find((c) => c[0] === "save_recording_timeline")!;
  expect(save[1]).toMatchObject({
    p_owner: "owner",
    p_recording: recordingId,
    p_match: "EUW1_9",
  });
  expect(save[1].p_review.playerId).toBe(3);
  expect(rpc.mock.calls.some((c) => c[0] === "claim_league_sync")).toBe(false);
});
it("refuses another owner's recording, unsynced games and malformed ids before calling Riot", async () => {
  ownsRecording = false;
  expect((await request({})).status).toBe(404);
  ownsRecording = true;
  savedMatch = null;
  const unsynced = await request({});
  expect(unsynced.status).toBe(404);
  expect(await unsynced.text()).toContain("Sync this game");
  expect((await request({ matchId: "../../evil" })).status).toBe(400);
  expect((await request({ recordingId: "nope" })).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});
it("reports a timeline without the player instead of saving it", async () => {
  savedMatch = { ...match };
  provider.mockResolvedValueOnce(
    new Response(JSON.stringify({ info: { participants: [], frames: [] } })),
  );
  const response = await request({});
  expect(response.status).toBe(502);
  expect(await response.text()).toContain("wasn't in that game");
  expect(rpc.mock.calls.some((c) => c[0] === "save_recording_timeline")).toBe(
    false,
  );
});

it("reuses a timeline curated by a season pull instead of calling Riot", async () => {
  savedReview = { version: 1, matchId: "EUW1_9", playerId: 3 };
  const response = await request({});
  expect(response.status).toBe(200);
  expect(provider).not.toHaveBeenCalled();
  const save = rpc.mock.calls.find((c) => c[0] === "save_recording_timeline")!;
  expect(save[1].p_review).toEqual(savedReview);
});
it("curates stored games' timelines in small batches and reports what is left", async () => {
  pendingRows = [
    { match_id: "EUW1_9", match },
    { match_id: "EUW1_8", match },
  ];
  pendingAfter = 4;
  provider
    .mockResolvedValueOnce(new Response(JSON.stringify(raw)))
    .mockResolvedValueOnce(new Response("{}", { status: 404 }));
  const response = await request({
    action: "sync-timelines",
    startTime: 1767225600,
    endTime: 1798761600,
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ done: 2, remaining: 4 });
  expect(provider.mock.calls[0][0]).toContain("/matches/EUW1_9/timeline");
  // The usable one is stored; the expired one is marked checked so the pull ends.
  expect(updates[0]).toMatchObject({ review_checked: true, review: { playerId: 3 } });
  expect(updates[1]).toEqual({ review: null, review_checked: true });
  expect(JSON.stringify(updates[0])).not.toContain('"me"');
});
it("rejects malformed time windows before calling Riot", async () => {
  for (const bad of [
    { startTime: 1767225600 },
    { startTime: 1767225600, endTime: 1767225600 },
    { startTime: 1000, endTime: 2000 },
    { startTime: 1767225600, endTime: 1767225600 + 400 * 86400 },
  ])
    expect((await request({ action: "sync", ...bad })).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
});
