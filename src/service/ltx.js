// LTX 2.5 (Lightricks, open weights, in ComfyUI core): a second video model beside MiniMax H3, on this PC and free.
// Built from ComfyUI's own LTX 2.5 templates (video_ltx2_5_t2v / i2v / flf2v): the 22B distilled transformer with
// its Gemma 4 text encoder, video and audio VAEs, sampled in two stages: a half-size pass, then Lightricks' latent
// upscaler x2 and a short refining pass. A take is the half-size pass (fast); finishing a take runs the same pass
// with the same seed (so it is the same take) and then the upscale stage, to full size with its own sound.
// LTX 2.5 makes a shot from words, or from a first frame (and a last frame). It has no character LoRAs or
// reference pictures here: a person stays the same through their first frame.

export const LTX = 'ltx'
export const LTX_LABEL = 'LTX 2.5'
export const LTX_MODES = ['text', 'frames']
export const LTX_SECONDS = { min: 2, max: 20 }
export const LTX_FPS = 24
// the half-size pass a take is (about 0.25 MP: 672x384 at 16:9); finished, each side doubles
export const LTX_TAKE_MP = 0.25

export const LTX_FILES = {
  unet: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
  clip: 'gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors',
  vae: 'ltx-2.5-video-vae-bf16.safetensors',
  audioVae: 'ltx-2.5-audio-vae-bf16.safetensors',
  upscaler: 'ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors'
}
// models.json ids of those files (Setup's download list)
export const LTX_MODEL_IDS = ['ff_ltx_2_5_22b_distilled_transformer_comfy_int8_convrot', 'ff_gemma4_12b_with_proj_ltx_2_5_comfy_int8_convrot', 'ff_ltx_2_5_video_vae_bf16', 'ff_ltx_2_5_audio_vae_bf16', 'ltx_spatial_upscaler']

// the distilled model's own schedules, from ComfyUI's templates
const SIGMAS_TAKE = '1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0'
const SIGMAS_REFINE = '0.85, 0.7250, 0.4219, 0.0'
// no "cartoon" here: LTX 2.5 is the model people pick for cartoons (GitHub #34)
export const LTX_NEGATIVE = 'blurry, out of focus, low quality, flicker, distorted faces, deformed hands, extra limbs, watermark, text, subtitles, logo'

const RATIOS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9] }

// The take's size: about mp megapixels at the aspect, each side a multiple of 32 (so the finish, x2, is of 64).
export function ltxTakeSize(aspect = '16:9', mp = LTX_TAKE_MP) {
  const [a, b] = RATIOS[aspect] || RATIOS['16:9']
  const px = mp * 1e6
  const w = Math.sqrt((px * a) / b)
  const r32 = (x) => Math.max(256, Math.round(x / 32) * 32)
  return { width: r32(w), height: r32((w * b) / a) }
}
// LTX lengths are 8n+1 frames
export const ltxFrames = (seconds) => Math.max(1, Math.round((Math.min(LTX_SECONDS.max, Math.max(LTX_SECONDS.min, Number(seconds) || 5)) * LTX_FPS) / 8)) * 8 + 1

// A Create request (or a film shot's) as an LTX plan. media: [{ kind: 'picture', file }] (first, then last frame).
export function planLtx(request = {}) {
  const mode = request.mode || 'text'
  if (!LTX_MODES.includes(mode)) throw new Error(`LTX 2.5 makes shots from words, or from a first (and last) frame. Switch to MiniMax H3 for ${mode === 'reference' ? 'References' : mode === 'continue' ? 'Continue' : 'this'} mode.`)
  const pictures = (request.media || []).filter((m) => m.kind === 'picture' && (m.file || m.path))
  if (mode === 'frames' && !pictures.length) throw new Error('First / last frame needs a first frame picture.')
  const prompt = String(request.prompt || '').trim()
  if (!prompt) throw new Error('Write what happens in the shot first.')
  const take = ltxTakeSize(request.aspect, LTX_TAKE_MP)
  const frames = ltxFrames(request.seconds)
  const previews = Math.min(3, Math.max(1, Number(request.previews) || 2))
  const seed = Number.isInteger(Number(request.seed)) ? Number(request.seed) : Math.floor(Math.random() * 1e9)
  return {
    request: { ...request, mode, prompt, aspect: request.aspect || '16:9', engine: LTX },
    resolved: { width: take.width, height: take.height, finalWidth: take.width * 2, finalHeight: take.height * 2, frames, seconds: +((frames - 1) / LTX_FPS).toFixed(3), fps: LTX_FPS, previews, seeds: Array.from({ length: previews }, (_, i) => seed + i * 1000), model: LTX },
    frames: mode === 'frames' ? pictures.slice(0, 2).map((m) => m.file || m.path) : []
  }
}

// The graph. stage 'previews': every take's half-size pass, saved as H3/hunt/<name>_c<n>. stage 'final': take n's
// pass again (same seed), upscaled x2 and refined, saved as H3/final/<name>. pics: the frames' names in ComfyUI's input.
export function ltxGraph(plan, { stage = 'previews', candidate = 1, name = 'ltx', pics = [] } = {}) {
  const r = plan.resolved
  const g = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: LTX_FILES.unet, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: LTX_FILES.clip, type: 'ltxv', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: LTX_FILES.vae } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: LTX_FILES.audioVae } },
    pos: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: plan.request.prompt } },
    neg: { class_type: 'CLIPTextEncode', inputs: { clip: ['clip', 0], text: LTX_NEGATIVE } },
    cond: { class_type: 'LTXVConditioning', inputs: { positive: ['pos', 0], negative: ['neg', 0], frame_rate: r.fps } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler_ancestral' } },
    sigmas1: { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS_TAKE } },
    emptyV: { class_type: 'EmptyLTXVLatentVideo', inputs: { width: r.width, height: r.height, length: r.frames, batch_size: 1 } },
    emptyA: { class_type: 'LTXVEmptyLatentAudio', inputs: { frames_number: r.frames, frame_rate: r.fps, batch_size: 1, audio_vae: ['avae', 0] } }
  }
  const first = pics[0] || null
  const last = pics[1] || null
  // a frame picture resized to the pass's size, through LTX's own compression look (img_compression 18, as templated)
  const frame = (key, pic, w, h) => {
    if (!g[`${key}_load`]) g[`${key}_load`] = { class_type: 'LoadImage', inputs: { image: pic } }
    g[`${key}_${w}`] = { class_type: 'ImageScale', inputs: { image: [`${key}_load`, 0], upscale_method: 'lanczos', width: w, height: h, crop: 'center' } }
    g[`${key}_${w}_pre`] = { class_type: 'LTXVPreprocess', inputs: { image: [`${key}_${w}`, 0], img_compression: 18 } }
    return [`${key}_${w}_pre`, 0]
  }
  // one pass: frames placed (a first frame in place; first and last as guides), sampled, guides cropped, split
  const pass = (p, { latent, audio, w, h, sigmas, seed, strength }) => {
    let pos = ['cond', 0]
    let neg = ['cond', 1]
    let lat = latent
    if (first && !last) {
      g[`${p}_i2v`] = { class_type: 'LTXVImgToVideoInplace', inputs: { vae: ['vae', 0], image: frame('first', first, w, h), latent: lat, strength, bypass: false } }
      lat = [`${p}_i2v`, 0]
    } else if (first && last) {
      g[`${p}_g0`] = { class_type: 'LTXVAddGuide', inputs: { positive: pos, negative: neg, vae: ['vae', 0], latent: lat, image: frame('first', first, w, h), frame_idx: 0, strength } }
      g[`${p}_g1`] = { class_type: 'LTXVAddGuide', inputs: { positive: [`${p}_g0`, 0], negative: [`${p}_g0`, 1], vae: ['vae', 0], latent: [`${p}_g0`, 2], image: frame('last', last, w, h), frame_idx: -1, strength } }
      pos = [`${p}_g1`, 0]
      neg = [`${p}_g1`, 1]
      lat = [`${p}_g1`, 2]
    }
    g[`${p}_guider`] = { class_type: 'LTXVDualCFGGuider', inputs: { model: ['unet', 0], positive: pos, negative: neg, video_cfg: 1, audio_cfg: 1 } }
    g[`${p}_noise`] = { class_type: 'RandomNoise', inputs: { noise_seed: seed } }
    g[`${p}_av`] = { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: lat, audio_latent: audio } }
    g[`${p}_sample`] = { class_type: 'SamplerCustomAdvanced', inputs: { noise: [`${p}_noise`, 0], guider: [`${p}_guider`, 0], sampler: ['sampler', 0], sigmas, latent_image: [`${p}_av`, 0] } }
    g[`${p}_split`] = { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: [`${p}_sample`, 0] } }
    let video = [`${p}_split`, 0]
    if (first && last) {
      g[`${p}_crop`] = { class_type: 'LTXVCropGuides', inputs: { positive: pos, negative: neg, latent: video } }
      video = [`${p}_crop`, 2]
    }
    return { video, audio: [`${p}_split`, 1] }
  }
  const save = (key, video, audio, w, h, prefix) => {
    g[`${key}_dec`] = { class_type: 'VAEDecodeTiled', inputs: { samples: video, vae: ['vae', 0], tile_size: 512, overlap: 64, temporal_size: 64, temporal_overlap: 8 } }
    g[`${key}_snd`] = { class_type: 'LTXVAudioVAEDecode', inputs: { samples: audio, audio_vae: ['avae', 0] } }
    g[key] = { class_type: 'VHS_VideoCombine', inputs: { images: [`${key}_dec`, 0], audio: [`${key}_snd`, 0], frame_rate: r.fps, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } }
  }
  if (stage === 'previews') {
    r.seeds.forEach((seed, i) => {
      const n = i + 1
      const t = pass(`t${n}`, { latent: ['emptyV', 0], audio: ['emptyA', 0], w: r.width, h: r.height, sigmas: ['sigmas1', 0], seed, strength: 0.7 })
      save(`save${n}`, t.video, t.audio, r.width, r.height, `H3/hunt/${name}_c${n}`)
    })
    return g
  }
  const seed = r.seeds[candidate - 1] ?? r.seeds[0]
  const t = pass('t1', { latent: ['emptyV', 0], audio: ['emptyA', 0], w: r.width, h: r.height, sigmas: ['sigmas1', 0], seed, strength: 0.7 })
  g.upModel = { class_type: 'LatentUpscaleModelLoader', inputs: { model_name: LTX_FILES.upscaler } }
  g.up = { class_type: 'LTXVLatentUpsampler', inputs: { samples: t.video, upscale_model: ['upModel', 0], vae: ['vae', 0] } }
  g.sigmas2 = { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS_REFINE } }
  const f = pass('f', { latent: ['up', 0], audio: t.audio, w: r.finalWidth, h: r.finalHeight, sigmas: ['sigmas2', 0], seed: 42, strength: 1 })
  save('save', f.video, f.audio, r.finalWidth, r.finalHeight, `H3/final/${name}`)
  return g
}

// Which saved videos are which take: the previews graph saves take n as save<n>.
export function ltxTakes(outputs = {}, previews = 1) {
  const out = []
  for (let n = 1; n <= previews; n++) {
    const v = (outputs[`save${n}`]?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
    if (v) out.push({ candidate: n, file: v })
  }
  return out
}

// How the writer is told to write for LTX 2.5 (Lightricks' prompting guide, in IV Studio's words): one flowing
// present-tense paragraph, in the order things happen, with the shot, the look and the sound, spoken words quoted.
export const LTX_WRITER_RULES = `Write one prompt for LTX 2.5, a video model with sound. Rules:
- One flowing paragraph in the present tense, 4 to 8 sentences, in the order things happen. No headings, lists, tags or section names.
- Start with the shot and the subject (who or what, where, the light). Then the action, step by step, with the camera's own movement. Then the sound: the room, the effects, and any music.
- Describe people by what we see (age, hair, clothes, build), never by a name the model can't know. Keep the style the idea asks for (cartoon, 3D animation, anime, live action).
- Spoken words go in double quotes after who says them and how ("she says quietly, \\"..."). Only the words the idea gives.
- Nothing the camera can't see: no feelings without a visible sign, no backstory.
- When a first frame is given, the shot starts exactly on it: describe what moves from there.`

// The person's writer turns an idea into an LTX prompt. writer: { engine, model } (Settings → Prompt writer);
// frames: the first (and last) frame files, shown to a writer that sees pictures so it describes what's there.
export async function writeLtx({ writer, idea, mode = 'text', seconds = 5, frames = [], cpu = false }) {
  if (!String(idea || '').trim()) throw new Error('Describe the idea first.')
  const { askWriter } = await import('./filmcraft.js')
  const { jpegOf } = await import('./prompter.js')
  const images = []
  for (const [i, f] of frames.slice(0, 2).entries()) images.push({ name: i ? 'last-frame.jpg' : 'first-frame.jpg', data: await jpegOf({ file: f }) })
  const user = [
    `The idea: ${String(idea).trim()}`,
    `Length: about ${Math.round(seconds)} seconds.`,
    mode === 'frames' ? `The shot starts exactly on the first frame${frames.length > 1 ? ' and ends exactly on the last frame' : ''} (attached${writer?.engine === 'claude' ? ' as image files in your working folder: open them with the Read tool' : ''}). Describe what you see in it, then what moves.` : '',
    'Answer as JSON: { "prompt": "..." }.'
  ].filter(Boolean).join('\n')
  const out = await askWriter(writer, { system: LTX_WRITER_RULES, user, schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] }, cpu, temperature: 0.6, images })
  const prompt = String(out?.prompt || '').trim()
  if (!prompt) throw new Error('The writer gave no prompt back. Try again.')
  return prompt
}
