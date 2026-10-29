// IV Studio MCP server (stdio). Same service, data folder and job records as the studio window, so an agent
// and a person see the same projects and results. Run with the app's own binary:
//   ELECTRON_RUN_AS_NODE=1 "IV Studio.exe" <resources>/app.asar/out/main/mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { Edits, editLength, FORMATS, TRACKS } from '../service/edits'
import { dataDir, readSettings, resourcesDir, writeSettings } from '../service/paths'
import { ASPECTS, FRAME_GEN_FPS, MODES } from '../service/plan'
import { RETAKE_MODES, SHOT_SECONDS } from '../service/sequence'
import { Studio } from '../service/studio'
import { applyOps, clipEnd } from '../service/timeline'

const DATA = dataDir()
const studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(), comfyUrl: readSettings(DATA).comfyUrl, models: readSettings(DATA).models })
const server = new McpServer({ name: 'iv-studio', version: '0.1.0' })
// Where the app puts downloads and exports (Electron's videos folder; this process has no Electron app).
const VIDEOS = path.join(process.env.USERPROFILE || os.homedir(), 'Videos', 'IV Studio')
// Packaged, the ffmpeg binaries sit outside the asar archive.
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

// MCP structured results must be objects, so lists go out as { items }.
const ok = (value) => {
  if (value?.image) return { content: [{ type: 'image', data: value.image, mimeType: 'image/png' }, { type: 'text', text: value.caption }] }
  const structured = value && typeof value === 'object' && !Array.isArray(value) ? value : { items: value }
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: structured }
}
const fail = (err) => ({ isError: true, content: [{ type: 'text', text: err.message }] })
const tool = (name, description, shape, fn) =>
  server.registerTool(name, { description, inputSchema: shape }, async (args) => {
    try {
      return ok(await fn(args))
    } catch (err) {
      return fail(err)
    }
  })

const media = z
  .array(z.object({ kind: z.enum(['picture', 'video', 'audio']), file: z.string().describe('Absolute local path (uploaded to ComfyUI) or a name already in ComfyUI input') }))
  .optional()
  .describe('frames mode: 1-2 pictures (first, last). reference mode: pictures, videos, audio, named <Picture 1>, <Video 1>, <Audio 1> in the prompt. continue mode: 1 video.')
const request = {
  mode: z.enum(Object.keys(MODES)).default('text').describe('text, frames (first/last frame), reference (ref2va), continue (extend a video)'),
  prompt: z.string().describe('H3 prompt. Write {char} where the character trigger word goes, e.g. "{char} (S1) says: <d>[English] Hi.</d>"'),
  character: z.string().default('tess').describe('Character preset id from list_characters, or "none"'),
  aspect: z.enum(Object.keys(ASPECTS)).default('16:9'),
  megapixels: z.number().min(0.1).max(2.5).default(0.4).describe('Preview size. 0.4 is the tested default.'),
  seconds: z.number().min(1).max(15).default(5),
  previews: z.number().int().min(1).max(3).default(3),
  seed: z.number().int().min(0).default(4242).describe('Previews use seed, seed+1000, seed+2000'),
  steps: z.number().int().min(4).max(20).default(8),
  media,
  overlapFrames: z.number().int().optional().describe('continue mode: 5, 22, 39 or 56'),
  voiceLine: z.string().optional().describe('Absolute path to a voice recording; the previews lip-sync to it'),
  refmods: z.array(z.object({ name: z.string(), strength: z.number().min(0).max(1).optional(), copies: z.number().int().min(1).max(10).optional() })).optional(),
  retention: z.number().min(0).max(1).optional(),
  extraLoras: z.array(z.object({ name: z.string(), strength: z.number().optional() })).optional()
}
const finish = {
  candidate: z.number().int().min(1).max(3).default(1),
  megapixels: z.number().min(0.5).max(4).default(2),
  upscale2x: z.boolean().default(false).describe('RTX 2x after DLSS (2 MP -> about 4K)'),
  fps: z.number().int().default(0).describe(`Frame generation: ${FRAME_GEN_FPS.join(', ')} (0 = off)`),
  audio: z.enum(['pass', 'preview', 'voice']).default('pass').describe('Final sound: the 2 MP pass, the picked preview (keeps a cloned voice), or the voice line itself'),
  rerollSeed: z.number().int().optional()
}

tool('check_setup', 'Report ComfyUI, GPU, node packs, models and characters, with fixes for anything missing.', {}, () => studio.checkSetup())
tool('list_characters', 'Character presets (LoRA, strength, trigger word).', {}, () => studio.characters())
tool('list_projects', 'Projects in the IV Studio library, newest first.', {}, () => studio.listProjects())
tool('plan_render', 'Validate a request and resolve size, frames, duration, seeds and the finished size, without rendering.', { ...request, finish: z.object(finish).partial().optional() }, ({ finish: f, ...r }) => studio.planRender(r, f || {}))
tool('generate_previews', 'Start preview candidates. Returns a job at once; follow with get_job.', { ...request, projectId: z.string().optional(), projectName: z.string().optional() }, (args) => studio.generatePreviews(args))
tool('finish_candidate', "Finish one preview candidate (2 MP pass + DLSS, optional RTX 2x and frame generation) from its recorded settings. Reuses the candidate's saved latent.", { jobId: z.string().describe('The previews job id'), ...finish }, (args) => studio.finishCandidate(args))
const sequenceFields = {
  name: z.string().optional(),
  method: z.enum(['take', 'shots']).optional().describe('take: every shot in one seamless render. shots: hunt and finish shot by shot, each continuing from the last.'),
  character: z.string().optional().describe('Character preset id, or "none"'),
  aspect: z.enum(Object.keys(ASPECTS)).optional(),
  megapixels: z.number().min(0.3).max(1.5).optional().describe('Render size of the sequence. 0.9 (1280x736 at 16:9) is the tested default.'),
  shotSeconds: z.number().refine((v) => SHOT_SECONDS.includes(v)).optional().describe(`Length of every shot: ${SHOT_SECONDS.join(' or ')} seconds`),
  steps: z.number().int().min(4).max(20).optional(),
  seed: z.number().int().min(0).optional(),
  voiceRef: z.string().nullable().optional().describe('take: absolute path to a voice sample the whole take keeps'),
  shots: z
    .array(z.object({ id: z.string().optional(), prompt: z.string(), mode: z.enum(['text', 'reference', 'frames']).optional(), media: media }))
    .optional()
    .describe("One prompt per shot. Each later shot should open holding the previous shot's closing arrangement and stay quiet ~2 s before anyone speaks; end settled with ~2 s to spare. {char} = trigger word.")
}
tool('list_sequences', 'Sequences (several shots that play as one continuous video), newest first.', {}, () => studio.listSequences())
tool('get_sequence', 'A sequence with its shots, versions (takes, shot-by-shot result, retakes) and render-outs.', { sequenceId: z.string() }, ({ sequenceId }) => studio.refreshSequence(sequenceId))
tool('save_sequence', 'Create a sequence (no sequenceId) or update its settings and shots.', { sequenceId: z.string().optional(), ...sequenceFields }, ({ sequenceId, ...patch }) =>
  sequenceId ? studio.saveSequence(sequenceId, patch) : studio.saveSequence(studio.createSequence().id, patch)
)
tool('render_take', 'Render every shot of a sequence as one seamless take (H3 Multishot). Adds a version; follow with get_job.', { sequenceId: z.string() }, ({ sequenceId }) => studio.renderTake(sequenceId))
tool('hunt_shot', 'Shot by shot: start previews for one shot (index from 0). Shot 1 gets 3 candidates; later shots continue from the previous finished shot.', { sequenceId: z.string(), index: z.number().int().min(0), seed: z.number().int().optional() }, ({ sequenceId, index, seed }) => studio.huntShot(sequenceId, index, { seed }))
tool('finish_shot', 'Shot by shot: finish the picked candidate of one shot at the sequence size.', { sequenceId: z.string(), index: z.number().int().min(0), candidate: z.number().int().min(1).max(3).default(1) }, ({ sequenceId, index, candidate }) => studio.finishShot(sequenceId, index, { candidate }))
tool('retake', 'Redo start..end seconds of a finished version and keep the rest. Adds a new version.', {
  sequenceId: z.string(),
  versionId: z.string().describe('From get_sequence versions, e.g. v1 or shots'),
  prompt: z.string().describe('What happens in that stretch, written like a shot prompt'),
  start: z.number().min(0),
  end: z.number().min(0.1),
  mode: z.enum(Object.keys(RETAKE_MODES)).default('both').describe('both: picture and sound. video: keep the performance (audio). audio: keep the picture.'),
  seed: z.number().int().optional()
}, ({ sequenceId, ...opts }) => studio.retakeSequence(sequenceId, opts))
tool('render_out', 'Finish a version: optional colour smoothing across the joins, then DLSS (scale 1 or 2, frame generation).', {
  sequenceId: z.string(),
  versionId: z.string(),
  normalize: z.boolean().default(false).describe('Smooth colour shifts at the joins (most useful for shot by shot)'),
  scale: z.number().int().min(1).max(2).default(1),
  fps: z.number().int().default(0).describe(`Frame generation: ${FRAME_GEN_FPS.join(', ')} (0 = off)`)
}, ({ sequenceId, ...opts }) => studio.renderOutSequence(sequenceId, opts))
tool('write_prompt', 'Write a MiniMax H3 prompt from a plain-words idea, using the same writer as the app. engine local = free model in Ollama (default); contextir = MiniMax Context IR, paid per call, needs COMFY_ORG_API_KEY in the environment of this server.', {
  idea: z.string(),
  mode: z.enum(Object.keys(MODES)).default('text'),
  seconds: z.number().min(1).max(15).default(5),
  aspect: z.enum(Object.keys(ASPECTS)).default('16:9'),
  character: z.string().default('tess').describe('Character preset id or "none"; the result uses {char} for it'),
  media,
  sequence: z.boolean().default(false).describe('Write it as one shot of a continuous sequence (join rules)'),
  previous: z.string().optional().describe('sequence: the prompt of the previous shot'),
  engine: z.enum(['local', 'contextir']).optional()
}, ({ engine, ...request }) => {
  const s = readSettings(DATA)
  const e = engine || (s.promptEngine === 'contextir' && process.env.COMFY_ORG_API_KEY ? 'contextir' : 'local')
  return studio.writePrompt(request, { engine: e, apiKey: process.env.COMFY_ORG_API_KEY || null, model: s.ollamaModel }).then((prompt) => ({ prompt, engine: e }))
})
tool('write_shots_from_story', 'Split a short story into sequence shots and write each one so they join as one continuous take (free local writer).', {
  story: z.string(),
  shots: z.number().int().min(1).max(8).default(3),
  seconds: z.number().refine((v) => SHOT_SECONDS.includes(v)).default(10),
  character: z.string().default('tess')
}, (args) => studio.writeStory(args, { model: readSettings(DATA).ollamaModel }).then((shots) => ({ shots })))
tool('get_job', 'Status, progress and outputs of a job.', { jobId: z.string() }, ({ jobId }) => studio.refreshJob(jobId))
tool('cancel_job', 'Cancel an IV Studio job (removes it from the queue or interrupts it if running); never touches other work.', { jobId: z.string() }, ({ jobId }) => studio.cancelJob(jobId))
tool('get_outputs', 'Playable outputs (paths and URLs) with the settings that made them, for a job or a whole project.', { jobId: z.string().optional(), projectId: z.string().optional() }, async ({ jobId, projectId }) => {
  if (jobId) {
    const j = await studio.refreshJob(jobId)
    return { job: j.id, status: j.status, resolved: j.plan.resolved, outputs: j.outputs }
  }
  if (projectId) return studio.listJobs(projectId).map((j) => ({ job: j.id, kind: j.kind, status: j.status, resolved: j.plan.resolved, outputs: j.outputs }))
  throw new Error('Give jobId or projectId.')
})

// ---------- projects and sequences ----------
tool('rename_project', 'Rename a project in the library.', { projectId: z.string(), name: z.string().min(1) }, ({ projectId, name }) => studio.renameProject(projectId, name))
tool('delete_sequence', 'Delete a sequence and its record of versions. Rendered video files stay on disk. Ask the person first.', { sequenceId: z.string() }, ({ sequenceId }) => studio.deleteSequence(sequenceId))

// ---------- renders library ----------
tool('list_renders', 'Every IV Studio render (shot finals and previews, sequence versions and finals), newest first. Pass a key to add_media to put one on a timeline.', { limit: z.number().int().min(1).max(500).default(50) }, ({ limit }) =>
  studio.library().slice(0, limit).map(({ key, label, group, at, file }) => ({ key, label, group, at, path: file.path || null, url: file.url || null }))
)

// ---------- edits (the timeline editor) ----------
const edits = new Edits({
  dataDir: DATA,
  ffmpeg: unpacked(ffmpegStatic.ffmpegPath),
  ffprobe: unpacked(ffmpegStatic.ffprobePath),
  fontFile: path.join(resourcesDir(), 'fonts', 'BarlowCondensed-SemiBold.ttf')
})
const exporting = new Map() // edit id -> { state, progress, file, error, startedAt }

// An edit as an agent reads it: media by id, then each track's clips in time order with the media name.
function describe(e) {
  const tracks = Object.fromEntries(
    TRACKS.map((t) => [
      t.id,
      e.clips
        .filter((c) => c.track === t.id)
        .sort((a, b) => a.start - b.start)
        .map((c) => ({ clip: c.id, ...(c.text ? { title: c.text } : { media: c.media, name: e.media[c.media]?.name }), start: c.start, end: +clipEnd(c).toFixed(3), in: c.in, out: c.out, fadeIn: c.fadeIn, fadeOut: c.fadeOut, ...(c.text ? {} : { volume: c.volume ?? 1, muted: !!c.muted }) }))
    ])
  )
  return { id: e.id, name: e.name, settings: e.settings, seconds: +editLength(e).toFixed(3), media: Object.values(e.media).map(({ id, name, kind, duration, width, height, hasAudio, path: p }) => ({ id, name, kind, duration, width, height, hasAudio, path: p })), tracks, exports: e.exports || [] }
}

const LIVE = 'If the edit is open in the IV Studio window, it reloads there and the person can undo your change with Ctrl+Z.'
tool('list_edits', 'Edits (timelines in the Edit page), newest first.', {}, () => edits.list())
tool('get_edit', 'An edit: its media (with ids), each track\'s clips in order (clip ids, start/end on the timeline, in/out in the media, fades, volume), settings and past exports. Tracks: V2 is drawn over V1; T1 holds titles; A1/A2 are sound. Video clips play their own sound too unless muted.', { editId: z.string() }, ({ editId }) => describe(edits.get(editId)))
tool('create_edit', 'Create an empty edit.', { name: z.string().default('Untitled edit'), format: z.enum(Object.keys(FORMATS)).default('1080p'), fps: z.number().int().min(12).max(60).default(24) }, ({ name, format, fps }) => {
  const e = edits.create(name)
  return describe(edits.save(e.id, { settings: { format, fps } }))
})
tool('set_edit_settings', `Rename an edit or change its export format (${Object.entries(FORMATS).map(([k, f]) => `${k} = ${f.label}`).join(', ')}) and frame rate. ${LIVE}`, {
  editId: z.string(),
  name: z.string().min(1).optional(),
  format: z.enum(Object.keys(FORMATS)).optional(),
  fps: z.number().int().min(12).max(60).optional()
}, ({ editId, name, format, fps }) => {
  const e = edits.get(editId)
  return describe(edits.save(editId, { name, settings: { ...e.settings, ...(format && { format }), ...(fps && { fps }) } }))
})
tool('delete_edit', 'Delete an edit (the timeline only: its media files and exported videos stay). Ask the person first.', { editId: z.string() }, ({ editId }) => edits.remove(editId))
tool('add_media', `Add files to an edit's media bin: local video, picture or audio paths, and/or IV Studio renders by key (list_renders; cloud renders download to Videos\\IV Studio). Returns the new media ids. With append, each also goes on the end of V1 (video, pictures) or A1 (sound), in the order given. ${LIVE}`, {
  editId: z.string(),
  files: z.array(z.string()).optional().describe('Absolute paths on this PC'),
  renders: z.array(z.string()).optional().describe('Keys from list_renders'),
  append: z.boolean().default(false)
}, async ({ editId, files = [], renders = [], append }) => {
  const e = edits.get(editId)
  const lib = renders.length ? studio.library() : []
  const added = []
  for (const f of files) added.push(await edits.addMedia(f))
  for (const key of renders) {
    const item = lib.find((i) => i.key === key)
    if (!item) throw new Error(`No render ${key}. list_renders gives the keys.`)
    added.push(await edits.addMedia(await studio.localCopy(item.file, VIDEOS), { type: 'iv', label: item.label }))
  }
  if (!added.length) throw new Error('Give files or renders.')
  const media = { ...e.media, ...Object.fromEntries(added.map((m) => [m.id, m])) }
  const { clips, results } = append ? applyOps({ ...e, media }, added.map((m) => ({ op: 'add_clip', media: m.id }))) : { clips: e.clips, results: [] }
  edits.save(editId, { media, clips })
  return { media: added.map(({ id, name, kind, duration, width, height, hasAudio }) => ({ id, name, kind, duration, width, height, hasAudio })), placed: results }
})

const op = {
  add_clip: z.object({ op: z.literal('add_clip'), media: z.string().describe('Media id'), track: z.enum(['V1', 'V2', 'A1', 'A2']).optional().describe('Default V1, or A1 for sound'), start: z.number().min(0).optional().describe('Timeline seconds; default = the end of that track'), in: z.number().min(0).optional().describe('Where in the media to start (default 0)'), out: z.number().optional().describe('Where in the media to stop (default its end; pictures 4 s)'), duration: z.number().optional().describe('Instead of out: how long the clip plays'), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(), volume: z.number().min(0).max(4).optional(), muted: z.boolean().optional() }),
  add_title: z.object({ op: z.literal('add_title'), content: z.string(), start: z.number().min(0).default(0), duration: z.number().min(0.1).default(3), size: z.number().min(2).max(30).optional().describe('Text height as % of the frame (default 8)'), position: z.enum(['top', 'center', 'bottom']).optional(), color: z.string().optional().describe('#rrggbb'), box: z.boolean().optional().describe('Dark box behind the text'), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional() }),
  update_clip: z.object({ op: z.literal('update_clip'), clip: z.string(), track: z.enum(['V1', 'V2', 'T1', 'A1', 'A2']).optional(), start: z.number().min(0).optional().describe('Move it on the timeline'), in: z.number().min(0).optional().describe('Trim the head (media seconds)'), out: z.number().optional().describe('Trim the tail (media seconds)'), duration: z.number().optional(), fadeIn: z.number().min(0).optional(), fadeOut: z.number().min(0).optional(), volume: z.number().min(0).max(4).optional(), muted: z.boolean().optional(), content: z.string().optional().describe('Titles only, as are size, position, color, box'), size: z.number().optional(), position: z.enum(['top', 'center', 'bottom']).optional(), color: z.string().optional(), box: z.boolean().optional() }),
  split_clip: z.object({ op: z.literal('split_clip'), clip: z.string(), at: z.number().describe('Timeline seconds, inside the clip') }),
  remove_clip: z.object({ op: z.literal('remove_clip'), clip: z.string(), ripple: z.boolean().default(false).describe('Close the gap: later clips on the same track move left') }),
  remove_media: z.object({ op: z.literal('remove_media'), media: z.string().describe('Takes it out of the bin with all its clips (the file stays)') }),
  clear: z.object({ op: z.literal('clear'), track: z.enum(['V1', 'V2', 'T1', 'A1', 'A2']).optional().describe('One track, or every clip when left out') })
}
tool('edit_timeline', `Change an edit's timeline with a list of operations, applied in order: add_clip, add_title, update_clip (move, trim, change track, fades, volume, mute, title text), split_clip, remove_clip (optionally ripple), remove_media, clear. All are checked against the media first; if one fails, nothing changes. Returns what each did and the edit afterwards. ${LIVE}`, {
  editId: z.string(),
  ops: z.array(z.discriminatedUnion('op', Object.values(op))).min(1)
}, ({ editId, ops }) => {
  const e = edits.get(editId)
  const { clips, media, results } = applyOps(e, ops)
  return { results, edit: describe(edits.save(editId, { clips, media })) }
})

tool('grab_frame', 'A picture of one moment, to check an edit or a render by eye: either an edit at a timeline time (the top visible video clip, without titles) or any video file at a time.', {
  editId: z.string().optional(),
  file: z.string().optional().describe('Instead of editId: an absolute video path'),
  at: z.number().min(0).describe('Seconds'),
  width: z.number().int().min(160).max(1920).default(640)
}, async ({ editId, file, at, width }) => {
  let src = file
  let t = at
  if (editId) {
    const e = edits.get(editId)
    const c = ['V2', 'V1'].flatMap((tr) => e.clips.filter((x) => x.track === tr && at >= x.start && at < clipEnd(x)))[0]
    if (!c) throw new Error(`Nothing on V1 or V2 at ${at} s.`)
    src = e.media[c.media].path
    t = e.media[c.media].kind === 'image' ? 0 : c.in + (at - c.start)
  }
  if (!src || !fs.existsSync(src)) throw new Error('Give editId or an existing file.')
  const png = await new Promise((resolve, reject) => {
    const p = spawn(edits.ffmpeg, ['-v', 'error', '-ss', t.toFixed(3), '-i', src, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], { windowsHide: true })
    const out = []
    p.stdout.on('data', (d) => out.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && out.length ? resolve(Buffer.concat(out)) : reject(new Error(`No frame at ${t.toFixed(2)} s in ${path.basename(src)}.`))))
  })
  return { image: png.toString('base64'), caption: `${path.basename(src)} at ${t.toFixed(2)} s` }
})

tool('export_edit', `Render the whole edit to one MP4 (H.264 + AAC) in Videos\\IV Studio\\Edits, or outDir. Returns at once; follow with get_edit_export. The export runs inside this MCP server, so it stops if the server stops.`, {
  editId: z.string(),
  outDir: z.string().optional()
}, ({ editId, outDir }) => {
  if (exporting.get(editId)?.state === 'running') throw new Error('This edit is already exporting.')
  const e = edits.get(editId)
  if (!e.clips.length) throw new Error('The timeline is empty.')
  const st = { state: 'running', progress: 0, file: null, error: null, startedAt: new Date().toISOString(), seconds: +editLength(e).toFixed(2) }
  exporting.set(editId, st)
  edits
    .export(editId, outDir || path.join(VIDEOS, 'Edits'), (p) => (st.progress = +p.toFixed(3)))
    .then((f) => Object.assign(st, { state: 'done', progress: 1, file: f }))
    .catch((err) => Object.assign(st, { state: /cancel/i.test(err.message) ? 'cancelled' : 'failed', error: err.message }))
  return st
})
tool('get_edit_export', 'Progress of an export started with export_edit (state running, done, failed or cancelled; file when done).', { editId: z.string() }, ({ editId }) => {
  const st = exporting.get(editId)
  if (!st) throw new Error('No export started for this edit from this MCP server. Past exports are in get_edit.')
  return st
})
tool('cancel_edit_export', 'Stop an export started with export_edit.', { editId: z.string() }, ({ editId }) => ({ cancelled: edits.cancelExport(editId) }))

// ---------- models and characters ----------
const WORKFLOWS = ['text', 'frames', 'reference', 'continue', 'take', 'retake']
tool('list_h3_models', 'H3 models the ComfyUI can load, each workflow\'s built-in default, and the model chosen in Settings for each (text, frames, reference, continue, take = Sequences one take, retake). Some models suit realism, others animation.', {}, async () => {
  const { models, defaults } = await studio.h3Models()
  return { models, defaults, chosen: readSettings(DATA).models || {} }
})
tool('set_workflow_model', 'Choose the H3 model one workflow uses (Settings -> Models). model null = back to the default. Applies to this MCP server at once and to the app window from its next render.', {
  workflow: z.enum(WORKFLOWS),
  model: z.string().nullable()
}, async ({ workflow, model }) => {
  if (model) {
    const { models } = await studio.h3Models()
    if (!models.includes(model)) throw new Error(`ComfyUI has no H3 model "${model}". list_h3_models shows them.`)
  }
  const next = { ...(readSettings(DATA).models || {}) }
  if (model) next[workflow] = model
  else delete next[workflow]
  studio.models = writeSettings({ models: next }, DATA).models
  return { chosen: studio.models }
})
tool('list_choices', 'Character LoRAs and RefMods the ComfyUI can load (for save_character and the refmods of a request).', {}, () => studio.choices())
tool('save_character', 'Add a character preset, or update one by id. The LoRA must be a name from list_choices. Only invented characters, or real people who agreed to it.', {
  id: z.string().regex(/^[a-z0-9_-]{2,32}$/).describe('Short id, e.g. "tess"'),
  name: z.string().min(1).optional(),
  lora: z.string().optional(),
  strength: z.number().min(0).max(1.5).optional(),
  trigger: z.string().min(2).optional().describe('The trigger word the LoRA was trained on; prompts write {char} for it'),
  voiceRefmod: z.string().nullable().optional(),
  visualRefmod: z.string().nullable().optional()
}, async ({ id, ...fields }) => {
  const list = studio.characters()
  const old = list.find((c) => c.id === id)
  const next = { ...(old || { strength: 0.8 }), id, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) }
  for (const k of ['name', 'lora', 'trigger']) if (!next[k]) throw new Error(`A new character needs ${k}.`)
  if (fields.lora) {
    const { loras } = await studio.choices()
    if (!loras.some((l) => l.replace(/\\/g, '/') === fields.lora.replace(/\\/g, '/'))) throw new Error(`ComfyUI has no LoRA "${fields.lora}". list_choices shows them.`)
  }
  studio.saveCharacters(old ? list.map((c) => (c.id === id ? next : c)) : [...list, next])
  return next
})
tool('delete_character', 'Remove a character preset (the LoRA file stays). Ask the person first.', { id: z.string() }, ({ id }) => {
  const list = studio.characters()
  if (!list.some((c) => c.id === id)) throw new Error(`No character ${id}.`)
  return studio.saveCharacters(list.filter((c) => c.id !== id))
})

server.connect(new StdioServerTransport()).catch((err) => {
  console.error('IV Studio MCP server failed to start:', err)
  process.exit(1)
})
