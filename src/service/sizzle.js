// Website sizzle: a web address in, a short promo film out. IV Studio captures the site (sitecapture.js), an
// agent writes the storyboard from what's actually on it, the person approves it, and IV Studio makes the
// pieces on this PC: H3 shots (one preview each, finished at 1 MP), Z-Image pictures, a MiniMax or
// ACE-Step track and, optionally, a voice-over. Then it hands everything to Shinobi with a brief, where the
// agent cuts the film: the site's own screens, colours and fonts, typography and motion, on the beat.
//   sizzle/<id>/sizzle.json  the project; site/ the capture
// Nothing renders before the storyboard is approved, and the brief tells the agent to use only claims the
// site itself makes.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { captureSite } from './sitecapture.js'

export const SIZZLE_FORMATS = { '16:9': { width: 1920, height: 1088 }, '9:16': { width: 1088, height: 1920 }, '1:1': { width: 1440, height: 1440 } }
export const SCENE_KINDS = ['h3', 'image', 'screen', 'title']
const H3_SECONDS = [3, 4, 5, 6, 7, 8, 10]
const DONE = ['success', 'error', 'cancelled']

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()
const slug = (s) => String(s || 'sizzle').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'sizzle'

export class Sizzles {
  constructor({ dataDir, studio, music, voices, trainings, shinobi, onLog }) {
    this.dir = path.join(dataDir, 'sizzle')
    Object.assign(this, { studio, music, voices, trainings, shinobi })
    this.onLog = onLog || (() => {})
  }

  file = (id) => path.join(this.dir, id, 'sizzle.json')
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((id) => readJson(this.file(id), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({ id: s.id, name: s.name, url: s.url, status: s.status, scenes: s.plan?.scenes.length || 0, cover: s.site?.captures.find((c) => c.name === 'hero')?.file || null, final: this.finalOf(s), updatedAt: s.updatedAt }))
  }
  get(id) {
    const s = readJson(this.file(id), null)
    if (!s) throw new Error(`No sizzle ${id}`)
    return s
  }
  write(s) {
    s.updatedAt = now()
    fs.mkdirSync(path.dirname(this.file(s.id)), { recursive: true })
    fs.writeFileSync(`${this.file(s.id)}.tmp`, JSON.stringify(s, null, 2))
    fs.renameSync(`${this.file(s.id)}.tmp`, this.file(s.id))
    return s
  }
  remove(id) {
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true })
    return true
  }

  // ---------- 1 capture ----------
  async create({ url, name, format = '16:9' }) {
    if (!SIZZLE_FORMATS[format]) throw new Error(`Format is ${Object.keys(SIZZLE_FORMATS).join(', ')}.`)
    const id = randomUUID().slice(0, 8)
    const site = await captureSite({ url, browser: this.shinobi.browser(), outDir: path.join(this.dir, id, 'site'), onLog: this.onLog })
    const host = new URL(site.url).hostname.replace(/^www\./, '')
    return this.write({ id, name: String(name || '').trim() || site.siteName || host, url: site.url, format, status: 'planning', createdAt: now(), site, plan: null, approvedAt: null, assets: {}, shinobi: null })
  }

  // ---------- 2 storyboard ----------
  // plan: { seconds, music: {engine, caption, lyrics?, instrumental?, seconds}, voiceover?: {voiceId, lines[]},
  //         scenes: [{ id?, kind: h3|image|screen|title, seconds, prompt?, character?, capture?, text?, note? }] }
  savePlan(id, plan) {
    const s = this.get(id)
    if (s.status === 'rendering') throw new Error('The pieces are being made from the approved storyboard. Wait for them, or start a new sizzle.')
    const captures = new Set(s.site.captures.map((c) => c.name).concat(s.site.images.map((_, k) => `image-${k + 1}`)))
    const scenes = (plan?.scenes || []).map((sc, k) => {
      const kind = sc.kind
      const where = `Scene ${k + 1}`
      if (!SCENE_KINDS.includes(kind)) throw new Error(`${where}: kind is ${SCENE_KINDS.join(', ')}.`)
      const seconds = Number(sc.seconds)
      if (!(seconds >= 0.5 && seconds <= 15)) throw new Error(`${where}: seconds runs from 0.5 to 15.`)
      if ((kind === 'h3' || kind === 'image') && !String(sc.prompt || '').trim()) throw new Error(`${where}: an ${kind} scene needs a prompt.`)
      if (kind === 'h3' && !H3_SECONDS.includes(Math.round(seconds))) throw new Error(`${where}: H3 shots are ${H3_SECONDS.join(', ')} seconds.`)
      if (kind === 'screen' && !captures.has(sc.capture)) throw new Error(`${where}: capture is one of ${[...captures].join(', ')}.`)
      if (kind === 'title' && !String(sc.text || '').trim()) throw new Error(`${where}: a title scene needs its text.`)
      return { id: sc.id || `s${k + 1}`, kind, seconds: kind === 'h3' ? Math.round(seconds) : seconds, prompt: sc.prompt || null, character: sc.character || 'none', capture: sc.capture || null, text: sc.text || null, note: sc.note || null }
    })
    if (scenes.length < 2) throw new Error('A sizzle needs at least two scenes.')
    if (new Set(scenes.map((x) => x.id)).size !== scenes.length) throw new Error('Scene ids must be different.')
    const m = plan.music
    if (!m?.caption) throw new Error('Describe the music (music.caption): genre, mood, instruments, tempo.')
    const vo = plan.voiceover?.lines?.length ? { voiceId: plan.voiceover.voiceId, lines: plan.voiceover.lines.map(String) } : null
    if (vo && !vo.voiceId) throw new Error('A voice-over needs voiceover.voiceId (list_voices).')
    const total = scenes.reduce((t, x) => t + x.seconds, 0)
    s.plan = { seconds: Math.round(total * 10) / 10, music: { engine: m.engine === 'ace' ? 'ace' : 'minimax', caption: m.caption, lyrics: m.lyrics || '', instrumental: m.instrumental !== false && !m.lyrics, seconds: Math.max(10, Math.min(180, Math.ceil(m.seconds || total + 2))) }, voiceover: vo, scenes, notes: plan.notes || '' }
    s.approvedAt = null
    s.status = 'planning'
    return this.write(s)
  }
  approve(id) {
    const s = this.get(id)
    if (!s.plan) throw new Error('Write the storyboard first.')
    s.approvedAt = now()
    s.status = 'approved'
    return this.write(s)
  }

  // ---------- 3 make the pieces ----------
  async makeAssets(id) {
    let s = this.get(id)
    if (!s.approvedAt) throw new Error('The storyboard needs the person\'s OK first (approve it on the Sizzle page, or approve_sizzle_plan once they say yes).')
    const f = SIZZLE_FORMATS[s.format]
    const tag = `${slug(s.name)}_${s.id}`
    const assets = { ...s.assets }
    // voice-over first: the voice engine shares the GPU with ComfyUI, and renders stop it
    if (s.plan.voiceover && !assets.voiceover) {
      this.onLog('Speaking the voice-over…')
      const lines = []
      for (const text of s.plan.voiceover.lines) lines.push(await this.voices.speak({ voiceId: s.plan.voiceover.voiceId, text }))
      assets.voiceover = { status: 'success', lines: lines.map((l) => ({ text: l.text, file: l.file, duration: l.duration })) }
      await this.voices.release?.()
    }
    // pictures, then music, then H3: one model family after another
    const stills = s.plan.scenes.filter((x) => x.kind === 'image' && !assets[x.id])
    if (stills.length) {
      const models = { ...(await this.trainings.stillModels()), lora: null }
      for (const sc of stills) {
        const seed = Math.floor(Math.random() * 2 ** 31)
        const graph = this.trainings.stillGraph(models, { prompt: sc.prompt, seed, width: f.width, height: f.height, prefix: `IV Studio/sizzle/${tag}/${sc.id}` })
        const job = await this.studio.submitGraph({ kind: 'still', graph, plan: { images: true, request: { prompt: sc.prompt, seed } }, name: `${tag}_${sc.id}` })
        assets[sc.id] = { kind: 'image', jobId: job.id, status: job.status }
      }
    }
    if (!assets.music) {
      const m = s.plan.music
      const song = await this.music.create({ engine: m.engine, name: `${s.name} sizzle`, caption: m.caption, lyrics: m.lyrics, instrumental: m.instrumental, seconds: m.seconds })
      assets.music = { songId: song.id, status: song.status }
    }
    for (const sc of s.plan.scenes.filter((x) => x.kind === 'h3' && !assets[x.id])) {
      const job = await this.studio.generatePreviews({ mode: 'text', prompt: sc.prompt, character: sc.character || 'none', aspect: s.format, megapixels: 0.4, seconds: sc.seconds, previews: 1, seed: Math.floor(Math.random() * 1e6), steps: 8, projectName: `Sizzle · ${s.name} · ${sc.id}` })
      assets[sc.id] = { kind: 'h3', previewJob: job.id, status: job.status }
    }
    s = this.get(id)
    s.assets = assets
    s.status = 'rendering'
    this.write(s)
    return this.refresh(id)
  }

  // Brings the pieces up to date: a finished H3 preview is finished at 1 MP, finished jobs give their files.
  // Both the window and the MCP server call this; a lock file keeps them from both finishing one preview.
  async refresh(id) {
    const lock = path.join(this.dir, id, '.refresh.lock')
    let fd
    try {
      fd = fs.openSync(lock, 'wx')
    } catch {
      if (Date.now() - fs.statSync(lock).mtimeMs < 60000) return this.view(this.get(id))
      fs.rmSync(lock, { force: true })
      fd = fs.openSync(lock, 'wx')
    }
    try {
      const s = this.get(id)
      if (s.status !== 'rendering') return this.view(s)
      for (const [key, a] of Object.entries(s.assets)) {
        if (a.status === 'success' && a.file) continue
        if (key === 'music') {
          const song = await this.music.refresh(this.music.all().find((x) => x.id === a.songId))
          Object.assign(a, { status: song.status === 'success' && !song.file ? 'running' : song.status, file: song.file || null, duration: song.duration || null })
        } else if (a.kind === 'image') {
          const j = await this.studio.refreshJob(a.jobId)
          // ComfyUI doesn't give picture paths; the file is fetched into the sizzle's own folder
          const out = j.outputs.find((o) => o.kind === 'image')
          const file = out && (out.path && fs.existsSync(out.path) ? out.path : await this.studio.localCopy(out, path.join(this.dir, id, 'pieces')))
          Object.assign(a, { status: j.status, error: j.error || null, file: file || null })
        } else if (a.kind === 'h3') {
          if (!a.finishJob) {
            const p = await this.studio.refreshJob(a.previewJob)
            a.status = p.status === 'success' ? 'finishing' : p.status
            a.preview = p.outputs.find((o) => o.kind === 'preview')?.path || null
            if (p.status === 'error') a.error = p.error
            if (p.status === 'success') a.finishJob = (await this.studio.finishCandidate({ jobId: a.previewJob, candidate: 1, megapixels: 1, upscale2x: false, fps: 0, audio: 'pass' })).id
          } else {
            const j = await this.studio.refreshJob(a.finishJob)
            Object.assign(a, { status: j.status === 'success' ? 'success' : j.status === 'error' || j.status === 'cancelled' ? j.status : 'finishing', error: j.error || null, file: j.outputs.find((o) => o.kind === 'final')?.path || null })
          }
        }
      }
      const states = Object.values(s.assets).map((a) => a.status)
      if (states.every((x) => x === 'success')) s.status = 'ready'
      else if (states.every((x) => DONE.includes(x) || x === 'success')) s.status = 'ready'
      this.write(s)
      return this.view(s)
    } finally {
      fs.closeSync(fd)
      fs.rmSync(lock, { force: true })
    }
  }

  // ---------- 4 hand the pieces to Shinobi ----------
  async toShinobi(id) {
    let s = await this.refresh(id).then(() => this.get(id))
    if (!this.shinobi.installed()) throw new Error('Set up Shinobi first (Workflows → Shinobi, or shinobi_setup).')
    if (!['ready', 'editing', 'done'].includes(s.status)) throw new Error('The pieces are still being made (get_sizzle shows where they are).')
    const projectId = s.shinobi?.projectId || `sizzle-${s.id}`
    if (!s.shinobi) {
      await this.shinobi.call('create_project', { name: `Sizzle · ${s.name}`, project_id: projectId })
      const files = this.mediaFor(s)
      for (const m of files) await this.shinobi.call('import_media', { project_id: projectId, source: m.file, rights: m.rights, ...(m.audioOnly && { audio_only: true }) })
      fs.writeFileSync(path.join(this.shinobi.projectDir(projectId), 'iv-brief.md'), this.brief(s, files))
      s = this.get(id)
      s.shinobi = { projectId, importedAt: now() }
      s.status = 'editing'
      this.write(s)
    }
    return { ...this.view(s), shinobi: this.shinobi.project(projectId), brief: fs.readFileSync(path.join(this.shinobi.projectDir(projectId), 'iv-brief.md'), 'utf8') }
  }

  // Every file the film uses, with what it is: the scenes' pieces, the screens and pictures they name, the
  // logo, the music and the voice-over.
  mediaFor(s) {
    const out = []
    const seen = new Set()
    const add = (file, what, rights, extra = {}) => file && fs.existsSync(file) && !seen.has(file) && (seen.add(file), out.push({ file, what, rights, ...extra }))
    const capture = (name) => s.site.captures.find((c) => c.name === name)?.file || s.site.images[Number(String(name).split('-')[1]) - 1]?.file
    for (const sc of s.plan.scenes) {
      const a = s.assets[sc.id]
      if (sc.kind === 'h3') add(a?.file, `${sc.id}: H3 shot, ${sc.seconds} s. ${sc.prompt}`, 'generated')
      if (sc.kind === 'image') add(a?.file, `${sc.id}: picture. ${sc.prompt}`, 'generated')
      if (sc.kind === 'screen') add(capture(sc.capture), `${sc.id}: the site's ${sc.capture}`, 'site_capture')
    }
    add(capture('logo'), 'The logo, captured from the site', 'site_capture')
    add(s.assets.music?.file, `Music: ${s.plan.music.caption}`, 'generated', { audioOnly: true })
    for (const l of s.assets.voiceover?.lines || []) add(l.file, `Voice-over: "${l.text}"`, 'generated', { audioOnly: true })
    return out
  }

  brief(s, files) {
    const site = s.site
    const f = SIZZLE_FORMATS[s.format]
    const lines = [
      `# Sizzle: ${s.name}`,
      '',
      `A ${s.plan.seconds} s promo film for ${s.url}, ${s.format} (${f.width}x${f.height}).`,
      '',
      '## The site, as captured',
      `- Title: ${site.title}`,
      site.description && `- Description: ${site.description}`,
      `- Headings: ${site.headings.slice(0, 12).map((h) => `"${h}"`).join(', ')}`,
      site.ctas.length && `- Buttons: ${site.ctas.map((h) => `"${h}"`).join(', ')}`,
      site.paragraphs.length && `- Copy: ${site.paragraphs.slice(0, 6).map((h) => `"${h}"`).join(' ')}`,
      `- Colours: ${site.colors.join(', ')}`,
      `- Fonts: ${site.fonts.join(', ')}`,
      '',
      '## Storyboard (approved)',
      ...s.plan.scenes.map((sc, k) => `${k + 1}. ${sc.id} · ${sc.kind} · ${sc.seconds} s · ${sc.kind === 'title' ? `"${sc.text}"` : sc.kind === 'screen' ? sc.capture : sc.prompt}${sc.note ? ` (${sc.note})` : ''}`),
      s.plan.notes && `\nNotes: ${s.plan.notes}`,
      '',
      '## Media in this project',
      ...files.map((m) => `- ${path.basename(m.file)}: ${m.what}`),
      '',
      '## How to cut it',
      '- Follow the storyboard order and lengths; cut on the beat of the music (analyze_audio, plan_music_edit).',
      "- Screens: slow push-ins and pans, or slide from one screen to the next like a scroll. Keep them sharp, never stretched.",
      "- Titles: kinetic typography in the site's colours and, where the fonts are installed (list_fonts), its fonts; render_page for anything custom. Keep each line on screen at least 1.2 s.",
      '- End on the logo, the main button\'s words and the web address.',
      "- Words on screen come from the site's own copy. Don't invent claims, numbers, prices, guarantees or scarcity.",
      '- Mix: music under everything, ducked under any voice-over; a soft fade at the end.',
      `- Render at ${f.width}x${f.height}, check the frames and the sound, and say honestly what still needs work.`
    ]
    return lines.filter((l) => typeof l === 'string' && l).join('\n').replace(/\n(#+ )/g, '\n\n$1') + '\n'
  }

  // ---------- views ----------
  finalOf(s) {
    if (!s.shinobi) return null
    try {
      return this.shinobi.renders(s.shinobi.projectId).find((r) => r.video)?.video || null
    } catch {
      return null
    }
  }
  view(s) {
    const scenes = (s.plan?.scenes || []).map((sc) => {
      const a = s.assets[sc.id]
      const capture = sc.kind === 'screen' ? s.site.captures.find((c) => c.name === sc.capture)?.file || s.site.images[Number(String(sc.capture).split('-')[1]) - 1]?.file : null
      return { ...sc, status: sc.kind === 'screen' || sc.kind === 'title' ? 'ready' : a?.status || 'waiting', file: a?.file || capture || null, preview: a?.preview || null, error: a?.error || null }
    })
    return { ...s, scenes, final: this.finalOf(s) }
  }
}
