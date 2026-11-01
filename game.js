// Fuzzle — original, Chuzzle-inspired sliding match game. No assets, no backend.
(function () {
  'use strict';
  var N = 6;
  var COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
  var board = []; // board[r][c] = {id, color, locked}
  var els = {};   // id -> element
  var nextId = 1;
  var score = 0, best = 0, level = 1, poppedThisLevel = 0, levelTarget = 40, scrambles = 3;
  var selected = null; // {r,c}
  var busy = false, soundOn = true;
  var drag = null;

  var boardEl = document.getElementById('board');
  var scoreEl = document.getElementById('score');
  var bestEl = document.getElementById('best');
  var levelEl = document.getElementById('level');
  var scramblesEl = document.getElementById('scrambles');
  var meterFill = document.getElementById('meterFill');
  var meterText = document.getElementById('meterText');
  var messageEl = document.getElementById('message');
  var selectedText = document.getElementById('selectedText');

  function mod(n, m) { return ((n % m) + m) % m; }
  function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
  function cellPx() { return boardEl.getBoundingClientRect().width / N; }

  function msg(text, kind) {
    messageEl.textContent = text;
    messageEl.className = 'message' + (kind ? ' ' + kind : '');
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
    } catch (e) { /* audio is optional */ }
  }

  function makeTile(color, locked) {
    return { id: nextId++, color: color, locked: !!locked };
  }

  function colorsMatrix(b) {
    b = b || board;
    return b.map(function (row) { return row.map(function (t) { return t ? t.color : null; }); });
  }

  function findGroupsFromColors(colors) {
    var seen = [], groups = [], r, c;
    for (r = 0; r < N; r++) { seen.push([]); for (c = 0; c < N; c++) seen[r].push(false); }
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var col = colors[r][c];
      if (!col || seen[r][c]) continue;
      var stack = [[r, c]], group = [];
      seen[r][c] = true;
      while (stack.length) {
        var cur = stack.pop(), cr = cur[0], cc = cur[1];
        group.push([cr, cc]);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nr = cr + d[0], nc = cc + d[1];
          if (nr >= 0 && nr < N && nc >= 0 && nc < N && !seen[nr][nc] && colors[nr][nc] === col) {
            seen[nr][nc] = true; stack.push([nr, nc]);
          }
        });
      }
      if (group.length >= 3) groups.push({ color: col, cells: group });
    }
    return groups;
  }
  function findGroups() { return findGroupsFromColors(colorsMatrix()); }

  function rotateColors(colors, type, index, shift) {
    var out = colors.map(function (row) { return row.slice(); });
    var i, s = mod(shift, N);
    if (type === 'row') {
      for (i = 0; i < N; i++) out[index][mod(i + s, N)] = colors[index][i];
    } else {
      for (i = 0; i < N; i++) out[mod(i + s, N)][index] = colors[i][index];
    }
    return out;
  }

  function findMove() {
    var colors = colorsMatrix(), type, index, shift;
    var types = ['row', 'col'];
    for (var ti = 0; ti < 2; ti++) {
      type = types[ti];
      for (index = 0; index < N; index++) {
        // A line containing a locked tile cannot move at all.
        var locked = false;
        for (var k = 0; k < N; k++) {
          var t = type === 'row' ? board[index][k] : board[k][index];
          if (t && t.locked) locked = true;
        }
        if (locked) continue;
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

  function newBoard() {
    var attempt = 0;
    do {
      board = [];
      for (var r = 0; r < N; r++) {
        board.push([]);
        for (var c = 0; c < N; c++) board[r].push(makeTile(randColor(), false));
      }
      attempt++;
    } while ((findGroups().length || !hasMove()) && attempt < 200);
  }

  function render(hintLine) {
    var px = cellPx(), r, c;
    // Remove elements for tiles no longer on the board.
    var live = {};
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) live[board[r][c].id] = true;
    Object.keys(els).forEach(function (id) {
      if (!live[id]) { els[id].remove(); delete els[id]; }
    });
    for (r = 0; r < N; r++) for (c = 0; c < N; c++) {
      var tile = board[r][c], el = els[tile.id];
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<div class="blob"><span class="eye left"></span><span class="eye right"></span></div>';
        boardEl.appendChild(el);
        els[tile.id] = el;
      }
      var cls = 'tile c-' + tile.color;
      if (tile.locked) cls += ' locked';
      if (selected && selected.r === r && selected.c === c) cls += ' selected';
      if (hintLine) {
        var inLine = hintLine.type === 'row' ? r === hintLine.index : c === hintLine.index;
        if (inLine) cls += ' hint';
      }
      el.className = cls;
      el.dataset.r = r; el.dataset.c = c;
      // Size tiles from the measured board, not the CSS variable, so the
      // 6 tiles exactly fill the board regardless of border/padding.
      el.style.width = px + 'px'; el.style.height = px + 'px';
      el.style.transform = 'translate(' + (c * px) + 'px,' + (r * px) + 'px)';
    }
    scoreEl.textContent = score;
    bestEl.textContent = best;
    levelEl.textContent = level;
    scramblesEl.textContent = scrambles;
    meterFill.style.width = Math.min(100, Math.round(poppedThisLevel / levelTarget * 100)) + '%';
    meterText.textContent = poppedThisLevel + ' / ' + levelTarget + ' popped';
    if (selected) {
      var s = board[selected.r][selected.c];
      selectedText.textContent = s ? ('Selected: ' + s.color + (s.locked ? ' (locked)' : '') + ' at row ' + (selected.r + 1) + ', col ' + (selected.c + 1) + '.') : 'Tap a fuzzy to select it, then use the arrows.';
    } else {
      selectedText.textContent = 'Tap a fuzzy to select it, then use the arrows.';
    }
    document.getElementById('btnScramble').disabled = busy || scrambles <= 0;
  }

  function rotateLine(type, index, shift) {
    var s = mod(shift, N), i, old;
    if (type === 'row') {
      old = board[index].slice();
      for (i = 0; i < N; i++) board[index][mod(i + s, N)] = old[i];
    } else {
      old = [];
      for (i = 0; i < N; i++) old.push(board[i][index]);
      for (i = 0; i < N; i++) board[mod(i + s, N)][index] = old[i];
    }
  }

  function lineHasLock(type, index) {
    for (var i = 0; i < N; i++) {
      var t = type === 'row' ? board[index][i] : board[i][index];
      if (t && t.locked) return true;
    }
    return false;
  }

  function applyGravity() {
    for (var c = 0; c < N; c++) {
      var stack = [];
      for (var r = N - 1; r >= 0; r--) if (board[r][c]) stack.push(board[r][c]);
      for (r = N - 1; r >= 0; r--) {
        board[r][c] = stack.length ? stack.shift() : makeTile(randColor(), false);
      }
    }
  }

  function addLocks(count) {
    var placed = 0, tries = 0;
    while (placed < count && tries < 100) {
      tries++;
      var r = Math.floor(Math.random() * N), c = Math.floor(Math.random() * N);
      if (!board[r][c].locked) { board[r][c].locked = true; placed++; }
    }
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
        gained += (g.cells.length * 10 + (g.cells.length >= 4 ? (g.cells.length - 3) * 20 : 0)) * cascade;
        g.cells.forEach(function (cell) {
          var t = board[cell[0]][cell[1]];
          if (t && t.locked) lockedPopped++;
          var el = t ? els[t.id] : null;
          if (el) el.classList.add('popping');
        });
      });
      gained += lockedPopped * 50;
      score += gained; poppedThisLevel += popped;
      blip(520 + cascade * 80, 0.18, 'triangle');
      msg('Pop! +' + gained + (cascade > 1 ? ' (cascade x' + cascade + ')' : '') + (lockedPopped ? ' — unlocked bonus!' : ''), 'good');
      // Do NOT re-render here: render() would strip the .popping class.
      // The HUD catches up on the next render after gravity.
      await sleep(240);
      groups.forEach(function (g) { g.cells.forEach(function (cell) { board[cell[0]][cell[1]] = null; }); });
      applyGravity();
      render();
      await sleep(200);
      cascade++;
    }
    // Level up?
    while (poppedThisLevel >= levelTarget) {
      poppedThisLevel -= levelTarget;
      level++;
      var bonus = 1000 * level;
      score += bonus;
      levelTarget = 40 + (level - 1) * 15;
      msg('Level ' + level + '! Bonus +' + bonus + (level >= 2 ? ' — locks are appearing.' : ''), 'good');
      blip(880, 0.3, 'sine'); blip(1170, 0.3, 'sine');
      if (level >= 2) addLocks(Math.min(level, 4));
      render();
      await sleep(400);
    }
    if (score > best) { best = score; try { localStorage.setItem('fuzzle-best', String(best)); } catch (e) {} }
    busy = false;
    render();
    if (!hasMove()) {
      if (scrambles > 0) msg('No moves left — use a Scramble!', 'bad');
      else { msg('Game over — no moves and no scrambles left. Hit New game!', 'bad'); }
    } else if (selected) {
      // Keep the message unless it was a level message; leave as-is.
    }
  }

  async function attemptSlide(type, index, shift) {
    if (busy || shift === 0) return;
    if (lineHasLock(type, index)) {
      boardEl.classList.add('shake');
      setTimeout(function () { boardEl.classList.remove('shake'); }, 320);
      msg('That row/column is locked — pop the 🔒 fuzzy first!', 'bad');
      blip(140, 0.15, 'square');
      return;
    }
    rotateLine(type, index, shift);
    render();
    if (!findGroups().length) {
      rotateLine(type, index, -shift);
      boardEl.classList.add('shake');
      setTimeout(function () { boardEl.classList.remove('shake'); }, 320);
      msg('No match — slides back.', 'bad');
      blip(180, 0.12, 'square');
      render();
      return;
    }
    blip(420, 0.08, 'sine');
    await resolveBoard();
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
    boardEl.setPointerCapture(e.pointerId);
  });

  boardEl.addEventListener('pointermove', function (e) {
    if (!drag || busy) return;
    var px = cellPx();
    var dx = (e.clientX - drag.x) / px, dy = (e.clientY - drag.y) / px;
    if (!drag.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.25) return;
      drag.mode = Math.abs(dx) > Math.abs(dy) ? 'row' : 'col';
      if (drag.mode === 'row' ? lineHasLock('row', drag.r) : lineHasLock('col', drag.c)) {
        msg('That row/column is locked — pop the 🔒 fuzzy first!', 'bad');
        drag = null; render(); return;
      }
    }
    drag.delta = drag.mode === 'row' ? dx : dy;
    // Live wrap-around positioning for the dragged line only.
    render();
    var lineTiles = [];
    for (var i = 0; i < N; i++) {
      var t = drag.mode === 'row' ? board[drag.r][i] : board[i][drag.c];
      lineTiles.push(t);
    }
    lineTiles.forEach(function (t, i) {
      var el = els[t.id];
      if (!el) return;
      el.classList.add('dragging');
      var pos = mod(i + drag.delta, N);
      if (drag.mode === 'row') el.style.transform = 'translate(' + (pos * px) + 'px,' + (drag.r * px) + 'px)';
      else el.style.transform = 'translate(' + (drag.c * px) + 'px,' + (pos * px) + 'px)';
    });
  });

  async function endDrag(e) {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.mode) {
      // Tap = select.
      selected = { r: d.r, c: d.c };
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
    if (!selected || busy) return;
    var map = { ArrowLeft: ['row', -1], ArrowRight: ['row', 1], ArrowUp: ['col', -1], ArrowDown: ['col', 1] };
    if (!map[e.key]) return;
    e.preventDefault();
    var type = map[e.key][0], shift = map[e.key][1];
    attemptSlide(type, type === 'row' ? selected.r : selected.c, shift);
  });

  document.getElementById('btnUp').addEventListener('click', function () { if (selected) attemptSlide('col', selected.c, -1); });
  document.getElementById('btnDown').addEventListener('click', function () { if (selected) attemptSlide('col', selected.c, 1); });
  document.getElementById('btnLeft').addEventListener('click', function () { if (selected) attemptSlide('row', selected.r, -1); });
  document.getElementById('btnRight').addEventListener('click', function () { if (selected) attemptSlide('row', selected.r, 1); });

  document.getElementById('btnHint').addEventListener('click', function () {
    if (busy) return;
    var move = findMove();
    if (!move) { msg('No moves — use a Scramble!', 'bad'); return; }
    var dir = move.type === 'row' ? (move.shift <= 3 ? 'right' : 'left') : (move.shift <= 3 ? 'down' : 'up');
    var shownShift = move.shift <= 3 ? move.shift : move.shift - N;
    msg('Hint: slide ' + move.type + ' ' + (move.index + 1) + ' ' + dir + ' by ' + Math.abs(shownShift) + '.', 'good');
    render(move);
    setTimeout(function () { render(); }, 1800);
  });

  document.getElementById('btnScramble').addEventListener('click', function () {
    if (busy || scrambles <= 0) return;
    scrambles--;
    var colors = [];
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) colors.push(board[r][c].color);
    var attempt = 0, ok = false;
    while (!ok && attempt < 200) {
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
    selected = null;
    msg('Scrambled! ' + scrambles + ' left.', 'good');
    blip(660, 0.15, 'triangle');
    render();
  });

  document.getElementById('btnSound').addEventListener('click', function (e) {
    soundOn = !soundOn;
    e.target.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound off';
    e.target.setAttribute('aria-pressed', String(soundOn));
  });

  document.getElementById('btnNew').addEventListener('click', function () {
    if (busy) return;
    score = 0; level = 1; poppedThisLevel = 0; levelTarget = 40; scrambles = 3; selected = null;
    newBoard(); render();
    msg('New game! Drag a row or column to make a match.');
  });

  window.addEventListener('resize', function () { render(); });

  try { best = parseInt(localStorage.getItem('fuzzle-best') || '0', 10) || 0; } catch (e) {}
  newBoard();
  render();
  msg('Drag a row left/right or a column up/down to make a match!');
})();
