// Timeline maths shared by the editor window and the MCP server. Times are seconds; a clip plays
// media[in..out] from `start` on the timeline. Pure functions: no files, no Node APIs.
export const FRAME = 1 / 24
export const clipLength = (c) => Math.max(0, c.out - c.in)
export const clipEnd = (c) => c.start + clipLength(c)
export const newId = () => Math.random().toString(36).slice(2, 9)

// Which tracks a kind of clip may sit on.
export const fits = (kind, trackId) => (kind === 'text' ? trackId === 'T1' : kind === 'audio' ? trackId.startsWith('A') : trackId.startsWith('V'))
export const clipKind = (c, media) => (c.track === 'T1' ? 'text' : media[c.media]?.kind || 'video')

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

// ---------- scripted edits (the MCP server's edit_timeline) ----------
const TRACK_IDS = ['V1', 'V2', 'T1', 'A1', 'A2']
const TEXT_FIELDS = ['content', 'size', 'position', 'color', 'box']
const trackEnd = (clips, track) => clips.filter((c) => c.track === track).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
const round = (v) => Math.round(v * 1000) / 1000

// Checks one clip against its media: right track, in/out inside the media, sane fades and volume.
function check(c, media) {
  if (!TRACK_IDS.includes(c.track)) throw new Error(`Unknown track ${c.track}. Tracks: ${TRACK_IDS.join(', ')}.`)
  const kind = clipKind(c, media)
  if (c.track !== 'T1' && !media[c.media]) throw new Error(`No media ${c.media} in this edit.`)
  if (!fits(kind, c.track)) throw new Error(`${/^[aeiou]/.test(kind) ? 'An' : 'A'} ${kind} clip can't go on ${c.track} (video and pictures: V1/V2, sound: A1/A2, titles: T1).`)
  const m = media[c.media]
  if (c.start < 0 || c.in < 0) throw new Error('Times must be 0 or more.')
  if (c.out - c.in < FRAME) throw new Error('A clip must be at least one frame long (out > in).')
  if (m && m.kind !== 'image' && m.duration && c.out > m.duration + 0.05) throw new Error(`${m.name} is only ${m.duration.toFixed(2)} s long; out can't be ${c.out}.`)
  if (c.fadeIn < 0 || c.fadeOut < 0 || c.fadeIn + c.fadeOut > clipLength(c) + 1e-6) throw new Error('Fades must fit inside the clip.')
  if (c.volume !== undefined && (c.volume < 0 || c.volume > 4)) throw new Error('Volume runs from 0 to 4 (1 = as recorded).')
  if (c.track === 'T1' && !String(c.text?.content || '').trim()) throw new Error('A title needs some text.')
  if (c.text && !['top', 'center', 'bottom'].includes(c.text.position)) throw new Error('Title position is top, center or bottom.')
  return { ...c, start: round(c.start), in: round(c.in), out: round(c.out) }
}

// Applies a list of operations to an edit's clips and media; every one is checked first, so a bad
// operation changes nothing. Returns { clips, media, results } (results[i] says what op i did).
export function applyOps(edit, ops) {
  let clips = edit.clips.map((c) => ({ ...c }))
  const media = { ...edit.media }
  const results = []
  const find = (id) => {
    const c = clips.find((x) => x.id === id)
    if (!c) throw new Error(`No clip ${id}. get_edit lists the clip ids.`)
    return c
  }
  ops.forEach((op, i) => {
    try {
      switch (op.op) {
        case 'add_clip': {
          const m = media[op.media]
          if (!m) throw new Error(`No media ${op.media}. add_media returns media ids.`)
          const track = op.track || (m.kind === 'audio' ? 'A1' : 'V1')
          const base = clipFor(m, track, op.start ?? trackEnd(clips, track))
          const c = check({ ...base, in: op.in ?? base.in, out: op.out ?? (op.duration != null ? (op.in ?? 0) + op.duration : base.out), fadeIn: op.fadeIn ?? 0, fadeOut: op.fadeOut ?? 0, volume: op.volume ?? 1, muted: op.muted ?? false }, media)
          clips.push(c)
          results.push({ op: op.op, clip: c.id, track: c.track, start: c.start, end: round(clipEnd(c)) })
          break
        }
        case 'add_title': {
          const base = titleClip(op.start ?? 0, op.content || 'Title')
          const c = check({ ...base, out: op.duration ?? 3, fadeIn: op.fadeIn ?? 0.3, fadeOut: op.fadeOut ?? 0.3, text: { ...base.text, ...pick(op, TEXT_FIELDS) } }, media)
          clips.push(c)
          results.push({ op: op.op, clip: c.id, start: c.start, end: round(clipEnd(c)) })
          break
        }
        case 'update_clip': {
          const c = find(op.clip)
          const next = { ...c, ...pick(op, ['track', 'start', 'in', 'out', 'fadeIn', 'fadeOut', 'volume', 'muted']) }
          if (op.duration != null) next.out = next.in + op.duration
          if (c.text) next.text = { ...c.text, ...pick(op, TEXT_FIELDS) }
          const checked = check(next, media)
          clips = clips.map((x) => (x.id === c.id ? checked : x))
          results.push({ op: op.op, clip: c.id, track: checked.track, start: checked.start, end: round(clipEnd(checked)) })
          break
        }
        case 'split_clip': {
          const next = split(clips, find(op.clip).id, op.at)
          if (!next) throw new Error(`${op.at} s is not inside clip ${op.clip}.`)
          const added = next.find((x) => !clips.some((y) => y.id === x.id))
          clips = next
          results.push({ op: op.op, clip: op.clip, newClip: added.id, at: op.at })
          break
        }
        case 'remove_clip': {
          find(op.clip)
          clips = remove(clips, op.clip, !!op.ripple)
          results.push({ op: op.op, clip: op.clip, ripple: !!op.ripple })
          break
        }
        case 'remove_media': {
          if (!media[op.media]) throw new Error(`No media ${op.media}.`)
          const gone = clips.filter((c) => c.media === op.media).length
          clips = clips.filter((c) => c.media !== op.media)
          delete media[op.media]
          results.push({ op: op.op, media: op.media, clipsRemoved: gone })
          break
        }
        case 'clear': {
          const t = op.track
          clips = t ? clips.filter((c) => c.track !== t) : []
          results.push({ op: op.op, track: t || 'all' })
          break
        }
        default:
          throw new Error(`Unknown op "${op.op}".`)
      }
    } catch (err) {
      throw new Error(`Operation ${i + 1} (${op.op}): ${err.message} Nothing was changed.`)
    }
  })
  return { clips, media, results }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
