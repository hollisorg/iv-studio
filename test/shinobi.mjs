// Shinobi check: installs the pinned engine into a temporary data folder, makes a project from two clips and a
// music track, builds a first cut from a recipe, renders it with Edge and the bundled ffmpeg, and (with the
// face models folder) scores likeness.
//   node test/shinobi.mjs <clip1> <clip2> <music> [<buffalo_l folder> <reference face> <picture>...]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Shinobi } from '../src/service/shinobi.js'

const [c1, c2, music, faces, ref, ...pics] = process.argv.slice(2)
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-shinobi-'))
const ffmpegDir = path.resolve('node_modules/ffmpeg-ffprobe-static')
const sh = new Shinobi({ dataDir, resourcesDir: path.resolve('resources'), ffmpegDir, onLog: (l) => /Installing|Setting up|Downloading/.test(l) && console.log('  ', l) })
let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}

let t0 = Date.now()
const st = await sh.install()
expect('install', st.installed && !!st.browser, `${Math.round((Date.now() - t0) / 1000)} s, browser ${st.browser}`)
const caps = await sh.call('get_capabilities')
expect('engine ready to render', caps.ffmpeg?.toLowerCase().includes('ffmpeg-ffprobe-static') && !!caps.chrome, caps.ffmpeg)
const tools = await sh.tools()
expect('tool list', tools.length >= 70, `${tools.length} tools`)
const p = await sh.call('create_project', { name: 'Shinobi test' })
const id = p.project_id
for (const c of [c1, c2]) await sh.call('import_media', { project_id: id, source: c, start: 0.3, duration: 4, max_width: 1280 })
await sh.call('import_media', { project_id: id, source: music, audio_only: /\.mp4$/i.test(music) })
const proj = sh.project(id)
expect('project read from disk', proj.assets.length === 3 && sh.projects()[0].id === id, proj.assets.map((a) => a.kind).join(', '))
const recipe = await sh.call('build_recipe', { project_id: id, family: 'beat_cut_punch', asset_ids: proj.assets.filter((a) => a.kind !== 'audio').map((a) => a.id), music_asset_id: proj.assets.find((a) => a.kind === 'audio')?.id, text: 'THEO', seconds: 6, width: 1280, height: 720, fps: 24 })
const timeline = recipe.timeline || recipe
const saved = await sh.call('save_timeline', { project_id: id, timeline, revision: (await sh.call('get_project', { project_id: id })).revision ?? null })
expect('recipe saved', !!saved.revision, `revision ${String(saved.revision).slice(0, 8)}`)
const job = await sh.call('start_render', { project_id: id, request_id: 'test-v1' })
t0 = Date.now()
let r
for (;;) {
  r = await sh.call('get_render', { project_id: id, job_id: job.id })
  if (!['running', 'queued'].includes(r.state)) break
  await new Promise((res) => setTimeout(res, 2000))
}
const video = sh.renders(id)[0]?.video
const probe = video ? spawnSync(path.join(ffmpegDir, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'csv=p=0', video]).stdout.toString().trim().replace(/\r?\n/g, ' | ') : ''
expect('render', r.state === 'succeeded' && !!video, `${r.state} in ${Math.round((Date.now() - t0) / 1000)} s: ${probe}`)

if (faces) {
  fs.mkdirSync(sh.faceDir, { recursive: true })
  for (const f of ['det_10g.onnx', 'w600k_r50.onnx']) fs.copyFileSync(path.join(faces, f), path.join(sh.faceDir, f))
  const scores = await sh.likeness(ref, pics)
  scores.forEach((s) => console.log('    ', s.score, s.min, path.basename(s.file)))
  expect('likeness', scores.every((s) => s.score != null && s.score > -1 && s.score <= 1))
}
console.log(failures ? `${failures} FAILED` : 'all passed', '| data in', dataDir)
process.exit(failures ? 1 : 0)
