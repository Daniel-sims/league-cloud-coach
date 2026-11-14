import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { PlayerController } from '../lib/player'
import { jumpSeconds } from './SeekControls'

export type BarMarker = {
  id: string
  ms: number
  className: string
  label: string
  icon?: LucideIcon
}

/** The narrowest stretch of video the scrubber can zoom in to, in seconds. */
const minSpan = 20
/** Icons closer together than this many pixels hide behind the first one. */
const iconGap = 14
/** A click this close to a marker, in pixels, lands exactly on it. */
const snapPixels = 6

const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]
const steps = [-30, -10, -1, 1, 10, 30]

type Snapshot = {
  time: number
  duration: number
  paused: boolean
  buffered: [number, number][]
  rate: number
  volume: number
  muted: boolean
}
const empty: Snapshot = {
  time: 0,
  duration: 0,
  paused: true,
  buffered: [],
  rate: 1,
  volume: 1,
  muted: false,
}

function read(controller: PlayerController): Snapshot {
  const duration = controller.duration()
  return {
    time: controller.currentTime() || 0,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    paused: controller.paused?.() ?? true,
    buffered: controller.buffered?.() ?? [],
    rate: controller.playbackRate?.() ?? 1,
    volume: controller.volume?.() ?? 1,
    muted: controller.muted?.() ?? false,
  }
}

/**
 * The review's own control bar under the video: seek steps, play/pause,
 * a scrubber with buffered ranges and timeline markers, speed, volume,
 * the review actions and fullscreen. Works with any PlayerController.
 */
export function PlayerBar({
  controller,
  timeLabel,
  markers,
  actions,
  expanded,
  onExpand,
}: {
  controller: PlayerController | null
  timeLabel(videoMs: number): string
  markers: BarMarker[]
  actions?: ReactNode
  /** Video + timeline filling the window (the review's cinema mode). */
  expanded: boolean
  onExpand(): void
}) {
  const [state, setState] = useState<Snapshot>(empty)
  // Where the scrubber is being dragged to, in seconds; the seek happens on
  // release so a drag doesn't make the player fetch every position it passes.
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // Zoom: the scrubber shows `duration / zoom` seconds starting at `start`.
  const [view, setView] = useState({ zoom: 1, start: 0 })
  const [width, setWidth] = useState(0)
  const scrubber = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const pressedAt = useRef<number | null>(null)
  const latestExpand = useRef(onExpand)
  latestExpand.current = onExpand
  const ready = Boolean(controller) && state.duration > 0

  const maxZoom = Math.max(1, state.duration / minSpan)
  const zoom = Math.min(view.zoom, maxZoom)
  const span = state.duration / zoom
  const viewStart = Math.max(0, Math.min(state.duration - span, view.start))
  const viewEnd = viewStart + span
  const latest = useRef({ duration: state.duration, zoom, span, viewStart, width, maxZoom })
  latest.current = { duration: state.duration, zoom, span, viewStart, width, maxZoom }

  useEffect(() => {
    if (!controller) {
      setState(empty)
      return
    }
    const tick = () => setState(read(controller))
    tick()
    const timer = window.setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [controller])

  useEffect(() => {
    const element = track.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /** Zoom to `next`, keeping the time at `anchor` (0–1 across the track) still. */
  function zoomTo(next: number, anchor?: number) {
    const now = latest.current
    if (!now.duration) return
    const target = Math.max(1, Math.min(now.maxZoom, next))
    const at =
      anchor ??
      (state.time >= now.viewStart && state.time <= now.viewStart + now.span
        ? (state.time - now.viewStart) / now.span
        : 0.5)
    const pivot = now.viewStart + at * now.span
    setView({ zoom: target, start: pivot - at * (now.duration / target) })
  }
  const latestZoom = useRef(zoomTo)
  latestZoom.current = zoomTo

  // Wheel or pinch over the scrubber zooms around the pointer; a sideways
  // swipe (or Shift + wheel) pans. Needs a non-passive listener to stop the
  // page scrolling or the browser zooming.
  useEffect(() => {
    const element = scrubber.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      const now = latest.current
      if (!now.duration || !now.width) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? now.width : 1
      const sideways = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      if (sideways) {
        const delta = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * scale
        setView({ zoom: now.zoom, start: now.viewStart + (delta / now.width) * now.span })
        return
      }
      const box = track.current!.getBoundingClientRect()
      const anchor = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
      const factor = Math.exp(-event.deltaY * scale * (event.ctrlKey ? 0.01 : 0.002))
      latestZoom.current(now.zoom * factor, anchor)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  // While zoomed, keep the playhead in view: when it moves out of the window
  // (playing past the edge, or a seek elsewhere) the window jumps to it. A
  // paused playhead stays put so you can pan away to look around.
  const lastTime = useRef(state.time)
  useEffect(() => {
    const previous = lastTime.current
    lastTime.current = state.time
    if (zoom <= 1 || drag !== null || Math.abs(state.time - previous) < 0.01) return
    if (state.time < viewStart || state.time > viewEnd)
      setView({ zoom, start: state.time - span * 0.1 })
  }, [state.time, zoom, span, viewStart, viewEnd, drag])

  const refresh = () => controller && setState(read(controller))
  function seekTo(seconds: number) {
    if (!controller || !ready) return
    controller.seekTo(Math.max(0, Math.min(state.duration, seconds)))
    refresh()
  }
  function togglePlay() {
    if (!controller) return
    if (controller.paused?.() ?? true) controller.play?.()
    else controller.pause?.()
    refresh()
  }
  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'f' || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable], dialog[open]')) return
      event.preventDefault()
      latestExpand.current()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /** The time under the pointer, in seconds. */
  const secondsAt = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect()
    return viewStart + Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * span
  }
  const shown = drag ?? state.time
  const inView = (seconds: number) => seconds >= viewStart && seconds <= viewEnd
  const percent = (seconds: number) =>
    span ? `${((Math.max(viewStart, Math.min(viewEnd, seconds)) - viewStart) / span) * 100}%` : '0%'
  const pixels = (seconds: number) => (span ? ((seconds - viewStart) / span) * width : 0)
  const visible = state.duration > 0 ? markers.filter((m) => inView(m.ms / 1000)) : []
  // One icon per crowded spot; zooming in spreads them out to show the rest.
  const iconed = new Set<string>()
  let lastIcon = -Infinity
  for (const marker of visible) {
    if (!marker.icon) continue
    const x = pixels(marker.ms / 1000)
    if (x - lastIcon < iconGap) continue
    iconed.add(marker.id)
    lastIcon = x
  }
  const nearest = (seconds: number, within: number) => {
    let best: BarMarker | undefined
    let distance = within
    for (const marker of visible) {
      const d = Math.abs(pixels(marker.ms / 1000) - pixels(seconds))
      if (d <= distance) {
        best = marker
        distance = d
      }
    }
    return best
  }
  const peek = drag ?? hover
  const peekMarker = peek !== null && state.duration ? nearest(peek, 8) : undefined

  function scrubKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      seekTo(state.time + (event.key === 'ArrowLeft' ? -1 : 1) * jumpSeconds(event))
    } else if (event.key === 'Home') {
      event.preventDefault()
      seekTo(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      seekTo(state.duration)
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomTo(zoom * 2)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomTo(zoom / 2)
    } else if (event.key === '0') {
      event.preventDefault()
      zoomTo(1)
    }
  }
  const zoomed = zoom > 1.01

  return (
    <div className="player-bar" role="group" aria-label="Player controls">
      <div className="bar-seek">
        <div
          ref={scrubber}
          className={`bar-scrubber ${ready ? '' : 'disabled'}`}
          role="slider"
          tabIndex={ready ? 0 : -1}
          aria-label="Seek"
          aria-disabled={!ready}
          aria-valuemin={0}
          aria-valuemax={Math.round(state.duration)}
          aria-valuenow={Math.round(shown)}
          aria-valuetext={`${timeLabel(shown * 1000)} of ${timeLabel(state.duration * 1000)}`}
          aria-keyshortcuts="+ - 0"
          onKeyDown={scrubKey}
          onPointerDown={(event) => {
            if (!ready || event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            pressedAt.current = event.clientX
            setDrag(secondsAt(event))
          }}
          onPointerMove={(event) => {
            if (!ready) return
            if (drag !== null) setDrag(secondsAt(event))
            else setHover(secondsAt(event))
          }}
          onPointerUp={(event) => {
            if (drag === null) return
            let to = secondsAt(event)
            // A click (not a drag) on or next to a marker lands exactly on it.
            if (pressedAt.current !== null && Math.abs(event.clientX - pressedAt.current) < 4) {
              const marker = nearest(to, snapPixels)
              if (marker) to = marker.ms / 1000
            }
            pressedAt.current = null
            setDrag(null)
            seekTo(to)
          }}
          onPointerCancel={() => {
            pressedAt.current = null
            setDrag(null)
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="bar-track" ref={track}>
            {state.buffered
              .filter(([start, end]) => end > viewStart && start < viewEnd)
              .map(([start, end], i) => (
                <span
                  key={i}
                  className="bar-buffered"
                  style={{
                    left: percent(start),
                    width: `calc(${percent(end)} - ${percent(start)})`,
                  }}
                />
              ))}
            {shown > viewStart && <span className="bar-played" style={{ width: percent(shown) }} />}
            {visible.map((marker) => {
              const Icon = iconed.has(marker.id) ? marker.icon : undefined
              return (
                <i
                  key={marker.id}
                  className={`bar-marker ${marker.className}`}
                  style={{ left: percent(marker.ms / 1000) }}
                >
                  {Icon && (
                    <span className="bar-icon">
                      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  )}
                </i>
              )
            })}
            {inView(shown) && <span className="bar-thumb" style={{ left: percent(shown) }} />}
          </div>
          {peek !== null && ready && (
            <span className="bar-peek" style={{ left: percent(peek) }} aria-hidden="true">
              {timeLabel(peek * 1000)}
              {peekMarker && <small>{peekMarker.label}</small>}
            </span>
          )}
        </div>
        <span className="bar-zoom">
          <button
            className="icon-button"
            disabled={!ready || !zoomed}
            onClick={() => zoomTo(zoom / 2)}
            aria-label="Zoom out"
            title="Zoom the timeline out (scroll over it, or -)"
          >
            <ZoomOut size={16} />
          </button>
          {zoomed && (
            <button
              className="bar-zoom-level"
              onClick={() => zoomTo(1)}
              aria-label="Reset zoom"
              title="Show the whole video (0)"
            >
              {zoom < 10 ? zoom.toFixed(1).replace(/\.0$/, '') : Math.round(zoom)}×
            </button>
          )}
          <button
            className="icon-button"
            disabled={!ready || zoom >= maxZoom}
            onClick={() => zoomTo(zoom * 2)}
            aria-label="Zoom in"
            title="Zoom the timeline in (scroll over it, or +)"
          >
            <ZoomIn size={16} />
          </button>
        </span>
      </div>
      {zoomed && (
        <div className="bar-overview">
          <span>{timeLabel(viewStart * 1000)}</span>
          <div
            className="bar-overview-track"
            title="Click to move the zoomed window"
            onPointerDown={(event) => {
              const box = event.currentTarget.getBoundingClientRect()
              const at = ((event.clientX - box.left) / box.width) * state.duration
              setView({ zoom, start: at - span / 2 })
            }}
          >
            <span
              className="bar-overview-window"
              style={{
                left: `${(viewStart / state.duration) * 100}%`,
                width: `${(span / state.duration) * 100}%`,
              }}
            />
            <span
              className="bar-overview-head"
              style={{ left: `${(state.time / state.duration) * 100}%` }}
            />
          </div>
          <span>{timeLabel(viewEnd * 1000)}</span>
        </div>
      )}
      <div className="bar-row">
        <div className="bar-transport">
          {steps
            .filter((s) => s < 0)
            .map((step) => (
              <StepButton
                key={step}
                step={step}
                disabled={!ready}
                onSeek={() => seekTo(state.time + step)}
              />
            ))}
          <button
            className="bar-play"
            disabled={!ready}
            onClick={togglePlay}
            aria-label={state.paused ? 'Play' : 'Pause'}
            title={state.paused ? 'Play (Space)' : 'Pause (Space)'}
          >
            {state.paused ? <Play size={18} /> : <Pause size={18} />}
          </button>
          {steps
            .filter((s) => s > 0)
            .map((step) => (
              <StepButton
                key={step}
                step={step}
                disabled={!ready}
                onSeek={() => seekTo(state.time + step)}
              />
            ))}
        </div>
        <span className="bar-time">
          {timeLabel(shown * 1000)} / {timeLabel(state.duration * 1000)}
        </span>
        <div className="bar-tools">
          {controller?.setPlaybackRate && (
            <select
              className="bar-speed"
              aria-label="Playback speed"
              title="Playback speed"
              value={state.rate}
              disabled={!ready}
              onChange={(event) => {
                controller.setPlaybackRate!(Number(event.target.value))
                refresh()
              }}
            >
              {speeds.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          )}
          {controller?.setMuted && (
            <span className="bar-volume">
              <button
                className="icon-button"
                disabled={!ready}
                onClick={() => {
                  controller.setMuted!(!state.muted)
                  refresh()
                }}
                aria-label={state.muted ? 'Unmute' : 'Mute'}
                title={state.muted ? 'Unmute' : 'Mute'}
              >
                {state.muted || state.volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.05}
                disabled={!ready}
                value={state.muted ? 0 : state.volume}
                onChange={(event) => {
                  controller.setVolume?.(Number(event.target.value))
                  controller.setMuted!(Number(event.target.value) === 0)
                  refresh()
                }}
              />
            </span>
          )}
          {actions}
          <button
            className="icon-button"
            onClick={onExpand}
            aria-label={expanded ? 'Exit full screen' : 'Full screen'}
            aria-pressed={expanded}
            title={
              expanded ? 'Exit full screen (F or Escape)' : 'Full screen: video and timeline (F)'
            }
          >
            {expanded ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function StepButton({
  step,
  disabled,
  onSeek,
}: {
  step: number
  disabled: boolean
  onSeek(): void
}) {
  const seconds = Math.abs(step)
  return (
    <button
      className="bar-step"
      disabled={disabled}
      onClick={onSeek}
      aria-label={`${step < 0 ? 'Back' : 'Forward'} ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`}
      title={`${step < 0 ? 'Back' : 'Forward'} ${seconds}s`}
    >
      {step < 0 ? '−' : '+'}
      {seconds}
    </button>
  )
}
