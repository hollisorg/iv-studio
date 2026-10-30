import { useEffect, useState } from 'react'
import Hero from './Hero'
import { SettingsTabs } from './Settings'

const ICON = { ok: '●', warn: '▲', missing: '✕' }
const GROUPS = [
  ['ComfyUI and GPU', (i) => i.id === 'comfyui' || i.id === 'gpu'],
  ['Models', (i) => i.kind === 'model'],
  ['Node packs', (i) => i.kind === 'node_pack'],
  ['Characters', (i) => i.kind === 'character']
]
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const ACTIVE = ['queued', 'downloading', 'verifying']

function ModelAction({ item, dl }) {
  if (item.status === 'ok') return item.size ? <span className="mono dim">{GB(item.size)}</span> : <span />
  const s = dl[item.model]
  if (s && ACTIVE.includes(s.status)) {
    const pct = s.total ? Math.floor((s.received / s.total) * 100) : null
    return (
      <div className="dl">
        <div className="bar">
          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
        </div>
        <span className="mono dim">{s.status === 'queued' ? 'Queued' : s.status === 'verifying' ? 'Checking…' : `${pct}% of ${GB(s.total)}`}</span>
        <button className="link-btn mono" onClick={() => window.ivstudio.models.cancel(item.model)}>
          Pause
        </button>
      </div>
    )
  }
  return (
    <div className="dl">
      {s?.status === 'paused' && <span className="mono dim">Paused</span>}
      <button className="btn btn-small" onClick={() => window.ivstudio.models.download([item.model])}>
        {s?.status === 'paused' ? 'Resume' : 'Download'}
        {item.size ? ` · ${GB(item.size)}` : ''}
      </button>
    </div>
  )
}

export default function Setup({ setup, recheck, checking, remote, go }) {
  const [dl, setDl] = useState({})
  const items = setup?.items || []

  useEffect(() => {
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => {
      setDl((all) => ({ ...all, [u.id]: u }))
      if (u.status === 'done') recheck()
    })
  }, [recheck])

  const missingModels = remote ? [] : items.filter((i) => i.kind === 'model' && i.status !== 'ok' && !i.optional && !ACTIVE.includes(dl[i.model]?.status))
  const missingBytes = missingModels.reduce((n, i) => n + (i.size || 0), 0)
  const errors = Object.entries(dl).filter(([, s]) => s.status === 'error')

  return (
    <div className="setup">
      <Hero title="Settings" kicker="Infinite Variance" />
      <SettingsTabs tab="setup" go={go} setup={setup} />
      <p className="lede">
        IV Studio drives your own ComfyUI. This checks it has everything the workflow needs.
        <span className="lede-small dim">Models download from their upstream hosts straight into ComfyUI's models folder and are checked against the SHA-256 the host publishes. A paused download picks up where it stopped. Node packs install from their GitHub pages.</span>
      </p>
      <div className="setup-actions">
        <button className="btn btn-primary" disabled={checking} onClick={recheck}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
        {missingModels.length > 0 && (
          <button className="btn" onClick={() => window.ivstudio.models.download(missingModels.map((i) => i.model))}>
            Download {missingModels.length} missing model{missingModels.length === 1 ? '' : 's'}
            {missingBytes ? ` · ${GB(missingBytes)}+` : ''}
          </button>
        )}
      </div>
      {errors.map(([id, s]) => (
        <p key={id} className="notice">
          {items.find((i) => i.model === id)?.label || id}: {s.error}
        </p>
      ))}
      {GROUPS.map(([title, test]) => {
        const list = items.filter(test)
        if (!list.length) return null
        return (
          <section key={title} className="group">
            <div className="group-head">
              <h2>{title}</h2>
              <p className="mono dim">
                {list.filter((i) => i.status === 'ok').length}/{list.length} ready
              </p>
            </div>
            <ul className="checks">
              {list.map((i) => (
                <li key={i.id} className={i.status}>
                  <span className="check-icon">{ICON[i.status]}</span>
                  <div>
                    <div>{i.label}</div>
                    <div className="dim small">{i.detail}</div>
                    {i.fix && <div className="small pink">{i.fix}</div>}
                    {i.status !== 'ok' && (i.url || i.page) && (
                      <button className="link-btn mono" onClick={() => window.ivstudio.links.open(i.url || i.page)}>
                        {i.url ? 'Open its GitHub page' : 'Model page and licence'}
                      </button>
                    )}
                  </div>
                  {i.kind === 'model' && !remote ? <ModelAction item={i} dl={dl} /> : <span />}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
