// Board smoke test: load the real game.js against a minimal DOM stub and
// assert it builds a 6x6 board without throwing. This is an integration
// smoke test, not a substitute for the pure-logic tests in logic.test.js —
// it catches missing-element and startup crashes that node --check cannot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function fakeEl(id) {
  return {
    id: id || '', textContent: '', innerHTML: '', className: '',
    dataset: {}, style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {}, remove() {}, setAttribute() {},
    appendChild(child) { (this.children = this.children || []).push(child); },
    getBoundingClientRect() { return { width: 408 }; },
    setPointerCapture() {},
  };
}

test('game builds 36 valid tiles on load', () => {
  const byId = {};
  ['board', 'score', 'best', 'level', 'scrambles', 'meterFill', 'meterText',
   'message', 'selectedText', 'btnUp', 'btnDown', 'btnLeft', 'btnRight',
   'btnHint', 'btnScramble', 'btnSound', 'btnNew'].forEach((id) => { byId[id] = fakeEl(id); });
  byId.board.children = [];
  global.window = { addEventListener() {} };
  global.document = {
    getElementById: (id) => byId[id] || fakeEl(id),
    createElement: () => fakeEl('tile'),
    addEventListener() {},
  };
  global.localStorage = { getItem: () => '0', setItem() {} };

  const code = fs.readFileSync(path.join(__dirname, '..', 'game.js'), 'utf8');
  eval(code); // eslint-disable-line no-eval — the point is to load the real file

  const tiles = byId.board.children;
  assert.equal(tiles.length, 36);
  assert.ok(tiles.every((t) => /^tile c-(red|orange|yellow|green|blue|purple)/.test(t.className)));
  delete global.window; delete global.document; delete global.localStorage;
});
