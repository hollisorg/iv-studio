// ChatGPT Images through Codex (src/service/codeximages.js), with a stand-in Codex: what Codex is asked, its event
// stream read, the picture collected from <Codex home>/generated_images/<run>/, and a refusal or usage limit turned
// into a plain error. Runs anywhere (no Codex account needed).
//   node test/codex-images.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { codexImage, codexImagePrompt, codexImageStatus, readCodexEvents, runPictures } from '../src/service/codeximages.js'
import { CODEX_FAMILY, codexFamilyStatus } from '../src/service/images.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-codex-images-'))
const home = path.join(tmp, 'codex-home')
fs.mkdirSync(home, { recursive: true })
// a tiny valid PNG (1x1)
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')

// A stand-in Codex: reads the prompt on stdin, prints Codex's events, and (unless told to fail) saves a picture into
// <CODEX_HOME>/generated_images/<run id>/ like Codex does. It records its arguments and the prompt.
const script = path.join(tmp, 'fake-codex.mjs')
fs.writeFileSync(
  script,
  `import fs from 'node:fs'; import path from 'node:path'
let input = ''; process.stdin.on('data', (d) => (input += d)); process.stdin.on('end', () => {
  fs.writeFileSync(path.join(${JSON.stringify(tmp)}, 'last.json'), JSON.stringify({ args: process.argv.slice(2), input }))
  const id = 'run-' + Date.now()
  const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
  say({ type: 'thread.started', thread_id: id })
  if (/LIMIT/.test(input)) { say({ type: 'turn.failed', error: { message: "You've hit your usage limit." } }); process.exit(1) }
  if (/REFUSE/.test(input)) { say({ type: 'item.completed', item: { type: 'agent_message', text: 'I can’t make that picture.' } }); process.exit(0) }
  const dir = path.join(process.env.CODEX_HOME, 'generated_images', id); fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'exec-1.png'), Buffer.from(${JSON.stringify(PNG.toString('hex'))}, 'hex'))
  say({ type: 'item.completed', item: { type: 'agent_message', text: 'Done.' } }); say({ type: 'turn.completed' })
})`
)
let exe
if (process.platform === 'win32') {
  exe = path.join(tmp, 'codex.cmd')
  fs.writeFileSync(exe, `@"${process.execPath}" "${script}" %*\r\n`)
} else {
  exe = path.join(tmp, 'codex')
  fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  fs.chmodSync(exe, 0o755)
}
const last = () => JSON.parse(fs.readFileSync(path.join(tmp, 'last.json'), 'utf8'))

await ok('the prompt asks for exactly one picture, in the shape asked for, and nothing else', () => {
  const g = codexImagePrompt({ prompt: 'a fox in snow', aspect: '16:9' })
  assert.match(g, /exactly ONE image, wide landscape \(16:9\)/)
  assert.match(g, /The image: a fox in snow/)
  assert.match(g, /Don't run commands/)
  const e = codexImagePrompt({ mode: 'edit', prompt: 'make it night', refs: 2 })
  assert.match(e, /edit the 2 attached pictures \(picture 1 is the one to change/)
  assert.match(e, /Keep everything the change doesn't mention/)
})

await ok('Codex’s event stream: its run id, what it said, and failures', () => {
  const ev = readCodexEvents(['{"type":"thread.started","thread_id":"abc"}', 'not json', '{"type":"item.completed","item":{"type":"agent_message","text":" hi "}}', '{"type":"turn.failed","error":{"message":"limit"}}', '{"type":"error","message":"boom"}'].join('\n'))
  assert.deepEqual(ev, { thread: 'abc', said: ['hi'], errors: ['limit', 'boom'] })
  assert.deepEqual(runPictures('nope', home), [])
})

await ok('a picture: Codex runs read-only without the person’s config, and the picture comes from its folder', async () => {
  const ref = path.join(tmp, 'ref.png')
  fs.writeFileSync(ref, PNG)
  const pic = await codexImage({ mode: 'edit', prompt: 'make it night', refs: [ref], exe, home, model: 'gpt-test' })
  assert.ok(fs.existsSync(pic) && pic.startsWith(path.join(home, 'generated_images')))
  const { args, input } = last()
  for (const a of ['exec', '--ephemeral', '--ignore-user-config', '--json']) assert.ok(args.includes(a), a)
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only')
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-test')
  // the prompt comes on stdin ("-"), before -i, which takes every path after it
  assert.ok(args.indexOf('-') < args.indexOf('-i'))
  assert.equal(args[args.indexOf('-i') + 1], ref)
  assert.match(input, /make it night/)
})

await ok('a usage limit or a refusal comes back as what Codex said', async () => {
  await assert.rejects(codexImage({ prompt: 'LIMIT', exe, home }), /ChatGPT made no picture: You've hit your usage limit/)
  await assert.rejects(codexImage({ prompt: 'REFUSE', exe, home }), /ChatGPT made no picture: I can’t make that picture/)
})

await ok('ready only with Codex installed and signed in; the family takes four pictures and has no LoRAs or seed', () => {
  const none = codexImageStatus({ LOCALAPPDATA: path.join(tmp, 'nothing'), APPDATA: path.join(tmp, 'nothing'), PATH: '', CODEX_HOME: home }, tmp, process.platform)
  assert.equal(none.ready, false)
  assert.ok(none.missing[0].startsWith('Codex'))
  const fam = codexFamilyStatus({ ready: false, missing: ['x'] })
  assert.equal(fam.ready, false)
  assert.deepEqual(fam.models, [])
  const on = codexFamilyStatus({ ready: true, missing: [] })
  assert.equal(on.edit, true)
  assert.equal(on.maxRefs, 4)
  assert.equal(on.loraPattern, null)
  assert.equal(CODEX_FAMILY.id, 'chatgpt')
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${n} checks passed`)
