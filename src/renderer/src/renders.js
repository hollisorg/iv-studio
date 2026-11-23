// A render someone just started, handed to the render hub (RenderHub.jsx): it opens the render pop-up, follows the
// render, and when it's done drops a "ready" announcement that opens with a reveal, from any page.
//   video: { kind: 'video', job, projectId, name }   (a shot's hunt; a One final follows its own finish)
//   image: { kind: 'image', set, name }              (a picture set from Create → Image)
//   jobs:  { kind: 'jobs', jobs: [job or id], name, open, what }   (any tool's IV Studio jobs, followed until all are done)
//   task:  { kind: 'task', promise, media(result), name, open, what }   (a call that returns when it's done: Effects)
//   poll:  { kind: 'poll', id, poll() -> { stage, pct, error, media }, name, open, what }   (a tool that runs its own steps)
// open: where Open it goes ({ page, id }, App's openTarget); what: what's ready ('shot', 'pictures', 'song', 'sound',
// 'effect', 'take', 'video'), for its words.
// Settings → Accessibility (and the welcome setup): renderPopup, whether the pop-up opens when a render starts;
// readyFx, how a finished render is announced: 'full' (the drop and the crate reveal), 'simple' (the drop and the card,
// nothing moving) or 'off' (a short notice). App hands the settings over whenever they change.
export const READY_FX = [
  ['full', 'Celebrate', 'A drop lands in the corner; click it and a crate bursts open to show what you made.'],
  ['simple', 'Simple', 'The drop and the card that shows it, with nothing moving.'],
  ['off', 'Just a notice', 'A short message at the bottom, nothing else.']
]
let prefs = { popup: true, fx: 'full' }
export function setRenderPrefs(s) {
  prefs = { popup: s?.renderPopup !== false, fx: READY_FX.some(([id]) => id === s?.readyFx) ? s.readyFx : 'full' }
}
export const renderPopupOn = () => prefs.popup
export const readyFx = () => prefs.fx
export function startRender(detail) {
  window.dispatchEvent(new CustomEvent('iv:render', { detail }))
}

// The IV Studio jobs in what a tool's call returned: a job, a list of them, { started: [{ jobId }] } (hunt all),
// { jobs } or { session, jobs } (Remake)
export function jobsOf(r) {
  if (!r || typeof r !== 'object') return []
  if (Array.isArray(r)) return r.flatMap(jobsOf)
  if ('promptId' in r && r.id) return [r]
  if (Array.isArray(r.started)) return r.started.map((x) => x.jobId).filter(Boolean)
  if (Array.isArray(r.jobs)) return r.jobs.flatMap((j) => (typeof j === 'string' ? [j] : jobsOf(j)))
  return []
}
// A tool's render call, handed to the hub as it starts: returns what the call returned, unchanged.
//   await track(window.ivstudio.sequences.take(id), { open: { page: 'sequence', id }, what: 'take', name })
export async function track(call, { name = null, open = null, what = null } = {}) {
  const r = await call
  const jobs = jobsOf(r)
  if (jobs.length) startRender({ kind: 'jobs', jobs, name, open, what })
  return r
}
// Rebuild's takes, as the hub sees them: done when every shot's take is ready to pick or finished (Rebuild then waits
// for the person), failed when every one failed
export async function rebuildProgress(id) {
  const r = await window.ivstudio.rebuild.get(id)
  const takes = (r?.shots || []).map((s) => s.take).filter(Boolean)
  const ok = (t) => t.final || ['pick', 'success', 'finished'].includes(t.status)
  const bad = (t) => ['error', 'cancelled'].includes(t.status)
  if (r?.status === 'ready' || (takes.length && takes.every((t) => ok(t) || bad(t)) && takes.some(ok))) return { stage: 'done', pct: 100, note: takes.some((t) => t.status === 'pick' && !t.final) ? 'Pick a take for each shot to finish them.' : null }
  if (takes.length && takes.every(bad)) return { stage: 'failed', error: 'Every shot stopped.' }
  const done = takes.filter((t) => ok(t) || bad(t)).length
  return { stage: 'running', pct: takes.length ? Math.round((100 * done) / takes.length) : 0, count: takes.length, done, label: 'Rendering the shots' }
}
// Sizzle's pieces (stills and H3 shots): done when it says it's ready
export async function sizzleProgress(id) {
  const s = await window.ivstudio.sizzle.get(id)
  if (!s) return null
  if (['ready', 'editing'].includes(s.status)) return { stage: 'done', pct: 100 }
  const parts = Object.values(s.assets || {}).filter((a) => a && a.kind !== 'audio')
  const done = parts.filter((a) => ['success', 'error', 'cancelled'].includes(a.status) || a.final).length
  if (parts.length && parts.every((a) => ['error', 'cancelled'].includes(a.status))) return { stage: 'failed', error: 'Every piece stopped.' }
  return { stage: 'running', pct: parts.length ? Math.round((100 * done) / parts.length) : 0, count: parts.length, done, label: 'Making the pieces' }
}

// A shot made inside an edit (Edit → Generate): done when it's on the timeline, or its takes wait to be picked
export async function editGenProgress(editId, genId) {
  const gens = await window.ivstudio.edits.gens(editId)
  const g = (Array.isArray(gens) ? gens : gens?.gens || []).find((x) => x.id === genId)
  if (!g) return null
  if (g.status === 'done') return { stage: 'done', pct: 100 }
  if (g.status === 'pick') return { stage: 'done', pct: 100, note: 'Pick a take on the timeline to finish it.' }
  if (g.status === 'error' || g.status === 'cancelled') return { stage: 'failed', error: g.error || 'It stopped.' }
  return { stage: g.status === 'finishing' ? 'finishing' : 'running', pct: 0, label: g.status === 'finishing' ? 'Finishing' : 'Rendering' }
}
// what a reframe, an effect or a cut-out on the Edit page made: the file it put on the timeline
export const madeFile = (r) => {
  const f = r?.file || r?.media?.path || r?.files?.find?.((x) => x.kind === 'video')?.file || r?.files?.[0]?.file
  return f ? { kind: mediaKind(f), file: f } : null
}

// A job's file name as words, for a render with no name of its own: kitchen_letter_ac82a1a9_v1 → Kitchen letter
export function jobTitle(name = '') {
  const words = String(name)
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[_\s]+/)
    .filter((w) => w && !/^[0-9a-f]{6,}$/i.test(w) && !/^(r|v|c|take|shot|mv|kf)?\d+$/i.test(w) && !/^\d+$/.test(w))
    .join(' ')
  return words ? words[0].toUpperCase() + words.slice(1) : ''
}

// Where a video render stands, from its jobs: the take, then (One final) the finish it starts by itself.
// { stage: 'queued' | 'running' | 'finishing' | 'done' | 'failed', pct, position, job (the one that matters), error }
export function videoState(job, jobs = {}) {
  if (!job) return { stage: 'queued', pct: 0 }
  const finish = job.autoFinishJob ? jobs[job.autoFinishJob] || { id: job.autoFinishJob, status: 'queued' } : null
  const pctOf = (j) => (j?.progress?.max ? Math.round((100 * j.progress.value) / j.progress.max) : 0)
  if (job.status === 'error' || job.status === 'cancelled') return { stage: 'failed', job, error: job.explain?.title || job.error || 'It stopped.' }
  if (job.status === 'success' && job.plan?.autoFinish) {
    if (job.autoFinishError) return { stage: 'failed', job, error: job.autoFinishError }
    if (!finish) return { stage: 'finishing', pct: 0, job }
    if (finish.status === 'success') return { stage: 'done', job: finish, pct: 100 }
    if (finish.status === 'error' || finish.status === 'cancelled') return { stage: 'failed', job: finish, error: finish.explain?.title || finish.error || 'The finish stopped.' }
    return { stage: 'finishing', pct: pctOf(finish), job: finish, position: finish.queuePosition }
  }
  if (job.status === 'success') return { stage: 'done', job, pct: 100 }
  if (job.status === 'running') return { stage: 'running', pct: pctOf(job), job }
  return { stage: 'queued', pct: 0, job, position: job.queuePosition }
}

// Where several jobs stand together: failed if one failed, done when all are, else the furthest behind leads
export function jobsState(list = [], jobs = {}) {
  const states = list.map((j) => videoState(typeof j === 'string' ? jobs[j] || { id: j, status: 'queued' } : jobs[j.id] || j, jobs))
  if (!states.length) return { stage: 'queued', pct: 0 }
  const failed = states.find((s) => s.stage === 'failed')
  if (failed) return failed
  if (states.every((s) => s.stage === 'done')) return { stage: 'done', pct: 100, job: states[states.length - 1].job, jobsDone: states.map((s) => s.job) }
  const pct = Math.round(states.reduce((a, s) => a + (s.stage === 'done' ? 100 : s.pct || 0), 0) / states.length)
  const stage = states.some((s) => s.stage === 'running' || s.stage === 'finishing') ? (states.some((s) => s.stage === 'finishing') ? 'finishing' : 'running') : 'queued'
  const position = states.map((s) => s.position).filter(Boolean).sort((a, b) => a - b)[0]
  return { stage, pct, position, count: states.length, done: states.filter((s) => s.stage === 'done').length }
}

// The words for what's ready
export const READY = { shot: 'Your shot is ready', pictures: 'Pictures ready', song: 'Your song is ready', sound: 'Your sound is ready', effect: 'Your effect is ready', take: 'Your take is ready', video: 'Your video is ready', frames: 'Your frames are ready' }
export const readyWords = (r) => READY[r.what] || (r.kind === 'image' ? READY.pictures : READY.shot)

// Where a picture set stands
export function imageState(set) {
  if (!set) return { stage: 'queued', pct: 0 }
  if (set.status === 'success') return { stage: 'done', pct: 100 }
  if (set.status === 'error' || set.status === 'cancelled') return { stage: 'failed', error: set.error || 'It stopped.' }
  const pct = set.progress?.max ? Math.round((100 * set.progress.value) / set.progress.max) : 0
  return { stage: set.status === 'running' ? 'running' : 'queued', pct, position: set.queuePosition }
}

// What a file is, from its name
export const mediaKind = (f) => (/\.(png|jpe?g|webp|bmp|gif)$/i.test(f || '') ? 'image' : /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(f || '') ? 'audio' : 'video')

// What the reveal shows: the finished picture, or the video (a finished version first, else a take), or a song
export function revealMedia(render, state, set = null) {
  if (render.kind === 'image') {
    const f = set?.files?.[0]
    return f ? { kind: 'image', file: f, more: Math.max(0, (set.files?.length || 1) - 1) } : null
  }
  if (render.kind === 'task' || render.kind === 'poll') return state?.media || null
  const outs = state?.job?.outputs || []
  const o = outs.find((x) => x.kind === 'final') || outs.find((x) => x.kind === 'preview') || outs.find((x) => ['audio', 'image', 'master', 'video'].includes(x.kind)) || outs.find((x) => x.path)
  if (!o) return null
  const file = o.path || null
  const kind = o.kind === 'audio' ? 'audio' : o.kind === 'image' ? 'image' : mediaKind(file || o.filename)
  const others = (state?.jobsDone?.length || 1) - 1 + Math.max(0, outs.filter((x) => x.kind === 'preview').length - 1)
  return { kind, file, url: o.url || null, more: others, candidate: o.kind === 'preview' ? o.candidate || 1 : null, jobId: state?.job?.id || null }
}

// What the reveal can do next. again: the same H3 shot with a new seed (H3 only: Seedance would spend credits), or the
// same pictures made again; finish: the take it shows, finished at full size (a hunt's take, not yet finished).
export function nextSteps(render, state, media) {
  const job = state?.job
  const h3 = job && !job.plan?.engine
  const again = (render.kind === 'video' && h3 && !!job.plan?.asked) || (render.kind === 'image' && ['generate', 'edit'].includes(render.set?.mode))
  // Create's own shots only: the tools (Keyframes, Sequences...) finish through their own steps, which keep their records
  const finish = !!(render.kind === 'video' && h3 && job.kind === 'previews' && !job.plan?.autoFinish && media?.candidate)
  return { again, finish }
}
// The request for Again: the run as it was asked (its words, media and character), with a new seed; a One final
// finishes itself again
export function againRequest(job, seed = Math.floor(Math.random() * 1e9)) {
  const q = job.plan?.request || {}
  const a = job.plan?.asked || {}
  const keep = ['engine', 'aspect', 'megapixels', 'seconds', 'previews', 'steps', 'sampler', 'scheduler', 'overlapFrames', 'refmods', 'retention', 'extraLoras', 'photoSize', 'speed', 'continueFull', 'writtenBy']
  const af = job.plan?.autoFinish
  return {
    ...Object.fromEntries(keep.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])),
    prompt: a.prompt ?? q.prompt,
    mode: a.mode || q.mode,
    character: a.character ?? q.character ?? 'none',
    with: a.with || [],
    media: (a.media || []).map((m) => ({ kind: m.kind, file: m.file, ...(m.softMouth ? { softMouth: true } : {}) })),
    voiceLine: a.voiceLine || null,
    seed,
    projectId: job.projectId,
    ...(af ? { autoFinish: { megapixels: af.megapixels, enhancer: af.enhancer, ...(af.upscale2x != null ? { upscale2x: af.upscale2x } : {}) } } : {})
  }
}

// ---------- The renders the hub follows, for whoever wants to show them (the tray, the Dashboard) ----------
let current = []
const watchers = new Set()
export function publishRenders(list) {
  current = list
  for (const fn of watchers) fn(list)
}
export function watchRenders(fn) {
  watchers.add(fn)
  fn(current)
  return () => watchers.delete(fn)
}
export const isRunning = (r) => !['done', 'failed'].includes(r?.state?.stage)

// ---------- Quiet hours (Settings → Accessibility): no pop-ups or celebrations between two times, or while editing
// full screen; finished renders wait and are announced together when it's over ----------
let quiet = { on: false, from: '22:00', to: '07:00', editor: true }
export function setQuietHours(q) {
  quiet = { on: !!q?.on, from: /^\d\d:\d\d$/.test(q?.from || '') ? q.from : '22:00', to: /^\d\d:\d\d$/.test(q?.to || '') ? q.to : '07:00', editor: q?.editor !== false }
}
export const quietHours = () => quiet
// whether now (minutes since midnight) is inside from..to, which may run past midnight
export function inQuietWindow(q, minutes) {
  if (!q?.on) return false
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  const a = m(q.from)
  const b = m(q.to)
  return a === b ? false : a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b
}
export function isQuiet(now = new Date(), editing = false) {
  return inQuietWindow(quiet, now.getHours() * 60 + now.getMinutes()) || (quiet.editor && editing)
}

// ---------- Frame Hunt's best (kept on this PC) ----------
const BEST_KEY = 'iv.frameHuntBest'
export function frameHuntBest() {
  try {
    const b = JSON.parse(localStorage.getItem(BEST_KEY) || 'null')
    return b && Number.isFinite(b.score) ? b : { score: 0, level: 1 }
  } catch {
    return { score: 0, level: 1 }
  }
}
export function keepFrameHuntBest(score, level) {
  const b = frameHuntBest()
  if (score <= b.score) return false
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify({ score, level, at: Date.now() }))
  } catch {}
  return true
}

// ---------- Quick finals (Create → Shape and size): a One final setup in one click ----------
// built in, then the person's own (settings.quickFinals); each sets One final and only these fields
export const QUICK_FINALS = [
  { id: 'photo-2-none', label: 'Photo shape · 2 MP · no enhancer', matchPhoto: true, finalMp: 2, finalEnhancer: 'none', framesOnly: true },
  { id: '2-none', label: '2 MP · no enhancer', finalMp: 2, finalEnhancer: 'none' },
  { id: '2-dlss', label: '2 MP · DLSS 5', finalMp: 2, finalEnhancer: 'dlss' },
  { id: '15-seedvr2', label: '1.5 MP · SeedVR2', finalMp: 1.5, finalEnhancer: 'seedvr2' }
]
const QUICK_KEYS = ['matchPhoto', 'aspect', 'finalMp', 'finalEnhancer', 'megapixels', 'steps']
// a quick final from the form as it is now, named by what it does
export function quickFinalOf(form) {
  const q = Object.fromEntries(QUICK_KEYS.filter((k) => form[k] !== undefined).map((k) => [k, form[k]]))
  // the photo's own shape only counts in First / last frame; elsewhere it's the aspect
  q.matchPhoto = !!(form.matchPhoto && form.mode === 'frames')
  const enh = { none: 'no enhancer', dlss: 'DLSS 5', seedvr2: 'SeedVR2' }[q.finalEnhancer] || q.finalEnhancer
  return { id: `mine-${Date.now().toString(36)}`, label: `${q.matchPhoto ? 'Photo shape' : q.aspect} · ${q.finalMp} MP · ${enh}${q.steps === 4 ? ' · Draft' : ''}`, ...q }
}
// what a quick final changes in the form: One final on, and its own fields
export function applyQuickFinal(form, q) {
  const patch = { oneFinal: true }
  for (const k of QUICK_KEYS) if (q[k] !== undefined) patch[k] = q[k]
  if (q.matchPhoto === undefined && q.aspect) patch.matchPhoto = false
  return { ...form, ...patch }
}
export const sameQuickFinal = (form, q) => !!form.oneFinal && QUICK_KEYS.every((k) => q[k] === undefined || (k === 'matchPhoto' ? !!(form.matchPhoto && form.mode === 'frames') === q[k] : k === 'aspect' && form.matchPhoto && form.mode === 'frames' ? false : form[k] === q[k]))
