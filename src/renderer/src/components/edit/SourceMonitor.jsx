import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FRAME, fileUrl, timecode } from './model'
import { Wave, usePeaks } from './thumbs'

// The source monitor, like Premiere's: plays one piece of media from the bin, marks In and Out on it, and
// puts that part on the timeline (, inserts and . overwrites at the playhead on the target track, or drag
// the picture onto a track). The editor drives it from the keyboard through the ref.
const SourceMonitor = forwardRef(function SourceMonitor({ m, marks, onMarks, onInsert, onOverwrite, active, onFocus }, ref) {
  const el = useRef(null)
  const bar = useRef(null)
  const [t, setT] = useState(0)
  const [rate, setRate] = useState(0) // 0 paused, >0 forward, <0 backward
  const wave = usePeaks(m?.kind === 'audio' ? m : null)
  const dur = m ? (m.kind === 'image' ? 4 : m.duration || 0) : 0
  const mi = marks?.in ?? 0
  const mo = marks?.out ?? dur

  useEffect(() => {
    setT(marks?.in ?? 0)
    setRate(0)
  }, [m?.id])

  // Forward: the element plays at the rate. Backward: step it back every frame (silent).
  useEffect(() => {
    const v = el.current
    if (!v || m?.kind === 'image') return
    if (rate > 0) {
      v.playbackRate = rate
      v.play().catch(() => {})
      return
    }
    v.pause()
    if (rate < 0) {
      let last = performance.now()
      let raf
      const tick = (now) => {
        const next = Math.max(0, v.currentTime + ((now - last) / 1000) * rate)
        last = now
        v.currentTime = next
        setT(next)
        if (next <= 0) return setRate(0)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }
  }, [rate, m?.id])

  const seek = (x) => {
    const v = Math.max(0, Math.min(dur, x))
    setT(v)
    if (el.current && m?.kind !== 'image') el.current.currentTime = v
  }
  const range = () => ({ in: Math.min(mi, mo - FRAME), out: mo })
  useImperativeHandle(ref, () => ({
    toggle: () => setRate((r) => (r ? 0 : 1)),
    shuttle: (dir) => setRate((r) => (dir === 0 ? 0 : dir > 0 ? (r > 0 ? Math.min(8, r * 2) : 1) : r < 0 ? Math.max(-8, r * 2) : -1)),
    step: (frames) => (setRate(0), seek(t + frames * FRAME)),
    home: () => seek(0),
    end: () => seek(dur),
    markIn: () => onMarks({ in: Math.min(t, mo - FRAME), out: marks?.out }),
    markOut: () => onMarks({ in: marks?.in, out: Math.max(t, mi + FRAME) }),
    clear: () => onMarks({}),
    range,
    loaded: () => !!m
  }))

  function scrub(e) {
    const at = (ev) => {
      const r = bar.current.getBoundingClientRect()
      seek(((ev.clientX - r.left) / r.width) * dur)
    }
    setRate(0)
    at(e)
    const up = () => {
      window.removeEventListener('pointermove', at)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', at)
    window.addEventListener('pointerup', up)
  }

  const pct = (v) => `${dur ? (v / dur) * 100 : 0}%`
  return (
    <section className={`ed-panel ed-monitor ${active ? 'active' : ''}`} onPointerDown={onFocus}>
      <header className="ed-panel-head">
        <span className="mono label">Source</span>
        <span className="small dim ed-monitor-name">{m ? m.name : 'Nothing loaded'}</span>
      </header>
      <div
        className="ed-screen"
        draggable={!!m}
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-iv-media', m.id)
          e.dataTransfer.setData('application/x-iv-range', JSON.stringify(range()))
        }}
        title={m ? 'Drag onto a track to place the marked part' : ''}
      >
        {!m && <p className="small dim ed-screen-empty">Click something in the bin to see it here, mark In (I) and Out (O), then press , to insert it or . to overwrite.</p>}
        {m?.kind === 'video' && <video ref={el} src={fileUrl(m.path)} preload="auto" onTimeUpdate={(e) => rate > 0 && setT(e.target.currentTime)} onEnded={() => setRate(0)} onSeeked={(e) => !rate && setT(e.target.currentTime)} onLoadedData={(e) => (e.target.currentTime = t)} />}
        {m?.kind === 'audio' && (
          <>
            <audio ref={el} src={fileUrl(m.path)} preload="auto" onTimeUpdate={(e) => rate > 0 && setT(e.target.currentTime)} onEnded={() => setRate(0)} onSeeked={(e) => !rate && setT(e.target.currentTime)} />
            <div className="ed-screen-wave">
              <Wave wave={wave} from={0} to={dur} width={640} height={120} />
            </div>
          </>
        )}
        {m?.kind === 'image' && <img src={fileUrl(m.path)} alt="" />}
      </div>
      <div className="ed-src-bar" ref={bar} onPointerDown={scrub}>
        {(marks?.in != null || marks?.out != null) && <span className="ed-src-range" style={{ left: pct(mi), width: `calc(${pct(mo)} - ${pct(mi)})` }} />}
        <span className="ed-src-head" style={{ left: pct(t) }} />
      </div>
      <div className="ed-transport">
        <button className="btn btn-small" disabled={!m} onClick={() => onMarks({ in: Math.min(t, mo - FRAME), out: marks?.out })} title="Mark In (I)">
          I
        </button>
        <button className="btn btn-small" disabled={!m} onClick={() => onMarks({ in: marks?.in, out: Math.max(t, mi + FRAME) })} title="Mark Out (O)">
          O
        </button>
        <button className="btn btn-small" disabled={!m || m.kind === 'image'} onClick={() => setRate(rate ? 0 : 1)} title="Play (Space, J K L)">
          {rate ? 'Pause' : 'Play'}
        </button>
        <span className="mono ed-tc">
          {timecode(t)} · <span className="dim">{timecode(mo - mi)}</span>
        </span>
        <button className="btn btn-small" disabled={!m} onClick={() => onInsert(range())} title="Insert at the playhead on the target track (,)">
          Insert ,
        </button>
        <button className="btn btn-small" disabled={!m} onClick={() => onOverwrite(range())} title="Overwrite at the playhead on the target track (.)">
          Overwrite .
        </button>
      </div>
    </section>
  )
})

export default SourceMonitor
