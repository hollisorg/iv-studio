// MCP smoke test: launch the server the way an agent would and call the read-only tools.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import path from 'node:path'

const transport = new StdioClientTransport({
  command: path.resolve('node_modules/electron/dist/electron.exe'),
  args: [path.resolve('out/main/mcp.js')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
const client = new Client({ name: 'smoke', version: '1' })
await client.connect(transport)
const { tools } = await client.listTools()
console.log('tools:', tools.map((t) => t.name).join(', '))
const setup = await client.callTool({ name: 'check_setup', arguments: {} })
console.log('check_setup ready:', setup.structuredContent?.ready, '| items:', setup.structuredContent?.items?.length)
const plan = await client.callTool({ name: 'plan_render', arguments: { mode: 'reference', prompt: 'x', aspect: '9:16', megapixels: 0.4, seconds: 6, media: [{ kind: 'picture', file: 'minimax_h3/tess_pub_garden_ref.png' }], finish: { megapixels: 1.5, fps: 60 } } })
console.log('plan_render:', JSON.stringify(plan.structuredContent))
const bad = await client.callTool({ name: 'plan_render', arguments: { mode: 'frames', prompt: 'x' } })
console.log('invalid request ->', bad.isError, bad.content[0].text)
await client.close()
