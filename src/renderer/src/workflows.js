// The Workflows tools: one card each on the Workflows page, in this order, each its own page. needs: what a tool
// requires beyond IV Studio itself, shown on its card and on its page (FlowKit's WorkflowNeeds), so nobody starts
// one without it. New tools are added here.
// example: what the card's Example pop-up shows (WorkflowExample.jsx), from resources/examples (examples.json lists
// every file). kind compare: before and after videos with a wipe line (tabs when there's more than one); steps: the
// pictures that went in, then the video; video: one video, its strip the labelled stretches that light up as it
// plays. sound: the video's sound is worth hearing (it still starts muted). tall: a vertical video. A tool without
// an example has no Example button.
export const WORKFLOWS = [
  {
    page: 'replace',
    name: 'Replace',
    tag: 'Swap who is in the shot, or change the scene',
    about: 'Like Higgsfield’s Genjutsu, on your own PC: put your characters in place of people in a video, or change the scene in plain words: snow, night, a new setting, something removed. IV Studio paints the frames, you check them, and the camera, motion and soundtrack stay.',
    needs: ['H3 on this PC', 'Its node packs and models (the page lists them)'],
    example: {
      kind: 'compare',
      tabs: [
        {
          label: 'Swap a person',
          before: 'replace-swap-before.mp4',
          after: 'replace-swap-after.mp4',
          text: 'Tess talking to camera in a pottery studio, an IV Studio render. Replace painted Theo into two of its frames, and H3 carried him through the whole clip: the same handheld camera, the same gestures, the same room and the same soundtrack. Drag the line to compare.'
        },
        {
          label: 'Change the scene',
          before: 'replace-scene-before.mp4',
          after: 'replace-scene-after.mp4',
          text: 'A short animated shot of a farmer and his dog. Replace painted one frame as a snowy winter evening, and H3 carried it through the whole clip: the same camera move, the same walk, the same dog. Drag the line to compare.'
        }
      ]
    }
  },
  {
    page: 'sequences',
    name: 'Sequences',
    tag: 'Several shots, one continuous take',
    about: 'Write a scene as a list of 10 or 15 second shots and render them as one unbroken video, in one take or shot by shot, then retake any stretch and render it out.',
    needs: ['H3 on this PC'],
    example: {
      kind: 'video',
      video: 'sequences.mp4',
      sound: true,
      text: 'A scene written as a list of shots, Tess talking across the kitchen table, rendered as one unbroken take: no cuts and no jumps between the shots, with the voices and the room sound running straight through.'
    }
  },
  {
    page: 'sizzle',
    name: 'Sizzle',
    tag: 'A website, made into a film',
    about: 'Put in a web address. Your agent storyboards a promo film from the real site, then H3 shots, pictures, music and the site’s own screens are cut together with motion and typography.',
    needs: ['Claude or ChatGPT', 'Shinobi', 'H3, a picture model and a music model on this PC'],
    example: {
      kind: 'steps',
      inputs: [{ picture: 'sizzle-site.webp', label: 'The website' }],
      video: 'sizzle.mp4',
      sound: true,
      text: 'Put in infinitevariance.ai. The agent read the site and storyboarded a film, H3 rendered the shots, and the site’s own screens, music and type were cut together into this sizzle.'
    }
  },
  {
    page: 'effects',
    name: 'Effects',
    tag: 'A photo, made into a moment',
    about: 'Pick a photo and an effect: cakeify, explode, money rain, a 360° orbit and 20 more; a transformation that keeps the face; or a transition from one picture into another. Each becomes a short clip.',
    needs: ['Its models on this PC (Setup)'],
    example: {
      kind: 'steps',
      inputs: [
        { picture: 'effects-first.webp', label: 'First picture' },
        { picture: 'effects-last.webp', label: 'Last picture' }
      ],
      video: 'effects.mp4',
      text: 'A transition from one picture into another: Tess at a rainy bus stop bursts into light and comes back checking her watch. Two pictures in, one 5 second clip out.'
    }
  },
  {
    page: 'reel',
    name: 'Reel',
    tag: 'Pictures and a song, cut to the beat',
    about: 'Add pictures in order and pick a song. IV Studio finds its beat and cuts them on its bars, with a slow move on each picture, as an edit you can finish in Edit.',
    needs: ['Nothing extra: your pictures and a song'],
    example: {
      kind: 'steps',
      inputs: [1, 2, 3, 4, 5, 6].map((n) => ({ picture: `reel-${n}.webp` })),
      video: 'reel.mp4',
      sound: true,
      text: 'Six pictures of Tess and an upbeat song. IV Studio found the beat (120 BPM) and cut to a new picture on the bars, with a slow move on each, as an edit ready to finish in Edit.'
    }
  },
  {
    page: 'musicvideo',
    name: 'Music video',
    tag: 'A song, cut into scenes that sing along',
    about: 'Pick a song from Music or your own. IV Studio finds its beat, bars and parts and cuts it into scenes of up to 15 s. Your cast sings and plays along to each scene’s own stretch of the song, and the finished scenes land in Edit over the song.',
    needs: ['H3 on this PC', 'A song (make one on Audio → Music)'],
    example: {
      kind: 'video',
      video: 'musicvideo.mp4',
      sound: true,
      strip: [
        // the clip starts 1.1 s into the song; the cut between scene 1 and 2 falls on the bar at 7.12 s
        { label: 'Scene 1', start: 0, end: 6.0 },
        { label: 'Scene 2', start: 6.0, end: 12.0 }
      ],
      text: 'A song from Music, cut on its bars into scenes. Tess sings each scene’s own stretch of the song, so her mouth follows the words, and the finished scenes play back to back over the song itself.'
    }
  },
  {
    page: 'keyframes',
    name: 'Keyframes',
    tag: 'Pictures, brought to life in one moving video',
    about: 'Put pictures in order: a photoshoot, poses, product angles. IV Studio makes one smooth video that moves from each picture to the next, and loops back to the first if you like, in one take or as a chain of moves.',
    needs: ['H3 on this PC', 'Your pictures'],
    example: {
      kind: 'steps',
      inputs: [{ picture: 'keyframes-1.webp' }, { picture: 'keyframes-2.webp' }, { picture: 'keyframes-3.webp' }],
      video: 'keyframes.mp4',
      sound: true,
      text: 'Three pictures of Tess on a harbour wall at sunset, in order. IV Studio made one take that lands on each picture in turn, with the moves between them and one continuous sound.'
    }
  },
  {
    page: 'animalcam',
    name: 'Animal Cam',
    tag: 'Animal videos that look filmed on a phone',
    about: 'Seven steps from your pet to a clip that looks like a stranger filmed it: a reference sheet from a photo, an unseen filmer, one task for everyone in frame, timed beats, only real sounds and a checklist before H3 films it.',
    needs: ['H3 on this PC', 'A picture model to make the reference sheet (or your own sheet)'],
    example: {
      kind: 'steps',
      tall: true,
      inputs: [
        { picture: 'animalcam-photo.webp', label: 'The pet' },
        { picture: 'animalcam-sheet.webp', label: 'Reference sheet' }
      ],
      video: 'animalcam.mp4',
      sound: true,
      text: 'A made-up cat called Pepper. A reference sheet made from one photo keeps her look, and the seven steps (an unseen filmer, one task, timed beats, only real sounds) give a gym clip that looks like a stranger filmed it on a phone.'
    }
  },
  {
    page: 'shinobi',
    name: 'Shinobi',
    tag: 'Edits your agent cuts',
    about: 'Hand footage to an agent (or a one-click style) and get a finished edit: cuts on the beat, speed ramps, typography, effects and sound.',
    needs: ['Shinobi’s engine (one click, about 440 MB)', 'Claude or ChatGPT, or a one-click style'],
    example: {
      kind: 'steps',
      inputs: [{ picture: 'shinobi-1.webp' }, { picture: 'shinobi-2.webp' }, { picture: 'shinobi-3.webp' }],
      video: 'shinobi.mp4',
      sound: true,
      text: 'H3 shots and a website’s screens handed to Shinobi. It cut them on the beat with speed ramps, typography and sound into this edit (a later stretch of the Sizzle film).'
    }
  },
  {
    page: 'rebuild',
    name: 'Rebuild',
    tag: 'A video, taken apart and rebuilt',
    about: 'Bring a video you made. IV Studio reads it shot by shot, your agent plans how each shot is remade, you approve the plan and the frames, H3 renders the new shots and a first cut lands in Edit beside the original.',
    needs: ['Claude or ChatGPT', 'H3 on this PC'],
    example: {
      kind: 'compare',
      tabs: [
        {
          label: 'Rebuilt with Theo',
          before: 'rebuild-before.mp4',
          after: 'rebuild-after.mp4',
          text: 'Twelve seconds of Tess singing, cut from four shots. Rebuild read each shot, painted Theo into its first frame, and H3 made every shot again from there: the same framing, the same cuts at the same moments, a new singer. Drag the line to compare.'
        }
      ]
    }
  }
]

export const NEEDS = Object.fromEntries(WORKFLOWS.map((w) => [w.page, w.needs]))
