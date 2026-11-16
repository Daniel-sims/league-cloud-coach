import { useEffect, useState } from 'react'
import { rpc } from '../lib/supabase'

type Device = { code: string; created_at: string; expires_at: string }
export function CompanionConnection({ hash }: { hash?: string }) {
  // null until the list has loaded, so the empty state never flashes.
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [approved, setApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function load() {
    try {
      setDevices(await rpc<Device[]>('list_companions'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load connected apps.')
    }
  }
  useEffect(() => {
    void load()
  }, [])
  async function approve() {
    setBusy(true)
    setError('')
    try {
      await rpc('connect_companion', { p_hash: hash })
      setApproved(true)
      sessionStorage.removeItem('league-cloud-coach-connect')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect League Helper.')
    } finally {
      setBusy(false)
    }
  }
  async function disconnect(code: string) {
    setBusy(true)
    setError('')
    try {
      await rpc('disconnect_companion', { p_hash: code })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not disconnect.')
    } finally {
      setBusy(false)
    }
  }
  const valid = hash && /^[a-f0-9]{64}$/.test(hash)
  return (
    <section className="blocks-page companion-connect">
      <div className="blocks-head">
        <div>
          <span className="eyebrow">LEAGUE HELPER</span>
          <h1>{hash ? 'Connect League Helper' : 'Connected apps'}</h1>
          <p className="blocks-lede">
            Apps on your computer that can upload recordings and prepared review timelines to your
            library. They can’t read or change anything else.
          </p>
        </div>
      </div>
      {hash && !valid ? (
        <p className="notice error" role="alert">
          Invalid connection link. Start Connect to web again in League Helper.
        </p>
      ) : null}
      {valid && !approved ? (
        <div className="companion-approve">
          <p>
            Approve the League Helper app on your Mac to upload recordings and prepared review
            timelines to this account. Access expires after 90 days and can be disconnected here at
            any time.
          </p>
          <p>
            Check that the code shown in League Helper matches:{' '}
            <strong>
              <code>{hash.slice(0, 8).toUpperCase()}</code>
            </strong>
          </p>
          <p>Approve only a connection you just started in your own app.</p>
          <button className="button" disabled={busy} onClick={() => void approve()}>
            Connect League Helper
          </button>
        </div>
      ) : null}
      {approved && (
        <p className="notice" role="status">
          Connected. Return to League Helper and choose Check connection, then Push to web.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <h2>Connected companions</h2>
      {devices === null ? (
        error ? null : (
          <p className="blocks-empty" role="status">
            Loading connected apps…
          </p>
        )
      ) : devices.length === 0 ? (
        <p className="blocks-empty">
          No connected companions. In League Helper, choose Connect to web to add one.
        </p>
      ) : (
        <ul className="companion-list">
          {devices.map((device) => (
            <li key={device.code}>
              <span>
                <strong>
                  League Helper · <code>{device.code.slice(0, 8).toUpperCase()}</code>
                </strong>
                <small>
                  Connected {formatDay(device.created_at)} · Expires {formatDay(device.expires_at)}
                </small>
              </span>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void disconnect(device.code)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

const formatDay = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(value),
  )
