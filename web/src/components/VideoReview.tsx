import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  Clock3,
  Filter,
  Flag,
  Link2,
  LoaderCircle,
  MessageSquarePlus,
  Maximize2,
  NotebookPen,
  Minimize2,
  Pencil,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react'
import { Dialog } from './Dialog'
import { EventContextMenu, type EventMenuTarget } from './EventContextMenu'
import { CompleteReview, ReviewNotebook, type ReviewNotebookModel } from './ReviewNotebook'
import { DrawingCapture, CapturePreview } from './DrawingCapture'
import { captureTabFrame } from '../lib/drawing'
import { CaptureRow, CommentRow, EventRow, MomentRow, patchOf } from './TimelineRows'
import type { PlayerController } from '../lib/player'
import {
  buildTimeline,
  simpleEntries,
  ultimateEntries,
  seekLeadMs,
  clock,
  context,
  entryKinds,
  gameTimeMs,
  parseGameClock,
  videoOffset,
  type ClockAnchor,
  type EntryKind,
  type TimelineEntry,
} from '../lib/review-timeline'
import {
  commentKinds,
  saveCoachName,
  savedCoachName,
  type CommentKind,
  type CommentEvent,
  type KeyMoment,
  type ReviewComment,
  type ReviewData,
  type ReviewRepository,
  type ReviewCapture,
} from '../lib/review'
import {
  championIcon,
  gamesFor,
  queues,
  roleNames,
  type Game,
  type LeagueProfile,
} from '../lib/league'
import type { LeagueRepository } from '../lib/league-repository'
import '../review.css'

const hiddenStorage = 'league-cloud-coach-hidden-kinds'
const commentsKey = 'comments'
const capturesKey = 'captures'
const widthStorage = 'league-cloud-coach-timeline-width'
const openStorage = 'league-cloud-coach-timeline'
const detailStorage = 'league-cloud-coach-timeline-detail'
const minPanel = 300
const defaultPanel = 420
function stored(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Layout preferences are per-browser conveniences.
  }
}

type Item =
  | { id: string; type: 'event'; entry: TimelineEntry; sortMs: number }
  | { id: string; type: 'comment'; comment: ReviewComment; sortMs: number }
  | { id: string; type: 'capture'; capture: ReviewCapture; sortMs: number }
  | { id: string; type: 'moment'; moment: KeyMoment; sortMs: number }

function loadHidden(): Set<string> {
  try {
    const saved = localStorage.getItem(hiddenStorage)
    if (saved !== null) return new Set<string>(JSON.parse(saved))
  } catch {
    // Filters are a per-browser convenience.
  }
  return new Set<string>()
}

export function VideoReview({
  repository,
  league,
  recordedOn,
  notebook,
  renderPlayer,
}: {
  repository: ReviewRepository
  league?: LeagueRepository
  recordedOn?: string | null
  notebook?: ReviewNotebookModel
  renderPlayer(onController: (controller: PlayerController | null) => void): ReactNode
}) {
  const [cinema, setCinema] = useState(false)
  const [eventMenu, setEventMenu] = useState<(EventMenuTarget & { entry: TimelineEntry }) | null>(
    null,
  )
  const [openMenu, setOpenMenu] = useState<'settings' | 'filter' | null>(null)
  const cinemaButton = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!cinema) return
    const previousScroll = window.scrollY
    window.scrollTo(0, 0)
    return () => window.scrollTo(0, previousScroll)
  }, [cinema])
  useEffect(() => {
    if (!cinema) return
    const exit = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        openMenu ||
        document.querySelector('dialog[open]')
      )
        return
      setCinema(false)
      cinemaButton.current?.focus()
    }
    window.addEventListener('keydown', exit)
    return () => window.removeEventListener('keydown', exit)
  }, [cinema, openMenu])
  useEffect(() => {
    if (!openMenu) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.review-menu')) {
        setOpenMenu(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpenMenu(null)
      const label = openMenu === 'settings' ? 'Video settings' : 'Filter timeline'
      container.current?.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [openMenu])
  const owner = repository.role === 'owner'
  const [controller, setController] = useState<PlayerController | null>(null)
  const [data, setData] = useState<ReviewData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [playheadMs, setPlayheadMs] = useState<number | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [composing, setComposing] = useState<number | null>(null)
  const [commentEvent, setCommentEvent] = useState<CommentEvent | null>(null)
  function cancelComment() {
    setComposing(null)
    setCommentEvent(null)
  }
  const [editing, setEditing] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<number | null>(null)
  const [pendingSeek, setPendingSeek] = useState<{ ms: number; leadMs: number } | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [drawingFrame, setDrawingFrame] = useState<{ image: string; videoMs: number } | null>(null)
  const [preparingDrawing, setPreparingDrawing] = useState(false)
  const [viewingCapture, setViewingCapture] = useState<ReviewCapture | null>(null)
  const captureBusy = useRef(false)
  const captureGeneration = useRef(0)
  useEffect(() => {
    setDrawingFrame(null)
    setViewingCapture(null)
    setPreparingDrawing(false)
    captureBusy.current = false
    return () => {
      captureGeneration.current++
    }
  }, [repository])
  const [hidden, setHidden] = useState(loadHidden)
  const [follow, setFollow] = useState(true)
  const list = useRef<HTMLOListElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(stored(widthStorage))
    return Number.isFinite(saved) && saved >= minPanel ? saved : defaultPanel
  })
  const [panelOpen, setPanelOpen] = useState(() => stored(openStorage) !== 'closed')
  useEffect(() => {
    if (notebook?.view === 'notes') {
      setPanelOpen(true)
      setOpenMenu(null)
      setEventMenu(null)
    }
  }, [notebook?.view])
  function showPanel(open: boolean) {
    setPanelOpen(open)
    store(openStorage, open ? 'open' : 'closed')
  }
  function resizeTo(width: number, persist = false) {
    const total = container.current?.getBoundingClientRect().width ?? 0
    const next = Math.round(Math.min(Math.max(width, minPanel), Math.max(minPanel, total - 496)))
    setPanelWidth(next)
    if (persist) store(widthStorage, String(next))
  }
  function dragResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const right = handle.parentElement!.getBoundingClientRect().right
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('dragging')
    let width = panelWidth
    const move = (e: PointerEvent) => {
      width = right - e.clientX - (cinema ? 0 : 8)
      resizeTo(width)
    }
    const end = () => {
      handle.classList.remove('dragging')
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      resizeTo(width, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  // The video is as large as fits below the page heading with its controls in
  // view; preserve the recording’s actual proportions rather than adding side bars.
  useLayoutEffect(() => {
    const box = container.current
    if (!box) return
    const measure = () => {
      const top = box.getBoundingClientRect().top + window.scrollY
      const wrap = box.querySelector<HTMLElement>('.player-wrap')
      const stage = box.querySelector<HTMLElement>('.player-stage')
      const chrome = wrap && stage && !stage.hidden ? wrap.offsetHeight - stage.offsetHeight : 0
      const media = box.querySelector('video')
      const aspect =
        media && media.videoWidth > 0 && media.videoHeight > 0
          ? media.videoWidth / media.videoHeight
          : 16 / 9
      box.style.setProperty('--review-aspect', `${aspect}`)
      box.style.setProperty('--review-top', `${Math.round(top)}px`)
      box.style.setProperty('--review-chrome', `${Math.max(0, chrome)}px`)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(box)
    const wrap = box.querySelector('.review-video')
    if (wrap) observer?.observe(wrap)
    const player = box.querySelector('.player-wrap')
    if (player) observer?.observe(player)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [cinema])

  const lastLoaded = useRef('')
  useEffect(() => {
    lastLoaded.current = ''
  }, [repository])
  const reload = useCallback(async () => {
    try {
      const next = await repository.load()
      // Live polling: leave the timeline alone unless something actually changed.
      const fingerprint = JSON.stringify(next)
      if (fingerprint !== lastLoaded.current) {
        lastLoaded.current = fingerprint
        setData(next)
      }
      setState('ready')
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the review timeline.')
      setState((s) => (s === 'loading' ? 'error' : s))
    }
  }, [repository])
  useEffect(() => {
    void reload()
    // Reviews are live: the player and coach work at the same time.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, 8000)
    const focus = () => void reload()
    window.addEventListener('focus', focus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', focus)
    }
  }, [reload])

  useEffect(() => {
    if (!controller) {
      setPlayheadMs(null)
      return
    }
    const tick = () => {
      const time = controller.currentTime()
      const duration = controller.duration()
      if (Number.isFinite(time)) setPlayheadMs(Math.round(time * 4) * 250)
      if (Number.isFinite(duration) && duration > 0) setDurationMs(Math.round(duration * 1000))
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [controller])

  const review = data?.review ?? null
  const anchor = data?.anchor ?? null
  const [simple, setSimple] = useState(() => stored(detailStorage) === 'simple')
  const chooseDetail = (value: 'detailed' | 'simple') => {
    setSimple(value === 'simple')
    store(detailStorage, value)
  }
  const entries = useMemo(
    () =>
      review
        ? simple
          ? simpleEntries(review, anchor)
          : [...buildTimeline(review), ...ultimateEntries(review, anchor)].sort(
              (a, b) => a.gameTimeMs - b.gameTimeMs,
            )
        : [],
    [review, anchor, simple],
  )
  const coverage = useMemo(
    () => (anchor && durationMs ? [gameTimeMs(anchor, 0), gameTimeMs(anchor, durationMs)] : null),
    [anchor, durationMs],
  )
  const comments = data?.comments ?? []
  const captures = data?.captures ?? []
  const moments = useMemo(() => data?.moments ?? [], [data?.moments])
  const presentKinds = entryKinds.filter((k) => entries.some((e) => e.kind === k.kind))
  const items = useMemo(() => {
    const eventMs = (gameMs: number) =>
      anchor ? Math.round(videoOffset(anchor, gameMs / 1000) * 1000) : gameMs
    const events: Item[] = entries
      .filter((e) => !hidden.has(e.kind))
      .map((entry) => ({ id: entry.id, type: 'event', entry, sortMs: eventMs(entry.gameTimeMs) }))
    const notes: Item[] = hidden.has(commentsKey)
      ? []
      : comments
          .filter(
            (comment) =>
              !comment.event ||
              comment.event.matchId !== review?.matchId ||
              !events.some((event) => event.id === comment.event?.id),
          )
          .map((comment) => ({
            id: comment.id,
            type: 'comment',
            comment,
            sortMs: comment.videoMs,
          }))
    const stills: Item[] = hidden.has(capturesKey)
      ? []
      : captures.map((capture) => ({
          id: capture.id,
          type: 'capture',
          capture,
          sortMs: capture.videoMs,
        }))
    // The student's flags are always on the timeline; they are the point of the review.
    const flags: Item[] = moments.map((moment) => ({
      id: `moment-${moment.id}`,
      type: 'moment',
      moment,
      sortMs: moment.videoMs,
    }))
    return [...events, ...notes, ...stills, ...flags].sort(
      (a, b) => a.sortMs - b.sortMs || (a.id < b.id ? -1 : 1),
    )
  }, [entries, comments, captures, moments, hidden, anchor, review?.matchId])
  const eventComments = useMemo(() => {
    const grouped = new Map<string, ReviewComment[]>()
    if (hidden.has(commentsKey)) return grouped
    for (const comment of comments) {
      if (!comment.event || comment.event.matchId !== review?.matchId) continue
      const group = grouped.get(comment.event.id) ?? []
      group.push(comment)
      grouped.set(comment.event.id, group)
    }
    for (const group of grouped.values())
      group.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    return grouped
  }, [comments, review?.matchId, hidden])
  // Deaths and ultimates seek a few seconds before the moment, which lands the
  // playhead on the previous row. Keep the row that was clicked marked as current
  // until play reaches it (or the viewer seeks somewhere else).
  const [pin, setPin] = useState<{ ms: number; lead: number } | null>(null)
  const currentId = useMemo(() => {
    if (playheadMs === null) return null
    const pinned = pin
      ? items.find((i) => i.type === 'event' && i.entry.gameTimeMs === pin.ms)
      : undefined
    if (
      pin &&
      pinned &&
      playheadMs >= pinned.sortMs - pin.lead - 1500 &&
      playheadMs <= pinned.sortMs
    )
      return pinned.id
    return items.filter((i) => i.sortMs <= playheadMs).at(-1)?.id ?? null
  }, [items, playheadMs, pin])

  useEffect(() => {
    if (!follow || !currentId || !list.current || editing) return
    const row = list.current.querySelector<HTMLElement>(`[data-item="${currentId}"]`)
    if (!row) return
    const box = list.current
    const target = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    box.scrollTo?.({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' })
  }, [currentId, follow, editing])

  // Without a synced clock the owner is asked to sync first; the jump they
  // asked for happens as soon as the anchor lands.
  const canSync = owner && Boolean(repository.setAnchor)
  const seekGame = (gameMs: number, leadMs = 0) => {
    if (!controller) return
    if (!anchor) {
      if (!canSync) return
      setPendingSeek({ ms: gameMs, leadMs })
      showPanel(true)
      setSyncing(Math.max(0, controller.currentTime()))
      return
    }
    if (!coverage || gameMs < coverage[0] || gameMs > coverage[1]) return
    const target = leadMs > 0 ? Math.max(gameMs - leadMs, coverage[0]) : gameMs
    setPin(leadMs > 0 ? { ms: gameMs, lead: leadMs } : null)
    controller.seekTo(videoOffset(anchor, target / 1000))
  }
  const seekable = (gameMs: number) =>
    Boolean(
      controller && (anchor ? coverage && gameMs >= coverage[0] && gameMs <= coverage[1] : canSync),
    )
  useEffect(() => {
    if (pendingSeek === null) return
    if (anchor && coverage && controller) {
      const { ms, leadMs } = pendingSeek
      const target = leadMs > 0 ? Math.max(ms - leadMs, coverage[0]) : ms
      if (ms >= coverage[0] && ms <= coverage[1]) {
        setPin(leadMs > 0 ? { ms, lead: leadMs } : null)
        controller.seekTo(videoOffset(anchor, target / 1000))
      }
      setPendingSeek(null)
    } else if (syncing === null && !anchor) setPendingSeek(null)
  }, [anchor, coverage, controller, pendingSeek, syncing])
  const commentTime = (videoMs: number) =>
    anchor ? clock(gameTimeMs(anchor, videoMs)) : clock(videoMs)

  const startComment = useCallback(() => {
    if (!controller) return
    showPanel(true)
    notebook?.setView('timeline')
    setEditing(null)
    setCommentEvent(null)
    setComposing(Math.max(0, Math.round(controller.currentTime() * 1000)))
  }, [controller, notebook?.setView])
  const commentOnEvent = (entry: TimelineEntry) => {
    if (!controller || !anchor || !review || !seekable(entry.gameTimeMs)) return
    controller.pause?.()
    if (hidden.has(commentsKey)) toggle(commentsKey)
    setFollow(false)
    setEditing(null)
    setOpenMenu(null)
    setCommentEvent({
      id: entry.id,
      matchId: review.matchId,
      gameMs: entry.gameTimeMs,
      label: entry.label,
    })
    setComposing(Math.round(videoOffset(anchor, entry.gameTimeMs / 1000) * 1000))
  }
  const startDrawing = useCallback(async () => {
    if (!controller?.pause || !repository.addCapture || captureBusy.current) return
    const generation = captureGeneration.current
    captureBusy.current = true
    controller.pause()
    setPreparingDrawing(true)
    setActionError('')
    try {
      const stage = container.current?.querySelector<HTMLElement>('.player-stage')
      if (!stage) throw new Error('Wait for the video to load, then try again.')
      const image = controller.captureFrame
        ? await controller.captureFrame()
        : await captureTabFrame(stage)
      const seconds = controller.currentTime()
      if (!Number.isFinite(seconds) || seconds < 0)
        throw new Error('The video position is unavailable. Try again.')
      if (generation === captureGeneration.current)
        setDrawingFrame({ image, videoMs: Math.round(seconds * 1000) })
    } catch (reason) {
      if (generation === captureGeneration.current)
        setActionError(
          reason instanceof DOMException && reason.name === 'NotAllowedError'
            ? 'Tab capture was cancelled. Choose Draw and share this tab to try again.'
            : reason instanceof DOMException && reason.name === 'SecurityError'
              ? 'This video does not allow frame capture in this browser. Check the video’s cross-origin access settings.'
              : reason instanceof Error
                ? reason.message
                : 'Could not freeze the frame. Try again.',
        )
    } finally {
      if (generation === captureGeneration.current) {
        captureBusy.current = false
        setPreparingDrawing(false)
      }
    }
  }, [controller, repository])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== 'n' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable], dialog[open]')) return
      if (!controller || composing !== null) return
      event.preventDefault()
      startComment()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [controller, composing, startComment])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'd' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      )
        return
      if (
        (event.target as HTMLElement | null)?.closest(
          'input, textarea, select, [contenteditable], dialog[open]',
        )
      )
        return
      if (!controller?.pause || !repository.addCapture || drawingFrame) return
      event.preventDefault()
      void startDrawing()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [controller, repository, drawingFrame, startDrawing])

  async function act(work: () => Promise<unknown>) {
    setActionError('')
    try {
      await work()
      await reload()
      return true
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : 'That didn’t save. Please try again.',
      )
      return false
    }
  }
  function toggle(kind: string) {
    const next = new Set(hidden)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setHidden(next)
    try {
      localStorage.setItem(hiddenStorage, JSON.stringify([...next]))
    } catch {
      // Not persisted in this browser.
    }
  }
  const patch = review ? patchOf(review.gameVersion) : ''
  const filtered =
    presentKinds.some((k) => hidden.has(k.kind)) ||
    hidden.has(commentsKey) ||
    hidden.has(capturesKey)

  const saveComment = async (kind: CommentKind, body: string, name?: string) => {
    if (composing === null) return false
    const ok = await act(() =>
      repository.addComment(
        { videoMs: composing, kind, body, ...(commentEvent ? { event: commentEvent } : {}) },
        name,
      ),
    )
    if (ok) cancelComment()
    return ok
  }
  const compose = composing !== null && (
    <Composer
      key={`${commentEvent?.id ?? 'playhead'}-${composing}`}
      role={repository.role}
      fixedName={repository.guestName}
      timeLabel={commentTime(composing)}
      videoClock={!anchor}
      contextLabel={commentEvent?.label}
      onCancel={cancelComment}
      onSave={saveComment}
    />
  )
  const renderComment = (comment: ReviewComment, nested = false) =>
    editing === comment.id ? (
      <li
        key={comment.id}
        className={nested ? 'event-comment composing' : 'timeline-row composing'}
      >
        <Composer
          role={repository.role}
          fixedName={repository.guestName}
          timeLabel={commentTime(comment.videoMs)}
          videoClock={!anchor}
          contextLabel={comment.event?.label}
          initial={comment}
          onCancel={() => setEditing(null)}
          onSave={async (kind, body) => {
            const ok = await act(() => repository.updateComment(comment.id, { kind, body }))
            if (ok) setEditing(null)
            return ok
          }}
        />
      </li>
    ) : (
      <CommentRow
        key={comment.id}
        comment={comment}
        nested={nested}
        timeLabel={commentTime(comment.videoMs)}
        videoClock={!anchor}
        current={comment.id === currentId}
        viewer={repository.role}
        onSeek={() => controller?.seekTo(Math.max(0, comment.videoMs) / 1000)}
        onEdit={
          comment.mine
            ? () => {
                cancelComment()
                setEditing(comment.id)
              }
            : undefined
        }
        onDelete={
          comment.mine || owner
            ? () => void act(() => repository.deleteComment(comment.id))
            : undefined
        }
      />
    )
  const needsSetup = owner && (!review || !anchor)
  const closeSettings = () => setOpenMenu(null)
  const cinemaToggle = (
    <button
      ref={cinemaButton}
      type="button"
      className="icon-button"
      aria-label={cinema ? 'Exit cinema mode' : 'Enter cinema mode'}
      aria-pressed={cinema}
      title={cinema ? 'Exit cinema mode (Escape)' : 'Cinema mode'}
      onClick={() => {
        closeSettings()
        if (!cinema) showPanel(true)
        setCinema(!cinema)
      }}
    >
      {cinema ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </button>
  )
  const videoSettings = data && (
    <div className="review-filter review-menu">
      <button
        type="button"
        aria-expanded={openMenu === 'settings'}
        onClick={() => setOpenMenu(openMenu === 'settings' ? null : 'settings')}
        className={`icon-button ${needsSetup ? 'attention' : ''}`}
        aria-label={needsSetup ? 'Video settings (setup needed)' : 'Video settings'}
        title="Video settings"
      >
        <Settings size={15} />
      </button>
      {openMenu === 'settings' && (
        <div className="review-filter-menu review-settings-menu review-menu-panel">
          <div className="review-detail-setting" role="radiogroup" aria-label="Timeline detail">
            <small>Timeline</small>
            <div>
              {(['detailed', 'simple'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={simple === (value === 'simple')}
                  className={`button button-small ${simple === (value === 'simple') ? '' : 'secondary'}`}
                  onClick={() => chooseDetail(value)}
                  title={
                    value === 'simple'
                      ? 'Compact named events for your deaths, ultimate casts and objectives'
                      : 'Fights, kills, objectives, matchups and more'
                  }
                >
                  {value === 'simple' ? 'Simple' : 'Detailed'}
                </button>
              ))}
            </div>
          </div>
          {owner && (
            <ReviewSettings
              data={data}
              playerReady={Boolean(controller)}
              onSync={() => {
                closeSettings()
                if (controller) setSyncing(Math.max(0, controller.currentTime()))
              }}
              onAttach={() => {
                closeSettings()
                setAttaching(true)
              }}
            />
          )}
        </div>
      )}
    </div>
  )
  return (
    <div className={`review-container ${cinema ? 'cinema-mode' : ''}`} ref={container}>
      {notebook && <CompleteReview notebook={notebook} />}
      {eventMenu && (
        <EventContextMenu
          target={eventMenu}
          label={eventMenu.entry.label}
          disabled={
            !anchor ||
            !controller ||
            !seekable(eventMenu.entry.gameTimeMs) ||
            editing !== null ||
            (composing !== null && commentEvent?.id !== eventMenu.entry.id)
          }
          hint={
            editing !== null || composing !== null ? 'Finish your current comment first' : undefined
          }
          onClose={() => setEventMenu(null)}
          onComment={() => commentOnEvent(eventMenu.entry)}
        />
      )}

      <div
        className={`review-layout ${panelOpen ? '' : 'timeline-collapsed'}`}
        style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}
      >
        <div className="review-video">
          <div className="review-player">
            {renderPlayer(setController)}
            {data && repository.addCapture && (
              <div className="review-video-settings">
                <button
                  className="button secondary button-small"
                  disabled={!controller?.pause || preparingDrawing}
                  onClick={() => {
                    closeSettings()
                    void startDrawing()
                  }}
                  title="Pause and draw on this frame (D); YouTube prompts you to share this tab"
                >
                  <Pencil size={15} />
                  {preparingDrawing ? 'Freezing frame…' : 'Draw'}
                </button>
              </div>
            )}
          </div>
          {!panelOpen && actionError && (
            <p className="notice error" role="alert">
              {actionError}
            </p>
          )}
        </div>
        {!panelOpen ? (
          <div className="review-collapsed-tools">
            {cinemaToggle}
            {videoSettings}
            <button
              className="review-rail"
              onClick={() => showPanel(true)}
              aria-label="Show timeline"
              title="Show timeline"
            >
              <PanelRightOpen size={16} />
              <span>Timeline</span>
            </button>
          </div>
        ) : (
          <>
            <div
              className="review-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize timeline"
              aria-valuenow={panelWidth}
              aria-valuemin={minPanel}
              tabIndex={0}
              onPointerDown={dragResize}
              onDoubleClick={() => resizeTo(defaultPanel, true)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 96 : 32
                if (event.key === 'ArrowLeft') resizeTo(panelWidth + step, true)
                else if (event.key === 'ArrowRight') resizeTo(panelWidth - step, true)
                else return
                event.preventDefault()
              }}
            />
            <section
              className="review-panel"
              aria-label={notebook?.view === 'notes' ? 'Review notes' : 'Review timeline'}
            >
              {notebook?.view === 'notes' && (
                <ReviewNotebook
                  notebook={notebook}
                  timeLabel={
                    controller
                      ? () =>
                          `${commentTime(Math.round(controller.currentTime() * 1000))}${anchor ? '' : ' video'}`
                      : undefined
                  }
                  cinemaControl={cinemaToggle}
                />
              )}
              <div className="review-timeline-content" hidden={notebook?.view === 'notes'}>
                <header className="review-header">
                  <div className="review-title">
                    <h2>Timeline</h2>
                  </div>
                  <div className="review-tools">
                    {notebook?.view !== 'notes' && cinemaToggle}
                    {notebook?.supported && cinema && (
                      <button
                        className="icon-button"
                        aria-label="Add review notes"
                        title="Add notes"
                        onClick={notebook.open}
                      >
                        <NotebookPen size={15} />
                      </button>
                    )}
                    {videoSettings}
                    {(presentKinds.length > 0 || comments.length > 0 || captures.length > 0) && (
                      <div className="review-filter review-menu">
                        <button
                          type="button"
                          aria-expanded={openMenu === 'filter'}
                          onClick={() => setOpenMenu(openMenu === 'filter' ? null : 'filter')}
                          className={`icon-button ${filtered ? 'active' : ''}`}
                          aria-label="Filter timeline"
                          title="Filter timeline"
                        >
                          <Filter size={15} />
                        </button>
                        {openMenu === 'filter' && (
                          <div className="review-filter-menu review-menu-panel">
                            {presentKinds.map((k) => (
                              <label key={k.kind}>
                                <input
                                  type="checkbox"
                                  checked={!hidden.has(k.kind)}
                                  onChange={() => toggle(k.kind)}
                                />
                                <i className={`kind-dot kind-${k.kind}`} />
                                {k.name}
                                <small>{entries.filter((e) => e.kind === k.kind).length}</small>
                              </label>
                            ))}
                            <label>
                              <input
                                type="checkbox"
                                checked={!hidden.has(commentsKey)}
                                onChange={() => toggle(commentsKey)}
                              />
                              <i className="kind-dot kind-comment" />
                              Comments
                              <small>{comments.length}</small>
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={!hidden.has(capturesKey)}
                                onChange={() => toggle(capturesKey)}
                              />
                              <i className="kind-dot kind-comment" />
                              Captures
                              <small>{captures.length}</small>
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => showPanel(false)}
                      aria-label="Hide timeline"
                      title="Hide timeline"
                    >
                      <PanelRightClose size={15} />
                    </button>
                    <button
                      className="button button-small"
                      onClick={startComment}
                      disabled={!controller || composing !== null || editing !== null}
                      aria-label="Comment"
                      title={controller ? 'Comment at the playhead' : 'Wait for the video to load'}
                    >
                      <MessageSquarePlus size={15} />
                      <span className="review-comment-label">Comment</span>
                    </button>
                  </div>
                </header>
                {data && (
                  <KeyMoments
                    moments={data.moments ?? []}
                    editable={owner && Boolean(repository.addMoment)}
                    timeLabel={commentTime}
                    videoClock={!anchor}
                    playheadMs={playheadMs}
                    canMark={Boolean(controller)}
                    onSeek={(ms) => controller?.seekTo(Math.max(0, ms) / 1000)}
                    onMark={async (note) =>
                      controller
                        ? act(() =>
                            repository.addMoment!(
                              Math.round(controller.currentTime() * 1000),
                              note,
                            ),
                          )
                        : false
                    }
                    onSaveNote={(id, note) => act(() => repository.updateMoment!(id, note))}
                    onDelete={(id) => void act(() => repository.deleteMoment!(id))}
                  />
                )}
                {!owner && review && !anchor && (
                  <p className="review-note">
                    <Clock3 size={13} aria-hidden="true" />
                    Events can't jump to the video until the player syncs the game clock.
                  </p>
                )}
                {actionError && (
                  <div className="notice error review-notice" role="alert">
                    {actionError}
                  </div>
                )}
                {syncing !== null && repository.setAnchor && controller && (
                  <SyncClockPanel
                    key={syncing}
                    initialSeconds={syncing}
                    liveSeconds={(playheadMs ?? syncing * 1000) / 1000}
                    readSeconds={() => controller.currentTime()}
                    anchor={anchor}
                    target={pendingSeek?.ms}
                    onClose={() => setSyncing(null)}
                    onSave={(next) => act(() => repository.setAnchor!(next))}
                  />
                )}
                {composing !== null &&
                  (!commentEvent ||
                    !items.some((item) => item.type === 'event' && item.id === commentEvent.id)) &&
                  compose}
                {state === 'loading' ? (
                  <div className="review-empty" role="status">
                    <LoaderCircle className="spin" size={18} />
                    Loading the timeline…
                  </div>
                ) : state === 'error' ? (
                  <div className="review-empty" role="alert">
                    <p>{error}</p>
                    <button className="button secondary button-small" onClick={() => void reload()}>
                      <RefreshCw size={14} />
                      Try again
                    </button>
                  </div>
                ) : items.length === 0 ? (
                  <div className="review-empty">
                    {entries.length || comments.length || captures.length || moments.length ? (
                      <>
                        <p>Everything on this timeline is hidden by the filter.</p>
                        <button
                          className="button secondary button-small"
                          onClick={() => {
                            setHidden(new Set())
                            try {
                              localStorage.removeItem(hiddenStorage)
                            } catch {
                              // Nothing saved.
                            }
                          }}
                        >
                          Reset filter
                        </button>
                      </>
                    ) : (
                      <>
                        <strong>No comments yet</strong>
                        <p>
                          {owner
                            ? 'Add a comment or question at the playhead. Your coach sees it on the watch page and can reply with their own.'
                            : 'Add a comment at the playhead. The player sees it straight away.'}
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="review-list-wrap">
                    <ol
                      className="review-list"
                      ref={list}
                      // The reader taking over the list stops it following the playhead.
                      onWheel={() => playheadMs !== null && setFollow(false)}
                      onTouchMove={() => playheadMs !== null && setFollow(false)}
                      onKeyDown={(event) => {
                        if (
                          ['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(
                            event.key,
                          ) &&
                          playheadMs !== null
                        )
                          setFollow(false)
                      }}
                    >
                      {items.map((item) =>
                        item.type === 'event' ? (
                          <EventRow
                            key={item.id}
                            entry={item.entry}
                            patch={patch}
                            current={item.id === currentId}
                            seekable={seekable(item.entry.gameTimeMs)}
                            dim={Boolean(coverage) && !seekable(item.entry.gameTimeMs)}
                            compact={simple}
                            onOpenMenu={(target) => {
                              setOpenMenu(null)
                              setFollow(false)
                              if (list.current)
                                list.current.scrollTo?.({
                                  top: list.current.scrollTop,
                                  behavior: 'instant',
                                })
                              setEventMenu({ ...target, entry: item.entry })
                            }}
                            onSeek={() =>
                              seekGame(item.entry.gameTimeMs, seekLeadMs(item.entry.kind))
                            }
                            onSeekTime={(ms, kind) => seekGame(ms, seekLeadMs(kind))}
                          >
                            {((eventComments.get(item.id)?.length ?? 0) > 0 ||
                              commentEvent?.id === item.id) && (
                              <section
                                className="event-discussion"
                                aria-label={`Comments on ${item.entry.label} at ${clock(item.entry.gameTimeMs)}`}
                              >
                                <strong>Discussion</strong>
                                <ol>
                                  {eventComments
                                    .get(item.id)
                                    ?.map((comment) => renderComment(comment, true))}
                                </ol>
                                {commentEvent?.id === item.id && compose}
                              </section>
                            )}
                          </EventRow>
                        ) : item.type === 'moment' ? (
                          <MomentRow
                            key={item.id}
                            id={item.id}
                            note={item.moment.note}
                            timeLabel={commentTime(item.moment.videoMs)}
                            videoClock={!anchor}
                            current={item.id === currentId}
                            onSeek={() =>
                              controller?.seekTo(Math.max(0, item.moment.videoMs) / 1000)
                            }
                          />
                        ) : item.type === 'capture' ? (
                          <CaptureRow
                            key={item.id}
                            capture={item.capture}
                            repository={repository}
                            timeLabel={commentTime(item.capture.videoMs)}
                            videoClock={!anchor}
                            current={item.id === currentId}
                            onOpen={() => setViewingCapture(item.capture)}
                          />
                        ) : (
                          renderComment(item.comment)
                        ),
                      )}
                    </ol>
                    {!follow && playheadMs !== null && (
                      <button
                        className="button secondary button-small review-follow"
                        onClick={() => setFollow(true)}
                      >
                        <ArrowDownToLine size={14} />
                        Return to playhead
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
        {attaching && league && repository.attachMatch && (
          <AttachMatchDialog
            league={league}
            recordedOn={recordedOn ?? null}
            attachedId={data?.matchId ?? null}
            onClose={() => setAttaching(false)}
            onAttach={(profile, match) => act(() => repository.attachMatch!(profile, match))}
            onDetach={() => act(() => repository.detachMatch!())}
          />
        )}
      </div>
      {drawingFrame && (
        <DrawingCapture
          frame={drawingFrame.image}
          timeLabel={commentTime(drawingFrame.videoMs)}
          role={repository.role}
          fixedName={repository.guestName}
          onClose={() => setDrawingFrame(null)}
          onSave={async (image, body, name) => {
            const generation = captureGeneration.current
            await repository.addCapture!({ videoMs: drawingFrame.videoMs, image, body }, name)
            if (generation !== captureGeneration.current) return
            setHidden((previous) => {
              const next = new Set(previous)
              next.delete(capturesKey)
              return next
            })
            showPanel(true)
            setDrawingFrame(null)
            await reload()
          }}
        />
      )}
      {viewingCapture && repository.getCapture && (
        <CapturePreview
          capture={viewingCapture}
          repository={repository}
          timeLabel={commentTime(viewingCapture.videoMs)}
          onClose={() => setViewingCapture(null)}
          onSeek={controller ? () => controller.seekTo(viewingCapture.videoMs / 1000) : undefined}
          onDelete={
            repository.deleteCapture && (owner || viewingCapture.mine)
              ? () => act(() => repository.deleteCapture!(viewingCapture.id))
              : undefined
          }
        />
      )}
    </div>
  )
}

/// The student flags places the coach should look at; everyone can jump to them.
function KeyMoments({
  moments,
  editable,
  timeLabel,
  videoClock,
  playheadMs,
  canMark,
  onSeek,
  onMark,
  onSaveNote,
  onDelete,
}: {
  moments: KeyMoment[]
  editable: boolean
  timeLabel(videoMs: number): string
  videoClock: boolean
  playheadMs: number | null
  canMark: boolean
  onSeek(videoMs: number): void
  onMark(note: string): Promise<boolean>
  onSaveNote(id: string, note: string): Promise<boolean>
  onDelete(id: string): void
}) {
  const [open, setOpen] = useState(true)
  const [marking, setMarking] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const startMark = useCallback(() => {
    setEditing(null)
    setNote('')
    setMarking(true)
  }, [])
  useEffect(() => {
    if (!editable) return
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'm' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented ||
        !canMark
      )
        return
      if (
        (event.target as HTMLElement | null)?.closest(
          'input, textarea, select, [contenteditable], dialog[open]',
        )
      )
        return
      event.preventDefault()
      setOpen(true)
      startMark()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [editable, canMark, startMark])
  if (!editable && moments.length === 0) return null
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    const ok = editing ? await onSaveNote(editing, note.trim()) : await onMark(note.trim())
    setBusy(false)
    if (ok) {
      setMarking(false)
      setEditing(null)
      setNote('')
    }
  }
  const form = (marking || editing) && (
    <form
      className="moment-form"
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setMarking(false)
          setEditing(null)
        }
      }}
    >
      <input
        ref={input}
        autoFocus
        aria-label="Why this moment matters"
        value={note}
        maxLength={500}
        placeholder="What should the coach look at? (optional)"
        onChange={(event) => setNote(event.target.value)}
      />
      <div className="moment-form-actions">
        <button
          type="button"
          className="button secondary button-small"
          onClick={() => {
            setMarking(false)
            setEditing(null)
          }}
        >
          Cancel
        </button>
        <button className="button button-small" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
  return (
    <section className="key-moments" aria-label="Key moments">
      <button
        type="button"
        className="key-moments-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Flag size={14} aria-hidden="true" />
        <strong>Key moments</strong>
        <span>{moments.length}</span>
      </button>
      {open && (
        <>
          {moments.length === 0 && (
            <p className="field-hint">
              Mark the moments you want your coach to look at. They appear here for everyone with a
              link.
            </p>
          )}
          <ol className="key-moment-list">
            {moments.map((moment) => (
              <li
                key={moment.id}
                className={
                  playheadMs !== null && Math.abs(playheadMs - moment.videoMs) < 5000
                    ? 'is-current'
                    : ''
                }
              >
                <button
                  type="button"
                  className="key-moment-seek"
                  onClick={() => onSeek(moment.videoMs)}
                  title="Jump to this moment"
                >
                  <time>
                    {timeLabel(moment.videoMs)}
                    {videoClock ? ' video' : ''}
                  </time>
                  <span>{moment.note || 'Look here'}</span>
                </button>
                {editable && (
                  <span className="key-moment-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Edit note"
                      title="Edit note"
                      onClick={() => {
                        setMarking(false)
                        setNote(moment.note)
                        setEditing(moment.id)
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Remove key moment"
                      title="Remove"
                      onClick={() => onDelete(moment.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
          {form}
          {editable && !form && (
            <button
              type="button"
              className="button secondary button-small"
              disabled={!canMark}
              onClick={startMark}
              title="Mark the current moment for your coach (M)"
            >
              <Flag size={14} />
              Mark this moment
            </button>
          )}
        </>
      )}
    </section>
  )
}

function ReviewSettings({
  data,
  playerReady,
  onSync,
  onAttach,
}: {
  data: ReviewData
  playerReady: boolean
  onSync(): void
  onAttach(): void
}) {
  const review = data.review
  const lane = review ? context(review) : null
  return (
    <div className="review-settings">
      <div>
        <small>Game</small>
        <p>
          {review && lane
            ? `${lane.name(review.playerId)}${lane.opponent ? ` vs ${lane.name(lane.opponent)}` : ''} · ${queues[review.queueId] ?? 'Game'} · ${clock(review.gameDuration * 1000)}`
            : 'No game attached'}
        </p>
        <button className="button secondary button-small" onClick={onAttach}>
          {review ? 'Change game' : 'Attach game'}
        </button>
      </div>
      {review && (
        <div>
          <small>Game clock</small>
          <p>
            {data.anchor
              ? `${clock(data.anchor.gameTimeSeconds * 1000)} at ${clock(data.anchor.videoOffsetSeconds * 1000)} in the video`
              : 'Not synced'}
          </p>
          <button
            className="button secondary button-small"
            onClick={onSync}
            disabled={!playerReady}
            title={
              playerReady
                ? 'Read the in-game timer from the current frame'
                : 'Wait for the video to load'
            }
          >
            {data.anchor ? 'Resync' : 'Sync clock'}
          </button>
        </div>
      )}
    </div>
  )
}

function Composer({
  role,
  fixedName,
  timeLabel,
  videoClock,
  initial,
  contextLabel,
  onCancel,
  onSave,
}: {
  role: 'owner' | 'coach'
  /** A named guest's name is set by the owner, not typed. */
  fixedName?: string
  timeLabel: string
  videoClock: boolean
  initial?: ReviewComment
  contextLabel?: string
  onCancel(): void
  onSave(kind: CommentKind, body: string, name?: string): Promise<boolean>
}) {
  const [kind, setKind] = useState<CommentKind>(initial?.kind ?? 'comment')
  const [body, setBody] = useState(initial?.body ?? '')
  const [name, setName] = useState(savedCoachName)
  const [askName, setAskName] = useState(() => !savedCoachName().trim())
  const [busy, setBusy] = useState(false)
  const group = useId()
  const needsName = role === 'coach' && !initial && !fixedName
  const prompt = commentKinds.find((k) => k.kind === kind)!.prompt
  async function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!body.trim() || (needsName && !name.trim()) || busy) return
    setBusy(true)
    if (needsName) saveCoachName(name.trim())
    const ok = await onSave(kind, body.trim(), needsName ? name.trim() : fixedName)
    if (!ok) setBusy(false)
  }
  const kinds = role === 'owner' ? commentKinds : commentKinds.filter((k) => k.kind !== 'mindset')
  return (
    <form
      className="review-composer"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit()
      }}
    >
      {contextLabel && <p className="composer-event-context">On {contextLabel}</p>}
      <div className="composer-heading">
        <strong>
          {initial ? 'Edit' : 'New'} at {timeLabel}
        </strong>
        {videoClock && <small>video time</small>}
      </div>
      <div className="composer-kinds" role="radiogroup" aria-label="Comment type">
        {kinds.map((k) => (
          <label key={k.kind} className={kind === k.kind ? 'selected' : ''}>
            <input
              type="radio"
              name={group}
              checked={kind === k.kind}
              onChange={() => setKind(k.kind)}
            />
            {k.name}
          </label>
        ))}
      </div>
      {needsName &&
        (askName ? (
          <label className="composer-name">
            <span>Your name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="Shown with your comments"
            />
          </label>
        ) : (
          <p className="composer-as">
            Commenting as <strong>{name}</strong>
            <button type="button" className="text-link" onClick={() => setAskName(true)}>
              Change
            </button>
          </p>
        ))}
      <textarea
        aria-label="Comment text"
        value={body}
        maxLength={2000}
        rows={3}
        placeholder={prompt}
        autoFocus={!needsName || !askName}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="composer-actions">
        <button type="button" className="button secondary button-small" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="button button-small"
          disabled={busy || !body.trim() || (needsName && !name.trim())}
        >
          {busy ? 'Saving…' : initial ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  )
}

/// Inline rather than a modal: the reader has to see the frame's timer, and
/// may pause or step the video while typing. The position is read on save.
function SyncClockPanel({
  initialSeconds,
  liveSeconds,
  readSeconds,
  anchor,
  target,
  onClose,
  onSave,
}: {
  initialSeconds: number
  liveSeconds: number
  readSeconds(): number
  anchor: ClockAnchor | null
  target?: number | null
  onClose(): void
  onSave(anchor: ClockAnchor | null): Promise<boolean>
}) {
  const mappedAt = (seconds: number) =>
    anchor ? anchor.gameTimeSeconds + (seconds - anchor.videoOffsetSeconds) : null
  const [text, setText] = useState(() => {
    const mapped = mappedAt(initialSeconds)
    return mapped !== null && mapped >= 0 ? clock(mapped * 1000) : ''
  })
  const [busy, setBusy] = useState(false)
  const mapped = mappedAt(liveSeconds)
  const parsed = parseGameClock(text)
  const shift = parsed !== null && mapped !== null && mapped >= 0 ? parsed - mapped : null
  const hint = !text
    ? 'Pause where the timer is readable, then type it.'
    : parsed === null
      ? 'Enter the clock as minutes:seconds, like 12:34.'
      : shift === null
        ? `Events will seek relative to ${clock(parsed * 1000)} at this frame.`
        : Math.abs(shift) < 0.5
          ? 'No change from the current sync.'
          : `Every event will land ${clock(Math.abs(shift) * 1000)} ${shift > 0 ? 'later' : 'earlier'} in the video than it does now.`
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (parsed === null) return
    setBusy(true)
    if (await onSave({ gameTimeSeconds: parsed, videoOffsetSeconds: Math.max(0, readSeconds()) }))
      onClose()
    else setBusy(false)
  }
  return (
    <form
      className="review-composer sync-panel"
      aria-label="Sync game clock"
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="composer-heading">
        <strong>{anchor ? 'Resync game clock' : 'Sync game clock'}</strong>
      </div>
      <p className="sync-intro">
        Read the in-game timer at the top right of the video and type it here. Every event seeks
        relative to this moment, for you and anyone you share the video with.
        {target != null && ` Once synced, the video jumps to the ${clock(target)} event.`}
      </p>
      <div className="sync-fields">
        <div>
          <small>Video position</small>
          <strong>{clock(liveSeconds * 1000)}</strong>
        </div>
        <label>
          <small>In-game clock</small>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="mm:ss"
            inputMode="decimal"
            autoFocus
            aria-label="In-game clock"
          />
        </label>
      </div>
      <p className="sync-hint" aria-live="polite">
        {hint}
      </p>
      <div className="composer-actions">
        {anchor && (
          <button
            type="button"
            className="button secondary button-small sync-clear"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              if (await onSave(null)) onClose()
              else setBusy(false)
            }}
          >
            Clear sync
          </button>
        )}
        <button type="button" className="button secondary button-small" onClick={onClose}>
          Cancel
        </button>
        <button className="button button-small" disabled={busy || parsed === null}>
          {busy ? 'Saving…' : anchor ? 'Resync' : 'Sync'}
        </button>
      </div>
    </form>
  )
}

function AttachMatchDialog({
  league,
  recordedOn,
  attachedId,
  onClose,
  onAttach,
  onDetach,
}: {
  league: LeagueRepository
  recordedOn: string | null
  attachedId: string | null
  onClose(): void
  onAttach(profileId: string, matchId: string): Promise<boolean>
  onDetach(): Promise<boolean>
}) {
  const [profiles, setProfiles] = useState<LeagueProfile[] | null>(null)
  const [profileId, setProfileId] = useState('')
  const [games, setGames] = useState<Game[] | null>(null)
  const [selected, setSelected] = useState<string>(attachedId ?? '')
  const [busy, setBusy] = useState<'attach' | 'detach' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    league
      .profiles()
      .then((rows) => {
        setProfiles(rows)
        setProfileId(rows[0]?.id ?? '')
      })
      .catch((e: Error) => setError(e.message))
  }, [league])
  useEffect(() => {
    const profile = profiles?.find((p) => p.id === profileId)
    if (!profile) return
    let active = true
    setGames(null)
    league
      .matches(profile.id)
      .then((rows) => {
        if (!active) return
        const list = gamesFor(rows, profile.puuid).sort((a, b) => b.gameCreation - a.gameCreation)
        setGames(list)
        // Preselect the only game played on the recording's date.
        if (!attachedId && recordedOn) {
          const sameDay = list.filter((g) => localDate(g.gameCreation) === recordedOn)
          if (sameDay.length === 1) setSelected(sameDay[0].id)
        }
      })
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [league, profiles, profileId, attachedId, recordedOn])
  async function attach(event: FormEvent) {
    event.preventDefault()
    if (!selected || !profileId) return
    setBusy('attach')
    setError('')
    if (await onAttach(profileId, selected)) onClose()
    else setBusy(null)
  }
  return (
    <Dialog title={attachedId ? 'Change game' : 'Attach game'} onClose={onClose} wide>
      <form className="attach-form" onSubmit={attach}>
        <p className="dialog-intro">
          Pick the game this video shows. Its Riot timeline is fetched once with your token and
          saved with the video, so anyone you share it with sees the same events.
        </p>
        {error && <div className="notice error">{error}</div>}
        {profiles === null ? (
          <div className="review-empty" role="status">
            <LoaderCircle className="spin" size={18} />
            Loading your accounts…
          </div>
        ) : profiles.length === 0 ? (
          <div className="notice">
            Add your League account in Home and sync your match history first.
          </div>
        ) : (
          <>
            {profiles.length > 1 && (
              <label className="form-label">
                <span>Account</span>
                <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.gameName}#{p.tagLine}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {games === null ? (
              <div className="review-empty" role="status">
                <LoaderCircle className="spin" size={18} />
                Loading synced games…
              </div>
            ) : games.length === 0 ? (
              <div className="notice">
                No synced games yet. Refresh your match history in Home, then try again.
              </div>
            ) : (
              <fieldset className="attach-games">
                <legend className="sr-only">Game</legend>
                {games.slice(0, 40).map((g) => (
                  <label key={g.id} className={selected === g.id ? 'selected' : ''}>
                    <input
                      type="radio"
                      name="game"
                      value={g.id}
                      checked={selected === g.id}
                      onChange={() => setSelected(g.id)}
                    />
                    <img src={championIcon(g.player.championId)} alt="" loading="lazy" />
                    <span>
                      <strong>
                        {g.player.championName}
                        {g.opponent && ` vs ${g.opponent.championName}`}
                      </strong>
                      <small>
                        {queues[g.queueId] ?? 'Game'} ·{' '}
                        {roleNames[g.player.teamPosition] ?? 'Any role'} ·{' '}
                        {new Date(g.gameCreation).toLocaleString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </small>
                    </span>
                    <span className={`attach-result ${g.player.win ? 'win' : 'loss'}`}>
                      {g.player.win ? 'Win' : 'Loss'} · {clock(g.gameDuration * 1000)}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        <div className="form-footer">
          {attachedId && (
            <button
              type="button"
              className="button secondary"
              disabled={busy !== null}
              onClick={async () => {
                setBusy('detach')
                if (await onDetach()) onClose()
                else setBusy(null)
              }}
            >
              {busy === 'detach' ? 'Removing…' : 'Remove game'}
            </button>
          )}
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={!selected || busy !== null}>
            {busy === 'attach'
              ? 'Fetching timeline…'
              : attachedId === selected
                ? 'Refresh timeline'
                : 'Attach game'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function localDate(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
