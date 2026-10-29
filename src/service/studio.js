// IV Studio service: the one place both the studio window and the MCP server go through.
// Projects, jobs and characters live as JSON in the data folder, so either process can pick up the
// other's work. ComfyUI does the rendering; this records what was asked, what ran and what came out.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Comfy } from './comfy.js'
import { buildPrompt, checkPrompt } from './graph.js'
import { planFinish, planPreviews } from './plan.js'
import { adaptGraph, capabilities } from './remote.js'
import { contextIrGraph, fromContextIr, writeLocal, writeStoryLocal } from './prompter.js'
import { renderOutGraph, retakeGraph, SAVES, SEQUENCE_DEFAULTS, takeGraph, validateSequence } from './sequence.js'
import { checkSetup, comboOptions } from './setup.js'

const DEFAULT_CHARACTERS = [
  { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8, trigger: 't3ss4', voiceRefmod: 'characters/tess_audio', visualRefmod: 'characters/tess_visual' }
]
const PREVIEW_SAVES = { 1: '42', 2: '118', 3: '128' }
// The UNETLoader each mode of the IV Studio workflow uses (Settings can swap its model).
export const MODEL_NODES = { text: '101', frames: '201', reference: '301', continue: '601' }

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
const slug = (s) => (s || 'shot').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'shot'
const now = () => new Date().toISOString()

export class Studio {
  // models: { text, frames, reference, continue, take, retake } -> a UNET name per workflow (Settings).
  constructor({ dataDir, resourcesDir, comfyUrl, comfyToken = null, outputDir, models = null }) {
    this.models = models || {}
    this.dataDir = dataDir
    this.template = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.json'), 'utf8'))
    this.meta = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.groups.json'), 'utf8'))
    this.manifest = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'models.json'), 'utf8'))
    this.comfy = new Comfy(comfyUrl, `iv-studio-${randomUUID().slice(0, 8)}`, comfyToken)
    this.outputDir = outputDir || null
    this.progress = new Map() // promptId -> {value, max, node}
  }

  // ---------- characters ----------
  characters() {
    return readJson(path.join(this.dataDir, 'characters.json'), DEFAULT_CHARACTERS)
  }
  saveCharacters(list) {
    writeJson(path.join(this.dataDir, 'characters.json'), list)
    return list
  }

  // ---------- projects ----------
  projectFile = (id) => path.join(this.dataDir, 'projects', `${id}.json`)
  listProjects() {
    const dir = path.join(this.dataDir, 'projects')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  getProject(id) {
    const p = readJson(this.projectFile(id), null)
    if (!p) throw new Error(`No project ${id}`)
    return p
  }
  // sequenceId / trainingId / tool: the project holds a sequence's shots, a character training's renders or a
  // workflow's runs (tool 'replace'), and stays out of Shots.
  createProject(name, sequenceId = null, trainingId = null, tool = null) {
    const p = { id: randomUUID().slice(0, 8), name: name || 'Untitled shot', createdAt: now(), updatedAt: now(), jobs: [], sequenceId, ...(trainingId && { trainingId }), ...(tool && { tool }) }
    writeJson(this.projectFile(p.id), p)
    return p
  }
  touchProject(id, jobId) {
    const p = this.getProject(id)
    if (jobId && !p.jobs.includes(jobId)) p.jobs.push(jobId)
    p.updatedAt = now()
    writeJson(this.projectFile(id), p)
    return p
  }
  // A shot and its run history. The rendered videos stay in ComfyUI's output folder.
  deleteProject(id) {
    const p = this.getProject(id)
    for (const j of p.jobs) fs.rmSync(this.jobFile(j), { force: true })
    fs.rmSync(this.projectFile(id), { force: true })
    return true
  }
  renameProject(id, name) {
    const p = this.getProject(id)
    p.name = name
    writeJson(this.projectFile(id), p)
    return p
  }

  // ---------- setup ----------
  async checkSetup() {
    const result = await checkSetup({ comfy: this.comfy, template: this.template, manifest: this.manifest, characters: this.characters() })
    if (result.items[0]?.status === 'ok') result.caps = await this.capabilities(true).catch(() => null)
    return { ...result, remote: this.comfy.remote }
  }

  // What the connected ComfyUI can do (Linux paths, DLSS or the cloud's upscale + RIFE); cached.
  async capabilities(refresh = false) {
    if (!this._caps || refresh) {
      const [info, stats] = await Promise.all([this.comfy.objectInfo(), this.comfy.systemStats()])
      this._caps = capabilities(info, stats)
    }
    return this._caps
  }

  // ---------- planning ----------
  planRender(request, finish) {
    const plan = planPreviews(request, this.characters())
    const out = { resolved: plan.resolved, groups: plan.groups }
    if (finish !== false) out.finish = planFinish(plan, { candidate: 1, ...(finish || {}) }).resolved
    return out
  }

  // Local files (absolute paths) are uploaded into ComfyUI's input folder; names already in input pass through.
  async stage(file, sub) {
    if (!file) return file
    if (/^[a-zA-Z]:[\\/]|^\//.test(file)) {
      if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
      return this.comfy.upload(file, sub)
    }
    return file
  }

  // characterOverride: a character that isn't a saved preset (a training's checkpoint under test).
  async generatePreviews(input) {
    const { projectId, projectName, characterOverride, ...request } = input
    const project = projectId ? this.getProject(projectId) : this.createProject(projectName || request.prompt?.slice(0, 40))
    const media = []
    for (const m of request.media || []) media.push({ ...m, file: await this.stage(m.file || m.path, 'minimax_h3') })
    const voiceLine = request.voiceLine ? await this.stage(request.voiceLine, 'iv_studio') : null
    const characters = characterOverride ? [...this.characters(), characterOverride] : this.characters()
    const plan = planPreviews({ ...request, media, voiceLine, ...(characterOverride && { character: characterOverride.id }) }, characters)
    const unet = this.models[plan.request.mode]
    if (unet) plan.values[`${MODEL_NODES[plan.request.mode]}.unet_name`] = unet
    const run = project.jobs.length + 1
    const name = `${slug(project.name)}_${project.id}_r${run}`
    plan.values['80'] = name
    return this.submit({ kind: 'previews', project, plan, name })
  }

  // What a finish of this previews job would produce, without rendering.
  planFinishJob(jobId, finish) {
    const source = this.getJob(jobId)
    if (source.kind !== 'previews') throw new Error('Needs a previews job id.')
    return planFinish(source.plan, finish).resolved
  }

  async finishCandidate({ jobId, ...finish }) {
    const source = this.getJob(jobId, { refresh: false })
    if (source.kind !== 'previews') throw new Error('finish_candidate needs a previews job id.')
    const caps = await this.capabilities()
    if (finish.fps && !caps.fps.includes(finish.fps)) throw new Error(`This ComfyUI can make ${caps.fps.filter(Boolean).join(', ') || 'no other'} fps.`)
    if (finish.upscale2x && !caps.upscale2x) throw new Error('This ComfyUI has no 2x upscaler.')
    const plan = planFinish(source.plan, finish)
    plan.values['80'] = source.name
    return this.submit({ kind: 'finish', project: this.getProject(source.projectId), plan, name: source.name, parent: source.id, previewPlan: source.plan })
  }

  async submit({ kind, project, plan, name, parent, previewPlan }) {
    const prompt = buildPrompt(this.template, this.meta, plan.groups, plan.values)
    return this.submitGraph({ kind, graph: prompt, projectId: project.id, plan, name, parent, previewPlan })
  }

  // Queues any graph and records it as a job. Sequence graphs carry plan.saves so their outputs can be read.
  async submitGraph({ kind, graph: built, projectId = null, sequenceId = null, plan, name, parent, previewPlan }) {
    const graph = adaptGraph(built, await this.capabilities())
    const problems = checkPrompt(graph)
    if (problems.length) throw new Error(`Internal graph error: ${problems.join('; ')}`)
    const promptId = await this.comfy.submit(graph, { iv_studio: { kind, project: projectId, sequence: sequenceId } })
    const job = {
      id: randomUUID().slice(0, 12),
      kind,
      projectId,
      sequenceId,
      parent: parent || null,
      name,
      promptId,
      status: 'queued',
      createdAt: now(),
      plan: kind === 'previews' ? plan : { ...plan, preview: undefined },
      previewPlan: previewPlan || undefined,
      outputs: []
    }
    writeJson(this.jobFile(job.id), job)
    if (projectId) this.touchProject(projectId, job.id)
    return this.publicJob(job)
  }

  // ---------- renders, files and models (shared by the window and the MCP server) ----------
  // An output as a file on this PC: its own path when local, else downloaded from the (cloud)
  // ComfyUI into dir under the same name.
  async localCopy(file, dir) {
    const p = typeof file === 'string' ? file : file?.path
    if (p && fs.existsSync(p)) return p
    if (!file?.url) throw new Error('That file is not on this PC.')
    const u = new URL(file.url)
    const dest = path.join(dir, u.searchParams.get('filename'))
    if (!fs.existsSync(dest)) {
      const res = await fetch(`${this.comfy.url}/view${u.search}`, { headers: this.comfy.headers() })
      if (!res.ok) throw new Error(`Download failed (${res.status}).`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()))
      fs.renameSync(`${dest}.part`, dest)
    }
    return dest
  }

  // Every IV Studio render, newest first: shot finals and previews, sequence versions and finals.
  library() {
    const items = []
    for (const p of this.listProjects()) {
      if (p.trainingId) continue // a character training's test renders
      for (const j of this.listJobs(p.id)) {
        for (const o of j.outputs || []) {
          if (!['final', 'preview'].includes(o.kind)) continue
          items.push({ key: `${j.id}:${o.kind}:${o.candidate || ''}`, label: `${p.name} · ${o.kind === 'final' ? 'final' : `preview ${o.candidate}`}`, group: p.tool === 'replace' ? 'Replace' : p.sequenceId ? 'Sequence shots' : 'Shots', at: j.finishedAt || j.createdAt, file: { path: o.path, url: o.url, filename: o.filename } })
        }
      }
    }
    for (const sq of this.listSequences()) {
      const v = this.sequenceView(sq.id)
      for (const x of v.versions) if (x.file) items.push({ key: `${sq.id}:${x.id}`, label: `${sq.name} · ${x.label}`, group: 'Sequences', at: x.createdAt, file: x.file })
      for (const r of v.renders) if (r.file) items.push({ key: `${sq.id}:r:${r.id}`, label: `${sq.name} · final`, group: 'Sequences', at: r.createdAt, file: r.file })
    }
    const seen = new Set() // a finish job lists its picked preview again
    return items.filter((i) => !seen.has(i.file.path || i.file.url) && seen.add(i.file.path || i.file.url)).sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }

  // H3 models the ComfyUI can load, and each workflow's default (Settings -> Models).
  async h3Models() {
    const all = comboOptions(await this.comfy.objectInfo('UNETLoader'), 'UNETLoader', 'unet_name') || []
    const t = this.template
    return {
      models: all.filter((n) => /h3|minimax/i.test(n)),
      defaults: { text: t['101'].inputs.unet_name, frames: t['201'].inputs.unet_name, reference: t['301'].inputs.unet_name, continue: t['601'].inputs.unet_name, take: t['301'].inputs.unet_name, retake: t['301'].inputs.unet_name }
    }
  }

  // LoRA names ComfyUI lists, and the loras folder new character LoRAs go in: the one already holding
  // "MiniMax H3" (ComfyUI may list its install's own folder first, ahead of a shared one).
  async loraNames() {
    return comboOptions(await this.comfy.objectInfo('LoraLoaderModelOnly'), 'LoraLoaderModelOnly', 'lora_name') || []
  }
  async loraRoot() {
    const folders = (await fetch(`${this.comfy.url}/experiment/models`, { headers: this.comfy.headers() }).then((r) => r.json())).find((f) => f.name === 'loras')?.folders || []
    const real = folders.filter((f) => fs.existsSync(f))
    const root = real.find((f) => fs.existsSync(path.join(f, 'MiniMax H3'))) || real[0]
    if (!root) throw new Error("Couldn't find this ComfyUI's loras folder (character downloads need a ComfyUI on this PC).")
    return root
  }

  // Character LoRAs and RefMods the ComfyUI can load (for new characters and refmods in a request).
  async choices() {
    const refmod = this.template['1101'].class_type
    const [l, r] = await Promise.all([this.comfy.objectInfo('LoraLoaderModelOnly'), this.comfy.objectInfo(refmod)])
    return { loras: comboOptions(l, 'LoraLoaderModelOnly', 'lora_name') || [], refmods: (comboOptions(r, refmod, 'mod_1') || []).filter((n) => n !== '(none)') }
  }

  // ---------- prompt writer ----------
  // request: {idea, mode, seconds, aspect, character, media, sequence, previous}. engine: local | contextir.
  async writePrompt(request, { engine = 'local', apiKey = null, model } = {}) {
    const { idea, character: charId = 'none', mode = 'text', seconds = 5, aspect = '16:9', media = [], sequence = false, previous = null } = request
    if (!idea?.trim()) throw new Error('Describe the idea first.')
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    const files = media.map((m) => ({ kind: m.kind, file: m.file || m.path }))
    if (engine === 'local') return writeLocal({ idea, mode, seconds, character, sequence, previous, media: files, model, cpu: await this.gpuBusy() })
    if (engine !== 'contextir') throw new Error(`Unknown writer "${engine}".`)
    if (!apiKey) throw new Error('MiniMax Context IR needs a Comfy.org API key. Add it in Settings → Prompt writer.')
    const staged = []
    for (const m of files) staged.push({ kind: m.kind, name: await this.stage(m.file, 'iv_studio') })
    const graph = contextIrGraph({ idea, mode, seconds, aspect, character, media: staged, sequence })
    const promptId = await this.comfy.submit(graph, { api_key_comfy_org: apiKey, iv_studio: { kind: 'write_prompt' } }, { front: true })
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const h = (await this.comfy.history(promptId))[promptId]
      if (!h) continue
      const err = h.status?.messages?.find((m) => m[0] === 'execution_error')
      if (err) throw new Error(`Context IR: ${err[1].exception_message}`.slice(0, 600))
      const text = h.outputs?.out?.text?.[0]
      if (!text) throw new Error('Context IR returned no prompt.')
      return fromContextIr(text, character)
    }
    throw new Error('Context IR took too long. Try again.')
  }

  async writeStory({ story, shots = 3, seconds = 10, character: charId = 'none' }, { model } = {}) {
    if (!story?.trim()) throw new Error('Write the story first.')
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    return writeStoryLocal({ story, shots: Math.min(8, Math.max(1, shots)), seconds, character, model, cpu: await this.gpuBusy() })
  }

  // True while ComfyUI is rendering; the local writer then stays on the CPU so it can't take H3's VRAM.
  async gpuBusy() {
    try {
      return (await this.comfy.queue()).queue_running.length > 0
    } catch {
      return false
    }
  }

  // ---------- sequences ----------
  // A sequence is a list of shots that plays as one video. Each render (a whole take, the last shot of a
  // shot-by-shot chain, or a retake) is a version; a render-out finishes one version with DLSS.
  sequenceFile = (id) => path.join(this.dataDir, 'sequences', `${id}.json`)
  listSequences() {
    const dir = path.join(this.dataDir, 'sequences')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({ id: s.id, name: s.name, method: s.method, shots: s.shots.length, versions: s.versions.length, renders: s.renders.length, updatedAt: s.updatedAt }))
  }
  getSequence(id) {
    const s = readJson(this.sequenceFile(id), null)
    if (!s) throw new Error(`No sequence ${id}`)
    return s
  }
  writeSequence(s) {
    s.updatedAt = now()
    writeJson(this.sequenceFile(s.id), s)
    return s
  }
  createSequence(init = {}) {
    const s = { ...SEQUENCE_DEFAULTS, name: 'Untitled sequence', shots: [{ id: randomUUID().slice(0, 6), prompt: '', mode: 'text', media: [] }], ...init, id: randomUUID().slice(0, 8), createdAt: now(), projectId: null, shotJobs: {}, versions: [], renders: [], jobs: [] }
    return this.writeSequence(s)
  }
  // Edits name, settings and shots. Renders already made stay; shot-by-shot shots go stale when their inputs change.
  saveSequence(id, patch) {
    const s = this.getSequence(id)
    const allowed = ['name', 'method', 'character', 'aspect', 'megapixels', 'shotSeconds', 'steps', 'seed', 'voiceRef', 'shots']
    for (const k of allowed) if (k in (patch || {})) s[k] = patch[k]
    s.shots = s.shots.map((sh) => ({ id: sh.id || randomUUID().slice(0, 6), prompt: sh.prompt || '', mode: sh.mode || 'text', media: sh.media || [] }))
    return this.writeSequence(s)
  }
  deleteSequence(id) {
    fs.rmSync(this.sequenceFile(id), { force: true })
    return true
  }

  // The sequence plus everything derived from its jobs: version files, shot-by-shot state, render-outs.
  sequenceView(id) {
    const s = this.getSequence(id)
    const job = (jid) => (jid ? readJson(this.jobFile(jid), null) : null)
    const out = (j, kind) => j?.outputs?.find((o) => o.kind === kind) || null

    // Shot by shot: a shot is fresh when its finish succeeded from the inputs it has now,
    // including the previous shot's video.
    const shots = []
    let prevRaw = null
    for (const [i, sh] of s.shots.entries()) {
      const rec = s.shotJobs[sh.id] || {}
      const pj = job(rec.previews)
      const fj = job(rec.finish)
      const raw = out(fj, i === 0 ? 'before_dlss' : 'continued_before_dlss')
      const key = this.shotKey(s, i, prevRaw)
      const fresh = !!(raw && rec.key === key)
      shots.push({ id: sh.id, previews: pj ? this.publicJob(pj) : null, finish: fj ? this.publicJob(fj) : null, raw, fresh, stale: !!rec.key && rec.key !== key, ready: i === 0 || !!prevRaw })
      prevRaw = fresh ? raw.path : null
    }

    const versions = s.versions.map((v) => {
      const j = job(v.jobId)
      return { ...v, job: j ? this.publicJob(j) : null, file: out(j, 'master') }
    })
    if (prevRaw && shots.length) versions.unshift({ id: 'shots', kind: 'shots', label: 'Shot by shot', createdAt: shots.at(-1).finish?.createdAt, job: shots.at(-1).finish, file: shots.at(-1).raw })
    const renders = s.renders.map((r) => {
      const j = job(r.jobId)
      return { ...r, job: j ? this.publicJob(j) : null, file: out(j, 'final') }
    })
    return { sequence: s, shots, versions, renders }
  }

  // sequenceView after asking ComfyUI about any of the sequence's jobs that haven't finished.
  async refreshSequence(id) {
    for (const jid of this.getSequence(id).jobs) {
      const j = readJson(this.jobFile(jid), null)
      if (j && !['success', 'error', 'cancelled'].includes(j.status)) await this.refreshJob(jid).catch(() => {})
    }
    return this.sequenceView(id)
  }

  shotKey(s, i, prevRaw) {
    const sh = s.shots[i]
    return JSON.stringify([sh.prompt, sh.mode, sh.media, s.character, s.aspect, s.megapixels, s.shotSeconds, s.steps, i ? prevRaw : null])
  }

  sequenceCharacter(s) {
    return validateSequence(s, this.characters())
  }
  sequenceJob(s, j) {
    s.jobs.push(j.id)
    this.writeSequence(s)
    return j
  }

  async renderTake(id) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    const voiceRef = s.voiceRef ? await this.stage(s.voiceRef, 'iv_studio') : null
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph, resolved } = takeGraph({ template: this.template, seq: s, character, name, voiceRef, unet: this.models.take })
    const j = await this.submitGraph({ kind: 'take', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved } })
    s.versions.push({ id: `v${n}`, kind: 'take', label: `Take ${s.versions.filter((v) => v.kind === 'take').length + 1}`, jobId: j.id, createdAt: j.createdAt, seed: s.seed })
    return this.sequenceJob(s, j)
  }

  versionPath(id, versionId) {
    const v = this.sequenceView(id).versions.find((x) => x.id === versionId)
    if (!v?.file?.path) throw new Error(`Version ${versionId} has no finished video yet.`)
    return { v, path: v.file.path }
  }

  async retakeSequence(id, { versionId, prompt, start, end, mode = 'both', seed }) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    if (!prompt?.trim()) throw new Error('Describe what should happen in the retake.')
    if (!(end > start)) throw new Error('The retake must end after it starts.')
    const { v, path: sourcePath } = this.versionPath(id, versionId)
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph } = retakeGraph({ template: this.template, seq: s, character, name, sourcePath, prompt, start, end, mode, seed: seed ?? s.seed + n, unet: this.models.retake })
    const j = await this.submitGraph({ kind: 'retake', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { start, end, mode } } })
    s.versions.push({ id: `v${n}`, kind: 'retake', label: `Retake of ${v.label}, ${start}–${end} s`, jobId: j.id, createdAt: j.createdAt, source: versionId, start, end, mode, prompt })
    return this.sequenceJob(s, j)
  }

  async renderOutSequence(id, { versionId, normalize = false, scale = 1, fps = 0 }) {
    const s = this.getSequence(id)
    const { path: sourcePath } = this.versionPath(id, versionId)
    const name = `${slug(s.name)}_${s.id}_${versionId}_final`
    const { graph } = renderOutGraph({ template: this.template, name, sourcePath, normalize, scale, fps })
    const j = await this.submitGraph({ kind: 'renderout', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { normalize, scale, fps } } })
    s.renders.push({ id: j.id, versionId, jobId: j.id, createdAt: j.createdAt, normalize, scale, fps })
    return this.sequenceJob(s, j)
  }

  // Shot by shot: shot 1 is hunted like any shot; every later shot continues from the previous shot's video.
  async huntShot(id, index, { seed } = {}) {
    const s = this.getSequence(id)
    this.sequenceCharacter(s)
    const view = this.sequenceView(id)
    const sh = s.shots[index]
    if (!sh) throw new Error(`No shot ${index + 1}.`)
    const prev = index > 0 ? view.shots[index - 1] : null
    if (prev && !prev.fresh) throw new Error(`Finish shot ${index} first; shot ${index + 1} continues from it.`)
    if (!s.projectId) s.projectId = this.createProject(`${s.name} (sequence)`, s.id).id
    const base = { prompt: sh.prompt, character: s.character, aspect: s.aspect, seconds: s.shotSeconds, steps: s.steps, seed: seed ?? s.seed + index * 100 }
    const request = prev
      ? { ...base, mode: 'continue', media: [{ kind: 'video', file: prev.raw.path }], megapixels: s.megapixels, overlapFrames: 22 }
      : { ...base, mode: sh.mode || 'text', media: sh.media || [], megapixels: 0.4, previews: 3 }
    const j = await this.generatePreviews({ projectId: s.projectId, ...request })
    s.shotJobs[sh.id] = { previews: j.id, finish: null, key: this.shotKey(s, index, prev?.raw?.path || null) }
    return this.sequenceJob(s, j)
  }

  async finishShot(id, index, { candidate = 1 } = {}) {
    const s = this.getSequence(id)
    const sh = s.shots[index]
    const rec = s.shotJobs[sh?.id]
    if (!rec?.previews) throw new Error(`Hunt shot ${index + 1} first.`)
    const j = await this.finishCandidate({ jobId: rec.previews, candidate, megapixels: Math.max(0.5, s.megapixels), audio: 'pass', fps: 0, upscale2x: false })
    rec.finish = j.id
    return this.sequenceJob(s, j)
  }

  // ---------- jobs ----------
  jobFile = (id) => path.join(this.dataDir, 'jobs', `${id}.json`)

  getJob(id, { refresh = true } = {}) {
    const job = readJson(this.jobFile(id), null)
    if (!job) throw new Error(`No job ${id}`)
    return refresh ? job : job
  }

  async refreshJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return this.publicJob(job)
    let h
    try {
      h = (await this.comfy.history(job.promptId))[job.promptId]
    } catch (err) {
      return this.publicJob({ ...job, note: err.message })
    }
    if (h) {
      const msgs = h.status?.messages || []
      const err = msgs.find((m) => m[0] === 'execution_error')
      const interrupted = msgs.find((m) => m[0] === 'execution_interrupted')
      job.status = err ? 'error' : interrupted ? 'cancelled' : h.status?.status_str === 'success' ? 'success' : 'error'
      if (err) job.error = `${err[1].node_type}: ${err[1].exception_message}`.slice(0, 1200)
      const t = msgs.filter((m) => ['execution_start', 'execution_success', 'execution_error'].includes(m[0])).map((m) => m[1].timestamp)
      if (t.length > 1) job.seconds = Math.round((t.at(-1) - t[0]) / 1000)
      job.outputs = this.collectOutputs(job, h.outputs || {})
      job.finishedAt = now()
      writeJson(this.jobFile(job.id), job)
      return this.publicJob(job)
    }
    const q = await this.comfy.queue()
    if (q.queue_running.some((i) => i[1] === job.promptId)) job.status = 'running'
    else {
      const pos = q.queue_pending.findIndex((i) => i[1] === job.promptId)
      job.status = pos >= 0 ? 'queued' : job.status
      job.queuePosition = pos >= 0 ? pos + 1 + q.queue_running.length : undefined
    }
    return this.publicJob({ ...job, progress: this.progress.get(job.promptId) })
  }

  async cancelJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return { job: this.publicJob(job), result: 'already finished' }
    const result = await this.comfy.cancel(job.promptId)
    if (result === 'removed from queue') {
      job.status = 'cancelled'
      writeJson(this.jobFile(job.id), job)
    }
    return { job: this.publicJob(job), result }
  }

  collectOutputs(job, outputs) {
    const list = []
    const file = (f, kind, extra = {}) => ({ kind, path: f.fullpath || null, url: this.comfy.viewUrl(f), filename: f.filename, subfolder: f.subfolder, ...extra })
    const videoOf = (o) => (o?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
    if (job.plan?.replace) {
      // OpenJutsu's workflows: the final video (Context Loop assembly or VHS), plus mask and "who is who" previews
      const fin = job.plan.replace.finalNode
      for (const [nid, out] of Object.entries(outputs)) {
        for (const f of [...(out.gifs || []), ...(out.videos || []), ...(out.video || [])]) if (/\.(mp4|webm|mov)$/i.test(f.filename)) list.push(file(f, nid === fin ? 'final' : 'video'))
        for (const t of out.text || []) if (typeof t === 'string' && /\.(mp4|webm|mov)$/i.test(t)) list.push(this.fileFromPath(t, nid === fin ? 'final' : 'video'))
        for (const img of out.images || []) if (/\.(png|jpe?g|webp)$/i.test(img.filename)) list.push(file(img, 'image'))
      }
      return list
    }
    if (job.plan?.music) {
      // a song (Music): the SaveAudio output
      for (const nid of Object.keys(outputs).sort()) for (const a of outputs[nid].audio || []) list.push(file(a, 'audio'))
      return list
    }
    if (job.plan?.images) {
      // a picture graph (character design stills): every SaveImage output, in node order
      for (const nid of Object.keys(outputs).sort()) for (const img of outputs[nid].images || []) list.push(file(img, 'image'))
      return list
    }
    if (job.plan?.saves) {
      const master = videoOf(outputs[SAVES.master])
      if (master) list.push(file(master, 'master'))
      const p = outputs[SAVES.final]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
      return list
    }
    for (const [k, nid] of Object.entries(PREVIEW_SAVES)) {
      const v = videoOf(outputs[nid])
      if (v) list.push(file(v, 'preview', { candidate: Number(k), seed: job.kind === 'previews' ? job.plan.resolved.seeds[k - 1] : undefined }))
    }
    const twoMp = videoOf(outputs['30'])
    if (twoMp) list.push(file(twoMp, 'before_dlss'))
    const cont = videoOf(outputs['619'])
    if (cont) list.push(file(cont, 'continued_before_dlss'))
    for (const nid of ['51', '704']) {
      const p = outputs[nid]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
    }
    return list
  }

  fileFromPath(p, kind) {
    const norm = p.replace(/\\/g, '/')
    const m = norm.match(/\/output\/(.*)\/([^/]+)$/)
    const subfolder = m ? m[1] : ''
    const filename = m ? m[2] : norm.split('/').pop()
    return { kind, path: p, filename, subfolder, url: this.comfy.viewUrl({ filename, subfolder, type: 'output' }) }
  }

  publicJob(job) {
    const { previewPlan, ...rest } = job
    return { ...rest, plan: { resolved: job.plan?.resolved, request: job.plan?.request ? summarise(job.plan.request) : undefined, finish: job.plan?.finish } }
  }

  listJobs(projectId) {
    const ids = projectId ? this.getProject(projectId).jobs : []
    return ids.map((id) => readJson(this.jobFile(id), null)).filter(Boolean).map((j) => this.publicJob(j))
  }

  // Live progress from ComfyUI's websocket (the studio window keeps one open; the MCP server polls).
  watch(onEvent) {
    // A cloud ComfyUI shuts down when idle; an open websocket would keep it (and its bill) running.
    if (this.comfy.remote) return () => {}
    let ws
    let stopped = false
    const connect = () => {
      if (stopped) return
      try {
        ws = new WebSocket(`${this.comfy.url.replace(/^http/, 'ws')}/ws?clientId=${this.comfy.clientId}-watch`)
      } catch {
        return setTimeout(connect, 3000)
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        const d = msg.data || {}
        if (msg.type === 'progress' && d.prompt_id) this.progress.set(d.prompt_id, { value: d.value, max: d.max, node: d.node })
        if (msg.type === 'executing' && d.prompt_id && d.node == null) this.progress.delete(d.prompt_id)
        onEvent?.(msg)
      }
      ws.onclose = () => setTimeout(connect, 3000)
      ws.onerror = () => {}
    }
    connect()
    return () => {
      stopped = true
      ws?.close()
    }
  }
}

function summarise(r) {
  const { prompt, ...rest } = r
  return { ...rest, prompt: prompt?.length > 400 ? prompt.slice(0, 400) + '…' : prompt }
}
