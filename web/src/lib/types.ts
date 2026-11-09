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
> & { session_expires_at?: string | null }
export type VideoInput = Pick<
  Recording,
  'title' | 'youtube_video_id' | 'recorded_on' | 'provider' | 'stream_video_id'
>

export interface LibraryRepository {
  list(): Promise<Recording[]>
  add(input: VideoInput): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  share(id: string): Promise<string>
  revoke(id: string): Promise<void>
}
