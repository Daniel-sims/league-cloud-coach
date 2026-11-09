/** Keep in step with Domain/YouTubeVideo.swift. Never embed user-supplied HTML. */
export function parseYouTubeId(input: string): string | null {
  try {
    const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port)
      return null
    const parts = url.pathname.split('/').filter(Boolean)
    let id: string | null = null
    if (['youtu.be', 'www.youtu.be'].includes(url.hostname)) {
      id = parts.length === 1 ? parts[0] : null
    } else if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(
        url.hostname,
      )
    ) {
      if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v')
      else if (parts.length === 2 && ['embed', 'shorts', 'live'].includes(parts[0])) id = parts[1]
    } else if (['youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname)) {
      id = parts.length === 2 && parts[0] === 'embed' ? parts[1] : null
    }
    return isVideoId(id) ? id : null
  } catch {
    return null
  }
}

export function isVideoId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id)
}

export function youtubeURL(id: string) {
  if (!isVideoId(id)) throw new Error('Invalid YouTube video ID.')
  return `https://www.youtube.com/watch?v=${id}`
}

export function embedURL(id: string) {
  if (!isVideoId(id)) throw new Error('Invalid YouTube video ID.')
  const params = new URLSearchParams({
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
    origin: window.location.origin,
  })
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}
