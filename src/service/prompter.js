// Prompt writer: turns a plain-words idea into a MiniMax H3 prompt, so nobody has to learn the format.
//   contextir - MiniMax's own rewriter (H3 Context IR), run as a ComfyUI partner node. Paid per call
//               through the user's Comfy.org API key; sees the reference media.
//   local     - a model in the user's own Ollama with IV Studio's H3 rule sheet. Free and private;
//               the model is unloaded right after writing so H3 gets the GPU back.
// The character is written as its first name for the writer and turned back into {char} afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-ffprobe-static'

// The bundled ffmpeg, outside the asar in a packaged app (as in main and the MCP server).
const unpacked = (p) => p && p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const FFMPEG = unpacked(ffmpegStatic.ffmpegPath)
const FFPROBE = unpacked(ffmpegStatic.ffprobePath)

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const DEFAULT_LOCAL_MODEL = 'huihui_ai/qwen3-vl-abliterated:8b-instruct'
export const CONTEXT_IR_PRICE = 'about $0.02 a prompt ($0.05 with first/last frames, $0.06–0.11 with reference media)'

const RULES = `You write prompts for MiniMax H3, a model that makes short videos with native sound (24 fps, picture and audio together).
Write in English. Answer with JSON only, in the shape you are given.

DIRECTING RULES
- Cover the whole duration with continuous action; every beat has a visible action, a reaction or consequence, and the state it leaves. End on a settled, visible result with a little time to spare.
- Open the first shot with who is where, wardrobe, setting, light and key props, then the action.
- Use a new shot only when a cut adds new information. Later shots start at strictly increasing times inside the duration.
- Camera: one compatible move at a time, written like "The camera pushes in with small amplitude at slow speed toward her hands." Use "The camera holds a static shot" for a locked camera.
- Dialogue: speakers get stable IDs in the order they first speak, written right after their name, e.g. "Mara (S1)". Put ONLY the exact spoken words inside <d>[English] ...</d>, never quotation marks. Describe voice, delivery and the listener's reaction outside the tag. Keep lines short enough to say naturally in the time.
- Describe what is seen and heard, positively and concretely. No negative prompts, no camera or render settings, no real people, no imitation of named artists or franchises.
- Keep identities, wardrobe, props, light and screen direction consistent unless something visibly changes them.
- soundscape: 1-4 sentences of ambience, physical action sounds and breaths (no dialogue, no music). music: 1-3 sentences of audience-only music, or "N/A".

EXAMPLE of the shape only (do not reuse its scene, props or lines; 10 seconds, main character Mara):
{"style": "Live-action, warm late-afternoon light, shallow depth of field.", "shots": [{"start_seconds": 0, "description": "Wide shot of a rooftop vegetable garden at golden hour: Mara stands between raised beds in a mustard apron over a white T-shirt, a green watering can in her right hand. The camera pushes in with small amplitude at slow speed. A neighbour (S1) in a striped shirt leans over the low wall and calls: <d>[English] Your tomatoes beat mine again!</d> Mara (S2) laughs and lifts the watering can in a salute."}, {"start_seconds": 6, "description": "The camera cuts to a medium shot of Mara as she plucks a ripe tomato and tosses it across the wall. The neighbour catches it with both hands and grins. Mara (S2) answers: <d>[English] Bribery works.</d> She turns back to the beds, still smiling."}], "soundscape": "A light breeze rustles the tomato leaves, water patters from the can onto soil, and city traffic hums far below. A soft thud as the tomato lands in the neighbour's hands.", "music": "N/A"}`

const CHARACTER_RULE = (name) =>
  `- The main character is called ${name}. Always refer to them as ${name}. Their face, hair, body and voice come from a trained character model: never describe ${name}'s face, hair, age, ethnicity, body or voice. Do describe their clothes, position, actions, expressions in action terms and what they say.`

const MODE_RULES = {
  text: '',
  frames: `- The video starts on a fixed first picture (and may end on a fixed last picture). The first shot describes the opening exactly as that picture shows it, then the motion away from it.`,
  continue: `- This prompt continues an existing video from its last frames. The first shot opens holding the source video's final arrangement (same people, positions, framing and light), then the new action follows.`,
  reference: `- Reference media are attached and named <Picture N>, <Video N> and <Audio N>, numbered separately per kind in the order listed below. Use ONLY labels that exist.
- Also fill "subjects" (who or what each reference defines, with its visible traits; the first is <Subject 1>), "summary" (one short paragraph: what the target video is and what each reference supplies) and "retention" (what each subject carries over from its reference). In the shots, refer to those people and things as <Subject 1>, <Subject 2>.`
}

const SEQUENCE_RULES = `- This shot is one of several that are joined into ONE continuous take with no visible cut between them, so write exactly one shot.
- Describe the place, light and wardrobe the same way, word for word, in every shot.
- Unless it is the first shot, it opens holding the previous shot's exact closing arrangement (same people, positions, framing) and stays quiet for about two seconds, with small natural movement (a breath, a weight shift, an eyeline change), before anyone speaks.
- It ends settled: dialogue finished, people back in a stable arrangement, with about two seconds to spare. That arrangement is what the next shot opens on.
- A spoken line never runs past the end of the shot. Budget about 15 words of speech for a 10 second shot, about 27 for 15 seconds.`

function durationRule(seconds) {
  const s = Math.round(seconds)
  const shots = s <= 6 ? '1-2 shots, one short line or two very short exchanges' : s <= 11 ? '1-3 shots, 2-4 short lines with visible reactions' : '1-3 shots with natural pauses'
  return `- The video is ${s} seconds long. Plan ${shots}. Keep 0.3-0.8 seconds at the end for the reaction or result.`
}

const firstName = (character) => character?.name?.split(/\s+/)[0] || null

// Writer output -> IV Studio prompt: character name back to {char}, fences and thinking removed.
export function cleanPrompt(text, character) {
  let t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*|```\s*$/gim, '')
    .trim()
  const name = firstName(character)
  if (name) t = t.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '{char}')
  return t
}

// Spoken lines in H3's tag: <d>[English] words</d> with no quotation marks inside. Quoted speech the
// writer left outside a tag (she says: "...") is moved into one.
export function normalizeDialogue(text) {
  let t = String(text).replace(/<d>\s*(\[[A-Za-z ]+\])?\s*[“"‘']?([\s\S]*?)[”"’']?\s*<\/d>/g, (_, lang, words) => `<d>${lang || '[English]'} ${words.trim()}</d>`)
  if (!/<d>/.test(t)) t = t.replace(/(\b(?:says|asks|whispers|replies|answers|shouts|murmurs|admits|adds)\b[^“"\n]{0,40}?)[:,]?\s*[“"]([^”"]+)[”"]/g, (_, lead, words) => `${lead.trimEnd()}: <d>[English] ${words.trim()}</d>`)
  return t
}

const at = (sec) => {
  const ms = Math.round(sec * 1000)
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0')
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${s}`
}

// The writer's JSON -> the exact H3 text format. Cut times are kept strictly increasing inside the
// duration; a shot whose time doesn't fit is folded into the shot before it.
export function assemble(data, { mode = 'text', seconds = 5 } = {}) {
  const shots = []
  for (const sh of Array.isArray(data?.shots) ? data.shots : []) {
    const desc = normalizeDialogue(String(sh.description || '').trim())
    if (!desc) continue
    const t = Number(sh.start_seconds)
    const prev = shots.at(-1)
    if (!prev) shots.push({ t: 0, desc })
    else if (Number.isFinite(t) && t > prev.t + 0.5 && t < seconds - 0.5) shots.push({ t, desc })
    else prev.desc += ` ${desc}`
  }
  if (!shots.length) throw new Error('The writer returned no shots. Try again.')
  const style = String(data.style || '').trim()
  const lines = shots.map((sh, i) => (i === 0 ? `[Shot 1] ${sh.desc}` : `[Shot ${i + 1}] At ${at(sh.t)}, ${sh.desc.charAt(0).toLowerCase()}${sh.desc.slice(1)}`))
  const sound = String(data.soundscape || '').trim() || 'Quiet room tone.'
  const music = String(data.music || '').trim() || 'N/A'
  if (mode === 'reference') {
    const subjects = (data.subjects || []).map((x, i) => `<Subject ${i + 1}> is ${String(x.traits || '').trim().replace(/\.$/, '')}${x.reference ? `, from ${x.reference}` : ''}.`)
    const retention = (data.retention || []).map((x, i) => `<Subject ${x.subject || i + 1}>: attribute_transfer${x.reference ? ` from ${x.reference}` : ''} - ${String(x.carries || '').trim()}`)
    return [
      `subject_definitions:\n${subjects.join('\n')}`,
      `summary:\n[reference generation] ${String(data.summary || '').trim()}`,
      `retention_analysis:\n${retention.join('\n')}`,
      `detailed_description:\n${style ? `${style}\n` : ''}${lines.join('\n')}`,
      `overall_soundscape:\n${sound}`,
      `non_diegetic_music:\n${music}`
    ].join('\n\n')
  }
  const first = style ? [`[Shot 1] ${style} ${shots[0].desc}`, ...lines.slice(1)] : lines
  const body = [`integrated_multimodal_description:\n${first.join('\n')}`, `overall_soundscape:\n${sound}`, `non_diegetic_music:\n${music}`].join('\n\n')
  return mode === 'frames' ? `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\n${body}` : body
}

const SHOT_SCHEMA = { type: 'object', properties: { start_seconds: { type: 'number' }, description: { type: 'string' } }, required: ['start_seconds', 'description'] }

// JSON shape the local writer must answer in (Ollama structured output).
export function outputSchema({ mode = 'text', sequence = false } = {}) {
  const props = { style: { type: 'string' }, shots: { type: 'array', items: SHOT_SCHEMA, minItems: 1, maxItems: sequence ? 1 : 3 }, soundscape: { type: 'string' }, music: { type: 'string' } }
  const required = ['style', 'shots', 'soundscape', 'music']
  if (mode === 'reference') {
    props.subjects = { type: 'array', items: { type: 'object', properties: { reference: { type: 'string' }, traits: { type: 'string' } }, required: ['reference', 'traits'] } }
    props.summary = { type: 'string' }
    props.retention = { type: 'array', items: { type: 'object', properties: { subject: { type: 'integer' }, reference: { type: 'string' }, carries: { type: 'string' } }, required: ['subject', 'reference', 'carries'] } }
    required.push('subjects', 'summary', 'retention')
  }
  return { type: 'object', properties: props, required }
}

const withName = (text, character) => (firstName(character) ? String(text).replaceAll('{char}', firstName(character)) : String(text).replaceAll('{char}', 'the main character'))

export function systemPrompt({ mode = 'text', seconds = 5, character, sequence = false, media = [] }) {
  const parts = [RULES]
  if (character) parts.push(CHARACTER_RULE(firstName(character)))
  if (MODE_RULES[mode]) parts.push(MODE_RULES[mode])
  if (mode === 'reference' && media.length) {
    const count = { picture: 0, video: 0, audio: 0 }
    const label = { picture: 'Picture', video: 'Video', audio: 'Audio' }
    parts.push('Attached references, in order:\n' + media.map((m) => `<${label[m.kind]} ${++count[m.kind]}> (${m.kind}: ${path.basename(m.file || m.path || '')})`).join('\n'))
  }
  if (sequence) parts.push(SEQUENCE_RULES)
  parts.push(durationRule(seconds))
  return parts.join('\n')
}

// ---------- local (Ollama) ----------
export async function ollamaStatus() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) })
    const { models = [] } = await r.json()
    return { running: true, installed: ollamaExe() != null, models: models.map((m) => ({ name: m.name, size: m.size, vision: /vl|vision|llava|gemma3/i.test(m.name) })) }
  } catch {
    return { running: false, installed: ollamaExe() != null, models: [] }
  }
}

function ollamaExe() {
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')
  return local && fs.existsSync(local) ? local : null
}

// Starts Ollama's server if it is installed but not running, and waits for it.
export async function ensureOllama() {
  if ((await ollamaStatus()).running) return true
  const exe = ollamaExe()
  if (!exe) throw new Error('Ollama is not installed. Install it from ollama.com, or use MiniMax Context IR.')
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if ((await ollamaStatus()).running) return true
  }
  throw new Error('Ollama did not start.')
}

// What a vision writer is shown, each with the label the prompt uses for it: reference pictures (<Picture N>), two
// frames of each reference video (<Video N>), the first/last frame pictures, or the last frame of the video a
// Continue shot carries on from. At most 6 images, each a JPEG of 1024 px or less (Ollama doesn't read every format).
const MAX_IMAGES = 6
export function imagePlan(media, mode) {
  const plan = []
  const n = { picture: 0, video: 0 }
  for (const m of media) {
    if (!(m.kind in n)) continue
    const k = ++n[m.kind]
    const file = m.file || m.path
    if (!file || !fs.existsSync(file)) continue
    if (m.kind === 'picture' && mode === 'frames' && k <= 2) plan.push({ file, label: k === 1 ? 'the first frame (the video opens exactly on it)' : 'the last frame (the video ends on it)' })
    else if (m.kind === 'picture' && mode === 'reference') plan.push({ file, label: `<Picture ${k}>` })
    else if (m.kind === 'video' && mode === 'reference') plan.push({ file, at: 0.15, label: `<Video ${k}>, a frame near its start` }, { file, at: 0.6, label: `<Video ${k}>, a frame later on` })
    else if (m.kind === 'video' && mode === 'continue' && k === 1) plan.push({ file, at: 'end', label: 'the last frame of the video this shot continues' })
  }
  return plan.slice(0, MAX_IMAGES)
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    const out = []
    p.stdout.on('data', (d) => out.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${path.basename(cmd)} exited ${code}`))))
  })

// One picture or video frame as base64 JPEG. at: a fraction of the video's length, 'end', or none for a picture.
async function jpegOf({ file, at }) {
  let seek = []
  if (at === 'end') seek = ['-sseof', '-0.1']
  else if (at != null) {
    const length = parseFloat(String(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]))) || 0
    seek = ['-ss', (length * at).toFixed(2)]
  }
  const jpg = await run(FFMPEG, ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'])
  if (!jpg.length) throw new Error('no frame')
  return jpg.toString('base64')
}

async function imagesFor(media, mode) {
  const shown = []
  for (const item of imagePlan(media, mode)) {
    try {
      shown.push({ label: item.label, data: await jpegOf(item) })
    } catch {
      // a picture ffmpeg can't read still goes over as it is; a video frame that fails is left out
      if (item.at == null) shown.push({ label: item.label, data: fs.readFileSync(item.file).toString('base64') })
    }
  }
  return shown
}

const LOOK_RULE = `The images attached to this message are the references, listed below. Look at them closely and write what you actually see into the shots: who is in them (face, hair, age, build, wardrobe), the objects, the place, the light and the colours. Refer to each reference by its label, and don't invent details that contradict them.`

// cpu: keep the model off the GPU (used while ComfyUI is rendering, so H3 keeps its VRAM).
export async function writeLocal({ idea, mode = 'text', seconds = 5, character, sequence = false, previous, media = [], model, cpu = false }) {
  await ensureOllama()
  const status = await ollamaStatus()
  const name = model || DEFAULT_LOCAL_MODEL
  const info = status.models.find((m) => m.name === name)
  if (!info) throw new Error(`The writer model ${name} isn't in Ollama yet. Install it in Settings → Prompt writer.`)
  let user = `Idea: ${withName(idea, character)}`
  if (previous) user += `\n\nThe previous shot, which this one continues from:\n${withName(previous, character)}`
  const message = { role: 'user', content: user }
  if (info.vision) {
    const shown = await imagesFor(media, mode)
    if (shown.length) {
      message.images = shown.map((s) => s.data)
      message.content += `\n\n${LOOK_RULE}\n${shown.map((s, i) => `Image ${i + 1}: ${s.label}`).join('\n')}`
    }
  }
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: false, format: outputSchema({ mode, sequence }), keep_alive: 0, options: { temperature: 0.6, num_ctx: 8192, ...(cpu ? { num_gpu: 0 } : {}) }, messages: [{ role: 'system', content: systemPrompt({ mode, seconds, character, sequence, media }) }, message] }),
    signal: AbortSignal.timeout(300000)
  })
  if (!r.ok) throw new Error(`Ollama: ${(await r.text()).slice(0, 300)}`)
  const out = await r.json()
  return cleanPrompt(assemble(parseJson(out.message?.content), { mode, seconds }), character)
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, ''))
  } catch {
    throw new Error('The writer returned something unreadable. Try again.')
  }
}

// A short story -> one prompt per shot, written to join as one continuous take.
export async function writeStoryLocal({ story, shots, seconds, character, model, cpu = false }) {
  await ensureOllama()
  const name = model || DEFAULT_LOCAL_MODEL
  const sys = `${systemPrompt({ mode: 'text', seconds, character, sequence: true })}
TASK: Split the story into exactly ${shots} consecutive shots of ${seconds} seconds each, following every rule above. Each item of "prompts" is one shot in the single-shot JSON shape of the example (style, shots with exactly one entry, soundscape, music).`
  const single = outputSchema({ sequence: true })
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: name, stream: false, format: { type: 'object', properties: { prompts: { type: 'array', items: single, minItems: shots, maxItems: shots } }, required: ['prompts'] }, keep_alive: 0, options: { temperature: 0.6, num_ctx: 16384, ...(cpu ? { num_gpu: 0 } : {}) }, messages: [{ role: 'system', content: sys }, { role: 'user', content: `Story: ${withName(story, character)}` }] }),
    signal: AbortSignal.timeout(600000)
  })
  if (!r.ok) throw new Error(`Ollama: ${(await r.text()).slice(0, 300)}`)
  const out = await r.json()
  const list = parseJson(out.message?.content).prompts
  if (!Array.isArray(list) || !list.length) throw new Error('The writer did not return a shot list. Try again.')
  return list.slice(0, shots).map((p) => cleanPrompt(assemble(p, { seconds }), character))
}

export async function pullModel(name, onProgress) {
  await ensureOllama()
  const r = await fetch(`${OLLAMA_URL}/api/pull`, { method: 'POST', body: JSON.stringify({ model: name, stream: true }) })
  if (!r.ok) throw new Error(`Ollama: ${(await r.text()).slice(0, 300)}`)
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const ev = JSON.parse(line)
      if (ev.error) throw new Error(`Ollama: ${ev.error}`)
      onProgress?.(ev)
    }
  }
  return true
}

// ---------- MiniMax Context IR (ComfyUI partner node) ----------
// media: [{kind, name}] already uploaded into ComfyUI's input folder, in IV Studio order.
export function contextIrGraph({ idea, mode, seconds, aspect, character, media = [], sequence = false }) {
  const g = {}
  const ir = { model: 'MiniMax H3', 'model.prompt': '', 'model.duration': Math.min(15, Math.max(4, Math.round(seconds))), 'model.ratio': aspect || '16:9' }
  let text = withName(idea, character)
  if (character) text += ` (${firstName(character)}'s face and voice come from a trained character model; describe clothes and actions, not their face or voice.)`
  if (sequence) text += ' This shot joins seamlessly onto the previous and next shots as one continuous take: open holding the previous closing pose, stay quiet for about two seconds before speaking, and end settled with about two seconds to spare.'
  if (mode === 'continue') text += ' The video continues an existing clip from its final frame, holding that arrangement at the start.'
  ir['model.prompt'] = text
  const pics = media.filter((m) => m.kind === 'picture')
  if (mode === 'frames') {
    pics.slice(0, 2).forEach((m, i) => {
      g[`img${i}`] = { class_type: 'LoadImage', inputs: { image: m.name } }
      ir[i === 0 ? 'first_frame' : 'last_frame'] = [`img${i}`, 0]
    })
  } else if (mode === 'reference') {
    const n = { picture: 0, video: 0, audio: 0 }
    for (const m of media) {
      const k = ++n[m.kind]
      const id = `${m.kind}${k}`
      if (m.kind === 'picture' && k <= 9) {
        g[id] = { class_type: 'LoadImage', inputs: { image: m.name } }
        ir[`model.reference_images.image_${k}`] = [id, 0]
      } else if (m.kind === 'video' && k <= 3) {
        g[id] = { class_type: 'LoadVideo', inputs: { file: m.name } }
        ir[`model.reference_videos.video_${k}`] = [id, 0]
      } else if (m.kind === 'audio' && k <= 3 && media.some((x) => x.kind !== 'audio')) {
        // Context IR refuses audio without a picture or video
        g[id] = { class_type: 'LoadAudio', inputs: { audio: m.name } }
        ir[`model.reference_audios.audio_${k}`] = [id, 0]
      }
    }
  }
  if (!Object.keys(ir).some((k) => k.startsWith('model.reference') || k.endsWith('_frame')) && ir['model.ratio'] === 'adaptive') ir['model.ratio'] = '16:9'
  g.ir = { class_type: 'MinimaxHailuo03ContextIRNode', inputs: ir }
  g.out = { class_type: 'PreviewAny', inputs: { source: ['ir', 0] } }
  return g
}

// Context IR names media "Image 1", "Video 1", "Audio 1"; IV Studio's workflow uses <Picture 1>, <Video 1>, <Audio 1>.
export function fromContextIr(text, character) {
  const t = String(text || '')
    .replace(/<?\b(?:Image|Picture)\s*(\d)\b>?/g, '<Picture $1>')
    .replace(/<?\bVideo\s*(\d)\b>?/g, '<Video $1>')
    .replace(/<?\bAudio\s*(\d)\b>?/g, '<Audio $1>')
  return cleanPrompt(t, character)
}
