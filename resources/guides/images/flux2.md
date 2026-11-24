# FLUX.2 [klein] 9B

Source: https://docs.bfl.ai/guides/prompting_unified_reference.md
https://docs.bfl.ai/guides/prompting_guide_flux2.md
https://help.bfl.ai/articles/7592221790-how-do-i-generate-quickly-with-flux-2-klein
https://huggingface.co/black-forest-labs/FLUX.2-klein-9B
https://huggingface.co/black-forest-labs/FLUX.2-klein-base-9B
Local skill flux-best-practices (Black Forest Labs): SKILL.md, rules/flux2-models.md, t2i-prompting.md, i2i-prompting.md, multi-reference-editing.md, typography-text.md, negative-prompt-alternatives.md
Confidence: high for new pictures and reference naming; medium for text (BFL's text rules are written for FLUX.2 [pro]/[max] and apply to klein by family).

## How it reads a prompt

- Natural language. Write flowing prose, like a novelist describing a scene, not a list of keywords. BFL: the model gets your text exactly as written.
- Klein has no prompt upsampling, so the prompt must carry all the detail itself. A thin prompt gives a generic picture.
- Word order matters: FLUX.2 pays more attention to what comes first. Put the main subject first.
- Ideal length: about 30 to 80 words for most pictures; up to about 120 for busy scenes. Every sentence should describe something visible.
- Lighting has the biggest single effect on quality: always say where the light comes from and whether it is soft or hard.
- Good at photographs, illustration, product shots and editing with several reference pictures. Rendered text can be inaccurate or distorted (model card): keep words short.
- The distilled model runs 4 steps at CFG 1; the base model runs more steps with real CFG and gives more varied results. Both read prompts the same way.

## Writing a new picture

1. Subject first: who or what, count, age range, clothing, material, defining details.
2. Action or pose, and how the subject relates to anything else.
3. Setting and context: place, time of day, weather, what is in the foreground and background.
4. Lighting: source, direction, quality (soft, hard, golden hour, overcast, neon), and the shadows it makes.
5. Composition: shot size, camera height and angle, where the subject sits in the frame.
6. Style or medium: one clear choice (a photograph, a watercolour, a 3D render). For photographs a camera or lens may be named when it explains the look.
7. Any words to show, in quotation marks (see below).
8. Optionally end with a short line in BFL's klein pattern: "Style: <style>. Mood: <mood>."

Exact colours: write a hex code tied to one object, for example "a ceramic mug in color #0047AB".

Example:
A weathered fisherman in his seventies mends a green net on a wooden dock at golden hour, his calloused hands working the knots while gulls circle overhead. Warm low sunlight comes from the left, catching the salt spray in the air and rimming his grey beard with light. He sits in the left third of the frame on an upturned crate, with blurred fishing boats and a pale harbour wall behind him. Medium shot at eye level, shallow depth of field. Style: documentary photograph on 35mm film. Mood: quiet and nostalgic.

## Writing an edit

- The pictures are named by their order: "image 1", "image 2", and so on. BFL documents up to 4 references for klein; with more, results get less reliable.
- The first picture is the one being changed and sets the output size, unless the person says otherwise.
- Give each picture a role: identity, outfit, pose, background, style or product.
- Say exactly what changes, then say what stays: "keeping the face, pose, clothing and lighting exactly the same".
- One clear change per edit works best. For a big transformation, describe the finished result rather than a list of steps.
- To keep a style while changing content, say so: "maintain the photographic style and colour grading".

Example (two pictures):
Place the woman from image 1 in the sunlit cafe from image 2, seated at the window table on the right, holding a white cup in both hands. Keep her face, hairstyle and green coat from image 1 exactly the same. Match the warm afternoon light from the window in image 2, with soft shadows falling to her left.

## Words in the picture

- Put the exact words in quotation marks: a sign reading "FRESH BREAD".
- Mention the text early in the prompt, and keep each string short (one to four words works best).
- Say where it sits, its size (large headline, small caption), the font style (bold condensed sans-serif, elegant script) and colour (a hex code for brand colours).
- For an edit, give the full new wording and say to keep the original font, size and colour.

## Negative prompt

Not used. BFL: FLUX.2 does not support negative prompts; describe what you want, not what you don't want. The distilled model samples at CFG 1, so a negative has no effect there anyway. Say exclusions as what is present instead:
- "no people" becomes "an empty street"
- "no blur" becomes "sharp focus throughout"
- "no text" becomes "plain unmarked surfaces" (only when text might otherwise appear)

## Avoid

- Keyword lists and tag soup ("4k, masterpiece, trending").
- Words like "no", "without", "don't" for things to leave out.
- Conflicting styles in one prompt (photorealistic and watercolour).
- Long paragraphs of text to render.
- Vague edit wording such as "make it better" or "change the background" without saying to what.
