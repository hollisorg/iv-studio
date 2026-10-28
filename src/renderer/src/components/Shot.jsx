import { useCallback, useEffect, useMemo, useState } from 'react'
import { media } from '../media'
import Hero from './Hero'

const DONE = ['success', 'error', 'cancelled']
const FINAL_MP = [1, 1.5, 2]
const FPS = [0, 30, 50, 60, 120]

export function Progress({ job }) {
  if (!job || DONE.includes(job.status)) return null
  const p = job.progress
  const pct = p ? Math.round((p.value / p.max) * 100) : null
  return (
    <div className="progress">
      <div className="bar">
        <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
      </div>
      <span className="mono dim">
        {job.status === 'queued' ? `Queued${job.queuePosition ? ` · #${job.queuePosition}` : ''}` : p ? `Step ${p.value}/${p.max}` : 'Working…'}
      </span>
      <button className="link-btn mono" onClick={() => window.ivstudio.jobs.cancel(job.id)}>
        Cancel
      </button>
    </div>
  )
}

function FinishPanel({ job, candidate, onStart, notify }) {
  const [opts, setOpts] = useState({ megapixels: 2, upscale2x: false, fps: 0, audio: 'pass' })
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  const single = job.plan.request?.mode === 'continue'
  const hasVoice = !!job.plan.request?.voiceLine

  useEffect(() => {
    window.ivstudio.render
      .planFinish(job.id, { candidate, ...opts })
      .then(setSize)
      .catch(() => setSize(null))
  }, [opts, job.id, candidate])

  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.render.finish({ jobId: job.id, candidate, ...opts }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="finish-panel">
      <p className="mono label">Finish candidate {candidate}</p>
      {!single && (
        <div className="row">
          <span className="row-label">Final size</span>
          <div className="segmented">
            {FINAL_MP.map((mp) => (
              <button key={mp} className={opts.megapixels === mp ? 'on' : ''} onClick={() => set({ megapixels: mp })}>
                {mp} MP
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row">
        <span className="row-label">RTX upscale</span>
        <div className="segmented">
          <button className={!opts.upscale2x ? 'on' : ''} onClick={() => set({ upscale2x: false })}>
            Off
          </button>
          <button className={opts.upscale2x ? 'on' : ''} onClick={() => set({ upscale2x: true })}>
            2×
          </button>
        </div>
      </div>
      <div className="row">
        <span className="row-label">Frame rate</span>
        <div className="segmented">
          {FPS.map((f) => (
            <button key={f} className={opts.fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>
              {f ? f : '24'}
            </button>
          ))}
        </div>
      </div>
      {!single && (
        <div className="row">
          <span className="row-label">Sound</span>
          <div className="segmented">
            <button className={opts.audio === 'pass' ? 'on' : ''} onClick={() => set({ audio: 'pass' })}>
              Generated
            </button>
            <button className={opts.audio === 'preview' ? 'on' : ''} onClick={() => set({ audio: 'preview' })} title="Keeps a voice cloned from an <Audio> reference or RefMod">
              Preview's
            </button>
            {hasVoice && (
              <button className={opts.audio === 'voice' ? 'on' : ''} onClick={() => set({ audio: 'voice' })}>
                My recording
              </button>
            )}
          </div>
        </div>
      )}
      <div className="finish-go">
        <span className="mono">{size ? `${size.width} × ${size.height} · ${size.fps} fps${single ? ' · single pass' : ''}` : '…'}</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : 'Finish'}
        </button>
      </div>
    </div>
  )
}

export default function Shot({ projectId, jobs: live, setJobs, notify, go }) {
  const [project, setProject] = useState(null)
  const [jobIds, setJobIds] = useState([])
  const [picked, setPicked] = useState({})
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    const { project, jobs } = await window.ivstudio.projects.get(projectId)
    setProject(project)
    setName(project.name)
    setJobIds(jobs.map((j) => j.id))
    setJobs((all) => ({ ...all, ...Object.fromEntries(jobs.map((j) => [j.id, all[j.id] && !DONE.includes(j.status) ? all[j.id] : j])) }))
    const open = jobs.filter((j) => !DONE.includes(j.status)).map((j) => j.id)
    if (open.length) window.ivstudio.jobs.watch(open)
  }, [projectId, setJobs])

  useEffect(() => {
    load()
  }, [load])

  const jobs = useMemo(() => jobIds.map((id) => live[id]).filter(Boolean), [jobIds, live])
  const runs = jobs.filter((j) => j.kind === 'previews').reverse()
  const finishesOf = (id) => jobs.filter((j) => j.parent === id).reverse()

  const onStart = (job) => {
    setJobIds((ids) => [...ids, job.id])
    setJobs((all) => ({ ...all, [job.id]: job }))
  }

  if (!project) return null

  return (
    <div className="shot">
      <Hero back={{ label: 'All shots', onClick: () => go('library') }} kicker={`Shot · ${runs.length} run${runs.length === 1 ? '' : 's'}`}>
        <input className="shot-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== project.name && window.ivstudio.projects.rename(projectId, name)} />
      </Hero>
      <div className="shot-actions">
        <button className="btn btn-small" onClick={() => go('create')}>
          New run
        </button>
      </div>

      {runs.length === 0 && <p className="dim">No runs yet.</p>}
      {runs.map((run, i) => {
        const previews = run.outputs.filter((o) => o.kind === 'preview')
        const req = run.plan.request || {}
        return (
          <section key={run.id} className="run">
            <div className="run-head">
              <h2>Run {runs.length - i}</h2>
              <span className="mono dim">
                {req.mode} · {run.plan.resolved?.width}×{run.plan.resolved?.height} · {run.plan.resolved?.seconds} s · seed {req.seed}
                {run.seconds ? ` · ${run.seconds} s render` : ''}
              </span>
            </div>
            <Progress job={run} />
            {run.status === 'error' && <p className="notice">{run.error}</p>}
            {req.prompt && <details className="run-prompt"><summary className="mono dim">Prompt</summary><pre>{req.prompt}</pre></details>}
            {previews.length > 0 && (
              <div className={`candidates n${previews.length}`}>
                {previews.map((o) => (
                  <figure key={o.candidate} className={`candidate ${picked[run.id] === o.candidate ? 'on' : ''}`}>
                    <video src={media(o.url)} controls loop preload="metadata" />
                    <figcaption>
                      <span className="mono">#{o.candidate} · seed {o.seed}</span>
                      <button className="btn btn-small" onClick={() => setPicked({ ...picked, [run.id]: o.candidate })}>
                        {picked[run.id] === o.candidate ? 'Picked' : 'Pick'}
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
            {picked[run.id] && <FinishPanel job={run} candidate={picked[run.id]} onStart={onStart} notify={notify} />}
            {finishesOf(run.id).map((f) => {
              const final = f.outputs.find((o) => o.kind === 'final')
              return (
                <div key={f.id} className="final">
                  <div className="final-head">
                    <span className="mono pink">Final · candidate {f.plan.finish?.candidate}</span>
                    <span className="mono dim">
                      {f.plan.resolved?.width}×{f.plan.resolved?.height} · {f.plan.resolved?.fps} fps{f.seconds ? ` · ${f.seconds} s render` : ''}
                    </span>
                    {final?.path && (
                      <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(final.path)}>
                        Show in folder
                      </button>
                    )}
                  </div>
                  <Progress job={f} />
                  {f.status === 'error' && <p className="notice">{f.error}</p>}
                  {final && <video className="final-video" src={media(final.url)} controls preload="metadata" />}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
