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
  NotebookPen,
  Pencil,
  Radio,
  RefreshCw,
  LoaderCircle,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { Champion } from './LeagueParts'
import '../matchups.css'
import { Dialog } from './Dialog'
import { RunePageEditor } from './RunePageEditor'
import { isEmpty } from '../lib/runes'
import { leagueRepository, type LeagueRepository, type LiveGame } from '../lib/league-repository'
import {
  gamesFor,
  percent,
  queues,
  remake,
  timeAgo,
  type Game,
  type LeagueProfile,
} from '../lib/league'
import { championLabel } from '../lib/champions'
import {
  championCatalogue,
  championOptions,
  cleanDraft,
  emptyDraft,
  guessLaneOpponent,
  hasContent,
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
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => {
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
  const { games, profiles, loading, error: gamesError } = useOwnGames(league)
  const { notes, error } = useMatchups(repository)
  const { options, name } = useChampions(games)
  const live = useLiveGame(league, profiles)
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
      {live.game ? (
        <LiveGameCard
          key={`${live.game.profileId}:${live.game.gameStartTime}:${live.game.championId}`}
          game={live.game}
          games={games}
          notes={notes ?? []}
          name={name}
          checking={live.checking}
          onCheck={live.check}
        />
      ) : (
        league.liveGame &&
        profiles.length > 0 && (
          <p className="live-idle muted" role="status">
            <Radio size={14} />
            {live.checking
              ? 'Checking for a live game…'
              : live.error
                ? `Couldn’t check for a live game: ${live.error}`
                : 'Not in a game. Once you’re in one, your matchup shows up here.'}
            {!live.checking && (
              <button className="text-link" onClick={() => void live.check()}>
                Check now
              </button>
            )}
          </p>
        )
      )}
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
          autoFocus={!live.game}
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
            <MatchupNotes
              key={`${championId}:${opponentId}`}
              note={note ?? { ...emptyDraft, championId, opponentId, revision: 0 }}
              repository={repository}
              championName={name(championId)}
              opponentName={name(opponentId)}
              onSaved={remember}
              games={history}
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
  onBlur?: () => void
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
              type="button"
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
        type="button"
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

// Text from the removed build box shows at the top of the notes, unless that
// would pass the notes limit (then it stays where it was, so saving still works).
function foldBuild(note: MatchupDraft) {
  const merged = [note.build.trim(), note.notes].filter(Boolean).join('\n\n')
  return merged.length <= 20000
    ? { build: '', notes: merged }
    : { build: note.build, notes: note.notes }
}

type NotesProps = {
  note: MatchupNote
  repository: MatchupRepository
  championName: string
  opponentName: string
  games: Game[]
  onSaved: (note: MatchupNote) => void
  onCleared: () => void
}

// Notes read like a briefing; Edit opens the form, Save brings you back.
function MatchupNotes(props: NotesProps) {
  const [editing, setEditing] = useState(false)
  return editing ? (
    <MatchupEditor {...props} onClose={() => setEditing(false)} />
  ) : (
    <MatchupReader
      note={props.note}
      championName={props.championName}
      opponentName={props.opponentName}
      onEdit={() => setEditing(true)}
    />
  )
}

function ReadList({ title, tone, points }: { title: string; tone: string; points: string[] }) {
  return (
    <section className={`matchup-section matchup-points ${tone}`} aria-label={title}>
      <h2>{title}</h2>
      <ul className="matchup-read-list">
        {points.map((point, i) => (
          <li key={i}>
            <span className="matchup-bullet" aria-hidden />
            {point}
          </li>
        ))}
      </ul>
    </section>
  )
}

function MatchupReader({
  note,
  championName,
  opponentName,
  onEdit,
}: {
  note: MatchupNote
  championName: string
  opponentName: string
  onEdit: () => void
}) {
  if (!hasContent(note))
    return (
      <div className="matchup-empty">
        <NotebookPen size={26} />
        <h2>
          No notes for {championName} vs {opponentName} yet
        </h2>
        <p>Write the plan, the threats and the runes you want in front of you next game.</p>
        <button className="button" onClick={onEdit}>
          <Pencil size={14} /> Write notes
        </button>
      </div>
    )
  const text = [note.build.trim(), note.notes.trim()].filter(Boolean).join('\n\n')
  const lists = [note.threats.length > 0, note.tips.length > 0].filter(Boolean).length
  return (
    <div className="matchup-reader">
      <div className="matchup-reader-bar">
        {note.difficulty ? (
          <span className={`difficulty-chip ${note.difficulty}`}>
            {difficultyLabel(note.difficulty)} matchup
          </span>
        ) : (
          <span />
        )}
        <button className="button secondary button-small" onClick={onEdit}>
          <Pencil size={14} /> Edit notes
        </button>
      </div>
      {note.plan && (
        <section className="matchup-plan-read" aria-label="Game plan">
          <span>Game plan</span>
          <p>{note.plan}</p>
        </section>
      )}
      {lists > 0 && (
        <div className={`matchup-columns ${lists === 1 ? 'single' : ''}`}>
          {note.threats.length > 0 && (
            <ReadList title="Watch out for" tone="threat" points={note.threats} />
          )}
          {note.tips.length > 0 && <ReadList title="How to win" tone="tip" points={note.tips} />}
        </div>
      )}
      {note.runes && !isEmpty(note.runes) && (
        <section className="matchup-runes" aria-label="Runes">
          <h2>Runes</h2>
          <RunePageEditor value={note.runes} readOnly />
        </section>
      )}
      {text && (
        <section className="matchup-section matchup-notes-read" aria-label="Notes">
          <h2>Notes</h2>
          <p>{text}</p>
        </section>
      )}
      {note.updatedAt && (
        <small className="muted matchup-updated">
          Updated {timeAgo(Date.parse(note.updatedAt))}
        </small>
      )}
    </div>
  )
}

function MatchupEditor({
  note,
  repository,
  opponentName,
  games,
  onSaved,
  onCleared,
  onClose,
}: NotesProps & { onClose: () => void }) {
  const [initial] = useState<MatchupDraft>(() => ({
    difficulty: note.difficulty,
    plan: note.plan,
    threats: note.threats,
    tips: note.tips,
    ...foldBuild(note),
    runes: note.runes ?? null,
  }))
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState<'discard' | 'delete' | null>(null)
  const dirty = JSON.stringify(cleanDraft(draft)) !== JSON.stringify(cleanDraft(initial))
  const edit = (patch: Partial<MatchupDraft>) => setDraft((d) => ({ ...d, ...patch }))

  // Leaving the site with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = async () => {
    if (!dirty) return onClose()
    setSaving(true)
    setMessage('')
    try {
      onSaved(await repository.save(note.championId, note.opponentId, note.revision, draft))
      onClose()
    } catch (e) {
      const conflict =
        (e as { code?: string }).code === '40001' || /another tab/.test((e as Error).message)
      setMessage(
        conflict
          ? 'These notes changed in another tab. Copy anything you need, then reload to see the latest.'
          : `Couldn’t save: ${(e as Error).message}. Your changes are still here.`,
      )
      setSaving(false)
    }
  }
  const remove = async () => {
    setSaving(true)
    try {
      if (note.revision > 0) await repository.remove(note.championId, note.opponentId)
      onCleared()
      onClose()
    } catch (e) {
      setMessage((e as Error).message)
      setSaving(false)
      setConfirm(null)
    }
  }

  return (
    <form
      className="matchup-editor"
      aria-label="Edit matchup notes"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="matchup-editor-bar">
        <div className="matchup-difficulty" role="radiogroup" aria-label="Matchup difficulty">
          <span className="muted">Difficulty</span>
          {difficulties.map((d) => (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={draft.difficulty === d.value}
              className={`difficulty-chip ${d.value} ${draft.difficulty === d.value ? 'selected' : ''}`}
              onClick={() => edit({ difficulty: draft.difficulty === d.value ? null : d.value })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
      {message && <div className="notice error">{message}</div>}

      <label className="matchup-plan">
        <span>Game plan</span>
        <input
          value={draft.plan}
          maxLength={300}
          placeholder={`The one thing to do vs ${opponentName}`}
          onChange={(e) => edit({ plan: e.target.value })}
        />
      </label>

      <div className="matchup-columns">
        <PointList
          title="Watch out for"
          hint="Their threats: abilities, power spikes, all-in windows."
          tone="threat"
          points={draft.threats}
          onChange={(threats) => edit({ threats })}
        />
        <PointList
          title="How to win"
          hint="Your edges: trades, timings, wave states."
          tone="tip"
          points={draft.tips}
          onChange={(tips) => edit({ tips })}
        />
      </div>

      <div className="matchup-runes">
        <h2>Runes</h2>
        <RunePageEditor value={draft.runes} onChange={(runes) => edit({ runes })} games={games} />
      </div>
      <label className="matchup-section matchup-text">
        <h2>Notes</h2>
        <textarea
          value={draft.notes}
          maxLength={20000}
          rows={5}
          placeholder="Anything else: jungle pathing, what went wrong last time, VOD timestamps"
          onChange={(e) => edit({ notes: e.target.value })}
        />
      </label>

      <div className="matchup-editor-footer">
        {note.revision > 0 ? (
          <button
            type="button"
            className="text-link danger-link"
            onClick={() => setConfirm('delete')}
            disabled={saving}
          >
            <Trash2 size={14} /> Delete notes
          </button>
        ) : (
          <span />
        )}
        <div className="matchup-editor-actions">
          <span className="muted" role="status">
            {dirty ? 'Unsaved changes' : ''}
          </span>
          <button
            type="button"
            className="button secondary"
            onClick={() => (dirty ? setConfirm('discard') : onClose())}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="button" disabled={saving}>
            {saving ? (
              <>
                <LoaderCircle size={14} className="spin" /> Saving…
              </>
            ) : (
              <>
                <Check size={14} /> Save
              </>
            )}
          </button>
        </div>
      </div>

      {confirm === 'discard' && (
        <Dialog title="Discard your changes?" onClose={() => setConfirm(null)}>
          <p className="dialog-intro">The notes go back to how they were before you edited them.</p>
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={() => setConfirm(null)}>
              Keep editing
            </button>
            <button type="button" className="button danger" onClick={onClose}>
              Discard changes
            </button>
          </div>
        </Dialog>
      )}
      {confirm === 'delete' && (
        <Dialog title="Delete these notes?" onClose={() => !saving && setConfirm(null)}>
          <p className="dialog-intro">Everything written for this matchup will be removed.</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfirm(null)}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button danger"
              onClick={() => void remove()}
              disabled={saving}
            >
              {saving ? 'Deleting…' : 'Delete notes'}
            </button>
          </div>
        </Dialog>
      )}
    </form>
  )
}

type Live = Extract<LiveGame, { inGame: true }> & { profileId: string }

// Checks every saved account for a game in progress: on opening the page, every
// minute while it's visible, and when you come back to the tab.
function useLiveGame(league: LeagueRepository, profiles: LeagueProfile[]) {
  const [game, setGame] = useState<Live | null>(null)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const ids = profiles.map((p) => p.id).join(',')
  const check = useCallback(async () => {
    if (!league.liveGame || !ids) return
    setChecking(true)
    const results = await Promise.allSettled(
      ids.split(',').map(async (id) => ({ id, game: await league.liveGame!(id) })),
    )
    if (!alive.current) return
    const found = results.flatMap((r) =>
      r.status === 'fulfilled' && r.value.game.inGame
        ? [{ ...r.value.game, profileId: r.value.id }]
        : [],
    )[0]
    const failed = results.find((r) => r.status === 'rejected')
    setGame(found ?? null)
    setError(
      !found && failed?.status === 'rejected'
        ? ((failed.reason as Error)?.message ?? 'Riot didn’t answer.')
        : '',
    )
    setChecking(false)
  }, [league, ids])
  useEffect(() => {
    alive.current = true
    void check()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check()
    }, 60000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])
  return { game, checking, error, check }
}

function LiveGameCard({
  game,
  games,
  notes,
  name,
  checking,
  onCheck,
}: {
  game: Live
  games: Game[]
  notes: MatchupNote[]
  name: (id: number) => string
  checking: boolean
  onCheck: () => Promise<void>
}) {
  const guess = useMemo(
    () => guessLaneOpponent(game.championId, game.enemies, games),
    [game, games],
  )
  const [picked, setPicked] = useState<number | null>(guess.opponentId)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])
  const noteFor = (id: number) =>
    notes.find((n) => n.championId === game.championId && n.opponentId === id && hasContent(n))
  const chosen = picked ?? guess.opponentId
  const note = chosen ? noteFor(chosen) : undefined
  const minutes = game.gameStartTime
    ? Math.max(0, Math.floor((now - game.gameStartTime) / 60000))
    : null
  return (
    <section className="league-card live-card" aria-label="Live game">
      <div className="live-head">
        <span className="live-dot" aria-hidden />
        <strong>In game</strong>
        <span className="muted">
          {queues[game.queueId] || 'Custom game'} ·{' '}
          {minutes === null ? 'loading in' : `${minutes} min`}
        </span>
        <button
          className="icon-button"
          onClick={() => void onCheck()}
          disabled={checking}
          aria-label="Check again"
          title="Check again"
        >
          <RefreshCw size={14} className={checking ? 'spin' : ''} />
        </button>
      </div>
      <div className="live-you">
        <Champion id={game.championId} name={name(game.championId)} size={44} />
        <span>
          <span>
            You’re playing <strong>{name(game.championId)}</strong>
          </span>
          <small className="muted">
            {guess.opponentId
              ? 'Your likely lane opponent is picked. Choose another if it’s wrong.'
              : 'Who are you laning against?'}
          </small>
        </span>
      </div>
      <div className="live-enemies" role="radiogroup" aria-label="Lane opponent">
        {game.enemies.map((e) => (
          <button
            key={e.championId}
            role="radio"
            aria-checked={chosen === e.championId}
            className={`live-enemy ${chosen === e.championId ? 'selected' : ''}`}
            onClick={() => setPicked(e.championId)}
          >
            <Champion id={e.championId} name={name(e.championId)} size={40} />
            <span>{name(e.championId)}</span>
            {guess.opponentId === e.championId && <small>Likely</small>}
            {noteFor(e.championId) && <i className="live-noted" title="You have notes" />}
          </button>
        ))}
      </div>
      {note?.plan && (
        <p className="live-plan">
          <span>Game plan</span>
          {note.plan}
        </p>
      )}
      {chosen && (
        <a className="button live-open" href={matchupPath(game.championId, chosen)}>
          {note ? 'Read your notes' : 'Open matchup'}: {name(game.championId)} vs {name(chosen)}
          <ArrowRight size={14} />
        </a>
      )}
    </section>
  )
}
