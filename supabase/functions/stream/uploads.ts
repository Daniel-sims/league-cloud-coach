export const MAX_UPLOAD_BYTES = 30_000_000_000
export const UPLOAD_DURATIONS = [1800, 3600, 5400, 7200]
export const VIDEO_FILENAME = /\.(mp4|mov|m4v|mkv|webm|avi)$/i

export type UploadInput = {
  filename: string
  size: number
  title: string
  recordedOn?: string | null
  maxDuration: number
}
export function validUpload(input: Partial<UploadInput>): input is UploadInput {
  return (
    typeof input.filename === 'string' &&
    input.filename.length <= 255 &&
    VIDEO_FILENAME.test(input.filename) &&
    typeof input.size === 'number' &&
    Number.isSafeInteger(input.size) &&
    input.size > 0 &&
    input.size <= MAX_UPLOAD_BYTES &&
    typeof input.title === 'string' &&
    input.title.trim().length > 0 &&
    input.title.trim().length <= 160 &&
    UPLOAD_DURATIONS.includes(input.maxDuration!) &&
    (!input.recordedOn ||
      (typeof input.recordedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.recordedOn)))
  )
}
export function isUploadURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      ['upload.videodelivery.net', 'upload.cloudflarestream.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
function base64(value: string) {
  return btoa(Array.from(new TextEncoder().encode(value), (x) => String.fromCharCode(x)).join(''))
}
export async function provisionUpload(options: {
  account: string
  apiToken: string
  ownerId: string
  input: UploadInput
  fetch: typeof fetch
}): Promise<{ videoId: string; uploadURL: string }> {
  const { account, apiToken, ownerId, input } = options
  const metadata = {
    name: input.title.trim(),
    maxdurationseconds: String(input.maxDuration),
    appupload: 'true',
    ...(input.recordedOn ? { recordedon: input.recordedOn } : {}),
  }
  const response = await options.fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(input.size),
        'Upload-Creator': ownerId,
        'Upload-Metadata': [
          ...Object.entries(metadata).map(([key, value]) => `${key} ${base64(value)}`),
          'requiresignedurls',
        ].join(','),
      },
      signal: AbortSignal.timeout(15000),
    },
  )
  const uploadURL = response.headers.get('Location') || ''
  const videoId = response.headers.get('stream-media-id') || ''
  if (!response.ok || !isUploadURL(uploadURL) || !/^[a-f0-9]{32}$/.test(videoId))
    throw new Error(
      'Could not reserve this upload. Check Cloudflare storage capacity and try again.',
    )
  return { videoId, uploadURL }
}
