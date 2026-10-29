// The editor's clip pictures: a filmstrip and waveform peaks for one video, made and then read from the cache.
//   node test/edit-strips.mjs <video with sound> [copy the strip here]
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Edits } from '../src/service/edits.js'

let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const file = process.argv[2]
if (!file || !fs.existsSync(file)) throw new Error('Give a video file.')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-strips-'))
const edits = new Edits({ dataDir: temp, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
const info = await edits.probe(file)

let t = Date.now()
const s = await edits.filmstrip(file, info.duration)
const jpg = fs.readFileSync(s.file)
const width = jpg.readUInt16BE(jpg.indexOf(Buffer.from([0xff, 0xc0])) + 7)
expect('filmstrip', jpg[0] === 0xff && jpg[1] === 0xd8 && width === s.count * s.w, `${s.count} frames, one every ${s.every.toFixed(2)} s, ${width} px wide, ${Date.now() - t} ms`)
t = Date.now()
const again = await edits.filmstrip(file, info.duration)
expect('filmstrip comes from the cache', again.file === s.file && Date.now() - t < 200, `${Date.now() - t} ms`)

t = Date.now()
const p = await edits.peaks(file)
const expected = Math.round(info.duration * 100)
expect('peaks', Math.abs(p.peaks.length - expected) <= 5 && Math.max(...p.peaks) > 20, `${p.peaks.length} peaks (expected about ${expected}), loudest ${Math.max(...p.peaks)}, ${Date.now() - t} ms`)
t = Date.now()
const cached = await edits.peaks(file)
expect('peaks come from the cache', cached.peaks.length === p.peaks.length && Date.now() - t < 200, `${Date.now() - t} ms`)

if (process.argv[3]) fs.copyFileSync(s.file, process.argv[3])
fs.rmSync(temp, { recursive: true, force: true })
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
