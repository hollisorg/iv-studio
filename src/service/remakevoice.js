// Replace's voice swap: when Remake swaps a person for a character, the character says the same words, at the same
// moments, in their own saved voice (the character's voiceId, from Audio > Voices). All on this PC:
//   split   the source's sound into voice and background (Demucs, MIT, in the voice engine; optional: without it
//           the room sound dips under the new voice)
//   hear    the words and their times (Whisper large-v3 turbo, the voice engine's own)
//   who     which phrases the swapped person says (one face: all of them; several: whose mouth moves, mouth_track.py)
//   speak   each of their phrases in the character's voice (VoxCPM2 clone), fitted to the phrase's own time span:
//           a light stretch (rubberband, formants kept, 12% at most), else said again with another seed
//   mix     background + the other speakers' own lines + the new lines, exactly as long as Remake's source
//   check   Whisper hears the new track again; a phrase it can't read back is said once more
// Remake then holds that track as its audio (the lips follow it) and the final file gets the exact track back.
// Take C (experimental): H3 itself speaks in the voice, given the voice clip as <Audio 1> and the phrases' spans to
// make new (resources/comfy-nodes/ComfyUI-Viggle-Remake, version 2).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { phantom, QUIET_DB } from './captions.js'

export const FPS = 24
export const MAX_STRETCH = 0.12 // a voice stretched further sounds robotic (Matthew, Academy narration, 2026-11-13)
export const SEEDS = [41, 141, 241]
const EARLY = 0.1 // a new line may start this much before the old one
const LATE = 0.4 // and end this much after it, when the gap allows
const GAP = 0.05 // kept between two lines
const WIDEN = 0.06 // the old voice is taken out a little either side of its words
const FADE = 0.04
const DUCK = 0.0316 // -30 dB: the simple mix's original track under a new line
export const MATCH_OK = 0.75

// ---------- pure parts (tested in test/remake-voice.mjs) ----------

// Speech edges pulled in to where the voice really starts and stops: an edge inside a silence moves to its border.
// EDGE: an edge just outside a silence counts as in it (silencedetect closes a trailing silence a frame before the end
// of the file, while Whisper's last segment runs to the end).
const EDGE = 0.08
export function tighten({ start, end }, silences = []) {
  let a = start
  let b = end
  for (const [s, e] of silences) {
    if (a >= s - EDGE && a < e && e < b) a = Math.max(a, e)
    if (b > s && b <= e + EDGE && s > a) b = Math.min(b, s)
  }
  return { start: +a.toFixed(3), end: +b.toFixed(3) }
}

// Whisper's segments as phrases: inside the clip's own time (never its backwards padding), edges tightened, the
// phantom lines Whisper hears in silence dropped, and a phrase at least 0.2 s long.
export function phrasesFrom(segments = [], { seconds, silences = [] } = {}) {
  const out = []
  for (const seg of segments) {
    const text = String(seg.text || '').trim()
    if (!text || phantom(text)) continue
    const s = Math.max(0, Number(seg.start) || 0)
    const e = Math.min(seconds ?? Infinity, Number(seg.end) || 0)
    if (!(e > s)) continue
    const t = tighten({ start: s, end: e }, silences)
    if (t.end - t.start < 0.2) continue
    out.push({ start: t.start, end: t.end, text })
  }
  return out.sort((a, b) => a.start - b.start)
}

// A new line cut to its speech: VoxCPM2 opens a line with up to a second of silence (and may close with some), which
// would place and fit it by its silence rather than its words. silences: the line's own (silencesFrom), dur its length.
// Keeps a little air either side. null when there's nothing to cut.
export function speechSpan(silences = [], dur, { before = 0.04, after = 0.08 } = {}) {
  let a = 0
  let b = dur
  for (const [s, e] of silences) {
    if (s <= 0.01 && e < b) a = Math.max(a, e)
    if (e >= dur - 0.01 && s > a) b = Math.min(b, s)
  }
  a = Math.max(0, a - before)
  b = Math.min(dur, b + after)
  if (b - a < 0.2 || (a < 0.02 && b > dur - 0.02)) return null
  return { from: +a.toFixed(3), to: +b.toFixed(3) }
}

// The silent stretches in ffmpeg silencedetect's log: [[start, end]].
export function silencesFrom(log, total) {
  const out = []
  let start = null
  for (const m of String(log).matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    if (m[1] === 'start') start = Math.max(0, Number(m[2]))
    else if (start != null) {
      out.push([start, Number(m[2])])
      start = null
    }
  }
  if (start != null && total) out.push([start, total])
  return out
}

// Each face's facts from mouth_track.py --motion: how big it is and where, how often it is there.
export function faceFacts(faces = [], frames = 1) {
  return faces.map((f) => {
    const rows = f.rows || []
    const n = rows.length || 1
    return { id: f.id, rows, presence: rows.length / Math.max(1, frames), cx: rows.reduce((a, r) => a + r[1], 0) / n, width: rows.reduce((a, r) => a + r[3], 0) / n }
  })
}

// The face each swapped person is: "left"/"right" in whom they replace picks by position, otherwise the biggest
// face on screen most of the time (the main person, as the painter assumes), then the next.
export function pickFaces(faces, people = []) {
  const ranked = [...faces].sort((a, b) => b.presence * b.width - a.presence * a.width)
  const taken = new Set()
  return people.map((p) => {
    const who = String(p?.who || '').toLowerCase()
    const free = ranked.filter((f) => !taken.has(f.id))
    if (!free.length) return null
    const top = free.slice(0, 3)
    const f = /\bleft\b/.test(who) ? top.sort((a, b) => a.cx - b.cx)[0] : /\bright\b/.test(who) ? top.sort((a, b) => b.cx - a.cx)[0] : free[0]
    taken.add(f.id)
    return f.id
  })
}

// Who says each phrase: the person index (0 or 1) or null for someone not swapped. One face (or none seen) with one
// swapped person: every phrase is theirs. Otherwise the face whose mouth moves most during the phrase.
export function assignSpeakers(phrases, faces = [], people = [], { fps = FPS, frames = 1 } = {}) {
  const facts = faceFacts(faces, frames).filter((f) => f.presence >= 0.05)
  if (!people.length) return phrases.map(() => null)
  if (facts.length <= 1) return phrases.map(() => 0)
  const ids = pickFaces(facts, people)
  return phrases.map((p) => {
    const a = Math.floor(p.start * fps)
    const b = Math.ceil(p.end * fps)
    let best = null
    for (const f of facts) {
      const rows = f.rows.filter((r) => r[0] >= a && r[0] <= b)
      if (rows.length < Math.max(2, (b - a) * 0.3)) continue
      const m = rows.reduce((s, r) => s + r[4], 0) / rows.length
      if (!best || m > best.m) best = { id: f.id, m }
    }
    if (!best) return null
    const i = ids.indexOf(best.id)
    return i >= 0 ? i : null
  })
}

// Where a new line goes and how it's stretched. dur: its length as said. The slot is the old line's span; it may
// start EARLY before and end LATE after, inside the gaps around it. ratio = dur / span; within MAX_STRETCH it is
// stretched to fit exactly (left alone within 3%); beyond it the stretch stops at MAX_STRETCH and the line either
// ends early (too short: natural, the mouth closes sooner) or runs on (too long: flagged, never cut).
export function fitPhrase({ start, end }, dur, { prevEnd = -Infinity, nextStart = Infinity, total = Infinity } = {}) {
  const span = end - start
  const ratio = dur / span
  const earliest = Math.max(0, start - EARLY, prevEnd + GAP)
  const latest = Math.min(total, end + LATE, nextStart - GAP)
  const tempo = Math.abs(ratio - 1) < 0.03 ? 1 : Math.min(1 + MAX_STRETCH, Math.max(1 - MAX_STRETCH, ratio))
  const out = dur / tempo
  let at = start
  if (at + out > latest) at = Math.max(earliest, latest - out)
  const over = at + out - latest
  const inRange = Math.abs(ratio - 1) <= MAX_STRETCH
  const warn = over > 0.02 ? `runs ${over.toFixed(1)} s long: shorten the words or say it again` : null
  return { at: +at.toFixed(3), tempo: +tempo.toFixed(4), out: +out.toFixed(3), ratio: +ratio.toFixed(3), inRange, warn }
}

// How far off a take is (0 = it fits exactly), to keep the best of several seeds.
export const fitScore = (span, dur) => Math.abs(Math.log(dur / span))

// The new line's level in dB, to match the old one's: the difference, within ±12 dB; 0 when either is unknown.
export function gainFor(oldDb, newDb) {
  if (!Number.isFinite(oldDb) || !Number.isFinite(newDb) || oldDb <= QUIET_DB) return 0
  return +Math.max(-12, Math.min(12, oldDb - newDb)).toFixed(1)
}

// The gain on the old voice over time, as an ffmpeg expression: 0 (taken out) over each swapped span, widened a
// little and faded in and out; the simple mix (no voice split) keeps the whole track at -30 dB there instead.
export function keepGain(spans, { simple = false } = {}) {
  if (!spans.length) return '1'
  const parts = spans.map(([a, b]) => {
    const m = (a + b) / 2
    const h = (b - a) / 2 + WIDEN
    return `clip((abs(t-${m.toFixed(4)})-${h.toFixed(4)})/${FADE},0,1)`
  })
  const prod = parts.join('*')
  return simple ? `${DUCK}+${(1 - DUCK).toFixed(4)}*${prod}` : prod
}

// The ffmpeg arguments that mix the new track. base: [background, vocals] (split) or [original] (simple); lines:
// [{ file, at, tempo, gain, start, end }] of the swapped phrases; total: the track's length in seconds (Remake's
// padded source). 48 kHz stereo WAV. voiceOnly (with base [vocals]): the voices alone, no room sound, the old voice
// taken out under the new lines (Rebuild's shots lip-sync to it).
export function mixArgs({ base, lines, total, out, voiceOnly = false }) {
  const simple = base.length === 1 && !voiceOnly
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const spans = lines.map((l) => [l.start, l.end])
  const chains = []
  const labels = []
  if (simple) {
    chains.push(`[0:a]${fmt},asetnsamples=n=240,volume='${keepGain(spans, { simple: true })}':eval=frame[k0]`)
    labels.push('[k0]')
  } else if (voiceOnly) {
    chains.push(`[0:a]${fmt},asetnsamples=n=240,volume='${keepGain(spans)}':eval=frame[vo]`)
    labels.push('[vo]')
  } else {
    chains.push(`[0:a]${fmt}[bg]`, `[1:a]${fmt},asetnsamples=n=240,volume='${keepGain(spans)}':eval=frame[vo]`)
    labels.push('[bg]', '[vo]')
  }
  lines.forEach((l, i) => {
    const k = base.length + i
    const ms = Math.max(0, Math.round(l.at * 1000))
    const stretch = l.tempo && l.tempo !== 1 ? `,rubberband=tempo=${l.tempo}:formant=preserved` : ''
    chains.push(`[${k}:a]${fmt}${stretch},volume=${l.gain || 0}dB,adelay=${ms}:all=1[n${i}]`)
    labels.push(`[n${i}]`)
  })
  const mix = `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,alimiter=limit=0.98:latency=1,apad,atrim=end=${total.toFixed(4)}[out]`
  const inputs = [...base, ...lines.map((l) => l.file)].flatMap((f) => ['-i', f])
  return ['-y', '-v', 'error', ...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', out]
}

// How much of what was meant Whisper heard back, 0..1: the longest run of words in common, over the longer line.
const words = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean)
export function wordMatch(meant, heard) {
  const a = words(meant)
  const b = words(heard)
  if (!a.length && !b.length) return 1
  if (!a.length || !b.length) return 0
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1])
  return +(d[a.length][b.length] / Math.max(a.length, b.length)).toFixed(3)
}

const LANGUAGES = { en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', ru: 'Russian', pl: 'Polish', sv: 'Swedish' }
export const languageName = (code) => LANGUAGES[code] || (code ? code[0].toUpperCase() + code.slice(1) : 'English')

const mmss = (t) => {
  const m = Math.floor(t / 60)
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(3).padStart(6, '0')}`
}
// The spoken lines for the prompt writer: who says what, when.
export function spokenLines(voice, people = []) {
  return (voice?.phrases || []).map((p) => {
    const who = p.swap && p.person != null ? `Character ${p.person + 1} (${people[p.person]?.name || 'the character'})` : 'Someone not swapped'
    return `${mmss(p.start)}-${mmss(p.end)} ${who}: "${p.text}"`
  })
}

// Take C: the seconds where H3 makes the sound new (person 0's lines, a little wider), for RemakeConditioning's regen.
export function regenSpans(voice, person = 0) {
  return (voice?.phrases || [])
    .filter((p) => p.swap && p.person === person)
    .map((p) => `${Math.max(0, p.start - 0.1).toFixed(2)}-${(p.end + 0.15).toFixed(2)}`)
    .join(', ')
}
// Take C: the lines H3 must say, in its dialogue form, added to the prompt's detailed_description.
export function withDialogue(prompt, voice, { person = 0, subject = 1 } = {}) {
  const lang = languageName(voice?.language)
  const lines = (voice?.phrases || []).filter((p) => p.swap && p.person === person).map((p) => `From ${mmss(p.start)} to ${mmss(p.end)}, <Subject ${subject}>, in the voice of <Audio 1>, says: <d>[${lang}] ${p.text}</d>`)
  if (!lines.length) return prompt
  const at = prompt.search(/^overall_soundscape:/m)
  // at the end of detailed_description, just before overall_soundscape
  return at < 0 ? `${prompt.trimEnd()}\n${lines.join('\n')}\n` : `${prompt.slice(0, at).trimEnd()}\n${lines.join('\n')}\n\n${prompt.slice(at)}`
}

// ---------- the work ----------

const run = (cmd, args, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, env })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${path.basename(cmd)} exited ${code}`))))
  })

export const peopleKey = (people = []) => people.map((p) => p?.voiceId || '').join('|')
// The voice needs making (again) before a render: never heard, a different voice chosen since, or (for the track) not
// mixed. people: whose voices are wanted (Replace: the session's people; Rebuild: its swap).
export const voiceStale = (s, { h3 = false, people = s.people } = {}) => !s.voice?.phrases || s.voice.peopleKey !== peopleKey(people) || (!h3 && !s.voice.track)

// Where a voice swap lives. Replace keeps it on its Remake session (one clip of up to 14 s, padded to Remake's
// length); Rebuild on the rebuild (the whole source, up to 2 minutes, its swap's voice).
//   get / save   the object that carries .voice
//   dir          the folder for the voice's files
//   info(obj)    { source (a file with the sound), total (the track's length, s), seconds (the real length, s),
//                  people [{ voiceId, name, who }], motion { file, start, width, height } (where to see who talks) }
export function remakeHost(remake) {
  return {
    get: (id) => remake.get(id),
    save: (s) => remake.save(s),
    dir: (id) => path.join(remake.dir, id, 'voice'),
    wanted: (s) => s.kind === 'swap' && (s.people || []).some((p) => p.voiceId),
    info: (s) => ({ source: s.source, total: s.frames / FPS, seconds: s.n / FPS, people: s.people || [], motion: { file: s.origin || s.video, start: s.section?.start || 0, width: s.canvas.width, height: s.canvas.height } })
  }
}
// A rebuild's swap as a voice swap's people: one person, the one painted in.
export const rebuildPeople = (r) => {
  const swap = r.plan ? r.plan.swap : r.swap
  return swap ? [{ voiceId: swap.voiceId || null, name: swap.name || '', who: swap.who || '' }] : []
}
export function rebuildHost(rebuilds) {
  return {
    get: (id) => rebuilds.get(id),
    save: (r) => rebuilds.write(r),
    dir: (id) => rebuilds.folder(id, 'voice'),
    wanted: (r) => rebuildPeople(r).some((p) => p.voiceId),
    info: (r) => {
      const w = r.source.width >= r.source.height ? 640 : 360
      const h = Math.round((w * r.source.height) / r.source.width / 2) * 2
      return { source: r.source.file, total: r.source.duration, seconds: r.source.duration, people: rebuildPeople(r), motion: { file: r.source.file, start: 0, width: w, height: h } }
    }
  }
}

export class VoiceSwap {
  // host: remakeHost(...) or rebuildHost(...). voices: () => Voices. shinobi: () => Shinobi (its Python and face
  // models, for who's talking; optional).
  constructor({ host, voices, shinobi = () => null, ffmpeg, resourcesDir }) {
    Object.assign(this, { host, voices, shinobi, ffmpeg, resourcesDir })
  }

  dir = (id) => this.host.dir(id)
  key = (s) => {
    const { source, total } = this.host.info(s)
    return createHash('sha1').update(JSON.stringify([source, fs.statSync(source).mtimeMs, total])).digest('hex').slice(0, 12)
  }
  wanted = (s) => this.host.wanted(s)
  stale = (s, opts = {}) => voiceStale(s, { ...opts, people: this.host.info(s).people })

  // Who has a voice: [{ index, voiceId, name }] (voiceId null keeps the original voice). Throws when a chosen voice
  // no longer exists.
  people(s) {
    return this.host.info(s).people.map((p, index) => {
      if (!p.voiceId) return { index, voiceId: null, name: p.name || '' }
      const v = this.voices().get(p.voiceId)
      return { index, voiceId: v.id, name: p.name || v.name, voiceName: v.name, reference: v.reference }
    })
  }

  async level(file, from, len) {
    const { err } = await run(this.ffmpeg, ['-hide_banner', '-ss', from.toFixed(3), '-t', Math.max(0.05, len).toFixed(3), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
    const m = err.match(/mean_volume:\s*(-?[\d.]+) dB/)
    return m ? Number(m[1]) : null
  }

  // 1-3: the sound apart, the words heard, who says them. Kept until the source changes.
  async hear(id, { onProgress } = {}) {
    const s = this.host.get(id)
    const { source, total, seconds, people, motion } = this.host.info(s)
    const dir = this.dir(id)
    fs.mkdirSync(dir, { recursive: true })
    const original = path.join(dir, 'original.wav')
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', source, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', original])
    let vocals = original
    let background = null
    let mode = 'simple'
    const V = this.voices()
    if (V.splitterReady()) {
      onProgress?.({ step: 'splitting the voice from the room sound' })
      const r = await V.separate(original, { vocals: path.join(dir, 'vocals.wav'), background: path.join(dir, 'background.wav') })
      ;({ vocals, background } = r)
      mode = 'split'
    }
    onProgress?.({ step: 'hearing the words' })
    const heard = await V.transcribeTimed(vocals)
    const { err } = await run(this.ffmpeg, ['-hide_banner', '-i', vocals, '-af', 'silencedetect=noise=-35dB:d=0.12', '-f', 'null', '-'])
    const phrases = phrasesFrom(heard.segments, { seconds, silences: silencesFrom(err, total) })
    // who says each: whose mouth moves (on the source as it was, before any soft mouth)
    let faces = []
    let frames = Math.round(seconds * FPS)
    const sh = this.shinobi()
    if (phrases.length && people.length && motion?.file && sh?.installed?.() && sh.faceModelsReady?.()) {
      onProgress?.({ step: 'seeing who talks' })
      const clip = path.join(dir, 'motion.mp4')
      await run(this.ffmpeg, ['-y', '-v', 'error', '-ss', motion.start.toFixed(3), '-t', seconds.toFixed(3), '-i', motion.file, '-an', '-vf', `fps=${FPS},scale=${motion.width}:${motion.height}`, '-c:v', 'libx264', '-crf', '18', clip])
      const r = JSON.parse((await run(sh.python, [path.join(this.resourcesDir, 'python', 'mouth_track.py'), '--motion', sh.faceDir, clip], sh.env?.())).out)
      if (!r.error) ({ faces, frames } = { faces: r.faces || [], frames: r.frames || frames })
    }
    const who = assignSpeakers(phrases, faces, people, { frames })
    const voice = {
      key: this.key(s),
      mode,
      language: heard.language,
      original,
      vocals: mode === 'split' ? vocals : null,
      background,
      faces: faces.length,
      phrases: phrases.map((p, i) => ({ ...p, heardAs: p.text, person: who[i], swap: who[i] != null && !!people[who[i]]?.voiceId })),
      peopleKey: peopleKey(people),
      heardAt: new Date().toISOString()
    }
    return this.host.save({ ...this.host.get(id), voice })
  }

  // 4-6: says each swapped line in its person's voice, fits it, mixes the track and reads it back. Re-hears first
  // when the source changed (or rehear). Lines already said with the same words, voice and seed come from the cache.
  async make(id, { rehear = false, onProgress } = {}) {
    let s = this.host.get(id)
    if (!this.wanted(s)) throw new Error('Choose a voice for who goes in first.')
    if (rehear || !s.voice?.phrases || s.voice.key !== this.key(s)) s = await this.hear(id, { onProgress })
    // a different voice chosen since the words were heard: whose lines are swapped follows it
    const wantedPeople = this.host.info(s).people
    if (s.voice.peopleKey !== peopleKey(wantedPeople)) {
      s.voice.phrases.forEach((p) => (p.swap = p.person != null && !!wantedPeople[p.person]?.voiceId))
      s = this.host.save({ ...s, voice: { ...s.voice, peopleKey: peopleKey(wantedPeople) } })
    }
    const people = this.people(s)
    const dir = this.dir(id)
    const { total } = this.host.info(s)
    const v = s.voice
    const phrases = v.phrases.map((p) => ({ ...p }))
    const levelOf = v.mode === 'split' ? v.vocals : v.original
    for (const [i, p] of phrases.entries()) {
      const person = p.person != null ? people[p.person] : null
      if (!p.swap || !person?.voiceId) {
        Object.assign(p, { file: null, at: null, tempo: null, out: null, gain: null, warn: null, heard: null, match: null })
        continue
      }
      onProgress?.({ step: `saying line ${i + 1} of ${phrases.length}`, phrase: i })
      const span = p.end - p.start
      const seeds = p.seed != null ? [p.seed] : SEEDS
      let best = null
      for (const seed of seeds) {
        const out = path.join(dir, `line_${createHash('sha1').update([person.voiceId, p.text, seed].join('\u0000')).digest('hex').slice(0, 12)}.wav`)
        const said = await this.speechOnly(await this.voices().sayTo({ voiceId: person.voiceId, text: p.text, seed, out }))
        const score = fitScore(span, said.duration)
        if (!best || score < best.score) best = { seed, file: said.file, dur: said.duration, score }
        if (Math.abs(said.duration / span - 1) <= MAX_STRETCH) break
      }
      const fit = fitPhrase(p, best.dur, { prevEnd: phrases[i - 1]?.end ?? -Infinity, nextStart: phrases[i + 1]?.start ?? Infinity, total })
      const gain = gainFor(await this.level(levelOf, p.start, span), await this.level(best.file, 0, best.dur))
      Object.assign(p, { file: best.file, dur: best.dur, usedSeed: best.seed, ...fit, gain })
    }
    s = this.host.save({ ...this.host.get(id), voice: { ...v, phrases, people } })
    await this.mix(id, { onProgress })
    return this.check(id, { onProgress })
  }

  // A said line ({ file, duration }) cut to its speech (speechSpan), next to it.
  async speechOnly(said) {
    const { err } = await run(this.ffmpeg, ['-hide_banner', '-i', said.file, '-af', 'silencedetect=noise=-40dB:d=0.08', '-f', 'null', '-'])
    const span = speechSpan(silencesFrom(err, said.duration), said.duration)
    if (!span) return said
    const out = said.file.replace(/\.wav$/i, '_speech.wav')
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', said.file, '-af', `atrim=${span.from}:${span.to},asetpts=PTS-STARTPTS,afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse`, '-c:a', 'pcm_s16le', out])
    return { ...said, file: out, duration: +(span.to - span.from).toFixed(3), said: said.file }
  }

  // The track (room sound kept, or ducked without the splitter) and the voices alone (stem), both the track's length.
  async mix(id, { onProgress } = {}) {
    const s = this.host.get(id)
    const v = s.voice
    const { total } = this.host.info(s)
    onProgress?.({ step: 'mixing' })
    const track = path.join(this.dir(id), 'voice.wav')
    const lines = v.phrases.filter((p) => p.file)
    await run(this.ffmpeg, mixArgs({ base: v.mode === 'split' ? [v.background, v.vocals] : [v.original], lines, total, out: track }))
    let stem = track
    if (v.mode === 'split') {
      stem = path.join(this.dir(id), 'voices.wav')
      await run(this.ffmpeg, mixArgs({ base: [v.vocals], lines, total, out: stem, voiceOnly: true }))
    }
    return this.host.save({ ...s, voice: { ...v, track, stem, madeAt: new Date().toISOString() } })
  }

  // Whisper hears each new line in the mixed track; a line it can't read back (a stumble, a missed word) is said
  // once more with another seed and the track mixed again.
  async check(id, { onProgress, again = true } = {}) {
    let s = this.host.get(id)
    const v = s.voice
    const tmp = path.join(this.dir(id), 'check.wav')
    const retry = []
    for (const [i, p] of v.phrases.entries()) {
      if (!p.file) continue
      onProgress?.({ step: `checking line ${i + 1}` })
      await run(this.ffmpeg, ['-y', '-v', 'error', '-ss', Math.max(0, p.at - 0.1).toFixed(3), '-t', (p.out + 0.3).toFixed(3), '-i', v.track, '-ac', '1', '-ar', '16000', tmp])
      p.heard = await this.voices().transcribe(tmp).catch(() => null)
      p.match = p.heard == null ? null : wordMatch(p.text, p.heard)
      if (p.match != null && p.match < MATCH_OK && p.seed == null && again) retry.push(i)
    }
    fs.rmSync(tmp, { force: true })
    s = this.host.save({ ...s, voice: { ...v } })
    if (!retry.length) return s
    for (const i of retry) v.phrases[i].seed = (v.phrases[i].usedSeed ?? 41) + 1000
    this.host.save({ ...s, voice: v })
    await this.make(id, { onProgress })
    return this.host.get(id)
  }

  // One line changed: its words, whether it is swapped, or a new seed ("say it again"). Mixes again.
  async setPhrase(id, index, { text, swap, seed, again = false } = {}, { onProgress } = {}) {
    const s = this.host.get(id)
    const p = s.voice?.phrases?.[index]
    if (!p) throw new Error(`No line ${index}.`)
    if (text != null) p.text = String(text).trim() || p.text
    if (swap != null) p.swap = !!swap && p.person != null
    if (swap && p.person == null) Object.assign(p, { person: 0, swap: true })
    if (seed != null) p.seed = seed
    if (again) p.seed = (p.usedSeed ?? p.seed ?? 41) + 1000
    this.host.save(s)
    return this.make(id, { onProgress })
  }
}

// Replace's voice swap, on its Remake sessions.
export class RemakeVoice extends VoiceSwap {
  constructor({ remake, ...rest }) {
    super({ host: remakeHost(remake), ...rest })
  }
}
