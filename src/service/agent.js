// What an agent gets told about IV Studio: the guide (resources/agent-guide.md), the short
// instructions an MCP client receives on connect, the Claude Code skill, and the message a person
// pastes into their agent to set it all up.
import fs from 'node:fs'
import path from 'node:path'

export const readGuide = (resourcesDir) => fs.readFileSync(path.join(resourcesDir, 'agent-guide.md'), 'utf8')

export const INSTRUCTIONS = `IV Studio renders MiniMax H3 video shots and continuous sequences with recurring characters on a local ComfyUI, and cuts them together on its own timeline. It shares projects, renders and edits with the IV Studio window the person sees.
Start with check_setup and list_characters, and call get_guide once for the full workflow (shots, prompts, sequences, timeline edits) and the house rules.
Prompts write {char} where the character goes. Renders take GPU minutes: poll get_job every 20-30 s. Ask the person before deleting anything or using the paid Context IR writer, and only cancel jobs you started.`

// mcp: { command, args } of this install, or null for the copy hosted on GitHub.
export function skillMarkdown(guide, mcp = null) {
  const setup = mcp
    ? `If the \`iv-studio\` MCP tools aren't available, add the server (stdio), then reload MCP servers:\n\n\`\`\`\nclaude mcp add -s user iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "${mcp.command}" "${mcp.args[0]}"\n\`\`\``
    : `If the \`iv-studio\` MCP tools aren't available, IV Studio has to be installed and its server added: the exact command for an install is under Settings -> Agents (MCP) in the app. Download: https://github.com/hollisorg/iv-studio/releases`
  return `---
name: iv-studio
description: Make MiniMax H3 videos with IV Studio through its MCP server - render shots and continuous sequences with recurring characters, hunt and finish previews, retake stretches, and cut renders together on IV Studio's timeline (trims, titles, sound, export). Use whenever the person asks for IV Studio, an H3 shot or sequence, a character video, or an edit of their IV Studio renders.
---

${setup}

${guide.replace(/^# .*\n+/, '')}`
}

export function pasteMessage(mcp) {
  return `Connect to IV Studio, my local MiniMax H3 video app, and learn to use it.

1. Add its MCP server (stdio), named "iv-studio":
   command: ${mcp.command}
   args: ${mcp.args[0]}
   env: ELECTRON_RUN_AS_NODE=1
   In Claude Code that's: claude mcp add -s user iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "${mcp.command}" "${mcp.args[0]}"
   In Codex: codex mcp add iv-studio --env ELECTRON_RUN_AS_NODE=1 -- "${mcp.command}" "${mcp.args[0]}"
2. Reload MCP servers if your app needs it, then call the iv-studio tool get_guide and follow it.
3. Run check_setup and tell me what's ready and what you can make for me.`
}
