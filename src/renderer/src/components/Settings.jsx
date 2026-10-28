import { useEffect, useState } from 'react'
import Hero from './Hero'

export default function Settings({ info, recheck, notify, characters, setCharacters }) {
  const [settings, setSettings] = useState(null)
  const [url, setUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.ivstudio.settings.get().then((s) => {
      setSettings(s)
      setUrl(s.comfyUrl)
    })
  }, [])

  async function saveUrl() {
    try {
      setSettings(await window.ivstudio.settings.set({ comfyUrl: url.trim() }))
      recheck()
    } catch (err) {
      notify(err.message)
    }
  }

  const mcp = info?.mcp
  const claudeCmd = mcp ? `claude mcp add iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "${mcp.command}" "${mcp.args[0]}"` : ''
  const jsonCfg = mcp ? JSON.stringify({ mcpServers: { 'iv-studio': mcp } }, null, 2) : ''

  async function saveCharacter(i, patch) {
    const list = characters.map((c, j) => (j === i ? { ...c, ...patch } : c))
    setCharacters(await window.ivstudio.characters.save(list))
  }

  // Shots already made with a character keep working: their finish uses the saved plan, not this list.
  async function deleteCharacter(i) {
    if (!window.confirm(`Delete ${characters[i].name}? Its LoRA file stays in ComfyUI; only the preset is removed.`)) return
    setCharacters(await window.ivstudio.characters.save(characters.filter((_, j) => j !== i)))
  }

  if (!settings) return null
  return (
    <div className="settings">
      <Hero title="Settings" kicker="Infinite Variance" />

      <section className="group">
        <div className="group-head">
          <h2>ComfyUI</h2>
          <p className="dim small">The ComfyUI IV Studio renders on.</p>
        </div>
        <div className="group-body">
          <div className="key-form">
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-small" disabled={url.trim() === settings.comfyUrl} onClick={saveUrl}>
              Save
            </button>
          </div>
        </div>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Characters</h2>
          <p className="dim small">A character is a trained LoRA plus its trigger word.</p>
        </div>
        <div className="group-body">
          {characters.map((c, i) => (
            <div key={c.id} className="character-card">
              <div className="character-head">
                <input value={c.name} onChange={(e) => saveCharacter(i, { name: e.target.value })} />
                <button className="link-btn mono" onClick={() => deleteCharacter(i)}>
                  Delete
                </button>
              </div>
              <div className="row tight">
                <span className="row-label">LoRA</span>
                <input value={c.lora} onChange={(e) => saveCharacter(i, { lora: e.target.value })} />
              </div>
              <div className="row tight">
                <span className="row-label">Strength</span>
                <input type="number" step={0.05} min={0} max={1.5} value={c.strength} onChange={(e) => saveCharacter(i, { strength: Number(e.target.value) })} />
              </div>
              <div className="row tight">
                <span className="row-label">Trigger</span>
                <input value={c.trigger} onChange={(e) => saveCharacter(i, { trigger: e.target.value })} />
              </div>
            </div>
          ))}
          <button
            className="btn btn-small"
            onClick={async () => setCharacters(await window.ivstudio.characters.save([...characters, { id: `char${Date.now().toString(36)}`, name: 'New character', lora: 'MiniMax H3\\name\\name.safetensors', strength: 0.8, trigger: 'n4m3' }]))}
          >
            + Add character
          </button>
        </div>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>Agents (MCP)</h2>
          <p className="dim small">Lets Claude Code and other agents use IV Studio with the same projects and results.</p>
        </div>
        <div className="group-body">
          <p className="mono label">Claude Code</p>
          <pre className="code">{claudeCmd}</pre>
          <button
            className="btn btn-small"
            onClick={() => {
              navigator.clipboard.writeText(claudeCmd)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            {copied ? 'Copied' : 'Copy command'}
          </button>
          <p className="mono label">Other clients (JSON)</p>
          <pre className="code">{jsonCfg}</pre>
          <p className="dim small">Tools: check_setup, list_characters, list_projects, plan_render, generate_previews, finish_candidate, get_job, cancel_job, get_outputs.</p>
        </div>
      </section>

      <section className="group">
        <div className="group-head">
          <h2>About</h2>
        </div>
        <div className="group-body">
          <p className="small dim">IV Studio {info?.version}. Data: {info?.dataDir}</p>
        </div>
      </section>
    </div>
  )
}
