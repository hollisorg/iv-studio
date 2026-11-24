import { useEffect, useState } from 'react'
import { media } from '../media'
import { Progress } from './Shot'
import Failure from './Failure'
import { FirstRenders } from './Speed'
import Stage from './Stage'
import { ToolShelf, ShelfTile, WorkflowNeeds } from './FlowKit'
import { fileUrl } from './edit/model'
import TileDelete from './TileDelete'
import { track } from '../renders'

// Keyframes (src/service/keyframes.js): pictures in order become one video moving from each to the next. The editor
// borrows the Music video editor's parts (studio.css .mv-*): a top bar, the pictures as a strip, the video's
// settings beside one move (or the one take) at a time.
const DONE = ['success', 'error', 'cancelled']
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i
const api = () => window.ivstudio.keyframes
const base = (p) => String(p || '').split(/[\\/]/).pop()
const JOINS = [
  ['auto', 'Let IV Studio pick', 'One take when the pictures fit in one 15 s shot, else a chain.'],
  ['onetake', 'One take', 'Every picture in one H3 shot of up to 15 s: no joins at all.'],
  ['carried', 'A chain, motion carried', 'Each move carries on from the one before and ends on its picture, so the motion flows through.'],
  ['plain', 'A chain, move by move', 'Each move is its own shot, picture to picture, joined in Edit.']
]
const MODE_WORD = { onetake: 'One take', carried: 'A chain, motion carried', plain: 'A chain, move by move' }
const pick = async (kind) => {
  const files = await window.ivstudio.files.pick(kind)
  return (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f)
}
const dropped = (e) => [...(e.dataTransfer?.files || [])].map((f) => window.ivstudio.media.pathFor(f)).filter((p) => p && IMAGE.test(p))

export default function Keyframes(props) {
  const [open, setOpen] = useState(null)
  // Open it from the render hub's reveal (App's openTarget): this page with that one open
  useEffect(() => {
    const pick = (e) => e.detail?.page === 'keyframes' && e.detail.id && setOpen(e.detail.id)
    window.addEventListener('iv:open-item', pick)
    return () => window.removeEventListener('iv:open-item', pick)
  }, [])
  return open ? <Editor key={open} id={open} back={() => setOpen(null)} {...props} /> : <List openOne={setOpen} {...props} />
}

function List({ openOne, notify, go }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [making, setMaking] = useState(false)
  useEffect(() => {
    api().list().then(setList)
  }, [])
  async function create(files) {
    if (files.length < 2) return notify('Pick two pictures or more.')
    setMaking(true)
    try {
      openOne((await api().create({ pictures: files })).id)
    } catch (err) {
      notify(err.message)
    } finally {
      setMaking(false)
    }
  }
  const shown = (list || []).filter((x) => !q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="keyframes flow-page">
      <Stage effect="film" art="sequences" title="Keyframes" kicker="Pictures, brought to life in one moving video" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        <div className="stage-panel kf-new" onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), create(dropped(e)))}>
          <span className="stage-drop-text">Drop your pictures here, in order, or</span>
          <button className="btn btn-primary" disabled={making} onClick={async () => create(await pick('picture'))}>
            {making ? 'Starting…' : 'Pick pictures'}
          </button>
        </div>
        <p className="stage-note small">A photoshoot, a character’s poses, product angles, storyboard frames: IV Studio moves from each picture to the next, and back to the first if you loop it.</p>
        <WorkflowNeeds page="keyframes" />
      </Stage>
      <ToolShelf label="Your keyframes videos" count={shown.length} q={q} setQ={setQ} empty="None yet. Drop some pictures above.">
        {shown.map((x) => (
          <ShelfTile
            key={x.id}
            onOpen={() => openOne(x.id)}
            media={x.cover ? <img src={fileUrl(x.cover)} alt="" /> : <span className="shelf-empty-art">{x.pictures} pictures</span>}
            status={`${x.pictures} pictures${x.loop ? ' · loop' : ''}`}
            name={x.name}
            meta={[new Date(x.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })]}
            del={<TileDelete name={x.name} notify={notify} onDelete={async () => (await api().remove(x.id), setList(await api().list()))} />}
          />
        ))}
      </ToolShelf>
    </div>
  )
}

function Editor({ id, back, notify, jobs: live = {}, openEdit }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState('')
  const [sel, setSel] = useState(0)
  const [drag, setDrag] = useState(null) // picture id being dragged
  const [songs, setSongs] = useState([])
  const load = () =>
    api()
      .get(id)
      .then(setV)
      .catch((err) => notify(err.message))
  useEffect(() => {
    load()
    window.ivstudio.music
      .list()
      .then((l) => setSongs((l || []).filter((s) => s.status === 'success' && s.file)))
      .catch(() => {})
  }, [id])
  const states = v ? (v.mode === 'onetake' ? [v.take?.state] : v.moves.map((m) => m.state)).filter(Boolean) : []
  const rendering = states.some((s) => s.busy)
  useEffect(() => {
    if (!rendering) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [rendering])
  const ours = states.flatMap((s) => [s.previews?.id, s.finish?.id]).filter(Boolean)
  const doneKey = ours.map((j) => `${j}:${live[j]?.status || ''}`).join(',')
  useEffect(() => {
    if (ours.some((j) => DONE.includes(live[j]?.status))) load()
  }, [doneKey])

  async function run(label, fn) {
    setBusy(label)
    try {
      const r = await fn()
      if (r?.pictures) setV(r)
      else await load()
      return r
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy('')
    }
  }
  if (!v) return <div className="keyframes flow-page"><p className="dim">Loading…</p></div>

  const save = (patch, label = 'save') => run(label, () => api().save(id, patch))
  const add = async (files) => files.length && run('add', () => api().addPictures(id, files))
  const reorder = (from, to) => {
    if (from === to) return
    // dropped on a picture to its right, it goes after it; to its left, before it
    const ids = v.pictures.map((p) => p.id)
    const right = ids.indexOf(to) > ids.indexOf(from)
    ids.splice(ids.indexOf(from), 1)
    ids.splice(ids.indexOf(to) + (right ? 1 : 0), 0, from)
    run('order', () => api().reorder(id, ids))
  }
  const i = Math.min(sel, Math.max(0, v.moves.length - 1))
  const toHunt = v.mode === 'onetake' ? (v.take && !v.take.state.fresh && !v.take.state.busy ? 1 : 0) : v.moves.filter((m) => m.state && !m.state.fresh && !m.state.busy && m.state.ready).length
  async function assemble() {
    const r = await run('assemble', () => api().assemble(id))
    if (!r) return
    notify(`It’s in Edit: ${r.seconds.toFixed(1)} s. Trim, add titles and export it there.`, 'info')
    openEdit?.(r.editId)
  }
  const ready = v.mode === 'onetake' ? !!v.take?.state.fresh : v.mode === 'carried' ? !!v.moves.at(-1)?.state?.fresh : v.moves.length > 0 && v.moves.every((m) => m.state?.fresh)

  return (
    <div className="keyframes mv-editor flow-page">
      <header className="mv-top">
        <div className="mv-back-row">
          <button className="link-btn mono small mv-back" onClick={back}>
            ← Keyframes
          </button>
        </div>
        <div className="mv-title">
          <h1>{v.name}</h1>
          <span className="mono small dim">
            {v.pictures.length} pictures · {v.seconds.toFixed(1)} s{v.loop ? ' · loops' : ''} · {v.mode ? MODE_WORD[v.mode] : 'can’t render as asked'}
          </span>
        </div>
        <div className="mv-progress">
          <span className="mv-progress-n">
            {v.finished}
            <span className="dim">/{v.parts}</span>
          </span>
          <span className="mono small dim">{v.mode === 'onetake' ? 'take finished' : 'moves finished'}</span>
          <span className="mv-meter">
            <span style={{ width: `${(100 * v.finished) / Math.max(1, v.parts)}%` }} />
          </span>
        </div>
        <div className="mv-top-actions">
          <button className="btn btn-small" disabled={!!busy || !toHunt || !v.mode} onClick={() => run('huntAll', () => track(api().huntAll(id, {}), { open: { page: 'keyframes', id }, what: 'video' }))} title={v.mode === 'carried' ? 'A carried chain hunts its next move: each continues the one before' : 'Hunt everything that isn’t finished'}>
            {busy === 'huntAll' ? 'Starting…' : v.mode === 'carried' ? 'Hunt the next move' : 'Hunt all'}
          </button>
          <button className="btn btn-small btn-primary" disabled={!!busy || !ready} onClick={assemble}>
            {busy === 'assemble' ? 'Making the edit…' : 'Make the edit →'}
          </button>
        </div>
      </header>

      <section className="mv-timeline kf-strip-wrap">
        <div className="kf-strip" onDragOver={(e) => e.preventDefault()} onDrop={(e) => !drag && (e.preventDefault(), add(dropped(e)))}>
          {v.pictures.map((p, k) => {
            const moveFrom = v.moves.findIndex((m) => m.from.id === p.id)
            return (
              <div key={p.id} className="kf-step">
                <figure
                  className={`kf-pic ${drag === p.id ? 'dragging' : ''}`}
                  draggable
                  onDragStart={(e) => (setDrag(p.id), e.dataTransfer.setData('text/plain', p.id))}
                  onDragEnd={() => setDrag(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (drag) reorder(drag, p.id)
                    setDrag(null)
                  }}
                  title="Drag to reorder"
                >
                  <img src={fileUrl(p.file)} alt="" />
                  <span className="kf-pic-n mono">{k + 1}</span>
                  <button className="kf-pic-x" onClick={() => run('remove', () => api().removePicture(id, p.id))} aria-label={`Remove picture ${k + 1}`} disabled={!!busy}>
                    ×
                  </button>
                </figure>
                {moveFrom >= 0 && !v.moves[moveFrom].loopBack && <MoveArrow v={v} m={v.moves[moveFrom]} on={moveFrom === i} live={live} onClick={() => setSel(moveFrom)} />}
              </div>
            )
          })}
          {v.loop && v.moves.length > 0 && (
            <div className="kf-step">
              <MoveArrow v={v} m={v.moves.at(-1)} on={v.moves.length - 1 === i} live={live} onClick={() => setSel(v.moves.length - 1)} />
              <figure className="kf-pic kf-pic-ghost">
                <img src={fileUrl(v.pictures[0].file)} alt="" />
                <span className="kf-pic-n mono">1</span>
              </figure>
            </div>
          )}
          <button className="kf-add" onClick={async () => add(await pick('picture'))} disabled={!!busy}>
            <span>+</span>
            <span className="small">Add pictures</span>
          </button>
        </div>
        <p className="small dim kf-hint">Drag a picture to reorder. Drop more pictures on the strip to add them. Click an arrow to open that move.</p>
      </section>

      <div className="mv-grid">
        <aside className="mv-side">
          <section className="mv-card">
            <h3 className="mv-h">The idea</h3>
            <textarea className="mv-idea" rows={4} key={`idea:${v.idea}`} defaultValue={v.idea} placeholder="The whole video in a sentence or two: the setting, the mood, how things move and how the camera moves." onBlur={(e) => e.target.value !== v.idea && save({ idea: e.target.value }, 'idea')} />
            <div className="mv-shape">
              {['16:9', '9:16', '1:1'].map((a) => (
                <button key={a} className={`mv-shape-btn ${v.aspect === a ? 'on' : ''}`} onClick={() => a !== v.aspect && save({ aspect: a })} aria-pressed={v.aspect === a}>
                  <span className={`mv-shape-box r${a.replace(':', '')}`} />
                  <span className="mono small">{a}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="mv-card">
            <h3 className="mv-h">How it moves</h3>
            <label className="kf-row">
              <span className="mono small dim">Each move takes</span>
              <span className="kf-seconds">
                <input type="number" min={2} max={15} step={0.5} key={`pace:${v.pace}`} defaultValue={v.pace} onBlur={(e) => Number(e.target.value) !== v.pace && save({ pace: Number(e.target.value) })} /> s
              </span>
            </label>
            <label className="kf-check">
              <input type="checkbox" checked={!!v.loop} disabled={!!busy} onChange={() => save({ loop: !v.loop })} />
              Loop: move from the last picture back to the first
            </label>
            <div className="kf-joins" role="radiogroup" aria-label="How it renders">
              {JOINS.map(([k, label, about]) => (
                <button key={k} className={`kf-join ${v.join === k ? 'on' : ''}`} disabled={!!busy} onClick={() => k !== v.join && save({ join: k })} aria-pressed={v.join === k}>
                  <strong>{label}</strong>
                  <span className="small dim">{about}</span>
                </button>
              ))}
            </div>
            {v.join === 'onetake' && v.oneTakeProblem && <p className="small pink">{v.oneTakeProblem}</p>}
            <FirstRenders compact label="Takes" />
          </section>
          <section className="mv-card">
            <h3 className="mv-h">Sound</h3>
            <select value={v.song?.file || ''} onChange={async (e) => {
              const s = songs.find((x) => x.file === e.target.value)
              await run('song', () => api().setSong(id, s ? { file: s.file, name: s.name } : null))
            }} aria-label="Song">
              <option value="">{songs.length ? 'No song' : 'No songs in Music yet'}</option>
              {songs.map((s) => (
                <option key={s.file} value={s.file}>
                  {s.name}
                </option>
              ))}
              {v.song && !songs.some((s) => s.file === v.song.file) && <option value={v.song.file}>♪ {v.song.name}</option>}
            </select>
            <button className="link-btn mono small" onClick={async () => {
              const [f] = await pick('audio')
              if (f) run('song', () => api().setSong(id, { file: f, name: base(f) }))
            }}>
              + A sound file
            </button>
            <div className="mv-shape">
              {[['song', 'The song'], ['h3', 'Their own'], ['silent', 'Silent']].map(([k, label]) => (
                <button key={k} className={`mv-shape-btn ${v.sound === k ? 'on' : ''}`} disabled={k === 'song' && !v.song} onClick={() => k !== v.sound && save({ sound: k })} aria-pressed={v.sound === k}>
                  <span className="mono small">{label}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        {v.mode === 'onetake' ? <TakePanel v={v} m={v.moves[i]} n={v.moves.length} setSel={setSel} live={live} busy={busy} run={run} save={save} id={id} notify={notify} /> : v.moves.length ? <MovePanel key={v.moves[i].key} v={v} m={v.moves[i]} n={v.moves.length} setSel={setSel} live={live} busy={busy} run={run} save={save} id={id} notify={notify} /> : <section className="mv-scene2"><p className="dim">Add at least two pictures.</p></section>}
      </div>
    </div>
  )
}

// The arrow between two pictures: one move, with its seconds and a dot for where it stands.
function MoveArrow({ v, m, on, live, onClick }) {
  const st = m.state ? status(m.state, live) : null
  return (
    <button className={`kf-arrow ${on ? 'on' : ''} ${st ? `t-${st.tone}` : ''}`} onClick={onClick} title={v.mode === 'onetake' ? `Move ${m.index + 1} of the one take` : `Move ${m.index + 1}: ${st?.word || ''}`}>
      <span className="mono small">{m.seconds.toFixed(1)} s</span>
      <span className="kf-arrow-line" />
      {st && <span className="mv-tl-dot" />}
    </button>
  )
}

function status(s, live) {
  if (!s) return { tone: 'empty', word: '' }
  const pj = s.previews && (live[s.previews.id] || s.previews)
  const fj = s.finish && (live[s.finish.id] || s.finish)
  if (s.fresh) return { tone: 'done', word: 'Finished' }
  if (fj && !DONE.includes(fj.status)) return { tone: 'busy', word: 'Finishing' }
  if (pj && !DONE.includes(pj.status)) return { tone: 'busy', word: 'Hunting takes' }
  if (fj?.status === 'error' || pj?.status === 'error') return { tone: 'error', word: 'It failed' }
  if (s.changed) return { tone: 'changed', word: 'Changed since its render' }
  if (pj?.outputs?.some((o) => o.kind === 'preview')) return { tone: 'pick', word: 'Pick a take' }
  if (s.ready === false) return { tone: 'empty', word: 'Waits for the move before' }
  return { tone: 'ready', word: 'Ready to hunt' }
}

// Takes to pick from, then the finish, then the finished clip.
function Takes({ s, live, busy, onFinish, notify, finishLabel }) {
  const [picked, setPicked] = useState(1)
  const pj = s.previews && (live[s.previews.id] || s.previews)
  const fj = s.finish && (live[s.finish.id] || s.finish)
  const takes = pj?.outputs?.filter((o) => o.kind === 'preview') || []
  return (
    <>
      <Progress job={pj} />
      <Progress job={fj} />
      {pj?.status === 'error' && <Failure job={pj} notify={notify} />}
      {fj?.status === 'error' && <Failure job={fj} notify={notify} />}
      {takes.length > 0 && !s.fresh && (
        <div className="mv-takes">
          <span className="mono small dim">{takes.length > 1 ? 'Takes: pick the one that moves best, then finish it' : 'The take: finish it, or hunt again'}</span>
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
          <button className="btn btn-primary" disabled={!!busy || (fj && !DONE.includes(fj.status))} onClick={() => onFinish(picked)}>
            {fj && !DONE.includes(fj.status) ? 'Finishing…' : `${finishLabel} #${picked}`}
          </button>
        </div>
      )}
      {s.clip && (
        <div className="mv-final">
          <span className="mono small dim">{s.fresh ? 'Finished' : 'The last finish (changed since)'}</span>
          <video src={media(s.clip.url)} controls preload="metadata" />
        </div>
      )}
    </>
  )
}

// A move's length and its own line (for a chain, or inside the one take).
function MoveFields({ m, save }) {
  return (
    <>
      <div className="kf-pair">
        <img src={fileUrl(m.from.file)} alt="From" />
        <span className="kf-pair-arrow">→</span>
        <img src={fileUrl(m.to.file)} alt="To" />
      </div>
      <label className="kf-row">
        <span className="mono small dim">This move takes</span>
        <span className="kf-seconds">
          <input type="number" min={2} max={15} step={0.5} key={`${m.key}:${m.seconds}`} defaultValue={m.seconds} onBlur={(e) => Number(e.target.value) !== m.seconds && save({ move: { key: m.key, seconds: Number(e.target.value) } })} /> s
        </span>
      </label>
      <label className="mv-prompt-wrap">
        <span className="mono small dim">What happens in this move (optional)</span>
        <textarea className="prompt mv-prompt" rows={3} key={`${m.key}:${m.line}`} defaultValue={m.line} placeholder="She turns from the window and smiles at the camera." onBlur={(e) => e.target.value !== m.line && save({ move: { key: m.key, line: e.target.value } })} />
      </label>
    </>
  )
}

function MovePanel({ v, m, n, setSel, live, busy, run, save, id, notify }) {
  const st = status(m.state, live)
  const carried = v.mode === 'carried'
  return (
    <section className={`mv-scene2 t-${st.tone}`}>
      <header className="mv-scene2-head">
        <button className="mv-nav" disabled={m.index === 0} onClick={() => setSel(m.index - 1)} aria-label="Previous move">
          ‹
        </button>
        <div className="mv-scene2-title">
          <h2>
            Move {m.index + 1} <span className="dim">of {n}</span>
          </h2>
          <span className="mono small">
            Picture {m.index + 1} → {m.loopBack ? 'back to picture 1' : `picture ${m.index + 2}`}
          </span>
        </div>
        <span className={`mv-pill t-${st.tone}`}>{st.word}</span>
        <button className="mv-nav" disabled={m.index === n - 1} onClick={() => setSel(m.index + 1)} aria-label="Next move">
          ›
        </button>
      </header>
      <MoveFields m={m} save={save} />
      <div className="mv-scene2-actions">
        <button className="btn btn-primary" disabled={!!busy || m.state.busy || !m.state.ready} onClick={() => run('hunt', () => track(api().hunt(id, m.index, {}), { open: { page: 'keyframes', id }, what: 'video' }))} title={m.state.ready ? '' : `Finish move ${m.index} first: this one carries on from it`}>
          {m.state.busy ? 'Rendering…' : m.state.previews ? (carried && m.index > 0 ? 'Make it again' : 'Hunt new takes') : carried && m.index > 0 ? 'Make this move' : 'Hunt takes'}
        </button>
        {carried && m.index > 0 && <span className="small dim">A carried move is made once, at its finished size, from the move before.</span>}
      </div>
      <Takes s={m.state} live={live} busy={busy} notify={notify} finishLabel={carried && m.index > 0 ? 'Use take' : 'Finish take'} onFinish={(c) => run('finish', () => track(api().finish(id, m.index, { candidate: c }), { open: { page: 'keyframes', id }, what: 'video' }))} />
    </section>
  )
}

function TakePanel({ v, m, n, setSel, live, busy, run, save, id, notify }) {
  const s = v.take.state
  const st = status(s, live)
  return (
    <section className={`mv-scene2 t-${st.tone}`}>
      <header className="mv-scene2-head">
        <div className="mv-scene2-title">
          <h2>One take</h2>
          <span className="mono small">
            {v.take.pictures.length} pictures in {v.take.seconds.toFixed(1)} s, no joins
          </span>
        </div>
        <span className={`mv-pill t-${st.tone}`}>{st.word}</span>
        <button className="btn btn-primary" disabled={!!busy || s.busy} onClick={() => run('hunt', () => track(api().hunt(id, 0, {}), { open: { page: 'keyframes', id }, what: 'video' }))}>
          {s.busy ? 'Rendering…' : s.previews ? 'Hunt new takes' : 'Hunt takes'}
        </button>
      </header>
      <p className="small dim">Every picture is held at its moment in one H3 shot. Each move’s length and line still count: pick a move with the arrows on the strip or here.</p>
      {m && (
        <div className="kf-take-move">
          <div className="mv-scene2-head">
            <button className="mv-nav" disabled={m.index === 0} onClick={() => setSel(m.index - 1)} aria-label="Previous move">
              ‹
            </button>
            <span className="mv-h">
              Move {m.index + 1} <span className="dim">of {n}</span>
            </span>
            <button className="mv-nav" disabled={m.index === n - 1} onClick={() => setSel(m.index + 1)} aria-label="Next move">
              ›
            </button>
          </div>
          <MoveFields m={m} save={save} />
        </div>
      )}
      <Takes s={s} live={live} busy={busy} notify={notify} finishLabel="Finish take" onFinish={(c) => run('finish', () => track(api().finish(id, 0, { candidate: c }), { open: { page: 'keyframes', id }, what: 'video' }))} />
    </section>
  )
}
