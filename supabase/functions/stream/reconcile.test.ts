import { expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reconcileUploads } from './reconcile'
const id = 'd'.repeat(32)
const video = {
  uid: id,
  creator: 'owner',
  meta: { appupload: 'true', name: 'Recovered game' },
  requireSignedURLs: true,
  readyToStream: true,
}
function backend(remembered: string[] = []) {
  const rpc = vi.fn(async (name: string) =>
    name === 'list_stream_imports'
      ? { data: remembered, error: null }
      : { data: 'recording', error: null },
  )
  return { rpc, client: { rpc } as unknown as SupabaseClient }
}
it('recovers ready owner-tagged uploads even without browser pending state', async () => {
  const { rpc, client } = backend()
  const result = await reconcileUploads({ admin: client, ownerId: 'owner', videos: [video] })
  expect(result).toEqual({ imported: 1, pending: [] })
  expect(rpc).toHaveBeenLastCalledWith('add_stream_recording', {
    p_owner: 'owner',
    p_title: 'Recovered game',
    p_video_id: id,
    p_recorded_on: null,
  })
})
it('never restores a remembered import that the owner deliberately removed', async () => {
  const { rpc, client } = backend([id])
  expect(await reconcileUploads({ admin: client, ownerId: 'owner', videos: [video] })).toEqual({
    imported: 0,
    pending: [],
  })
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('ignores foreign creators and manual uploads, and reports processing instead of success', async () => {
  const { rpc, client } = backend()
  const result = await reconcileUploads({
    admin: client,
    ownerId: 'owner',
    videos: [
      { ...video, creator: 'other' },
      { ...video, meta: { name: 'Manual' } },
      { ...video, readyToStream: false, status: { state: 'inprogress' } },
    ],
  })
  expect(result.pending).toEqual([{ videoId: id, title: 'Recovered game', state: 'processing' }])
  expect(result.imported).toBe(0)
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('does not claim success when account insertion fails', async () => {
  const { rpc, client } = backend()
  rpc.mockImplementation(async (name) =>
    name === 'list_stream_imports'
      ? { data: [], error: null }
      : ({ data: null, error: { code: 'XX000' } } as never),
  )
  const result = await reconcileUploads({ admin: client, ownerId: 'owner', videos: [video] })
  expect(result.imported).toBe(0)
  expect(result.pending[0].state).toBe('error')
})
