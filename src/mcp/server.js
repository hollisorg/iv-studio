// IV Studio MCP server (stdio). Same service, data folder and job records as the studio window, so an agent
// and a person see the same projects and results. Run with the app's own binary:
//   ELECTRON_RUN_AS_NODE=1 "IV Studio.exe" <resources>/app.asar/out/main/mcp.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { dataDir, readSettings, resourcesDir } from '../service/paths'
import { ASPECTS, FRAME_GEN_FPS, MODES } from '../service/plan'
import { Studio } from '../service/studio'

const DATA = dataDir()
const studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(), comfyUrl: readSettings(DATA).comfyUrl })
const server = new McpServer({ name: 'iv-studio', version: '0.1.0' })

const ok = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value })
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

server.connect(new StdioServerTransport()).catch((err) => {
  console.error('IV Studio MCP server failed to start:', err)
  process.exit(1)
})
