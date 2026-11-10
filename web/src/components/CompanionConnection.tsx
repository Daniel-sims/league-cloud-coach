import { useEffect, useState } from 'react'
import { rpc } from '../lib/supabase'

type Device = { code: string; created_at: string; expires_at: string }
export function CompanionConnection({ hash }: { hash?: string }) {
  const [devices, setDevices] = useState<Device[]>([])
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
    <section className="companion-connect">
      <h1>{hash ? 'Connect League Helper' : 'Connected apps'}</h1>
      {hash && !valid ? (
        <p>Invalid connection link. Start Connect to web again in League Helper.</p>
      ) : null}
      {valid && !approved ? (
        <>
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
        </>
      ) : null}
      {approved && (
        <p role="status">
          Connected. Return to League Helper and choose Check connection, then Push to web.
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <h2>Connected companions</h2>
      {devices.length === 0 ? (
        <p>No connected companions.</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.code}>
              <code>{device.code.slice(0, 8).toUpperCase()}</code> · Expires{' '}
              {new Date(device.expires_at).toLocaleDateString()}{' '}
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
      <p>
        <a href="#/library">Back to library</a>
      </p>
    </section>
  )
}
