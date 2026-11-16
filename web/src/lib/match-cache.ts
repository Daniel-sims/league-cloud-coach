import type { LeagueMatch } from './league'
import { AccessDeniedError } from './supabase'

// Each profile's history is kept in the browser. The server stamps every saved
// game with when its data last changed, so only games changed after the kept
// cursor are fetched: new games, and the rare backfill of an old one.
const PAGE = 200
// Rewind the cursor this far so a write that committed late is never skipped.
const OVERLAP_MS = 60 * 1000 // each game is saved by its own short statement
const DB = 'league-match-cache'
const STORE = 'profiles'

export type ChangeCursor = { at: string; id: string }
export type ChangePage = { matches: LeagueMatch[]; cursor: ChangeCursor | null }
export type FetchChanges = (
  id: string,
  after: ChangeCursor | null,
  limit: number,
) => Promise<ChangePage>

interface Entry {
  matches: LeagueMatch[]
  /** The last change already held; absent in entries saved before cursors. */
  cursor?: ChangeCursor
  savedAt: number
}

const memory = new Map<string, Entry>()

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function load(id: string): Promise<Entry | undefined> {
  const hit = memory.get(id)
  if (hit) return hit
  try {
    const db = await open()
    const entry = await new Promise<Entry | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(id)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (entry) memory.set(id, entry)
    return entry
  } catch {
    return undefined // storage is optional
  }
}
async function save(id: string, entry: Entry) {
  memory.set(id, entry)
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(entry, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {
    /* storage is optional */
  }
}

// Other League data kept beside the match history (looked-up players), in the
// same database so sign-out wipes it too. Values are structured-cloned.
const extras = new Map<string, unknown>()
export async function readStored<T>(key: string): Promise<T | undefined> {
  if (extras.has(key)) return extras.get(key) as T
  try {
    const db = await open()
    const value = await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (value !== undefined) extras.set(key, value)
    return value
  } catch {
    return undefined // storage is optional
  }
}
export async function writeStored(key: string, value: unknown | undefined) {
  if (value === undefined) extras.delete(key)
  else extras.set(key, value)
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      if (value === undefined) tx.objectStore(STORE).delete(key)
      else tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  } catch {
    /* storage is optional */
  }
}

/** Sign-out and account switches wipe saved history from this browser. */
export function clearMatchCache() {
  memory.clear()
  extras.clear()
  try {
    indexedDB.deleteDatabase(DB)
  } catch {
    /* storage is optional */
  }
}
async function forget(id: string) {
  memory.delete(id)
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  } catch {
    /* storage is optional */
  }
}

const newestFirst = (a: LeagueMatch, b: LeagueMatch) => b.gameCreation - a.gameCreation

/** What this browser already holds, for showing straight away; null when nothing usable. */
export async function storedMatches(id: string): Promise<LeagueMatch[] | null> {
  const entry = await load(id)
  return entry?.cursor ? entry.matches : null
}

// One refresh per profile at a time; a second caller shares the first.
const running = new Map<string, Promise<LeagueMatch[]>>()

export function cachedMatches(id: string, fetchChanges: FetchChanges): Promise<LeagueMatch[]> {
  const active = running.get(id)
  if (active) return active
  const work = refresh(id, fetchChanges).finally(() => running.delete(id))
  running.set(id, work)
  return work
}

async function refresh(id: string, fetchChanges: FetchChanges): Promise<LeagueMatch[]> {
  const cached = await load(id)
  // Entries from before change cursors are rebuilt once from scratch.
  const usable = cached?.cursor ? cached : undefined
  const byId = new Map((usable?.matches ?? []).map((m) => [m.id, m]))
  let after: ChangeCursor | null = usable?.cursor
    ? { at: new Date(Date.parse(usable.cursor.at) - OVERLAP_MS).toISOString(), id: '' }
    : null
  let cursor = usable?.cursor
  for (;;) {
    let page: ChangePage
    try {
      page = await fetchChanges(id, after, PAGE)
    } catch (error) {
      // The profile is no longer this owner's: drop what was kept for it.
      if (error instanceof AccessDeniedError) await forget(id)
      throw error
    }
    for (const match of page.matches) byId.set(match.id, match)
    if (page.cursor && (!cursor || Date.parse(page.cursor.at) >= Date.parse(cursor.at)))
      cursor = page.cursor
    if (page.matches.length < PAGE || !page.cursor) break
    after = page.cursor
  }
  const matches = [...byId.values()].sort(newestFirst)
  // An empty history has no cursor yet; keep it uncached so the next visit asks again.
  if (cursor) void save(id, { matches, cursor, savedAt: Date.now() })
  return matches
}
