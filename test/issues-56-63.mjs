// GitHub #56, #58, #61, #62 and #63.
// #56: a film's Qwen Image 2.1 sketch keeps the film's frame, not its first face picture's shape (images.js).
// #58: a video over ComfyUI's 100 MB upload limit goes up as a smaller copy (uploadfit.js, comfy.js).
// #61: Create's Size and How many buttons keep their own height beside the taller Seed picker (studio.css).
// #62: Write it for me keeps its idea when Create switches between Video and Image (PromptWriter.jsx useKeptText).
// #63: the Renders list lets go of stopped and deleted renders (RenderHub.jsx, renders.js, main's jobs:gone).
//   node test/issues-56-63.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { imageGraph } from '../src/service/images.js'
import { Comfy } from '../src/service/comfy.js'
import { fitArgs, fitForUpload, fitTarget, tooBig, UPLOAD_LIMIT } from '../src/service/uploadfit.js'
import { isRunning, noSet, videoState } from '../src/renderer/src/renders.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}
const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const nodes = (g, cls) => Object.entries(g).filter(([, n]) => n.class_type === cls)

// ---------- #56 ----------
const qwen = (keepAspect) => imageGraph({ family: 'qwen21', mode: 'edit', unet: 'q.safetensors', te: 't.safetensors', vae: 'v.safetensors', prompt: 'x', width: 944, height: 528, refs: ['face1.png', 'face2.png', 'place.png'], seed: 1, steps: 20, cfg: 4, megapixels: 0.5, prefix: 'p', keepAspect })
{
  const g = qwen(true)
  const [encId] = nodes(g, 'TextEncodeQwenImage21')[0]
  const ks = nodes(g, 'KSampler')[0][1]
  const lat = g[ks.inputs.latent_image[0]]
  check('#56 a kept-frame Qwen edit samples on an empty latent at the film’s size', lat.class_type === 'EmptyLatentImage' && lat.inputs.width === 944 && lat.inputs.height === 528, JSON.stringify(lat))
  check('#56 its references still go to the encoder, face first', g[encId].inputs['images.image_1'] && g[encId].inputs['images.image_3'])
  const g2 = qwen(false)
  const ks2 = nodes(g2, 'KSampler')[0][1]
  check('#56 a plain Qwen edit still takes the encoder’s latent (its picture’s shape)', g2[ks2.inputs.latent_image[0]].class_type === 'TextEncodeQwenImage21')
}
check('#56 images.create passes keepAspect on to Qwen Image 2.1', /\['flux2', 'flux3', 'h3image', 'qwen21'\]\.includes\(fam\.id\)/.test(src('src/service/images.js')))

// ---------- #58 ----------
check('#58 the limit is ComfyUI’s default, 100 MB', UPLOAD_LIMIT === 104857600)
check('#58 the issue’s 104,900,464-byte body is too big', tooBig(104900464) && !tooBig(50 * 1024 * 1024))
{
  const a = fitArgs('in.mp4', 'out.mp4', { seconds: 15, hasAudio: true })
  const k = Number(a[a.indexOf('-maxrate') + 1].replace('k', ''))
  const bytes = ((k + 160) * 1000 * 15) / 8
  check('#58 a 15 s copy is capped to land under the limit', bytes <= fitTarget() && bytes > fitTarget() * 0.9, `${k}k -> ${bytes} bytes`)
  check('#58 the copy keeps the sound', a.includes('aac') && a.includes('0:a:0?'))
  check('#58 a silent video stays silent', fitArgs('in.mp4', 'o.mp4', { seconds: 5, hasAudio: false }).includes('-an'))
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-58-'))
const ffmpeg = ffmpegStatic.ffmpegPath
const ffprobe = ffmpegStatic.ffprobePath
{
  // a noisy 4 s clip with sound, near-lossless, so it's several MB; a 2 MB limit stands in for ComfyUI's 100 MB
  const big = path.join(tmp, 'source clip.mp4')
  const made = spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-vf', 'noise=alls=60:allf=t', '-c:v', 'libx264', '-crf', '4', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', big])
  const limit = 2 * 1024 * 1024
  check('#58 test clip made, over the stand-in limit', made.status === 0 && fs.statSync(big).size > limit, `${made.stderr}`)
  const out = await fitForUpload(big, { ffmpeg, ffprobe, dir: path.join(tmp, 'media'), limit })
  check('#58 a too-big video comes back as a new copy under the limit', out !== big && fs.statSync(out).size < limit, `${fs.statSync(out).size} bytes`)
  const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', out], { encoding: 'utf8' })
  const info = JSON.parse(probe.stdout)
  const v = info.streams.find((s) => s.codec_type === 'video')
  check('#58 the copy keeps its size, length and sound', v.width === 640 && v.height === 360 && Math.abs(Number(info.format.duration) - 4) < 0.2 && info.streams.some((s) => s.codec_type === 'audio'), probe.stdout)
  check('#58 the next upload reuses the copy', (await fitForUpload(big, { ffmpeg, ffprobe, dir: path.join(tmp, 'media'), limit })) === out)
  check('#58 the original is untouched', fs.statSync(big).size > limit)
  check('#58 a small file goes up as it is', (await fitForUpload(out, { ffmpeg, ffprobe, dir: path.join(tmp, 'media'), limit })) === out)
  const pic = path.join(tmp, 'huge.png')
  fs.writeFileSync(pic, Buffer.alloc(limit + 10))
  let said = ''
  await fitForUpload(pic, { ffmpeg, ffprobe, dir: tmp, limit }).catch((e) => (said = e.message))
  check('#58 a too-big picture is refused in words', /more than ComfyUI takes in one upload/.test(said), said)

  // Comfy.upload sends what the fitter gives, and a 413 is said in words
  const c = new Comfy('http://127.0.0.1:1')
  let sent = null
  c.req = async (route, opts) => ((sent = opts.body.get('image').name), { name: sent, subfolder: 'iv_studio' })
  c.fitter = async () => out
  await c.upload(big)
  check('#58 Comfy.upload uploads the fitted copy', sent === path.basename(out), sent)
  c.fitter = null
  c.req = async () => {
    throw Object.assign(new Error('ComfyUI /upload/image 413: Maximum request body size 104857600 exceeded'), { status: 413 })
  }
  said = ''
  await c.upload(out).catch((e) => (said = e.message))
  check('#58 a 413 says the file is too big for ComfyUI’s upload limit', /too big for ComfyUI's upload limit/.test(said), said)
  check('#58 Studio sets the fitter on its ComfyUI', /this\.comfy\.fitter = \(file\) => fitForUpload\(/.test(src('src/service/studio.js')))
}
fs.rmSync(tmp, { recursive: true, force: true })

// ---------- #61 ----------
const css = src('src/renderer/src/studio.css')
check('#61 Create’s fields keep their own height in a row', /\.create-grid > \.create-field \{\s*align-content: start;/.test(css))
check('#61 their button rows stay as wide as their buttons', /\.create-field > \.segmented \{\s*justify-self: start;/.test(css))

// ---------- #62 ----------
const pw = src('src/renderer/src/components/PromptWriter.jsx')
const create = src('src/renderer/src/components/Create.jsx')
check('#62 a kept text outlives its card', /const keptText = new Map\(\)/.test(pw) && /export function useKeptText\(key\)/.test(pw))
check('#62 the Video writer keeps its idea', /useKeptText\(keep\)/.test(pw) && /keep="create:writer"/.test(create))
check('#62 the Image writer keeps its idea', /useKeptText\('images:writer'\)/.test(pw))
check('#62 the banner’s idea is kept too', /useKeptText\('create:quick'\)/.test(create))

// ---------- #63 ----------
check('#63 a deleted job reads as gone, not waiting', videoState({ id: 'a', status: 'gone' }).stage === 'gone' && !isRunning({ state: { stage: 'gone' } }))
check('#63 a deleted picture set is recognised', noSet(new Error('No picture set ab12cd34.')) && noSet(new Error("Error invoking remote method 'images:get': Error: No picture set x.")) && !noSet(new Error('ComfyUI isn’t answering')))
const hub = src('src/renderer/src/components/RenderHub.jsx')
const main = src('src/main/index.js')
check('#63 Stop takes the render off the list unless it finished', /if \(!finished\) forget\(\[r\.key\]\)/.test(hub))
check('#63 a Stop that ComfyUI never got keeps the render, and says why', /if \(problem\) throw new Error\(`Couldn't stop/.test(hub))
check('#63 forget clears the list, the drop, the pop-up and the reveal', /setRenders\(\(all\) => all\.filter\(\(x\) => !keys\.includes\(x\.key\)\)\)/.test(hub) && /setDrops\(\(d\) => d\.filter\(\(k\) => !keys\.includes\(k\)\)\)/.test(hub) && /setPopup/.test(hub) && /setOpening/.test(hub))
check('#63 a job update saying gone forgets its renders', /j\.status === 'gone'\) return forget/.test(hub))
check('#63 finished renders are checked for deletion', /window\.ivstudio\.jobs\.gone\(ids\)/.test(hub) && /handle\('jobs:gone'/.test(main) && /gone: call\('jobs:gone'\)/.test(src('src/preload/index.js')))
check('#63 main stops following a job whose file is gone', /status: gone \? 'gone' : 'unknown'/.test(main) && /if \(gone\) pending\.delete\(id\)/.test(main))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
