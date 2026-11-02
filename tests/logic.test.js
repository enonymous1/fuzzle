// Pure-logic tests for game.js. No DOM, no dependencies, Node's built-in runner.
// game.js exports its pure functions when loaded in Node (see the guard
// after rotateColors) and returns before touching the DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mod, rotateArray, findGroupsFromColors, rotateColors } = require('../game.js');

// A board with no groups at all: every row and column is a permutation.
const EMPTY_OF_GROUPS = [
  ['red', 'orange', 'yellow', 'green', 'blue', 'purple'],
  ['orange', 'yellow', 'green', 'blue', 'purple', 'red'],
  ['yellow', 'green', 'blue', 'purple', 'red', 'orange'],
  ['green', 'blue', 'purple', 'red', 'orange', 'yellow'],
  ['blue', 'purple', 'red', 'orange', 'yellow', 'green'],
  ['purple', 'red', 'orange', 'yellow', 'green', 'blue'],
];

test('mod wraps negative values (the slide-wrap rule)', () => {
  assert.equal(mod(-1, 6), 5);
  assert.equal(mod(6, 6), 0);
  assert.equal(mod(7, 6), 1);
});

test('rotateArray wraps and does not mutate its input', () => {
  const input = ['a', 'b', 'c'];
  assert.deepEqual(rotateArray(input, 1), ['c', 'a', 'b']);
  assert.deepEqual(rotateArray(input, -1), ['b', 'c', 'a']);
  assert.deepEqual(input, ['a', 'b', 'c']);
});

test('rotateColors rotates a row right and a column down, with wrap', () => {
  const row = rotateColors(EMPTY_OF_GROUPS, 'row', 0, 1);
  assert.deepEqual(row[0], ['purple', 'red', 'orange', 'yellow', 'green', 'blue']);
  assert.deepEqual(row[1], EMPTY_OF_GROUPS[1]); // other rows untouched
  const col = rotateColors(EMPTY_OF_GROUPS, 'col', 0, 1);
  assert.deepEqual(col.map((r) => r[0]), ['purple', 'red', 'orange', 'yellow', 'green', 'blue']);
  // Original matrix untouched (move search must not mutate the live board).
  assert.equal(EMPTY_OF_GROUPS[0][0], 'red');
});

test('findGroups: a straight line of 3 counts', () => {
  const board = EMPTY_OF_GROUPS.map((r) => r.slice());
  board[0][0] = 'red'; board[0][1] = 'red'; board[0][2] = 'red';
  const groups = findGroupsFromColors(board);
  assert.ok(groups.some((g) => g.cells.length === 3));
});

test('findGroups: an L-shape and a 2x2 block count (Chuzzle, not Bejeweled)', () => {
  const l = EMPTY_OF_GROUPS.map((r) => r.slice());
  l[0][0] = 'red'; l[0][1] = 'red'; l[1][0] = 'red';
  assert.ok(findGroupsFromColors(l).some((g) => g.cells.length === 3));
  const square = EMPTY_OF_GROUPS.map((r) => r.slice());
  square[2][2] = 'blue'; square[2][3] = 'blue'; square[3][2] = 'blue'; square[3][3] = 'blue';
  // >= 4, not === 4: the 2x2 touches a blue at [3][1] in the base board,
  // so the connected group is 5. The point is the block counts, not its size.
  assert.ok(findGroupsFromColors(square).some((g) => g.cells.length >= 4));
});

test('findGroups: diagonals do not connect, and pairs do not count', () => {
  const diag = EMPTY_OF_GROUPS.map((r) => r.slice());
  diag[0][0] = 'red'; diag[1][1] = 'red'; diag[2][2] = 'red';
  // The diagonal touches nothing else, so it must not be reported.
  // (Other cells in the base board form no groups by construction.)
  assert.deepEqual(findGroupsFromColors(diag), []);
  const pair = EMPTY_OF_GROUPS.map((r) => r.slice());
  pair[0][0] = 'red'; pair[0][1] = 'red';
  assert.deepEqual(findGroupsFromColors(pair), []);
});

test('findGroups: a group-free board reports no groups', () => {
  assert.deepEqual(findGroupsFromColors(EMPTY_OF_GROUPS), []);
});
