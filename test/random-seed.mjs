// Video seeds are random unless one is given (Matthew, 2026-11-23: "we need the seed to be random for videos also").
// Before 1.1.26 every video run started from seed 4242 (Create's form, the plan's default, the MCP tool's default).
//   node test/random-seed.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { newSeed, withSeed } from '../src/service/studio.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok', name))
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

ok('a run with no seed gets a new one each time; a given seed is kept', () => {
  const seeds = new Set(Array.from({ length: 50 }, () => withSeed({ prompt: 'x' }).seed))
  assert.ok(seeds.size > 45, 'fifty runs, (nearly) fifty seeds')
  for (const s of seeds) assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 31)
  assert.equal(typeof withSeed({ seed: '' }).seed, 'number', 'an empty seed is a new one')
  assert.equal(withSeed({ seed: 0 }).seed, 0, '0 is a seed like any other')
  assert.equal(withSeed({ seed: 4242 }).seed, 4242, 'a seed asked for is used')
  assert.ok(Number.isInteger(newSeed()))
})

ok('every video path picks one: H3, LTX and Seedance runs, new sequences and retakes', () => {
  const studio = src('../src/service/studio.js')
  assert.match(studio, /const asked = withSeed\(applySpeed\(withPreviewSize\(given/)
  assert.match(studio, /async seedancePreviews\(input\) \{\s*const \{ projectId, projectName, spend, \.\.\.given \} = input\s*const asked = withSeed\(given\)/)
  assert.match(studio, /async ltxPreviews\(input\) \{\s*const \{ projectId, projectName, \.\.\.given \} = input\s*const asked = withSeed\(given\)/)
  assert.match(studio, /\{ \.\.\.SEQUENCE_DEFAULTS, seed: newSeed\(\),/)
  assert.match(studio, /seed: seed \?\? newSeed\(\), unet: this\.models\.retake/)
  assert.match(src('../src/mcp/server.js'), /seed: z\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)\.describe\('Previews use seed/)
})

ok('Create and Images: Seed is a choice, Random each time or Fixed, says so, and old 4242 setups go random', () => {
  const create = src('../src/renderer/src/components/Create.jsx')
  assert.match(create, /seed: '', \/\/ '' is a new seed every run/)
  assert.match(create, /<SeedPick seed=\{form\.seed\} max=\{1e9\} onChange=\{\(seed\) => set\(\{ seed \}\)\} \/>/)
  assert.match(create, /seed: r\.seed === '' \|\| r\.seed == null \? undefined : r\.seed/)
  assert.match(create, /\.\.\.\(saved\.seed === 4242 \? \{ seed: '' \} : \{\}\)/)
  assert.match(create, /form\.seed === '' \? 'random seed' : `seed \$\{form\.seed\}`/)
  const kit = src('../src/renderer/src/components/CreateKit.jsx')
  for (const w of ['Random each time', 'Fixed', 'role="radiogroup"', 'This seed every run', 'A new seed every run']) assert.ok(kit.includes(w), `the seed choice says ${w}`)
  assert.match(kit, /onClick=\{\(\) => onChange\(''\)\}/, 'Random each time empties the seed')
  assert.match(kit, /onChange\(lastSeed \?\? roll\(\)\)/, 'Fixed starts from the last seed, or a new one')
  const images = src('../src/renderer/src/components/Images.jsx')
  assert.match(images, /<SeedPick seed=\{form\.seed\} lastSeed=/, 'Images has the same choice, starting from its last picture’s seed')
})

console.log(`\n${n} of 3 passed`)
