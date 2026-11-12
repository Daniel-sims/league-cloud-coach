export type Recording = {
  id: string
  title: string
  youtube_video_id: string | null
  provider?: 'youtube' | 'stream'
  stream_video_id?: string | null
  recorded_on: string | null
  created_at: string
  has_share: boolean
}

export type WatchVideo = Pick<
  Recording,
  'title' | 'youtube_video_id' | 'recorded_on' | 'provider' | 'stream_video_id'
> & {
  session_expires_at?: string | null
  /** Set when the link was made for a named guest; the owner chose the name. */
  guest_name?: string | null
  guest_key?: string | null
}
export type VideoInput = Pick<
  Recording,
  'title' | 'youtube_video_id' | 'recorded_on' | 'provider' | 'stream_video_id'
>

export type UploadSync = {
  imported: number
  pending: {
    videoId: string
    title: string
    state: 'uploading' | 'processing' | 'error'
    message?: string
  }[]
}

export type Guest = {
  id: string
  name: string
  active: boolean
  link_created_at: string | null
  started_at: string | null
}

export interface LibraryRepository {
  guests?: {
    list(recordingId: string): Promise<Guest[]>
    /** Creates the guest, or replaces that name's link. Returns the one-time token. */
    link(recordingId: string, name: string): Promise<string>
    revoke(recordingId: string, guestId: string): Promise<void>
    remove(recordingId: string, guestId: string): Promise<void>
  }
  syncUploads?(): Promise<UploadSync>
  list(): Promise<Recording[]>
  add(input: VideoInput): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  share(id: string): Promise<string>
  revoke(id: string): Promise<void>
}
