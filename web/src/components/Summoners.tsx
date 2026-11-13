import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, RefreshCw, Search, UserRound } from 'lucide-react'
import '../league.css'
import { MatchRow, RankCard, RecentSummary, SeasonChampions } from './LeagueParts'
import { leagueRepository, type LeagueRepository } from '../lib/league-repository'
import { listViewed, loadViewed, maxViewedGames, saveViewed } from '../lib/viewed-cache'
import {
  groupGamesByDay,
  gamesFor,
  platforms,
  type LeagueMatch,
  type LeagueProfile,
  type Participant,
} from '../lib/league'

const profileIcon = (id: number) =>
  `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`
const profileHash = (platform: string, puuid: string) => `/summoners/${platform}/${puuid}`
const firstPage = 20

// Lookup page: find anyone by Riot ID. Nothing here is saved to your account; the
// browser keeps the last few players so reopening one is instant.
export function SummonerSearch({
  ownerId,
  repository = leagueRepository,
}: {
  ownerId: string
  repository?: LeagueRepository
}) {
  const [riotId, setRiotId] = useState('')
  const [platform, setPlatform] = useState('euw1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recent, setRecent] = useState(() => listViewed(ownerId))
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { puuid, profile } = await repository.findPlayer(platform, riotId)
      const cached = loadViewed(ownerId, platform, puuid)
      saveViewed(ownerId, platform, puuid, {
        profile: {
          ...profile,
          id: 'viewing',
          platform,
          puuid,
          syncedAt: null,
        },
        matches: cached?.matches ?? [],
      })
      window.location.hash = profileHash(platform, puuid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not find this player. Please retry.')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => setRecent(listViewed(ownerId)), [ownerId])
  return (
    <div className="league-home">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LOOK ANYONE UP</span>
          <h1>
            Summoners<span className="title-dot">.</span>
          </h1>
          <p className="muted">Search a Riot ID, or open a player from any of your games.</p>
        </div>
      </div>
      <form className="league-card league-summoner-search" onSubmit={submit}>
        <label>
          Riot ID
          <input
            autoFocus
            required
            maxLength={65}
            placeholder="Name#TAG"
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="league-select">
          <span>Region</span>
          <select
            aria-label="Region"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={busy}
          >
            {Object.entries(platforms).map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={busy}>
          <Search size={16} />
          {busy ? 'Searching…' : 'Look up'}
        </button>
      </form>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <h2 className="league-section-heading">Recent</h2>
      {recent.length ? (
        <ul className="league-recent-players" aria-label="Recent summoners">
          {recent.map(({ platform, puuid, profile }) => (
            <li key={`${platform}:${puuid}`}>
              <a
                className="league-card league-recent-player"
                href={`#${profileHash(platform, puuid)}`}
              >
                <img
                  className="champion-icon"
                  width={40}
                  height={40}
                  alt=""
                  hidden={!profile.profileIconId}
                  src={profileIcon(profile.profileIconId)}
                />
                <span>
                  <strong>
                    {profile.gameName}#{profile.tagLine}
                  </strong>
                  <small className="muted">
                    Level {profile.summonerLevel} · {platforms[platform]}
                  </small>
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="league-card league-empty">
          <UserRound size={26} />
          <h3>No one looked up yet</h3>
          <p>
            Search a Riot ID above, or click a player in a scoreboard on Home. Nothing about them is
            saved to your account.
          </p>
        </div>
      )}
    </div>
  )
}

export function SummonerProfile({
  ownerId,
  platform,
  puuid,
  repository = leagueRepository,
}: {
  ownerId: string
  platform: string
  puuid: string
  repository?: LeagueRepository
}) {
  const cached = loadViewed(ownerId, platform, puuid)
  const [profile, setProfile] = useState<LeagueProfile>(
    cached?.profile ?? {
      id: 'viewing',
      platform,
      puuid,
      gameName: '',
      tagLine: '',
      profileIconId: 0,
      summonerLevel: 0,
      ranks: [],
      syncedAt: null,
    },
  )
  const [matches, setMatches] = useState<LeagueMatch[]>(cached?.matches ?? [])
  const [mine, setMine] = useState<LeagueProfile[]>([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [limit, setLimit] = useState(firstPage)
  const [exhausted, setExhausted] = useState(false)
  const data = useRef({ matches: cached?.matches ?? [], cursor: 0, profile })
  const token = useRef(0)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      token.current++
    }
  }, [])
  useEffect(() => {
    repository
      .profiles()
      .then((rows) => mounted.current && setMine(rows))
      .catch(() => {
        /* only used to recognise your own accounts */
      })
  }, [repository])

  async function loadGames(run: number, current: LeagueProfile, older: boolean, count: number) {
    let start = older ? data.current.cursor : 0
    let hasMore = true
    for (let n = 0; n < count && hasMore; n += 5) {
      if (token.current !== run) return
      setBusy(`Loading games ${n + 1}–${n + 5}…`)
      const page = await repository.viewMatches(
        platform,
        puuid,
        start,
        data.current.matches.map((m) => m.id).slice(0, 60),
      )
      if (token.current !== run) return
      start = page.nextStart
      hasMore = page.hasMore
      const byId = new Map(data.current.matches.map((m) => [m.id, m]))
      for (const m of page.matches) byId.set(m.id, m)
      const merged = [...byId.values()]
        .sort((a, b) => b.gameCreation - a.gameCreation)
        .slice(0, maxViewedGames)
      data.current = {
        ...data.current,
        matches: merged,
        cursor: Math.max(data.current.cursor, start),
      }
      setMatches(merged)
      setExhausted(!hasMore || merged.length >= maxViewedGames)
      saveViewed(ownerId, platform, puuid, { profile: current, matches: merged })
    }
  }
  async function load(older: boolean, count: number) {
    const run = ++token.current
    setError('')
    setBusy(older ? 'Loading older games…' : 'Opening player…')
    try {
      let current = data.current.profile
      if (!older) {
        const { profile: fresh } = await repository.viewPlayer(platform, puuid)
        if (token.current !== run) return
        current = { ...current, ...fresh, syncedAt: new Date().toISOString() }
        data.current.profile = current
        setProfile(current)
      }
      await loadGames(run, current, older, count)
      if (older && token.current === run) setLimit((old) => old + count)
    } catch (e) {
      if (token.current === run)
        setError(e instanceof Error ? e.message : 'Could not open this player. Please retry.')
    } finally {
      if (token.current === run) setBusy('')
    }
  }
  useEffect(() => {
    void load(false, firstPage)
  }, [ownerId, platform, puuid])

  function openPlayer(player: Participant) {
    const own = mine.find((p) => p.puuid === player.puuid && p.platform === platform)
    window.location.hash = own ? '/home' : profileHash(platform, player.puuid)
  }
  const ownAccount = mine.find((p) => p.puuid === puuid && p.platform === platform)
  const games = gamesFor(matches, puuid)
  const recent = games.slice(0, 20)
  const named = profile.gameName ? `${profile.gameName}#${profile.tagLine}` : 'Player'
  return (
    <div className="league-home">
      <a className="text-link" href="#/summoners">
        <ArrowLeft size={14} /> Summoners
      </a>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUMMONER</span>
          <h1>
            {named}
            <span className="title-dot">.</span>
          </h1>
          <p className="muted">Nothing about this player is saved to your account.</p>
        </div>
      </div>
      {ownAccount && (
        <div className="league-viewing" role="status">
          <span>This is one of your accounts.</span>
          <span className="league-viewing-actions">
            <a className="button secondary" href="#/home">
              Open Home
            </a>
          </span>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-link"
            disabled={Boolean(busy)}
            onClick={() => void load(false, firstPage)}
          >
            Try again
          </button>
        </div>
      )}
      <section className="league-profile league-card" aria-label="League profile">
        <div className="league-identity">
          <span className="league-avatar">
            <img
              className="champion-icon"
              width={64}
              height={64}
              hidden={!profile.profileIconId}
              alt="Profile icon"
              src={profileIcon(profile.profileIconId)}
            />
            <b>{profile.summonerLevel}</b>
          </span>
          <div>
            <span className="muted">
              Level {profile.summonerLevel} · {platforms[platform]}
            </span>
          </div>
        </div>
        <div className="league-refresh">
          <button
            className="button secondary"
            disabled={Boolean(busy)}
            onClick={() => void load(false, firstPage)}
          >
            <RefreshCw size={15} className={busy ? 'spin' : ''} />
            {busy || 'Refresh'}
          </button>
        </div>
      </section>
      <div className="league-layout">
        <div className="league-rail" role="group" aria-label="Ranks and champions">
          {profile.ranks.length ? (
            [...profile.ranks]
              .sort((a, b) =>
                a.queueType === 'RANKED_SOLO_5x5' ? -1 : b.queueType === 'RANKED_SOLO_5x5' ? 1 : 0,
              )
              .map((rank) => <RankCard key={rank.queueType} rank={rank} />)
          ) : (
            <div className="league-card league-rank-card">
              <strong>Unranked</strong>
              <small className="muted">No current ranked placement</small>
            </div>
          )}
          {games.length > 0 && <SeasonChampions games={games} choose={() => {}} />}
        </div>
        <div className="league-main">
          {recent.length > 0 && <RecentSummary recent={recent} />}
          <div className="league-section-heading">
            <h2>Match history</h2>
            <span className="muted">{games.length} loaded games</span>
          </div>
          <section className="league-card league-history" aria-label="Match history">
            {groupGamesByDay(games.slice(0, limit)).map((day) => (
              <section className="league-match-day" key={day.key} aria-label={day.label}>
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
                    busy={false}
                    loadRanks={repository.matchRanks}
                  />
                ))}
              </section>
            ))}
            {!games.length && (
              <div className="league-empty">
                <p>{busy ? 'Loading games…' : 'No games found for this player.'}</p>
              </div>
            )}
            <div className="league-history-footer">
              {games.length > limit && (
                <button className="button secondary" onClick={() => setLimit((old) => old + 20)}>
                  Show more loaded games
                </button>
              )}
              <button
                className="button secondary"
                disabled={Boolean(busy) || exhausted}
                onClick={() => void load(true, 20)}
              >
                {busy || (exhausted ? 'All available history loaded' : 'Load older games')}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
