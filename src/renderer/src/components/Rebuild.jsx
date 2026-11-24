import { useEffect, useState } from 'react'
import { FirstRenders } from './Speed'
import Hero from './Hero'
import Stage from './Stage'
import { ToolShelf, ShelfTile, Step, WorkflowNeeds } from './FlowKit'
import { SetCode } from './SettingsKit'
import TileDelete from './TileDelete'
import { fileUrl } from './edit/model'
import VoiceLines from './VoiceLines'
import { rebuildProgress, startRender } from '../renders'

// Rebuild: a video the person made (or may rework), read into shots and made again on this PC. IV Studio reads it
// (cuts, frames, captions, tempo); your agent (Claude Code or Codex, through IV Studio's tools) says what each shot
// is and writes the plan; you approve the plan and the frames here; H3 renders the new shots; a first cut lands in
// Edit with the original sound as a guide. rebuild.js does the work; the agent guide's "Rebuild" is the agent side.
const B = () => window.ivstudio.rebuild
const clean = (err) => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const KIND = { ai_video: 'AI video', live: 'Live action', code_graphics: 'Graphics', screen: 'Screen', still: 'Still', film_clip: 'Film clip', unsure: 'Unsure' }
const ROUTE = { h3: 'Remade with H3', still: 'Still with a push', keep: 'Kept', own: 'Your clip', replace: 'For Replace' }
const STATUS = { reading: 'Reading the shots', planning: 'Plan', approved: 'Plan approved', frames: 'Frames', rendering: 'Rendering', ready: 'Shots ready', editing: 'Cut in Edit' }
const PROGRESS = ['Read', 'Plan', 'Frames', 'Shots', 'Cut']
const secs = (n) => `${Number(n || 0).toFixed(1)} s`

// Where a rebuild is: 0 read, 1 plan, 2 frames, 3 shots, 4 cut.
function stageOf(r) {
  if (r.editId) return 4
  if (r.framesApprovedAt) return 3
  if (r.planApprovedAt) return 2
  if (r.status === 'reading') return 0
  return 1
}

function agentMessage(r) {
  const swap = r.swap?.ask ? ` The person wants this changed: "${r.swap.ask}".` : ''
  if (r.status === 'reading')
    return `Rebuild "${r.name}" with IV Studio's Rebuild workflow (rebuild id ${r.id}). IV Studio has already read it (${r.shots.length} shots), and the person has confirmed they made it or have the right to rework it.${swap}

1. Call get_guide and read "Rebuild".
2. get_rebuild ${r.id}, then look at each shot with view_rebuild_shot and say what it is with save_rebuild_reading.
3. Write the plan with save_rebuild_plan and show it to me: which shots H3 remakes and about how many GPU minutes. Wait for my OK (I can also approve it on the Rebuild page).`
  if (!r.plan) return `Carry on with rebuild ${r.id} ("${r.name}"): every shot is read. Write the plan with save_rebuild_plan (get_guide, "Rebuild", step 3) and show it to me before anything renders.`
  if (!r.planApprovedAt) return `The plan for rebuild ${r.id} ("${r.name}") is waiting for my OK. Change it with save_rebuild_plan if I ask; I approve it on the Rebuild page or tell you to (approve_rebuild_plan).`
  if (!r.framesApprovedAt) return `The plan for rebuild ${r.id} ("${r.name}") is approved. Make the frames with make_rebuild_frames, look at the before and after pictures, and show me. I approve them on the Rebuild page or tell you to (approve_rebuild_frames).`
  if (!r.editId) return `The frames for rebuild ${r.id} ("${r.name}") are approved. Render the shots with make_rebuild_shots, poll get_rebuild, look at each shot's previews when it says pick and choose the best (picks), then cut it with rebuild_first_cut. Tell me which shots are still the original footage.`
  return `Rebuild ${r.id} ("${r.name}") has a first cut in Edit. Work on it with the Edit tools, and remind me the guide sound on A1 must be replaced before I publish.`
}

export function RebuildList({ notify, openRebuild, go }) {
  const [list, setList] = useState(null)
  const [file, setFile] = useState(null)
  const [rights, setRights] = useState(false)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    B().list().then(setList)
    return B().onLog((line) => setBusy(line))
  }, [])
  async function read() {
    setBusy('Reading the video…')
    try {
      openRebuild((await B().read({ file, rights, swap: ask.trim() ? { ask: ask.trim() } : null })).id)
    } catch (err) {
      notify(clean(err))
      setBusy(null)
    }
  }
  const shown = (list || []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="rebuild flow-page">
      <Stage effect="film" art="rebuild" title="Rebuild" kicker="A video, taken apart and rebuilt" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        <div className="stage-panel rb-start">
          <button className="btn" onClick={async () => setFile((await B().pickVideo()) || file)}>
            {file ? 'Another video' : 'Choose a video'}
          </button>
          <span className="rb-file mono small">{file ? file.split(/[\\/]/).pop() : 'Up to 2 minutes'}</span>
          <input value={ask} placeholder="What changes? (optional)" title="Optional: what should change, e.g. put my character in place of the host" onChange={(e) => setAsk(e.target.value)} aria-label="What changes" />
          <button className="btn btn-primary" disabled={!file || !rights || !!busy} onClick={read}>
            {busy ? 'Reading…' : 'Read it'}
          </button>
        </div>
        <label className="rb-rights small">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />I made this video or I have the right to rework it
        </label>
        <p className="stage-note small">{busy || 'IV Studio finds the cuts, frames, captions and tempo; your agent says what each shot is and plans the remake; you approve the plan and the frames before anything renders.'}</p>
        <WorkflowNeeds page="rebuild" />
      </Stage>

      <ToolShelf label="Your rebuilds" count={shown.length} q={q} setQ={setQ} empty="None yet. Choose a video in the bar above.">
        {shown.map((r) => (
          <ShelfTile
            key={r.id}
            onOpen={() => openRebuild(r.id)}
            media={r.cover ? <img src={fileUrl(r.cover)} alt="" loading="lazy" /> : <span className="shelf-empty-art">Rebuild</span>}
            status={STATUS[r.status] || r.status}
            name={r.name}
            meta={[`${r.shots} shot${r.shots === 1 ? '' : 's'}`, secs(r.seconds)]}
            del={<TileDelete name={r.name} keeps="Its renders and its edit stay." notify={notify} onDelete={async () => (await B().delete(r.id), setList(await B().list()))} />}
          />
        ))}
      </ToolShelf>
    </div>
  )
}

// One shot in the storyboard strip: its picture (the new take's once finished), time, kind and route.
function StripTile({ s }) {
  const route = s.route || s.suggested
  return (
    <figure className={`rb-tile route-${route || 'none'} ${s.take?.final ? 'rebuilt' : ''}`} style={{ flexGrow: Math.max(1, Math.round(s.duration)) }}>
      <img src={fileUrl(s.middle || s.first)} alt={`Shot ${s.index}`} loading="lazy" />
      <figcaption className="mono small">
        <span>
          {s.index} · {secs(s.duration)}
        </span>
        {s.reading && <span className="rb-chip">{KIND[s.reading.kind] || s.reading.kind}</span>}
        {route && <span className={`rb-chip route ${s.route ? '' : 'suggested'}`}>{ROUTE[route]}{s.route ? '' : '?'}</span>}
        {s.take?.final && <span className="rb-chip done">Rebuilt</span>}
      </figcaption>
    </figure>
  )
}

export function RebuildProject({ rebuildId, notify, go, openEdit }) {
  const [r, setR] = useState(null)
  const [busy, setBusy] = useState(null)
  const [voices, setVoices] = useState([])
  const [voiceState, setVoiceState] = useState(null)
  const [voiceStep, setVoiceStep] = useState(null)
  const load = () => B().get(rebuildId).then(setR, (err) => notify(clean(err)))
  useEffect(() => {
    load()
    window.ivstudio.voices.list().then(setVoices, () => {})
    window.ivstudio.remake.voiceStatus().then(setVoiceState, () => {})
    const off = B().onVoiceProgress((u) => u.id === rebuildId && setVoiceStep(u.step))
    const off2 = B().onLog((line) => setBusy(line))
    return () => (off?.(), off2?.())
  }, [rebuildId])
  // keep it current: the agent works through the tools, and renders finish in ComfyUI
  useEffect(() => {
    const h = setInterval(load, r?.status === 'rendering' ? 8000 : 15000)
    return () => clearInterval(h)
  }, [r?.status])
  async function act(label, fn) {
    setBusy(label)
    try {
      const next = await fn()
      if (next?.shots) setR(next)
      else await load()
      return next
    } catch (err) {
      notify(clean(err))
    } finally {
      setBusy(null)
    }
  }
  if (!r) return null
  const at = stageOf(r)
  const h3 = r.shots.filter((s) => s.route === 'h3')
  const unread = r.shots.filter((s) => !s.reading).length
  const takes = h3.filter((s) => s.take)
  const done = takes.filter((s) => s.take.final).length
  // the voice swap: the person painted in says the same words in their saved voice
  const swap = r.plan ? r.plan.swap : r.swap
  const voiceId = swap?.voiceId || ''
  const voiceReady = !!voiceState?.installed
  const voiceName = voices.find((v) => v.id === voiceId)?.name
  const withVoice = (label, fn) =>
    act(label, async () => {
      setVoiceStep('starting')
      try {
        return await fn()
      } finally {
        setVoiceStep(null)
      }
    })
  const voiceN = swap ? 3 : null
  const shift = swap ? 1 : 0

  return (
    <div className="rebuild create-v2 flow-page">
      <Hero art="rebuild" help="rebuild-project" title={r.name} kicker={`Rebuild · ${r.shots.length} shots · ${secs(r.source.duration)}`} back={{ label: 'All rebuilds', onClick: () => go('rebuild') }} />
      <ol className="wizard-steps flow-progress" aria-label="Progress">
        {PROGRESS.map((label, i) => (
          <li key={label} className={`${i === at ? 'on' : ''} ${i <= at ? 'reached' : ''}`}>
            <span className="flow-progress-in">
              <span className="wizard-n">{i < at ? '✓' : i + 1}</span>
              <span className="wizard-label">{label}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mono small dim sz-status">
        {STATUS[r.status] || r.status}
        {r.music?.bpm ? ` · ${Math.round(r.music.bpm)} BPM` : ''}
        {r.swap?.ask ? ` · change: ${r.swap.ask}` : ''}
        {busy && ` · ${busy.replace(/…$/, '')}…`}
      </p>

      <div className="create-steps">
        <Step n={1} title="The shots" sub={unread ? `${unread} of ${r.shots.length} still to be read. Your agent says what each one is, or your prompt writer can.` : 'Every shot, at its own length. Each says what it is and how it will be made.'}>
          <div className="rb-strip">
            {r.shots.map((s) => (
              <StripTile key={s.index} s={s} />
            ))}
          </div>
          {unread > 0 && (
            <div className="row-actions">
              <button className="btn btn-small" disabled={!!busy} onClick={() => act('Reading the shots with your prompt writer', () => B().readWithWriter(r.id))}>
                Read them with my prompt writer
              </button>
              <span className="small dim">Uses the writer set in Settings → Prompt writer. Your agent can do it instead.</span>
            </div>
          )}
        </Step>

        <Step n={2} title="The plan" sub={r.plan ? `${h3.length} shot${h3.length === 1 ? '' : 's'} remade with H3, about ${h3.length * 3}-${h3.length * 5} GPU minutes` : 'Your agent writes it once every shot is read. Nothing renders until you approve it.'}>
          {r.plan && (
            <>
              <div className="rb-plan">
                {r.shots.map((s) => (
                  <div key={s.index} className="rb-plan-row">
                    <span className="mono small">{s.index}</span>
                    <span className="rb-chip route">{ROUTE[s.route] || '—'}</span>
                    <span className="small">{s.reading?.description || s.reading?.why || ''}</span>
                  </div>
                ))}
              </div>
              {r.plan.notes && <p className="small dim">{r.plan.notes}</p>}
              <div className="row-actions">
                {!r.planApprovedAt ? (
                  <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Approving the plan', () => B().approvePlan(r.id))}>
                    Approve plan
                  </button>
                ) : (
                  <span className="mono small cloud-ok">✓ Approved</span>
                )}
              </div>
            </>
          )}
        </Step>

        {swap && (
          <Step n={voiceN} title="The voice" sub={voiceId ? `The same words, at the same moments, in ${voiceName ? `${voiceName}’s voice` : 'the chosen voice'}. Each remade shot's lips follow its piece of it, and it goes on A1 in the first cut.` : 'Who goes in can speak in their own saved voice, or keep the original voice.'}>
            <div className="row">
              <span className="row-label">Voice</span>
              <select className="small remake-voice-pick" value={voiceId} disabled={!!busy} aria-label="The voice who goes in speaks with" onChange={(e) => act('Saving the voice', () => B().setVoice(r.id, { voiceId: e.target.value || null, name: swap.name || voices.find((v) => v.id === e.target.value)?.name || '' }))}>
                <option value="">Keep the original voice</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    Voice: {v.name}
                  </option>
                ))}
              </select>
            </div>
            {voiceId && !voiceReady && <p className="small pink">Swapping the voice needs IV Studio’s voice engine: set it up once on Audio › Voices.</p>}
            {voiceId && voiceReady && (
              <VoiceLines voice={r.voice?.peopleKey === voiceId ? r.voice : r.voice && { ...r.voice, track: null }} busy={busy} step={voiceStep} names={[swap.name || voiceName]} onMake={(opts) => withVoice('Making the voice', () => B().voice(r.id, opts))} onPhrase={(i, patch) => withVoice('Saying it again', () => B().setPhrase(r.id, i, patch))} onSetupSplitter={() => act('Setting up the voice splitter', async () => (await window.ivstudio.remake.setupSplitter(), setVoiceState(await window.ivstudio.remake.voiceStatus()), B().voice(r.id, { rehear: true })))} settingUp={busy === 'Setting up the voice splitter'} />
            )}
          </Step>
        )}

        {r.planApprovedAt && (
          <Step n={3 + shift} title="The frames" sub="Each remade shot starts from its own first frame (and ends on its last), with any writing painted out and your change painted in.">
            {h3.length === 0 && <p className="small dim">No shot is remade with H3, so there are no frames to make. Approve to go on to the cut.</p>}
            <div className="rb-frames">
              {h3.map((s) => (
                <div key={s.index} className="rb-frame">
                  <span className="mono small">Shot {s.index}</span>
                  <div className="rb-frame-pair">
                    <img src={fileUrl(s.frames?.original?.first || s.first)} alt={`Shot ${s.index}, before`} />
                    {s.frames?.first ? <img src={fileUrl(s.frames.first)} alt={`Shot ${s.index}, after`} /> : <span className="rb-wait mono small">Not made yet</span>}
                  </div>
                  {s.frames && !s.frames.edited && <span className="small dim">Kept as it was: no writing to clean.</span>}
                </div>
              ))}
            </div>
            <div className="row-actions">
              {h3.some((s) => !s.frames) && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Making the frames', () => B().makeFrames(r.id))}>
                  Make the frames
                </button>
              )}
              {h3.every((s) => s.frames) && !r.framesApprovedAt && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Approving the frames', () => B().approveFrames(r.id))}>
                  Approve frames
                </button>
              )}
              {r.framesApprovedAt && <span className="mono small cloud-ok">✓ Approved</span>}
            </div>
          </Step>
        )}

        {r.framesApprovedAt && (
          <Step n={4 + shift} title="The shots, made again" sub={takes.length ? `${done} of ${h3.length} finished · H3 shots take 3-5 min each` : 'Two previews per shot (three with a change); pick one and it is finished at 1 MP.'}>
            <div className="rb-takes">
              {takes.map((s) => (
                <div key={s.index} className="rb-take">
                  <span className="mono small">
                    Shot {s.index} · {s.take.status}
                    {s.take.error ? `: ${s.take.error}` : ''}
                  </span>
                  {s.take.final ? (
                    <video src={fileUrl(s.take.final)} controls preload="metadata" />
                  ) : (
                    <div className="rb-previews">
                      {s.take.previews.map((p) => (
                        <figure key={p.candidate} className={s.take.candidate === p.candidate ? 'on' : ''}>
                          {p.path && <video src={fileUrl(p.path)} muted loop preload="metadata" onMouseEnter={(e) => e.target.play().catch(() => {})} onMouseLeave={(e) => e.target.pause()} />}
                          <button className="btn btn-small" disabled={!!busy || s.take.candidate === p.candidate} onClick={() => act(`Finishing shot ${s.index}`, () => B().pick(r.id, s.index, p.candidate))}>
                            {s.take.candidate === p.candidate ? 'Picked' : `Pick #${p.candidate}`}
                          </button>
                        </figure>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {h3.some((s) => !s.take || ['error', 'cancelled'].includes(s.take.status)) && <FirstRenders compact label="Takes" />}
            <div className="row-actions">
              {h3.some((s) => !s.take || ['error', 'cancelled'].includes(s.take.status)) && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Starting the renders', () => B().makeShots(r.id).then((next) => (startRender({ kind: 'poll', id: `rebuild:${r.id}`, poll: () => rebuildProgress(r.id), name: r.name, open: { page: 'rebuild', id: r.id }, what: 'take' }), next)))}>
                  {takes.length ? 'Render the rest' : 'Render the shots'}
                </button>
              )}
              {(['ready', 'editing'].includes(r.status) || h3.length === 0) && (
                <button className={`btn ${r.editId ? '' : 'btn-primary'}`} disabled={!!busy} onClick={() => act('Cutting it', () => B().firstCut(r.id)).then((cut) => cut?.editId && openEdit(cut.editId))}>
                  {r.editId ? 'Cut it again' : 'Make the first cut'}
                </button>
              )}
              {r.editId && (
                <button className="btn btn-small" onClick={() => openEdit(r.editId)}>
                  Open in Edit
                </button>
              )}
            </div>
            {r.editId && <p className="small dim">{voiceId && r.voice?.track ? `A1 is the new voice track, in ${voiceName ? `${voiceName}’s voice` : 'the chosen voice'}.` : 'The original sound is on A1 as a guide for timing. Replace it before you publish.'}</p>}
          </Step>
        )}

        <Step n={(r.framesApprovedAt ? 5 : r.planApprovedAt ? 4 : 3) + shift} title="Your agent" sub="Paste this into Claude or ChatGPT, connected to IV Studio (Settings → Agents).">
          <SetCode text={agentMessage(r)} label="Copy message" tall />
        </Step>
      </div>
    </div>
  )
}
