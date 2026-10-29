// Voices: a voice for each character, and lines spoken in it for H3 to lip-sync.
// IV Studio keeps every voice itself, as a short reference recording plus the words in it (the data
// folder's voices/<id>/), so a voice belongs to the person, not to an engine. The speaking is done by
// VoiceStudio, a separate free app that runs on this PC (http://127.0.0.1:3900), with VoxCPM2 or
// CosyVoice 3. Both are Apache-2.0. VoiceStudio's default, OmniVoice, has non-commercial weights, so IV
// Studio never asks for it.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const VOICE_ENGINES = [
  { id: 'voxcpm2', label: 'VoxCPM2', design: true, maxRef: 30, note: 'Designs voices from a description and clones them. Apache-2.0.' },
  { id: 'cosyvoice', label: 'CosyVoice 3', design: false, maxRef: 20, note: 'Clones only; a second opinion on the same voice. Apache-2.0.' }
]
export const VOICESTUDIO = { url: 'https://github.com/debpalash/VoiceStudio/releases', name: 'VoiceStudio' }
// A reference longer than this only slows every line down.
const REF_SECONDS = 20
// After this long without a line, VoiceStudio is asked to let go of the GPU (a render on this PC asks at
// once). Loading VoxCPM2 again takes about 40 s, so not too eagerly.
const IDLE_RELEASE_MS = 10 * 60 * 1000

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const now = () => new Date().toISOString()
const hash = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)
const WAV_SECONDS = (buf) => {
  // RIFF header: byte rate at 28, the data chunk's size follows the "data" tag
  const rate = buf.readUInt32LE(28)
  const at = buf.indexOf('data', 12)
  return rate && at > 0 ? +(buf.readUInt32LE(at + 4) / rate).toFixed(2) : null
}

export class Voices {
  constructor({ dataDir, url = 'http://127.0.0.1:3900', ffmpeg }) {
    this.dir = path.join(dataDir, 'voices')
    this.url = url.replace(/\/$/, '')
    this.ffmpeg = ffmpeg
    this.idle = null
  }

  // ---------- the engine ----------
  async api(route, { method = 'GET', json, form, timeout = 300000 } = {}) {
    let res
    try {
      res = await fetch(`${this.url}${route}`, {
        method,
        headers: json ? { 'Content-Type': 'application/json' } : undefined,
        body: json ? JSON.stringify(json) : form,
        signal: AbortSignal.timeout(timeout)
      })
    } catch {
      throw new Error(`VoiceStudio isn't running at ${this.url}. Start it, then try again.`)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text
      try {
        detail = JSON.parse(text).detail || text
      } catch {}
      throw new Error(`VoiceStudio: ${typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)}`)
    }
    return res
  }

  // Whether VoiceStudio answers, and which of the two Apache engines it has ready.
  async status() {
    try {
      const engines = await (await this.api('/engines/tts', { timeout: 5000 })).json()
      const by = Object.fromEntries((engines.backends || []).map((b) => [b.id, b]))
      return {
        running: true,
        url: this.url,
        engines: VOICE_ENGINES.map((e) => ({ ...e, available: !!by[e.id]?.available, reason: by[e.id]?.available ? null : by[e.id]?.reason || 'Not installed in VoiceStudio.' })),
        get: VOICESTUDIO
      }
    } catch (err) {
      return { running: false, url: this.url, error: err.message, engines: VOICE_ENGINES.map((e) => ({ ...e, available: false })), get: VOICESTUDIO }
    }
  }

  // Unloads IV Studio's engines from VoiceStudio so the GPU's memory goes back to ComfyUI.
  async release() {
    clearTimeout(this.idle)
    try {
      const loaded = await (await this.api('/model/loaded', { timeout: 5000 })).json()
      for (const m of loaded.models || []) if (VOICE_ENGINES.some((e) => e.id === m.engine_id) && m.unloadable) await this.api(`/model/unload/${encodeURIComponent(m.id)}`, { method: 'POST', timeout: 30000 }).catch(() => {})
    } catch {}
  }
  releaseSoon() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.release(), IDLE_RELEASE_MS)
    this.idle.unref?.()
  }

  async transcribe(file) {
    const form = new FormData()
    form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file))
    form.append('model', 'whisper-1')
    const out = await (await this.api('/v1/audio/transcriptions', { method: 'POST', form })).json()
    return String(out.text || '').trim()
  }

  // ---------- the library ----------
  folder = (id) => path.join(this.dir, id)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((id) => readJson(path.join(this.dir, id, 'voice.json'), null))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  get(id) {
    const v = readJson(path.join(this.folder(id), 'voice.json'), null)
    if (!v) throw new Error(`No voice ${id}.`)
    return v
  }
  write(v) {
    writeJson(path.join(this.folder(v.id), 'voice.json'), v)
    return v
  }
  update(id, patch) {
    const v = this.get(id)
    for (const k of ['name', 'text', 'description', 'engine', 'seed']) if (patch[k] !== undefined) v[k] = patch[k]
    return this.write(v)
  }
  delete(id) {
    this.get(id)
    fs.rmSync(this.folder(id), { recursive: true, force: true })
    writeJson(this.linesFile(), this.allLines().filter((l) => l.voiceId !== id))
    return { deleted: id }
  }

  // Up to `count` candidate voices from a written description (VoxCPM2 voice design), each saying `text`.
  // They wait in voices/_drafts until one is kept with create().
  async design({ description, text, seed = 1, count = 3 }) {
    if (!String(description || '').trim()) throw new Error('Describe the voice first: age, accent, pitch, manner.')
    const say = String(text || '').trim() || "Hi. So this is what I sound like when I'm just talking, nothing rehearsed. Give it a listen and tell me what you think."
    const dir = path.join(this.dir, '_drafts')
    fs.mkdirSync(dir, { recursive: true })
    const out = []
    for (let i = 0; i < Math.min(Math.max(1, count), 4); i++) {
      const s = Number(seed) + i * 7
      const file = path.join(dir, `${hash(description, say, s)}.wav`)
      if (!fs.existsSync(file)) {
        const res = await this.api('/v1/audio/speech', { method: 'POST', json: { model: 'voxcpm2', input: say, description, seed: s, response_format: 'wav' } })
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      }
      out.push({ file, seed: s, text: say, description, duration: WAV_SECONDS(fs.readFileSync(file)) })
    }
    this.releaseSoon()
    return out
  }

  // A voice from a recording: a design candidate, or someone's own recording (clone). The recording is cut
  // to its first 20 seconds, mono, as the voice's reference. Words: given, or read from it by Whisper.
  async create({ name, file, text = '', description = '', seed = null, engine = 'voxcpm2', kind = 'clone', consent = false }) {
    if (!name?.trim()) throw new Error('Give the voice a name.')
    if (!file || !fs.existsSync(file)) throw new Error('Pick the recording first.')
    if (kind === 'clone' && !consent) throw new Error("Only clone your own voice, an invented one, or someone who agreed to it: tick the box to confirm.")
    if (!VOICE_ENGINES.some((e) => e.id === engine)) throw new Error(`Unknown voice engine ${engine}.`)
    const id = randomUUID().slice(0, 8)
    const ref = path.join(this.folder(id), 'reference.wav')
    fs.mkdirSync(path.dirname(ref), { recursive: true })
    await this.convert(file, ref)
    let words = String(text || '').trim()
    if (!words) words = await this.transcribe(ref).catch(() => '')
    return this.write({ id, name: name.trim(), kind, engine, seed, description, text: words, reference: ref, source: file, duration: WAV_SECONDS(fs.readFileSync(ref)), createdAt: now() })
  }

  convert(from, to) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, ['-y', '-v', 'error', '-i', from, '-t', String(REF_SECONDS), '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', to], { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(to) : reject(new Error(`Couldn't read that recording. ${err.trim().split('\n').pop() || ''}`))))
    })
  }

  // ---------- lines ----------
  linesFile = () => path.join(this.dir, 'lines.json')
  allLines() {
    return readJson(this.linesFile(), [])
  }
  lines(voiceId = null) {
    return this.allLines().filter((l) => !voiceId || l.voiceId === voiceId)
  }
  deleteLine(id) {
    const all = this.allLines()
    const line = all.find((l) => l.id === id)
    if (!line) throw new Error(`No line ${id}.`)
    writeJson(this.linesFile(), all.filter((l) => l.id !== id))
    if (!all.some((l) => l.id !== id && l.file === line.file)) fs.rmSync(line.file, { force: true })
    return { deleted: id }
  }

  // `text` said in a voice: a WAV in voices/lines, kept in the history. The same words, voice, engine and
  // seed give back the same file without asking the engine again.
  async speak({ voiceId, text, seed = null, engine = null }) {
    const say = String(text || '').trim()
    if (!say) throw new Error('Type the line first.')
    const v = this.get(voiceId)
    const eng = engine || v.engine || 'voxcpm2'
    const s = seed ?? v.seed ?? 41
    if (!v.text) this.update(v.id, { text: (v.text = await this.transcribe(v.reference)) })
    const file = path.join(this.dir, 'lines', `${v.id}_${hash(say, eng, s, v.text)}.wav`)
    if (!fs.existsSync(file)) {
      const form = new FormData()
      form.append('text', say)
      form.append('ref_audio', new Blob([fs.readFileSync(v.reference)]), 'reference.wav')
      form.append('ref_text', v.text)
      form.append('engine', eng)
      form.append('seed', String(s))
      form.append('effect_preset', 'raw')
      const res = await this.api('/generate', { method: 'POST', form })
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    }
    this.releaseSoon()
    const line = { id: randomUUID().slice(0, 8), voiceId: v.id, voice: v.name, text: say, engine: eng, seed: s, file, duration: WAV_SECONDS(fs.readFileSync(file)), createdAt: now() }
    writeJson(this.linesFile(), [line, ...this.allLines()].slice(0, 500))
    return line
  }
}
