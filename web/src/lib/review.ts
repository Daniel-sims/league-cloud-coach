import { rpc } from './supabase'
import { riotRequest } from './league-repository'
import type { ClockAnchor, ReviewPayload } from './review-timeline'

export type CommentKind = 'comment' | 'question' | 'mindset'
export const commentKinds: { kind: CommentKind; name: string; prompt: string }[] = [
  { kind: 'comment', name: 'Comment', prompt: 'What do you notice here?' },
  { kind: 'question', name: 'Question', prompt: 'What would you like to ask about this moment?' },
  { kind: 'mindset', name: 'Mindset', prompt: 'What was going through your head at this point?' },
]
export type ReviewComment = {
  id: string
  videoMs: number
  kind: CommentKind
  body: string
  role: 'owner' | 'coach'
  author: string | null
  mine: boolean
  createdAt: string
  updatedAt: string
}
export type ReviewData = {
  matchId: string | null
  review: ReviewPayload | null
  syncedAt: string | null
  anchor: ClockAnchor | null
  comments: ReviewComment[]
}
export type CommentInput = { videoMs: number; kind: CommentKind; body: string }

/// What the review panel can do. Owner-only capabilities are absent for guests.
export interface ReviewRepository {
  role: 'owner' | 'coach'
  load(): Promise<ReviewData | null>
  addComment(input: CommentInput, authorName?: string): Promise<void>
  updateComment(id: string, input: Omit<CommentInput, 'videoMs'>): Promise<void>
  deleteComment(id: string): Promise<void>
  setAnchor?(anchor: ClockAnchor | null): Promise<void>
  attachMatch?(profileId: string, matchId: string): Promise<void>
  detachMatch?(): Promise<void>
}

export function ownerReview(recordingId: string): ReviewRepository {
  return {
    role: 'owner',
    load: () => rpc<ReviewData>('get_recording_review', { p_id: recordingId }),
    addComment: ({ videoMs, kind, body }) =>
      rpc('add_recording_comment', {
        p_id: recordingId,
        p_video_ms: videoMs,
        p_kind: kind,
        p_body: body,
      }),
    updateComment: (id, { kind, body }) =>
      rpc('update_recording_comment', { p_comment: id, p_kind: kind, p_body: body }),
    deleteComment: (id) => rpc('delete_recording_comment', { p_comment: id }),
    setAnchor: (anchor) =>
      rpc('set_recording_anchor', {
        p_id: recordingId,
        p_game_time: anchor?.gameTimeSeconds ?? null,
        p_video_offset: anchor?.videoOffsetSeconds ?? null,
      }),
    attachMatch: (profileId, matchId) =>
      riotRequest({ action: 'review-timeline', recordingId, profileId, matchId }),
    detachMatch: () => rpc('detach_recording_timeline', { p_id: recordingId }),
  }
}

export function sharedReview(token: string): ReviewRepository {
  const key = authorKey()
  return {
    role: 'coach',
    load: () => rpc<ReviewData | null>('get_shared_review', { p_token: token, p_author_key: key }),
    addComment: ({ videoMs, kind, body }, authorName) =>
      rpc('add_shared_comment', {
        p_token: token,
        p_author_key: key,
        p_author_name: authorName,
        p_video_ms: videoMs,
        p_kind: kind,
        p_body: body,
      }),
    updateComment: (id, { kind, body }) =>
      rpc('update_shared_comment', {
        p_token: token,
        p_author_key: key,
        p_comment: id,
        p_kind: kind,
        p_body: body,
      }),
    deleteComment: (id) =>
      rpc('delete_shared_comment', { p_token: token, p_author_key: key, p_comment: id }),
  }
}

// A coach's comments belong to the browser that wrote them. The key never
// leaves as anything but a database hash; losing it only loses edit rights.
const keyStorage = 'league-cloud-coach-author-key'
const nameStorage = 'league-cloud-coach-coach-name'
let memoryKey: string | undefined
function randomKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('')
}
export function authorKey(): string {
  try {
    const saved = localStorage.getItem(keyStorage)
    if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved
    const key = randomKey()
    localStorage.setItem(keyStorage, key)
    return key
  } catch {
    return (memoryKey ??= randomKey())
  }
}
export function savedCoachName(): string {
  try {
    return localStorage.getItem(nameStorage) ?? ''
  } catch {
    return ''
  }
}
export function saveCoachName(name: string) {
  try {
    localStorage.setItem(nameStorage, name)
  } catch {
    // Name is a convenience; the comment itself carries it.
  }
}
