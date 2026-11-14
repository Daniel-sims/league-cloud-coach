import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
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

export type BarMarker = { id: string; ms: number; className: string; label: string }

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
  clockName,
  markers,
  actions,
  expanded,
  onExpand,
}: {
  controller: PlayerController | null
  timeLabel(videoMs: number): string
  clockName: string
  markers: BarMarker[]
  actions?: ReactNode
  /** Video + timeline filling the window (the review's cinema mode). */
  expanded: boolean
  onExpand(): void
}) {
  const [state, setState] = useState<Snapshot>(empty)
  // Where the scrubber is being dragged to; the seek happens on release so a
  // drag doesn't make the player fetch every position it passes over.
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const latestExpand = useRef(onExpand)
  latestExpand.current = onExpand
  const ready = Boolean(controller) && state.duration > 0

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

  const fraction = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
  }
  const shown = drag !== null ? drag * state.duration : state.time
  const percent = (seconds: number) =>
    state.duration
      ? `${(Math.max(0, Math.min(state.duration, seconds)) / state.duration) * 100}%`
      : '0%'
  const peek = drag ?? hover
  const peekMarker =
    peek !== null && state.duration
      ? markers.find((m) => Math.abs(m.ms / 1000 / state.duration - peek) < 0.006)
      : undefined

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
    }
  }

  return (
    <div className="player-bar" role="group" aria-label="Player controls">
      <div
        className={`bar-scrubber ${ready ? '' : 'disabled'}`}
        role="slider"
        tabIndex={ready ? 0 : -1}
        aria-label="Seek"
        aria-disabled={!ready}
        aria-valuemin={0}
        aria-valuemax={Math.round(state.duration)}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${timeLabel(shown * 1000)} of ${timeLabel(state.duration * 1000)}`}
        onKeyDown={scrubKey}
        onPointerDown={(event) => {
          if (!ready || event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          setDrag(fraction(event))
        }}
        onPointerMove={(event) => {
          if (!ready) return
          if (drag !== null) setDrag(fraction(event))
          else setHover(fraction(event))
        }}
        onPointerUp={(event) => {
          if (drag === null) return
          const to = fraction(event) * state.duration
          setDrag(null)
          seekTo(to)
        }}
        onPointerCancel={() => setDrag(null)}
        onPointerLeave={() => setHover(null)}
      >
        <div className="bar-track" ref={track}>
          {state.buffered.map(([start, end], i) => (
            <span
              key={i}
              className="bar-buffered"
              style={{ left: percent(start), width: `calc(${percent(end)} - ${percent(start)})` }}
            />
          ))}
          <span className="bar-played" style={{ width: percent(shown) }} />
          {state.duration > 0 &&
            markers.map((marker) => (
              <i
                key={marker.id}
                className={`bar-marker ${marker.className}`}
                style={{ left: percent(marker.ms / 1000) }}
              />
            ))}
          <span className="bar-thumb" style={{ left: percent(shown) }} />
        </div>
        {peek !== null && ready && (
          <span className="bar-peek" style={{ left: `${peek * 100}%` }} aria-hidden="true">
            {timeLabel(peek * state.duration * 1000)}
            {peekMarker && <small>{peekMarker.label}</small>}
          </span>
        )}
      </div>
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
          <small>{clockName}</small>
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
