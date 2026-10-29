import { useCallback, useEffect, useRef, useState } from 'react'
import { media } from '../media'
import { Progress } from './Shot'
import Hero from './Hero'
import TileDelete from './TileDelete'
import PromptWriter, { StoryWriter } from './PromptWriter'

const DONE = ['success', 'error', 'cancelled']
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const SIZES = [0.6, 0.9, 1.2]
const RETAKE_MODES = [
  ['both', 'Picture and sound'],
  ['video', 'Picture only'],
  ['audio', 'Sound only']
]
// Measured on an RTX 4090: a 0.4 MP take renders at about 19 s per second of video; time grows with pixels.
const estimateMinutes = (seconds, mp) => Math.max(1, Math.round((seconds * 19 * (mp / 0.4)) / 60))
const newId = () => Math.random().toString(36).slice(2, 8)

const SHOT_HINT =
  'Shots join into one continuous video. Describe the place the same way in every shot. Each later shot opens holding the previous shot\'s closing pose and stays quiet for about two seconds before anyone speaks. Every shot ends settled, with the line finished and about two seconds to spare. Keep lines to about 15 words for 10 s shots, 27 for 15 s. Write {char} where the character goes; dialogue as <d>[English] Your line.</d>'

export function SequenceList({ openSequence, notify }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    window.ivstudio.sequences.list().then(setList)
  }, [])

  async function create() {
    try {
      openSequence((await window.ivstudio.sequences.create({ name: 'Untitled sequence' })).id)
    } catch (err) {
      notify(err.message)
    }
  }

  return (
    <div className="sequences">
      <Hero title="Sequences" kicker="Infinite Variance" />
      <p className="lede">
        Several shots that play as one continuous video.
        <span className="lede-small dim">Write the shots, render them as one seamless take or shot by shot, redo any stretch, then render out the final.</span>
      </p>
      <button className="btn btn-primary" onClick={create}>
        New sequence
      </button>
      <div className="tiles seq-tiles">
        {list?.map((s) => (
          <div key={s.id} className="tile-wrap">
          <button className="tile" onClick={() => openSequence(s.id)}>
            <div className="tile-body">
              <span className="tile-name">{s.name}</span>
              <span className="mono dim">
                {s.shots} shot{s.shots === 1 ? '' : 's'} · {s.method === 'take' ? 'one take' : 'shot by shot'} · {s.versions} version{s.versions === 1 ? '' : 's'} · {s.renders} final{s.renders === 1 ? '' : 's'}
              </span>
              <span className="mono dim">{new Date(s.updatedAt).toLocaleString()}</span>
            </div>
          </button>
          <TileDelete name={s.name} notify={notify} onDelete={async () => (await window.ivstudio.sequences.delete(s.id), setList(await window.ivstudio.sequences.list()))} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Seg({ value, options, onChange, format = (v) => v }) {
  return (
    <div className="segmented">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, format(o)]
        return (
          <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ShotCard({ shot, i, count, onChange, onMove, onDuplicate, onDelete, writer }) {
  const [writing, setWriting] = useState(false)
  return (
    <div className="seq-shot">
      <div className="seq-shot-head">
        <span className="seq-shot-no">Shot {i + 1}</span>
        <div className="seq-shot-tools">
          <button className="link-btn mono" disabled={i === 0} onClick={() => onMove(-1)} title="Move up">
            ↑
          </button>
          <button className="link-btn mono" disabled={i === count - 1} onClick={() => onMove(1)} title="Move down">
            ↓
          </button>
          <button className="link-btn mono" onClick={() => setWriting(!writing)}>
            {writing ? 'Hide writer' : '✦ Write it for me'}
          </button>
          <button className="link-btn mono" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="link-btn mono danger" disabled={count === 1} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {writing && <PromptWriter compact context={writer.context} current={shot.prompt} onWritten={(prompt) => onChange({ prompt })} notify={writer.notify} go={writer.go} />}
      <textarea className="prompt seq-prompt" rows={5} value={shot.prompt} placeholder="{char} sits at the kitchen table… and says: <d>[English] …</d>" onChange={(e) => onChange({ prompt: e.target.value })} />
    </div>
  )
}

// Pick a stretch of a version and redo it.
function RetakePanel({ version, onStart, notify }) {
  const video = useRef(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState([0, 3])
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('both')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setRange((r) => (k === 0 ? [Math.min(v, r[1] - 0.2), r[1]] : [r[0], Math.max(v, r[0] + 0.2)]))
  const at = () => +(video.current?.currentTime || 0).toFixed(1)

  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.sequences.retake(version.seqId, { versionId: version.id, prompt, start: range[0], end: range[1], mode }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="finish-panel">
      <p className="mono label">Retake part of {version.label}</p>
      <video ref={video} className="final-video" src={media(version.file.url)} controls preload="metadata" onLoadedMetadata={(e) => setDuration(+e.target.duration.toFixed(1))} />
      <div className="timeline">
        <div className="timeline-track">
          <span className="timeline-sel" style={{ left: `${(range[0] / (duration || 1)) * 100}%`, width: `${((range[1] - range[0]) / (duration || 1)) * 100}%` }} />
        </div>
        <input type="range" min={0} max={duration || 1} step={0.1} value={range[0]} onChange={(e) => set(0, Number(e.target.value))} />
        <input type="range" min={0} max={duration || 1} step={0.1} value={range[1]} onChange={(e) => set(1, Number(e.target.value))} />
      </div>
      <div className="row">
        <span className="row-label">Stretch</span>
        <div className="seed">
          <span className="mono">
            {range[0].toFixed(1)}–{range[1].toFixed(1)} s
          </span>
          <button className="btn btn-small" onClick={() => set(0, at())}>
            Start at playhead
          </button>
          <button className="btn btn-small" onClick={() => set(1, at())}>
            End at playhead
          </button>
        </div>
      </div>
      <div className="row">
        <span className="row-label">Redo</span>
        <Seg value={mode} options={RETAKE_MODES} onChange={setMode} />
      </div>
      <textarea className="prompt" rows={4} value={prompt} placeholder="What happens in this stretch, written like a shot prompt. {char} works here too." onChange={(e) => setPrompt(e.target.value)} />
      <div className="finish-go">
        <span className="mono dim">Everything outside the stretch stays as it is. Takes several minutes: the whole video is re-encoded.</span>
        <button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={go}>
          {busy ? 'Starting…' : 'Retake'}
        </button>
      </div>
    </div>
  )
}

function RenderOutPanel({ version, method, onStart, notify, caps }) {
  const FPS = caps?.fps || [0, 30, 50, 60, 120]
  const [opts, setOpts] = useState({ normalize: method === 'shots', scale: 1, fps: 0 })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.sequences.renderOut(version.seqId, { versionId: version.id, ...opts }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="finish-panel">
      <p className="mono label">Render out {version.label}</p>
      <div className="row">
        <span className="row-label">Smooth colour</span>
        <Seg value={opts.normalize} options={[[false, 'Off'], [true, 'On']]} onChange={(normalize) => set({ normalize })} />
      </div>
      <div className="row">
        <span className="row-label">{caps?.dlss === false ? '2× upscale' : 'RTX upscale'}</span>
        <Seg value={opts.scale} options={[[1, 'Off'], [2, '2×']]} onChange={(scale) => set({ scale })} />
      </div>
      <div className="row">
        <span className="row-label">Frame rate</span>
        <Seg value={opts.fps} options={FPS} format={(f) => (f ? f : '24')} onChange={(fps) => set({ fps })} />
      </div>
      <div className="finish-go">
        <span className="mono dim">{caps?.dlss === false ? 'Cloud finish' : 'DLSS clean-up'}{opts.normalize ? ', colour matched across the joins' : ''}.</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : 'Render out'}
        </button>
      </div>
    </div>
  )
}

// Shot by shot: hunt, pick and finish each shot in order.
function ShotRow({ seqId, i, shot, state, live, onStart, notify, flush }) {
  const [picked, setPicked] = useState(1)
  const [busy, setBusy] = useState(false)
  const pj = state?.previews && (live[state.previews.id] || state.previews)
  const fj = state?.finish && (live[state.finish.id] || state.finish)
  const previews = pj?.outputs?.filter((o) => o.kind === 'preview') || []
  const status = state?.fresh ? 'Finished' : state?.stale ? 'Changed since it was rendered' : fj && !DONE.includes(fj.status) ? 'Finishing' : pj && !DONE.includes(pj.status) ? 'Hunting' : previews.length ? 'Pick a preview' : 'Not started'

  async function act(fn) {
    setBusy(true)
    try {
      await flush()
      onStart(await fn())
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`seq-row ${state?.fresh ? 'done' : ''}`}>
      <div className="seq-row-head">
        <span className="seq-shot-no">Shot {i + 1}</span>
        <span className={`mono small ${state?.stale ? 'pink' : 'dim'}`}>{status}</span>
        <span className="dim small seq-row-prompt">{shot.prompt.slice(0, 90)}</span>
        <button className="btn btn-small" disabled={busy || !state?.ready || !shot.prompt.trim() || (pj && !DONE.includes(pj.status))} onClick={() => act(() => window.ivstudio.sequences.huntShot(seqId, i, {}))} title={state?.ready ? '' : `Finish shot ${i} first`}>
          {pj ? 'Hunt again' : i === 0 ? 'Hunt 3 previews' : 'Render preview'}
        </button>
      </div>
      <Progress job={pj} />
      <Progress job={fj} />
      {pj?.status === 'error' && <p className="notice">{pj.error}</p>}
      {fj?.status === 'error' && <p className="notice">{fj.error}</p>}
      {previews.length > 0 && !state?.fresh && (
        <>
          <div className={`candidates n${previews.length}`}>
            {previews.map((o) => (
              <figure key={o.candidate} className={`candidate ${picked === o.candidate ? 'on' : ''}`}>
                <video src={media(o.url)} controls loop preload="metadata" />
                <figcaption>
                  <span className="mono">#{o.candidate}</span>
                  {previews.length > 1 && (
                    <button className="btn btn-small" onClick={() => setPicked(o.candidate)}>
                      {picked === o.candidate ? 'Picked' : 'Pick'}
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
          <button className="btn btn-primary seq-use" disabled={busy || (fj && !DONE.includes(fj.status))} onClick={() => act(() => window.ivstudio.sequences.finishShot(seqId, i, { candidate: picked }))}>
            Use #{picked}
          </button>
        </>
      )}
      {state?.fresh && state.raw && <video className="seq-row-video" src={media(state.raw.url)} controls preload="metadata" />}
    </div>
  )
}

export function SequenceEditor({ sequenceId, characters, notify, go, jobs: live, caps, remote }) {
  const [seq, setSeq] = useState(null)
  const [view, setView] = useState(null)
  const [panel, setPanel] = useState(null) // {kind: 'retake'|'out', versionId}
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef(null)
  const pendingSave = useRef(null)

  const load = useCallback(async () => {
    const v = await window.ivstudio.sequences.get(sequenceId)
    setView(v)
    setSeq((s) => s || v.sequence)
    const open = v.sequence.jobs.filter((id) => {
      const all = [...v.versions.map((x) => x.job), ...v.renders.map((x) => x.job), ...v.shots.flatMap((x) => [x.previews, x.finish])].filter(Boolean)
      const j = all.find((x) => x.id === id)
      return j && !DONE.includes(j.status)
    })
    if (open.length) window.ivstudio.jobs.watch(open)
    return v
  }, [sequenceId])

  useEffect(() => {
    load()
  }, [load])

  // Reload when a job of this sequence changes state.
  const liveKey = view ? view.sequence.jobs.map((id) => live[id]?.status || '').join() : ''
  useEffect(() => {
    if (view) load()
  }, [liveKey])

  async function flush() {
    clearTimeout(saveTimer.current)
    if (pendingSave.current) {
      const patch = pendingSave.current
      pendingSave.current = null
      await window.ivstudio.sequences.save(sequenceId, patch)
    }
  }
  // Edits show at once and save half a second after the last change (flush() saves before any render).
  function edit(patch) {
    setSeq((s) => ({ ...s, ...patch }))
    pendingSave.current = { ...(pendingSave.current || {}), ...patch }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flush().then(load).catch((err) => notify(err.message)), 500)
  }
  useEffect(() => () => flush(), [])

  const shots = seq?.shots || []
  const setShot = (i, patch) => edit({ shots: shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const moveShot = (i, d) => {
    const next = [...shots]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    edit({ shots: next })
  }

  async function act(fn) {
    setBusy(true)
    try {
      await flush()
      const job = await fn()
      window.ivstudio.jobs.watch([job.id])
      await load()
      setPanel(null)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const onStart = (job) => {
    window.ivstudio.jobs.watch([job.id])
    load()
    setPanel(null)
  }

  if (!seq || !view) return null
  const char = characters.find((c) => c.id === seq.character)
  const total = shots.length * seq.shotSeconds
  const takeRunning = view.versions.some((v) => v.kind === 'take' && v.job && !DONE.includes((live[v.job.id] || v.job).status))

  return (
    <div className="sequence">
      <Hero back={{ label: 'All sequences', onClick: () => go('sequences') }} kicker={`Sequence · ${shots.length} shot${shots.length === 1 ? '' : 's'}`}>
        <input className="shot-name" value={seq.name} onChange={(e) => edit({ name: e.target.value })} />
      </Hero>

      <section className="block">
        <div className="prompt-head">
          <p className="mono label">01 · Shots</p>
          <span className="mono dim small">{char ? <>Write {'{char}'} for {char.name.split(' ')[0]} ({char.trigger})</> : 'No character'}</span>
        </div>
        <StoryWriter
          character={seq.character}
          shotSeconds={seq.shotSeconds}
          existing={shots.filter((s) => s.prompt.trim()).length}
          onShots={(list) => edit({ shots: list.map((prompt, k) => ({ id: shots[k]?.id || newId(), prompt, mode: 'text', media: [] })) })}
          notify={notify}
        />
        <details className="seq-hint">
          <summary className="mono dim">How to write shots that join cleanly</summary>
          <p className="small dim">{SHOT_HINT}</p>
        </details>
        {shots.map((s, i) => (
          <ShotCard
            key={s.id}
            shot={s}
            i={i}
            count={shots.length}
            onChange={(p) => setShot(i, p)}
            onMove={(d) => moveShot(i, d)}
            onDuplicate={() => edit({ shots: [...shots.slice(0, i + 1), { ...s, id: newId() }, ...shots.slice(i + 1)] })}
            onDelete={() => edit({ shots: shots.filter((_, j) => j !== i) })}
            writer={{ notify, go, context: { mode: 'text', seconds: seq.shotSeconds, aspect: seq.aspect, character: seq.character, sequence: true, previous: i > 0 ? shots[i - 1].prompt : null } }}
          />
        ))}
        <button className="btn btn-small seq-add" disabled={shots.length >= 8} onClick={() => edit({ shots: [...shots, { id: newId(), prompt: '', mode: 'text', media: [] }] })}>
          + Add shot
        </button>
      </section>

      <section className="block">
        <p className="mono label">02 · Settings</p>
        <div className="row">
          <span className="row-label">Render</span>
          <Seg value={seq.method} options={[['take', 'One take'], ['shots', 'Shot by shot']]} onChange={(method) => edit({ method })} />
        </div>
        <p className="small dim seq-method-hint">
          {seq.method === 'take'
            ? 'All shots render together as one seamless take: no cuts, matched colour, unbroken sound. All or nothing.'
            : 'Hunt and pick each shot in turn; each one carries on from the end of the shot before. Change a shot and only the shots after it need redoing.'}
        </p>
        <div className="row">
          <span className="row-label">Character</span>
          <Seg value={seq.character} options={[...characters.map((c) => [c.id, c.name.split(' ')[0]]), ['none', 'None']]} onChange={(character) => edit({ character })} />
        </div>
        <div className="row">
          <span className="row-label">Aspect</span>
          <Seg value={seq.aspect} options={ASPECTS} onChange={(aspect) => edit({ aspect })} />
        </div>
        <div className="row">
          <span className="row-label">Size</span>
          <Seg value={seq.megapixels} options={SIZES} format={(mp) => `${mp} MP`} onChange={(megapixels) => edit({ megapixels })} />
        </div>
        <div className="row">
          <span className="row-label">Shot length</span>
          <Seg value={seq.shotSeconds} options={[[10, '10 s'], [15, '15 s']]} onChange={(shotSeconds) => edit({ shotSeconds })} />
        </div>
        <div className="row">
          <span className="row-label">Seed</span>
          <div className="seed">
            <input type="number" value={seq.seed} onChange={(e) => edit({ seed: Math.max(0, Number(e.target.value) || 0) })} />
            <button className="btn btn-small" onClick={() => edit({ seed: Math.floor(Math.random() * 1e9) })}>
              🎲 New seed
            </button>
          </div>
        </div>
        {seq.method === 'take' && (
          <div className="row">
            <span className="row-label">Voice sample</span>
            <div className="voice-control">
              <button
                className="btn btn-small"
                onClick={async () => {
                  const [file] = await window.ivstudio.files.pick('audio')
                  if (file) edit({ voiceRef: file })
                }}
              >
                {seq.voiceRef ? 'Change' : '+ Voice to keep'}
              </button>
              {seq.voiceRef ? (
                <>
                  <span className="mono small">{seq.voiceRef.split(/[\\/]/).pop()}</span>
                  <button className="link-btn mono" onClick={() => edit({ voiceRef: null })}>
                    Remove
                  </button>
                </>
              ) : (
                <span className="dim small">Optional. A short clean recording the whole take keeps as the voice.</span>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="block">
        <p className="mono label">03 · Render</p>
        <div className="summary mono">
          <span>
            {shots.length} shot{shots.length === 1 ? '' : 's'} · {total} s
          </span>
          <span className="dim">
            roughly {estimateMinutes(total, seq.megapixels)} min{seq.method === 'shots' ? ' in total, plus picking' : ''}
          </span>
        </div>
        {seq.method === 'take' ? (
          <button className="btn btn-primary big" disabled={busy || takeRunning || shots.some((s) => !s.prompt.trim())} onClick={() => act(() => window.ivstudio.sequences.take(sequenceId))}>
            {takeRunning ? 'Rendering…' : view.versions.some((v) => v.kind === 'take') ? 'Render another take' : 'Render take'}
          </button>
        ) : (
          shots.map((s, i) => <ShotRow key={s.id} seqId={sequenceId} i={i} shot={s} state={view.shots[i]} live={live} onStart={onStart} notify={notify} flush={flush} />)
        )}
      </section>

      <section className="block">
        <p className="mono label">04 · Versions</p>
        {view.versions.length === 0 && <p className="dim small">Renders, the shot-by-shot result and retakes appear here.</p>}
        {view.versions.map((v) => {
          const j = v.job && (live[v.job.id] || v.job)
          const ver = { ...v, seqId: sequenceId }
          return (
            <div key={v.id} className="final">
              <div className="final-head">
                <span className="mono pink">{v.label}</span>
                {j?.seconds ? <span className="mono dim">{j.seconds} s render</span> : null}
                {v.file?.path && (
                  <>
                    <button className="link-btn mono" onClick={() => setPanel(panel?.versionId === v.id && panel.kind === 'retake' ? null : { kind: 'retake', versionId: v.id })}>
                      Retake…
                    </button>
                    <button className="link-btn mono" onClick={() => setPanel(panel?.versionId === v.id && panel.kind === 'out' ? null : { kind: 'out', versionId: v.id })}>
                      Render out…
                    </button>
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(v.file).catch((err) => notify(err.message))}>
                      {remote ? 'Download' : 'Show in folder'}
                    </button>
                  </>
                )}
              </div>
              <Progress job={j} />
              {j?.status === 'error' && <p className="notice">{j.error}</p>}
              {v.prompt && <p className="mono dim small">{v.prompt}</p>}
              {panel?.versionId === v.id && panel.kind === 'retake' ? (
                <RetakePanel version={ver} onStart={onStart} notify={notify} />
              ) : (
                v.file && <video className="final-video" src={media(v.file.url)} controls preload="metadata" />
              )}
              {panel?.versionId === v.id && panel.kind === 'out' && <RenderOutPanel version={ver} method={seq.method} onStart={onStart} notify={notify} caps={caps} />}
            </div>
          )
        })}
      </section>

      {view.renders.length > 0 && (
        <section className="block">
          <p className="mono label">05 · Finals</p>
          {view.renders.map((r) => {
            const j = r.job && (live[r.job.id] || r.job)
            const v = view.versions.find((x) => x.id === r.versionId)
            return (
              <div key={r.id} className="final">
                <div className="final-head">
                  <span className="mono pink">Final of {v?.label || r.versionId}</span>
                  <span className="mono dim">
                    {r.normalize ? 'colour smoothed · ' : ''}
                    {r.scale === 2 ? 'RTX 2× · ' : ''}
                    {r.fps || 24} fps{j?.seconds ? ` · ${j.seconds} s render` : ''}
                  </span>
                  {r.file?.path && (
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(r.file).catch((err) => notify(err.message))}>
                      {remote ? 'Download' : 'Show in folder'}
                    </button>
                  )}
                </div>
                <Progress job={j} />
                {j?.status === 'error' && <p className="notice">{j.error}</p>}
                {r.file && <video className="final-video" src={media(r.file.url)} controls preload="metadata" />}
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}
