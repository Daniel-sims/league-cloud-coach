// Caches third-party League assets only; the app shell and every API call
// (Supabase, Riot proxy, video) always go to the network.
//
// Both art hosts send `Access-Control-Allow-Origin: *`, so every request is
// refetched in CORS mode. Opaque (no-cors) responses must never be stored:
// Chrome counts each one as several megabytes of quota whatever its real size,
// and a failed opaque response looks like a success, so a broken image would
// stick for good. v1 caches held opaque entries; bumping the names drops them.
const IMAGES = 'league-art-v2'
const CATALOGUE = 'league-catalogue-v2'
const MAX_IMAGES = 1500 // a few patches of items, champions, runes and crests

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== IMAGES && k !== CATALOGUE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

const corsFetch = (request) => fetch(request.url, { mode: 'cors', credentials: 'omit' })

// Keys come back in insertion order, so the oldest entries go first.
let trimming = false
async function trim(cache) {
  if (trimming) return
  trimming = true
  try {
    const keys = await cache.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))) await cache.delete(key)
  } finally {
    trimming = false
  }
}
async function store(name, request, response) {
  if (!response.ok) return
  const cache = await caches.open(name)
  await cache.put(request.url, response)
  if (name === IMAGES) await trim(cache)
}

// Versioned Data Dragon paths never change, so they are cache-first for good.
async function cacheFirst(event, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(event.request.url)
  if (hit) return hit
  const response = await corsFetch(event.request)
  event.waitUntil(store(name, event.request, response.clone()))
  return response
}
// Community Dragon's `latest` path and the version list can change, so those
// answer from the cache and refresh it in the background.
async function staleWhileRevalidate(event, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(event.request.url)
  const network = corsFetch(event.request).then((response) => {
    event.waitUntil(store(name, event.request, response.clone()))
    return response
  })
  if (hit) {
    event.waitUntil(network.catch(() => undefined))
    return hit
  }
  return network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.hostname === 'ddragon.leagueoflegends.com') {
    if (url.pathname === '/api/versions.json')
      return event.respondWith(staleWhileRevalidate(event, CATALOGUE))
    if (url.pathname.startsWith('/cdn/') && url.pathname.includes('/img/'))
      return event.respondWith(cacheFirst(event, IMAGES))
    if (url.pathname.startsWith('/cdn/')) return event.respondWith(cacheFirst(event, CATALOGUE)) // versioned JSON
  }
  if (url.hostname === 'raw.communitydragon.org') {
    const json = url.pathname.endsWith('.json')
    event.respondWith(staleWhileRevalidate(event, json ? CATALOGUE : IMAGES))
  }
})
