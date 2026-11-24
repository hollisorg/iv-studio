# Krea 2

Source: https://github.com/krea-ai/krea-2/blob/main/docs/prompting.md
https://github.com/krea-ai/krea-2/blob/main/docs/expansion.txt
https://github.com/krea-ai/krea-2
Matthew Hollis's Krea 2 prompt-writer playbook (built from the sources above and Krea's blog posts).
Confidence: high for new pictures; medium for edits (IV Studio edits Krea 2 with the Krea 2 Identity Edit LoRA).

## How it reads a prompt

- Natural language. Long, detailed prompts give the most control; short prompts also work when the person wants to explore.
- Krea 2 RAW and Krea 2 Turbo read prompts the same way. Turbo makes pictures up to about 2K.
- Strong at aesthetic, photographic and illustrated looks, many fine-tunes, and quoted words.
- Weaker at long text, complex diagrams, exact multi-object layouts and exact product packaging: keep those simple.

## Writing a new picture

Plan it in this order, then write ONE cohesive paragraph (no bullets, no JSON, no tags):

1. The main subject and its defining attributes (who or what, count, age, clothing, material).
2. Pose, action or interaction.
3. The setting, with grounded spatial relationships: left/right, foreground/background, what is next to what.
4. Composition: viewpoint, framing, camera height, how much of the frame the subject fills.
5. Lighting and atmosphere.
6. Palette, materials, surface and texture.
7. Medium and finish (photograph, digital painting, ligne claire illustration, 3D render, cel animation...).
8. Any words to show, in quotation marks, exactly as asked.

Rules (from Krea's own expansion recipe):
- Faithfulness first: keep every subject, action, colour and spatial relationship the person gave. Add no new objects, props, people or animals unless clearly implied.
- Group each subject with its own attributes and action, so details don't swap between subjects.
- Choose one coherent style, medium, light and framing; never offer alternatives inside the prompt.
- Don't invent very specific clothing, colours, materials or scene details the idea doesn't support.
- If the idea is already detailed, polish it lightly and keep the person's wording.
- Keep the medium the person asked for: a photograph stays a photograph, an illustration stays an illustration.
- Translate vague words into visible evidence: "premium" becomes restrained styling, controlled highlights, refined materials and clean negative space, only if that fits.
- Treat people with dignity; clothing covers intimate anatomy.
- A lens length only when it explains perspective or depth, not to sound photographic.

Example:
A tiny, russet-brown harvest mouse clings to a slender diagonal branch amid vibrant green lobed leaves and small round buds. The mouse has soft textured fur, glossy black eyes, a pink nose, fine whiskers, and delicate pink paws gripping the wood. In this macro photograph, an extremely shallow depth of field sharply focuses on the animal's face. The deep green background dissolves into smooth, creamy bokeh, lit by soft, diffused natural light that brings out the fur and foliage.

Short tag-style prompts also work for quick exploration, for example: "3D rendered matte black designer toy figure, stylized round shape, oversized gold aviator sunglasses, smooth vinyl texture, studio lighting, solid vibrant blue background, high contrast minimal composition". Prefer the paragraph unless the person writes in that style.

LoRAs: put a LoRA's trigger words first, exactly as given, then describe the scene without redescribing what the LoRA learned (a character LoRA carries the face; describe clothes, pose, place and light).

## Writing an edit

IV Studio edits Krea 2 with the Krea 2 Identity Edit LoRA: one source picture, which the model sees while it reads the prompt.
- Write one clear instruction in plain sentences: say what changes, then what stays the same, for example: "Change the background to a rainy neon street at night. Keep the woman's face, hair, expression and pose exactly as they are; keep her grey coat."
- Describe the change concretely (new place, light, clothing, time of day), as you would describe that part of a new picture.
- Always name what must stay: the person's identity and face first, then pose, clothing, framing, unless the person asked to change them.
- One main change at a time works best. Don't ask it to repaint the whole picture and keep identity at once.
- Don't call the picture by a number; there is only one.

## Words in the picture

Put the exact words in double quotes with their placement and look, e.g. a poster with the headline "NIGHT SIGNAL" in large condensed capitals across the top. Keep text short, say "no other text" when it matters, and avoid busy detail around the words.

## Negative prompt

Krea 2 Turbo runs without guidance, so a negative prompt does nothing there; don't rely on one. Say exclusions positively inside the prompt instead ("a clean, empty background", "no other text or logos") and only when they matter.

## Avoid

- Midjourney switches, (word:1.3) weights, prompt-token soup, stacked artist names.
- Settings in the prompt: size, aspect ratio, steps, seed, CFG.
- Several competing styles or mediums.
- Inventing a person's ethnicity, age, brand or story the idea didn't give.
- Asking a style or an edit to guarantee exact packaging, logos or long text.
