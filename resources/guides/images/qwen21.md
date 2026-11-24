# Qwen Image 2.1

Source: https://raw.githubusercontent.com/QwenLM/Qwen-Image-2.1/main/README.md
https://raw.githubusercontent.com/QwenLM/Qwen-Image-2.1/main/prompt_rewrite/pe_core.py
https://huggingface.co/Qwen/Qwen-Image-2.1-PE-T2I/resolve/main/system_prompt.txt
https://huggingface.co/Qwen/Qwen-Image-2.1-PE-I2I/resolve/main/system_prompt.txt
https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1
Confidence: high. Rules below follow Qwen's own prompt-enhancer (PE) system prompts for text-to-image and editing.

## How it reads a prompt

- Natural language in English (Chinese also works). Text encoder: Qwen3-VL 8B, reading the words and reference pictures together.
- New pictures: Qwen's enhancer writes one long paragraph of about twenty sentences, roughly 400 to 500 words, describing the finished image as an observer looking at it. A short idea still gets a full-size description: you invent the rest of the frame.
- Very strong at text in pictures: dense small text, posters, slides, UI, packaging and charts hold up.
- Edits with reference pictures (IV Studio allows up to three). The first picture is the one being edited.

## Writing a new picture

1. Note what the person fixed (every text string, named object, count, colour, position) and keep it unchanged; decide everything else.
2. Opening sentence, about twenty words: "The image is a <vertical / wide / square> <style> <photograph / poster / illustration...> of <subject>, <background and palette>." Never leave out the medium noun.
3. Background and surface right after the opening.
4. Walk the frame. For layouts and busy scenes: top band, then left, centre, right, then the bottom band. For a single subject: background, pose and placement, head and face, body and each garment, what it holds, the edges.
5. Use eight to fourteen positional phrases reaching corners, edges and centre; start about a third of sentences with one ("On the right side of the frame, ...").
6. Set every piece of text (see below).
7. Give lighting its own sentence: "The lighting is ..." with source, direction, quality and shadows.
8. Close with exactly one sentence: "The overall composition ..." covering balance, palette, style and mood.

Throughout: present tense, third person; name colours with a modifier (deep navy, pale cream); give materials (brushed metal, coarse linen); enumerate items, write small counts as words; people get build, posture, gaze, expression, hair, skin tone, each garment, and age as a life stage (in her thirties), never a number; objects by class, not brand, unless named; shadows and reflections must agree with the light. The enhancer may use "appears to be" for details the person left open, but is definite about everything the person fixed. Never write a ratio, resolution or pixel count.

Example (shortened):
The image is a vertical realistic photograph of a small corner bakery at early morning, with a warm cream and terracotta palette. The background is a pale plaster wall with a faded green awning across the top of the frame. In the upper centre, a hand-painted wooden sign reads "MARA'S BAKERY" in large cream serif capitals on deep green. On the left side of the frame, a tall window shows wire racks of golden round loaves and braided rolls. In the centre, a middle-aged woman with a flour-dusted navy apron and dark hair tied back arranges croissants on a slate tray. On the right side, a small chalkboard reads "FRESH SOURDOUGH" with "7 AM" on a second line in white chalk letters. The lighting is soft low sunlight from the left, casting long shadows of the loaves across the tray. The overall composition is balanced and warm, with a calm, homely morning mood.

## Writing an edit

- Write an instruction, leading with the operation, from the view of someone holding only the input pictures.
- One picture: refer to it naturally ("the image"); no tags. Two or more: refer to each as <image1>, <image2>, <image3>, never "the first image" or "Picture 1". Say which picture is the canvas (its composition survives) and what is taken from each.
- Edit exactly what was named, strongly enough to be unmistakable, and hold everything else at input fidelity.
- Say what stays with one blanket clause, naming kept things by type and position, not by re-describing them (re-describing makes them drift).
- Identity, a product's exact design, and the picture's medium survive every edit unless targeted. Point at the reference picture for identity rather than describing the face.
- When something is removed or moved, say what fills the exposed area.
- Add no operations or clean-ups the person did not ask for. One paragraph, affirmative wording ("keep the background identical"), no hedging.
- For a painted mask, name its colour: "change the jacket in the red area".

Example (two pictures):
Dress the man in <image1> in the light blue denim shirt from <image2>, buttoned to the collar with the sleeves rolled to the elbow, replacing his grey t-shirt. Keep his face, hair, body shape, pose, the background and the lighting of <image1> unchanged, and keep the shirt's fabric, stitching and pocket details from <image2>.

## Words in the picture

- Every string that will be legible goes in straight double quotes, character for character, in its own script.
- For each string, in reading order, say where it sits, its weight, colour, case and relative size: a bold black headline across the top reads "...".
- Describe a line break as a second line, not a newline inside the quotes.
- Chart axes, tick labels, legends and table cells are text too: write them out.
- Distant text not meant to be read: call it blurred or too small to read. Invent no signage for a picture that needs no text.
- In an edit, keep the language of the picture's existing text unless told otherwise, and give the exact new words.

## Negative prompt

Not used here. IV Studio runs Qwen Image 2.1 at CFG 1, where ComfyUI skips the negative pass, so a negative has no effect. State the wanted result positively in the prompt.

## Avoid

- Quality boosters: "masterpiece", "8K", "highly detailed", "award-winning".
- Talking to the model: "create", "make sure", "you".
- Ratios, resolutions or sizes in the prompt.
- "Picture 1", "the first image" or "image A" in multi-picture edits.
- Brand names the person did not give.
- Summaries like "various decorations" instead of naming each thing.
