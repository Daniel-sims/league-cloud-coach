import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RefreshCw, Check } from 'lucide-react'
import { Dialog } from './Dialog'
import { Champion } from './LeagueParts'
import type { LeagueRepository } from '../lib/league-repository'
import {
  duration,
  gamesFor,
  queues,
  remake,
  timeAgo,
  type Game,
  type LeagueProfile,
} from '../lib/league'

const shown = 20

export function AddGameDialog({
  repository,
  added,
  onAdd,
  onAddBlank,
  onClose,
}: {
  repository: LeagueRepository
  added: Set<string>
  onAdd: (game: Game, profileId: string) => void
  onAddBlank: () => void
  onClose: () => void
}) {
  const [profiles, setProfiles] = useState<LeagueProfile[] | null>(null)
  const [profileId, setProfileId] = useState('')
  const [games, setGames] = useState<Game[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    repository
      .profiles()
      .then((rows) => {
        if (!alive.current) return
        setProfiles(rows ?? [])
        setProfileId((old) => old || rows?.[0]?.id || '')
      })
      .catch((e: Error) => alive.current && setError(e.message))
  }, [repository])

  const profile = profiles?.find((p) => p.id === profileId)
  const load = useCallback(async () => {
    if (!profile) return
    const rows = await repository.matches(profile.id)
    if (alive.current) setGames(gamesFor(rows, profile.puuid).slice(0, shown))
  }, [repository, profile])
  useEffect(() => {
    setGames(null)
    load().catch((e: Error) => alive.current && setError(e.message))
  }, [load])

  const refresh = async () => {
    if (!profile || refreshing) return
    setRefreshing(true)
    setError('')
    try {
      await repository.refreshProfile(profile.id)
      await repository.sync(profile.id, 0)
      await load()
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      if (alive.current) setRefreshing(false)
    }
  }

  return (
    <Dialog title="Add a game" onClose={onClose} wide>
      <div className="pick-toolbar">
        {profiles && profiles.length > 1 ? (
          <select
            value={profileId}
            aria-label="Account"
            onChange={(e) => setProfileId(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.gameName}#{p.tagLine}
              </option>
            ))}
          </select>
        ) : (
          <span className="pick-account">
            {profile ? `${profile.gameName}#${profile.tagLine}` : ''}
          </span>
        )}
        <button
          className="button secondary button-small"
          onClick={() => void refresh()}
          disabled={!profile || refreshing}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          {refreshing ? 'Refreshing…' : 'Refresh games'}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}
      {profiles && profiles.length === 0 ? (
        <p className="blocks-empty">
          Connect a League account on Home first, then your games will appear here.
        </p>
      ) : !games ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Loading your games…
        </div>
      ) : games.length === 0 ? (
        <p className="blocks-empty">No games synced yet. Try Refresh games.</p>
      ) : (
        <ul className="pick-list">
          {games.map((g) => {
            const done = added.has(g.id)
            const outcome = remake(g) ? 'Remake' : g.player.win ? 'Victory' : 'Defeat'
            return (
              <li key={g.id}>
                <button
                  className={`pick-row ${remake(g) ? 'remake' : g.player.win ? 'win' : 'loss'}`}
                  disabled={done}
                  onClick={() => onAdd(g, profileId)}
                >
                  <Champion id={g.player.championId} name={g.player.championName} size={36} />
                  <span className="pick-main">
                    <strong>
                      {g.player.championName}
                      {g.opponent ? ` vs ${g.opponent.championName}` : ''}
                    </strong>
                    <small>
                      {outcome} · {queues[g.queueId] || `Queue ${g.queueId}`} ·{' '}
                      {duration(g.gameDuration)}
                    </small>
                  </span>
                  <span className="pick-kda">
                    {g.player.kills} / {g.player.deaths} / {g.player.assists}
                  </span>
                  <small className="pick-when">
                    {done ? (
                      <>
                        <Check size={13} /> Added
                      </>
                    ) : (
                      timeAgo(g.gameCreation)
                    )}
                  </small>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="dialog-actions pick-actions">
        <button className="text-link" onClick={onAddBlank}>
          Add without a match
        </button>
        <button className="button" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  )
}
