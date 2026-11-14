import { useEffect, useRef, useState, type FormEvent } from 'react'
import { RefreshCw, Plus, Swords, UserRound, SlidersHorizontal } from 'lucide-react'
import { Dialog } from './Dialog'
import { MatchRow, RankCard, RecentSummary, SeasonChampions, Select } from './LeagueParts'
import '../league.css'
import { leagueRepository, type LeagueRepository } from '../lib/league-repository'
import {
  championGroups,
  emptyFilter,
  filterGames,
  gamesFor,
  groupGamesByDay,
  platforms,
  queues,
  roleNames,
  roles,
  summary,
  type HistoryFilter,
  type LeagueMatch,
  type LeagueProfile,
  type Participant,
} from '../lib/league'

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
  const [recordings, setRecordings] = useState<Record<string, string>>({})
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
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [queueTab, setQueueTab] = useState<'RANKED_SOLO_5x5' | 'RANKED_FLEX_SR'>('RANKED_SOLO_5x5')
  const [cursor, setCursor] = useState<Record<string, number>>({})
  const [exhausted, setExhausted] = useState<Record<string, boolean>>({})
  const mounted = useRef(true)
  const ownProfile = profiles.find((p) => p.id === selected)
  const profile = ownProfile
  const shownRank = profile?.ranks.find((r) => r.queueType === queueTab)
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

  // Games the companion uploaded video for, paired by match id.
  useEffect(() => {
    let active = true
    repository
      .matchRecordings?.()
      .then((map) => active && setRecordings(map ?? {}))
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [repository, selected])

  // Another player: Summoners owns lookups, so hand off to their profile page.
  function openPlayer(player: Participant) {
    if (!profile) return
    const own = profiles.find((p) => p.puuid === player.puuid && p.platform === profile.platform)
    if (own) {
      setSelected(own.id)
      setError('')
      return
    }
    window.location.hash = `/summoners/${profile.platform}/${player.puuid}`
  }

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
  const activeFilters = (Object.keys(emptyFilter) as (keyof HistoryFilter)[]).filter(
    (key) => filter[key] !== emptyFilter[key],
  ).length
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

  const recentControls = (
    <div className="league-controls">
      <label className="league-check">
        <input type="checkbox" checked={soloOnly} onChange={(e) => setSoloOnly(e.target.checked)} />
        Ranked Solo/Duo only
      </label>
      <Select
        compact
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
  )

  return (
    <div className="league-home">
      <h1 className="sr-only">Home.</h1>
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
            <div className="league-layout">
              <div className="league-rail" role="group" aria-label="Ranks and champions">
                <section className="league-card league-account" aria-label="Current account">
                  <div className="league-account-head">
                    <span className="eyebrow">CURRENT ACCOUNT</span>
                    <button
                      className="button button-small league-update"
                      disabled={Boolean(busy)}
                      aria-label={busy || 'Refresh match history'}
                      title={
                        busy ||
                        (profile.syncedAt
                          ? `Last synced ${new Date(profile.syncedAt).toLocaleString('en-GB')}`
                          : 'No games synced yet')
                      }
                      onClick={() => void sync()}
                    >
                      <RefreshCw size={13} className={busy ? 'spin' : ''} />
                      {busy ? 'Updating' : 'Update'}
                    </button>
                  </div>
                  <div className="league-identity">
                    <span className="league-avatar">
                      <img
                        className="champion-icon"
                        width={56}
                        height={56}
                        hidden={!profile.profileIconId}
                        alt="Profile icon"
                        src={`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profile.profileIconId}.jpg`}
                      />
                      <b>{profile.summonerLevel}</b>
                    </span>
                    <div className="league-account-picker">
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
                        <optgroup label={busy ? 'Sync in progress' : 'Your accounts'}>
                          {profiles.map((p) => (
                            <option key={p.id} value={p.id} disabled={Boolean(busy)}>
                              {p.gameName}#{p.tagLine} · {platforms[p.platform]}
                            </option>
                          ))}
                        </optgroup>
                      </Select>
                      <button
                        className="button secondary button-small league-add"
                        onClick={() => setConnect(true)}
                        disabled={Boolean(busy)}
                        aria-label="Add another account"
                        title="Add another account"
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="league-queue-tabs" role="tablist" aria-label="Ranked queue">
                    {(
                      [
                        ['RANKED_SOLO_5x5', 'Solo/Duo'],
                        ['RANKED_FLEX_SR', 'Flex'],
                      ] as const
                    ).map(([q, label]) => (
                      <button
                        key={q}
                        role="tab"
                        aria-selected={queueTab === q}
                        className={queueTab === q ? 'active' : ''}
                        onClick={() => setQueueTab(q)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {shownRank ? (
                    <RankCard rank={shownRank} embedded />
                  ) : (
                    <div className="league-rank-card embedded">
                      <strong>Unranked</strong>
                      <small className="muted">No current placement in this queue</small>
                    </div>
                  )}
                </section>
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
                </div>
                {historyLoading ? (
                  <p role="status" className="muted">
                    Loading saved games…
                  </p>
                ) : recent.length ? (
                  <RecentSummary
                    recent={recent}
                    controls={recentControls}
                    footer={
                      recent.length < windowCount && (
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
                      )
                    }
                  />
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
                    {games.length > 0 && recentControls}
                  </div>
                )}
                <div className="league-section-heading">
                  <h2>Match history</h2>
                  <div className="league-heading-actions">
                    <span className="muted">{games.length} synced games</span>
                    <button
                      className={`icon-button league-filter-toggle ${filtersOpen ? 'active' : ''}`}
                      onClick={() => setFiltersOpen((open) => !open)}
                      aria-expanded={filtersOpen}
                      aria-controls="history-filters"
                      aria-label="Filters"
                      title="Filters"
                    >
                      <SlidersHorizontal size={18} />
                      {activeFilters > 0 && (
                        <span className="filter-badge" aria-label={`${activeFilters} active`}>
                          {activeFilters}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
                <section className="league-card league-history" aria-label="Match history">
                  {filtersOpen && (
                    <div className="league-filters" id="history-filters">
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
                  )}
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
                        <MatchRow
                          key={game.id}
                          game={game}
                          onOpenPlayer={openPlayer}
                          busy={Boolean(busy)}
                          loadRanks={repository.matchRanks}
                          recordingId={recordings[game.id]}
                        />
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
                      disabled={Boolean(busy) || exhausted[profile.id]}
                      onClick={() => void sync(true, 20)}
                    >
                      {busy ||
                        (exhausted[profile.id]
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
