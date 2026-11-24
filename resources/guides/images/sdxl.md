# SDXL and its fine-tunes

Source: https://civitai.com/api/v1/models/257749
https://huggingface.co/Laxhar/noobai-XL-1.1
https://huggingface.co/OnomaAIResearch/Illustrious-XL-v1.0
https://blenderneko.github.io/ComfyUI-docs/Interface/Textprompts/
Confidence: high for Pony and NoobAI conventions and ComfyUI weight syntax (from their own pages); medium for plain SDXL and photo fine-tunes (Juggernaut, RealVis), which rests on long-standing community practice.

## How it reads a prompt

- Two CLIP text encoders that read short phrases best. They read about 75 tokens at a time (77 with start and end); ComfyUI splits longer prompts into chunks and joins them, and the first chunk counts most (community). Keep the important things in the first 75 tokens, roughly the first 50 words.
- Comma-separated phrases beat long sentences. Short descriptive clauses are fine; grammar adds little.
- Weak at spelled text, counting, hands and complex spatial layouts. Strong at styles, faces and the huge range of fine-tunes and LoRAs.
- Prompt only in IV Studio: SDXL does not edit pictures here.

### Which convention applies

Look at the checkpoint file name:
- contains "pony": Pony Diffusion conventions.
- contains "illustrious", "noobai" or "noob": Danbooru-tag conventions.
- anything else (base SDXL, Juggernaut, RealVis, DreamShaper...): plain SDXL conventions.

## Writing a new picture

### Plain SDXL and photo fine-tunes

1. Medium and shot first: "photo of", "cinematic still of", "oil painting of".
2. Subject with key attributes, then action.
3. Setting, then lighting, then camera or lens words if photographic, then colour and mood.
4. Comma-separated phrases, 30 to 60 words. Skip "masterpiece, best quality" on photo fine-tunes; they add little (community).

Example:
cinematic photo of a young woman in a yellow raincoat standing on a rainy neon-lit street at night, looking over her shoulder, wet asphalt reflections, pink and teal neon signs, shallow depth of field, 85mm lens, soft rim light, film grain, moody colour grading

### Pony Diffusion XL

1. Start with Pony's template exactly: score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up
2. Optionally a source tag: source_anime, source_cartoon, source_furry or source_pony (choose by the look wanted; omit for a neutral mix).
3. A rating tag: rating_safe for ordinary pictures (rating_questionable and rating_explicit exist).
4. Then describe the picture in plain words, then a few boosting tags after it. Pony understands both.
5. No "masterpiece" or "hd": Pony says it does not need other quality modifiers.

Example:
score_9, score_8_up, score_7_up, score_6_up, score_5_up, score_4_up, source_anime, rating_safe, a cheerful girl with short silver hair and a red scarf building a snowman in a quiet village at dusk, warm lantern light, falling snow, 1girl, smile, winter coat, outdoors

### Illustrious and NoobAI

1. Quality prefix first. NoobAI's own: masterpiece, best quality, newest, absurdres, highres, safe. (For Illustrious, community use is masterpiece, best quality, very aesthetic, absurdres.)
2. Then Danbooru tags in NoobAI's order: count tag (1girl, 1boy, 2girls, no humans), character, series, artist, special tags, general tags (hair, eyes, clothes, pose, place, light).
3. Use real Danbooru tag names, with spaces. Escape brackets in names: hatsune miku, or ganyu \(genshin impact\).
4. Illustrious also reads plain English; a short sentence after the tags is fine.

Example:
masterpiece, best quality, newest, absurdres, highres, safe, 1girl, solo, long black hair, red eyes, school uniform, pleated skirt, holding umbrella, standing, rain, city street, night, neon lights, reflection, from side, looking at viewer

### Weighting (ComfyUI)

- (word:1.2) raises a phrase, (word:0.8) lowers it; (word) alone means 1.1. Stay between 0.7 and 1.4; above about 1.5 pictures break (community).
- Weight only the one or two things the picture keeps missing.
- Literal brackets must be escaped: \( and \).
- ComfyUI does not use A1111's BREAK keyword or [word] lowering.

## Writing an edit

This model does not edit pictures.

## Words in the picture

SDXL spells poorly. Ask only for one short word, in quotes with a description: a neon sign that says "OPEN". Expect errors; for real lettering, suggest Qwen Image 2.1, Moss or FLUX. Pony and Danbooru models can use the tag text plus an English description, but spelling stays unreliable.

## Negative prompt

Used: IV Studio runs SDXL with CFG above 1.

- Plain SDXL default: blurry, low quality, worst quality, watermark, text, deformed hands
- Pony: designed to need no negative. If one helps, a short one: score_4, score_5, score_6, watermark, signature (community; Pony notes pseudo-signatures are hard to remove).
- NoobAI official: nsfw, worst quality, old, early, low quality, lowres, signature, username, logo, bad hands, mutated hands, mammal, anthro, furry, ambiguous form, feral, semi-anthro
- Illustrious (community): worst quality, low quality, lowres, bad anatomy, bad hands, signature, watermark
- Per idea: add tags for real risks in this picture (extra fingers for hands in view, text for a sign-free scene, people for an empty place). Keep it short; long negatives dull the picture. Same weighting syntax works there.

## Avoid

- Long prose paragraphs; burying the subject after 75 tokens.
- Pony score tags on non-Pony checkpoints, or Danbooru quality tags on photo models.
- Weights above 1.5, or weighting many phrases.
- Expecting more than a word or two of correct text.
- Contradicting tags (photorealistic with source_anime).
