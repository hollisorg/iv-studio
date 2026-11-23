// A render ComfyUI forgot (it restarted, or its queue was cleared, before the render finished): before, the job stayed
// "queued" for good, because refreshJob only learns an outcome from ComfyUI's history or its queue, and a restart
// clears both. Now it's marked failed with a plain reason (failures.js 'lost') and Try again. Stand-in ComfyUI only.
//   node test/lost-jobs.mjs
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Studio, LOST_JOB } from '../src/service/studio.js'
import { explainFailure } from '../src/service/failures.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}

// the stand-in: its queue and history are set by each case; `finishOnSecondAsk` puts a prompt into history only the
// second time it's asked about (the render finishing between refreshJob's history and queue questions)
const comfy = { running: [], pending: [], history: {}, finishOnSecondAsk: null, asked: {}, deleted: [] }
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/queue' && req.method === 'GET') return res.end(JSON.stringify({ queue_running: comfy.running.map((p, i) => [i, p]), queue_pending: comfy.pending.map((p, i) => [i + 10, p]) }))
  if (u.pathname === '/queue' && req.method === 'POST') return res.end('{}')
  const m = u.pathname.match(/^\/history\/(.+)$/)
  if (m) {
    const id = decodeURIComponent(m[1])
    comfy.asked[id] = (comfy.asked[id] || 0) + 1
    if (comfy.finishOnSecondAsk === id && comfy.asked[id] >= 2) return res.end(JSON.stringify({ [id]: { status: { status_str: 'success', messages: [] }, outputs: {} } }))
    return res.end(JSON.stringify(comfy.history[id] ? { [id]: comfy.history[id] } : {}))
  }
  res.end('{}')
})
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)))
const url = `http://127.0.0.1:${port}`

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-lost-'))
const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: url })
const job = (promptId, extra = {}) => {
  const j = studio.recordJob({ kind: 'previews', projectId: null, name: `case_${promptId}`, promptId, plan: { resolved: {} } })
  if (Object.keys(extra).length) studio.updateJob(j.id, extra)
  return j.id
}
const saved = (id) => JSON.parse(fs.readFileSync(studio.jobFile(id), 'utf8'))

try {
  // a new job remembers the ComfyUI it went to
  const a = job('p-waiting')
  check('a new job records the ComfyUI it went to', saved(a).server === url && saved(a).where === 'local')

  comfy.pending = ['p-waiting']
  let j = await studio.refreshJob(a)
  check('a job still in the queue stays queued, with its place', j.status === 'queued' && j.queuePosition === 1, JSON.stringify(j))

  comfy.pending = []
  comfy.running = ['p-waiting']
  j = await studio.refreshJob(a)
  check('a job ComfyUI is rendering is running', j.status === 'running')

  comfy.running = []
  comfy.history['p-waiting'] = { status: { status_str: 'success', messages: [] }, outputs: {} }
  j = await studio.refreshJob(a)
  check('a job in the history is finished', j.status === 'success' && !j.lost)

  // the case that used to hang: in neither
  const b = job('p-forgotten')
  j = await studio.refreshJob(b)
  check('a job in neither the queue nor the history is marked failed (lost)', j.status === 'error' && j.lost === true && j.error === LOST_JOB, JSON.stringify(j))
  check('it is saved that way, with a finish time', saved(b).status === 'error' && !!saved(b).finishedAt)
  check('the page explains it in plain words, with Try again', j.explain?.id === 'lost' && j.explain.title === 'ComfyUI lost this render' && j.explain.fixes[0]?.id === 'try-again', JSON.stringify(j.explain))
  check('asking again leaves it as it is', (await studio.refreshJob(b)).status === 'error')

  // a render that finishes between the history and queue answers is not lost
  const c = job('p-just-done')
  comfy.finishOnSecondAsk = 'p-just-done'
  j = await studio.refreshJob(c)
  check('a job that finished between the two questions is finished, not lost', j.status === 'success' && !j.lost, JSON.stringify(j))

  // only the ComfyUI the job went to can say it lost it
  const d = job('p-elsewhere', { server: 'http://127.0.0.1:8199' })
  j = await studio.refreshJob(d)
  check('a job sent to another ComfyUI address is left queued', j.status === 'queued' && !j.lost)
  const e = job('p-cloud', { where: 'cloud' })
  j = await studio.refreshJob(e)
  check('a job sent to the cloud is left queued while this PC’s ComfyUI is in use', j.status === 'queued' && !j.lost)
  const f = job('p-old', { server: undefined })
  j = await studio.refreshJob(f)
  check('a job saved before this fix (no address) is judged by where it ran: lost', j.status === 'error' && j.lost)

  // cancelling a job ComfyUI lost settles it instead of leaving it queued
  const g = job('p-cancel-lost')
  const r = await studio.cancelJob(g)
  check('Cancel on a lost job settles it as lost', r.result === 'not queued' && r.job.status === 'error' && r.job.lost)

  // ComfyUI not answering at all: it can't say anything, so the job stays as it is
  const h = job('p-down')
  server.close()
  await new Promise((res) => setTimeout(res, 100))
  j = await studio.refreshJob(h).catch((err) => ({ status: 'threw', note: err.message }))
  check('with ComfyUI down the job is not marked lost', saved(h).status === 'queued' && !saved(h).lost, JSON.stringify(j))

  // the cloud says it in its own words
  const cloud = explainFailure(LOST_JOB, { where: 'cloud' })
  check('on a cloud GPU the explanation names the cloud machine', cloud.id === 'lost' && /cloud GPU/.test(cloud.title) && /cloud machine/.test(cloud.why))
  check('no em dashes in the words', !/—/.test(LOST_JOB + cloud.title + cloud.why + explainFailure(LOST_JOB).why))
} finally {
  server.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
