import { rpc } from './supabase'
import { riotRequest } from './league-repository'
import type { ClockAnchor, ReviewPayload } from './review-timeline'

export type CommentKind = 'comment' | 'question' | 'mindset'
export const commentKinds: { kind: CommentKind; name: string; prompt: string }[] = [
  { kind: 'comment', name: 'Comment', prompt: 'What do you notice here?' },
  { kind: 'question', name: 'Question', prompt: 'What would you like to ask about this moment?' },
  { kind: 'mindset', name: 'Mindset', prompt: 'What was going through your head at this point?' },
]
export type CommentEvent = { id: string; matchId: string; gameMs: number; label: string }
export type ReviewComment = {
  event?: CommentEvent | null
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
  captures?: ReviewCapture[]
}
export type ReviewCapture = {
  id: string
  videoMs: number
  body: string
  role: 'owner' | 'coach'
  author: string | null
  mine: boolean
  createdAt: string
}
export type CaptureInput = { videoMs: number; image: string; body: string }
export type CommentInput = {
  videoMs: number
  kind: CommentKind
  body: string
  event?: CommentEvent
}

export type CompletedReview = {
  id: string
  body: string
  role: 'owner' | 'coach'
  author: string | null
  completedAt: string
  mine: boolean
}
export type ReviewNotes = {
  draft: { body: string; version: number; author: string | null } | null
  reviews: CompletedReview[]
}
export type NotesInput = { body: string; version: number; complete: boolean; author?: string }

/// What the review panel can do. Owner-only capabilities are absent for guests.
export interface ReviewRepository {
  role: 'owner' | 'coach'
  loadNotes?(): Promise<ReviewNotes | null>
  saveNotes?(input: NotesInput): Promise<ReviewNotes>
  load(): Promise<ReviewData | null>
  addComment(input: CommentInput, authorName?: string): Promise<void>
  updateComment(id: string, input: Omit<CommentInput, 'videoMs'>): Promise<void>
  deleteComment(id: string): Promise<void>
  setAnchor?(anchor: ClockAnchor | null): Promise<void>
  attachMatch?(profileId: string, matchId: string): Promise<void>
  detachMatch?(): Promise<void>
  addCapture?(input: CaptureInput, authorName?: string): Promise<void>
  getCapture?(id: string): Promise<string>
  deleteCapture?(id: string): Promise<void>
}

export function ownerReview(recordingId: string): ReviewRepository {
  return {
    role: 'owner',
    loadNotes: () => rpc<ReviewNotes>('get_recording_notes', { p_id: recordingId }),
    saveNotes: ({ body, version, complete }) =>
      rpc<ReviewNotes>('save_recording_notes', {
        p_id: recordingId,
        p_body: body,
        p_version: version,
        p_complete: complete,
      }),
    load: async () => {
      const [review, captures] = await Promise.all([
        rpc<ReviewData>('get_recording_review', { p_id: recordingId }),
        rpc<ReviewCapture[]>('list_recording_captures', { p_recording: recordingId }),
      ])
      return review ? { ...review, captures: captures ?? [] } : null
    },
    addCapture: async ({ videoMs, image, body }) => {
      await rpc('add_recording_capture', {
        p_recording: recordingId,
        p_video_ms: videoMs,
        p_image: image,
        p_body: body,
      })
    },
    getCapture: (id) => rpc<string>('get_recording_capture', { p_capture: id }),
    deleteCapture: (id) => rpc('delete_recording_capture', { p_capture: id }),
    addComment: ({ videoMs, kind, body, event }) =>
      rpc(event ? 'add_recording_event_comment' : 'add_recording_comment', {
        p_id: recordingId,
        p_video_ms: videoMs,
        p_kind: kind,
        p_body: body,
        ...(event ? { p_event: event } : {}),
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
    loadNotes: () => rpc<ReviewNotes>('get_shared_notes', { p_token: token, p_author_key: key }),
    saveNotes: ({ body, version, complete, author }) =>
      rpc<ReviewNotes>('save_shared_notes', {
        p_token: token,
        p_author_key: key,
        p_author_name: author,
        p_body: body,
        p_version: version,
        p_complete: complete,
      }),
    load: async () => {
      const review = await rpc<ReviewData | null>('get_shared_review', {
        p_token: token,
        p_author_key: key,
      })
      if (!review) return null
      const captures = await rpc<ReviewCapture[]>('list_recording_captures', {
        p_token: token,
        p_author_key: key,
      })
      return { ...review, captures: captures ?? [] }
    },
    addCapture: async ({ videoMs, image, body }, authorName) => {
      await rpc('add_recording_capture', {
        p_token: token,
        p_author_key: key,
        p_author_name: authorName,
        p_video_ms: videoMs,
        p_image: image,
        p_body: body,
      })
    },
    getCapture: (id) => rpc<string>('get_recording_capture', { p_capture: id, p_token: token }),
    deleteCapture: (id) =>
      rpc('delete_recording_capture', { p_capture: id, p_token: token, p_author_key: key }),
    addComment: ({ videoMs, kind, body, event }, authorName) =>
      rpc(event ? 'add_shared_event_comment' : 'add_shared_comment', {
        p_token: token,
        p_author_key: key,
        p_author_name: authorName,
        p_video_ms: videoMs,
        p_kind: kind,
        p_body: body,
        ...(event ? { p_event: event } : {}),
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
