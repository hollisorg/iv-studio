import { useEffect, useState } from 'react'
import { ask } from './Confirm'

// "Write it for me": a plain-words idea in, a finished H3 prompt out. context carries what the writer
// should respect (mode, seconds, aspect, character, media, sequence, previous shot).
export default function PromptWriter({ context, current, onWritten, notify, go, compact = false }) {
  const [idea, setIdea] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [undo, setUndo] = useState(null)

  useEffect(() => {
    window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  const engine = status?.engine || 'local'
  const blocker =
    status &&
    (engine === 'contextir'
      ? !status.hasComfyKey && 'MiniMax Context IR needs your Comfy.org API key.'
      : !status.installed
        ? 'The free writer needs Ollama.'
        : status.running && !status.models.some((m) => m.name === status.model) && `The writer model ${status.model} isn't installed yet.`)

  async function write() {
    setBusy(true)
    try {
      const text = await window.ivstudio.prompts.write({ ...context, idea })
      setUndo(current || '')
      onWritten(text)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`writer ${compact ? 'compact' : ''}`}>
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write it for me</span>
        <span className="mono dim small">{engine === 'contextir' ? `MiniMax Context IR · ${status?.contextIrPrice?.split(' (')[0] || 'paid'}` : `Local writer · free`}</span>
      </div>
      <div className="writer-row">
        <textarea rows={compact ? 2 : 2} value={idea} placeholder={context.sequence ? 'What happens in this shot, in plain words' : 'Your idea in plain words, e.g. Tess in a parked car at night admits she kept the letter'} onChange={(e) => setIdea(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !idea.trim() || !!blocker} onClick={write}>
          {busy ? 'Writing…' : current?.trim() ? 'Rewrite prompt' : 'Write my prompt'}
        </button>
      </div>
      {blocker && (
        <p className="small pink writer-note">
          {blocker}{' '}
          <button className="link-btn" onClick={() => go('settings')}>
            Set it up in Settings
          </button>
        </p>
      )}
      {undo != null && !busy && (
        <p className="small dim writer-note">
          Prompt written below; edit it freely.{' '}
          <button
            className="link-btn"
            onClick={() => {
              onWritten(undo)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </p>
      )}
    </div>
  )
}

// A short story -> every shot of a sequence (local writer).
export function StoryWriter({ character, shotSeconds, existing, onShots, notify }) {
  const [open, setOpen] = useState(false)
  const [story, setStory] = useState('')
  const [count, setCount] = useState(Math.max(2, existing || 3))
  const [busy, setBusy] = useState(false)

  async function write() {
    if (existing && !(await ask({ title: 'Replace your shots?', message: 'The shots you have are replaced with new ones written from the story.', confirm: 'Write new shots', danger: true }))) return
    setBusy(true)
    try {
      onShots(await window.ivstudio.prompts.story({ story, shots: count, seconds: shotSeconds, character }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button className="link-btn mono story-toggle" onClick={() => setOpen(true)}>
        ✦ Write all shots from a story
      </button>
    )
  return (
    <div className="writer">
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write all shots from a story</span>
        <button className="link-btn mono" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <textarea rows={4} value={story} placeholder="A few sentences: who, where, what happens and what they say. {char} works here." onChange={(e) => setStory(e.target.value)} />
      <div className="writer-row tight">
        <div className="segmented">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
              {n} shots
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy || !story.trim()} onClick={write}>
          {busy ? 'Writing…' : 'Write the shots'}
        </button>
      </div>
      <p className="small dim writer-note">Uses the free local writer. Each shot follows the join rules so they play as one take.</p>
    </div>
  )
}
