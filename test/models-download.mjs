// Downloader check against a live ComfyUI with a 4 MB public Hugging Face file: a fresh download,
// a resume from a partial .part, and a corrupted .part that must fail its checksum and be removed.
// Writes into <ComfyUI>/models/vae/IV Studio test/ and removes that folder afterwards.
import fs from 'node:fs'
import path from 'node:path'
import { Comfy } from '../src/service/comfy.js'
import { ModelInstaller, modelTarget } from '../src/service/models.js'

const comfy = new Comfy(process.env.COMFY_URL || 'http://127.0.0.1:8188', 'iv-studio-test')
const model = {
  id: 'tiny',
  label: 'tiny test file',
  folder: 'vae/IV Studio test',
  match: 'tiny_test.safetensors',
  url: 'https://huggingface.co/hf-internal-testing/tiny-random-LlamaForCausalLM/resolve/main/model.safetensors'
}
const target = await modelTarget(comfy, model)
const dir = path.dirname(target)
if (fs.existsSync(dir)) throw new Error(`${dir} already exists; refusing to touch it.`)

const run = () =>
  new Promise((resolve) => {
    const inst = new ModelInstaller({ comfy, manifest: { models: [model] }, onUpdate: (u) => ['done', 'error'].includes(u.status) && resolve(u) })
    inst.enqueue(['tiny'])
  })
const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok - ${msg}`)
}

try {
  let r = await run()
  check(r.status === 'done' && r.verified && fs.statSync(target).size === 4131280, 'fresh download verified')
  const good = fs.readFileSync(target)

  fs.rmSync(target)
  fs.writeFileSync(`${target}.part`, good.subarray(0, 1_000_000))
  r = await run()
  check(r.status === 'done' && r.verified && fs.readFileSync(target).equals(good), 'resumed from a 1 MB .part')

  fs.rmSync(target)
  const bad = Buffer.from(good.subarray(0, 1_000_000))
  bad[500] ^= 0xff
  fs.writeFileSync(`${target}.part`, bad)
  r = await run()
  check(r.status === 'error' && !fs.existsSync(target) && !fs.existsSync(`${target}.part`), `corrupt .part rejected: ${r.error}`)
} finally {
  fs.rmSync(dir, { recursive: true, force: true })
}
