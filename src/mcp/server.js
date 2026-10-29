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
import { INSTRUCTIONS, readGuide } from '../service/agent'
import { Edits, editLength, FORMATS, TRACKS } from '../service/edits'
import { MediaTools } from '../service/media'
import { dataDir, readSettings, resourcesDir, writeSettings } from '../service/paths'
import { ASPECTS, FRAME_GEN_FPS, MODES } from '../service/plan'
import { RETAKE_MODES, SHOT_SECONDS } from '../service/sequence'
import { Studio } from '../service/studio'
import { applyOps, clipEnd } from '../service/timeline'
import { TALKS, TRAIN_GPUS, Trainings } from '../service/training'
import { Shinobi } from '../service/shinobi'
import { CharacterCatalog } from '../service/characters'
import { Replace, RESOLUTIONS } from '../service/replace'
import { VOICE_ENGINES, Voices } from '../service/voices'
import { ACE_KEYS, Music, MUSIC_DEFAULTS, MUSIC_ENGINES } from '../service/music'

const DATA = dataDir()
const studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(), comfyUrl: readSettings(DATA).comfyUrl, models: readSettings(DATA).models })
const server = new McpServer({ name: 'iv-studio', version: '0.1.0' }, { instructions: INSTRUCTIONS })
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

// The full how-to, as plain markdown (resources/agent-guide.md, also the Claude Code skill).
server.registerTool('get_guide', { description: 'How to use IV Studio: rendering shots, writing H3 prompts, sequences, timeline edits, models, characters, and the house rules. Read it once before your first render or edit.', inputSchema: {} }, () => ({
  content: [{ type: 'text', text: readGuide(resourcesDir()) }]
}))
tool('check_setup', 'Report ComfyUI, GPU, node packs, models and characters, with fixes for anything missing.', {}, () => studio.checkSetup())
tool('list_characters', 'Character presets (LoRA, strength, trigger word).', {}, () => studio.characters())
tool('list_projects', 'Projects in the IV Studio library, newest first.', {}, () => studio.listProjects())
tool('plan_render', 'Validate a request and resolve size, frames, duration, seeds and the finished size, without rendering.', { ...request, finish: z.object(finish).partial().optional() }, ({ finish: f, ...r }) => studio.planRender(r, f || {}))
tool('generate_previews', 'Start preview candidates. Returns a job at once; follow with get_job.', { ...request, projectId: z.string().optional(), projectName: z.string().optional() }, async (args) => (readSettings(DATA).target === 'cloud' || (await voices.release()), studio.generatePreviews(args)))
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
tool('delete_project', "Delete a shot (project) and its run history. Its videos stay in ComfyUI's output folder. Ask the person first.", { projectId: z.string() }, ({ projectId }) => studio.deleteProject(projectId))
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
const mediaTools = new MediaTools({ dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
tool('prepare_media', 'Crop a picture, or trim (and optionally crop) a video or a sound, before using it as a reference, frame, source video or voice line. The original stays as it is; returns the new file. For first/last frames, crop to the shot aspect: frames are stretched to the shot size. H3 video lengths are 17n+5 frames at 24 fps (73 = 3.04 s, 124 = 5.17 s).', {
  file: z.string().describe('Absolute path on this PC'),
  crop: z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().min(16), h: z.number().min(16) }).optional().describe('In source pixels'),
  start: z.number().min(0).optional().describe('Seconds'),
  end: z.number().optional().describe('Seconds')
}, (args) => mediaTools.prepare(args))
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

// ---------- character training ----------
// ---------- Shinobi: the agent-driven editor (OpenKatana engine) ----------
const shinobi = new Shinobi({ dataDir: DATA, resourcesDir: resourcesDir(), ffmpegDir: path.dirname(edits.ffmpeg) })
// Pictures a Shinobi tool made (preview frames, contact sheets), as small JPEGs for the agent to look at.
async function picturesOf(result, max = 4) {
  const paths = []
  const walk = (v) => {
    if (paths.length >= max) return
    if (typeof v === 'string' && /\.(png|jpe?g)$/i.test(v) && fs.existsSync(v)) paths.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(result)
  const out = []
  for (const p of paths) {
    const jpg = path.join(os.tmpdir(), `shinobi-${path.basename(p)}-${Date.now()}.jpg`)
    await new Promise((res) => spawn(edits.ffmpeg, ['-v', 'error', '-y', '-i', p, '-vf', 'scale=768:-2', '-q:v', '4', jpg], { windowsHide: true }).on('close', res))
    if (fs.existsSync(jpg)) out.push({ type: 'image', data: fs.readFileSync(jpg).toString('base64'), mimeType: 'image/jpeg' }), fs.rmSync(jpg, { force: true })
  }
  return out
}
tool('shinobi_status', "Is Shinobi (IV Studio's agent-driven editor, built on OpenKatana) set up on this PC, which browser it renders with, and its projects folder.", {}, () => ({ ...shinobi.status(), projects: shinobi.status().installed ? shinobi.projects() : [] }))
tool('shinobi_setup', "Install Shinobi's engine into IV Studio's folder (about 440 MB, under a minute; nothing else on the PC changes). Ask the person first.", {}, () => shinobi.install())
tool('shinobi_tools', 'Every Shinobi tool with its parameters: media inspection, timeline authoring, beat analysis, captions, effects, 3D, rendering and review. Call them with the shinobi tool. Start with read_guide (agent, timeline, effects).', {}, () => shinobi.tools())
server.registerTool('shinobi', {
  description: "Call one Shinobi tool (see shinobi_tools) with its arguments. Projects live in IV Studio's Shinobi workspace and show on the Shinobi page. Typical flow: create_project, import_media (any IV Studio render path or file), preview_source, save_timeline (with the revision from get_project), preview_timeline, start_render, get_render. Preview pictures come back as images. Never call paid or hosted model tools without the person's OK.",
  inputSchema: { tool: z.string(), arguments: z.record(z.any()).default({}) }
}, async ({ tool: name, arguments: args }) => {
  try {
    const result = await shinobi.call(name, args)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }, ...(await picturesOf(result))] }
  } catch (err) {
    return fail(err)
  }
})
tool('shinobi_project', "A Shinobi project as IV Studio sees it: media with file paths, the saved edit's length and shape, renders with their video files, and the person's brief.", { projectId: z.string() }, ({ projectId }) => {
  const p = shinobi.project(projectId)
  const brief = path.join(p.dir, 'iv-brief.md')
  return { ...p, brief: fs.existsSync(brief) ? fs.readFileSync(brief, 'utf8') : '' }
})

const trainings = new Trainings({ dataDir: DATA, resourcesDir: resourcesDir(), studio, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe, shinobi })
// A training with each render's state; pictures and clips as file paths/URLs rather than the raw jobs.
async function trainingView(id) {
  const t = await trainings.refresh(id)
  const out = (jobId, kind) => {
    const j = t.jobs[jobId]
    const o = j?.outputs?.find((x) => x.kind === kind)
    return { jobId, status: j?.status, ...(o && { path: o.path, url: o.url }), ...(j?.error && { error: j.error }) }
  }
  return {
    id: t.id,
    name: t.name,
    trigger: t.trigger,
    who: t.who,
    faceText: t.faceText,
    consent: t.consent,
    face: t.face,
    faceCandidates: t.faceCandidates.map((c, i) => ({ index: i, seed: c.seed, ...out(c.jobId, 'image') })),
    stills: t.stills.map((s) => ({ id: s.id, source: s.source, caption: s.caption, pick: s.pick, inSet: !!s.file, candidates: s.candidates.map((c, i) => ({ index: i, ...out(c.jobId, 'image') })) })),
    clips: t.clips.map((c) => ({ id: c.id, source: c.source, caption: c.caption, keep: c.keep, file: c.file?.path || null, ...(c.jobId && { render: out(c.jobId, 'preview') }) })),
    voice: t.voice?.path || null,
    estimate: t.estimate,
    train: t.train,
    checkpoints: t.checkpoints,
    tests: t.tests.map((x) => ({ epoch: x.epoch, ...out(x.jobId, 'preview') })),
    characterId: t.characterId
  }
}
const firstOutput = async (id, jobId, kind) => {
  const t = await trainings.refresh(id)
  const o = t.jobs[jobId]?.outputs?.find((x) => x.kind === kind)
  if (!o) throw new Error('That render has not finished yet; check get_character_training.')
  return { path: o.path, url: o.url, filename: o.filename }
}
const TRAIN_HOW = 'Steps: create_character_training -> design_faces -> pick_face -> design_scenes -> pick_still (each scene) -> make_training_clips -> estimate_training -> start_training (paid, ask first) -> get_character_training until done -> test_checkpoints -> adopt_checkpoint. Look at the pictures by reading their files, and clips with grab_frame.'
tool('list_character_trainings', `Characters being designed or trained (the Characters page). ${TRAIN_HOW}`, {}, () => trainings.list())
tool('get_character_training', 'A character training: face candidates, scene stills, clips (with render status and files), the cost estimate, training progress, checkpoints and tests.', { trainingId: z.string() }, ({ trainingId }) => trainingView(trainingId))
tool('create_character_training', `Start designing a new invented character. ${TRAIN_HOW}`, {
  name: z.string().min(1),
  who: z.string().default('a woman in her thirties').describe('Kind of person, e.g. "a man in his fifties" (no face details here)')
}, (args) => trainingView(trainings.create(args).id))
tool('update_character_training', 'Change the name, trigger word (3-12 letters/numbers, made up), who, face description, consent (true only if the person confirmed their pictures/clips are of an invented person or someone who agreed), or the voice sample path.', {
  trainingId: z.string(),
  name: z.string().optional(),
  trigger: z.string().optional(),
  who: z.string().optional(),
  faceText: z.string().optional(),
  consent: z.boolean().optional(),
  voice: z.string().nullable().optional().describe('Absolute path to a clean recording of the designed voice, or null')
}, ({ trainingId, voice, ...patch }) => trainingView(trainings.save(trainingId, { ...patch, ...(voice !== undefined && { voice: voice ? { path: voice } : null }) }).id))
tool('design_faces', 'Render four face candidates on this PC (Z-Image Turbo, a few seconds each) from the face description: age, face shape, eyes, skin, hair.', { trainingId: z.string(), faceText: z.string().optional() }, ({ trainingId, faceText }) => trainings.designFaces(trainingId, { faceText }).then(() => trainingView(trainingId)))
tool('pick_face', 'Choose one face candidate (by index from get_character_training) once it has rendered.', { trainingId: z.string(), index: z.number().int().min(0) }, async ({ trainingId, index }) => {
  const c = trainings.get(trainingId).faceCandidates[index]
  if (!c) throw new Error('No face candidate with that index.')
  trainings.pickFace(trainingId, { jobId: c.jobId, file: await firstOutput(trainingId, c.jobId, 'image') })
  return trainingView(trainingId)
})
tool('design_scenes', 'Render the picked face in eight scenes (four candidates each), for the training stills. Pick the closest to the face in each; weak stills teach the LoRA a blend.', { trainingId: z.string() }, ({ trainingId }) => trainings.designScenes(trainingId).then(() => trainingView(trainingId)))
tool('pick_still', 'Keep one candidate of a scene in the training set (index), or leave the scene out (null). reroll: two more candidates instead.', {
  trainingId: z.string(),
  stillId: z.string(),
  index: z.number().int().min(0).nullable().optional(),
  reroll: z.boolean().optional()
}, async ({ trainingId, stillId, index, reroll }) => {
  if (reroll) await trainings.rerollStill(trainingId, stillId)
  else {
    const s = trainings.get(trainingId).stills.find((x) => x.id === stillId)
    if (!s) throw new Error('No still with that id.')
    trainings.pickStill(trainingId, stillId, index == null ? { pick: null } : { pick: index, file: await firstOutput(trainingId, s.candidates[index]?.jobId, 'image') })
  }
  return trainingView(trainingId)
})
tool('make_training_clips', 'Render talking clips (H3 reference-to-video from the picked face, one kept still and the voice sample, about 1.5 minutes each on this PC). lines: replace the default lines, one per clip. redo: clip ids to render again instead (new seed), for clips where the face drifts.', {
  trainingId: z.string(),
  lines: z.array(z.string()).max(TALKS.length).optional(),
  redo: z.array(z.string()).optional()
}, ({ trainingId, lines, redo }) => (redo?.length ? trainings.remakeClips(trainingId, redo) : trainings.makeClips(trainingId, { talks: lines ? lines.map((line, k) => ({ ...TALKS[k], line })) : TALKS })).then(() => trainingView(trainingId)))
tool('set_training_item', 'Edit a still or clip caption (trigger first, then clothes, place, action, framing, any line; never the face or voice), keep or drop a clip, or remove an uploaded item.', {
  trainingId: z.string(),
  kind: z.enum(['still', 'clip']),
  itemId: z.string(),
  caption: z.string().optional(),
  keep: z.boolean().optional(),
  remove: z.boolean().optional()
}, ({ trainingId, kind, itemId, caption, keep, remove }) => {
  if (remove) trainings.removeItem(trainingId, kind, itemId)
  if (caption !== undefined) trainings.setCaption(trainingId, kind, itemId, caption)
  if (keep !== undefined && kind === 'clip') trainings.keepClip(trainingId, itemId, keep)
  return trainingView(trainingId)
})
tool('add_training_files', "Add the person's own pictures or clips (needs consent: true first). Long clips are cut into 5 s pieces on the H3 frame grid when the set is built.", {
  trainingId: z.string(),
  kind: z.enum(['still', 'clip']),
  files: z.array(z.string()).min(1),
  caption: z.string().default('').describe('Clothes, place, framing; never the face')
}, ({ trainingId, kind, files, caption }) => trainingView((kind === 'still' ? trainings.addStills(trainingId, files, caption) : trainings.addClips(trainingId, files, caption)).id))
tool('estimate_training', 'Steps, minutes and dollars of a training run on Modal, before starting it.', {
  trainingId: z.string(),
  gpu: z.enum(TRAIN_GPUS.map((g) => g.id)).default('B200'),
  epochs: z.number().int().min(10).max(200).optional()
}, ({ trainingId, ...opts }) => trainings.estimateFor(trainings.get(trainingId), opts))
tool('start_training', "Train the character LoRA on the person's own Modal account (signed in on the Cloud page). This costs real money: run estimate_training, tell the person the minutes and dollars, and only call this after they say yes, passing confirm_cost with that dollar figure. Runs in the background; poll get_character_training (train.state, train.progress).", {
  trainingId: z.string(),
  gpu: z.enum(TRAIN_GPUS.map((g) => g.id)).default('B200'),
  epochs: z.number().int().min(10).max(200).optional(),
  confirm_cost: z.number().describe('The estimated dollars the person agreed to')
}, async ({ trainingId, gpu, epochs, confirm_cost }) => {
  const est = trainings.estimateFor(trainings.get(trainingId), { gpu, epochs })
  if (confirm_cost < est.dollars - 0.01) throw new Error(`The estimate is $${est.dollars}; ask the person to agree to that first.`)
  await trainings.startTraining(trainingId, { gpu, epochs })
  return trainingView(trainingId)
})
tool('stop_training', 'Stop a training run on Modal (billing stops; saved epochs stay). Ask the person first.', { trainingId: z.string() }, ({ trainingId }) => trainings.stopTraining(trainingId).then(() => trainingView(trainingId)))
tool('test_checkpoints', "After training: download the chosen epochs into ComfyUI's loras folder and render the same talking shot and seed with each, to compare by eye. Late epochs often look best.", {
  trainingId: z.string(),
  epochs: z.array(z.number().int()).min(1).max(6),
  prompt: z.string().optional().describe('Text-mode H3 prompt with {char}; default a talking close-up')
}, async ({ trainingId, epochs, prompt }) => {
  if (!trainings.get(trainingId).checkpoints.length) await trainings.listCheckpoints(trainingId)
  await trainings.fetchCheckpoints(trainingId, epochs)
  await trainings.testCheckpoints(trainingId, { epochs, prompt })
  return trainingView(trainingId)
})
tool('rank_likeness', 'Score every scene candidate and clip against the picked face with InsightFace ArcFace (0.6+ the same person, 0.4-0.6 a family resemblance, under 0.4 someone else); pick: keep the closest candidate of each scene. Needs the face models (the person downloads them on the Characters page; non-commercial licence).', {
  trainingId: z.string(),
  pick: z.boolean().default(false)
}, ({ trainingId, pick }) => trainings.rank(trainingId, { pick }))
tool('adopt_checkpoint', 'Save the chosen epoch as a character preset (strength 0.8), ready for every render.', { trainingId: z.string(), epoch: z.number().int() }, async ({ trainingId, epoch }) => trainingView((await trainings.adopt(trainingId, epoch)).id))

// ---------- Replace (OpenJutsu's workflows) ----------
const replace = new Replace({ studio, resourcesDir: resourcesDir(), dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
const REPLACE_MODES = ['person', 'people', 'people_maxq', 'object', 'mask', 'faces', 'colours']
tool('replace_check', 'What this ComfyUI still needs for a Replace mode (node packs with links, models to download on the Setup page).', { mode: z.enum(REPLACE_MODES).default('person') }, ({ mode }) => replace.check(mode))
tool('replace_video', `Swap people or objects in a video; the camera, cuts, motion and soundtrack stay. Modes: person (one picture replaces the main person; settings.role says who, optional), people (1-4 pictures, settings.roles one per picture), people_maxq (exactly 2, one pass per person, better likeness), object (settings.mode change|remove|background, settings.target what SAM tracks such as "hair", settings.changeTo what it becomes, or a picture), mask (a quick preview of what would be redrawn; run it first), faces (redraw small faces from one picture, settings.style photo|mouth), colours (settings.detail -1..1). The video needs a soundtrack. Only use invented characters or people who agreed. Returns a job: poll get_job; the result is the output with kind final.`, {
  mode: z.enum(REPLACE_MODES),
  video: z.string().describe('Absolute path of the source video (prepare_media can trim it first)'),
  pictures: z.array(z.string()).default([]).describe('Absolute paths of character or object pictures'),
  characterId: z.string().optional().describe('person mode: a character preset whose LoRA joins the run'),
  start: z.number().min(0).default(0).describe('Seconds into the video'),
  length: z.number().min(0).default(0).describe('Seconds to use; 0 = to the end'),
  settings: z.object({
    resolution: z.enum(RESOLUTIONS).optional(),
    motion: z.union([z.literal(512), z.literal(768), z.literal(1376)]).optional().describe('Motion reference size; 512 (default) fits a 24 GB card'),
    clipSeconds: z.number().min(2.5).max(15).optional(),
    seed: z.number().int().min(0).optional(),
    margin: z.enum(['tight', 'normal', 'loose']).optional(),
    hatFix: z.boolean().optional(),
    noLipSync: z.boolean().optional(),
    role: z.string().optional(),
    roles: z.array(z.string()).optional(),
    mode: z.enum(['change', 'remove', 'background']).optional(),
    target: z.string().optional(),
    changeTo: z.string().optional(),
    style: z.enum(['photo', 'mouth']).optional(),
    detail: z.number().min(-1).max(1).optional()
  }).default({})
}, ({ characterId, start, length, ...input }) => replace.run({ ...input, section: { start, length }, character: characterId ? studio.characters().find((c) => c.id === characterId) : null }))
tool('replace_history', 'Past Replace runs, newest first, with their status and result videos.', {}, async () => (await replace.history()).map((j) => ({ job: j.id, name: j.projectName, status: j.status, mode: j.plan?.replace?.mode, error: j.error, outputs: j.outputs })))

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
  visualRefmod: z.string().nullable().optional(),
  voiceId: z.string().nullable().optional().describe('A voice from list_voices: the voice speak_line uses for this character; null for none')
}, async ({ id, ...fields }) => {
  if (fields.voiceId) voices.get(fields.voiceId)
  if (fields.voiceId === null) fields.voiceDeclined = true
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
// ---------- Audio: voices and spoken lines (IV Studio's own engine: VoxCPM2 and Whisper) ----------
const voices = new Voices({ dataDir: DATA, resourcesDir: resourcesDir(), ffmpeg: edits.ffmpeg, comfy: studio.comfy })
process.on('exit', () => voices.release())
tool('voice_status', `Whether IV Studio's voice engine is set up (${VOICE_ENGINES.map((e) => `${e.label}: ${e.note}`).join(' ')} Whisper large-v3 turbo, MIT, reads the words in recordings). installed false: ask the person to press Set up voices on Audio > Voices, or run setup_voices with their OK.`, {}, () => voices.status())
tool('setup_voices', "Set up IV Studio's voice engine once: a Python environment with PyTorch and VoxCPM, plus the VoxCPM2 and Whisper models, about 12 GB of free downloads into IV Studio's data folder (roughly 5-15 minutes). Ask the person first. Returns when done.", {}, () => voices.setup())
tool('list_voices', 'Every saved voice: id, name, kind (designed, clone, ready), engine, seed, reference recording and its words, and which characters use it.', {}, async () => {
  await catalog.attachVoices().catch(() => {})
  const chars = studio.characters()
  return { items: voices.list().map((v) => ({ ...v, characters: chars.filter((c) => c.voiceId === v.id).map((c) => c.id) })) }
})
tool('design_voice', 'Make 1-4 candidate voices from a description (VoxCPM2 voice design, about 25 s each). Returns their files: listen or let the person listen, then save one with create_voice (kind designed, same seed and description). Only invented voices.', {
  description: z.string().min(10).describe('Age, accent, pitch, manner, recording: e.g. "A man in his sixties from Cork, gravelly and slow, close and natural"'),
  text: z.string().optional().describe('What the candidates say (optional)'),
  seed: z.number().int().default(1),
  count: z.number().int().min(1).max(4).default(3)
}, async (a) => ({ items: await voices.design(a) }))
tool('create_voice', 'Save a voice from a recording: a design_voice candidate (kind designed) or a recording of one person talking (kind clone; only their own voice, an invented one, or someone who agreed: set consent true only when the person has confirmed that). The first 20 s become the reference; text is its words (read by Whisper when left out).', {
  name: z.string().min(1),
  file: z.string().describe('A local wav, mp3, flac, m4a or ogg'),
  kind: z.enum(['designed', 'clone']).default('designed'),
  text: z.string().optional(),
  description: z.string().optional(),
  seed: z.number().int().nullable().optional(),
  consent: z.boolean().default(false)
}, (a) => voices.create(a))
tool('update_voice', 'Rename a voice or change its default seed, words or description.', { id: z.string(), name: z.string().optional(), seed: z.number().int().nullable().optional(), text: z.string().optional(), description: z.string().optional() }, ({ id, ...patch }) => voices.update(id, patch))
tool('delete_voice', 'Delete a voice and the lines spoken in it; characters using it lose their voice. Ask the person first.', { id: z.string() }, ({ id }) => {
  const r = voices.delete(id)
  studio.saveCharacters(studio.characters().map((c) => (c.voiceId === id ? { ...c, voiceId: null } : c)))
  return r
})
tool('speak_line', `Say a line in a voice (or a character's voice) and get a WAV: use it as voiceLine in generate_previews so H3 lip-syncs to it, with the same words inside the prompt's <d>[English] …</d>. About 5 s a line once the engine is warm (the first after a pause loads the model, about 25 s); the same words, voice and seed come back from the cache.`, {
  text: z.string().min(1).max(600),
  voiceId: z.string().optional(),
  character: z.string().optional().describe('A character id with a voice (save_character voiceId); used when voiceId is left out'),
  seed: z.number().int().optional()
}, ({ text, voiceId, character, seed }) => {
  const id = voiceId || studio.characters().find((c) => c.id === character)?.voiceId
  if (!id) throw new Error(character ? `${character} has no voice yet: give them one with save_character voiceId.` : 'Give voiceId or character.')
  return voices.speak({ voiceId: id, text, seed })
})
tool('list_lines', 'Lines spoken so far, newest first (optionally for one voice): text, file, duration, seed.', { voiceId: z.string().optional() }, ({ voiceId }) => ({ items: voices.lines(voiceId) }))
tool('delete_line', 'Delete a spoken line and its file.', { id: z.string() }, ({ id }) => voices.deleteLine(id))
tool('release_voice_engine', 'Stop the voice engine so its GPU memory goes back to ComfyUI (IV Studio also does this before a render, and ten minutes after the last line).', {}, async () => (await voices.release(), { released: true }))

// ---------- Audio: music (MiniMax Music 3 and ACE-Step 1.5 on this PC's ComfyUI) ----------
const music = new Music({ studio, dataDir: DATA, probe: (f) => edits.probe(f) })
tool('music_status', `Whether this PC's ComfyUI can make music, per engine: ${MUSIC_ENGINES.map((e) => `${e.id} = ${e.label} (${e.note}; ${e.licence})`).join(' ')} Lists missing models; the person downloads them on Audio > Music.`, {}, () => music.status())
tool('make_music', 'Make a song or an instrumental on this PC (free, local). Returns the song at once; follow with get_music until status is success, then use its file: add_media (files) puts it on an edit, generate_previews voiceLine makes a character sing to it (trim it with prepare_media first). MiniMax takes a few minutes per song; ACE-Step seconds.', {
  engine: z.enum(MUSIC_ENGINES.map((e) => e.id)).default(MUSIC_DEFAULTS.engine),
  caption: z.string().describe('The style: genre, mood, instruments, the voice and how it sings, tempo, how the song builds.'),
  lyrics: z.string().optional().describe('Lyrics with section tags on their own lines: [Intro], [Verse], [Chorus], [Bridge], [Instrumental], [Outro]. Leave out for an instrumental.'),
  instrumental: z.boolean().default(false),
  seconds: z.number().min(5).max(600).default(MUSIC_DEFAULTS.seconds).describe('minimax: up to 300, a limit; it sets the length from the lyrics (two short sections give about 15 s). ace: up to 600, exact.'),
  name: z.string().optional(),
  seed: z.number().int().min(0).optional(),
  bpm: z.number().int().min(30).max(300).optional().describe('ace only'),
  key: z.enum(ACE_KEYS).optional().describe('ace only, e.g. "E minor"'),
  timesignature: z.enum(['2', '3', '4', '6']).optional().describe('ace only: beats per bar'),
  language: z.string().optional().describe('ace only: lyrics language code, e.g. en, es, ja')
}, async (args) => (readSettings(DATA).target === 'cloud' || (await voices.release()), music.create(Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)))))
tool('list_music', 'Every song made in IV Studio, newest first, with status, file (once finished), length, engine, style, lyrics and seed.', {}, () => music.list())
tool('get_music', 'One song, brought up to date: status (queued, running, success, error), progress, and its file once finished.', { songId: z.string() }, ({ songId }) => music.get(songId))
tool('cancel_music', 'Stop a song that is still being made. Never touches other ComfyUI work.', { songId: z.string() }, ({ songId }) => music.cancel(songId))
tool('rename_music', 'Rename a song.', { songId: z.string(), name: z.string().min(1) }, ({ songId, name }) => music.rename(songId, name))
tool('delete_music', "Delete a song and its file in IV Studio's music folder (ComfyUI's own output copy stays). Ask the person first.", { songId: z.string() }, ({ songId }) => music.delete(songId))

const catalog = new CharacterCatalog({ studio, voices, resourcesDir: resourcesDir() })
tool('list_ready_characters', "IV Studio's ready-made characters (Tess, Theo…): who they are, their face picture's path, and whether they're downloaded and usable.", {}, () => catalog.list())
tool('install_ready_character', 'Download a ready-made character (its LoRA, about 150 MB, into ComfyUI) and add it as a character preset.', { id: z.string() }, async ({ id }) => (await catalog.install(id)).find((c) => c.id === id))
tool('delete_character', 'Remove a character preset (the LoRA file stays). Ask the person first.', { id: z.string() }, ({ id }) => {
  const list = studio.characters()
  if (!list.some((c) => c.id === id)) throw new Error(`No character ${id}.`)
  return studio.saveCharacters(list.filter((c) => c.id !== id))
})

server.connect(new StdioServerTransport()).catch((err) => {
  console.error('IV Studio MCP server failed to start:', err)
  process.exit(1)
})
