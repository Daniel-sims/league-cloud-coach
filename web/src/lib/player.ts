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
