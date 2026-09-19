/**
 * Spielschleife, Tastatur-/Touch-Steuerung und Anbindung der Oberflaeche.
 */
(function (root, document) {
  'use strict';

  var E = root.TetrisEngine;

  // Auto-Repeat beim Halten der Pfeiltasten (Werte in Millisekunden).
  var DAS_MS = 160; // Verzoegerung bis zur Wiederholung
  var ARR_MS = 40;  // Abstand der Wiederholungen
  var SOFT_DROP_MS = 45;
  var LOCK_DELAY_MS = 500;
  var MAX_LOCK_RESETS = 15;

  var game = new E.Tetris();
  var renderer = null;
  var running = false;
  var lastTime = 0;
  var dropAccumulator = 0;

  var lockTimer = 0;
  var lockResets = 0;
  var grounded = false;

  var dasTimer = 0;
  var arrTimer = 0;
  var dasDirection = 0;
  var softDropTimer = 0;
  var softDropHeld = false;

  var elements = {};
  var bestScore = 0;

  function $(id) { return document.getElementById(id); }

  function loadBestScore() {
    try {
      var stored = root.localStorage.getItem('tetris.bestScore');
      bestScore = stored ? parseInt(stored, 10) || 0 : 0;
    } catch (err) {
      bestScore = 0; // Privates Fenster o. Ae. - dann eben ohne Bestenwert.
    }
  }

  function saveBestScore() {
    if (game.score <= bestScore) return;
    bestScore = game.score;
    try {
      root.localStorage.setItem('tetris.bestScore', String(bestScore));
    } catch (err) { /* nicht kritisch */ }
  }

  function showMessage(text, sub) {
    elements.overlayTitle.textContent = text;
    elements.overlayText.textContent = sub || '';
    elements.overlay.classList.remove('hidden');
  }

  function hideMessage() {
    elements.overlay.classList.add('hidden');
  }

  function flashEvent(result) {
    if (!result) return;
    var parts = [];
    if (result.label) parts.push(result.label);
    if (result.backToBack) parts.push('Back-to-Back');
    if (result.combo > 0) parts.push('Combo x' + result.combo);
    if (result.perfectClear) parts.push('Perfect Clear');
    if (parts.length === 0) return;

    elements.event.textContent = parts.join(' · ');
    elements.event.classList.remove('pulse');
    void elements.event.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
    elements.event.classList.add('pulse');
  }

  function updateHud() {
    elements.score.textContent = game.score.toLocaleString('de-DE');
    elements.lines.textContent = game.lines;
    elements.level.textContent = game.level;
    elements.best.textContent = Math.max(bestScore, game.score).toLocaleString('de-DE');
  }

  function resetLockState() {
    lockTimer = 0;
    lockResets = 0;
    grounded = false;
  }

  function handleLockResult(result) {
    if (!result) return;
    renderer.markClear(result.rows);
    flashEvent(result);
    resetLockState();
    dropAccumulator = 0;
    updateHud();
    if (game.gameOver) endGame();
  }

  function endGame() {
    running = false;
    saveBestScore();
    updateHud();
    showMessage('Game Over', 'Punkte: ' + game.score.toLocaleString('de-DE') + ' — Enter für eine neue Partie');
  }

  /**
   * Lock-Delay: Ein aufliegendes Teil bekommt etwas Zeit, bevor es fixiert wird.
   * Jede Bewegung setzt den Timer zurueck - begrenzt auf MAX_LOCK_RESETS.
   */
  function updateLockDelay(delta) {
    var resting = game.collides(game.piece, 0, 1);
    if (!resting) {
      grounded = false;
      lockTimer = 0;
      return;
    }
    if (!grounded) {
      grounded = true;
      lockTimer = 0;
    }
    lockTimer += delta;
    if (lockTimer >= LOCK_DELAY_MS) handleLockResult(game.lock());
  }

  function noteMovement() {
    if (!grounded) return;
    if (lockResets < MAX_LOCK_RESETS) {
      lockResets++;
      lockTimer = 0;
    }
  }

  function loop(time) {
    if (!running) return;
    var delta = time - lastTime;
    lastTime = time;
    if (delta > 250) delta = 250; // Nach Tab-Wechsel nicht mehrere Ticks nachholen

    if (!game.paused && !game.gameOver) {
      if (dasDirection !== 0) {
        dasTimer += delta;
        if (dasTimer >= DAS_MS) {
          arrTimer += delta;
          while (arrTimer >= ARR_MS) {
            arrTimer -= ARR_MS;
            if (game.move(dasDirection)) noteMovement();
          }
        }
      }

      if (softDropHeld) {
        softDropTimer += delta;
        while (softDropTimer >= SOFT_DROP_MS) {
          softDropTimer -= SOFT_DROP_MS;
          if (game.softDrop()) { noteMovement(); dropAccumulator = 0; }
        }
        updateHud();
      }

      dropAccumulator += delta;
      var interval = game.gravityInterval();
      while (dropAccumulator >= interval && !game.gameOver) {
        dropAccumulator -= interval;
        if (!game.softDropStep()) break; // Aufliegend: der Lock-Delay uebernimmt
      }

      if (game.piece) updateLockDelay(delta);
    }

    renderer.draw(game);
    renderer.drawNext(game);
    renderer.drawHold(game);
    root.requestAnimationFrame(loop);
  }

  function start() {
    running = true;
    lastTime = root.performance.now();
    dropAccumulator = 0;
    resetLockState();
    root.requestAnimationFrame(loop);
  }

  function newGame() {
    game.reset();
    hideMessage();
    elements.event.textContent = '';
    resetLockState();
    dasDirection = 0;
    softDropHeld = false;
    updateHud();
    if (!running) start();
  }

  function togglePause() {
    if (game.gameOver) return;
    if (game.togglePause()) {
      showMessage('Pause', 'P oder Esc zum Weiterspielen');
    } else {
      hideMessage();
      lastTime = root.performance.now();
    }
  }

  var ACTIONS = {
    left: function () { if (game.move(-1)) noteMovement(); },
    right: function () { if (game.move(1)) noteMovement(); },
    rotateCW: function () { if (game.rotate(1)) noteMovement(); },
    rotateCCW: function () { if (game.rotate(-1)) noteMovement(); },
    rotate180: function () { if (game.rotate(2)) noteMovement(); },
    softDrop: function () { if (game.softDrop()) { noteMovement(); updateHud(); } },
    hardDrop: function () { handleLockResult(game.hardDrop()); },
    hold: function () { if (game.holdPiece()) { resetLockState(); dropAccumulator = 0; } }
  };

  var KEY_MAP = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowDown: 'softDrop',
    ArrowUp: 'rotateCW',
    KeyX: 'rotateCW',
    KeyZ: 'rotateCCW',
    ControlLeft: 'rotateCCW',
    KeyA: 'rotate180',
    Space: 'hardDrop',
    KeyC: 'hold',
    ShiftLeft: 'hold'
  };

  function onKeyDown(event) {
    if (event.code === 'Enter') {
      event.preventDefault();
      newGame();
      return;
    }
    if (event.code === 'KeyP' || event.code === 'Escape') {
      event.preventDefault();
      togglePause();
      return;
    }
    if (game.gameOver || game.paused) return;

    var action = KEY_MAP[event.code];
    if (!action) return;
    event.preventDefault();

    if (action === 'left' || action === 'right') {
      if (event.repeat) return; // Wiederholung macht DAS/ARR selbst
      var dir = action === 'left' ? -1 : 1;
      dasDirection = dir;
      dasTimer = 0;
      arrTimer = 0;
      ACTIONS[action]();
      return;
    }

    if (action === 'softDrop') {
      if (event.repeat) return;
      softDropHeld = true;
      softDropTimer = 0;
      ACTIONS.softDrop();
      return;
    }

    if (event.repeat && action !== 'hardDrop') return;
    if (event.repeat) return;
    ACTIONS[action]();
  }

  function onKeyUp(event) {
    var action = KEY_MAP[event.code];
    if (action === 'left' && dasDirection === -1) dasDirection = 0;
    if (action === 'right' && dasDirection === 1) dasDirection = 0;
    if (action === 'softDrop') softDropHeld = false;
  }

  /** Touch-Gesten: Wischen bewegt, Tippen dreht, Wischen nach unten wirft ab. */
  function bindTouch(canvas) {
    var startX = 0, startY = 0, startTime = 0, movedCells = 0, handled = false;

    canvas.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
      movedCells = 0;
      handled = false;
    }, { passive: true });

    canvas.addEventListener('touchmove', function (e) {
      if (game.paused || game.gameOver) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      var threshold = Math.max(22, renderer.cell);

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) >= threshold) {
        var steps = Math.trunc(dx / threshold);
        var delta = steps - movedCells;
        for (var i = 0; i < Math.abs(delta); i++) {
          if (game.move(delta > 0 ? 1 : -1)) noteMovement();
        }
        movedCells = steps;
        handled = true;
        e.preventDefault();
      } else if (dy >= threshold * 2.5 && !handled) {
        ACTIONS.hardDrop();
        handled = true;
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      if (handled || game.gameOver || game.paused) return;
      var t = e.changedTouches[0];
      var dx = Math.abs(t.clientX - startX);
      var dy = Math.abs(t.clientY - startY);
      if (dx < 12 && dy < 12 && Date.now() - startTime < 300) ACTIONS.rotateCW();
    }, { passive: true });
  }

  function bindButtons() {
    var map = {
      'btn-left': 'left',
      'btn-right': 'right',
      'btn-down': 'softDrop',
      'btn-rotate': 'rotateCW',
      'btn-drop': 'hardDrop',
      'btn-hold': 'hold'
    };
    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        if (!game.gameOver && !game.paused) ACTIONS[map[id]]();
      });
    });

    $('btn-new').addEventListener('click', newGame);
    $('btn-pause').addEventListener('click', togglePause);
  }

  function init() {
    elements = {
      overlay: $('overlay'),
      overlayTitle: $('overlay-title'),
      overlayText: $('overlay-text'),
      score: $('score'),
      lines: $('lines'),
      level: $('level'),
      best: $('best'),
      event: $('event')
    };

    renderer = new root.TetrisRenderer($('board'), $('next'), $('hold'));
    // Breite der Spielfeld-Spalte vor dem ersten Zeichnen ermitteln.
    renderer.maxBoardWidth = document.querySelector('.board-col').clientWidth;
    renderer.resize(game);

    loadBestScore();
    updateHud();
    bindButtons();
    bindTouch($('board'));

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    root.addEventListener('resize', function () {
      renderer.maxBoardWidth = document.querySelector('.board-col').clientWidth;
      renderer.resize(game);
    });
    root.addEventListener('blur', function () {
      dasDirection = 0;
      softDropHeld = false;
      if (running && !game.paused && !game.gameOver) togglePause();
    });

    // Debug-Zugriff: erlaubt Konsolen-Experimente und automatisierte Tests.
    root.Tetris = { game: game, renderer: renderer, newGame: newGame };

    showMessage('Tetris', 'Enter oder „Neues Spiel" zum Starten');
    renderer.draw(game);
    renderer.drawNext(game);
    renderer.drawHold(game);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, document);
