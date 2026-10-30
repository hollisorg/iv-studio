// Renders IV Studio's per-page banner art on local ComfyUI: the closed-eye recipe (Flux.2 Klein 9B, eye.webp as the
// reference latent, 4 steps, 1536x800) with the eye swapped for each page's own subject. Saves into ./page-art-raw.
//   node docs/art/page-art.mjs [page ...]
import fs from 'node:fs'
import path from 'node:path'

const COMFY = 'http://127.0.0.1:8188'
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'))
const EYE = path.join(HERE, '..', '..', 'src', 'renderer', 'src', 'assets', 'eye.webp')
const OUT = path.resolve('page-art-raw')
const SEEDS = [101, 202, 303]

export const SUBJECTS = {
  shots: 'a vintage film clapperboard with its striped clapper arm raised open',
  sequences: 'a long strip of motion-picture film curling in a smooth S-curve, with three blank frames and sprocket holes',
  edit: 'an open pair of scissors cutting through a strip of motion-picture film',
  workflows: 'three interlocking cog wheels',
  shinobi: 'a katana sword lying diagonally, with a wrapped handle and a long curved blade',
  replace: 'two theatre masks overlapping, one face sliding in front of the other',
  sizzle: 'a lit match with a tall flickering flame',
  characters: 'a calm human face shown in profile, head and shoulders, like a carved cameo',
  loras: 'a camera lens seen from the front, with several glass rings nested inside it',
  cloud: 'a big billowing cumulus cloud with a lightning bolt beneath it',
  settings: 'a wrench and a screwdriver crossed in an X',
  library: 'a fan of overlapping instant photographs spread out like a hand of playing cards, their pictures blank',
  voices: 'a pair of full lips, slightly parted as if speaking',
  lines: 'a vintage ribbon microphone on a short stand',
  music: 'a vinyl record with a tone arm resting on it'
}

const prompt = (subject) =>
  `Edit this illustration. Replace the big eye in the center with ${subject}, drawn large in the same place and at the same size as the eye, as bold and bright as the eye was: filled with solid coral pink and bright red, with fine line stripes and stippled dot texture. Keep everything else exactly the same: the swirling liquid coral and red contour shapes all around, the dotted lines radiating from the center, the near-black background, the flat screen-printed psychedelic illustration style, and the palette of near-black, coral pink and bright red. No text, no letters, no words, no numbers, no logos.`

function graph(ref, text, seed, prefix) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'Flux 2\\Flux.2 Klein_9B.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_8b.safetensors', type: 'flux2', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    4: { class_type: 'LoadImage', inputs: { image: ref } },
    5: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['4', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 16 } },
    6: { class_type: 'VAEEncode', inputs: { pixels: ['5', 0], vae: ['3', 0] } },
    7: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
    8: { class_type: 'ReferenceLatent', inputs: { conditioning: ['7', 0], latent: ['6', 0] } },
    9: { class_type: 'BasicGuider', inputs: { model: ['1', 0], conditioning: ['8', 0] } },
    10: { class_type: 'EmptyFlux2LatentImage', inputs: { width: 1536, height: 800, batch_size: 1 } },
    11: { class_type: 'Flux2Scheduler', inputs: { steps: 4, width: 1536, height: 800 } },
    12: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    13: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    14: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['13', 0], guider: ['9', 0], sampler: ['12', 0], sigmas: ['11', 0], latent_image: ['10', 0] } },
    15: { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['3', 0] } },
    16: { class_type: 'SaveImage', inputs: { images: ['15', 0], filename_prefix: prefix } }
  }
}

async function upload(file) {
  const form = new FormData()
  form.append('image', new Blob([fs.readFileSync(file)]), 'iv-studio-eye-ref.webp')
  form.append('subfolder', 'IV-Studio')
  form.append('overwrite', 'true')
  const r = await (await fetch(`${COMFY}/upload/image`, { method: 'POST', body: form })).json()
  return r.subfolder ? `${r.subfolder}/${r.name}` : r.name
}

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  fs.mkdirSync(OUT, { recursive: true })
  const ref = await upload(EYE)
  const pages = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUBJECTS)
  const jobs = []
  for (const page of pages)
    for (const seed of SEEDS) {
      const r = await (await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph(ref, prompt(SUBJECTS[page]), seed, `IV-Studio/page-art/${page}_${seed}`), client_id: 'claude-page-art' }) })).json()
      if (!r.prompt_id) throw new Error(JSON.stringify(r))
      jobs.push({ page, seed, id: r.prompt_id })
    }
  console.log('queued', jobs.length)
  const t0 = Date.now()
  for (const j of jobs) {
    for (;;) {
      const h = (await (await fetch(`${COMFY}/history/${j.id}`)).json())[j.id]
      if (h?.status?.completed || h?.status?.status_str === 'error') {
        const img = Object.values(h.outputs || {}).flatMap((o) => o.images || [])[0]
        if (!img) throw new Error(`${j.page} ${j.seed} failed`)
        const buf = Buffer.from(await (await fetch(`${COMFY}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder)}&type=output`)).arrayBuffer())
        fs.writeFileSync(path.join(OUT, `${j.page}_${j.seed}.png`), buf)
        console.log(`${j.page} ${j.seed} done at ${Math.round((Date.now() - t0) / 1000)} s`)
        break
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}
