/**
 * Keeps an hls.js session playing across Cloudflare playback-lease renewals
 * without reloading the source.
 *
 * Cloudflare signs every playlist and segment URL, and the signatures expire
 * with the lease. Calling `hls.loadSource` with the renewed manifest makes
 * hls.js recreate its MediaSource, which throws away everything buffered and
 * stalls playback every few minutes. Instead, on renewal we fetch the renewed
 * playlists ourselves and redirect each request hls.js makes to the freshly
 * signed URL at the same position in the same playlist. The video, its
 * renditions and its segments don't change between leases; only the
 * signatures do.
 *
 * Every URL hls.js knows (from any lease) maps to a stable key: `root` for the
 * manifest, then `<playlist key>/<position>` for each URI inside a playlist.
 */

type Fetch = (url: string) => Promise<string>

const normalize = (url: string, base?: string) => {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/** Every URI a playlist references, in document order, made absolute. */
export function playlistUris(text: string, base: string): string[] {
  const uris: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      for (const match of line.matchAll(/URI="([^"]*)"/g)) uris.push(normalize(match[1], base))
    } else uris.push(normalize(line, base))
  }
  return uris
}

export class SignedPlaylists {
  private keyOf = new Map<string, string>()
  private latest = new Map<string, string>()
  private counts = new Map<string, number>()
  private generation = 0

  /** The current signed URL for any URL hls.js asks for. */
  resolve(url: string): string {
    const key = this.keyOf.get(normalize(url))
    return (key && this.latest.get(key)) || url
  }

  /** Remember a playlist hls.js loaded so its contents can be re-signed later. */
  record(requestedUrl: string, responseUrl: string, text: string, manifest: boolean) {
    const key = manifest ? 'root' : this.keyOf.get(normalize(requestedUrl))
    if (!key) return
    if (manifest) {
      this.keyOf.set(normalize(requestedUrl), key)
      this.keyOf.set(normalize(responseUrl), key)
      this.latest.set(key, normalize(responseUrl))
    }
    this.store(key, playlistUris(text, responseUrl))
  }

  /** Which lease a request was issued under; see `isStale`. */
  get current() {
    return this.generation
  }

  /** True when a playlist was requested before the latest renewal finished. */
  isStale(generation: number) {
    return generation < this.generation
  }

  /** Re-fetch one playlist under the latest lease, e.g. after a stale load. */
  async refreshPlaylist(url: string, fetchText: Fetch) {
    const key = this.keyOf.get(normalize(url))
    const latest = key && this.latest.get(key)
    if (!key || !latest) return
    const uris = playlistUris(await fetchText(latest), latest)
    if (uris.length !== this.counts.get(key)) throw new Error('Playlist changed shape.')
    this.store(key, uris)
  }

  /**
   * Re-sign everything hls.js has loaded so far from a renewed manifest URL.
   * All-or-nothing: on any mismatch nothing changes and the caller should
   * fall back to reloading the source.
   */
  async renew(manifestUrl: string, fetchText: Fetch) {
    if (!this.counts.has('root')) throw new Error('No manifest has loaded yet.')
    const next = new Map<string, string[]>()
    const latest = new Map(this.latest)
    latest.set('root', normalize(manifestUrl))
    // Parents before children, so each child is fetched from its renewed URL.
    const keys = [...this.counts.keys()].sort((a, b) => a.split('/').length - b.split('/').length)
    for (const key of keys) {
      const url = latest.get(key)
      if (!url) throw new Error('Playlist is missing from the renewed manifest.')
      const uris = playlistUris(await fetchText(url), url)
      if (uris.length !== this.counts.get(key)) throw new Error('Playlist changed shape.')
      next.set(key, uris)
      uris.forEach((uri, index) => latest.set(`${key}/${index}`, uri))
    }
    this.generation += 1
    this.keyOf.set(normalize(manifestUrl), 'root')
    this.latest.set('root', normalize(manifestUrl))
    for (const [key, uris] of next) this.store(key, uris)
  }

  private store(key: string, uris: string[]) {
    this.counts.set(key, uris.length)
    uris.forEach((uri, index) => {
      const child = `${key}/${index}`
      this.keyOf.set(uri, child)
      this.latest.set(child, uri)
    })
  }
}

/**
 * The hls.js `xhrSetup` hook: sends each request to its current signed URL
 * and records playlists as they load.
 */
export function signedXhrSetup(playlists: SignedPlaylists, fetchText: Fetch) {
  return (xhr: XMLHttpRequest, url: string, context?: { type?: string; responseType?: string }) => {
    const target = playlists.resolve(url)
    xhr.open('GET', target, true)
    const playlist = context?.responseType === 'text' && Boolean(context.type)
    if (!playlist) return
    const generation = playlists.current
    // Registered before hls.js sets onreadystatechange, so this runs first.
    xhr.addEventListener('readystatechange', () => {
      if (xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return
      playlists.record(
        url,
        xhr.responseURL || target,
        xhr.responseText,
        context?.type === 'manifest',
      )
      if (context?.type !== 'manifest' && playlists.isStale(generation))
        void playlists.refreshPlaylist(url, fetchText).catch(() => {})
    })
  }
}

export async function fetchPlaylist(url: string) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store' })
  if (!response.ok) throw new Error(`Playlist request failed (${response.status}).`)
  return response.text()
}
