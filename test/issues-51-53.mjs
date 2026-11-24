// GitHub #51, #52 and #53.
// #51: Your Pictures' viewer keeps its buttons inside the window and its info line inside the side column.
// #52: Lines can say how a line is said with VoxCPM2's control, CFG and steps (voices.js lineTuning,
//      voice_server.py), and the agent's speak_line takes them too.
// #53: Setup items can be marked as not used (setup.js markNotUsed): they stop counting as things to fix.
//   node test/issues-51-53.mjs [python]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanNotUsed, markNotUsed } from '../src/service/setup.js'
import { readSettings, writeSettings } from '../src/service/paths.js'
import { LINE_TUNING, lineTuning, Voices } from '../src/service/voices.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}
const src = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---------- #51 ----------
const css = src('src/renderer/src/studio.css')
const side = /\.image-viewer-side \{([^}]*)\}/.exec(css)?.[1] || ''
check('the viewer’s side column has a height limit, so its buttons stay inside', /max-height: calc\(90vh - 36px\)/.test(side) && /overflow-y: auto/.test(side), side)
check('the side column never scrolls sideways', /overflow-x: hidden/.test(side) && /min-width: 0/.test(side))
check('the info line breaks a long model file name anywhere', /\.image-viewer-meta \{[^}]*overflow-wrap: anywhere/.test(css))
check('the seed and “n of n” stay whole', /\.image-viewer-keep \{[^}]*white-space: nowrap/.test(css))
const images = src('src/renderer/src/components/Images.jsx')
const viewer = images.slice(images.indexOf('function ImageViewer'))
check('the viewer puts the seed and the count in their own unbroken parts', (viewer.match(/image-viewer-keep/g) || []).length === 2 && viewer.includes('image-viewer-model'))
check('the viewer’s other actions are small buttons, the first stays primary', (viewer.match(/className="btn btn-small"/g) || []).length === 5 && viewer.includes('className="btn btn-primary" onClick={() => onShot(file)}'))
check('on a narrow window the viewer stacks', /@media \(max-width: 900px\) \{\s*\.image-viewer \{\s*grid-template-columns: minmax\(0, 1fr\)/.test(css))

// ---------- #52 ----------
check('no tuning says it as before', JSON.stringify(lineTuning({})) === '{}' && JSON.stringify(lineTuning({ control: '  ', cfg: 2, steps: 10 })) === '{}')
check('a control is kept, without brackets or line breaks', lineTuning({ control: ' (whispering)\n out of breath ' }).control === 'whispering out of breath')
check('a control is at most 200 characters', lineTuning({ control: 'x'.repeat(500) }).control.length === LINE_TUNING.controlMax)
check('CFG is kept to 1.0 to 3.0, to a tenth', lineTuning({ cfg: 9 }).cfg === 3 && lineTuning({ cfg: 0 }).cfg === 1 && lineTuning({ cfg: '2.46' }).cfg === 2.5)
check('steps are kept to 4 to 30, whole', lineTuning({ steps: 1 }).steps === 4 && lineTuning({ steps: 99 }).steps === 30 && lineTuning({ steps: '12.4' }).steps === 12)
check('empty or unreadable numbers are left out', JSON.stringify(lineTuning({ cfg: '', steps: 'abc' })) === '{}')

// speak, with the engine stood in for: the defaults keep the old file name; a tuned line gets its own
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-51-53-'))
const wav = () => {
  const b = Buffer.alloc(44 + 4800)
  b.write('RIFF', 0)
  b.write('WAVE', 8)
  b.writeUInt32LE(48000, 28)
  b.write('data', 36)
  b.writeUInt32LE(4800, 40)
  return b
}
const calls = []
const voices = new Voices({ dataDir: tmp, resourcesDir: tmp, ffmpeg: 'ffmpeg' })
voices.get = () => ({ id: 'v1', name: 'Ana', reference: path.join(tmp, 'ref.wav'), text: 'hello there', seed: 41 })
voices.releaseSoon = () => {}
voices.eng = () => ({
  call: async (op, a) => {
    calls.push({ op, ...a })
    fs.mkdirSync(path.dirname(a.out), { recursive: true })
    fs.writeFileSync(a.out, wav())
    return { file: a.out }
  }
})
const plain = await voices.speak({ voiceId: 'v1', text: 'Run.' })
const oldName = `v1_${createHash('sha1').update(['Run.', 'voxcpm2', 41, 'hello there'].join('\u0000')).digest('hex').slice(0, 12)}.wav`
check('a line said the old way keeps its old file name', path.basename(plain.file) === oldName, path.basename(plain.file))
check('a line said the old way sends no control, CFG or steps', !('control' in calls[0]) && !('cfg' in calls[0]) && !('steps' in calls[0]))
const tuned = await voices.speak({ voiceId: 'v1', text: 'Run.', control: 'whispering', cfg: 2.6, steps: 20 })
check('a tuned line is its own file', tuned.file !== plain.file && calls.length === 2)
check('a tuned line sends its control, CFG and steps to the engine', calls[1].control === 'whispering' && calls[1].cfg === 2.6 && calls[1].steps === 20 && calls[1].ref_text === 'hello there')
check('Lines keeps how it was said', tuned.control === 'whispering' && tuned.cfg === 2.6 && tuned.steps === 20 && voices.lines()[0].control === 'whispering')
await voices.speak({ voiceId: 'v1', text: 'Run.', control: 'whispering', cfg: 2.6, steps: 20 })
check('the same tuned line comes back from the cache', calls.length === 2)
await voices.sayTo({ voiceId: 'v1', text: 'Go.', out: path.join(tmp, 'swap.wav'), cfg: 1.5 })
check('Replace’s voice swap can take the same options', calls[2]?.cfg === 1.5 && !('control' in calls[2]))
fs.rmSync(tmp, { recursive: true, force: true })

// voice_server.py itself, with a stand-in for VoxCPM: what generate() is asked for
const PY = process.argv[2] || process.env.IV_TEST_PYTHON || ['python', 'python3'].find((p) => spawnSync(p, ['--version']).status === 0) || 'python'
const probe = `
import json, sys
sys.path.insert(0, ${JSON.stringify(path.resolve('resources/python'))})
import voice_server as vs
seen = []
class TTS:
    def generate(self, **kw):
        seen.append(kw)
        return [0.0]
e = vs.Engine("x")
e.voxcpm = lambda: TTS()
e.seeded = lambda s: None
e.save = lambda wav, out: {"file": out}
e.handle({"op": "speak", "text": "Hi.", "out": "o.wav", "ref_wav": "r.wav", "ref_text": "hello", "seed": 1})
e.handle({"op": "speak", "text": "Hi.", "out": "o.wav", "ref_wav": "r.wav", "ref_text": "hello", "seed": 1, "control": "whispering", "cfg": 2.5, "steps": 16})
e.handle({"op": "speak", "text": "Hi.", "out": "o.wav", "ref_wav": "r.wav", "ref_text": "hello", "cfg": 9, "steps": 1})
e.handle({"op": "design", "text": "Hi.", "description": "an old man", "out": "o.wav", "cfg": 1.4, "steps": 12})
print(json.dumps(seen))
`
const r = spawnSync(PY, ['-c', probe], { encoding: 'utf8' })
if (r.status !== 0) check('voice_server.py runs', false, (r.stderr || r.error?.message || '').slice(-300))
else {
  const [a, b, c, d] = JSON.parse(r.stdout.trim().split('\n').pop())
  check('the engine says a plain line as before: continuing the recording, CFG 2.0, 10 steps', a.prompt_wav_path === 'r.wav' && a.prompt_text === 'hello' && a.cfg_value === 2 && a.inference_timesteps === 10 && a.text === 'Hi.')
  check('with a control it clones from the reference alone, control in front', b.text === '(whispering)Hi.' && !('prompt_wav_path' in b) && !('prompt_text' in b) && b.reference_wav_path === 'r.wav')
  check('the engine uses the CFG and steps it is given', b.cfg_value === 2.5 && b.inference_timesteps === 16)
  check('the engine keeps CFG and steps in range itself', c.cfg_value === 3 && c.inference_timesteps === 4)
  check('designing a voice takes CFG and steps too', d.cfg_value === 1.4 && d.inference_timesteps === 12 && d.text === '(an old man)Hi.')
}
check('the cloud voice host passes control, CFG and steps on', /for k in \("text", "description", "ref_text", "seed", "control", "cfg", "steps"\)/.test(src('resources/cloud/voicehost.py')))
const mcp = src('src/mcp/server.js')
const speakTool = mcp.slice(mcp.indexOf("tool('speak_line'"), mcp.indexOf("tool('list_lines'"))
check('speak_line takes control, cfg and steps', /control: z\.string\(\)\.max\(200\)/.test(speakTool) && /cfg: z\.number\(\)\.min\(1\)\.max\(3\)/.test(speakTool) && /steps: z\.number\(\)\.int\(\)\.min\(4\)\.max\(30\)/.test(speakTool) && speakTool.includes('voices.speak({ voiceId: id, text, seed, control, cfg, steps })'))
const vjsx = src('src/renderer/src/components/Voices.jsx')
check('Lines has the How it’s said panel by the line', vjsx.includes('<LineTuning key={tuneKey} value={tune} onChange={setTune} />') && vjsx.includes('Style, in words') && vjsx.includes('min="1" max="3" step="0.1"') && vjsx.includes('min="4" max="30" step="1"'))
check('Say it again brings a line’s settings back', /Say it again in this voice'[^\n]*setTune\(\{ control: l\.control/.test(vjsx))

// ---------- #53 ----------
check('only model, pack and character ids are kept as not used', JSON.stringify(cleanNotUsed(['model:h3_fl2va', 'pack:IV Studio nodes', 'character:abc', 'comfyui', 'gpu', 5, null, 'model:h3_fl2va'])) === JSON.stringify(['model:h3_fl2va', 'pack:IV Studio nodes', 'character:abc']))
check('a bad list is no list', cleanNotUsed('model:x').length === 0 && cleanNotUsed(undefined).length === 0)
const result = () => ({
  ready: false,
  items: [
    { id: 'comfyui', kind: undefined, status: 'missing' },
    { id: 'model:h3_fl2va', kind: 'model', status: 'missing' },
    { id: 'model:h3_vae', kind: 'model', status: 'missing' },
    { id: 'model:ltx', kind: 'model', status: 'ok' },
    { id: 'pack:Seed hunter', kind: 'node_pack', status: 'missing' },
    { id: 'character:abc', kind: 'character', status: 'warn' }
  ]
})
const before = markNotUsed(result(), [])
check('with nothing marked, every missing item counts', before.toFix === 4 && !before.items.some((i) => i.notUsed))
const after = markNotUsed(result(), ['model:h3_fl2va', 'model:h3_vae', 'model:ltx', 'comfyui', 'character:abc'])
const by = Object.fromEntries(after.items.map((i) => [i.id, i]))
check('marked models are reported as not used', by['model:h3_fl2va'].notUsed && by['model:h3_vae'].notUsed && by['character:abc'].notUsed)
check('a marked item that is there is just there', !by['model:ltx'].notUsed)
check('ComfyUI can never be set aside', !by.comfyui.notUsed)
check('what is marked no longer counts as to fix', after.toFix === 2, after.toFix)
check('ready still says whether H3 shots can render', after.ready === false)
const main = src('src/main/index.js')
check('the setting keeps only clean ids', main.includes("if ('setupNotUsed' in safe) safe.setupNotUsed = cleanNotUsed(safe.setupNotUsed)"))
check('main marks and unmarks through setup:notUsed', /handle\('setup:notUsed', \(\{ ids, on \} = \{\}\) => \{/.test(main) && main.includes('studio.notUsed = () => readSettings(BASE).setupNotUsed || []'))
check('the page can call it', src('src/preload/index.js').includes("notUsed: call('setup:notUsed')"))
check('the agent’s check_setup sees the marks', mcp.includes('studio.notUsed = () => readSettings(BASE).setupNotUsed || []'))
check('Studio applies the marks to every setup check', src('src/service/studio.js').includes('markNotUsed(result, this.notUsed?.() || [])'))
// the mark is really written to settings.json and read back (writeSettings keeps only known keys)
const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-53-'))
writeSettings({ setupNotUsed: ['model:fl2va', 'pack:Seed hunter'] }, sdir)
check('settings.json keeps the not-used marks', JSON.stringify(readSettings(sdir).setupNotUsed) === JSON.stringify(['model:fl2va', 'pack:Seed hunter']), JSON.stringify(readSettings(sdir).setupNotUsed))
check('a new settings file starts with nothing marked', JSON.stringify(readSettings(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-53b-'))).setupNotUsed) === '[]')
fs.rmSync(sdir, { recursive: true, force: true })
const setupJsx = src('src/renderer/src/components/Setup.jsx')
check('Setup has a Not used card that counts for nothing', setupJsx.includes("{ id: 'notused', title: 'Not used'") && setupJsx.includes('x.optional || x.info ? false'))
check('Setup can set H3’s models aside in one go, and use them all again', setupJsx.includes('I don’t make MiniMax H3 shots') && setupJsx.includes('Use all {x.list.length} again'))
check('with H3’s models set aside, Setup never says shots are ready', setupJsx.indexOf('h3Aside && !setup.ready') > 0 && setupJsx.indexOf('h3Aside && !setup.ready') < setupJsx.indexOf("? { tone: 'ok', title: 'Ready to make shots'"))
check('each item can be marked, and unmarked', setupJsx.includes("{i.notUsed ? 'Use it again' : 'I don’t use this'}"))
check('Download N models leaves marked models out', /const required = live\.filter/.test(setupJsx) && /const blocking = live\.filter/.test(setupJsx))
const app = src('src/renderer/src/App.jsx')
check('the top bar counts what is left to fix', app.includes('setup?.toFix ?? (setup?.items?.filter((i) => i.status === \'missing\' && !i.notUsed).length || 0)') && app.includes('setup?.toFix === 0'))
check('Settings’ Setup tab counts the same', src('src/renderer/src/components/Settings.jsx').includes("setup?.toFix ?? (setup?.items?.filter((i) => i.status === 'missing' && !i.notUsed).length || 0)"))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
