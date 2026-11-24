# Moss (MOSS-Image)

Source: https://github.com/OpenMOSS/MOSS-Image
https://raw.githubusercontent.com/OpenMOSS/MOSS-Image/main/USERGUIDE.md
https://raw.githubusercontent.com/OpenMOSS/MOSS-Image/main/skills/moss-image-prompt-enhancer/SKILL.md
https://raw.githubusercontent.com/OpenMOSS/MOSS-Image/main/assets/prompt_defaults.txt
https://comfyui-wiki.com/en/models/moss-image
Confidence: high. MOSS-Image is OpenMOSS's open 5B image model (Apache-2.0, Qwen3.5 9B text encoder, FLUX.2 VAE), released 2026-10-16 as Base and SFT. Rules below follow OpenMOSS's user guide and its own prompt-enhancer skill.

## How it reads a prompt

- Takes natural language, Danbooru-style tag sequences, or an experimental JSON layout. For IV Studio, write natural language.
- Long prompts are fine: it accepts up to 4K tokens and reads a full scene description well.
- English is recommended (most training data); Chinese and other languages also work.
- Strong at text in pictures, including long passages and Chinese and English, with automatic line breaks.
- Uses real CFG, so the negative prompt matters (see below). OpenMOSS notes higher CFG helps short prompts; long prompts are fine at low CFG, another reason to write fully.
- Prompt only in IV Studio: Moss edits need an edit LoRA IV Studio does not use yet.

## Writing a new picture

Follow the OpenMOSS prompt-enhancer skill:

1. Keep the person's subjects, counts, relationships, medium, style, exclusions and exact wording.
2. Fill ordinary creative gaps yourself with concrete, visible choices: subject and action, relevant appearance, setting, camera and framing, medium, lighting, materials, palette and mood.
3. Write cohesive prose. Put spatial relations in words (left, behind, in the lower corner). It may run to several paragraphs for a dense scene.
4. Keep a minimalist brief minimalist; develop a rich brief without turning it into a generic title, hero and footer template.
5. For designed pictures (posters, slides, menus), set the reading order, what is most prominent, and coherent groups, and write the real copy, never placeholders like "headline here".
6. Do not import unrelated names, watermarks or copy.
7. Optional: OpenMOSS's demo pre-fills the prefix "best quality, masterpiece". You may start with it; add no other quality words.
8. Tag style only if the person writes tags: order them Quality, Score, Meta, Year, Character, Series, Artist, General.

Example:
best quality, masterpiece. A wide photograph of a small independent bookshop at night seen from the street. Warm yellow light spills from a large front window onto wet cobblestones. Inside, tall wooden shelves packed with colourful spines line the back wall, and a young man in a mustard sweater reads in a green armchair beside a brass floor lamp. A hand-painted sign above the window reads "THE LAST CHAPTER" in gold serif capitals on a dark blue board. On the glass, small white handwritten lettering reads:
"Open late
Tea & stories"
To the right, a black bicycle leans against the brick wall, its wheel reflecting the window light. Light rain falls in soft streaks across the frame, and the street fades to deep blue shadow on both sides.

## Writing an edit

This model does not edit pictures in IV Studio.

## Words in the picture

- Quote every visible word exactly, in its original language, with its punctuation and capitalisation.
- Describe the layout of the text: position, alignment, size hierarchy, font style, colour, and ordering.
- To control line breaks, put real line breaks (or \n) inside the quoted text, as above. Otherwise the model breaks lines on its own, not always as wanted.
- A quoted sentence in the idea is not always text to render: tell apart wording for the picture from instructions or reference material.

## Negative prompt

Used. IV Studio runs Moss with CFG above 1, so the negative prompt is applied.

- Good default (OpenMOSS's recommended tags, which also start with "nsfw"; IV Studio's default leaves that one out): worst quality, bad anatomy, watermark, jpeg artifact
- Per idea (general practice, not from OpenMOSS): keep the default and add only a few short tags for real risks in this picture, such as extra fingers and blurry face for a close portrait, text and lettering for a picture that should carry no words, or people for an empty landscape.
- Keep it short and made of tags, not sentences. Never put anything the person wants into the negative.

## Avoid

- The JSON layout format: it needs exact pixel boxes for the final canvas size, which the writer does not set.
- Placeholder copy and invented brands or watermarks.
- Long lists of quality words beyond the optional prefix.
- Contradicting the person's medium or style.
- Huge negatives that fight the prompt.
