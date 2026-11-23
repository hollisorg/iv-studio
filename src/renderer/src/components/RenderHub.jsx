import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { fileUrl } from './edit/model'
import { againRequest, imageState, isQuiet, isRunning, jobsState, jobTitle, nextSteps, publishRenders, readyFx, readyWords, renderPopupOn as popupOn, revealMedia, setRenderPrefs, startRender, track, videoState } from '../renders'
import { reducedMotion } from '../a11y'

// The game only loads when someone presses Play
const FrameHunt = lazy(() => import('./FrameHunt'))
const reduced = reducedMotion
// quiet now: Settings → Accessibility → Quiet hours, or editing full screen (the app's focus mode)
const quietNow = () => isQuiet(new Date(), !!document.querySelector('.app.app-focus'))

// The render hub, mounted once in App: a pop-up when a render starts (startRender in renders.js), a "ready" drop in the
// corner when it's done, on any page, and the reveal when that drop is clicked.
export default function RenderHub({ openShot, openImage, openTarget, notify }) {
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
      const ids = (d.jobs || []).map((j) => (typeof j === 'string' ? j : j?.id)).filter(Boolean)
      for (const j of d.jobs || []) if (j && typeof j === 'object' && j.id) jobs.current[j.id] = { ...j, ...(jobs.current[j.id] || {}) }
      const key = d.kind === 'image' ? `image:${d.set?.id}` : d.kind === 'jobs' ? `jobs:${ids.join(',')}` : d.kind === 'task' || d.kind === 'poll' ? `${d.kind}:${d.id || Date.now()}` : `video:${d.job?.id}`
      if (d.kind === 'image' ? !d.set?.id : d.kind === 'jobs' ? !ids.length : d.kind === 'task' ? !d.promise : d.kind === 'poll' ? !d.poll : !d.job?.id) return
      const watch = d.job?.id ? [d.job.id] : ids
      if (watch.length) window.ivstudio.jobs.watch(watch).catch(() => {})
      const r = { key, kind: d.kind, what: d.what || null, open: d.open || null, ids, poll: d.poll || null, name: d.name || d.set?.name || jobTitle((d.jobs || []).find((j) => j && typeof j === 'object')?.name || d.job?.name) || 'Your render', unnamed: !d.name && !d.set?.name, projectId: d.projectId || d.job?.projectId || null, job: d.job || null, set: d.set || null, at: Date.now() }
      r.state = stateOf(r)
      // a call that returns when it's done (Effects): done, or failed, when it does
      if (d.kind === 'task')
        Promise.resolve(d.promise).then(
          (result) => setRenders((all) => all.map((x) => (x.key === key ? { ...x, state: { stage: 'done', pct: 100, media: d.media?.(result) || null } } : x))),
          (err) => setRenders((all) => all.map((x) => (x.key === key ? { ...x, state: { stage: 'failed', error: err?.message || 'It stopped.' } } : x)))
        )
      setRenders((all) => [r, ...all.filter((x) => x.key !== key)].slice(0, 16))
      if (popupOn() && !quietNow()) setPopup(key)
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
        setRenders((all) =>
          all.map((r) =>
            r.kind === 'video' && (r.job?.id === j.id || r.job?.autoFinishJob === j.id)
              ? update(r, r.job?.id === j.id ? j : r.job)
              : r.kind === 'jobs' && r.ids.some((id) => id === j.id || jobs.current[id]?.autoFinishJob === j.id)
                ? { ...r, state: stateOf(r), ...(r.unnamed && r.name === 'Your render' && jobTitle(j.name) ? { name: jobTitle(j.name) } : {}) }
                : r
          )
        )
      }),
    []
  )
  // a tool that runs its own steps (Rebuild, Sizzle): asked every three seconds until it says done
  const asking = renders.some((r) => r.kind === 'poll' && !['done', 'failed'].includes(r.state.stage))
  useEffect(() => {
    if (!asking) return
    const t = setInterval(async () => {
      for (const r of live.current.filter((x) => x.kind === 'poll' && !['done', 'failed'].includes(x.state.stage))) {
        const s = await Promise.resolve(r.poll()).catch(() => null)
        if (s) setRenders((all) => all.map((x) => (x.key === r.key ? { ...x, state: s } : x)))
      }
    }, 3000)
    return () => clearInterval(t)
  }, [asking])
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
  const stateOf = (r) => (r.kind === 'image' ? imageState(r.set) : r.kind === 'jobs' ? jobsState(r.ids, jobs.current) : r.kind === 'task' || r.kind === 'poll' ? r.state || { stage: 'running', pct: 0 } : videoState(r.job, jobs.current))
  const update = (r, job, set) => {
    const next = { ...r, ...(job ? { job } : {}), ...(set ? { set } : {}) }
    next.state = stateOf(next)
    return next
  }

  // done: the drop in the corner (and the pop-up says so); failed: the pop-up says so, no drop. In quiet hours (or
  // while editing full screen) they wait, and come together when it's over.
  const seen = useRef(new Set())
  const held = useRef([])
  const announce = (r) => {
    // Just a notice (Settings → Accessibility): a short message, no drop
    if (readyFx() === 'off') notify?.(`${readyWords(r)}: ${r.name}.`, 'ok')
    else setDrops((d) => [r.key, ...d.filter((k) => k !== r.key)].slice(0, 4))
  }
  useEffect(() => {
    publishRenders(renders)
    for (const r of renders) {
      if (r.state.stage === 'done' && !seen.current.has(r.key)) {
        seen.current.add(r.key)
        if (quietNow()) held.current.push(r.key)
        else announce(r)
      }
    }
  }, [renders])
  useEffect(() => {
    const t = setInterval(() => {
      if (!held.current.length || quietNow()) return
      const keys = held.current.splice(0)
      for (const k of keys) {
        const r = live.current.find((x) => x.key === k)
        if (r) announce(r)
      }
      if (keys.length > 1 && readyFx() !== 'off') notify?.(`${keys.length} renders finished while it was quiet.`, 'ok')
    }, 20000)
    return () => clearInterval(t)
  }, [])

  // the tray: stop a render, or take a finished one off the list
  const [hidden, setHidden] = useState(() => new Set())
  async function cancel(r) {
    try {
      if (r.kind === 'image') await window.ivstudio.images.cancel(r.set.id)
      else {
        const ids = r.kind === 'video' ? [r.job?.id, jobs.current[r.job?.id]?.autoFinishJob] : r.ids.flatMap((id) => [id, jobs.current[id]?.autoFinishJob])
        for (const id of ids.filter(Boolean)) if (isRunning({ state: videoState(jobs.current[id] || { status: 'queued' }) })) await window.ivstudio.jobs.cancel(id).catch(() => {})
      }
    } catch (err) {
      notify?.(err.message)
    }
  }
  // the reveal's next steps: Again (a new seed) and Finish this one
  async function again(r) {
    setOpening(null)
    setDrops((d) => d.filter((k) => k !== r.key))
    try {
      if (r.kind === 'image') {
        const s = (await window.ivstudio.images.get(r.set.id).catch(() => null)) || r.set
        const rec = await window.ivstudio.images.create({ mode: s.mode, model: s.model, prompt: s.prompt, negative: s.negative || '', loras: s.loras || [], aspect: s.aspect, megapixels: s.megapixels, count: s.count, steps: s.steps ?? null, cfg: s.cfg ?? null, refs: s.refs || [], seed: null })
        startRender({ kind: 'image', set: rec, name: rec.name })
      } else {
        const job = await window.ivstudio.render.previews(againRequest(jobs.current[r.job.id] || r.job))
        startRender({ kind: 'video', job, projectId: job.projectId, name: r.name })
      }
    } catch (err) {
      notify?.(err.message)
    }
  }
  async function finishIt(r, media) {
    setOpening(null)
    setDrops((d) => d.filter((k) => k !== r.key))
    try {
      // the enhancer Check my PC (or the last finish) chose
      const prefs = (await window.ivstudio.settings.get().catch(() => ({})))?.shotPrefs || {}
      const job = jobs.current[media.jobId] || r.state.job
      await track(window.ivstudio.render.finish({ jobId: job.id, candidate: media.candidate, ...(prefs.enhancer ? { enhancer: prefs.enhancer } : {}) }), { name: r.name, open: { page: 'shot', id: job.projectId }, what: 'shot' })
    } catch (err) {
      notify?.(err.message)
    }
  }

  const byKey = (k) => renders.find((r) => r.key === k)
  const go = (r) => {
    setOpening(null)
    setDrops((d) => d.filter((k) => k !== r.key))
    setPopup(null)
    if (r.open) openTarget(r.open)
    else if (r.kind === 'image') openImage(r.set?.id)
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
              <div key={k} className={`ready-drop ${readyFx() === 'simple' ? 'simple' : ''}`}>
                <button className="ready-drop-open" onClick={() => (setPopup(null), setOpening(k))}>
                  <span className="ready-drop-crate" aria-hidden="true">
                    <CrateIcon />
                  </span>
                  <span className="ready-drop-text">
                    <span className="mono ready-drop-kicker">{readyWords(r)}</span>
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
      {opening && byKey(opening) && <LootReveal r={byKey(opening)} onClose={() => (setOpening(null), setDrops((d) => d.filter((k) => k !== opening)))} onGo={() => go(byKey(opening))} onAgain={() => again(byKey(opening))} onFinish={(m) => finishIt(byKey(opening), m)} />}
      <RenderTray
        renders={renders.filter((r) => !hidden.has(r.key))}
        onOpen={(r) => (r.state.stage === 'done' ? (setPopup(null), setOpening(r.key)) : setPopup(r.key))}
        onCancel={cancel}
        onDismiss={(r) => setHidden((h) => new Set([...h, r.key]))}
      />
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
            ? `${s.label || 'Rendering'}${s.count > 1 ? ` · ${s.done} of ${s.count} done` : ''}${s.pct ? ` · ${s.pct}%` : '…'}`
            : `Waiting its turn${s.position ? ` · ${s.position} in the queue` : '…'}`
  const pct = s.stage === 'done' ? 100 : s.stage === 'finishing' ? 50 + s.pct / 2 : r.job?.plan?.autoFinish ? s.pct / 2 : s.pct
  // the same switch as Settings → Accessibility → Render pop-up
  const keep = async (v) => {
    setOff(v)
    try {
      setRenderPrefs(await window.ivstudio.settings.set({ renderPopup: !v }))
      window.dispatchEvent(new CustomEvent('iv:settings'))
    } catch {}
  }
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal render-popup ${s.stage}`} role="dialog" aria-modal="true" aria-labelledby="render-popup-title">
        <div className="modal-head">
          <span className="mono render-popup-kicker">{r.kind === 'image' ? 'Making pictures' : r.what === 'song' ? 'Making your song' : r.what === 'sound' ? 'Making your sound' : 'Rendering'}</span>
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
function LootReveal({ r, onClose, onGo, onAgain, onFinish }) {
  // Simple (Settings → Accessibility) and reduced motion go straight to the card
  const calm = reduced() || readyFx() === 'simple'
  const [phase, setPhase] = useState(calm ? 'open' : 'drop')
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
  const next = nextSteps(r, r.state, media)
  const src = media?.file ? fileUrl(media.file) : media?.url
  return (
    <div className={`loot ${phase} ${calm ? 'calm' : ''}`} role="dialog" aria-modal="true" aria-label={`${r.name} is ready`} onPointerDown={(e) => e.target === e.currentTarget && phase === 'open' && onClose()}>
      <div className="loot-rays" aria-hidden="true" />
      <div className="loot-stage">
        <div className="loot-crate" aria-hidden="true">
          <span className="loot-lid" />
          <span className="loot-box">
            <CrateIcon />
          </span>
        </div>
        <div className="loot-card">
          <span className="mono loot-kicker">{readyWords(r)}</span>
          <div className={`loot-media ${media?.kind === 'audio' ? 'audio' : ''}`}>
            {src ? media.kind === 'image' ? <img src={src} alt="" /> : media.kind === 'audio' ? <audio src={src} controls autoPlay /> : <video src={src} muted autoPlay loop playsInline /> : <span className="mono dim">Open it to see</span>}
          </div>
          <h2 className="loot-name">{r.name}</h2>
          {media?.more > 0 && <span className="small dim">and {media.more} more inside</span>}
          {r.state?.note && <span className="small dim">{r.state.note}</span>}
          <div className="loot-actions">
            <button className="btn btn-small" onClick={onClose}>
              Later
            </button>
            {next.again && (
              <button className="btn btn-small" onClick={onAgain} title="The same again with a new seed">
                ↻ Again
              </button>
            )}
            {next.finish && (
              <button className="btn btn-small" onClick={() => onFinish(media)} title={`Finish take ${media.candidate} at full size with your usual enhancer`}>
                Finish take {media.candidate}
              </button>
            )}
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

// The tray: everything rendering and ready, across every tool, in one place. A pill in the corner; open, a list with
// each render's progress, Open, Stop and a way to take finished ones off the list.
function RenderTray({ renders, onOpen, onCancel, onDismiss }) {
  const [open, setOpen] = useState(false)
  const running = renders.filter(isRunning)
  const ready = renders.filter((r) => r.state.stage === 'done')
  if (!renders.length) return null
  const canStop = (r) => isRunning(r) && (r.kind === 'image' || r.kind === 'video' || r.kind === 'jobs')
  const words = (s) => (s.stage === 'done' ? 'Ready' : s.stage === 'failed' ? 'Stopped' : s.stage === 'finishing' ? `Finishing${s.pct ? ` · ${s.pct}%` : ''}` : s.stage === 'running' ? `${s.count > 1 ? `${s.done} of ${s.count} · ` : ''}${s.pct ? `${s.pct}%` : 'Rendering'}` : `Waiting${s.position ? ` · ${s.position} in line` : ''}`)
  return (
    <div className={`render-tray ${open ? 'open' : ''}`}>
      {open && (
        <div className="render-tray-list" role="list" aria-label="Your renders">
          <div className="render-tray-head mono small">
            <span>Renders</span>
            <span className="spacer" />
            {ready.length > 0 && (
              <button className="link-btn mono small" onClick={() => ready.forEach(onDismiss)}>
                Clear finished
              </button>
            )}
          </div>
          {renders.map((r) => (
            <div key={r.key} className={`render-tray-row ${r.state.stage}`} role="listitem">
              <div className="render-tray-text">
                <span className="render-tray-name" title={r.name}>
                  {r.name}
                </span>
                <span className="mono small dim">{words(r.state)}</span>
                {isRunning(r) && (
                  <span className="render-tray-bar">
                    <span style={{ width: `${Math.max(4, r.state.pct || 0)}%` }} />
                  </span>
                )}
              </div>
              <div className="render-tray-actions">
                {r.state.stage !== 'failed' && (
                  <button className="btn btn-small" onClick={() => onOpen(r)}>
                    {r.state.stage === 'done' ? 'Open' : 'Watch'}
                  </button>
                )}
                {canStop(r) && (
                  <button className="link-btn mono small" onClick={() => onCancel(r)}>
                    Stop
                  </button>
                )}
                {!isRunning(r) && (
                  <button className="lora-chip-x" aria-label={`Take ${r.name} off the list`} onClick={() => onDismiss(r)}>
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <button className={`render-tray-pill mono ${running.length ? 'busy' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} title="Everything rendering and ready">
        <span className="render-tray-dot" />
        {running.length ? `${running.length} rendering` : ''}
        {running.length && ready.length ? ' · ' : ''}
        {ready.length ? `${ready.length} ready` : ''}
        {!running.length && !ready.length ? `${renders.length} stopped` : ''}
      </button>
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
