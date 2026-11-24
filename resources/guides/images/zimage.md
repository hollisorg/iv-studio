# Z-Image Turbo

Source: https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
https://raw.githubusercontent.com/Tongyi-MAI/Z-Image/main/README.md
https://huggingface.co/spaces/Tongyi-MAI/Z-Image-Turbo/raw/main/pe.py
https://docs.comfy.org/tutorials/image/z-image/z-image-turbo
Confidence: high for the writing rules (they follow Tongyi-MAI's own prompt-enhancer instructions in pe.py); medium for the length range, which comes from the official example prompts and community use.

## How it reads a prompt

- Natural language, in English or Chinese. Text encoder: Qwen3 4B, so it reads full sentences well.
- 8-step distilled model with no classifier-free guidance. It cannot be pushed with weights or a negative: everything has to be in the prompt.
- Works best from a detailed, objective visual description. A good length is about 80 to 250 words.
- Strong at photographic pictures and at rendering Chinese and English text.
- Lower diversity than the base model: the same prompt gives similar pictures across seeds, so variety comes from changing the words.
- Prompt only: it makes new pictures and does not edit.

## Writing a new picture

Follow Tongyi-MAI's prompt-enhancer sequence:

1. Lock the core: subject, count, action, state, and any named character or IP, colours and words the person gave. These must survive exactly.
2. If the idea is a question or a design task rather than a scene ("a diagram of how a bike gear works", "a poster for a bake sale"), first decide one complete, concrete solution in your head, then describe that solution as a picture.
3. Add professional visual detail to the settled picture: composition and framing, lighting and atmosphere, materials and textures, a colour scheme, and layered space (foreground, middle ground, background).
4. Handle text last and precisely (see below).
5. Keep it objective and concrete: describe what is seen. No metaphors, no emotional rhetoric, no meta tags like "8K" or "masterpiece", and no drawing instructions.
6. Output only the finished description.

Example:
A medium close-up photograph of an elderly man in a dark green wool cap and a brown corduroy jacket, sitting on a wooden bench in a small city park in late autumn. He holds a paper cup of coffee in both hands, steam rising from the lid, and looks toward the right edge of the frame. Behind him, a row of maple trees with orange and yellow leaves stands along a gravel path, softly out of focus. Fallen leaves cover the ground around the bench legs. Low afternoon sunlight comes from the left, lighting one side of his face and the creases of his jacket, while the other side falls into soft shadow. The colour palette is warm oranges, browns and muted greens, with a shallow depth of field and natural skin texture.

## Writing an edit

This model does not edit pictures.

## Words in the picture

- Transcribe every word that should appear exactly, character for character, inside English double quotes ("").
- For posters, menus, UI and other designs, give all the text they contain and describe the font and the layout.
- For signs, road signs, screens and labels in a scene, give the exact words and their position, size and material.
- If you add an element with text yourself (a chart, worked steps of a solution), every word in it follows the same rules.
- If no text is needed, put all the effort into visual detail and do not mention text.

## Negative prompt

Not used. Z-Image Turbo runs without CFG (IV Studio uses CFG 1), so a negative prompt has no effect; Tongyi-MAI's own example sets guidance to 0 for Turbo. Say exclusions as what is present: "a clear blue sky" rather than "no clouds", "plain unmarked packaging" rather than "no logo".

## Avoid

- Meta tags and quality words: "8K", "masterpiece", "best quality", "highly detailed".
- Metaphors and feelings in place of visible facts ("a dreamy, magical vibe").
- Weights like (word:1.3) and keyword lists.
- Vague or figurative wording; the enhancer rule is "objective and concrete".
- Asking for an edit of an existing picture: it can't.
