// End-to-end through the service (no UI): setup check, plan, previews, finish, outputs.
//   node test/service-e2e.mjs [dataDir]
import fs from 'node:fs'
import path from 'node:path'
import { Studio } from '../src/service/studio.js'

const dataDir = process.argv[2] || path.resolve('test/.data')
fs.mkdirSync(dataDir, { recursive: true })
const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: 'http://127.0.0.1:8188' })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const setup = await studio.checkSetup()
log('setup ready:', setup.ready, '|', setup.items.filter((i) => i.status !== 'ok').map((i) => `${i.label}: ${i.status} (${i.detail})`).join('; ') || 'all ok', '| refmods:', setup.refmods.length)

const request = {
  mode: 'text',
  character: 'tess',
  prompt:
    'integrated_multimodal_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture: no signs, no labels, no captions. A medium close-up of {char}, a woman wearing a grey hoodie, in a bright kitchen in the morning. {char} (S1) lifts a mug to the camera and says: <d>[English] Morning. Coffee first.</d>\n\noverall_soundscape: Kitchen room tone, a kettle clicking off. Her voice is close and natural.\n\nnon_diegetic_music: N/A',
  seconds: 3,
  aspect: '9:16',
  megapixels: 0.4,
  previews: 2,
  seed: 777
}
log('plan:', JSON.stringify(studio.planRender(request, { megapixels: 1.0 })))

async function wait(job) {
  let last = ''
  for (;;) {
    const j = await studio.refreshJob(job.id)
    const s = `${j.status}${j.progress ? ` ${j.progress.value}/${j.progress.max}` : ''}${j.queuePosition ? ` #${j.queuePosition}` : ''}`
    if (s !== last) log(job.kind, s)
    last = s
    if (['success', 'error', 'cancelled'].includes(j.status)) return j
    await new Promise((r) => setTimeout(r, 5000))
  }
}

const stop = studio.watch()
const previews = await wait(await studio.generatePreviews({ projectName: 'Service test', ...request }))
log('previews:', previews.status, previews.seconds + 's', previews.error || '', previews.outputs.map((o) => `${o.kind}#${o.candidate} ${o.filename}`).join(', '))
if (previews.status !== 'success') process.exit(1)
// Wipe ComfyUI's RAM cache so the finish has to come from IV Latent Cache on disk.
await studio.comfy.req('/free', { method: 'POST', json: { unload_models: false, free_memory: true } })
const finish = await wait(await studio.finishCandidate({ jobId: previews.id, candidate: 2, megapixels: 1.0 }))
log('finish:', finish.status, finish.seconds + 's', finish.error || '', JSON.stringify(finish.plan.resolved), finish.outputs.map((o) => `${o.kind} ${o.path || o.filename}`).join(' | '))
stop()
fs.writeFileSync(path.join(dataDir, 'e2e-result.json'), JSON.stringify({ previews, finish }, null, 2))
process.exit(finish.status === 'success' ? 0 : 1)
