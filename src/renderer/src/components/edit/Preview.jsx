import { useEffect, useRef } from 'react'
import { active, clipEnd, fadeGain, fileUrl } from './model'

// The live preview: one hidden <video>/<audio>/<img> per clip, kept in step with the playhead, and a
// canvas that draws V1, then V2 over it, then titles, each with its fade. Sound comes from the media
// elements themselves (volume x fade). Playing drives the playhead; when paused it shows the frame.
export default function Preview({ clips, media, format, time, playing, length, onTime, onEnd }) {
  const canvas = useRef(null)
  const els = useRef(new Map()) // clip id -> element
  const clock = useRef({ base: 0, t0: 0 })
  const state = useRef({ clips, media, time, playing })
  state.current = { clips, media, time, playing }

  const W = 960
  const H = Math.round((W * format.height) / format.width)

  // One element per clip that has media.
  useEffect(() => {
    const map = els.current
    for (const c of clips) {
      const m = media[c.media]
      if (!m || map.has(c.id)) continue
      const el = m.kind === 'image' ? new Image() : document.createElement(m.kind === 'audio' ? 'audio' : 'video')
      el.src = fileUrl(m.path)
      if (m.kind !== 'image') {
        el.preload = 'auto'
        el.playsInline = true
        el.addEventListener('seeked', () => !state.current.playing && draw(state.current.time))
        el.addEventListener('loadeddata', () => !state.current.playing && draw(state.current.time))
      } else el.onload = () => draw(state.current.time)
      map.set(c.id, el)
    }
    for (const [id, el] of map) {
      if (!clips.some((c) => c.id === id && media[c.media]?.path && fileUrl(media[c.media].path) === el.src)) {
        el.pause?.()
        el.removeAttribute('src')
        map.delete(id)
      }
    }
  }, [clips, media])

  function draw(t) {
    const cv = canvas.current
    if (!cv) return
    const g = cv.getContext('2d')
    g.globalAlpha = 1
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, H)
    for (const track of ['V1', 'V2']) {
      for (const c of active(state.current.clips, track, t)) {
        const el = els.current.get(c.id)
        const ready = el && (el instanceof HTMLImageElement ? el.complete && el.naturalWidth : el.readyState >= 2)
        if (!ready) continue
        const sw = el.videoWidth || el.naturalWidth
        const sh = el.videoHeight || el.naturalHeight
        const s = Math.min(W / sw, H / sh)
        g.globalAlpha = fadeGain(c, t)
        g.drawImage(el, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s)
      }
    }
    for (const c of active(state.current.clips, 'T1', t)) {
      const tx = c.text || {}
      if (!tx.content) continue
      const size = ((tx.size || 8) * H) / 100
      g.globalAlpha = fadeGain(c, t)
      g.font = `600 ${size}px "Barlow Condensed", "Barlow", Impact, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'top'
      const lines = tx.content.split('\n')
      const lh = size * 1.15
      const block = lh * lines.length
      const y0 = { top: H * 0.08, center: (H - block) / 2, bottom: H * 0.92 - block }[tx.position || 'bottom']
      if (tx.box) {
        const w = Math.max(...lines.map((l) => g.measureText(l).width)) + size * 0.7
        g.fillStyle = 'rgba(0,0,0,0.55)'
        g.fillRect((W - w) / 2, y0 - size * 0.25, w, block + size * 0.4)
      }
      g.fillStyle = tx.color || '#f4ecdc'
      lines.forEach((l, i) => g.fillText(l, W / 2, y0 + i * lh))
    }
    g.globalAlpha = 1
  }

  // Puts every media element where it should be at time t (playing or not).
  function sync(t, play) {
    for (const c of state.current.clips) {
      const el = els.current.get(c.id)
      if (!el || el instanceof HTMLImageElement) continue
      const on = t >= c.start && t < clipEnd(c)
      if (!on) {
        if (!el.paused) el.pause()
        continue
      }
      const want = c.in + (t - c.start)
      el.muted = !!c.muted
      el.volume = Math.max(0, Math.min(1, (c.volume ?? 1) * fadeGain(c, t)))
      if (play) {
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
        if (el.paused) el.play().catch(() => {})
      } else {
        if (!el.paused) el.pause()
        if (Math.abs(el.currentTime - want) > 0.02) el.currentTime = want
      }
    }
  }

  // Playing: the clock drives time; every frame syncs the elements and draws.
  useEffect(() => {
    if (!playing) {
      sync(time, false)
      draw(time)
      return
    }
    clock.current = { base: time, t0: performance.now() }
    let raf
    let lastReport = 0
    const tick = (now) => {
      const t = clock.current.base + (now - clock.current.t0) / 1000
      if (t >= length) {
        sync(length, false)
        onTime(length)
        onEnd()
        return
      }
      sync(t, true)
      draw(t)
      if (now - lastReport > 33) {
        lastReport = now
        onTime(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const el of els.current.values()) el.pause?.()
    }
  }, [playing])

  // Paused: redraw whenever the time or the edit changes.
  useEffect(() => {
    if (!playing) {
      sync(time, false)
      draw(time)
    }
  }, [time, clips, media, format])

  useEffect(
    () => () => {
      for (const el of els.current.values()) {
        el.pause?.()
        el.removeAttribute('src')
      }
    },
    []
  )

  return <canvas ref={canvas} className="ed-canvas" width={W} height={H} />
}
