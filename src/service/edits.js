// Edits: IV Studio's own timeline editor. An edit is media (files on this PC) plus clips on tracks;
// the window plays it live, and export turns the whole timeline into one ffmpeg run.
//   tracks  T1 (titles), V1..Vn (video, a higher number drawn over a lower one), A1..An (audio); each can be
//           hidden, locked, muted or soloed (edit.tracks, see timeline.js tracksOf)
//   clip    { id, track, media, start, in, out, fadeIn, fadeOut, volume, muted, text? }
//   marker  { id, t, label, color }
//           start = where it sits on the timeline; in/out = the part of the media it plays (seconds).
// Video clips carry their own sound (mixed with the audio tracks) unless muted.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'
import { audible, clipEnd, clipLength, shown, tracksOf, videoLayers } from './timeline.js'

export const FORMATS = {
  '1080p': { width: 1920, height: 1080, label: '1080p 16:9' },
  '4k': { width: 3840, height: 2160, label: '4K 16:9' },
  vertical: { width: 1080, height: 1920, label: 'Vertical 9:16' },
  square: { width: 1080, height: 1080, label: 'Square 1:1' }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()

export const editLength = (e) => e.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)

export class Edits {
  constructor({ dataDir, ffmpeg, ffprobe, fontFile }) {
    this.dir = path.join(dataDir, 'edits')
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
    this.fontFile = fontFile
    this.exports = new Map() // edit id -> child process
  }

  file = (id) => path.join(this.dir, `${id}.json`)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((e) => ({ id: e.id, name: e.name, clips: e.clips.length, seconds: +editLength(e).toFixed(1), format: e.settings.format, updatedAt: e.updatedAt, exports: e.exports?.length || 0 }))
  }
  get(id) {
    const e = readJson(this.file(id), null)
    if (!e) throw new Error(`No edit ${id}`)
    return e
  }
  write(e) {
    e.updatedAt = now()
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(`${this.file(e.id)}.tmp`, JSON.stringify(e, null, 2))
    fs.renameSync(`${this.file(e.id)}.tmp`, this.file(e.id))
    return e
  }
  create(name = 'Untitled edit') {
    return this.write({ id: randomUUID().slice(0, 8), name, createdAt: now(), settings: { format: '1080p', fps: 24 }, media: {}, clips: [], exports: [] })
  }
  // The window saves the whole edit (it keeps its own undo history); media and settings come with it.
  save(id, { name, settings, media, clips, tracks, markers }) {
    const e = this.get(id)
    Object.assign(e, { name: name ?? e.name, settings: settings ?? e.settings, media: media ?? e.media, clips: clips ?? e.clips, tracks: tracks ?? e.tracks, markers: markers ?? e.markers ?? [] })
    return this.write(e)
  }
  remove(id) {
    fs.rmSync(this.file(id), { force: true })
    return true
  }

  probe = (file) => probe(this.ffprobe, file)

  async addMedia(file, source = { type: 'file' }) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
    const info = await this.probe(file)
    return { id: randomUUID().slice(0, 8), name: path.basename(file), path: file, source, ...info }
  }

  // ---------- export ----------
  // ffmpeg arguments for the whole timeline: a black canvas, the video clips overlaid in track order
  // (V1 up to the top track) with their fades as alpha, titles drawn on top, every sound mixed with its fades.
  // Hidden tracks are left out of the picture, and muted (or not soloed) tracks out of the sound.
  exportArgs(e, outFile, textDir) {
    const fmt = FORMATS[e.settings.format] || FORMATS['1080p']
    const { width: W, height: H } = fmt
    const fps = e.settings.fps || 24
    const total = Math.max(0.1, editLength(e))
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1']
    const filters = [`color=c=black:s=${W}x${H}:r=${fps}:d=${total.toFixed(3)},format=yuv420p[base]`]
    const audio = []
    let input = 0
    const tracks = tracksOf(e)
    const order = Object.fromEntries(videoLayers(tracks).map((t, k) => [t.id, k]))
    const hears = (c) => !c.muted && audible(tracks, c.track)
    const videoClips = e.clips.filter((c) => order[c.track] !== undefined && e.media[c.media] && (shown(tracks, c.track) || (e.media[c.media].hasAudio && hears(c)))).sort((a, b) => order[a.track] - order[b.track] || a.start - b.start)
    let last = 'base'
    for (const c of videoClips) {
      const m = e.media[c.media]
      const len = clipLength(c)
      if (m.kind === 'image') args.push('-loop', '1', '-t', len.toFixed(3), '-i', m.path)
      else args.push('-i', m.path)
      const i = input++
      if (m.kind === 'video' && m.hasAudio && hears(c)) audio.push({ i, c })
      if (!shown(tracks, c.track)) continue
      const fades = [c.fadeIn > 0 && `fade=t=in:st=0:d=${c.fadeIn}:alpha=1`, c.fadeOut > 0 && `fade=t=out:st=${Math.max(0, len - c.fadeOut).toFixed(3)}:d=${c.fadeOut}:alpha=1`].filter(Boolean)
      const trim = m.kind === 'image' ? '' : `trim=start=${c.in.toFixed(3)}:end=${c.out.toFixed(3)},`
      filters.push(`[${i}:v]${trim}setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p${fades.length ? ',' + fades.join(',') : ''},setpts=PTS+${c.start.toFixed(3)}/TB[v${i}]`)
      filters.push(`[${last}][v${i}]overlay=eof_action=pass:enable='between(t,${c.start.toFixed(3)},${clipEnd(c).toFixed(3)})'[o${i}]`)
      last = `o${i}`
    }
    for (const c of e.clips.filter((x) => x.track[0] === 'A' && e.media[x.media] && hears(x))) {
      args.push('-i', e.media[c.media].path)
      audio.push({ i: input++, c })
    }
    // Titles: each text goes through a file, so no quoting of the user's words is needed.
    const titles = shown(tracks, 'T1') ? e.clips.filter((c) => c.track === 'T1' && c.text?.content) : []
    titles.forEach((c, k) => {
      const tf = path.join(textDir, `title${k}.txt`)
      fs.writeFileSync(tf, c.text.content)
      const size = Math.round((c.text.size || 8) * H / 100)
      const y = { top: `h*0.08`, center: `(h-text_h)/2`, bottom: `h*0.92-text_h` }[c.text.position || 'bottom']
      const a = `if(lt(t-${c.start},${c.fadeIn || 0.001}),(t-${c.start})/${c.fadeIn || 0.001},if(gt(t,${clipEnd(c) - (c.fadeOut || 0.001)}),(${clipEnd(c)}-t)/${c.fadeOut || 0.001},1))`
      const font = this.fontFile.replace(/\\/g, '/').replace(':', '\\:')
      const tfile = tf.replace(/\\/g, '/').replace(':', '\\:')
      const box = c.text.box ? `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.35)}` : ''
      filters.push(`[${last}]drawtext=fontfile='${font}':textfile='${tfile}':fontsize=${size}:fontcolor=${c.text.color || '#f4ecdc'}:x=(w-text_w)/2:y=${y}${box}:alpha='${a}':enable='between(t,${c.start.toFixed(3)},${clipEnd(c).toFixed(3)})'[t${k}]`)
      last = `t${k}`
    })
    filters.push(`[${last}]null[vout]`)
    if (audio.length) {
      for (const { i, c } of audio) {
        const len = clipLength(c)
        const fades = [c.fadeIn > 0 && `afade=t=in:st=0:d=${c.fadeIn}`, c.fadeOut > 0 && `afade=t=out:st=${Math.max(0, len - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`].filter(Boolean)
        const ms = Math.round(c.start * 1000)
        filters.push(`[${i}:a]atrim=start=${c.in.toFixed(3)}:end=${c.out.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(c.volume ?? 1).toFixed(2)}${fades.length ? ',' + fades.join(',') : ''},adelay=${ms}|${ms},aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`)
      }
      filters.push(`${audio.map(({ i }) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:duration=longest,apad,atrim=end=${total.toFixed(3)}[aout]`)
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=end=${total.toFixed(3)}[aout]`)
    }
    const script = path.join(textDir, 'graph.txt')
    fs.writeFileSync(script, filters.join(';\n'))
    args.push('-filter_complex_script', script, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile)
    return { args, total }
  }

  // Renders the edit to outDir; onProgress(0..1). Resolves with the file path.
  async export(id, outDir, onProgress) {
    const e = this.get(id)
    if (!e.clips.length) throw new Error('The timeline is empty.')
    if (this.exports.has(id)) throw new Error('This edit is already exporting.')
    const missing = Object.values(e.media).filter((m) => e.clips.some((c) => c.media === m.id) && !fs.existsSync(m.path))
    if (missing.length) throw new Error(`Missing files: ${missing.map((m) => m.name).join(', ')}`)
    fs.mkdirSync(outDir, { recursive: true })
    const base = `${e.name.replace(/[^\w -]+/g, '').trim() || 'edit'}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const outFile = path.join(outDir, `${base}.mp4`)
    const work = path.join(this.dir, 'work', id)
    fs.rmSync(work, { recursive: true, force: true })
    fs.mkdirSync(work, { recursive: true })
    const { args, total } = this.exportArgs(e, outFile, work)
    const t0 = Date.now()
    await new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      this.exports.set(id, p)
      let err = ''
      p.stdout.on('data', (d) => {
        const us = String(d).match(/out_time_us=(\d+)/g)?.pop()
        if (us) onProgress?.(Math.min(1, Number(us.split('=')[1]) / 1e6 / total))
      })
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code, signal) => {
        this.exports.delete(id)
        if (code === 0) resolve()
        else reject(new Error(signal || code === null ? 'Export cancelled.' : `Export failed: ${err.trim().split('\n').slice(-3).join(' ')}`))
      })
    })
    fs.rmSync(work, { recursive: true, force: true })
    const fresh = this.get(id)
    fresh.exports = [...(fresh.exports || []), { file: outFile, at: now(), seconds: Math.round((Date.now() - t0) / 1000), format: e.settings.format, fps: e.settings.fps }]
    this.write(fresh)
    return outFile
  }

  cancelExport(id) {
    const p = this.exports.get(id)
    if (p) p.kill()
    return !!p
  }

  // ---------- what the timeline draws on clips (cached in edits/cache, keyed by file, size and date) ----------
  cachePath(file, ext) {
    const st = fs.statSync(file)
    const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
    fs.mkdirSync(path.join(this.dir, 'cache'), { recursive: true })
    return path.join(this.dir, 'cache', `${key}.${ext}`)
  }
  run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      const out = []
      let err = ''
      p.stdout.on('data', (d) => out.push(d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))))
    })
  }
  // A filmstrip: one row of small frames, one every `every` seconds of the video.
  async filmstrip(file, duration) {
    const W = 96
    const H = 54
    const every = Math.max(0.5, (duration || 4) / 120)
    const count = Math.max(1, Math.floor((duration || 4) / every))
    const jpg = this.cachePath(file, `strip${count}.jpg`)
    if (!fs.existsSync(jpg)) {
      await this.run(['-v', 'error', '-y', '-i', file, '-an', '-vf', `fps=1/${every},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,tile=${count}x1`, '-frames:v', '1', '-q:v', '6', `${jpg}.tmp.jpg`])
      fs.renameSync(`${jpg}.tmp.jpg`, jpg)
    }
    return { file: jpg, every, count, w: W, h: H }
  }
  // Waveform peaks: the loudest sample in every 10 ms, 0..255.
  async peaks(file) {
    const cached = this.cachePath(file, 'peaks')
    if (fs.existsSync(cached)) return { rate: 100, peaks: [...fs.readFileSync(cached)] }
    const pcm = await this.run(['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
    const n = Math.floor(pcm.length / 2)
    const out = Buffer.alloc(Math.ceil(n / 80))
    for (let k = 0; k < out.length; k++) {
      let m = 0
      for (let j = k * 80, end = Math.min(n, j + 80); j < end; j++) m = Math.max(m, Math.abs(pcm.readInt16LE(j * 2)))
      out[k] = Math.min(255, Math.round(Math.sqrt(m / 32768) * 255))
    }
    fs.writeFileSync(cached, out)
    return { rate: 100, peaks: [...out] }
  }
}
