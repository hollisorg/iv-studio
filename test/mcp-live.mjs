// Live-sync check: an agent edits through the MCP server while the edit is open in a dev copy of the
// app (started with --remote-debugging-port=9333 and the same IV_STUDIO_DATA). The window should
// reload the edit, say what the agent did in its activity strip, undo it from there, and a track the
// person locks should refuse the agent.
//   IV_STUDIO_DATA=<test data> node test/mcp-live.mjs <video.mp4>
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mcp = new Client({ name: 'live-test', version: '1' })
await mcp.connect(new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }))
const raw = async (name, args) => mcp.callTool({ name, arguments: args })
const call = async (name, args) => (await raw(name, args)).structuredContent

const list = await (await fetch('http://127.0.0.1:9333/json/list')).json()
const ws = new WebSocket(list.find((p) => p.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
let n = 0
const pending = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) pending.get(m.id)(m)
})
const js = (expression) =>
  new Promise((r) => {
    const i = ++n
    pending.set(i, (m) => r(m.result?.result?.value))
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const clips = () => js(`[...document.querySelectorAll('.tl-clip')].map(c=>c.title)`)
const heads = () => js(`[...document.querySelectorAll('.tl-head .tl-name')].map(h=>h.firstChild.textContent)`)
const strip = () => js(`document.querySelector('.ed-agent-text')?.textContent || null`)

const e = await call('create_edit', { name: `Live sync ${Date.now().toString(36)}` })
const [m] = (await call('add_media', { editId: e.id, files: [process.argv[2]], append: true })).media
await js(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Edit')).click()`)
await sleep(800)
await js(`[...document.querySelectorAll('.tile')].find(b=>b.textContent.includes(${JSON.stringify(e.name)})).click()`)
await sleep(1500)
const before = await clips()
console.log('open in the window:', before)

await call('edit_timeline', { editId: e.id, ops: [{ op: 'add_title', content: 'FROM THE AGENT', start: 0.5, duration: 2 }] })
await sleep(1200)
const after = await clips()
const said = await strip()
expect("the agent's title appears", after.length === before.length + 1, after.join(' | '))
expect('the strip says what it did', /added 1 title on T1/i.test(said || ''), said)

await js(`document.querySelector('.ed-agent .btn').click()`)
await sleep(1500)
const undone = await clips()
const onDisk = await call('get_edit', { editId: e.id })
expect('Undo in the strip puts it back, on disk too', undone.length === before.length && onDisk.tracks.T1.length === 0, `${undone.length} clips, ${onDisk.tracks.T1.length} titles saved`)

await call('edit_timeline', { editId: e.id, ops: [{ op: 'add_track', kind: 'video' }, { op: 'insert_clip', media: m.id, track: 'V1', at: 1, in: 0, duration: 1 }, { op: 'add_marker', at: 2, label: 'cut here' }] })
await sleep(1500)
const h = await heads()
const said2 = await strip()
expect('agent track, insert and marker show up', h.includes('V3') && (await js(`document.querySelectorAll('.tl-marker').length`)) === 1 && (await clips()).length === before.length + 2, `${h.join(' ')} · ${said2}`)

await js(`[...document.querySelectorAll('.tl-head')].find(x=>x.querySelector('.tl-name').firstChild.textContent==='V1').querySelector('.tl-sw.locked').click()`)
await sleep(1200)
const locked = await raw('edit_timeline', { editId: e.id, ops: [{ op: 'add_clip', media: m.id, track: 'V1' }] })
expect('a track locked in the window refuses the agent', locked.isError && /locked/.test(locked.content[0].text), locked.content[0].text)
const desc = await call('get_edit', { editId: e.id })
expect('get_edit shows track states and markers', desc.trackList.find((t) => t.id === 'V1')?.locked === true && desc.markers[0]?.label === 'cut here')

await call('delete_edit', { editId: e.id })
console.log(failures ? `${failures} failed` : 'live sync ok')
await mcp.close()
process.exit(failures ? 1 : 0)
