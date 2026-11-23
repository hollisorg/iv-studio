import { useEffect, useRef, useState } from 'react'
import Stage from './Stage'
import WorkflowExample from './WorkflowExample'
import { WORKFLOWS } from '../workflows'

// Each tool card's own art (assets/workflows/<page>.webp), drawn in the page banners' style and faded behind the
// card's text (docs/art/README.md). A tool without a picture just shows the plain card.
const CARD_ART = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/workflows/*.webp', { eager: true, import: 'default' })).map(([file, url]) => [file.split('/').pop().replace('.webp', ''), url])
)

// Tools that take a video further. Each is its own page; they and what each needs are in workflows.js.
const TOOLS = WORKFLOWS

// A card is a box, not a button, so it can hold two: the whole card opens the tool (workflow-open, stretched over
// it), and Example opens a pop-up with a real example (WorkflowExample.jsx), for tools that have one.
export default function Workflows({ go }) {
  const [showing, setShowing] = useState(null)
  const [dir, setDir] = useState(null)
  const opener = useRef(null)
  useEffect(() => {
    if (showing && !dir) window.ivstudio.app.info().then((i) => setDir(i.examplesDir || null))
  }, [showing, dir])
  const close = () => {
    setShowing(null)
    // focus goes back to the Example button that opened it
    setTimeout(() => opener.current?.focus(), 0)
  }
  return (
    <div className="workflows">
      <Stage effect="cogs" art="workflows" title="Workflows" kicker="Take a video further" />
      <p className="lede">
        Tools for what comes after a render.
        <span className="lede-small dim">Each one works with your IV Studio renders and characters, and agents can use them through IV Studio's MCP.</span>
      </p>
      <div className="workflow-cards">
        {TOOLS.map((t) => (
          <div key={t.page} className="workflow-card">
            {CARD_ART[t.page] && <span className="workflow-art" aria-hidden="true" style={{ '--card-art': `url("${CARD_ART[t.page]}")` }} />}
            <button className="workflow-open" onClick={() => go(t.page)}>
              <span className="mono pink">{t.tag}</span>
              <span className="workflow-name">{t.name}</span>
              <span className="small dim">{t.about}</span>
              <span className="workflow-needs small">
                <span className="mono pink">Needs</span> {t.needs.join(' · ')}
              </span>
            </button>
            {t.example && (
              <button
                className="btn btn-small workflow-example"
                aria-label={`Example of ${t.name}`}
                onClick={(e) => {
                  opener.current = e.currentTarget
                  setShowing(t)
                }}
              >
                <span aria-hidden="true">▶</span> Example
              </button>
            )}
          </div>
        ))}
      </div>
      {showing && <WorkflowExample workflow={showing} dir={dir} onClose={close} onTry={() => (setShowing(null), go(showing.page))} />}
    </div>
  )
}
