# Animal Cam

Workflows → Animal Cam: animal videos that look filmed on a phone, as a seven-step wizard, rendered by MiniMax H3 on
this PC. The method follows pik.vik1's Higgsfield guide on realistic animal phone footage, rewritten in IV Studio's
own words and fitted to H3. No text or prompts were copied from the guide or from its downloadable skill.

## The steps

1. **Your animal**: a reference sheet (made here from a pet photo or from words, or your own), or a character; its
   species, real size, everything it wears, and its state in this scene (dry, soaked, muddy, snowy, dusty).
2. **The idea**: one line, a genre (gym and sport, everyday comedy, caught on camera, horror, wholesome; each fills in
   the place, light and sound where they're empty) and a length of 5, 10 or 15 s.
3. **Who's filming**: the unseen person holding the phone (close, audience, secret), where they stand, which way the
   animal faces, and at most one special camera move with its reason in the scene.
4. **Place and people**: the place, a size anchor, up to three people in the background with one task each on one
   named thing, someone who doesn't care, and someone who notices late.
5. **What happens**: the action and its mechanics, then six timed beats (hook, build, progress, check, payoff,
   ending) fitted to H3's real length. **Draft the beats** has the Settings prompt writer fill the empty ones.
6. **Sound**: the only sounds in the clip, with a sharp hook sound before 1.5 s and the animal's own sound with its
   kind, pitch and the second it peaks.
7. **Check and film**: the checklist, IV Studio's prompt checker, then three takes, pick one, finish it, and make a
   vertical edit (as a phone-style 1080×1920 file unless that's turned off). **What broke?** points at the one setting
   that controls each common fault.

## Fitted to H3

- H3 has no negative prompt: every noun is something to show. The guide's "no music, no extra sounds" lists are
  written as "Only these sounds are heard" with `non_diegetic_music: N/A`; the house sentences "No one speaks." and
  "It is one continuous take with no cuts." stay, as elsewhere in IV Studio. The checklist flags a negative a person
  writes into a beat.
- The beats are timed on H3's frame grid (24 fps, 17n+5 frames): 10 s renders as 10.125 s, 5 s as 5.167 s, 15 s as
  15.083 s. The phone finish keeps H3's 24 fps; it doesn't make up frames.
- Without an H3 LoRA the animal is a referenced subject (`cast.js` kind `animal`): its sheet is attached as a picture
  and kept "exactly as pictured", including everything it wears. A character with an H3 LoRA or RefMod is the shot's
  character instead.
- The check beat repeats the outfit, the size anchor and the facing, and the payoff times the animal's mouth to its
  sound, as the guide advises.

## The sheet model test (2026-11-20)

One made-up pet photo (a grey British Shorthair, made with ChatGPT Images for the test), one sheet from each picture
model that can edit here, through `make_animal_sheet`:

| Model | Time | Result |
|---|---|---|
| Flux 3 Klein (int8) | 40 s | Same cat in all three panels, copper eyes and round face kept; hat and suspenders worn front and back. **Picked as the default.** |
| ChatGPT Images | 40 s | The best likeness, but the hat sits on the floor in the middle panel. Second choice. |
| Krea 2 (Krea2Realism) | 4 min | Eye colour drifted to green, fur darker, one suspender strap missing. |
| Qwen Image 2.1 | failed | `normalized_shape=[4096] ... [1, 2201, 2560]`: this PC's Qwen text encoder is the 4B one (GitHub #46). |

Flux.2 Klein isn't installed here and wasn't tested. The window offers the models in this order: Flux 3 Klein,
ChatGPT Images, Flux.2 Klein, Krea 2, Qwen Image, H3 Image.

## Real renders (2026-11-20)

Two 10 s clips of the same made-up cat, Pepper (the Flux 3 Klein sheet), through the MCP tools on scratch data, on
this PC's RTX 4090 (ComfyUI 0.30.0 Seedhunter profile). Three takes each, at the first-render size (480×864), then one
finished at 2 MP (1088×1952) and made into a vertical edit with the phone finish (1080×1920, 24 fps, about 3.1 Mbit/s,
4.1 MB). Hunting took about 11 and 18 minutes (the second waited in the queue), each finish about 14 to 15 minutes.

**Gym** (beats written by hand, checklist 17/17): take 3 picked. Pepper lies back in the leg press, hind paw pads
flat on the foot plate, knees folding and extending; paws stay paws; hat and suspenders as on the sheet in every frame;
his size against the foot plate holds; the treadmill walker, the woman on her phone and the young man who notices are
there. Weak: the forepaws hover by his chest instead of pressing the side handles, and the hat brim hides most of his
face. Takes 1 and 2 had him lying on his belly on the seat. Sound by loudness only: a sharp peak at about 0.75 s (the
hook was asked for at 0.6 s), quiet room tone around −37 dB between, bursts near 5.3 s and 7.9 to 8.6 s (the meow was
asked for at 7.3 s); no steady bed that would suggest music. Not listened to.

**Comedy** (beats drafted by Claude through `draft_animal_beats`): take 3 picked. Pepper presses a sponge onto a
plate in the sink with both forepaws; the man in the blue jumper dries a mug and stares late; the girl at the table
keeps her eyes on her phone; hat and suspenders hold. Weak: in the last third Pepper turns his back to the phone while
his paws stay on the sponge, so his body reads as twisted; the window backlight is more golden than ordinary phone
footage. The draft's payoff had him "turn to face" the man behind him, which H3 took as turning away; keeping him
facing the phone in the payoff is the one-line fix.

The checklist's paw check first flagged "thumb" in a sentence about the girl's phone; it now reads only sentences
about the animal (tested).

Not checked: a real person listening to either clip, a physical phone, another species, the 5 s and 15 s lengths in
a render, a character with an H3 LoRA as the animal, the sheet from words instead of a photo.

## The window (2026-11-20)

A test copy of the app on scratch data, driven over DevTools: 28/28. The card on Workflows with its art, the list,
a new clip from a genre button, seven steps by Next, a field saving on blur, the sheet model picker starting on Flux 3
Klein, no sideways overflow on any step at 1440 or 1100 wide, the checklist's misses on step 7 and their jump to the
step, Film blocked while there are misses, the gym clip's checklist clear and its H3 prompt shown, no console errors.

## Code

- `src/service/animalcam.js`: presets, beat times, the prompt, the checklist, writer briefs, the sheet prompt, the phone
  finish, and the `AnimalCams` service (storage, sheets, hunt, finish, edit).
- `src/renderer/src/components/AnimalCam.jsx` and `animalcam.css`: the wizard.
- `src/main/index.js` (`ac:*`), `src/preload/index.js` (`animalcam`), MCP tools `list_animal_cams`,
  `create_animal_cam`, `get_animal_cam`, `set_animal_cam`, `make_animal_sheet`, `draft_animal_beats`,
  `check_animal_cam`, `render_animal_cam`, `finish_animal_cam`, `assemble_animal_cam`.
- `test/animal-cam.mjs` (in the Linux CI list).
