// Writes skills/iv-studio/SKILL.md, the Claude Code skill hosted in this repo, from
// resources/agent-guide.md. The app installs the same skill with the install's own MCP command.
//   node scripts/make-skill.mjs
import fs from 'node:fs'
import path from 'node:path'
import { readGuide, skillMarkdown } from '../src/service/agent.js'

const out = path.resolve('skills/iv-studio/SKILL.md')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, skillMarkdown(readGuide(path.resolve('resources'))))
console.log(`Wrote ${out}`)
