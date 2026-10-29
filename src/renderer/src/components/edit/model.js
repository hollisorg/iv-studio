// Timeline maths shared by the editor's parts. Times are seconds; a clip plays media[in..out] from
// `start` on the timeline.
import { clipEnd, clipKind, tracksOf } from '../../../../service/timeline'

export { FRAME, clipLength, clipEnd, newId, fits, clipKind, clipFor, titleClip, split, remove, insert, overwrite, tracksOf, videoLayers, shown, audible, nextTrackId } from '../../../../service/timeline'
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

// Nearest snap point (clip edges on every track, the playhead, markers, zero) within `tolerance` seconds.
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

// Every clip start and end, sorted: where ↑ and ↓ jump to.
export const editPoints = (clips) => [...new Set([0, ...clips.flatMap((c) => [c.start, clipEnd(c)])].map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b)

// What an agent's change did, in a few words: "added 2 clips on V1, moved 1, 1 marker".
export function describeChange(before, after) {
  const parts = []
  const byId = (list) => new Map((list || []).map((x) => [x.id, x]))
  const a = byId(before.clips)
  const b = byId(after.clips)
  const added = [...b.values()].filter((c) => !a.has(c.id))
  const removed = [...a.values()].filter((c) => !b.has(c.id))
  const changed = [...b.values()].filter((c) => a.has(c.id) && JSON.stringify(a.get(c.id)) !== JSON.stringify(c))
  const where = (list) => [...new Set(list.map((c) => c.track))].join(', ')
  const n = (k, word) => `${k} ${word}${k === 1 ? '' : 's'}`
  if (added.length) parts.push(`added ${n(added.length, added.every((c) => clipKind(c, after.media) === 'text') ? 'title' : 'clip')} on ${where(added)}`)
  if (removed.length) parts.push(`removed ${n(removed.length, 'clip')}`)
  if (changed.length) parts.push(`changed ${n(changed.length, 'clip')} on ${where(changed)}`)
  const mediaAdded = Object.keys(after.media || {}).filter((k) => !before.media?.[k]).length
  if (mediaAdded) parts.push(`added ${n(mediaAdded, 'file')} to the bin`)
  const ma = byId(before.markers)
  const mb = byId(after.markers)
  const mAdded = [...mb.keys()].filter((k) => !ma.has(k)).length
  const mGone = [...ma.keys()].filter((k) => !mb.has(k)).length
  if (mAdded) parts.push(`added ${n(mAdded, 'marker')}`)
  if (mGone) parts.push(`removed ${n(mGone, 'marker')}`)
  const state = (e) => tracksOf(e).map(({ id, label, hidden, locked, muted, solo }) => ({ id, label, hidden: !!hidden, locked: !!locked, muted: !!muted, solo: !!solo }))
  const ta = state(before)
  const tb = state(after)
  if (JSON.stringify(ta) !== JSON.stringify(tb)) {
    const old = new Set(ta.map((t) => t.id))
    const now = new Set(tb.map((t) => t.id))
    const added = tb.filter((t) => !old.has(t.id)).map((t) => t.id)
    const gone = ta.filter((t) => !now.has(t.id)).map((t) => t.id)
    if (added.length) parts.push(`added track ${added.join(', ')}`)
    if (gone.length) parts.push(`removed track ${gone.join(', ')}`)
    if (!added.length && !gone.length) parts.push('changed track settings')
  }
  if (before.name !== after.name) parts.push(`renamed it "${after.name}"`)
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings)) parts.push('changed the format')
  const text = parts.join(', ') || 'changed the edit'
  return text[0].toUpperCase() + text.slice(1)
}
