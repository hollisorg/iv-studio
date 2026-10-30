import { useEffect, useRef, useState } from 'react'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { fileUrl } from './edit/model'

const ASPECTS = [
  ['16:9', 1280, 720],
  ['9:16', 1080, 1920],
  ['1:1', 1080, 1080]
]
const RUNNING = ['running', 'queued']
const base = (p) => String(p).split(/[\\/]/).pop()

// Set up the engine once, then films: create one or open one.
export function ShinobiList({ openShinobi, notify }) {
  const [st, setSt] = useState(null)
  const [list, setList] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const load = () => window.ivstudio.shinobi.status().then((s) => (setSt(s), s.installed && window.ivstudio.shinobi.projects().then(setList)))
  useEffect(() => {
    load()
    return window.ivstudio.shinobi.onLog((l) => setLog((x) => [...x.slice(-40), l]))
  }, [])
  async function install() {
    setBusy(true)
    try {
      await window.ivstudio.shinobi.install()
      await load()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function create() {
    try {
      openShinobi((await window.ivstudio.shinobi.create(name.trim())).project_id)
    } catch (err) {
      notify(err.message)
    }
  }
  if (!st) return null
  return (
    <div className="shinobi">
      <Hero art="shinobi" title="Shinobi" kicker="Edits your agent cuts" />
      <p className="lede">
        Hand your footage to an agent and get a finished edit.
        <span className="lede-small dim">
          Cuts on the beat, speed ramps, camera moves, typography, effects and sound, written by your agent (or a recipe) and rendered on this PC. Works with your IV Studio renders.
        </span>
      </p>
      {!st.installed ? (
        <section className="group">
          <div className="group-head">
            <h2>Set up Shinobi</h2>
            <p className="dim small">Once, about 440 MB and under a minute. It renders with {st.browser ? base(st.browser).replace('.exe', '') : 'Edge or Chrome'} and IV Studio's own ffmpeg; nothing else to install.</p>
          </div>
          <div className="group-body">
            {!st.browser && <p className="small pink">Shinobi needs Microsoft Edge or Google Chrome to draw frames.</p>}
            <button className="btn btn-primary" disabled={busy || !st.browser} onClick={install}>
              {busy ? 'Setting up…' : 'Set up Shinobi'}
            </button>
            {busy && log.length > 0 && <pre className="code cloud-log">{log.join('\n')}</pre>}
            <p className="small dim">
              Shinobi's engine is{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open(st.engine.repo)}>
                OpenKatana
              </button>{' '}
              ({st.engine.licence}), at a fixed version, installed into IV Studio's own folder.
            </p>
          </div>
        </section>
      ) : (
        <>
          <section className="group">
            <div className="group-head">
              <h2>New film</h2>
            </div>
            <div className="group-body">
              <div className="row">
                <span className="row-label">Name</span>
                <input value={name} placeholder="e.g. Theo teaser" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
              </div>
              <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>
                Start a film
              </button>
            </div>
          </section>
          {list.length > 0 && (
            <div className="tiles seq-tiles">
              {list.map((p) => (
                <div key={p.id} className="tile-wrap">
                <button className="tile" onClick={() => openShinobi(p.id)}>
                  {p.cover ? <video className="shinobi-cover" src={`${fileUrl(p.cover)}#t=0.5`} muted preload="metadata" /> : <span className="shinobi-cover empty mono dim">No render yet</span>}
                  <div className="tile-body">
                    <span className="tile-name">{p.name}</span>
                    <span className="mono dim">
                      {p.assets} media · {p.renders} render{p.renders === 1 ? '' : 's'}
                    </span>
                  </div>
                </button>
                <TileDelete name={p.name} keeps="Its renders go too (copy any you want to keep, or send them to Edit first). Your original files stay." notify={notify} onDelete={async () => (await window.ivstudio.shinobi.delete(p.id), setList(await window.ivstudio.shinobi.projects()))} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// One film: brief and media, a first cut from a recipe, the hand-off to an agent, renders.
export function ShinobiProject({ projectId, notify, go }) {
  const [p, setP] = useState(null)
  const [presets, setPresets] = useState([])
  const [lib, setLib] = useState(null)
  const [brief, setBrief] = useState('')
  const [preset, setPreset] = useState(null)
  const [aspect, setAspect] = useState('16:9')
  const [seconds, setSeconds] = useState(8)
  const [text, setText] = useState('')
  const [previews, setPreviews] = useState([])
  const [busy, setBusy] = useState(null)
  const [tools, setTools] = useState(null)
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  const S = window.ivstudio.shinobi
  const load = () => S.project(projectId).then((x) => (setP(x), x))
  useEffect(() => {
    load().then((x) => setBrief(x.brief))
    S.presets().then((list) => (setPresets(list), setPreset(list[0]?.name)))
  }, [projectId])
  const rendering = p?.renders.some((r) => RUNNING.includes(r.state))
  useEffect(() => {
    if (!rendering) return
    const h = setInterval(load, 2500)
    return () => clearInterval(h)
  }, [rendering])

  async function act(label, fn) {
    setBusy(label)
    try {
      return await fn()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  if (!p) return null
  const visual = p.assets.filter((a) => a.kind !== 'audio')
  const music = p.assets.find((a) => a.kind === 'audio')
  const chosen = presets.find((x) => x.name === preset)
  const [, W, H] = ASPECTS.find((a) => a[0] === aspect)
  // A style that needs music says so ("needs music; 3+ clips"); "music optional" doesn't count.
  const needsMusic = chosen && /\bmusic\b/i.test(chosen.needs) && !/music optional/i.test(chosen.needs)

  async function firstCut() {
    await act('Building the first cut', async () => {
      const r = await S.call('build_recipe', { project_id: projectId, family: chosen.family, asset_ids: visual.map((a) => a.id), music_asset_id: music?.id ?? null, text: text || null, seconds, width: W, height: H, fps: 30 })
      const cur = await S.call('get_project', { project_id: projectId })
      await S.call('save_timeline', { project_id: projectId, timeline: r.timeline || r, revision: cur.revision ?? null })
      const frames = [0.1, 0.35, 0.6, 0.85].map((f) => Math.round(f * seconds * 30))
      setPreviews((await S.call('preview_timeline', { project_id: projectId, frames })).preview_images || [])
      await load()
    })
  }
  async function render() {
    await act('Starting the render', async () => {
      await S.call('start_render', { project_id: projectId, request_id: `iv-${Date.now().toString(36)}` })
      await load()
    })
  }
  const agentBrief = `Edit a film with Shinobi, IV Studio's agent-driven editor (its MCP tools: shinobi_tools to list them, shinobi to call one).

Project: "${p.name}" (project_id ${p.id}).
Media already imported:
${p.assets.map((a) => `- ${a.id}: ${a.kind}, ${a.name}`).join('\n') || '- none yet'}
${p.timeline ? `There is a saved timeline (${p.timeline.seconds} s) you can build on.` : 'No timeline yet.'}

What I want:
${brief || '(describe the film here)'}

Read the guides first (shinobi read_guide: agent, timeline, effects). Look at the media with preview_source before choosing shots, preview the timeline before rendering, and render with start_render. Tell me when it's ready; I'll review it in IV Studio's Shinobi page.`

  return (
    <div className="shinobi">
      <Hero art="shinobi" title={p.name} kicker="Shinobi film" />
      {busy && <p className="mono small dim">{busy}…</p>}

      <section className="block">
        <p className="mono label">01 · Brief and media</p>
        <textarea rows={4} value={brief} placeholder="What's the film? Mood, pace, length, aspect, music, the words on screen…" onChange={(e) => setBrief(e.target.value)} onBlur={() => S.saveBrief(projectId, brief)} />
        <div className="media-actions">
          <button className="btn btn-small" onClick={() => act('Importing', async () => setP({ ...(await S.importFiles(projectId)), brief }))}>
            + Files
          </button>
          <button className="btn btn-small" onClick={async () => setLib(lib ? null : await window.ivstudio.edits.library())}>
            + IV Studio render
          </button>
        </div>
        {lib && (
          <div className="ed-lib shinobi-lib">
            {lib.slice(0, 40).map((item) => (
              <button key={item.key} className="ed-lib-item" onClick={() => act('Importing', async () => (setP({ ...(await S.importRender(projectId, item)), brief }), setLib(null)))}>
                <span>{item.label}</span>
                <span className="mono dim small">{item.group}</span>
              </button>
            ))}
          </div>
        )}
        {p.assets.length > 0 && (
          <div className="media-tiles">
            {p.assets.map((a) => (
              <div key={a.id} className={`media-tile ${a.kind}`}>
                <div className="media-thumb">
                  {a.kind === 'image' && <img src={fileUrl(a.path)} alt="" />}
                  {a.kind === 'video' && <video src={`${fileUrl(a.path)}#t=0.3`} muted preload="metadata" />}
                  {a.kind === 'audio' && <span className="media-wave">♪</span>}
                </div>
                <div className="media-meta">
                  <span className="mono pink">{a.kind}</span>
                  <span className="media-name" title={a.name}>
                    {a.name}
                  </span>
                  {a.kind === 'video' && (
                    <button className="link-btn mono small" onClick={() => act('Taking its sound', async () => setP({ ...(await S.importAudioOf(projectId, a.path)), brief }))}>
                      Use its sound as the soundtrack
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="block">
        <p className="mono label">02 · A first cut, no agent needed</p>
        <p className="small dim">Pick a style and Shinobi lays out a starting edit from your media. Your agent can take it from there.</p>
        <div className="shinobi-presets">
          {presets.map((x) => (
            <button key={x.name} className={`mode-card ${preset === x.name ? 'on' : ''}`} onClick={() => setPreset(x.name)}>
              <span className="mode-name">{x.title}</span>
              <span className="dim small">{x.about}</span>
              <span className="mono small">Needs {x.needs}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="row-label">Shape</span>
          <div className="segmented">
            {ASPECTS.map(([a]) => (
              <button key={a} className={aspect === a ? 'on' : ''} onClick={() => setAspect(a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row-label">Seconds</span>
          <input className="mini" type="number" min={3} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
        </div>
        <div className="row">
          <span className="row-label">Title</span>
          <input value={text} placeholder="optional words on screen" onChange={(e) => setText(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!visual.length || !chosen || !!busy || (needsMusic && !music)} onClick={firstCut}>
          Build the first cut
        </button>
        {!visual.length && <p className="small dim">Add some pictures or clips first.</p>}
        {visual.length > 0 && needsMusic && !music && <p className="small pink">{chosen.title} cuts to music: add a soundtrack (a sound file, or "Use its sound as the soundtrack" on a clip).</p>}
        {previews.length > 0 && (
          <div className="shinobi-previews">
            {previews.map((f) => (
              <img key={f} src={fileUrl(f)} alt="" />
            ))}
          </div>
        )}
        {p.timeline && (
          <p className="mono small dim">
            Saved edit: {p.timeline.seconds} s · {p.timeline.width}×{p.timeline.height} · {p.timeline.fps} fps · {p.timeline.shots} shots · {p.timeline.texts} titles
          </p>
        )}
      </section>

      <section className="block">
        <p className="mono label">03 · Hand it to your agent</p>
        <p className="small dim">
          Your agent edits through IV Studio's MCP (Settings → Agents). This message tells it which film, what's in it and what you want.
        </p>
        <pre className="code shinobi-brief">{agentBrief}</pre>
        <button
          className="btn btn-small"
          onClick={() => {
            S.saveBrief(projectId, brief)
            navigator.clipboard.writeText(agentBrief)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied' : 'Copy for your agent'}
        </button>
        <details className="shinobi-tools" onToggle={(e) => e.target.open && !tools && S.tools().then(setTools)}>
          <summary className="mono dim">Everything Shinobi can do ({tools?.length || 72} tools)</summary>
          <input value={query} placeholder="Search: beat, captions, 3D, speed…" onChange={(e) => setQuery(e.target.value)} />
          {(tools || [])
            .filter((t) => !query || `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()))
            .map((t) => (
              <div key={t.name} className="shinobi-tool">
                <span className="mono pink">{t.name}</span>
                <span className="small">{t.description}</span>
              </div>
            ))}
        </details>
      </section>

      <section className="block">
        <p className="mono label">04 · Render and review</p>
        <button className="btn btn-primary" disabled={!p.timeline || rendering || !!busy} onClick={render}>
          {rendering ? 'Rendering…' : 'Render the saved edit'}
        </button>
        {!p.timeline && <p className="small dim">Build a first cut, or ask your agent for an edit, first.</p>}
        <div className="char-clips">
          {p.renders.map((r) => (
            <div key={r.id} className="char-clip">
              {r.video ? <video className="char-video" src={fileUrl(r.video)} controls preload="metadata" /> : <div className="char-pending mono small dim">{RUNNING.includes(r.state) ? 'Rendering…' : r.error || r.state}</div>}
              <div className="row-actions">
                <span className="mono small dim">{r.requestId}</span>
                {r.video && (
                  <>
                    <button className="link-btn mono" onClick={() => act('Making an edit', async () => (await window.ivstudio.shinobi.addToEdit(r.video, p.name), notify('Added to a new edit on the Edit page.', 'info')))}>
                      To Edit
                    </button>
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal({ path: r.video })}>
                      Show
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
