// Local prompt writer check: one Create prompt and a two-shot story, through the studio service.
// Uses the Ollama writer model from settings (qwen3-vl:8b-instruct by default). Free; no ComfyUI job.
//   node test/prompt-writer.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Studio } from '../src/service/studio.js'

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-writer-'))
const studio = new Studio({ dataDir, resourcesDir: 'resources', comfyUrl: process.env.COMFY_URL || 'http://127.0.0.1:8188' })
const check = (cond, msg) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`ok - ${msg}`)
}

console.log('GPU busy, writer on CPU:', await studio.gpuBusy())
let t0 = Date.now()
const prompt = await studio.writePrompt({ idea: '{char} sits in a parked car at night in the rain and admits to a friend in the passenger seat that she kept the letter and never opened it', character: 'tess', mode: 'text', seconds: 10, aspect: '16:9' }, { engine: 'local' })
console.log(`--- prompt (${Math.round((Date.now() - t0) / 1000)} s) ---\n${prompt}\n---`)
check(/integrated_multimodal_description:/.test(prompt) && /overall_soundscape:/.test(prompt) && /non_diegetic_music:/.test(prompt), 'three H3 fields')
check(/\{char\}/.test(prompt) && !/\bTess\b/.test(prompt), 'character written as {char}')
check(/<d>\[English\][^<]+<\/d>/.test(prompt), 'dialogue in <d>[English] …</d>')

t0 = Date.now()
const shots = await studio.writeStory({ story: '{char} waits at a bus stop at dawn, reads a text message, laughs, and decides to walk home instead.', shots: 2, seconds: 10, character: 'tess' })
console.log(`--- story (${Math.round((Date.now() - t0) / 1000)} s) ---`)
shots.forEach((s, i) => console.log(`[shot ${i + 1}]\n${s}\n`))
check(shots.length === 2, 'two shots')
check(shots.every((s) => /\{char\}/.test(s)), 'every shot uses {char}')
fs.rmSync(dataDir, { recursive: true, force: true })
