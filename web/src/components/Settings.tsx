import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import { Dialog } from './Dialog'
import { riotRequest } from '../lib/league-repository'
import { platforms } from '../lib/league'

export function Settings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [token, setToken] = useState('')
  const [platform, setPlatform] = useState('euw1')
  const [status, setStatus] = useState<{ configured: boolean; sharedDefault: boolean } | null>(null)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('')
  const [warning, setWarning] = useState(false)
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
        if (!busy) onClose()
      }}
    >
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
