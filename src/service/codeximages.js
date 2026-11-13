// ChatGPT Images through the person's own Codex (OpenAI's Codex, signed in with ChatGPT): Codex's built-in image tool
// makes the picture on their ChatGPT plan, with no ComfyUI and no GPU here, and no per-picture charge from IV Studio.
// Codex runs read-only (it can't change anything on this PC) and without the person's own config (no MCP servers or
// plugins), with its input closed (otherwise it waits for more). It keeps each picture it makes in its own folder,
// <Codex home>/generated_images/<run id>/, where IV Studio collects it; the run id comes from Codex's event stream.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findHarnesses } from './harness.js'

export const CODEX_MODEL = 'chatgpt-images'
export const codexHome = (env = process.env, home = os.homedir()) => env.CODEX_HOME || path.join(home, '.codex')

// Codex installed and signed in (it keeps its ChatGPT login in auth.json).
export function codexImageStatus(env = process.env, home = os.homedir(), platform = process.platform) {
  const exe = findHarnesses(env, home, platform).codex
  const signedIn = fs.existsSync(path.join(codexHome(env, home), 'auth.json'))
  const missing = [...(exe ? [] : ['Codex (the ChatGPT Codex app or its command-line tool)']), ...(exe && !signedIn ? ['a ChatGPT sign-in in Codex'] : [])]
  return { exe, signedIn, ready: !!exe && signedIn, missing }
}

const SHAPES = {
  '1:1': 'square (1:1)',
  '16:9': 'wide landscape (16:9)',
  '9:16': 'tall portrait (9:16)',
  '4:3': 'landscape (4:3)',
  '3:4': 'portrait (3:4)',
  '3:2': 'landscape (3:2)',
  '2:3': 'portrait (2:3)',
  '21:9': 'very wide cinematic landscape (21:9)'
}

// What Codex is asked: one picture with its image tool, nothing else.
export function codexImagePrompt({ mode = 'generate', prompt, aspect = '1:1', refs = 0 }) {
  const text = String(prompt || '').trim()
  if (mode === 'edit') {
    const pics = refs > 1 ? `the ${refs} attached pictures (picture 1 is the one to change; the others are references, in order)` : 'the attached picture'
    return `Use your image generation tool to edit ${pics}. Make exactly ONE image. The change: ${text}\nKeep everything the change doesn't mention as it is. Don't run commands, read or write files, or do anything else.`
  }
  return `Use your image generation tool to create exactly ONE image, ${SHAPES[aspect] || SHAPES['1:1']}. The image: ${text}\nDon't run commands, read or write files, or do anything else.`
}

// What Codex's event stream says: its run id, what it said, and any error.
export function readCodexEvents(text) {
  const out = { thread: null, said: [], errors: [] }
  for (const line of String(text || '').split('\n')) {
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e.type === 'thread.started') out.thread = e.thread_id
    else if (e.type === 'item.completed' && e.item?.type === 'agent_message' && e.item.text) out.said.push(e.item.text.trim())
    else if (e.type === 'error' && e.message) out.errors.push(e.message)
    else if (e.type === 'turn.failed') out.errors.push(e.error?.message || 'Codex stopped.')
  }
  return out
}

// The pictures a run made, newest last.
export function runPictures(thread, home = codexHome()) {
  const dir = path.join(home, 'generated_images', thread || '')
  if (!thread || !fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
}

// One picture. refs: local picture paths (Edit). onChild(child) lets the caller stop it. Resolves the picture's path
// in Codex's folder; rejects with what Codex said when it made none (a refusal, a usage limit, not signed in).
export function codexImage({ mode = 'generate', prompt, aspect = '1:1', refs = [], exe, model = '', home = codexHome(), timeoutMs = 600000, onChild = () => {} }) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-studio-codex-image-'))
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', ...(model ? ['-m', model] : []), '--sandbox', 'read-only', '--color', 'never', '--json', '-C', dir, '-', ...refs.flatMap((r) => ['-i', r])]
    const viaShell = process.platform === 'win32' && /\.cmd$/i.test(exe)
    const child = spawn(viaShell ? `"${exe}"` : exe, args, { cwd: dir, windowsHide: true, shell: viaShell, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, CODEX_HOME: home } })
    onChild(child)
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('ChatGPT took too long to make the picture. Try again.'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`Codex couldn't start: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {}
      const ev = readCodexEvents(out)
      const pics = runPictures(ev.thread, home)
      if (pics.length) return resolve(pics[pics.length - 1])
      if (child.killed) return reject(new Error('Stopped.'))
      const why = ev.errors.pop() || ev.said.pop() || err.trim().split('\n').filter((l) => !/^\d{4}-\d\d-\d\dT/.test(l)).pop() || `Codex stopped (code ${code}) without a picture.`
      reject(new Error(/login|sign.?in|auth|401/i.test(why) ? `Codex isn't signed in to ChatGPT. Open Codex and sign in, then try again. (${why.slice(0, 200)})` : `ChatGPT made no picture: ${why.slice(0, 400)}`))
    })
    child.stdin.end(codexImagePrompt({ mode, prompt, aspect, refs: refs.length }))
  })
}
