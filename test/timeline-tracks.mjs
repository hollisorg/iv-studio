// Timeline model test, no app needed: tracks (default, added, locked, solo), markers, insert and overwrite.
//   node test/timeline-tracks.mjs
import { applyOps, audible, clipEnd, insert, overwrite, tracksOf, videoLayers } from '../src/service/timeline.js'

let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const throws = (fn) => {
  try {
    fn()
    return null
  } catch (err) {
    return err.message
  }
}
const media = { a: { id: 'a', kind: 'video', name: 'a.mp4', duration: 10, hasAudio: true }, s: { id: 's', kind: 'audio', name: 's.wav', duration: 20 } }
const clip = (id, track, start, len, inn = 0) => ({ id, track, media: 'a', start, in: inn, out: inn + len, fadeIn: 0, fadeOut: 0, volume: 1, muted: false })
const edit = { media, clips: [clip('x', 'V1', 0, 4), clip('y', 'V1', 4, 4)] }

const order = tracksOf(edit).map((t) => t.id).join(' ')
expect('old edits get the five default tracks, titles then V2, V1, A1, A2', order === 'T1 V2 V1 A1 A2', order)

// overwrite 2 s at 3 s: x trimmed to 3, y head-trimmed to start at 5
const ow = overwrite(edit.clips, clip('n', 'V1', 3, 2))
const x = ow.find((c) => c.id === 'x')
const y = ow.find((c) => c.id === 'y')
expect('overwrite trims both neighbours', clipEnd(x) === 3 && y.start === 5 && y.in === 1 && clipEnd(y) === 8, JSON.stringify([x, y].map((c) => [c.start, c.in, c.out])))
const inside = overwrite([clip('x', 'V1', 0, 8)], clip('n', 'V1', 2, 2))
expect('overwrite inside a clip leaves both ends', inside.length === 3 && inside.filter((c) => c.media === 'a' && c.id !== 'n').map((c) => `${c.start}+${c.out - c.in}`).sort().join(',') === '0+2,4+4')

// insert 2 s at 2 s: x cut at 2, its tail and y pushed right by 2
const ins = insert(edit.clips, clip('n', 'V1', 2, 2))
const total = ins.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
expect('insert cuts and pushes everything after', ins.length === 4 && total === 10 && ins.find((c) => c.id === 'y').start === 6, `ends at ${total}`)

const r = applyOps(edit, [
  { op: 'add_track', kind: 'video' },
  { op: 'add_track', kind: 'audio', label: 'Music' },
  { op: 'insert_clip', media: 'a', track: 'V3', at: 1, duration: 2 },
  { op: 'add_marker', at: 2.5, label: 'beat' },
  { op: 'update_track', track: 'A1', muted: true },
  { op: 'update_track', track: 'A3', solo: true }
])
const ids = r.tracks.map((t) => t.id).join(' ')
expect('add_track numbers new tracks', ids === 'T1 V3 V2 V1 A1 A2 A3' && r.tracks.find((t) => t.id === 'A3').label === 'Music', ids)
expect('videoLayers draws V1 first, V3 last', videoLayers(r.tracks).map((t) => t.id).join(' ') === 'V1 V2 V3')
expect('insert_clip lands on the new track', r.clips.some((c) => c.track === 'V3' && c.start === 1))
expect('marker added', r.markers.length === 1 && r.markers[0].t === 2.5 && r.markers[0].label === 'beat')
expect('solo: only soloed tracks are heard', audible(r.tracks, 'A3') && !audible(r.tracks, 'A2') && !audible(r.tracks, 'V1'))

const locked = { ...edit, tracks: tracksOf(edit).map((t) => (t.id === 'V1' ? { ...t, locked: true } : t)) }
expect('locked track refuses update_clip', /locked/.test(throws(() => applyOps(locked, [{ op: 'update_clip', clip: 'x', start: 1 }])) || ''))
expect('locked track refuses add_clip', /locked/.test(throws(() => applyOps(locked, [{ op: 'add_clip', media: 'a', track: 'V1' }])) || ''))
expect('clear keeps locked tracks', applyOps(locked, [{ op: 'clear' }]).clips.length === 2)
expect('unknown track refused', /Unknown track V9/.test(throws(() => applyOps(edit, [{ op: 'add_clip', media: 'a', track: 'V9' }])) || ''))
expect('remove_track refuses one with clips', /still has clips/.test(throws(() => applyOps(r, [{ op: 'remove_track', track: 'V3' }])) || ''))
expect('remove_track removes an empty one', !applyOps(r, [{ op: 'remove_track', track: 'A2' }]).tracks.some((t) => t.id === 'A2'))
expect('sound on a video track refused', /can't go on V1/.test(throws(() => applyOps(edit, [{ op: 'add_clip', media: 's', track: 'V1' }])) || ''))

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
