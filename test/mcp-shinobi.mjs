// Shinobi through IV Studio's MCP server: status, the tool list, a passthrough call that returns preview frames
// as images, and the project view. Needs a data folder where Shinobi is set up and has a project with an edit
// (test/shinobi.mjs leaves one).   IV_STUDIO_DATA=<data folder> node test/mcp-shinobi.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const c = new Client({ name: 'shinobi-test', version: '1' })
await c.connect(new StdioClientTransport({ command: path.resolve('node_modules/electron/dist/electron.exe'), args: [path.resolve('out/main/mcp.js')], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }))
let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const call = (name, args = {}) => c.callTool({ name, arguments: args }, undefined, { timeout: 300000 })

const st = (await call('shinobi_status')).structuredContent
expect('shinobi_status', st.installed && st.projects.length > 0, `${st.projects.length} project(s), browser ${path.basename(st.browser || '')}`)
const tools = (await call('shinobi_tools')).structuredContent.items
expect('shinobi_tools', tools.length >= 70, `${tools.length} tools`)
const id = st.projects[0].id
const prev = await call('shinobi', { tool: 'preview_timeline', arguments: { project_id: id, frames: [10, 90] } })
const images = prev.content.filter((x) => x.type === 'image')
expect('passthrough with pictures', !prev.isError && images.length === 2, `${images.length} images, ${Math.round(images[0]?.data.length / 1024)} KB each`)
const bad = await call('shinobi', { tool: 'get_project', arguments: { project_id: 'nope' } })
expect('engine errors come back as errors', bad.isError, bad.content[0].text.slice(0, 80))
const proj = (await call('shinobi_project', { projectId: id })).structuredContent
expect('shinobi_project', proj.assets.length > 0 && proj.renders.length > 0 && proj.timeline, `${proj.assets.length} media, ${proj.renders.length} render(s), ${proj.timeline?.seconds} s`)
await c.close()
console.log(failures ? `${failures} FAILED` : 'all passed')
process.exit(failures ? 1 : 0)
