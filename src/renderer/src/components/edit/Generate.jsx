import { useEffect, useState } from 'react'
import { media } from '../../media'
import { fileUrl } from './model'

// New footage from inside the edit: the right-click menu, the dialog for each kind, and picking a bridge's
// previews. The work itself happens in the main process (src/service/editgen.js); placeholders on the timeline
// show it until the clip lands.

export const GEN_LABEL = { extend: 'Extend', bridge: 'Bridge', fill: 'Fill', retake: 'Retake' }
const RETAKE = [
  ['both', 'Redo the moment', 'New picture and sound'],
  ['video', 'Picture only', 'Keeps the performance and the audio'],
  ['audio', 'Sound only', 'Keeps the picture']
]

// A small right-click menu at the pointer. items: [{ label, hint, onClick, disabled }]
export function ContextMenu({ x, y, items, onClose }) {
  useEffect(() => {
    const close = () => onClose()
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [])
  return (
    <div className="tl-menu" style={{ left: Math.min(x, window.innerWidth - 280), top: Math.min(y, window.innerHeight - 40 * items.length - 20) }} onPointerDown={(e) => e.stopPropagation()}>
      {items.map((it, i) =>
        it === '-' ? (
          <div key={i} className="tl-menu-sep" />
        ) : (
          <button key={i} className="tl-menu-item" disabled={it.disabled} onClick={() => (onClose(), it.onClick())}>
            <span>{it.label}</span>
            {it.hint && <span className="mono small dim">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}

// The dialog for one generation. spec: { kind: 'extend' | 'bridge' | 'retake', clip, next, gap, from, to }
export function GenDialog({ edit, spec, characters, notify, onStart, onClose }) {
  const kind = spec.gap ? 'fill' : spec.kind
  const c = spec.clip ? edit.clips.find((x) => x.id === spec.clip) : null
  const m = c ? edit.media[c.media] : null
  const [prep, setPrep] = useState(null)
  const [prompt, setPrompt] = useState('')
  const [idea, setIdea] = useState('')
  const [character, setCharacter] = useState('none')
  const [seconds, setSeconds] = useState(spec.kind === 'extend' ? 5 : 3)
  const [mode, setMode] = useState('both')
  const [from, setFrom] = useState(spec.from ?? 0)
  const [to, setTo] = useState(spec.to ?? 0)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    const clip = spec.clip || edit.clips.filter((x) => x.track === spec.gap?.track && x.start + (x.out - x.in) <= spec.gap.from + 1e-3).sort((a, b) => b.start - a.start)[0]?.id
    const next = spec.next || (spec.gap && edit.clips.filter((x) => x.track === spec.gap.track && x.start >= spec.gap.to - 1e-3).sort((a, b) => a.start - b.start)[0]?.id)
    if (!clip) return
    window.ivstudio.edits
      .prepareGen(edit.id, { kind: spec.kind, clip, next })
      .then((p) => {
        setPrep(p)
        if (p.origin?.character) setCharacter(p.origin.character)
        if (p.origin?.prompt && spec.kind === 'retake') setPrompt(p.origin.prompt)
      })
      .catch((err) => notify(err.message))
  }, [])
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), onClose())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])

  // "Write it for me": the local writer looks at what the new footage starts from
  async function write() {
    setBusy('Writing…')
    try {
      const pics = [prep?.first, prep?.last].filter(Boolean).map((file) => ({ kind: 'picture', file }))
      const req =
        spec.kind === 'extend'
          ? { mode: 'continue', media: [{ kind: 'video', file: m.path }] }
          : spec.kind === 'bridge'
            ? { mode: 'frames', media: pics }
            : { mode: 'reference', media: [{ kind: 'video', file: m.path }] }
      setPrompt(await window.ivstudio.prompts.write({ ...req, idea, seconds: spec.kind === 'retake' ? Math.max(1, to - from) : seconds, aspect: prep?.aspect || '16:9', character }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function go() {
    setBusy('Starting…')
    try {
      await onStart({ ...spec, prompt, character, seconds, mode, from: Number(from), to: Number(to), extraLoras: prep?.origin?.extraLoras || [], aspect: prep?.aspect })
      onClose()
    } catch (err) {
      notify(err.message)
      setBusy(null)
    }
  }

  const gapLen = spec.gap ? spec.gap.to - spec.gap.from : 0
  const title = { extend: 'Extend this clip', bridge: 'Bridge to the next clip', fill: 'Fill this gap', retake: 'Retake this stretch' }[kind]
  const what = {
    extend: 'Carries the clip on from its last frames.',
    bridge: spec.next ? "A new shot that opens on this clip's last frame and lands on the next clip's first." : "A new shot that opens on this clip's last frame.",
    fill: `A new shot that opens on the clip before the gap and lands on the clip after it, ${gapLen.toFixed(2)} s long.`,
    retake: 'Renders this stretch again inside the clip. The rest of the clip stays as it is.'
  }[kind]
  return (
    <div className="gen-backdrop" onPointerDown={onClose}>
      <div className="gen-dialog" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="gen-head">
          <h2>{title}</h2>
          <button className="link-btn mono" onClick={onClose}>
            Close ×
          </button>
        </div>
        <p className="small dim">{what}</p>

        {(prep?.first || prep?.last) && (
          <div className="gen-frames">
            {prep.first && (
              <figure>
                <img src={fileUrl(prep.first)} alt="" />
                <figcaption className="mono small dim">Opens on</figcaption>
              </figure>
            )}
            {prep.last && (
              <figure>
                <img src={fileUrl(prep.last)} alt="" />
                <figcaption className="mono small dim">Lands on</figcaption>
              </figure>
            )}
          </div>
        )}
        {spec.kind === 'extend' && m && <video className="gen-source" src={`${fileUrl(m.path)}#t=${Math.max(0, c.out - 0.1)}`} muted preload="metadata" />}

        {spec.kind === 'extend' && (
          <div className="row tight">
            <span className="row-label">Length</span>
            <div className="segmented">
              {[5, 10, 15].map((s) => (
                <button key={s} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>
                  {s} s
                </button>
              ))}
            </div>
          </div>
        )}
        {kind === 'bridge' && (
          <div className="row tight">
            <span className="row-label">Length</span>
            <div className="segmented">
              {[2, 3, 5, 8].map((s) => (
                <button key={s} className={seconds === s ? 'on' : ''} onClick={() => setSeconds(s)}>
                  {s} s
                </button>
              ))}
            </div>
          </div>
        )}
        {spec.kind === 'retake' && (
          <>
            <div className="row tight">
              <span className="row-label">Stretch</span>
              <div className="gen-range mono">
                <input type="number" step="0.1" value={from} min={c?.start} max={to} onChange={(e) => setFrom(e.target.value)} />
                <span>to</span>
                <input type="number" step="0.1" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                <span className="dim">s on the timeline · {Math.max(0, to - from).toFixed(1)} s</span>
              </div>
            </div>
            <div className="gen-modes">
              {RETAKE.map(([id, label, hint]) => (
                <button key={id} className={`mode-card ${mode === id ? 'on' : ''}`} onClick={() => setMode(id)}>
                  <span className="mode-name">{label}</span>
                  <span className="dim small">{hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="row tight">
          <span className="row-label">Character</span>
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            <option value="none">None</option>
            {characters.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          {prep?.origin && <span className="mono small dim">from the clip's shot</span>}
        </div>

        <div className="gen-write">
          <input value={idea} placeholder={spec.kind === 'retake' ? 'What should happen instead, in plain words' : 'What happens, in plain words'} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && idea.trim() && !busy && write()} />
          <button className="btn btn-small" disabled={!idea.trim() || !!busy || !prep} onClick={write}>
            ✦ Write it for me
          </button>
        </div>
        <textarea className="prompt" rows={6} value={prompt} placeholder="The H3 prompt. Write {char} where the character goes." onChange={(e) => setPrompt(e.target.value)} />

        <div className="gen-foot">
          <span className="small dim">{kind === 'bridge' || kind === 'fill' ? 'Three previews to pick from, then the one you pick is finished.' : 'Renders on your GPU for a few minutes.'} It shows on the timeline while it works.</span>
          <button className="btn btn-primary" disabled={!prompt.trim() || !!busy || !prep} onClick={go}>
            {busy || 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// A bridge's three previews: watch them, pick one to finish.
export function PickDialog({ gen, onPick, onCancel, onClose }) {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && (e.stopImmediatePropagation(), onClose())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  return (
    <div className="gen-backdrop" onPointerDown={onClose}>
      <div className="gen-dialog wide" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Pick a take">
        <div className="gen-head">
          <h2>Pick a take</h2>
          <button className="link-btn mono" onClick={onClose}>
            Close ×
          </button>
        </div>
        <p className="small dim">{gen.name}. The one you pick is finished at full size and goes on the timeline.</p>
        <div className="gen-picks">
          {(gen.candidates || []).map((cand) => (
            <figure key={cand.n}>
              <video src={cand.path ? fileUrl(cand.path) : media(cand.url)} muted loop autoPlay playsInline />
              <figcaption>
                <span className="mono small dim">Take {cand.n}</span>
                <button
                  className="btn btn-small btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true)
                    await onPick(cand.n)
                    onClose()
                  }}
                >
                  Use this one
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="gen-foot">
          <button className="link-btn mono small" onClick={() => (onCancel(), onClose())}>
            None of them: remove it
          </button>
        </div>
      </div>
    </div>
  )
}
