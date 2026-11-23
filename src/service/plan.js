// Turns a render request (from the studio or an agent) into the groups and node values of the IV Studio
// graph, and resolves the real pixel size, frame count and duration before anything runs.

export const MODES = {
  text: { group: 'mode1', label: 'Text to video', model: 'fl2va' },
  frames: { group: 'mode2', label: 'First / last frame', model: 'fl2va' },
  reference: { group: 'mode3', label: 'Reference to video', model: 'ref2va' },
  continue: { group: 'mode4', label: 'Continue a video', model: 'fl2va' }
}

// Keyframes' one take (H3 Multishot's H3Keyframes): this many pictures at most in one shot
export const KEYFRAME_MAX = 6

// A node swapped or extended after the graph is built (plan.patch): { id: { class_type, remove: [inputs], inputs } }.
export function applyPatch(graph, patch) {
  if (!patch) return graph
  for (const [id, change] of Object.entries(patch)) {
    if (!(id in graph)) continue
    const inputs = { ...graph[id].inputs }
    for (const k of change.remove || []) delete inputs[k]
    graph[id] = { ...graph[id], ...(change.class_type ? { class_type: change.class_type } : {}), inputs: { ...inputs, ...(change.inputs || {}) } }
  }
  return graph
}

export const ASPECTS = {
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait Widescreen)',
  '1:1': '1:1 (Square)',
  '4:3': '4:3 (Standard)',
  '3:4': '3:4 (Portrait Standard)',
  '3:2': '3:2 (Photo)',
  '2:3': '2:3 (Portrait Photo)',
  '21:9': '21:9 (Ultrawide)'
}

// DLSS takes 30/50/60/120; the cloud's RIFE takes whole multiples of 24 (48/72/120). The studio
// checks a request against what the connected ComfyUI can do (remote.js capabilities).
export const FRAME_GEN_FPS = [0, 30, 48, 50, 60, 72, 120]
const RATIO = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9] }

// ComfyUI's ResolutionSelector, multiple 32. ratio: an exact [w, h] (a first frame's own shape) instead of the aspect.
export function resolveSize(aspect, megapixels, ratio = null) {
  const [a, b] = ratio || RATIO[aspect]
  const s = Math.sqrt((megapixels * 1024 * 1024) / (a * b))
  return { width: Math.round((a * s) / 32) * 32, height: Math.round((b * s) / 32) * 32 }
}

// "Same as photo" (Create, First / last frame): the picture's own width and height, kept between 21:9 and 9:21
// (wider or taller than that H3 hasn't been tried at), or null when it isn't a usable size.
export function photoRatio(size) {
  const w = Number(size?.width)
  const h = Number(size?.height)
  if (!(w > 0 && h > 0)) return null
  const r = Math.min(21 / 9, Math.max(9 / 21, w / h))
  return r >= 1 ? [r, 1] : [1, 1 / r]
}
// The standard aspect nearest a picture's shape: what a shot made at its photo's own shape is filed as elsewhere
// (the editor, sequences) that only knows the standard ones.
export function nearestAspect(size) {
  const ratio = photoRatio(size)
  if (!ratio) return null
  const r = ratio[0] / ratio[1]
  return Object.entries(RATIO).sort(([, x], [, y]) => Math.abs(Math.log(x[0] / x[1] / r)) - Math.abs(Math.log(y[0] / y[1] / r)))[0][0]
}
// the nodes that read the shot's width and height from the ResolutionSelector (501)
const SIZE_NODES = ['102', '204', '205', '304', '611', '614']

// Seedhunter 2.5's formula: seconds -> frames on H3's 17n+5 grid at 24 fps.
export function resolveFrames(seconds) {
  const f = Math.max(5, Math.round(seconds * 24))
  return f + ((5 - (f % 17)) % 17 + 17) % 17
}

// The latent upscaler sizes by megapixels with 32-pixel alignment; this is its result for a given input.
export function resolveFinalSize(width, height, megapixels) {
  const s = Math.sqrt((megapixels * 1024 * 1024) / (width * height))
  return { width: Math.round((width * s) / 32) * 32, height: Math.round((height * s) / 32) * 32 }
}

const loraState = (loras) =>
  JSON.stringify({ version: 1, sep: ', ', cacheMode: 'last', loras: loras.map((l) => ({ name: l.name, on: true, sm: l.strength ?? 0.8, sc: l.strength ?? 0.8, triggers: [] })) })

export const DEFAULTS = {
  mode: 'text',
  prompt: '',
  character: 'tess',
  aspect: '16:9',
  megapixels: 0.4,
  seconds: 5,
  steps: 8,
  // the preview pass's sampler (KSamplerSelect, node 12) and scheduler (BasicScheduler, node 13); the 2 MP finish
  // keeps its own tuned refine (er_sde, linear_quadratic, 2 steps at 0.4)
  sampler: 'er_sde',
  scheduler: 'beta',
  seed: 4242,
  previews: 3,
  overlapFrames: 22,
  media: [],
  voiceLine: null,
  refmods: [],
  retention: 1,
  extraLoras: [],
  // the speed preset the shot was made with (speed.js), kept so its finish starts from the preset's finish
  speed: null
}

// request: see DEFAULTS. characters: [{id, name, lora, strength, trigger}]. Returns the plan or throws.
export function planPreviews(request, characters) {
  const r = { ...DEFAULTS, ...request }
  const errors = []
  const mode = MODES[r.mode]
  if (!mode) errors.push(`Unknown mode "${r.mode}". Use ${Object.keys(MODES).join(', ')}.`)
  if (!ASPECTS[r.aspect]) errors.push(`Unknown aspect "${r.aspect}". Use ${Object.keys(ASPECTS).join(', ')}.`)
  if (!(r.megapixels >= 0.1 && r.megapixels <= 2.5)) errors.push('megapixels must be between 0.1 and 2.5.')
  if (!(r.seconds >= 1 && r.seconds <= 15)) errors.push('seconds must be between 1 and 15.')
  if (!r.prompt?.trim()) errors.push('A prompt is required.')
  if (!/^[\w.+-]{1,60}$/.test(String(r.sampler || ''))) errors.push(`Unknown sampler "${r.sampler}".`)
  if (!/^[\w.+-]{1,60}$/.test(String(r.scheduler || ''))) errors.push(`Unknown scheduler "${r.scheduler}".`)
  const character = r.character === 'none' ? null : characters.find((c) => c.id === r.character)
  if (r.character !== 'none' && !character) errors.push(`Unknown character "${r.character}".`)
  // a RefMod character (refmods.js) is RefMod 1, ahead of any RefMods picked for the shot; a LoRA character loads its LoRA
  const refChar = character && !character.lora && character.refmod ? character : null
  const refmods = refChar ? [{ name: refChar.refmod, strength: refChar.strength ?? 1, copies: 1 }, ...r.refmods.filter((m) => m.name !== refChar.refmod)] : r.refmods
  const pictures = r.media.filter((m) => m.kind === 'picture')
  const videos = r.media.filter((m) => m.kind === 'video')
  // keyframes: { positions } (Keyframes, one take): 2 to 6 pictures anchored at those frames by H3 Multishot's H3Keyframes
  const keyframes = r.keyframes && r.mode === 'frames' ? r.keyframes : null
  if (keyframes) {
    if (pictures.length < 2 || pictures.length > KEYFRAME_MAX) errors.push(`A one-take keyframes shot needs 2 to ${KEYFRAME_MAX} pictures.`)
    if (!Array.isArray(keyframes.positions) || keyframes.positions.length !== pictures.length) errors.push('Give one keyframe position per picture.')
  } else if (r.mode === 'frames' && (pictures.length < 1 || pictures.length > 2)) errors.push('First / last frame needs 1 picture (first frame) or 2 (first and last).')
  if (r.mode === 'continue' && pictures.length > 1) errors.push('Continue a video takes one picture at most: where the new part ends.')
  if (r.mode === 'reference' && !r.media.length && !refmods.length) errors.push('Reference to video needs at least one picture, video or audio reference, or a RefMod.')
  if (r.mode === 'continue' && videos.length !== 1) errors.push('Continue a video needs exactly one source video.')
  if (r.mode === 'continue' && ![5, 22, 39, 56].includes(r.overlapFrames)) errors.push('Overlap frames must be 5, 22, 39 or 56.')
  if (refmods.length > 8) errors.push(refChar ? 'At most 7 RefMods with a RefMod character (it takes the first).' : 'At most 8 RefMods.')
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })

  // Continue makes one take for the app's own chains (Extend, one-take film shots, sequences); a shot from Create
  // (continueFull) hunts 1-3 takes like any other and finishes at full size (planFinish)
  const previews = r.mode === 'continue' && !r.continueFull ? 1 : Math.min(3, Math.max(1, Math.round(r.previews)))
  // photoSize ({ width, height }, First / last frame only): the shot takes the first frame's own shape
  const ratio = r.mode === 'frames' && r.photoSize ? photoRatio(r.photoSize) : null
  const size = resolveSize(r.aspect, r.megapixels, ratio)
  const frames = resolveFrames(r.seconds)
  const groups = [mode.group, character && !refChar ? 'char_tess' : 'char_none', 'select1']
  for (let k = 1; k <= previews; k++) groups.push(`preview${k}`)
  if (r.voiceLine) groups.push('voice')
  if (refmods.length) groups.push('refmods')

  const values = {
    '87': r.prompt,
    '501.aspect_ratio': ASPECTS[r.aspect],
    '501.megapixels': r.megapixels,
    '82': r.seconds,
    '503': r.steps,
    '12.sampler_name': r.sampler,
    '13.scheduler': r.scheduler,
    '81.seed': r.seed,
    '410.LoraLoaderState': loraState(r.extraLoras)
  }
  // the photo's own shape: every node that reads 501's width and height gets the exact size instead
  if (ratio) for (const id of SIZE_NODES) Object.assign(values, { [`${id}.width`]: size.width, [`${id}.height`]: size.height })
  if (refChar) values['1004'] = refChar.name
  else if (character) {
    // the character's main H3 LoRA, and any more its bible loads with it (bible.js models.h3.loras)
    values['1001.LoraLoaderState'] = loraState([{ name: character.lora, strength: character.strength }, ...(character.models?.h3?.loras || [])])
    values['1002'] = character.trigger
  }
  const mediaNode = { frames: '202', reference: '302', continue: '602' }[r.mode]
  if (mediaNode) values[`${mediaNode}.media_state`] = JSON.stringify(r.media.map(mediaItem))
  if (r.mode === 'continue') values['604'] = r.overlapFrames
  if (r.voiceLine) values['801.audio'] = r.voiceLine
  // a continued shot with a picture ends on it (Keyframes' carried motion): the picture is H3's last frame
  if (r.mode === 'continue' && pictures.length === 1) values['611.last_frame'] = ['603', 0]
  // one take through several keyframes: node 204 (H3's first/last frame) becomes H3 Multishot's H3Keyframes, fed by
  // the pictures in order at their frame positions; same outputs (conditioning, latent), so the rest of the graph stays
  const patch = keyframes ? { 204: { class_type: 'H3Keyframes', remove: ['first_frame', 'last_frame'], inputs: { positions: keyframes.positions.map((n) => String(Math.round(n))).join(', '), ...Object.fromEntries(pictures.map((_, k) => [`image_${k + 1}`, ['203', k]])) } } } : null
  if (refmods.length) {
    for (let k = 1; k <= 8; k++) {
      const m = refmods[k - 1]
      values[`1101.mod_${k}`] = m ? m.name : '(none)'
      values[`1101.strength_${k}`] = m ? (m.strength ?? 1) : 1
      values[`1101.copies_${k}`] = m ? (m.copies ?? 1) : 1
    }
    values['1102'] = r.retention
  }
  return {
    request: r,
    groups,
    values,
    ...(patch ? { patch } : {}),
    resolved: { ...size, frames, seconds: +(frames / 24).toFixed(3), fps: 24, previews, model: mode.model, seeds: [r.seed, r.seed + 1000, r.seed + 2000].slice(0, previews) }
  }
}

// A finish re-uses the preview plan's groups and values unchanged (so the picked latent's fingerprint
// matches and IV Latent Cache skips re-sampling), keeping only the picked preview and adding the upscale.
// The finish's enhancer: DLSS 5 (in the graph: noise reduction, RTX 2x, frame generation) or SeedVR2 (a step after
// a DLSS-free finish, to a short side of enhanceResolution), or none (the latent upscaler's video as it is).
export const ENHANCERS = ['dlss', 'seedvr2', 'none']
export const SEEDVR2_SIZES = [1080, 1440, 2160]
// a finish that skips DLSS 5 in its own graph (remote.js swaps the node for a plain save)
export const skipsDlss = (finish) => finish?.enhancer === 'seedvr2' || finish?.enhancer === 'none'
// The 2 MP pass draws the take again at this strength (node 25; the template's 0.4 otherwise). In First / last frame
// (and Keyframes, which renders that way) its guide is the words alone (node 205: the pictures only steer the take,
// node 204), so with no character LoRA nothing holds the face and 0.4 redrew it: Tess's green eyes came out brown in a
// Keyframes finish (2026-11-23). 0.1 kept her face, eyes and freckles and was as sharp; 0.2 still moved the eyes.
export const FRAMES_REFINE = 0.1
export const picturesOnly = (request) => request?.mode === 'frames' && (!request.character || request.character === 'none')
export function planFinish(previewPlan, finish) {
  const f = { candidate: 1, megapixels: 2, upscale2x: false, fps: 0, audio: 'pass', rerollSeed: null, enhancer: 'dlss', enhanceResolution: 1080, ...finish }
  // a picture-led shot with no character LoRA keeps its face: a light 2 MP pass, unless the finish sets one
  if (f.refineDenoise == null && picturesOnly(previewPlan.request)) f.refineDenoise = FRAMES_REFINE
  // SeedVR2 or none instead of DLSS 5: the finish skips DLSS (no 2x, no frame generation); SeedVR2 then follows it
  if (skipsDlss(f)) Object.assign(f, { upscale2x: false, fps: 0 })
  const errors = []
  if (!ENHANCERS.includes(f.enhancer)) errors.push(`enhancer must be ${ENHANCERS.join(', ')}.`)
  if (f.enhancer === 'seedvr2' && !SEEDVR2_SIZES.includes(f.enhanceResolution)) errors.push(`enhanceResolution must be ${SEEDVR2_SIZES.join(', ')}.`)
  const n = previewPlan.resolved.previews
  if (!(f.candidate >= 1 && f.candidate <= n)) errors.push(`candidate must be 1..${n}.`)
  if (!FRAME_GEN_FPS.includes(f.fps)) errors.push(`fps must be one of ${FRAME_GEN_FPS.join(', ')} (0 = off).`)
  if (!(f.megapixels >= 0.5 && f.megapixels <= 4)) errors.push('megapixels must be between 0.5 and 4.')
  if (f.refineDenoise != null && !(f.refineDenoise >= 0.05 && f.refineDenoise <= 0.6)) errors.push('refineDenoise must be between 0.05 and 0.6.')
  if (f.audio === 'voice' && !previewPlan.request.voiceLine) errors.push('Final audio "voice" needs a voice line.')
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })

  // Continue: the app's own chains finish in one pass at preview size (DLSS only, 'single'). A Create shot
  // (continueFull) gets the full finish: the picked take's 2 MP pass (its frame-free continuation conditioning,
  // node 611), with the source scaled to that size and joined back on before it ('continue_full'), so the
  // final is the whole continued video. continueFinish: 'single' keeps the old one-pass finish for such a shot.
  const cont = previewPlan.request.mode === 'continue'
  const full = cont && !!previewPlan.request.continueFull && f.continueFinish !== 'single'
  const single = cont && !full
  const keep = previewPlan.groups.filter((g) => !/^preview\d$|^select\d$/.test(g))
  const groups = [...keep, `preview${f.candidate}`, `select${f.candidate}`, single ? 'single' : 'upscale']
  if (full) groups.push('continue_full')
  if (!single && f.audio === 'preview') groups.push('audio_preview')
  if (!single && f.audio === 'voice') groups.push('audio_voice')
  const values = { ...previewPlan.values, '504': f.megapixels, '511': f.upscale2x ? 2 : 1, '512': f.fps }
  if (cont) {
    // the continued video (source + take) is built from the picked take, not always take 1
    const decode = { 1: ['40', '41'], 2: ['116', '117'], 3: ['126', '127'] }[f.candidate]
    values['615.image2'] = [decode[0], 0]
    values['617.audio2'] = [decode[1], 0]
  }
  if (full) {
    values['30.images'] = ['632', 0]
    values['30.audio'] = ['633', 0]
  }
  // DLSS 5's noise reduction (0-2) and style, when the finish asks for them
  if (f.dlssStrength != null && Number.isFinite(Number(f.dlssStrength))) values['50.NR Intensity'] = Math.min(2, Math.max(0, Number(f.dlssStrength)))
  if (['Default', 'Natural', 'Cinematic'].includes(f.dlssStyle)) values['50.NR Style'] = f.dlssStyle
  // the 2 MP pass's strength (node 25, 0.4 by default): how much of the picture it draws again
  if (f.refineDenoise != null) values['25.denoise'] = f.refineDenoise
  if (f.rerollSeed != null) values['505.seed'] = f.rerollSeed
  else values['505.seed'] = previewPlan.request.seed + 444
  const { width, height } = previewPlan.resolved
  const base = single ? { width, height } : resolveFinalSize(width, height, f.megapixels)
  const scale = f.enhancer === 'seedvr2' ? f.enhanceResolution / Math.min(base.width, base.height) : f.upscale2x ? 2 : 1
  const frames = previewPlan.resolved.frames
  return {
    ...(previewPlan.patch ? { patch: previewPlan.patch } : {}),
    finish: f,
    groups,
    values,
    resolved: {
      width: Math.round((base.width * scale) / 2) * 2,
      height: Math.round((base.height * scale) / 2) * 2,
      enhancer: f.enhancer,
      ...(f.enhancer === 'seedvr2' ? { finishWidth: base.width, finishHeight: base.height } : {}),
      // what the latent upscaler makes, before DLSS or SeedVR2 (remote.js hands it to ComfyUI's built-in upscaler)
      ...(single ? {} : { upscaleSize: { width: base.width, height: base.height } }),
      fps: f.fps || 24,
      frames: f.fps ? Math.round((frames / 24) * f.fps) : frames,
      seconds: previewPlan.resolved.seconds,
      singlePass: single,
      ...(full ? { continued: true } : {})
    }
  }
}

function mediaItem(m) {
  const base = { kind: m.kind, file: `${m.file} [input]`, name: m.file.split('/').pop(), duration: m.duration ?? null, width: m.width ?? null, height: m.height ?? null, uid: m.file.slice(-10) }
  if (m.kind === 'video') return { ...base, has_audio: m.hasAudio ?? true, audio_mode: 'paired' }
  return { ...base, has_audio: m.kind === 'audio', audio_mode: 'off' }
}
