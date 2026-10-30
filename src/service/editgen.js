// Making new footage from inside an edit. Each is an ordinary IV Studio job (a shot project, so it also shows
// in Shots and the Library), tracked on the edit as edit.gens until its result lands on the timeline:
//   extend  - carry a clip on past its end (Create's Continue a video, from the clip's last seconds)
//   bridge  - fill a gap, or a new shot between two touching clips (First / last frame: clip A's last frame to
//             clip B's first frame), three previews to pick from, then finished
//   retake  - redo a stretch of a clip: picture and sound, picture only or sound only (H3 Retake, as Sequences)
// A gen: { id, kind, status, name, track, at, length, ... jobs }. status: rendering -> (pick) -> finishing -> done,
// or error / cancelled. advance() moves every open gen on; the window and the MCP server both call it.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ASPECTS } from './plan.js'
import { RETAKE_MODES } from './sequence.js'
import { applyOps, clipEnd, tracksOf } from './timeline.js'

export const GEN_KINDS = ['extend', 'bridge', 'retake']
export const EXTEND_SECONDS = [5, 10, 15]
const OPEN = ['rendering', 'pick', 'finishing']
const OVERLAP = 22 // Continue's overlap frames (the default on Create)
const FPS = 24
const round = (x) => Math.round(x * 1000) / 1000

// The aspect of IV Studio's list closest to a width x height.
export function nearestAspect(width, height) {
  if (!width || !height) return '16:9'
  const r = width / height
  return Object.keys(ASPECTS).reduce((best, k) => {
    const [a, b] = k.split(':').map(Number)
    const [x, y] = best.split(':').map(Number)
    return Math.abs(Math.log(a / b / r)) < Math.abs(Math.log(x / y / r)) ? k : best
  }, '16:9')
}

// The video a job made, best first: the finished file, then what came before the upscale.
function videoOut(job) {
  const outs = job?.outputs || []
  for (const k of ['final', 'master', 'continued_before_dlss', 'before_dlss']) {
    const o = outs.find((x) => x.kind === k)
    if (o) return o
  }
  return outs.find((x) => /\.(mp4|webm|mov)$/i.test(x.filename || '')) || null
}

// Where a gen lands now: it follows the clip it was made from (anchor), so footage that lands first and pushes
// clips along doesn't send it to the wrong place. Without its clip it keeps the time it was started at.
export function where(e, g) {
  const a = g.anchor && e.clips.find((x) => x.id === g.anchor)
  if (!a) return { track: g.track, at: g.at }
  return { track: a.track, at: round((g.pos === 'end' ? clipEnd(a) : a.start) + (g.rel || 0)) }
}

export class EditGen {
  // studio: () => the current Studio (the app makes a new one when it switches to the cloud). localCopy(file):
  // the output as a file on this PC (cloud renders download). onChange(editId): an edit's gens changed.
  constructor({ edits, studio, localCopy, onChange = () => {} }) {
    this.edits = edits
    this.studio = studio
    this.localCopy = localCopy
    this.onChange = onChange
    this.busy = new Set() // edit ids being advanced, so two loops never place the same gen twice
    this.live = new Map() // gen id -> { progress, queuePosition }, kept in memory (not written to the edit)
  }

  // An edit's gens as the window shows them: what's saved plus the live step progress.
  view(editId) {
    const e = this.edits.get(editId)
    return (e.gens || []).map((g) => ({ ...g, ...(OPEN.includes(g.status) ? { ...this.live.get(g.id), ...where(e, g) } : {}) }))
  }

  dir = () => path.join(this.edits.dir, 'gen')
  ffmpeg = (args) => this.edits.run(['-hide_banner', '-loglevel', 'error', '-y', ...args])

  // ---------- making the inputs ----------
  // A stretch of a media file as a 24 fps H.264 + AAC file H3 can read; silence is added when it has no sound.
  // h3Size: scaled to H3's own sizes (sides on a 32-pixel grid, about that many megapixels at most), which
  // H3 Retake needs; Continue resizes by itself.
  async cut(m, from, to, name, { h3Size = 0 } = {}) {
    fs.mkdirSync(this.dir(), { recursive: true })
    const out = path.join(this.dir(), `${name}.mp4`)
    const audio = m.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    let size = []
    if (h3Size && m.width && m.height) {
      const s = Math.min(1, Math.sqrt((h3Size * 1024 * 1024) / (m.width * m.height)))
      const grid = (x) => Math.max(256, Math.round((x * s) / 32) * 32)
      size = ['-vf', `scale=${grid(m.width)}:${grid(m.height)}:flags=lanczos`]
    }
    await this.ffmpeg(['-ss', String(round(from)), '-to', String(round(to)), '-i', m.path, ...audio, '-map', '0:v:0', '-map', m.hasAudio ? '0:a:0' : '1:a:0', ...size, '-r', String(FPS), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', out])
    const info = await this.edits.probe(out)
    return { file: out, ...info }
  }
  // One frame of a media file (or the picture itself) as a PNG.
  async still(m, t, name) {
    if (m.kind === 'image') return { file: m.path, width: m.width, height: m.height }
    fs.mkdirSync(this.dir(), { recursive: true })
    const out = path.join(this.dir(), `${name}.png`)
    await this.ffmpeg(['-ss', String(Math.max(0, round(t))), '-i', m.path, '-frames:v', '1', out])
    return { file: out, width: m.width, height: m.height }
  }

  // What IV Studio knows about the render a media file came from: its shot's request (prompt, character, LoRAs,
  // aspect), so new footage for it starts the same way.
  origin(m) {
    const base = path.basename(m.path || '').toLowerCase()
    if (!base) return null
    const dir = path.join(this.studio().dataDir, 'jobs')
    let files = []
    try {
      files = fs.readdirSync(dir)
    } catch {
      return null
    }
    for (const f of files) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
        if ((j.outputs || []).some((o) => String(o.filename || '').toLowerCase() === base)) {
          const r = j.plan?.request || j.previewPlan?.request
          if (r) return { projectId: j.projectId, prompt: r.prompt, character: r.character, extraLoras: r.extraLoras || [], aspect: r.aspect }
        }
      } catch {}
    }
    return null
  }

  // For the window's dialog: what a gen of this kind would start from (the clip's shot, the frames it would use).
  async prepare(editId, { kind, clip, next }) {
    const e = this.edits.get(editId)
    const c = e.clips.find((x) => x.id === clip)
    const m = c && e.media[c.media]
    if (!m) throw new Error('Pick a video clip.')
    const o = this.origin(m)
    const out = { origin: o, aspect: o?.aspect || nearestAspect(m.width, m.height) }
    if (kind === 'bridge') {
      const b = next && e.clips.find((x) => x.id === next)
      const mb = b && e.media[b.media]
      out.first = (await this.still(m, c.out - 1 / FPS, `${c.id}_last`)).file
      if (mb) out.last = (await this.still(mb, b.in, `${b.id}_first`)).file
    }
    return out
  }

  // ---------- starting ----------
  // spec: { kind, clip, prompt, character, extraLoras, seconds, next (bridge: the clip after), gap: {track, from, to}
  // (bridge: a gap instead of a clip), from, to (retake: timeline seconds inside the clip), mode (retake) }
  async start(editId, spec) {
    const e = this.edits.get(editId)
    const studio = this.studio()
    if (!GEN_KINDS.includes(spec.kind)) throw new Error(`kind must be ${GEN_KINDS.join(', ')}.`)
    if (!spec.prompt?.trim()) throw new Error('Describe what should happen.')
    const id = randomUUID().slice(0, 8)
    const character = spec.character || 'none'
    const extraLoras = spec.extraLoras || []
    const seed = spec.seed ?? Math.floor(Math.random() * 1e9)
    let gen

    if (spec.kind === 'extend') {
      const c = this.clip(e, spec.clip)
      const m = this.video(e, c)
      const seconds = Number(spec.seconds) || 5
      if (!EXTEND_SECONDS.includes(seconds)) throw new Error(`An extension is ${EXTEND_SECONDS.join(', ')} seconds.`)
      // the last few seconds of what the clip shows: Continue carries on from its final frames
      const src = await this.cut(m, Math.max(c.in, c.out - 4), c.out, `${id}_source`)
      const job = await studio.generatePreviews({
        projectName: `${e.name}: extend`,
        mode: 'continue',
        prompt: spec.prompt,
        character,
        extraLoras,
        // Continue counts its overlap inside the length, so ask for that much more (H3 stops at 15 s)
        seconds: Math.min(15, round(seconds + (OVERLAP + 1) / FPS)),
        overlapFrames: OVERLAP,
        aspect: spec.aspect || nearestAspect(m.width, m.height),
        megapixels: 1,
        seed,
        media: [{ kind: 'video', file: src.file, duration: src.duration, width: src.width, height: src.height, hasAudio: true }]
      })
      // Continue's video replays the source stretch first; the new footage starts where it ends
      gen = { kind: 'extend', track: c.track, at: clipEnd(c), anchor: c.id, pos: 'end', rel: 0, length: seconds, clip: c.id, insert: true, trimStart: src.duration, previewsJob: job.id }
    } else if (spec.kind === 'bridge') {
      let first, last, track, at, length, insert, anchor
      if (spec.gap) {
        // a gap on a track: from the clip before it to the clip after it
        const { track: t, from, to } = spec.gap
        const before = e.clips.filter((x) => x.track === t && clipEnd(x) <= from + 1e-3).sort((a, b) => clipEnd(b) - clipEnd(a))[0]
        const after = e.clips.filter((x) => x.track === t && x.start >= to - 1e-3).sort((a, b) => a.start - b.start)[0]
        if (!before) throw new Error('A gap needs a clip before it.')
        first = await this.still(this.video(e, before), before.out - 1 / FPS, `${id}_first`)
        if (after) last = await this.still(this.video(e, after), after.in, `${id}_last`)
        track = t
        at = from
        anchor = before.id
        length = round(to - from)
        insert = false
        if (length > 15) throw new Error('A gap is filled up to 15 seconds at a time. Shorten it, or fill part of it.')
        if (length < 1 / FPS) throw new Error('There is no gap there.')
      } else {
        const a = this.clip(e, spec.clip)
        const b = spec.next ? this.clip(e, spec.next) : null
        first = await this.still(this.video(e, a), a.out - 1 / FPS, `${id}_first`)
        if (b) last = await this.still(this.video(e, b), b.in, `${id}_last`)
        track = a.track
        at = clipEnd(a)
        anchor = a.id
        length = Number(spec.seconds) || 3
        insert = true
      }
      const seconds = Math.min(15, Math.max(1, length))
      const m0 = first
      const job = await studio.generatePreviews({
        projectName: `${e.name}: ${spec.gap ? 'fill' : 'bridge'}`,
        mode: 'frames',
        prompt: spec.prompt,
        character,
        extraLoras,
        seconds,
        aspect: spec.aspect || nearestAspect(m0.width, m0.height),
        megapixels: 0.4,
        previews: 3,
        seed,
        media: [{ kind: 'picture', file: first.file, width: first.width, height: first.height }, ...(last ? [{ kind: 'picture', file: last.file, width: last.width, height: last.height }] : [])]
      })
      // the first frame repeats the clip before it, so it is left out
      gen = { kind: 'bridge', track, at, anchor, pos: 'end', rel: 0, length, insert, gap: !!spec.gap, trimStart: 1 / FPS, previewsJob: job.id }
    } else {
      const c = this.clip(e, spec.clip)
      const m = this.video(e, c)
      const mode = spec.mode || 'both'
      if (!RETAKE_MODES[mode]) throw new Error(`mode must be ${Object.keys(RETAKE_MODES).join(', ')}.`)
      const from = Math.max(c.start, Number(spec.from))
      const to = Math.min(clipEnd(c), Number(spec.to))
      if (!(to - from >= 0.5)) throw new Error('Retake at least half a second, inside the clip.')
      // a short stretch of the source around it, so H3 re-encodes seconds, not the whole file
      const srcFrom = Math.max(0, c.in + (from - c.start) - 1.5)
      const srcTo = Math.min(m.duration || c.out, c.in + (to - c.start) + 1.5)
      const src = await this.cut(m, srcFrom, srcTo, `${id}_source`, { h3Size: 1 })
      const start = round(c.in + (from - c.start) - srcFrom)
      const end = round(c.in + (to - c.start) - srcFrom)
      const job = await studio.retakeFile({ name: `${e.name}: retake`, sourcePath: src.file, start, end, mode, prompt: spec.prompt, character, seed })
      gen = { kind: 'retake', track: c.track, at: round(from), anchor: c.id, pos: 'start', rel: round(from - c.start), length: round(to - from), clip: c.id, insert: false, mode, trimStart: start, finishJob: job.id }
    }

    const who = studio.characters().find((x) => x.id === character)?.name.split(' ')[0] || 'the character'
    const words = spec.prompt.replaceAll('{char}', who).replace(/^(live-action|cinematic)[,.]?\s*/i, '')
    gen = { id, ...gen, status: 'rendering', prompt: spec.prompt, character, name: spec.name || `${{ extend: 'Extend', bridge: spec.gap ? 'Fill' : 'Bridge', retake: 'Retake' }[spec.kind]}: ${words.slice(0, 40)}`, createdAt: new Date().toISOString() }
    this.saveGens(editId, (gens) => [...gens, gen])
    return gen
  }

  clip(e, id) {
    const c = e.clips.find((x) => x.id === id)
    if (!c) throw new Error(`No clip ${id}. get_edit lists the clip ids.`)
    if (tracksOf(e).find((t) => t.id === c.track)?.locked) throw new Error(`Track ${c.track} is locked. Unlock it first.`)
    return c
  }
  video(e, c) {
    const m = e.media[c.media]
    if (!m || !['video', 'image'].includes(m.kind)) throw new Error('That clip has no video.')
    return m
  }

  // ---------- moving on ----------
  saveGens(editId, fn) {
    const e = this.edits.get(editId)
    e.gens = fn(e.gens || [])
    this.edits.write(e)
    this.onChange(editId)
    return e
  }
  open(e) {
    return (e.gens || []).some((g) => OPEN.includes(g.status))
  }

  // Checks every open gen's job and moves it on: previews done -> finish (extend) or ask to pick (bridge);
  // finish done -> the clip goes on the timeline. Returns the edit's gens.
  async advance(editId) {
    if (this.busy.has(editId)) return this.view(editId)
    // the app and an agent's MCP server can both be advancing: a lock file lets only one at a time
    const lock = path.join(this.dir(), `${editId}.lock`)
    fs.mkdirSync(this.dir(), { recursive: true })
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > 120000) fs.rmSync(lock, { force: true })
    } catch {}
    let fd
    try {
      fd = fs.openSync(lock, 'wx')
    } catch {
      return this.view(editId)
    }
    this.busy.add(editId)
    try {
      const studio = this.studio()
      for (const g of this.edits.get(editId).gens || []) {
        if (!OPEN.includes(g.status) || g.status === 'pick') continue
        try {
          if (g.status === 'rendering' && g.previewsJob) {
            const j = await studio.refreshJob(g.previewsJob)
            if (j.status === 'error' || j.status === 'cancelled') this.update(editId, g.id, { status: j.status === 'cancelled' ? 'cancelled' : 'error', error: j.error || null })
            else if (j.status === 'success') {
              if (g.kind === 'extend') {
                const f = await studio.finishCandidate({ jobId: j.id, candidate: 1, upscale2x: (await studio.capabilities()).upscale2x, fps: 0, audio: 'pass' })
                this.update(editId, g.id, { status: 'finishing', finishJob: f.id })
              } else {
                const candidates = j.outputs.filter((o) => o.kind === 'preview').map((o) => ({ n: o.candidate, url: o.url, path: o.path, seed: o.seed }))
                this.update(editId, g.id, { status: 'pick', candidates })
              }
            } else this.live.set(g.id, { jobStatus: j.status, progress: j.progress || null, queuePosition: j.queuePosition || null })
          } else if (g.status === 'rendering' || g.status === 'finishing') {
            const j = await studio.refreshJob(g.finishJob)
            if (j.status === 'error' || j.status === 'cancelled') this.update(editId, g.id, { status: j.status === 'cancelled' ? 'cancelled' : 'error', error: j.error || null })
            else if (j.status === 'success') await this.place(editId, g, j)
            else this.live.set(g.id, { jobStatus: j.status, progress: j.progress || null, queuePosition: j.queuePosition || null })
          }
        } catch (err) {
          this.update(editId, g.id, { status: 'error', error: err.message })
        }
      }
      return this.view(editId)
    } finally {
      this.busy.delete(editId)
      fs.closeSync(fd)
      fs.rmSync(lock, { force: true })
    }
  }

  update(editId, genId, patch) {
    const e = this.edits.get(editId)
    e.gens = (e.gens || []).map((g) => (g.id === genId ? { ...g, ...patch } : g))
    this.edits.write(e)
    this.onChange(editId)
  }

  // The finished video goes on the timeline where the placeholder was: inserted (extend, bridge between clips)
  // or over what's there (fill a gap, retake).
  async place(editId, g, job) {
    const out = videoOut(job)
    if (!out) throw new Error('The render finished without a video.')
    const file = await this.localCopy(out)
    const m = await this.edits.addMedia(file, { type: 'iv', label: g.name, gen: g.kind })
    const e = this.edits.get(editId)
    if (!(e.gens || []).some((x) => x.id === g.id && OPEN.includes(x.status))) return
    const inn = Math.min(g.trimStart || 0, Math.max(0, (m.duration || 0) - 1 / FPS))
    const out2 = Math.min(m.duration || inn + g.length, inn + g.length)
    const { track, at } = where(e, g)
    const ops = [{ op: g.insert ? 'insert_clip' : 'overwrite_clip', media: m.id, track, at, in: round(inn), out: round(out2) }]
    const r = applyOps({ ...e, media: { ...e.media, [m.id]: m } }, ops)
    Object.assign(e, { clips: r.clips, media: r.media, tracks: r.tracks, markers: r.markers })
    e.gens = e.gens.map((x) => (x.id === g.id ? { ...x, status: 'done', media: m.id, placedClip: r.results[0]?.clip || null, doneAt: new Date().toISOString() } : x))
    this.edits.write(e)
    this.onChange(editId)
  }

  // Bridge: the person picked preview n; it is finished at 2 MP and placed.
  async pick(editId, genId, n) {
    const g = (this.edits.get(editId).gens || []).find((x) => x.id === genId)
    if (!g || g.status !== 'pick') throw new Error('That generation is not waiting for a pick.')
    const f = await this.studio().finishCandidate({ jobId: g.previewsJob, candidate: Number(n), megapixels: 2, upscale2x: false, fps: 0, audio: 'pass' })
    this.update(editId, genId, { status: 'finishing', finishJob: f.id, picked: Number(n) })
    return f
  }

  // Stops a gen: its job is cancelled (if IV Studio's and still running) and the placeholder goes away.
  async cancel(editId, genId) {
    const g = (this.edits.get(editId).gens || []).find((x) => x.id === genId)
    if (!g) throw new Error('No such generation.')
    if (OPEN.includes(g.status)) {
      for (const jid of [g.finishJob, g.previewsJob].filter(Boolean)) {
        try {
          await this.studio().cancelJob(jid)
        } catch {}
      }
    }
    this.saveGens(editId, (gens) => gens.filter((x) => x.id !== genId))
    return true
  }

  // Every edit with an open gen (the app checks them on a timer).
  openEdits() {
    return this.edits.list().filter((x) => {
      try {
        return this.open(this.edits.get(x.id))
      } catch {
        return false
      }
    })
  }
}
