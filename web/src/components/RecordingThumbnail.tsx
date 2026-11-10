import { useEffect, useRef, useState } from 'react'
import { streamRequest } from '../lib/supabase'
import type { Recording } from '../lib/types'
import { cachedThumbnailURL, libraryThumbnail } from '../lib/library-cache'

/** Private Stream previews are authorized for the owner and sampled at video zero. */
export function RecordingThumbnail({ record, ownerId }: { record: Recording; ownerId?: string }) {
  const target = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [url, setURL] = useState<string | null>(() => cachedThumbnailURL(ownerId, record))
  const [attempt, setAttempt] = useState(0)
  const stream = record.provider === 'stream'
  useEffect(() => {
    if (!stream || !target.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '150px' },
    )
    observer.observe(target.current)
    return () => observer.disconnect()
  }, [stream])
  useEffect(() => {
    if (!stream || !visible) return
    let active = true
    libraryThumbnail(
      ownerId,
      record,
      () =>
        streamRequest<{ url: string; expiresAt: string }>('thumbnail', {
          recordingId: record.id,
        }).then((result) => result.url),
      attempt > 0,
    )
      .then((result) => {
        if (active) setURL(result)
      })
      .catch(() => {
        /* Keep the existing play placeholder if the preview cannot load. */
      })
    return () => {
      active = false
    }
  }, [record.id, record.stream_video_id, ownerId, stream, visible, attempt])
  const source = stream ? url : `https://i.ytimg.com/vi/${record.youtube_video_id}/mqdefault.jpg`
  return (
    <span ref={target} className="recording-image">
      {source && (
        <img
          loading="lazy"
          src={source}
          alt=""
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
            // Renew once if a short-lived image URL expired before the browser fetched it.
            if (stream && attempt === 0) setAttempt(1)
          }}
          onLoad={(event) => {
            event.currentTarget.style.visibility = 'visible'
          }}
        />
      )}
    </span>
  )
}
