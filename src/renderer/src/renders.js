// A render someone just started, handed to the render hub (RenderHub.jsx): it opens the render pop-up, follows the
// render, and when it's done drops a "ready" announcement that opens with a reveal, from any page.
//   video: { kind: 'video', job, projectId, name }   (a shot's hunt; a One final follows its own finish)
//   image: { kind: 'image', set, name }              (a picture set from Create → Image)
// whether the pop-up opens when a render starts ("Don't open this when a render starts" turns it off, on this PC)
export const POPUP_KEY = 'iv.renderPopup'
export function renderPopupOn() {
  try {
    return localStorage.getItem(POPUP_KEY) !== 'off'
  } catch {
    return true
  }
}
export function startRender(detail) {
  window.dispatchEvent(new CustomEvent('iv:render', { detail }))
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

// Where a picture set stands
export function imageState(set) {
  if (!set) return { stage: 'queued', pct: 0 }
  if (set.status === 'success') return { stage: 'done', pct: 100 }
  if (set.status === 'error' || set.status === 'cancelled') return { stage: 'failed', error: set.error || 'It stopped.' }
  const pct = set.progress?.max ? Math.round((100 * set.progress.value) / set.progress.max) : 0
  return { stage: set.status === 'running' ? 'running' : 'queued', pct, position: set.queuePosition }
}

// What the reveal shows: the finished picture, or the video (a finished version first, else a take)
export function revealMedia(render, state, set = null) {
  if (render.kind === 'image') {
    const f = set?.files?.[0]
    return f ? { kind: 'image', file: f, more: Math.max(0, (set.files?.length || 1) - 1) } : null
  }
  const outs = state?.job?.outputs || []
  const o = outs.find((x) => x.kind === 'final') || outs.find((x) => x.kind === 'preview')
  return o ? { kind: 'video', file: o.path || null, url: o.url || null, more: outs.filter((x) => x.kind === 'preview').length - 1 } : null
}
