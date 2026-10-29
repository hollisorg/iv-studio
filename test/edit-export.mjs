// Export check: builds a small edit from two local videos (pass their paths) and renders it with
// the bundled ffmpeg: V1 cut with a crossfade, a picture-in-picture-style clip on V2, a title, and
// an extra audio clip at half volume.
//   node test/edit-export.mjs <video1.mp4> <video2.mp4>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Edits, editLength } from '../src/service/edits.js'

const [a, b] = process.argv.slice(2)
const bin = path.resolve('node_modules/ffmpeg-ffprobe-static')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-edit-'))
const edits = new Edits({ dataDir, ffmpeg: path.join(bin, 'ffmpeg.exe'), ffprobe: path.join(bin, 'ffprobe.exe'), fontFile: path.resolve('resources/fonts/BarlowCondensed-SemiBold.ttf') })

const e = edits.create('Export test')
const ma = await edits.addMedia(a)
const mb = await edits.addMedia(b)
console.log('probe', ma.kind, ma.duration, ma.width, ma.hasAudio, '|', mb.kind, mb.duration, mb.width, mb.hasAudio)
const clips = [
  { id: 'c1', track: 'V1', media: ma.id, start: 0, in: 1, out: 6, fadeIn: 0.5, fadeOut: 1, volume: 1 },
  { id: 'c2', track: 'V1', media: mb.id, start: 5, in: 0, out: 4, fadeIn: 1, fadeOut: 0.5, volume: 1 },
  { id: 'c3', track: 'V2', media: mb.id, start: 2, in: 2, out: 3.5, fadeIn: 0.3, fadeOut: 0.3, volume: 0, muted: true },
  { id: 't1', track: 'T1', media: null, start: 0.5, in: 0, out: 3, fadeIn: 0.4, fadeOut: 0.4, text: { content: "WHAT IF? Tess's day", size: 9, position: 'bottom', box: true } },
  { id: 'a1', track: 'A1', media: ma.id, start: 6, in: 2, out: 5, fadeIn: 0.5, fadeOut: 0.5, volume: 0.5 }
]
edits.save(e.id, { media: { [ma.id]: ma, [mb.id]: mb }, clips, settings: { format: '1080p', fps: 24 } })
console.log('length', editLength(edits.get(e.id)))
const t0 = Date.now()
let last = 0
const out = await edits.export(e.id, dataDir, (p) => {
  if (p - last > 0.25) console.log('progress', Math.round(p * 100) + '%'), (last = p)
})
console.log('exported in', Math.round((Date.now() - t0) / 1000), 's', out)
const probe = spawnSync(path.join(bin, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'csv=p=0', out]).stdout.toString()
console.log(probe.trim().replace(/\n/g, ' | '))
for (const t of [0.6, 2.5, 5.5, 8.5]) spawnSync(path.join(bin, 'ffmpeg.exe'), ['-v', 'error', '-y', '-ss', String(t), '-i', out, '-frames:v', '1', '-vf', 'scale=480:-1', path.join(dataDir, `frame_${t}.png`)])
console.log('frames in', dataDir)
