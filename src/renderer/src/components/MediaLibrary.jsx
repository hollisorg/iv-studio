import { useEffect, useMemo, useState } from 'react'
import { media } from '../media'
import Hero from './Hero'
import { fileUrl } from './edit/model'

// Everything made in IV Studio in one place: shot, sequence and Replace renders, Edit exports, songs and
// voice lines. Each item can be shown in Explorer, put on an edit, and (sound) used as a shot's voice line.
const FILTERS = [
  ['all', 'All'],
  ['video', 'Videos'],
  ['music', 'Music'],
  ['voice', 'Voice lines']
]
const src = (file) => (file.path ? fileUrl(file.path) : media(file.url))
const secs = (d) => (d ? (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${Math.round(d)}s`) : null)

function Item({ item, edits, notify, sendToCreate, openEdit }) {
  const [target, setTarget] = useState('')
  const sound = item.type !== 'video'
  async function toEdit() {
    try {
      openEdit((await window.ivstudio.library.toEdit(item, target || null)).id)
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <div className={`lib-item ${sound ? 'lib-sound' : ''}`}>
      {sound ? (
        <div className="lib-wave mono">{item.type === 'music' ? '♪' : '“ ”'}</div>
      ) : (
        <div className="tile-media">
          <video src={`${src(item.file)}#t=0.3`} controls preload="metadata" />
        </div>
      )}
      <div className="tile-body">
        <span className="tile-name" title={item.label}>
          {item.label}
        </span>
        <span className="mono dim small">
          {[item.group, item.detail, secs(item.duration), new Date(item.at).toLocaleDateString()].filter(Boolean).join(' · ')}
        </span>
        {sound && <audio controls preload="none" src={src(item.file)} />}
        <div className="lib-actions">
          {sound && (
            <button className="btn btn-small btn-primary" onClick={() => sendToCreate({ kind: item.type === 'music' ? 'music' : 'line', file: item.file.path, text: item.type === 'voice' ? item.label : '', name: item.label })}>
              Use in a shot
            </button>
          )}
          <select value={target} onChange={(e) => setTarget(e.target.value)} title="Which edit">
            <option value="">New edit</option>
            {edits.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button className="btn btn-small" onClick={toEdit}>
            Add to edit
          </button>
          <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(item.file).catch((err) => notify(err.message))}>
            Show file
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MediaLibrary(ctx) {
  const [items, setItems] = useState(null)
  const [edits, setEdits] = useState([])
  const [filter, setFilter] = useState(() => {
    try {
      return localStorage.getItem('iv.libraryFilter') || 'all'
    } catch {
      return 'all'
    }
  })
  const [q, setQ] = useState('')
  useEffect(() => {
    window.ivstudio.library.all().then(setItems, (err) => (ctx.notify(err.message), setItems([])))
    window.ivstudio.edits.list().then(setEdits, () => {})
  }, [])
  const pick = (f) => {
    setFilter(f)
    try {
      localStorage.setItem('iv.libraryFilter', f)
    } catch {}
  }
  const count = (f) => (items || []).filter((i) => f === 'all' || i.type === f).length
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (items || []).filter((i) => (filter === 'all' || i.type === filter) && words.every((w) => `${i.label} ${i.group} ${i.detail || ''}`.toLowerCase().includes(w)))
  }, [items, filter, q])

  return (
    <div className="media-library">
      <Hero title="Library" kicker="Everything you've made" />
      <p className="lede">
        Every video, song and line in one place.
        <span className="lede-small dim">Shots, sequences, Replace runs, Edit exports, Music and Lines, newest first. Put any of them on an edit, or use a sound as a shot's voice line.</span>
      </p>
      <div className="lib-bar">
        <div className="segmented">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => pick(id)}>
              {label} <span className="dim">{items ? count(id) : ''}</span>
            </button>
          ))}
        </div>
        <input className="lib-search" value={q} placeholder="Search" onChange={(e) => setQ(e.target.value)} />
      </div>
      {items === null && <p className="dim mono">Loading…</p>}
      {items && shown.length === 0 && <p className="dim">{items.length ? 'Nothing matches.' : 'Nothing made yet. Make a shot on Create, or a song on Audio > Music.'}</p>}
      <div className="lib-grid">
        {shown.map((i) => (
          <Item key={i.key} item={i} edits={edits} {...ctx} />
        ))}
      </div>
    </div>
  )
}
