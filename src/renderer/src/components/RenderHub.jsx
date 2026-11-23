import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { fileUrl } from './edit/model'
import { imageState, POPUP_KEY, renderPopupOn as popupOn, revealMedia, videoState } from '../renders'
import { reducedMotion } from '../a11y'

// The game only loads when someone presses Play
const FrameHunt = lazy(() => import('./FrameHunt'))
const reduced = reducedMotion

// The render hub, mounted once in App: a pop-up when a render starts (startRender in renders.js), a "ready" drop in the
// corner when it's done, on any page, and the reveal when that drop is clicked.
export default function RenderHub({ openShot, openImage }) {
  const [renders, setRenders] = useState([]) // [{ key, kind, name, projectId, job, set, state, at }]
  const [popup, setPopup] = useState(null) // the key of the render the pop-up shows
  const [drops, setDrops] = useState([]) // keys ready to open
  const [opening, setOpening] = useState(null)
  const jobs = useRef({})
  const live = useRef([])
  live.current = renders

  // a render starts: follow it, and show the pop-up
  useEffect(() => {
    const start = (e) => {
      const d = e.detail || {}
      const key = d.kind === 'image' ? `image:${d.set?.id}` : `video:${d.job?.id}`
      if (!d.set?.id && !d.job?.id) return
      if (d.job?.id) window.ivstudio.jobs.watch([d.job.id]).catch(() => {})
      const r = { key, kind: d.kind, name: d.name || d.job?.name || d.set?.name || 'Your render', projectId: d.projectId || d.job?.projectId || null, job: d.job || null, set: d.set || null, at: Date.now() }
      r.state = r.kind === 'image' ? imageState(r.set) : videoState(r.job, jobs.current)
      setRenders((all) => [r, ...all.filter((x) => x.key !== key)])
      if (popupOn()) setPopup(key)
      // a shot without a name of its own takes its project's (made from the prompt)
      if (!d.name && r.projectId)
        window.ivstudio.projects
          .get(r.projectId)
          .then((p) => {
            const name = p?.project?.name || p?.name
            if (name) setRenders((all) => all.map((x) => (x.key === key ? { ...x, name } : x)))
          })
          .catch(() => {})
    }
    window.addEventListener('iv:render', start)
    return () => window.removeEventListener('iv:render', start)
  }, [])

  // the jobs it follows, as the app hears about them
  useEffect(
    () =>
      window.ivstudio.jobs.onUpdate((j) => {
        jobs.current[j.id] = j
        // a One final's finish: watch it too
        if (j.autoFinishJob && !jobs.current[j.autoFinishJob]) window.ivstudio.jobs.watch([j.autoFinishJob]).catch(() => {})
        setRenders((all) => all.map((r) => (r.kind === 'video' && (r.job?.id === j.id || r.job?.autoFinishJob === j.id) ? update(r, r.job?.id === j.id ? j : r.job) : r)))
      }),
    []
  )
  // picture sets: asked every two seconds while one is being made
  const making = renders.some((r) => r.kind === 'image' && !['done', 'failed'].includes(r.state.stage))
  useEffect(() => {
    if (!making) return
    const t = setInterval(async () => {
      for (const r of live.current.filter((x) => x.kind === 'image' && !['done', 'failed'].includes(x.state.stage))) {
        const set = await window.ivstudio.images.get(r.set.id).catch(() => null)
        if (set) setRenders((all) => all.map((x) => (x.key === r.key ? update(x, null, set) : x)))
      }
    }, 2000)
    return () => clearInterval(t)
  }, [making])
  const update = (r, job, set) => {
    const next = { ...r, ...(job ? { job } : {}), ...(set ? { set } : {}) }
    next.state = next.kind === 'image' ? imageState(next.set) : videoState(next.job, jobs.current)
    return next
  }

  // done: the drop in the corner (and the pop-up says so); failed: the pop-up says so, no drop
  const seen = useRef(new Set())
  useEffect(() => {
    for (const r of renders) {
      if (r.state.stage === 'done' && !seen.current.has(r.key)) {
        seen.current.add(r.key)
        setDrops((d) => [r.key, ...d.filter((k) => k !== r.key)].slice(0, 4))
      }
    }
  }, [renders])

  const byKey = (k) => renders.find((r) => r.key === k)
  const go = (r) => {
    setOpening(null)
    setDrops((d) => d.filter((k) => k !== r.key))
    setPopup(null)
    if (r.kind === 'image') openImage(r.set?.id)
    else openShot(r.projectId)
  }
  const shown = popup && byKey(popup)
  return (
    <>
      {shown && <RenderPopup r={shown} onClose={() => setPopup(null)} onOpen={() => (shown.state.stage === 'done' ? setOpening(shown.key) : go(shown))} />}
      {drops.length > 0 && (
        <div className="ready-drops" aria-live="polite">
          {drops.map((k) => {
            const r = byKey(k)
            if (!r) return null
            return (
              <div key={k} className="ready-drop">
                <button className="ready-drop-open" onClick={() => (setPopup(null), setOpening(k))}>
                  <span className="ready-drop-crate" aria-hidden="true">
                    <CrateIcon />
                  </span>
                  <span className="ready-drop-text">
                    <span className="mono ready-drop-kicker">{r.kind === 'image' ? 'Pictures ready' : 'Your shot is ready'}</span>
                    <span className="ready-drop-name">{r.name}</span>
                    <span className="mono small dim">Click to open it</span>
                  </span>
                </button>
                <button className="ready-drop-x" aria-label="Dismiss" title="Dismiss (it stays on its page)" onClick={() => setDrops((d) => d.filter((x) => x !== k))}>
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
      {opening && byKey(opening) && <LootReveal r={byKey(opening)} onClose={() => (setOpening(null), setDrops((d) => d.filter((k) => k !== opening)))} onGo={() => go(byKey(opening))} />}
    </>
  )
}

// The pop-up while a render runs: where it is, that the person can leave, and a game if they'd like one
function RenderPopup({ r, onClose, onOpen }) {
  const [play, setPlay] = useState(false)
  const [off, setOff] = useState(!popupOn())
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const s = r.state
  const words =
    s.stage === 'done'
      ? 'Done. It’s ready.'
      : s.stage === 'failed'
        ? `It stopped: ${s.error}`
        : s.stage === 'finishing'
          ? `Finishing at full size${s.pct ? ` · ${s.pct}%` : s.position ? ` · ${s.position} in the queue` : '…'}`
          : s.stage === 'running'
            ? `Rendering${s.pct ? ` · ${s.pct}%` : '…'}`
            : `Waiting its turn${s.position ? ` · ${s.position} in the queue` : '…'}`
  const pct = s.stage === 'done' ? 100 : s.stage === 'finishing' ? 50 + s.pct / 2 : r.job?.plan?.autoFinish ? s.pct / 2 : s.pct
  const keep = (v) => {
    setOff(v)
    try {
      localStorage.setItem(POPUP_KEY, v ? 'off' : 'on')
    } catch {}
  }
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal render-popup ${s.stage}`} role="dialog" aria-modal="true" aria-labelledby="render-popup-title">
        <div className="modal-head">
          <span className="mono render-popup-kicker">{r.kind === 'image' ? 'Making pictures' : 'Rendering'}</span>
          <span className="spacer" />
          <button className="lora-chip-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <h2 id="render-popup-title" className="render-popup-name">
          {r.name}
        </h2>
        <div className="render-popup-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
          <span style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="mono small render-popup-state">{words}</p>
        {s.stage !== 'done' && s.stage !== 'failed' && <p className="render-popup-note">You can close this and keep exploring. When it’s ready, it shows up in the corner, on any page.</p>}
        {play ? (
          <Suspense fallback={<p className="small dim">Loading the game…</p>}>
            <FrameHunt />
          </Suspense>
        ) : (
          s.stage !== 'done' &&
          s.stage !== 'failed' && (
            <button className="btn btn-small render-popup-play" onClick={() => setPlay(true)}>
              ▶ Play Frame Hunt while you wait
            </button>
          )
        )}
        <div className="modal-foot">
          <label className="small dim render-popup-off">
            <input type="checkbox" checked={off} onChange={(e) => keep(e.target.checked)} /> Don’t open this when a render starts
          </label>
          <span className="spacer" />
          {s.stage === 'done' ? (
            <button className="btn btn-small btn-primary" onClick={onOpen}>
              Open it
            </button>
          ) : (
            <button className="btn btn-small btn-primary" onClick={onClose}>
              Keep exploring
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// The reveal: a crate drops in, shakes, bursts open in light, and the finished render rises out of it
function LootReveal({ r, onClose, onGo }) {
  const [phase, setPhase] = useState(reduced() ? 'open' : 'drop')
  useEffect(() => {
    if (phase === 'open') return
    const t = [setTimeout(() => setPhase('shake'), 450), setTimeout(() => setPhase('burst'), 1350), setTimeout(() => setPhase('open'), 1900)]
    return () => t.forEach(clearTimeout)
  }, [])
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  const media = revealMedia(r, r.state, r.set)
  const src = media?.file ? fileUrl(media.file) : media?.url
  return (
    <div className={`loot ${phase}`} role="dialog" aria-modal="true" aria-label={`${r.name} is ready`} onPointerDown={(e) => e.target === e.currentTarget && phase === 'open' && onClose()}>
      <div className="loot-rays" aria-hidden="true" />
      <div className="loot-stage">
        <div className="loot-crate" aria-hidden="true">
          <span className="loot-lid" />
          <span className="loot-box">
            <CrateIcon />
          </span>
        </div>
        <div className="loot-card">
          <span className="mono loot-kicker">{r.kind === 'image' ? 'Pictures ready' : 'Your shot is ready'}</span>
          <div className="loot-media">{src ? media.kind === 'image' ? <img src={src} alt="" /> : <video src={src} muted autoPlay loop playsInline /> : <span className="mono dim">Open it to see</span>}</div>
          <h2 className="loot-name">{r.name}</h2>
          {media?.more > 0 && <span className="small dim">and {media.more} more inside</span>}
          <div className="loot-actions">
            <button className="btn btn-small" onClick={onClose}>
              Later
            </button>
            <button className="btn btn-small btn-primary" onClick={onGo} autoFocus>
              Open it
            </button>
          </div>
        </div>
      </div>
      <div className="loot-sparks" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => (
          <span key={i} style={{ '--a': `${(360 / 14) * i}deg`, '--d': `${120 + (i % 4) * 40}px` }} />
        ))}
      </div>
    </div>
  )
}

function CrateIcon() {
  // a crate with the IV eye on its front
  return (
    <svg viewBox="0 0 48 40" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <rect x="4" y="10" width="40" height="27" rx="2" />
      <path d="M4 18h40M17 10v27M31 10v27" opacity="0.35" />
      <path d="M2 6h44v6H2z" />
      <path d="M13 26s4-5 11-5 11 5 11 5-4 5-11 5-11-5-11-5z" />
      <circle cx="24" cy="26" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}
