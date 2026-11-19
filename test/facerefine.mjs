// Refine faces (src/service/facerefine.js): the graph built on IV Studio's H3 files, without ComfyUI.
//   node test/facerefine.mjs
import assert from 'node:assert/strict'
import { FACE_DETECTOR, FACE_STRENGTHS, FACE_TURBO, PLUS_NODES, facePromptFor, faceRefineGraph } from '../src/service/facerefine.js'
import { renameFiles } from '../src/service/comfy.js'

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
ok('with FaceRefine Plus: Stitch Plus, Flow Lock and Tone Match against the shot, saved from Tone Match; the redraw unchanged', () => {
  const opts = { video: 'F:/x/shot.mp4', face: 'iv_studio/faces/tess.jpg', lora: { name: 'MiniMax H3/tess/tess.safetensors', strength: 0.8 }, who: 'Tess' }
  const plain = faceRefineGraph(opts)
  const g = faceRefineGraph({ ...opts, plus: true })
  linked(g)
  assert.deepEqual(PLUS_NODES, ['H3FaceStitchPlus', 'H3FaceFlowLock', 'H3FaceToneMatch'])
  assert.equal(g.stitch.class_type, 'H3FaceStitchPlus')
  assert.deepEqual(g.stitch.inputs.refined_crops, ['decode', 0])
  assert.deepEqual(g.stitch.inputs.transform, ['track', 1])
  assert.equal(g.stitch.inputs.tone_mode, 'freq_sep')
  assert.deepEqual([g.lock.inputs.base_images, g.lock.inputs.refined_images], [['load', 0], ['stitch', 0]])
  assert.deepEqual([g.tone.inputs.source_images, g.tone.inputs.processed_images], [['load', 0], ['lock', 0]])
  assert.equal(g.tone.inputs.face_detector, FACE_DETECTOR)
  assert.deepEqual(g.save.inputs.images, ['tone', 0])
  assert.deepEqual(g.save.inputs.audio, ['load', 2])
  for (const k of ['track', 'cond', 'inject', 'per', 'sigmas', 'sample', 'decode']) assert.deepEqual(g[k], plain[k], `${k} is the same as without Plus`)
  assert.equal(plain.stitch.class_type, 'H3FaceStitch')
  assert.equal(plain.lock, undefined)
  assert.deepEqual(plain.save.inputs.images, ['stitch', 0])
})
ok('queueing keeps Tone Match’s detector a bare name (it adds ultralytics/bbox/ itself); other model names still map', () => {
  const g = renameFiles(faceRefineGraph({ video: 'F:/x/shot.mp4', plus: true }), { [FACE_DETECTOR]: `bbox/${FACE_DETECTOR}`, [FACE_TURBO]: `MiniMax H3/Turbo/${FACE_TURBO}` })
  assert.equal(g.tone.inputs.face_detector, FACE_DETECTOR)
  assert.equal(g.track.inputs.detector, `bbox/${FACE_DETECTOR}`)
  assert.equal(g.turbo.inputs.lora_name, `MiniMax H3/Turbo/${FACE_TURBO}`)
})
console.log(`${n} checks passed`)
