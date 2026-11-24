# MiniMax H3 (a still frame)

Source: IV Studio's own guidance, built on MiniMax's H3 video text-mode prompt format (integrated_multimodal_description, overall_soundscape, non_diegetic_music) as used by IV Studio's H3 shot writer. Read: local skills minimax-h3-ultra (references/h3-ultra-spec.md) and iv-studio (SKILL.md), and IV Studio's src/service/images.js (the still's render graph).
Confidence: medium. This is IV Studio's own guidance, not a MiniMax document: the picture is one frame taken from the middle of a very short H3 text-to-video render, with the person's H3 character LoRAs.

## How it reads a prompt

- H3 is a video model. Here it renders a very short clip and IV Studio keeps one frame, so the prompt describes a single frozen moment, framed as one cinematic shot.
- Natural English prose in H3's text-mode layout (below). Keep it short: about 60 to 120 words for the shot.
- A character LoRA carries the character's face and body. When trigger words are given, start the prompt's description with them exactly, then call the character by a plain noun ("the woman", "the man"). Never write {char} or a placeholder: pictures send the prompt to H3 as written.
- Good at cinematic, filmic pictures that match the look of the person's H3 shots. Weak at exact text and busy layouts.
- Prompt only: it does not edit pictures.

## Writing a new picture

1. Start the prompt with "integrated_multimodal_description: [Shot 1]".
2. Any LoRA trigger words first, exactly as given; then the style: the look in a few words ("Photorealistic cinematic film still", "35mm film, warm grade").
3. The place: setting, time of day, weather, two or three concrete background details.
4. The character: clothing, hair styling if it matters, pose, expression and what they hold or touch, in one held moment. With a character LoRA, do not describe their face, skin, eye colour or body shape: the LoRA carries them.
5. Other people briefly, by clothing and position only.
6. Camera: shot size, angle, lens feel and where the character sits in the frame. A static camera.
7. Light: source, direction, quality and colour.
8. If no text is wanted, add: "There is no writing anywhere in the picture." (H3 likes to add signs.)
9. Then two short lines: "overall_soundscape:" with a few quiet words of ambience, and "non_diegetic_music: N/A". The sound is thrown away, but the layout keeps H3 in its usual mode.

Example:
integrated_multimodal_description: [Shot 1] Photorealistic cinematic film still, warm 35mm grade. A narrow rain-soaked alley in an old harbour town at blue hour, wet cobblestones reflecting a single amber wall lamp, stacked wooden crates on the left. The woman stands in the centre of the frame in a dark wool peacoat and grey scarf, one hand resting on a crate, looking back over the shoulder toward the camera with a calm, guarded expression. Medium shot at eye level, static camera, shallow depth of field. Cool blue ambient light with warm lamp light from the upper right edging the coat. There is no writing anywhere in the picture.
overall_soundscape: Light rain and distant harbour water.
non_diegetic_music: N/A

## Writing an edit

This model does not edit pictures.

## Words in the picture

H3 is not reliable at exact text. Keep any wanted words to one short phrase in quotes on a clear surface (a shop sign reading "OPEN"). For real lettering, suggest MiniMax H3 Image, Qwen Image 2.1 or ChatGPT Images. Without wanted text, always add "There is no writing anywhere in the picture."

## Negative prompt

Not used here: the still renders through H3's own guider with no negative prompt. Say exclusions as facts in the description: "The street is empty apart from the woman", "There is no writing anywhere in the picture."

## Avoid

- Motion beats, sequences or timings ("she turns, then walks away", "at 2 seconds").
- Camera moves (dolly, pan, zoom); keep the camera static.
- Dialogue, speaker labels, <d> tags or spoken lines.
- More than one shot or cut.
- Describing the character's face, eyes or body when a character LoRA is used.
- {char} or any other placeholder: write the trigger word and a plain noun instead.
- Long prompts: the clip is very short and one moment is enough.
