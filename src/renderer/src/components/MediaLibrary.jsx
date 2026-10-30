import { useEffect, useMemo, useRef, useState } from 'react'
import { media } from '../media'
import Hero from './Hero'
import { fileUrl } from './edit/model'

// Everything made in IV Studio in one place: shot, sequence and Replace renders, Edit exports, pictures
// (Create -> Image), songs and voice lines. The takes of one shot (its previews and finals), of one sequence or of one edit are a single
// tile; clicking it opens a viewer that plays them big and steps through every version.
const FILTERS = [
  ['all', 'All'],
  ['video', 'Videos'],
  ['image', 'Images'],
  ['music', 'Music'],
  ['voice', 'Voice lines']
]
const src = (file) => (file.path ? fileUrl(file.path) : media(file.url))
const secs = (d) => (d ? (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${Math.round(d)}s`) : null)
const day = (at) => (at ? new Date(at).toLocaleDateString() : '')

// Items grouped into sets (a shot, a sequence, an edit), best version first, newest set first.
export function toSets(items) {
  const map = new Map()
  for (const i of items) {
    const k = i.set || i.key
    if (!map.has(k)) map.set(k, { key: k, name: i.setName || i.label, group: i.group, type: i.type, items: [] })
    map.get(k).items.push(i)
  }
  const sets = [...map.values()]
  for (const s of sets) {
    s.items.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(b.at).localeCompare(String(a.at)))
    s.at = s.items.reduce((m, i) => (String(i.at) > m ? String(i.at) : m), '')
    s.cover = s.items[0]
  }
  return sets.sort((a, b) => b.at.localeCompare(a.at))
}

function Player({ item }) {
  if (item.type === 'video') return <video key={item.key} className="viewer-media" src={src(item.file)} controls autoPlay playsInline />
  if (item.type === 'image') return <img key={item.key} className="viewer-media" src={src(item.file)} alt={item.label} />
  return (
    <div className="viewer-sound">
      <div className="viewer-sound-art mono">{item.type === 'music' ? '♪' : '“ ”'}</div>
      {item.type === 'voice' && <p className="viewer-words">{item.label}</p>}
      <audio key={item.key} src={src(item.file)} controls autoPlay />
    </div>
  )
}

// The pop-up: one version big, every version of the set underneath, and the next or previous set a click
// (or an arrow key) away.
export function Viewer({ sets, at, setAt, onClose, edits, notify, sendToCreate, pictureToShot, openEdit, openShot, openSequence }) {
  const [si, ii] = at
  const set = sets[si]
  const item = set?.items[ii]
  const [target, setTarget] = useState('')
  // every version of every set, in order, for the arrow keys
  const flat = useMemo(() => sets.flatMap((s, a) => s.items.map((_, b) => [a, b])), [sets])
  const pos = flat.findIndex(([a, b]) => a === si && b === ii)
  const step = (d) => {
    const next = flat[pos + d]
    if (next) setAt(next)
  }
  const stepSet = (d) => sets[si + d] && setAt([si + d, 0])
  useEffect(() => {
    const key = (e) => {
      if (e.target.tagName === 'SELECT') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') (e.preventDefault(), step(1))
      else if (e.key === 'ArrowLeft') (e.preventDefault(), step(-1))
      else if (e.key === 'ArrowDown') (e.preventDefault(), stepSet(1))
      else if (e.key === 'ArrowUp') (e.preventDefault(), stepSet(-1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  if (!item) return null
  async function toEdit() {
    try {
      openEdit((await window.ivstudio.library.toEdit(item, target || null)).id)
    } catch (err) {
      notify(err.message)
    }
  }
  const sound = item.type !== 'video'
  return (
    <div className="viewer-backdrop" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={set.name}>
        <div className="viewer-head">
          <div className="viewer-title">
            <span className="mono small dim">
              {set.group} · {pos + 1} of {flat.length}
            </span>
            <h2>{set.name}</h2>
          </div>
          <button className="link-btn mono" onClick={onClose}>
            Close ×
          </button>
        </div>
        <div className="viewer-stage">
          <button className="viewer-nav" disabled={pos <= 0} onClick={() => step(-1)} aria-label="Previous">
            ‹
          </button>
          <Player item={item} />
          <button className="viewer-nav" disabled={pos >= flat.length - 1} onClick={() => step(1)} aria-label="Next">
            ›
          </button>
        </div>
        <div className="viewer-meta">
          <span className="viewer-variant">{item.variant || item.label}</span>
          <span className="mono small dim">{[item.detail, secs(item.duration), new Date(item.at).toLocaleString()].filter(Boolean).join(' · ')}</span>
        </div>
        {set.items.length > 1 && (
          <div className="viewer-strip">
            {set.items.map((x, k) => (
              <button key={x.key} className={`viewer-thumb ${k === ii ? 'on' : ''}`} onClick={() => setAt([si, k])}>
                {x.type === 'video' ? <video src={`${src(x.file)}#t=0.3`} muted preload="metadata" /> : x.type === 'image' ? <img src={src(x.file)} alt="" loading="lazy" /> : <span className="viewer-thumb-sound">{x.type === 'music' ? '♪' : '“ ”'}</span>}
                <span className="mono small">{x.variant || x.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="viewer-actions">
          {item.type === 'image' && (
            <button className="btn btn-small btn-primary" onClick={() => (onClose(), pictureToShot(item.file.path))}>
              Use in a shot
            </button>
          )}
          {sound && (
            <button className="btn btn-small btn-primary" onClick={() => sendToCreate({ kind: item.type === 'music' ? 'music' : 'line', file: item.file.path, text: item.type === 'voice' ? item.label : '', name: set.name })}>
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
          {item.projectId && (
            <button className="btn btn-small" onClick={() => openShot(item.projectId)}>
              Open shot
            </button>
          )}
          {item.sequenceId && (
            <button className="btn btn-small" onClick={() => openSequence(item.sequenceId)}>
              Open sequence
            </button>
          )}
          <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(item.file).catch((err) => notify(err.message))}>
            Show file
          </button>
          <span className="mono small dim viewer-keys">← → versions · ↑ ↓ next tile · Esc closes</span>
        </div>
      </div>
    </div>
  )
}

export function Tile({ set, onOpen }) {
  const c = set.cover
  const ref = useRef(null)
  const count = set.items.length
  return (
    <button className={`lib-item lib-tile ${c.type !== 'video' && c.type !== 'image' ? 'lib-sound' : ''}`} onClick={onOpen} onMouseEnter={() => ref.current?.play?.().catch(() => {})} onMouseLeave={() => ref.current?.pause?.()}>
      {c.type === 'video' ? (
        <div className="tile-media">
          <video ref={ref} src={`${src(c.file)}#t=0.3`} muted loop playsInline preload="metadata" />
          <span className="lib-play" aria-hidden="true">
            ▶
          </span>
        </div>
      ) : c.type === 'image' ? (
        <div className="tile-media">
          <img src={src(c.file)} alt="" loading="lazy" />
        </div>
      ) : (
        <div className="lib-wave mono">{c.type === 'music' ? '♪' : '“ ”'}</div>
      )}
      {count > 1 && <span className="lib-count mono">{count} {c.type === 'image' ? 'pictures' : 'versions'}</span>}
      <span className="tile-body">
        <span className="tile-name" title={set.name}>
          {set.name}
        </span>
        <span className="mono dim small">{[set.group, c.variant, c.detail, secs(c.duration), day(set.at)].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  )
}

export default function MediaLibrary(ctx) {
  const [items, setItems] = useState(null)
  const [edits, setEdits] = useState([])
  const [open, setOpen] = useState(null) // [set index, version index]
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
  const allSets = useMemo(() => toSets(items || []), [items])
  const count = (f) => allSets.filter((s) => f === 'all' || s.type === f).length
  const sets = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return allSets.filter((s) => (filter === 'all' || s.type === filter) && words.every((w) => `${s.name} ${s.group} ${s.items.map((i) => `${i.label} ${i.detail || ''}`).join(' ')}`.toLowerCase().includes(w)))
  }, [allSets, filter, q])

  return (
    <div className="media-library">
      <Hero art="library" title="Library" kicker="Everything you've made" />
      <p className="lede">
        Every video, song and line in one place.
        <span className="lede-small dim">A shot's previews and finals, a sequence's takes and an edit's exports are one tile. Click it to watch every version and step through them.</span>
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
      {items && sets.length === 0 && <p className="dim">{items.length ? 'Nothing matches.' : 'Nothing made yet. Make a shot on Create, or a song on Audio > Music.'}</p>}
      <div className="lib-grid">
        {sets.map((s, i) => (
          <Tile key={s.key} set={s} onOpen={() => setOpen([i, 0])} />
        ))}
      </div>
      {open && sets[open[0]] && <Viewer sets={sets} at={open} setAt={setOpen} onClose={() => setOpen(null)} edits={edits} {...ctx} />}
    </div>
  )
}
