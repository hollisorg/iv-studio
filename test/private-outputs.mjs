// Render folders (Settings -> Folders): outputsUnder points every saved file of IV Studio's graphs into a
// folder inside ComfyUI's output, once, and leaves everything else alone. Also cleanFolder's rules.   node test/private-outputs.mjs
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { cleanFolder, outputsUnder, PRIVATE_FOLDER } from '../src/service/paths.js'
import { aceGraph } from '../src/service/music.js'

const load = (f) => JSON.parse(fs.readFileSync(new URL(`../resources/workflows/${f}`, import.meta.url), 'utf8'))
const saves = (g) => Object.entries(g).flatMap(([id, n]) => {
  const out = []
  const fp = n.inputs?.filename_prefix
  if (typeof fp === 'string') out.push([id, fp])
  if (Array.isArray(fp) && g[fp[0]]?.class_type === 'StringConcatenate') out.push([id, g[fp[0]].inputs.string_a])
  if (typeof n.inputs?.['Output Directory'] === 'string') out.push([id, n.inputs['Output Directory']])
  return out
})
let checked = 0
for (const [name, g] of [['H3 shot graph', load('iv_studio_api.json')], ['music (ACE)', aceGraph({ ckpt: 'x', tags: 'y', lyrics: '', seconds: 10, seed: 1, bpm: 90, key: 'C major', timesignature: '4', language: 'en', prefix: 'iv_studio/music/song_1' })], ['Replace mask', load('replace/mask.api.json')]]) {
  const before = JSON.stringify(g)
  const n = saves(g).length
  assert.ok(n > 0, `${name}: has saves`)
  outputsUnder(g, PRIVATE_FOLDER)
  for (const [id, v] of saves(g)) assert.ok(v.startsWith(`${PRIVATE_FOLDER}/`), `${name} #${id}: ${v}`)
  const once = JSON.stringify(g)
  outputsUnder(g, PRIVATE_FOLDER)
  assert.equal(JSON.stringify(g), once, `${name}: applying twice changes nothing`)
  // only the save paths changed
  const strip = (s) => s.replaceAll(`${PRIVATE_FOLDER}/`, '')
  assert.equal(strip(once), before, `${name}: nothing else changed`)
  console.log(`ok  ${name}: ${n} saves now in ${PRIVATE_FOLDER}/`)
  checked += n
}
// no folder: untouched
const plain = load('iv_studio_api.json')
assert.equal(JSON.stringify(outputsUnder(structuredClone(plain), '')), JSON.stringify(plain), 'no folder changes nothing')
// folder names stay inside ComfyUI's folders
for (const [given, want] of [['IV Private', 'IV Private'], ['Studio\\Private', 'Studio/Private'], ['../../Windows', 'Windows'], ['C:\\Users\\x', 'C/Users/x'], ['  /a//b/ ', 'a/b'], ['..', ''], ['bad<>|?*name', 'badname']])
  assert.equal(cleanFolder(given), want, `cleanFolder(${given})`)
console.log(`${checked} saves checked; folder names cleaned`)
