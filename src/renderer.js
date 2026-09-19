/**
 * Zeichnet Spielfeld, Vorschau und Hold-Slot auf Canvas-Elementen.
 */
(function (root) {
  'use strict';

  var E = root.TetrisEngine;

  function Renderer(canvas, nextCanvas, holdCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nextCtx = nextCanvas.getContext('2d');
    this.holdCtx = holdCanvas.getContext('2d');
    this.nextCanvas = nextCanvas;
    this.holdCanvas = holdCanvas;
    this.cell = 30;
    this.flashRows = [];
    this.flashUntil = 0;
  }

  /**
   * Canvas an die Geraeteaufloesung anpassen, damit nichts unscharf wird.
   * Die Zellgroesse richtet sich nach Breite UND verfuegbarer Hoehe - sonst
   * ragt das 20 Reihen hohe Feld auf breiten Bildschirmen unten heraus.
   */
  Renderer.prototype.resize = function (game) {
    var dpr = root.devicePixelRatio || 1;
    var maxWidth = this.maxBoardWidth || 320;
    var maxHeight = (root.innerHeight || 800) * 0.74;

    this.cell = Math.max(10, Math.floor(Math.min(maxWidth / game.cols, maxHeight / game.rows)));
    var width = this.cell * game.cols;
    var height = this.cell * game.rows;

    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    [this.nextCanvas, this.holdCanvas].forEach(function (c) {
      var r = c.getBoundingClientRect();
      c.width = (r.width || c.width) * dpr;
      c.height = (r.height || c.height) * dpr;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
  };

  Renderer.prototype.markClear = function (rows) {
    if (!rows || rows.length === 0) return;
    this.flashRows = rows.slice();
    this.flashUntil = Date.now() + 140;
  };

  function shade(hex, amount) {
    var num = parseInt(hex.slice(1), 16);
    var r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
    var g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
    var b = Math.min(255, Math.max(0, (num & 255) + amount));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  Renderer.prototype.drawCell = function (ctx, x, y, size, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var px = x * size;
    var py = y * size;
    var inset = Math.max(1, Math.round(size * 0.06));

    ctx.fillStyle = color;
    ctx.fillRect(px + inset, py + inset, size - inset * 2, size - inset * 2);

    // Leichte Lichtkante oben, Schattenkante unten - gibt den Steinen Tiefe.
    ctx.fillStyle = shade(color, 45);
    ctx.fillRect(px + inset, py + inset, size - inset * 2, Math.max(2, size * 0.14));
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px + inset, py + size - inset - Math.max(2, size * 0.12), size - inset * 2, Math.max(2, size * 0.12));
    ctx.globalAlpha = 1;
  };

  Renderer.prototype.drawGrid = function (game) {
    var ctx = this.ctx;
    var size = this.cell;
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, size * game.cols, size * game.rows);

    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (var x = 1; x < game.cols; x++) {
      ctx.beginPath();
      ctx.moveTo(x * size + 0.5, 0);
      ctx.lineTo(x * size + 0.5, size * game.rows);
      ctx.stroke();
    }
    for (var y = 1; y < game.rows; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * size + 0.5);
      ctx.lineTo(size * game.cols, y * size + 0.5);
      ctx.stroke();
    }
  };

  Renderer.prototype.draw = function (game) {
    var ctx = this.ctx;
    var size = this.cell;
    var offset = game.hiddenRows; // Grid-Zeile -> Bildschirmzeile
    this.drawGrid(game);

    for (var y = offset; y < game.grid.length; y++) {
      for (var x = 0; x < game.cols; x++) {
        var type = game.grid[y][x];
        if (type) this.drawCell(ctx, x, y - offset, size, game.colorOf(type));
      }
    }

    if (game.piece && !game.gameOver) {
      var ghostY = game.ghostY();
      var ghostCells = game.cellsOf(game.piece, 0, ghostY - game.piece.y);
      for (var g = 0; g < ghostCells.length; g++) {
        var gy = ghostCells[g][1] - offset;
        if (gy >= 0) this.drawCell(ctx, ghostCells[g][0], gy, size, game.colorOf(game.piece.type), 0.22);
      }

      var cells = game.cellsOf(game.piece);
      for (var i = 0; i < cells.length; i++) {
        var cy = cells[i][1] - offset;
        if (cy >= 0) this.drawCell(ctx, cells[i][0], cy, size, game.colorOf(game.piece.type));
      }
    }

    if (Date.now() < this.flashUntil) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (var f = 0; f < this.flashRows.length; f++) {
        var row = this.flashRows[f] - offset;
        if (row >= 0) ctx.fillRect(0, row * size, size * game.cols, size);
      }
    }
  };

  /** Zeichnet ein Tetromino mittig in ein kleines Vorschau-Canvas. */
  Renderer.prototype.drawPreviewPiece = function (ctx, type, size, centerX, centerY) {
    var shape = E.SHAPES[type][0];
    var minX = 4, maxX = -1, minY = 4, maxY = -1;
    for (var i = 0; i < shape.length; i++) {
      minX = Math.min(minX, shape[i][0]);
      maxX = Math.max(maxX, shape[i][0]);
      minY = Math.min(minY, shape[i][1]);
      maxY = Math.max(maxY, shape[i][1]);
    }
    var w = (maxX - minX + 1) * size;
    var h = (maxY - minY + 1) * size;
    var ox = centerX - w / 2 - minX * size;
    var oy = centerY - h / 2 - minY * size;

    ctx.save();
    ctx.translate(ox, oy);
    for (var j = 0; j < shape.length; j++) {
      this.drawCell(ctx, shape[j][0], shape[j][1], size, E.COLORS[type]);
    }
    ctx.restore();
  };

  Renderer.prototype.drawNext = function (game) {
    var ctx = this.nextCtx;
    var dpr = root.devicePixelRatio || 1;
    var w = this.nextCanvas.width / dpr;
    var h = this.nextCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    var count = Math.min(4, game.queue.length);
    var slot = h / count;
    var size = Math.min(slot * 0.42, w * 0.18);
    for (var i = 0; i < count; i++) {
      this.drawPreviewPiece(ctx, game.queue[i], size, w / 2, slot * i + slot / 2);
    }
  };

  Renderer.prototype.drawHold = function (game) {
    var ctx = this.holdCtx;
    var dpr = root.devicePixelRatio || 1;
    var w = this.holdCanvas.width / dpr;
    var h = this.holdCanvas.height / dpr;
    ctx.clearRect(0, 0, w, h);
    if (!game.hold) return;

    ctx.globalAlpha = game.holdUsed ? 0.35 : 1;
    this.drawPreviewPiece(ctx, game.hold, Math.min(h * 0.28, w * 0.18), w / 2, h / 2);
    ctx.globalAlpha = 1;
  };

  root.TetrisRenderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
