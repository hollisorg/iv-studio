// The 2 MP pass in a finish (plan.js planFinish, node 25): a First / last frame or Keyframes shot with no character
// LoRA is finished lightly (FRAMES_REFINE), because that pass is guided by the words alone and 0.4 redrew the face
// (Tess's green eyes came out brown, 2026-11-23). Anything else keeps the template's tested 0.4.  node test/frames-finish.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { FRAMES_REFINE, picturesOnly, planFinish, planPreviews } from '../src/service/plan.js'
import { buildPrompt, checkPrompt } from '../src/service/graph.js'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const meta = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.groups.json', 'utf8'))
const chars = [{ id: 'tess', name: 'Tess', lora: 'tess.safetensors', strength: 0.8, trigger: 't3ss4' }]
const frames = { mode: 'frames', prompt: 'x', character: 'none', media: [{ kind: 'picture', file: 'minimax_h3/a.png' }] }

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const denoise = (finish) => {
  const g = buildPrompt(template, meta, finish.groups, finish.values)
  assert.deepEqual(checkPrompt(g), [])
  return g['25'].inputs.denoise
}

ok('the template’s 2 MP pass is 0.4, and in frames mode it is guided by the words alone (205, not 204)', () => {
  assert.equal(template['25'].inputs.denoise, 0.4)
  assert.deepEqual(template['26'].inputs.conditioning, ['1104', 0])
  assert.deepEqual(template['1104'].inputs.conditioning, ['404', 0])
  assert.deepEqual(template['404'].inputs.any_02, ['205', 0])
  assert.equal(template['205'].inputs.first_frame, undefined, 'node 205 carries no picture')
  assert.ok(template['204'].inputs.first_frame, 'the take’s guide (204) does')
})

ok('a First / last frame shot with no character: the 2 MP pass is light', () => {
  const p = planPreviews(frames, chars)
  const f = planFinish(p, {})
  assert.equal(f.finish.refineDenoise, FRAMES_REFINE)
  assert.equal(denoise(f), FRAMES_REFINE)
})

ok('Keyframes (H3Keyframes in frames mode, no character) too', () => {
  const p = planPreviews({ ...frames, media: [1, 2, 3].map((k) => ({ kind: 'picture', file: `minimax_h3/k${k}.png` })), keyframes: { positions: [0, 120, 240] } }, chars)
  assert.ok(p.patch, 'the keyframes patch')
  assert.equal(denoise(planFinish(p, { candidate: 1 })), FRAMES_REFINE)
})

ok('with a character LoRA, or in other modes, the tested 0.4 stays', () => {
  assert.equal(denoise(planFinish(planPreviews({ ...frames, character: 'tess' }, chars), {})), 0.4)
  assert.equal(denoise(planFinish(planPreviews({ mode: 'text', prompt: 'x', character: 'none' }, chars), {})), 0.4)
  assert.equal(planFinish(planPreviews({ mode: 'text', prompt: 'x', character: 'none' }, chars), {}).finish.refineDenoise, undefined)
})

ok('a finish that sets its own strength keeps it, and a strength out of range is refused', () => {
  const p = planPreviews(frames, chars)
  assert.equal(denoise(planFinish(p, { refineDenoise: 0.3 })), 0.3)
  assert.throws(() => planFinish(p, { refineDenoise: 0.9 }), /refineDenoise must be between/)
})

ok('picturesOnly reads the request', () => {
  assert.equal(picturesOnly({ mode: 'frames', character: 'none' }), true)
  assert.equal(picturesOnly({ mode: 'frames' }), true)
  assert.equal(picturesOnly({ mode: 'frames', character: 'tess' }), false)
  assert.equal(picturesOnly({ mode: 'reference', character: 'none' }), false)
  assert.equal(picturesOnly(null), false)
})

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
