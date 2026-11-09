import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import {
  streamRequest,
  StreamAccessError,
  viewerSession,
  type PlaybackLease,
} from '../lib/supabase'

/** Replace only our video's token; never forward a capability to another host. */
export function refreshStreamURL(
  requestURL: string,
  originalURL: string,
  currentURL: string,
): string {
  const request = new URL(requestURL)
  const original = new URL(originalURL)
  const current = new URL(currentURL)
  const token = original.pathname.split('/')[1]
  if (
    request.origin === original.origin &&
    current.origin === original.origin &&
    request.pathname.startsWith(`/${token}/`)
  ) {
    request.pathname = `/${current.pathname.split('/')[1]}/${request.pathname.split('/').slice(2).join('/')}`
  }
  return request.href
}

export function StreamPlayer({
  title,
  recordingId,
  shareToken,
}: {
  title: string
  recordingId?: string
  shareToken?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [stopped, setStopped] = useState(false)
  useEffect(() => {
    if (!started) return
    let disposed = false
    let hls: Hls | undefined
    let lease: PlaybackLease | undefined
    let renewAt = 0
    let renewing = false
    let terminated = false
    let timer: number | undefined
    const media = video.current!
    let session: string | null = null
    try {
      session = shareToken ? viewerSession(shareToken) : null
    } catch {
      setStopped(true)
      setError('Enable browser session storage to start a review session, then try again.')
      return
    }
    function stop(message: string) {
      terminated = true
      lease = undefined
      hls?.destroy()
      hls = undefined
      media.pause()
      media.removeAttribute('src')
      media.load()
      setStopped(true)
      setLoading(false)
      setError(message)
    }
    async function getLease(first: boolean) {
      renewing = true
      try {
        const next = await streamRequest(
          recordingId ? 'owner' : first ? 'start' : 'renew',
          recordingId ? { recordingId } : { token: shareToken, session },
        )
        if (disposed || terminated) return
        const firstLease = !lease
        lease = next
        renewAt = Date.parse(next.expiresAt) - 60000
        setError('')
        if (firstLease) {
          const { default: Hls } = await import('hls.js')
          if (disposed || terminated) return
          if (Hls.isSupported()) {
            const originalURL = next.url
            hls = new Hls({
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              xhrSetup(xhr, url) {
                xhr.open('GET', refreshStreamURL(url, originalURL, lease!.url), true)
              },
            })
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal && !disposed)
                stop('Playback failed. Check your connection and try again.')
            })
            hls.loadSource(next.url)
            hls.attachMedia(media)
          } else if (media.canPlayType('application/vnd.apple.mpegurl')) {
            media.src = next.url
          } else
            stop(
              'This browser does not support video playback. Try a current version of Chrome or Safari.',
            )
        } else if (!hls) {
          // Native HLS has no request hook. Preserve position when changing its URL.
          const position = media.currentTime
          const paused = media.paused
          media.src = next.url
          media.addEventListener(
            'loadedmetadata',
            () => {
              if (disposed) return
              media.currentTime = position
              if (!paused) void media.play().catch(() => {})
            },
            { once: true },
          )
        }
      } catch (reason) {
        if (disposed) return
        const message = reason instanceof Error ? reason.message : 'Could not open the video.'
        if (
          !lease ||
          (reason instanceof StreamAccessError && [401, 403, 404, 409, 410].includes(reason.status))
        )
          stop(message)
        else {
          setError('Connection interrupted. Retrying video access…')
          renewAt = Date.now() + 5000
        }
      } finally {
        renewing = false
        if (!disposed) setLoading(false)
      }
    }
    setStopped(false)
    setError('')
    setLoading(true)
    void getLease(true)
    timer = window.setInterval(() => {
      if (!lease || disposed || terminated) return
      const now = Date.now()
      const end = lease.sessionExpiresAt ? Date.parse(lease.sessionExpiresAt) : null
      if (end !== null) setRemaining(Math.max(0, Math.ceil((end - now) / 60000)))
      if (end !== null && now >= end) {
        lease = undefined
        stop('Your two-hour session has ended. Ask the owner for a new watch link.')
      } else if (now >= Date.parse(lease.expiresAt)) {
        lease = undefined
        stop('Video access expired. Try again to reconnect to your session.')
      } else if (now >= renewAt && !renewing) void getLease(false)
    }, 1000)
    return () => {
      disposed = true
      clearInterval(timer)
      hls?.destroy()
      media.pause()
      media.removeAttribute('src')
      media.load()
    }
  }, [started, attempt, recordingId, shareToken])
  return (
    <div className="player-wrap">
      {!started ? (
        <div className="stream-session-start">
          <h2>{shareToken ? 'Ready for your review?' : 'Watch your recording'}</h2>
          <p>
            {shareToken
              ? 'Start a two-hour session in this browser. Pausing counts toward the session. Only the owner can issue a new link.'
              : 'Play your private recording with normal video controls.'}
          </p>
          <button className="button" onClick={() => setStarted(true)}>
            {shareToken ? 'Start session' : 'Load video'}
          </button>
        </div>
      ) : (
        <>
          <div className="player-stage" hidden={stopped}>
            <video
              ref={video}
              controls
              playsInline
              preload="none"
              aria-label={title}
              onLoadedMetadata={() => setLoading(false)}
              onError={() => {
                if (!stopped) setError('Video playback failed. Try reconnecting below.')
              }}
            />
          </div>
          {loading && <p role="status">Preparing private playback…</p>}
          {!stopped && remaining !== null && (
            <p className="field-hint" role="status">
              {remaining} minutes left in this session. Refreshing keeps the same deadline.
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          {(stopped || error) && (
            <button className="button secondary" onClick={() => setAttempt((x) => x + 1)}>
              Try again
            </button>
          )}
        </>
      )}
    </div>
  )
}
