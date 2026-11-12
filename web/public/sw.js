// Caches third-party League assets only; the app shell and every API call
// (Supabase, Riot proxy, video) always go to the network.
const IMAGES = 'league-art-v1'
const CATALOGUE = 'league-catalogue-v1'

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

// Versioned Data Dragon paths never change, so images are cache-first for good.
// Community Dragon's `latest` path can change, so those revalidate in the background.
async function cacheFirst(request, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone())
  return response
}
async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok || response.type === 'opaque') cache.put(request, response.clone())
      return response
    })
    .catch((error) => {
      if (hit) return hit
      throw error
    })
  return hit || network
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.hostname === 'ddragon.leagueoflegends.com') {
    if (url.pathname === '/api/versions.json')
      return event.respondWith(staleWhileRevalidate(request, CATALOGUE))
    if (url.pathname.startsWith('/cdn/') && url.pathname.includes('/img/'))
      return event.respondWith(cacheFirst(request, IMAGES))
    if (url.pathname.startsWith('/cdn/')) return event.respondWith(cacheFirst(request, CATALOGUE)) // versioned JSON
  }
  if (url.hostname === 'raw.communitydragon.org')
    event.respondWith(staleWhileRevalidate(request, IMAGES))
})
