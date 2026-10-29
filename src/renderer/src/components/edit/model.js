// Timeline maths shared by the editor's parts. Times are seconds; a clip plays media[in..out] from
// `start` on the timeline.
export const FRAME = 1 / 24
export const clipLength = (c) => Math.max(0, c.out - c.in)
export const clipEnd = (c) => c.start + clipLength(c)
export const editLength = (clips) => clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
export const newId = () => Math.random().toString(36).slice(2, 9)
export const fileUrl = (p) => `ivfile://local/?p=${encodeURIComponent(p)}`

// Which tracks a kind of clip may sit on.
export const fits = (kind, trackId) => (kind === 'text' ? trackId === 'T1' : kind === 'audio' ? trackId.startsWith('A') : trackId.startsWith('V'))
export const clipKind = (c, media) => (c.track === 'T1' ? 'text' : media[c.media]?.kind || 'video')

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

// A new clip for a piece of media dropped at `start` on `track`.
export function clipFor(media, track, start) {
  const len = media.kind === 'image' ? 4 : media.duration || 4
  return { id: newId(), track, media: media.id, start: Math.max(0, start), in: 0, out: len, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }
}

export function titleClip(start, content = 'Title') {
  return { id: newId(), track: 'T1', media: null, start: Math.max(0, start), in: 0, out: 3, fadeIn: 0.3, fadeOut: 0.3, text: { content, size: 8, position: 'bottom', color: '#f4ecdc', box: false } }
}

// Cuts a clip in two at timeline time t; returns the new clips list, or null if t isn't inside it.
export function split(clips, id, t) {
  const c = clips.find((x) => x.id === id)
  if (!c || t <= c.start + FRAME || t >= clipEnd(c) - FRAME) return null
  const at = c.in + (t - c.start)
  const a = { ...c, out: at, fadeOut: 0 }
  const b = { ...c, id: newId(), start: t, in: at, fadeIn: 0 }
  return clips.flatMap((x) => (x.id === id ? [a, b] : [x]))
}

// Removes a clip; with ripple, later clips on the same track move left to close the gap.
export function remove(clips, id, ripple = false) {
  const c = clips.find((x) => x.id === id)
  if (!c) return clips
  const len = clipLength(c)
  return clips.filter((x) => x.id !== id).map((x) => (ripple && x.track === c.track && x.start >= clipEnd(c) - 1e-6 ? { ...x, start: x.start - len } : x))
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
