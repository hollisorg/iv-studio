// Refine faces (src/service/facerefine.js): the graph built on IV Studio's H3 files, without ComfyUI.
//   node test/facerefine.mjs
import assert from 'node:assert/strict'
import { FACE_DETECTOR, FACE_STRENGTHS, FACE_TURBO, facePromptFor, faceRefineGraph } from '../src/service/facerefine.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log(`ok  ${name}`))
const linked = (g) => {
  for (const [id, node] of Object.entries(g)) for (const [k, v] of Object.entries(node.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') assert.ok(g[v[0]], `${id}.${k} points at ${v[0]}, which isn't there`)
}

ok('with a face picture and a character LoRA: identity, reference, LoRA after the turbo, the source sound kept', () => {
  const g = faceRefineGraph({ video: 'F:/x/shot.mp4', face: 'iv_studio/faces/tess.jpg', lora: { name: 'MiniMax H3/tess/tess.safetensors', strength: 0.8 }, who: 'Tess', fps: 24, prefix: 'H3/enhanced/shot_faces' })
  linked(g)
  assert.equal(g.track.inputs.detector, FACE_DETECTOR)
  assert.deepEqual(g.track.inputs.identity_reference, ['face', 0])
  assert.equal(g.track.inputs.absent_shots, undefined, 'a small face that doesn\'t match yet must still be refined')
  assert.deepEqual(g.cond.inputs['ref_images.ref_image_0'], ['face', 0])
  assert.deepEqual(g.cond.inputs['ref_audios.ref_audio_0'], ['load', 2])
  assert.equal(g.turbo.inputs.lora_name, FACE_TURBO)
  assert.deepEqual(g.lora.inputs.model, ['turbo', 0])
  assert.deepEqual(g.per.inputs.model, ['lora', 0])
  assert.equal(g.sigmas.inputs.denoise, FACE_STRENGTHS.normal)
  assert.deepEqual(g.stitch.inputs.base_images, ['load', 0])
  assert.deepEqual(g.save.inputs.audio, ['load', 2])
  assert.equal(g.save.inputs.filename_prefix, 'H3/enhanced/shot_faces')
  assert.match(g.cond.inputs.prompt, /Tess, the person in <Picture 1>/)
})
ok('without a picture: the largest face, no reference, no LoRA', () => {
  const g = faceRefineGraph({ video: { cls: 'VHS_LoadVideo', video: 'a.mp4 [output]' }, strength: 0.3 })
  linked(g)
  assert.equal(g.load.class_type, 'VHS_LoadVideo')
  assert.equal(g.face, undefined)
  assert.equal(g.track.inputs.identity_reference, undefined)
  assert.equal(g.cond.inputs['ref_images.ref_image_0'], undefined)
  assert.equal(g.lora, undefined)
  assert.deepEqual(g.per.inputs.model, ['turbo', 0])
  assert.equal(g.sigmas.inputs.denoise, 0.3)
  assert.ok(!/Picture 1/.test(facePromptFor({})))
})
console.log(`${n} checks passed`)
