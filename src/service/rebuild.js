// Rebuild: a video the person made (or may rework) taken apart and made again on this PC. The reader
// (reader.js) splits it into shots with frames, contact sheets, caption changes, beat and loudness; the agent,
// or the writer set in Settings, says what each shot is; the person approves a plan of routes; text is painted
// out of the H3 shots' frames (and anything swapped in); the person approves the frames; H3 renders each shot in
// frames mode, the person picks a take, it's finished at 1 MP; and the first cut puts every shot back in its
// slot in an Edit, captions as titles and the original sound as a guide.
//   rebuild/<id>/rebuild.json  the project; source.<ext>, shots/, reading.json, frames/, takes/, cut/
// Routes: h3 (render it again), still (a picture with a slow push), keep (the original footage), own (the
// person's own clip), replace (keep it here; Replace remakes it on its own page). Nothing renders before the plan
// is approved, and no H3 shot before the frames are. Free and local: the writer is the person's own (Ollama,
// Claude Code or Codex), never the paid one.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { FORMATS } from './edits.js'
import { harnessJson } from './harness.js'
import { IMAGE_ASPECTS } from './images.js'
import { blocking, FIRST_FRAME_LINE, firstLastLine, withLine } from './lint.js'
import { probe } from './media.js'
import { ASPECTS } from './plan.js'
import { localChat, localWriterModel } from './prompter.js'
import { applyOps } from './timeline.js'

export const KINDS = ['ai_video', 'live', 'code_graphics', 'screen', 'still', 'film_clip', 'unsure']
export const ROUTES = ['h3', 'still', 'keep', 'own', 'replace']
export const WHERE = ['top', 'middle', 'bottom']
export const NO_TEXT = 'There is no writing anywhere in the picture.'
export const CLEAN_TEXT = 'Remove every caption, title, label, sticker and on-screen text. Keep everything else exactly as it is: people, objects, framing, light and colours.'
export const GUIDE_WARNING = "A1 is the reference video's own sound, as a guide. Replace it before you publish."
export const voiceNote = (name, mode) => `A1 is the new voice track: the words in ${name || 'the new'}'s voice${mode === 'split' ? ', with the room sound and music kept' : '; the room sound dips under the new lines (set up the voice splitter to keep it)'}.`
export const MAX_SECONDS = 120
const MAX_FRAMES = 345 // 14.4 s, the longest take generate_previews makes; with a 1.25x slow-down, an 18 s shot
const REPLACE_SECONDS = 14
const DONE = ['success', 'error', 'cancelled']
const RIGHTS = 'Rebuild is for video you made or have the right to rework. Confirm that (rights: true) to go on.'

const r3 = (v) => Math.round(v * 1000) / 1000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const now = () => new Date().toISOString()
const pad3 = (k) => String(k).padStart(3, '0')
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const ratioOf = (key) => {
  const [a, b] = key.split(':').map(Number)
  return a / b
}
const nearestKey = (keys, r) => keys.reduce((best, k) => (Math.abs(Math.log(ratioOf(k) / r)) < Math.abs(Math.log(ratioOf(best) / r)) ? k : best), keys[0])

// ---------- rules ----------
export const defaultRoute = (kind) => (kind === 'ai_video' ? 'h3' : kind === 'still' ? 'still' : 'keep')

// How H3 makes a shot of `duration` seconds: a length on its 17n+5 frame grid, never under its trained 124 frames
// (5.17 s). Long enough that the cut slows it down at most 1.25x: then it gets the first and the last frame. A
// shot so short that its take would need more than a 1.25x speed-up renders 5.17 s from the first frame only, with
// the action written to happen at once, and the cut keeps its first `trimTo` seconds.
export function h3Length(duration) {
  const natural = 17 * Math.ceil((duration * 24) / 1.25 / 17 - 5 / 17) + 5
  const frames = Math.max(124, natural)
  const short = frames / 24 / duration > 1.25
  return { frames, seconds: r3(frames / 24), short, useLast: !short, trimTo: short ? r3(duration) : null, tooLong: frames > MAX_FRAMES }
}

// The opening line H3's frames mode needs (MiniMax's wording; lint.js checks it too).
export const alignmentLine = ({ useLast, seconds }) => (useLast ? firstLastLine(seconds) : FIRST_FRAME_LINE)

// A take of takeSeconds played into a slot of slotSeconds: the speed (slowed at most 1.25x, sped up at most 3x),
// and whether it's then trimmed (true) or held on its last frame.
export function retime(takeSeconds, slotSeconds) {
  const speed = r3(clamp(takeSeconds / slotSeconds, 1 / 1.25, 3))
  return { speed, trim: takeSeconds / speed > slotSeconds + 0.001 }
}

// ---------- the voice (remakevoice.js on the whole source) ----------
// How a shot's piece of the new voices goes into its H3 take, so the lips land on the real timing once the cut has
// fitted the take to its slot: the slot's piece, slowed by the speed the cut plays the take at (retime), padded to
// the take's length. A short shot (trimTo) plays at its own speed, so its piece is only padded.
export function shotVoicePiece(shot, planShot) {
  const L = planShot.h3
  const slot = shot.duration
  const speed = L.trimTo ? 1 : retime(L.seconds, slot).speed
  return { from: r3(shot.start), slot: r3(slot), tempo: r3(1 / speed), padTo: L.seconds }
}
// The ffmpeg arguments that cut that piece out of the voices (voice.stem) and fit it.
export function shotVoiceArgs({ stem, from, slot, tempo, padTo, out }) {
  const stretch = Math.abs(tempo - 1) > 0.001 ? `rubberband=tempo=${tempo}:formant=preserved,` : ''
  return ['-y', '-v', 'error', '-ss', from.toFixed(3), '-t', slot.toFixed(3), '-i', stem, '-af', `${stretch}apad,atrim=end=${padTo.toFixed(4)}`, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', out]
}
// The lines said during a shot (any part of them inside it).
export const shotLines = (voice, shot) => (voice?.phrases || []).filter((p) => p.end > shot.start + 0.05 && p.start < shot.start + shot.duration - 0.05)
// A shot's prompt with the swapped person's lines in it, so H3 knows the words it lip-syncs (lint.js withLine skips
// a line already written).
export function voicedPrompt(prompt, lines, who) {
  return lines.filter((l) => l.swap).reduce((text, l) => withLine(text, who, l.text), prompt)
}
// Shots whose picture isn't remade while the swapped person talks in them: the old face with the new voice.
export function keptWithVoice(rebuild) {
  const voice = rebuild.voice
  if (!voice?.phrases) return []
  return (rebuild.plan?.shots || []).filter((p) => p.route !== 'h3' && shotLines(voice, rebuild.shots.find((s) => s.index === p.index)).some((l) => l.swap)).map((p) => p.index)
}

// The captions the reading found, as titles on T1 at their place in the film (a caption's from/to are seconds
// into its shot).
export function captionsToTitles(shots) {
  const out = []
  for (const s of shots) {
    for (const c of s.reading?.captions || []) {
      const text = String(c.text || '').trim()
      if (!text) continue
      const from = clamp(Number(c.from) || 0, 0, s.duration)
      const to = clamp(Number(c.to) || s.duration, from, s.duration)
      out.push({ op: 'add_title', content: text, start: r3(s.start + from), duration: r3(Math.max(0.3, to - from)), position: c.where === 'middle' ? 'center' : c.where === 'top' ? 'top' : 'bottom', box: true, size: 5, fadeIn: 0, fadeOut: 0 })
    }
  }
  return out
}

// The Edit format nearest the video's shape (4K has 1080p's shape, so it's never picked).
export function formatFor(width, height) {
  const r = width && height ? width / height : 16 / 9
  const ratios = { '1080p': 16 / 9, vertical: 9 / 16, square: 1 }
  return Object.keys(ratios).reduce((best, k) => (Math.abs(Math.log(ratios[k] / r)) < Math.abs(Math.log(ratios[best] / r)) ? k : best), '1080p')
}

// ffmpeg's video filter for one shot's piece of the cut: the take's first trimTo seconds (when it's short),
// played at speed, fitted to the edit's frame, and held on its last frame or cut to exactly the slot.
export function segmentFilter({ trimTo = null, speed = 1, slot, width, height }) {
  return [
    trimTo && `trim=duration=${trimTo.toFixed(3)}`,
    `setpts=(PTS-STARTPTS)/${speed.toFixed(3)}`,
    'fps=24',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
    `tpad=stop_mode=clone:stop_duration=${slot.toFixed(3)},trim=duration=${slot.toFixed(3)},setpts=PTS-STARTPTS`,
    'format=yuv420p'
  ].filter(Boolean).join(',')
}
// The same for its sound, so it lines up if someone unmutes it.
export function segmentAudio({ trimTo = null, speed = 1, slot }) {
  return [trimTo && `atrim=duration=${trimTo.toFixed(3)}`, 'asetpts=PTS-STARTPTS', Math.abs(speed - 1) > 0.001 && `atempo=${speed.toFixed(3)}`, `apad,atrim=duration=${slot.toFixed(3)}`, 'aresample=48000'].filter(Boolean).join(',')
}

const swapOf = (swap, exists, where = 'swap') => {
  if (!swap) return null
  const ask = String(swap.ask || '').trim()
  if (!ask) throw new Error(`${where}: say what changes (ask).`)
  if (swap.picture && !exists(swap.picture)) throw new Error(`${where}: picture not found: ${swap.picture}`)
  const out = { ask, picture: swap.picture || null }
  // the voice the person painted in speaks with (a voice from Audio > Voices), and their name for the prompts
  if (swap.voiceId) out.voiceId = String(swap.voiceId)
  if (swap.name) out.name = String(swap.name).trim()
  if (swap.who) out.who = String(swap.who).trim()
  return out
}
// What the painter sees of a swap (a change of voice alone repaints nothing).
const paintKey = (swap) => JSON.stringify(swap ? { ask: swap.ask, picture: swap.picture || null } : null)

// Checks a plan against the rebuild's shots; returns it tidied, or throws naming the shot.
export function validatePlan(rebuild, plan, { lint, exists = fs.existsSync }) {
  const given = new Map()
  for (const p of plan?.shots || []) {
    const k = Number(p.index)
    if (!rebuild.shots.some((s) => s.index === k)) throw new Error(`There's no shot ${p.index}; the shots run 1 to ${rebuild.shots.length}.`)
    if (given.has(k)) throw new Error(`Shot ${k} is in the plan twice.`)
    given.set(k, p)
  }
  const shots = rebuild.shots.map((s) => {
    const p = given.get(s.index)
    const where = `Shot ${s.index}`
    if (!p) throw new Error(`${where} has no route in the plan (${ROUTES.join(', ')}).`)
    if (!ROUTES.includes(p.route)) throw new Error(`${where}: route is ${ROUTES.join(', ')}.`)
    const out = { index: s.index, route: p.route, prompt: null, character: 'none', file: null, h3: null, note: p.note || null }
    if (p.route === 'h3') {
      const L = h3Length(s.duration)
      if (L.tooLong) throw new Error(`${where} is too long for one H3 take (about 18 s and up): split it, or keep it.`)
      const prompt = String(p.prompt || '').trim()
      if (!prompt) throw new Error(`${where}: an h3 shot needs its prompt.`)
      const line = alignmentLine(L)
      if (!prompt.startsWith(line)) throw new Error(`${where}: the prompt must open with H3's frames line for this shot (${L.useLast ? 'first and last frame' : 'first frame only'}):\n${line}`)
      if (!prompt.includes(NO_TEXT)) throw new Error(`${where}: the prompt must say "${NO_TEXT}" (H3 copies writing it sees).`)
      const media = L.useLast ? [{ kind: 'picture' }, { kind: 'picture' }] : [{ kind: 'picture' }]
      const errors = blocking(lint(prompt, { mode: 'frames', seconds: L.seconds, media }) || [])
      if (errors.length) throw new Error(`${where}: ${errors.map((e) => e.message).join(' ')}`)
      Object.assign(out, { prompt, character: p.character || 'none', h3: L })
    }
    if (p.route === 'own') {
      if (!p.file || !exists(p.file)) throw new Error(`${where}: your own clip wasn't found${p.file ? `: ${p.file}` : ' (file)'}.`)
      out.file = p.file
    }
    if (p.route === 'replace' && s.duration > REPLACE_SECONDS) throw new Error(`${where} is ${s.duration.toFixed(1)} s; Replace takes clips up to ${REPLACE_SECONDS} s.`)
    return out
  })
  return { swap: plan?.swap !== undefined ? swapOf(plan.swap, exists, 'plan.swap') : swapOf(rebuild.swap, exists), shots, notes: plan?.notes || '' }
}

// ---------- the writer: what each shot is ----------
const answerSchema = () => ({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: KINDS },
    why: { type: 'string' },
    description: { type: 'string' },
    captions: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, from: { type: 'number' }, to: { type: 'number' }, where: { type: 'string', enum: WHERE } }, required: ['text', 'from', 'to', 'where'], additionalProperties: false } },
    stickers: { type: 'array', items: { type: 'string' } },
    camera: { type: 'string' },
    light: { type: 'string' }
  },
  required: ['kind', 'why', 'description', 'captions', 'stickers', 'camera', 'light'],
  additionalProperties: false
})
const WRITER_SYSTEM = `You look at one shot of a short video and say what it is, so it can be made again.
kind: ai_video (made with an AI video model: smooth, dreamlike, too-perfect skin, morphing details), live (filmed with a camera), code_graphics (animated text, shapes or charts made in software), screen (a screen recording), still (one picture, perhaps with a slow push), film_clip (from a film or show), unsure (you can't tell; say so rather than guess).
why: the signs you saw. description: in English, concretely, what's in the picture and what moves: subject, clothes, place, framing, the action from start to end. It is the raw material for a video prompt, so leave the writing out of it.
captions: every piece of writing laid over the picture, word for word, with when it shows (seconds into the shot) and where (top, middle, bottom). stickers: emoji, arrows, logos laid on top. camera: how the camera moves (static, push in, pan left...). light: the light in a few words.`

// ---------- the service ----------
export class Rebuilds {
  // voice: a VoiceSwap on rebuildHost(this) (remakevoice.js), set after construction; without it nothing is voiced.
  constructor({ dataDir, reader, studio, images, remake, edits, writer, lint, onLog }) {
    this.dir = path.join(dataDir, 'rebuild')
    Object.assign(this, { reader, studio, images, remake, edits, writer, lint })
    this.voice = null
    this.onLog = onLog || (() => {})
  }

  file = (id) => path.join(this.dir, id, 'rebuild.json')
  folder = (id, ...more) => path.join(this.dir, id, ...more)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((id) => readJson(this.file(id), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((r) => ({ id: r.id, name: r.name, status: r.status, shots: r.shots.length, seconds: r3(r.source.duration), cover: r.shots[0]?.middle || null, editId: r.editId, updatedAt: r.updatedAt }))
  }
  get(id) {
    const r = readJson(this.file(id), null)
    if (!r) throw new Error(`No rebuild ${id}`)
    return r
  }
  write(r) {
    r.updatedAt = now()
    fs.mkdirSync(path.dirname(this.file(r.id)), { recursive: true })
    fs.writeFileSync(`${this.file(r.id)}.tmp`, JSON.stringify(r, null, 2))
    fs.renameSync(`${this.file(r.id)}.tmp`, this.file(r.id))
    return r
  }
  remove(id) {
    fs.rmSync(this.folder(id), { recursive: true, force: true })
    return true
  }
  shot(r, index) {
    const s = r.shots.find((x) => x.index === Number(index))
    if (!s) throw new Error(`There's no shot ${index}; the shots run 1 to ${r.shots.length}.`)
    return s
  }

  // ---------- 1 read ----------
  async read({ file, name, rights, swap = null }) {
    if (rights !== true) throw new Error(RIGHTS)
    if (!file || !fs.existsSync(file)) throw new Error(`File not found: ${file}`)
    const ffprobe = this.reader.ffprobe || this.edits?.ffprobe
    if (ffprobe) {
      const info = await probe(ffprobe, file)
      if (info.kind !== 'video') throw new Error(`${path.basename(file)} isn't a video.`)
      if (info.duration > MAX_SECONDS) throw new Error(`Rebuild takes videos up to ${MAX_SECONDS / 60} minutes; this one is ${Math.round(info.duration)} s. Trim it first.`)
    }
    const swapped = swapOf(swap, fs.existsSync)
    const id = randomUUID().slice(0, 8)
    const dir = this.folder(id)
    fs.mkdirSync(dir, { recursive: true })
    const source = path.join(dir, `source${path.extname(file).toLowerCase() || '.mp4'}`)
    fs.copyFileSync(file, source)
    let reading
    try {
      reading = await this.reader.read(source, dir)
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw err
    }
    if (reading.source.duration > MAX_SECONDS) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw new Error(`Rebuild takes videos up to ${MAX_SECONDS / 60} minutes.`)
    }
    return this.write({
      id,
      name: String(name || '').trim() || path.parse(file).name,
      createdAt: now(),
      rightsConfirmedAt: now(),
      original: file,
      swap: swapped,
      source: reading.source,
      music: reading.music,
      loudness: reading.loudness,
      silences: reading.silences,
      speechState: reading.speech,
      shots: reading.shots.map((s) => ({ ...s, reading: null })),
      status: 'reading',
      plan: null,
      planApprovedAt: null,
      framesApprovedAt: null,
      frames: {},
      takes: {},
      editId: null
    })
  }

  // ---------- 2 what each shot is ----------
  // answers: [{ index, kind, why, description, captions: [{ text, from, to, where }], stickers, camera, light }]
  saveReading(id, answers) {
    const r = this.get(id)
    if (r.status === 'rendering') throw new Error('The shots are rendering from the approved plan. Wait for them first.')
    for (const a of answers || []) {
      const s = this.shot(r, a.index)
      if (!KINDS.includes(a.kind)) throw new Error(`Shot ${s.index}: kind is ${KINDS.join(', ')}.`)
      const captions = (a.captions || []).map((c) => {
        const text = String(c.text || '').trim()
        const from = r3(clamp(Number(c.from) || 0, 0, s.duration))
        return { text, from, to: r3(clamp(c.to == null ? s.duration : Number(c.to), from, s.duration)), where: WHERE.includes(c.where) ? c.where : 'bottom' }
      }).filter((c) => c.text)
      const stickers = (Array.isArray(a.stickers) ? a.stickers : a.stickers ? [a.stickers] : []).map(String).filter((x) => x.trim())
      s.reading = { kind: a.kind, why: String(a.why || ''), description: String(a.description || ''), captions, stickers, camera: String(a.camera || ''), light: String(a.light || '') }
    }
    if (r.shots.every((s) => s.reading) && r.status === 'reading') r.status = 'planning'
    return this.write(r)
  }

  // The writer from Settings looks at each shot still unread (or the ones in only) and answers for it.
  async readWithWriter(id, { only = null } = {}) {
    const r = this.get(id)
    const w = this.writer()
    if (!['local', 'claude', 'codex'].includes(w.engine)) throw new Error('Rebuild reads shots with the local writer, Claude or ChatGPT. Choose one in Settings → Prompt writer.')
    const todo = r.shots.filter((s) => (only ? only.includes(s.index) : !s.reading))
    const answers = []
    for (const s of todo) {
      this.onLog(`Reading shot ${s.index}…`)
      const images = [['sheet.jpg', s.sheet], ['first.jpg', s.first], ['last.jpg', s.last]].map(([name, f]) => ({ name, data: fs.readFileSync(f).toString('base64') }))
      const user = [
        `Shot ${s.index} of ${r.shots.length}: ${s.start.toFixed(2)} to ${s.end.toFixed(2)} s (${s.duration.toFixed(2)} s) of a ${r.source.width}x${r.source.height} video.`,
        'Pictures: sheet.jpg (its first, middle and last frame side by side), first.jpg, last.jpg.',
        s.bandTop.length && `Something changes in the top band at ${s.bandTop.map((t) => (t - s.start).toFixed(2)).join(', ')} s into the shot (a caption coming or going?).`,
        s.bandBottom.length && `Something changes in the bottom band at ${s.bandBottom.map((t) => (t - s.start).toFixed(2)).join(', ')} s into the shot.`,
        s.words && `Words heard: "${s.words}"`,
        'Answer as JSON.'
      ].filter(Boolean).join('\n')
      const a = w.engine === 'local' ? await this.localWriter({ model: w.model, user, images }) : await harnessJson({ engine: w.engine, model: w.model, system: WRITER_SYSTEM, user, schema: answerSchema(), images })
      answers.push({ ...a, index: s.index })
    }
    return this.saveReading(id, answers)
  }
  async localWriter({ model, user, images }) {
    const { name } = await localWriterModel(model, { needsEyes: 'read a shot' })
    return localChat({
      model: name,
      system: WRITER_SYSTEM,
      schema: answerSchema(),
      temperature: 0.2,
      ctx: 16384,
      cpu: await this.studio?.gpuBusy?.().catch(() => false),
      timeoutMs: 900000,
      messages: [{ role: 'user', content: user, images: images.map((im) => im.data) }]
    })
  }

  // ---------- 3 the plan ----------
  // plan: { swap?: { ask, picture? } | null, shots: [{ index, route, prompt?, character?, file? }], notes? }
  savePlan(id, plan) {
    const r = this.get(id)
    if (r.status === 'rendering') throw new Error('The shots are rendering from the approved plan. Wait for them (get_rebuild), then change the plan.')
    const next = validatePlan(r, plan, { lint: this.lint, exists: fs.existsSync })
    const before = new Map((r.plan?.shots || []).map((p) => [p.index, p]))
    // a changed swap repaints every frame; a shot whose route, prompt or character changed loses its take
    if (paintKey(next.swap) !== paintKey(r.plan ? r.plan.swap : r.swap)) r.frames = {}
    for (const p of next.shots) {
      const b = before.get(p.index)
      if (p.route !== 'h3') delete r.frames[p.index]
      if (!b || b.route !== p.route || b.prompt !== p.prompt || b.character !== p.character || !r.frames[p.index]) delete r.takes[p.index]
    }
    r.plan = { ...next, savedAt: now() }
    r.swap = next.swap
    r.planApprovedAt = null
    r.framesApprovedAt = null
    r.status = 'planning'
    return this.write(r)
  }
  approvePlan(id) {
    const r = this.get(id)
    if (!r.plan) throw new Error('Write the plan first.')
    r.planApprovedAt = now()
    r.status = 'approved'
    return this.write(r)
  }
  h3Shots = (r) => (r.plan?.shots || []).filter((p) => p.route === 'h3')

  // ---------- 4 the frames ----------
  // The first (and, for longer shots, the last) frame of each H3 shot, with any writing painted out and the swap
  // painted in, both ends with one seed so they match. A shot with no writing and no swap keeps its frames.
  async makeFrames(id, { only = null } = {}) {
    let r = this.get(id)
    if (!r.planApprovedAt) throw new Error("The plan needs the person's OK first (approve_rebuild_plan once they say yes).")
    if (r.status === 'rendering') throw new Error('The shots are rendering. Wait for them first.')
    const todo = this.h3Shots(r).filter((p) => (only ? only.includes(p.index) : !r.frames[p.index]))
    const aspect = nearestKey(Object.keys(IMAGE_ASPECTS), r.source.width / r.source.height)
    let painter = null
    for (const p of todo) {
      const s = this.shot(r, p.index)
      const ends = p.h3.useLast ? ['first', 'last'] : ['first']
      const swap = r.plan.swap
      const edit = !!swap || !!s.reading?.captions?.length || !!s.reading?.stickers?.length
      const seed = Math.floor(Math.random() * 1e9)
      const got = { first: null, last: null, original: { first: s.first, last: p.h3.useLast ? s.last : null }, edited: edit, seed: edit ? seed : null }
      for (const end of ends) {
        let file = s[end]
        if (edit) {
          painter ||= await this.remake.painter()
          this.onLog(`Painting shot ${s.index}'s ${end} frame…`)
          const set = await this.images.create({ mode: 'edit', model: painter.model, prompt: swap ? `${CLEAN_TEXT} Then: ${swap.ask}` : CLEAN_TEXT, refs: [s[end], swap?.picture].filter(Boolean), count: 1, seed, keepAspect: true, aspect, megapixels: 1, name: `Rebuild · shot ${s.index} ${end}`, tag: `rebuild:${id}` })
          const done = await this.remake.waitPictures(set.id)
          fs.mkdirSync(this.folder(id, 'frames'), { recursive: true })
          file = this.folder(id, 'frames', `shot_${pad3(s.index)}_${end}_${Date.now()}${path.extname(done) || '.png'}`)
          fs.copyFileSync(done, file)
        }
        got[end] = await this.fitFrame(id, r, file, s.index, end)
      }
      r = this.get(id)
      r.frames[p.index] = got
      delete r.takes[p.index]
      r.framesApprovedAt = null
      r.status = 'frames'
      this.write(r)
    }
    return this.get(id)
  }
  // H3 stretches a frame that isn't its own shape: one that differs by more than 1% is cropped to it (the middle).
  async fitFrame(id, r, file, index, end) {
    const want = ratioOf(this.h3Aspect(r))
    const have = r.source.width / r.source.height
    if (Math.abs(Math.log(want / have)) < 0.01 || !this.edits) return file
    const out = this.folder(id, 'frames', `shot_${pad3(index)}_${end}_fit_${Date.now()}.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    await this.edits.run(['-y', '-v', 'error', '-i', file, '-vf', `crop='min(iw,ih*${want.toFixed(5)})':'min(ih,iw/${want.toFixed(5)})'`, out])
    return out
  }
  h3Aspect = (r) => nearestKey(Object.keys(ASPECTS).filter((k) => /^\d+:\d+$/.test(k)), r.source.width / r.source.height)
  approveFrames(id) {
    const r = this.get(id)
    if (!r.planApprovedAt) throw new Error("The plan needs the person's OK first.")
    const missing = this.h3Shots(r).filter((p) => !r.frames[p.index]).map((p) => p.index)
    if (missing.length) throw new Error(`Make the frames first (shot ${missing.join(', ')}).`)
    r.framesApprovedAt = now()
    return this.write(r)
  }

  // ---------- 5 the shots ----------
  // The voice swap for the whole source (remakevoice.js): who goes in says the same words in their saved voice.
  async makeVoice(id, opts = {}) {
    if (!this.voice) throw new Error('The voice swap isn’t set up here.')
    return this.voice.make(id, opts)
  }
  setPhrase(id, index, patch, opts) {
    if (!this.voice) throw new Error('The voice swap isn’t set up here.')
    return this.voice.setPhrase(id, index, patch, opts)
  }
  // The voice the swapped-in person speaks with (a voice from Audio > Voices; null keeps the original voice), and
  // their name for the prompts. The frames and approvals stay: a voice changes no picture.
  setSwapVoice(id, { voiceId = null, name } = {}) {
    const r = this.get(id)
    const swap = r.plan ? r.plan.swap : r.swap
    if (!swap) throw new Error('This rebuild changes no one: say what changes first (the plan’s swap).')
    const next = { ...swap }
    if (voiceId) next.voiceId = String(voiceId)
    else delete next.voiceId
    if (name != null) {
      if (String(name).trim()) next.name = String(name).trim()
      else delete next.name
    }
    r.swap = next
    if (r.plan) r.plan.swap = next
    return this.write(r)
  }
  // The voice the shots use, when the swap wants one and it's made for the current swap.
  voiced(r) {
    return !!(this.voice?.wanted(r) && r.voice?.stem && !this.voice.stale(r) && fs.existsSync(r.voice.stem))
  }

  async makeShots(id) {
    let r = this.get(id)
    if (!r.framesApprovedAt) throw new Error("The frames need the person's OK first (approve_rebuild_frames once they say yes).")
    // a swap with a voice: the new voice track first, so each shot's lips follow its piece of it
    if (this.voice?.wanted(r) && !this.voiced(r)) r = await this.voice.make(id)
    const voiced = this.voiced(r)
    const voiceKey = voiced ? r.voice.madeAt : null
    const who = r.plan.swap?.name || 'The person'
    const aspect = this.h3Aspect(r)
    for (const p of this.h3Shots(r)) {
      const t = r.takes[p.index]
      const s = this.shot(r, p.index)
      const lines = voiced ? shotLines(r.voice, s) : []
      // a take stays unless it failed, or its lips were drawn to another voice than the shot now has
      const needsVoice = lines.some((l) => l.swap)
      if (t && !['error', 'cancelled'].includes(t.status) && (!needsVoice || t.voiceKey === voiceKey)) continue
      const f = r.frames[p.index]
      const media = [{ kind: 'picture', file: f.first }, ...(p.h3.useLast ? [{ kind: 'picture', file: f.last }] : [])]
      let voiceLine = null
      let prompt = p.prompt
      if (needsVoice) {
        voiceLine = this.folder(id, 'voice', `shot_${pad3(p.index)}.wav`)
        fs.mkdirSync(path.dirname(voiceLine), { recursive: true })
        await this.edits.run(shotVoiceArgs({ stem: r.voice.stem, ...shotVoicePiece(s, p), out: voiceLine }))
        prompt = voicedPrompt(p.prompt, lines, p.character && p.character !== 'none' ? '{char}' : who)
      }
      const job = await this.studio.generatePreviews({ mode: 'frames', prompt, character: p.character || 'none', aspect, seconds: p.h3.seconds, previews: r.plan.swap ? 3 : 2, seed: Math.floor(Math.random() * 1e6), steps: 8, media, ...(voiceLine ? { voiceLine } : {}), projectName: `Rebuild · ${r.name} · shot ${p.index}` })
      r = this.get(id)
      r.takes[p.index] = { previewJob: job.id, status: job.status, previews: [], candidate: null, finishJob: null, final: null, error: null, ...(needsVoice ? { voiceKey, voiceLine } : {}) }
      r.status = 'rendering'
      this.write(r)
    }
    return this.get(id)
  }
  // The person's pick among a shot's previews (1, 2 or 3). Picking another after it was finished finishes that one.
  pick(id, index, candidate) {
    const r = this.get(id)
    const t = r.takes[Number(index)]
    if (!t) throw new Error(`Shot ${index} has no takes yet.`)
    const c = Number(candidate)
    if (!Number.isInteger(c) || c < 1 || c > 3) throw new Error('candidate is 1, 2 or 3.')
    if (t.previews.length && !t.previews.some((x) => x.candidate === c)) throw new Error(`Shot ${index} has previews ${t.previews.map((x) => x.candidate).join(', ')}.`)
    if (t.candidate !== c) Object.assign(t, { candidate: c, finishJob: null, final: null, status: t.previews.length ? 'finishing' : t.status })
    if (r.status === 'ready' && t.status === 'finishing') r.status = 'rendering'
    return this.write(r)
  }
  // Brings the takes up to date: a picked preview is finished at 1 MP once, a finished take is copied in. A lock
  // file keeps the window and the MCP server from finishing one preview twice.
  async refresh(id) {
    const lock = this.folder(id, '.refresh.lock')
    let fd
    try {
      fd = fs.openSync(lock, 'wx')
    } catch {
      if (Date.now() - fs.statSync(lock).mtimeMs < 60000) return this.get(id)
      fs.rmSync(lock, { force: true })
      fd = fs.openSync(lock, 'wx')
    }
    try {
      const r = this.get(id)
      if (!['rendering', 'ready'].includes(r.status)) return r
      for (const [index, t] of Object.entries(r.takes)) {
        if (t.final) continue
        if (!t.finishJob) {
          const p = await this.studio.refreshJob(t.previewJob)
          t.previews = (p.outputs || []).filter((o) => o.kind === 'preview').map((o) => ({ candidate: o.candidate, path: o.path || null }))
          if (p.status !== 'success') {
            Object.assign(t, { status: p.status, error: p.error || null })
            continue
          }
          if (!t.candidate) {
            t.status = 'pick'
            continue
          }
          t.finishJob = (await this.studio.finishCandidate({ jobId: t.previewJob, candidate: t.candidate, megapixels: 1, upscale2x: false, fps: 0, audio: 'pass' })).id
          t.status = 'finishing'
        } else {
          const j = await this.studio.refreshJob(t.finishJob)
          if (j.status === 'success') {
            const out = (j.outputs || []).find((o) => o.kind === 'final')
            t.final = out ? await this.studio.localCopy(out, this.folder(id, 'takes')) : null
            t.status = t.final ? 'done' : 'error'
            if (!t.final) t.error = 'The finish made no video.'
          } else Object.assign(t, { status: j.status === 'error' || j.status === 'cancelled' ? j.status : 'finishing', error: j.error || null })
        }
        this.onLog(`Shot ${index}: ${t.status}`)
      }
      const takes = this.h3Shots(r).map((p) => r.takes[p.index])
      if (r.status === 'rendering' && takes.every((t) => t && (t.final || DONE.includes(t.status)))) r.status = 'ready'
      return this.write(r)
    } finally {
      fs.closeSync(fd)
      fs.rmSync(lock, { force: true })
    }
  }

  // ---------- 6 the first cut ----------
  // Every shot as a piece exactly its slot long (24 fps, the edit's frame), on V1 at its own start time; the
  // original sound on A1 as a guide. V1's own sound is muted. Captions go on T1 only over shots whose picture is
  // new and clean (an H3 take from cleaned frames, the person's own clip): original footage and stills from it
  // already carry their writing, and a title over it would show every caption twice (seen on dual_role.mp4).
  async firstCut(id) {
    let r = this.get(id)
    if (!r.plan) throw new Error('Write and approve the plan first.')
    if (r.status === 'rendering') r = await this.refresh(id)
    const format = formatFor(r.source.width, r.source.height)
    const { width: W, height: H } = FORMATS[format]
    const cutDir = this.folder(id, 'cut')
    fs.mkdirSync(cutDir, { recursive: true })
    const sourceFile = r.source.file
    const placed = []
    const kept = []
    const missing = []
    const clean = new Set()
    const segs = []
    for (const s of r.shots) {
      const p = r.plan.shots.find((x) => x.index === s.index)
      const slot = s.duration
      const out = path.join(cutDir, `shot_${pad3(s.index)}.mp4`)
      const take = r.takes[s.index]?.final
      let args
      if (p.route === 'h3' && take && fs.existsSync(take)) {
        const info = await probe(this.edits.ffprobe, take)
        const L = p.h3
        const { speed } = L.trimTo ? { speed: 1 } : retime(info.duration || L.seconds, slot)
        args = ['-i', take, '-vf', segmentFilter({ trimTo: L.trimTo, speed, slot, width: W, height: H }), ...(info.hasAudio ? ['-af', segmentAudio({ trimTo: L.trimTo, speed, slot })] : ['-an'])]
        placed.push(s.index)
        clean.add(s.index)
      } else if (p.route === 'own' && p.file && fs.existsSync(p.file)) {
        const info = await probe(this.edits.ffprobe, p.file)
        const { speed } = retime(info.duration || slot, slot)
        args = ['-i', p.file, '-vf', segmentFilter({ speed, slot, width: W, height: H }), ...(info.hasAudio ? ['-af', segmentAudio({ speed, slot })] : ['-an'])]
        placed.push(s.index)
        clean.add(s.index)
      } else if (p.route === 'still') {
        const n = Math.max(1, Math.round(slot * 24))
        args = ['-loop', '1', '-i', s.first, '-vf', `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=decrease,pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,zoompan=z='1+0.03*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${n}:s=${W}x${H}:fps=24,format=yuv420p`, '-frames:v', String(n), '-an']
        placed.push(s.index)
      } else {
        if (p.route === 'h3' || p.route === 'own') missing.push(s.index)
        else kept.push(s.index)
        args = ['-ss', s.start.toFixed(3), '-t', (slot + 0.2).toFixed(3), '-i', sourceFile, '-vf', segmentFilter({ speed: 1, slot, width: W, height: H }), ...(r.source.hasAudio ? ['-af', segmentAudio({ speed: 1, slot })] : ['-an'])]
      }
      await this.edits.run(['-y', '-v', 'error', ...args, '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', out])
      segs.push({ s, file: out })
    }
    let guide = null
    const voiced = this.voiced(r)
    if (voiced) guide = r.voice.track
    else if (r.source.hasAudio) {
      guide = path.join(cutDir, 'guide.wav')
      await this.edits.run(['-y', '-v', 'error', '-i', sourceFile, '-vn', '-ac', '2', '-ar', '48000', guide])
    }
    const e = this.edits.create(`${r.name} · rebuild`)
    e.settings = { ...e.settings, format, fps: 24 }
    const media = {}
    const ops = []
    for (const { s, file } of segs) {
      const m = await this.edits.addMedia(file, { type: 'rebuild', rebuildId: id, shot: s.index })
      media[m.id] = m
      ops.push({ op: 'add_clip', media: m.id, track: 'V1', start: s.start, in: 0, out: r3(Math.min(s.duration, m.duration || s.duration)), muted: true })
    }
    if (guide) {
      const m = await this.edits.addMedia(guide, { type: 'rebuild', rebuildId: id, ...(voiced ? { voice: true } : { guide: true }) })
      media[m.id] = m
      ops.push({ op: 'add_clip', media: m.id, track: 'A1', start: 0, in: 0, out: r3(Math.min(r.source.duration, m.duration || r.source.duration)) })
    }
    ops.push(...captionsToTitles(r.shots.filter((s) => clean.has(s.index))))
    const res = applyOps({ ...e, media }, ops)
    Object.assign(e, { clips: res.clips, media: res.media, tracks: res.tracks, markers: res.markers })
    this.edits.write(e)
    const name = r.plan.swap?.name || r.voice?.people?.[0]?.name || r.voice?.people?.[0]?.voiceName
    const warnings = [voiced ? voiceNote(name, r.voice.mode) : GUIDE_WARNING]
    if (voiced) {
      const old = keptWithVoice(r)
      if (old.length) warnings.push(`Shot ${old.join(', ')} ${old.length === 1 ? 'isn’t' : 'aren’t'} remade, but ${old.length === 1 ? 'its' : 'their'} words are now in ${name || 'the new'}'s voice: render ${old.length === 1 ? 'it' : 'them'} with H3 so the face matches.`)
      const before = this.h3Shots(r).filter((p) => shotLines(r.voice, this.shot(r, p.index)).some((l) => l.swap) && r.takes[p.index]?.final && r.takes[p.index].voiceKey !== r.voice.madeAt).map((p) => p.index)
      if (before.length) warnings.push(`Shot ${before.join(', ')} ${before.length === 1 ? 'was' : 'were'} rendered before this voice, so the lips follow the old sound: make the shots again to redo ${before.length === 1 ? 'it' : 'them'}.`)
    }
    if (kept.length) warnings.push(`Shot ${kept.join(', ')} ${kept.length === 1 ? 'is' : 'are'} still the original footage.`)
    if (missing.length) warnings.push(`Shot ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} no new take yet, so the original footage stands in.`)
    r = this.get(id)
    r.editId = e.id
    r.status = 'editing'
    this.write(r)
    return { editId: e.id, format, placed, kept, missing, warnings }
  }

  // ---------- views ----------
  // The rebuild with each shot's route (or the suggested one) and, for H3 shots, how H3 makes it.
  view(r) {
    const planned = new Map((r.plan?.shots || []).map((p) => [p.index, p]))
    return {
      ...r,
      shots: r.shots.map((s) => {
        const p = planned.get(s.index)
        const suggested = s.reading ? defaultRoute(s.reading.kind) : null
        const route = p?.route || null
        return { ...s, route, suggested, ...((route || suggested) === 'h3' && { h3: h3Length(s.duration) }), frames: r.frames[s.index] || null, take: r.takes[s.index] || null }
      })
    }
  }
}
