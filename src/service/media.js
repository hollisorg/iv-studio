// Preparing a reference before it goes to H3: crop a picture, trim and crop a video, trim a sound.
// The original is never touched; the result is a new file in the data folder's media/ (named from the
// source and the settings, so applying the same settings again reuses it).
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const IMAGE = /\.(png|jpe?g|webp|bmp)$/i
const AUDIO = /\.(wav|mp3|m4a|flac|ogg|aac)$/i
const even = (v) => Math.max(2, Math.floor(v / 2) * 2)

// What a file is: kind, duration, size and whether it has sound, from ffprobe.
export function probe(ffprobe, file) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], { windowsHide: true })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Can't read ${path.basename(file)}.`))
      const info = JSON.parse(out)
      const video = info.streams?.find((s) => s.codec_type === 'video')
      const kind = IMAGE.test(file) ? 'image' : video && !AUDIO.test(file) ? 'video' : 'audio'
      const [n, d] = String(video?.r_frame_rate || '0/1').split('/').map(Number)
      resolve({
        kind,
        duration: kind === 'image' ? null : Number(info.format?.duration) || 0,
        width: video?.width || null,
        height: video?.height || null,
        fps: kind === 'video' && d ? +(n / d).toFixed(3) : null,
        hasAudio: info.streams?.some((s) => s.codec_type === 'audio') || false
      })
    })
  })
}

// H3's own sizes: about `megapixels`, both sides on a 32-pixel grid (Retake and Continue need it), same shape.
export function h3Size(width, height, megapixels) {
  const s = Math.sqrt((megapixels * 1024 * 1024) / (width * height))
  const grid = (x) => Math.max(256, Math.round((x * s) / 32) * 32)
  return { width: grid(width), height: grid(height) }
}

export class MediaTools {
  constructor({ dataDir, ffmpeg, ffprobe }) {
    this.dir = path.join(dataDir, 'media')
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
  }

  probe = (file) => probe(this.ffprobe, file)

  // crop: {x, y, w, h} in source pixels (pictures and videos). start/end: seconds (videos and sounds).
  // fitH3: megapixels; resizes (after the crop) to H3's own sizes, and a video to 24 fps.
  // Returns the new file's path and what it is.
  async prepare({ file, crop = null, start = null, end = null, fitH3 = null }) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
    const info = await this.probe(file)
    const kind = info.kind
    if (crop && kind === 'audio') throw new Error('Sounds have no picture to crop.')
    if ((start != null || end != null) && kind === 'image') throw new Error('Pictures have no length to trim.')
    if (fitH3 && kind === 'audio') throw new Error('Sounds have no picture to resize.')
    if (fitH3 != null && !(fitH3 >= 0.2 && fitH3 <= 4)) throw new Error('fitH3 is megapixels, 0.2 to 4.')
    const args = ['-y', '-hide_banner', '-loglevel', 'error']
    let filter = null
    if (crop) {
      const x = Math.max(0, Math.round(crop.x))
      const y = Math.max(0, Math.round(crop.y))
      const w = even(Math.min(crop.w, info.width - x))
      const h = even(Math.min(crop.h, info.height - y))
      if (w < 16 || h < 16) throw new Error('The crop is too small.')
      filter = `crop=${w}:${h}:${x}:${y}`
    }
    if (fitH3) {
      const size = h3Size(crop ? even(Math.min(crop.w, info.width)) : info.width, crop ? even(Math.min(crop.h, info.height)) : info.height, fitH3)
      filter = [filter, `scale=${size.width}:${size.height}:flags=lanczos`].filter(Boolean).join(',')
    }
    const s = Math.max(0, start ?? 0)
    const e = Math.min(info.duration || Infinity, end ?? Infinity)
    if (kind !== 'image' && !(e - s >= 0.04)) throw new Error('The trimmed part must be longer than a frame.')
    const ext = kind === 'image' ? 'png' : kind === 'video' ? 'mp4' : 'wav'
    const key = createHash('sha1').update(JSON.stringify([file, fs.statSync(file).mtimeMs, filter, s, e, fitH3])).digest('hex').slice(0, 10)
    const out = path.join(this.dir, `${path.basename(file).replace(/\.[^.]+$/, '').replace(/[^\w -]+/g, '_')}_${key}.${ext}`)
    if (fs.existsSync(out)) return { path: out, ...(await this.probe(out)) }
    fs.mkdirSync(this.dir, { recursive: true })

    if (kind === 'image') args.push('-i', file, ...(filter ? ['-vf', filter] : []), '-frames:v', '1', out)
    else {
      args.push('-ss', s.toFixed(3), '-i', file)
      if (Number.isFinite(e)) args.push('-t', (e - s).toFixed(3))
      // An exact frame count: -t alone can keep one frame too many, and H3 lengths are counted in frames.
      if (kind === 'video' && Number.isFinite(e) && info.fps) args.push('-frames:v', String(Math.round((e - s) * (fitH3 ? 24 : info.fps))))
      if (kind === 'video') args.push(...(filter ? ['-vf', filter] : []), ...(fitH3 ? ['-r', '24'] : []), '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out)
      else args.push('-vn', '-c:a', 'pcm_s16le', out)
    }
    await new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Couldn't prepare ${path.basename(file)}: ${err.trim().split('\n').pop()}`))))
    })
    return { path: out, ...(await this.probe(out)) }
  }
}
