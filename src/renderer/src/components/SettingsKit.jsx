import { useState } from 'react'

// The pieces Settings is built from: a numbered card per topic, a labelled row inside it, a switch, a small
// status pill and a copyable code block. Kept apart so Update.jsx can use them too without a circular import.

export function SetCard({ id, n, title, sub, aside, children, foot }) {
  return (
    <section id={`set-${id}`} className="set-card" data-set={id}>
      <header className="set-card-head">
        <span className="set-card-n">{String(n).padStart(2, '0')}</span>
        <div className="set-card-title">
          <h2>{title}</h2>
          {sub && <p className="dim small">{sub}</p>}
        </div>
        {aside && <div className="set-card-aside">{aside}</div>}
      </header>
      <div className="set-card-body">{children}</div>
      {foot && <p className="set-card-foot small dim">{foot}</p>}
    </section>
  )
}

// One setting: its name on the left, the control and a line of help on the right.
export function SetField({ label, tag, hint, children, warn }) {
  return (
    <div className="set-field">
      <div className="set-field-label">
        <span>{label}</span>
        {tag && <span className="set-field-tag mono">{tag}</span>}
      </div>
      <div className="set-field-ctl">
        {children}
        {warn && <p className="set-hint pink">{warn}</p>}
        {hint && <p className="set-hint">{hint}</p>}
      </div>
    </div>
  )
}

export function SetSwitch({ checked, onChange, children, disabled = false }) {
  return (
    <label className={`switch-toggle set-switch ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
      <span>{children}</span>
    </label>
  )
}

// ok (green), warn (pink) or plain
export function Pill({ tone = '', children, title }) {
  return (
    <span className={`set-pill ${tone}`} title={title}>
      {tone && <i aria-hidden="true" />}
      {children}
    </span>
  )
}

// A path, kept on one line; the whole path shows on hover.
export function SetPath({ path, empty = 'Not set' }) {
  return (
    <span className={`set-path mono ${path ? '' : 'dim'}`} title={path || ''}>
      {path || empty}
    </span>
  )
}

// A block of code with its Copy button in the corner.
export function SetCode({ text, label = 'Copy', tall }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={`set-code ${tall ? 'tall' : ''}`}>
      <pre>{text}</pre>
      <button
        className="btn btn-small set-code-copy"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied ✓' : label}
      </button>
    </div>
  )
}
