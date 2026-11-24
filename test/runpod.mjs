// RunPod cloud (src/service/runpod.js, resources/cloud/gate.py, the ComfyUI client's waker), without RunPod:
// a mock of RunPod's REST API, and the real gate.py run locally in RunPod mode.
//   node test/runpod.mjs [python-with-aiohttp]
// The Python defaults to IV Studio's voice engine (%APPDATA%\IV Studio\voiceengine\venv), which has aiohttp.
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunPod, GPUS, VOLUME_NAME } from '../src/service/runpod.js'
import { Comfy } from '../src/service/comfy.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(ROOT, 'resources')
const PY = process.argv[2] || path.join(process.env.APPDATA || '', 'IV Studio', 'voiceengine', 'venv', 'Scripts', 'python.exe')
let pass = 0
let fail = 0
const ok = (cond, what) => (cond ? (pass++, console.log(`  ok   ${what}`)) : (fail++, console.log(`  FAIL ${what}`)))

// ---------- a mock RunPod API ----------
function mockApi() {
  const calls = []
  const state = { volumes: [], pods: [], noCapacity: new Set() }
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const route = u.pathname.replace(/^\/v2/, '')
    const body = init.body ? JSON.parse(init.body) : null
    calls.push({ method: init.method || 'GET', route, query: u.search, body, auth: init.headers?.Authorization })
    if (init.headers?.Authorization !== 'Bearer rpa_good') return json(401, { title: 'Unauthorized' })
    if (route === '/network-volumes' && (init.method || 'GET') === 'GET') return json(200, { networkVolumes: state.volumes })
    if (route === '/network-volumes') {
      const v = { id: 'vol123', ...body, type: 'STANDARD' }
      state.volumes.push(v)
      return json(201, v)
    }
    if (route === '/catalog/gpus') {
      return json(200, {
        gpus: [
          { id: 'NVIDIA L40S', availability: 'LOW', price: { secure: 1.09 }, dataCenters: [{ id: 'US-MO-1' }, { id: 'US-NC-1' }] },
          { id: 'NVIDIA RTX 6000 Ada Generation', availability: 'LOW', price: { secure: 0.99 }, dataCenters: [{ id: 'US-WA-1' }, { id: 'US-NC-1' }] },
          { id: 'NVIDIA A100 80GB PCIe', availability: 'LOW', price: { secure: 2.09 }, dataCenters: [{ id: 'US-NC-1' }] }
        ]
      })
    }
    if (route === '/catalog/datacenters') {
      // state.l40sOnlyWithoutStorage: the L40S is free only in US-MO-1, which offers no network storage (RunPod's
      // own stock on 2026-11-23, when a setup that asked for an L40S started a $2.09 A100)
      const l40s = state.l40sOnlyWithoutStorage ? [] : [{ id: 'NVIDIA L40S', availability: 'LOW' }]
      return json(200, {
        dataCenters: [
          { id: 'US-MO-1', networkVolumeTypes: [], gpuAvailability: [{ id: 'NVIDIA L40S', availability: 'HIGH' }] },
          { id: 'US-WA-1', networkVolumeTypes: ['STANDARD'], gpuAvailability: [{ id: 'NVIDIA RTX 6000 Ada Generation', availability: 'LOW' }] },
          { id: 'US-NC-1', networkVolumeTypes: ['STANDARD'], gpuAvailability: [...l40s, { id: 'NVIDIA RTX 6000 Ada Generation', availability: 'LOW' }, { id: 'NVIDIA A100 80GB PCIe', availability: 'LOW' }, { id: 'NVIDIA GeForce RTX 4090', availability: 'LOW' }, { id: 'NVIDIA H200', availability: 'LOW' }] }
        ]
      })
    }
    if (route === '/pods' && (init.method || 'GET') === 'GET') return json(200, state.pods)
    if (route === '/pods') {
      if (state.noCapacity.has(body.gpu.id)) return json(400, { title: 'Bad Request', detail: 'There are no instances currently available' })
      const p = { id: `pod${state.pods.length + 1}`, name: body.name, status: 'RUNNING', gpu: { id: body.gpu.id }, cost: 0.99, startedAt: '2026-11-03T09:00:00Z' }
      state.pods.push(p)
      return json(201, p)
    }
    const del = route.match(/^\/pods\/(\w+)$/)
    if (del && init.method === 'DELETE') {
      state.pods = state.pods.filter((p) => p.id !== del[1])
      return new Response(null, { status: 204 })
    }
    return json(404, { title: 'Not found' })
  }
  return { calls, state, fetchImpl }
}

async function serviceTests() {
  console.log('RunPod service (mock API)')
  const api = mockApi()
  const bad = new RunPod({ resourcesDir: RES, key: () => 'rpa_wrong', fetchImpl: api.fetchImpl })
  ok(await bad.check().then(() => false, (e) => /refused the API key/.test(e.message)), 'a wrong key is refused with a plain message')
  const rp = new RunPod({ resourcesDir: RES, key: () => 'rpa_good', fetchImpl: api.fetchImpl })
  ok((await rp.check()).volumes === 0, 'a good key reads the account')

  const cat = await rp.catalog()
  ok(cat.length === GPUS.length && cat[0].inStock === true && cat[0].dataCenters.join() === 'US-NC-1' && cat[1].dataCenters.join() === 'US-WA-1,US-NC-1' && cat[2].perHour === 2.09, 'catalog: live prices, and stock only where there is network storage')
  api.state.l40sOnlyWithoutStorage = true
  const taken = await rp.catalog()
  ok(taken[0].inStock === false && taken[0].dataCenters.length === 0, 'catalog: an L40S free only where storage isn’t offered shows as busy, not "free now"')

  ok(await rp.pickDataCenter('NVIDIA L40S').then(() => false, (e) => e.gpuTaken && /No L40S · 48 GB is free right now/.test(e.message) && /nothing was made or billed/.test(e.message) && /RTX 4090 · 24 GB \(\$0\.89 an hour\), RTX 6000 Ada · 48 GB \(\$0\.99 an hour\), A100 · 80 GB \(\$2\.09 an hour\)/.test(e.message)), 'data center: the chosen GPU free nowhere with storage stops setup before anything is made, listing what is free, cheapest first')
  ok(!api.calls.some((c) => c.method === 'POST'), 'data center: so no volume or pod was made')
  api.state.l40sOnlyWithoutStorage = false
  ok((await rp.pickDataCenter('NVIDIA L40S')) === 'US-NC-1', 'data center: has the chosen GPU and network storage (not US-MO-1, which has no storage)')
  ok((await rp.pickDataCenter('NVIDIA RTX 6000 Ada Generation')) === 'US-NC-1', 'data center: of those with the chosen GPU, the one with most of ours')
  ok((await rp.pickDataCenter('NVIDIA H200', { strict: false })) === 'US-NC-1', 'data center: training (not strict) takes the one with most of ours when its GPU is free nowhere')

  ok(RunPod.fallbacks('NVIDIA L40S', cat).join() === ['NVIDIA L40S', 'NVIDIA RTX 6000 Ada Generation', 'NVIDIA GeForce RTX 4090'].join(), 'fallbacks: an L40S falls back only to GPUs that cost no more (RTX 6000 Ada, RTX 4090), never the $2.09 A100')
  ok(RunPod.fallbacks('NVIDIA GeForce RTX 4090', cat).join() === 'NVIDIA GeForce RTX 4090', 'fallbacks: the cheapest has nothing to fall back to')
  ok(RunPod.fallbacks('NVIDIA H100 80GB HBM3', cat)[1] === 'NVIDIA A100 80GB PCIe', 'fallbacks: an H100 may fall back to the A100, the most memory first')

  const vol = await rp.ensureVolume('US-NC-1')
  const create = api.calls.find((c) => c.method === 'POST' && c.route === '/network-volumes')
  ok(vol.id === 'vol123' && create.body.name === VOLUME_NAME && create.body.size === 100 && create.body.dataCenter === 'US-NC-1', 'volume: made once, 100 GB, in the chosen data center')
  await rp.ensureVolume('US-WA-1')
  ok(api.calls.filter((c) => c.method === 'POST' && c.route === '/network-volumes').length === 1, 'volume: reused after that')

  const body = rp.podBody({ gpu: 'NVIDIA L40S', volume: vol, token: 'tok', idleSeconds: 300 })
  ok(body.mounts.network[0].volumeId === 'vol123' && body.mounts.network[0].path === '/workspace' && body.dataCenterIds[0] === 'US-NC-1' && body.cloud === 'SECURE', 'pod: volume at /workspace, in its data center, Secure Cloud')
  ok(body.ports[0] === '8189/http' && body.env.IV_TOKEN === 'tok' && body.env.IV_IDLE_SECONDS === '300' && body.gpu.minCudaVersion === '12.8', 'pod: gate port, token, idle time, CUDA floor')
  ok(body.env.IV_BUNDLE.length < 100000 && JSON.stringify(body).length < 1024 * 1024, `pod: bundle ${Math.round(body.env.IV_BUNDLE.length / 1024)} KB (under Linux's 128 KB per variable and RunPod's 1 MiB body)`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-rp-bundle-'))
  fs.writeFileSync(path.join(dir, 'b.tgz'), Buffer.from(body.env.IV_BUNDLE, 'base64'))
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xzf', path.join(dir, 'b.tgz'), '-C', dir])
  const want = ['runpod_boot.py', 'gate.py', 'extra_model_paths.yaml', 'cloud.json', 'models.json', path.join('ComfyUI-IV-Studio', '__init__.py')]
  ok(want.every((f) => fs.existsSync(path.join(dir, f))), 'pod: the bundle unpacks to the boot script, gate, configs, models list and node pack')
  ok(fs.readFileSync(path.join(dir, 'gate.py'), 'utf8') === fs.readFileSync(path.join(RES, 'cloud', 'gate.py'), 'utf8'), 'pod: the bundled gate is this version’s')
  fs.rmSync(dir, { recursive: true, force: true })
  ok(body.cmd[0].includes('base64 -d | tar -xz -C /opt/iv') && body.cmd[0].includes('python3 /opt/iv/runpod_boot.py') && body.entrypoint.join(' ') === 'bash -c', 'pod: start command unpacks the bundle and runs the boot script')

  api.state.noCapacity.add('NVIDIA L40S')
  const logs = []
  rp.onLog = (l) => logs.push(l)
  const pod = await rp.createPod({ gpu: 'NVIDIA L40S', volume: vol, token: 'tok', idleSeconds: 300 })
  ok(pod.gpu === GPUS[1].id && pod.url === 'https://pod1-8189.proxy.runpod.net' && logs.some((l) => /taken in US-NC-1/.test(l)), 'pod: chosen GPU out of capacity falls back to the next one, and says so')
  api.state.noCapacity.add('NVIDIA RTX 6000 Ada Generation')
  api.state.noCapacity.add('NVIDIA GeForce RTX 4090')
  const tried = api.calls.length
  ok(await rp.createPod({ gpu: 'NVIDIA L40S', volume: vol, token: 'tok', idleSeconds: 300 }).then(() => false, (e) => e.gpuTaken && /no GPU that costs the same or less is free there/.test(e.message) && /A100 · 80 GB \(\$2\.09 an hour\)/.test(e.message)), 'pod: with the L40S and every cheaper GPU taken, it stops and names the pricier one free there, instead of starting it')
  ok(!api.calls.slice(tried).some((c) => c.method === 'POST' && c.body?.gpu?.id === 'NVIDIA A100 80GB PCIe'), 'pod: the A100 was never asked for')
  api.state.noCapacity.clear()

  api.state.pods.push({ id: 'other', name: 'my-own-pod', status: 'RUNNING' }, { id: 'old', name: 'iv-studio-x', status: 'EXITED' })
  const mine = await rp.pods()
  ok(mine.length === 1 && mine[0].id === 'pod1', 'pods: only IV Studio’s running pods (not the person’s other pods, not exited ones)')
  ok((await rp.stopAll()).stopped === 1 && api.state.pods.some((p) => p.id === 'other'), 'Shut down GPU deletes IV Studio’s pod and leaves the person’s other pod alone')
}

// ---------- the real gate, locally, in RunPod mode ----------
async function gateTests() {
  console.log('gate.py in RunPod mode (local)')
  if (!fs.existsSync(PY)) return console.log(`  skip (no Python with aiohttp at ${PY})`)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-rp-gate-'))
  const status = path.join(tmp, 'status.json')
  const models = path.join(tmp, 'models')
  const port = 18000 + Math.floor(Math.random() * 1000)
  const url = `http://127.0.0.1:${port}`
  fs.writeFileSync(status, JSON.stringify({ stage: 'models', detail: 'H3 int8 (1 of 9), 40%', percent: 40 }))
  const gate = spawn(PY, [path.join(RES, 'cloud', 'gate.py')], { env: { ...process.env, IV_TOKEN: 'secret-token', IV_PLATFORM: 'runpod', IV_STATUS_FILE: status, IV_MODELS_DIR: models, IV_GATE_PORT: String(port), IV_IDLE_SECONDS: '300', IV_UPSTREAM: 'http://127.0.0.1:9' }, windowsHide: true })
  let err = ''
  gate.stderr.on('data', (d) => (err += d))
  try {
    const rp = new RunPod({ resourcesDir: RES, key: () => 'unused', chunk: 300 * 1024 })
    let h = null
    for (let i = 0; i < 50 && !h; i++) (h = await rp.health(url)) || (await new Promise((r) => setTimeout(r, 200)))
    ok(h?.gate === 'ok' && h.platform === 'runpod' && h.stage === 'models' && h.percent === 40, 'health: no token needed, reports the boot stage')
    ok((await fetch(`${url}/system_stats`)).status === 401, 'anything else without the token: 401')
    ok((await fetch(`${url}/system_stats`, { headers: { Authorization: 'Bearer secret-token' } })).status === 503, 'with the token while ComfyUI is down: 503 (starting)')

    const file = path.join(tmp, 'tess.safetensors')
    fs.writeFileSync(file, Buffer.from(Array.from({ length: 1000 * 1024 }, (_, i) => (i * 7) % 256)))
    const saved = await rp.uploadModel(url, 'secret-token', file, 'loras/MiniMax H3/tess/tess.safetensors')
    const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    const landed = path.join(models, 'loras', 'MiniMax H3', 'tess', 'tess.safetensors')
    ok(saved.sha256 === sha && fs.existsSync(landed) && fs.readFileSync(landed).equals(fs.readFileSync(file)), 'upload: 1 MB in four 300 KB chunks lands byte for byte, checksum checked')
    ok(!fs.existsSync(landed + '.part'), 'upload: no .part left behind')

    const put = (q, body = 'x') => fetch(`${url}/iv/upload?${q}`, { method: 'PUT', headers: { Authorization: 'Bearer secret-token' }, body })
    ok((await put('path=../../etc/passwd.safetensors&offset=0')).status === 400, 'upload: a path that climbs out is refused')
    ok((await put('path=custom_nodes/evil.py&offset=0')).status === 400, 'upload: only loras/ and refmods/, only .safetensors')
    ok((await fetch(`${url}/iv/upload?path=loras/x.safetensors&offset=0`, { method: 'PUT', body: 'x' })).status === 401, 'upload: needs the token')
    await put('path=loras/bad.safetensors&offset=0', 'abc')
    ok((await put('path=loras/bad.safetensors&offset=10', 'def')).status === 409, 'upload: a chunk out of order is refused')
    const done = await fetch(`${url}/iv/upload?path=loras/bad.safetensors&sha256=${'0'.repeat(64)}`, { method: 'POST', headers: { Authorization: 'Bearer secret-token' } })
    ok(done.status === 422 && !fs.existsSync(path.join(models, 'loras', 'bad.safetensors')) && !fs.existsSync(path.join(models, 'loras', 'bad.safetensors.part')), 'upload: a checksum mismatch is removed, not kept')
  } finally {
    gate.kill()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (err.includes('Traceback')) ok(false, `gate printed a traceback:\n${err}`)
}

// ---------- the ComfyUI client wakes a new pod when the old one is gone ----------
async function wakerTests() {
  console.log('ComfyUI client waker')
  const serve = (handler) =>
    new Promise((resolve) => {
      const srv = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }))
    })
  const gone = await serve((req, res) => (res.writeHead(502), res.end('Bad Gateway')))
  const alive = await serve((req, res) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify({ prompt_id: 'p1', auth: req.headers.authorization }))))
  try {
    const c = new Comfy(gone.url, 'test', 'tok')
    let woke = 0
    c.waker = async () => (woke++, await new Promise((r) => setTimeout(r, 50)), alive.url)
    const [a, b] = await Promise.all([c.req('/prompt', { method: 'POST', json: {} }), c.req('/queue')])
    ok(a.prompt_id === 'p1' && b.auth === 'Bearer tok' && c.url === alive.url, 'a 502 from a gone pod wakes a new one and retries there, with the token')
    ok(woke === 1, 'two requests at once start one pod, not two')
    const d = new Comfy(gone.url, 'test', 'tok')
    d.waker = async () => null
    ok(await d.req('/queue').then(() => false, (e) => e.status === 502), 'when the waker says the pod is fine, the original error stands')
    const e = new Comfy(gone.url, 'test', null)
    ok(await e.req('/queue').then(() => false, (er) => er.status === 502), 'a local ComfyUI (no waker) is unchanged')
  } finally {
    gone.srv.close()
    alive.srv.close()
  }
}

// ---------- the boot script and gate at least compile ----------
function compileTests() {
  console.log('Python files compile')
  if (!fs.existsSync(PY)) return console.log('  skip (no Python)')
  for (const f of ['runpod_boot.py', 'gate.py']) {
    try {
      execFileSync(PY, ['-c', `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())`, path.join(RES, 'cloud', f)])
      ok(true, f)
    } catch (e) {
      ok(false, `${f}: ${e.stderr}`)
    }
  }
}

await serviceTests()
await gateTests()
await wakerTests()
compileTests()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
