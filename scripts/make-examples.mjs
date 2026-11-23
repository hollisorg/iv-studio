// Makes the Workflows cards' Example media (resources/examples) from a list of sources, and its examples.json.
//   node scripts/make-examples.mjs <sources.json>
// sources.json (kept outside the repo: it names files on the maker's PC) is a list of
//   { "out": "reel.mp4", "from": "<video>", "start": 0, "length": 12, "height": 540, "audio": true }
//   { "out": "reel-1.webp", "from": "<picture or video>", "at": 2.5, "width": 640 }
// Videos: H.264, CRF 26, AAC 96 kb/s at -16 LUFS when audio (else no sound), +faststart, at most 12 s, even sizes; each gets a
// first-frame poster beside it (same name, .webp), which WorkflowExample.jsx shows before it plays.
// Pictures: WebP, quality 82, scaled down to width (from a video: the frame at "at" seconds).
// examples.json: every file's bytes, sha256 and, for videos, seconds and size; test/workflow-examples.mjs checks it.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-ffprobe-static').ffmpegPath
const ffprobe = require('ffmpeg-ffprobe-static').ffprobePath
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '../resources/examples')
const MAX_SECONDS = 12
// "long": true lets one source run to this (Sequences' three shots in one take, Effects' three effects)
const LONG_SECONDS = 32

const list = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
fs.mkdirSync(OUT, { recursive: true })
const run = (bin, args) => execFileSync(bin, ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'inherit'] })
const probe = (file) => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString())

for (const s of list) {
  const out = path.join(OUT, s.out)
  if (s.out.endsWith('.mp4')) {
    const max = s.long ? LONG_SECONDS : MAX_SECONDS
    const length = Math.min(s.length ?? max, max)
    const h = s.height || 540
    const vf = [s.crop && `crop=${s.crop}`, `scale=-2:${h}:flags=lanczos`, 'setsar=1', 'format=yuv420p'].filter(Boolean).join(',')
    // every example with sound at one loudness (-16 LUFS, peaks under -1.5 dB), so Sound on doesn't jump between cards:
    // loudnorm's two passes (measure the stretch, then correct it linearly), as one pass falls short on dense music
    let audio = ['-an']
    if (s.audio) {
      const LN = 'loudnorm=I=-16:TP=-1.5:LRA=11'
      const m = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-ss', String(s.start || 0), '-t', String(length), '-i', s.from, '-vn', '-af', `${LN}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr
      const j = JSON.parse(m.slice(m.lastIndexOf('{'), m.lastIndexOf('}') + 1))
      const second = `${LN}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`
      audio = ['-af', second, '-ar', '48000', '-c:a', 'aac', '-b:a', '96k', '-ac', '2']
    }
    run(ffmpeg, ['-ss', String(s.start || 0), '-t', String(length), '-i', s.from, '-vf', vf, '-r', String(s.fps || 24), '-c:v', 'libx264', '-preset', 'slow', '-crf', String(s.crf || 26), '-profile:v', 'high', ...audio, '-movflags', '+faststart', out])
    run(ffmpeg, ['-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', out.replace(/\.mp4$/, '.webp')])
  } else {
    const at = s.at != null ? ['-ss', String(s.at)] : []
    run(ffmpeg, [...at, '-i', s.from, '-frames:v', '1', '-vf', `scale='min(${s.width || 640},iw)':-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out])
  }
  console.log('made', s.out)
}

// the manifest of everything in the folder
const files = {}
for (const name of fs.readdirSync(OUT).filter((n) => n !== 'examples.json').sort()) {
  const file = path.join(OUT, name)
  const buf = fs.readFileSync(file)
  const entry = { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') }
  if (name.endsWith('.mp4')) {
    const p = probe(file)
    const v = p.streams.find((x) => x.codec_type === 'video')
    Object.assign(entry, { seconds: Number(Number(p.format.duration).toFixed(2)), width: v.width, height: v.height, audio: p.streams.some((x) => x.codec_type === 'audio') })
  }
  files[name] = entry
}
const total = Object.values(files).reduce((a, f) => a + f.bytes, 0)
fs.writeFileSync(path.join(OUT, 'examples.json'), JSON.stringify({ note: 'Made by scripts/make-examples.mjs; the Workflows cards’ Example media.', total, files }, null, 1) + '\n')
console.log(`${Object.keys(files).length} files, ${(total / 1048576).toFixed(1)} MB`)
