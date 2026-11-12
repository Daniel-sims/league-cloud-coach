import type { LeagueMatch } from './league'

// Saved games are immutable apart from a rare backfill, so each profile's
// history is kept in the browser and only games it does not hold are fetched.
const PAGE = 200
const MAX_AGE = 24 * 60 * 60 * 1000 // a full reload daily picks up backfilled fields
const DB = 'league-match-cache'
const STORE = 'profiles'

interface Entry {
  matches: LeagueMatch[]
  savedAt: number
}
export type FetchPage = (id: string, known: string[], limit: number) => Promise<LeagueMatch[]>

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

export async function cachedMatches(id: string, fetchPage: FetchPage): Promise<LeagueMatch[]> {
  const cached = await load(id)
  const fresh = cached && Date.now() - cached.savedAt < MAX_AGE
  const byId = new Map((fresh ? cached.matches : []).map((m) => [m.id, m]))
  for (;;) {
    const page = await fetchPage(id, [...byId.keys()], PAGE)
    for (const match of page) byId.set(match.id, match)
    if (page.length < PAGE) break
  }
  const matches = [...byId.values()].sort((a, b) => b.gameCreation - a.gameCreation)
  void save(id, { matches, savedAt: fresh ? cached.savedAt : Date.now() })
  return matches
}
