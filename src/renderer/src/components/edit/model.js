// Timeline maths shared by the editor's parts. Times are seconds; a clip plays media[in..out] from
// `start` on the timeline.
import { clipEnd } from '../../../../service/timeline'

export { FRAME, clipLength, clipEnd, newId, fits, clipKind, clipFor, titleClip, split, remove } from '../../../../service/timeline'
export const editLength = (clips) => clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
export const fileUrl = (p) => `ivfile://local/?p=${encodeURIComponent(p)}`

// 0..1 visibility/loudness of a clip at timeline time t (its fades).
export function fadeGain(c, t) {
  const into = t - c.start
  const left = clipEnd(c) - t
  let g = 1
  if (c.fadeIn > 0 && into < c.fadeIn) g = Math.min(g, Math.max(0, into / c.fadeIn))
  if (c.fadeOut > 0 && left < c.fadeOut) g = Math.min(g, Math.max(0, left / c.fadeOut))
  return g
}

export const active = (clips, track, t) => clips.filter((c) => c.track === track && t >= c.start && t < clipEnd(c)).sort((a, b) => a.start - b.start)

export function timecode(t) {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const f = Math.floor((s % 1) * 24)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

// Nearest snap point (clip edges on every track, the playhead, zero) within `tolerance` seconds.
export function snap(value, points, tolerance) {
  let best = value
  let dist = tolerance
  for (const p of points) {
    const d = Math.abs(p - value)
    if (d < dist) {
      dist = d
      best = p
    }
  }
  return best
}
