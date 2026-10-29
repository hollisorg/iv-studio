import { useCallback, useEffect, useRef, useState } from 'react'
import Hero from './Hero'
import TileDelete from './TileDelete'
import Preview from './edit/Preview'
import Timeline from './edit/Timeline'
import { FRAME, clipEnd, clipFor, clipKind, clipLength, editLength, remove, split, timecode, titleClip } from './edit/model'

export function EditList({ openEdit, notify }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    window.ivstudio.edits.list().then(setList)
  }, [])
  async function create() {
    try {
      openEdit((await window.ivstudio.edits.create('Untitled edit')).id)
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <div className="edits">
      <Hero title="Edit" kicker="Infinite Variance" />
      <p className="lede">
        Cut your shots and sequences together.
        <span className="lede-small dim">A multi-track timeline with trims, fades, titles and sound, played live and exported as one MP4.</span>
      </p>
      <button className="btn btn-primary" onClick={create}>
        New edit
      </button>
      <div className="tiles seq-tiles">
        {list?.map((e) => (
          <div key={e.id} className="tile-wrap">
          <button className="tile" onClick={() => openEdit(e.id)}>
            <div className="tile-body">
              <span className="tile-name">{e.name}</span>
              <span className="mono dim">
                {e.clips} clip{e.clips === 1 ? '' : 's'} · {timecode(e.seconds)} · {e.exports} export{e.exports === 1 ? '' : 's'}
              </span>
              <span className="mono dim">{new Date(e.updatedAt).toLocaleString()}</span>
            </div>
          </button>
          <TileDelete name={e.name} keeps="Its media files and exported videos stay on disk." notify={notify} onDelete={async () => (await window.ivstudio.edits.delete(e.id), setList(await window.ivstudio.edits.list()))} />
          </div>
        ))}
      </div>
    </div>
  )
}

// Media in the edit, plus ways to add more: files on this PC, IV Studio renders, titles.
function Bin({ media, onAdd, onTitle, notify }) {
  const [lib, setLib] = useState(null)
  const [busy, setBusy] = useState(null)
  async function pick() {
    try {
      const added = await window.ivstudio.edits.pickFiles()
      added.forEach(onAdd)
    } catch (err) {
      notify(err.message)
    }
  }
  async function addOutput(item) {
    setBusy(item.key)
    try {
      onAdd(await window.ivstudio.edits.addOutput(item))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="ed-bin">
      <div className="ed-bin-actions">
        <button className="btn btn-small" onClick={pick}>
          + Files
        </button>
        <button className="btn btn-small" onClick={async () => setLib(lib ? null : await window.ivstudio.edits.library())}>
          {lib ? 'Close renders' : '+ IV renders'}
        </button>
        <button className="btn btn-small" onClick={onTitle}>
          + Title
        </button>
      </div>
      {lib && (
        <div className="ed-lib">
          {lib.length === 0 && <p className="small dim">No renders yet.</p>}
          {lib.map((item) => (
            <button key={item.key} className="ed-lib-item" disabled={!!busy} onClick={() => addOutput(item)}>
              <span className="mono dim">{item.group}</span>
              <span className="small">{busy === item.key ? 'Adding…' : item.label}</span>
            </button>
          ))}
        </div>
      )}
      <p className="mono label ed-bin-label">Media · drag onto a track</p>
      {Object.values(media).length === 0 && <p className="small dim">Add files or IV Studio renders, then drag them onto the timeline.</p>}
      {Object.values(media).map((m) => (
        <div key={m.id} className={`ed-media ${m.kind}`} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-iv-media', m.id)} title={m.path}>
          <span className="ed-media-kind mono">{m.kind}</span>
          <span className="ed-media-name small">{m.name}</span>
          <span className="mono dim">{m.duration ? timecode(m.duration) : 'still'}</span>
        </div>
      ))}
    </div>
  )
}

function Num({ label, value, onChange, step = 0.1, min = 0, max }) {
  return (
    <label className="ed-num">
      <span className="dim small">{label}</span>
      <input type="number" step={step} min={min} max={max} value={Number(value ?? 0).toFixed(2)} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} />
    </label>
  )
}

function Inspector({ clip, media, meta, settings, onClip, onSettings }) {
  if (!clip)
    return (
      <div className="ed-insp">
        <p className="mono label">Edit settings</p>
        <span className="dim small">Format</span>
        <div className="segmented ed-seg">
          {Object.entries(meta.formats).map(([id, f]) => (
            <button key={id} className={settings.format === id ? 'on' : ''} onClick={() => onSettings({ format: id })}>
              {f.label.split(' ')[0]}
            </button>
          ))}
        </div>
        <span className="dim small">Frame rate</span>
        <div className="segmented ed-seg">
          {[24, 30, 60].map((f) => (
            <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => onSettings({ fps: f })}>
              {f}
            </button>
          ))}
        </div>
        <p className="small dim ed-help">
          Space play · S split at playhead · Delete remove · Shift+Delete ripple · Ctrl+Z undo · ← → one frame
        </p>
      </div>
    )
  const m = media[clip.media]
  const kind = clipKind(clip, media)
  const set = (patch) => onClip({ ...clip, ...patch })
  return (
    <div className="ed-insp">
      <p className="mono label">{kind === 'text' ? 'Title' : m?.name || 'Clip'}</p>
      {kind === 'text' && (
        <>
          <textarea rows={3} value={clip.text.content} onChange={(e) => set({ text: { ...clip.text, content: e.target.value } })} />
          <div className="segmented ed-seg">
            {['top', 'center', 'bottom'].map((p) => (
              <button key={p} className={clip.text.position === p ? 'on' : ''} onClick={() => set({ text: { ...clip.text, position: p } })}>
                {p}
              </button>
            ))}
          </div>
          <div className="ed-row">
            <Num label="Size %" value={clip.text.size} step={0.5} min={2} max={30} onChange={(v) => set({ text: { ...clip.text, size: v } })} />
            <label className="ed-num">
              <span className="dim small">Colour</span>
              <input type="color" value={clip.text.color || '#f4ecdc'} onChange={(e) => set({ text: { ...clip.text, color: e.target.value } })} />
            </label>
          </div>
          <label className="ed-check small">
            <input type="checkbox" checked={!!clip.text.box} onChange={(e) => set({ text: { ...clip.text, box: e.target.checked } })} /> Dark box behind
          </label>
        </>
      )}
      <div className="ed-row">
        <Num label="Start" value={clip.start} onChange={(v) => set({ start: v })} />
        <Num label="Length" value={clipLength(clip)} min={0.1} max={m?.duration ? m.duration - clip.in : undefined} onChange={(v) => set({ out: clip.in + v })} />
      </div>
      {kind !== 'text' && kind !== 'image' && (
        <div className="ed-row">
          <Num label="In (source)" value={clip.in} max={clip.out - 0.1} onChange={(v) => set({ in: v })} />
          <Num label="Out (source)" value={clip.out} min={clip.in + 0.1} max={m?.duration} onChange={(v) => set({ out: v })} />
        </div>
      )}
      <div className="ed-row">
        <Num label="Fade in" value={clip.fadeIn} max={clipLength(clip)} onChange={(v) => set({ fadeIn: v })} />
        <Num label="Fade out" value={clip.fadeOut} max={clipLength(clip)} onChange={(v) => set({ fadeOut: v })} />
      </div>
      {(kind === 'audio' || (kind === 'video' && m?.hasAudio)) && (
        <>
          <span className="dim small">Volume {Math.round((clip.volume ?? 1) * 100)}%</span>
          <input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1} onChange={(e) => set({ volume: Number(e.target.value) })} />
          <label className="ed-check small">
            <input type="checkbox" checked={!!clip.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute this clip
          </label>
        </>
      )}
    </div>
  )
}

export function EditEditor({ editId, notify, go }) {
  const [meta, setMeta] = useState(null)
  const [edit, setEdit] = useState(null)
  const [hist, setHist] = useState({ past: [], future: [] })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [zoom, setZoom] = useState(40)
  const [snapOn, setSnapOn] = useState(true)
  const [exp, setExp] = useState(null) // {progress} | {file} | null
  const saveTimer = useRef(null)
  const editRef = useRef(null)
  editRef.current = edit

  useEffect(() => {
    window.ivstudio.edits.meta().then(setMeta)
    window.ivstudio.edits.get(editId).then(setEdit)
    return window.ivstudio.edits.onProgress((p) => p.id === editId && setExp((x) => (x && !x.file ? { progress: p.progress } : x)))
  }, [editId])

  const persist = useCallback((e) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.ivstudio.edits.save(e.id, { name: e.name, settings: e.settings, media: e.media, clips: e.clips }).catch((err) => notify(err.message)), 500)
  }, [])
  useEffect(() => () => editRef.current && window.ivstudio.edits.save(editRef.current.id, editRef.current), [])

  // Every change to clips/media goes through here, so it can be undone. The undo stacks live in a ref
  // (hist is only mirrored into state to enable the buttons).
  const histRef = useRef({ past: [], future: [] })
  const apply = (next) => {
    editRef.current = next
    setEdit(next)
    persist(next)
  }
  const commit = (patch) => {
    const e = editRef.current
    histRef.current = { past: [...histRef.current.past.slice(-99), { clips: e.clips, media: e.media }], future: [] }
    setHist(histRef.current)
    apply({ ...e, ...patch })
  }
  const undo = () => {
    const h = histRef.current
    if (!h.past.length) return
    const e = editRef.current
    histRef.current = { past: h.past.slice(0, -1), future: [{ clips: e.clips, media: e.media }, ...h.future] }
    setHist(histRef.current)
    apply({ ...e, ...h.past.at(-1) })
  }
  const redo = () => {
    const h = histRef.current
    if (!h.future.length) return
    const e = editRef.current
    histRef.current = { past: [...h.past, { clips: e.clips, media: e.media }], future: h.future.slice(1) }
    setHist(histRef.current)
    apply({ ...e, ...h.future[0] })
  }

  // An agent changed this edit through the MCP server: show its version, with ours one undo away.
  useEffect(
    () =>
      window.ivstudio.edits.onChanged(async ({ id }) => {
        if (id !== editId) return
        const fresh = await window.ivstudio.edits.get(id)
        const e = editRef.current
        const same = (k) => JSON.stringify(fresh[k]) === JSON.stringify(e[k])
        if (!e || ['clips', 'media', 'name', 'settings'].every(same)) return
        clearTimeout(saveTimer.current)
        histRef.current = { past: [...histRef.current.past.slice(-99), { clips: e.clips, media: e.media }], future: [] }
        setHist(histRef.current)
        editRef.current = fresh
        setEdit(fresh)
        notify('An agent changed this edit. Ctrl+Z puts it back.')
      }),
    [editId]
  )

  const length = edit ? editLength(edit.clips) : 0
  const seek = (t) => {
    setPlaying(false)
    setTime(Math.max(0, Math.min(t, Math.max(length, 0))))
  }
  const selClip = edit?.clips.find((c) => c.id === selected)

  function doSplit() {
    const target = selClip && time > selClip.start && time < clipEnd(selClip) ? selClip : edit.clips.find((c) => time > c.start && time < clipEnd(c) && c.track.startsWith('V'))
    const next = target && split(edit.clips, target.id, time)
    if (next) commit({ clips: next })
  }
  function doDelete(ripple) {
    if (!selected) return
    commit({ clips: remove(edit.clips, selected, ripple) })
    setSelected(null)
  }

  // Keyboard shortcuts, except while typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      if (!edit || /input|textarea|select/i.test(e.target.tagName)) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (time >= length) setTime(0)
        setPlaying((p) => !p)
      } else if (e.key === 's' || e.key === 'S') doSplit()
      else if (e.key === 'Delete' || e.key === 'Backspace') doDelete(e.shiftKey)
      else if (e.ctrlKey && e.key.toLowerCase() === 'z') (e.shiftKey ? redo : undo)()
      else if (e.ctrlKey && e.key.toLowerCase() === 'y') redo()
      else if (e.key === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : FRAME))
      else if (e.key === 'ArrowRight') seek(time + (e.shiftKey ? 1 : FRAME))
      else if (e.key === 'Home') seek(0)
      else if (e.key === 'End') seek(length)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function exportEdit() {
    setPlaying(false)
    clearTimeout(saveTimer.current)
    await window.ivstudio.edits.save(edit.id, edit)
    setExp({ progress: 0 })
    try {
      const file = await window.ivstudio.edits.export(edit.id)
      setExp({ file })
    } catch (err) {
      setExp(null)
      notify(err.message)
    }
  }

  if (!edit || !meta) return null
  const format = meta.formats[edit.settings.format] || meta.formats['1080p']
  const addMedia = (m) => {
    // dropped straight on the end of V1 (or A1 for sound), so one click is enough to start cutting
    const track = m.kind === 'audio' ? 'A1' : 'V1'
    const end = editLength(editRef.current.clips.filter((c) => c.track === track))
    commit({ media: { ...editRef.current.media, [m.id]: m }, clips: [...editRef.current.clips, clipFor(m, track, end)] })
  }

  return (
    <div className="ed">
      <div className="ed-top">
        <button className="link-btn mono" onClick={() => go('edits')}>
          ← All edits
        </button>
        <input className="ed-name" value={edit.name} onChange={(e) => (setEdit({ ...edit, name: e.target.value }), persist({ ...edit, name: e.target.value }))} />
        <span className="mono dim">
          {format.label} · {edit.settings.fps} fps · {timecode(length)}
        </span>
        <div className="ed-export">
          {exp?.progress != null && (
            <>
              <div className="bar">
                <span style={{ width: `${Math.round(exp.progress * 100)}%` }} />
              </div>
              <button className="link-btn mono" onClick={() => window.ivstudio.edits.cancelExport(edit.id)}>
                Cancel
              </button>
            </>
          )}
          {exp?.file && (
            <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(exp.file)}>
              Exported · show in folder
            </button>
          )}
          <button className="btn btn-primary" disabled={!edit.clips.length || exp?.progress != null} onClick={exportEdit}>
            {exp?.progress != null ? `Exporting ${Math.round(exp.progress * 100)}%` : 'Export MP4'}
          </button>
        </div>
      </div>

      <div className="ed-main">
        <Bin media={edit.media} onAdd={addMedia} onTitle={() => commit({ clips: [...edit.clips, titleClip(time)] })} notify={notify} />
        <div className="ed-stage">
          <Preview clips={edit.clips} media={edit.media} format={format} time={time} playing={playing} length={length} onTime={setTime} onEnd={() => setPlaying(false)} />
          <div className="ed-transport">
            <button className="btn btn-small" onClick={() => seek(0)} title="Start (Home)">
              ⏮
            </button>
            <button className="btn btn-small" onClick={() => seek(time - FRAME)} title="Back one frame (←)">
              ◀
            </button>
            <button
              className="btn btn-primary ed-play"
              onClick={() => {
                if (time >= length) setTime(0)
                setPlaying(!playing)
              }}
              disabled={!length}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn btn-small" onClick={() => seek(time + FRAME)} title="Forward one frame (→)">
              ▶
            </button>
            <span className="mono ed-tc">
              {timecode(time)} / {timecode(length)}
            </span>
          </div>
        </div>
        <Inspector
          clip={selClip}
          media={edit.media}
          meta={meta}
          settings={edit.settings}
          onClip={(c) => commit({ clips: edit.clips.map((x) => (x.id === c.id ? c : x)) })}
          onSettings={(s) => {
            const next = { ...edit, settings: { ...edit.settings, ...s } }
            setEdit(next)
            persist(next)
          }}
        />
      </div>

      <div className="ed-tools">
        <button className="btn btn-small" disabled={!edit.clips.length} onClick={doSplit} title="Split at playhead (S)">
          Split
        </button>
        <button className="btn btn-small" disabled={!selected} onClick={() => doDelete(false)} title="Delete">
          Delete
        </button>
        <button className="btn btn-small" disabled={!selected} onClick={() => doDelete(true)} title="Ripple delete (Shift+Delete)">
          Ripple delete
        </button>
        <button className="btn btn-small" disabled={!hist.past.length} onClick={undo} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button className="btn btn-small" disabled={!hist.future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">
          Redo
        </button>
        <label className="ed-check small">
          <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Snap
        </label>
        <span className="dim small ed-zoom-label">Zoom</span>
        <input type="range" min={8} max={200} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="ed-zoom" />
      </div>
      <Timeline
        tracks={meta.tracks}
        clips={edit.clips}
        media={edit.media}
        time={time}
        zoom={zoom}
        selected={selected}
        snapOn={snapOn}
        length={length}
        onSeek={seek}
        onSelect={setSelected}
        onCommit={(clips) => commit({ clips })}
      />
    </div>
  )
}
