import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCompanionHandler } from "./handler";
import { validReview } from "./review";
const owner = "11111111-1111-4111-8111-111111111111";
const videoId = "a".repeat(32);
const payload = () => ({
  version: 1,
  matchId: "EUW1_123",
  queueId: 420,
  gameVersion: "16.1.1",
  gameCreation: 1794304800000,
  gameDuration: 1800,
  playerId: 1,
  participants: [
    {
      id: 1,
      championId: 4,
      championName: "TwistedFate",
      teamId: 100,
      position: "MIDDLE",
    },
  ],
  frames: [],
  kills: [],
  items: [],
  plates: [],
  buildings: [],
  monsters: [],
  ultimates: { detectorVersion: 1, videoTimestampsMs: [10000] },
});
function setup(
  options: {
    revoked?: boolean;
    otherOwner?: boolean;
    private?: boolean;
    removed?: boolean;
    existing?: boolean;
    processing?: boolean;
    saveError?: boolean;
  } = {},
) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "authorize_companion")
      return { data: options.revoked ? null : owner, error: null };
    if (name === "companion_recording")
      return { data: options.existing ? "recording-id" : null, error: null };
    if (name === "list_stream_imports")
      return { data: options.removed ? [videoId] : [], error: null };
    if (name === "add_stream_recording")
      return { data: "recording-id", error: null };
    return { data: null, error: options.saveError ? { code: "fail" } : null };
  });
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: {
            uid: videoId,
            creator: options.otherOwner ? "another-owner" : owner,
            requireSignedURLs: options.private !== false,
            readyToStream: !options.processing,
            duration: 1800,
            status: { state: options.processing ? "inprogress" : "ready" },
            meta: { appupload: "true", name: "Game" },
          },
        }),
      ),
  );
  const handler = createCompanionHandler({
    env: (name) => name,
    createClient: () => ({ rpc }) as unknown as SupabaseClient,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  const send = (body: unknown, token = "b".repeat(64)) =>
    handler(
      new Request("https://example.test", {
        method: "POST",
        headers: { "x-companion-token": token },
        body: JSON.stringify(body),
      }),
    );
  return { rpc, fetch, send };
}
const publish = () => ({
  action: "publish",
  videoId,
  review: payload(),
  anchor: { gameTimeSeconds: 0, videoOffsetSeconds: 10 },
});
describe("companion authorization and publish", () => {
  it("rejects missing/revoked connections before provider access", async () => {
    for (const revoked of [false, true]) {
      const t = setup({ revoked });
      expect(
        (await t.send(publish(), revoked ? "b".repeat(64) : "")).status,
      ).toBe(401);
      expect(t.fetch).not.toHaveBeenCalled();
    }
  });
  it("connection check requires no Cloudflare requests", async () => {
    const t = setup();
    expect(await (await t.send({ action: "check" })).json()).toEqual({
      connected: true,
      ownerId: owner,
    });
    expect(t.fetch).not.toHaveBeenCalled();
  });
  it("denies other owners and unsigned videos", async () => {
    for (const options of [{ otherOwner: true }, { private: false }]) {
      const t = setup(options);
      expect((await t.send(publish())).status).toBe(
        options.otherOwner ? 404 : 409,
      );
      expect(
        t.rpc.mock.calls.some(([name]) => name === "publish_companion_review"),
      ).toBe(false);
    }
  });
  it("publishes a verified private upload and reuses an existing recording on retries", async () => {
    for (const existing of [false, true]) {
      const t = setup({ existing });
      const response = await t.send(publish());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        state: "published",
        recordingId: "recording-id",
      });
      expect(t.rpc).toHaveBeenCalledWith(
        "publish_companion_review",
        expect.objectContaining({
          p_owner: owner,
          p_recording: "recording-id",
          p_game_time: 0,
          p_video_offset: 10,
        }),
      );
      expect(
        t.rpc.mock.calls.some(([name]) => name === "add_stream_recording"),
      ).toBe(!existing);
    }
  });
  it("does not restore removed recordings or report success before timeline save", async () => {
    expect((await setup({ removed: true }).send(publish())).status).toBe(409);
    expect(
      (await setup({ saveError: true, existing: true }).send(publish())).status,
    ).toBe(503);
    const t = setup({ processing: true });
    expect(await (await t.send(publish())).json()).toEqual({
      state: "processing",
    });
    expect(
      t.rpc.mock.calls.some(([name]) => name === "publish_companion_review"),
    ).toBe(false);
  });
  it("rejects raw identity data, invalid clock sync and out-of-video markers", async () => {
    const t = setup();
    const identity = publish();
    Object.assign(identity.review.participants[0], { puuid: "secret" });
    expect((await t.send(identity)).status).toBe(400);
    const time = publish();
    time.anchor.videoOffsetSeconds = -1;
    expect((await t.send(time)).status).toBe(400);
    const marker = publish();
    marker.review.ultimates.videoTimestampsMs = [1800001];
    expect((await t.send(marker)).status).toBe(400);
  });
  it("strictly validates bounded review payloads", () => {
    expect(validReview(payload())).toBe(true);
    expect(validReview({ ...payload(), monsters: [{ t: 1, killer: 1, team: 300, assists: [], type: 'HORDE', subType: null }] })).toBe(true);
    expect(validReview({ ...payload(), puuid: "secret" })).toBe(false);
    expect(validReview({ ...payload(), playerId: 2 })).toBe(false);
    expect(
      validReview({
        ...payload(),
        ultimates: { detectorVersion: 1, videoTimestampsMs: [-1] },
      }),
    ).toBe(false);
  });
});
