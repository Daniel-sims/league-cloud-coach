/// The slice of a video player the review timeline needs: read the playhead
/// and jump to a position. Both the YouTube and Stream players provide one
/// once their media can seek.
export type PlayerController = {
  currentTime(): number
  duration(): number
  seekTo(seconds: number): void
  pause?(): void
  /** Present only when the browser can extract pixels from the video itself. */
  captureFrame?(): Promise<string>
}
