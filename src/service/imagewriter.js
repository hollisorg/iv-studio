// "Write it for me" for pictures: a plain-words idea in, a prompt written the way the chosen picture model reads
// prompts out. Every model family has its own guide (resources/guides/images/<family>.md, distilled from the makers'
// own prompting guides; each names its sources), and every writer gets the whole guide: the local model in Ollama or
// on an OpenAI-compatible server, or the person's Claude, ChatGPT or Hermes (askWriter in filmcraft.js).
import fs from 'node:fs'
import path from 'node:path'
import { askWriter } from './filmcraft.js'
import { jpegOf } from './prompter.js'

// the families that get a guide (images.js IMAGE_FAMILIES, plus ChatGPT Images); the H3 still's guide is h3still.md
export const GUIDED = ['chatgpt', 'flux2', 'flux3', 'krea2', 'moss', 'qwen21', 'zimage', 'sdxl', 'h3image', 'h3']
const GUIDE_FILE = { h3: 'h3still' }
// the families whose sampler uses a negative prompt (CFG above 1): the writer writes one only for these
export const NEGATIVE_FAMILIES = ['sdxl', 'moss']
const LABEL = { chatgpt: 'ChatGPT Images', flux2: 'FLUX.2 [klein]', flux3: 'Flux 3 Klein', krea2: 'Krea 2', moss: 'Moss', qwen21: 'Qwen Image 2.1', zimage: 'Z-Image Turbo', sdxl: 'SDXL', h3image: 'MiniMax H3 Image', h3: 'MiniMax H3 (a still frame)' }
export const guideFile = (family) => `${GUIDE_FILE[family] || family}.md`

const guides = new Map()
export function loadImageGuide(resourcesDir, family) {
  if (!GUIDED.includes(family)) throw new Error(`There's no prompt guide for "${family}" yet.`)
  const file = path.join(resourcesDir, 'guides', 'images', guideFile(family))
  if (!guides.has(file)) {
    let text = ''
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      throw new Error(`IV Studio's prompt guide for ${LABEL[family]} is missing (${guideFile(family)}). Reinstall IV Studio.`)
    }
    // the sources line is for people, not the writer
    guides.set(file, text.replace(/^Source:[\s\S]*?(?=\n##|\n\n)/m, '').trim())
  }
  return guides.get(file)
}

// SDXL fine-tunes read different prompts: Pony wants its score tags, Illustrious and NoobAI want Danbooru tags.
export function sdxlStyle(model = '') {
  const m = String(model).toLowerCase()
  if (/pony/.test(m)) return 'pony'
  if (/illustrious|noobai|\bnoob/.test(m)) return 'illustrious'
  return 'plain'
}

// How the model names the reference pictures in an edit, so the writer uses the model's own words.
// (Qwen Image 2.1: <image1>, <image2> from two pictures up, per Qwen's own prompt enhancer; H3 Image: <Picture 1>;
// FLUX and ChatGPT: "image 1".) One picture on Qwen or Krea 2 gets no name at all: "the image".
export function refName(family, i) {
  if (family === 'h3image') return `<Picture ${i}>`
  if (family === 'qwen21') return `<image${i}>`
  return `image ${i}`
}
const untagged = (family, refs) => refs === 1 && ['qwen21', 'krea2'].includes(family)

export function schemaFor(family) {
  const props = { prompt: { type: 'string', description: 'The whole prompt, ready to paste.' } }
  if (NEGATIVE_FAMILIES.includes(family)) props.negative = { type: 'string', description: 'The negative prompt for this picture.' }
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false }
}

// { family, model, mode, aspect, refs: n, triggers: [], current, full guide } -> the writer's instructions
export function imageSystem({ family, model = '', mode = 'generate', aspect = '1:1', refs = 0, triggers = [], guide }) {
  const style = family === 'sdxl' ? sdxlStyle(model) : null
  const edit = mode === 'edit'
  return [
    `You write prompts for ${LABEL[family]}${model ? ` (the checkpoint is ${String(model).split(/[\\/]/).pop()})` : ''}. Answer with JSON: ${NEGATIVE_FAMILIES.includes(family) ? '{ prompt, negative }' : '{ prompt }'}.`,
    `Follow this guide for ${LABEL[family]} exactly:\n\n${guide}`,
    style === 'pony' ? 'This checkpoint is a Pony Diffusion fine-tune: use the Pony conventions from the guide (its score tags first).' : style === 'illustrious' ? 'This checkpoint is an Illustrious or NoobAI fine-tune: use the Danbooru-tag conventions from the guide.' : style === 'plain' ? 'This checkpoint is a general SDXL model: use the plain SDXL conventions from the guide, not Pony or Danbooru tags.' : '',
    edit
      ? `This is an EDIT of ${refs === 1 ? 'one picture' : `${refs} pictures`}${untagged(family, refs) ? ': call it "the image", with no number or tag' : refs ? `, in this order: ${Array.from({ length: refs }, (_, i) => refName(family, i + 1)).join(', ')}. Name the pictures exactly like that` : ''}. Write the instruction the way the guide says this model reads edits: what changes, and what stays.`
      : 'This is a NEW picture from words only.',
    `The picture's shape is ${aspect}; size, steps, seed and the shape itself are set outside the prompt: never write them, and never write settings, parameters or weights the guide doesn't use.`,
    triggers.length ? `LoRA trigger words, keep them exactly as written, at the very start of the prompt: ${triggers.join(', ')}.` : '',
    'Keep everything the person asked for: every subject, count, name, colour and any words to show. Add only what makes the picture clearer (framing, light, texture, medium); never invent new people, logos or story. Write in English unless the person asks for words in another language inside the picture. No markdown, no headings, no notes to the reader.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Tidy what came back: no quotes round the whole thing, no "Prompt:" label, the trigger words kept at the start.
export function cleanImagePrompt(text, triggers = []) {
  let p = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  p = p.replace(/^```[a-z]*\s*|\s*```$/g, '').replace(/^(positive )?prompt\s*:\s*/i, '').trim()
  if (/^"[\s\S]*"$/.test(p) && !p.slice(1, -1).includes('"')) p = p.slice(1, -1).trim()
  const missing = triggers.filter((w) => w && !p.toLowerCase().includes(String(w).toLowerCase()))
  if (missing.length) p = `${missing.join(', ')}, ${p}`
  return p
}

// request: { family, model, mode, aspect, idea, current, refs: [files], triggers }. writer: { engine, model }.
// -> { prompt, negative? }
export async function writeImagePrompt({ writer, family, model = '', mode = 'generate', aspect = '1:1', idea, current = '', refs = [], triggers = [], resourcesDir, cpu = false }) {
  if (!String(idea || '').trim() && !String(current || '').trim()) throw new Error('Describe the picture first.')
  const guide = loadImageGuide(resourcesDir, family)
  const edit = mode === 'edit'
  const files = edit ? refs.filter((f) => f && fs.existsSync(f)).slice(0, 6) : []
  const images = []
  for (const [i, f] of files.entries()) {
    try {
      images.push({ name: `picture-${i + 1}.jpg`, data: await jpegOf({ file: f }) })
    } catch {}
  }
  const system = imageSystem({ family, model, mode, aspect, refs: edit ? refs.length : 0, triggers, guide })
  const user = [
    String(idea || '').trim() ? `The idea: ${String(idea).trim()}` : '',
    String(current || '').trim() ? `${String(idea || '').trim() ? 'The prompt so far (keep what still fits the idea)' : 'Rewrite this prompt for this model, keeping what it shows'}: ${String(current).trim()}` : '',
    images.length ? `The ${images.length === 1 ? 'picture' : 'pictures'} to edit ${images.length === 1 ? 'is' : 'are'} attached${writer?.engine === 'claude' ? ' as image files in your working folder: open each with the Read tool' : ''}${untagged(family, refs.length) ? '' : `, in order (${images.map((_, i) => refName(family, i + 1)).join(', ')})`}. Look at them and write only what is true of them.` : '',
    `Answer as JSON: ${NEGATIVE_FAMILIES.includes(family) ? '{ "prompt": "...", "negative": "..." }' : '{ "prompt": "..." }'}.`
  ]
    .filter(Boolean)
    .join('\n\n')
  const out = await askWriter(writer, { system, user, schema: schemaFor(family), cpu, temperature: 0.6, ctx: 16384, images })
  const prompt = cleanImagePrompt(out?.prompt, triggers)
  if (!prompt) throw new Error('The writer gave no prompt back. Try again.')
  return NEGATIVE_FAMILIES.includes(family) ? { prompt, negative: String(out?.negative || '').trim() } : { prompt }
}
