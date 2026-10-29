import { useCallback, useEffect, useRef, useState } from 'react'
import Inspector from './Inspector'
import Preview from './Preview'
import ProjectBin from './ProjectBin'
import SourceMonitor from './SourceMonitor'
import Timeline from './Timeline'
import { FRAME, clipEnd, clipFor, clipLength, describeChange, editLength, editPoints, insert, newId, nextTrackId, overwrite, remove, split, timecode, titleClip, tracksOf } from './model'

// Panel sizes, remembered between sessions: bin and effect-controls widths, the source monitor's share
// of the two monitors, and the timeline's height.
const LAYOUT = { bin: 280, insp: 270, src: 0.5, tl: 330 }
function useLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return { ...LAYOUT, ...JSON.parse(localStorage.getItem('iv.editLayout') || '{}') }
    } catch {
      return LAYOUT
    }
  })
  const set = (patch) =>
    setLayout((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem('iv.editLayout', JSON.stringify(next))
      } catch {}
      return next
    })
  return [layout, set]
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
function dragSplit(e, onMove) {
  e.preventDefault()
  const x0 = e.clientX
  const y0 = e.clientY
  const move = (ev) => onMove(ev.clientX - x0, ev.clientY - y0)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.classList.remove('resizing')
  }
  document.body.classList.add('resizing')
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
const TOOLS = [
  ['select', 'Select', 'V'],
  ['razor', 'Razor', 'C'],
  ['ripple', 'Ripple', 'B'],
  ['roll', 'Roll', 'N']
]
const fitFades = (c) => {
  const len = clipLength(c)
  const fadeIn = Math.min(c.fadeIn || 0, len)
  return { ...c, fadeIn, fadeOut: Math.min(c.fadeOut || 0, len - fadeIn) }
}

// The editor, laid out like Premiere: project bin, source and program monitors and effect controls on top,
// the timeline below, every border draggable. A full-screen workspace hides IV Studio's own sidebar.
// An agent edits the same file through the MCP server: its changes appear here with a one-click undo.
export default function EditEditor({ editId, notify, go, focus, setFocus }) {
  const [meta, setMeta] = useState(null)
  const [edit, setEdit] = useState(null)
  const [hist, setHist] = useState({ past: [], future: [] })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [selected, setSelected] = useState(null)
  const [selMarker, setSelMarker] = useState(null)
  const [zoom, setZoom] = useState(40)
  const [snapOn, setSnapOn] = useState(true)
  const [tool, setTool] = useState('select')
  const [targets, setTargets] = useState({ video: 'V1', audio: 'A1' })
  const [sourceId, setSourceId] = useState(null)
  const [marks, setMarks] = useState({}) // media id -> { in, out } in the source monitor
  const [panel, setPanel] = useState('program') // which monitor the keys drive
  const [agent, setAgent] = useState(null) // { text, at, mark, log }
  const [showLog, setShowLog] = useState(false)
  const [exp, setExp] = useState(null) // {progress} | {file} | null
  const [layout, setLayout] = useLayout()
  const [tlWidth, setTlWidth] = useState(800)
  const saveTimer = useRef(null)
  const editRef = useRef(null)
  const source = useRef(null)
  const panels = useRef(null)
  const keyRef = useRef(null)
  editRef.current = edit

  useEffect(() => {
    window.ivstudio.edits.meta().then(setMeta)
    window.ivstudio.edits.get(editId).then(setEdit)
    return window.ivstudio.edits.onProgress((p) => p.id === editId && setExp((x) => (x && !x.file ? { progress: p.progress } : x)))
  }, [editId])

  const persist = useCallback((e) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => window.ivstudio.edits.save(e.id, { name: e.name, settings: e.settings, media: e.media, clips: e.clips, tracks: e.tracks, markers: e.markers || [] }).catch((err) => notify(err.message)), 500)
  }, [])
  useEffect(() => () => editRef.current && window.ivstudio.edits.save(editRef.current.id, editRef.current), [])

  // Every change to the timeline goes through here, so it can be undone. The undo stacks live in a ref
  // (hist is only mirrored into state to enable the buttons).
  const snapshot = (e) => ({ clips: e.clips, media: e.media, tracks: e.tracks, markers: e.markers || [] })
  const histRef = useRef({ past: [], future: [] })
  const apply = (next) => {
    editRef.current = next
    setEdit(next)
    persist(next)
  }
  const commit = (patch) => {
    const e = editRef.current
    histRef.current = { past: [...histRef.current.past.slice(-99), snapshot(e)], future: [] }
    setHist(histRef.current)
    apply({ ...e, ...patch })
  }
  const undo = () => {
    const h = histRef.current
    if (!h.past.length) return
    const e = editRef.current
    histRef.current = { past: h.past.slice(0, -1), future: [snapshot(e), ...h.future] }
    setHist(histRef.current)
    apply({ ...e, ...h.past.at(-1) })
  }
  const redo = () => {
    const h = histRef.current
    if (!h.future.length) return
    const e = editRef.current
    histRef.current = { past: [...h.past, snapshot(e)], future: h.future.slice(1) }
    setHist(histRef.current)
    apply({ ...e, ...h.future[0] })
  }

  // An agent changed this edit through the MCP server: show its version, say what it did, and keep ours
  // one undo away.
  useEffect(
    () =>
      window.ivstudio.edits.onChanged(async ({ id }) => {
        if (id !== editId) return
        const fresh = await window.ivstudio.edits.get(id)
        const e = editRef.current
        const same = (k) => JSON.stringify(fresh[k] ?? null) === JSON.stringify(e?.[k] ?? null)
        if (!e || ['clips', 'media', 'name', 'settings', 'tracks', 'markers'].every(same)) return
        clearTimeout(saveTimer.current)
        histRef.current = { past: [...histRef.current.past.slice(-99), snapshot(e)], future: [] }
        setHist(histRef.current)
        editRef.current = fresh
        setEdit(fresh)
        const text = describeChange(e, fresh)
        const at = new Date()
        setAgent((a) => ({ text, at, mark: histRef.current.past.length, undone: false, log: [{ text, at }, ...(a?.log || [])].slice(0, 12) }))
      }),
    [editId]
  )

  const toggleFocus = (on = !focus) => {
    setFocus(on)
    window.ivstudio.edits.fullScreen(on).catch(() => {})
  }

  if (!edit || !meta) return null
  const tracks = tracksOf(edit)
  const markers = edit.markers || []
  const isLocked = (id) => !!tracks.find((t) => t.id === id)?.locked
  const length = editLength(edit.clips)
  const seek = (t) => {
    setPlaying(false)
    setTime(Math.max(0, Math.min(t, Math.max(length, 0))))
  }
  const selClip = edit.clips.find((c) => c.id === selected)
  const format = meta.formats[edit.settings.format] || meta.formats['1080p']
  const srcMedia = edit.media[sourceId]

  const play = () => {
    if (time >= length) setTime(0)
    setRate(1)
    setPlaying(!playing)
  }
  const shuttle = (dir) => {
    if (dir === 0) return setPlaying(false), setRate(1)
    const r = playing ? rate : 0
    const next = dir > 0 ? (r > 0 ? Math.min(8, r * 2) : 1) : r < 0 ? Math.max(-8, r * 2) : -1
    if (next > 0 && time >= length) setTime(0)
    setRate(next)
    setPlaying(true)
  }

  function doSplit() {
    const under = (c) => time > c.start && time < clipEnd(c) && !isLocked(c.track)
    const target = selClip && under(selClip) ? selClip : edit.clips.find((c) => under(c) && c.track === targets.video) || edit.clips.find((c) => under(c) && c.track[0] === 'V')
    const next = target && split(edit.clips, target.id, time)
    if (next) commit({ clips: next })
  }
  function splitAll() {
    let next = edit.clips
    for (const c of edit.clips) if (!isLocked(c.track)) next = split(next, c.id, time) || next
    if (next !== edit.clips) commit({ clips: next })
  }
  function doDelete(ripple) {
    if (selMarker && !selected) {
      commit({ markers: markers.filter((m) => m.id !== selMarker) })
      return setSelMarker(null)
    }
    if (!selClip) return
    if (isLocked(selClip.track)) return notify(`${selClip.track} is locked.`)
    commit({ clips: remove(edit.clips, selected, ripple) })
    setSelected(null)
  }
  // Q and W: cut the clip under the playhead from its start (or to its end) and close the gap.
  function rippleTrim(side) {
    const under = (c) => time > c.start + FRAME && time < clipEnd(c) - FRAME && !isLocked(c.track)
    const c = (selClip && under(selClip) && selClip) || edit.clips.find((x) => x.track === targets.video && under(x)) || edit.clips.find((x) => x.track === targets.audio && under(x)) || edit.clips.find(under)
    if (!c) return
    const cut = side === 'start' ? time - c.start : clipEnd(c) - time
    const trimmed = fitFades(side === 'start' ? { ...c, in: c.in + cut } : { ...c, out: c.out - cut })
    commit({ clips: edit.clips.map((x) => (x.id === c.id ? trimmed : x.track === c.track && x.start >= clipEnd(c) - 1e-6 ? { ...x, start: x.start - cut } : x)) })
    if (side === 'start') seek(c.start)
  }
  function place(kind, range = source.current?.range()) {
    if (!srcMedia || !range) return notify('Open something in the source monitor first: click it in the bin.')
    const track = srcMedia.kind === 'audio' ? targets.audio : targets.video
    if (!tracks.some((t) => t.id === track)) return notify(`Pick a target track: click a ${srcMedia.kind === 'audio' ? 'A' : 'V'} track's name.`)
    if (isLocked(track)) return notify(`${track} is locked.`)
    const c = { ...clipFor(srcMedia, track, time), in: range.in, out: range.out }
    commit({ clips: (kind === 'insert' ? insert : overwrite)(edit.clips, c) })
    setSelected(c.id)
    setTime(time + clipLength(c))
  }
  function addMarker() {
    const near = markers.find((m) => Math.abs(m.t - time) < FRAME)
    if (near) return setSelMarker(near.id)
    const m = { id: newId(), t: Math.round(time * 1000) / 1000, label: '', color: null }
    commit({ markers: [...markers, m].sort((a, b) => a.t - b.t) })
    setSelMarker(m.id)
  }
  const jumpMarker = (dir) => {
    const m = dir > 0 ? markers.find((x) => x.t > time + 1e-3) : [...markers].reverse().find((x) => x.t < time - 1e-3)
    if (m) seek(m.t), setSelMarker(m.id)
  }
  const jumpEdit = (dir) => {
    const pts = editPoints(edit.clips)
    const t = dir > 0 ? pts.find((p) => p > time + 1e-3) : [...pts].reverse().find((p) => p < time - 1e-3)
    if (t != null) seek(t)
  }
  const fit = () => setZoom(clamp((tlWidth - 40) / Math.max(length, 1), 2, 300))
  const zoomBy = (f) => setZoom((z) => clamp(z * f, 2, 300))
  const setTracks = (next) => commit({ tracks: next })
  const addTrack = (kind) => {
    const id = nextTrackId(tracks, kind)
    setTracks([...tracks, { id, kind, label: id }])
  }

  // Premiere's keys, except while typing in a field. The source monitor takes the transport keys while
  // it's the active panel (click it); the program monitor and timeline take them otherwise.
  const onKey = (e) => {
    if (/input|textarea|select/i.test(e.target.tagName) || e.target.isContentEditable) return
    const k = e.key
    const lower = k.toLowerCase()
    const src = panel === 'source' && source.current?.loaded()
    let done = true
    if (k === 'F11' || k === '`') toggleFocus()
    else if (k === 'Escape' && focus) toggleFocus(false)
    else if (e.ctrlKey && lower === 'z') (e.shiftKey ? redo : undo)()
    else if (e.ctrlKey && lower === 'y') redo()
    else if (e.ctrlKey && lower === 'k') splitAll()
    else if (e.ctrlKey && e.shiftKey && lower === 'm') jumpMarker(-1)
    else if (e.ctrlKey || e.altKey || e.metaKey) done = false
    else if (k === ',') place('insert')
    else if (k === '.') place('overwrite')
    else if (src && k === ' ') source.current.toggle()
    else if (src && lower === 'j') source.current.shuttle(-1)
    else if (src && lower === 'k') source.current.shuttle(0)
    else if (src && lower === 'l') source.current.shuttle(1)
    else if (src && lower === 'i') source.current.markIn()
    else if (src && lower === 'o') source.current.markOut()
    else if (src && k === 'ArrowLeft') source.current.step(e.shiftKey ? -24 : -1)
    else if (src && k === 'ArrowRight') source.current.step(e.shiftKey ? 24 : 1)
    else if (src && k === 'Home') source.current.home()
    else if (src && k === 'End') source.current.end()
    else if (k === ' ') play()
    else if (lower === 'j') shuttle(-1)
    else if (lower === 'k') shuttle(0)
    else if (lower === 'l') shuttle(1)
    else if (k === 'ArrowLeft') seek(time - (e.shiftKey ? 1 : FRAME))
    else if (k === 'ArrowRight') seek(time + (e.shiftKey ? 1 : FRAME))
    else if (k === 'ArrowUp') jumpEdit(-1)
    else if (k === 'ArrowDown') jumpEdit(1)
    else if (k === 'Home') seek(0)
    else if (k === 'End') seek(length)
    else if (lower === 'v') setTool('select')
    else if (lower === 'c') setTool('razor')
    else if (lower === 'b') setTool('ripple')
    else if (lower === 'n') setTool('roll')
    else if (lower === 's') doSplit()
    else if (lower === 'q') rippleTrim('start')
    else if (lower === 'w') rippleTrim('end')
    else if (lower === 'm') (e.shiftKey ? jumpMarker(1) : addMarker())
    else if (k === 'Delete' || k === 'Backspace') doDelete(e.shiftKey)
    else if (k === '\\') fit()
    else if (k === '=' || k === '+') zoomBy(1.25)
    else if (k === '-' || k === '_') zoomBy(0.8)
    else done = false
    if (done) e.preventDefault()
  }
  keyRef.current = onKey

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

  const addMedia = (m, { place: put = true } = {}) => {
    const e = editRef.current
    // the first file of an empty edit goes straight onto the timeline, so one click is enough to start
    const track = m.kind === 'audio' ? targets.audio : targets.video
    const first = put && !e.clips.length && !isLocked(track)
    commit({ media: { ...e.media, [m.id]: m }, clips: first ? [...e.clips, clipFor(m, track, editLength(e.clips.filter((c) => c.track === track)))] : e.clips })
    setSourceId(m.id)
  }
  const monitorsWidth = () => (panels.current?.clientWidth || 1200) - layout.bin - layout.insp - 18

  return (
    <div className={`ed ${focus ? 'ed-focus' : ''}`} style={{ gridTemplateRows: `auto minmax(150px, 1fr) 6px auto ${layout.tl}px` }}>
      <KeyListener handler={keyRef} />
      <div className="ed-top">
        <button className="link-btn mono" onClick={() => (focus && toggleFocus(false), go('edits'))}>
          ← All edits
        </button>
        <input className="ed-name" value={edit.name} onChange={(e) => (setEdit({ ...edit, name: e.target.value }), persist({ ...edit, name: e.target.value }))} />
        <span className="mono dim">
          {format.label} · {edit.settings.fps} fps · {timecode(length)}
        </span>
        <div className="ed-export">
          <button className="btn btn-small" onClick={() => toggleFocus()} title={focus ? 'Back to IV Studio (Esc)' : 'Full-screen workspace (F11)'}>
            {focus ? 'Exit full screen' : '⤢ Full screen'}
          </button>
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

      <div className="ed-panels" ref={panels} style={{ gridTemplateColumns: `${layout.bin}px 6px minmax(0, ${layout.src}fr) 6px minmax(0, ${1 - layout.src}fr) 6px ${layout.insp}px` }}>
        <ProjectBin media={edit.media} sourceId={sourceId} onSource={(id) => (setSourceId(id), setPanel('source'))} onAdd={addMedia} onTitle={() => (isLocked('T1') ? notify('Titles are locked.') : commit({ clips: [...edit.clips, titleClip(time)] }))} notify={notify} />
        <div className="ed-split v" onPointerDown={(e) => dragSplit(e, (dx) => setLayout({ bin: clamp(layout.bin + dx, 180, 520) }))} />
        <SourceMonitor
          ref={source}
          m={srcMedia}
          marks={marks[sourceId]}
          onMarks={(mk) => setMarks({ ...marks, [sourceId]: mk })}
          onInsert={(r) => place('insert', r)}
          onOverwrite={(r) => place('overwrite', r)}
          active={panel === 'source'}
          onFocus={() => setPanel('source')}
        />
        <div className="ed-split v" onPointerDown={(e) => dragSplit(e, (dx) => setLayout({ src: clamp(layout.src + dx / monitorsWidth(), 0.2, 0.8) }))} />
        <section className={`ed-panel ed-monitor ${panel === 'program' ? 'active' : ''}`} onPointerDown={() => setPanel('program')}>
          <header className="ed-panel-head">
            <span className="mono label">Program</span>
            <span className="small dim ed-monitor-name">{edit.name}</span>
            {playing && rate !== 1 && <span className="mono ed-rate">{rate > 0 ? `${rate}×` : `◀ ${-rate}×`}</span>}
          </header>
          <div className="ed-screen">
            <Preview clips={edit.clips} media={edit.media} tracks={tracks} format={format} time={time} playing={playing} rate={rate} length={length} onTime={setTime} onEnd={() => (setPlaying(false), setRate(1))} />
          </div>
          <div className="ed-transport">
            <button className="btn btn-small" onClick={() => jumpEdit(-1)} title="Previous edit (↑)">
              ⏮
            </button>
            <button className="btn btn-small" onClick={() => seek(time - FRAME)} title="Back one frame (←)">
              ◀
            </button>
            <button className="btn btn-primary ed-play" onClick={play} disabled={!length} title="Play (Space, J K L)">
              {playing ? 'Pause' : 'Play'}
            </button>
            <button className="btn btn-small" onClick={() => seek(time + FRAME)} title="Forward one frame (→)">
              ▶
            </button>
            <button className="btn btn-small" onClick={() => jumpEdit(1)} title="Next edit (↓)">
              ⏭
            </button>
            <span className="mono ed-tc">
              {timecode(time)} / {timecode(length)}
            </span>
          </div>
        </section>
        <div className="ed-split v" onPointerDown={(e) => dragSplit(e, (dx) => setLayout({ insp: clamp(layout.insp - dx, 200, 480) }))} />
        <section className="ed-panel ed-effects">
          <header className="ed-panel-head">
            <span className="mono label">Effect controls</span>
          </header>
          <Inspector
            clip={selClip}
            media={edit.media}
            meta={meta}
            settings={edit.settings}
            markers={markers}
            selMarker={selMarker}
            onSeek={seek}
            onMarkers={(next) => commit({ markers: next })}
            onClip={(c) => (isLocked(c.track) ? notify(`${c.track} is locked.`) : commit({ clips: edit.clips.map((x) => (x.id === c.id ? c : x)) }))}
            onSettings={(s) => {
              const next = { ...edit, settings: { ...edit.settings, ...s } }
              setEdit(next)
              persist(next)
            }}
          />
        </section>
      </div>
      <div className="ed-split h" onPointerDown={(e) => dragSplit(e, (_, dy) => setLayout({ tl: clamp(layout.tl - dy, 160, window.innerHeight - 260) }))} />

      <div className="ed-toolbar">
        <div className="ed-tools">
          <div className="segmented ed-seg ed-toolset" role="radiogroup" aria-label="Tool">
            {TOOLS.map(([id, label, key]) => (
              <button key={id} role="radio" aria-checked={tool === id} className={tool === id ? 'on' : ''} onClick={() => setTool(id)} title={`${label} (${key})`}>
                {label} <span className="dim mono">{key}</span>
              </button>
            ))}
          </div>
          <button className="btn btn-small" disabled={!edit.clips.length} onClick={doSplit} title="Split at the playhead (S); every track: Ctrl+K">
            Split
          </button>
          <button className="btn btn-small" disabled={!selected} onClick={() => doDelete(false)} title="Delete">
            Delete
          </button>
          <button className="btn btn-small" disabled={!selected} onClick={() => doDelete(true)} title="Ripple delete (Shift+Delete)">
            Ripple delete
          </button>
          <button className="btn btn-small" onClick={addMarker} title="Add a marker at the playhead (M)">
            Marker
          </button>
          <span className="ed-sep" />
          <button className="btn btn-small" disabled={!hist.past.length} onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn btn-small" disabled={!hist.future.length} onClick={redo} title="Redo (Ctrl+Y)">
            Redo
          </button>
          <span className="ed-sep" />
          <button className="btn btn-small" onClick={() => addTrack('video')} title="Add a video track on top">
            + Video track
          </button>
          <button className="btn btn-small" onClick={() => addTrack('audio')} title="Add a sound track">
            + Audio track
          </button>
          <label className="ed-check small">
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Snap
          </label>
          <span className="ed-zoom-label dim small">Zoom</span>
          <button className="btn btn-small" onClick={() => zoomBy(0.8)} title="Zoom out (−)">
            −
          </button>
          <input type="range" min={2} max={300} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="ed-zoom" aria-label="Zoom" />
          <button className="btn btn-small" onClick={() => zoomBy(1.25)} title="Zoom in (=)">
            +
          </button>
          <button className="btn btn-small" onClick={fit} title="Fit the whole edit (\)">
            Fit
          </button>
        </div>
        {agent && (
          <div className={`ed-agent ${agent.undone ? 'undone' : ''}`} role="status">
            <span className="ed-agent-dot" />
            <span className="mono label">Agent</span>
            <span className="ed-agent-text">{agent.undone ? `Undone: ${agent.text.toLowerCase()}` : agent.text}</span>
            <span className="mono dim small">{agent.at.toLocaleTimeString()}</span>
            {agent.log.length > 1 && (
              <button className="link-btn mono" onClick={() => setShowLog(!showLog)}>
                {showLog ? 'Hide' : `History (${agent.log.length})`}
              </button>
            )}
            {!agent.undone && (
              <button className="btn btn-small" disabled={hist.past.length !== agent.mark} title={hist.past.length !== agent.mark ? 'You have changed things since; use Undo in the toolbar' : 'Put back what was there before'} onClick={() => (undo(), setAgent({ ...agent, undone: true }))}>
                Undo
              </button>
            )}
            <button className="link-btn ed-agent-close" title="Dismiss" onClick={() => (setAgent(null), setShowLog(false))}>
              ×
            </button>
            {showLog && (
              <ol className="ed-agent-log small">
                {agent.log.map((x, i) => (
                  <li key={i}>
                    <span className="mono dim">{x.at.toLocaleTimeString()}</span> {x.text}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
      <div className="ed-tl-wrap" onPointerDownCapture={() => setPanel('program')}>
        <Timeline
          tracks={tracks}
          clips={edit.clips}
          media={edit.media}
          markers={markers}
          time={time}
          zoom={zoom}
          selected={selected}
          selectedMarker={selMarker}
          snapOn={snapOn}
          tool={tool}
          targets={targets}
          length={length}
          height={layout.tl}
          onSeek={seek}
          onSelect={(id) => (setSelected(id), id && setSelMarker(null))}
          onSelectMarker={(id) => (setSelMarker(id), setSelected(null))}
          onCommit={(clips) => commit({ clips })}
          onMarkers={(next) => commit({ markers: next })}
          onTrack={(id, patch) => setTracks(tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)))}
          onTarget={(t) => setTargets({ ...targets, [t.kind]: t.id })}
          onRemoveTrack={(id) => setTracks(tracks.filter((t) => t.id !== id))}
          onWidth={setTlWidth}
          notify={notify}
        />
      </div>
    </div>
  )
}

// One window keydown listener for the editor's lifetime; it always calls the latest handler.
function KeyListener({ handler }) {
  useEffect(() => {
    const on = (e) => handler.current(e)
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  return null
}
