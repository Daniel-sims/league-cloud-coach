import type { LibraryRepository, Recording } from './types'

const storageKey = 'league-cloud-coach.local.v1'
function read(): Recording[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}
function write(records: Recording[]) {
  localStorage.setItem(storageKey, JSON.stringify(records))
}

/** Development-only scratch library, never an account or a cloud-sharing substitute. */
export const localRepository: LibraryRepository = {
  async list() {
    return read()
  },
  async add(input) {
    const records = read()
    if (records.some((r) => r.youtube_video_id === input.youtube_video_id))
      throw new Error('This YouTube video is already in your library.')
    write([
      { ...input, id: crypto.randomUUID(), created_at: new Date().toISOString(), has_share: false },
      ...records,
    ])
  },
  async rename(id, title) {
    write(read().map((r) => (r.id === id ? { ...r, title } : r)))
  },
  async remove(id) {
    write(read().filter((r) => r.id !== id))
  },
  async share() {
    throw new Error(
      'Connect Supabase to create a shared watch page. You can copy the YouTube link in this local preview.',
    )
  },
  async revoke() {
    throw new Error('Cloud sharing is not available in the local preview.')
  },
}
