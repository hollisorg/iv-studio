import { useEffect, useRef, useState } from 'react'

// IV Studio's own confirmation dialog, in place of the system box:
//   if (await ask({ title: 'Delete "Theo"?', message: 'Its videos stay on disk.', confirm: 'Delete', danger: true })) ...
// <ConfirmHost /> is mounted once in App and shows whatever ask() requests.
let open = null
export function ask(options) {
  return new Promise((resolve) => (open ? open({ ...options, resolve }) : resolve(window.confirm([options.title, options.message].filter(Boolean).join('\n\n')))))
}

export function ConfirmHost() {
  const [req, setReq] = useState(null)
  const okRef = useRef(null)
  useEffect(() => {
    open = setReq
    return () => (open = null)
  }, [])
  useEffect(() => {
    if (!req) return
    okRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') answer(false)
      else if (e.key === 'Enter') answer(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  function answer(yes) {
    req.resolve(yes)
    setReq(null)
  }
  if (!req) return null
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className={`modal confirm ${req.danger ? 'danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <p className="mono label">{req.kicker || (req.danger ? 'Are you sure?' : 'Confirm')}</p>
        <h2 id="confirm-title">{req.title}</h2>
        {req.message && <p className="confirm-message">{req.message}</p>}
        {req.details && (
          <dl className="confirm-details">
            {req.details.map(([k, v]) => (
              <div key={k}>
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="modal-foot">
          <span className="spacer" />
          <button className="btn btn-small" onClick={() => answer(false)}>
            {req.cancel || 'Cancel'}
          </button>
          <button ref={okRef} className={`btn btn-small ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)}>
            {req.confirm || 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
