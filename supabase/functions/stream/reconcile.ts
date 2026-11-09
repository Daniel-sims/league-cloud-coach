import type { SupabaseClient } from '@supabase/supabase-js'

export type CloudUpload = {
  uid: string
  creator?: string
  requireSignedURLs?: boolean
  readyToStream?: boolean
  meta?: Record<string, unknown>
  status?: { state?: string }
}
export type UploadState = {
  videoId: string
  title: string
  state: 'uploading' | 'processing' | 'error'
  message?: string
}
export function recordingDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}
export async function rememberedImports(
  admin: SupabaseClient,
  ownerId: string,
): Promise<Set<string>> {
  const { data, error } = await admin.rpc('list_stream_imports', { p_owner: ownerId })
  if (error) throw new Error('Could not check completed uploads.')
  return new Set(Array.isArray(data) ? data : [])
}
export async function reconcileUploads(options: {
  admin: SupabaseClient
  ownerId: string
  videos: CloudUpload[]
}): Promise<{ imported: number; pending: UploadState[] }> {
  const { admin, ownerId, videos } = options
  const importedIDs = await rememberedImports(admin, ownerId)
  let imported = 0
  const pending: UploadState[] = []
  for (const video of videos) {
    if (
      video.creator !== ownerId ||
      video.meta?.appupload !== 'true' ||
      !/^[a-f0-9]{32}$/.test(video.uid) ||
      importedIDs.has(video.uid)
    )
      continue
    const title = typeof video.meta.name === 'string' ? video.meta.name.trim() : ''
    if (!video.requireSignedURLs || !title || title.length > 160) {
      pending.push({
        videoId: video.uid,
        title: title || 'Uploaded video',
        state: 'error',
        message: 'Check this video’s title and privacy in Cloudflare.',
      })
    } else if (video.status?.state === 'error') {
      pending.push({
        videoId: video.uid,
        title,
        state: 'error',
        message: 'Cloudflare could not process this video. Check its format and duration limit.',
      })
    } else if (!video.readyToStream) {
      pending.push({
        videoId: video.uid,
        title,
        state: ['pendingupload', 'uploading'].includes(video.status?.state || '')
          ? 'uploading'
          : 'processing',
      })
    } else {
      const { error } = await admin.rpc('add_stream_recording', {
        p_owner: ownerId,
        p_title: title,
        p_video_id: video.uid,
        p_recorded_on: recordingDate(video.meta.recordedon),
      })
      if (error && error.code !== '23505')
        pending.push({
          videoId: video.uid,
          title,
          state: 'error',
          message: 'Your video is ready, but could not be added. Try refreshing uploads.',
        })
      else {
        importedIDs.add(video.uid)
        imported++
      }
    }
  }
  return { imported, pending }
}
