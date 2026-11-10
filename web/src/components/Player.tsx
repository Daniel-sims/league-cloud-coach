import { useEffect, useRef, useState } from 'react'
import { ExternalLink, LoaderCircle, VideoOff } from 'lucide-react'
import { isVideoId, youtubeURL } from '../lib/youtube'
import { SeekControls, seekPosition, seekWithKeyboard } from './SeekControls'
import type { PlayerController } from '../lib/player'

type PlayerInstance = {
  destroy(): void
  getCurrentTime(): number
  getDuration(): number
  seekTo(seconds: number, allowSeekAhead: boolean): void
}
type YouTubeAPI = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => PlayerInstance
}
declare global {
  interface Window {
    YT?: YouTubeAPI
    onYouTubeIframeAPIReady?: () => void
  }
}
let loading: Promise<YouTubeAPI> | undefined

function loadAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(fail, 15000)
    function fail() {
      clearTimeout(timer)
      script.remove()
      loading = undefined
      reject(
        new Error(
          'The YouTube player could not load. Check your connection or open the video on YouTube.',
        ),
      )
    }
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer)
      if (window.YT) resolve(window.YT)
      else fail()
    }
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = fail
    document.head.appendChild(script)
  })
  return loading
}

export function Player({
  videoId,
  title,
  onController,
}: {
  videoId: string
  title: string
  onController?: (controller: PlayerController | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const instance = useRef<PlayerInstance | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  function seek(delta: number) {
    const player = instance.current
    if (state !== 'ready' || !player) return false
    const duration = player.getDuration(),
      position = player.getCurrentTime()
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position)) return false
    player.seekTo(seekPosition(position, delta, duration), true)
    return true
  }
  useEffect(() => {
    if (!isVideoId(videoId)) return
    let disposed = false
    let player: PlayerInstance | undefined
    let readyTimer: number | undefined
    setState('loading')
    setError('')
    loadAPI()
      .then((api) => {
        if (disposed || !host.current) return
        const element = document.createElement('div')
        host.current.replaceChildren(element)
        readyTimer = window.setTimeout(() => {
          if (!disposed) {
            setState('error')
            setError(
              'YouTube is taking too long to respond. Try again, or open the video on YouTube.',
            )
          }
        }, 20000)
        player = new api.Player(element, {
          host: 'https://www.youtube-nocookie.com',
          videoId,
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              if (disposed) return
              clearTimeout(readyTimer)
              host.current?.querySelector('iframe')?.setAttribute('title', title)
              setState('ready')
              onController?.({
                currentTime: () => player!.getCurrentTime(),
                duration: () => player!.getDuration(),
                seekTo: (seconds) => player!.seekTo(Math.max(0, seconds), true),
              })
            },
            onError: (event: { data: number }) => {
              if (disposed) return
              clearTimeout(readyTimer)
              setState('error')
              setError(
                event.data === 101 || event.data === 150
                  ? 'Embedding is disabled for this video. Enable it in YouTube Studio, or watch on YouTube.'
                  : event.data === 153
                    ? 'YouTube could not identify this page. Try reloading, or open the video on YouTube.'
                    : 'This video may be private, still processing, or unavailable. Check its visibility in YouTube Studio.',
              )
            },
          },
        })
        instance.current = player
      })
      .catch((reason: Error) => {
        if (!disposed) {
          setState('error')
          setError(reason.message)
        }
      })
    return () => {
      disposed = true
      clearTimeout(readyTimer)
      onController?.(null)
      player?.destroy()
      instance.current = null
    }
  }, [videoId, title, attempt])
  return (
    <div className="player-wrap" onKeyDownCapture={(event) => seekWithKeyboard(event, seek)}>
      <div className="player-stage">
        <div className="player-host" ref={host} />
        {state === 'loading' && (
          <div className="player-loading" role="status">
            <LoaderCircle className="spin" size={22} />
            <span>Loading your video…</span>
          </div>
        )}
        {state === 'error' && (
          <div className="player-error" role="alert">
            <VideoOff size={28} />
            <h3>Playback unavailable</h3>
            <p>{error}</p>
            <button className="button light" onClick={() => setAttempt((x) => x + 1)}>
              Try again
            </button>
          </div>
        )}
      </div>
      <SeekControls seek={seek} disabled={state !== 'ready'} />
      <a
        className="text-link player-external"
        href={youtubeURL(videoId)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open on YouTube <ExternalLink size={13} />
      </a>
    </div>
  )
}
