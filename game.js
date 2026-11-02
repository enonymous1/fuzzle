/**
 * Fuzzle — original, Chuzzle-inspired sliding match game. No assets, no backend.
 *
 * Why this file is still one file (deliberate, see docs/REVIEW.md):
 * GitHub Pages serves it as-is and `file://` + a static server both work with
 * plain `<script>` tags. ES modules would break `file://` (CORS) for no gain
 * at 400 lines. The split point is documented in docs/REVIEW.md: when Fat/Super
 * fuzzies or a second mode land, split this into `js/board.js` (pure logic),
 * `js/audio.js`, and `js/ui.js` — the pure functions below are already written
 * to move unchanged.
 *
 * Structure:
 *  1. CONFIG — every tunable in one place. Nothing else hardcodes a number.
 *  2. Pure logic — no DOM, no randomness, no state. Testable from Node
 *     (`node --test tests/`); in Node the file exports these and returns
 *     before touching the DOM. See the guard after `rotateColors`.
 *  3. UI / game state — board, rendering, input, sound, scoring. This is the
 *     only part that knows about the DOM.
 *
 * Core rules (the Chuzzle mechanics this replicates, with original art/code):
 *  - A move slides a whole row or column, and it *wraps*: a tile pushed off
 *    one edge reappears on the opposite edge. Hence all rotation is modulo
 *    the board size, never a clamp or a swap.
 *  - A match is a *connected group* of >= MIN_GROUP same-colour tiles
 *    (orthogonal flood fill), not just a straight line. L-shapes and 2x2
 *    blocks count — this is the rule that separates Chuzzle from Bejeweled,
 *    and it is why matching uses BFS, not row/column scans.
 *  - After a pop, gravity is downward only and new tiles enter from the top.
 *    Cascades re-run the same matcher, with the cascade number multiplying
 *    the whole group score.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- CONFIG
  /**
   * Single source of truth for tuning. Keep the CSS colour classes in
   * `style.css` (.c-red, .c-orange, ...) in sync with COLORS — they are the
   * same list in two languages, and drift here is a silent visual bug.
   * Changing BOARD_SIZE also requires updating the board's CSS sizing and
   * the "6 by 6" label in index.html; it is not yet a one-line change
   * (see docs/REVIEW.md, P1).
   */
  var CONFIG = {
    BOARD_SIZE: 6,
    COLORS: ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
    MIN_GROUP: 3,
    SCORE_PER_TILE: 10,
    BONUS_PER_EXTRA_TILE: 20, // per tile beyond 3 in a group (so 4 = +20, 5 = +40)
    LOCKED_BONUS: 50,
    LEVEL_BASE_TARGET: 40, // pops needed to finish level 1
    LEVEL_TARGET_STEP: 15, // extra pops per subsequent level
    LEVEL_BONUS_PER_LEVEL: 1000, // level-up bonus is 1000 * new level
    LOCKS_START_LEVEL: 2,
    MAX_LOCKS_PER_LEVEL_UP: 4,
    SCRAMBLES_START: 3,
    MAX_BOARD_ATTEMPTS: 200, // rejection-sampling attempts for a fresh board
    MAX_SCRAMBLE_ATTEMPTS: 200,
    MAX_LOCK_ATTEMPTS: 100,
    DRAG_THRESHOLD_CELLS: 0.25, // pointer travel before a drag commits to a direction
    POP_MS: 240,
    GRAVITY_MS: 200,
    LEVEL_UP_MS: 400,
    SHAKE_MS: 320,
    HINT_MS: 1800,
    BEST_KEY: 'fuzzle-best'
  };
  var N = CONFIG.BOARD_SIZE;
  var COLORS = CONFIG.COLORS;

  // ------------------------------------------------------------ PURE LOGIC
  /**
   * True modulo (JS `%` keeps the sign of the dividend). Required for wrap:
   * sliding left by 1 from column 0 must land on column N-1, not -1.
   * @param {number} n
   * @param {number} m - modulus, must be > 0
   * @returns {number} value in [0, m)
   */
  function mod(n, m) { return ((n % m) + m) % m; }

  /**
   * Rotate an array by `shift` positions, wrapping around.
   * Positive = right (rows) / down (columns). Shared by the colour-matrix
   * rotation (used for move search) and the live-board rotation, so the two
   * can never disagree about what a slide means.
   * @param {Array} arr
   * @param {number} shift
   * @returns {Array} new array, input untouched
   */
  function rotateArray(arr, shift) {
    var s = mod(shift, arr.length), out = new Array(arr.length), i;
    for (i = 0; i < arr.length; i++) out[mod(i + s, arr.length)] = arr[i];
    return out;
  }

  /**
   * Find connected groups of >= minGroup same-colour tiles in a colour matrix.
   * BFS over orthogonal neighbours only: diagonals do not connect, and a
   * group is counted once even if it is L-shaped or larger than a line.
   * @param {Array<Array<string|null>>} colors - rows of colour ids (null = empty)
   * @param {number} [minGroup] - defaults to CONFIG.MIN_GROUP
   * @returns {Array<{color: string, cells: Array<[number, number]>}>}
   */
  function findGroupsFromColors(colors, minGroup) {
    var need = minGroup || CONFIG.MIN_GROUP;
    var rows = colors.length, cols = colors[0].length;
    var seen = [], groups = [], r, c;
    for (r = 0; r < rows; r++) { seen.push([]); for (c = 0; c < cols; c++) seen[r].push(false); }
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var col = colors[r][c];
      if (!col || seen[r][c]) continue;
      var stack = [[r, c]], group = [];
      seen[r][c] = true;
      while (stack.length) {
        var cur = stack.pop(), cr = cur[0], cc = cur[1];
        group.push([cr, cc]);
        // Orthogonal only, and only inside the board: wrap does NOT apply
        // to matching (a tile on the left edge does not match the right edge).
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nr = cr + d[0], nc = cc + d[1];
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc] && colors[nr][nc] === col) {
            seen[nr][nc] = true; stack.push([nr, nc]);
          }
        });
      }
      if (group.length >= need) groups.push({ color: col, cells: group });
    }
    return groups;
  }

  /**
   * Return a new colour matrix with one row/column rotated. Pure and
   * non-mutating, so move search can try all 60 rotations (10 lines x 5
   * shifts, plus the identity is skipped) without touching the live board.
   * @param {Array<Array<string|null>>} colors
   * @param {'row'|'col'} type
   * @param {number} index
   * @param {number} shift
   * @returns {Array<Array<string|null>>}
   */
  function rotateColors(colors, type, index, shift) {
    var out = colors.map(function (row) { return row.slice(); });
    var i;
    if (type === 'row') {
      out[index] = rotateArray(colors[index], shift);
    } else {
      var col = colors.map(function (row) { return row[index]; });
      var rotated = rotateArray(col, shift);
      for (i = 0; i < colors.length; i++) out[i][index] = rotated[i];
    }
    return out;
  }

  // Test seam: in Node (no DOM) export the pure logic and stop here, so
  // `node --test tests/` exercises the real matcher/rotation, not a copy.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG: CONFIG, mod: mod, rotateArray: rotateArray, findGroupsFromColors: findGroupsFromColors, rotateColors: rotateColors };
  }
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------- UI
  /** Fail loud at startup instead of throwing later from a null element. */
  function el(id) {
    var e = document.getElementById(id);
    if (!e) throw new Error('Fuzzle: missing required element #' + id);
    return e;
  }
  var boardEl = el('board');
  var scoreEl = el('score');
  var bestEl = el('best');
  var levelEl = el('level');
  var scramblesEl = el('scrambles');
  var meterFill = el('meterFill');
  var meterText = el('meterText');
  var messageEl = el('message');
  var selectedText = el('selectedText');
  var btnScramble = el('btnScramble');
  var btnSound = el('btnSound');

  // Game state. `selectedId` (not coordinates) is deliberate: after a slide
  // or gravity, a tile moves, but its id does not. Selecting by coordinates
  // silently re-pointed at a different tile after every cascade (v1 bug).
  var board = []; // board[r][c] = {id, color, locked}
  var els = {};   // tile id -> element
  var nextId = 1;
  var score = 0, level = 1, poppedThisLevel = 0;
  var levelTarget = CONFIG.LEVEL_BASE_TARGET;
  var scrambles = CONFIG.SCRAMBLES_START;
  var selectedId = null;
  var busy = false, soundOn = true;
  var drag = null;
  var hintTimeout = null;
  var best = loadBest();

  function loadBest() {
    try { return parseInt(localStorage.getItem(CONFIG.BEST_KEY) || '0', 10) || 0; }
    catch (e) { return 0; } // private mode / blocked storage: best just resets
  }
  function saveBest() {
    try { localStorage.setItem(CONFIG.BEST_KEY, String(best)); } catch (e) { /* best is best-effort */ }
  }

  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
  function cellPx() { return boardEl.getBoundingClientRect().width / N; }
  function msg(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind ? ' ' + kind : '');
  }
  function shakeBoard() {
    boardEl.classList.add('shake');
    setTimeout(function () { boardEl.classList.remove('shake'); }, CONFIG.SHAKE_MS);
  }
  /** One place for every rejected move, so lock/no-match feedback cannot drift. */
  function rejectMove(text) {
    shakeBoard();
    msg(text, 'bad');
    blip(180, 0.12, 'square');
  }

  // ---- audio (WebAudio only, no files) ----
  var audioCtx = null;
  function blip(freq, dur, type) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.12, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* audio is optional; a failed blip must never break a move */ }
  }

  function makeTile(color, locked) {
    return { id: nextId++, color: color, locked: !!locked };
  }
  function colorsMatrix(b) {
    b = b || board;
    return b.map(function (row) { return row.map(function (t) { return t ? t.color : null; }); });
  }
  function findGroups() { return findGroupsFromColors(colorsMatrix()); }

  /** Tiles of one line, in board order. Used by lock checks and drag rendering. */
  function lineTiles(type, index) {
    var out = [], i;
    for (i = 0; i < N; i++) out.push(type === 'row' ? board[index][i] : board[i][index]);
    return out;
  }
  /** A locked tile freezes its whole row AND column — that is the lock rule. */
  function lineHasLock(type, index) {
    return lineTiles(type, index).some(function (t) { return t && t.locked; });
  }
  /** Current coordinates of the selected tile, or null. Scans by id (see above). */
  function selectedPos() {
    if (selectedId === null) return null;
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      if (board[r][c].id === selectedId) return { r: r, c: c };
    }
    return null; // tile popped or scrambled away: selection is stale, drop it
  }

  /**
   * Brute-force move search: try every line and every non-zero shift and
   * keep the first that creates a group. Cost is 60 rotations x BFS on a
   * 6x6 board — trivial here, and correctness matters more than cleverness.
   * It must skip locked lines, or Hint would suggest an illegal move.
   * @returns {{type: string, index: number, shift: number}|null}
   */
  function findMove() {
    var colors = colorsMatrix(), type, index, shift;
    var types = ['row', 'col'];
    for (var ti = 0; ti < 2; ti++) {
      type = types[ti];
      for (index = 0; index < N; index++) {
        if (lineHasLock(type, index)) continue;
        for (shift = 1; shift < N; shift++) {
          if (findGroupsFromColors(rotateColors(colors, type, index, shift)).length) {
            return { type: type, index: index, shift: shift };
          }
        }
      }
    }
    return null;
  }
  function hasMove() { return !!findMove(); }

  /**
   * Fresh board by rejection sampling: deal random tiles until the board
   * has no pre-existing groups AND at least one legal move. A board that
   * starts with a pop, or with no move, is not a fair start.
   * Tail risk (documented, not hidden): if MAX_BOARD_ATTEMPTS is exhausted
   * the last board is used anyway and a warning is logged. At 6 colours
   * this has not been observed; a deterministic fallback is future work.
   */
  function newBoard() {
    var attempt = 0;
    do {
      board = [];
      for (var r = 0; r < N; r++) {
        board.push([]);
        for (var c = 0; c < N; c++) board[r].push(makeTile(randColor(), false));
      }
      attempt++;
    } while ((findGroups().length || !hasMove()) && attempt < CONFIG.MAX_BOARD_ATTEMPTS);
    if (findGroups().length || !hasMove()) {
      console.warn('Fuzzle: fresh board still invalid after ' + attempt + ' attempts');
    }
  }

  function render(hintLine) {
    var px = cellPx(), r, c;
    // Remove elements for tiles no longer on the board.
    var live = {};
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) live[board[r][c].id] = true;
    Object.keys(els).forEach(function (id) {
      if (!live[id]) { els[id].remove(); delete els[id]; }
    });
    var sel = selectedPos();
    if (sel === null) selectedId = null; // drop a stale selection, don't render it
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var tile = board[r][c], element = els[tile.id];
      if (!element) {
        element = document.createElement('div');
        element.innerHTML = '<div class="blob"><span class="eye left"></span><span class="eye right"></span></div>';
        boardEl.appendChild(element);
        els[tile.id] = element;
      }
      var cls = 'tile c-' + tile.color;
      if (tile.locked) cls += ' locked';
      if (sel && sel.r === r && sel.c === c) cls += ' selected';
      if (hintLine) {
        var inLine = hintLine.type === 'row' ? r === hintLine.index : c === hintLine.index;
        if (inLine) cls += ' hint';
      }
      element.className = cls;
      element.dataset.r = r; element.dataset.c = c;
      // Colour alone must not be the only signal: the label names the colour
      // (screen readers, and a first step toward colourblind patterns).
      element.setAttribute('aria-label', tile.color + (tile.locked ? ' locked fuzzy' : ' fuzzy'));
      // Size tiles from the measured board, not the CSS variable, so the
      // 6 tiles exactly fill the board regardless of border/padding.
      element.style.width = px + 'px'; element.style.height = px + 'px';
      element.style.transform = 'translate(' + (c * px) + 'px,' + (r * px) + 'px)';
    }
    scoreEl.textContent = score;
    bestEl.textContent = best;
    levelEl.textContent = level;
    scramblesEl.textContent = scrambles;
    meterFill.style.width = Math.min(100, Math.round(poppedThisLevel / levelTarget * 100)) + '%';
    meterText.textContent = poppedThisLevel + ' / ' + levelTarget + ' popped';
    if (sel) {
      var s = board[sel.r][sel.c];
      selectedText.textContent = 'Selected: ' + s.color + (s.locked ? ' (locked)' : '') + ' at row ' + (sel.r + 1) + ', col ' + (sel.c + 1) + '.';
    } else {
      selectedText.textContent = 'Tap a fuzzy to select it, then use the arrows.';
    }
    btnScramble.disabled = busy || scrambles <= 0;
  }

  /** Rotate the live board. Same semantics as rotateColors, via rotateArray. */
  function rotateLine(type, index, shift) {
    var i;
    if (type === 'row') {
      board[index] = rotateArray(board[index], shift);
    } else {
      var col = board.map(function (row) { return row[index]; });
      var rotated = rotateArray(col, shift);
      for (i = 0; i < N; i++) board[i][index] = rotated[i];
    }
  }

  /**
   * Gravity: collect the survivors in each column, bottom-first, then refill
   * from the top with fresh tiles. Iterating top-to-bottom and popping from
   * the end gives the bottom survivor first without Array.shift() (O(n^2)).
   */
  function applyGravity() {
    for (var c = 0; c < N; c++) {
      var stack = [];
      for (var r = 0; r < N; r++) if (board[r][c]) stack.push(board[r][c]);
      for (r = N - 1; r >= 0; r--) {
        board[r][c] = stack.length ? stack.pop() : makeTile(randColor(), false);
      }
    }
  }

  function addLocks(count) {
    var placed = 0, tries = 0;
    while (placed < count && tries < CONFIG.MAX_LOCK_ATTEMPTS) {
      tries++;
      var r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N);
      if (!board[r][c].locked) { board[r][c].locked = true; placed++; }
    }
  }

  /**
   * Group score: base per tile, plus a bonus for each tile beyond 3, all
   * multiplied by the cascade number. The multiplier applies to the whole
   * group (not just the base) — that is the cascade incentive, by design.
   */
  function scoreForGroup(size, cascade) {
    return (size * CONFIG.SCORE_PER_TILE + (size >= 4 ? (size - CONFIG.MIN_GROUP) * CONFIG.BONUS_PER_EXTRA_TILE : 0)) * cascade;
  }

  async function resolveBoard() {
    busy = true; render();
    var cascade = 1;
    while (true) {
      var groups = findGroups();
      if (!groups.length) break;
      var popped = 0, gained = 0, lockedPopped = 0;
      groups.forEach(function (g) {
        popped += g.cells.length;
        gained += scoreForGroup(g.cells.length, cascade);
        g.cells.forEach(function (cell) {
          var t = board[cell[0]][cell[1]];
          if (t && t.locked) lockedPopped++;
          var element = t ? els[t.id] : null;
          if (element) element.classList.add('popping');
        });
      });
      gained += lockedPopped * CONFIG.LOCKED_BONUS;
      score += gained; poppedThisLevel += popped;
      blip(520 + cascade * 80, 0.18, 'triangle');
      msg('Pop! +' + gained + (cascade > 1 ? ' (cascade x' + cascade + ')' : '') + (lockedPopped ? ' — unlocked bonus!' : ''), 'good');
      // Do NOT re-render here: render() would strip the .popping class.
      // The HUD catches up on the next render after gravity.
      await sleep(CONFIG.POP_MS);
      groups.forEach(function (g) { g.cells.forEach(function (cell) { board[cell[0]][cell[1]] = null; }); });
      applyGravity();
      render();
      await sleep(CONFIG.GRAVITY_MS);
      cascade++;
    }
    // Level up: the meter is pops, not points, so a big cascade cannot skip
    // a level — each level's bonus is earned by popping its target.
    while (poppedThisLevel >= levelTarget) {
      poppedThisLevel -= levelTarget;
      level++;
      var bonus = CONFIG.LEVEL_BONUS_PER_LEVEL * level;
      score += bonus;
      levelTarget = CONFIG.LEVEL_BASE_TARGET + (level - 1) * CONFIG.LEVEL_TARGET_STEP;
      msg('Level ' + level + '! Bonus +' + bonus + (level >= CONFIG.LOCKS_START_LEVEL ? ' — locks are appearing.' : ''), 'good');
      blip(880, 0.3, 'sine'); blip(1170, 0.3, 'sine');
      if (level >= CONFIG.LOCKS_START_LEVEL) addLocks(Math.min(level, CONFIG.MAX_LOCKS_PER_LEVEL_UP));
      render();
      await sleep(CONFIG.LEVEL_UP_MS);
    }
    if (score > best) { best = score; saveBest(); }
    busy = false;
    render();
    if (!hasMove()) {
      if (scrambles > 0) msg('No moves left — use a Scramble!', 'bad');
      else { msg('Game over — no moves and no scrambles left. Hit New game!', 'bad'); }
    }
  }

  async function attemptSlide(type, index, shift) {
    if (busy || shift === 0) return;
    if (lineHasLock(type, index)) {
      rejectMove('That row/column is locked — pop the 🔒 fuzzy first!');
      return;
    }
    rotateLine(type, index, shift);
    render();
    if (!findGroups().length) {
      rotateLine(type, index, -shift);
      rejectMove('No match — slides back.');
      render();
      return;
    }
    blip(420, 0.08, 'sine');
    await resolveBoard();
  }

  /**
   * Position only the dragged line during a drag. The v1 code called the
   * full render() on every pointermove (36 elements re-styled + a layout
   * read per event) and render() stripped the .dragging class it had just
   * set. Updating only the line is both faster and the reason the class
   * no longer fights the renderer.
   */
  function positionDraggedLine(px) {
    var tiles = lineTiles(drag.mode, drag.mode === 'row' ? drag.r : drag.c);
    tiles.forEach(function (t, i) {
      var element = els[t.id];
      if (!element) return;
      element.classList.add('dragging');
      var pos = mod(i + drag.delta, N);
      if (drag.mode === 'row') element.style.transform = 'translate(' + (pos * px) + 'px,' + (drag.r * px) + 'px)';
      else element.style.transform = 'translate(' + (drag.c * px) + 'px,' + (pos * px) + 'px)';
    });
  }

  // ---- dragging ----
  boardEl.addEventListener('pointerdown', function (e) {
    if (busy) return;
    var tileEl = e.target.closest ? e.target.closest('.tile') : null;
    if (!tileEl) return;
    e.preventDefault();
    drag = {
      r: parseInt(tileEl.dataset.r, 10), c: parseInt(tileEl.dataset.c, 10),
      x: e.clientX, y: e.clientY, mode: null, delta: 0
    };
    try { boardEl.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort */ }
  });

  boardEl.addEventListener('pointermove', function (e) {
    if (!drag || busy) return;
    var px = cellPx();
    var dx = (e.clientX - drag.x) / px, dy = (e.clientY - drag.y) / px;
    if (!drag.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < CONFIG.DRAG_THRESHOLD_CELLS) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
      if (lineHasLock(drag.mode, drag.mode === 'row' ? drag.r : drag.c)) {
        msg('That row/column is locked — pop the 🔒 fuzzy first!', 'bad');
        drag = null; render(); return;
      }
    }
    drag.delta = drag.mode === 'row' ? dx : dy;
    positionDraggedLine(px);
  });

  async function endDrag() {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.mode) {
      // Tap = select. Selection is by tile id, so it survives later slides.
      var tile = board[d.r][d.c];
      selectedId = tile ? tile.id : null;
      render();
      return;
    }
    var shift = Math.round(d.delta);
    render();
    if (shift !== 0) await attemptSlide(d.mode, d.mode === 'row' ? d.r : d.c, shift);
    else render();
  }
  boardEl.addEventListener('pointerup', endDrag);
  boardEl.addEventListener('pointercancel', function () { drag = null; render(); });

  document.addEventListener('keydown', function (e) {
    if (busy) return;
    var sel = selectedPos();
    if (!sel) return;
    var map = { ArrowLeft: ['row', -1], ArrowRight: ['row', 1], ArrowUp: ['col', -1], ArrowDown: ['col', 1] };
    if (!map[e.key]) return;
    e.preventDefault();
    var type = map[e.key][0], shift = map[e.key][1];
    attemptSlide(type, type === 'row' ? sel.r : sel.c, shift);
  });

  /** D-pad: slide the selected tile's row/column by one, if anything is selected. */
  function slideSelected(type, shift) {
    var sel = selectedPos();
    if (sel) attemptSlide(type, type === 'row' ? sel.r : sel.c, shift);
  }
  el('btnUp').addEventListener('click', function () { slideSelected('col', -1); });
  el('btnDown').addEventListener('click', function () { slideSelected('col', 1); });
  el('btnLeft').addEventListener('click', function () { slideSelected('row', -1); });
  el('btnRight').addEventListener('click', function () { slideSelected('row', 1); });

  el('btnHint').addEventListener('click', function () {
    if (busy) return;
    var move = findMove();
    if (!move) { msg('No moves — use a Scramble!', 'bad'); return; }
    var dir = move.type === 'row' ? (move.shift <= 3 ? 'right' : 'left') : (move.shift <= 3 ? 'down' : 'up');
    var shownShift = move.shift <= 3 ? move.shift : move.shift - N;
    msg('Hint: slide ' + move.type + ' ' + (move.index + 1) + ' ' + dir + ' by ' + Math.abs(shownShift) + '.', 'good');
    render(move);
    if (hintTimeout) clearTimeout(hintTimeout);
    hintTimeout = setTimeout(function () {
      hintTimeout = null;
      if (!drag && !busy) render(); // don't wipe a drag the user started meanwhile
    }, CONFIG.HINT_MS);
  });

  btnScramble.addEventListener('click', function () {
    if (busy || scrambles <= 0) return;
    // Shuffle until the board is valid (no groups, at least one move).
    // v1 decremented first and then reported success even when 200 shuffles
    // failed; now a failed scramble is not consumed.
    var colors = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) colors.push(board[r][c].color);
    var attempt = 0, ok = false;
    while (!ok && attempt < CONFIG.MAX_SCRAMBLE_ATTEMPTS) {
      attempt++;
      for (var i = colors.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = colors[i]; colors[i] = colors[j]; colors[j] = tmp;
      }
      var test = [];
      for (r = 0; r < N; r++) test.push(colors.slice(r * N, (r + 1) * N));
      var saved = board;
      board = test.map(function (row) { return row.map(function (col) { return makeTile(col, false); }); });
      ok = !findGroups().length && hasMove();
      if (!ok) board = saved;
    }
    if (!ok) {
      rejectMove('Scramble failed — try again (not consumed).');
      render();
      return;
    }
    scrambles--;
    selectedId = null;
    msg('Scrambled! ' + scrambles + ' left.', 'good');
    blip(660, 0.15, 'triangle');
    render();
  });

  btnSound.addEventListener('click', function () {
    soundOn = !soundOn;
    btnSound.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
    btnSound.setAttribute('aria-pressed', String(soundOn));
  });

  el('btnNew').addEventListener('click', function () {
    if (busy) return;
    score = 0; level = 1; poppedThisLevel = 0; levelTarget = CONFIG.LEVEL_BASE_TARGET;
    scrambles = CONFIG.SCRAMBLES_START; selectedId = null;
    newBoard(); render();
    msg('New game! Drag a row or column to make a match.');
  });

  window.addEventListener('resize', function () { if (!drag) render(); });

  newBoard();
  render();
  msg('Drag a row left/right or a column up/down to make a match!');
})();
