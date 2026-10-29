import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './model'

// Filmstrips and waveforms are made once per file by the main process (ffmpeg, cached on disk) and kept here
// for the session, so every clip and bin tile of the same file shares one request.
const strips = new Map() // path -> Promise<{file, every, count, w, h}>
const waves = new Map() // path -> Promise<{rate, peaks}>

function useCached(cache, key, make) {
  const [value, setValue] = useState(null)
  useEffect(() => {
    if (!key) return setValue(null)
    let live = true
    if (!cache.has(key)) cache.set(key, make().catch(() => null))
    cache.get(key).then((v) => live && setValue(v))
    return () => {
      live = false
    }
  }, [key])
  return value
}

export const useStrip = (m) => useCached(strips, m?.kind === 'video' ? m.path : null, () => window.ivstudio.edits.filmstrip(m.path, m.duration))
export const usePeaks = (m) => useCached(waves, m && (m.kind === 'audio' || (m.kind === 'video' && m.hasAudio)) ? m.path : null, () => window.ivstudio.edits.peaks(m.path))

// A row of frames across a clip: each tile shows the frame at its own spot in media[from..to].
export function Filmstrip({ m, strip, from, to, width, height }) {
  if (m?.kind === 'image') return <div className="strip" style={{ backgroundImage: `url("${fileUrl(m.path)}")`, backgroundSize: `auto ${height}px`, height }} />
  if (!strip) return null
  const tileW = Math.round((height * strip.w) / strip.h)
  const tiles = Math.min(200, Math.max(1, Math.ceil(width / tileW)))
  const url = `url("${fileUrl(strip.file)}")`
  return (
    <div className="strip" style={{ height }}>
      {Array.from({ length: tiles }, (_, k) => {
        const t = from + ((k + 0.5) * tileW * (to - from)) / Math.max(1, width)
        const idx = Math.max(0, Math.min(strip.count - 1, Math.floor(t / strip.every)))
        return <span key={k} style={{ left: k * tileW, width: tileW, backgroundImage: url, backgroundSize: `${strip.count * tileW}px ${height}px`, backgroundPosition: `${-idx * tileW}px 0` }} />
      })}
    </div>
  )
}

// A waveform of media[from..to], drawn at most 4096 pixels wide and stretched to `width`.
export function Wave({ wave, from, to, width, height, color = 'rgba(178, 236, 205, 0.85)' }) {
  const ref = useRef(null)
  const W = Math.max(1, Math.min(4096, Math.round(width)))
  useEffect(() => {
    const cv = ref.current
    if (!cv || !wave) return
    const g = cv.getContext('2d')
    g.clearRect(0, 0, W, height)
    g.fillStyle = color
    const { peaks, rate } = wave
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor((from + ((to - from) * x) / W) * rate)
      const i1 = Math.max(i0 + 1, Math.ceil((from + ((to - from) * (x + 1)) / W) * rate))
      let m = 0
      for (let i = i0, step = Math.max(1, Math.floor((i1 - i0) / 64)); i < i1 && i < peaks.length; i += step) m = Math.max(m, peaks[i])
      const h = Math.max(1, (m / 255) * height)
      g.fillRect(x, (height - h) / 2, 1, h)
    }
  }, [wave, from, to, W, height, color])
  if (!wave) return null
  return <canvas ref={ref} className="wave" width={W} height={height} style={{ width, height }} />
}
