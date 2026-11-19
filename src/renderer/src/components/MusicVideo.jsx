import { useEffect, useRef, useState } from 'react'
import { media } from '../media'
import { Progress } from './Shot'
import Failure from './Failure'
import { FirstRenders } from './Speed'
import Stage from './Stage'
import { ToolShelf, ShelfTile, WorkflowNeeds } from './FlowKit'
import { fileUrl } from './edit/model'
import { usePeaks, Wave } from './edit/thumbs'
import TileDelete from './TileDelete'

// Music video (src/service/musicvideo.js): a song cut into scenes on its bars, each scene an H3 shot that sings or
// plays along to its own stretch of the song, then the finished scenes laid over the song as an edit.
const DONE = ['success', 'error', 'cancelled']
const CAST = 4
const base = (p) => String(p || '').split(/[\\/]/).pop()
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const api = () => window.ivstudio.musicVideos

export default function MusicVideo(props) {
  const [open, setOpen] = useState(null)
  return open ? <Editor key={open} id={open} back={() => setOpen(null)} {...props} /> : <List openOne={setOpen} {...props} />
}

function List({ openOne, notify, go }) {
  const [list, setList] = useState(null)
  const [songs, setSongs] = useState([])
  const [song, setSong] = useState(null) // { file, name }
  const [name, setName] = useState('')
  const [making, setMaking] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    api().list().then(setList)
    window.ivstudio.music
      .list()
      .then((l) => setSongs((l || []).filter((s) => s.status === 'success' && s.file)))
      .catch(() => {})
  }, [])
  async function pickFile() {
    const files = await window.ivstudio.files.pick('audio')
    const f = (Array.isArray(files) ? files : files ? [files] : []).map((x) => x.path || x)[0]
    if (f) setSong({ file: f, name: base(f) })
  }
  async function create() {
    setMaking(true)
    try {
      const v = await api().create({ name: name.trim() || undefined, song: song.file, songName: song.name })
      openOne(v.id)
    } catch (err) {
      notify(err.message)
    } finally {
      setMaking(false)
    }
  }
  const shown = (list || []).filter((x) => !q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="musicvideo flow-page">
      <Stage effect="beat" art="music" title="Music video" kicker="A song, cut into scenes that sing along" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        <div className="stage-panel mv-new">
          <select value={song?.file || ''} onChange={(e) => setSong(songs.find((s) => s.file === e.target.value) ? { file: e.target.value, name: songs.find((s) => s.file === e.target.value).name } : null)} aria-label="Song">
            <option value="">{songs.length ? 'Pick a song from Music…' : 'No songs in Music yet'}</option>
            {songs.map((s) => (
              <option key={s.file} value={s.file}>
                {s.name} · {Math.round(s.duration || s.seconds || 0)} s
              </option>
            ))}
            {song && !songs.some((s) => s.file === song.file) && <option value={song.file}>♪ {song.name}</option>}
          </select>
          <button className="btn btn-small" onClick={pickFile}>
            + A sound file
          </button>
          <input value={name} placeholder="Name it (optional)" onChange={(e) => setName(e.target.value)} aria-label="Name" />
          <button className="btn btn-primary" disabled={!song || making} onClick={create}>
            {making ? 'Reading the song…' : 'New music video'}
          </button>
        </div>
        <p className="stage-note small">IV Studio finds the song’s beat, bars and parts and cuts it into scenes of up to 15 s. Each scene is an H3 shot that sings or plays along to its own stretch of the song.</p>
        <WorkflowNeeds page="musicvideo" />
      </Stage>
      <ToolShelf label="Your music videos" count={shown.length} q={q} setQ={setQ} empty="No music videos yet. Pick a song above.">
        {shown.map((x) => (
          <ShelfTile
            key={x.id}
            onOpen={() => openOne(x.id)}
            media={<span className="shelf-empty-art">{x.scenes} scene{x.scenes === 1 ? '' : 's'}</span>}
            status={clock(x.seconds)}
            name={x.name}
            meta={[x.song ? `♪ ${x.song}` : '', new Date(x.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })]}
            del={<TileDelete name={x.name} notify={notify} onDelete={async () => (await api().remove(x.id), setList(await api().list()))} />}
          />
        ))}
      </ToolShelf>
    </div>
  )
}

// ---------- the editor: the song across the top, the selected scene beside the video's idea and cast ----------

const MIC = (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="mv-icon">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
  </svg>
)

// Where a scene stands, as a word and a tone for its pill and its block on the timeline.
function sceneStatus(s, live) {
  const pj = s.state.previews && (live[s.state.previews.id] || s.state.previews)
  const fj = s.state.finish && (live[s.state.finish.id] || s.state.finish)
  if (s.state.fresh) return { tone: 'done', word: 'Finished' }
  if (fj && !DONE.includes(fj.status)) return { tone: 'busy', word: 'Finishing' }
  if (pj && !DONE.includes(pj.status)) return { tone: 'busy', word: 'Hunting takes' }
  if (fj?.status === 'error' || pj?.status === 'error') return { tone: 'error', word: 'It failed' }
  if (s.state.changed) return { tone: 'changed', word: 'Changed since its render' }
  if (pj?.outputs?.some((o) => o.kind === 'preview')) return { tone: 'pick', word: 'Pick a take' }
  if (s.prompt.trim()) return { tone: 'ready', word: 'Ready to hunt' }
  return { tone: 'empty', word: 'Needs a prompt' }
}

// The picture a scene's block shows: its finished clip, else its first take.
function sceneVideo(s, live) {
  if (s.state.clip?.url) return s.state.clip.url
  const pj = s.state.previews && (live[s.state.previews.id] || s.state.previews)
  return pj?.outputs?.find((o) => o.kind === 'preview')?.url || null
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function Editor({ id, back, notify, characters = [], jobs: live = {}, openEdit }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState('')
  const [sel, setSel] = useState(0)
  const [catalog, setCatalog] = useState([])
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const audio = useRef(null)
  const stopAt = useRef(null) // playing one scene: stop at its end
  const load = () =>
    api()
      .get(id)
      .then(setV)
      .catch((err) => notify(err.message))
  useEffect(() => {
    load()
    window.ivstudio.characters
      .catalog()
      .then((c) => setCatalog(c || []))
      .catch(() => {})
  }, [id])
  // while anything renders, ask again every few seconds (the jobs also stream into live)
  const rendering = v?.scenes.some((s) => s.state.busy)
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [rendering])
  // a job of ours that just finished in live: read the music video again
  const ours = v ? v.scenes.flatMap((s) => [s.state.previews?.id, s.state.finish?.id]).filter(Boolean) : []
  const doneKey = ours.map((j) => `${j}:${live[j]?.status || ''}`).join(',')
  useEffect(() => {
    if (ours.some((j) => DONE.includes(live[j]?.status))) load()
  }, [doneKey])
  // the playhead follows the song while it plays
  useEffect(() => {
    if (!playing) return
    let raf
    const tick = () => {
      const a = audio.current
      if (a) {
        setTime(a.currentTime)
        if (stopAt.current != null && a.currentTime >= stopAt.current) {
          a.pause()
          stopAt.current = null
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
  // the selected scene follows the playhead while the whole song plays
  useEffect(() => {
    if (!playing || stopAt.current != null || !v) return
    const i = v.scenes.findIndex((s) => time >= s.start && time < s.end)
    if (i >= 0 && i !== sel) setSel(i)
  }, [time])

  async function run(label, fn) {
    setBusy(label)
    try {
      const r = await fn()
      if (r?.scenes) setV(r)
      else await load()
      return r
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy('')
    }
  }
  if (!v) return <div className="musicvideo flow-page"><p className="dim">Loading…</p></div>

  const n = v.scenes.length
  const i = Math.min(sel, n - 1)
  const s = v.scenes[i]
  const faceOf = (cid) => {
    const c = characters.find((x) => x.id === cid)
    return c?.picture || catalog.find((x) => x.id === cid)?.picture || null
  }
  const nameOf = (cid) => characters.find((c) => c.id === cid)?.name || cid
  const seek = (t) => {
    setTime(t)
    if (audio.current) audio.current.currentTime = t
  }
  const play = (from = null, until = null) => {
    const a = audio.current
    if (!a) return
    if (from != null) a.currentTime = from
    stopAt.current = until
    a.play().catch((err) => notify(err.message))
  }
  const pause = () => audio.current?.pause()
  const noPrompt = v.scenes.filter((x) => !x.prompt.trim()).length
  const toHunt = v.scenes.filter((x) => x.prompt.trim() && !x.state.fresh && !x.state.busy).length
  const edit = (change, label = 'scene') => run(label, () => api().edit(id, change))

  async function assemble() {
    const r = await run('assemble', () => api().assemble(id))
    if (!r) return
    notify(r.missing.length ? `The edit has ${r.placed} finished scene${r.placed === 1 ? '' : 's'}; scene${r.missing.length === 1 ? '' : 's'} ${r.missing.join(', ')} ${r.missing.length === 1 ? 'isn’t' : 'aren’t'} finished yet, so ${r.missing.length === 1 ? 'it’s' : 'they’re'} a gap.` : `All ${r.placed} scenes are on the timeline over the song. Export it from Edit.`, 'info')
    openEdit?.(r.editId)
  }

  return (
    <div className="musicvideo mv-editor flow-page">
      <audio ref={audio} src={fileUrl(v.song.file)} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <header className="mv-top">
        <div className="mv-back-row">
          <button className="link-btn mono small mv-back" onClick={back}>
            ← Music videos
          </button>
        </div>
        <div className="mv-title">
          <h1>{v.name}</h1>
          <span className="mono small dim">
            ♪ {v.song.name} · {clock(v.song.duration)}
            {v.song.clearBeat ? ` · ${Math.round(v.song.bpm)} BPM` : ''}
          </span>
        </div>
        <div className="mv-progress" title={`${v.finished} of ${n} scenes finished`}>
          <span className="mv-progress-n">
            {v.finished}
            <span className="dim">/{n}</span>
          </span>
          <span className="mono small dim">scenes finished</span>
          <span className="mv-meter">
            <span style={{ width: `${(100 * v.finished) / n}%` }} />
          </span>
        </div>
        <div className="mv-top-actions">
          <button className="btn btn-small" disabled={!!busy || !noPrompt} onClick={() => run('write', () => api().write(id, {}).then((r) => r.video))} title="The writer chosen in Settings writes every scene that has no prompt yet">
            {busy === 'write' ? 'Writing…' : noPrompt ? `✦ Write ${noPrompt} scene${noPrompt === 1 ? '' : 's'}` : '✦ All written'}
          </button>
          <button className="btn btn-small" disabled={!!busy || !toHunt} onClick={() => run('huntAll', () => api().huntAll(id, {}))} title="Hunt takes for every written scene that isn't finished, one after another on this PC">
            {busy === 'huntAll' ? 'Starting…' : `Hunt ${toHunt || ''} scene${toHunt === 1 ? '' : 's'}`.replace('  ', ' ')}
          </button>
          <button className="btn btn-small btn-primary" disabled={!!busy || !v.finished} onClick={assemble} title="The finished scenes over the song, as an edit">
            {busy === 'assemble' ? 'Making the edit…' : 'Make the edit →'}
          </button>
        </div>
      </header>

      <SongTimeline v={v} sel={i} setSel={setSel} time={time} seek={seek} playing={playing} play={play} pause={pause} live={live} busy={busy} onCut={(index, at) => edit({ op: 'cut', index, at })} />

      <div className="mv-grid">
        <aside className="mv-side">
          <section className="mv-card">
            <h3 className="mv-h">The idea</h3>
            <textarea className="mv-idea" rows={4} key={`idea:${v.idea}`} defaultValue={v.idea} placeholder="A sentence or two about the whole video: where it happens, the mood, the story. The writer uses it for every scene." onBlur={(e) => e.target.value !== v.idea && run('idea', () => api().save(id, { idea: e.target.value }))} />
            <div className="mv-shape">
              {['16:9', '9:16'].map((a) => (
                <button key={a} className={`mv-shape-btn ${v.aspect === a ? 'on' : ''}`} onClick={() => a !== v.aspect && run('aspect', () => api().save(id, { aspect: a }))} aria-pressed={v.aspect === a}>
                  <span className={`mv-shape-box r${a.replace(':', '')}`} />
                  <span className="mono small">{a === '16:9' ? 'Wide 16:9' : 'Tall 9:16'}</span>
                </button>
              ))}
            </div>
            <FirstRenders compact label="Takes" />
          </section>
          <CastCard v={v} characters={characters} faceOf={faceOf} run={run} id={id} />
          <RefsCard v={v} run={run} id={id} />
          <section className="mv-card mv-songfacts">
            <h3 className="mv-h">The song</h3>
            <p className="small dim">{v.song.clearBeat ? `${Math.round(v.song.bpm)} BPM, ${v.song.bars.length} bars and ${v.song.sections.length} part${v.song.sections.length === 1 ? '' : 's'}, found from where the loudness changes. Cuts snap to the bars.` : 'No clear beat, so the cuts snap to an even 2 s grid.'}</p>
            <button className="link-btn mono small" disabled={!!busy} onClick={() => (window.confirm('Plan every scene again from the song? The current scenes’ prompts and renders are dropped from the plan.') ? run('map', () => api().map(id, { replan: true })) : null)}>
              Plan the scenes again
            </button>
          </section>
        </aside>

        <ScenePanel key={s.id} v={v} s={s} i={i} n={n} setSel={setSel} live={live} busy={busy} run={run} edit={edit} id={id} notify={notify} faceOf={faceOf} nameOf={nameOf} time={time} playing={playing} play={play} pause={pause} />
      </div>
    </div>
  )
}

// The song across the page: its parts, waveform and bar lines, the scenes as blocks (their take or finished clip
// showing), a playhead, and the cuts between scenes to drag (they snap to the bars).
function SongTimeline({ v, sel, setSel, time, seek, playing, play, pause, live, busy, onCut }) {
  const [ref, W] = useWidth()
  const wave = usePeaks({ kind: 'audio', path: v.song.file })
  const [drag, setDrag] = useState(null) // { i, t }
  const D = v.song.duration
  const x = (t) => (W * t) / D
  const tOf = (clientX) => {
    const r = ref.current.getBoundingClientRect()
    return Math.max(0, Math.min(D, ((clientX - r.left) / r.width) * D))
  }
  const parts = [...new Set(v.scenes.map((s) => s.part))]
  // where a dragged cut lands: the nearest bar line that keeps both scenes 2 to 15 s
  const landing = (i, t) => {
    const [a, b] = [v.scenes[i], v.scenes[i + 1]]
    const lo = Math.max(a.start + 2, b.end - 15)
    const hi = Math.min(b.end - 2, a.start + 15)
    const ok = v.song.bars.filter((x) => x >= lo - 0.001 && x <= hi + 0.001)
    const c = Math.min(hi, Math.max(lo, t))
    return ok.length ? ok.reduce((p, q) => (Math.abs(q - c) < Math.abs(p - c) ? q : p)) : c
  }
  const startDrag = (i) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ i, t: v.scenes[i].end })
  }
  const moveDrag = (e) => drag && setDrag({ ...drag, t: landing(drag.i, tOf(e.clientX)) })
  const endDrag = () => {
    if (!drag) return
    const { i, t } = drag
    setDrag(null)
    if (Math.abs(t - v.scenes[i].end) > 0.01) onCut(i, t)
  }
  const ticks = []
  const step = D > 150 ? 30 : D > 60 ? 10 : 5
  for (let t = 0; t <= D; t += step) ticks.push(t)
  return (
    <section className="mv-timeline">
      <div className="mv-tl-head">
        <button className="mv-play" onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play the song'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="mono small mv-clock">
          {clock(time)} <span className="dim">/ {clock(D)}</span>
        </span>
        <span className="small dim mv-tl-hint">Click a scene to open it. Drag the line between two scenes to move the cut; it snaps to the bars.</span>
      </div>
      <div ref={ref} className={`mv-tl ${drag ? 'dragging' : ''}`} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
        <div className="mv-tl-parts">
          {v.song.sections.map((p, k) => (
            <span key={p.label} className="mv-tl-part" style={{ left: x(p.start), width: Math.max(0, x(p.end) - x(p.start) - 1), '--part': k }}>
              {p.label}
            </span>
          ))}
        </div>
        <div className="mv-tl-wave" onClick={(e) => seek(tOf(e.clientX))}>
          {v.song.bars.map((b) => (
            <span key={b} className="mv-tl-bar" style={{ left: x(b) }} />
          ))}
          {W > 0 && <Wave wave={wave} from={0} to={D} width={W} height={52} color="rgba(244, 236, 220, 0.55)" />}
        </div>
        <div className="mv-tl-scenes">
          {v.scenes.map((s, k) => {
            const st = sceneStatus(s, live)
            const vid = sceneVideo(s, live)
            const w = x(s.end) - x(s.start)
            return (
              <button key={s.id} className={`mv-tl-scene t-${st.tone} ${k === sel ? 'on' : ''}`} style={{ left: x(s.start), width: Math.max(4, w - 2), '--part': parts.indexOf(s.part) }} onClick={() => (setSel(k), seek(s.start))} title={`Scene ${k + 1}: ${clock(s.start)}–${clock(s.end)} · ${st.word}`}>
                {vid && w > 40 && <video src={`${media(vid)}#t=0.5`} muted preload="metadata" />}
                <span className="mv-tl-scene-n mono">{k + 1}</span>
                <span className="mv-tl-dot" />
              </button>
            )
          })}
          {v.scenes.slice(0, -1).map((s, k) => (
            <span key={`cut${s.id}`} className={`mv-tl-cut ${drag?.i === k ? 'on' : ''}`} style={{ left: x(drag?.i === k ? drag.t : s.end) }} onPointerDown={busy ? undefined : startDrag(k)} role="slider" aria-label={`The cut after scene ${k + 1}`} aria-valuenow={+(drag?.i === k ? drag.t : s.end).toFixed(2)}>
              {drag?.i === k && <span className="mv-tl-cut-time mono">{clock(drag.t)}.{String(Math.round((drag.t % 1) * 10))}</span>}
            </span>
          ))}
        </div>
        <span className="mv-tl-head-line" style={{ left: x(time) }} />
      </div>
      <div className="mv-tl-ruler mono">
        {ticks.map((t) => (
          <span key={t} style={{ left: x(t) }}>
            {clock(t)}
          </span>
        ))}
      </div>
    </section>
  )
}

// The cast: up to four faces, each with a part; the microphone marks the one who sings.
function CastCard({ v, characters, faceOf, run, id }) {
  const rows = Array.from({ length: CAST }, (_, k) => v.cast[k] || { character: 'none', part: '', singer: false })
  const save = (k, patch) => run('cast', () => api().save(id, { cast: rows.map((c, j) => (j === k ? { ...c, ...patch } : patch.singer ? { ...c, singer: false } : c)) }))
  return (
    <section className="mv-card">
      <h3 className="mv-h">The cast</h3>
      <p className="small dim mv-sub">Up to four of your characters. The one with the microphone sings; everyone else keeps their mouth closed.</p>
      <div className="mv-cast2">
        {rows.map((c, k) => {
          const face = c.character !== 'none' && faceOf(c.character)
          return (
            <div key={k} className={`mv-member ${c.character === 'none' ? 'empty' : ''} ${c.singer ? 'sings' : ''}`}>
              <span className="mv-face">{face ? <img src={fileUrl(face)} alt="" /> : c.character !== 'none' ? (characters.find((x) => x.id === c.character)?.name || '?').slice(0, 1) : '+'}</span>
              <div className="mv-member-body">
                <select value={c.character} onChange={(e) => save(k, { character: e.target.value, ...(e.target.value === 'none' ? { singer: false, part: '' } : {}) })} aria-label={`Cast member ${k + 1}`}>
                  <option value="none">{c.character === 'none' ? 'Add someone…' : 'No one'}</option>
                  {characters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
                {c.character !== 'none' && <input key={`${k}:${c.character}`} defaultValue={c.part} placeholder="Their part: lead singer, drums…" onBlur={(e) => e.target.value !== c.part && save(k, { part: e.target.value })} aria-label={`Part of cast member ${k + 1}`} />}
              </div>
              {c.character !== 'none' && (
                <button className={`mv-mic ${c.singer ? 'on' : ''}`} onClick={() => save(k, { singer: !c.singer })} aria-pressed={!!c.singer} title={c.singer ? 'Sings (press to make no one sing)' : 'Make them the singer'}>
                  {MIC}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// References: pictures of people, products, places or things the scenes can show. Each scene picks its own; H3 gets
// them as reference pictures and keeps their look (a product its label).
const REF_KINDS = [
  ['person', 'Person'],
  ['product', 'Product'],
  ['place', 'Place'],
  ['thing', 'Thing']
]
const REF_MAX = 8
function RefsCard({ v, run, id }) {
  const [over, setOver] = useState(false)
  const refs = v.refs || []
  const add = async (paths) => {
    for (const picture of paths.slice(0, REF_MAX - refs.length)) await run('ref', () => api().addRef(id, { picture, kind: 'product' }))
  }
  const pick = async () => {
    const files = await window.ivstudio.files.pick('picture')
    await add((Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f))
  }
  const drop = (e) => {
    e.preventDefault()
    setOver(false)
    add([...(e.dataTransfer?.files || [])].map((f) => window.ivstudio.media.pathFor(f)).filter((p) => p && /\.(png|jpe?g|webp|bmp)$/i.test(p)))
  }
  return (
    <section className={`mv-card mv-refs ${over ? 'over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
      <h3 className="mv-h">References</h3>
      <p className="small dim mv-sub">Pictures of people, products, places or things to show. Each scene picks the ones it has, and H3 keeps their look; a product keeps its label.</p>
      {refs.length > 0 && (
        <div className="mv-ref-list">
          {refs.map((r) => (
            <div key={r.id} className="mv-ref">
              <img src={fileUrl(r.picture)} alt="" />
              <div className="mv-ref-body">
                <input key={`${r.id}:${r.name}`} defaultValue={r.name} aria-label="Name" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== r.name && run('ref', () => api().updateRef(id, r.id, { name: e.target.value }))} />
                <select value={r.kind} aria-label="What it is" onChange={(e) => run('ref', () => api().updateRef(id, r.id, { kind: e.target.value }))}>
                  {REF_KINDS.map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
                <input key={`${r.id}:d:${r.description}`} defaultValue={r.description} placeholder="A few words, e.g. a red can with a white wave" aria-label="Description" onBlur={(e) => e.target.value !== (r.description || '') && run('ref', () => api().updateRef(id, r.id, { description: e.target.value }))} />
              </div>
              <button className="mv-ref-x" onClick={() => (window.confirm(`Remove ${r.name}? It leaves every scene it was in.`) ? run('ref', () => api().removeRef(id, r.id)) : null)} aria-label={`Remove ${r.name}`} title="Remove">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {refs.length < REF_MAX && (
        <button className="mv-ref-add" onClick={pick}>
          <span className="mv-ref-plus">+</span>
          <span>
            Add a picture
            <span className="small dim"> or drop one here</span>
          </span>
        </button>
      )}
    </section>
  )
}

// The references chips in a scene: press one to put it in the scene or take it out (four at most).
function SceneRefs({ v, s, i, edit }) {
  const refs = v.refs || []
  if (!refs.length) return null
  const on = s.refs || []
  const kindWord = Object.fromEntries(REF_KINDS)
  const toggle = (r) => edit({ op: 'set', index: i, refs: on.includes(r.id) ? on.filter((x) => x !== r.id) : [...on, r.id] })
  return (
    <div className="mv-who mv-scene-refs">
      <span className="mono small dim mv-who-label">In this scene</span>
      {refs.map((r) => {
        const isOn = on.includes(r.id)
        return (
          <button key={r.id} className={`mv-who-chip mv-ref-chip ${isOn ? 'on' : ''}`} onClick={() => toggle(r)} disabled={!isOn && on.length >= 4} aria-pressed={isOn} title={isOn ? `${r.name} is in this scene (press to take it out)` : on.length >= 4 ? 'Four references in a scene at most' : `Put ${r.name} in this scene`}>
            <span className="mv-face small square">
              <img src={fileUrl(r.picture)} alt="" />
            </span>
            {r.name}
            <span className="mono small dim">{kindWord[r.kind]}</span>
          </button>
        )
      })}
    </div>
  )
}

// The selected scene: who is in it and whether it sings, its prompt, its takes and its finished clip.
function ScenePanel({ v, s, i, n, setSel, live, busy, run, edit, id, notify, faceOf, nameOf, time, playing, play, pause }) {
  const [picked, setPicked] = useState(1)
  const pj = s.state.previews && (live[s.state.previews.id] || s.state.previews)
  const fj = s.state.finish && (live[s.state.finish.id] || s.state.finish)
  const takes = pj?.outputs?.filter((o) => o.kind === 'preview') || []
  const st = sceneStatus(s, live)
  const named = v.cast.map((c, k) => ({ ...c, k })).filter((c) => c.character !== 'none')
  const inIt = (c) => !s.cast || s.cast.includes(c.k)
  const toggle = (c) => {
    const now = named.filter((x) => (x.k === c.k ? !inIt(x) : inIt(x))).map((x) => x.k)
    edit({ op: 'set', index: i, cast: now.length === named.length ? null : now })
  }
  const singer = named.find((c) => c.singer && inIt(c))
  const last = i === n - 1
  // split at the playhead when it sits inside the scene with 2 s either side, else on the bar nearest the middle
  const atHead = time > s.start + 2 && time < s.end - 2
  const inScene = playing && time >= s.start && time < s.end
  return (
    <section className={`mv-scene2 t-${st.tone}`} style={{ '--part': [...new Set(v.scenes.map((x) => x.part))].indexOf(s.part) }}>
      <header className="mv-scene2-head">
        <button className="mv-nav" disabled={i === 0} onClick={() => setSel(i - 1)} aria-label="Previous scene">
          ‹
        </button>
        <div className="mv-scene2-title">
          <h2>
            Scene {i + 1} <span className="dim">of {n}</span>
          </h2>
          <span className="mono small">
            {clock(s.start)}–{clock(s.end)} · {s.seconds.toFixed(1)} s{s.part ? ` · ${s.part}` : ''}
          </span>
        </div>
        <span className={`mv-pill t-${st.tone}`}>{st.word}</span>
        <button className="btn btn-small" onClick={() => (inScene ? pause() : play(s.start, s.end))}>
          {inScene ? '❚❚ Pause' : '▶ Hear it'}
        </button>
        <button className="mv-nav" disabled={last} onClick={() => setSel(i + 1)} aria-label="Next scene">
          ›
        </button>
      </header>

      <div className="mv-who">
        {named.length === 0 && <p className="small dim">Add your cast on the left, so the scene knows who is in it.</p>}
        {named.map((c) => {
          const face = faceOf(c.character)
          return (
            <button key={c.k} className={`mv-who-chip ${inIt(c) ? 'on' : ''}`} onClick={() => toggle(c)} aria-pressed={inIt(c)} title={inIt(c) ? 'In this scene (press to leave them out)' : 'Not in this scene (press to put them in)'}>
              <span className="mv-face small">{face ? <img src={fileUrl(face)} alt="" /> : nameOf(c.character).slice(0, 1)}</span>
              {nameOf(c.character).split(/\s+/)[0]}
              {c.singer && <span className="mv-chip-mic">{MIC}</span>}
            </button>
          )
        })}
        {named.some((c) => c.singer) && (
          <button className={`mv-sings ${s.sings ? 'on' : ''}`} onClick={() => edit({ op: 'set', index: i, sings: !s.sings })} aria-pressed={!!s.sings}>
            {MIC} {s.sings ? (singer ? `${nameOf(singer.character).split(/\s+/)[0]} sings here` : 'Sings here') : 'No singing here'}
          </button>
        )}
      </div>

      <SceneRefs v={v} s={s} i={i} edit={edit} />

      <label className="mv-prompt-wrap">
        <span className="mono small dim">What happens</span>
        <textarea
          className="prompt mv-prompt"
          rows={5}
          key={`${s.id}:${s.prompt}`}
          defaultValue={s.prompt}
          placeholder="Describe the scene as an H3 prompt, with {char} for the lead (the singer when they sing). Or press Write and the writer chosen in Settings does it from the idea, the song and the cast."
          onBlur={(e) => e.target.value !== s.prompt && edit({ op: 'set', index: i, prompt: e.target.value })}
        />
      </label>
      <div className="mv-scene2-actions">
        <button className="btn btn-small" disabled={!!busy} onClick={() => run('write', () => api().write(id, { only: [i] }).then((r) => r.video))}>
          {busy === 'write' ? 'Writing…' : s.prompt.trim() ? '✦ Write it again' : '✦ Write'}
        </button>
        <button className="btn btn-primary" disabled={!!busy || !s.prompt.trim() || s.state.busy} onClick={() => run('hunt', () => api().hunt(id, i, {}))}>
          {s.state.busy ? 'Rendering…' : pj ? 'Hunt new takes' : 'Hunt takes'}
        </button>
        <span className="mv-scene2-tools">
          <button className="link-btn mono small" disabled={!!busy || s.seconds < 4} onClick={() => edit(atHead ? { op: 'split', index: i, at: time } : { op: 'split', index: i })} title={atHead ? 'Split at the playhead' : 'Split on the bar nearest the middle'}>
            {atHead ? `Split at ${clock(time)}` : 'Split in two'}
          </button>
          <button className="link-btn mono small" disabled={!!busy || last} onClick={() => edit({ op: 'merge', index: i })}>
            Join with the next
          </button>
        </span>
      </div>

      <Progress job={pj} />
      <Progress job={fj} />
      {pj?.status === 'error' && <Failure job={pj} notify={notify} />}
      {fj?.status === 'error' && <Failure job={fj} notify={notify} />}

      {takes.length > 0 && !s.state.fresh && (
        <div className="mv-takes">
          <span className="mono small dim">Takes: pick the one that sings best, then finish it</span>
          <div className={`candidates n${takes.length}`}>
            {takes.map((o) => (
              <figure key={o.candidate} className={`candidate ${picked === o.candidate ? 'on' : ''}`} onClick={() => setPicked(o.candidate)}>
                <video src={media(o.url)} controls loop preload="metadata" />
                <figcaption>
                  <span className="mono">#{o.candidate}</span>
                  <span className="mono small">{picked === o.candidate ? 'Picked' : 'Pick'}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!!busy || (fj && !DONE.includes(fj.status))} onClick={() => run('finish', () => api().finish(id, i, { candidate: picked }))}>
            {fj && !DONE.includes(fj.status) ? 'Finishing…' : `Finish take #${picked}`}
          </button>
        </div>
      )}
      {s.state.clip && (
        <div className="mv-final">
          <span className="mono small dim">{s.state.fresh ? 'The finished scene' : 'The last finish (the scene has changed since)'}</span>
          <video src={media(s.state.clip.url)} controls preload="metadata" />
        </div>
      )}
    </section>
  )
}
