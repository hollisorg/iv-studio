// MCP voices test: voice tools over stdio on a temporary data folder, against the VoiceStudio running on
// this PC (it speaks two short lines and designs one voice; about a minute on a 4090).
//   node test/mcp-voices.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-voices-'))
let failures = 0
const transport = new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: temp } })
const c = new Client({ name: 'voices-test', version: '1' })
await c.connect(transport)
const call = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args })
  return { error: r.isError ? r.content[0].text : null, value: r.structuredContent }
}
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}

const st = await call('voice_status')
expect('voice_status', !st.error && st.value.running && st.value.engines.every((e) => e.available), JSON.stringify(st.value?.engines.map((e) => [e.id, e.available])))
if (!st.value?.running) process.exit(1)

// a fresh data folder has Tess as a preset: her bundled voice joins and becomes hers
const vs = await call('list_voices')
const tessVoice = vs.value?.items.find((v) => v.catalogId === 'tess')
expect('list_voices attaches the ready-made voice', !!tessVoice && tessVoice.characters.includes('tess') && tessVoice.text.length > 20, tessVoice && `${tessVoice.name}, ${tessVoice.duration}s`)

const t0 = Date.now()
const line = await call('speak_line', { character: 'tess', text: 'Right. So the kiln is on fire. Again.' })
expect('speak_line by character', !line.error && fs.existsSync(line.value.file) && line.value.duration > 1, line.error || `${line.value.duration}s in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
const again = await call('speak_line', { character: 'tess', text: 'Right. So the kiln is on fire. Again.' })
expect('speak_line cache', again.value?.file === line.value?.file)
const other = await call('speak_line', { character: 'tess', text: 'Right. So the kiln is on fire. Again.', seed: 7 })
expect('speak_line new seed, new read', !other.error && other.value.file !== line.value.file)
const none = await call('speak_line', { character: 'nobody', text: 'Hi' })
expect('speak_line without a voice -> error', !!none.error, none.error)

const d = await call('design_voice', { description: 'A man in his sixties from Cork, gravelly, slow and kind, close and natural', count: 1, seed: 3 })
expect('design_voice', !d.error && d.value.items.length === 1 && fs.existsSync(d.value.items[0].file), d.error || `${d.value.items[0].duration}s`)
const noConsent = await call('create_voice', { name: 'Clone', file: d.value.items[0].file, kind: 'clone' })
expect('create_voice clone needs consent', !!noConsent.error)
const made = await call('create_voice', { name: 'Old Cork', file: d.value.items[0].file, kind: 'designed', seed: 3, text: d.value.items[0].text, description: d.value.items[0].description })
expect('create_voice designed', !made.error && fs.existsSync(made.value.reference), made.error || made.value.id)
const given = await call('save_character', { id: 'tess', voiceId: made.value.id })
expect('save_character voiceId', !given.error && given.value.voiceId === made.value.id)
const bad = await call('save_character', { id: 'tess', voiceId: 'nope' })
expect('save_character unknown voice -> error', !!bad.error)

const lines = await call('list_lines')
expect('list_lines', lines.value?.items.length === 3, `${lines.value?.items.length} lines`)
const del = await call('delete_voice', { id: tessVoice.id })
expect('delete_voice removes its lines', !del.error && (await call('list_lines')).value.items.length === 0)
const after = (await call('list_characters')).value
const tess = (after.items || after).find?.((x) => x.id === 'tess')
expect('the character keeps the voice it was given', tess?.voiceId === made.value.id)
await call('release_voice_engine')

await c.close()
console.log(failures ? `${failures} failed` : 'all passed', `| files in ${temp}`)
process.exit(failures ? 1 : 0)
