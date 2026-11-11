import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Plus, Swords, UserRound } from 'lucide-react'
import { Dialog } from './Dialog'
import { ItemBuild, Loadout } from './Loadout'
import '../league.css'
import { leagueRepository, type LeagueRepository } from '../lib/league-repository'
import {
  championGroups,
  championIcon,
  cs,
  duration,
  emptyFilter,
  filterGames,
  gamesFor,
  groupGamesByDay,
  kda,
  number,
  percent,
  platforms,
  queues,
  remake,
  roleNames,
  roles,
  seasonOf,
  splitOf,
  summary,
  type Game,
  type HistoryFilter,
  type LeagueMatch,
  type LeagueProfile,
  type Participant,
  type Rank,
  timeAgo,
} from '../lib/league'

function Champion({ id, name, size = 36 }: { id: number; name: string; size?: number }) {
  return (
    <img
      className="champion-icon"
      src={championIcon(id)}
      alt={name}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  )
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="league-select">
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  )
}
function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="league-metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export function Home({
  ownerId,
  repository = leagueRepository,
}: {
  ownerId: string
  repository?: LeagueRepository
}) {
  const preferenceKey = `league-home:${ownerId}`
  function preferences() {
    try {
      return JSON.parse(localStorage.getItem(preferenceKey) || '{}')
    } catch {
      return {}
    }
  }
  const [profiles, setProfiles] = useState<LeagueProfile[]>([])
  const [selected, setSelected] = useState('')
  const [matches, setMatches] = useState<LeagueMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [connect, setConnect] = useState(false)
  const [filter, setFilter] = useState<HistoryFilter>(emptyFilter)
  const [windowCount, setWindowCount] = useState(() => {
    const saved = preferences().windowCount
    return [5, 10, 15, 20, 30, 40, 50].includes(saved) ? saved : 10
  })
  const [soloOnly, setSoloOnly] = useState(() => preferences().soloOnly === true)
  const [limit, setLimit] = useState(20)
  const [cursor, setCursor] = useState<Record<string, number>>({})
  const [exhausted, setExhausted] = useState<Record<string, boolean>>({})
  const mounted = useRef(true)
  const autoSynced = useRef(new Set<string>())
  const profile = profiles.find((p) => p.id === selected)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function loadProfiles(preferred?: string) {
    const rows = await repository.profiles()
    if (!mounted.current) return
    setProfiles(rows)
    let saved = ''
    try {
      saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}').profile || ''
    } catch {
      /* browser storage is optional */
    }
    setSelected(
      (old) =>
        [preferred, old, saved].find((id) => rows.some((p) => p.id === id)) || rows[0]?.id || '',
    )
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    loadProfiles()
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [ownerId, repository])
  useEffect(() => {
    if (!selected) return
    try {
      localStorage.setItem(
        preferenceKey,
        JSON.stringify({ profile: selected, windowCount, soloOnly }),
      )
    } catch {
      /* optional */
    }
  }, [selected, windowCount, soloOnly, preferenceKey])
  useEffect(() => {
    if (!selected) return
    let active = true
    setMatches([])
    setFilter(emptyFilter)
    setLimit(20)
    setHistoryLoading(true)
    repository
      .matches(selected)
      .then((rows) => {
        if (active) {
          setMatches(rows)
          if (!autoSynced.current.has(selected)) {
            autoSynced.current.add(selected)
            void sync()
          }
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setHistoryLoading(false)
      })
    return () => {
      active = false
    }
  }, [selected, repository])

  async function sync(older = false, count = Math.max(20, windowCount)) {
    if (!profile || busy) return
    const id = profile.id
    setError('')
    setBusy(older ? 'Loading older games…' : 'Refreshing profile…')
    try {
      if (!older) await repository.refreshProfile(id)
      let start = older ? Math.max(cursor[id] || 0, profile.historyCursor || 0) : 0
      let hasMore = true
      for (let n = 0; n < count && hasMore; n += 5) {
        if (!mounted.current) break
        setBusy(`Syncing games ${n + 1}–${n + 5}…`)
        const page = await repository.sync(id, start)
        start = page.nextStart
        hasMore = page.hasMore
        setCursor((old) => ({ ...old, [id]: Math.max(old[id] || 0, start) }))
        setExhausted((old) => ({ ...old, [id]: !hasMore }))
        const rows = await repository.matches(id)
        if (mounted.current) setMatches(rows)
      }
      if (mounted.current) {
        await loadProfiles(id)
        if (older) setLimit((old) => old + count)
      }
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Sync failed. Please retry.')
        // Completed pages survive a partial failure and appear immediately.
        try {
          setMatches(await repository.matches(id))
        } catch {
          /* retain last saved view */
        }
      }
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const games = profile ? gamesFor(matches, profile.puuid) : []
  const queued = soloOnly ? games.filter((g) => g.queueId === 420) : games
  const recent = queued.slice(0, windowCount)
  const stats = summary(recent)
  const champions = championGroups(recent).slice(0, 5)
  const effectiveFilter = soloOnly ? { ...filter, queue: '420' } : filter
  const filtered = filterGames(games, effectiveFilter)
  const record = summary(filterGames(games, effectiveFilter, false))
  const playedOptions = [
    ...new Map(games.map((g) => [g.player.championId, g.player.championName])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const opponentOptions = [
    ...new Map(
      games.flatMap((g) =>
        g.participants
          .filter((p) => p.teamId !== g.player.teamId)
          .map((p) => [p.championId, p.championName] as const),
      ),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]))
  const updateFilter = (key: keyof HistoryFilter, value: string | boolean) => {
    setFilter((old) => ({ ...old, [key]: value }))
    setLimit(20)
  }

  return (
    <div className="league-home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR NEXT GAME STARTS HERE</span>
          <h1>
            Home<span className="title-dot">.</span>
          </h1>
          <p className="muted">Your account, your champions, your progress.</p>
        </div>
        <button
          className="button secondary"
          onClick={() => setConnect(true)}
          disabled={Boolean(busy)}
        >
          <Plus size={16} />
          Add League account
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-link"
            disabled={Boolean(busy)}
            onClick={() => {
              setError('')
              if (profile) void sync()
              else {
                setLoading(true)
                loadProfiles()
                  .catch((e) => setError(e.message))
                  .finally(() => setLoading(false))
              }
            }}
          >
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <p role="status" className="muted">
          Opening your League accounts…
        </p>
      ) : !profiles.length ? (
        <div className="league-empty">
          <UserRound size={32} />
          <h2>Bring your games into focus</h2>
          <p>Add your Riot ID and region to see your match history, champions and stats.</p>
          <button className="button" onClick={() => setConnect(true)}>
            Choose your League account
          </button>
        </div>
      ) : (
        profile && (
          <>
            <section className="league-profile league-card" aria-label="League profile">
              <div className="league-identity">
                <span className="league-avatar">
                  <img
                    className="champion-icon"
                    width={64}
                    height={64}
                    alt="Profile icon"
                    src={`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profile.profileIconId}.jpg`}
                  />
                  <b>{profile.summonerLevel}</b>
                </span>
                <div>
                  <Select
                    label="League account"
                    value={selected}
                    onChange={(id) => {
                      if (!busy) {
                        setSelected(id)
                        setError('')
                      }
                    }}
                  >
                    <optgroup label={busy ? 'Sync in progress' : 'Saved accounts'}>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id} disabled={Boolean(busy)}>
                          {p.gameName}#{p.tagLine} · {platforms[p.platform]}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                  <span className="muted">
                    Level {profile.summonerLevel} · {platforms[profile.platform]}
                  </span>
                </div>
              </div>
              <div className="league-refresh">
                <button
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void sync()}
                >
                  <RefreshCw size={15} className={busy ? 'spin' : ''} />
                  {busy || 'Refresh match history'}
                </button>
                <small className="muted">
                  {profile.syncedAt
                    ? `Last synced ${new Date(profile.syncedAt).toLocaleString('en-GB')}`
                    : 'No games synced yet'}
                </small>
              </div>
            </section>
            <div className="league-layout">
              <div className="league-rail" role="group" aria-label="Ranks and champions">
                {profile.ranks.length ? (
                  [...profile.ranks]
                    .sort((a, b) =>
                      a.queueType === 'RANKED_SOLO_5x5'
                        ? -1
                        : b.queueType === 'RANKED_SOLO_5x5'
                          ? 1
                          : 0,
                    )
                    .map((rank) => <RankCard key={rank.queueType} rank={rank} />)
                ) : (
                  <div className="league-card league-rank-card">
                    <strong>Unranked</strong>
                    <small className="muted">No current ranked placement</small>
                  </div>
                )}
                {queued.length > 0 && (
                  <SeasonChampions
                    games={queued}
                    choose={(id) => updateFilter('champion', String(id))}
                  />
                )}
              </div>
              <div className="league-main">
                <div className="league-section-heading">
                  <h2>Recent games</h2>
                  <div className="league-controls">
                    <label className="league-check">
                      <input
                        type="checkbox"
                        checked={soloOnly}
                        onChange={(e) => setSoloOnly(e.target.checked)}
                      />
                      Ranked Solo/Duo only
                    </label>
                    <Select
                      label="Recent games window"
                      value={String(windowCount)}
                      onChange={(v) => setWindowCount(Number(v))}
                    >
                      {[5, 10, 15, 20, 30, 40, 50].map((n) => (
                        <option key={n} value={n}>
                          Last {n} games
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                {historyLoading ? (
                  <p role="status" className="muted">
                    Loading saved games…
                  </p>
                ) : recent.length ? (
                  <section
                    className="league-card league-summary"
                    aria-label="Recent game statistics"
                  >
                    <div className="league-summary-grid">
                      <div className="league-summary-record">
                        <WinDonut rate={stats.winRate} />
                        <div>
                          <strong>
                            {stats.wins}W {stats.losses}L
                          </strong>
                          <span className="muted">
                            {stats.games} games
                            {stats.remakes
                              ? ` · ${stats.remakes} remake${stats.remakes > 1 ? 's' : ''}`
                              : ''}
                          </span>
                        </div>
                      </div>
                      <div className="league-summary-kda">
                        <strong>{stats.games ? kda(stats) : '—'}</strong>
                        <span>
                          {number(stats.averageKills)} / <b>{number(stats.averageDeaths)}</b> /{' '}
                          {number(stats.averageAssists)}
                        </span>
                        <small className="muted">KDA</small>
                      </div>
                      <div className="league-metrics">
                        <Metric
                          label="Kill participation"
                          value={percent(stats.killParticipation)}
                        />
                        <Metric label="CS / min" value={number(stats.csPerMinute)} />
                        <Metric label="Damage share" value={percent(stats.damageShare)} />
                        <small className="muted">
                          {stats.primaryRole
                            ? `${roleNames[stats.primaryRole]} games only`
                            : 'All roles'}
                        </small>
                      </div>
                      <div className="league-summary-roles">
                        <span className="eyebrow">ROLES</span>
                        {stats.roles.map(({ role, games }) => {
                          const s = summary(games)
                          return (
                            <div className="league-role-row" key={role}>
                              <strong>{roleNames[role]}</strong>
                              <span className="league-role-bar">
                                <i
                                  style={{ width: `${(games.length / (stats.games || 1)) * 100}%` }}
                                />
                              </span>
                              <span>
                                {games.length}G · {percent(s.winRate)}
                              </span>
                            </div>
                          )
                        })}
                        {!stats.roles.length && <span className="muted">No assigned roles</span>}
                      </div>
                    </div>
                    <div className="league-form" aria-label="Recent results, newest first">
                      {recent.map((g) => (
                        <span
                          key={g.id}
                          className={`league-result ${remake(g) ? 'remake' : g.player.win ? 'win' : 'loss'}`}
                          title={`${g.player.championName}: ${remake(g) ? 'Remake' : g.player.win ? 'Victory' : 'Defeat'}`}
                        >
                          {remake(g) ? 'R' : g.player.win ? 'W' : 'L'}
                        </span>
                      ))}
                      {stats.streak && (
                        <small>
                          {stats.streak.count} {stats.streak.win ? 'win' : 'loss'} streak
                        </small>
                      )}
                    </div>
                    {recent.length < windowCount && (
                      <p className="league-coverage muted">
                        Showing {recent.length} of up to {windowCount} games from synced history.{' '}
                        <button
                          className="text-link"
                          disabled={Boolean(busy)}
                          onClick={() => void sync(true, windowCount)}
                        >
                          Sync more history
                        </button>
                      </p>
                    )}
                  </section>
                ) : (
                  <div className="league-card league-empty">
                    <Swords size={26} />
                    <h3>
                      {games.length
                        ? 'No games in this queue yet'
                        : 'Your match history is ready to sync'}
                    </h3>
                    <p>
                      Refresh to fetch your recent games from Riot. Saved games stay available
                      between visits.
                    </p>
                    <button className="button" disabled={Boolean(busy)} onClick={() => void sync()}>
                      {busy || 'Sync recent games'}
                    </button>
                  </div>
                )}
                <div className="league-section-heading">
                  <h2>Match history</h2>
                  <span className="muted">{games.length} synced games</span>
                </div>
                <section className="league-card league-history" aria-label="Match history">
                  <div className="league-filters">
                    <Select
                      label="Your champion"
                      value={filter.champion}
                      onChange={(v) => updateFilter('champion', v)}
                    >
                      <option value="">All champions</option>
                      {playedOptions.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="Lane opponent"
                      value={filter.opponent}
                      onChange={(v) => updateFilter('opponent', v)}
                    >
                      <option value="">Any opponent</option>
                      {opponentOptions.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </Select>
                    <Select
                      label="Lane"
                      value={filter.role}
                      onChange={(v) => updateFilter('role', v)}
                    >
                      <option value="">All lanes</option>
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {roleNames[role]}
                        </option>
                      ))}
                    </Select>
                    {!soloOnly && (
                      <Select
                        label="Queue"
                        value={filter.queue}
                        onChange={(v) => updateFilter('queue', v)}
                      >
                        <option value="">All queues</option>
                        {[...new Set(games.map((g) => g.queueId))].sort().map((id) => (
                          <option key={id} value={id}>
                            {queues[id] || `Queue ${id}`}
                          </option>
                        ))}
                      </Select>
                    )}
                    <Select
                      label="Patch"
                      value={filter.patch}
                      onChange={(v) => updateFilter('patch', v)}
                    >
                      <option value="">All patches</option>
                      {[
                        ...new Set(
                          games.map((g) => g.gameVersion.split('.').slice(0, 2).join('.')),
                        ),
                      ]
                        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
                        .map((p) => (
                          <option key={p}>{p}</option>
                        ))}
                    </Select>
                    <Select
                      label="Result"
                      value={filter.result}
                      onChange={(v) => updateFilter('result', v)}
                    >
                      <option value="">All results</option>
                      <option value="win">Wins</option>
                      <option value="loss">Losses</option>
                    </Select>
                    <Select
                      label="Sort"
                      value={filter.oldest ? 'oldest' : 'newest'}
                      onChange={(v) => updateFilter('oldest', v === 'oldest')}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </Select>
                    <button
                      className="text-link"
                      onClick={() => {
                        setFilter(emptyFilter)
                        setLimit(20)
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                  <div className="league-history-record">
                    <strong>
                      {percent(record.winRate)} win rate · {record.wins}W – {record.losses}L
                      {record.remakes ? ` · ${record.remakes} remakes` : ''}
                    </strong>
                    <span className="muted">
                      Across {record.games + record.remakes} matching synced games · Result filter
                      only changes the list
                    </span>
                  </div>
                  {groupGamesByDay(filtered.slice(0, limit)).map((day) => (
                    <section
                      className="league-match-day"
                      key={`${selected}:${day.key}`}
                      aria-label={day.label}
                    >
                      <div className="league-day-heading">
                        <h3>
                          <time dateTime={day.key}>{day.label}</time>
                        </h3>
                        <span>
                          {day.games.length} {day.games.length === 1 ? 'game' : 'games'}
                        </span>
                      </div>
                      {day.games.map((game) => (
                        <MatchRow key={game.id} game={game} />
                      ))}
                    </section>
                  ))}
                  {!filtered.length && (
                    <div className="league-empty">
                      <p>
                        {games.length
                          ? 'No games match these filters. Clear them or sync more history.'
                          : 'Sync your first games to see your full match history here.'}
                      </p>
                    </div>
                  )}
                  <div className="league-history-footer">
                    {filtered.length > limit && (
                      <button
                        className="button secondary"
                        onClick={() => setLimit((old) => old + 20)}
                      >
                        Show more saved games
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={Boolean(busy) || exhausted[selected]}
                      onClick={() => void sync(true, 20)}
                    >
                      {busy ||
                        (exhausted[selected]
                          ? 'All available Riot history synced'
                          : 'Sync older games')}
                    </button>
                    <small className="muted">
                      History and season totals cover synced games. Riot may no longer provide older
                      games.
                    </small>
                  </div>
                </section>
              </div>
            </div>
          </>
        )
      )}
      {connect && (
        <ConnectAccount
          repository={repository}
          onClose={() => setConnect(false)}
          onSaved={async (id) => {
            await loadProfiles(id)
            setConnect(false)
            setError('')
          }}
        />
      )}
    </div>
  )
}

function ConnectAccount({
  repository,
  onClose,
  onSaved,
}: {
  repository: LeagueRepository
  onClose: () => void
  onSaved: (id: string) => Promise<void>
}) {
  const [riotId, setRiotId] = useState(''),
    [platform, setPlatform] = useState('euw1'),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await repository.connect(riotId, platform)
      await onSaved(result.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect this account.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title="Choose your League account"
      onClose={() => {
        if (!saving) onClose()
      }}
    >
      <p className="dialog-intro">
        Use the Riot ID shown in your League profile. You can save multiple accounts and switch
        between them.
      </p>
      <form onSubmit={submit} className="league-connect-form">
        <label>
          Riot ID
          <input
            autoFocus
            required
            maxLength={65}
            placeholder="Name#TAG"
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            disabled={saving}
          />
        </label>
        <Select label="Region" value={platform} onChange={setPlatform}>
          {Object.entries(platforms).map(([id, name]) => (
            <option value={id} key={id}>
              {name}
            </option>
          ))}
        </Select>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="button" disabled={saving}>
          {saving ? 'Finding your account…' : 'Add account'}
        </button>
      </form>
    </Dialog>
  )
}

function SeasonChampions({ games, choose }: { games: Game[]; choose: (id: number) => void }) {
  const seasons = [...new Set(games.map((g) => seasonOf(g)))].sort((a, b) => b - a)
  const [year, setYear] = useState(''),
    [split, setSplit] = useState('')
  const selectedYear = seasons.includes(Number(year)) ? Number(year) : seasons[0]
  // Use the native patch boundaries, including games with no known split.
  const splits = [
    ...new Set(
      games
        .filter((g) => seasonOf(g) === selectedYear)
        .flatMap((g) => (splitOf(g) === null ? [] : [splitOf(g)!])),
    ),
  ].sort()
  const selectedSplit =
    split === 'all'
      ? null
      : splits.includes(Number(split))
        ? Number(split)
        : (splits.at(-1) ?? null)
  const list = championGroups(
    games.filter(
      (g) =>
        seasonOf(g) === selectedYear && (selectedSplit === null || splitOf(g) === selectedSplit),
    ),
  )
  return (
    <section className="league-card league-rail-champions">
      <div className="league-rail-heading">
        <h2>Champions</h2>
        <div className="league-controls">
          <Select
            label="Season"
            value={String(selectedYear)}
            onChange={(v) => {
              setYear(v)
              setSplit('')
            }}
          >
            {seasons.map((y) => (
              <option key={y} value={y}>
                Season {y}
              </option>
            ))}
          </Select>
          <Select
            label="Split"
            value={selectedSplit === null ? 'all' : String(selectedSplit)}
            onChange={setSplit}
          >
            <option value="all">Whole season</option>
            {splits.map((s) => (
              <option key={s} value={s}>
                Split {s}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <ul className="league-champion-list">
        {list.map((c) => (
          <li key={c.id}>
            <button className="league-champion-row" onClick={() => choose(c.id)}>
              <Champion id={c.id} name={c.name} size={36} />
              <span className="league-champion-name">
                <strong>{c.name}</strong>
                <small>
                  {number(c.summary.csPerMinute)} CS/min · {c.summary.games}{' '}
                  {c.summary.games === 1 ? 'game' : 'games'}
                </small>
              </span>
              <span className="league-champion-kda">
                <strong>{kda(c.summary)}</strong>
                <small>KDA</small>
              </span>
              <span
                className={`league-champion-wr ${(c.summary.winRate ?? 0) >= 0.5 ? 'good' : 'bad'}`}
              >
                <strong>{percent(c.summary.winRate)}</strong>
                <small>
                  {c.summary.wins}W {c.summary.losses}L
                </small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <small className="muted">Synced games · remakes excluded</small>
    </section>
  )
}

function RankCard({ rank }: { rank: Rank }) {
  const solo = rank.queueType === 'RANKED_SOLO_5x5'
  const games = rank.wins + rank.losses
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rank.tier)
  const tier = rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase()
  return (
    <section
      className="league-card league-rank-card"
      aria-label={solo ? 'Solo/Duo rank' : 'Flex rank'}
    >
      <span className="eyebrow">{solo ? 'RANKED SOLO/DUO' : 'RANKED FLEX'}</span>
      <div className="league-rank-body">
        <img
          src={`https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-mini-crests/${rank.tier.toLowerCase()}.png`}
          alt=""
          width={64}
          height={64}
          onError={(e) => {
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
        <div>
          <strong>
            {tier}
            {apex ? '' : ` ${rank.rank}`}
          </strong>
          <span className="league-rank-lp">{rank.leaguePoints} LP</span>
        </div>
        <div className="league-rank-record">
          <span>
            {rank.wins}W {rank.losses}L
          </span>
          <b>{percent(games ? rank.wins / games : null)} win rate</b>
        </div>
      </div>
    </section>
  )
}

function WinDonut({ rate }: { rate: number | null }) {
  const radius = 30
  const length = 2 * Math.PI * radius
  return (
    <svg
      className="league-donut"
      viewBox="0 0 80 80"
      role="img"
      aria-label={`Win rate ${percent(rate)}`}
    >
      <circle cx="40" cy="40" r={radius} className="loss" />
      <circle
        cx="40"
        cy="40"
        r={radius}
        className="win"
        strokeDasharray={`${(rate ?? 0) * length} ${length}`}
        transform="rotate(-90 40 40)"
      />
      <text x="40" y="45" textAnchor="middle">
        {percent(rate)}
      </text>
    </svg>
  )
}

function MatchRow({ game: g }: { game: Game }) {
  const [open, setOpen] = useState(false)
  const p = g.player,
    teamKills = g.allies.reduce((n, p) => n + p.kills, 0)
  const outcome = remake(g) ? 'Remake' : p.win ? 'Victory' : 'Defeat'
  return (
    <article className={`league-match ${remake(g) ? 'remake' : p.win ? 'win' : 'loss'}`}>
      <button
        className="league-match-toggle"
        aria-expanded={open}
        aria-controls={`score-${g.id}`}
        onClick={() => setOpen(!open)}
      >
        <div className="league-match-result">
          <strong>{outcome}</strong>
          <span>{queues[g.queueId] || `Queue ${g.queueId}`}</span>
          <small>
            <time dateTime={new Date(g.gameCreation).toISOString()}>{timeAgo(g.gameCreation)}</time>{' '}
            · {duration(g.gameDuration)}
          </small>
        </div>
        <div className="league-match-champion">
          <span className="league-portrait">
            <Champion id={p.championId} name={p.championName} size={52} />
            <b>{p.champLevel}</b>
          </span>
          <Loadout player={p} />
          <span className="league-match-name">
            <strong>{p.championName}</strong>
            <small>{roleNames[p.teamPosition] || 'No lane'}</small>
          </span>
        </div>
        <div className="league-match-kda">
          <strong>
            {p.kills} / <b>{p.deaths}</b> / {p.assists}
          </strong>
          <small>{kda(p)} KDA</small>
          <small>
            {percent(teamKills ? (p.kills + p.assists) / teamKills : null)} KP ·{' '}
            {number(cs(p) / Math.max(g.gameDuration / 60, 1))} CS/m
          </small>
        </div>
        <ItemBuild player={p} version={g.gameVersion} size={26} />
        {g.opponent ? (
          <div className="league-opponent">
            <span className="muted">vs</span>
            <Champion id={g.opponent.championId} name={g.opponent.championName} size={32} />
            <small>{g.opponent.championName}</small>
          </div>
        ) : (
          <span />
        )}
        <span className="league-score-toggle">
          {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <span className="sr-only">Scoreboard for {g.id}</span>
        </span>
      </button>
      {open && (
        <div className="league-scoreboard" id={`score-${g.id}`}>
          <div className="league-game-meta">
            {g.id} · Patch {g.gameVersion.split('.').slice(0, 2).join('.')} ·{' '}
            {new Date(g.gameCreation).toLocaleString('en-GB')}
          </div>
          {[...new Set([p.teamId, ...g.participants.map((p) => p.teamId)])].map((team) => (
            <Scoreboard
              key={team}
              players={g.participants.filter((p) => p.teamId === team)}
              game={g}
            />
          ))}
        </div>
      )}
    </article>
  )
}

function Scoreboard({ players, game }: { players: Participant[]; game: Game }) {
  const team = players[0].teamId
  const teamKills = players.reduce((n, p) => n + p.kills, 0)
  const maxDamage = Math.max(1, ...game.participants.map((p) => p.totalDamageDealtToChampions))
  return (
    <div className={`league-team ${players[0].win ? 'win' : 'loss'}`}>
      <div className="league-team-heading">
        <strong>
          {players[0].win ? 'Victory' : 'Defeat'} ·{' '}
          {team === 100 ? 'Blue team' : team === 200 ? 'Red team' : `Team ${team}`}
        </strong>
        <span>
          {teamKills} kills · {number(players.reduce((n, p) => n + p.goldEarned, 0) / 1000)}k gold
        </span>
      </div>
      <div className="league-table-wrap">
        <table className="league-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>KDA</th>
              <th>Damage</th>
              <th>Wards</th>
              <th>CS</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr
                key={p.puuid}
                className={p.puuid === game.player.puuid ? 'league-focused-player' : ''}
              >
                <td>
                  <div className="league-player">
                    <span className="league-portrait">
                      <Champion id={p.championId} name={p.championName} size={36} />
                      <b>{p.champLevel}</b>
                    </span>
                    <Loadout player={p} />
                    <span>
                      <strong>
                        {p.riotIdGameName || p.summonerName || p.championName}
                        {p.riotIdTagline ? `#${p.riotIdTagline}` : ''}
                      </strong>
                      <small>
                        {p.championName} · {roleNames[p.teamPosition] || '—'}
                      </small>
                    </span>
                  </div>
                </td>
                <td>
                  <strong>
                    {p.kills} / <b>{p.deaths}</b> / {p.assists}
                  </strong>
                  <small>
                    {kda(p)} · {percent(teamKills ? (p.kills + p.assists) / teamKills : null)} KP
                  </small>
                </td>
                <td>
                  <div className="league-damage">
                    <span title={`${number(p.totalDamageTaken, 0)} damage taken`}>
                      {number(p.totalDamageDealtToChampions, 0)}
                    </span>
                    <i>
                      <b
                        style={{ width: `${(p.totalDamageDealtToChampions / maxDamage) * 100}%` }}
                      />
                    </i>
                  </div>
                </td>
                <td>
                  {p.wardsPlaced} / {p.wardsKilled}
                  <small>
                    {p.visionWardsBoughtInGame} control · {p.visionScore} vision
                  </small>
                </td>
                <td>
                  {cs(p)}
                  <small>{number(cs(p) / Math.max(game.gameDuration / 60, 1))}/m</small>
                </td>
                <td>
                  <ItemBuild player={p} version={game.gameVersion} size={22} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
