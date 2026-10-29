import { useEffect, useState } from 'react'
import { ask } from './Confirm'
import Hero from './Hero'

const WRITER_MODEL = 'qwen3-vl:8b-instruct'
const GB = (b) => `${(b / 1e9).toFixed(1)} GB`

const WORKFLOWS = [
  ['text', 'Text', 'fl2va'],
  ['frames', 'First / last frame', 'fl2va'],
  ['continue', 'Continue a video', 'fl2va'],
  ['reference', 'References', 'ref2va'],
  ['take', 'Sequences · one take', 'ref2va'],
  ['retake', 'Sequences · retake', 'ref2va']
]
const short = (n) => n.split(/[\\/]/).pop().replace(/\.safetensors$/, '')
const kindOf = (n) => (/fl2va/i.test(n) ? 'fl2va' : /ref2va|omniref/i.test(n) ? 'ref2va' : null)

// Which H3 model each workflow runs: fine-tunes differ (realism, animation, speed).
function ModelSettings({ settings, setSettings, notify }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    window.ivstudio.h3Models().then(setInfo).catch((err) => setInfo({ error: err.message }))
  }, [])
  const choices = settings.models || {}
  async function choose(id, name) {
    try {
      setSettings(await window.ivstudio.settings.set({ models: { ...choices, [id]: name || undefined } }))
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <section className="group">
      <div className="group-head">
        <h2>Models</h2>
        <p className="dim small">The main H3 model each workflow runs. Fine-tunes lean towards realism, animation or speed.</p>
      </div>
      <div className="group-body">
        {info?.error && <p className="small pink">ComfyUI didn't answer: {info.error}</p>}
        {info?.models &&
          WORKFLOWS.map(([id, label, want]) => {
            const value = choices[id] || ''
            const picked = value || info.defaults[id]
            const kind = kindOf(picked)
            return (
              <div key={id} className="row">
                <span className="row-label">{label}</span>
                <div className="model-pick">
                  <select value={value} onChange={(e) => choose(id, e.target.value)}>
                    <option value="">Default · {short(info.defaults[id])}</option>
                    {info.models.map((m) => (
                      <option key={m} value={m}>
                        {short(m)}
                        {kindOf(m) ? ` · ${kindOf(m)}` : ''}
                      </option>
                    ))}
                  </select>
                  {kind && kind !== want && <span className="small pink">This workflow expects a {want} model.</span>}
                </div>
              </div>
            )
          })}
        <p className="small dim">
          Text, First / last frame and Continue use an fl2va-type model (it lands on exact frames). References and Sequences use a ref2va-type model (it follows reference pictures and keeps a voice across shots). A cloud ComfyUI only lists the models in its own storage.
        </p>
      </div>
    </section>
  )
}

// Prompt writer: which engine writes prompts, the free local model, and the Comfy.org key for Context IR.
function WriterSettings({ settings, setSettings, notify }) {
  const [status, setStatus] = useState(null)
  const [key, setKey] = useState('')
  const [pull, setPull] = useState(null)
  const refresh = () => window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))

  useEffect(() => {
    refresh()
    return window.ivstudio.prompts.onPull((ev) => setPull(ev))
  }, [])

  const save = async (patch) => {
    try {
      setSettings(await window.ivstudio.settings.set(patch))
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }
  async function install(model) {
    setPull({ status: 'starting' })
    try {
      await window.ivstudio.prompts.pull(model)
      await save({ ollamaModel: model })
    } catch (err) {
      notify(err.message)
    } finally {
      setPull(null)
    }
  }
  async function saveKey(k) {
    try {
      setSettings(await window.ivstudio.settings.setComfyKey(k))
      setKey('')
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }

  const engine = settings.promptEngine
  const models = status?.models || []
  const hasModel = models.some((m) => m.name === settings.ollamaModel)
  const pct = pull?.total ? Math.floor((pull.completed / pull.total) * 100) : null

  return (
    <section className="group">
      <div className="group-head">
        <h2>Prompt writer</h2>
        <p className="dim small">Writes the H3 prompt from your idea in plain words (✦ Write it for me).</p>
      </div>
      <div className="group-body">
        <div className="segmented">
          <button className={engine === 'local' ? 'on' : ''} onClick={() => save({ promptEngine: 'local' })}>
            Local · free
          </button>
          <button className={engine === 'contextir' ? 'on' : ''} onClick={() => save({ promptEngine: 'contextir' })}>
            MiniMax Context IR
          </button>
        </div>

        {engine === 'local' ? (
          <>
            <p className="small dim">
              A model in Ollama on this PC, with IV Studio's H3 rules. Private and free. It loads only while writing, then frees the GPU for rendering.
            </p>
            {!status ? null : !status.installed ? (
              <p className="small pink">
                Ollama isn't installed.{' '}
                <button className="link-btn" onClick={() => window.ivstudio.links.open('https://ollama.com/download')}>
                  Get Ollama
                </button>
              </p>
            ) : (
              <>
                <div className="row">
                  <span className="row-label">Model</span>
                  {models.length ? (
                    <select value={hasModel ? settings.ollamaModel : ''} onChange={(e) => save({ ollamaModel: e.target.value })}>
                      {!hasModel && <option value="">Choose a model</option>}
                      {models.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} · {GB(m.size)}
                          {m.vision ? ' · sees pictures' : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="small dim">{status.running ? 'No models yet.' : 'Ollama starts when you first write a prompt.'}</span>
                  )}
                </div>
                {!models.some((m) => m.name === WRITER_MODEL) && (
                  <div className="dl">
                    {pull ? (
                      <>
                        <div className="bar">
                          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                        </div>
                        <span className="mono dim">{pct != null ? `${pct}%` : pull.status}</span>
                      </>
                    ) : (
                      <button className="btn btn-small" onClick={() => install(WRITER_MODEL)}>
                        Install the recommended writer ({WRITER_MODEL}, about 6 GB)
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="small dim">
              MiniMax's own prompt rewriter: it writes in the exact format H3 was trained on and looks at your reference media. Paid through your Comfy.org account, {status?.contextIrPrice || 'a few cents a prompt'}. It runs through ComfyUI.
            </p>
            {settings.hasComfyKey ? (
              <p className="small">
                A Comfy.org API key is saved (encrypted on this PC).{' '}
                <button className="link-btn" onClick={() => saveKey('')}>
                  Remove it
                </button>
              </p>
            ) : (
              <>
                <div className="key-form">
                  <input type="password" value={key} placeholder="Comfy.org API key (comfyui-…)" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                  <button className="btn btn-small" disabled={!key.trim()} onClick={() => saveKey(key)}>
                    Save
                  </button>
                </div>
                <p className="small dim">
                  Create one at{' '}
                  <button className="link-btn" onClick={() => window.ivstudio.links.open('https://platform.comfy.org/login')}>
                    platform.comfy.org
                  </button>{' '}
                  and add credits there. The key stays on this PC.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// A block of text with a Copy button.
function Copyable({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyable">
      <pre className="code">{text}</pre>
      <button
        className="btn btn-small"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}

// Agents (MCP): a message to paste into any agent, the manual commands, and the Claude Code skill.
function AgentSettings({ mcp, notify }) {
  const [agents, setAgents] = useState(null)
  const [client, setClient] = useState('claude')
  const refresh = () => window.ivstudio.agents.info().then(setAgents)
  useEffect(() => {
    refresh()
  }, [])
  if (!mcp || !agents) return null
  const cmd = `"${mcp.command}" "${mcp.args[0]}"`
  const manual = {
    claude: `claude mcp add -s user iv-studio -e ELECTRON_RUN_AS_NODE=1 -- ${cmd}`,
    codex: `codex mcp add iv-studio --env ELECTRON_RUN_AS_NODE=1 -- ${cmd}`,
    json: JSON.stringify({ mcpServers: { 'iv-studio': mcp } }, null, 2)
  }
  async function installSkill() {
    try {
      await window.ivstudio.agents.installSkill()
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <section className="group">
      <div className="group-head">
        <h2>Agents (MCP)</h2>
        <p className="dim small">Claude Code, Codex and other agents can render, sequence and edit in IV Studio, with the same projects and results you see here.</p>
      </div>
      <div className="group-body">
        <p className="mono label">Paste into your agent</p>
        <p className="small dim">One message: your agent adds IV Studio, reads its guide and checks your setup.</p>
        <Copyable text={agents.paste} label="Copy message" />

        <p className="mono label">Or add it yourself</p>
        <div className="segmented">
          {[
            ['claude', 'Claude Code'],
            ['codex', 'Codex'],
            ['json', 'Other (JSON)']
          ].map(([id, label]) => (
            <button key={id} className={client === id ? 'on' : ''} onClick={() => setClient(id)}>
              {label}
            </button>
          ))}
        </div>
        <Copyable text={manual[client]} label="Copy command" />

        <p className="mono label">Claude Code skill</p>
        <p className="small dim">
          Teaches Claude Code IV Studio's workflow (shots, H3 prompts, sequences, timeline edits and the house rules) so it picks the right tools without being told. The server also hands every agent a short version, and the full guide through get_guide.
        </p>
        <div className="row-actions">
          <button className="btn btn-small" onClick={installSkill}>
            {!agents.skillInstalled ? 'Add the skill to Claude Code' : agents.skillCurrent ? 'Skill added ✓' : 'Update the skill'}
          </button>
          <button className="link-btn mono" onClick={() => window.ivstudio.links.open('https://github.com/hollisorg/iv-studio/blob/main/skills/iv-studio/SKILL.md')}>
            View it on GitHub ↗
          </button>
        </div>
        {agents.skillInstalled && <p className="mono small dim">{agents.skillFile}</p>}
        <p className="dim small">Tools for setup, shots, sequences, prompt writing, references, renders, timeline editing, character training, models and characters.</p>
      </div>
    </section>
  )
}

export default function Settings({ info, recheck, notify, characters, setCharacters }) {
  const [settings, setSettings] = useState(null)
  const [url, setUrl] = useState('')

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

  async function saveCharacter(i, patch) {
    const list = characters.map((c, j) => (j === i ? { ...c, ...patch } : c))
    setCharacters(await window.ivstudio.characters.save(list))
  }

  // Shots already made with a character keep working: their finish uses the saved plan, not this list.
  async function deleteCharacter(i) {
    if (!(await ask({ title: `Delete ${characters[i].name}?`, message: 'Only the preset goes; its LoRA file stays in ComfyUI.', confirm: 'Delete', danger: true }))) return
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

      <ModelSettings settings={settings} setSettings={setSettings} notify={notify} />

      <WriterSettings settings={settings} setSettings={setSettings} notify={notify} />

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

      <AgentSettings mcp={info?.mcp} notify={notify} />

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
