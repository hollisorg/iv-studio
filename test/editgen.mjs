// Pure parts of the editor's new-footage work (src/service/editgen.js): the aspect a clip maps to, and where a
// generation lands when the timeline has moved.   node test/editgen.mjs
import assert from 'node:assert/strict'
import { insert } from '../src/service/timeline.js'
import { nearestAspect, where } from '../src/service/editgen.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('a 1952x1088 render is 16:9', () => assert.equal(nearestAspect(1952, 1088), '16:9'))
ok('a vertical phone clip is 9:16', () => assert.equal(nearestAspect(1080, 1920), '9:16'))
ok('a square picture is 1:1', () => assert.equal(nearestAspect(1024, 1024), '1:1'))
ok('no size falls back to 16:9', () => assert.equal(nearestAspect(0, 0), '16:9'))

const clip = (id, start, len, track = 'V1') => ({ id, track, media: 'm', start, in: 0, out: len })
const e = { clips: [clip('a', 0, 5), clip('b', 5, 6), clip('c', 14, 3)] }
const extendA = { anchor: 'a', pos: 'end', rel: 0, track: 'V1', at: 5 }
const fillGap = { anchor: 'b', pos: 'end', rel: 0, track: 'V1', at: 11 }
const retakeB = { anchor: 'b', pos: 'start', rel: 2.5, track: 'V1', at: 7.5 }
ok('extend lands at its clip end', () => assert.deepEqual(where(e, extendA), { track: 'V1', at: 5 }))
ok('retake lands inside its clip', () => assert.deepEqual(where(e, retakeB), { track: 'V1', at: 7.5 }))

// an extension of a lands first: 5 s inserted at 5 pushes b and c along
const after = { clips: insert(e.clips, clip('x', 5, 5)) }
ok('the gap fill follows clip b after an insert', () => assert.deepEqual(where(after, fillGap), { track: 'V1', at: 16 }))
ok('the retake follows clip b after an insert', () => assert.deepEqual(where(after, retakeB), { track: 'V1', at: 12.5 }))
ok('a clip moved to V2 takes its gen with it', () => assert.deepEqual(where({ clips: [{ ...clip('a', 3, 5), track: 'V2' }] }, extendA), { track: 'V2', at: 8 }))
ok('without its clip a gen keeps its start time', () => assert.deepEqual(where({ clips: [] }, fillGap), { track: 'V1', at: 11 }))
console.log(`${n} checks passed`)
