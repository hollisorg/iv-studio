# MiniMax H3 Image

Source: https://github.com/MiniMax-AI/MiniMax-H3-Image
https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3-Image/main/skills/h3-image-prompt-writing/SKILL.md
https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3-Image/main/skills/h3-image-prompt-writing/references/t2i-en.txt
https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3-Image/main/skills/h3-image-prompt-writing/references/edit-en.txt
https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3-Image/main/examples/revised_prompt.edit.txt
Confidence: high. Distilled from MiniMax's own h3-image-prompt-writing skill. A local ComfyUI run does not expand prompts, so the prompt you write is what the model gets.

## How it reads a prompt

- Natural English prose describing the finished picture: what it is for, what is in it and where, how it looks, and every word on it. Text inside the picture keeps its own language.
- Follows long, detailed descriptions closely. New pictures: one or more flowing paragraphs, often 150 to 350 words. Edits: one paragraph.
- Very large pictures (4 to 16 MP) with fine detail; strong at posters, infographics, charts, UI, product shots and storyboards or grids.
- Edits with up to 16 reference pictures.
- Distilled to 6 steps with no CFG.

## Writing a new picture

1. Task before style: open with what the picture is and what it is for, then the main people or objects and their state or action.
2. Layout before details: number of subjects, their positions, the viewpoint and the empty space. For dense content, name the regions first, then fill each ("a title across the top; below it, a photo on the left and three short paragraphs on the right").
3. Make scenes physically readable: one frozen moment; consistent left and right, foreground and background, gaze; hands, support points and contact must agree.
4. Style through visible details: colour, material, light, texture ("soft side light, brushed-metal reflections, generous white space"), not words like "premium".
5. Designed pieces get real content in every region: actual titles, labels, controls, axis values. Write the copy yourself when asked.
6. Data must be right: exact values, units and relationships; do the arithmetic yourself; never present invented numbers as real.
7. Grids: "2 rows and 3 columns", never "2x3"; address a cell as "row 2, column 1".
8. If the picture has no text, end with: "The image contains no text, letters or numbers."

Example:
A naturalistic photograph of a woman potter seated at a pottery wheel in a sunlit workshop, viewed from her left side at about hand level. A medium composition includes her profile, shoulders, forearms, hands and the complete bowl on the wheel. She leans slightly forward and looks down at the clay. Her left hand supports the bowl's outer wall while the fingertips of her right hand shape the inner surface near the rim. Wet slip coats her fingertips and gathers in fine ridges on the bowl. Soft sunlight from a side window catches the moisture on the clay and casts gentle shadows beneath her wrists. A worn wooden workbench recedes out of focus. The image contains no text, letters or numbers.

## Writing an edit

Write one paragraph in this order: source definitions, then the target and each source's relationship, then the changed details. Narrate the finished state ("The former location is filled by continuous tabletop"), not a command.

1. Name the pictures <Picture 1>, <Picture 2>, ... in the order given. Define what you use from them as <Subject N>, grounded in what is visible: "The red cup at the left of <Picture 1> is <Subject 1>." Keep the numbers stable. Define a donor that only lends a property (a colour, a style) as that property, not the whole object.
2. Start the overview with "The target image" and state the main result.
3. Give every Subject its own relationship:
   - Fully preserved: exactly "<Subject N> is fully preserved." as its own sentence.
   - Partially preserved: say which aspects stay and which change.
   - Attribute transfer: "<Subject 2> supplies the exact body color transferred to <Subject 1>."
   - Weak reference: name the borrowed quality and what may vary.
4. Then describe only the changed or new content: shape, material, contact, light, layout. Say what fills a removed area. Do not re-describe fully preserved things.
5. Text in the source: transcribe every readable line in its definition; give the complete new line for any change; say that no other lettering is added.
6. Unmentioned content stays stable; name a nearby element as preserved when the change might disturb it.

Example (one picture):
The red cup on the left in <Picture 1> is <Subject 1>. The lemon on the right in <Picture 1> is <Subject 2>. The target image shows <Subject 1> with a blue finish. <Subject 1> is partially preserved; its shape, material, position and scale remain while its surface color changes. <Subject 2> is fully preserved. The blue finish follows the existing surface shading and highlights of <Subject 1>, with the rest of the source image unchanged.

## Words in the picture

- Quote every word that appears, complete and exactly as given, with its spacing, in single or double quotes, in its own language.
- Give its position, size hierarchy and line breaks (describe lines in reading order: "on two centered lines: 'A quieter kind' followed by 'of bold.'").
- When asked to write the copy, write the actual words, never placeholders.
- No text wanted: say so explicitly (see above), because the model otherwise adds titles, labels or decorative lettering.

## Negative prompt

Not supported: MiniMax rejects a negative prompt and the model runs without CFG. State exclusions inside the prompt as plain facts: "The composition contains no other lettering, brand names or decorative props", "No additional people appear."

## Avoid

- Vague quality words ("premium", "high-end", "stunning") where a visible detail can say it.
- Commands in edits ("change the cup to blue"); describe the target state instead.
- Ranges like "<Picture 1-3>" or "all references": cite each picture.
- "2x3" for grids.
- Invented data presented as real.
- Aspect ratio or size inside the prompt (IV Studio sets the shape).
