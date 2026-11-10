import type { Recording } from './types'

// Only display metadata and image bytes live here. Signed URLs and auth tokens never do.
const project = import.meta.env.VITE_SUPABASE_URL || 'unconfigured'
const prefix = `league-cloud-coach.library.v1:${project}:`
const lifetime = 7 * 24 * 60 * 60 * 1000
const imageLimit = 96
let epoch = 0
let sessionEpoch = 0
let activeAccount: string | null = null
export const libraryCacheEpoch = () => epoch
const libraries = new Map<string, { savedAt: number; records: Recording[] }>()
const catalogs = new Map<string, Set<string>>()
type ImageRow = { key: string; owner: string; savedAt: number; blob: Blob }
const images = new Map<string, { url: string; savedAt: number }>()
const pending = new Map<string, Promise<string>>()
let database: Promise<IDBDatabase | null> | undefined

function imageKey(owner: string, record: Recording) {
  return JSON.stringify([owner, record.id, record.stream_video_id])
}
function cleanRecords(value: unknown): Recording[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null
  const result: Recording[] = []
  for (const row of value) {
    if (
      !row ||
      typeof row.id !== 'string' ||
      row.id.length > 100 ||
      typeof row.title !== 'string' ||
      row.title.length > 160 ||
      typeof row.created_at !== 'string' ||
      row.created_at.length > 100 ||
      typeof row.has_share !== 'boolean' ||
      !(row.recorded_on === null || typeof row.recorded_on === 'string') ||
      !(row.youtube_video_id === null || typeof row.youtube_video_id === 'string') ||
      ![undefined, 'youtube', 'stream'].includes(row.provider) ||
      !(row.stream_video_id == null || typeof row.stream_video_id === 'string')
    )
      return null
    result.push({
      id: row.id,
      title: row.title,
      created_at: row.created_at,
      recorded_on: row.recorded_on,
      has_share: row.has_share,
      provider: row.provider,
      youtube_video_id: row.youtube_video_id,
      stream_video_id: row.stream_video_id,
    })
  }
  return result
}
export function readLibraryCache(owner?: string): Recording[] | null {
  if (!owner) return null
  try {
    const saved = libraries.get(owner) ?? JSON.parse(localStorage.getItem(prefix + owner) || 'null')
    if (
      !saved ||
      !Number.isFinite(saved.savedAt) ||
      Date.now() - saved.savedAt > lifetime ||
      saved.savedAt > Date.now() + 60000
    )
      return null
    const records = cleanRecords(saved.records)
    if (!records) return null
    libraries.set(owner, { savedAt: saved.savedAt, records })
    catalogs.set(owner, new Set(records.map((r) => imageKey(owner, r))))
    return records
  } catch {
    return null
  }
}
export function saveLibraryCache(
  owner: string | undefined,
  records: Recording[],
  expectedEpoch = epoch,
) {
  if (!owner || expectedEpoch !== epoch) return
  const clean = cleanRecords(records)
  if (!clean) return
  const saved = { savedAt: Date.now(), records: clean }
  libraries.set(owner, saved)
  try {
    localStorage.setItem(prefix + owner, JSON.stringify(saved))
  } catch {
    /* Private/quota-limited browsers use memory. */
  }
  const keys = new Set(clean.map((r) => imageKey(owner, r)))
  catalogs.set(owner, keys)
  for (const [key, image] of images) {
    if (JSON.parse(key)[0] === owner && !keys.has(key)) {
      URL.revokeObjectURL(image.url)
      images.delete(key)
    }
  }
  void pruneImages(owner, keys)
}
/** A successful mutation invalidates stale in-flight list reads without discarding unchanged images. */
export function invalidateLibraryCache(owner?: string) {
  epoch++
  if (!owner) return
  libraries.delete(owner)
  try {
    localStorage.removeItem(prefix + owner)
  } catch {
    /* Optional storage. */
  }
}
function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database
  database = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const request = indexedDB.open(prefix + 'images', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('images', { keyPath: 'key' }).createIndex('owner', 'owner')
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          database = undefined
        }
        resolve(db)
      }
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return database
}
async function readImage(key: string): Promise<ImageRow | null> {
  const db = await openDatabase()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction('images').objectStore('images').get(key)
      request.onsuccess = () => {
        const row = request.result as ImageRow | undefined
        resolve(row && Date.now() - row.savedAt < lifetime && row.blob instanceof Blob ? row : null)
      }
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}
async function storeImage(row: ImageRow, expectedEpoch: number) {
  const db = await openDatabase()
  if (
    !db ||
    sessionEpoch !== expectedEpoch ||
    (catalogs.has(row.owner) && !catalogs.get(row.owner)!.has(row.key))
  )
    return
  try {
    const store = db.transaction('images', 'readwrite').objectStore('images')
    store.put(row)
    const request = store.index('owner').getAll(row.owner)
    request.onsuccess = () => {
      const rows = (request.result as ImageRow[]).sort((a, b) => b.savedAt - a.savedAt)
      for (const stale of rows.filter(
        (r, index) => index >= imageLimit || Date.now() - r.savedAt > lifetime,
      ))
        store.delete(stale.key)
    }
  } catch {
    /* Caching is optional. */
  }
}
async function pruneImages(owner: string, keys: Set<string>) {
  const expectedEpoch = sessionEpoch
  const db = await openDatabase()
  if (!db || sessionEpoch !== expectedEpoch) return
  try {
    const store = db.transaction('images', 'readwrite').objectStore('images')
    const request = store.index('owner').openCursor(owner)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if (
        !(catalogs.get(owner) ?? keys).has(cursor.value.key) ||
        Date.now() - cursor.value.savedAt > lifetime
      )
        cursor.delete()
      cursor.continue()
    }
  } catch {
    /* Caching is optional. */
  }
}
function objectURL(key: string, blob: Blob) {
  const old = images.get(key)
  if (old) URL.revokeObjectURL(old.url)
  const url = URL.createObjectURL(blob)
  images.set(key, { url, savedAt: Date.now() })
  while (images.size > imageLimit) {
    const first = images.entries().next().value!
    URL.revokeObjectURL(first[1].url)
    images.delete(first[0])
  }
  return url
}
export function cachedThumbnailURL(owner: string | undefined, record: Recording): string | null {
  if (!owner) return null
  const image = images.get(imageKey(owner, record))
  return image && Date.now() - image.savedAt < lifetime ? image.url : null
}
export async function libraryThumbnail(
  owner: string | undefined,
  record: Recording,
  loadURL: () => Promise<string>,
  force = false,
): Promise<string> {
  if (!owner || typeof indexedDB === 'undefined' || typeof URL.createObjectURL !== 'function')
    return loadURL()
  const key = imageKey(owner, record)
  if (!force) {
    const memory = cachedThumbnailURL(owner, record)
    if (memory) return memory
    const running = pending.get(key)
    if (running) return running
  }
  const expectedEpoch = sessionEpoch
  const load = async () => {
    if (!force) {
      const saved = await readImage(key)
      if (sessionEpoch !== expectedEpoch) throw new Error('Account changed.')
      if (saved) return objectURL(key, saved.blob)
    }
    const signedURL = await loadURL()
    if (sessionEpoch !== expectedEpoch) throw new Error('Account changed.')
    try {
      const response = await fetch(signedURL, {
        credentials: 'omit',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) return signedURL
      const blob = await response.blob()
      if (!/^image\/(jpeg|png|webp|avif)$/.test(blob.type) || blob.size > 256 * 1024)
        return signedURL
      if (sessionEpoch !== expectedEpoch || (catalogs.has(owner) && !catalogs.get(owner)!.has(key)))
        throw new Error('Library changed.')
      await storeImage({ key, owner, savedAt: Date.now(), blob }, expectedEpoch)
      if (sessionEpoch !== expectedEpoch) throw new Error('Account changed.')
      return objectURL(key, blob)
    } catch {
      if (sessionEpoch !== expectedEpoch) throw new Error('Account changed.')
      return signedURL // CORS/storage failures must not prevent the image itself from displaying.
    }
  }
  const promise = load()
  pending.set(key, promise)
  try {
    return await promise
  } finally {
    if (pending.get(key) === promise) pending.delete(key)
  }
}
/** Also handles a different account restoring a session after the app was closed. */
export function selectLibraryCacheAccount(owner: string | null) {
  let previous = activeAccount
  try {
    previous ||= localStorage.getItem(prefix + 'account')
  } catch {
    /* Optional storage. */
  }
  if (!owner || (previous && previous !== owner)) clearLibraryCaches()
  activeAccount = owner
  if (owner) {
    try {
      localStorage.setItem(prefix + 'account', owner)
    } catch {
      /* Optional storage. */
    }
  }
}
export function clearLibraryCaches() {
  activeAccount = null
  epoch++
  sessionEpoch++
  libraries.clear()
  catalogs.clear()
  pending.clear()
  for (const image of images.values()) URL.revokeObjectURL(image.url)
  images.clear()
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith(prefix)) localStorage.removeItem(key)
    }
  } catch {
    /* Storage may be unavailable. */
  }
  void openDatabase().then((db) => {
    try {
      db?.transaction('images', 'readwrite').objectStore('images').clear()
    } catch {
      /* Optional cache. */
    }
  })
}
