/**
 * Tetris-Engine: reine Spiellogik, ohne DOM-Zugriff.
 * Laeuft im Browser (window.TetrisEngine) und in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TetrisEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS = 10;
  var ROWS = 20;
  var HIDDEN_ROWS = 2; // Puffer oberhalb des sichtbaren Feldes fuer das Spawnen

  // Rotationszustaende je Tetromino als Koordinatenlisten [x, y] im 4x4-Raster.
  // Reihenfolge: 0 = Spawn, 1 = rechts, 2 = 180 Grad, 3 = links.
  var SHAPES = {
    I: [
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[2, 0], [2, 1], [2, 2], [2, 3]],
      [[0, 2], [1, 2], [2, 2], [3, 2]],
      [[1, 0], [1, 1], [1, 2], [1, 3]]
    ],
    J: [
      [[0, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [2, 2]],
      [[1, 0], [1, 1], [0, 2], [1, 2]]
    ],
    L: [
      [[2, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [1, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [0, 2]],
      [[0, 0], [1, 0], [1, 1], [1, 2]]
    ],
    O: [
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]],
      [[1, 0], [2, 0], [1, 1], [2, 1]]
    ],
    S: [
      [[1, 0], [2, 0], [0, 1], [1, 1]],
      [[1, 0], [1, 1], [2, 1], [2, 2]],
      [[1, 1], [2, 1], [0, 2], [1, 2]],
      [[0, 0], [0, 1], [1, 1], [1, 2]]
    ],
    T: [
      [[1, 0], [0, 1], [1, 1], [2, 1]],
      [[1, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [2, 1], [1, 2]],
      [[1, 0], [0, 1], [1, 1], [1, 2]]
    ],
    Z: [
      [[0, 0], [1, 0], [1, 1], [2, 1]],
      [[2, 0], [1, 1], [2, 1], [1, 2]],
      [[0, 1], [1, 1], [1, 2], [2, 2]],
      [[1, 0], [0, 1], [1, 1], [0, 2]]
    ]
  };

  var TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  var COLORS = {
    I: '#3ad1e0',
    J: '#4a7bf7',
    L: '#f5922f',
    O: '#f2d02c',
    S: '#3fd07a',
    T: '#b45cf0',
    Z: '#f2564b'
  };

  // Wall-Kick-Tabellen nach SRS. Schluessel: "<von><nach>".
  var KICKS_JLSTZ = {
    '01': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '10': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '12': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '21': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '23': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '32': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '30': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '03': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]]
  };

  var KICKS_I = {
    '01': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '10': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '12': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '21': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '23': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '32': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '30': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '03': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]
  };

  // Punkte je Anzahl gleichzeitig geloeschter Reihen (Guideline-Scoring).
  var LINE_SCORES = [0, 100, 300, 500, 800];

  // Fallzeit in Millisekunden je Level (Index = Level, danach konstant).
  var GRAVITY_MS = [
    1000, 793, 618, 473, 355, 262, 190, 135, 94, 64,
    43, 28, 18, 11, 7
  ];

  function createMatrix(cols, rows) {
    var grid = [];
    for (var y = 0; y < rows; y++) {
      var row = [];
      for (var x = 0; x < cols; x++) row.push(null);
      grid.push(row);
    }
    return grid;
  }

  /** Mulberry32: kleiner, deterministischer PRNG - macht Tests reproduzierbar. */
  function createRandom(seed) {
    var state = (seed === undefined ? Date.now() : seed) >>> 0;
    return function () {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Tetris(options) {
    options = options || {};
    this.cols = options.cols || COLS;
    this.rows = options.rows || ROWS;
    this.hiddenRows = options.hiddenRows === undefined ? HIDDEN_ROWS : options.hiddenRows;
    this.random = createRandom(options.seed);
    this.reset();
  }

  Tetris.COLS = COLS;
  Tetris.ROWS = ROWS;
  Tetris.TYPES = TYPES;
  Tetris.COLORS = COLORS;
  Tetris.SHAPES = SHAPES;

  Tetris.prototype.reset = function () {
    this.grid = createMatrix(this.cols, this.rows + this.hiddenRows);
    this.bag = [];
    this.queue = [];
    this.refillQueue();
    this.hold = null;
    this.holdUsed = false;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.backToBack = false;
    this.gameOver = false;
    this.paused = false;
    this.lastClear = null;
    this.piece = null;
    this.spawn();
  };

  /** 7-Bag-Randomizer: jedes Tetromino kommt einmal pro Beutel vor. */
  Tetris.prototype.nextFromBag = function () {
    if (this.bag.length === 0) {
      this.bag = TYPES.slice();
      for (var i = this.bag.length - 1; i > 0; i--) {
        var j = Math.floor(this.random() * (i + 1));
        var tmp = this.bag[i];
        this.bag[i] = this.bag[j];
        this.bag[j] = tmp;
      }
    }
    return this.bag.pop();
  };

  Tetris.prototype.refillQueue = function () {
    while (this.queue.length < 5) this.queue.push(this.nextFromBag());
  };

  Tetris.prototype.createPiece = function (type) {
    return {
      type: type,
      rotation: 0,
      x: Math.floor((this.cols - 4) / 2),
      y: 0,
      lastMoveWasRotation: false,
      lastKickIndex: 0
    };
  };

  Tetris.prototype.spawn = function (type) {
    if (type === undefined) {
      type = this.queue.shift();
      this.refillQueue();
    }
    this.piece = this.createPiece(type);
    this.holdUsed = false;

    // Block-Out: passt das neue Teil nicht mehr, ist die Partie vorbei.
    if (this.collides(this.piece, 0, 0, this.piece.rotation)) {
      this.gameOver = true;
      return false;
    }
    return true;
  };

  /** Absolute Zellkoordinaten eines Teils (Grid-Koordinaten inkl. verstecktem Bereich). */
  Tetris.prototype.cellsOf = function (piece, offsetX, offsetY, rotation) {
    offsetX = offsetX || 0;
    offsetY = offsetY || 0;
    var rot = rotation === undefined ? piece.rotation : rotation;
    var shape = SHAPES[piece.type][((rot % 4) + 4) % 4];
    var cells = [];
    for (var i = 0; i < shape.length; i++) {
      cells.push([piece.x + offsetX + shape[i][0], piece.y + offsetY + shape[i][1]]);
    }
    return cells;
  };

  Tetris.prototype.collides = function (piece, offsetX, offsetY, rotation) {
    var cells = this.cellsOf(piece, offsetX, offsetY, rotation);
    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0];
      var y = cells[i][1];
      if (x < 0 || x >= this.cols) return true;
      if (y >= this.rows + this.hiddenRows) return true;
      if (y >= 0 && this.grid[y][x] !== null) return true;
    }
    return false;
  };

  Tetris.prototype.move = function (dx) {
    if (this.gameOver || this.paused || !this.piece) return false;
    if (this.collides(this.piece, dx, 0)) return false;
    this.piece.x += dx;
    this.piece.lastMoveWasRotation = false;
    return true;
  };

  /** Ein Feld nach unten. Gibt false zurueck, wenn das Teil aufliegt. */
  Tetris.prototype.softDropStep = function () {
    if (this.gameOver || this.paused || !this.piece) return false;
    if (this.collides(this.piece, 0, 1)) return false;
    this.piece.y += 1;
    this.piece.lastMoveWasRotation = false;
    return true;
  };

  Tetris.prototype.softDrop = function () {
    if (this.softDropStep()) {
      this.score += 1;
      return true;
    }
    return false;
  };

  Tetris.prototype.hardDrop = function () {
    if (this.gameOver || this.paused || !this.piece) return null;
    var distance = 0;
    while (!this.collides(this.piece, 0, 1)) {
      this.piece.y += 1;
      distance++;
    }
    this.score += distance * 2;
    if (distance > 0) this.piece.lastMoveWasRotation = false;
    return this.lock();
  };

  /** dir: +1 = im Uhrzeigersinn, -1 = gegen den Uhrzeigersinn, 2 = 180 Grad. */
  Tetris.prototype.rotate = function (dir) {
    if (this.gameOver || this.paused || !this.piece) return false;
    var from = this.piece.rotation;
    var to = ((from + dir) % 4 + 4) % 4;
    if (to === from) return false;

    var kicks;
    if (this.piece.type === 'O') {
      kicks = [[0, 0]];
    } else if (dir === 2) {
      // 180 Grad ist nicht Teil von SRS - nur ohne Versatz erlauben.
      kicks = [[0, 0]];
    } else {
      var table = this.piece.type === 'I' ? KICKS_I : KICKS_JLSTZ;
      kicks = table['' + from + to] || [[0, 0]];
    }

    for (var i = 0; i < kicks.length; i++) {
      var dx = kicks[i][0];
      // SRS-Tabellen rechnen mit y nach oben, das Grid mit y nach unten.
      var dy = -kicks[i][1];
      if (!this.collides(this.piece, dx, dy, to)) {
        this.piece.x += dx;
        this.piece.y += dy;
        this.piece.rotation = to;
        this.piece.lastMoveWasRotation = true;
        this.piece.lastKickIndex = i;
        return true;
      }
    }
    return false;
  };

  Tetris.prototype.holdPiece = function () {
    if (this.gameOver || this.paused || !this.piece || this.holdUsed) return false;
    var current = this.piece.type;
    if (this.hold === null) {
      this.hold = current;
      this.spawn();
    } else {
      var swap = this.hold;
      this.hold = current;
      this.spawn(swap);
    }
    this.holdUsed = true;
    return true;
  };

  /** Y-Position, auf der das aktuelle Teil landen wuerde (Ghost-Piece). */
  Tetris.prototype.ghostY = function () {
    if (!this.piece) return 0;
    var dy = 0;
    while (!this.collides(this.piece, 0, dy + 1)) dy++;
    return this.piece.y + dy;
  };

  /**
   * T-Spin-Erkennung nach 3-Corner-Regel:
   * Das T muss zuletzt rotiert worden sein und mindestens drei der vier
   * Ecken seines 3x3-Feldes muessen belegt sein.
   */
  Tetris.prototype.detectTSpin = function (piece) {
    if (piece.type !== 'T' || !piece.lastMoveWasRotation) return null;
    var cx = piece.x + 1;
    var cy = piece.y + 1;
    var corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
    var occupied = 0;
    for (var i = 0; i < corners.length; i++) {
      var x = corners[i][0];
      var y = corners[i][1];
      if (x < 0 || x >= this.cols || y >= this.rows + this.hiddenRows) {
        occupied++;
      } else if (y >= 0 && this.grid[y][x] !== null) {
        occupied++;
      }
    }
    if (occupied < 3) return null;

    // Die beiden Ecken vor der Spitze bestimmen Full- vs. Mini-T-Spin.
    var frontByRotation = {
      0: [[cx - 1, cy - 1], [cx + 1, cy - 1]],
      1: [[cx + 1, cy - 1], [cx + 1, cy + 1]],
      2: [[cx - 1, cy + 1], [cx + 1, cy + 1]],
      3: [[cx - 1, cy - 1], [cx - 1, cy + 1]]
    };
    var front = frontByRotation[piece.rotation];
    var frontFilled = 0;
    for (var f = 0; f < front.length; f++) {
      var fx = front[f][0];
      var fy = front[f][1];
      if (fx < 0 || fx >= this.cols || fy >= this.rows + this.hiddenRows) {
        frontFilled++;
      } else if (fy >= 0 && this.grid[fy][fx] !== null) {
        frontFilled++;
      }
    }
    // Ein grosser Kick (letzter Eintrag der Tabelle) zaehlt immer als Full.
    if (frontFilled === 2 || piece.lastKickIndex === 4) return 'tspin';
    return 'tspin-mini';
  };

  Tetris.prototype.clearLines = function () {
    var cleared = [];
    for (var y = 0; y < this.grid.length; y++) {
      var full = true;
      for (var x = 0; x < this.cols; x++) {
        if (this.grid[y][x] === null) { full = false; break; }
      }
      if (full) cleared.push(y);
    }
    for (var i = 0; i < cleared.length; i++) {
      this.grid.splice(cleared[i], 1);
      this.grid.unshift(new Array(this.cols).fill(null));
    }
    return cleared;
  };

  /** Teil im Grid verankern, Reihen aufloesen, Punkte buchen, naechstes Teil holen. */
  Tetris.prototype.lock = function () {
    if (!this.piece) return null;
    var piece = this.piece;
    var spin = this.detectTSpin(piece);
    var cells = this.cellsOf(piece);
    var visibleCells = 0;

    for (var i = 0; i < cells.length; i++) {
      var x = cells[i][0];
      var y = cells[i][1];
      if (y >= 0) {
        this.grid[y][x] = piece.type;
        if (y >= this.hiddenRows) visibleCells++;
      }
    }

    var cleared = this.clearLines();
    var result = this.applyScore(cleared.length, spin);
    result.rows = cleared;

    // Lock-Out: liegt das Teil komplett im versteckten Bereich, ist Schluss.
    if (visibleCells === 0 && cleared.length === 0) {
      this.gameOver = true;
      this.piece = null;
      return result;
    }

    this.lastClear = result;
    this.spawn();
    return result;
  };

  Tetris.prototype.applyScore = function (clearedCount, spin) {
    var base = 0;
    var label = null;
    var difficult = false;

    if (spin === 'tspin') {
      base = [400, 800, 1200, 1600][clearedCount];
      label = ['T-Spin', 'T-Spin Single', 'T-Spin Double', 'T-Spin Triple'][clearedCount];
      difficult = clearedCount > 0;
    } else if (spin === 'tspin-mini') {
      base = [100, 200, 400][clearedCount] || 0;
      label = ['T-Spin Mini', 'T-Spin Mini Single', 'T-Spin Mini Double'][clearedCount] || null;
      difficult = clearedCount > 0;
    } else if (clearedCount > 0) {
      base = LINE_SCORES[clearedCount];
      label = ['', 'Single', 'Double', 'Triple', 'Tetris'][clearedCount];
      difficult = clearedCount === 4;
    }

    var backToBack = false;
    if (clearedCount > 0) {
      if (difficult && this.backToBack) {
        base = Math.floor(base * 1.5);
        backToBack = true;
      }
      this.backToBack = difficult;
      this.combo += 1;
    } else {
      this.combo = -1;
    }

    var comboBonus = this.combo > 0 ? 50 * this.combo : 0;
    var perfectClear = clearedCount > 0 && this.isBoardEmpty();
    var perfectBonus = perfectClear ? [0, 800, 1200, 1800, 2000][clearedCount] : 0;

    var gained = (base + comboBonus + perfectBonus) * this.level;
    this.score += gained;
    this.lines += clearedCount;
    this.level = Math.floor(this.lines / 10) + 1;

    return {
      cleared: clearedCount,
      spin: spin,
      label: label,
      backToBack: backToBack,
      combo: this.combo,
      perfectClear: perfectClear,
      gained: gained
    };
  };

  Tetris.prototype.isBoardEmpty = function () {
    for (var y = 0; y < this.grid.length; y++) {
      for (var x = 0; x < this.cols; x++) {
        if (this.grid[y][x] !== null) return false;
      }
    }
    return true;
  };

  Tetris.prototype.gravityInterval = function () {
    var index = Math.min(this.level - 1, GRAVITY_MS.length - 1);
    return GRAVITY_MS[Math.max(0, index)];
  };

  /** Ein Schwerkraft-Tick: faellt das Teil nicht mehr, wird es verankert. */
  Tetris.prototype.tick = function () {
    if (this.gameOver || this.paused || !this.piece) return null;
    if (this.softDropStep()) return null;
    return this.lock();
  };

  Tetris.prototype.togglePause = function () {
    if (this.gameOver) return false;
    this.paused = !this.paused;
    return this.paused;
  };

  Tetris.prototype.colorOf = function (type) {
    return COLORS[type] || '#7d879c';
  };

  return {
    Tetris: Tetris,
    SHAPES: SHAPES,
    TYPES: TYPES,
    COLORS: COLORS,
    COLS: COLS,
    ROWS: ROWS,
    HIDDEN_ROWS: HIDDEN_ROWS,
    createRandom: createRandom
  };
});
