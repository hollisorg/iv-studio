// A file going up to ComfyUI must fit under its upload limit: ComfyUI refuses a request body over --max-upload-size,
// 100 MB unless it was started with more ("Maximum request body size 104857600 exceeded", GitHub #58). A long or
// high-bitrate source for Continue, Extend or Replace easily passes it.
// A video over the limit goes up as a smaller copy: the same size, frame rate and sound, with its picture bitrate
// capped so the whole file lands well under the limit. The original is never touched; the copy is kept in the data
// folder's media/ (named from the source's path, size and date, so the next upload of the same video reuses it).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'

const MB = 1024 * 1024
// ComfyUI's default limit is the whole request (the file plus the form around it)
export const UPLOAD_LIMIT = 100 * MB
// what a fitted copy aims for: 80% of the limit, room for the form and the encoder overshooting its cap
export const fitTarget = (limit = UPLOAD_LIMIT) => Math.floor(limit * 0.8)
const VIDEO = /\.(mp4|mov|m4v|mkv|webm|avi)$/i
const AUDIO_KBPS = 160

// over the limit less room for the form around the file (1 MB of ComfyUI's 100)
export const tooBig = (bytes, limit = UPLOAD_LIMIT) => bytes > limit - Math.min(MB, limit * 0.01)

// ffmpeg's arguments for a copy of `seconds` of video that fits in target bytes.
export function fitArgs(src, dest, { seconds, hasAudio = true, target = fitTarget() }) {
  const total = Math.floor((target * 8) / 1000 / Math.max(1, seconds)) // kilobits a second, sound included
  const video = Math.max(100, total - (hasAudio ? AUDIO_KBPS : 0))
  return [
    '-v', 'error', '-y', '-i', src,
    '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0?'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-maxrate', `${video}k`, '-bufsize', `${video}k`, '-pix_fmt', 'yuv420p',
    ...(hasAudio ? ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`] : ['-an']),
    '-movflags', '+faststart', dest
  ]
}

// The file to upload: `file` itself when it fits, else a fitted copy of a video. A picture or sound that is too big
// is refused here in words, rather than by ComfyUI with a 413.
export async function fitForUpload(file, { ffmpeg, ffprobe, dir, limit = UPLOAD_LIMIT }) {
  const st = fs.statSync(file)
  if (!tooBig(st.size, limit)) return file
  const name = path.basename(file)
  if (!VIDEO.test(file) || !ffmpeg || !ffprobe)
    throw new Error(`${name} is ${Math.round(st.size / MB)} MB, more than ComfyUI takes in one upload (${Math.round(limit / MB)} MB). Use a smaller file, or start ComfyUI with a bigger --max-upload-size.`)
  const key = createHash('sha1').update(`${path.resolve(file)}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 12)
  const out = path.join(dir, `${path.parse(file).name}.upload-${key}.mp4`)
  if (fs.existsSync(out) && !tooBig(fs.statSync(out).size, limit)) return out
  fs.mkdirSync(dir, { recursive: true })
  const info = await probe(ffprobe, file)
  await run(ffmpeg, fitArgs(file, `${out}.part.mp4`, { seconds: info.duration || 15, hasAudio: info.hasAudio, target: fitTarget(limit) }))
  fs.renameSync(`${out}.part.mp4`, out)
  if (tooBig(fs.statSync(out).size, limit)) throw new Error(`${name} is still too big for ComfyUI's upload limit after making it smaller. Trim it shorter, or start ComfyUI with a bigger --max-upload-size.`)
  return out
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Couldn't make a smaller copy to upload: ${err.trim().slice(-300) || `ffmpeg stopped (${code})`}`))))
  })
}
