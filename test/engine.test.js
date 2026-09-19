const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.js');

/** Legt ein Teil an eine feste Position, damit Testfaelle reproduzierbar sind. */
function place(game, type, x, y, rotation = 0) {
  game.piece = game.createPiece(type);
  game.piece.x = x;
  game.piece.y = y;
  game.piece.rotation = rotation;
  return game.piece;
}

/** Fuellt eine Grid-Zeile bis auf die angegebenen Luecken. */
function fillRow(game, y, gaps = []) {
  for (let x = 0; x < game.cols; x++) {
    game.grid[y][x] = gaps.includes(x) ? null : 'I';
  }
}

test('Spielfeld startet leer mit korrekten Massen', () => {
  const game = new E.Tetris({ seed: 42 });
  assert.strictEqual(game.cols, 10);
  assert.strictEqual(game.rows, 20);
  assert.strictEqual(game.grid.length, 22);
  assert.strictEqual(game.score, 0);
  assert.strictEqual(game.level, 1);
});

test('7-Bag liefert jedes Tetromino genau einmal pro Beutel', () => {
  const game = new E.Tetris({ seed: 7 });
  game.bag = []; // Konstruktor hat bereits Teile gezogen - frisch beginnen
  const drawn = [];
  for (let i = 0; i < 7; i++) drawn.push(game.nextFromBag());
  assert.deepStrictEqual(drawn.slice().sort(), E.TYPES.slice().sort());
});

test('Gleicher Seed erzeugt die gleiche Teilefolge', () => {
  const a = new E.Tetris({ seed: 123 });
  const b = new E.Tetris({ seed: 123 });
  assert.deepStrictEqual(a.queue, b.queue);
  assert.strictEqual(a.piece.type, b.piece.type);
});

test('Bewegung stoppt an den Seitenwaenden', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', -1, 0);
  assert.strictEqual(game.move(-1), false, 'links darf nicht aus dem Feld');
  game.piece.x = game.cols - 3;
  assert.strictEqual(game.move(1), false, 'rechts darf nicht aus dem Feld');
});

test('Hard Drop setzt das Teil auf den Boden', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', 4, 0);
  game.hardDrop();
  const bottom = game.grid[game.grid.length - 1];
  assert.strictEqual(bottom[5], 'O');
  assert.strictEqual(bottom[6], 'O');
});

test('Volle Reihe wird geloescht und zaehlt 100 Punkte mal Level', () => {
  const game = new E.Tetris({ seed: 1 });
  const lastRow = game.grid.length - 1;
  fillRow(game, lastRow, [5, 6]);
  game.grid[0][0] = 'I'; // Restblock: sonst waere es ein Perfect Clear mit Bonus
  place(game, 'O', 4, 0);
  const before = game.score;
  const result = game.hardDrop();

  assert.strictEqual(result.cleared, 1);
  assert.strictEqual(result.label, 'Single');
  assert.strictEqual(game.lines, 1);
  // 100 Punkte fuer die Reihe plus 2 Punkte je Feld Hard-Drop-Strecke.
  assert.strictEqual(game.score - before, 100 + 20 * 2);
  // Die obere Haelfte des O-Steins rutscht in die geloeschte Reihe nach.
  assert.deepStrictEqual(
    game.grid[lastRow].map((cell) => (cell ? 'x' : '.')).join(''),
    '.....xx...'
  );
});

test('Tetris (vier Reihen) gibt 800 Punkte und setzt Back-to-Back', () => {
  const game = new E.Tetris({ seed: 1 });
  const bottom = game.grid.length - 1;
  for (let y = bottom - 3; y <= bottom; y++) fillRow(game, y, [0]);
  place(game, 'I', -2, 0, 1); // vertikales I in Spalte 0

  const result = game.hardDrop();
  assert.strictEqual(result.cleared, 4);
  assert.strictEqual(result.label, 'Tetris');
  assert.strictEqual(game.backToBack, true);
  assert.strictEqual(game.lines, 4);
});

test('Zweiter Tetris bekommt den Back-to-Back-Bonus von 50 Prozent', () => {
  const game = new E.Tetris({ seed: 1 });
  game.backToBack = true;
  game.combo = -1;
  const bottom = game.grid.length - 1;
  for (let y = bottom - 3; y <= bottom; y++) fillRow(game, y, [0]);
  game.grid[0][0] = 'I'; // Restblock: isoliert den Back-to-Back-Bonus
  place(game, 'I', -2, 0, 1);

  const result = game.hardDrop();
  assert.strictEqual(result.backToBack, true);
  // 800 * 1.5 = 1200, plus Combo-Bonus 0 beim ersten Clear der Kette.
  assert.strictEqual(result.gained, 1200);
});

test('Level steigt alle zehn Reihen', () => {
  const game = new E.Tetris({ seed: 1 });
  game.lines = 9;
  const lastRow = game.grid.length - 1;
  fillRow(game, lastRow, [5, 6]);
  place(game, 'O', 4, 0);
  game.hardDrop();

  assert.strictEqual(game.lines, 10);
  assert.strictEqual(game.level, 2);
});

test('Hoeheres Level faellt schneller', () => {
  const game = new E.Tetris({ seed: 1 });
  const slow = game.gravityInterval();
  game.level = 10;
  assert.ok(game.gravityInterval() < slow);
});

test('Rotation nutzt Wall Kick an der linken Wand', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'T', -1, 5, 0); // Spitze ragt ueber den linken Rand hinaus
  assert.strictEqual(game.rotate(-1), true, 'Rotation gelingt per Kick');
  const cells = game.cellsOf(game.piece);
  assert.ok(cells.every(([x]) => x >= 0 && x < game.cols), 'alle Felder im Spielfeld');
});

test('O-Stein behaelt bei Rotation seine Felder', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', 4, 5);
  const before = game.cellsOf(game.piece).map(String).sort();
  game.rotate(1);
  const after = game.cellsOf(game.piece).map(String).sort();
  assert.deepStrictEqual(after, before);
});

test('Alle Tetrominos haben in jeder Lage genau vier Felder', () => {
  for (const type of E.TYPES) {
    for (let rot = 0; rot < 4; rot++) {
      assert.strictEqual(E.SHAPES[type][rot].length, 4, `${type} Lage ${rot}`);
    }
  }
});

test('Hold tauscht das Teil und ist pro Zug nur einmal nutzbar', () => {
  const game = new E.Tetris({ seed: 5 });
  const first = game.piece.type;
  assert.strictEqual(game.holdPiece(), true);
  assert.strictEqual(game.hold, first);
  assert.notStrictEqual(game.piece.type, null);

  const second = game.piece.type;
  assert.strictEqual(game.holdPiece(), false, 'zweites Hold ist gesperrt');
  assert.strictEqual(game.piece.type, second);

  game.hardDrop(); // neues Teil -> Hold wieder frei
  assert.strictEqual(game.holdUsed, false);
});

test('Hold tauscht beim zweiten Mal mit dem abgelegten Teil', () => {
  const game = new E.Tetris({ seed: 5 });
  const first = game.piece.type;
  game.holdPiece();
  game.hardDrop(); // das getauschte Teil wird abgelegt, ein neues erscheint
  const third = game.piece.type;
  game.holdPiece();
  assert.strictEqual(game.piece.type, first, 'das gehaltene Teil kommt zurueck');
  assert.strictEqual(game.hold, third, 'das aktuelle Teil wandert ins Hold');
});

test('Ghost-Piece zeigt die Landeposition', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', 4, 0);
  const ghost = game.ghostY();
  game.hardDrop();
  // Das Teil wurde bereits verankert - die Landereihe muss belegt sein.
  assert.strictEqual(game.grid[ghost + 1][5], 'O');
});

test('Combo-Zaehler waechst bei Clears in Folge und bricht sonst ab', () => {
  const game = new E.Tetris({ seed: 1 });
  const bottom = game.grid.length - 1;

  fillRow(game, bottom, [5, 6]);
  place(game, 'O', 4, 0);
  game.hardDrop();
  assert.strictEqual(game.combo, 0);

  fillRow(game, bottom, [5, 6]);
  place(game, 'O', 4, 0);
  game.hardDrop();
  assert.strictEqual(game.combo, 1);

  place(game, 'O', 0, 0);
  game.hardDrop();
  assert.strictEqual(game.combo, -1, 'ohne Clear endet die Combo');
});

test('Perfect Clear wird erkannt und extra belohnt', () => {
  const game = new E.Tetris({ seed: 1 });
  const bottom = game.grid.length - 1;
  fillRow(game, bottom, [3, 4, 5, 6]);

  place(game, 'I', 3, 0, 0); // liegendes I fuellt die Luecke exakt aus
  const result = game.hardDrop();

  assert.strictEqual(result.cleared, 1);
  assert.strictEqual(result.perfectClear, true);
  assert.ok(game.isBoardEmpty(), 'Feld ist danach leer');
  // 100 fuer den Single plus 800 Perfect-Clear-Bonus.
  assert.strictEqual(result.gained, 900);
});

test('T-Spin Double wird erkannt und hoeher bewertet', () => {
  const game = new E.Tetris({ seed: 1 });
  const bottom = game.grid.length - 1;

  // T-Mulde: unterste Reihe bis auf Spalte 4 voll, darueber eine 3er-Kerbe,
  // und ein Ueberhang nur links - so bleibt der Schacht ueber Spalte 4 offen.
  fillRow(game, bottom, [4]);
  fillRow(game, bottom - 1, [3, 4, 5]);
  game.grid[bottom - 2][3] = 'I';

  // Senkrecht in Lage 1 einfaedeln, dann im Uhrzeigersinn in die Mulde drehen.
  place(game, 'T', 3, 0, 1);
  while (game.softDropStep()) { /* bis zum Aufliegen fallen lassen */ }
  assert.strictEqual(game.piece.y, bottom - 2, 'liegt im Schacht auf');
  assert.strictEqual(game.rotate(1), true, 'Drehung in die Mulde gelingt');

  const result = game.hardDrop();
  assert.strictEqual(result.spin, 'tspin');
  assert.strictEqual(result.cleared, 2);
  assert.strictEqual(result.label, 'T-Spin Double');
  // T-Spin Double bringt 1200 statt 300 fuer einen normalen Double.
  assert.strictEqual(result.gained, 1200);
});

test('Ohne Drehung zaehlt ein Zug nicht als T-Spin', () => {
  const game = new E.Tetris({ seed: 1 });
  const bottom = game.grid.length - 1;
  fillRow(game, bottom, [4, 5, 6]);
  game.grid[bottom - 1][3] = 'I';
  game.grid[bottom - 1][7] = 'I';

  place(game, 'T', 4, 0, 2); // bereits in Endlage, nur gefallen
  const result = game.hardDrop();
  assert.strictEqual(result.spin, null, 'ohne Rotation kein T-Spin');
});

test('Game Over, wenn das Feld bis oben voll ist', () => {
  const game = new E.Tetris({ seed: 1 });
  for (let y = 0; y < game.grid.length; y++) fillRow(game, y, [9]);
  game.spawn('O');
  assert.strictEqual(game.gameOver, true);
});

test('Im Game-Over-Zustand sind keine Zuege mehr moeglich', () => {
  const game = new E.Tetris({ seed: 1 });
  game.gameOver = true;
  assert.strictEqual(game.move(-1), false);
  assert.strictEqual(game.rotate(1), false);
  assert.strictEqual(game.hardDrop(), null);
  assert.strictEqual(game.tick(), null);
});

test('Pause friert alle Eingaben ein', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'T', 4, 5);
  game.togglePause();
  assert.strictEqual(game.move(1), false);
  assert.strictEqual(game.softDropStep(), false);
  game.togglePause();
  assert.strictEqual(game.move(1), true);
});

test('Tick faellt ein Feld und verankert am Boden', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', 4, 0);
  const y = game.piece.y;
  assert.strictEqual(game.tick(), null);
  assert.strictEqual(game.piece.y, y + 1);

  place(game, 'O', 4, game.grid.length - 2);
  const result = game.tick();
  assert.ok(result, 'am Boden wird verankert');
  assert.strictEqual(game.grid[game.grid.length - 1][5], 'O');
});

test('Soft Drop gibt einen Punkt je Feld', () => {
  const game = new E.Tetris({ seed: 1 });
  place(game, 'O', 4, 0);
  const before = game.score;
  game.softDrop();
  assert.strictEqual(game.score - before, 1);
});

test('Reset stellt den Ausgangszustand wieder her', () => {
  const game = new E.Tetris({ seed: 1 });
  game.score = 5000;
  game.lines = 30;
  game.gameOver = true;
  game.grid[0][0] = 'T';
  game.reset();

  assert.strictEqual(game.score, 0);
  assert.strictEqual(game.lines, 0);
  assert.strictEqual(game.level, 1);
  assert.strictEqual(game.gameOver, false);
  assert.strictEqual(game.hold, null);
  assert.ok(game.isBoardEmpty());
});
