# ChatGPT Images (GPT Image)

Source: https://developers.openai.com/api/docs/guides/image-prompting.md
https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide.md
Confidence: high for the prompting rules (OpenAI's own guide for its GPT Image models). How the person's ChatGPT passes the prompt to its image tool is IV Studio's own setup, not documented by OpenAI.

## How it reads a prompt

- Plain natural language. No special syntax: short prompts, descriptive paragraphs, instruction lists or labelled sections all work. Choose the form that makes the requirements easiest to read.
- No length limit. One clear sentence works for a simple picture; several short paragraphs suit complex ones.
- Very good at following instructions, at text and layout (posters, diagrams, infographics), and at editing with reference pictures.
- Makes new pictures and edits. In IV Studio an edit takes up to four pictures: the one to change first, then the references.
- The image comes from the person's ChatGPT plan; there are no seeds, weights or settings in the prompt.

## Writing a new picture

1. Start with the subject and what the picture is for: a product photo, an ad, a diagram, a portrait.
2. Composition and placement: framing, viewpoint, where things sit, what is in front and behind.
3. Name the medium. For a photo, say "a real photograph" or "photorealistic" and describe materials, lighting, colours, framing and texture. Camera or lens words are hints about the look, not exact physics.
4. For people: body framing, gaze, pose, and how they hold or touch objects.
5. For wide, low-light, rainy or neon scenes, describe scale, atmosphere and colour directly; mood words alone are less reliable.
6. For complex requests, write it in labelled parts: Scene, Subject, Details, Constraints.
7. End with constraints and exclusions as plain statements: "No watermarks, no logos, no extra text."

Example:
A real photograph for a coffee shop menu board: a single latte in a white ceramic cup on a light oak counter, shot from a low three-quarter angle. Leaf-shaped latte art on top, a small cinnamon stick on the saucer, soft morning window light from the left with a gentle shadow to the right. Background softly blurred: a chalkboard wall and a hanging green plant. Warm, natural colours, fine detail in the foam and wood grain. No people, no logos, no watermarks, no text.

## Writing an edit

- Call the pictures "image 1", "image 2" and so on, in the order given, and give each a role: subject, style, clothing, background. The first picture is the one being changed.
- Say exactly what changes, using "change only ..." wording.
- Then list what must stay the same: identity and face, geometry, layout, lighting, camera angle, labels and text. Name nearby objects or colours to keep for a small local change.
- For several pictures, say how they combine and which element moves where.
- End with "Do not change anything else." or "Do not add new elements or text." when it fits.
- One change per edit is most reliable; if a later edit drifts, restate the keep list.

Example (two pictures):
Put the jacket from image 2 on the woman in image 1. Change only her jacket: it becomes the olive canvas field jacket from image 2, with its brass buttons and chest pockets. Keep her face, hair, pose, jeans, the street background, the lighting and the camera angle of image 1 exactly the same. Do not change anything else.

## Words in the picture

- Put the exact words in quotation marks and say where they go and how they look: font style, weight, colour, size, alignment.
- Spell unusual words, names or brand names letter by letter when needed (for example: "Kyiv" spelled K-Y-I-V).
- For important lettering, mark it as exact: the headline "SUMMER MARKET" exactly as written.
- Ask for no extra text: "No other text appears."
- For an edit that changes or translates text, give the full new wording and say to keep the rest of the design.

## Negative prompt

Not used: there is no negative prompt. Write exclusions straight into the prompt as plain statements, which this model follows well: "No watermarks.", "no logos", "Do not add new elements or text.", "Do not change anything else."

## Avoid

- Tag lists and weights like (word:1.3).
- Mood words alone with no visible detail.
- Several unrelated changes in one edit.
- Leaving out the keep list in an edit.
- Asking for seeds, sizes or aspect ratios in the prompt (IV Studio sets the shape).
