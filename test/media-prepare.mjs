// Media editor check: crops a picture, trims and crops a video, trims a sound, with the bundled ffmpeg,
// and checks the results' sizes and lengths. Writes to a temporary data folder.
//   node test/media-prepare.mjs <picture> <video> <audio>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MediaTools } from '../src/service/media.js'

const [pic, vid, aud] = process.argv.slice(2)
const bin = path.resolve('node_modules/ffmpeg-ffprobe-static')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-media-'))
const tools = new MediaTools({ dataDir, ffmpeg: path.join(bin, 'ffmpeg.exe'), ffprobe: path.join(bin, 'ffprobe.exe') })
let failures = 0
const expect = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label} - ${detail}`)
  if (!cond) failures++
}

const p = await tools.prepare({ file: pic, crop: { x: 100, y: 50, w: 641, h: 361 } })
expect('picture crop', p.kind === 'image' && p.width === 640 && p.height === 360, `${p.width}x${p.height} ${path.basename(p.path)}`)
const again = await tools.prepare({ file: pic, crop: { x: 100, y: 50, w: 641, h: 361 } })
expect('same settings reuse the file', again.path === p.path, path.basename(again.path))

const vi = await tools.probe(vid)
const v = await tools.prepare({ file: vid, start: 1, end: 1 + 73 / 24, crop: { x: 0, y: 0, w: vi.width / 2, h: vi.height } })
const frames = Number(String((await import('node:child_process')).spawnSync(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', v.path]).stdout).trim())
expect('video trim is frame exact', frames === 73, `${frames} frames`)
expect('video trim + crop', v.kind === 'video' && Math.abs(v.duration - 73 / 24) < 0.06 && v.width === Math.floor(vi.width / 4) * 2 && v.hasAudio, `${v.width}x${v.height} ${v.duration.toFixed(3)} s audio=${v.hasAudio}`)

const a = await tools.prepare({ file: aud, start: 0.5, end: 2.5 })
expect('sound trim', a.kind === 'audio' && Math.abs(a.duration - 2) < 0.03, `${a.duration.toFixed(3)} s ${path.basename(a.path)}`)

for (const [label, args] of [['crop a sound', { file: aud, crop: { x: 0, y: 0, w: 10, h: 10 } }], ['trim a picture', { file: pic, start: 1 }], ['tiny crop', { file: pic, crop: { x: 0, y: 0, w: 4, h: 4 } }]]) {
  const err = await tools.prepare(args).then(() => null, (e) => e.message)
  expect(`refuses: ${label}`, !!err, err)
}
expect('original untouched', fs.existsSync(pic) && fs.existsSync(vid) && fs.existsSync(aud), 'sources still there')
console.log(failures ? `${failures} FAILED` : 'all passed', '| files in', dataDir)
process.exit(failures ? 1 : 0)
