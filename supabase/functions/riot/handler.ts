import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken, encryptToken } from "./tokens.ts";
import { reduceTimeline, TimelineError } from "./timeline.ts";

type Dependencies = {
  env(key: string): string | undefined;
  createClient(url: string, key: string, options?: object): SupabaseClient;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  crypto?: Crypto;
};
class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const regions: Record<string, string> = {
  euw1: "europe",
  eun1: "europe",
  na1: "americas",
  kr: "asia",
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// Keep only the post-game fields this product uses; never persist keys.
const matchFields = [
  "puuid",
  "teamId",
  "championId",
  "championName",
  "riotIdGameName",
  "riotIdTagline",
  "summonerName",
  "teamPosition",
  "win",
  "gameEndedInEarlySurrender",
  "kills",
  "deaths",
  "assists",
  "champLevel",
  "summonerLevel",
  "totalMinionsKilled",
  "neutralMinionsKilled",
  "goldEarned",
  "totalDamageDealtToChampions",
  "totalDamageTaken",
  "wardsPlaced",
  "wardsKilled",
  "visionWardsBoughtInGame",
  "visionScore",
  "summoner1Id",
  "summoner2Id",
  "item0",
  "item1",
  "item2",
  "item3",
  "item4",
  "item5",
  "item6",
  "perks",
];
function reduceMatch(
  id: string,
  info: Record<string, unknown> & { participants: Record<string, unknown>[] },
) {
  return {
    id,
    queueId: info.queueId,
    gameCreation: info.gameCreation,
    gameDuration: info.gameDuration,
    gameVersion: info.gameVersion,
    participants: info.participants.map((p) =>
      Object.fromEntries(
        matchFields.filter((f) => p[f] !== undefined).map((f) => [f, p[f]]),
      ),
    ),
  };
}

export function createRiotHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const reply = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers });
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
    try {
      const jwt = request.headers.get("Authorization")?.replace(/^Bearer /, "");
      if (!jwt) throw new Failure(401, "Sign in to view your League accounts.");
      const admin = deps.createClient(
        deps.env("SUPABASE_URL")!,
        deps.env("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: auth, error: authError } = await admin.auth.getUser(jwt);
      if (authError || !auth.user)
        throw new Failure(401, "Sign in again to continue.");
      const ownerId = auth.user.id;
      const { data: membership, error: membershipError } = await admin
        .from("owner_memberships")
        .select("enabled")
        .eq("user_id", ownerId)
        .eq("enabled", true)
        .maybeSingle();
      if (membershipError || !membership)
        throw new Failure(403, "Workspace owner access required.");
      const raw = await request.text();
      if (raw.length > 2048) throw new Failure(413, "Request too large.");
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Failure(400, "Invalid request.");
      }
      if (
        !body ||
        typeof body !== "object" ||
        ![
          "connect",
          "view-player",
          "view-matches",
          "sync",
          "refresh-profile",
          "token-status",
          "save-token",
          "remove-token",
          "review-timeline",
        ].includes(body.action)
      )
        throw new Failure(400, "Choose a League action.");
      const { data: credential, error: credentialError } = await admin
        .from("riot_credentials")
        .select("encrypted_token,updated_at")
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (credentialError)
        throw new Failure(
          503,
          "Could not open Riot settings. Please try again.",
        );
      if (body.action === "token-status")
        return reply({
          configured: Boolean(credential),
          sharedDefault: Boolean(deps.env("RIOT_API_KEY")),
          updatedAt: credential?.updated_at ?? null,
        });
      if (body.action === "remove-token") {
        const { error } = await admin
          .from("riot_credentials")
          .delete()
          .eq("owner_id", ownerId);
        if (error)
          throw new Failure(
            503,
            "Could not remove your Riot token. Please retry.",
          );
        return reply({ ok: true });
      }
      const encryptionSecret = deps.env("RIOT_TOKEN_ENCRYPTION_KEY");
      let key: string | undefined;
      if (body.action === "save-token") {
        if (
          typeof body.token !== "string" ||
          !/^RGAPI-[A-Za-z0-9-]{20,100}$/.test(body.token.trim()) ||
          typeof body.platform !== "string" ||
          !regions[body.platform]
        )
          throw new Failure(
            400,
            "Enter a Riot API token and supported region.",
          );
        if (!encryptionSecret)
          throw new Failure(
            503,
            "Token storage is temporarily unavailable. Please try again later.",
          );
        key = body.token.trim();
      } else if (credential) {
        if (!encryptionSecret)
          throw new Failure(
            503,
            "Token storage is temporarily unavailable. Please try again later.",
          );
        try {
          key = await decryptToken(
            credential.encrypted_token,
            encryptionSecret,
            deps.crypto,
          );
        } catch {
          throw new Failure(
            503,
            "Could not open your saved Riot token. Save it again in Settings.",
          );
        }
      } else key = deps.env("RIOT_API_KEY");
      if (!key)
        throw new Failure(
          503,
          "Add your Riot API token in Settings to sync your League account.",
        );
      const sleep =
        deps.sleep ??
        ((ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms)));
      async function riot(host: string, path: string) {
        const { data: wait, error: budgetError } = await admin.rpc(
          "reserve_riot_request",
        );
        if (budgetError || typeof wait !== "number" || wait < 0)
          throw new Failure(
            429,
            "League sync is busy. Please try again in a moment.",
          );
        await sleep(wait);
        const response = await deps.fetch(
          `https://${host}.api.riotgames.com${path}`,
          {
            headers: { "X-Riot-Token": key! },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (response.status === 401 || response.status === 403)
          throw new Failure(
            503,
            "Riot hasn't accepted this token yet. If you just generated it, it may take a few minutes to start working. Otherwise, check or replace it in Settings.",
          );
        if (response.status === 404)
          throw new Failure(
            404,
            "Riot could not find this account or game. Check the Riot ID and region.",
          );
        if (response.status === 429)
          throw new Failure(
            429,
            `Riot is limiting requests. Try again in ${Math.min(120, Math.max(1, Number(response.headers.get("Retry-After")) || 120))} seconds.`,
          );
        if (!response.ok)
          throw new Failure(
            502,
            "Riot is unavailable. Your saved games are still here; try again later.",
          );
        return response.json();
      }
      async function profileData(
        platform: string,
        puuid: string,
        account: { gameName: string; tagLine: string },
      ) {
        const summoner = await riot(
          platform,
          `/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
        );
        const ranks = await riot(
          platform,
          `/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
        );
        if (!Array.isArray(ranks))
          throw new Failure(
            502,
            "Riot returned an incomplete profile. Try again.",
          );
        return {
          gameName: account.gameName,
          tagLine: account.tagLine,
          profileIconId: summoner.profileIconId,
          summonerLevel: summoner.summonerLevel,
          ranks: ranks.map((r) => ({
            queueType: r.queueType,
            tier: r.tier,
            rank: r.rank,
            leaguePoints: r.leaguePoints,
            wins: r.wins,
            losses: r.losses,
          })),
        };
      }
      if (body.action === "save-token") {
        let warning: string | undefined;
        try {
          await riot(body.platform, "/lol/status/v4/platform-data");
        } catch {
          warning =
            "Token saved, but it couldn't be verified with Riot yet. If you just generated it, it may take a few minutes to start working. Try refreshing your match history again shortly.";
        }
        let encrypted: string;
        try {
          encrypted = await encryptToken(key!, encryptionSecret!, deps.crypto);
        } catch {
          throw new Failure(
            503,
            "Could not securely save your Riot token. Please retry.",
          );
        }
        const { error } = await admin.from("riot_credentials").upsert({
          owner_id: ownerId,
          encrypted_token: encrypted,
          updated_at: new Date().toISOString(),
        });
        if (error)
          throw new Failure(
            503,
            "Could not save your Riot token. Please retry.",
          );
        return reply({
          ok: true,
          verified: !warning,
          ...(warning ? { warning } : {}),
        });
      }
      if (body.action === "view-player" || body.action === "view-matches") {
        // Look up another player seen in a game. Nothing is saved; the browser caches it.
        if (
          typeof body.platform !== "string" ||
          !regions[body.platform] ||
          typeof body.puuid !== "string" ||
          !/^[A-Za-z0-9_-]{20,100}$/.test(body.puuid)
        )
          throw new Failure(400, "Choose a player and supported region.");
        const puuid: string = body.puuid;
        const platform: string = body.platform;
        if (body.action === "view-player") {
          const account = await riot(
            regions[platform],
            `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
          );
          if (
            typeof account.gameName !== "string" ||
            typeof account.tagLine !== "string"
          )
            throw new Failure(
              404,
              "This player has no public Riot ID, so their profile can't be opened.",
            );
          return reply({
            profile: await profileData(platform, puuid, account),
          });
        }
        const start = body.start ?? 0;
        const known: unknown = body.known ?? [];
        if (!Number.isInteger(start) || start < 0 || start > 200)
          throw new Failure(400, "Invalid history page.");
        if (
          !Array.isArray(known) ||
          known.length > 60 ||
          known.some(
            (id) => typeof id !== "string" || !/^[A-Z0-9]+_\d+$/.test(id),
          )
        )
          throw new Failure(400, "Invalid saved games list.");
        const ids = await riot(
          regions[platform],
          `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=${start}&count=5`,
        );
        if (
          !Array.isArray(ids) ||
          ids.length > 5 ||
          ids.some(
            (id) => typeof id !== "string" || !/^[A-Z0-9]+_\d+$/.test(id),
          )
        )
          throw new Failure(502, "Riot returned an incomplete match list.");
        const matches = [];
        for (const id of ids) {
          if ((known as string[]).includes(id)) continue;
          const match = await riot(
            regions[platform],
            `/lol/match/v5/matches/${id}`,
          );
          const info = match.info;
          if (
            match.metadata?.matchId !== id ||
            !info ||
            !Array.isArray(info.participants) ||
            !info.participants.some((p: { puuid: string }) => p.puuid === puuid)
          )
            throw new Failure(
              502,
              "Riot returned an incomplete game. Retry to continue.",
            );
          matches.push(reduceMatch(id, info));
        }
        return reply({
          ids,
          matches,
          nextStart: start + ids.length,
          hasMore: ids.length === 5,
        });
      }
      if (body.action === "connect") {
        if (
          typeof body.platform !== "string" ||
          !regions[body.platform] ||
          typeof body.riotId !== "string"
        )
          throw new Failure(400, "Enter a Riot ID and supported region.");
        const parts: string[] = body.riotId.trim().split("#");
        if (
          parts.length !== 2 ||
          !parts.every((p) => p.trim().length > 0 && p.length <= 32)
        )
          throw new Failure(400, "Use your full Riot ID: Name#TAG.");
        const [gameName, tagLine] = parts.map((p) => p.trim());
        const account = await riot(
          regions[body.platform],
          `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
        );
        if (
          typeof account.puuid !== "string" ||
          account.gameName?.toLowerCase() !== gameName.toLowerCase() ||
          account.tagLine?.toLowerCase() !== tagLine.toLowerCase()
        )
          throw new Failure(
            502,
            "Riot returned a different account. Please try again.",
          );
        const profile = await profileData(
          body.platform,
          account.puuid,
          account,
        );
        const { data: saved, error } = await admin
          .from("league_profiles")
          .upsert(
            {
              owner_id: ownerId,
              platform: body.platform,
              puuid: account.puuid,
              profile,
            },
            { onConflict: "owner_id,platform,puuid" },
          )
          .select("id")
          .single();
        if (error || !saved)
          throw new Failure(
            503,
            "Could not save this account. Please try again.",
          );
        return reply({ id: saved.id });
      }
      if (typeof body.profileId !== "string" || !uuid.test(body.profileId))
        throw new Failure(400, "Choose a saved League account.");
      const { data: profile, error: profileError } = await admin
        .from("league_profiles")
        .select("*")
        .eq("id", body.profileId)
        .eq("owner_id", ownerId)
        .maybeSingle();
      if (profileError || !profile)
        throw new Failure(404, "League account unavailable.");
      if (body.action === "review-timeline") {
        // One owner-initiated fetch per recording; guests then read the stored copy.
        if (
          typeof body.recordingId !== "string" ||
          !uuid.test(body.recordingId) ||
          typeof body.matchId !== "string" ||
          !/^[A-Z0-9]+_\d+$/.test(body.matchId)
        )
          throw new Failure(400, "Choose a recording and a synced game.");
        const { data: recording, error: recordingError } = await admin
          .from("recordings")
          .select("id")
          .eq("id", body.recordingId)
          .eq("owner_id", ownerId)
          .maybeSingle();
        if (recordingError || !recording)
          throw new Failure(404, "Recording unavailable.");
        const { data: saved, error: savedError } = await admin
          .from("league_matches")
          .select("match")
          .eq("profile_id", profile.id)
          .eq("match_id", body.matchId)
          .maybeSingle();
        if (savedError) throw new Failure(503, "Could not read saved history.");
        if (!saved)
          throw new Failure(
            404,
            "Sync this game in Home first, then attach it again.",
          );
        const raw = await riot(
          regions[profile.platform],
          `/lol/match/v5/matches/${body.matchId}/timeline`,
        );
        let review;
        try {
          review = reduceTimeline(raw, saved.match, profile.puuid);
        } catch (error) {
          throw new Failure(
            502,
            error instanceof TimelineError
              ? error.message
              : "Riot returned an incomplete timeline. Try again.",
          );
        }
        const { error } = await admin.rpc("save_recording_timeline", {
          p_owner: ownerId,
          p_recording: recording.id,
          p_match: body.matchId,
          p_review: review,
        });
        if (error)
          throw new Failure(
            503,
            "Could not save the game timeline. Please retry.",
          );
        return reply({ ok: true });
      }
      const { data: claimed, error: claimError } = await admin.rpc(
        "claim_league_sync",
        { p_profile: profile.id, p_owner: ownerId },
      );
      if (claimError || !claimed)
        throw new Failure(
          409,
          "This account is already syncing. Please try again shortly.",
        );
      try {
        if (body.action === "refresh-profile") {
          const account = await riot(
            regions[profile.platform],
            `/riot/account/v1/accounts/by-puuid/${encodeURIComponent(profile.puuid)}`,
          );
          const data = await profileData(
            profile.platform,
            profile.puuid,
            account,
          );
          const { error } = await admin
            .from("league_profiles")
            .update({ profile: data })
            .eq("id", profile.id);
          if (error)
            throw new Failure(503, "Could not save your updated profile.");
          return reply({ ok: true });
        }
        const start = body.start ?? 0;
        if (!Number.isInteger(start) || start < 0 || start > 10000)
          throw new Failure(400, "Invalid history page.");
        // Small resumable pages stay inside edge runtime limits. Cache immutable matches.
        const ids = await riot(
          regions[profile.platform],
          `/lol/match/v5/matches/by-puuid/${encodeURIComponent(profile.puuid)}/ids?start=${start}&count=5`,
        );
        if (
          !Array.isArray(ids) ||
          ids.length > 5 ||
          ids.some(
            (id) => typeof id !== "string" || !/^[A-Z0-9]+_\d+$/.test(id),
          )
        )
          throw new Failure(502, "Riot returned an incomplete match list.");
        for (const id of ids) {
          const { data: exists, error: cacheError } = await admin
            .from("league_matches")
            .select("match")
            .eq("profile_id", profile.id)
            .eq("match_id", id)
            .maybeSingle();
          if (cacheError)
            throw new Failure(503, "Could not read saved history.");
          // Games saved before account levels were kept are fetched once more.
          const needsLevel =
            exists &&
            !(exists.match?.participants ?? []).every(
              (p: { summonerLevel?: unknown }) =>
                typeof p.summonerLevel === "number",
            );
          if (exists && !needsLevel) continue;
          let match;
          try {
            match = await riot(
              regions[profile.platform],
              `/lol/match/v5/matches/${id}`,
            );
          } catch (error) {
            if (needsLevel && error instanceof Failure && error.status === 404)
              continue;
            throw error;
          }
          const info = match.info;
          if (
            match.metadata?.matchId !== id ||
            !info ||
            !Array.isArray(info.participants) ||
            !info.participants.some(
              (p: { puuid: string }) => p.puuid === profile.puuid,
            )
          )
            throw new Failure(
              502,
              "Riot returned an incomplete game. Retry to continue syncing.",
            );
          const data = reduceMatch(id, info);
          const { error } = await admin.from("league_matches").upsert({
            profile_id: profile.id,
            match_id: id,
            game_creation: info.gameCreation,
            match: data,
          });
          if (error)
            throw new Failure(
              503,
              "Could not save this game. Retry to continue syncing.",
            );
        }
        const { error } = await admin.rpc("complete_league_sync", {
          p_profile: profile.id,
          p_owner: ownerId,
          p_cursor: start + ids.length,
        });
        if (error)
          throw new Failure(
            503,
            "Games saved, but sync status could not be updated. Please retry.",
          );
        return reply({
          nextStart: start + ids.length,
          hasMore: ids.length === 5,
        });
      } finally {
        await admin
          .from("league_profiles")
          .update({ sync_until: null })
          .eq("id", profile.id);
      }
    } catch (error) {
      return error instanceof Failure
        ? reply({ error: error.message }, error.status)
        : reply(
            {
              error:
                "Could not reach League. Your saved history is safe; please retry.",
            },
            502,
          );
    }
  };
}
