// Timeline maths shared by the editor window and the MCP server. Times are seconds; a clip plays
// media[in..out] from `start` on the timeline. Pure functions: no files, no Node APIs.
export const FRAME = 1 / 24
export const clipLength = (c) => Math.max(0, c.out - c.in)
export const clipEnd = (c) => c.start + clipLength(c)
export const newId = () => Math.random().toString(36).slice(2, 9)

// Which tracks a kind of clip may sit on.
export const fits = (kind, trackId) => (kind === 'text' ? trackId === 'T1' : kind === 'audio' ? trackId.startsWith('A') : trackId.startsWith('V'))
export const clipKind = (c, media) => (c.track === 'T1' ? 'text' : media[c.media]?.kind || 'video')

// ---------- tracks ----------
// An edit's tracks: T1 (titles), V1..Vn (video; a higher number is drawn over a lower one) and A1..An (sound),
// each with { hidden, locked, muted, solo }. Edits made before tracks could be added have none saved and get
// the original five.
export const DEFAULT_TRACKS = [
  { id: 'T1', kind: 'text', label: 'Titles' },
  { id: 'V2', kind: 'video', label: 'V2' },
  { id: 'V1', kind: 'video', label: 'V1' },
  { id: 'A1', kind: 'audio', label: 'A1' },
  { id: 'A2', kind: 'audio', label: 'A2' }
]
export const TRACK_ID = /^(V[1-9]\d?|A[1-9]\d?|T1)$/
export const trackKind = (id) => (id === 'T1' ? 'text' : id[0] === 'A' ? 'audio' : 'video')
const trackNum = (id) => Number(id.slice(1))
const trackRank = (t) => (t.kind === 'text' ? -1000 : t.kind === 'video' ? -trackNum(t.id) : 1000 + trackNum(t.id))
// Every track, in the order the timeline shows them: titles, video from the top layer down, then sound.
export function tracksOf(edit) {
  const byId = new Map()
  const label = (id) => (id === 'T1' ? 'Titles' : id)
  for (const t of edit.tracks?.length ? edit.tracks : DEFAULT_TRACKS) if (TRACK_ID.test(t.id)) byId.set(t.id, { ...t, kind: trackKind(t.id), label: t.label || label(t.id) })
  for (const c of edit.clips || []) if (!byId.has(c.track) && TRACK_ID.test(c.track)) byId.set(c.track, { id: c.track, kind: trackKind(c.track), label: label(c.track) })
  return [...byId.values()].sort((a, b) => trackRank(a) - trackRank(b))
}
// Video tracks bottom to top: the order they're drawn in.
export const videoLayers = (tracks) => tracks.filter((t) => t.kind === 'video').sort((a, b) => trackNum(a.id) - trackNum(b.id))
export const shown = (tracks, id) => !tracks.find((t) => t.id === id)?.hidden
// Whether a track's sound plays: not muted, and if any track is soloed, this one is too.
export function audible(tracks, id) {
  const t = tracks.find((x) => x.id === id)
  const solo = tracks.some((x) => x.solo)
  return !t || (!t.muted && (!solo || !!t.solo))
}
export function nextTrackId(tracks, kind) {
  const p = kind === 'audio' ? 'A' : 'V'
  return p + (Math.max(0, ...tracks.filter((t) => t.kind === kind).map((t) => trackNum(t.id))) + 1)
}

// ---------- insert and overwrite (Premiere's , and .) ----------
function fitFades(c) {
  const len = clipLength(c)
  const fadeIn = Math.min(c.fadeIn || 0, len)
  return { ...c, fadeIn, fadeOut: Math.min(c.fadeOut || 0, len - fadeIn) }
}
// Puts clip c on its track over whatever is there: clips under it are trimmed, cut in two or removed.
export function overwrite(clips, c) {
  const s = c.start
  const e = clipEnd(c)
  const out = []
  for (const x of clips) {
    if (x.track !== c.track || clipEnd(x) <= s + 1e-6 || x.start >= e - 1e-6) out.push(x)
    else {
      if (x.start < s) out.push(fitFades({ ...x, out: x.in + (s - x.start), fadeOut: 0 }))
      if (clipEnd(x) > e) out.push(fitFades({ ...x, id: x.start < s ? newId() : x.id, start: e, in: x.in + (e - x.start), fadeIn: 0 }))
    }
  }
  return [...out, c]
}
// Puts clip c on its track and pushes everything after it right; a clip it lands in is cut in two.
export function insert(clips, c) {
  const s = c.start
  const len = clipLength(c)
  const out = []
  for (const x of clips) {
    if (x.track !== c.track || clipEnd(x) <= s + 1e-6) out.push(x)
    else if (x.start < s - 1e-6) out.push(fitFades({ ...x, out: x.in + (s - x.start), fadeOut: 0 }), fitFades({ ...x, id: newId(), start: s + len, in: x.in + (s - x.start), fadeIn: 0 }))
    else out.push({ ...x, start: x.start + len })
  }
  return [...out, c]
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

// ---------- scripted edits (the MCP server's edit_timeline) ----------
const TEXT_FIELDS = ['content', 'size', 'position', 'color', 'box']
const trackEnd = (clips, track) => clips.filter((c) => c.track === track).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
const round = (v) => Math.round(v * 1000) / 1000

// Checks one clip against its media and tracks: an existing, unlocked track of its kind, in/out inside the
// media, sane fades and volume.
function check(c, media, tracks) {
  const t = tracks.find((x) => x.id === c.track)
  if (!t) throw new Error(`Unknown track ${c.track}. Tracks: ${tracks.map((x) => x.id).join(', ')} (add_track adds one).`)
  if (t.locked) throw new Error(`Track ${c.track} is locked in the editor. Ask the person to unlock it, or use another track.`)
  const kind = clipKind(c, media)
  if (c.track !== 'T1' && !media[c.media]) throw new Error(`No media ${c.media} in this edit.`)
  if (!fits(kind, c.track)) throw new Error(`${/^[aeiou]/.test(kind) ? 'An' : 'A'} ${kind} clip can't go on ${c.track} (video and pictures: V tracks, sound: A tracks, titles: T1).`)
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

// Applies a list of operations to an edit's clips, media, tracks and markers; every one is checked first, so a
// bad operation changes nothing. Returns { clips, media, tracks, markers, results } (results[i]: what op i did).
export function applyOps(edit, ops) {
  let clips = edit.clips.map((c) => ({ ...c }))
  const media = { ...edit.media }
  let tracks = tracksOf(edit).map((t) => ({ ...t }))
  let markers = (edit.markers || []).map((m) => ({ ...m }))
  const results = []
  const unlocked = (id) => {
    if (tracks.find((x) => x.id === id)?.locked) throw new Error(`Track ${id} is locked in the editor. Ask the person to unlock it.`)
  }
  const findTrack = (id) => {
    const t = tracks.find((x) => x.id === id)
    if (!t) throw new Error(`No track ${id}. get_edit lists the tracks.`)
    return t
  }
  const findMarker = (id) => {
    if (!markers.some((m) => m.id === id)) throw new Error(`No marker ${id}. get_edit lists the markers.`)
  }
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
          const c = check({ ...base, in: op.in ?? base.in, out: op.out ?? (op.duration != null ? (op.in ?? 0) + op.duration : base.out), fadeIn: op.fadeIn ?? 0, fadeOut: op.fadeOut ?? 0, volume: op.volume ?? 1, muted: op.muted ?? false }, media, tracks)
          clips.push(c)
          results.push({ op: op.op, clip: c.id, track: c.track, start: c.start, end: round(clipEnd(c)) })
          break
        }
        case 'add_title': {
          const base = titleClip(op.start ?? 0, op.content || 'Title')
          const c = check({ ...base, out: op.duration ?? 3, fadeIn: op.fadeIn ?? 0.3, fadeOut: op.fadeOut ?? 0.3, text: { ...base.text, ...pick(op, TEXT_FIELDS) } }, media, tracks)
          clips.push(c)
          results.push({ op: op.op, clip: c.id, start: c.start, end: round(clipEnd(c)) })
          break
        }
        case 'update_clip': {
          const c = find(op.clip)
          const next = { ...c, ...pick(op, ['track', 'start', 'in', 'out', 'fadeIn', 'fadeOut', 'volume', 'muted']) }
          if (op.duration != null) next.out = next.in + op.duration
          if (c.text) next.text = { ...c.text, ...pick(op, TEXT_FIELDS) }
          unlocked(c.track)
          const checked = check(next, media, tracks)
          clips = clips.map((x) => (x.id === c.id ? checked : x))
          results.push({ op: op.op, clip: c.id, track: checked.track, start: checked.start, end: round(clipEnd(checked)) })
          break
        }
        case 'split_clip': {
          unlocked(find(op.clip).track)
          const next = split(clips, op.clip, op.at)
          if (!next) throw new Error(`${op.at} s is not inside clip ${op.clip}.`)
          const added = next.find((x) => !clips.some((y) => y.id === x.id))
          clips = next
          results.push({ op: op.op, clip: op.clip, newClip: added.id, at: op.at })
          break
        }
        case 'remove_clip': {
          unlocked(find(op.clip).track)
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
        case 'insert_clip':
        case 'overwrite_clip': {
          const m = media[op.media]
          if (!m) throw new Error(`No media ${op.media}. add_media returns media ids.`)
          const track = op.track || (m.kind === 'audio' ? 'A1' : 'V1')
          const base = clipFor(m, track, op.at ?? 0)
          const c = check({ ...base, in: op.in ?? base.in, out: op.out ?? (op.duration != null ? (op.in ?? 0) + op.duration : base.out), volume: op.volume ?? 1 }, media, tracks)
          clips = (op.op === 'insert_clip' ? insert : overwrite)(clips, c)
          results.push({ op: op.op, clip: c.id, track: c.track, start: c.start, end: round(clipEnd(c)) })
          break
        }
        case 'add_track': {
          const kind = op.kind === 'audio' ? 'audio' : 'video'
          const id = nextTrackId(tracks, kind)
          if (!TRACK_ID.test(id)) throw new Error('That is the most tracks of that kind an edit can have.')
          tracks = [...tracks, { id, kind, label: op.label || id }]
          results.push({ op: op.op, track: id })
          break
        }
        case 'update_track': {
          const t = findTrack(op.track)
          tracks = tracks.map((x) => (x.id === t.id ? { ...x, ...pick(op, ['label', 'hidden', 'locked', 'muted', 'solo']) } : x))
          results.push({ op: op.op, track: t.id })
          break
        }
        case 'remove_track': {
          const t = findTrack(op.track)
          if (['V1', 'A1', 'T1'].includes(t.id)) throw new Error(`${t.id} can't be removed.`)
          if (clips.some((c) => c.track === t.id)) throw new Error(`${t.id} still has clips; move or remove them first.`)
          tracks = tracks.filter((x) => x.id !== t.id)
          results.push({ op: op.op, track: t.id })
          break
        }
        case 'add_marker': {
          if (!(op.at >= 0)) throw new Error('A marker needs at (timeline seconds, 0 or more).')
          const m = { id: newId(), t: round(op.at), label: op.label || '', color: op.color || null }
          markers = [...markers, m].sort((a, b) => a.t - b.t)
          results.push({ op: op.op, marker: m.id, at: m.t })
          break
        }
        case 'update_marker': {
          findMarker(op.marker)
          const patch = { ...(op.at != null && { t: round(Math.max(0, op.at)) }), ...pick(op, ['label', 'color']) }
          markers = markers.map((m) => (m.id === op.marker ? { ...m, ...patch } : m)).sort((a, b) => a.t - b.t)
          results.push({ op: op.op, marker: op.marker })
          break
        }
        case 'remove_marker': {
          findMarker(op.marker)
          markers = markers.filter((m) => m.id !== op.marker)
          results.push({ op: op.op, marker: op.marker })
          break
        }
        case 'clear': {
          const t = op.track
          if (t) unlocked(t)
          clips = t ? clips.filter((c) => c.track !== t) : clips.filter((c) => tracks.find((x) => x.id === c.track)?.locked)
          results.push({ op: op.op, track: t || 'all unlocked' })
          break
        }
        default:
          throw new Error(`Unknown op "${op.op}".`)
      }
    } catch (err) {
      throw new Error(`Operation ${i + 1} (${op.op}): ${err.message} Nothing was changed.`)
    }
  })
  return { clips, media, tracks: tracksOf({ tracks, clips }), markers, results }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
