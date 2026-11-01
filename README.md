# 🫧 Fuzzle

A Chuzzle-inspired sliding match game that runs entirely as static files — no build step, no backend, no dependencies. Push it to GitHub Pages and play.

**Play it:** after pushing, enable Pages once: repo Settings → Pages → Source: **GitHub Actions**. The site will be at `https://<your-username>.github.io/fuzzle/`.

> Fan-made tribute. Inspired by the *mechanics* of Chuzzle (Raptisoft / PopCap): slide whole rows and columns that wrap around, match connected groups of 3+ fuzzy blobs, gravity refills from the top. Not affiliated with PopCap or EA. All art, sounds (WebAudio blips), and code in this repo are original — no PopCap assets are used.

## How to play

- **Drag** any fuzzy horizontally to slide its whole row, or vertically to slide its whole column. Rows and columns **wrap around** — pushed off the left, it reappears on the right; pushed off the top, it reappears at the bottom.
- Form a connected group of **3 or more** of the same colour. Lines, L-shapes, and 2×2 blocks all count.
- Popped fuzzies leave gaps; the ones above fall down and new ones drop in from the top. Cascades multiply your score.
- A move that makes no match **slides back**.
- Fill the level meter to level up (+1000 × level bonus). From level 2, 🔒 locked fuzzies appear: they freeze their row and column until you pop them, and popping one is worth +50.
- If no move exists, use a **Scramble** (you start with 3). No moves and no scrambles = game over.
- **Hint** shows a legal move. Tap a fuzzy to select it, then use the on-screen arrows or your keyboard arrow keys for precise one-step slides. Best score is saved in your browser only (`localStorage`).

## Run it locally

```sh
# any static server works; for example:
python3 -m http.server 8000
# then open http://localhost:8000/
```

There is nothing to install and nothing to build. `index.html` + `style.css` + `game.js` is the whole game.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page, HUD, board container, how-to |
| `style.css` | Board, fuzzy blobs (pure CSS), HUD |
| `game.js` | Board, wrap-sliding, cluster matching, gravity, cascades, levels, locks, scrambles, hints, sounds |
| `.github/workflows/pages.yml` | Deploys the repo root to GitHub Pages on push to `main` |

## Roadmap (honest v1 limits)

- [x] 6×6 wrap-sliding board, connected-group matches, gravity, cascades
- [x] Score, level meter + bonus, best score, locks, scrambles, hints, sounds, touch + keyboard
- [ ] Fat fuzzies (2×2) and Super fuzzies (5+ match explodes 3×3) from the original — not in v1
- [ ] Mind Bender puzzle mode (match a target pattern) — not in v1
- [ ] Speed / Zen modes — not in v1

## License

MIT — see `LICENSE`.
