import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ask } from './Confirm'
import StageBoard from './StageBoard'
import { cameraWords, defaultStage, previsWords, stagingWords } from '../../../service/staging'

const HARNESS_NAME = { claude: 'Claude', codex: 'ChatGPT', hermes: 'Hermes' }
// The writers the header's menu switches between (the same setting as Settings → Prompt writer). Context IR is paid per
// prompt, so it's chosen in Settings only; the menu shows it only while it's the one in use.
const WRITERS = [
  ['local', 'Local writer · free'],
  ['claude', 'Claude · your plan'],
  ['codex', 'ChatGPT · your plan'],
  ['hermes', 'Hermes · your plan'],
  ['openai', 'OpenAI-compatible · your server'],
  ['contextir', 'Context IR · paid']
]

// An idea from somewhere else (Create's banner bar, the Dashboard's "What do you want to make?") for Create's own
// writer: it fills in the idea and, with write, writes the prompt straight away. Kept until a listening writer takes
// it, so it survives the move from the Dashboard to Create.
let pendingIdea = null
export function sendIdea(idea, write = true) {
  pendingIdea = { idea: String(idea || '').trim(), write }
  window.dispatchEvent(new CustomEvent('iv:idea'))
}

// Writes that outlive the card that started them (GitHub #40): leaving a sequence while its writer works no longer
// loses the prompt. A write started with a key keeps running; while a card with that key is on screen the result
// goes to it (and it shows "Writing…" when you come back), otherwise to the onLate the last card gave.
const lasting = new Map() // key -> { owner, liveRef, lateRef, done: Set<setBusy> }
export const isWriting = (key) => lasting.has(key)
function useLasting(key, onResult, onLate) {
  const me = useRef({})
  const live = useRef(onResult)
  live.current = onResult
  const late = useRef(onLate)
  late.current = onLate
  const [busy, setBusy] = useState(() => !!(key && lasting.has(key)))
  useEffect(() => {
    if (!key) return
    const e = lasting.get(key)
    if (e) Object.assign(e, { owner: me.current, liveRef: live, lateRef: late }), e.done.add(setBusy), setBusy(true)
    return () => {
      const cur = lasting.get(key)
      if (!cur) return
      if (cur.owner === me.current) cur.owner = null
      cur.done.delete(setBusy)
    }
  }, [key])
  async function run(make, onError) {
    const e = { owner: me.current, liveRef: live, lateRef: late, done: new Set([setBusy]) }
    if (key) lasting.set(key, e)
    setBusy(true)
    try {
      const value = await make()
      if (!key || e.owner) e.liveRef.current?.(value)
      else e.lateRef.current?.(value)
    } catch (err) {
      onError(err)
    } finally {
      if (key && lasting.get(key) === e) lasting.delete(key)
      for (const f of e.done) f(false)
    }
  }
  return [busy, run]
}

// "Write it for me": a plain-words idea in, a finished H3 prompt out. context carries what the writer
// should respect (mode, seconds, aspect, character, media, sequence, previous shot). names: who can go on the
// staging board; its exact screen-side words go to the writer with the idea. onPrevis(clip): the board's grey
// previs clip, for the form to add as a video reference (then the words name it as <Video n>).
// idea + onIdea: the idea kept by the page (a sequence shot saves it). lastingKey + onLate: the write keeps going
// if the card goes away, and onLate gets the prompt then (see useLasting).
// Who writes for one tool: the writer that tool remembers (settings.writers[tool], set from its menu), else Settings →
// Prompt writer's. { status, engine, pick(id), remembered }
export function useToolWriter(tool) {
  const [status, setStatus] = useState(null)
  const [writers, setWriters] = useState({})
  const load = () => {
    window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))
    window.ivstudio.settings.get().then((s) => setWriters(s.writers || {}), () => {})
  }
  useEffect(() => {
    load()
    // another writer on the page (or Settings) switched a writer
    window.addEventListener('iv:writer', load)
    return () => window.removeEventListener('iv:writer', load)
  }, [])
  const engine = (tool && writers[tool]) || status?.engine || 'local'
  async function pick(id) {
    const next = { ...writers, [tool]: id }
    setWriters(next)
    await window.ivstudio.settings.set({ writers: next })
    window.dispatchEvent(new Event('iv:writer'))
  }
  return { status, engine, pick, remembered: !!(tool && writers[tool]) }
}

// The menu of writers for one tool (Write it for me's corner, Music video, Films)
export function WriterMenu({ status, engine, onPick, title = 'Who writes the prompt here. Settings → Prompt writer sets the one every tool starts with.' }) {
  return (
    <select className="writer-engine mono small" aria-label="Who writes the prompt" title={title} value={engine} disabled={!status} onChange={(e) => onPick(e.target.value)}>
      {WRITERS.filter(([id]) => id === engine || (id !== 'contextir' && (id !== 'openai' || status?.openai?.url))).map(([id, label]) => {
        const missing = !status ? false : id === 'local' ? !status.installed : HARNESS_NAME[id] ? !status.harnesses?.[id]?.installed : id === 'openai' ? !status.openai?.model : false
        const text = id === 'contextir' ? `Context IR · ${status?.contextIrPrice?.split(' (')[0] || 'paid'}` : id === 'openai' && status?.openai?.model ? `${status.openai.model} · your server` : label
        return (
          <option key={id} value={id}>
            {text}
            {missing ? ' (not set up)' : ''}
          </option>
        )
      })}
    </select>
  )
}
export function ToolWriter({ tool, notify }) {
  const w = useToolWriter(tool)
  return (
    <span className="writer-engine-pick tool-writer">
      <span className="mono small dim">Writer</span>
      <WriterMenu status={w.status} engine={w.engine} onPick={(id) => w.pick(id).catch((err) => notify?.(err.message))} />
    </span>
  )
}
// Why the chosen writer can't write yet (not installed, not set up), or null when it can.
export function writerBlocker(status, engine) {
  const harness = engine === 'claude' || engine === 'codex' || engine === 'hermes'
  return (
    status &&
    (engine === 'contextir'
      ? !status.hasComfyKey && 'MiniMax Context IR needs your Comfy.org API key.'
      : harness
        ? !status.harnesses?.[engine]?.installed && `${HARNESS_NAME[engine]} isn't installed on this PC.`
        : engine === 'openai'
        ? (!status.openai?.url ? 'Set up the OpenAI-compatible writer in Settings → Prompt writer.' : !status.openai.model ? 'Choose a model for the OpenAI-compatible writer in Settings → Prompt writer.' : !status.openai.ok && `The OpenAI-compatible server isn't answering: ${status.openai.error}`)
        : !status.installed
        ? 'The free writer needs Ollama.'
        : status.running && !status.models.some((m) => m.name === status.model) && `The writer model ${status.model} isn't installed yet.`)
  )
}
// a writer's name for the run history ("written by Claude")
export const writerName = (id) => ({ local: 'the local writer', claude: 'Claude', codex: 'ChatGPT', hermes: 'Hermes', openai: 'your OpenAI-compatible server', contextir: 'Context IR' })[id] || id

export default function PromptWriter({ context, current, onWritten, notify, go, compact = false, names = null, onPrevis = null, listen = false, idea: ideaProp, onIdea, lastingKey = null, onLate = null, tool = 'create' }) {
  const [ideaLocal, setIdeaLocal] = useState('')
  const idea = ideaProp ?? ideaLocal
  const setIdea = onIdea || setIdeaLocal
  // listen (Create's writer only): take ideas sent with sendIdea, and write them when asked to
  const [writeNow, setWriteNow] = useState(false)
  useEffect(() => {
    if (!listen) return
    const take = () => {
      if (!pendingIdea?.idea) return
      setIdea(pendingIdea.idea)
      setWriteNow(!!pendingIdea.write)
      pendingIdea = null
    }
    take()
    window.addEventListener('iv:idea', take)
    return () => window.removeEventListener('iv:idea', take)
  }, [listen])
  const [board, setBoard] = useState(false)
  // the board opens in a pop-up; Cancel puts back what was there (snapshot)
  const [boardOpen, setBoardOpen] = useState(false)
  const snapshot = useRef(null)
  const [stage, setStage] = useState(null)
  const [previs, setPrevis] = useState(null)
  const [drawing, setDrawing] = useState(false)
  // the clip still in the references, as which video
  const previsN = previs ? (context.media || []).filter((m) => m.kind === 'video').findIndex((m) => m.file === previs.file) + 1 : 0
  async function makePrevis() {
    setDrawing(true)
    try {
      const clip = await window.ivstudio.previs.make({ stage, seconds: context.seconds, aspect: context.aspect, name: idea.slice(0, 30) || 'previs' })
      setPrevis({ ...clip, stage })
      onPrevis(clip)
    } catch (err) {
      notify(err.message)
    } finally {
      setDrawing(false)
    }
  }
  // this tool's writer (its menu remembers it per tool)
  const { status, engine: chosen, pick } = useToolWriter(tool)
  const [undo, setUndo] = useState(null)
  // the prompt goes back with who wrote it, for the run's history
  const [busy, run] = useLasting(lastingKey, (text) => (setUndo(current || ''), onWritten(text, chosen)), onLate)
  async function pickWriter(id) {
    try {
      await pick(id)
    } catch (err) {
      notify(err.message)
    }
  }

  // Context IR is MiniMax's H3 rewriter: a Seedance shot is written by the local writer instead
  const engine = context.engine === 'seedance' && chosen === 'contextir' ? 'local' : chosen
  const harness = engine === 'claude' || engine === 'codex' || engine === 'hermes'
  const blocker = writerBlocker(status, engine)

  // What the local writer will look at: pictures, frames from videos, or the clip a Continue shot carries on.
  const visual = (context.media || []).filter((m) => m.kind === 'picture' || m.kind === 'video')
  const sees = engine === 'openai' ? status?.openai?.vision : status?.models?.find((m) => m.name === status.model)?.vision
  const seeing =
    harness && visual.length > 0
      ? `${HARNESS_NAME[engine]} looks at your ${visual.length === 1 ? (visual[0].kind === 'video' ? 'video' : 'picture') : `${visual.length} references`} and writes what it sees${engine === 'hermes' ? ', if its model takes pictures' : ''}.`
      : (engine === 'local' && status?.running) || (engine === 'openai' && status?.openai?.ok) ? (visual.length > 0
      ? sees
        ? `Looks at your ${visual.length === 1 ? (visual[0].kind === 'video' ? 'video' : 'picture') : `${visual.length} references`} and writes what it sees.`
        : engine === 'openai'
          ? `The OpenAI-compatible writer is set to not see pictures; turn on "It can see pictures" in Settings if ${status.openai.model} can.`
          : `${status.model} can't see pictures; choose a model marked "sees pictures" in Settings to have it look at your references.`
      : null)
      : null

  useEffect(() => {
    if (writeNow && idea.trim() && status) (setWriteNow(false), write())
  }, [writeNow, idea, status])

  async function write() {
    const staged =
      (board && stage?.people?.length ? `${idea.trim()}\nStaging (follow it exactly): ${stagingWords(stage)}\nCamera: ${cameraWords(stage)}.` : idea) +
      (previsN ? `\n${previsWords(previs.stage, previsN)} Say so in the prompt, with these words.` : '')
    await run(() => window.ivstudio.prompts.write({ ...context, idea: staged, writer: engine }), (err) => notify(err.message))
  }

  return (
    <div className={`writer ${compact ? 'compact' : ''}`}>
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write it for me</span>
        <span className="writer-engine-pick">
          <WriterMenu status={status} engine={engine} onPick={pickWriter} />
          {context.engine === 'seedance' && <span className="mono dim small"> · Seedance guide</span>}
        </span>
      </div>
      <div className="writer-row">
        <textarea rows={compact ? 2 : 2} value={idea} placeholder={context.sequence ? 'What happens in this shot, in plain words' : 'Your idea in plain words, e.g. Tess in a parked car at night admits she kept the letter'} onChange={(e) => setIdea(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !idea.trim() || !!blocker} onClick={write}>
          {busy ? 'Writing…' : current?.trim() ? 'Rewrite prompt' : 'Write my prompt'}
        </button>
      </div>
      {names && (
        <div className="writer-staged">
          {board && stage?.people?.length ? (
            <>
              <span className="small">
                <span className="mono pink">✦ Staged:</span> <span className="dim">{stagingWords(stage)} {cameraWords(stage)}.</span>
                {previsN ? <span className="dim"> Previs clip added.</span> : null}
              </span>
              <button className="btn btn-small" onClick={() => ((snapshot.current = { stage, board }), setBoardOpen(true))}>
                Edit the staging
              </button>
            </>
          ) : (
            <button
              className="link-btn mono small writer-stage"
              onClick={() => {
                snapshot.current = { stage, board }
                if (!stage) setStage(defaultStage(names.slice(0, 1)))
                setBoardOpen(true)
              }}
            >
              ✦ Stage it on a board
            </button>
          )}
        </div>
      )}
      {names && boardOpen && (
        <StagePop
          stage={stage}
          names={names}
          setStage={setStage}
          staged={board}
          previsN={previsN}
          drawing={drawing}
          canPrevis={!!onPrevis}
          makePrevis={makePrevis}
          onUse={() => (setBoard(true), setBoardOpen(false))}
          onRemove={() => (setBoard(false), setBoardOpen(false))}
          onCancel={() => {
            setStage(snapshot.current?.stage ?? null)
            setBoard(!!snapshot.current?.board)
            setBoardOpen(false)
          }}
        />
      )}
      {seeing && !blocker && <p className={`small writer-note ${sees ? 'dim' : 'pink'}`}>✦ {seeing}</p>}
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

// The staging board in its own pop-up: the floor seen from above, big enough to place people and the camera, with
// the words it becomes, the previs clip, and Use / Cancel. Esc or the backdrop cancels.
function StagePop({ stage, names, setStage, staged, previsN, drawing, canPrevis, makePrevis, onUse, onRemove, onCancel }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal stage-pop" role="dialog" aria-label="Stage it on a board">
        <div className="source-head">
          <h2>Stage it on a board</h2>
          <button className="link-btn mono" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="dim small">The floor seen from above. Drag people and the camera, turn them by their small dot, and pick the lens and the move. The writer follows it exactly: who stands where, who looks at whom, and what the camera does.</p>
        <StageBoard stage={stage} names={names} start={names.slice(0, 1)} onChange={setStage} />
        {canPrevis && (
          <p className="small stage-pop-previs">
            <button className="btn btn-small" disabled={drawing || !stage?.people?.length} onClick={makePrevis}>
              {drawing ? 'Drawing…' : previsN ? 'Draw the previs again' : 'Make a previs clip'}
            </button>{' '}
            <span className="dim">{previsN ? `The previs is <Video ${previsN}> in your references; H3 is told to follow its camera move.` : 'A grey clip of the camera move, added as a reference. Worth it for an arc round people; a push, track or walk works as well from the words.'}</span>
          </p>
        )}
        <div className="modal-foot">
          {staged && (
            <button className="link-btn mono small" onClick={onRemove}>
              Leave the staging to the writer
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!stage?.people?.length} onClick={onUse}>
            Use this staging
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// The shot count picked for each sequence's story (by lastingKey), so it outlasts leaving the sequence, also while
// its shots are being written and the sequence still has the old number of shots (GitHub #43).
const pickedCounts = new Map()

// A short story -> every shot of a sequence (the writer chosen in Settings; Context IR falls back to the local one).
// story + onStory: the story kept by the page; lastingKey + onLate as PromptWriter's (GitHub #40).
export function StoryWriter({ character, shotSeconds, existing, onShots, notify, story: storyProp, onStory, lastingKey = null, onLate = null }) {
  const [busy, run] = useLasting(lastingKey, onShots, onLate)
  const [open, setOpen] = useState(() => !!storyProp || busy)
  const [storyLocal, setStoryLocal] = useState('')
  const story = storyProp ?? storyLocal
  const setStory = onStory || setStoryLocal
  const [count, setCountNow] = useState(() => (lastingKey && pickedCounts.get(lastingKey)) || Math.max(2, existing || 3))
  const setCount = (n) => {
    if (lastingKey) pickedCounts.set(lastingKey, n)
    setCountNow(n)
  }

  async function write() {
    if (existing && !(await ask({ title: 'Replace your shots?', message: 'The shots you have are replaced with new ones written from the story.', confirm: 'Write new shots', danger: true }))) return
    await run(() => window.ivstudio.prompts.story({ story, shots: count, seconds: shotSeconds, character }), (err) => notify(err.message))
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
      <p className="small dim writer-note">Uses the writer chosen in Settings (the local one if that's Context IR). Each shot follows the join rules so they play as one take.</p>
    </div>
  )
}

// Write it for me on the Images page: the idea in plain words, the prompt written for the chosen picture model with
// its own guide (service/imagewriter.js). With no idea but a prompt, it rewrites that prompt for this model. The
// menu is the Images page's own writer (remembered like every tool's); Context IR writes H3 shots only, so pictures
// go to the local writer then. A model that uses a negative prompt gets one written too.
export function ImageWriter({ family, familyLabel, model, mode, aspect, refs = [], triggers = [], current = '', negative = '', usesNegative = false, onWritten, notify, go }) {
  const [idea, setIdea] = useState('')
  const { status, engine: chosen, pick } = useToolWriter('images')
  const engine = chosen === 'contextir' ? 'local' : chosen
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState(null)
  const blocker = writerBlocker(status, engine)
  const edit = mode === 'edit'
  const harness = engine === 'claude' || engine === 'codex' || engine === 'hermes'
  const sees = harness || (engine === 'openai' ? status?.openai?.vision : status?.models?.find((m) => m.name === status.model)?.vision)
  const rewriteOnly = !idea.trim() && !!current.trim()
  async function write() {
    setBusy(true)
    try {
      const out = await window.ivstudio.prompts.image({ family, model, mode, aspect, idea: idea.trim(), current, refs, triggers, writer: engine })
      setUndo({ prompt: current, negative })
      onWritten(out, engine)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="writer image-writer">
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write it for me</span>
        <span className="writer-engine-pick">
          <WriterMenu status={status} engine={engine} onPick={(id) => pick(id).catch((err) => notify(err.message))} title="Who writes the prompt on the Images page. Settings → Prompt writer sets the one every tool starts with." />
          <span className="mono dim small"> · {familyLabel} guide</span>
        </span>
      </div>
      <div className="writer-row">
        <textarea rows={2} value={idea} placeholder={edit ? 'What to change, in plain words, e.g. make it night and keep her face' : 'Your idea in plain words, e.g. an old farmer in a golden field at sunset'} onChange={(e) => setIdea(e.target.value)} aria-label="Your idea in plain words" />
        <button className="btn btn-primary" disabled={busy || (!idea.trim() && !current.trim()) || !!blocker} onClick={write} title={rewriteOnly ? `Rewrites the prompt below the way ${familyLabel} reads prompts` : undefined}>
          {busy ? 'Writing…' : rewriteOnly ? `Rewrite for ${familyLabel}` : current.trim() ? 'Rewrite prompt' : 'Write my prompt'}
        </button>
      </div>
      {edit && refs.length > 0 && !blocker && (
        <p className={`small writer-note ${sees ? 'dim' : 'pink'}`}>
          ✦ {sees ? `Looks at your ${refs.length === 1 ? 'picture' : `${refs.length} pictures`} and writes the change for them.` : engine === 'openai' ? `The OpenAI-compatible writer is set to not see pictures, so it writes from your words alone.` : `${status?.model || 'The writer model'} can't see pictures, so it writes from your words alone.`}
        </p>
      )}
      {blocker && (
        <p className="small pink writer-note">
          {blocker}{' '}
          <button className="link-btn" onClick={() => go('settings')}>
            Set it up in Settings
          </button>
        </p>
      )}
      {undo && !busy && (
        <p className="small dim writer-note">
          Prompt written below{usesNegative ? ', with a negative prompt under More' : ''}; edit it freely.{' '}
          <button
            className="link-btn"
            onClick={() => {
              onWritten(undo, null)
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
