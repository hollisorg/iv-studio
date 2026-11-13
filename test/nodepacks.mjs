// The node pack installer (src/service/nodepacks.js) without the network: which packs a ComfyUI needs, its
// Python, the requirements it may install, copying IV Studio's own pack, and leaving existing folders alone.
//   node test/nodepacks.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { findPython, installPacks, missingPacks, packsNeedingRuntime, requirementsFor, runtimeReady } from '../src/service/nodepacks.js'
import { explainRenderError } from '../src/service/studio.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'models.json'), 'utf8'))
let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}

await ok('every pack has a folder name, a pinned source and the feature it is for', () => {
  for (const p of manifest.node_packs) {
    assert.ok(p.dir && p.for && p.classes.length, p.label)
    assert.ok(p.bundled || p.registry || (p.git && /^[0-9a-f]{40}$/.test(p.commit)), `${p.label}: needs a registry release, a full commit or bundled`)
    if (p.registry) assert.match(p.registry, /^https:\/\/cdn\.comfy\.org\/[^/]+\/[^/]+\/\d+\.\d+\.\d+\/node\.(zip|tar\.gz)$/)
    if (p.bundled) assert.ok(fs.existsSync(path.join(ROOT, 'resources', p.bundled, '__init__.py')), p.bundled)
  }
  assert.equal(new Set(manifest.node_packs.map((p) => p.dir)).size, manifest.node_packs.length, 'folder names are unique')
})

await ok('missing packs: any absent node, and never the other OS’s pack', () => {
  const all = Object.fromEntries(manifest.node_packs.flatMap((p) => p.classes).map((c) => [c, {}]))
  assert.deepEqual(missingPacks(manifest, all), [])
  const noIv = { ...all }
  delete noIv.IVShotList
  assert.deepEqual(missingPacks(manifest, noIv).map((p) => p.dir), ['ComfyUI-IV-Studio'])
  const none = missingPacks(manifest, {}).map((p) => p.dir)
  assert.ok(none.includes('comfyui-dlss5-enhancer-v15') && !none.includes('comfyui-frame-interpolation'))
  const linux = missingPacks(manifest, {}, { linux: true }).map((p) => p.dir)
  assert.ok(!linux.includes('comfyui-dlss5-enhancer-v15') && linux.includes('comfyui-frame-interpolation'))
})

await ok('requirements keep ComfyUI’s torch and skip git+ lines without git', () => {
  const text = '# comment\ntorch\ntorchvision>=0.20\nnumpy\n\nxformers\nopencv-python\ngit+https://github.com/facebookresearch/sam2\n'
  assert.deepEqual(requirementsFor(text), { kept: ['numpy', 'opencv-python', 'git+https://github.com/facebookresearch/sam2'], skipped: ['torch', 'torchvision>=0.20', 'xformers'] })
  assert.deepEqual(requirementsFor(text, { git: false }).kept, ['numpy', 'opencv-python'])
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-nodes-test-'))
try {
  await ok('ComfyUI’s Python: the portable build, a venv in ComfyUI or beside it', () => {
    const portable = path.join(tmp, 'portable')
    fs.mkdirSync(path.join(portable, 'ComfyUI'), { recursive: true })
    fs.mkdirSync(path.join(portable, 'python_embeded'))
    fs.writeFileSync(path.join(portable, 'python_embeded', 'python.exe'), '')
    assert.equal(findPython(path.join(portable, 'ComfyUI'), 'win32'), path.join(portable, 'python_embeded', 'python.exe'))
    const venv = path.join(tmp, 'venv', 'ComfyUI')
    fs.mkdirSync(path.join(venv, '.venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(venv, '.venv', 'bin', 'python'), '')
    assert.equal(findPython(venv, 'linux'), path.join(venv, '.venv', 'bin', 'python'))
    assert.equal(findPython(path.join(tmp, 'nothing'), 'win32'), null)
  })

  await ok('IV Studio’s own pack is copied in; a folder already there is left alone', async () => {
    const customNodes = path.join(tmp, 'custom_nodes')
    fs.mkdirSync(path.join(customNodes, 'rgthree-comfy'), { recursive: true })
    fs.writeFileSync(path.join(customNodes, 'rgthree-comfy', 'mine.txt'), 'keep me')
    const packs = manifest.node_packs.filter((p) => p.dir === 'ComfyUI-IV-Studio' || p.dir === 'rgthree-comfy')
    const steps = []
    const results = await installPacks(packs, { customNodes, python: null, resourcesDir: path.join(ROOT, 'resources'), onProgress: (u) => steps.push(`${u.dir}:${u.step}`) })
    assert.deepEqual(results.map((r) => [r.dir, r.status]), [['rgthree-comfy', 'skipped'], ['ComfyUI-IV-Studio', 'installed']].sort((a, b) => packs.findIndex((p) => p.dir === a[0]) - packs.findIndex((p) => p.dir === b[0])))
    assert.ok(fs.existsSync(path.join(customNodes, 'ComfyUI-IV-Studio', '__init__.py')))
    assert.equal(fs.readFileSync(path.join(customNodes, 'rgthree-comfy', 'mine.txt'), 'utf8'), 'keep me')
    assert.ok(steps.includes('ComfyUI-IV-Studio:done') && steps.includes('rgthree-comfy:skipped'))
  })

  // GitHub #36: the DLSS pack's nodes load without its runtime, and every DLSS finish then fails
  const dlss = manifest.node_packs.find((p) => p.dir === 'comfyui-dlss5-enhancer-v15')
  await ok('the DLSS runtime counts in its folder or where config.json points, and a pack without it is found', () => {
    assert.equal(dlss.runtime.exe, 'VE_CLI.exe')
    const customNodes = path.join(tmp, 'rt', 'custom_nodes')
    const dir = path.join(customNodes, dlss.dir)
    fs.mkdirSync(path.join(dir, 'runtime'), { recursive: true })
    assert.equal(runtimeReady(dir, dlss.runtime), false)
    assert.deepEqual(packsNeedingRuntime(manifest, customNodes).map((p) => p.dir), [dlss.dir])
    assert.deepEqual(packsNeedingRuntime(manifest, customNodes, { linux: true }), [], 'DLSS is Windows only')
    const elsewhere = path.join(tmp, 'rt', 'Visual Enhancer')
    fs.mkdirSync(elsewhere, { recursive: true })
    fs.writeFileSync(path.join(elsewhere, 'VE_CLI.exe'), '')
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ runtime_dir: elsewhere }))
    assert.equal(runtimeReady(dir, dlss.runtime), true)
    fs.rmSync(path.join(dir, 'config.json'))
    fs.writeFileSync(path.join(dir, 'runtime', 'VE_CLI.exe'), '')
    assert.equal(runtimeReady(dir, dlss.runtime), true)
    assert.deepEqual(packsNeedingRuntime(manifest, customNodes), [])
  })

  const py = ['python3', 'python'].find((c) => spawnSync(c, ['-c', 'print(1)'], { encoding: 'utf8' }).stdout?.trim() === '1')
  await ok(`a pack already there still gets its runtime script run${py ? '' : ' (skipped: no Python here)'}`, async () => {
    if (!py) return
    const customNodes = path.join(tmp, 'rt2', 'custom_nodes')
    const dir = path.join(customNodes, dlss.dir)
    fs.mkdirSync(dir, { recursive: true })
    // a stand-in for the pack's install.py: makes runtime/VE_CLI.exe the way the real one does after its download
    fs.writeFileSync(path.join(dir, 'install.py'), "import os\nos.makedirs('runtime', exist_ok=True)\nopen(os.path.join('runtime','VE_CLI.exe'),'w').close()\n")
    const steps = []
    const [r] = await installPacks([dlss], { customNodes, python: py, resourcesDir: path.join(ROOT, 'resources'), onProgress: (u) => steps.push(u.step) })
    assert.equal(r.status, 'skipped')
    assert.equal(r.runtime, 'installed')
    assert.ok(steps.includes('runtime'))
    assert.ok(fs.existsSync(path.join(dir, 'runtime', 'VE_CLI.exe')))
    // without ComfyUI's Python it says how to do it by hand
    fs.rmSync(path.join(dir, 'runtime'), { recursive: true })
    const [r2] = await installPacks([dlss], { customNodes, python: null, resourcesDir: path.join(ROOT, 'resources') })
    assert.equal(r2.runtime, 'failed')
    assert.match(r2.runtimeDetail, /install\.py/)
  })

  await ok('the VE_CLI.exe render error says what to press', () => {
    const raw = "DLSS5_Enhance_Video: Could not find VE_CLI.exe. Searched: [WindowsPath('D:/x/runtime')]. Run install_runtime.py or set DLSS5_V15_RUNTIME_DIR."
    assert.match(explainRenderError(raw), /Install missing node packs/)
    assert.ok(explainRenderError(raw).includes(raw))
    assert.equal(explainRenderError('KSampler: out of memory'), 'KSampler: out of memory')
  })
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(`\n${n} checks passed`)
