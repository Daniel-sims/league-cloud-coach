import { useEffect, useRef, useState } from 'react'
import type Hls from 'hls.js'
import { LoaderCircle } from 'lucide-react'
import { SeekControls, seekPosition, useSeekKeys } from './SeekControls'
import {
  streamRequest,
  StreamAccessError,
  viewerSession,
  type PlaybackLease,
} from '../lib/supabase'
import type { PlayerController } from '../lib/player'
import { canvasFor, encodeCapture } from '../lib/drawing'
import { fetchPlaylist, SignedPlaylists, signedXhrSetup } from '../lib/signed-hls'

export function StreamPlayer({
  title,
  recordingId,
  shareToken,
  onController,
  showSeekControls = true,
  nativeControls = true,
}: {
  title: string
  recordingId?: string
  shareToken?: string
  onController?: (controller: PlayerController | null) => void
  showSeekControls?: boolean
  /** Off when the review page supplies its own control bar. */
  nativeControls?: boolean
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(Boolean(recordingId))
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(recordingId))
  const [remaining, setRemaining] = useState<number | null>(null)
  const [stopped, setStopped] = useState(false)
  const [canSeek, setCanSeek] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [aspectRatio, setAspectRatio] = useState(16 / 9)
  // Once a frame has been shown, later buffering holds it under a spinner.
  const [hasFrame, setHasFrame] = useState(false)
  // Every seek fires `waiting`, even ones that resolve in a few frames;
  // showing the spinner at once makes each skip flash the screen.
  const waitTimer = useRef<number | undefined>(undefined)
  const stopWaiting = () => {
    clearTimeout(waitTimer.current)
    setLoading(false)
  }
  useEffect(() => {
    const media = video.current
    if (!onController) return
    if (!canSeek || !media) {
      onController(null)
      return
    }
    onController({
      pause: () => media.pause(),
      captureFrame: async () => {
        media.pause()
        if (media.seeking)
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              clearTimeout(timer)
              resolve()
            }
            const timer = window.setTimeout(() => {
              media.removeEventListener('seeked', done)
              reject(new Error('Wait for the video to finish seeking, then try again.'))
            }, 5000)
            media.addEventListener('seeked', done, { once: true })
          })
        return encodeCapture(canvasFor(media, media.videoWidth, media.videoHeight))
      },
      currentTime: () => media.currentTime,
      duration: () => media.duration,
      seekTo: (seconds) => {
        media.currentTime = Math.max(0, Math.min(media.duration || seconds, seconds))
      },
      play: () => void media.play().catch(() => {}),
      paused: () => media.paused,
      buffered: () =>
        Array.from({ length: media.buffered.length }, (_, i): [number, number] => [
          media.buffered.start(i),
          media.buffered.end(i),
        ]),
      playbackRate: () => media.playbackRate,
      setPlaybackRate: (rate) => {
        media.playbackRate = rate
      },
      volume: () => media.volume,
      setVolume: (volume) => {
        media.volume = Math.max(0, Math.min(1, volume))
        if (volume > 0) media.muted = false
      },
      muted: () => media.muted,
      setMuted: (muted) => {
        media.muted = muted
      },
    })
    return () => onController(null)
  }, [canSeek, onController])
  function readAspectRatio(media: HTMLVideoElement) {
    if (media.videoWidth > 0 && media.videoHeight > 0)
      setAspectRatio(media.videoWidth / media.videoHeight)
  }
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
  function togglePlay() {
    const media = video.current
    if (!media || !canSeek || stopped) return
    if (media.paused) void media.play().catch(() => {})
    else media.pause()
  }
  useSeekKeys(seek, togglePlay)
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
    let playlists = new SignedPlaylists()
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
              // Chrome caps a video SourceBuffer at about 150 MB. Asking for
              // more than that fills the quota, and hls.js answers a full
              // buffer at an unbuffered seek by flushing everything, so a skip
              // ahead stalls and loses what was held. Stay under the cap:
              // about two minutes ahead (bytes bite first at high bitrates)
              // and a minute behind for quick rewinds.
              maxBufferLength: 120,
              maxMaxBufferLength: 180,
              maxBufferSize: 80 * 1000 * 1000,
              backBufferLength: 60,
              startFragPrefetch: true,
              xhrSetup: signedXhrSetup(playlists, fetchPlaylist),
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
          // Cloudflare signs every playlist and segment URL. Re-sign what
          // hls.js already knows without reloading, which would discard the
          // buffer; fall back to a reload if the renewed playlists don't line up.
          if (hls) {
            try {
              await playlists.renew(next.url, fetchPlaylist)
              return
            } catch {
              if (disposed || terminated) return
            }
          }
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
            playlists = new SignedPlaylists()
            hls.config.xhrSetup = signedXhrSetup(playlists, fetchPlaylist)
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
      clearTimeout(waitTimer.current)
      if (restorePosition) media.removeEventListener('loadedmetadata', restorePosition)
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
          <div className="player-stage" hidden={stopped} style={{ aspectRatio }}>
            <video
              ref={video}
              crossOrigin="anonymous"
              controls={nativeControls}
              playsInline
              preload="auto"
              aria-label={title}
              onResize={(event) => readAspectRatio(event.currentTarget)}
              // Chrome's built-in controls keep the keyboard once clicked: its
              // scrubber turns arrows into 1%-of-the-video jumps, its buttons
              // eat Space, and the page never sees either key. When a click
              // (not Tab) puts focus there, hand it back so Space and arrows
              // always reach the review shortcuts. The click itself still works.
              onFocus={(event) => {
                const media = event.currentTarget
                if (!nativeControls || media.matches(':focus-visible')) return
                window.setTimeout(() => {
                  if (document.activeElement === media) media.blur()
                })
              }}
              // With our own control bar, clicking the picture plays/pauses.
              onClick={nativeControls ? undefined : togglePlay}
              onLoadedMetadata={(event) => {
                readAspectRatio(event.currentTarget)
                setCanSeek(
                  Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0,
                )
              }}
              onLoadedData={() => setHasFrame(true)}
              onEmptied={() => {
                setHasFrame(false)
                setCanSeek(false)
                setPlaying(false)
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={() => setPlaying(false)}
              onCanPlay={stopWaiting}
              onPlaying={stopWaiting}
              onSeeked={stopWaiting}
              onWaiting={() => {
                if (stopped) return
                clearTimeout(waitTimer.current)
                if (hasFrame) waitTimer.current = window.setTimeout(() => setLoading(true), 400)
                else setLoading(true)
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
              <div className={`player-loading${hasFrame ? ' over-video' : ''}`} role="status">
                <LoaderCircle className="spin" size={26} aria-hidden="true" />
                <span className={hasFrame ? 'sr-only' : undefined}>Loading video…</span>
              </div>
            )}
          </div>
          {!stopped && showSeekControls && (
            <SeekControls
              seek={seek}
              disabled={!canSeek}
              playing={playing}
              onTogglePlay={togglePlay}
            />
          )}
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
