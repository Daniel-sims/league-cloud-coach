import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Copy,
  ExternalLink,
  Film,
  FileVideo,
  House,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Unlink,
  X,
} from 'lucide-react'
import { Dialog } from './components/Dialog'
import { Player } from './components/Player'
import { RecordingThumbnail } from './components/RecordingThumbnail'
import { StreamPlayer } from './components/StreamPlayer'
import { UploadDialog } from './components/UploadDialog'
import { Home } from './components/Home'
import { Settings } from './components/Settings'
import { CompanionConnection } from './components/CompanionConnection'
import { VideoReview } from './components/VideoReview'
import { ownerReview, sharedReview } from './lib/review'
import { leagueRepository } from './lib/league-repository'
import { useTheme } from './lib/theme'
import { appURL, cloudRepository, configured, resolveShare, rpc, supabase } from './lib/supabase'
import { localRepository } from './lib/local'
import { parseYouTubeId, youtubeURL } from './lib/youtube'
import type { LibraryRepository, Recording, WatchVideo, UploadSync } from './lib/types'

const isDev = import.meta.env.DEV
function useRoute() {
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/home')
  useEffect(() => {
    const update = () => setRoute(window.location.hash.slice(1) || '/home')
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <a
      href="#/home"
      className={`brand ${small ? 'brand-small' : ''}`}
      aria-label="League Cloud Coach home"
    >
      <span className="brand-symbol">
        <span>L</span>
        <i />
      </span>
      <span>
        League Cloud
        <span className="brand-second">
          Coach<span className="brand-dot">.</span>
        </span>
      </span>
    </a>
  )
}
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.04.97-3.38.97-2.61 0-4.83-1.77-5.62-4.15H3.04v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.38 13.9A6 6 0 0 1 6.05 12c0-.66.12-1.3.33-1.9V7.51H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.49l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.96 5.51l3.34 2.59A5.93 5.93 0 0 1 12 5.95Z"
      />
    </svg>
  )
}
function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="notice error" role="alert">
      {message}
    </div>
  )
}
function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(`${value.slice(0, 10)}T12:00:00`),
      )
    : 'Date not added'
}

export function App({ authError = null }: { authError?: string | null }) {
  const [theme, setTheme] = useTheme()
  const route = useRoute()
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(Boolean(supabase))
  const [member, setMember] = useState(false)
  const [accessLoading, setAccessLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState(authError || '')
  const [signingIn, setSigningIn] = useState(false)
  const [help, setHelp] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('league-cloud-coach-sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem('league-cloud-coach-sidebar', next ? 'collapsed' : 'open')
    } catch {
      // Layout preference only.
    }
  }
  const [setup, setSetup] = useState(false)
  const [settings, setSettings] = useState(false)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const local = isDev && route.startsWith('/preview')
  const home = route === '/home'

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return
        if (error) setAuthMessage('Could not restore your session. Please sign in again.')
        setSession(data.session)
        setAuthLoading(false)
      })
      .catch(() => {
        if (active) {
          setAuthMessage('Could not connect to sign-in. Please try again.')
          setAuthLoading(false)
        }
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthLoading(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  useEffect(() => {
    setMember(false)
    if (!session) {
      setAccessLoading(false)
      return
    }
    let active = true
    setAccessLoading(true)
    rpc<boolean>('is_library_owner')
      .then((enabled) => {
        if (active) setMember(enabled)
      })
      .catch((error: Error) => {
        if (active) setAuthMessage(error.message)
      })
      .finally(() => {
        if (active) setAccessLoading(false)
      })
    return () => {
      active = false
    }
  }, [session?.user.id])

  async function signIn() {
    if (!supabase) {
      setSetup(true)
      return
    }
    setSigningIn(true)
    setAuthMessage('')
    try {
      if (/^\/connect\/[a-f0-9]{64}$/.test(route))
        sessionStorage.setItem('league-cloud-coach-connect', route)
      const redirect = new URL(import.meta.env.BASE_URL, window.location.origin).href
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirect },
      })
      if (error) throw error
    } catch {
      setAuthMessage('Google sign-in could not start. Check your connection and try again.')
      setSigningIn(false)
    }
  }
  async function signOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      const { error } = await supabase!.auth.signOut()
      if (error) throw error
      setConfirmSignOut(false)
      setMember(false)
      window.location.hash = '/home'
    } catch {
      setSignOutError('Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }
  const watchToken = route.startsWith('/watch/') ? route.slice('/watch/'.length) : null
  if (watchToken !== null) return <Watch key={watchToken} token={watchToken} />

  const userName =
    session?.user.user_metadata?.full_name || session?.user.email?.split('@')[0] || 'Your account'
  const ownVideoId = route.match(/^\/(?:preview\/)?video\/([a-f0-9-]+)$/)?.[1]
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar" id="app-sidebar">
        <Brand />
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <a className={`nav-item ${home ? 'active' : ''}`} href="#/home">
            <House size={18} />
            Home
            {home && <ChevronRight size={14} className="nav-chevron" />}
          </a>
          <a
            className={`nav-item ${!home ? 'active' : ''}`}
            href={local ? '#/preview' : '#/library'}
          >
            <FileVideo size={18} />
            Video library
            <ChevronRight size={14} className="nav-chevron" />
          </a>
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={18} />
            How it works
          </button>
        </nav>
        {session && member && (
          <nav className="sidebar-settings" aria-label="Settings navigation">
            {member && (
              <a className="nav-item" href="#/connect">
                <Link2 size={18} />
                Connected apps
              </a>
            )}
            <button className="nav-item" onClick={() => setSettings(true)}>
              <Settings2 size={18} />
              Settings
            </button>
          </nav>
        )}
        <div className="sidebar-bottom">
          <span className="status-dot" />
          {local ? 'Local preview' : 'League Cloud Coach'}
          <span className="version">V.01</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button sidebar-toggle"
            onClick={toggleSidebar}
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
            title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <div className="breadcrumb">
            <Cloud size={16} />
            <span>Workspace</span>
            <span className="crumb-slash">/</span>
            <strong>
              {home ? 'Home' : route.startsWith('/connect') ? 'Connected apps' : 'Video library'}
            </strong>
          </div>
          <div className="topbar-actions">
            {local ? (
              <>
                <span className="preview-label">LOCAL PREVIEW</span>
                <a className="text-link" href="#/library">
                  Exit preview <X size={14} />
                </a>
              </>
            ) : session ? (
              <>
                <span className="account-avatar">{String(userName).slice(0, 1).toUpperCase()}</span>
                <span className="account-name">{userName}</span>
                <button
                  className="button button-small secondary"
                  onClick={() => {
                    setSignOutError('')
                    setConfirmSignOut(true)
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <button className="button button-small" onClick={signIn} disabled={signingIn}>
                <GoogleIcon />
                {signingIn ? 'Connecting…' : 'Sign in'}
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </header>
        <main className={`main-content ${ownVideoId ? 'wide' : ''}`}>
          {authMessage && <ErrorNotice message={authMessage} />}
          {local && (
            <div className="notice preview-notice">
              <Settings2 size={16} />
              <span>
                <strong>Local preview.</strong> Videos stay in this browser. Google accounts and
                shared watch pages need the cloud connection.
              </span>
            </div>
          )}
          {authLoading || accessLoading ? (
            <div className="loading-state" role="status">
              <LoaderCircle className="spin" />
              Opening your workspace…
            </div>
          ) : local || (session && member) ? (
            route.startsWith('/connect') ? (
              <CompanionConnection
                key={route}
                hash={route.startsWith('/connect/') ? route.slice(9) : undefined}
              />
            ) : ownVideoId ? (
              <OwnVideo
                key={ownVideoId}
                id={ownVideoId}
                repository={local ? localRepository : cloudRepository}
                local={local}
              />
            ) : home && session ? (
              <Home key={`${session.user.id}:${settingsVersion}`} ownerId={session.user.id} />
            ) : (
              <Library
                key={local ? 'local' : session!.user.id}
                ownerId={session?.user.id}
                repository={local ? localRepository : cloudRepository}
                local={local}
              />
            )
          ) : session ? (
            <div className="access-state">
              <ShieldCheck size={34} />
              <span className="eyebrow">PERSONAL WORKSPACE</span>
              <h1>You’re signed in.</h1>
              <p>
                This library is currently open to its owner only. Your account hasn’t been given
                access yet.
              </p>
              <button
                className="button secondary"
                onClick={() => {
                  setSignOutError('')
                  setConfirmSignOut(true)
                }}
              >
                Use a different Google account
              </button>
            </div>
          ) : (
            <Welcome onSignIn={signIn} signingIn={signingIn} />
          )}
        </main>
        <footer className="main-footer">
          <span>LEAGUE CLOUD COACH</span>
          <span>A little reflection. A better next game.</span>
        </footer>
      </div>
      {settings && session && member && (
        <Settings
          key={session.user.id}
          theme={theme}
          onThemeChange={setTheme}
          onClose={() => setSettings(false)}
          onSaved={() => setSettingsVersion((old) => old + 1)}
        />
      )}
      {confirmSignOut && (
        <Dialog
          title="Sign out?"
          onClose={() => {
            if (!signingOut) setConfirmSignOut(false)
          }}
        >
          <p className="dialog-intro">You’ll need to sign in again to open your workspace.</p>
          {signOutError && <ErrorNotice message={signOutError} />}
          <div className="dialog-actions">
            <button
              className="button secondary"
              onClick={() => setConfirmSignOut(false)}
              disabled={signingOut}
            >
              Cancel
            </button>
            <button className="button" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title="From your game to your coach" onClose={() => setHelp(false)}>
          <p className="dialog-intro">Three simple steps. Your coach doesn’t need an account.</p>
          <ol className="steps">
            <li>
              <span>01</span>
              <div>
                <h3>Upload or add a recording</h3>
                <p>
                  Choose Upload video to select a file from your computer. It will appear in your
                  library when processing finishes. Already have a video on Cloudflare Stream or
                  YouTube? Choose Add existing video instead. YouTube videos should be Unlisted with
                  embedding allowed.
                </p>
                <a
                  className="text-link"
                  href="https://studio.youtube.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open YouTube Studio <ExternalLink size={13} />
                </a>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Create a watch link</h3>
                <p>
                  Choose Share beside a recording, then Create share link. Copy the link to send to
                  your coach.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Send it to your coach</h3>
                <p>
                  Your coach opens the link without signing in. For a private recording, they choose
                  Start session when ready to watch; the two-hour timer includes pauses.
                </p>
              </div>
            </li>
          </ol>
          <div className="notice">
            Stream links allow one two-hour browser session. YouTube links remain unlisted sharing:
            anyone with the YouTube link can watch. To stop YouTube access, make it Private or
            delete it in YouTube Studio.
          </div>
        </Dialog>
      )}
      {setup && (
        <Dialog title="Sign-in unavailable" onClose={() => setSetup(false)}>
          <p className="dialog-intro">
            Sign-in is temporarily unavailable. Please try again later.
          </p>
          {isDev && (
            <>
              <p className="muted">
                For local development, follow the cloud setup instructions in{' '}
                <code>web/README.md</code>.
              </p>
              <a className="button" href="#/preview" onClick={() => setSetup(false)}>
                Open local preview <ArrowRight size={16} />
              </a>
            </>
          )}
        </Dialog>
      )}
    </div>
  )
}

function Welcome({ onSignIn, signingIn }: { onSignIn(): void; signingIn: boolean }) {
  return (
    <>
      <section className="welcome-hero">
        <div className="eyebrow">
          <span className="tiny-rule" /> ROOM TO IMPROVE
        </div>
        <h1>
          Your games.
          <br />
          <span>A clearer perspective.</span>
        </h1>
        <p>
          Your recordings, ready for a second pair of eyes.
          <br className="desktop-break" /> Bring your coach into the game.
        </p>
        <div className="hero-actions">
          <button className="button" onClick={onSignIn} disabled={signingIn}>
            <GoogleIcon />
            {signingIn ? 'Connecting…' : 'Continue with Google'}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="hero-assurance">
          <ShieldCheck size={14} />
          Your library stays yours. You choose what to share.
        </div>
      </section>
      <section className="welcome-overview" aria-label="How sharing works">
        <div className="overview-heading">
          <span className="eyebrow">A SIMPLE WAY TO SHARE</span>
          <span>Less setup. More perspective.</span>
        </div>
        <div className="overview-grid">
          <Feature
            number="01"
            icon={<Film size={20} />}
            title="Keep your games together"
            text="Upload a recording directly to Cloudflare, or add an existing video link."
          />
          <Feature
            number="02"
            icon={<Link2 size={20} />}
            title="One link. Another perspective."
            text="Give your coach a watch page they can open without an account."
          />
          <Feature
            number="03"
            icon={<Play size={20} />}
            title="Review with your coach"
            text="Watch the recording together and discuss what to try next game."
          />
        </div>
      </section>
      {isDev && !configured && (
        <div className="local-preview-entry">
          <span>Building your workspace? Try the interface before connecting an account.</span>
          <a className="text-link" href="#/preview">
            Open local preview <ArrowRight size={14} />
          </a>
        </div>
      )}
    </>
  )
}
function Feature({
  number,
  icon,
  title,
  text,
}: {
  number: string
  icon: React.ReactNode
  title: string
  text: string
}) {
  return (
    <article className="feature">
      <div className="feature-top">
        <span className="feature-icon">{icon}</span>
        <span>{number}</span>
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
    </article>
  )
}

function Library({
  repository,
  local,
  ownerId,
}: {
  repository: LibraryRepository
  local: boolean
  ownerId?: string
}) {
  const [records, setRecords] = useState<Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'all' | 'shared'>('all')
  const [oldest, setOldest] = useState(false)
  const [modal, setModal] = useState<'add' | 'upload' | null>(null)
  const [selected, setSelected] = useState<{
    record: Recording
    action: 'share' | 'rename' | 'remove'
  } | null>(null)
  const [notice, setNotice] = useState('')
  const [uploads, setUploads] = useState<UploadSync['pending']>([])
  const [uploadError, setUploadError] = useState('')
  async function refresh() {
    if (repository.syncUploads) {
      try {
        const result = await repository.syncUploads()
        setUploads(result?.pending || [])
        if (result?.imported > 0) {
          setTab('all')
          setQuery('')
          setNotice('Your completed upload has been added to the library.')
        }
        setUploadError('')
      } catch {
        setUploadError('Could not refresh uploads. Your saved library is still available.')
      }
    }
    const next = await repository.list()
    setRecords(next)
  }
  useEffect(() => {
    let active = true
    async function open() {
      try {
        if (repository.syncUploads) {
          try {
            const result = await repository.syncUploads()
            if (active) {
              setUploads(result?.pending || [])
              if (result?.imported > 0) {
                setTab('all')
                setQuery('')
                setNotice('Your completed upload has been added to the library.')
              }
            }
          } catch {
            if (active)
              setUploadError('Could not refresh uploads. Your saved library is still available.')
          }
        }
        const next = await repository.list()
        if (active) setRecords(next)
      } catch (e) {
        if (active) setError((e as Error).message)
      } finally {
        if (active) setLoading(false)
      }
    }
    void open()
    return () => {
      active = false
    }
  }, [repository])
  useEffect(() => {
    if (!uploads.some((upload) => upload.state !== 'error')) return
    const timer = window.setInterval(() => {
      void refresh().catch((e: Error) => setError(e.message))
    }, 15000)
    return () => window.clearInterval(timer)
  }, [repository, uploads.length, uploads.some((upload) => upload.state !== 'error')])
  async function changed(message: string) {
    setModal(null)
    setSelected(null)
    setNotice(message)
    try {
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const shared = records.filter((r) => r.has_share).length
  const filtered = records
    .filter(
      (r) => (tab === 'all' || r.has_share) && r.title.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      oldest ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at),
    )
  return (
    <>
      <section className="library-heading">
        <div>
          <div className="eyebrow">YOUR PERSONAL WORKSPACE</div>
          <h1>
            Video library<span className="heading-dot">.</span>
          </h1>
          <p>Upload recordings and share them with your coach.</p>
        </div>
        <div className="library-heading-actions">
          <button className="button secondary" onClick={() => setModal('add')}>
            <Plus size={17} />
            Add existing video
          </button>
          {!local && (
            <button className="button" onClick={() => setModal('upload')}>
              <Plus size={17} />
              Upload video
            </button>
          )}
        </div>
      </section>
      {(uploadError || uploads.length > 0) && (
        <div className="notice" role="status">
          <div>
            {uploadError ||
              uploads.map((upload) => (
                <p key={upload.videoId}>
                  <strong>{upload.title}</strong>:{' '}
                  {upload.state === 'processing'
                    ? 'Processing your video. It will appear here automatically.'
                    : upload.state === 'uploading'
                      ? 'Upload awaiting completion. Open Upload video to resume.'
                      : upload.message || 'Upload needs attention.'}
                </p>
              ))}
          </div>
          <button
            className="text-link"
            onClick={() => {
              void refresh().catch((e: Error) => setError(e.message))
            }}
          >
            Refresh uploads
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          <button
            className="text-link"
            onClick={async () => {
              setError('')
              setLoading(true)
              try {
                await refresh()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setLoading(false)
              }
            }}
          >
            Try again
          </button>
        </div>
      )}
      {notice && (
        <div className="notice success" role="status">
          <CheckCircle2 size={16} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="library-controls">
        <div className="tabs" role="tablist" aria-label="Filter recordings">
          <button
            role="tab"
            aria-selected={tab === 'all'}
            className={tab === 'all' ? 'selected' : ''}
            onClick={() => setTab('all')}
          >
            All recordings <span>{records.length}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === 'shared'}
            className={tab === 'shared' ? 'selected' : ''}
            onClick={() => setTab('shared')}
          >
            Shared <span>{shared}</span>
          </button>
        </div>
        <div className="filter-actions">
          <label className="search-field">
            <Search size={15} />
            <input
              type="search"
              aria-label="Search videos"
              placeholder="Search your games…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="sort-button" onClick={() => setOldest(!oldest)}>
            <ArrowDownUp size={14} />
            {oldest ? 'Oldest first' : 'Newest first'}
            <ChevronDown size={12} />
          </button>
        </div>
      </div>
      {loading ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" size={20} />
          Loading your games…
        </div>
      ) : filtered.length ? (
        <div className="recording-list">
          {filtered.map((record) => (
            <RecordingRow
              key={record.id}
              record={record}
              local={local}
              onAction={(action) => setSelected({ record, action })}
            />
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <div className="empty-art">
            <div className="empty-art-back" />
            <div className="empty-art-front">
              <Film size={31} strokeWidth={1.3} />
              <span className="empty-play">
                <Play size={12} fill="currentColor" />
              </span>
            </div>
            <span className="empty-spark">+</span>
          </div>
          <span className="eyebrow">
            {query
              ? 'NO MATCHES'
              : tab === 'shared'
                ? 'READY WHEN YOU ARE'
                : 'EVERY GAME IS A CHANCE TO LEARN'}
          </span>
          <h2>
            {query
              ? 'No games found'
              : tab === 'shared'
                ? 'A perspective worth sharing'
                : 'Your next review starts here'}
          </h2>
          <p>
            {query
              ? 'Try another title, or clear your search to see all your games.'
              : tab === 'shared'
                ? 'Create a share link for a recording and it will appear here.'
                : 'Add your first recording. Keep it here for yourself, or share a link with your coach.'}
          </p>
          {query || tab === 'shared' ? (
            <button
              className="button secondary"
              onClick={() => {
                setQuery('')
                setTab('all')
              }}
            >
              Show all recordings
            </button>
          ) : (
            <button className="button" onClick={() => setModal(local ? 'add' : 'upload')}>
              <Plus size={16} />
              {local ? 'Add your first video' : 'Upload your first video'}
            </button>
          )}
          <span className="empty-footnote">
            <ShieldCheck size={13} />
            {local ? 'Stored in this browser only' : 'Only you can manage your library'}
          </span>
        </section>
      )}
      <div className="library-bottom">
        <span>
          {records.length} {records.length === 1 ? 'recording' : 'recordings'} in your library
        </span>
        <span>
          <span className="status-dot" />
          Cloudflare Stream and YouTube
        </span>
      </div>
      {modal === 'upload' && ownerId && (
        <UploadDialog
          ownerId={ownerId}
          onClose={() => {
            setModal(null)
            void refresh().catch((e: Error) => setError(e.message))
          }}
          onSaved={async () => {
            setTab('all')
            setQuery('')
            setNotice('Video uploaded and added to your library.')
            try {
              await refresh()
            } catch (e) {
              setError((e as Error).message)
            }
          }}
        />
      )}
      {modal === 'add' && (
        <AddDialog
          local={local}
          repository={repository}
          onClose={() => setModal(null)}
          onSaved={() => changed('Video added to your library.')}
        />
      )}
      {selected?.action === 'share' && (
        <ShareDialog
          record={selected.record}
          repository={repository}
          local={local}
          onClose={() => {
            setSelected(null)
            refresh().catch((e: Error) => setError(e.message))
          }}
        />
      )}
      {selected?.action === 'rename' && (
        <RenameDialog
          record={selected.record}
          repository={repository}
          onClose={() => setSelected(null)}
          onSaved={() => changed('Title updated.')}
        />
      )}
      {selected?.action === 'remove' && (
        <RemoveDialog
          record={selected.record}
          repository={repository}
          onClose={() => setSelected(null)}
          onRemoved={() =>
            changed('Video removed from your library. The hosted original has been kept.')
          }
        />
      )}
    </>
  )
}

function RecordingRow({
  record,
  local,
  onAction,
}: {
  record: Recording
  local: boolean
  onAction(action: 'share' | 'rename' | 'remove'): void
}) {
  return (
    <article className="recording-row">
      <a
        className="recording-thumbnail"
        href={`#/${local ? 'preview/' : ''}video/${record.id}`}
        aria-label={`Watch ${record.title}`}
      >
        <RecordingThumbnail record={record} />
        <span className="thumbnail-play">
          <Play size={17} fill="currentColor" />
        </span>
      </a>
      <div className="recording-details">
        <a className="recording-title" href={`#/${local ? 'preview/' : ''}video/${record.id}`}>
          {record.title}
        </a>
        <div className="recording-meta">
          <span>{formatDate(record.recorded_on)}</span>
          <span className="meta-dot">·</span>
          <span>{record.provider === 'stream' ? 'Cloudflare Stream' : 'YouTube'}</span>
        </div>
      </div>
      {record.has_share && (
        <span className="share-status is-shared">
          <Link2 size={12} />
          Shared
        </span>
      )}
      <button
        className="button secondary button-small share-row-button"
        onClick={() => onAction('share')}
      >
        <Link2 size={14} />
        Share
      </button>
      <details className="row-menu">
        <summary className="icon-button" aria-label={`More actions for ${record.title}`}>
          <MoreHorizontal size={19} />
        </summary>
        <div className="row-menu-content">
          <button
            onClick={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open')
              onAction('rename')
            }}
          >
            Rename
          </button>
          {record.provider !== 'stream' && (
            <a
              href={youtubeURL(record.youtube_video_id ?? '')}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open on YouTube <ExternalLink size={12} />
            </a>
          )}
          <button
            className="danger-text"
            onClick={(e) => {
              e.currentTarget.closest('details')?.removeAttribute('open')
              onAction('remove')
            }}
          >
            Remove from library
          </button>
        </div>
      </details>
    </article>
  )
}

function AddDialog({
  local,
  repository,
  onClose,
  onSaved,
}: {
  repository: LibraryRepository
  onClose(): void
  onSaved(): void
  local: boolean
}) {
  const [provider, setProvider] = useState<'youtube' | 'stream'>('youtube')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const id =
    provider === 'stream'
      ? /^[a-f0-9]{32}$/.test(url.trim())
        ? url.trim()
        : null
      : parseYouTubeId(url)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!id) {
      setError(
        provider === 'stream'
          ? 'Enter the 32-character Stream video ID from Cloudflare.'
          : 'Paste a valid YouTube video link, such as youtube.com/watch?v=… or youtu.be/…',
      )
      return
    }
    if (!title.trim()) {
      setError('Give your game a title.')
      return
    }
    setSaving(true)
    try {
      await repository.add({
        title: title.trim(),
        youtube_video_id: provider === 'youtube' ? id : null,
        ...(provider === 'stream' ? { provider, stream_video_id: id } : {}),
        recorded_on: date || null,
      })
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title="Add a game to your library"
      onClose={() => {
        if (!saving) onClose()
      }}
      wide
    >
      <p className="dialog-intro">
        Add an existing video from Cloudflare Stream or YouTube. To choose a file from your
        computer, use Upload video in your library.
      </p>
      {!local && (
        <label className="form-label">
          Video hosting
          <select
            aria-label="Video hosting"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as 'youtube' | 'stream')
              setUrl('')
              setPreview(false)
              setError('')
            }}
          >
            <option value="youtube">YouTube</option>
            <option value="stream">Cloudflare Stream</option>
          </select>
        </label>
      )}
      {provider === 'stream' ? (
        <div className="notice">
          Upload in Cloudflare Stream, wait for processing, and enable Require signed URLs. Paste
          its video ID below.
        </div>
      ) : (
        <div className="add-instructions">
          <span className="feature-icon">
            <Film size={19} />
          </span>
          <p>
            Upload your recording as <strong>Unlisted</strong> and allow embedding.
            <a href="https://studio.youtube.com" target="_blank" rel="noopener noreferrer">
              Open YouTube Studio <ExternalLink size={12} />
            </a>
          </p>
        </div>
      )}
      <form onSubmit={submit}>
        <label className="form-label" htmlFor="video-url">
          {provider === 'stream' ? 'Stream video ID' : 'YouTube link'}
        </label>
        <div className="url-input">
          <Link2 size={17} />
          <input
            id="video-url"
            required
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setPreview(false)
            }}
            placeholder={
              provider === 'stream' ? '32-character video ID' : 'https://www.youtube.com/watch?v=…'
            }
            autoComplete="off"
          />
        </div>
        {url && !id && (
          <p className="field-hint danger-text">
            {provider === 'stream'
              ? 'Enter the 32-character video ID.'
              : 'Enter a YouTube video link, rather than a channel or playlist.'}
          </p>
        )}
        {id && (
          <div className="validated-link">
            <CheckCircle2 size={13} />
            {provider === 'stream' ? 'Stream video ID recognised' : 'YouTube link recognised'}
            {provider === 'youtube' && (
              <button className="text-link" type="button" onClick={() => setPreview(!preview)}>
                {preview ? 'Hide preview' : 'Preview video'}
              </button>
            )}
          </div>
        )}
        {preview && id && (
          <div className="add-preview">
            <Player videoId={id} title={title || 'Video preview'} />
            <p className="field-hint">
              Check the video plays before sharing. This preview cannot verify its Unlisted setting
              or channel ownership.
            </p>
          </div>
        )}
        <label className="form-label" htmlFor="video-title">
          Title
        </label>
        <input
          id="video-title"
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Twisted Fate vs Ahri · Mid lane review"
        />
        <div className="date-field">
          <label className="form-label" htmlFor="recorded-on">
            Game date <span>Optional</span>
          </label>
          <input
            id="recorded-on"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="form-footer">
          <span>
            <ShieldCheck size={13} />
            Sharing is your next choice.
          </span>
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="button" disabled={saving}>
            {saving ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}
            {saving ? 'Adding…' : 'Add video'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function ShareDialog({
  record,
  repository,
  local,
  onClose,
}: {
  record: Recording
  repository: LibraryRepository
  local: boolean
  onClose(): void
}) {
  const [link, setLink] = useState('')
  const [active, setActive] = useState(record.has_share)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  async function create() {
    setBusy(true)
    setError('')
    try {
      const token = await repository.share(record.id)
      setCopied(false)
      setLink(appURL(`/watch/${token}`))
      setActive(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function revoke() {
    setBusy(true)
    setError('')
    try {
      await repository.revoke(record.id)
      setLink('')
      setActive(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(local ? youtubeURL(record.youtube_video_id ?? '') : link)
      setCopied(true)
    } catch {
      setError('Clipboard access was blocked. Select the link and copy it manually.')
    }
  }
  return (
    <Dialog
      title="Share recording"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="dialog-intro">Share “{record.title}” with your coach.</p>
      <div className="share-illustration">
        <span>
          <Film size={23} />
        </span>
        <i />
        <Link2 size={20} />
        <i />
        <span>
          <Play size={23} />
        </span>
      </div>
      {local ? (
        <>
          <div className="notice">
            This is a local preview. Cloud watch pages need Supabase. You can share the original
            YouTube video now.
          </div>
          <label className="form-label" htmlFor="share-link">
            YouTube link
          </label>
          <input
            id="share-link"
            readOnly
            value={youtubeURL(record.youtube_video_id ?? '')}
            onFocus={(e) => e.target.select()}
          />
          <button className="button share-primary" onClick={copy}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied YouTube link' : 'Copy YouTube link'}
          </button>
        </>
      ) : link ? (
        <>
          <label className="form-label" htmlFor="share-link">
            Your watch link
          </label>
          <div className="copy-field">
            <input id="share-link" readOnly value={link} onFocus={(e) => e.target.select()} />
            <button className="button" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="field-hint">
            Save this link now. For privacy, it’s shown only when created.
          </p>
          <a className="text-link" href={link} target="_blank" rel="noopener noreferrer">
            Open watch page <ExternalLink size={13} />
          </a>
        </>
      ) : (
        <>
          <p>
            {active
              ? 'This video already has a shared watch page. Creating a replacement disables the previous app link.'
              : 'Create a watch page that anyone with the link can open.'}
          </p>
          <button className="button share-primary" onClick={create} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}
            {active ? 'Replace existing share link' : 'Create share link'}
          </button>
        </>
      )}
      {error && <ErrorNotice message={error} />}
      {!local && active && (
        <button className="text-link danger-text revoke-button" disabled={busy} onClick={revoke}>
          <Unlink size={14} />
          Stop sharing this app link
        </button>
      )}
      <p className="share-fineprint">
        {record.provider === 'stream'
          ? 'One browser session per link. Start within seven days; access ends two hours after starting. Replacing the link or stopping sharing can take up to five minutes to stop access; buffered video may continue playing.'
          : 'Anyone with the underlying YouTube link can still watch. To stop access to the video itself, make it Private or delete it in YouTube Studio.'}
      </p>
    </Dialog>
  )
}

function RenameDialog({
  record,
  repository,
  onClose,
  onSaved,
}: {
  record: Recording
  repository: LibraryRepository
  onClose(): void
  onSaved(): void
}) {
  const [title, setTitle] = useState(record.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await repository.rename(record.id, title.trim())
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Rename recording"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        <p className="dialog-intro">
          This updates the title in your library and shared watch page.
        </p>
        <label className="form-label" htmlFor="rename-title">
          Title
        </label>
        <input
          required
          maxLength={160}
          id="rename-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <ErrorNotice message={error} />}
        <div className="form-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="button" disabled={busy}>
            {busy ? 'Saving…' : 'Save title'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
function RemoveDialog({
  record,
  repository,
  onClose,
  onRemoved,
}: {
  record: Recording
  repository: LibraryRepository
  onClose(): void
  onRemoved(): void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function remove() {
    setBusy(true)
    try {
      await repository.remove(record.id)
      onRemoved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Remove from your library?"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="dialog-intro">
        “{record.title}” will be removed and its app share links will stop working. The original
        video stays on{' '}
        {record.provider === 'stream'
          ? 'Cloudflare Stream and continues to use paid storage'
          : 'YouTube'}
        .
      </p>
      {error && <ErrorNotice message={error} />}
      <div className="form-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Keep video
        </button>
        <button className="button danger" disabled={busy} onClick={remove}>
          {busy ? 'Removing…' : 'Remove from library'}
        </button>
      </div>
    </Dialog>
  )
}

function OwnVideo({
  id,
  repository,
  local,
}: {
  id: string
  repository: LibraryRepository
  local: boolean
}) {
  const [record, setRecord] = useState<Recording | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [share, setShare] = useState(false)
  const review = useMemo(() => (local ? null : ownerReview(id)), [id, local])
  useEffect(() => {
    let active = true
    setLoading(true)
    repository
      .list()
      .then((rows) => {
        if (active) setRecord(rows.find((r) => r.id === id) ?? null)
      })
      .catch((e: Error) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [id, repository])
  const back = (
    <a
      className="icon-button video-back"
      href={local ? '#/preview' : '#/library'}
      aria-label="Back to library"
      title="Back to library"
    >
      <ArrowLeft size={17} />
    </a>
  )
  return (
    <>
      {!record && <div className="video-bar">{back}</div>}
      {loading ? (
        <div className="loading-state" role="status">
          <LoaderCircle className="spin" />
          Opening recording…
        </div>
      ) : error ? (
        <ErrorNotice message={error} />
      ) : record ? (
        <>
          <div className="video-bar">
            {back}
            <h1>{record.title}</h1>
            {record.recorded_on && (
              <span className="video-date">{formatDate(record.recorded_on)}</span>
            )}
            <button className="button button-small video-share" onClick={() => setShare(true)}>
              <Link2 size={15} />
              Share video
            </button>
          </div>
          {local ? (
            <Player videoId={record.youtube_video_id!} title={record.title} />
          ) : (
            <VideoReview
              repository={review!}
              league={leagueRepository}
              recordedOn={record.recorded_on}
              renderPlayer={(onController) =>
                record.provider === 'stream' ? (
                  <StreamPlayer
                    key={record.id}
                    recordingId={record.id}
                    title={record.title}
                    onController={onController}
                  />
                ) : (
                  <Player
                    videoId={record.youtube_video_id!}
                    title={record.title}
                    onController={onController}
                  />
                )
              }
            />
          )}
          {share && (
            <ShareDialog
              record={record}
              repository={repository}
              local={local}
              onClose={() => setShare(false)}
            />
          )}
        </>
      ) : (
        <Unavailable />
      )}
    </>
  )
}
function Unavailable() {
  return (
    <div className="unavailable">
      <span className="empty-icon">
        <Unlink size={27} />
      </span>
      <span className="eyebrow">WATCH LINK UNAVAILABLE</span>
      <h1>This game isn’t shared here.</h1>
      <p>The link may have been removed or replaced. Ask the owner for a new watch link.</p>
      <a className="button secondary" href="#/library">
        Go to League Cloud Coach <ArrowRight size={15} />
      </a>
    </div>
  )
}
function Watch({ token }: { token: string }) {
  const [video, setVideo] = useState<WatchVideo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const review = useMemo(() => sharedReview(token), [token])
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    resolveShare(token)
      .then((result) => {
        if (active) setVideo(result)
      })
      .catch(() => {
        if (active)
          setError(
            configured
              ? 'We couldn’t open this watch page. Check your connection and try again.'
              : 'This site’s cloud connection has not been configured yet.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [token, attempt])
  useEffect(() => {
    document.title = video ? `${video.title} · League Cloud Coach` : 'Watch · League Cloud Coach'
    return () => {
      document.title = 'League Cloud Coach'
    }
  }, [video])
  return (
    <div className="watch-shell">
      <header className="watch-header">
        <Brand small />
        <span className="watch-header-note">
          <Link2 size={14} />A shared perspective
        </span>
      </header>
      <main className="watch-main">
        {loading ? (
          <div className="loading-state" role="status">
            <LoaderCircle className="spin" size={22} />
            Opening shared recording…
          </div>
        ) : error ? (
          <div className="unavailable">
            <Cloud size={30} />
            <h1>Couldn’t open this recording.</h1>
            <ErrorNotice message={error} />
            {configured && (
              <button className="button secondary" onClick={() => setAttempt(attempt + 1)}>
                Try again
              </button>
            )}
          </div>
        ) : video ? (
          <>
            <div className="video-bar">
              <h1>{video.title}</h1>
              {video.recorded_on && (
                <span className="video-date">{formatDate(video.recorded_on)}</span>
              )}
              <span className="watch-badge video-share">
                <Link2 size={13} />
                Shared with you
              </span>
            </div>
            <VideoReview
              repository={review}
              renderPlayer={(onController) =>
                video.provider === 'stream' ? (
                  <StreamPlayer
                    key={token}
                    shareToken={token}
                    title={video.title}
                    onController={onController}
                  />
                ) : (
                  <Player
                    videoId={video.youtube_video_id!}
                    title={video.title}
                    onController={onController}
                  />
                )
              }
            />
          </>
        ) : (
          <Unavailable />
        )}
      </main>
      <footer className="watch-footer">
        <span>LEAGUE CLOUD COACH</span>
        <span>A little reflection. A better next game.</span>
      </footer>
    </div>
  )
}
