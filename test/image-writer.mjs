// Write it for me on the Images page (service/imagewriter.js): every picture model has its own guide, the writer gets
// it, edits name the pictures the model's own way, LoRA trigger words stay, and only the models that use a negative
// prompt get one written.
//   node test/image-writer.mjs
import fs from 'node:fs'
import path from 'node:path'

import { CODEX_FAMILY, IMAGE_FAMILIES } from '../src/service/images.js'
import { GUIDED, NEGATIVE_FAMILIES, cleanImagePrompt, guideFile, imageSystem, loadImageGuide, refName, schemaFor, sdxlStyle, writeImagePrompt } from '../src/service/imagewriter.js'

let failed = 0
const check = (cond, msg) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}`)
  if (!cond) failed++
}
const resources = path.resolve('resources')
const ids = [...IMAGE_FAMILIES.map((f) => f.id), CODEX_FAMILY.id]
check(ids.every((id) => GUIDED.includes(id)) && GUIDED.every((id) => ids.includes(id)), `a guide for every picture family (${ids.join(', ')})`)
for (const id of GUIDED) {
  const file = path.join(resources, 'guides', 'images', guideFile(id))
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  check(!!raw, `${id}: ${guideFile(id)} is there`)
  if (!raw) continue
  check(/^# .+/m.test(raw) && /^Source: /m.test(raw), `${id}: a title and its sources`)
  for (const h of ['## How it reads a prompt', '## Writing a new picture', '## Writing an edit', '## Words in the picture', '## Negative prompt', '## Avoid']) check(raw.includes(h), `${id}: has "${h}"`)
  check(!/[—–]/.test(raw), `${id}: no em or en dashes`)
  check(raw.length < 9000, `${id}: short enough for a small local writer (${raw.length} characters)`)
  const g = loadImageGuide(resources, id)
  check(!/^Source:/m.test(g) && g.includes('## Writing a new picture'), `${id}: the writer gets the guide without the sources line`)
}
let threw = false
try {
  loadImageGuide(resources, 'nope')
} catch {
  threw = true
}
check(threw, 'an unknown family has no guide')

check(sdxlStyle('ponyDiffusionV6XL.safetensors') === 'pony' && sdxlStyle('illustriousXL_v01.safetensors') === 'illustrious' && sdxlStyle('noobaiXLNAIXL_vPred10.safetensors') === 'illustrious' && sdxlStyle('juggernautXL_v9.safetensors') === 'plain', 'SDXL fine-tunes: Pony, Illustrious/NoobAI or plain')
check(refName('h3image', 2) === '<Picture 2>' && refName('qwen21', 2) === '<image2>' && refName('flux3', 1) === 'image 1', 'edits name the pictures the model’s own way')
check(imageSystem({ family: 'qwen21', mode: 'edit', refs: 1, guide: 'g' }).includes('"the image", with no number or tag') && imageSystem({ family: 'qwen21', mode: 'edit', refs: 2, guide: 'g' }).includes('<image1>, <image2>'), 'Qwen: one picture is just "the image"; two are <image1>, <image2>')

const guide = loadImageGuide(resources, 'krea2')
const sys = imageSystem({ family: 'krea2', model: 'krea2/krea2_turbo.safetensors', guide, triggers: ['t3ss4'] })
check(sys.includes('Krea 2') && sys.includes(guide) && sys.includes('krea2_turbo.safetensors'), 'Krea 2: the writer gets its whole guide and the checkpoint')
check(sys.includes('t3ss4') && /trigger words/.test(sys), 'LoRA trigger words are passed on')
check(sys.includes('NEW picture') && !sys.includes('EDIT'), 'a new picture is not written as an edit')
const editSys = imageSystem({ family: 'h3image', mode: 'edit', refs: 2, guide: loadImageGuide(resources, 'h3image') })
check(editSys.includes('EDIT of 2 pictures') && editSys.includes('<Picture 1>, <Picture 2>'), 'an H3 Image edit names <Picture 1>, <Picture 2>')
check(imageSystem({ family: 'sdxl', model: 'ponyDiffusionV6XL', guide: loadImageGuide(resources, 'sdxl') }).includes('Pony'), 'a Pony checkpoint gets the Pony conventions')

check(JSON.stringify(Object.keys(schemaFor('sdxl').properties)) === '["prompt","negative"]' && JSON.stringify(Object.keys(schemaFor('krea2').properties)) === '["prompt"]', 'a negative prompt only for models that use one')
check(NEGATIVE_FAMILIES.every((id) => !IMAGE_FAMILIES.find((f) => f.id === id)?.noNegative), 'every model that gets a negative shows the negative box')

check(cleanImagePrompt('Prompt: "A red fox on ice"') === 'A red fox on ice', 'a label and wrapping quotes come off')
check(cleanImagePrompt('A poster with "NIGHT SIGNAL" on top') === 'A poster with "NIGHT SIGNAL" on top', 'quoted words inside stay')
check(cleanImagePrompt('woman at a bus stop', ['t3ss4']) === 't3ss4, woman at a bus stop', 'a trigger word the writer dropped goes back at the start')
check(cleanImagePrompt('t3ss4 woman at a bus stop', ['t3ss4']) === 't3ss4 woman at a bus stop', 'a kept trigger word is not doubled')
check(cleanImagePrompt('<think>hmm</think>```\nA lighthouse\n```') === 'A lighthouse', 'thinking and fences come off')

let empty = null
try {
  await writeImagePrompt({ writer: { engine: 'local' }, family: 'krea2', idea: '  ', resourcesDir: resources })
} catch (err) {
  empty = err.message
}
check(empty === 'Describe the picture first.', 'no idea and no prompt: asks for one, writes nothing')

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
