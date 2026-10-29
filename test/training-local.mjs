// Character training, the local half, on a live ComfyUI: four faces, four scenes, two talking clips,
// then the dataset, checked against Fizgig's rules (24 fps, 17n+5 frames from t=0, sides multiple of 32,
// 32 kHz stereo, a caption per file starting with the trigger and never describing the face).
// Renders on the local GPU (about 4 minutes); nothing goes to Modal. Temporary data folder.
//   node test/training-local.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Studio } from '../src/service/studio.js'
import { TALKS, SCENES, Trainings, trainScript } from '../src/service/training.js'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-train-'))
const bin = path.resolve('node_modules/ffmpeg-ffprobe-static')
const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: process.env.COMFY_URL || 'http://127.0.0.1:8188' })
const tr = new Trainings({ dataDir, resourcesDir: path.resolve('resources'), studio, ffmpeg: path.join(bin, 'ffmpeg.exe'), ffprobe: path.join(bin, 'ffprobe.exe') })
let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle(id, label) {
  const t0 = Date.now()
  for (;;) {
    const v = await tr.refresh(id)
    const jobs = Object.values(v.jobs)
    if (jobs.every((j) => ['success', 'error', 'cancelled'].includes(j.status))) {
      console.log(`  ${label}: ${jobs.length} renders in ${Math.round((Date.now() - t0) / 1000)} s`)
      return v
    }
    await sleep(4000)
  }
}

let t = tr.create({ name: 'Nova Reyes', who: 'a woman in her late twenties' })
expect('create + trigger', t.trigger === 'n0var36', t.trigger)
t = await tr.designFaces(t.id, { faceText: 'oval face, light freckles across the nose, warm brown eyes, thick dark curly hair to the shoulders, straight eyebrows' })
let v = await settle(t.id, 'faces')
const face = t.faceCandidates[0]
const faceOut = v.jobs[face.jobId].outputs[0]
expect('four face candidates', t.faceCandidates.length === 4 && t.faceCandidates.every((c) => v.jobs[c.jobId].status === 'success'), faceOut?.filename)
t = tr.pickFace(t.id, { jobId: face.jobId, file: faceOut })
t = await tr.designScenes(t.id, { scenes: SCENES.slice(0, 4) })
v = await settle(t.id, 'scenes')
for (const s of t.stills) tr.pickStill(t.id, s.id, { pick: 0, file: v.jobs[s.candidates[0].jobId].outputs[0] })
t = tr.get(t.id)
expect('four scene stills kept', tr.keptStills(t).length === 4)
expect('still captions start with the trigger and skip the face', t.stills.every((s) => s.caption.startsWith(`${t.trigger}, `) && !/freckles|curly|eyes/.test(s.caption)), t.stills[0].caption)

t = await tr.makeClips(t.id, { talks: TALKS.slice(0, 2) })
v = await settle(t.id, 'clips')
t = tr.get(t.id)
expect('two talking clips rendered', t.clips.length === 2 && t.clips.every((c) => c.file?.path), t.clips.map((c) => c.file?.filename).join(', '))

const ds = await tr.buildDataset(t.id)
console.log('  dataset:', ds)
expect('dataset counts', ds.stills === 4 && ds.clips === 2 && ds.items === 6)
for (const f of fs.readdirSync(ds.dir).filter((x) => !x.endsWith('.txt'))) {
  const cap = path.join(ds.dir, f.replace(/\.[^.]+$/, '.txt'))
  expect(`${f} has a caption`, fs.existsSync(cap) && fs.readFileSync(cap, 'utf8').startsWith(t.trigger))
  if (!f.endsWith('.mp4')) continue
  const pr = JSON.parse(spawnSync(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,width,height,r_frame_rate,nb_read_frames,sample_rate,channels,start_time', '-of', 'json', path.join(ds.dir, f)]).stdout)
  const vs = pr.streams.find((s) => s.codec_type === 'video')
  const as = pr.streams.find((s) => s.codec_type === 'audio')
  const frames = Number(vs.nb_read_frames)
  const ok = vs.r_frame_rate === '24/1' && (frames - 5) % 17 === 0 && vs.width % 32 === 0 && vs.height % 32 === 0 && Number(vs.start_time) === 0 && (!as || (as.sample_rate === '32000' && as.channels === 2))
  expect(`${f} fits Fizgig`, ok, `${vs.width}x${vs.height} ${frames}f ${vs.r_frame_rate} start ${vs.start_time} audio ${as ? `${as.sample_rate} Hz x${as.channels}` : 'none'}`)
}
const est = tr.estimateFor(t)
expect('estimate', est.steps > 0 && est.dollars > 0, `${est.epochs} epochs, ${est.steps} steps, ~${est.minutes} min, ~$${est.dollars}`)
const sh = trainScript({ name: 'nova_x_1', epochs: est.epochs, saveEvery: 3 })
expect('train.sh has the run name and epochs', sh.includes('--output_name nova_x_1_mmh3') && sh.includes(`--max_train_epochs ${est.epochs}`) && sh.includes('--save_every_n_epochs 3'))
console.log(failures ? `${failures} FAILED` : 'all passed', '| data in', dataDir)
process.exit(failures ? 1 : 0)
