import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { Dialog } from './Dialog'
import { leagueRepository, riotRequest } from '../lib/league-repository'
import { platforms, seasonOf, type LeagueProfile } from '../lib/league'
import type { Theme } from '../lib/theme'

export function Settings({
  onClose,
  onSaved,
  theme = 'light',
  onThemeChange,
}: {
  onClose: () => void
  onSaved: () => void
  theme?: Theme
  onThemeChange?: (theme: Theme) => void
}) {
  const [token, setToken] = useState('')
  const [platform, setPlatform] = useState('euw1')
  const [status, setStatus] = useState<{ configured: boolean; sharedDefault: boolean } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [warning, setWarning] = useState(false)
  const [profiles, setProfiles] = useState<LeagueProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [season, setSeason] = useState(0)
  const [seasons, setSeasons] = useState<number[]>([])
  const [seasonBusy, setSeasonBusy] = useState('')
  const [seasonError, setSeasonError] = useState('')
  const [seasonDone, setSeasonDone] = useState('')
  const stopSeason = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopSeason.current = true
    }
  }, [])
  useEffect(() => {
    let active = true
    leagueRepository
      .profiles()
      .then((rows) => {
        if (!active) return
        setProfiles(rows)
        setProfileId((old) => old || rows[0]?.id || '')
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!profileId) return
    let active = true
    leagueRepository
      .matches(profileId)
      .then((rows) => {
        if (!active) return
        const newest = Math.max(16, ...rows.map(seasonOf))
        const list = [newest, newest - 1, newest - 2]
        setSeasons(list)
        setSeason((old) => (list.includes(old) ? old : newest))
      })
      .catch(() => {
        if (!active) return
        setSeasons([16, 15, 14])
        setSeason((old) => old || 16)
      })
    return () => {
      active = false
    }
  }, [profileId])
  async function syncSeason() {
    const id = profileId
    if (!id || !season || seasonBusy) return
    stopSeason.current = false
    setSeasonError('')
    setSeasonDone('')
    let start = 0
    let count = 0
    try {
      for (;;) {
        if (stopSeason.current || !alive.current) {
          if (alive.current) setSeasonDone(`Stopped after checking ${count} games. Saved games are kept.`)
          break
        }
        setSeasonBusy(`Syncing season ${season}… ${count} games checked`)
        const page = await leagueRepository.sync(id, start)
        count = page.nextStart
        start = page.nextStart
        const rows = await leagueRepository.matches(id)
        const reached = rows.some((m) => {
          const s = seasonOf(m)
          return s > 0 && s < season
        })
        if (reached || !page.hasMore) {
          if (alive.current)
            setSeasonDone(
              `Season ${season} history is synced (${rows.filter((m) => seasonOf(m) === season).length} games saved).`,
            )
          break
        }
      }
      if (alive.current) onSaved()
    } catch (e) {
      if (alive.current) {
        setSeasonError(
          (e instanceof Error ? e.message : 'Sync failed.') + ' Saved games are kept; retry to continue.',
        )
        onSaved()
      }
    } finally {
      if (alive.current) setSeasonBusy('')
    }
  }
  useEffect(() => {
    let active = true
    riotRequest<{ configured: boolean; sharedDefault: boolean }>({ action: 'token-status' })
      .then((data) => {
        if (active) setStatus(data)
      })
      .catch(() => {
        if (active) setError('Could not load Riot settings. You can still enter a token below.')
      })
    return () => {
      active = false
    }
  }, [])
  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    setWarning(false)
    try {
      const result = await riotRequest<{ verified: boolean; warning?: string }>({
        action: 'save-token',
        token: token.trim(),
        platform,
      })
      setToken('')
      setStatus({ configured: true, sharedDefault: status?.sharedDefault ?? false })
      setWarning(Boolean(result.warning))
      setMessage(result.warning || 'Riot token saved and verified.')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your Riot token.')
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    setBusy(true)
    setError('')
    setMessage('')
    setWarning(false)
    try {
      await riotRequest({ action: 'remove-token' })
      setToken('')
      setStatus({ configured: false, sharedDefault: status?.sharedDefault ?? false })
      setMessage('Riot token removed. Your saved games are still available.')
      onSaved()
    } catch {
      setError('Could not remove your Riot token. Please retry.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Settings"
      onClose={() => {
        if (!busy && !seasonBusy) onClose()
      }}
    >
      {profiles.length > 0 && (
        <section className="season-sync-settings" aria-label="Match history">
          <h3>Match history</h3>
          <p className="dialog-intro">
            Download every game for a whole season from Riot. Games you already have are skipped, so
            this can be resumed at any time. A full season can take several minutes.
          </p>
          <div className="league-connect-form">
            {profiles.length > 1 && (
              <label>
                Account
                <select
                  aria-label="Account"
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  disabled={Boolean(seasonBusy)}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.gameName}#{p.tagLine}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Season
              <select
                aria-label="Season"
                value={season}
                onChange={(e) => setSeason(Number(e.target.value))}
                disabled={Boolean(seasonBusy)}
              >
                {seasons.map((s) => (
                  <option key={s} value={s}>
                    Season {s}
                  </option>
                ))}
              </select>
            </label>
            {seasonError && (
              <div className="notice error" role="alert">
                {seasonError}
              </div>
            )}
            {(seasonBusy || seasonDone) && (
              <div className="notice" role="status">
                {seasonBusy || seasonDone}
              </div>
            )}
            <div className="dialog-actions">
              {seasonBusy ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    stopSeason.current = true
                  }}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  onClick={() => void syncSeason()}
                  disabled={busy || !season}
                >
                  Sync full season
                </button>
              )}
            </div>
          </div>
        </section>
      )}
      <section className="appearance-settings" aria-label="Appearance">
        <h3>Appearance</h3>
        <label className="theme-setting">
          <span>
            Dark mode<small>{theme === 'dark' ? 'Dark appearance' : 'Light appearance'}</small>
          </span>
          <input
            className="theme-switch"
            aria-label="Dark mode"
            type="checkbox"
            role="switch"
            checked={theme === 'dark'}
            onChange={(event) => onThemeChange?.(event.target.checked ? 'dark' : 'light')}
          />
        </label>
      </section>
      <h3>Riot connection</h3>
      <p className="dialog-intro">
        Add your Riot API token to load your League account, match history and stats. Replace it
        here when it expires.
      </p>
      <p className="muted">
        {status
          ? status.configured
            ? 'A personal Riot token is saved.'
            : status.sharedDefault
              ? 'Using the workspace Riot connection.'
              : 'No Riot token saved yet.'
          : 'Checking your Riot connection…'}
      </p>
      <form onSubmit={save} className="league-connect-form">
        <label>
          Riot API token
          <input
            autoFocus
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="RGAPI-…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            required
            maxLength={120}
            disabled={busy}
          />
        </label>
        <label>
          Region
          <select
            aria-label="Region"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={busy}
          >
            {Object.entries(platforms).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Your token is stored encrypted for your account. It won’t be displayed again.
        </p>
        <a
          className="text-link"
          href="https://developer.riotgames.com/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get a token from Riot <ExternalLink size={13} />
        </a>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className={warning ? 'notice warning' : 'notice'} role="status">
            {message}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={busy}>
            Done
          </button>
          <button className="button" disabled={busy || !token.trim()}>
            {busy ? 'Working…' : 'Save token'}
          </button>
        </div>
        {status?.configured && (
          <button type="button" className="text-link" onClick={() => void remove()} disabled={busy}>
            Remove saved token
          </button>
        )}
      </form>
    </Dialog>
  )
}
