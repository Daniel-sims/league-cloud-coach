/** The playback speeds offered in the speed menu and stepped through by - and +. */
export const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

/** The next speed from the menu above (`direction` 1) or below (-1) `rate`. */
export function stepSpeed(rate: number, direction: 1 | -1) {
  if (direction > 0) return playbackSpeeds.find((s) => s > rate + 0.001) ?? rate
  return [...playbackSpeeds].reverse().find((s) => s < rate - 0.001) ?? rate
}

/// The slice of a video player the review needs: read the playhead, jump to a
/// position and drive playback from our own control bar. Both the YouTube and
/// Stream players provide one once their media can seek.
export type PlayerController = {
  currentTime(): number
  duration(): number
  seekTo(seconds: number): void
  pause?(): void
  /** Present only when the browser can extract pixels from the video itself. */
  captureFrame?(): Promise<string>
  play?(): void
  paused?(): boolean
  /** Buffered [start, end] ranges in seconds. */
  buffered?(): [number, number][]
  playbackRate?(): number
  setPlaybackRate?(rate: number): void
  volume?(): number
  setVolume?(volume: number): void
  muted?(): boolean
  setMuted?(muted: boolean): void
}
