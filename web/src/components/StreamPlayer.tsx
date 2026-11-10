import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { LoaderCircle } from 'lucide-react'
import { SeekControls, seekPosition, seekWithKeyboard } from './SeekControls'
import {
  streamRequest,
  StreamAccessError,
  viewerSession,
  type PlaybackLease,
} from '../lib/supabase'

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
  const [started, setStarted] = useState(Boolean(recordingId))
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(recordingId))
  const [remaining, setRemaining] = useState<number | null>(null)
  const [stopped, setStopped] = useState(false)
  const [canSeek, setCanSeek] = useState(false)
  function seek(delta: number) {
    const media = video.current
    if (
      !started ||
      stopped ||
      !media ||
      media.readyState < 1 ||
      !Number.isFinite(media.duration) ||
      media.duration <= 0
    )
      return false
    media.currentTime = seekPosition(media.currentTime, delta, media.duration)
    return true
  }
  useEffect(() => {
    if (!started) return
    let disposed = false
    let hls: Hls | undefined
    let lease: PlaybackLease | undefined
    let renewAt = 0
    let renewing = false
    let terminated = false
    let timer: number | undefined
    let restorePosition: (() => void) | undefined
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
      setCanSeek(false)
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
        const leaseEnd = Date.parse(next.expiresAt)
        const sessionEnd = next.sessionExpiresAt ? Date.parse(next.sessionExpiresAt) : null
        // The final lease already reaches the deadline; further renewal cannot extend it.
        renewAt = sessionEnd !== null && leaseEnd >= sessionEnd - 1000 ? Infinity : leaseEnd - 60000
        setError('')
        if (firstLease) {
          const { default: Hls } = await import('hls.js')
          if (disposed || terminated) return
          if (Hls.isSupported()) {
            hls = new Hls({
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
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
        } else {
          // Cloudflare signs segment URLs separately. Reload the playlist to obtain
          // fresh segment signatures, preserving playback position and pause state.
          const position = media.currentTime
          const paused = media.paused
          if (restorePosition) media.removeEventListener('loadedmetadata', restorePosition)
          restorePosition = () => {
            if (disposed || terminated) return
            media.currentTime = position
            if (!paused) void media.play().catch(() => {})
          }
          media.addEventListener('loadedmetadata', restorePosition, { once: true })
          if (hls) {
            hls.config.startPosition = position
            hls.loadSource(next.url)
          } else media.src = next.url
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
      }
    }
    setStopped(false)
    setError('')
    setLoading(true)
    setCanSeek(false)
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
      if (restorePosition) media.removeEventListener('loadedmetadata', restorePosition)
      hls?.destroy()
      media.pause()
      media.removeAttribute('src')
      media.load()
    }
  }, [started, attempt, recordingId, shareToken])
  return (
    <div className="player-wrap" onKeyDownCapture={(event) => seekWithKeyboard(event, seek)}>
      {!started ? (
        <div className="stream-session-start">
          <h2>Ready for your review?</h2>
          <p>
            Start a two-hour session in this browser. Pausing counts toward the session. Ask the
            owner for a new link when it ends.
          </p>
          <button className="button" onClick={() => setStarted(true)}>
            Start session
          </button>
        </div>
      ) : (
        <>
          <div className="player-stage" hidden={stopped}>
            <video
              ref={video}
              controls
              playsInline
              preload="auto"
              aria-label={title}
              onLoadedMetadata={(event) =>
                setCanSeek(
                  Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0,
                )
              }
              onEmptied={() => setCanSeek(false)}
              onCanPlay={() => setLoading(false)}
              onPlaying={() => setLoading(false)}
              onWaiting={() => {
                if (!stopped) setLoading(true)
              }}
              onError={() => {
                if (!stopped) {
                  setLoading(false)
                  setCanSeek(false)
                  setError('Video playback failed. Try reconnecting below.')
                }
              }}
            />
            {loading && !stopped && (
              <div className="player-loading" role="status">
                <LoaderCircle className="spin" size={26} aria-hidden="true" />
                <span>Loading video…</span>
              </div>
            )}
          </div>
          {!stopped && <SeekControls seek={seek} disabled={!canSeek} />}
          {!stopped && remaining !== null && (
            <p className="field-hint" role="status">
              {remaining} {remaining === 1 ? 'minute' : 'minutes'} remaining
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
