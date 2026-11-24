import { useEffect, useRef, useState } from 'react'

// The cloud setup as it happens (setupprogress.js in the main process): an overall bar with the time so far and
// about how long is left, each step with its usual time and its own bar when it reports one, a note that the page
// can be left (IV Studio says when it's done), and Modal's or RunPod's raw output behind Show details.

export function clock(secs) {
  const s = Math.max(0, Math.round(secs || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}
export function about(secs) {
  if (secs < 45) return 'less than a minute'
  const m = Math.round(secs / 60)
  if (m <= 1) return 'about a minute'
  if (m < 90) return `about ${m} minutes`
  const h = Math.round((secs / 3600) * 2) / 2
  return `about ${h} hour${h === 1 ? '' : 's'}`
}

// the setup's latest progress: from cloud:status when the page opens, then every cloud:progress
export function useSetupProgress(initial) {
  const [p, setP] = useState(initial || null)
  const [, tick] = useState(0)
  useEffect(() => setP((cur) => (initial && (!cur || initial.startedAt >= cur.startedAt) ? initial : cur)), [initial?.startedAt, initial?.finishedAt])
  useEffect(() => window.ivstudio.cloud.onProgress?.((snap) => setP(snap)), [])
  // the clock moves every second between updates
  const running = p && !p.finishedAt
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [running])
  return p
}

// seconds since the snapshot was made, so the clock runs smoothly between updates
const since = (p) => (p && !p.finishedAt ? Math.max(0, Math.round((Date.now() - p.startedAt) / 1000) - p.elapsed) : 0)

export default function SetupProgress({ progress: p, log = [], name }) {
  const [details, setDetails] = useState(false)
  const logEl = useRef(null)
  // braces: scrollTo returns a Promise in Electron's Chromium, and React would take it for a cleanup function
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log, details])
  if (!p) return null
  const extra = since(p)
  const elapsed = p.elapsed + extra
  const left = Math.max(0, p.remaining - extra)
  const done = p.finishedAt && p.ok
  const failed = p.finishedAt && p.ok === false
  const who = name || (p.provider === 'runpod' ? 'RunPod' : 'Modal')
  return (
    <div className={`setup-progress ${done ? 'is-done' : failed ? 'is-failed' : 'is-running'}`}>
      <div className="setup-progress-head">
        <div>
          <span className="setup-progress-kicker mono">{done ? 'Ready' : failed ? 'Stopped' : `Setting up ${who}`}</span>
          <strong className="setup-progress-pct">{done ? '100%' : `${Math.floor(p.overall)}%`}</strong>
        </div>
        <div className="setup-progress-times">
          <span>
            <span className="mono dim">{done || failed ? 'Took' : 'So far'}</span> <span className="mono">{clock(elapsed)}</span>
          </span>
          {!p.finishedAt && (
            <span>
              <span className="mono dim">Left</span> <span className="mono">{about(left)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="setup-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done ? 100 : p.overall)}>
        <i style={{ width: `${done ? 100 : Math.max(1.5, p.overall)}%` }} />
      </div>

      {!p.finishedAt && (
        <p className="setup-progress-leave">
          <strong>You don’t have to watch.</strong> Use the rest of IV Studio or leave this page: setup carries on, and IV Studio tells you when it’s ready. Keep IV Studio open until then.
        </p>
      )}
      {p.slow && !p.finishedAt && p.provider === 'runpod' && <SlowDownload p={p} />}
      {done && <p className="setup-progress-leave ok">Set up and ready. Switch on The cloud to render there.</p>}
      {failed && <p className="setup-progress-leave pink">{p.error?.split('\n')[0]}</p>}

      <ol className="setup-steps">
        {p.steps.map((s, i) => (
          <li key={s.id} className={`setup-step ${s.status}`}>
            <span className="setup-step-mark" aria-hidden="true">
              {s.status === 'done' ? (
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.2 4.2L19 7" />
                </svg>
              ) : s.status === 'running' ? (
                <span className="setup-step-spin" />
              ) : s.status === 'failed' ? (
                '!'
              ) : s.status === 'skipped' ? (
                '–'
              ) : (
                String(i + 1)
              )}
            </span>
            <div className="setup-step-body">
              <div className="setup-step-top">
                <span className="setup-step-label">{s.label}</span>
                <span className="setup-step-time mono">{s.status === 'running' || s.status === 'done' || s.status === 'failed' ? clock(s.seconds + (s.status === 'running' ? extra : 0)) : s.status === 'skipped' ? '' : s.typical}</span>
              </div>
              {s.status === 'running' && (
                <div className={`setup-step-bar ${s.percent == null ? 'busy' : ''}`}>
                  <i style={s.percent == null ? undefined : { width: `${Math.max(2, s.percent)}%` }} />
                </div>
              )}
              {(s.detail || s.status === 'running') && (
                <span className="setup-step-detail small dim words-exact">
                  {s.detail || 'Working…'}
                  {s.status === 'running' && s.percent != null ? ` · ${s.percent}%${/%/.test(s.detail) ? ' of all' : ''}` : ''}
                  {s.status === 'running' && s.percent == null ? ` · usually ${s.typical}` : ''}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {log.length > 0 && (
        <div className="setup-progress-details">
          <button className="link-btn mono small" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
            {details ? 'Hide details' : 'Show details'}
          </button>
          {details && (
            <pre className="code cloud-log" ref={logEl}>
              {log.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// RunPod's model download has been slow for a few minutes (setupprogress.js SLOW_ETA / SLOW_FOR): what it would
// cost to wait, and a way to stop the GPU now without losing what's downloaded.
function SlowDownload({ p }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const mbs = p.slow.speed ? `${Math.max(1, Math.round(p.slow.speed / 1e6))} MB/s` : 'very slowly'
  const cost = p.perHour ? `, roughly $${((p.slow.eta / 3600) * p.perHour).toFixed(2)} of GPU time` : ''
  async function stop() {
    setBusy(true)
    setErr('')
    try {
      await window.ivstudio.cloud.runpodPause()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <div className="setup-slow" role="alert">
      <p className="small">
        <strong>The model download is slow in this data center:</strong> {mbs}, {about(p.slow.eta)} left{cost}. You can stop the GPU now and billing stops. Everything downloaded so far stays on your storage, and Set up again carries on from where it stopped. Trying at another time often helps, and so does a Hugging Face token if Hugging Face is limiting this data center.
      </p>
      <div className="setup-slow-row">
        <button className="btn btn-small" disabled={busy} onClick={stop}>
          {busy ? 'Stopping…' : 'Stop the GPU, keep the download'}
        </button>
        <span className="small dim">Or let it carry on: it keeps going.</span>
      </div>
      {err && <p className="small pink">{err}</p>}
    </div>
  )
}

// The title-bar pill while a setup runs: its percentage and clock; opens the Cloud page.
export function SetupPill({ onOpen }) {
  const [initial, setInitial] = useState(null)
  useEffect(() => {
    window.ivstudio.cloud.status().then((st) => setInitial(st.setup || null), () => {})
  }, [])
  const p = useSetupProgress(initial)
  if (!p || p.finishedAt) return null
  return (
    <button className="setup-pill" onClick={onOpen} title="Cloud setup is running. Open the Cloud page.">
      <span className="setup-step-spin" aria-hidden="true" />
      <span className="mono">Cloud setup {Math.floor(p.overall)}%</span>
      <span className="mono dim">{clock(p.elapsed + since(p))}</span>
    </button>
  )
}
