// IV Studio service: the one place both the studio window and the MCP server go through.
// Projects, jobs and characters live as JSON in the data folder, so either process can pick up the
// other's work. ComfyUI does the rendering; this records what was asked, what ran and what came out.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Comfy } from './comfy.js'
import { buildPrompt, checkPrompt } from './graph.js'
import { planFinish, planPreviews } from './plan.js'
import { checkSetup } from './setup.js'

const DEFAULT_CHARACTERS = [
  { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8, trigger: 't3ss4', voiceRefmod: 'characters/tess_audio', visualRefmod: 'characters/tess_visual' }
]
const PREVIEW_SAVES = { 1: '42', 2: '118', 3: '128' }

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
  constructor({ dataDir, resourcesDir, comfyUrl, outputDir }) {
    this.dataDir = dataDir
    this.template = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.json'), 'utf8'))
    this.meta = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.groups.json'), 'utf8'))
    this.manifest = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'models.json'), 'utf8'))
    this.comfy = new Comfy(comfyUrl, `iv-studio-${randomUUID().slice(0, 8)}`)
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
  createProject(name) {
    const p = { id: randomUUID().slice(0, 8), name: name || 'Untitled shot', createdAt: now(), updatedAt: now(), jobs: [] }
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
  renameProject(id, name) {
    const p = this.getProject(id)
    p.name = name
    writeJson(this.projectFile(id), p)
    return p
  }

  // ---------- setup ----------
  checkSetup() {
    return checkSetup({ comfy: this.comfy, template: this.template, manifest: this.manifest, characters: this.characters() })
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

  async generatePreviews(input) {
    const { projectId, projectName, ...request } = input
    const project = projectId ? this.getProject(projectId) : this.createProject(projectName || request.prompt?.slice(0, 40))
    const media = []
    for (const m of request.media || []) media.push({ ...m, file: await this.stage(m.file || m.path, 'minimax_h3') })
    const voiceLine = request.voiceLine ? await this.stage(request.voiceLine, 'iv_studio') : null
    const plan = planPreviews({ ...request, media, voiceLine }, this.characters())
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
    const plan = planFinish(source.plan, finish)
    plan.values['80'] = source.name
    return this.submit({ kind: 'finish', project: this.getProject(source.projectId), plan, name: source.name, parent: source.id, previewPlan: source.plan })
  }

  async submit({ kind, project, plan, name, parent, previewPlan }) {
    const prompt = buildPrompt(this.template, this.meta, plan.groups, plan.values)
    const problems = checkPrompt(prompt)
    if (problems.length) throw new Error(`Internal graph error: ${problems.join('; ')}`)
    const promptId = await this.comfy.submit(prompt, { iv_studio: { kind, project: project.id } })
    const job = {
      id: randomUUID().slice(0, 12),
      kind,
      projectId: project.id,
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
    this.touchProject(project.id, job.id)
    return this.publicJob(job)
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
