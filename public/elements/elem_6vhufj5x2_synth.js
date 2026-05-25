// Tiny Pong canvas element. Intentionally silent: no Web Audio nodes are created.
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const W = 260;
  const H = 200;
  const PADDLE_W = 6;
  const PADDLE_H = 42;
  const BALL = 5;
  const WIN_SCORE = 7;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function validNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function makeBall(direction = 1, seed = Math.random()) {
    const angle = ((seed % 1) - 0.5) * 0.8;
    const speed = 112;
    return {
      x: W / 2,
      y: H / 2,
      vx: Math.cos(angle) * speed * direction,
      vy: Math.sin(angle) * speed
    };
  }

  function normalizeState(saved = {}) {
    saved = saved && typeof saved === 'object' ? saved : {};
    const leftScore = validNumber(saved.leftScore, 0);
    const rightScore = validNumber(saved.rightScore, 0);
    const ball = saved.ball && typeof saved.ball === 'object' ? saved.ball : makeBall(1, 0.23);
    return {
      version: 2,
      paused: saved.paused !== undefined ? !!saved.paused : false,
      leftScore: clamp(Math.round(leftScore), 0, 99),
      rightScore: clamp(Math.round(rightScore), 0, 99),
      leftPaddleY: clamp(validNumber(saved.leftPaddleY, H / 2 - PADDLE_H / 2), 30, H - PADDLE_H - 8),
      rightPaddleY: clamp(validNumber(saved.rightPaddleY, H / 2 - PADDLE_H / 2), 30, H - PADDLE_H - 8),
      ball: {
        x: clamp(validNumber(ball.x, W / 2), BALL, W - BALL),
        y: clamp(validNumber(ball.y, H / 2), 28 + BALL, H - BALL),
        vx: clamp(validNumber(ball.vx, 112), -210, 210) || 112,
        vy: clamp(validNumber(ball.vy, 12), -190, 190)
      },
      winner: saved.winner === 'PLAYER' || saved.winner === 'CPU' ? saved.winner : '',
      lastResetToken: saved.lastResetToken || '',
      lastControlToken: saved.lastControlToken || ''
    };
  }

  let state = normalizeState(prevState);
  let lastTime = 0;
  let destroyed = false;
  let pointerActive = false;
  let lastPaddlePublish = 0;

  dom.innerHTML = `
    <style>
      :host {
        display: block;
        width: 260px;
        height: 200px;
      }
      .pong-shell {
        position: relative;
        width: 260px;
        height: 200px;
        overflow: hidden;
        border-radius: 8px;
        background: #071018;
        box-shadow:
          inset 0 0 0 1px rgba(255,255,255,0.18),
          0 8px 24px rgba(0,0,0,0.35);
        user-select: none;
        touch-action: none;
      }
      canvas {
        display: block;
        width: 260px;
        height: 200px;
        cursor: crosshair;
      }
    </style>
    <div class="pong-shell" aria-label="Tiny Pong game">
      <canvas width="260" height="200" role="img" aria-label="Tiny Pong"></canvas>
    </div>
  `;

  const canvas = dom.querySelector('canvas');
  const g = canvas.getContext('2d');
  const rects = {
    pause: { x: 178, y: 9, w: 32, h: 16 },
    reset: { x: 215, y: 9, w: 36, h: 16 }
  };

  function publishControl(type, extra = {}) {
    const token = `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    ctx.bus.pubGlobal('pong_control', { type, token, ...extra });
  }

  function resetRound(direction = Math.random() > 0.5 ? 1 : -1, seed = Math.random(), clearScore = false) {
    if (clearScore) {
      state.leftScore = 0;
      state.rightScore = 0;
      state.winner = '';
    }
    state.ball = makeBall(direction, seed);
    state.leftPaddleY = H / 2 - PADDLE_H / 2;
    state.rightPaddleY = H / 2 - PADDLE_H / 2;
  }

  function togglePause(nextPaused) {
    state.paused = typeof nextPaused === 'boolean' ? nextPaused : !state.paused;
  }

  function pointScored(side) {
    if (side === 'PLAYER') state.leftScore += 1;
    else state.rightScore += 1;

    if (state.leftScore >= WIN_SCORE || state.rightScore >= WIN_SCORE) {
      state.winner = state.leftScore > state.rightScore ? 'PLAYER' : 'CPU';
      state.paused = true;
      state.ball = makeBall(state.winner === 'PLAYER' ? -1 : 1, Math.random());
      return;
    }

    resetRound(side === 'PLAYER' ? -1 : 1, Math.random(), false);
  }

  function setPaddleFromCanvasY(canvasY, shouldPublish) {
    const nextY = clamp(canvasY - PADDLE_H / 2, 30, H - PADDLE_H - 8);
    state.leftPaddleY = nextY;

    if (shouldPublish) {
      const now = performance.now();
      if (now - lastPaddlePublish > 66) {
        lastPaddlePublish = now;
        ctx.bus.pubGlobal('pong_paddle', { y: nextY, at: Date.now() });
      }
    }
  }

  function canvasPoint(event) {
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * (W / box.width),
      y: (event.clientY - box.top) * (H / box.height)
    };
  }

  function inRect(point, rect) {
    return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
  }

  function onPointerDown(event) {
    canvas.focus({ preventScroll: true });
    const point = canvasPoint(event);
    if (inRect(point, rects.pause)) {
      if (state.winner) {
        publishControl('reset', { seed: Math.random(), direction: Math.random() > 0.5 ? 1 : -1 });
      } else {
        publishControl('pause', { paused: !state.paused });
      }
      return;
    }
    if (inRect(point, rects.reset)) {
      publishControl('reset', { seed: Math.random(), direction: Math.random() > 0.5 ? 1 : -1 });
      return;
    }
    pointerActive = true;
    canvas.setPointerCapture?.(event.pointerId);
    setPaddleFromCanvasY(point.y, true);
  }

  function onPointerMove(event) {
    if (!pointerActive) return;
    setPaddleFromCanvasY(canvasPoint(event).y, true);
  }

  function onPointerUp(event) {
    pointerActive = false;
    canvas.releasePointerCapture?.(event.pointerId);
  }

  function onKeyDown(event) {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (state.winner) {
        publishControl('reset', { seed: Math.random(), direction: Math.random() > 0.5 ? 1 : -1 });
      } else {
        publishControl('pause', { paused: !state.paused });
      }
    } else if (event.key.toLowerCase() === 'r') {
      publishControl('reset', { seed: Math.random(), direction: Math.random() > 0.5 ? 1 : -1 });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPaddleFromCanvasY(state.leftPaddleY + PADDLE_H / 2 - 14, true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPaddleFromCanvasY(state.leftPaddleY + PADDLE_H / 2 + 14, true);
    }
  }

  function updateGame(dt) {
    if (state.paused || state.winner) return;

    const target = clamp(state.ball.y - PADDLE_H / 2, 30, H - PADDLE_H - 8);
    const aiSpeed = 82 * dt;
    state.rightPaddleY += clamp(target - state.rightPaddleY, -aiSpeed, aiSpeed);

    const ball = state.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.y <= 28 + BALL) {
      ball.y = 28 + BALL;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y >= H - BALL) {
      ball.y = H - BALL;
      ball.vy = -Math.abs(ball.vy);
    }

    const leftX = 17;
    const rightX = W - 23;
    const leftHit = ball.vx < 0 &&
      ball.x - BALL <= leftX + PADDLE_W &&
      ball.x + BALL >= leftX &&
      ball.y >= state.leftPaddleY &&
      ball.y <= state.leftPaddleY + PADDLE_H;
    const rightHit = ball.vx > 0 &&
      ball.x + BALL >= rightX &&
      ball.x - BALL <= rightX + PADDLE_W &&
      ball.y >= state.rightPaddleY &&
      ball.y <= state.rightPaddleY + PADDLE_H;

    if (leftHit || rightHit) {
      const paddleY = leftHit ? state.leftPaddleY : state.rightPaddleY;
      const side = leftHit ? 1 : -1;
      const impact = ((ball.y - (paddleY + PADDLE_H / 2)) / (PADDLE_H / 2));
      ball.x = leftHit ? leftX + PADDLE_W + BALL : rightX - BALL;
      ball.vx = side * Math.min(196, Math.abs(ball.vx) * 1.045 + 4);
      ball.vy = clamp(impact * 130, -155, 155);
    }

    if (ball.x < -BALL) pointScored('CPU');
    if (ball.x > W + BALL) pointScored('PLAYER');
  }

  function drawButton(rect, label, active) {
    g.save();
    g.fillStyle = active ? '#ffcf54' : 'rgba(255,255,255,0.1)';
    g.strokeStyle = active ? '#ffe7a3' : 'rgba(255,255,255,0.28)';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
    g.fill();
    g.stroke();
    g.fillStyle = active ? '#14202c' : '#e8f6ff';
    g.font = 'bold 8px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5);
    g.restore();
  }

  function draw() {
    g.clearRect(0, 0, W, H);

    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#08151d');
    bg.addColorStop(0.52, '#123340');
    bg.addColorStop(1, '#071018');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    g.fillStyle = 'rgba(255,255,255,0.055)';
    for (let y = 32; y < H; y += 12) {
      g.fillRect(W / 2 - 1, y, 2, 7);
    }

    g.fillStyle = 'rgba(6, 14, 20, 0.9)';
    g.fillRect(0, 0, W, 30);
    g.fillStyle = '#5eead4';
    g.font = 'bold 9px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('TINY PONG', 10, 17);

    g.font = 'bold 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    g.textAlign = 'center';
    g.fillStyle = '#f9fbff';
    g.fillText(String(state.leftScore), W / 2 - 24, 18);
    g.fillStyle = '#ff7a90';
    g.fillText(String(state.rightScore), W / 2 + 24, 18);

    drawButton(rects.pause, state.paused ? 'PLAY' : 'PAUSE', state.paused);
    drawButton(rects.reset, 'RESET', false);

    g.shadowBlur = 10;
    g.shadowColor = '#5eead4';
    g.fillStyle = '#5eead4';
    g.fillRect(17, state.leftPaddleY, PADDLE_W, PADDLE_H);

    g.shadowColor = '#ff7a90';
    g.fillStyle = '#ff7a90';
    g.fillRect(W - 23, state.rightPaddleY, PADDLE_W, PADDLE_H);

    g.shadowColor = '#fff3a6';
    g.fillStyle = '#fff3a6';
    g.beginPath();
    g.arc(state.ball.x, state.ball.y, BALL, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;

    g.strokeStyle = 'rgba(94,234,212,0.24)';
    g.lineWidth = 1;
    g.strokeRect(7.5, 29.5, W - 15, H - 37);

    if (state.paused || state.winner) {
      g.fillStyle = 'rgba(4, 10, 15, 0.58)';
      g.fillRect(8, 58, W - 16, 72);
      g.fillStyle = state.winner ? '#ffcf54' : '#e8f6ff';
      g.font = 'bold 17px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(state.winner ? `${state.winner} WINS` : 'PAUSED', W / 2, 83);
      g.fillStyle = '#9fb4c4';
      g.font = '10px system-ui, sans-serif';
      g.fillText('Drag to move. Tap PLAY or RESET.', W / 2, 106);
    }
  }

  const unsubControl = ctx.bus.subGlobal('pong_control', (msg) => {
    if (!msg || msg.token === state.lastControlToken) return;
    state.lastControlToken = msg.token;
    if (msg.type === 'pause') {
      togglePause(msg.paused);
      if (!state.paused) state.winner = '';
    }
    if (msg.type === 'reset') {
      state.lastResetToken = msg.token;
      state.paused = false;
      resetRound(msg.direction || 1, msg.seed || Math.random(), true);
    }
    draw();
  });

  const unsubPaddle = ctx.bus.subGlobal('pong_paddle', (msg) => {
    if (!msg || !Number.isFinite(msg.y)) return;
    state.leftPaddleY = clamp(msg.y, 30, H - PADDLE_H - 8);
  });

  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('keydown', onKeyDown);

  draw();

  return {
    update() {
      if (destroyed) return;
      const now = performance.now();
      const dt = lastTime ? Math.min(0.033, (now - lastTime) / 1000) : 0;
      lastTime = now;
      updateGame(dt);
      draw();
    },
    getState() {
      return {
        version: state.version,
        paused: state.paused,
        leftScore: state.leftScore,
        rightScore: state.rightScore,
        leftPaddleY: state.leftPaddleY,
        rightPaddleY: state.rightPaddleY,
        ball: { ...state.ball },
        winner: state.winner,
        lastResetToken: state.lastResetToken,
        lastControlToken: state.lastControlToken
      };
    },
    destroy() {
      destroyed = true;
      unsubControl();
      unsubPaddle();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('keydown', onKeyDown);
      dom.innerHTML = '';
    }
  };
}
