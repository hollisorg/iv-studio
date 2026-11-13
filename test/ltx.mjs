// LTX 2.5 as a second video model (src/service/ltx.js): sizes, lengths, the plan and the graphs, without ComfyUI.
//   node test/ltx.mjs
import assert from 'node:assert/strict'
import { LTX, LTX_FILES, ltxFrames, ltxGraph, ltxTakeSize, ltxTakes, planLtx } from '../src/service/ltx.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log(`ok  ${name}`))
const classOf = (g) => Object.values(g).map((x) => x.class_type)
// every [node, slot] input points at a node in the graph
const linked = (g) => {
  for (const [id, node] of Object.entries(g)) for (const [k, v] of Object.entries(node.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') assert.ok(g[v[0]], `${id}.${k} points at ${v[0]}, which isn't there`)
}

ok('a take is about 0.25 MP on the 32-pixel grid, and the finish doubles it', () => {
  assert.deepEqual(ltxTakeSize('16:9'), { width: 672, height: 384 })
  assert.deepEqual(ltxTakeSize('9:16'), { width: 384, height: 672 })
  const sq = ltxTakeSize('1:1')
  assert.equal(sq.width, sq.height)
  for (const a of ['16:9', '9:16', '1:1', '4:3', '21:9']) {
    const s = ltxTakeSize(a)
    assert.equal(s.width % 32, 0)
    assert.equal(s.height % 32, 0)
  }
})
ok('lengths are 8n+1 frames at 24 fps, from 2 to 20 seconds', () => {
  assert.equal(ltxFrames(5), 121)
  assert.equal(ltxFrames(10), 241)
  assert.equal(ltxFrames(0.5), 49, 'at least 2 s')
  assert.equal(ltxFrames(60), 481, 'at most 20 s')
  for (const s of [2, 3, 4.5, 7, 13]) assert.equal((ltxFrames(s) - 1) % 8, 0)
})
ok('the plan: text or first/last frame, takes and seeds; other modes are refused in words', () => {
  const p = planLtx({ prompt: 'A fox.', aspect: '16:9', seconds: 5, previews: 3, seed: 7 })
  assert.equal(p.request.engine, LTX)
  assert.deepEqual(p.resolved.seeds, [7, 1007, 2007])
  assert.equal(p.resolved.finalWidth, 1344)
  assert.equal(p.resolved.seconds, 5)
  assert.throws(() => planLtx({ prompt: 'x', mode: 'reference' }), /MiniMax H3 for References/)
  assert.throws(() => planLtx({ prompt: 'x', mode: 'continue' }), /Continue/)
  assert.throws(() => planLtx({ prompt: 'x', mode: 'frames' }), /first frame picture/)
  assert.throws(() => planLtx({ prompt: '  ' }), /Write what happens/)
  assert.deepEqual(planLtx({ prompt: 'x', mode: 'frames', media: [{ kind: 'picture', file: 'a.png' }, { kind: 'audio', file: 'v.wav' }, { kind: 'picture', path: 'b.png' }] }).frames, ['a.png', 'b.png'])
})
ok('takes: one half-size pass per take with its own seed, each saved with its sound', () => {
  const p = planLtx({ prompt: 'A fox.', seconds: 5, previews: 2, seed: 7 })
  const g = ltxGraph(p, { name: 'shot_r1' })
  linked(g)
  assert.equal(g.unet.inputs.unet_name, LTX_FILES.unet)
  assert.equal(g.clip.inputs.type, 'ltxv')
  assert.deepEqual([g.t1_noise.inputs.noise_seed, g.t2_noise.inputs.noise_seed], [7, 1007])
  assert.equal(g.emptyV.inputs.width, 672)
  assert.equal(g.emptyV.inputs.length, 121)
  assert.equal(g.save1.inputs.filename_prefix, 'H3/hunt/shot_r1_c1')
  assert.deepEqual(g.save2.inputs.audio, ['save2_snd', 0])
  assert.ok(!classOf(g).includes('LTXVLatentUpsampler'), 'no upscale in a take')
  assert.ok(!/cartoon/i.test(g.neg.inputs.text), 'cartoons are allowed')
})
ok('a finish: the same take again (same seed), then the 2x latent upscale and a refining pass with its audio', () => {
  const p = planLtx({ prompt: 'A fox.', seconds: 5, previews: 2, seed: 7 })
  const g = ltxGraph(p, { stage: 'final', candidate: 2, name: 'shot_r1_c2_final' })
  linked(g)
  assert.equal(g.t1_noise.inputs.noise_seed, 1007)
  assert.equal(g.upModel.inputs.model_name, LTX_FILES.upscaler)
  assert.deepEqual(g.up.inputs.samples, ['t1_split', 0])
  assert.deepEqual(g.f_av.inputs.audio_latent, ['t1_split', 1], 'the take\'s sound carries into the refine')
  assert.equal(g.save.inputs.filename_prefix, 'H3/final/shot_r1_c2_final')
})
ok('frames: a first frame placed in the latent, first and last as guides cropped after sampling, at each pass\'s size', () => {
  const one = ltxGraph(planLtx({ prompt: 'x', mode: 'frames', media: [{ kind: 'picture', file: 'a.png' }] }), { stage: 'final', pics: ['iv/a.png'] })
  linked(one)
  assert.equal(one.t1_i2v.inputs.strength, 0.7)
  assert.equal(one.f_i2v.inputs.strength, 1)
  assert.equal(one.first_672.inputs.width, 672)
  assert.equal(one.first_1344.inputs.width, 1344)
  const two = ltxGraph(planLtx({ prompt: 'x', mode: 'frames', media: [{ kind: 'picture', file: 'a.png' }, { kind: 'picture', file: 'b.png' }] }), { stage: 'previews', pics: ['iv/a.png', 'iv/b.png'] })
  linked(two)
  assert.equal(two.t1_g0.inputs.frame_idx, 0)
  assert.equal(two.t1_g1.inputs.frame_idx, -1)
  assert.deepEqual(two.save1_dec.inputs.samples, ['t1_crop', 2], 'guide frames cropped before decoding')
})
ok('takes are read back by their save node', () => {
  const outputs = { save1: { gifs: [{ filename: 'a_c1_00001.mp4' }, { filename: 'a_c1_00001-audio.mp4' }] }, save3: { gifs: [{ filename: 'x.mp4' }] } }
  assert.deepEqual(ltxTakes(outputs, 2).map((t) => [t.candidate, t.file.filename]), [[1, 'a_c1_00001-audio.mp4']])
})
console.log(`${n} checks passed`)
