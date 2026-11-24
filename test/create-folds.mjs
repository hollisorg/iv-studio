// Create's folding steps and jump bar (Matthew, 2026-11-23: scroll fatigue on Create).
//   node test/create-folds.mjs
import assert from "node:assert/strict";
import fs from "node:fs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const create = src("../src/renderer/src/components/Create.jsx");
const kit = src("../src/renderer/src/components/CreateKit.jsx");
const css = src("../src/renderer/src/studio.css");
let n = 0;
const ok = (name, fn) => (fn(), n++, console.log("ok", name));

ok("every step on Create can fold, with its own id and summary", () => {
  assert.ok(
    !/<section className="create-step">/.test(create),
    "no step left without a fold",
  );
  for (const id of ["kind", "who", "media", "what", "shape"]) {
    assert.ok(
      create.includes(`<section {...stepBox('${id}')}>`),
      `${id} has its box`,
    );
    assert.ok(create.includes(`fold={foldOf('${id}')}`), `${id} has its fold`);
    assert.ok(create.includes(`id: '${id}'`), `${id} has a summary`);
  }
});

ok(
  "the jump bar sits above the steps, opens a step and goes to it, and folds or opens them all",
  () => {
    assert.match(create, /<StepJump steps=\{stepList\} onJump=\{jumpTo\}/);
    assert.match(
      create,
      /const jumpTo = \(id\) => \(folds\.open\(id\), showStep\(id\)\)/,
    );
    assert.match(kit, /\{allFolded \? 'Open all' : 'Fold all'\}/);
    assert.match(
      kit,
      /behavior: reducedMotion\(\) \? 'auto' : 'smooth'/,
      "no smooth scroll when motion is reduced",
    );
  },
);

ok(
  "folds are remembered on this PC, and the quick idea opens What happens before going to the writer",
  () => {
    assert.match(kit, /export function useFolds\(key = 'iv\.create\.folded'\)/);
    assert.match(
      kit,
      /localStorage\.setItem\(key, JSON\.stringify\(\[\.\.\.next\]\)\)/,
    );
    assert.match(
      create,
      /folds\.open\('what'\), showBelow\('\.create \.writer'\)/,
    );
  },
);

ok(
  "a folded step shows only its head; the bar stays at the top and clear of Your shot",
  () => {
    assert.match(
      css,
      /\.create-step\.folded > :not\(\.step-head\) \{\s*display: none;/,
    );
    assert.match(css, /\.step-jump \{\s*position: sticky;/);
    assert.match(
      css,
      /\.create-v2 \.shot-card \{\s*top: calc\(84px - clamp\(28px, 4vw, 52px\)\);/,
    );
    assert.match(
      css,
      /\.step-jump-chip \{[^}]*min-height: 44px;/,
      "44 px targets",
    );
    assert.ok(!/—/.test(kit), "no em dashes");
  },
);

// since the seed choice (Matthew, 2026-11-24: "pick if they want randomized or fixed seed") the seed is out in Shape and size
ok('Advanced holds preview size, takes and quality with steps and sampler, says what they are, and stays as left; the seed choice is out in Shape and size', () => {
  const adv = create.slice(create.indexOf('<div className="more-settings-body">'), create.indexOf('<div className="adv-grid">'))
  for (const label of ["{oneFinal ? 'First pass size' : 'Preview size'}", 'Previews</span>', 'Quality</span>']) assert.ok(adv.includes(label), `${label} is under Advanced`)
  const shape = create.slice(create.indexOf("<section {...stepBox('shape')}>"), create.indexOf('<div className="more-settings-body">'))
  assert.ok(!shape.includes("'First pass size' : 'Preview size'"), 'and not out in Shape and size')
  assert.ok(shape.includes('<SeedPick seed={form.seed}') && !adv.includes('SeedPick') && !adv.includes('Seed</span>'), 'the seed choice is in Shape and size, not under Advanced')
  assert.ok(create.includes("{advanced ? '−' : '+'} Advanced") && create.includes('<span className="dim">{advancedLine}</span>'), 'the Advanced line says what they are set to')
  assert.ok(create.includes('`seed ${form.seed}`') && !/advancedLine = \[[^\]]*seed/.test(create), 'the shot card names the seed; the Advanced line no longer does')
  assert.ok(create.includes("localStorage.setItem('iv.create.advanced', v ? '1' : '0')"), 'open or shut is remembered')
})

console.log(`\n${n} of 5 passed`);
