import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionUpload, validUpload } from "../stream/uploads.ts";
import { recordingDate, rememberedImports } from "../stream/reconcile.ts";
import { validReview } from "./review.ts";
type Dependencies = {
  env(key: string): string | undefined;
  createClient(url: string, key: string, options?: object): SupabaseClient;
  fetch: typeof fetch;
};
class Failure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function createCompanionHandler(deps: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    };
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
    try {
      const token = request.headers.get("x-companion-token") ?? "";
      if (!/^[a-f0-9]{64}$/.test(token))
        throw new Failure(
          401,
          "Connect League Helper to your web account first.",
        );
      const admin = deps.createClient(
        deps.env("SUPABASE_URL")!,
        deps.env("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: owner, error: authError } = await admin.rpc(
        "authorize_companion",
        { p_token: token },
      );
      if (authError || !owner)
        throw new Failure(
          401,
          "Connection not approved, expired or disconnected. Connect again in your browser.",
        );
      // Bound memory before parsing; native requests contain reduced data only.
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (!reader) throw new Failure(400, "Invalid request.");
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 2_000_000) {
          await reader.cancel();
          throw new Failure(413, "Timeline too large.");
        }
        chunks.push(next.value);
      }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        raw.set(chunk, offset);
        offset += chunk.length;
      }
      let body;
      try {
        body = JSON.parse(new TextDecoder().decode(raw));
      } catch {
        throw new Failure(400, "Invalid request.");
      }
      if (!body || typeof body !== "object")
        throw new Failure(400, "Invalid request.");
      if (body.action === "check")
        return reply({ connected: true, ownerId: owner });
      const account = deps.env("CLOUDFLARE_ACCOUNT_ID"),
        apiToken = deps.env("CLOUDFLARE_API_TOKEN");
      if (!account || !apiToken)
        throw new Failure(503, "Video hosting is not configured.");
      if (body.action === "upload-create") {
        if (!validUpload(body))
          throw new Failure(
            400,
            "Choose a supported video up to 30 GB and 120 minutes, with a title.",
          );
        return reply(
          await provisionUpload({
            account,
            apiToken,
            ownerId: owner,
            input: body,
            fetch: deps.fetch,
          }),
        );
      }
      if (
        !["upload-status", "publish"].includes(body.action) ||
        !/^[a-f0-9]{32}$/.test(body.videoId ?? "")
      )
        throw new Failure(400, "Choose an upload.");
      // Validate before any provider call or library mutation.
      if (
        body.action === "publish" &&
        (!validReview(body.review) ||
          typeof body.anchor?.gameTimeSeconds !== "number" ||
          !Number.isFinite(body.anchor.gameTimeSeconds) ||
          body.anchor.gameTimeSeconds < 0 ||
          body.anchor.gameTimeSeconds > 14400 ||
          typeof body.anchor?.videoOffsetSeconds !== "number" ||
          !Number.isFinite(body.anchor.videoOffsetSeconds) ||
          body.anchor.videoOffsetSeconds < 0 ||
          body.anchor.videoOffsetSeconds > 86400)
      )
        throw new Failure(
          400,
          "Invalid timeline or clock sync. Prepare this recording again.",
        );
      const response = await deps.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${account}/stream/${body.videoId}`,
        {
          headers: { Authorization: `Bearer ${apiToken}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new Failure(502, "Could not check the upload. Try again.");
      const provider = await response.json();
      const video = provider.result;
      if (
        !provider.success ||
        !video ||
        video.uid !== body.videoId ||
        video.creator !== owner ||
        video.meta?.appupload !== "true"
      )
        throw new Failure(404, "Upload unavailable.");
      if (!video.requireSignedURLs)
        throw new Failure(
          409,
          "This upload must require signed URLs before it can be published.",
        );
      if (video.status?.state === "error")
        return reply({
          state: "error",
          message:
            "Cloudflare could not process this video. Check its format in Cloudflare.",
        });
      if (!video.readyToStream)
        return reply({
          state: ["pendingupload", "uploading"].includes(video.status?.state)
            ? "uploading"
            : "processing",
        });
      if (body.action === "upload-status") return reply({ state: "ready" });
      if (
        body.review.ultimates.videoTimestampsMs.some(
          (t: number) => t > Math.ceil(video.duration * 1000),
        )
      )
        throw new Failure(400, "Ultimate timestamps extend beyond this video.");
      const { data: existing, error: lookupError } = await admin.rpc(
        "companion_recording",
        { p_owner: owner, p_video: body.videoId },
      );
      if (lookupError) throw new Failure(503, "Could not check your library.");
      let recordingId = existing;
      if (!recordingId) {
        if ((await rememberedImports(admin, owner)).has(body.videoId))
          throw new Failure(
            409,
            "This video was removed from your library. Use Add existing video to restore it.",
          );
        const title = video.meta?.name?.trim();
        if (!title || title.length > 160)
          throw new Failure(400, "The upload needs a title.");
        const { data, error } = await admin.rpc("add_stream_recording", {
          p_owner: owner,
          p_title: title,
          p_video_id: body.videoId,
          p_recorded_on: recordingDate(video.meta.recordedon),
        });
        if (error && error.code !== "23505")
          throw new Failure(
            503,
            "Could not save the recording. Retry to finish publishing.",
          );
        if (error) {
          const result = await admin.rpc("companion_recording", {
            p_owner: owner,
            p_video: body.videoId,
          });
          recordingId = result.data;
        } else recordingId = data;
      }
      if (!recordingId)
        throw new Failure(
          503,
          "Could not confirm the recording. Retry to finish publishing.",
        );
      const { error } = await admin.rpc("publish_companion_review", {
        p_owner: owner,
        p_recording: recordingId,
        p_review: body.review,
        p_game_time: body.anchor.gameTimeSeconds,
        p_video_offset: body.anchor.videoOffsetSeconds,
      });
      if (error)
        throw new Failure(
          503,
          "Video uploaded; timeline could not be saved. Retry to finish publishing.",
        );
      return reply({ state: "published", recordingId });
    } catch (error) {
      return reply(
        {
          error:
            error instanceof Failure
              ? error.message
              : "Upload service unavailable. Please try again.",
        },
        error instanceof Failure ? error.status : 503,
      );
    }
  };
}
