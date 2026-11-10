import { render, waitFor, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { RecordingThumbnail } from './RecordingThumbnail'
import type { Recording } from '../lib/types'
const request = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ streamRequest: request }))
const record: Recording = {
  id: 'owned',
  title: 'Game',
  provider: 'stream',
  youtube_video_id: null,
  recorded_on: null,
  created_at: '',
  has_share: false,
}
it('uses an authorized thumbnail and renews a failed image at most once', async () => {
  request.mockResolvedValue({
    url: 'https://customer-test.cloudflarestream.com/signed/thumbnails/thumbnail.jpg?time=0s',
  })
  const view = render(<RecordingThumbnail record={record} />)
  await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy())
  expect(request).toHaveBeenCalledWith('thumbnail', { recordingId: 'owned' })
  fireEvent.error(view.container.querySelector('img')!)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(view.container.querySelector('img')).toBeTruthy())
  fireEvent.error(view.container.querySelector('img')!)
  expect(request).toHaveBeenCalledTimes(2)
})
