import { useRef, useState } from 'react'
import { clipEnd, clipFor, clipKind, clipLength, fits, snap, timecode } from './model'

const LANE = 46
const SNAP_PX = 8

// The timeline: ruler, playhead, tracks and clips. Drag a clip to move it (across tracks of its kind),
// drag an edge to trim, drop media from the bin onto a track. Changes are committed on release.
export default function Timeline({ tracks, clips, media, time, zoom, selected, snapOn, onSeek, onSelect, onCommit, length }) {
  const lanes = useRef(null)
  const [drag, setDrag] = useState(null) // {id, preview} while dragging
  const dragRef = useRef(null)
  const shown = drag?.preview ? clips.map((c) => (c.id === drag.id ? drag.preview : c)) : clips
  const width = Math.max(length + 10, 30) * zoom

  const points = (exceptId) => [0, time, ...clips.filter((c) => c.id !== exceptId).flatMap((c) => [c.start, clipEnd(c)])]
  const secondsAt = (clientX) => (clientX - lanes.current.getBoundingClientRect().left + lanes.current.scrollLeft) / zoom
  const trackAt = (clientY) => {
    const top = lanes.current.getBoundingClientRect().top + 24 // below the ruler
    return tracks[Math.floor((clientY - top) / LANE)]?.id
  }

  function startDrag(e, c, mode) {
    e.stopPropagation()
    e.preventDefault()
    onSelect(c.id)
    const move = (ev) => {
      const dt = (ev.clientX - e.clientX) / zoom
      const tol = snapOn ? SNAP_PX / zoom : 0
      const m = media[c.media]
      const maxOut = m?.kind === 'video' || m?.kind === 'audio' ? m.duration : Infinity
      let p = { ...c }
      if (mode === 'move') {
        let start = Math.max(0, c.start + dt)
        const s1 = snap(start, points(c.id), tol)
        const s2 = snap(start + clipLength(c), points(c.id), tol) - clipLength(c)
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2
        const t = trackAt(ev.clientY)
        p = { ...p, start: Math.max(0, start), track: t && fits(clipKind(c, media), t) ? t : c.track }
      } else if (mode === 'left') {
        let start = snap(c.start + dt, points(c.id), tol)
        start = Math.min(Math.max(start, c.start - c.in, 0), clipEnd(c) - 0.1)
        p = { ...p, start, in: c.in + (start - c.start) }
      } else {
        let end = snap(clipEnd(c) + dt, points(c.id), tol)
        const out = Math.min(Math.max(c.in + 0.1, c.out + (end - clipEnd(c))), maxOut)
        p = { ...p, out }
      }
      dragRef.current = { id: c.id, preview: p }
      setDrag(dragRef.current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (d?.preview) onCommit(clips.map((x) => (x.id === d.id ? d.preview : x)))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function scrub(e) {
    const seek = (ev) => onSeek(Math.max(0, secondsAt(ev.clientX)))
    seek(e)
    const up = () => {
      window.removeEventListener('pointermove', seek)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', seek)
    window.addEventListener('pointerup', up)
  }

  function drop(e, track) {
    e.preventDefault()
    const id = e.dataTransfer.getData('application/x-iv-media')
    const m = media[id]
    if (!m || !fits(m.kind, track)) return
    const start = snapOn ? snap(secondsAt(e.clientX), points(null), SNAP_PX / zoom) : secondsAt(e.clientX)
    const c = clipFor(m, track, start)
    onCommit([...clips, c])
    onSelect(c.id)
  }

  const step = zoom > 80 ? 1 : zoom > 30 ? 2 : zoom > 12 ? 5 : 10
  const ticks = Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step)

  return (
    <div className="tl">
      <div className="tl-heads">
        <div className="tl-ruler-head" />
        {tracks.map((t) => (
          <div key={t.id} className={`tl-head ${t.kind}`}>
            {t.label}
          </div>
        ))}
      </div>
      <div className="tl-lanes" ref={lanes} onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}>
        <div className="tl-inner" style={{ width }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * zoom }}>
                {timecode(s).slice(0, 5)}
              </span>
            ))}
          </div>
          {tracks.map((t) => (
            <div
              key={t.id}
              className={`tl-lane ${t.kind}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, t.id)}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) {
                  onSelect(null)
                  scrub(e)
                }
              }}
            >
              {shown
                .filter((c) => c.track === t.id)
                .map((c) => {
                  const m = media[c.media]
                  const label = c.track === 'T1' ? c.text?.content || 'Title' : m?.name || 'Missing media'
                  return (
                    <div
                      key={c.id}
                      className={`tl-clip ${clipKind(c, media)} ${selected === c.id ? 'on' : ''} ${c.muted ? 'muted' : ''}`}
                      style={{ left: c.start * zoom, width: Math.max(6, clipLength(c) * zoom) }}
                      onPointerDown={(e) => startDrag(e, c, 'move')}
                      title={`${label} · ${clipLength(c).toFixed(2)} s`}
                    >
                      {c.fadeIn > 0 && <span className="tl-fade in" style={{ width: c.fadeIn * zoom }} />}
                      {c.fadeOut > 0 && <span className="tl-fade out" style={{ width: c.fadeOut * zoom }} />}
                      <span className="tl-clip-name">{label}</span>
                      <span className="tl-edge left" onPointerDown={(e) => startDrag(e, c, 'left')} />
                      <span className="tl-edge right" onPointerDown={(e) => startDrag(e, c, 'right')} />
                    </div>
                  )
                })}
            </div>
          ))}
          <div className="tl-playhead" style={{ left: time * zoom }} />
        </div>
      </div>
    </div>
  )
}
