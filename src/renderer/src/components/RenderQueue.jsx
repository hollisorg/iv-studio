import { useEffect, useState } from 'react'
import { ask } from './Confirm'

// The render queue at the foot of the sidebar: what ComfyUI is rendering and what waits, from any page, so the
// person can explore the app while things render. Each of IV Studio's items opens its page and can be cancelled;
// anyone else's work on the same ComfyUI shows as "Other ComfyUI work".
const KIND = {
  previews: 'Previews',
  finish: 'Finishing',
  take: 'Sequence take',
  shots: 'Sequence shot',
  retake: 'Retake',
  renderout: 'Render out',
  music: 'Song',
  replace: 'Replace',
  still: 'Picture',
  write_prompt: 'Prompt writer'
}
const kindLabel = (k) => (k?.startsWith('picture') ? 'Picture' : KIND[k] || 'Render')
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const SHOWN = 4

export default function RenderQueue({ remote, notify, open }) {
  const [items, setItems] = useState([])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let live = true
    const poll = () =>
      window.ivstudio.queue
        .list()
        .then((q) => live && setItems(q.items))
        .catch(() => live && setItems([]))
    poll()
    const p = setInterval(poll, remote ? 10000 : 2000)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      live = false
      clearInterval(p)
      clearInterval(t)
    }
  }, [remote])

  async function cancel(item) {
    const ok = await ask({ title: 'Cancel this render?', message: `${item.name || kindLabel(item.kind)} stops ${item.state === 'running' ? 'now; what it rendered so far is lost' : 'and leaves the queue'}.`, confirm: 'Cancel render' })
    if (!ok) return
    try {
      await window.ivstudio.queue.cancel(item.promptId)
      setItems((all) => all.filter((i) => i.promptId !== item.promptId))
    } catch (err) {
      notify(err.message)
    }
  }

  const running = items.filter((i) => i.state === 'running').length
  const waiting = items.length - running
  return (
    <div className={`render-queue ${items.length ? 'busy' : ''}`}>
      <div className="render-queue-head">
        <span>Queue</span>
        <span className="dim">{items.length ? [running && `${running} rendering`, waiting && `${waiting} waiting`].filter(Boolean).join(' · ') : 'idle'}</span>
      </div>
      {items.slice(0, SHOWN).map((item) => {
        const pct = item.progress?.max ? Math.round((item.progress.value / item.progress.max) * 100) : null
        return (
          <div key={item.promptId} className={`render-queue-item ${item.state}`}>
            <button className="render-queue-open" disabled={!item.ours} onClick={() => open(item)} title={item.ours ? 'Open it' : 'Not started by IV Studio'}>
              <span className="render-queue-name">{item.ours ? item.name || kindLabel(item.kind) : 'Other ComfyUI work'}</span>
              <span className="render-queue-state dim">
                {item.ours && item.name ? `${kindLabel(item.kind)} · ` : ''}
                {item.state === 'running' ? (item.progress ? `step ${item.progress.value}/${item.progress.max}` : 'rendering') : `waiting · #${item.position}`}
                {item.state === 'running' && item.startedAt ? ` · ${clock(now - item.startedAt)}` : ''}
              </span>
              {item.state === 'running' && (
                <span className="render-queue-bar">
                  <span style={{ width: `${pct ?? 0}%` }} />
                </span>
              )}
            </button>
            {item.ours && (
              <button className="render-queue-x" title="Cancel this render" onClick={() => cancel(item)}>
                ×
              </button>
            )}
          </div>
        )
      })}
      {items.length > SHOWN && <div className="render-queue-more dim">+ {items.length - SHOWN} more waiting</div>}
    </div>
  )
}
