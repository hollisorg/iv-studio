// Rebuild's voice swap (rebuild.js with remakevoice.js on the whole source): the swap keeps its voice, each H3 shot
// gets its piece of the new voices (stretched to the take, so the cut lands the lips on the real timing), the prompt
// gets the words, takes made for another voice render again, and the first cut's notes. The piece is also cut for
// real with the bundled ffmpeg.
//   node test/rebuild-voice.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { h3Length, keptWithVoice, Rebuilds, retime, shotLines, shotVoiceArgs, shotVoicePiece, validatePlan, voicedPrompt, voiceNote } from '../src/service/rebuild.js'
import { mixArgs, peopleKey, rebuildHost, rebuildPeople, voiceStale, VoiceSwap } from '../src/service/remakevoice.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-rebuild-voice-'))
const make = (args) => {
  const r = spawnSync(ff, ['-y', '-v', 'error', ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
const seconds = (file) => Number(spawnSync(ff, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/time=(\d+):(\d+):([\d.]+)/g).pop().match(/([\d.]+)$/)[1])

await ok('a shot\'s piece: slowed by the speed the cut plays the take at, padded to the take; a short shot only padded', () => {
  const shot = { index: 2, start: 3.5, duration: 6 }
  const plan = { h3: h3Length(6) }
  const piece = shotVoicePiece(shot, plan)
  const { speed } = retime(plan.h3.seconds, 6)
  assert.equal(piece.from, 3.5)
  assert.equal(piece.slot, 6)
  assert.ok(Math.abs(piece.tempo - 1 / speed) < 0.002)
  assert.equal(piece.padTo, plan.h3.seconds)
  assert.ok(Math.abs(6 * speed - plan.h3.seconds) < 0.05, 'the slowed piece fills the take')
  const short = shotVoicePiece({ index: 1, start: 0, duration: 2.5 }, { h3: h3Length(2.5) })
  assert.equal(short.tempo, 1)
  assert.equal(short.padTo, h3Length(2.5).seconds)
  const a = shotVoiceArgs({ stem: 'voices.wav', ...piece, out: 'shot.wav' })
  assert.deepEqual(a.slice(a.indexOf('-ss'), a.indexOf('-ss') + 4), ['-ss', '3.500', '-t', '6.000'])
  assert.match(a[a.indexOf('-af') + 1], /^rubberband=tempo=\d\.\d+:formant=preserved,apad,atrim=end=/) // a 6 s slot gets a 5.17 s take, so its piece plays faster
  assert.ok(!shotVoiceArgs({ stem: 'v.wav', ...short, out: 'o.wav' }).some((x) => /rubberband/.test(x)))
})

await ok('the piece for real (bundled ffmpeg): the take\'s length, the line stretched by the same speed', () => {
  const stem = path.join(tmp, 'voices.wav')
  // a "line" from 4 to 6 s of the film
  make(['-f', 'lavfi', '-i', 'sine=f=440:d=12', '-af', "volume='between(t,4,6)':eval=frame", '-ar', '48000', '-ac', '2', stem])
  const shot = { index: 2, start: 3.5, duration: 4.5 }
  const plan = { h3: h3Length(4.5) }
  const piece = shotVoicePiece(shot, plan)
  const out = path.join(tmp, 'shot.wav')
  const r = spawnSync(ff, shotVoiceArgs({ stem, ...piece, out }), { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Math.abs(seconds(out) - plan.h3.seconds) < 0.03, `length ${seconds(out)} vs ${plan.h3.seconds}`)
  // where the line sits in the piece: it started 0.5 s into the shot, so (0.5 * speed) s into the take
  const log = spawnSync(ff, ['-hide_banner', '-i', out, '-af', 'silencedetect=noise=-40dB:d=0.1', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  const end = Number(log.match(/silence_end: ([\d.]+)/)[1])
  const speed = 1 / piece.tempo
  assert.ok(Math.abs(end - 0.5 * speed) < 0.08, `the line starts at ${end}, expected ${0.5 * speed}`)
})

const voice = { madeAt: 'v1', peopleKey: 'theo', phrases: [{ start: 0.4, end: 2.1, text: 'Hiya, so quick one.', swap: true, person: 0 }, { start: 4.2, end: 5, text: 'Not me.', swap: false, person: null }, { start: 8.1, end: 9.5, text: 'I make wonky pots.', swap: true, person: 0 }] }
await ok('lines in a shot, the words in its prompt (once), and kept shots where the new voice talks', () => {
  assert.deepEqual(shotLines(voice, { start: 0, duration: 4 }).map((l) => l.text), ['Hiya, so quick one.'])
  assert.deepEqual(shotLines(voice, { start: 4, duration: 4 }).map((l) => l.text), ['Not me.'])
  assert.deepEqual(shotLines(voice, { start: 8, duration: 2 }).map((l) => l.text), ['I make wonky pots.'])
  const prompt = 'The video starts on the first frame. A man stands at a pottery wheel. There is no writing anywhere in the picture.'
  const voiced = voicedPrompt(prompt, shotLines(voice, { start: 0, duration: 8 }), 'Theo')
  assert.match(voiced, /Theo says: <d>\[English\] Hiya, so quick one\.<\/d>/)
  assert.ok(!voiced.includes('Not me'))
  assert.equal(voicedPrompt(voiced, shotLines(voice, { start: 0, duration: 8 }), 'Theo'), voiced)
  const r = { voice, shots: [{ index: 1, start: 0, duration: 4 }, { index: 2, start: 4, duration: 4 }, { index: 3, start: 8, duration: 2 }], plan: { shots: [{ index: 1, route: 'h3' }, { index: 2, route: 'keep' }, { index: 3, route: 'still' }] } }
  assert.deepEqual(keptWithVoice(r), [3])
  assert.match(voiceNote('Theo', 'split'), /Theo's voice, with the room sound and music kept/)
  assert.match(voiceNote('Theo', 'simple'), /dips/)
})

await ok('the swap keeps its voice through the plan; the voice host reads it', () => {
  const rebuild = { shots: [{ index: 1, start: 0, duration: 6 }], swap: null }
  const p = validatePlan(rebuild, { swap: { ask: 'Make her Theo', voiceId: 'v-theo', name: 'Theo' }, shots: [{ index: 1, route: 'keep' }] }, { lint: () => [], exists: () => true })
  assert.deepEqual(p.swap, { ask: 'Make her Theo', picture: null, voiceId: 'v-theo', name: 'Theo' })
  assert.deepEqual(rebuildPeople({ plan: p }), [{ voiceId: 'v-theo', name: 'Theo', who: '' }])
  assert.deepEqual(rebuildPeople({ swap: { ask: 'x' } }), [{ voiceId: null, name: '', who: '' }])
  assert.deepEqual(rebuildPeople({ swap: null }), [])
  const host = rebuildHost({ get: () => null, write: (x) => x, folder: (...a) => a.join('/') })
  const info = host.info({ plan: p, source: { file: 'src.mp4', duration: 31.5, width: 1920, height: 1080 } })
  assert.equal(info.total, 31.5)
  assert.deepEqual(info.motion, { file: 'src.mp4', start: 0, width: 640, height: 360 })
  assert.ok(host.wanted({ plan: p }))
  assert.ok(!host.wanted({ swap: { ask: 'x' } }))
  assert.ok(voiceStale({ voice: { phrases: [], peopleKey: 'old', track: 't' } }, { people: rebuildPeople({ plan: p }) }))
  assert.ok(!voiceStale({ voice: { phrases: [], peopleKey: peopleKey(rebuildPeople({ plan: p })), track: 't' } }, { people: rebuildPeople({ plan: p }) }))
})

await ok('the voices alone for the shots: the old voice taken out, no room sound', () => {
  const a = mixArgs({ base: ['vocals.wav'], lines: [{ file: 'l.wav', at: 1, tempo: 1, gain: 0, start: 1, end: 2 }], total: 10, out: 'voices.wav', voiceOnly: true })
  const f = a[a.indexOf('-filter_complex') + 1]
  assert.match(f, /^\[0:a\].*volume='clip\(/)
  assert.ok(!/0\.0316/.test(f))
  assert.match(f, /amix=inputs=2/)
})

// a rebuild on disk with one approved H3 shot that has the swapped person talking, rendered through stand-ins
const dataDir = path.join(tmp, 'data')
const asked = []
const studio = { generatePreviews: async (req) => (asked.push(req), { id: `job${asked.length}`, status: 'queued' }) }
const edits = { run: async (args) => make(args.slice(3)) }
const rebuilds = new Rebuilds({ dataDir, reader: {}, studio, images: null, remake: null, edits, writer: () => ({}), lint: () => [] })
const id = 'rv000001'
fs.mkdirSync(rebuilds.folder(id), { recursive: true })
const stem = path.join(tmp, 'voices.wav')
const first = path.join(tmp, 'f.png')
make(['-f', 'lavfi', '-i', 'color=c=gray:s=64x36', '-frames:v', '1', first])
const L = h3Length(4.5)
rebuilds.write({ id, name: 'Pottery', status: 'approved', source: { file: path.join(tmp, 'src.mp4'), duration: 12, width: 1920, height: 1080 }, shots: [{ index: 1, start: 0, duration: 4.5 }, { index: 2, start: 4.5, duration: 4 }], swap: { ask: 'Make her Theo', voiceId: 'v-theo', name: 'Theo' }, plan: { swap: { ask: 'Make her Theo', voiceId: 'v-theo', name: 'Theo' }, shots: [{ index: 1, route: 'h3', prompt: 'The video starts on the first frame. A man at a wheel. There is no writing anywhere in the picture.', character: 'none', h3: L }, { index: 2, route: 'keep' }] }, planApprovedAt: 'x', framesApprovedAt: 'x', frames: { 1: { first, last: first } }, takes: {}, voice: { ...voice, stem, track: stem } })
let made = 0
rebuilds.voice = new VoiceSwap({ host: rebuildHost(rebuilds), voices: () => ({}), ffmpeg: ff })
rebuilds.voice.make = async (rid) => (made++, rebuilds.get(rid))
const realStale = rebuilds.voice.stale
await ok('make the shots: the voice is made first when missing; a talking shot gets its piece and the words', async () => {
  rebuilds.voice.stale = () => false
  await rebuilds.makeShots(id)
  assert.equal(made, 0)
  assert.equal(asked.length, 1)
  const req = asked[0]
  assert.ok(req.voiceLine && fs.existsSync(req.voiceLine), 'a voice line for the shot')
  assert.ok(Math.abs(seconds(req.voiceLine) - L.seconds) < 0.03)
  assert.match(req.prompt, /Theo says: <d>\[English\] Hiya, so quick one\.<\/d>/)
  const t = rebuilds.get(id).takes[1]
  assert.equal(t.voiceKey, 'v1')
  // again: the take stays
  await rebuilds.makeShots(id)
  assert.equal(asked.length, 1)
  // a new voice: the talking shot renders again
  const r = rebuilds.get(id)
  r.voice.madeAt = 'v2'
  rebuilds.write(r)
  await rebuilds.makeShots(id)
  assert.equal(asked.length, 2)
  assert.equal(rebuilds.get(id).takes[1].voiceKey, 'v2')
  // a stale voice is made first
  rebuilds.voice.stale = () => true
  await rebuilds.makeShots(id).catch(() => {})
  assert.equal(made, 1)
  rebuilds.voice.stale = realStale
})

await ok('a voice set on the swap keeps the frames and the approvals; none keeps the original voice', () => {
  rebuilds.setSwapVoice(id, { voiceId: null })
  let r = rebuilds.get(id)
  assert.equal(r.plan.swap.voiceId, undefined)
  assert.ok(r.frames[1] && r.framesApprovedAt && r.planApprovedAt)
  assert.ok(!rebuilds.voiced(r))
  rebuilds.setSwapVoice(id, { voiceId: 'v-tess', name: 'Tess' })
  r = rebuilds.get(id)
  assert.deepEqual([r.plan.swap.voiceId, r.plan.swap.name, r.swap.voiceId], ['v-tess', 'Tess', 'v-tess'])
  const bare = 'rv000002'
  rebuilds.write({ id: bare, name: 'x', status: 'planning', source: {}, shots: [], swap: null })
  assert.throws(() => rebuilds.setSwapVoice(bare, { voiceId: 'v' }), /changes no one/)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${n} checks passed`)
