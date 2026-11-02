# Staff review — Fuzzle (v1 → v1.1 review fixes)

Reviewer stance: staff engineer / open-source maintainer. Scope is the code as
shipped in v1 (commit `e99a6c0`, 421 lines of `game.js`, 64 of `style.css`,
74 of `index.html`, no tests, CI = `node --check` only). Verdict first:
**the core game is correct and the static/Pages design is right; the risk is
not the rules, it is maintainability, testability, and accessibility.**
Nothing below required a redesign. The P0/P1 items are already fixed in this
tree; P2 items are deferred with reasons, not ignored.

## Verdict

| Area | v1 | After this review |
| --- | --- | --- |
| Rules (wrap slide, cluster match, gravity, cascades) | Correct, untested | Same rules, now covered by 8 Node tests |
| Code organisation | One 421-line IIFE, logic + DOM + audio interleaved | Same single file by design, but pure logic separated + exported for tests, CONFIG extracted, JSDoc throughout |
| Performance | Full re-render on every pointermove | Drag updates only the dragged line |
| Accessibility | Colour-only, no tile labels, no reduced-motion | Tile `aria-label`s, focus-visible, reduced-motion; colourblind patterns still open (P2) |
| README | Accurate but missing the sections a new contributor needs | Rewritten: Description, Prerequisites, Installation, Local Development, Deployment, Architecture, Testing |
| Visuals | None, and none faked | Mermaid game-loop diagram ships now; screenshots/GIF are specified, not fabricated (see § Visual asset strategy) |

## P0 — fixed in this tree

### R1. Untestable monolith, CI that could not catch a logic bug
**Finding.** `game.js` mixed board logic, DOM rendering, audio, and scoring
in one IIFE with no exports. CI ran only `node --check`, which passes on
code that matches the wrong thing. A matcher regression (e.g. diagonals
counting) would have shipped to Pages undetected.

**Fix.** Pure functions (`mod`, `rotateArray`, `findGroupsFromColors`,
`rotateColors`) are defined before any DOM access, exported when loaded in
Node, and guarded so Node returns before the UI runs:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, mod, rotateArray, findGroupsFromColors, rotateColors };
}
if (typeof document === 'undefined') return;
```

`tests/logic.test.js` (7 tests) now covers wrap, rotation non-mutation,
line / L-shape / 2×2 matches, diagonal non-matches, and pairs.
`tests/board-smoke.test.js` loads the real file against a DOM stub and
asserts 36 valid tiles. CI runs both. This is the minimum testable seam;
it is not a claim of full coverage — gravity, cascades, and drag are still
only smoke-tested (see P2).

### R2. Full re-render on every pointermove
**Finding.** v1's `pointermove` called `render()` per event: 36 elements
re-styled, a `getBoundingClientRect()` layout read, and the `.dragging`
class it had just set stripped by `render()`'s `className` assignment.
It worked only because the drag code re-added the class after each render.

**Fix.** `positionDraggedLine(px)` updates only the dragged line's
transforms. `render()` is now reserved for committed state changes.
Measured effect: per-move DOM writes drop from 36 to 6; the class fight is
gone by construction, not by ordering luck.

### R3. Duplicated rotation, lock checks, and rejection feedback
**Finding.** `rotateColors` and `rotateLine` each re-implemented rotation;
`findMove` re-scanned for locks instead of using `lineHasLock`; the
shake + message + invalid-blip sequence appeared in three places.

**Fix.** `rotateArray()` is the single rotation implementation, used by
both matrix and live-board rotation. `lineTiles()` feeds `lineHasLock()`,
`findMove()`, and drag rendering. `rejectMove(text)` is the single
rejection path. If a slide ever means something different in search than
on the board, that is now one function to fix, not two to keep in sync.

### R4. Magic numbers and two sources of truth for colour
**Finding.** `40`, `15`, `1000`, `10`, `20`, `50`, `0.25`, `240`, `200`,
`400`, `320`, `1800`, `200`, `100` were scattered through the code, and
`COLORS` in JS vs `.c-*` classes in CSS were the same list in two
languages with no comment linking them. Changing board size or scoring
meant hunting literals.

**Fix.** All tunables live in `CONFIG` at the top of `game.js`, each with
a comment on what it controls. `style.css` now carries the matching
comment on the colour classes. BOARD_SIZE is still not a one-line change
(CSS sizing + the "6 by 6" label also encode 6) — that is a P1, not a
pretence otherwise.

### R5. Silent failures: scramble, fresh board, missing elements
**Finding.** (a) v1 decremented scrambles *before* shuffling, then reported
"Scrambled!" even if 200 shuffles produced no valid board. (b) `newBoard`
could exhaust 200 attempts and start with groups or no move, silently.
(c) A missing `#id` in the HTML threw later, from an unrelated
`.textContent` line.

**Fix.** (a) Scramble now only decrements on success; failure reports
"Scramble failed — try again (not consumed)." (b) `newBoard` logs
`console.warn` on exhaustion — still a tail risk, but no longer silent;
a deterministic fallback board is P2, because a Latin-square fallback
provably has *no* moves (see below) and a hand-built fallback would need
its own proof. (c) `el(id)` throws `Fuzzle: missing required element #id`
at startup.

### R6. Selection by coordinates went stale after every cascade
**Finding.** v1 stored `selected = {r, c}`. After a slide or gravity, the
tile at those coordinates was a different tile, so the D-pad and arrow keys
silently moved the wrong line. Scramble cleared it; slides did not.

**Fix.** Selection is now `selectedId`, resolved by `selectedPos()` on
every use. A popped or scrambled tile drops the selection instead of
re-pointing it. This is the only user-visible bug fix in the review, and
it is the kind of bug a review exists to catch: invisible in a demo,
confusing in play.

## P1 — fixed or explicitly bounded

- **JSDoc / why-comments.** Every non-trivial function now documents its
  contract *and* its why: `mod` (wrap needs true modulo), `findGroups…`
  (cluster, not line — the Chuzzle rule), `rotateColors` (pure so search
  cannot mutate the board), `applyGravity` (bottom-first via `pop()`,
  avoiding `shift()`'s O(n²)), `scoreForGroup` (cascade multiplies the
  whole group, by design), `newBoard` (rejection sampling = fair start).
  Comments that merely restated the code were removed or rewritten.
- **Hint race.** v1's 1.8 s hint timeout called `render()` unconditionally
  and could wipe a drag started in the meantime. It now clears the previous
  timeout and skips the render while dragging or resolving.
- **Cached DOM refs.** `render()` called `getElementById('btnScramble')`
  on every render. All HUD/button refs are now cached once, behind `el()`.
- **Accessibility, first pass.** Tiles get `aria-label`s ("red fuzzy",
  "blue locked fuzzy"), buttons get `:focus-visible`, and
  `prefers-reduced-motion` disables wobble/shake/transitions. This is not
  full accessibility: colour is still the only *visual* distinction, and
  the board itself is not keyboard-navigable without a prior tap (P2).
- **README vs code.** v1's README was accurate about rules but lacked
  Prerequisites, Installation, Local Development, and Deployment, said
  nothing about tests (there were none), and did not state the Pages
  subpath constraint (all links are relative, so the game works under
  `/fuzzle/` — verified by design, not by a deployed check). Rewritten;
  see the new README. The old "Files" table is now "Architecture".

## P2 — deferred, with reasons (do not "fix" by accident)

1. **Split into ES modules (`js/board.js`, `js/audio.js`, `js/ui.js`).**
   Deferred, not rejected. At ~600 lines with one game mode, modules add
   a build-or-server requirement (`file://` + ES modules = CORS failure)
   for no user benefit. Trigger: Fat/Super fuzzies or a second mode, at
   which point the pure functions move unchanged and the UI file splits.
2. **Colourblind patterns / shapes per colour.** The honest fix is a
   per-colour pattern (dots, stripes, icon) in the blob, not just labels.
   Deferred because it changes the visual design and needs a real visual
   check against the rendered board, not a code-only change.
3. **Full keyboard board navigation + ARIA grid roles.** The D-pad is a
   usable workaround; a proper roving-tabindex grid is a larger, testable
   change and should land with a keyboard-only playthrough, not alone.
4. **Deterministic fresh-board / scramble fallback.** As noted above, the
   obvious fallback (a Latin square) has no legal moves, so any fallback
   must be constructed *and* proven to have a move and no groups. Until
   that proof exists as a test, rejection sampling + a warning is safer
   than a clever-looking board that starts dead.
5. **State machine instead of `busy`.** `busy` currently gates input during
   resolution, but the states (idle / dragging / resolving / game-over)
   are implicit. Worth doing when a second mode or animation queue lands;
   premature for a single-mode game where every guard is one `if (busy)`.
6. **Fat (2×2) and Super (5+ explodes 3×3) fuzzies, Mind Bender, Speed/Zen.**
   Still roadmap, not v1.1. They change the board model (multi-cell tiles,
   exploding tiles, pattern targets) and must not be bolted onto the
   current `board[r][c] = tile` model without a design note first.

## What was verified, and what was not

- `node --check game.js` — pass.
- `node --test tests/logic.test.js tests/board-smoke.test.js` — **8/8 pass**
  (7 logic + 1 smoke). Note the exact command: `node --test tests/` on
  this Node (v24.22.1) mis-resolves the directory as a module; CI and the
  README use the explicit file list for that reason.
- Local static server returned 200 for `index.html`, `style.css`,
  `game.js` (same check as v1, re-run after the refactor).
- **Not verified here:** a full browser playthrough (drag, cascade,
  level-up, lock, scramble, game-over) and the deployed Pages URL. The
  review box has no browser playthrough harness for this game, and the
  screenshots/GIF below are therefore specified, not shipped. Claiming
  otherwise would be exactly the kind of faked evidence this repo must
  not carry.

## Performance notes (measured reasoning, not benchmarks)

- Board is 6×6: BFS, rotation, and move search are all trivially cheap
  (60 rotations × BFS). No memoisation is warranted, and adding it would
  be premature optimisation.
- The only real perf cost was per-pointermove rendering (R2, fixed).
  `getBoundingClientRect()` is now read once per move event, not once per
  tile, and `render()` is not called in the drag loop at all.
- `applyGravity` changed from `shift()` to `pop()` on a reversed stack.
  At n=6 this is unmeasurable; it is documented as a correctness-of-habit
  change, not a claimed speedup.

## Visual asset strategy

Rule for this repo, carried over from every other portfolio repo: **capture
from the real game, never fabricate.** No screenshot or GIF in this tree
was generated, drawn by hand to look like a screenshot, or taken from the
original Chuzzle. The assets below are a shot list for the maintainer to
capture after pushing, with exact files, exact content, and exact README
placement. Until they exist, the README carries a commented placeholder
(visible in source, invisible on the page) — never a broken image link.

| # | File (in repo) | Exactly what it must depict | README placement (max impact) |
| --- | --- | --- | --- |
| 1 | `docs/assets/screenshots/board-midgame.png` | **Hero.** Full page at desktop width (~1280 px), mid-game: score > 0, level 2+, one 🔒 tile visible, level meter partly filled. This is the first thing a visitor must see — it answers "what is this game?" without reading a word. | Directly under the H1, before Description. Uncomment the placeholder already in the README. Crop to the game area + HUD, not the whole browser chrome. |
| 2 | `docs/assets/screenshots/wrap-drag.png` | **The differentiator.** A row mid-drag, with one fuzzy visibly wrapping: half off the left edge, half reappearing on the right. Annotate in the capture (or caption) only — do not edit the game to stage it; drag a real row halfway. | In "How to play", beside the wrap-around bullet. This is the mechanic no Bejeweled clone has, so it earns its own image. |
| 3 | `docs/assets/screenshots/cascade-pop.png` | **The payoff.** Tiles in the `.popping` state (shrinking, fading) with a cascade message visible ("Pop! +… (cascade x2)"). Capture during a real cascade, not by staging colours. | In "How to play", beside the cascade bullet, or in "Scoring" if the cascade shot is clearer there. One image, not both places. |
| 4 | `docs/assets/screenshots/mobile.png` | **The proof it works on phones.** Same board at ~390 px width, side controls stacked below the board, a finger-drag-sized board. No desktop screenshot cropped to look mobile. | In "Local Development" or a short "Mobile" note under "How to play". Proves the touch path, which is half the game. |
| 5 | `docs/assets/screenshots/demo.gif` | **The loop, only after 1–4 exist.** 12–18 s, no audio: drag a row → match → pop → cascade → level meter moves. Loop cleanly. Record from the deployed Pages site or a local server, never from a mock. | Same hero position as #1, *replacing* (not alongside) the hero still once it exists. A GIF next to a still of the same board is noise. |
| — | (diagram, ships now) | **Game-loop Mermaid diagram** in the README's Architecture section. It is code, not a screenshot, so it ships without a capture step. It shows: drag/D-pad → `attemptSlide` → `findGroups` → `resolveBoard` cascade loop → gravity → level / no-move check. | Architecture section, in the README now. |

Capture checklist (so the shots are usable, not just present):
- Capture at the deployed Pages URL if possible, otherwise `python3 -m http.server` locally — never a mock or an edited image.
- PNG, not JPG, for the board (flat colours + text blur in JPG).
- No personal data in frame (best score is local-only, but check the HUD).
- Filenames exactly as above; the README placeholders already reference them, so dropping the files in is the only step — no README edit needed at capture time.
- If a shot cannot be captured faithfully (e.g. the wrap moment is hard to
  freeze), drop that row from the table rather than staging it. A missing
  screenshot is honest; a staged one is not.

## Suggested next steps, in order

1. Push v1.1 (this tree) and run the Pages deploy; confirm the live URL.
2. Capture assets #1–#4 from the live site, in that order; add #5 only after.
3. Then, and only then, take on P2 #2 (colourblind patterns) with a visual
   check, followed by P2 #1 (module split) when Fat/Super design starts.
