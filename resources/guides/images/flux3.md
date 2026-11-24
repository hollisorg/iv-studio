# Flux 3 Klein

Source: https://huggingface.co/black-forest-labs/flux-3-image-klein
https://huggingface.co/black-forest-labs/flux-3-image-klein-pup/raw/main/system_prompts.json
https://docs.bfl.ml/flux_3/flux3_image_klein.md
https://docs.bfl.ml/guides/prompting_editing_multi_reference.md
https://docs.bfl.ai/guides/prompting_unified_reference.md
https://bfl.ai/blog/flux-3-image-klein
https://recipes.vllm.ai/black-forest-labs/flux-3-image-klein
Confidence: high. Rules below follow BFL's own prompt upsampler (flux-3-image-klein-pup) system prompts, because IV Studio sends your prompt to the model as written, with no upsampler.

## How it reads a prompt

- Trained on full scene captions (framing, subject, background, lighting). BFL: a short prompt sent as typed gives noticeably weaker, generic results. You are the upsampler: write the full caption.
- Text encoder is Qwen3-VL 4B. Natural English prose, one continuous paragraph, descriptive voice.
- Typical length: 100 to 350 words for a new picture, longer for complex scenes. 50 to 150 words for an edit.
- Makes new pictures and edits with up to 10 reference pictures (IV Studio may allow fewer).
- Rendered text may be inaccurate (model card): keep words short and quoted.
- Describe style through attributes (palette, stroke, texture, film look), not by naming a famous artwork.

## Writing a new picture

Follow the BFL upsampler's order and rules:

1. Open with the medium and style. With no style asked for, plan a real photograph and open with a medium phrase such as "Full-color outdoor photograph", "Studio photograph" or "Close-up photograph". Keep "photorealistic" for renders.
2. Then the scene, lighting and camera.
3. Then each subject with concrete colours, materials and states. Each in-focus person gets gender, age range, skin tone, hair and clothing.
4. Use frame-relative positions ("in the left third", "behind her right shoulder") and describe up to about ten things one by one; beyond that give the exact count and arrangement.
5. Background is shapes, colours and silhouettes, about a sixth of the caption.
6. Keep every subject, count, colour, position, style cue and wording the person gave. Do not swap or narrow them.
7. Resolve open details into one concrete plan: no alternatives, no hedging, no quality or emotion judgments, no closing mood sentence.
8. Add a few ordinary, non-ideal details from the scene for realism.
9. Add depth of field or blur only when asked for or clearly implied.
10. Do not invent names, brands, logos or celebrities; keep any the person gives.
11. Do not mention the aspect ratio or canvas; just lay the picture out to suit its shape (wide spreads sideways, tall stacks).

Example:
Full-color outdoor photograph of a small wooden fishing cabin on the edge of a still mountain lake at dusk. The sky is deep blue fading to pale orange above a dark ridge of pine-covered hills. Soft, low light comes from the setting sun behind the hills on the right, leaving the cabin front in cool shadow. The cabin sits in the left third of the frame on short stilts, with weathered grey planks, a rusted tin roof and one window glowing warm yellow. A narrow plank dock runs from the cabin toward the lower right corner, where a green canoe with a chipped paddle is tied to a post. The water reflects the cabin, the window light and the sky in long smooth streaks. In the foreground lower left, tall dry grass and a few smooth stones edge the shore. The far shore is a dark band of tree silhouettes.

## Writing an edit

- Name the pictures by their order: "image 1", "image 2", and so on (BFL: "image 1" is the first picture). Use the same words each time. Put the picture being changed first: it sets the output size.
- One picture, bounded change: imperative editing language. "Remove...", "Change... to...", "Zoom in on...".
- Whole-picture change (season, style): open with the scope, then say where the main elements end up.
- Several pictures into a new frame: write it as a generation request ("Create a photograph of..."), saying what is taken from each picture by number and what is new.
- Identify things by how they actually look in the picture, and state end states concretely: colour, size, pose, material.
- Cover knock-on effects: shadows, reflections, what fills a removed area, matching light and scale.
- Describe the change, not the whole scene, then close with one short clause saying what stays unchanged. People moved into a new picture keep their identity, face and accessories unless told otherwise.
- BFL: the reference anchors content but does not lock structure, so the closing "keep" clause matters.

Example (two pictures):
Create a photograph of the man from image 1 sitting on the red velvet sofa from image 2, in the same living room with its tall window on the left. He leans back with one arm along the sofa's backrest and looks toward the window. Soft daylight from the window lights the left side of his face and casts a faint shadow onto the cushion beside him. His face, beard, glasses and blue denim shirt stay exactly as in image 1, and the sofa and room stay as in image 2.

## Words in the picture

- Transcribe every word verbatim in double quotes, in its original language and script, keeping line breaks.
- Give the typography (weight, case, style), colour and placement for each piece of text.
- If the idea needs wording the person did not give (a shop sign, a menu), write suitable real words rather than placeholders.
- Distant or out-of-focus areas never carry readable text.
- For an edit that replaces text, give the full new wording and match the original font, size and colour.

## Negative prompt

Not used. The distilled model runs with no guidance (CFG 1) and BFL's API rejects a negative prompt. State exclusions as what is present: "a bare white wall" rather than "no posters".

## Avoid

- Short, keyword-style prompts.
- JSON, coordinates, bounding boxes, IDs, angle-bracket tokens or markdown (the box format needs a separate element table IV Studio does not build).
- Hedging, alternatives, "this image shows", and quality words like "stunning" or "masterpiece".
- Naming the aspect ratio or resolution.
- Readable text in the distant background.
