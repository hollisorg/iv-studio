// Replace's voice swap (src/service/remakevoice.js and the voice parts of remake.js): phrases from Whisper's
// segments, who says what, fitting a new line to its time, the mix (also run for real with the bundled ffmpeg on a
// made-up source), the read-back check, the render graph with the new track or H3 voicing, and the final file.
//   node test/remake-voice.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { finalArgs, remakeGraph } from '../src/service/remake.js'
import { assignSpeakers, fitPhrase, gainFor, keepGain, MAX_STRETCH, mixArgs, peopleKey, phrasesFrom, pickFaces, faceFacts, regenSpans, silencesFrom, speechSpan, spokenLines, tighten, voiceStale, withDialogue, wordMatch } from '../src/service/remakevoice.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

await ok('phrases: inside the clip, edges pulled in to the voice, phantoms and slivers dropped', () => {
  const segs = [
    { start: 0.0, end: 2.4, text: ' Hiya, so quick one.' },
    { start: 2.4, end: 2.5, text: 'Uh' },
    { start: 3.1, end: 6.0, text: 'Thank you.' },
    { start: 6.2, end: 9.9, text: 'I make slightly wonky pots.' },
    { start: 14.0, end: 15.2, text: 'past the end' }
  ]
  const silences = [[0, 0.35], [2.1, 3.0], [9.4, 10.5]]
  const p = phrasesFrom(segs, { seconds: 12.4, silences })
  assert.deepEqual(p, [
    { start: 0.35, end: 2.1, text: 'Hiya, so quick one.' },
    { start: 6.2, end: 9.4, text: 'I make slightly wonky pots.' }
  ])
  assert.deepEqual(tighten({ start: 1, end: 2 }, [[0.5, 3]]), { start: 1, end: 2 }) // a silence over the whole phrase moves nothing
  // Whisper's last segment runs to the end of the file; silencedetect closes the trailing silence a frame earlier
  assert.deepEqual(tighten({ start: 0.123, end: 6.583 }, [[5.587, 6.571]]), { start: 0.123, end: 5.587 })
  assert.deepEqual(tighten({ start: 0.02, end: 3 }, [[0.05, 0.4]]), { start: 0.4, end: 3 }) // and a start just before a silence
})

await ok('a new line is cut to its speech: VoxCPM2 opens with up to a second of silence', () => {
  // the line Rebuild's test said: 1.2 s of silence first, gaps between words left alone
  const sil = [[0, 1.207], [1.426, 1.689], [2.643, 2.773], [3.374, 3.772], [5.016, 5.139]]
  assert.deepEqual(speechSpan(sil, 5.6), { from: 1.167, to: 5.6 })
  assert.deepEqual(speechSpan([[0, 0.6], [5.434, 5.6]], 5.6), { from: 0.56, to: 5.514 }) // and the end's silence
  assert.equal(speechSpan([[1, 2]], 5), null) // nothing at either edge: left as it is
  assert.equal(speechSpan([[0, 5]], 5), null) // all silence: left for the read-back to catch
})

await ok('silences from ffmpeg silencedetect, an open one closed at the end', () => {
  const log = '[silencedetect @ 0] silence_start: 0\n[silencedetect @ 0] silence_end: 0.412 | silence_duration: 0.412\n[silencedetect @ 0] silence_start: 5.2\n'
  assert.deepEqual(silencesFrom(log, 6), [[0, 0.412], [5.2, 6]])
})

const faceRows = (id, cx, width, motionAt) => ({ id, rows: Array.from({ length: 240 }, (_, f) => [f, cx, 200, width, motionAt(f)]) })
await ok('who talks: one face says everything; with two, whose mouth moves; left/right picks the face', () => {
  const phrases = [{ start: 0.5, end: 2 }, { start: 4, end: 6 }, { start: 7, end: 8.5 }]
  assert.deepEqual(assignSpeakers(phrases, [faceRows(0, 400, 120, () => 1)], [{ voiceId: 'v' }], { frames: 240 }), [0, 0, 0])
  assert.deepEqual(assignSpeakers(phrases, [], [{ voiceId: 'v' }]), [0, 0, 0])
  // the big face (main person) talks first and last; the small one in the middle
  const big = faceRows(0, 600, 160, (f) => (f < 60 || f > 160 ? 3 : 0.2))
  const small = faceRows(1, 200, 90, (f) => (f >= 90 && f <= 150 ? 3 : 0.2))
  assert.deepEqual(assignSpeakers(phrases, [big, small], [{ voiceId: 'v' }], { frames: 240 }), [0, null, 0])
  assert.deepEqual(assignSpeakers(phrases, [big, small], [{ voiceId: 'v', who: 'the woman on the left' }], { frames: 240 }), [null, 0, null])
  assert.deepEqual(pickFaces(faceFacts([big, small], 240), [{ who: '' }, { who: '' }]), [0, 1])
  assert.deepEqual(assignSpeakers(phrases, [big, small], [], { frames: 240 }), [null, null, null])
})

await ok('fit: stretched to the slot within 12%, never further; too long runs on (flagged), too short ends early', () => {
  const p = { start: 2, end: 4 } // 2 s
  const exact = fitPhrase(p, 2.03)
  assert.equal(exact.tempo, 1) // within 3%: left alone
  const light = fitPhrase(p, 2.2)
  assert.equal(light.tempo, 1.1)
  assert.equal(light.out, 2)
  assert.equal(light.at, 2)
  assert.ok(light.inRange)
  const long = fitPhrase(p, 3, { nextStart: 4.3 })
  assert.equal(long.tempo, 1 + MAX_STRETCH)
  assert.equal(long.inRange, false)
  assert.ok(long.at >= 1.9 && long.at < 2) // starts up to 0.1 s early
  assert.match(long.warn, /runs 0\.\d s long/)
  const short = fitPhrase(p, 1.2)
  assert.equal(short.tempo, 1 - MAX_STRETCH)
  assert.equal(short.at, 2)
  assert.ok(short.at + short.out < 4)
  assert.equal(short.warn, null)
  // a long line with room after it fits without a warning
  assert.equal(fitPhrase(p, 2.6).warn, null)
  // it never starts before the line before ends
  assert.ok(fitPhrase(p, 3.5, { prevEnd: 1.98, nextStart: 4.1 }).at >= 2.03)
})

await ok('level: matched within ±12 dB, nothing when either side is silent or unknown', () => {
  assert.equal(gainFor(-20, -26), 6)
  assert.equal(gainFor(-10, -40), 12)
  assert.equal(gainFor(-60, -20), 0)
  assert.equal(gainFor(null, -20), 0)
})

await ok('mix arguments: split keeps the background and takes the old voice out under each line; simple ducks', () => {
  const lines = [{ file: 'a.wav', at: 0.4, tempo: 1.1, gain: 3, start: 0.5, end: 2 }]
  const split = mixArgs({ base: ['bg.wav', 'voc.wav'], lines, total: 5.1667, out: 'o.wav' })
  const f = split[split.indexOf('-filter_complex') + 1]
  assert.deepEqual(split.filter((x, i) => split[i - 1] === '-i'), ['bg.wav', 'voc.wav', 'a.wav'])
  assert.match(f, /\[2:a\].*rubberband=tempo=1\.1:formant=preserved,volume=3dB,adelay=400:all=1\[n0\]/)
  assert.match(f, /amix=inputs=3:normalize=0/)
  assert.match(f, /atrim=end=5\.1667/)
  assert.ok(!/0\.0316/.test(f))
  const simple = mixArgs({ base: ['orig.wav'], lines: [{ ...lines[0], tempo: 1 }], total: 5, out: 'o.wav' })
  const g = simple[simple.indexOf('-filter_complex') + 1]
  assert.match(g, /0\.0316\+0\.9684\*clip/)
  assert.ok(!/rubberband/.test(g)) // tempo 1: no stretch
  assert.equal(keepGain([]), '1')
})

// a made-up source: a 200 Hz "old voice" from 1 to 3 s over pink noise (the room), and a 2 kHz "new voice" line
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-remake-voice-'))
const make = (args) => {
  const r = spawnSync(ff, ['-y', '-v', 'error', ...args], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
}
const rmsDb = (file, from, len, freq) => {
  const r = spawnSync(ff, ['-hide_banner', '-ss', String(from), '-t', String(len), '-i', file, '-af', `bandpass=f=${freq}:width_type=q:width=8,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(r.stderr.match(/mean_volume:\s*(-?[\d.]+)/)[1])
}
await ok('the real mix (bundled ffmpeg): old voice gone under the line, room kept, new voice in its slot, exact length', () => {
  const bg = path.join(tmp, 'bg.wav')
  const voc = path.join(tmp, 'voc.wav')
  const line = path.join(tmp, 'line.wav')
  const out = path.join(tmp, 'mix.wav')
  make(['-f', 'lavfi', '-i', 'anoisesrc=c=pink:a=0.05:d=5', '-ar', '48000', '-ac', '2', bg])
  make(['-f', 'lavfi', '-i', 'sine=f=200:d=5', '-af', "volume='between(t,1,3)*0.4':eval=frame", '-ar', '48000', '-ac', '2', voc])
  make(['-f', 'lavfi', '-i', 'sine=f=2000:d=2.1', '-af', 'volume=0.3', '-ar', '24000', '-ac', '1', line])
  const fit = fitPhrase({ start: 1, end: 3 }, 2.1, { total: 5 })
  const r = spawnSync(ff, mixArgs({ base: [bg, voc], lines: [{ file: line, ...fit, gain: 0, start: 1, end: 3 }], total: 5, out }), { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const probe = spawnSync(ff, ['-hide_banner', '-i', out, '-f', 'null', '-'], { encoding: 'utf8' }).stderr
  assert.match(probe, /48000 Hz, stereo/)
  const dur = probe.match(/time=(\d+):(\d+):([\d.]+)/g).pop().match(/([\d.]+)$/)[1]
  assert.ok(Math.abs(Number(dur) - 5) < 0.03, `length ${dur}`)
  // under the line the 200 Hz band holds only the room's own share of it: the old voice (far louder) is gone
  const room300 = rmsDb(bg, 1.3, 1.4, 200)
  assert.ok(rmsDb(voc, 1.3, 1.4, 200) - room300 > 15, 'the made-up old voice is too quiet to test with')
  assert.ok(Math.abs(rmsDb(out, 1.3, 1.4, 200) - room300) < 2, `old voice still there: ${rmsDb(out, 1.3, 1.4, 200)} vs room ${room300}`)
  assert.ok(Math.abs(rmsDb(out, 3.6, 1, 4000) - rmsDb(bg, 3.6, 1, 4000)) < 1.5, 'room changed') // after the line: as it was
  // the new voice in its slot, about as loud as said (a small loss to the formant-keeping stretch), none outside it
  const lineDb = rmsDb(line, 0, 2, 2000)
  assert.ok(rmsDb(out, 1.3, 1.4, 2000) > lineDb - 6, `new voice too quiet in its slot: ${rmsDb(out, 1.3, 1.4, 2000)} vs ${lineDb}`)
  assert.ok(rmsDb(out, 1.3, 1.4, 2000) - rmsDb(out, 3.8, 1, 2000) > 20, 'new voice outside its slot')
})
fs.rmSync(tmp, { recursive: true, force: true })

await ok('read-back: what was meant against what Whisper heard', () => {
  assert.equal(wordMatch('Hiya, so quick one.', 'hiya so quick one'), 1)
  assert.ok(wordMatch('I make slightly wonky pots', 'I make wonky pots') >= 0.75)
  assert.ok(wordMatch('I make slightly wonky pots', 'I mean, slide the honky pot') < 0.75)
  assert.equal(wordMatch('', ''), 1)
  assert.equal(wordMatch('words', ''), 0)
})

const voice = { language: 'en', phrases: [{ start: 1.2, end: 3.9, text: 'Hiya, so quick one.', swap: true, person: 0 }, { start: 4.5, end: 5.5, text: 'Not me.', swap: false, person: null }] }
await ok('the prompt writer gets the words; take C gets H3 dialogue and the spans to make new', () => {
  assert.deepEqual(spokenLines(voice, [{ name: 'Theo' }]), ['00:01.200-00:03.900 Character 1 (Theo): "Hiya, so quick one."', '00:04.500-00:05.500 Someone not swapped: "Not me."'])
  assert.equal(regenSpans(voice), '1.10-4.05')
  const prompt = 'subject_definitions:\na\n\nsummary:\nb\n\nretention_analysis:\nc\n\ndetailed_description:\nd\n\noverall_soundscape:\ne\n\nnon_diegetic_music:\nN/A\n'
  const withLines = withDialogue(prompt, voice)
  assert.match(withLines, /d\nFrom 00:01\.200 to 00:03\.900, <Subject 1>, in the voice of <Audio 1>, says: <d>\[English\] Hiya, so quick one\.<\/d>\n\noverall_soundscape:/)
  assert.ok(!withLines.includes('Not me'))
  assert.equal(withDialogue(prompt, { phrases: [] }), prompt)
})

await ok('stale voice: never heard, another voice chosen since, or not mixed', () => {
  const people = [{ voiceId: 'theo' }]
  assert.ok(voiceStale({ people }))
  assert.ok(voiceStale({ people, voice: { phrases: [], peopleKey: 'tess' } }))
  assert.ok(voiceStale({ people, voice: { phrases: [], peopleKey: peopleKey(people) } }))
  assert.ok(!voiceStale({ people, voice: { phrases: [], peopleKey: peopleKey(people) } }, { h3: true }))
  assert.ok(!voiceStale({ people, voice: { phrases: [], peopleKey: peopleKey(people), track: 'v.wav' } }))
})

const base = { kind: 'swap', unet: 'u.safetensors', clip: 'c', vae: 'v', audioVae: 'a', source: 'src.mp4', refs: ['p1.png'], pins: [12], frames: 124, prompt: 'x', seed: 1 }
await ok('render graph: the source sound by default; the new track through LoadAudio; take C adds the voice and spans', () => {
  const plain = remakeGraph(base)
  assert.deepEqual(plain[11].inputs.audio, ['8', 1])
  assert.ok(!plain.aud && !plain.vref && !('ref_audio' in plain[11].inputs))
  const withTrack = remakeGraph({ ...base, audio: 'voice.wav' })
  assert.deepEqual(withTrack.aud, { class_type: 'LoadAudio', inputs: { audio: 'voice.wav' } })
  assert.deepEqual(withTrack[11].inputs.audio, ['aud', 0])
  const c = remakeGraph({ ...base, voiceRef: 'theo.wav', regen: '1.10-4.05' })
  assert.deepEqual(c[11].inputs.audio, ['8', 1]) // the source's sound kept outside the spans
  assert.deepEqual(c[11].inputs.ref_audio, ['vref', 0])
  assert.equal(c[11].inputs.regen, '1.10-4.05')
  assert.equal(c.vref.inputs.audio, 'theo.wav')
})

await ok('final file: the take\'s own sound, or the voice track laid back on', () => {
  const own = finalArgs({ take: 't.mp4', n: 124, width: 864, height: 480, out: 'f.mp4' })
  assert.ok(!own.includes('-map'))
  const laid = finalArgs({ take: 't.mp4', track: 'voice.wav', n: 124, width: 864, height: 480, out: 'f.mp4' })
  assert.deepEqual(laid.slice(laid.indexOf('-map'), laid.indexOf('-map') + 4), ['-map', '0:v:0', '-map', '1:a:0'])
  assert.ok(laid.includes('atrim=end=5.1667'))
})

await ok('the bundled Remake node takes a voice clip and spans, and its pack version says so', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..')
  const py = fs.readFileSync(path.join(root, 'resources/comfy-nodes/ComfyUI-Viggle-Remake/nodes.py'), 'utf8')
  assert.match(py, /"ref_audio": \("AUDIO"/)
  assert.match(py, /"regen": \("STRING"/)
  assert.match(py, /<Audio 1>: /)
  const version = Number(fs.readFileSync(path.join(root, 'resources/comfy-nodes/ComfyUI-Viggle-Remake/VERSION'), 'utf8'))
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'resources/models.json'), 'utf8')).node_packs.find((p) => p.dir === 'ComfyUI-Viggle-Remake')
  assert.equal(pack.version, version)
  assert.ok(version >= 2)
})

console.log(`\n${n} checks passed`)
