import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UploadDialog } from './UploadDialog'
import { streamRequest } from '../lib/supabase'
import { loadPendingUpload, savePendingUpload } from '../lib/uploads'
import type { UploadOptions } from 'tus-js-client'
vi.mock('../lib/supabase', () => ({ streamRequest: vi.fn() }))
const state = vi.hoisted(() => ({
  options: null as UploadOptions | null,
  abort: vi.fn().mockResolvedValue(undefined),
  start: vi.fn(),
}))
vi.mock('tus-js-client', () => ({
  Upload: class {
    constructor(_file: File, options: UploadOptions) {
      state.options = options
    }
    start = state.start
    abort = state.abort
  },
}))
const owner = 'owner-one'
const dest = {
  videoId: 'a'.repeat(32),
  uploadURL: 'https://upload.cloudflarestream.com/tus/private-upload',
}
const file = () =>
  new File(['video-data'], 'game.mov', { type: 'video/quicktime', lastModified: 123 })
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  state.options = null
  vi.mocked(streamRequest).mockImplementation(async (action) =>
    action === 'upload-create' ? dest : { state: 'uploading' },
  )
})
afterEach(cleanup)
it('uploads directly to the issued destination and waits for processing before adding to the library', async () => {
  const user = userEvent.setup()
  const saved = vi.fn()
  render(<UploadDialog ownerId={owner} onClose={vi.fn()} onSaved={saved} />)
  await user.upload(screen.getByLabelText('Video file'), file())
  expect(screen.getByLabelText('Title')).toHaveValue('game')
  fireEvent.submit(screen.getByRole('button', { name: 'Upload to Cloudflare' }).closest('form')!)
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
  expect(state.options?.uploadUrl).toBe(dest.uploadURL)
  expect(state.options?.chunkSize).toBe(10 * 1024 * 1024)
  expect(state.options?.headers).toBeUndefined()
  await act(async () => {
    state.options?.onProgress?.(5, 10)
  })
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50')
  expect(saved).not.toHaveBeenCalled()
  vi.mocked(streamRequest).mockResolvedValue({ state: 'processing' })
  await act(async () => {
    state.options?.onSuccess?.({
      lastResponse: {
        getStatus: () => 204,
        getHeader: () => undefined,
        getBody: () => '',
        getUnderlyingObject: () => null,
      },
    })
  })
  await screen.findByText(/Preparing your recording/)
  expect(saved).not.toHaveBeenCalled()
  vi.mocked(streamRequest).mockResolvedValue({ state: 'ready', recordingId: 'saved-recording' })
  await user.click(screen.getByRole('button', { name: 'Check processing' }))
  await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  expect(loadPendingUpload(owner)).toBeNull()
  expect(screen.getByRole('heading', { name: 'Video added to your library' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Watch video' })).toHaveAttribute(
    'href',
    '#/video/saved-recording',
  )
  expect(screen.getByRole('button', { name: 'Back to library' })).toBeInTheDocument()
})
it('pauses on close and resumes the same destination after reopening without reserving another video', async () => {
  const user = userEvent.setup()
  const renderDialog = () =>
    render(<UploadDialog ownerId={owner} onClose={vi.fn()} onSaved={vi.fn()} />)
  const first = renderDialog()
  await user.upload(screen.getByLabelText('Video file'), file())
  fireEvent.submit(screen.getByRole('button', { name: 'Upload to Cloudflare' }).closest('form')!)
  await waitFor(() => expect(state.start).toHaveBeenCalledOnce())
  first.unmount()
  expect(state.abort).toHaveBeenCalled()
  renderDialog()
  await user.upload(screen.getByLabelText('Video file'), file())
  fireEvent.submit(screen.getByRole('button', { name: 'Resume upload' }).closest('form')!)
  await waitFor(() => expect(state.start).toHaveBeenCalledTimes(2))
  expect(
    vi.mocked(streamRequest).mock.calls.filter(([action]) => action === 'upload-create'),
  ).toHaveLength(1)
  expect(state.options?.uploadUrl).toBe(dest.uploadURL)
})
it('refuses a different file for a pending upload and isolates pending state by owner', async () => {
  savePendingUpload(owner, {
    ...dest,
    filename: 'original.mov',
    size: 10,
    lastModified: 123,
    title: 'Original',
    recordedOn: null,
    stage: 'uploading',
    createdAt: Date.now(),
  })
  expect(loadPendingUpload('owner-two')).toBeNull()
  render(<UploadDialog ownerId={owner} onClose={vi.fn()} onSaved={vi.fn()} />)
  fireEvent.change(screen.getByLabelText('Video file'), { target: { files: [file()] } })
  fireEvent.submit(screen.getByRole('button', { name: 'Resume upload' }).closest('form')!)
  await screen.findByRole('alert')
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the original file: original.mov')
  expect(state.start).not.toHaveBeenCalled()
})
