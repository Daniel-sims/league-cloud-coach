import { streamRequest } from './supabase'

export type PendingUpload = {
  videoId: string
  uploadURL: string
  filename: string
  size: number
  lastModified: number
  title: string
  recordedOn: string | null
  stage: 'uploading' | 'processing'
  createdAt: number
}
const key = (ownerId: string) => `league-cloud-coach.upload:${ownerId}`
export function validUploadURL(value: string) {
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
export function loadPendingUpload(ownerId: string): PendingUpload | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(ownerId)) || 'null')
    if (
      !value ||
      !/^[a-f0-9]{32}$/.test(value.videoId) ||
      !validUploadURL(value.uploadURL) ||
      typeof value.filename !== 'string' ||
      typeof value.title !== 'string' ||
      typeof value.lastModified !== 'number' ||
      !Number.isSafeInteger(value.size) ||
      value.size <= 0 ||
      !['uploading', 'processing'].includes(value.stage)
    )
      return null
    return value
  } catch {
    return null
  }
}
export function savePendingUpload(ownerId: string, upload: PendingUpload | null) {
  if (upload) localStorage.setItem(key(ownerId), JSON.stringify(upload))
  else localStorage.removeItem(key(ownerId))
}
export function sameFile(file: File, pending: PendingUpload) {
  return (
    file.name === pending.filename &&
    file.size === pending.size &&
    file.lastModified === pending.lastModified
  )
}
export function validateVideoFile(file: File): string | null {
  if (!/\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(file.name))
    return 'Choose an MP4, MOV, M4V, MKV, WebM or AVI video.'
  if (file.size <= 0 || file.size > 30_000_000_000)
    return 'Choose a video larger than zero bytes and no larger than 30 GB.'
  return null
}
export async function reserveUpload(
  file: File,
  title: string,
  recordedOn: string | null,
  maxDuration: number,
): Promise<PendingUpload> {
  const error = validateVideoFile(file)
  if (error) throw new Error(error)
  const result = await streamRequest<{ videoId: string; uploadURL: string }>('upload-create', {
    filename: file.name,
    size: file.size,
    title: title.trim(),
    recordedOn,
    maxDuration,
  })
  if (!validUploadURL(result.uploadURL) || !/^[a-f0-9]{32}$/.test(result.videoId))
    throw new Error('Cloudflare returned an invalid upload destination.')
  return {
    ...result,
    filename: file.name,
    size: file.size,
    lastModified: file.lastModified,
    title: title.trim(),
    recordedOn,
    stage: 'uploading',
    createdAt: Date.now(),
  }
}
export async function checkUpload(videoId: string) {
  return streamRequest<{ state: 'uploading' | 'processing' | 'ready' | 'error'; message?: string }>(
    'upload-status',
    { videoId },
  )
}
