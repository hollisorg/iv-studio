// Minimal ComfyUI HTTP client: prompt submission, history, queue, targeted interrupt, uploads, schemas.
import fs from 'node:fs'
import path from 'node:path'

export class Comfy {
  // token: a cloud ComfyUI sits behind IV Studio's gate (resources/cloud/gate.py), which wants it as a
  // Bearer header. A local ComfyUI has none.
  constructor(url = 'http://127.0.0.1:8188', clientId = 'iv-studio', token = null) {
    this.url = url.replace(/\/$/, '')
    this.clientId = clientId
    this.token = token
  }

  get remote() {
    return !!this.token
  }

  headers(extra = {}) {
    return { ...extra, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) }
  }

  async req(route, { method = 'GET', body, json, timeout = 15000 } = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeout)
    try {
      const res = await fetch(this.url + route, {
        method,
        signal: ctl.signal,
        headers: this.headers(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        body: json !== undefined ? JSON.stringify(json) : body
      })
      const text = await res.text()
      if (!res.ok) {
        let detail = text
        try {
          const j = JSON.parse(text)
          detail = j.error?.message ? `${j.error.message}${j.node_errors ? ' ' + summariseNodeErrors(j.node_errors) : ''}` : text
        } catch {}
        throw Object.assign(new Error(`ComfyUI ${route} ${res.status}: ${detail.slice(0, 800)}`), { status: res.status })
      }
      return text ? JSON.parse(text) : {}
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(`ComfyUI did not answer ${route} within ${timeout / 1000} s`)
      if (err.cause?.code === 'ECONNREFUSED') throw new Error(`ComfyUI is not running at ${this.url}`)
      if (err.status === 503 && this.remote) throw Object.assign(new Error('The cloud GPU is still starting up.'), { status: 503, starting: true })
      throw err
    } finally {
      clearTimeout(t)
    }
  }

  systemStats = () => this.req('/system_stats', { timeout: 5000 })
  queue = () => this.req('/queue')
  history = (id) => this.req(`/history/${id}`)
  objectInfo = (cls) => this.req(cls ? `/object_info/${encodeURIComponent(cls)}` : '/object_info', { timeout: 60000 })

  // front: put it ahead of waiting renders (used for quick jobs such as writing a prompt).
  async submit(prompt, extra = {}, { front = false } = {}) {
    const r = await this.req('/prompt', { method: 'POST', json: { prompt, client_id: this.clientId, extra_data: extra, ...(front ? { front: true } : {}) } })
    return r.prompt_id
  }

  // Cancels only this prompt: drops it from the queue, or interrupts it if it is the one running.
  async cancel(promptId) {
    const q = await this.queue()
    if (q.queue_pending.some((item) => item[1] === promptId)) {
      await this.req('/queue', { method: 'POST', json: { delete: [promptId] } })
      return 'removed from queue'
    }
    if (q.queue_running.some((item) => item[1] === promptId)) {
      await this.req('/interrupt', { method: 'POST', json: { prompt_id: promptId } })
      return 'interrupted'
    }
    return 'not queued'
  }

  // Asks ComfyUI to unload its models and free memory. ComfyUI does it between prompts, never inside one,
  // so nothing running is disturbed; the next prompt just loads what it needs.
  async freeMemory() {
    await this.req('/free', { method: 'POST', json: { unload_models: true, free_memory: true } })
  }

  // Copies a local file into ComfyUI's input folder (any type) and returns its name relative to input.
  async upload(filePath, subfolder = 'iv_studio') {
    const form = new FormData()
    const name = path.basename(filePath)
    form.append('image', new Blob([fs.readFileSync(filePath)]), name)
    form.append('subfolder', subfolder)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    const r = await this.req('/upload/image', { method: 'POST', body: form, timeout: 120000 })
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name
  }

  viewUrl(file) {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' })
    return `${this.url}/view?${q}`
  }
}

function summariseNodeErrors(errs) {
  return Object.entries(errs)
    .map(([id, e]) => `[${e.class_type} #${id}: ${(e.errors || []).map((x) => x.details || x.message).join('; ')}]`)
    .join(' ')
}
