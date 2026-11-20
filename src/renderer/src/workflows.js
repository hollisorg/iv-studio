// The Workflows tools: one card each on the Workflows page, in this order, each its own page. needs: what a tool
// requires beyond IV Studio itself, shown on its card and on its page (FlowKit's WorkflowNeeds), so nobody starts
// one without it. New tools are added here.
export const WORKFLOWS = [
  {
    page: 'replace',
    name: 'Replace',
    tag: 'Swap who is in the shot, or change the scene',
    about: 'Like Higgsfield’s Genjutsu, on your own PC: put your characters in place of people in a video, or change the scene in plain words: snow, night, a new setting, something removed. IV Studio paints the frames, you check them, and the camera, motion and soundtrack stay.',
    needs: ['H3 on this PC', 'Its node packs and models (the page lists them)']
  },
  {
    page: 'sequences',
    name: 'Sequences',
    tag: 'Several shots, one continuous take',
    about: 'Write a scene as a list of 10 or 15 second shots and render them as one unbroken video, in one take or shot by shot, then retake any stretch and render it out.',
    needs: ['H3 on this PC']
  },
  {
    page: 'sizzle',
    name: 'Sizzle',
    tag: 'A website, made into a film',
    about: 'Put in a web address. Your agent storyboards a promo film from the real site, then H3 shots, pictures, music and the site’s own screens are cut together with motion and typography.',
    needs: ['Claude or ChatGPT', 'Shinobi', 'H3, a picture model and a music model on this PC']
  },
  {
    page: 'effects',
    name: 'Effects',
    tag: 'A photo, made into a moment',
    about: 'Pick a photo and an effect: cakeify, explode, money rain, a 360° orbit and 20 more; a transformation that keeps the face; or a transition from one picture into another. Each becomes a short clip.',
    needs: ['Its models on this PC (Setup)']
  },
  {
    page: 'reel',
    name: 'Reel',
    tag: 'Pictures and a song, cut to the beat',
    about: 'Add pictures in order and pick a song. IV Studio finds its beat and cuts them on its bars, with a slow move on each picture, as an edit you can finish in Edit.',
    needs: ['Nothing extra: your pictures and a song']
  },
  {
    page: 'musicvideo',
    name: 'Music video',
    tag: 'A song, cut into scenes that sing along',
    about: 'Pick a song from Music or your own. IV Studio finds its beat, bars and parts and cuts it into scenes of up to 15 s. Your cast sings and plays along to each scene’s own stretch of the song, and the finished scenes land in Edit over the song.',
    needs: ['H3 on this PC', 'A song (make one on Audio → Music)']
  },
  {
    page: 'keyframes',
    name: 'Keyframes',
    tag: 'Pictures, brought to life in one moving video',
    about: 'Put pictures in order: a photoshoot, poses, product angles. IV Studio makes one smooth video that moves from each picture to the next, and loops back to the first if you like, in one take or as a chain of moves.',
    needs: ['H3 on this PC', 'Your pictures']
  },
  {
    page: 'animalcam',
    name: 'Animal Cam',
    tag: 'Animal videos that look filmed on a phone',
    about: 'Seven steps from your pet to a clip that looks like a stranger filmed it: a reference sheet from a photo, an unseen filmer, one task for everyone in frame, timed beats, only real sounds and a checklist before H3 films it.',
    needs: ['H3 on this PC', 'A picture model to make the reference sheet (or your own sheet)']
  },
  {
    page: 'shinobi',
    name: 'Shinobi',
    tag: 'Edits your agent cuts',
    about: 'Hand footage to an agent (or a one-click style) and get a finished edit: cuts on the beat, speed ramps, typography, effects and sound.',
    needs: ['Shinobi’s engine (one click, about 440 MB)', 'Claude or ChatGPT, or a one-click style']
  },
  {
    page: 'rebuild',
    name: 'Rebuild',
    tag: 'A video, taken apart and rebuilt',
    about: 'Bring a video you made. IV Studio reads it shot by shot, your agent plans how each shot is remade, you approve the plan and the frames, H3 renders the new shots and a first cut lands in Edit beside the original.',
    needs: ['Claude or ChatGPT', 'H3 on this PC']
  }
]

export const NEEDS = Object.fromEntries(WORKFLOWS.map((w) => [w.page, w.needs]))
