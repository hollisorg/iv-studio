// Live-sync check: an agent edits through the MCP server while the edit is open in a dev copy of the
// app (started with --remote-debugging-port=9333 and the same IV_STUDIO_DATA). The window should
// reload the edit, tell the person, and undo back to its own version with Ctrl+Z.
//   IV_STUDIO_DATA=<test data> node test/mcp-live.mjs <video.mp4>
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const mcp = new Client({ name: 'live-test', version: '1' })
await mcp.connect(new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }))
const call = async (name, args) => (await mcp.callTool({ name, arguments: args })).structuredContent

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
const clips = () => js(`[...document.querySelectorAll('.tl-clip')].map(c=>c.title)`)

const e = await call('create_edit', { name: `Live sync ${Date.now().toString(36)}` })
await call('add_media', { editId: e.id, files: [process.argv[2]], append: true })
await js(`[...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Edit')).click()`)
await sleep(800)
await js(`[...document.querySelectorAll('.tile')].find(b=>b.textContent.includes(${JSON.stringify(e.name)})).click()`)
await sleep(1200)
const before = await clips()
console.log('open in the window:', before)

await call('edit_timeline', { editId: e.id, ops: [{ op: 'add_title', content: 'FROM THE AGENT', start: 0.5, duration: 2 }] })
await sleep(1200)
const after = await clips()
const toast = await js(`document.body.innerText.includes('An agent changed this edit')`)
console.log('after the agent edit:', after, '| told the person:', toast)

await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Undo')).click()`)
await sleep(1500)
const undone = await clips()
const onDisk = await call('get_edit', { editId: e.id })
console.log('after Ctrl+Z:', undone, '| saved titles:', onDisk.tracks.T1.length)
const ok = after.length === before.length + 1 && toast && undone.length === before.length && onDisk.tracks.T1.length === 0
await call('delete_edit', { editId: e.id })
console.log(ok ? 'live sync ok' : 'live sync FAILED')
await mcp.close()
process.exit(ok ? 0 : 1)
