// Create -> Image: pictures made on this PC's ComfyUI with the person's own image models. Six families,
// each built after ComfyUI's official template for it (Comfy-Org's workflow templates, 2026-10), with the
// person's checkpoint, LoRAs (model-only), size, count and seed. Generate makes pictures from a prompt; Edit
// changes reference pictures with an instruction and only lists the families that can.
//
// A picture set is a ComfyUI job (a project with tool 'image'); when it finishes its pictures are copied
// into the app data's images/ folder, where the Library, the MCP server and Create's gallery find them.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { comboOptions } from './setup.js'

// unet: the family's checkpoints, by their folder or name in ComfyUI's diffusion_models.
// te / vae: the text encoder and VAE the official template uses, then compatible ones, first found wins.
// steps / cfg: the template's settings; base (undistilled) checkpoints get their own.
// loras: how the family's LoRAs are named (their folder or file), for the LoRA picker.
export const IMAGE_FAMILIES = [
  {
    id: 'flux2',
    label: 'Flux.2 Klein 9B',
    unet: /^flux ?2[\\/]|flux[.-]?2[-_ ]klein/i,
    te: { type: 'flux2', files: ['qwen_3_8b.safetensors', 'qwen_3_8b_fp8mixed.safetensors'] },
    vae: ['flux2-vae.safetensors', 'full_encoder_small_decoder.safetensors'],
    steps: 4,
    cfg: 1,
    base: { match: /base/i, steps: 20, cfg: 5 },
    edit: true,
    loras: /flux ?2|klein|klien/i,
    licence: 'FLUX Non-Commercial License (9B)',
    note: 'Fast, and edits with several reference pictures.'
  },
  {
    id: 'flux3',
    label: 'Flux 3 Klein',
    unet: /^flux ?3[\\/]|flux3[-_]image[-_]klein/i,
    te: { type: 'flux3', files: ['qwen3vl_4b_int8_convrot.safetensors', 'qwen3vl_4b_fp8_scaled.safetensors'] },
    vae: ['flux2-vae.safetensors'],
    steps: 15,
    cfg: 1,
    sampler: 'er_sde',
    editSteps: 16,
    edit: true,
    loras: /flux ?3|flux3/i,
    licence: 'FLUX Kommunity License',
    note: 'Black Forest Labs’ newest open model; edits keep what you don’t mention.'
  },
  {
    id: 'krea2',
    label: 'Krea 2',
    unet: /^krea ?2[\\/]|krea2/i,
    te: { type: 'krea2', files: ['qwen3vl_4b_fp8_scaled.safetensors', 'qwen3vl_4b_int8_convrot.safetensors'] },
    vae: ['qwen_image_vae.safetensors'],
    steps: 8,
    cfg: 1,
    base: { match: /^(?!.*turbo)/i, steps: 20, cfg: 3 },
    edit: 'lora', // with the Krea 2 Identity Edit LoRA and the comfyui-krea2edit nodes
    editLora: /identity[_ -]?edit/i,
    loras: /krea/i,
    licence: 'Krea 2 licence (see its model page)',
    note: 'Aesthetic, photographic looks, and many fine-tunes.'
  },
  {
    id: 'moss',
    label: 'Moss',
    unet: /^moss[\\/]|moss[_-]image/i,
    te: { type: 'moss_image', files: ['qwen3.5_9b_w4a8_gptq.safetensors', 'qwen3.5_9b_uncensored_int8_convrot.safetensors', 'qwen3.5_9b_int8_convrot.safetensors'] },
    vae: ['flux2-vae_small.safetensors', 'flux2-vae.safetensors'],
    steps: 25,
    cfg: 2.5,
    sampler: 'er_sde',
    negative: 'worst quality, bad anatomy, watermark, jpeg artifact',
    edit: false,
    noEdit: 'Moss edits through an edit LoRA that needs a newer ComfyUI.',
    loras: /moss/i,
    licence: 'Apache-2.0',
    note: 'Reads a full scene description, and spells out text well.'
  },
  {
    id: 'qwen21',
    label: 'Qwen Image 2.1',
    unet: /qwen[-_ ]image[-_ ]2\.1/i,
    te: { type: 'qwen_image', files: ['qwen3vl_8b_int8_convrot.safetensors', 'qwen3vl_8b_int8_uncensored.safetensors'] },
    vae: ['qwen_image_2.1_vae_bf16.safetensors'],
    steps: 25,
    cfg: 1,
    edit: true,
    loras: /qwen[ _-]?(image[ _-]?)?2\.1|qwen 2\.1/i,
    licence: 'Apache-2.0',
    note: 'Strong at text in pictures; edits with up to three references.'
  },
  {
    id: 'zimage',
    label: 'Z-Image Turbo',
    unet: /z[-_ ]?image/i,
    te: { type: 'lumina2', files: ['qwen_3_4b.safetensors'] },
    vae: ['ae.safetensors', 'Z-ImageVAE.safetensors'],
    steps: 8,
    cfg: 1,
    sampler: 'res_multistep',
    edit: false,
    noEdit: 'Z-Image Turbo makes pictures from a prompt only.',
    loras: /z[-_ ]?image|\bzit\b/i,
    licence: 'Apache-2.0',
    note: 'Very fast photographic pictures.'
  }
]

export const IMAGE_ASPECTS = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '21:9': 21 / 9 }
export const IMAGE_DEFAULTS = { aspect: '1:1', megapixels: 1, count: 1 }

const now = () => new Date().toISOString()
const slug = (s) => String(s || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'image'
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}
const DONE = ['success', 'error', 'cancelled']

// Width and height for an aspect at about this many megapixels, on a 32-pixel grid every family accepts.
export function imageSize(aspect, megapixels) {
  const ar = IMAGE_ASPECTS[aspect] || 1
  const px = Math.max(0.25, Math.min(4, Number(megapixels) || 1)) * 1024 * 1024
  const w = Math.round(Math.sqrt(px * ar) / 32) * 32
  const h = Math.round(Math.sqrt(px / ar) / 32) * 32
  return { width: w, height: h }
}

// The family a checkpoint belongs to, by its name.
export const familyOfModel = (unet) => IMAGE_FAMILIES.find((f) => f.unet.test(unet)) || null

// Builds the API graph. refs: picture names already in ComfyUI's input folder (Edit).
export function imageGraph({ family, mode = 'generate', unet, te, vae, loras = [], prompt, negative = '', width, height, count = 1, seed, steps, cfg, refs = [], megapixels = 1, editLora = null, prefix }) {
  const f = IMAGE_FAMILIES.find((x) => x.id === family)
  const g = {}
  let n = 0
  const add = (class_type, inputs) => ((g[String(++n)] = { class_type, inputs }), String(n))
  const unetNode = add('UNETLoader', { unet_name: unet, weight_dtype: 'default' })
  let model = [unetNode, 0]
  // Krea 2 edits through its identity edit LoRA, first in the chain
  for (const l of [...(mode === 'edit' && editLora ? [{ name: editLora, strength: 1 }] : []), ...loras]) model = [add('LoraLoaderModelOnly', { model, lora_name: l.name, strength_model: Number(l.strength ?? 1) }), 0]
  const clip = [add('CLIPLoader', { clip_name: te, type: f.te.type, device: 'default' }), 0]
  const vaeOut = [add('VAELoader', { vae_name: vae }), 0]
  const batch = Math.max(1, Math.min(4, Math.round(count)))
  const sampler = f.sampler || 'euler'
  const encode = (text) => [add('CLIPTextEncode', { clip, text }), 0]
  const ksample = (m, pos, neg, latent, stepsN = steps) => [add('KSampler', { model: m, seed, steps: stepsN, cfg, sampler_name: sampler, scheduler: 'simple', denoise: 1, positive: pos, negative: neg, latent_image: latent }), 0]
  const save = (samples) => add('SaveImage', { images: [add('VAEDecode', { samples, vae: vaeOut }), 0], filename_prefix: prefix })
  const negOf = (pos) => (cfg > 1 ? encode(negative || f.negative || '') : [add('ConditioningZeroOut', { conditioning: pos }), 0])
  const loadRefs = () => refs.map((name) => [add('LoadImage', { image: name }), 0])
  const sized = (img) => [add('ImageScaleToTotalPixels', { image: img, upscale_method: 'lanczos', megapixels, resolution_steps: 16 }), 0]
  const repeat = (latent) => (batch > 1 ? [add('RepeatLatentBatch', { samples: latent, amount: batch }), 0] : latent)

  if (family === 'flux2') {
    let pos = encode(prompt)
    let neg = cfg > 1 ? encode(negative) : [add('ConditioningZeroOut', { conditioning: pos }), 0]
    let w = width
    let h = height
    if (mode === 'edit') {
      const imgs = loadRefs().map(sized)
      const size = add('GetImageSize', { image: imgs[0] })
      ;[w, h] = [[size, 0], [size, 1]]
      for (const img of imgs) {
        const lat = [add('VAEEncode', { pixels: img, vae: vaeOut }), 0]
        pos = [add('ReferenceLatent', { conditioning: pos, latent: lat }), 0]
        neg = [add('ReferenceLatent', { conditioning: neg, latent: lat }), 0]
      }
    }
    const guider = [add('CFGGuider', { model, positive: pos, negative: neg, cfg }), 0]
    const out = add('SamplerCustomAdvanced', {
      noise: [add('RandomNoise', { noise_seed: seed }), 0],
      guider,
      sampler: [add('KSamplerSelect', { sampler_name: 'euler' }), 0],
      sigmas: [add('Flux2Scheduler', { steps, width: w, height: h }), 0],
      latent_image: [add('EmptyFlux2LatentImage', { width: w, height: h, batch_size: batch }), 0]
    })
    save([out, 0])
  } else if (family === 'flux3') {
    const pos = encode(prompt)
    const neg = [add('ConditioningZeroOut', { conditioning: pos }), 0]
    if (mode === 'edit') {
      const inputs = { positive: pos, negative: neg, vae: vaeOut, resolution: 'resize', 'resolution.megapixels': megapixels }
      loadRefs().forEach((img, i) => (inputs[`images.image${i}`] = img))
      const ref = add('ReferenceMultiLatent', inputs)
      save(ksample(model, [ref, 0], [ref, 1], repeat([ref, 2]), f.editSteps))
    } else save(ksample(model, pos, neg, [add('EmptyFlux2LatentImage', { width, height, batch_size: batch }), 0]))
  } else if (family === 'krea2') {
    if (mode === 'edit') {
      const img = sized(loadRefs()[0])
      const size = add('GetImageSize', { image: img })
      const target = [add('EmptySD3LatentImage', { width: [size, 0], height: [size, 1], batch_size: 1 }), 0]
      const patched = [add('Krea2EditModelPatch', { model, source_latent: [add('VAEEncode', { pixels: img, vae: vaeOut }), 0], vae: vaeOut, source_image: img, target_latent: target, ref_boost: 1, ref_boost_a: 1, fit_mode: 'fit' }), 0]
      const pos = [add('Krea2EditGroundedEncode', { clip, prompt, image: img, grounding_px: 1024, system_prompt: '' }), 0]
      const neg = [add('Krea2EditGroundedEncode', { clip, prompt: negative || '', image: img, grounding_px: 1024, system_prompt: '' }), 0]
      save(ksample(patched, pos, neg, repeat(target)))
    } else {
      const pos = encode(prompt)
      save(ksample(model, pos, negOf(pos), [add('EmptyLatentImage', { width, height, batch_size: batch }), 0]))
    }
  } else if (family === 'moss') {
    const pos = encode(prompt)
    save(ksample(model, pos, encode(negative || f.negative), [add('EmptyFlux2LatentImage', { width, height, batch_size: batch }), 0]))
  } else if (family === 'qwen21') {
    const cached = [add('QwenImage21Cache', { model, device: 'auto', dtype: 'default' }), 0]
    const inputs = { clip, prompt, negative_prompt: negative || '', resolution: Math.round((Math.sqrt(megapixels) * 1024) / 32) * 32 }
    if (mode === 'edit') {
      inputs.vae = vaeOut
      loadRefs().forEach((img, i) => (inputs[`images.image_${i + 1}`] = img))
    }
    const enc = add('TextEncodeQwenImage21', inputs)
    const latent = mode === 'edit' ? repeat([enc, 2]) : [add('EmptyLatentImage', { width, height, batch_size: batch }), 0]
    save(ksample(cached, [enc, 0], [enc, 1], latent))
  } else if (family === 'zimage') {
    const shifted = [add('ModelSamplingAuraFlow', { model, shift: 3 }), 0]
    const pos = encode(prompt)
    save(ksample(shifted, pos, negOf(pos), [add('EmptySD3LatentImage', { width, height, batch_size: batch }), 0]))
  } else throw new Error(`Unknown image family "${family}".`)
  return g
}

export class Images {
  constructor({ studio, dataDir }) {
    this.studio = studio
    this.dir = path.join(dataDir, 'images')
  }

  file = () => path.join(this.dir, 'images.json')
  all = () => readJson(this.file(), [])
  saveAll = (list) => writeJson(this.file(), list)

  // What each family can do on this ComfyUI: its checkpoints, the text encoder and VAE found for it, what's
  // missing, and whether it can edit.
  async status() {
    if (this.studio.comfy.remote) return { remote: true, families: IMAGE_FAMILIES.map((f) => ({ ...strip(f), ready: false, models: [], missing: [] })) }
    let info
    try {
      info = await this.studio.comfy.objectInfo()
    } catch (err) {
      return { error: err.message, families: IMAGE_FAMILIES.map((f) => ({ ...strip(f), ready: false, models: [], missing: [] })) }
    }
    const unets = comboOptions(info, 'UNETLoader', 'unet_name') || []
    const clips = comboOptions(info, 'CLIPLoader', 'clip_name') || []
    const vaes = comboOptions(info, 'VAELoader', 'vae_name') || []
    const loras = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
    const types = comboOptions(info, 'CLIPLoader', 'type') || []
    const pick = (opts, names) => names.map((n) => opts.find((o) => o.split(/[\\/]/).pop() === n)).find(Boolean) || null
    const families = IMAGE_FAMILIES.map((f) => {
      const models = unets.filter((u) => f.unet.test(u) && familyOfModel(u)?.id === f.id)
      const te = pick(clips, f.te.files)
      const vae = pick(vaes, f.vae)
      const missing = [...(te ? [] : [`text encoder ${f.te.files[0]}`]), ...(vae ? [] : [`VAE ${f.vae[0]}`]), ...(types.includes(f.te.type) ? [] : [`ComfyUI support for ${f.label} (update ComfyUI)`])]
      let edit = f.edit === true
      let editNote = f.noEdit || null
      let editLora = null
      if (f.edit === 'lora') {
        editLora = loras.find((l) => f.editLora.test(l)) || null
        const nodes = ['Krea2EditModelPatch', 'Krea2EditGroundedEncode'].every((c) => info[c])
        edit = !!editLora && nodes
        editNote = edit ? null : !nodes ? 'Krea 2 edits need the comfyui-krea2edit nodes.' : 'Krea 2 edits need the Krea 2 Identity Edit LoRA (krea2_identity_edit) in ComfyUI’s loras folder.'
      }
      if (f.id === 'flux3' && !info.ReferenceMultiLatent) [edit, editNote] = [false, 'Flux 3 Klein edits need a newer ComfyUI.']
      return { ...strip(f), models, te, vae, editLora, ready: models.length > 0 && !missing.length, missing, edit: edit && models.length > 0 && !missing.length, editNote }
    })
    return { families, aspects: Object.keys(IMAGE_ASPECTS), defaults: IMAGE_DEFAULTS }
  }

  // Queues a set of pictures. request: { mode: generate|edit, model (a checkpoint), prompt, negative, loras
  // [{name, strength}], aspect, megapixels, count 1-4, seed, steps, cfg, refs [local picture paths] (Edit), name }.
  async create({ mode = 'generate', model, prompt = '', negative = '', loras = [], aspect = IMAGE_DEFAULTS.aspect, megapixels = IMAGE_DEFAULTS.megapixels, count = IMAGE_DEFAULTS.count, seed = null, steps = null, cfg = null, refs = [], name } = {}) {
    const text = String(prompt || '').trim()
    if (!text) throw new Error(mode === 'edit' ? 'Say what to change in the picture.' : 'Describe the picture first.')
    const st = await this.status()
    if (st.remote) throw new Error('Pictures render on this PC’s ComfyUI. Switch to "This PC" on the Cloud page to make them.')
    if (st.error) throw new Error(st.error)
    const fam = st.families.find((f) => f.models.includes(model)) || st.families.find((f) => f.id === familyOfModel(String(model || ''))?.id)
    if (!fam) throw new Error(`"${model}" isn't an image model IV Studio knows. Pick one from list_image_models.`)
    if (!fam.models.includes(model)) throw new Error(`${fam.label} has no checkpoint "${model}" in ComfyUI.`)
    if (!fam.ready) throw new Error(`${fam.label} needs ${fam.missing.join(', ')}.`)
    if (mode === 'edit') {
      if (!fam.edit) throw new Error(fam.editNote || `${fam.label} can't edit pictures.`)
      if (!refs.length) throw new Error('Add the picture to edit.')
      if (fam.id === 'krea2' && refs.length > 1) throw new Error('Krea 2 edits one picture at a time.')
      if (refs.length > (fam.id === 'qwen21' ? 3 : 6)) throw new Error(`${fam.label} takes up to ${fam.id === 'qwen21' ? 3 : 6} reference pictures.`)
    } else if (mode !== 'generate') throw new Error('Mode is generate or edit.')
    const spec = IMAGE_FAMILIES.find((f) => f.id === fam.id)
    const isBase = spec.base && spec.base.match.test(model.split(/[\\/]/).pop())
    const s = seed == null || seed === '' ? Math.floor(Math.random() * 2 ** 31) : Math.floor(Number(seed))
    const usedSteps = Math.round(Number(steps) || (isBase ? spec.base.steps : spec.steps))
    const usedCfg = Number(cfg) || (isBase ? spec.base.cfg : spec.cfg)
    const { width, height } = imageSize(aspect, megapixels)
    const uploaded = []
    for (const r of refs) {
      if (!fs.existsSync(r)) throw new Error(`No picture at ${r}.`)
      uploaded.push(await this.studio.comfy.upload(r, 'iv_studio/images'))
    }
    const id = randomUUID().slice(0, 8)
    const title = String(name || '').trim() || text.split(/[.,\n]/)[0].slice(0, 48)
    const graph = imageGraph({ family: fam.id, mode, unet: model, te: fam.te, vae: fam.vae, loras: loras.filter((l) => l?.name), prompt: text, negative, width, height, count, seed: s, steps: usedSteps, cfg: usedCfg, refs: uploaded, megapixels: Number(megapixels) || 1, editLora: fam.editLora, prefix: `iv_studio/images/${slug(title)}_${id}` })
    const project = this.studio.createProject(`Image · ${title}`, null, null, 'image')
    const job = await this.studio.submitGraph({ kind: `picture:${fam.id}`, graph, projectId: project.id, name: title, plan: { images: true, request: { prompt: text } } })
    const record = { id, name: title, mode, family: fam.id, familyLabel: fam.label, model, prompt: text, negative, loras: loras.filter((l) => l?.name), aspect, megapixels: Number(megapixels) || 1, width: mode === 'edit' ? null : width, height: mode === 'edit' ? null : height, count: Math.max(1, Math.min(4, Math.round(count))), seed: s, steps: usedSteps, cfg: usedCfg, refs, projectId: project.id, jobId: job.id, status: job.status, files: [], createdAt: now() }
    this.saveAll([record, ...this.all()])
    return record
  }

  // A set brought up to date: a finished job's pictures are copied into images/ once.
  async refresh(rec) {
    if (DONE.includes(rec.status) && (rec.status !== 'success' || rec.files?.length)) return rec
    let job
    try {
      job = await this.studio.refreshJob(rec.jobId)
    } catch (err) {
      return { ...rec, note: err.message }
    }
    const next = { ...rec, status: job.status, progress: job.progress, queuePosition: job.queuePosition, seconds_taken: job.seconds }
    if (job.status === 'error') next.error = job.error
    if (job.status === 'success') {
      const outs = (job.outputs || []).filter((o) => o.kind === 'image')
      if (!outs.length) Object.assign(next, { status: 'error', error: 'ComfyUI finished but saved no pictures.' })
      else {
        fs.mkdirSync(this.dir, { recursive: true })
        next.files = []
        for (const [i, out] of outs.entries()) {
          const src = await this.studio.localCopy(out, path.join(this.dir, '_comfy'))
          const file = path.join(this.dir, `${slug(rec.name)}_${rec.id}_${i + 1}${path.extname(src) || '.png'}`)
          if (!fs.existsSync(file)) fs.copyFileSync(src, file)
          if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
          next.files.push(file)
        }
        next.finishedAt = now()
      }
    }
    if (DONE.includes(next.status)) {
      delete next.progress
      delete next.queuePosition
      this.saveAll(this.all().map((x) => (x.id === rec.id ? next : x)))
    }
    return next
  }

  list = () => Promise.all(this.all().map((r) => this.refresh(r)))

  async get(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    return this.refresh(r)
  }

  async cancel(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    const c = await this.studio.cancelJob(r.jobId)
    return { ...(await this.refresh(r)), result: c.result }
  }

  // Removes the set and its copies in images/. ComfyUI's own output files stay.
  async delete(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    if (!DONE.includes(r.status)) await this.studio.cancelJob(r.jobId).catch(() => {})
    for (const f of r.files || []) fs.rmSync(f, { force: true })
    try {
      this.studio.deleteProject(r.projectId)
    } catch {}
    this.saveAll(this.all().filter((x) => x.id !== id))
    return { deleted: id }
  }
}

// what the window and agents see of a family spec (no regular expressions)
function strip(f) {
  return { id: f.id, label: f.label, licence: f.licence, note: f.note, edit: f.edit === true, loraPattern: f.loras.source, steps: f.steps, cfg: f.cfg, maxRefs: f.id === 'krea2' ? 1 : f.id === 'qwen21' ? 3 : 6 }
}
