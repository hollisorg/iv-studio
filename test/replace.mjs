// Replace on a live ComfyUI: every mode's node and model check, then a mask preview and a person replace
// (renders on the GPU, a few minutes). Temporary data folder.
//   node test/replace.mjs <source video with sound> <character picture>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Replace } from '../src/service/replace.js'
import { Studio } from '../src/service/studio.js'

const [video, picture] = process.argv.slice(2)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-replace-'))
const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: process.env.COMFY_URL || 'http://127.0.0.1:8188' })
const bin = path.resolve('node_modules/ffmpeg-ffprobe-static')
const replace = new Replace({ studio, resourcesDir: path.resolve('resources'), dataDir, ffmpeg: path.join(bin, 'ffmpeg.exe'), ffprobe: path.join(bin, 'ffprobe.exe') })
let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
for (const mode of ['person', 'people', 'object', 'mask', 'faces', 'colours']) {
  const c = await replace.check(mode)
  expect(`check ${mode}`, c.ready, c.ready ? 'ready' : JSON.stringify(c))
}
async function wait(job, label) {
  const t0 = Date.now()
  for (;;) {
    const j = await studio.refreshJob(job.id)
    if (['success', 'error', 'cancelled'].includes(j.status)) {
      console.log(`  ${label}: ${j.status} in ${Math.round((Date.now() - t0) / 1000)} s${j.error ? ` - ${j.error.slice(0, 300)}` : ''}`)
      return j
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
}
const probe = (f) => spawnSync(path.resolve('node_modules/ffmpeg-ffprobe-static/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'csv=p=0', f]).stdout.toString().trim().replace(/\r?\n/g, ' | ')

const mask = await wait(await replace.run({ mode: 'mask', video, settings: { target: 'person' } }), 'mask')
const mv = mask.outputs.find((o) => o.kind === 'final')
expect('mask preview video', mask.status === 'success' && !!mv, mv && `${mv.filename}: ${mv.path ? probe(mv.path) : mv.url}`)

const run = await wait(await replace.run({ mode: 'person', video, pictures: [picture], settings: { resolution: '480p', clipSeconds: 6, seed: 7, motion: 512 } }), 'person')
const fin = run.outputs.find((o) => o.kind === 'final')
console.log('  outputs:', run.outputs.map((o) => `${o.kind}:${o.filename}`).join(', '))
expect('replaced video', run.status === 'success' && !!fin, fin && `${fin.filename}: ${fin.path ? probe(fin.path) : fin.url}`)
expect('in the library as Replace', studio.library().some((i) => i.group === 'Replace'))
console.log(failures ? `${failures} FAILED` : 'all passed', '| data in', dataDir)
process.exit(failures ? 1 : 0)
