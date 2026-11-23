// Create's Shape and size options: "Same as photo" (a First / last frame shot takes its first frame's own shape,
// plan.js photoSize, ltx.js), a finish with no enhancer (plan.js enhancer 'none': no DLSS 5, no SeedVR2), and One
// final (studio.js autoFinish: the one take is finished as soon as it's done).  node test/shape-options.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { nearestAspect, photoRatio, planFinish, planPreviews, resolveSize, skipsDlss } from '../src/service/plan.js'
import { buildPrompt, checkPrompt } from '../src/service/graph.js'
import { adaptGraph } from '../src/service/remote.js'
import { planLtx } from '../src/service/ltx.js'
import { Studio } from '../src/service/studio.js'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const meta = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.groups.json', 'utf8'))
const chars = [{ id: 'tess', name: 'Tess', lora: 'tess.safetensors', strength: 0.8, trigger: 't3ss4' }]
const frames = { mode: 'frames', prompt: '{char} turns to the camera.', character: 'tess', megapixels: 0.4, media: [{ kind: 'picture', file: 'minimax_h3/first.png' }] }
// a phone photo, portrait
const phone = { width: 1179, height: 2096 }

let n = 0
let failed = 0
const ok = async (name, fn) => {
  n++
  try {
    await fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const graph = (plan) => {
  const g = buildPrompt(template, meta, plan.groups, plan.values)
  assert.deepEqual(checkPrompt(g), [])
  return g
}

await ok('Same as photo: the shot is made at the photo’s own shape, every size reader gets it', () => {
  const p = planPreviews({ ...frames, aspect: '16:9', photoSize: phone }, chars)
  const { width, height } = p.resolved
  assert.ok(width % 32 === 0 && height % 32 === 0)
  assert.ok(Math.abs(width / height - phone.width / phone.height) < 0.03, `${width}x${height} keeps ${phone.width}x${phone.height}`)
  assert.ok(Math.abs((width * height) / (1024 * 1024) - 0.4) < 0.05, 'about the preview size asked for')
  const g = graph(p)
  assert.equal(g['204'].inputs.width, width)
  assert.equal(g['204'].inputs.height, height)
  // and the finish's 2 MP pass keeps the shape (the latent upscaler sizes from the take)
  const f = planFinish(p, { megapixels: 2 })
  assert.ok(Math.abs(f.resolved.width / f.resolved.height - width / height) < 0.03)
})

await ok('Same as photo only applies to First / last frame; without a size the aspect tile stands', () => {
  const text = planPreviews({ ...frames, mode: 'text', media: [], aspect: '16:9', photoSize: phone }, chars)
  assert.deepEqual({ width: text.resolved.width, height: text.resolved.height }, resolveSize('16:9', 0.4))
  assert.equal(graph(text)['102'].inputs.width[0], '501', 'text mode still reads the ResolutionSelector')
  const plain = planPreviews({ ...frames, aspect: '16:9' }, chars)
  assert.deepEqual({ width: plain.resolved.width, height: plain.resolved.height }, resolveSize('16:9', 0.4))
})

await ok('photoRatio and nearestAspect: kept between 21:9 and 9:21; bad sizes give null', () => {
  assert.deepEqual(photoRatio({ width: 3000, height: 1000 }), [21 / 9, 1])
  assert.deepEqual(photoRatio({ width: 1000, height: 3000 }), [1, 21 / 9])
  assert.equal(photoRatio({ width: 0, height: 10 }), null)
  assert.equal(photoRatio(null), null)
  assert.equal(nearestAspect(phone), '9:16')
  assert.equal(nearestAspect({ width: 4032, height: 3024 }), '4:3')
  assert.equal(nearestAspect({ width: 6000, height: 4000 }), '3:2')
})

await ok('LTX: a First / last frame take takes the photo’s shape too', () => {
  const p = planLtx({ mode: 'frames', prompt: 'x', aspect: '16:9', photoSize: phone, media: [{ kind: 'picture', file: 'a.png' }] })
  assert.ok(p.resolved.height > p.resolved.width, 'portrait')
  assert.ok(Math.abs(p.resolved.width / p.resolved.height - phone.width / phone.height) < 0.04)
  const t = planLtx({ mode: 'text', prompt: 'x', aspect: '16:9', photoSize: phone })
  assert.ok(t.resolved.width > t.resolved.height, 'text mode keeps the aspect')
})

await ok('a finish with no enhancer: no 2x, no extra frames, DLSS 5 swapped for a plain save, final at the 2 MP size', () => {
  const p = planPreviews({ ...frames, aspect: '16:9' }, chars)
  const f = planFinish(p, { megapixels: 2, enhancer: 'none', upscale2x: true, fps: 60 })
  assert.equal(f.finish.upscale2x, false)
  assert.equal(f.finish.fps, 0)
  assert.deepEqual({ width: f.resolved.width, height: f.resolved.height }, f.resolved.upscaleSize)
  assert.equal(f.resolved.fps, 24)
  assert.ok(skipsDlss(f.finish) && skipsDlss({ enhancer: 'seedvr2' }) && !skipsDlss({ enhancer: 'dlss' }))
  const built = graph(f)
  assert.ok(Object.values(built).some((x) => x.class_type === 'DLSS5_Enhance_Video'), 'the template has DLSS')
  const g = adaptGraph(built, { dlss: false, upscale2x: false, rife: false, fps: [0] })
  assert.ok(!Object.values(g).some((x) => x.class_type === 'DLSS5_Enhance_Video'), 'no DLSS left')
  assert.equal(g['50'].class_type, 'VHS_SelectFilename', 'the DLSS node answers with the plain save’s path')
  assert.deepEqual(g['51'].inputs.source, ['50', 0], 'node 51 still reports it as the final')
  assert.throws(() => planFinish(p, { enhancer: 'topaz' }), /enhancer must be dlss, seedvr2, none/)
})

await ok('One final: a finished take starts its finish once, with the settings it was asked for', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-shape-'))
  const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: 'http://127.0.0.1:9' })
  const p = planPreviews({ ...frames, previews: 1, aspect: '16:9' }, chars)
  p.autoFinish = { megapixels: 2, enhancer: 'none', candidate: 1 }
  const job = { id: 'job1', kind: 'previews', projectId: null, name: 'x', promptId: 'p1', status: 'running', plan: p, outputs: [] }
  fs.mkdirSync(path.dirname(studio.jobFile('job1')), { recursive: true })
  fs.writeFileSync(studio.jobFile('job1'), JSON.stringify(job))
  studio.comfy.history = async () => ({ p1: { status: { status_str: 'success', messages: [] }, outputs: {} } })
  const asked = []
  studio.finishCandidate = async (opts) => (asked.push(opts), { id: 'fin1' })
  const done = await studio.refreshJob('job1')
  assert.deepEqual(asked, [{ jobId: 'job1', megapixels: 2, enhancer: 'none', candidate: 1 }])
  assert.equal(done.autoFinishJob, 'fin1')
  assert.deepEqual(done.plan.autoFinish, p.autoFinish, 'the shot page can see it was a One final')
  await studio.refreshJob('job1')
  assert.equal(asked.length, 1, 'only once')
  // a failed start is kept, never retried by itself
  const j2 = { ...job, id: 'job2', promptId: 'p2', status: 'running' }
  fs.writeFileSync(studio.jobFile('job2'), JSON.stringify(j2))
  studio.comfy.history = async () => ({ p2: { status: { status_str: 'success', messages: [] }, outputs: {} } })
  studio.finishCandidate = async () => {
    throw new Error('ComfyUI went away')
  }
  const failed2 = await studio.refreshJob('job2')
  assert.equal(failed2.autoFinishError, 'ComfyUI went away')
})

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
