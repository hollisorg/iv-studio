// MCP tools test: drives the editor, renders, models and character tools over stdio, the way an agent
// would. Writes go to a temporary data folder; only read-only tools look at the real one.
//   node test/mcp-tools.mjs <video1.mp4> <video2.mp4> <audio.flac|wav>
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [va, vb, au] = process.argv.slice(2)
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-mcp-'))
let failures = 0

async function connect(env) {
  const transport = new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...env } })
  const client = new Client({ name: 'tools-test', version: '1' })
  await client.connect(transport)
  return client
}
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  return { error: r.isError ? r.content[0].text : null, value: r.structuredContent, content: r.content }
}
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}

// ---------- read-only, real data ----------
const real = await connect({})
const { tools } = await real.listTools()
console.log(`${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`)
const renders = await call(real, 'list_renders', { limit: 5 })
expect('list_renders', !renders.error && renders.value.items.length > 0, `${renders.value?.items.length} items, newest: ${renders.value?.items[0]?.label}`)
const h3 = await call(real, 'list_h3_models')
expect('list_h3_models', !h3.error && h3.value.models.length > 0, `${h3.value?.models.length} models, text default ${h3.value?.defaults.text}`)
const choices = await call(real, 'list_choices')
expect('list_choices', !choices.error && choices.value.loras.length > 0, `${choices.value?.loras.length} LoRAs, ${choices.value?.refmods.length} RefMods`)
await real.close()

// ---------- writes, temporary data ----------
const c = await connect({ IV_STUDIO_DATA: temp })
const created = await call(c, 'create_edit', { name: 'Agent cut', format: 'vertical', fps: 30 })
const id = created.value.id
expect('create_edit', !created.error && created.value.settings.format === 'vertical' && created.value.settings.fps === 30)

const added = await call(c, 'add_media', { editId: id, files: [va, vb, au], append: true })
expect('add_media append', !added.error && added.value.placed.length === 3, added.error || added.value.placed.map((p) => `${p.track}@${p.start}-${p.end}`).join(' '))
const [ma, mb, mc] = added.value.media
const firstClip = added.value.placed[0].clip
const secondClip = added.value.placed[1].clip

const notFound = await call(c, 'add_media', { editId: id, renders: ['nope'] })
expect('add_media unknown render -> error', !!notFound.error, notFound.error)

const before = (await call(c, 'get_edit', { editId: id })).value
const bad = await call(c, 'edit_timeline', { editId: id, ops: [{ op: 'update_clip', clip: firstClip, fadeIn: 0.5 }, { op: 'add_clip', media: mc.id, track: 'V1' }] })
const unchanged = (await call(c, 'get_edit', { editId: id })).value
expect('bad op rejected, nothing changed', !!bad.error && JSON.stringify(unchanged.tracks) === JSON.stringify(before.tracks), bad.error)
const tooLong = await call(c, 'edit_timeline', { editId: id, ops: [{ op: 'update_clip', clip: firstClip, out: ma.duration + 5 }] })
expect('out past the media end rejected', !!tooLong.error, tooLong.error)

const ops = [
  { op: 'update_clip', clip: firstClip, in: 0.5, out: 2.5, fadeIn: 0.5 },
  { op: 'update_clip', clip: secondClip, start: 2 },
  { op: 'split_clip', clip: secondClip, at: 4 },
  { op: 'add_title', content: 'AGENT CUT', start: 0.5, duration: 2.5, position: 'center', box: true },
  { op: 'add_clip', media: mb.id, track: 'V2', start: 1, in: 2, duration: 1.5, muted: true, fadeIn: 0.3, fadeOut: 0.3 }
]
const done = await call(c, 'edit_timeline', { editId: id, ops })
expect('edit_timeline 5 ops', !done.error && done.value.results.length === 5, done.error || done.value.results.map((r) => r.op).join(', '))
const newClip = done.value?.results[2].newClip
if (!newClip) process.exit(1)
const after = await call(c, 'edit_timeline', { editId: id, ops: [{ op: 'remove_clip', clip: newClip, ripple: true }, { op: 'update_clip', clip: added.value.placed[2].clip, volume: 0.4, start: 0, fadeOut: 1 }] })
expect('remove_clip ripple + audio volume', !after.error, after.error)
const e = after.value.edit
console.log('  timeline:', Object.entries(e.tracks).map(([t, cs]) => `${t}[${cs.map((x) => `${x.start}-${x.end}`).join(' ')}]`).join(' '), `= ${e.seconds} s`)
expect('trim + move landed', e.tracks.V1[0].start === 0 && e.tracks.V1[0].end === 2 && e.tracks.V1[1].start === 2 && e.tracks.V1[1].end === 4)

const renamed = await call(c, 'set_edit_settings', { editId: id, name: 'Agent cut v2', format: '1080p' })
expect('set_edit_settings', !renamed.error && renamed.value.name === 'Agent cut v2' && renamed.value.settings.format === '1080p' && renamed.value.settings.fps === 30)

const frame = await call(c, 'grab_frame', { editId: id, at: 1.6 })
const img = frame.content?.find((x) => x.type === 'image')
expect('grab_frame returns an image', !frame.error && !!img, frame.error || frame.content?.[1]?.text)
if (img) fs.writeFileSync(path.join(temp, 'grab_1.6.png'), Buffer.from(img.data, 'base64'))

const started = await call(c, 'export_edit', { editId: id, outDir: temp })
expect('export_edit starts', !started.error && started.value.state === 'running', started.error)
let st
for (let i = 0; i < 120; i++) {
  st = (await call(c, 'get_edit_export', { editId: id })).value
  if (st.state !== 'running') break
  await new Promise((r) => setTimeout(r, 1000))
}
expect('export finished', st.state === 'done', st.error || st.file)
if (st.file) {
  const probe = spawnSync(path.resolve('node_modules/ffmpeg-ffprobe-static/ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'csv=p=0', st.file]).stdout.toString()
  console.log('  ', probe.trim().replace(/\r?\n/g, ' | '))
  expect('export matches the edit', probe.includes('1920,1080,30/1') && Math.abs(parseFloat(probe.trim().split(/\r?\n/).pop()) - e.seconds) < 0.1)
}

// ---------- tracks: hidden V2 drops out of the picture, a muted A1 out of the sound ----------
const top = await call(c, 'grab_frame', { editId: id, at: 1.6 })
const hid = await call(c, 'edit_timeline', { editId: id, ops: [{ op: 'add_track', kind: 'video' }, { op: 'update_track', track: 'V2', hidden: true }, { op: 'update_track', track: 'A1', muted: true }, { op: 'add_marker', at: 1, label: 'agent' }] })
const under = await call(c, 'grab_frame', { editId: id, at: 1.6 })
const cap = (r) => r.content?.find((x) => x.type === 'text')?.text || r.value?.caption || ''
expect('hidden V2: grab_frame shows V1 instead', !hid.error && cap(top).includes(path.basename(vb)) && cap(under).includes(path.basename(va)), `${cap(top)} -> ${cap(under)}`)
expect('get_edit lists V3, the states and the marker', hid.value?.edit.trackList.map((t) => t.id).join(' ') === 'T1 V3 V2 V1 A1 A2' && hid.value.edit.trackList.find((t) => t.id === 'A1').muted && hid.value.edit.markers[0].label === 'agent', hid.error)
await call(c, 'export_edit', { editId: id, outDir: temp })
for (let i = 0; i < 120; i++) {
  st = (await call(c, 'get_edit_export', { editId: id })).value
  if (st.state !== 'running') break
  await new Promise((r) => setTimeout(r, 1000))
}
expect('export with a hidden and a muted track', st.state === 'done', st.error || st.file)

// ---------- characters and models (temporary settings) ----------
const badLora = await call(c, 'save_character', { id: 'robo', name: 'Robo', lora: 'nope.safetensors', trigger: 'r0b0' })
expect('save_character unknown LoRA -> error', !!badLora.error, badLora.error)
const lora = choices.value.loras.find((l) => /tess/i.test(l)) || choices.value.loras[0]
const saved = await call(c, 'save_character', { id: 'robo', name: 'Robo', lora, trigger: 'r0b0', strength: 0.7 })
const listed = await call(c, 'list_characters')
expect('save_character', !saved.error && listed.value.items.some((x) => x.id === 'robo' && x.strength === 0.7), saved.error)
const gone = await call(c, 'delete_character', { id: 'robo' })
expect('delete_character', !gone.error && !gone.value.items.some((x) => x.id === 'robo'))

const badModel = await call(c, 'set_workflow_model', { workflow: 'text', model: 'nope.safetensors' })
expect('set_workflow_model unknown -> error', !!badModel.error, badModel.error)
const pickModel = h3.value.models.find((m) => m !== h3.value.defaults.reference) || h3.value.models[0]
const set = await call(c, 'set_workflow_model', { workflow: 'reference', model: pickModel })
const settings = JSON.parse(fs.readFileSync(path.join(temp, 'settings.json'), 'utf8'))
expect('set_workflow_model saved', !set.error && settings.models.reference === pickModel, pickModel)
const plan = await call(c, 'list_h3_models')
expect('list_h3_models shows the choice', plan.value.chosen.reference === pickModel)
const reset = await call(c, 'set_workflow_model', { workflow: 'reference', model: null })
expect('set_workflow_model reset', !reset.error && !reset.value.chosen.reference)

const listedEdits = await call(c, 'list_edits')
expect('list_edits', listedEdits.value.items.length === 1 && listedEdits.value.items[0].exports === 2)
const del = await call(c, 'delete_edit', { editId: id })
expect('delete_edit', !del.error && (await call(c, 'list_edits')).value.items.length === 0)
await c.close()

console.log(failures ? `${failures} FAILED` : 'all passed', '| files in', temp)
process.exit(failures ? 1 : 0)
