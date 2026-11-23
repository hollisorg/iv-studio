// How IV Studio starts Ollama (prompter.js ollamaStartCommand, ollamaCanStart, ollamaStartDue). On Windows a detached
// `ollama serve` has no console, so each model it loads opened a new terminal window: Windows starts it hidden through
// PowerShell. Never through Ollama's own app: it opens its chat window each time, and background work kept bringing it
// back (2026-11-23). And only when a start can bring the address up, once at a time.
//   node test/ollama-start.mjs
import assert from 'node:assert/strict'
import { OLLAMA_RETRY_MS, ollamaCanStart, ollamaStartCommand, ollamaStartDue } from '../src/service/prompter.js'

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}

ok('Windows starts `ollama serve` hidden through PowerShell, never Ollama’s app (it opens its window)', () => {
  const c = ollamaStartCommand("C:\\Users\\o'neil\\Ollama\\ollama.exe", 'win32')
  assert.equal(c.command, 'powershell.exe')
  assert.ok(c.args.includes('Hidden'))
  const cmd = c.args[c.args.length - 1]
  assert.match(cmd, /^Start-Process -FilePath 'C:\\Users\\o''neil\\Ollama\\ollama\.exe' -ArgumentList 'serve' -WindowStyle Hidden$/)
  assert.ok(!JSON.stringify(c).includes('ollama app'), 'not the tray app')
})

ok('Mac and Linux run `ollama serve` as before', () => {
  assert.deepEqual(ollamaStartCommand('/usr/local/bin/ollama', 'linux'), { command: '/usr/local/bin/ollama', args: ['serve'] })
  assert.deepEqual(ollamaStartCommand('/Applications/Ollama.app/Contents/Resources/ollama', 'darwin'), { command: '/Applications/Ollama.app/Contents/Resources/ollama', args: ['serve'] })
})

ok('a start only for an address it can bring up: this PC, on Ollama’s port', () => {
  assert.equal(ollamaCanStart('http://127.0.0.1:11434', {}), true)
  assert.equal(ollamaCanStart('http://localhost:11434', {}), true)
  assert.equal(ollamaCanStart('http://127.0.0.1:9', {}), false, 'a dead test address never starts Ollama')
  assert.equal(ollamaCanStart('http://192.168.1.20:11434', {}), false, 'another machine')
  assert.equal(ollamaCanStart('http://127.0.0.1:12000', { OLLAMA_HOST: '127.0.0.1:12000' }), true, 'OLLAMA_HOST’s port')
  assert.equal(ollamaCanStart('http://127.0.0.1:11434', { OLLAMA_HOST: '127.0.0.1:12000' }), false)
})

ok('not started again within two minutes of the last start', () => {
  const t = 1_000_000
  assert.equal(ollamaStartDue(t, 0), true, 'never started')
  assert.equal(ollamaStartDue(t + 1000, t), false)
  assert.equal(ollamaStartDue(t + OLLAMA_RETRY_MS, t), true)
})

console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
