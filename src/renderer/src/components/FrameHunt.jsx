import { useEffect, useRef, useState } from 'react'
import { frameHuntBest, keepFrameHuntBest } from '../renders'

// Frame Hunt: IV Studio's own little maze game for the render pop-up. You're the IV eye; pick up every film frame
// while the static glitches hunt you. Arrow keys or WASD; three lives; each cleared maze makes the glitches quicker.
// It draws on one small canvas, at most 30 times a second, and only while it's on screen and the window is in front:
// it stops the moment the pop-up closes, so it costs nothing next to a render.

// # wall, . frame, P where you start, G where the glitches start, space nothing
const MAZE = [
  '#####################',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#.#.................#',
  '#.#.##.###.###.##.#.#',
  '#......#  G  #......#',
  '###.##.# G G #.##.###',
  '#......#######......#',
  '#.##.#.........#.##.#',
  '#....#.###.###.#....#',
  '#.##.#....P....#.##.#',
  '#....###.###.###....#',
  '#####################'
]
const ROWS = MAZE.length
const COLS = MAZE[0].length
const CELL = 22
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' }
const FPS = 30
// the accent colour and the page's ink, read from the app's own CSS variables
const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

export function newLevel(level = 1) {
  const frames = new Set()
  const glitches = []
  let player = { x: 1, y: 1 }
  MAZE.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') frames.add(`${x},${y}`)
      if (c === 'P') player = { x, y }
      if (c === 'G') glitches.push({ x, y, home: { x, y }, dir: 'up' })
    })
  )
  return { level, frames, glitches, player: { ...player, home: { ...player }, dir: null, want: null }, tick: 0 }
}
export const isWall = (x, y) => (MAZE[y]?.[x] ?? '#') === '#'

// One step of the world: the eye moves every tick it can, the glitches every few ticks (quicker each level), each
// choosing the open way that brings it closest to the eye, now and then a random one so they don't move as one.
export function step(state, rand = Math.random) {
  const s = state
  s.tick++
  const p = s.player
  if (p.want && !isWall(p.x + DIRS[p.want][0], p.y + DIRS[p.want][1])) p.dir = p.want
  if (p.dir && !isWall(p.x + DIRS[p.dir][0], p.y + DIRS[p.dir][1]) && s.tick % 4 === 0) {
    p.x += DIRS[p.dir][0]
    p.y += DIRS[p.dir][1]
  }
  s.frames.delete(`${p.x},${p.y}`)
  const every = Math.max(4, 8 - s.level)
  if (s.tick % every === 0) {
    for (const g of s.glitches) {
      const back = { up: 'down', down: 'up', left: 'right', right: 'left' }[g.dir]
      const open = Object.keys(DIRS).filter((d) => d !== back && !isWall(g.x + DIRS[d][0], g.y + DIRS[d][1]))
      const ways = open.length ? open : [back]
      const dist = (d) => Math.abs(g.x + DIRS[d][0] - p.x) + Math.abs(g.y + DIRS[d][1] - p.y)
      g.dir = rand() < 0.25 ? ways[Math.floor(rand() * ways.length)] : ways.reduce((a, b) => (dist(b) < dist(a) ? b : a))
      g.x += DIRS[g.dir][0]
      g.y += DIRS[g.dir][1]
    }
  }
  const caught = s.glitches.some((g) => g.x === p.x && g.y === p.y)
  return caught ? 'caught' : s.frames.size === 0 ? 'cleared' : null
}

export default function FrameHunt() {
  const canvas = useRef(null)
  const game = useRef(null)
  const [hud, setHud] = useState({ score: 0, lives: 3, level: 1, over: false, paused: false })
  const hudRef = useRef(hud)
  hudRef.current = hud
  // your best, kept on this PC (renders.js); a new one is saved as soon as you beat it
  const [best, setBest] = useState(frameHuntBest)
  const [beat, setBeat] = useState(false)
  useEffect(() => {
    if (hud.score > 0 && keepFrameHuntBest(hud.score, hud.level)) (setBest(frameHuntBest()), setBeat(true))
  }, [hud.score, hud.level])

  useEffect(() => {
    game.current = newLevel(1)
    const c = canvas.current
    const ctx = c.getContext('2d')
    const accent = cssVar('--red', '#ff4d6d')
    const paper = cssVar('--paper', '#f1ede5')
    const line = cssVar('--line-strong', '#3a3235')
    let raf = 0
    let last = 0
    let flash = 0
    const draw = () => {
      const s = game.current
      ctx.fillStyle = '#100c0e'
      ctx.fillRect(0, 0, c.width, c.height)
      // walls: solid blocks that join up, with a lit edge where a wall meets the open maze
      ctx.fillStyle = '#241b22'
      MAZE.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && ctx.fillRect(x * CELL, y * CELL, CELL, CELL)))
      ctx.fillStyle = line
      MAZE.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch !== '#') return
          if (!isWall(x, y - 1)) ctx.fillRect(x * CELL, y * CELL, CELL, 2)
          if (!isWall(x, y + 1)) ctx.fillRect(x * CELL, (y + 1) * CELL - 2, CELL, 2)
          if (!isWall(x - 1, y)) ctx.fillRect(x * CELL, y * CELL, 2, CELL)
          if (!isWall(x + 1, y)) ctx.fillRect((x + 1) * CELL - 2, y * CELL, 2, CELL)
        })
      )
      // film frames: a tiny frame with its sprocket holes
      ctx.fillStyle = paper
      for (const k of s.frames) {
        const [x, y] = k.split(',').map(Number)
        const cx = x * CELL + CELL / 2
        const cy = y * CELL + CELL / 2
        ctx.globalAlpha = 0.85
        ctx.fillRect(cx - 3, cy - 2.5, 6, 5)
        ctx.globalAlpha = 1
        ctx.fillStyle = '#100c0e'
        ctx.fillRect(cx - 2, cy - 1.5, 4, 3)
        ctx.fillStyle = paper
      }
      // glitches: squares of flickering static
      for (const g of s.glitches) {
        for (let i = 0; i < 9; i++) {
          ctx.fillStyle = (s.tick + i * 7 + g.x) % 3 === 0 ? accent : (s.tick + i) % 2 ? '#3ad6e6' : paper
          ctx.fillRect(g.x * CELL + 4 + (i % 3) * 5, g.y * CELL + 4 + Math.floor(i / 3) * 5, 4, 4)
        }
      }
      // the IV eye
      const p = s.player
      const px = p.x * CELL + CELL / 2
      const py = p.y * CELL + CELL / 2
      ctx.fillStyle = flash > 0 && flash % 2 ? paper : accent
      ctx.beginPath()
      ctx.ellipse(px, py, 8, 6, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#100c0e'
      const [dx, dy] = p.dir ? DIRS[p.dir] : [0, 0]
      ctx.beginPath()
      ctx.arc(px + dx * 2.5, py + dy * 2, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    const loop = (t) => {
      raf = requestAnimationFrame(loop)
      const h = hudRef.current
      if (h.over || h.paused || document.hidden || !document.hasFocus()) return
      if (t - last < 1000 / FPS) return
      last = t
      const before = game.current.frames.size
      const r = step(game.current)
      const got = before - game.current.frames.size
      if (flash > 0) flash--
      if (r === 'caught') {
        const lives = h.lives - 1
        const s = game.current
        s.player = { ...s.player.home, home: s.player.home, dir: null, want: null }
        s.glitches.forEach((g) => Object.assign(g, g.home))
        flash = 12
        setHud((x) => ({ ...x, lives, over: lives <= 0, score: x.score + got * 10 }))
      } else if (r === 'cleared') {
        const level = h.level + 1
        game.current = newLevel(level)
        setHud((x) => ({ ...x, level, score: x.score + got * 10 + 250 }))
      } else if (got) setHud((x) => ({ ...x, score: x.score + got * 10 }))
      draw()
    }
    draw()
    raf = requestAnimationFrame(loop)
    const key = (e) => {
      const d = KEYS[e.key]
      if (!d) return
      e.preventDefault()
      game.current.player.want = d
    }
    window.addEventListener('keydown', key)
    return () => (cancelAnimationFrame(raf), window.removeEventListener('keydown', key))
  }, [])

  const again = () => {
    game.current = newLevel(1)
    setBeat(false)
    setHud({ score: 0, lives: 3, level: 1, over: false, paused: false })
  }
  return (
    <div className="frame-hunt">
      <div className="frame-hunt-hud mono small">
        <span>Frame Hunt</span>
        <span className="dim">Level {hud.level}</span>
        <span>{hud.score}</span>
        <span className={beat ? 'frame-hunt-best new' : 'frame-hunt-best dim'}>{beat ? 'New best!' : `Best ${best.score}`}</span>
        <span aria-label={`${hud.lives} lives`}>{'●'.repeat(Math.max(0, hud.lives))}</span>
        <button className="link-btn mono small" onClick={() => setHud((x) => ({ ...x, paused: !x.paused }))}>
          {hud.paused ? 'Play' : 'Pause'}
        </button>
      </div>
      <div className="frame-hunt-board">
        <canvas ref={canvas} width={COLS * CELL} height={ROWS * CELL} aria-label="Frame Hunt: arrow keys or WASD to move" />
        {hud.over && (
          <div className="frame-hunt-over">
            <span className="mono">Caught · {hud.score}</span>
            <span className="mono small dim">{beat ? 'A new best' : `Best ${best.score} · level ${best.level}`}</span>
            <button className="btn btn-small" onClick={again}>
              Play again
            </button>
          </div>
        )}
      </div>
      <span className="small dim">Arrow keys or WASD. Pick up every frame; the glitches hunt you.</span>
    </div>
  )
}
