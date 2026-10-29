// Character training: invent a person, give them movement and a voice, train an H3 character LoRA, keep the best
// checkpoint as a character preset. The method is the one that made Tess (2026-10-24/25):
//   1 Design  Z-Image Turbo stills on this PC: face candidates, then the picked face's seed across scenes.
//   2 Clips   H3 reference-to-video talking clips from two stills (and a voice sample), or the user's own clips,
//             fitted to Fizgig's rules (24 fps, 17n+5 frames, sides multiple of 32, 32 kHz stereo).
//   3 Train   Fizgig on the user's own Modal account (resources/cloud/train_app.py), with a cost estimate first.
//   4 Pick    checkpoints rendered side by side on one seed; the chosen one becomes a character.
// Captions never describe the face or voice: whatever isn't described binds to the trigger word.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Cloud } from './cloud.js'
import { probe } from './media.js'
import { comboOptions } from './setup.js'

// Modal list prices (modal.com/pricing, 2026-10-28), billed by the second. secPerStep: measured on Tess's set
// (B200 0.45 s); the H200 figure scales Fizgig's own speed table.
export const TRAIN_GPUS = [
  { id: 'B200', label: 'B200 · 180 GB', perHour: 6.25, secPerStep: 0.45, note: 'Fastest. Tess trained in 29 minutes for $3.80.' },
  { id: 'H200', label: 'H200 · 141 GB', perHour: 4.54, secPerStep: 0.66, note: 'The fallback when B200s are busy.' }
]
const GRID = Array.from({ length: 8 }, (_, n) => 17 * n + 5) // 5 .. 124 frames
const VOLUME = 'iv-studio-train'

// Where each design still is set. Clothes and light vary so neither welds to the trigger.
export const SCENES = [
  'standing by a kitchen window in soft morning light, wearing a grey knitted jumper, waist-up, looking at the camera',
  'on a city street on an overcast day, wearing a dark green rain jacket, chest-up, three-quarter view',
  'sitting by the window of a busy café, wearing a cream cable-knit cardigan, holding a cup, medium shot',
  "in the driver's seat of a parked car, daylight through the windscreen, wearing a navy hoodie, chest-up",
  'on a sofa in a living room in the evening under a warm lamp, wearing an oversized black t-shirt, medium shot',
  'in a park in autumn, wearing a camel wool coat and a scarf, waist-up, looking slightly off camera',
  'at a desk in a home office with a laptop open, wearing a white button-up shirt, chest-up, ceiling light',
  'in profile by a window, wearing a black turtleneck, soft side light, close-up'
]
// Talking clips: where they are, what they say, what the room sounds like.
export const TALKS = [
  { scene: 'in a kitchen in the morning, wearing a grey knitted jumper, waist-up', line: "Okay, so I finally tried that recipe, and honestly? Not bad at all.", sound: 'A kettle hums in the background' },
  { scene: 'walking on a city street on an overcast day, wearing a dark green rain jacket, chest-up', line: "I'm about five minutes away. Don't start without me, alright?", sound: 'Light traffic and footsteps' },
  { scene: 'sitting by the window of a busy café, wearing a cream cardigan, medium close-up', line: 'You will not believe who just walked in here.', sound: 'Quiet café chatter and cups' },
  { scene: "in the driver's seat of a parked car on a rainy day, wearing a navy hoodie, chest-up", line: "Right. Deep breath. I can do this. I've got this.", sound: 'Rain patters on the roof' },
  { scene: 'on a sofa in a living room in the evening under a warm lamp, wearing a black t-shirt, medium shot', line: 'Is it just me, or does Sunday go twice as fast as every other day?', sound: 'A quiet room' },
  { scene: 'in a park in autumn, wearing a camel wool coat and a scarf, waist-up', line: 'Look at this. Every single tree has gone orange overnight.', sound: 'Birdsong and a light wind' },
  { scene: 'at a desk in a home office, wearing a white shirt, chest-up, ceiling light', line: 'Can everyone hear me? No? Let me try that again.', sound: 'A soft room tone and a keyboard' },
  { scene: 'leaning on a kitchen counter in the evening, wearing a dark red sweatshirt, medium close-up', line: "Promise me you'll never tell anyone I said that.", sound: 'A fridge hums' }
]

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'character'

// A made-up trigger H3 has no prior for, from the name: "Tess" -> "t3ss4" (the style Claire and Tess used).
export function suggestTrigger(name) {
  const base = slug(name).replace(/_/g, '').slice(0, 6) || 'char'
  return base.replace(/e/g, '3').replace(/i/g, '1').replace(/o/g, '0') + base.length
}

// Steps, minutes and dollars for a run. items: stills + clips; clips cost more per step, which the
// measured seconds-per-step already averages in for a Tess-like mix.
export function estimate({ items, epochs, gpu = 'B200' }) {
  const g = TRAIN_GPUS.find((x) => x.id === gpu) || TRAIN_GPUS[0]
  const steps = items * epochs
  const minutes = (steps * g.secPerStep) / 60 + 7 // caching the dataset and starting up
  return { steps, minutes: Math.ceil(minutes), dollars: +((minutes / 60) * g.perHour + 0.15).toFixed(2), gpu: g.id, perHour: g.perHour }
}

// Enough steps to learn a face from a small set without burning money on a big one (Claire: ~3,500).
export const defaultEpochs = (items) => Math.max(40, Math.min(120, Math.round(2800 / Math.max(1, items))))

// Fizgig's commands, as Tess's train.sh (checked against Fizgig 4b3f07f).
export function trainScript({ name, epochs, saveEvery }) {
  const v = '/vol'
  const root = `${v}/train/${name}`
  return `#!/usr/bin/env bash
set -euo pipefail
cd "/opt/Fizgig"
export PYTHONPATH="/opt/Fizgig/src\${PYTHONPATH:+:$PYTHONPATH}"
python3 src/fizgig/families/cache.py --family minimax --stage latents --dataset_config "${root}/dataset.toml" --model "${v}/models/minimax_h3_video_vae_fp16.safetensors" --aux "audio_vae=${v}/models/minimax_h3_audio_vae_fp32.safetensors" --aux clip_still=1
python3 src/fizgig/families/cache.py --family minimax --stage text --dataset_config "${root}/dataset.toml" --model "${v}/models/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
python3 src/fizgig/families/train.py --family minimax \\
  --dataset_config "${root}/dataset.toml" \\
  --dit "${v}/models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" \\
  --vae "${v}/models/minimax_h3_video_vae_fp16.safetensors" \\
  --text_encoder "${v}/models/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \\
  --output_dir "${root}/loras" --output_name ${name}_mmh3 \\
  --network_dim 16 --network_alpha 16 \\
  --optimizer_type automagic3 --learning_rate 1e-6 \\
  --max_train_epochs ${epochs} --save_every_n_epochs ${saveEvery} --seed 42 \\
  --save_state --save_state_on_train_end --keep_last_n_states 2 \\
  --precision auto --blocks_to_swap -1 --ema_decay 0.98 \\
  --training_adapter "${v}/models/minimax_h3_image_training_adapter.safetensors" \\
  --family_option lownoise_pct=60 --family_option highnoise_lr_pct=100 \\
  --family_option photo_blocks=20-49 --family_option clip_blocks=20-49 --family_option audio_blocks=20-49 \\
  --family_option tread=0.5@2-47 --family_option clip_still_as_photo=1 --family_option caption_dropout=0.05 \\
  --family_option "audio_vae=${v}/models/minimax_h3_audio_vae_fp32.safetensors"
`
}

export const datasetToml = (name) => `[general]
resolution = [512, 512]
caption_extension = ".txt"
batch_size = 1
num_repeats = 1
enable_bucket = true
bucket_no_upscale = true

[[datasets]]
image_directory = "/vol/datasets/${name}"
cache_directory = "/vol/train/${name}/cache"
`

// The H3 reference-to-video prompt for one talking clip.
export function talkPrompt({ who, talk, voice }) {
  return `subject_definitions: <Subject 1> is the person in <Picture 1> and <Picture 2>: ${who}.

retention_analysis: <Picture 1>: identity - keep this face and hair exactly. <Picture 2>: the same person in other clothes and light - identity only; the clothes and the place follow the description.${voice ? ' <Audio 1>: voice - keep this voice exactly.' : ''}

detailed_description: [Shot 1] Live-action, filmed on a smartphone held at arm's length, one continuous take. There is no writing anywhere in the picture. <Subject 1> is ${talk.scene}. <Subject 1> (S1) looks into the camera and says: <d>[English] ${talk.line}</d> Then <Subject 1> smiles and settles, lips closed.

overall_soundscape: ${talk.sound}. The voice is close and natural.

non_diegetic_music: N/A`
}

export class Trainings {
  // studio: the Studio service (renders, characters). onLog(line, trainingId) gets Modal's output.
  constructor({ dataDir, resourcesDir, studio, ffmpeg, ffprobe, onLog, onChange }) {
    this.dir = path.join(dataDir, 'trainings')
    this.dataDir = dataDir
    this.resourcesDir = resourcesDir
    this.studio = studio
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
    this.onChange = onChange || (() => {})
    this.active = null // the training whose Modal output is streaming
    this.runs = new Map() // training id -> running modal process promise
    this.cloud = new Cloud({ dataDir, resourcesDir, onLog: (line) => this.line(line, onLog) })
  }

  // ---------- records ----------
  folder = (id) => path.join(this.dir, id)
  file = (id) => path.join(this.folder(id), 'training.json')
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((d) => readJson(path.join(this.dir, d, 'training.json'), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ id: t.id, name: t.name, trigger: t.trigger, step: this.stepOf(t), cover: t.face?.file || null, state: t.train?.state || null, characterId: t.characterId || null, updatedAt: t.updatedAt }))
  }
  get(id) {
    const t = readJson(this.file(id), null)
    if (!t) throw new Error(`No character training ${id}`)
    return t
  }
  write(t) {
    t.updatedAt = now()
    fs.mkdirSync(this.folder(t.id), { recursive: true })
    fs.writeFileSync(`${this.file(t.id)}.tmp`, JSON.stringify(t, null, 2))
    fs.renameSync(`${this.file(t.id)}.tmp`, this.file(t.id))
    this.onChange(t.id)
    return t
  }
  create({ name, who = 'a woman in her thirties' }) {
    if (!name?.trim()) throw new Error('Give the character a name.')
    const t = { id: randomUUID().slice(0, 8), name: name.trim(), trigger: suggestTrigger(name), who, face: null, consent: false, faceText: '', faceCandidates: [], stills: [], clips: [], voice: null, train: null, checkpoints: [], tests: [], characterId: null, createdAt: now() }
    t.projectId = this.studio.createProject(`Training · ${t.name}`, null, t.id).id
    return this.write(t)
  }
  // name, trigger, who, faceText, consent, voice ({path}), clips' lines: the fields a person edits directly.
  save(id, patch) {
    const t = this.get(id)
    for (const k of ['name', 'trigger', 'who', 'faceText', 'consent', 'voice']) if (patch[k] !== undefined) t[k] = patch[k]
    if (patch.trigger !== undefined && !/^[a-z0-9]{3,12}$/i.test(t.trigger)) throw new Error('The trigger word is 3-12 letters and numbers, made up so H3 has no idea what it means (like t3ss4).')
    return this.write(t)
  }
  remove(id) {
    fs.rmSync(this.folder(id), { recursive: true, force: true })
    return true
  }
  stepOf(t) {
    if (t.characterId) return 'done'
    if (t.train?.state === 'done') return 'pick'
    if (t.train) return 'train'
    if (t.stills.some((s) => s.pick != null || s.source === 'upload')) return 'clips'
    return 'design'
  }

  // Every unfinished render of a training, refreshed; then the record with each job's state and files.
  async refresh(id) {
    const t = this.get(id)
    const jobs = [...t.faceCandidates.map((c) => c.jobId), ...t.stills.flatMap((s) => s.candidates.map((c) => c.jobId)), ...t.clips.map((c) => c.jobId), ...t.tests.map((x) => x.jobId)].filter(Boolean)
    const state = {}
    for (const j of new Set(jobs)) {
      try {
        const r = await this.studio.refreshJob(j)
        state[j] = { status: r.status, outputs: r.outputs, error: r.error, progress: r.progress, queuePosition: r.queuePosition }
      } catch (err) {
        state[j] = { status: 'error', error: err.message, outputs: [] }
      }
    }
    // a finished clip render becomes the clip's file
    let filled = false
    for (const c of t.clips) {
      const out = !c.file && state[c.jobId]?.status === 'success' && state[c.jobId].outputs.find((o) => o.kind === 'preview')
      if (out) (c.file = { path: out.path, url: out.url, filename: out.filename }), (filled = true)
    }
    if (filled) this.write(t)
    return { ...t, jobs: state, estimate: this.estimateFor(t) }
  }

  // ---------- 1 design: Z-Image Turbo stills ----------
  async stillModels() {
    const [u, c, v, l] = await Promise.all(['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly'].map((k) => this.studio.comfy.objectInfo(k)))
    const find = (opts, re) => (opts || []).find((o) => re.test(o.replace(/\\/g, '/').split('/').pop()))
    const m = {
      unet: find(comboOptions(u, 'UNETLoader', 'unet_name'), /^(z_image_turbo_(bf16|int8_convrot)|z image turbo_turbo)\.safetensors$/i),
      clip: find(comboOptions(c, 'CLIPLoader', 'clip_name'), /^qwen_3_4b(_fp8_mixed)?\.safetensors$/i),
      vae: find(comboOptions(v, 'VAELoader', 'vae_name'), /^ae\.safetensors$/i),
      lora: find(comboOptions(l, 'LoraLoaderModelOnly', 'lora_name'), /SmartphoneSnapshotPhotoReality_v8/i)
    }
    const missing = ['unet', 'clip', 'vae'].filter((k) => !m[k])
    if (missing.length) throw new Error('Designing a character needs Z-Image Turbo, its text encoder (qwen_3_4b) and VAE (ae). Download them on the Setup page, under "For designing characters".')
    return m
  }
  // Tess's still settings: euler / simple, 9 steps, cfg 1, AuraFlow shift 3, the Snapshot v8 LoRA at 1.0 when present.
  stillGraph(models, { prompt, seed, width = 832, height = 1216, prefix }) {
    const lora = !!models.lora
    const text = lora && !/amateur photo/i.test(prompt) ? `amateur photo, ${prompt}` : prompt
    const g = {
      1: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
      2: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'lumina2', device: 'default' } },
      3: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
      5: { class_type: 'ModelSamplingAuraFlow', inputs: { model: lora ? ['4', 0] : ['1', 0], shift: 3 } },
      6: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
      7: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
      8: { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
      9: { class_type: 'KSampler', inputs: { model: ['5', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed, steps: 9, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
      10: { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
      11: { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: prefix } }
    }
    if (lora) g[4] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: models.lora, strength_model: 1 } }
    return g
  }
  async renderStill(t, models, { prompt, seed, tag }) {
    const graph = this.stillGraph(models, { prompt, seed, prefix: `IV Studio/characters/${slug(t.name)}_${t.id}/${tag}_${seed}` })
    const job = await this.studio.submitGraph({ kind: 'still', graph, projectId: t.projectId, plan: { images: true, request: { prompt, seed } }, name: `${slug(t.name)}_${tag}` })
    return job.id
  }

  // Four face candidates, each its own seed, from the face description.
  async designFaces(id, { faceText, who } = {}) {
    let t = this.save(id, { ...(faceText !== undefined && { faceText }), ...(who !== undefined && { who }) })
    if (!t.faceText.trim()) throw new Error('Describe the face first: age, face shape, hair, eyes, skin, anything distinctive.')
    const models = await this.stillModels()
    const base = Math.floor(Math.random() * 1e6) * 10
    const prompt = `${t.who}, ${t.faceText}, close-up portrait looking at the camera, soft natural window light, a plain wall behind, candid phone photo`
    const round = []
    for (let k = 0; k < 4; k++) round.push({ jobId: await this.renderStill(t, models, { prompt, seed: base + k, tag: 'face' }), seed: base + k })
    t = this.get(id)
    t.faceCandidates = [...round, ...t.faceCandidates].slice(0, 12)
    return this.write(t)
  }
  pickFace(id, { jobId, file }) {
    const t = this.get(id)
    const c = t.faceCandidates.find((x) => x.jobId === jobId)
    if (!c) throw new Error('That face candidate is gone.')
    t.face = { seed: c.seed, jobId, file }
    return this.write(t)
  }

  // The picked face's seed and description across every scene: four candidates each. Z-Image keeps only a
  // family resemblance from seed to seed (0.4-0.6 face similarity), so the person picks the closest; two
  // candidates left Theo's set with three scenes under 0.4.
  async designScenes(id, { scenes = SCENES } = {}) {
    const t = this.get(id)
    if (!t.face) throw new Error('Pick a face first.')
    const models = await this.stillModels()
    for (const [k, scene] of scenes.entries()) {
      const prompt = `${t.who}, ${t.faceText}, ${scene}, candid phone photo`
      const candidates = []
      for (const s of [0, 7, 14, 21].map((d) => t.face.seed + d)) candidates.push({ jobId: await this.renderStill(t, models, { prompt, seed: s, tag: `scene${k + 1}` }), seed: s })
      t.stills.push({ id: randomUUID().slice(0, 6), source: 'generated', scene, caption: `${t.trigger}, ${t.who}, ${scene}`, candidates, pick: null, file: null })
    }
    return this.write(t)
  }
  // Another two candidates for one scene (new seeds near the face's).
  async rerollStill(id, stillId) {
    const t = this.get(id)
    const s = t.stills.find((x) => x.id === stillId)
    if (!s || s.source !== 'generated') throw new Error('That still is gone.')
    const models = await this.stillModels()
    const prompt = `${t.who}, ${t.faceText}, ${s.scene}, candid phone photo`
    const n = s.candidates.length
    for (const k of [0, 1]) {
      const seed = t.face.seed + 13 * (n + k + 1)
      s.candidates.push({ jobId: await this.renderStill(t, models, { prompt, seed, tag: `scene_r${n + k}` }), seed })
    }
    return this.write(t)
  }
  // pick: a candidate index, or null to leave the scene out. file: that candidate's output (from refresh).
  pickStill(id, stillId, { pick, file = null }) {
    const t = this.get(id)
    const s = t.stills.find((x) => x.id === stillId)
    if (!s) throw new Error('That still is gone.')
    Object.assign(s, { pick, file: pick == null ? null : file })
    return this.write(t)
  }
  // The user's own pictures of the character (an invented person, or someone who agreed).
  addStills(id, paths, caption = '') {
    const t = this.get(id)
    if (!t.consent) throw new Error('Confirm the pictures are of an invented person, or of someone who agreed to this.')
    for (const p of paths) t.stills.push({ id: randomUUID().slice(0, 6), source: 'upload', scene: caption, caption: `${t.trigger}, ${t.who}${caption ? `, ${caption}` : ''}`, candidates: [], pick: 0, file: { path: p } })
    return this.write(t)
  }
  setCaption(id, kind, itemId, text) {
    const t = this.get(id)
    const item = (kind === 'still' ? t.stills : t.clips).find((x) => x.id === itemId)
    if (!item) throw new Error('That item is gone.')
    if (!text.startsWith(t.trigger)) text = `${t.trigger}, ${text}`
    item.caption = text
    return this.write(t)
  }
  removeItem(id, kind, itemId) {
    const t = this.get(id)
    if (kind === 'still') t.stills = t.stills.filter((x) => x.id !== itemId)
    else t.clips = t.clips.filter((x) => x.id !== itemId)
    return this.write(t)
  }

  // ---------- 2 clips: talking H3 clips, or the user's own ----------
  keptStills = (t) => t.stills.filter((s) => s.file && (s.pick != null || s.source === 'upload'))
  // The face references for clip k: the picked face close-up (or the first kept still) carries identity in
  // every clip; one kept still adds the person in other clothes and light. Rotating through scene stills alone
  // let a weak still make a weak clip (Theo, 2026-10-28: an office still at 0.29 likeness gave a clip at 0.12).
  async clipRefs(t) {
    const stills = this.keptStills(t)
    if (!t.face?.file && stills.length < 2) throw new Error('Pick a face, or keep at least two stills, first: the clips use them as the face.')
    if (!stills.length) throw new Error('Keep at least one still first.')
    const dir = path.join(this.folder(t.id), 'stills')
    const face = t.face?.file ? await this.studio.localCopy(t.face.file, dir) : await this.studio.localCopy(stills[0].file, dir)
    const others = await Promise.all(stills.map((s) => this.studio.localCopy(s.file, dir)))
    return (k) => [face, others[k % others.length]]
  }
  async renderClip(t, refs, talk, k, seed) {
    const [face, still] = refs(k)
    return this.studio.generatePreviews({
      projectId: t.projectId,
      mode: 'reference',
      character: 'none',
      prompt: talkPrompt({ who: t.who, talk, voice: !!t.voice?.path }),
      media: [{ kind: 'picture', file: face }, { kind: 'picture', file: still }, ...(t.voice?.path ? [{ kind: 'audio', file: t.voice.path }] : [])],
      aspect: k % 3 === 2 ? '9:16' : '16:9',
      megapixels: 0.3,
      seconds: 5,
      previews: 1,
      steps: 8,
      seed
    })
  }
  async makeClips(id, { talks = TALKS, seed = 7100 } = {}) {
    const t = this.get(id)
    const refs = await this.clipRefs(t)
    // The design stills leave Z-Image (about 20 GB) in ComfyUI's memory. With H3's 40 GB on top, a 64 GB PC
    // pages the offloaded part of H3 to disk and a 1-minute clip takes 20 (seen 2026-10-28), so drop it first.
    await this.studio.comfy.freeMemory().catch(() => {})
    for (const [k, talk] of talks.entries()) {
      const job = await this.renderClip(t, refs, talk, k, seed + k)
      t.clips.push({ id: randomUUID().slice(0, 6), source: 'generated', talk, index: k, seed: seed + k, caption: `${t.trigger}, ${t.who}, ${talk.scene}, talking to the camera, handheld phone video. (S1) says: <d>[English] ${talk.line}</d>`, jobId: job.id, keep: true, file: null })
    }
    return this.write(t)
  }
  // Renders a generated clip again (same scene and line, new seed, current references); the old take is dropped.
  async remakeClips(id, clipIds) {
    const t = this.get(id)
    const refs = await this.clipRefs(t)
    await this.studio.comfy.freeMemory().catch(() => {})
    for (const clipId of clipIds) {
      const c = t.clips.find((x) => x.id === clipId)
      if (!c || c.source !== 'generated') throw new Error('Only generated clips can be rendered again.')
      const k = c.index ?? TALKS.findIndex((x) => x.line === c.talk.line)
      c.seed = (c.seed ?? 7100 + k) + 1000
      c.jobId = (await this.renderClip(t, refs, c.talk, Math.max(0, k), c.seed)).id
      Object.assign(c, { file: null, keep: true })
    }
    return this.write(t)
  }
  keepClip(id, clipId, keep) {
    const t = this.get(id)
    const c = t.clips.find((x) => x.id === clipId)
    if (c) c.keep = !!keep
    return this.write(t)
  }
  addClips(id, paths, caption = '') {
    const t = this.get(id)
    if (!t.consent) throw new Error('Confirm the clips are of an invented person, or of someone who agreed to this.')
    for (const p of paths) t.clips.push({ id: randomUUID().slice(0, 6), source: 'upload', caption: `${t.trigger}, ${t.who}${caption ? `, ${caption}` : ''}`, keep: true, file: { path: p } })
    return this.write(t)
  }

  // ---------- the dataset (Fizgig's flat folder) ----------
  // One clip, or several back to back if it's long, on the frame grid at about 0.25 MP.
  async fitClip(src, outBase, maxParts = 3) {
    const info = await probe(this.ffprobe, src)
    if (info.kind !== 'video') throw new Error(`${path.basename(src)} isn't a video.`)
    const s = Math.sqrt(250000 / (info.width * info.height))
    const W = Math.max(256, Math.round((info.width * s) / 32) * 32)
    const H = Math.max(256, Math.round((info.height * s) / 32) * 32)
    let left = Math.floor(info.duration * 24 + 0.01)
    let at = 0
    const parts = []
    while (left >= 22 && parts.length < maxParts) {
      const frames = [...GRID].reverse().find((g) => g <= Math.min(124, left))
      const out = `${outBase}_${parts.length + 1}.mp4`
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', (at / 24).toFixed(3), '-i', src, '-frames:v', String(frames), '-vf', `fps=24,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=N/(24*TB)`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p']
      if (info.hasAudio) args.push('-af', 'aresample=32000,asetpts=PTS-STARTPTS', '-ac', '2', '-t', (frames / 24).toFixed(3), '-c:a', 'aac', '-b:a', '192k')
      else args.push('-an')
      await run(this.ffmpeg, [...args, out])
      parts.push({ file: out, frames, width: W, height: H })
      at += frames
      left -= frames
    }
    if (!parts.length) throw new Error(`${path.basename(src)} is under a second; clips need at least 22 frames.`)
    return parts
  }

  // Builds the dataset folder from the kept stills and clips; returns what's in it.
  async buildDataset(id) {
    const t = this.get(id)
    const dir = path.join(this.folder(id), 'dataset')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const name = slug(t.name)
    let n = 0
    for (const s of this.keptStills(t)) {
      const src = await this.studio.localCopy(s.file, path.join(this.folder(id), 'stills'))
      const base = path.join(dir, `${name}_still_${String(++n).padStart(2, '0')}`)
      fs.copyFileSync(src, `${base}${path.extname(src).toLowerCase() || '.png'}`)
      fs.writeFileSync(`${base}.txt`, s.caption)
    }
    let c = 0
    for (const clip of t.clips.filter((x) => x.keep && x.file)) {
      const src = await this.studio.localCopy(clip.file, path.join(this.folder(id), 'clips'))
      for (const part of await this.fitClip(src, path.join(dir, `${name}_clip_${String(++c).padStart(2, '0')}`))) fs.writeFileSync(part.file.replace(/\.mp4$/, '.txt'), clip.caption)
    }
    const files = fs.readdirSync(dir)
    return { dir, stills: n, clips: files.filter((f) => f.endsWith('.mp4')).length, items: files.filter((f) => !f.endsWith('.txt')).length }
  }

  estimateFor(t, { gpu, epochs } = {}) {
    const items = this.keptStills(t).length + t.clips.filter((x) => x.keep && x.file).length * 1.3
    const e = epochs || t.train?.epochs || defaultEpochs(items)
    return { ...estimate({ items: Math.round(items), epochs: e, gpu: gpu || t.train?.gpu || 'B200' }), epochs: e }
  }

  // ---------- 3 train on Modal ----------
  get trainDir() {
    return path.join(this.dataDir, 'cloud', 'train')
  }
  modal(args, env = {}) {
    if (!this.cloud.toolkitReady()) throw new Error('Set up the cloud tools first (Cloud page, step 1).')
    fs.mkdirSync(this.trainDir, { recursive: true })
    fs.copyFileSync(path.join(this.resourcesDir, 'cloud', 'train_app.py'), path.join(this.trainDir, 'train_app.py'))
    return this.cloud.exec(this.cloud.modalExe, args, { cwd: this.trainDir, env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MSYS_NO_PATHCONV: '1', ...env } })
  }
  setTrain(id, patch) {
    const t = this.get(id)
    t.train = { ...(t.train || {}), ...patch }
    return this.write(t)
  }
  // Runs every step from the dataset to the end of training; resolves when the run is over. The run keeps
  // going on Modal if IV Studio closes (--detach); checkTraining() picks it up again from the volume's log.
  async startTraining(id, { gpu = 'B200', epochs } = {}) {
    if (this.runs.size) throw new Error('A character is already training. One at a time.')
    if (!(await this.cloud.workspace())) throw new Error('Sign in to Modal on the Cloud page first (steps 1 and 2).')
    const t = this.get(id)
    const est = this.estimateFor(t, { gpu, epochs })
    const runName = `${slug(t.name)}_${t.id}_${(t.train?.run || 0) + 1}`
    this.setTrain(id, { state: 'preparing', gpu, epochs: est.epochs, run: (t.train?.run || 0) + 1, name: runName, startedAt: now(), progress: null, error: null, estimate: est })
    const work = (async () => {
      this.active = id
      try {
        const ds = await this.buildDataset(id)
        if (ds.stills < 4 || ds.items < 8) throw new Error(`The set is too small to learn a face (${ds.stills} stills, ${ds.clips} clips). Keep at least 4 stills and 8 items in all.`)
        const root = path.join(this.folder(id), 'train')
        fs.mkdirSync(root, { recursive: true })
        const saveEvery = Math.max(1, Math.round(est.epochs / 40))
        fs.writeFileSync(path.join(root, 'train.sh'), trainScript({ name: runName, epochs: est.epochs, saveEvery }).replace(/\r\n/g, '\n'))
        fs.writeFileSync(path.join(root, 'dataset.toml'), datasetToml(runName))
        this.setTrain(id, { state: 'models', dataset: ds })
        await this.modal(['run', 'train_app.py::fetch_models'])
        this.setTrain(id, { state: 'uploading' })
        await this.modal(['volume', 'put', VOLUME, ds.dir, `/datasets/${runName}`, '--force'])
        for (const f of ['train.sh', 'dataset.toml']) await this.modal(['volume', 'put', VOLUME, path.join(root, f), `/train/${runName}/${f}`, '--force'])
        this.setTrain(id, { state: 'training', trainingAt: now() })
        await this.modal(['run', '--detach', 'train_app.py::train', '--name', runName], { IV_TRAIN_GPU: gpu })
        this.setTrain(id, { state: 'done', finishedAt: now() })
        await this.listCheckpoints(id).catch(() => {})
      } catch (err) {
        const cur = this.get(id).train
        // the local client can drop (sleep, network) while Modal carries on: check the log before calling it failed
        if (cur?.state === 'training') await this.checkTraining(id).catch(() => {})
        if (this.get(id).train?.state !== 'done') this.setTrain(id, { state: 'failed', error: err.message.split('\n').slice(-4).join(' ') })
      } finally {
        this.active = null
        this.runs.delete(id)
      }
    })()
    this.runs.set(id, work)
    return this.get(id)
  }
  // Modal's output, line by line: progress for the running training, and the log for the window.
  line(text, onLog) {
    const id = this.active
    onLog?.(text, id)
    if (!id) return
    const m = /epoch (\d+)\/(\d+).*?step=(\d+)/.exec(text)
    const steps = /\|\s*(\d+)\/(\d+) \[/.exec(text)
    const stage = /Encoding dataset|latent cache/i.test(text) ? 'caching' : /stage text/i.test(text) ? 'captions' : null
    if (m || stage) {
      const t = this.get(id)
      const p = { ...(t.train?.progress || {}), at: now() }
      if (m) Object.assign(p, { epoch: Number(m[1]), epochs: Number(m[2]), step: Number(m[3]), stage: 'training' })
      else if (stage && p.stage !== 'training') p.stage = stage
      if (steps) p.steps = Number(steps[2])
      if (!this.lastWrite || Date.now() - this.lastWrite > 4000 || m?.[1] === m?.[2]) {
        this.lastWrite = Date.now()
        this.setTrain(id, { progress: p })
      }
    }
  }
  // After a restart, or when the local client lost the stream: read the run's log from the volume.
  async checkTraining(id) {
    const t = this.get(id)
    if (!t.train?.name || this.runs.has(id)) return t
    const tmp = path.join(this.folder(id), 'train', 'train.log')
    fs.rmSync(tmp, { force: true })
    try {
      await this.modal(['volume', 'get', VOLUME, `/train/${t.train.name}/train.log`, tmp, '--force'])
    } catch {
      return t
    }
    const log = fs.readFileSync(tmp, 'utf8')
    const last = [...log.matchAll(/epoch (\d+)\/(\d+).*?step=(\d+)/g)].pop()
    const patch = last ? { progress: { epoch: Number(last[1]), epochs: Number(last[2]), step: Number(last[3]), stage: 'training', at: now() } } : {}
    if (/TRAINING DONE/.test(log)) Object.assign(patch, { state: 'done', finishedAt: t.train.finishedAt || now(), error: null })
    else if (/command failed|Traceback/.test(log) && /\[modal\] finished/.test(log)) Object.assign(patch, { state: 'failed', error: 'Training stopped with an error; the log is in the training folder.' })
    this.setTrain(id, patch)
    if (patch.state === 'done') await this.listCheckpoints(id).catch(() => {})
    return this.get(id)
  }
  // Stops the training app on Modal (the GPU stops billing at once). Saved epochs stay in storage.
  async stopTraining(id) {
    await this.modal(['app', 'stop', 'iv-studio-train'])
    this.setTrain(id, { state: 'stopped' })
    return this.get(id)
  }

  // ---------- 4 pick ----------
  async listCheckpoints(id) {
    const t = this.get(id)
    const out = await this.modal(['volume', 'ls', VOLUME, `/train/${t.train.name}/loras`, '--json'])
    const rows = JSON.parse(out.slice(out.indexOf('[')))
    const files = rows.map((r) => r.Filename || r.filename || r.path).filter((f) => /-\d{6}\.safetensors$/.test(f)).map((f) => path.posix.basename(f))
    const t2 = this.get(id)
    t2.checkpoints = files.map((f) => ({ file: f, epoch: Number(f.match(/-(\d{6})\.safetensors$/)[1]), lora: t2.checkpoints?.find((c) => c.file === f)?.lora || null })).sort((a, b) => a.epoch - b.epoch)
    return this.write(t2)
  }
  // The LoRA folder of the local ComfyUI, where checkpoints are saved under MiniMax H3\<name>\.
  async loraDir(t) {
    const folders = await fetch(`${this.studio.comfy.url}/experiment/models`, { headers: this.studio.comfy.headers() }).then((r) => r.json())
    const root = folders.find((f) => f.name === 'loras')?.folders?.[0]
    if (!root || !fs.existsSync(root)) throw new Error("Couldn't find this ComfyUI's loras folder.")
    return { dir: path.join(root, 'MiniMax H3', slug(t.name)), rel: `MiniMax H3\\${slug(t.name)}` }
  }
  // Downloads the chosen epochs (about 150 MB each) next to the other character LoRAs.
  async fetchCheckpoints(id, epochs) {
    const t = this.get(id)
    const { dir, rel } = await this.loraDir(t)
    fs.mkdirSync(dir, { recursive: true })
    for (const c of t.checkpoints.filter((x) => epochs.includes(x.epoch))) {
      if (!fs.existsSync(path.join(dir, c.file))) await this.modal(['volume', 'get', VOLUME, `/train/${t.train.name}/loras/${c.file}`, path.join(dir, c.file), '--force'])
      c.lora = `${rel}\\${c.file}`
    }
    return this.write(t)
  }
  // The same talking close-up and seed for every downloaded checkpoint, at preview size.
  async testCheckpoints(id, { epochs, prompt, seed = 4242 } = {}) {
    const t = this.get(id)
    const ready = t.checkpoints.filter((c) => c.lora && (!epochs || epochs.includes(c.epoch)))
    if (!ready.length) throw new Error('Download some checkpoints first.')
    const text = prompt || `integrated_multimodal_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture. A medium close-up of {char}, ${t.who}, wearing a blue denim jacket, standing on a quiet street at golden hour. The camera is handheld, a gentle sway. {char} (S1) smiles at the camera and says: <d>[English] So this is me. What do you think?</d>\n\noverall_soundscape: A quiet street, distant traffic. The voice is close and natural.\n\nnon_diegetic_music: N/A`
    for (const c of ready) {
      const job = await this.studio.generatePreviews({ projectId: t.projectId, mode: 'text', prompt: text, previews: 1, megapixels: 0.4, seconds: 5, steps: 8, seed, aspect: '16:9', characterOverride: { id: `trial_${t.id}_${c.epoch}`, name: t.name, lora: c.lora, strength: 0.8, trigger: t.trigger } })
      t.tests = [...t.tests.filter((x) => x.epoch !== c.epoch), { epoch: c.epoch, jobId: job.id, seed }]
    }
    return this.write(t)
  }
  // The chosen checkpoint becomes a character preset (Create, Sequences, MCP).
  adopt(id, epoch) {
    const t = this.get(id)
    const c = t.checkpoints.find((x) => x.epoch === epoch && x.lora)
    if (!c) throw new Error('Download that checkpoint first.')
    const charId = slug(t.name).replace(/_/g, '-')
    const list = this.studio.characters().filter((x) => x.id !== charId)
    this.studio.saveCharacters([...list, { id: charId, name: t.name, lora: c.lora, strength: 0.8, trigger: t.trigger }])
    t.characterId = charId
    t.chosenEpoch = epoch
    return this.write(t)
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `${path.basename(cmd)} failed`))))
  })
}
