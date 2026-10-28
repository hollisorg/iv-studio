// Renders the sequence graphs on a live ComfyUI: a two-shot take of Tess, a retake of 3 s of it, and a
// render-out with colour smoothing. Small (0.4 MP) so it finishes in minutes.
//   node test/sequence-graphs.mjs [take|retake|renderout] [source.mp4]
import fs from 'node:fs'
import { Comfy } from '../src/service/comfy.js'
import { checkPrompt } from '../src/service/graph.js'
import { renderOutGraph, retakeGraph, takeGraph } from '../src/service/sequence.js'

const comfy = new Comfy(process.env.COMFY_URL || 'http://127.0.0.1:8188', 'iv-studio-seqtest')
const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const tess = { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8, trigger: 't3ss4' }
const place = 'A static camera frames {char} from the chest up at a small kitchen table by a rain-streaked window at dusk, one warm lamp overhead, a white mug in front of her. Live-action, shallow depth of field.'
const seq = {
  aspect: '16:9',
  megapixels: 0.4,
  shotSeconds: 10,
  steps: 8,
  seed: 777,
  shots: [
    { prompt: `${place} {char} wraps both hands around the mug, looks up at someone across the table and says: <d>[English] I kept the letter. I never opened it.</d> She settles back, lips closed, holding the mug.` },
    { prompt: `${place} {char} sits exactly as she was, holding the mug, lips closed. For the first two seconds she only breathes and glances at the window, then she says: <d>[English] Maybe tonight's the night I finally read it.</d> She sets the mug down and rests her hands on the table.` }
  ]
}
const name = `seqtest_${Date.now().toString(36)}`

async function run(graph, label) {
  const problems = checkPrompt(graph)
  if (problems.length) throw new Error(problems.join('; '))
  const id = await comfy.submit(graph, {})
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000))
    const h = (await comfy.history(id))[id]
    if (!h) continue
    const err = h.status?.messages?.find((m) => m[0] === 'execution_error')
    if (err) throw new Error(`${label}: ${err[1].node_type}: ${err[1].exception_message}`)
    console.log(`${label}: ${Math.round((Date.now() - t0) / 1000)} s`)
    return h.outputs
  }
}
const videoPath = (o) => o?.gifs?.find((f) => /-audio\.mp4$/.test(f.filename))?.fullpath || o?.gifs?.find((f) => /\.mp4$/.test(f.filename))?.fullpath

const step = process.argv[2] || 'take'
let source = process.argv[3]
if (step === 'take') {
  const { graph, resolved } = takeGraph({ template, seq, character: tess, name })
  console.log('take', resolved)
  source = videoPath((await run(graph, 'take')).save)
  console.log('master', source)
}
if (step === 'retake' || step === 'take') {
  const { graph } = retakeGraph({ template, seq, character: tess, name, sourcePath: source, prompt: `${place} {char} laughs softly and shakes her head.`, start: 12, end: 15, mode: 'video', seed: 5 })
  console.log('retake', videoPath((await run(graph, 'retake')).save))
}
if (step === 'renderout' || step === 'take') {
  const { graph } = renderOutGraph({ template, name, sourcePath: source, normalize: true, scale: 1, fps: 0 })
  console.log('renderout', (await run(graph, 'renderout')).final?.text?.[0])
}
