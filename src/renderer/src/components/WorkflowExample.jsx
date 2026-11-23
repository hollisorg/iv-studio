import { useCallback, useEffect, useRef, useState } from 'react'
import { reducedMotion } from '../a11y'

// A Workflows card's Example pop-up: a short real example of what the tool makes (workflows.js example), one
// paragraph about it, Close and Try it (opens the tool). Its media ships with IV Studio in resources/examples and
// plays through ivfile://. Nothing plays with sound until asked; with Reduce motion nothing plays until asked; every
// video stops and lets go of its file when the pop-up closes. Esc, ×, Close and the backdrop close it.
const fileUrl = (dir, name) => `ivfile://local/?p=${encodeURIComponent(`${dir}/${name}`)}`
// the first frame of each video, made with it (scripts/make-examples.mjs)
export const posterOf = (name) => name.replace(/\.mp4$/, '.webp')

// The videos on show, together: play and pause them as one, sound on the main one, and keep the "before" of a
// compare in step with its "after". stillStart: Reduce motion (start paused on the first frame).
function useVideos(main, others, { stillStart }) {
  const [playing, setPlaying] = useState(!stillStart)
  const [muted, setMuted] = useState(true)
  const all = () => [main.current, ...others.map((r) => r.current)].filter(Boolean)
  useEffect(() => {
    for (const v of all()) {
      if (playing) v.play().catch(() => {})
      else v.pause()
    }
  })
  useEffect(() => {
    if (main.current) main.current.muted = muted
  }, [muted, main])
  // the other videos follow the main one's clock (a compare's two halves must show the same moment)
  useEffect(() => {
    const t = setInterval(() => {
      const m = main.current
      if (!m) return
      for (const r of others) if (r.current && Math.abs(r.current.currentTime - m.currentTime) > 0.08) r.current.currentTime = m.currentTime
    }, 250)
    return () => clearInterval(t)
  })
  // a hidden window stops the videos (they stay stopped until Play)
  useEffect(() => {
    const hide = () => document.hidden && setPlaying(false)
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])
  // closing lets go of the files, so nothing keeps decoding behind the page. The elements are remembered while
  // they're on screen: by the time the closing clean-up runs, React has already cleared the refs.
  const seen = useRef([])
  useEffect(() => {
    seen.current = all()
  })
  useEffect(
    () => () => {
      for (const v of seen.current) {
        v.pause()
        v.removeAttribute('src')
        v.load()
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  return { playing, setPlaying, muted, setMuted }
}

function Controls({ playing, setPlaying, muted, setMuted, sound }) {
  return (
    <div className="wfx-controls">
      <button className="btn btn-small" onClick={() => setPlaying(!playing)} aria-pressed={!playing}>
        {playing ? 'Pause' : 'Play'}
      </button>
      {sound && (
        <button className={`btn btn-small ${muted ? 'wfx-sound' : ''}`} onClick={() => (setMuted(!muted), muted && setPlaying(true))} aria-pressed={!muted}>
          {muted ? 'Sound on' : 'Sound off'}
        </button>
      )}
    </div>
  )
}

// before | after with a line between them: drag it, or arrow keys on it (Home / End go to the edges). It sweeps
// across once when it opens, unless motion is reduced or someone moves it first.
function Compare({ dir, pair, still }) {
  const after = useRef(null)
  const before = useRef(null)
  const box = useRef(null)
  const [pos, setPos] = useState(50)
  const touched = useRef(false)
  const v = useVideos(after, [before], { stillStart: still })
  useEffect(() => {
    if (still) return
    touched.current = false
    const t0 = performance.now()
    let raf = 0
    // 50 -> 85 -> 15 -> 50 over 2.4 s
    const step = (now) => {
      if (touched.current) return
      const k = Math.min(1, (now - t0) / 2400)
      setPos(50 + 35 * Math.sin(k * Math.PI * 2))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [pair, still])
  const fromPointer = (e) => {
    const r = box.current.getBoundingClientRect()
    setPos(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)))
  }
  const key = (e) => {
    const to = { ArrowLeft: pos - 5, ArrowDown: pos - 5, ArrowRight: pos + 5, ArrowUp: pos + 5, Home: 0, End: 100 }[e.key]
    if (to == null) return
    e.preventDefault()
    touched.current = true
    setPos(Math.max(0, Math.min(100, to)))
  }
  const p = Math.round(pos)
  return (
    <>
      <div
        ref={box}
        className="wfx-compare"
        onPointerDown={(e) => {
          touched.current = true
          box.current.setPointerCapture(e.pointerId)
          fromPointer(e)
        }}
        onPointerMove={(e) => box.current.hasPointerCapture(e.pointerId) && fromPointer(e)}
      >
        <video ref={before} src={fileUrl(dir, pair.before)} poster={fileUrl(dir, posterOf(pair.before))} muted loop playsInline preload="auto" aria-hidden="true" />
        <video ref={after} className="wfx-after" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} src={fileUrl(dir, pair.after)} poster={fileUrl(dir, posterOf(pair.after))} muted loop playsInline preload="auto" aria-hidden="true" />
        <span className="wfx-tag wfx-tag-before mono">Before</span>
        <span className="wfx-tag wfx-tag-after mono">After</span>
        <div
          className="wfx-line"
          style={{ left: `${pos}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Compare before and after"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={p}
          aria-valuetext={`Before ${p}%, after ${100 - p}%`}
          onKeyDown={key}
        >
          <span className="wfx-handle" aria-hidden="true">
            ‹ ›
          </span>
        </div>
      </div>
      <Controls {...v} sound={false} />
    </>
  )
}

// The labelled parts under a video (shots, scenes, effects), the one playing lit
function Strip({ parts, t }) {
  return (
    <ol className="wfx-strip" aria-label="Parts">
      {parts.map((s) => {
        const on = t >= s.start && t < s.end
        return (
          <li key={s.label} className={on ? 'on' : ''} style={{ flexGrow: s.end - s.start }} aria-current={on ? 'true' : undefined}>
            <span className="mono small">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Steps({ dir, ex, still }) {
  const main = useRef(null)
  const v = useVideos(main, [], { stillStart: still })
  const [t, setT] = useState(0)
  return (
    <>
      <div className={`wfx-steps ${ex.tall ? 'tall' : ''} ${ex.inputs.length > 3 ? 'many' : ''}`}>
        <ol className="wfx-inputs" aria-label="What went in">
          {ex.inputs.map((x) => (
            <li key={x.picture}>
              <img src={fileUrl(dir, x.picture)} alt={x.label || ''} />
              {x.label && <span className="mono small dim">{x.label}</span>}
            </li>
          ))}
        </ol>
        <span className="wfx-arrow" aria-hidden="true">
          →
        </span>
        <div className="wfx-result">
          <video ref={main} src={fileUrl(dir, ex.video)} poster={fileUrl(dir, posterOf(ex.video))} muted loop playsInline preload="auto" aria-label="What came out" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
        </div>
      </div>
      {ex.strip && <Strip parts={ex.strip} t={t} />}
      <Controls {...v} sound={ex.sound} />
    </>
  )
}

function Single({ dir, ex, still }) {
  const main = useRef(null)
  const v = useVideos(main, [], { stillStart: still })
  const [t, setT] = useState(0)
  return (
    <>
      <div className="wfx-single">
        <video ref={main} src={fileUrl(dir, ex.video)} poster={fileUrl(dir, posterOf(ex.video))} muted loop playsInline preload="auto" onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} />
      </div>
      {ex.strip && <Strip parts={ex.strip} t={t} />}
      <Controls {...v} sound={ex.sound} />
    </>
  )
}

export default function WorkflowExample({ workflow, dir, onClose, onTry }) {
  const ex = workflow.example
  const [tab, setTab] = useState(0)
  const tryRef = useRef(null)
  const dialog = useRef(null)
  const [still] = useState(() => reducedMotion())
  const pair = ex.kind === 'compare' ? ex.tabs[tab] : null
  const text = pair?.text || ex.text
  const close = useCallback(() => onClose(), [onClose])
  useEffect(() => {
    tryRef.current?.focus()
    // Esc closes; Tab and Shift+Tab stay inside the pop-up
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'Tab') {
        const f = [...dialog.current.querySelectorAll('button, [tabindex="0"], video[controls]')].filter((x) => !x.disabled && x.offsetParent !== null)
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [close])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialog} className="modal wf-example" role="dialog" aria-modal="true" aria-labelledby="wf-example-title" aria-describedby="wf-example-text">
        <div className="modal-head">
          <h2 id="wf-example-title">Example</h2>
          <span className="mono small pink">{workflow.name}</span>
          <span className="spacer" />
          <button className="lora-chip-x" aria-label="Close the example" onClick={close}>
            ×
          </button>
        </div>
        {ex.kind === 'compare' && ex.tabs.length > 1 && (
          <div className="segmented wfx-tabs" role="group" aria-label="Examples">
            {ex.tabs.map((t, i) => (
              <button key={t.label} className={i === tab ? 'on' : ''} aria-pressed={i === tab} onClick={() => setTab(i)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        {!dir ? (
          <p className="small dim">Loading the example…</p>
        ) : ex.kind === 'compare' ? (
          <Compare key={tab} dir={dir} pair={pair} still={still} />
        ) : ex.kind === 'steps' ? (
          <Steps dir={dir} ex={ex} still={still} />
        ) : (
          <Single dir={dir} ex={ex} still={still} />
        )}
        <p id="wf-example-text" className="wfx-text">
          {text}
        </p>
        <div className="modal-foot">
          <span className="small dim">Made in IV Studio on one PC.</span>
          <span className="spacer" />
          <button className="btn btn-small" onClick={close}>
            Close
          </button>
          <button ref={tryRef} className="btn btn-small btn-primary" onClick={onTry}>
            Try it →
          </button>
        </div>
      </div>
    </div>
  )
}
