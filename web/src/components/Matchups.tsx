import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Check,
  LoaderCircle,
  Plus,
  Swords,
  Trash2,
  X,
} from 'lucide-react'
import { Champion } from './LeagueParts'
import '../matchups.css'
import { Dialog } from './Dialog'
import { leagueRepository, type LeagueRepository } from '../lib/league-repository'
import { gamesFor, percent, remake, timeAgo, type Game, type LeagueProfile } from '../lib/league'
import { championLabel } from '../lib/champions'
import {
  championCatalogue,
  championOptions,
  cleanDraft,
  emptyDraft,
  hasContent,
  laneAt,
  matchupGames,
  matchupPath,
  matchupRepository,
  pairings,
  searchChampions,
  type ChampionOption,
  type Difficulty,
  type MatchupDraft,
  type MatchupNote,
  type MatchupRepository,
} from '../lib/matchups'

const MatchupStats = lazy(() => import('./MatchupStats').then((m) => ({ default: m.MatchupStats })))

export type OwnGame = Game & { profileId: string }

// Every saved account's games, merged: a matchup is yours whichever account played it.
export function useOwnGames(league: LeagueRepository) {
  const [profiles, setProfiles] = useState<LeagueProfile[]>([])
  const [games, setGames] = useState<OwnGame[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let active = true
    const merge = (rows: { profile: LeagueProfile; matches: Parameters<typeof gamesFor>[0] }[]) => {
      const seen = new Set<string>()
      return rows
        .flatMap(({ profile, matches }) =>
          gamesFor(matches, profile.puuid).map((g) => ({ ...g, profileId: profile.id })),
        )
        .sort((a, b) => b.gameCreation - a.gameCreation)
        .filter((g) => !seen.has(g.id) && Boolean(seen.add(g.id)))
    }
    league
      .profiles()
      .then(async (list) => {
        if (!active) return
        setProfiles(list)
        // What this browser already holds first, then the server's changes.
        const stored = await Promise.all(
          list.map(async (profile) => ({
            profile,
            matches: (await league.storedMatches?.(profile.id).catch(() => null)) ?? [],
          })),
        )
        if (active && stored.some((s) => s.matches.length)) setGames(merge(stored))
        const fresh = await Promise.all(
          list.map(async (profile) => ({ profile, matches: await league.matches(profile.id) })),
        )
        if (active) setGames(merge(fresh))
      })
      .catch((e: Error) => active && setError(e.message))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [league, version])
  const reload = useCallback(() => setVersion((v) => v + 1), [])
  return { profiles, games, loading, error, reload }
}

function useMatchups(repository: MatchupRepository) {
  const [notes, setNotes] = useState<MatchupNote[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    repository
      .list()
      .then((rows) => active && setNotes(rows ?? []))
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [repository])
  // Saves land in this list so the editor reopens with them after a tab switch.
  const remember = useCallback((note: MatchupNote) => {
    setNotes((list) => [
      note,
      ...(list ?? []).filter(
        (n) => n.championId !== note.championId || n.opponentId !== note.opponentId,
      ),
    ])
  }, [])
  const forget = useCallback((championId: number, opponentId: number) => {
    setNotes((list) =>
      (list ?? []).filter((n) => n.championId !== championId || n.opponentId !== opponentId),
    )
  }, [])
  return { notes, error, remember, forget }
}

function useChampions(games: Game[]) {
  const [catalogue, setCatalogue] = useState<ChampionOption[]>([])
  useEffect(() => {
    let active = true
    void championCatalogue().then((list) => active && setCatalogue(list))
    return () => {
      active = false
    }
  }, [])
  const options = useMemo(() => championOptions(catalogue, games), [catalogue, games])
  const name = useCallback(
    (id: number) => options.find((c) => c.id === id)?.name ?? `Champion ${id}`,
    [options],
  )
  return { options, name }
}

const difficulties: { value: Difficulty; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'even', label: 'Even' },
  { value: 'hard', label: 'Hard' },
]
const difficultyLabel = (d: Difficulty | null) => difficulties.find((x) => x.value === d)?.label

function Record({ games }: { games: Game[] }) {
  const decided = games.filter((g) => !remake(g))
  const wins = decided.filter((g) => g.player.win).length
  return (
    <span className="matchup-record">
      <strong>{percent(decided.length ? wins / decided.length : null)}</strong>
      <small>
        {wins}W {decided.length - wins}L
      </small>
    </span>
  )
}

// A text box that suggests champions as you type; Enter takes the top match.
export function ChampionPicker({
  label,
  value,
  options,
  onChange,
  autoFocus = false,
}: {
  label: string
  value: number | null
  options: ChampionOption[]
  onChange: (id: number | null) => void
  autoFocus?: boolean
}) {
  const selectedName = value ? (options.find((c) => c.id === value)?.name ?? '') : ''
  const [query, setQuery] = useState(selectedName)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const id = useId()
  useEffect(() => setQuery(selectedName), [selectedName])
  const results = searchChampions(options, open ? query : '', 8)
  const choose = (c: ChampionOption) => {
    onChange(c.id)
    setQuery(c.name)
    setOpen(false)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && open && results[active]) {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      setOpen(false)
      setQuery(selectedName)
    }
  }
  return (
    <div className="champion-picker">
      <label htmlFor={`${id}-input`}>{label}</label>
      <div className="champion-picker-field">
        {value ? (
          <Champion id={value} name={selectedName} size={28} />
        ) : (
          <span className="champion-picker-blank" />
        )}
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && results[active] ? `${id}-${results[active].id}` : undefined
          }
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder="Type a champion"
          value={query}
          onFocus={(e) => {
            e.currentTarget.select()
            setOpen(true)
            setActive(0)
          }}
          onBlur={() => {
            setOpen(false)
            setQuery(selectedName)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
            if (!e.target.value) onChange(null)
          }}
          onKeyDown={onKey}
        />
      </div>
      {open && results.length > 0 && (
        <ul className="champion-picker-list" role="listbox" id={`${id}-list`} aria-label={label}>
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${id}-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(c)
              }}
              onMouseEnter={() => setActive(i)}
            >
              <Champion id={c.id} name={c.name} size={24} />
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function MatchupsHome({
  league = leagueRepository,
  repository = matchupRepository,
}: {
  league?: LeagueRepository
  repository?: MatchupRepository
}) {
  const { games, loading, error: gamesError } = useOwnGames(league)
  const { notes, error } = useMatchups(repository)
  const { options, name } = useChampions(games)
  const [mine, setMine] = useState<number | null>(null)
  const [theirs, setTheirs] = useState<number | null>(null)
  // Start from the champion you played last.
  const lastPlayed = games[0]?.player.championId ?? null
  useEffect(() => {
    if (lastPlayed && mine === null) setMine(lastPlayed)
  }, [lastPlayed])
  const written = (notes ?? []).filter(hasContent)
  const pairs = useMemo(() => pairings(games), [games])
  const noteFor = (c: number, o: number) =>
    written.find((n) => n.championId === c && n.opponentId === o)
  // Opponents you've faced on the chosen champion, for a one-click pick in champ select.
  const faced = mine ? pairs.filter((p) => p.championId === mine).slice(0, 10) : []
  const withNotes = mine ? written.filter((n) => n.championId === mine) : []
  const quick = [
    ...faced.map((p) => p.opponentId),
    ...withNotes.map((n) => n.opponentId).filter((id) => !faced.some((p) => p.opponentId === id)),
  ].slice(0, 12)
  const open = () => {
    if (mine && theirs) window.location.hash = matchupPath(mine, theirs).slice(1)
  }
  return (
    <section className="matchups-page">
      <div className="blocks-head">
        <div>
          <span className="eyebrow">MATCHUPS</span>
          <h1>Matchups</h1>
          <p className="blocks-lede">
            Pick your champion and your lane opponent before the game: read your plan, then check
            how the lane has gone for you.
          </p>
        </div>
      </div>
      {(error || gamesError) && <div className="notice error">{error || gamesError}</div>}
      <form
        className="league-card matchup-finder"
        onSubmit={(e) => {
          e.preventDefault()
          open()
        }}
      >
        <ChampionPicker label="You" value={mine} options={options} onChange={setMine} />
        <button
          type="button"
          className="icon-button matchup-swap"
          aria-label="Swap champions"
          title="Swap champions"
          onClick={() => {
            setMine(theirs)
            setTheirs(mine)
          }}
        >
          <ArrowLeftRight size={16} />
        </button>
        <ChampionPicker
          label="Lane opponent"
          value={theirs}
          options={options}
          onChange={setTheirs}
          autoFocus
        />
        <button className="button" disabled={!mine || !theirs}>
          Open matchup
          <ArrowRight size={14} />
        </button>
        {quick.length > 0 && (
          <div className="matchup-quick" aria-label={`Opponents you've played ${name(mine!)} into`}>
            <span className="muted">Faced on {name(mine!)}</span>
            {quick.map((id) => (
              <a
                key={id}
                className={`matchup-chip ${noteFor(mine!, id) ? 'noted' : ''}`}
                href={matchupPath(mine!, id)}
                title={`${name(mine!)} vs ${name(id)}${noteFor(mine!, id) ? ' · has notes' : ''}`}
              >
                <Champion id={id} name={name(id)} size={24} />
                {name(id)}
              </a>
            ))}
          </div>
        )}
      </form>

      <div className="league-section-heading">
        <h2>Your notes</h2>
      </div>
      {!notes && !error ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading notes…
        </div>
      ) : written.length === 0 ? (
        <p className="blocks-empty">
          No matchup notes yet. Open a matchup and write the one thing to remember next time.
        </p>
      ) : (
        <ul className="matchup-list">
          {written.map((n) => {
            const played = pairs.find(
              (p) => p.championId === n.championId && p.opponentId === n.opponentId,
            )
            return (
              <li key={`${n.championId}:${n.opponentId}`}>
                <a className="matchup-card" href={matchupPath(n.championId, n.opponentId)}>
                  <span className="matchup-pair">
                    <Champion id={n.championId} name={name(n.championId)} size={32} />
                    <Champion id={n.opponentId} name={name(n.opponentId)} size={32} />
                  </span>
                  <span className="matchup-card-main">
                    <strong>
                      {name(n.championId)} <span className="muted">vs</span> {name(n.opponentId)}
                    </strong>
                    <small>{n.plan || `${n.threats.length + n.tips.length} points`}</small>
                  </span>
                  {n.difficulty && (
                    <span className={`difficulty-chip ${n.difficulty}`}>
                      {difficultyLabel(n.difficulty)}
                    </span>
                  )}
                  {played ? <Record games={played.games} /> : <span />}
                </a>
              </li>
            )
          })}
        </ul>
      )}

      <div className="league-section-heading">
        <h2>Most played matchups</h2>
        <span className="muted">From your synced games</span>
      </div>
      {loading && !games.length ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading your games…
        </div>
      ) : pairs.length === 0 ? (
        <p className="blocks-empty">Sync games on Home to see how you do in each lane matchup.</p>
      ) : (
        <ul className="matchup-list">
          {pairs.slice(0, 12).map((p) => (
            <li key={`${p.championId}:${p.opponentId}`}>
              <a className="matchup-card" href={matchupPath(p.championId, p.opponentId, true)}>
                <span className="matchup-pair">
                  <Champion id={p.championId} name={name(p.championId)} size={32} />
                  <Champion id={p.opponentId} name={name(p.opponentId)} size={32} />
                </span>
                <span className="matchup-card-main">
                  <strong>
                    {name(p.championId)} <span className="muted">vs</span> {name(p.opponentId)}
                  </strong>
                  <small>
                    {p.games.length} {p.games.length === 1 ? 'game' : 'games'} · last{' '}
                    {timeAgo(p.games[0].gameCreation)}
                  </small>
                </span>
                <span />
                <Record games={p.games} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function MatchupView({
  championId,
  opponentId,
  tab,
  league = leagueRepository,
  repository = matchupRepository,
}: {
  championId: number
  opponentId: number
  tab: 'notes' | 'stats'
  league?: LeagueRepository
  repository?: MatchupRepository
}) {
  const own = useOwnGames(league)
  const { notes, error, remember, forget } = useMatchups(repository)
  const { name } = useChampions(own.games)
  const note = notes?.find((n) => n.championId === championId && n.opponentId === opponentId)
  const history = useMemo(
    () => matchupGames(own.games, opponentId, championId),
    [own.games, opponentId, championId],
  )
  const others = (notes ?? []).filter(
    (n) => n.opponentId === opponentId && n.championId !== championId && hasContent(n),
  )
  return (
    <section className="matchups-page matchup-view">
      <a className="text-link" href="#/matchups">
        <ArrowLeft size={14} /> Matchups
      </a>
      <header className="matchup-header">
        <div className="matchup-side">
          <Champion id={championId} name={name(championId)} size={56} />
          <span>
            <small className="eyebrow">YOU</small>
            <strong>{name(championId)}</strong>
          </span>
        </div>
        <span className="matchup-vs">vs</span>
        <div className="matchup-side opponent">
          <Champion id={opponentId} name={name(opponentId)} size={56} />
          <span>
            <small className="eyebrow">LANE OPPONENT</small>
            <strong>{name(opponentId)}</strong>
          </span>
        </div>
        <h1 className="sr-only">
          {name(championId)} vs {name(opponentId)}
        </h1>
      </header>
      <nav className="matchup-tabs" aria-label="Matchup sections">
        <a
          href={matchupPath(championId, opponentId)}
          className={tab === 'notes' ? 'active' : ''}
          aria-current={tab === 'notes' ? 'page' : undefined}
        >
          Matchup
        </a>
        <a
          href={matchupPath(championId, opponentId, true)}
          className={tab === 'stats' ? 'active' : ''}
          aria-current={tab === 'stats' ? 'page' : undefined}
        >
          Stats
          {history.length > 0 && <span className="matchup-tab-count">{history.length}</span>}
        </a>
      </nav>
      {error && <div className="notice error">{error}</div>}
      {own.error && <div className="notice error">{own.error}</div>}
      {tab === 'notes' ? (
        !notes ? (
          !error && (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" />
              Loading notes…
            </div>
          )
        ) : (
          <>
            <HistoryGlance
              games={history}
              loading={own.loading}
              statsHref={matchupPath(championId, opponentId, true)}
              repository={repository}
            />
            <MatchupEditor
              key={`${championId}:${opponentId}`}
              note={note ?? { ...emptyDraft, championId, opponentId, revision: 0 }}
              repository={repository}
              opponentName={name(opponentId)}
              onSaved={remember}
              onCleared={() => forget(championId, opponentId)}
            />
            {others.length > 0 && (
              <div className="matchup-others">
                <h2>Your other notes vs {name(opponentId)}</h2>
                <ul>
                  {others.map((n) => (
                    <li key={n.championId}>
                      <a href={matchupPath(n.championId, opponentId)}>
                        <Champion id={n.championId} name={name(n.championId)} size={24} />
                        <strong>{name(n.championId)}</strong>
                        <span className="muted">{n.plan || n.threats[0] || n.tips[0] || ''}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )
      ) : (
        <Suspense
          fallback={
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" />
              Loading stats…
            </div>
          }
        >
          <MatchupStats
            games={own.games}
            loading={own.loading}
            championId={championId}
            opponentId={opponentId}
            championName={name(championId)}
            opponentName={name(opponentId)}
            profiles={own.profiles}
            league={league}
            repository={repository}
            onSynced={own.reload}
          />
        </Suspense>
      )}
    </section>
  )
}

// One line of history above the notes: enough to set expectations in champ select.
function HistoryGlance({
  games,
  loading,
  statsHref,
  repository,
}: {
  games: Game[]
  loading: boolean
  statsHref: string
  repository: MatchupRepository
}) {
  const decided = games.filter((g) => !remake(g))
  const [gold15, setGold15] = useState<number[] | null>(null)
  const ids = decided.map((g) => g.id).join(',')
  useEffect(() => {
    let active = true
    if (!decided.length) return
    repository
      .lanes(decided.map((g) => g.id))
      .then((lanes) => {
        if (!active) return
        setGold15(decided.flatMap((g) => laneAt(lanes[g.id], 15, 'gold') ?? []))
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [ids, repository])
  if (loading && !games.length) return <div className="matchup-glance muted">Loading history…</div>
  if (!decided.length)
    return (
      <div className="matchup-glance">
        <Swords size={16} />
        <span className="muted">No games in this matchup yet. Your notes are a good start.</span>
      </div>
    )
  const avg15 = gold15?.length ? gold15.reduce((a, b) => a + b, 0) / gold15.length : null
  return (
    <a className="matchup-glance" href={statsHref}>
      <Record games={decided} />
      <span className="matchup-glance-form" aria-label="Last five results, newest first">
        {decided.slice(0, 5).map((g) => (
          <span key={g.id} className={`league-result ${g.player.win ? 'win' : 'loss'}`}>
            {g.player.win ? 'W' : 'L'}
          </span>
        ))}
      </span>
      <span className="matchup-glance-stat">
        <strong>{decided.length}</strong>
        <small>{decided.length === 1 ? 'game' : 'games'}</small>
      </span>
      {avg15 !== null && (
        <span className="matchup-glance-stat">
          <strong>
            {avg15 >= 0 ? '+' : '−'}
            {Math.abs(Math.round(avg15)).toLocaleString('en-GB')}
          </strong>
          <small>gold at 15</small>
        </span>
      )}
      <span className="matchup-glance-link">
        Stats <ArrowRight size={14} />
      </span>
    </a>
  )
}

const saveDelayMs = 800
type SaveState = 'saved' | 'saving' | 'unsaved' | 'error'

function PointList({
  title,
  hint,
  points,
  tone,
  onChange,
  onBlur,
}: {
  title: string
  hint: string
  points: string[]
  tone: 'threat' | 'tip'
  onChange: (points: string[]) => void
  onBlur: () => void
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const focusAt = useRef<number | null>(null)
  useEffect(() => {
    if (focusAt.current !== null) {
      refs.current[focusAt.current]?.focus()
      focusAt.current = null
    }
  })
  const add = (at = points.length) => {
    focusAt.current = at
    onChange([...points.slice(0, at), '', ...points.slice(at)])
  }
  return (
    <div className={`matchup-section matchup-points ${tone}`}>
      <h2>{title}</h2>
      {points.length === 0 && <p className="blocks-empty">{hint}</p>}
      <ul className="point-list">
        {points.map((point, index) => (
          <li key={index}>
            <span className="matchup-bullet" aria-hidden />
            <input
              ref={(el) => {
                refs.current[index] = el
              }}
              value={point}
              maxLength={300}
              aria-label={`${title} ${index + 1}`}
              onChange={(e) => onChange(points.map((p, i) => (i === index ? e.target.value : p)))}
              onBlur={onBlur}
              onKeyDown={(e) => {
                // Enter starts the next point; Backspace on an empty point removes it.
                if (e.key === 'Enter' && points.length < 20) {
                  e.preventDefault()
                  add(index + 1)
                } else if (e.key === 'Backspace' && !point) {
                  e.preventDefault()
                  focusAt.current = Math.max(0, index - 1)
                  onChange(points.filter((_, i) => i !== index))
                }
              }}
            />
            <button
              className="icon-button"
              aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
              title="Remove"
              onClick={() => onChange(points.filter((_, i) => i !== index))}
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button
        className="button secondary button-small"
        onClick={() => add()}
        disabled={points.length >= 20}
      >
        <Plus size={14} />
        Add point
      </button>
    </div>
  )
}

function MatchupEditor({
  note,
  repository,
  opponentName,
  onSaved,
  onCleared,
}: {
  note: MatchupNote
  repository: MatchupRepository
  opponentName: string
  onSaved: (note: MatchupNote) => void
  onCleared: () => void
}) {
  const [draft, setDraft] = useState<MatchupDraft>(() => ({
    difficulty: note.difficulty,
    plan: note.plan,
    threats: note.threats,
    tips: note.tips,
    build: note.build,
    notes: note.notes,
  }))
  const [state, setState] = useState<SaveState>('saved')
  const [message, setMessage] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const latest = useRef(draft)
  const revision = useRef(note.revision)
  const dirty = useRef(false)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const timer = useRef<number | undefined>(undefined)
  const stopped = useRef(false)
  const alive = useRef(true)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    saving.current = saving.current.then(async () => {
      if (!dirty.current || stopped.current) return
      const sent = latest.current
      dirty.current = false
      if (alive.current) setState('saving')
      try {
        const saved = await repository.save(
          note.championId,
          note.opponentId,
          revision.current,
          sent,
        )
        revision.current = saved.revision
        onSaved(saved)
        if (alive.current) setState(dirty.current ? 'unsaved' : 'saved')
        setMessage('')
      } catch (e) {
        // Keep the text on screen; stop saving so a stale tab can't overwrite newer notes.
        dirty.current = true
        stopped.current =
          (e as { code?: string }).code === '40001' || /another tab/.test((e as Error).message)
        if (alive.current) {
          setState('error')
          setMessage(
            stopped.current
              ? 'These notes changed in another tab. Copy anything you need, then reload to see the latest.'
              : `Couldn’t save: ${(e as Error).message}. Your text is still here; keep editing to retry.`,
          )
        }
      }
    })
    return saving.current
  }, [repository, note.championId, note.opponentId, onSaved])

  const edit = (patch: Partial<MatchupDraft>) => {
    const next = { ...latest.current, ...patch }
    latest.current = next
    dirty.current = true
    setDraft(next)
    if (!stopped.current) setState('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), saveDelayMs)
  }

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      void flush()
    }
  }, [flush])

  const clear = async () => {
    stopped.current = true
    window.clearTimeout(timer.current)
    await saving.current
    try {
      if (revision.current > 0) await repository.remove(note.championId, note.opponentId)
      revision.current = 0
      onCleared()
      dirty.current = false
      latest.current = emptyDraft
      setDraft(emptyDraft)
      setState('saved')
      setMessage('')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      stopped.current = false
      setConfirmClear(false)
    }
  }

  return (
    <div className="matchup-editor">
      <div className="matchup-editor-bar">
        <div className="matchup-difficulty" role="radiogroup" aria-label="Matchup difficulty">
          <span className="muted">Difficulty</span>
          {difficulties.map((d) => (
            <button
              key={d.value}
              role="radio"
              aria-checked={draft.difficulty === d.value}
              className={`difficulty-chip ${d.value} ${draft.difficulty === d.value ? 'selected' : ''}`}
              onClick={() => edit({ difficulty: draft.difficulty === d.value ? null : d.value })}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className={`save-state ${state}`} role="status">
          {state === 'saving' ? (
            <>
              <LoaderCircle size={13} className="spin" /> Saving…
            </>
          ) : state === 'saved' ? (
            revision.current > 0 ? (
              <>
                <Check size={13} /> Saved
              </>
            ) : (
              ''
            )
          ) : state === 'error' ? (
            'Not saved'
          ) : (
            'Unsaved changes'
          )}
        </span>
      </div>
      {message && <div className="notice error">{message}</div>}

      <label className="matchup-plan">
        <span>Game plan</span>
        <input
          value={draft.plan}
          maxLength={300}
          placeholder={`The one thing to do vs ${opponentName}`}
          onChange={(e) => edit({ plan: e.target.value })}
          onBlur={() => void flush()}
        />
      </label>

      <div className="matchup-columns">
        <PointList
          title="Watch out for"
          hint="Their threats: abilities, power spikes, all-in windows."
          tone="threat"
          points={draft.threats}
          onChange={(threats) => edit({ threats })}
          onBlur={() => void flush()}
        />
        <PointList
          title="How to win"
          hint="Your edges: trades, timings, wave states."
          tone="tip"
          points={draft.tips}
          onChange={(tips) => edit({ tips })}
          onBlur={() => void flush()}
        />
      </div>

      <label className="matchup-section matchup-text">
        <h2>Build &amp; runes</h2>
        <textarea
          value={draft.build}
          maxLength={1000}
          rows={2}
          placeholder="Runes, starting items, spells, first back"
          onChange={(e) => edit({ build: e.target.value })}
          onBlur={() => void flush()}
        />
      </label>
      <label className="matchup-section matchup-text">
        <h2>Notes</h2>
        <textarea
          value={draft.notes}
          maxLength={20000}
          rows={5}
          placeholder="Anything else: jungle pathing, what went wrong last time, VOD timestamps"
          onChange={(e) => edit({ notes: e.target.value })}
          onBlur={() => void flush()}
        />
      </label>
      {hasContent(cleanDraft(draft)) && (
        <div className="block-footer">
          <button className="text-link danger-link" onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} /> Clear notes
          </button>
        </div>
      )}
      {confirmClear && (
        <Dialog title="Clear these notes?" onClose={() => setConfirmClear(false)}>
          <p className="dialog-intro">Everything written for this matchup will be removed.</p>
          <div className="dialog-actions">
            <button className="button secondary" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button className="button danger" onClick={() => void clear()}>
              Clear notes
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
