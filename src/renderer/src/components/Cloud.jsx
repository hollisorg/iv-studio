import { useEffect, useRef, useState } from 'react'
import Hero from './Hero'

const IDLE = [
  [180, '3 min'],
  [300, '5 min'],
  [600, '10 min'],
  [1200, '20 min']
]

function Step({ n, title, done, children }) {
  return (
    <section className={`group cloud-step ${done ? 'done' : ''}`}>
      <div className="group-head">
        <h2>
          <span className="mono dim cloud-n">{String(n).padStart(2, '0')}</span> {title}
        </h2>
        <p className={`mono small ${done ? 'cloud-ok' : 'dim'}`}>{done ? '● Done' : 'To do'}</p>
      </div>
      <div className="group-body">{children}</div>
    </section>
  )
}

// Cloud mode on the user's own Modal account: install the tools, sign in, set up, then switch.
export default function Cloud({ notify, recheck, setup, info }) {
  const [st, setSt] = useState(null)
  const [gpu, setGpu] = useState('L40S')
  const [idle, setIdle] = useState(300)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const [wake, setWake] = useState(null)
  const logEl = useRef(null)

  const refresh = () =>
    window.ivstudio.cloud.status().then((s) => {
      setSt(s)
      if (s.cloud?.gpu) setGpu(s.cloud.gpu)
      if (s.cloud?.idleSeconds) setIdle(s.cloud.idleSeconds)
    })

  useEffect(() => {
    refresh()
    return window.ivstudio.cloud.onLog((line) => setLog((l) => [...l.slice(-400), line]))
  }, [])
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log])

  async function run(label, fn) {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  async function setUp() {
    await run('Setting up', async () => {
      await window.ivstudio.cloud.deploy({ gpu, idleSeconds: idle })
      await window.ivstudio.cloud.fetchModels()
      await window.ivstudio.cloud.uploadCharacters()
    })
  }

  async function use(target) {
    await run(target === 'cloud' ? 'Waking the cloud GPU' : 'Switching', async () => {
      await window.ivstudio.cloud.use(target)
      if (target === 'cloud') {
        setWake('waking')
        const w = await window.ivstudio.cloud.wake()
        setWake(`Cloud GPU ready${w.gpu ? ` (${w.gpu.replace(/^cuda:\d+ /, '').replace(/ : \w+$/, '')})` : ''} in ${w.seconds} s.`)
      } else setWake(null)
      await recheck()
    })
  }

  if (!st) return null
  const chosen = st.gpus.find((g) => g.id === gpu)
  const setUpDone = !!(st.cloud?.url && st.cloud?.modelsAt)
  const onCloud = st.target === 'cloud'

  return (
    <div className="cloud">
      <Hero title="Cloud" kicker="Your own GPU · by the second" />
      <p className="lede">
        No strong graphics card? Render on a cloud GPU in your own Modal account.
        <span className="lede-small dim">
          Modal bills by the second only while a render runs, shuts the GPU down by itself when you stop, and gives new accounts $30 of free compute a month. IV Studio sets everything up; you just sign in.
        </span>
      </p>

      <div className="cloud-switch">
        <div className="segmented">
          <button className={!onCloud ? 'on' : ''} disabled={!!busy} onClick={() => use('local')}>
            My PC
          </button>
          <button className={onCloud ? 'on' : ''} disabled={!!busy || !setUpDone} onClick={() => use('cloud')}>
            Cloud
          </button>
        </div>
        <span className="mono small dim">{busy ? `${busy}…` : onCloud ? wake || 'Rendering in the cloud.' : 'Rendering on this PC.'}</span>
      </div>

      <Step n={1} title="Cloud tools" done={st.toolkit}>
        <p className="small dim">A private copy of Modal's client in IV Studio's own folder (about 100 MB). Nothing else on your PC changes.</p>
        {!st.toolkit && (
          <button className="btn btn-small" disabled={!!busy} onClick={() => run('Installing', () => window.ivstudio.cloud.install())}>
            Install the cloud tools
          </button>
        )}
      </Step>

      <Step n={2} title="Modal account" done={!!st.workspace}>
        {st.workspace ? (
          <p className="small">
            Signed in to the Modal workspace <span className="mono">{st.workspace}</span>.
          </p>
        ) : (
          <>
            <p className="small dim">
              Opens Modal's sign-in page in your browser. New to Modal? Signing up is free.{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open(info?.links?.modalSignup || 'https://modal.com/signup')}>
                Create an account
              </button>
              {info?.links?.modalSignup && (
                <span className="cloud-support">
                  {' '}
                  This is IV Studio's referral link: signing up through it supports the app, and costs you nothing extra.
                </span>
              )}
            </p>
            <button className="btn btn-small" disabled={!!busy || !st.toolkit} onClick={() => run('Waiting for Modal sign-in', () => window.ivstudio.cloud.signIn())}>
              Sign in with Modal
            </button>
          </>
        )}
      </Step>

      <Step n={3} title="GPU and shut-off" done={!!st.cloud?.url}>
        <div className="cloud-gpus">
          {st.gpus.map((g) => (
            <button key={g.id} className={`mode-card ${gpu === g.id ? 'on' : ''}`} onClick={() => setGpu(g.id)}>
              <span className="mode-name">{g.label}</span>
              <span className="mono">${g.perHour.toFixed(2)} an hour, by the second</span>
              <span className="dim small">{g.note}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="row-label">Shut down after</span>
          <div className="segmented">
            {IDLE.map(([s, label]) => (
              <button key={s} className={idle === s ? 'on' : ''} onClick={() => setIdle(s)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="small dim">
          With nothing to do for {IDLE.find(([s]) => s === idle)?.[1]}, the GPU switches off and billing stops. The next render wakes it again (about 1–3 minutes). Storage for the models is free on Modal (first 1 TiB).
          {chosen && ` A 10-second 2 MP shot takes roughly 3–5 minutes of GPU, about $${((chosen.perHour * 4) / 60).toFixed(2)}.`}
        </p>
      </Step>

      <Step n={4} title="Set up" done={setUpDone}>
        <p className="small dim">
          Builds IV Studio's cloud image (ComfyUI and every node pack, matched to this version), downloads the H3 models into your Modal storage (about 60 GB, once), and uploads your characters. The first time takes 20–40 minutes and costs a few cents of CPU time. Run it again after changing GPU or adding characters.
        </p>
        <button className="btn btn-primary" disabled={!!busy || !st.workspace} onClick={setUp}>
          {setUpDone ? 'Set up again' : 'Set up the cloud'}
        </button>
        {st.cloud?.url && (
          <p className="mono small dim">
            {st.cloud.gpu} · shuts down after {Math.round(st.cloud.idleSeconds / 60)} min · {st.cloud.workspace}
          </p>
        )}
      </Step>

      {(log.length > 0 || busy) && (
        <pre className="code cloud-log" ref={logEl}>
          {log.join('\n') || 'Starting…'}
        </pre>
      )}

      <section className="group">
        <div className="group-head">
          <h2>What's different in the cloud</h2>
        </div>
        <div className="group-body">
          <p className="small dim">
            Everything in Create, Sequences and the prompt writer works the same. The final DLSS clean-up only runs on Windows, so cloud finals use a 2× AI upscale (Real-ESRGAN) and frame interpolation (RIFE, 48/72/120 fps) instead. Finished videos download to Videos\IV Studio when you open them.
          </p>
        </div>
      </section>
    </div>
  )
}
