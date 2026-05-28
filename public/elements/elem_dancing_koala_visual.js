const STATE_VERSION = 'dancing-koala-visual-v1';

export default function setup(ctx, prevState) {
  const state = {
    stateVersion: STATE_VERSION,
    speed: Number.isFinite(prevState?.speed) ? prevState.speed : 1.05,
    energy: Number.isFinite(prevState?.energy) ? prevState.energy : 0.82,
    camera: Number.isFinite(prevState?.camera) ? prevState.camera : 0.68
  };

  let raf = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let scene = 0;
  let lastCut = 0;
  let flash = 0;
  let destroyed = false;

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .koala-video {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 190px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid rgba(167, 139, 250, 0.58);
        background: #030408;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .scan {
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.38;
        mix-blend-mode: overlay;
        background:
          repeating-linear-gradient(0deg, rgba(255,255,255,0.11) 0 1px, transparent 1px 4px),
          radial-gradient(circle at 50% 50%, transparent 0 58%, rgba(0,0,0,0.42) 100%);
      }
    </style>
    <div class="koala-video">
      <canvas id="canvas" aria-label="Dancing koala video loop"></canvas>
      <div class="scan"></div>
    </div>
  `;

  const host = ctx.domRoot.querySelector('.koala-video');
  const canvas = ctx.domRoot.querySelector('#canvas');
  const c = canvas.getContext('2d', { alpha: false });

  const resize = () => {
    const rect = host.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(host);
  resize();

  const ellipse = (x, y, rx, ry, fill, stroke = null, lineWidth = 1) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.stroke();
    }
  };

  const roundRect = (x, y, w, h, r, fill) => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.fillStyle = fill;
    c.fill();
  };

  const drawScene = (t, beat) => {
    const gradient = c.createLinearGradient(0, 0, width, height);
    if (scene === 0) {
      gradient.addColorStop(0, '#080716');
      gradient.addColorStop(0.48, '#161236');
      gradient.addColorStop(1, '#0b201a');
    } else if (scene === 1) {
      gradient.addColorStop(0, '#10040d');
      gradient.addColorStop(0.5, '#29110a');
      gradient.addColorStop(1, '#071923');
    } else {
      gradient.addColorStop(0, '#06100c');
      gradient.addColorStop(0.54, '#17240f');
      gradient.addColorStop(1, '#08080d');
    }
    c.fillStyle = gradient;
    c.fillRect(0, 0, width, height);

    const floorY = height * 0.79;
    c.fillStyle = 'rgba(0, 0, 0, 0.32)';
    c.fillRect(0, floorY, width, height - floorY);

    for (let i = 0; i < 10; i += 1) {
      const x = ((i / 9) * width + Math.sin(t * 0.001 + i) * 14) % width;
      const hue = (i * 41 + scene * 70 + beat * 28) % 360;
      c.strokeStyle = `hsla(${hue}, 92%, 64%, ${0.12 + beat * 0.2})`;
      c.lineWidth = 2 + beat * 4;
      c.beginPath();
      c.moveTo(width * 0.5, 0);
      c.lineTo(x, floorY);
      c.stroke();
    }

    for (let i = 0; i < 7; i += 1) {
      const x = (i + 0.5) * width / 7;
      const h = 18 + Math.sin(t * 0.006 + i) * 10 + beat * 28;
      c.fillStyle = `hsla(${180 + i * 24}, 80%, 58%, 0.24)`;
      c.fillRect(x - 12, floorY - h, 24, h);
    }
  };

  const drawKoala = (t, alpha = 1, offset = 0) => {
    const unit = Math.min(width, height) / 5.2;
    const beatPhase = t * 0.008 * state.speed + offset;
    const bounce = Math.sin(beatPhase * 2) * unit * 0.12 * state.energy;
    const sway = Math.sin(beatPhase) * unit * 0.28 * state.energy;
    const twist = Math.sin(beatPhase * 1.5) * 0.16 * state.energy;
    const cx = width * 0.5 + sway;
    const cy = height * 0.62 + bounce;

    c.save();
    c.globalAlpha = alpha;
    c.translate(cx, cy);
    c.rotate(twist);

    c.strokeLinecap = 'round';
    c.lineWidth = unit * 0.16;
    c.strokeStyle = '#8f98a3';

    const armSwing = Math.sin(beatPhase * 2.1) * unit * 0.48;
    const legSwing = Math.sin(beatPhase * 2.1 + Math.PI) * unit * 0.34;

    c.beginPath();
    c.moveTo(-unit * 0.55, -unit * 0.1);
    c.quadraticCurveTo(-unit * 1.08, -unit * 0.44 - armSwing * 0.2, -unit * 1.2, -unit * 0.9 + armSwing);
    c.stroke();
    c.beginPath();
    c.moveTo(unit * 0.55, -unit * 0.08);
    c.quadraticCurveTo(unit * 1.04, -unit * 0.36 + armSwing * 0.2, unit * 1.16, -unit * 0.88 - armSwing);
    c.stroke();

    c.lineWidth = unit * 0.18;
    c.beginPath();
    c.moveTo(-unit * 0.34, unit * 0.58);
    c.quadraticCurveTo(-unit * 0.58, unit * 1.04, -unit * 0.82 + legSwing, unit * 1.23);
    c.stroke();
    c.beginPath();
    c.moveTo(unit * 0.34, unit * 0.58);
    c.quadraticCurveTo(unit * 0.58, unit * 1.02, unit * 0.82 - legSwing, unit * 1.23);
    c.stroke();

    ellipse(0, unit * 0.2, unit * 0.78, unit * 0.92, '#9aa3ad', '#d7dde2', 2);
    ellipse(0, unit * 0.38, unit * 0.48, unit * 0.55, '#d6d8d7');

    ellipse(-unit * 0.52, -unit * 0.95, unit * 0.36, unit * 0.38, '#8d969f');
    ellipse(unit * 0.52, -unit * 0.95, unit * 0.36, unit * 0.38, '#8d969f');
    ellipse(-unit * 0.52, -unit * 0.95, unit * 0.2, unit * 0.22, '#d7d0d0');
    ellipse(unit * 0.52, -unit * 0.95, unit * 0.2, unit * 0.22, '#d7d0d0');
    ellipse(0, -unit * 0.72, unit * 0.68, unit * 0.62, '#aab1b8', '#e0e4e7', 2);
    ellipse(-unit * 0.2, -unit * 0.82, unit * 0.07, unit * 0.09, '#050505');
    ellipse(unit * 0.2, -unit * 0.82, unit * 0.07, unit * 0.09, '#050505');
    ellipse(0, -unit * 0.62, unit * 0.14, unit * 0.1, '#1d1d20');

    c.strokeStyle = '#1d1d20';
    c.lineWidth = unit * 0.035;
    c.beginPath();
    c.moveTo(-unit * 0.12, -unit * 0.48);
    c.quadraticCurveTo(0, -unit * 0.4 + Math.sin(beatPhase * 4) * unit * 0.03, unit * 0.12, -unit * 0.48);
    c.stroke();

    c.fillStyle = `hsla(${(t * 0.08 + scene * 80) % 360}, 90%, 62%, 0.88)`;
    roundRect(-unit * 0.4, -unit * 0.04, unit * 0.8, unit * 0.18, unit * 0.08, c.fillStyle);

    c.restore();
  };

  const drawNoise = (t) => {
    const lines = 15 + Math.floor(state.camera * 18);
    for (let i = 0; i < lines; i += 1) {
      const y = Math.random() * height;
      const h = 1 + Math.random() * 3;
      const x = (Math.random() - 0.5) * width * 0.08 * state.camera;
      c.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.08})`;
      c.fillRect(x, y, width, h);
    }

    if (flash > 0.02) {
      c.fillStyle = `rgba(255,255,255,${flash * 0.18})`;
      c.fillRect(0, 0, width, height);
    }

    c.fillStyle = 'rgba(255,255,255,0.62)';
    c.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.fillText(`KOALA//${String(Math.floor(t / 42) % 10000).padStart(4, '0')}`, width - 104, height - 10);
  };

  const draw = (time) => {
    if (destroyed) return;
    if (time - lastCut > 980 - state.energy * 280) {
      scene = (scene + 1 + Math.floor(Math.random() * 2)) % 3;
      lastCut = time;
      flash = 1;
    }

    const beat = (Math.sin(time * 0.008 * state.speed) + 1) * 0.5;
    const shakeX = (Math.random() - 0.5) * state.camera * 8 * flash;
    const shakeY = (Math.random() - 0.5) * state.camera * 6 * flash;

    c.save();
    c.translate(shakeX, shakeY);
    drawScene(time, beat);
    c.globalCompositeOperation = 'screen';
    drawKoala(time - 60, 0.18 + flash * 0.1, -0.42);
    c.globalCompositeOperation = 'source-over';
    drawKoala(time, 1, 0);
    c.globalCompositeOperation = 'lighter';
    drawKoala(time + 44, 0.16 * state.camera, 0.36);
    c.restore();

    drawNoise(time);
    flash *= 0.86;
    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      if (resizeObserver) resizeObserver.disconnect();
    }
  };
}
