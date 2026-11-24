// Cloud setup progress: the steps a Modal or RunPod setup goes through, which one is running, how far it is and
// about how long is left, for the window's progress view (SetupProgress.jsx) and the title-bar pill. It's fed by
// the setup's own output: Modal's log lines (fromLine) and the RunPod pod's boot health (fromHealth). Pure: the
// clock is passed in, so test/setup-progress.mjs can drive it.

// secs: a typical first-time duration, used for the overall bar and the time left until a step reports its own
// percentage. typical: the same, in words, shown beside the step.
export const SETUP_PLANS = {
  modal: [
    { id: 'token', label: 'Connect your Modal workspace', typical: 'a few seconds', secs: 10 },
    { id: 'image', label: 'Build the cloud image', typical: '10–15 min the first time, seconds after that', secs: 720 },
    { id: 'models', label: 'Download the H3 models into your cloud storage', typical: 'about 60 GB, 5–15 min the first time', secs: 600 },
    { id: 'characters', label: 'Upload your characters', typical: 'a minute or less', secs: 30 }
  ],
  runpod: [
    { id: 'storage', label: 'Make your cloud storage', typical: 'about a minute', secs: 60 },
    { id: 'pod', label: 'Start a cloud GPU', typical: '1–3 min', secs: 120 },
    // typical times from a real setup (2026-11-23, EU-RO-1): install 913 s, models 209 s at ~390 MB/s, first start 290 s
    { id: 'install', label: 'Install ComfyUI and its add-ons', typical: '10–15 min, first time only', secs: 900 },
    { id: 'models', label: 'Download the H3 models onto your storage', typical: '3–10 min, first time only', secs: 360 },
    { id: 'start', label: 'Start ComfyUI', typical: 'about 5 min the first time', secs: 300 },
    { id: 'characters', label: 'Upload your characters', typical: 'a minute or less', secs: 30 }
  ]
}

const short = (s, n = 110) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// RunPod's install in its three parts (runpod_boot.py), each a share of the step, so the step's percentage covers
// all of it: Python and torch, then ComfyUI (both timed, from a real setup: 200 s and 240 s), then the node packs
// (counted, about 470 s). Before this, the first node pack read as 7% of the whole step and the bar went back.
const INSTALL_PARTS = [
  { match: /python and torch|system packages/i, from: 0, to: 22, secs: 200 },
  { match: /^comfyui /i, from: 22, to: 48, secs: 240 }
]
const PACKS_FROM = 48

// RunPod's model download is "slow" when the pod's own estimate of the time left stays over SLOW_ETA for SLOW_FOR:
// the GPU bills all that time, so the setup offers to stop it (the download carries on next time). The first
// minute is left out while the connections get going.
export const SLOW_ETA = 40 * 60
export const SLOW_FOR = 3 * 60
const SLOW_GRACE = 60

export class SetupProgress {
  // models: [{ id, label, size }] the setup downloads (Modal), for a byte-weighted percentage
  constructor(provider, { now = Date.now, onChange = () => {}, models = [] } = {}) {
    this.provider = provider
    this.now = now
    this.onChange = onChange
    this.models = models
    this.finishedModels = new Set()
    this.startedAt = now()
    this.finishedAt = null
    this.ok = null
    this.error = null
    this.steps = (SETUP_PLANS[provider] || []).map((s) => ({ ...s, status: 'waiting', startedAt: null, doneAt: null, percent: null, detail: '', eta: null }))
    // the GPU's price an hour (RunPod), for what a slow download would cost; the slow warning, when there is one
    this.perHour = null
    this.slow = null
    this.slowSince = null
    // the install part now running and when it began (INSTALL_PARTS); the highest the overall bar has shown
    this.part = null
    this.peak = 0
  }

  step(id) {
    return this.steps.find((s) => s.id === id)
  }
  // starts a step; every step before it that was still waiting or running counts as done
  start(id, detail = '') {
    const at = this.steps.findIndex((s) => s.id === id)
    if (at < 0) return
    const t = this.now()
    for (const s of this.steps.slice(0, at)) if (s.status === 'waiting' || s.status === 'running') Object.assign(s, { status: 'done', doneAt: t, startedAt: s.startedAt || t })
    const s = this.steps[at]
    if (s.status !== 'running') Object.assign(s, { status: 'running', startedAt: t, percent: null })
    if (detail) s.detail = short(detail)
    this.changed()
  }
  update(id, { percent, detail, eta } = {}) {
    const s = this.step(id)
    if (!s) return
    if (s.status === 'waiting') this.start(id)
    if (eta !== undefined) s.eta = eta
    // a step's percentage only goes forward (a new part of it never reads as less done)
    if (percent != null) s.percent = Math.max(s.percent ?? 0, Math.max(0, Math.min(100, Math.round(percent))))
    if (detail) s.detail = short(detail)
    this.changed()
  }
  done(id, detail) {
    const s = this.step(id)
    if (!s) return
    if (s.status === 'waiting') this.start(id)
    Object.assign(s, { status: 'done', doneAt: this.now(), percent: 100, eta: null, ...(detail ? { detail: short(detail) } : {}) })
    if (id === 'models') this.slow = this.slowSince = null
    this.changed()
  }
  skip(id, detail = '') {
    const s = this.step(id)
    if (s && s.status === 'waiting') Object.assign(s, { status: 'skipped', detail: short(detail) })
    this.changed()
  }
  finish() {
    const t = this.now()
    for (const s of this.steps) if (s.status === 'waiting' || s.status === 'running') Object.assign(s, { status: 'done', doneAt: t, startedAt: s.startedAt || t, percent: s.status === 'running' ? 100 : s.percent })
    Object.assign(this, { ok: true, finishedAt: t })
    this.changed()
  }
  fail(err) {
    const s = this.steps.find((x) => x.status === 'running')
    if (s) s.status = 'failed'
    Object.assign(this, { ok: false, error: String(err?.message || err), finishedAt: this.now() })
    this.changed()
  }
  changed() {
    this.onChange(this.snapshot())
  }

  // Modal's output, as IV Studio's cloud.js logs it
  fromLine(raw) {
    const line = String(raw || '').trim()
    if (!line) return
    if (/^Saving the access token/i.test(line)) return this.start('token')
    if (/^Building the cloud image/i.test(line)) return this.start('image', 'Building the image Modal runs ComfyUI in')
    if (/^Downloading the H3 models/i.test(line)) return this.start('models', 'Checking which models your storage already has')
    let m
    if ((m = line.match(/^(have|done) (.+?)( \(checksum verified\))?$/))) {
      this.finishedModels.add(m[2])
      return this.update('models', { percent: this.modelPercent(), detail: `${m[2]} ${m[1] === 'have' ? 'is already there' : 'downloaded'}` })
    }
    if ((m = line.match(/^downloading (.+)$/))) return this.update('models', { percent: this.modelPercent(), detail: `Downloading ${m[1]}` })
    if ((m = line.match(/^progress (\S+) (\d+)% of (\d+)$/))) {
      const model = this.models.find((x) => x.id === m[1])
      return this.update('models', { percent: this.modelPercent(m[1], Number(m[2])), detail: `Downloading ${model?.label || m[1]}, ${m[2]}%` })
    }
    if (/^models ready:/i.test(line)) return this.done('models', line.replace(/^models ready:\s*/i, 'Models ready: '))
    if ((m = line.match(/^Uploading (.+?)…?$/))) return this.update('characters', { detail: `Uploading ${m[1]}` })
    // anything else while the image builds: show it as the step's latest news (Modal's build steps)
    const run = this.steps.find((s) => s.status === 'running')
    if (run?.id === 'image' && !/^[│┃|╭╰─]/.test(line)) this.update('image', { detail: line })
  }
  // the share of the model bytes on the volume: finished models, plus the one downloading at `pct`
  modelPercent(currentId, pct = 0) {
    const total = this.models.reduce((s, m) => s + (m.size || 0), 0)
    if (!total) return null
    const finished = this.models.filter((m) => this.finishedModels.has(m.label)).reduce((s, m) => s + (m.size || 0), 0)
    const cur = currentId && !this.models.some((m) => m.id === currentId && this.finishedModels.has(m.label)) ? (this.models.find((m) => m.id === currentId)?.size || 0) * (pct / 100) : 0
    return ((finished + cur) / total) * 100
  }

  // the RunPod pod's boot, as its gate reports it (runpod_boot.py status())
  fromHealth(h) {
    if (!h) return this.update('pod', { detail: 'Waiting for the pod to boot' })
    const detail = h.detail ? h.detail[0].toUpperCase() + h.detail.slice(1) : ''
    if (h.stage === 'booting') return this.update('pod', { detail: detail || 'The pod is booting' })
    if (h.stage === 'installing') return this.update('install', { detail, percent: this.installPercent(String(h.detail || '')) })
    if (h.stage === 'models') {
      // by bytes when the pod sends them (a 21 GB model isn't the same as a 0.4 GB one), else by files
      const pct = h.bytesTotal ? (h.bytesDone / h.bytesTotal) * 100 : h.total ? (((h.done || 0) + (h.percent || 0) / 100) / h.total) * 100 : h.percent
      this.update('models', { detail, percent: pct, eta: h.eta ?? null })
      return this.watchSpeed(h)
    }
    if (h.stage === 'starting') return this.update('start', { detail })
    if (h.stage === 'ready') return this.done('start', 'ComfyUI is ready')
  }

  // How far the install is, across its parts: a timed part moves with its typical time (never past 90% of its
  // share), a node pack counts the packs done. null for anything else (waiting for another pod's install).
  installPercent(detail) {
    const t = this.now()
    const n = detail.match(/node pack (\d+) of (\d+)/)
    if (n) return PACKS_FROM + ((100 - PACKS_FROM) * (Number(n[1]) - 1)) / Number(n[2])
    const part = INSTALL_PARTS.find((p) => p.match.test(detail))
    if (!part) return null
    if (this.part?.part !== part) this.part = { part, at: t }
    return part.from + (part.to - part.from) * Math.min(0.9, (t - this.part.at) / 1000 / part.secs)
  }

  // the slow warning: on once the time left has stayed over SLOW_ETA for SLOW_FOR, off again as soon as it isn't
  watchSpeed(h) {
    const s = this.step('models')
    const t = this.now()
    if (s?.startedAt == null || t - s.startedAt < SLOW_GRACE * 1000 || h.eta == null) return
    if (h.eta <= SLOW_ETA) {
      if (this.slow || this.slowSince) Object.assign(this, { slow: null, slowSince: null }), this.changed()
      return
    }
    this.slowSince ??= t
    if (t - this.slowSince >= SLOW_FOR * 1000) {
      this.slow = { speed: h.speed || 0, eta: h.eta, since: this.slowSince }
      this.changed()
    }
  }

  // 0..1 across the plan, weighted by each step's typical time
  overall() {
    const live = this.steps.filter((s) => s.status !== 'skipped')
    const total = live.reduce((a, s) => a + s.secs, 0) || 1
    const t = this.now()
    let got = 0
    for (const s of live) {
      if (s.status === 'done') got += s.secs
      else if (s.status === 'running' || s.status === 'failed') got += s.secs * (s.percent != null ? s.percent / 100 : Math.min(0.9, (t - s.startedAt) / 1000 / s.secs))
    }
    // never back: a step that starts reporting its own percentage can read lower than the time-based guess before it
    this.peak = this.ok ? 1 : Math.max(this.peak, Math.min(0.99, got / total))
    return this.peak
  }
  // about how many seconds are left: a running step from its own percentage when it has one, else its typical time
  remaining() {
    if (this.finishedAt) return 0
    const t = this.now()
    let left = 0
    for (const s of this.steps) {
      if (s.status === 'waiting') left += s.secs
      else if (s.status === 'running' && s.eta != null) left += s.eta
      else if (s.status === 'running') {
        const spent = (t - s.startedAt) / 1000
        left += s.percent > 3 ? (spent * (100 - s.percent)) / s.percent : Math.max(s.secs - spent, Math.min(60, s.secs * 0.2))
      }
    }
    return Math.round(left)
  }
  snapshot() {
    const t = this.now()
    return {
      provider: this.provider,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      elapsed: Math.round(((this.finishedAt || t) - this.startedAt) / 1000),
      remaining: this.remaining(),
      overall: Math.round(this.overall() * 1000) / 10,
      ok: this.ok,
      error: this.error,
      perHour: this.perHour,
      slow: this.finishedAt ? null : this.slow,
      steps: this.steps.map(({ id, label, typical, status, startedAt, doneAt, percent, detail }) => ({ id, label, typical, status, percent, detail, seconds: startedAt ? Math.round(((doneAt || t) - startedAt) / 1000) : null }))
    }
  }
}

// "12:04", "1:02:30"
export function clock(secs) {
  const s = Math.max(0, Math.round(secs || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}
// "about 25 minutes", "about a minute", "less than a minute"
export function about(secs) {
  if (secs < 45) return 'less than a minute'
  const m = Math.round(secs / 60)
  if (m <= 1) return 'about a minute'
  if (m < 90) return `about ${m} minutes`
  const h = Math.round((secs / 3600) * 2) / 2
  return `about ${h} hour${h === 1 ? '' : 's'}`
}
