import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Upload, DetailedError } from 'tus-js-client'
import { Dialog } from './Dialog'
import {
  checkUpload,
  loadPendingUpload,
  reserveUpload,
  sameFile,
  savePendingUpload,
  validateVideoFile,
  type PendingUpload,
} from '../lib/uploads'

export function UploadDialog({
  ownerId,
  onClose,
  onSaved,
}: {
  ownerId: string
  onClose(): void
  onSaved(): void
}) {
  const [pending, setPending] = useState<PendingUpload | null>(() => loadPendingUpload(ownerId))
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [maxDuration, setMaxDuration] = useState(3600)
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const [pollAttempt, setPollAttempt] = useState(0)
  const upload = useRef<Upload | null>(null)
  const mounted = useRef(true)
  const onSavedRef = useRef(onSaved)
  onSavedRef.current = onSaved
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      void upload.current?.abort().catch(() => {})
    }
  }, [])
  // Recover completed transfers after refresh without requiring the file again.
  useEffect(() => {
    if (!pending) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await checkUpload(pending!.videoId)
        if (disposed) return
        if (result.state === 'ready') {
          savePendingUpload(ownerId, null)
          onSavedRef.current()
          return
        }
        if (result.state === 'error') {
          setError(result.message || 'Cloudflare could not process this video.')
          return
        }
        if (result.state === 'processing' && pending!.stage !== 'processing') {
          const next = { ...pending!, stage: 'processing' as const }
          savePendingUpload(ownerId, next)
          setPending(next)
          return
        }
        if (result.state === 'processing' || pending!.stage === 'processing')
          timer = setTimeout(poll, 5000)
      } catch (reason) {
        if (!disposed)
          setError(
            reason instanceof Error ? reason.message : 'Could not check processing. Try again.',
          )
      }
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [ownerId, pending, pollAttempt])
  async function send(e: FormEvent) {
    e.preventDefault()
    if (!file) return
    setError('')
    const validation = validateVideoFile(file)
    if (validation) {
      setError(validation)
      return
    }
    if (pending && !sameFile(file, pending)) {
      setError(`Choose the original file: ${pending.filename}.`)
      return
    }
    setPreparing(true)
    try {
      // Persist the one-time destination before sending bytes; never allocate a
      // second Cloudflare video when retrying or resuming this transfer.
      localStorage.setItem(`league-cloud-coach.storage-check:${ownerId}`, '1')
      localStorage.removeItem(`league-cloud-coach.storage-check:${ownerId}`)
      const active = pending || (await reserveUpload(file, title, date || null, maxDuration))
      savePendingUpload(ownerId, active)
      if (!mounted.current) return
      setPending(active)
      const { Upload } = await import('tus-js-client')
      if (!mounted.current) return
      upload.current = new Upload(file, {
        uploadUrl: active.uploadURL,
        uploadSize: file.size,
        chunkSize: 10 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
        storeFingerprintForResuming: false,
        onProgress(sent, total) {
          if (mounted.current) setProgress(Math.floor((sent / total) * 100))
        },
        onError(reason) {
          const status = (reason as DetailedError).originalResponse?.getStatus()
          if (mounted.current) {
            setRunning(false)
            setError(
              status === 404 || status === 410
                ? 'This upload link has expired. Start another upload; the previous video stays in Cloudflare.'
                : 'Upload interrupted. Check your connection and resume; completed chunks are kept.',
            )
          }
        },
        onSuccess() {
          const next = { ...active, stage: 'processing' as const }
          savePendingUpload(ownerId, next)
          if (mounted.current) {
            setRunning(false)
            setProgress(100)
            setPending(next)
          }
        },
      })
      setRunning(true)
      upload.current.start()
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : 'Could not start upload.')
    } finally {
      if (mounted.current) setPreparing(false)
    }
  }
  async function pause() {
    await upload.current?.abort()
    if (mounted.current) setRunning(false)
  }
  function close() {
    if (!preparing) onClose()
  }
  return (
    <Dialog title="Upload video to Cloudflare" onClose={close} wide>
      <p className="dialog-intro">
        Choose a recording from your computer. It uploads privately to Cloudflare and appears in
        your library when processing finishes.
      </p>
      {pending?.stage === 'processing' ? (
        <>
          <h3>{pending.title}</h3>
          <p role="status">Upload complete. Cloudflare is processing your video…</p>
          <p className="field-hint">
            You can close this window and check again with Upload video. Your recording will be
            added when it is ready.
          </p>
          <button
            className="button secondary"
            onClick={() => {
              setError('')
              setPollAttempt((x) => x + 1)
            }}
          >
            Check processing
          </button>
        </>
      ) : (
        <form onSubmit={send}>
          {pending && (
            <div className="notice">
              Resume “{pending.title}” by selecting {pending.filename}. Completed chunks will not be
              uploaded again.
            </div>
          )}
          <label className="form-label" htmlFor="upload-file">
            Video file
          </label>
          <input
            id="upload-file"
            type="file"
            accept=".mp4,.mov,.m4v,.mkv,.webm,.avi,video/*"
            disabled={running || preparing}
            required
            onChange={(e) => {
              const selected = e.target.files?.[0] || null
              setFile(selected)
              setError('')
              if (selected && !title) setTitle(selected.name.replace(/\.[^.]+$/, '').slice(0, 160))
            }}
          />
          {!pending && (
            <>
              <label className="form-label" htmlFor="upload-title">
                Title
              </label>
              <input
                id="upload-title"
                value={title}
                required
                maxLength={160}
                disabled={running || preparing}
                onChange={(e) => setTitle(e.target.value)}
              />
              <label className="form-label" htmlFor="upload-date">
                Game date <span>Optional</span>
              </label>
              <input
                id="upload-date"
                type="date"
                value={date}
                disabled={running || preparing}
                onChange={(e) => setDate(e.target.value)}
              />
              <label className="form-label" htmlFor="upload-duration">
                Maximum video length
              </label>
              <select
                id="upload-duration"
                value={maxDuration}
                disabled={running || preparing}
                onChange={(e) => setMaxDuration(Number(e.target.value))}
              >
                {[30, 60, 90, 120].map((minutes) => (
                  <option key={minutes} value={minutes * 60}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Choose a length longer than your recording. Cloudflare temporarily reserves this
                storage capacity; videos over this limit fail processing. Files up to 30 GB.
              </p>
            </>
          )}
          {pending && (
            <div className="upload-progress">
              <progress max={100} value={progress} aria-label="Upload progress" />
              <p role="status">
                {running
                  ? `Uploading: ${progress}%`
                  : progress
                    ? `Paused at ${progress}%`
                    : 'Ready to resume'}
              </p>
            </div>
          )}
          <div className="form-footer">
            {running ? (
              <button type="button" className="button secondary" onClick={pause}>
                Pause upload
              </button>
            ) : (
              <button className="button" disabled={preparing || !file}>
                {preparing
                  ? 'Preparing upload…'
                  : pending
                    ? 'Resume upload'
                    : 'Upload to Cloudflare'}
              </button>
            )}
          </div>
        </form>
      )}
      {pending && !running && !preparing && (
        <div className="upload-recovery">
          <p className="field-hint">
            Cloudflare video ID: <code>{pending.videoId}</code>
          </p>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              savePendingUpload(ownerId, null)
              setPending(null)
              setFile(null)
              setProgress(0)
              setError('')
              setTitle('')
            }}
          >
            Start another upload
          </button>
          <p className="field-hint">
            This keeps the previous upload in Cloudflare. You can add its video ID later.
          </p>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <p className="share-fineprint">
        Keep this tab open while uploading. Closing pauses the transfer; select the same file to
        resume in this browser. Cloudflare storage and delivery charges apply. Closing this window
        does not delete uploaded media.
      </p>
      <button type="button" className="text-link" disabled={preparing} onClick={close}>
        {running ? 'Pause and close' : 'Close'}
      </button>
    </Dialog>
  )
}
