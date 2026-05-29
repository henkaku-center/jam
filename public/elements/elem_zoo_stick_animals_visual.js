const STATE_VERSION = 'zoo-stick-animals-v1';

export default function setup(ctx, prevState) {
  const state = {
    stateVersion: STATE_VERSION,
    cycleSteps: Number.isFinite(prevState?.cycleSteps) ? prevState.cycleSteps : 32,
    animalIndex: Number.isInteger(prevState?.animalIndex) ? prevState.animalIndex : 0,
    lastStep: Number.isFinite(prevState?.lastStep) ? prevState.lastStep : -1
  };

  const animals = [
    { name: 'elephant', color: '#9ca3af', accent: '#f9a8d4' },
    { name: 'giraffe', color: '#fbbf24', accent: '#92400e' },
    { name: 'lion', color: '#f59e0b', accent: '#78350f' },
    { name: 'monkey', color: '#a16207', accent: '#fde68a' },
    { name: 'zebra', color: '#f8fafc', accent: '#111827' },
    { name: 'penguin', color: '#1f2937', accent: '#f97316' }
  ];

  let canvas;
  let g;
  let destroyed = false;
  let pulse = 0;
  let lastSize = '';

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .wrap {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid rgba(34, 197, 94, 0.28);
        background:
          linear-gradient(180deg, #dff7ff 0%, #fef3c7 58%, #bbf7d0 100%);
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .badge {
        position: absolute;
        left: 10px;
        top: 10px;
        padding: 6px 8px;
        border-radius: 6px;
        color: #14532d;
        background: rgba(240, 253, 244, 0.78);
        border: 1px solid rgba(34, 197, 94, 0.22);
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        text-transform: capitalize;
      }
      .hint {
        position: absolute;
        right: 10px;
        bottom: 9px;
        color: rgba(20, 83, 45, 0.66);
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    </style>
    <div class="wrap">
      <canvas id="canvas"></canvas>
      <div class="badge" id="badge"></div>
      <div class="hint">stick zoo parade</div>
    </div>
  `;

  canvas = ctx.domRoot.querySelector('#canvas');
  g = canvas.getContext('2d');
  const badge = ctx.domRoot.querySelector('#badge');

  const clampIndex = (index) => ((index % animals.length) + animals.length) % animals.length;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(280, Math.floor(rect.width || 320));
    const height = Math.max(220, Math.floor(rect.height || 240));
    const key = `${width}x${height}@${dpr}`;
    if (key === lastSize) return;
    lastSize = key;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function line(points, width = 4, color = '#14532d') {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    points.forEach(([x, y], i) => {
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }

  function circle(x, y, radius, stroke = '#14532d', fill = null, width = 4) {
    g.beginPath();
    g.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.stroke();
  }

  function oval(x, y, rx, ry, stroke = '#14532d', fill = null, width = 4) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.stroke();
  }

  function eye(x, y) {
    circle(x, y, 2.5, '#111827', '#111827', 1);
  }

  function smile(x, y, size = 8) {
    g.strokeStyle = '#111827';
    g.lineWidth = 2;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(x, y, size, 0.14 * Math.PI, 0.86 * Math.PI);
    g.stroke();
  }

  function drawGround(w, h, t) {
    g.fillStyle = '#86efac';
    g.beginPath();
    g.moveTo(0, h * 0.76);
    for (let x = 0; x <= w + 20; x += 24) {
      const y = h * 0.76 + Math.sin(x * 0.035 + t * 2) * 5;
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(20, 83, 45, 0.28)';
    g.lineWidth = 2;
    for (let x = 18; x < w; x += 34) {
      line([[x, h * 0.83], [x + 5, h * 0.8], [x + 10, h * 0.83]], 2, 'rgba(20, 83, 45, 0.35)');
    }

    g.fillStyle = 'rgba(255, 255, 255, 0.72)';
    oval(w * 0.72, h * 0.18, 36, 13, 'transparent', 'rgba(255,255,255,0.72)', 0);
    oval(w * 0.8, h * 0.16, 27, 11, 'transparent', 'rgba(255,255,255,0.64)', 0);
  }

  function drawElephant(cx, cy, scale, bounce) {
    const c = '#475569';
    oval(cx, cy, 66 * scale, 38 * scale, c, '#cbd5e1');
    circle(cx + 46 * scale, cy - 24 * scale, 31 * scale, c, '#cbd5e1');
    circle(cx + 30 * scale, cy - 28 * scale, 24 * scale, c, '#e2e8f0', 3 * scale);
    line([[cx + 67 * scale, cy - 14 * scale], [cx + 86 * scale, cy + 8 * scale], [cx + 72 * scale, cy + 23 * scale]], 10 * scale, c);
    line([[cx - 44 * scale, cy + 25 * scale], [cx - 48 * scale, cy + 54 * scale + bounce]], 6 * scale, c);
    line([[cx - 8 * scale, cy + 31 * scale], [cx - 6 * scale, cy + 58 * scale - bounce]], 6 * scale, c);
    line([[cx + 32 * scale, cy + 26 * scale], [cx + 34 * scale, cy + 54 * scale + bounce]], 6 * scale, c);
    line([[cx - 69 * scale, cy - 4 * scale], [cx - 83 * scale, cy - 18 * scale]], 4 * scale, c);
    eye(cx + 54 * scale, cy - 30 * scale);
    smile(cx + 57 * scale, cy - 18 * scale, 5 * scale);
  }

  function drawGiraffe(cx, cy, scale, bounce) {
    const c = '#92400e';
    oval(cx - 10 * scale, cy + 12 * scale, 58 * scale, 30 * scale, c, '#fde68a');
    line([[cx + 31 * scale, cy - 7 * scale], [cx + 45 * scale, cy - 80 * scale]], 13 * scale, '#fbbf24');
    circle(cx + 53 * scale, cy - 91 * scale, 24 * scale, c, '#fde68a');
    line([[cx + 43 * scale, cy - 112 * scale], [cx + 39 * scale, cy - 127 * scale]], 3 * scale, c);
    line([[cx + 60 * scale, cy - 112 * scale], [cx + 64 * scale, cy - 127 * scale]], 3 * scale, c);
    circle(cx + 39 * scale, cy - 128 * scale, 4 * scale, c, '#92400e', 2);
    circle(cx + 64 * scale, cy - 128 * scale, 4 * scale, c, '#92400e', 2);
    for (let i = 0; i < 8; i += 1) {
      const x = cx - 54 * scale + (i % 4) * 28 * scale;
      const y = cy + (i < 4 ? 4 : 24) * scale;
      circle(x, y, 5 * scale, 'transparent', '#b45309', 0);
    }
    line([[cx - 45 * scale, cy + 35 * scale], [cx - 53 * scale, cy + 76 * scale + bounce]], 5 * scale, c);
    line([[cx - 5 * scale, cy + 39 * scale], [cx - 8 * scale, cy + 78 * scale - bounce]], 5 * scale, c);
    line([[cx + 30 * scale, cy + 34 * scale], [cx + 34 * scale, cy + 76 * scale + bounce]], 5 * scale, c);
    line([[cx - 63 * scale, cy + 10 * scale], [cx - 82 * scale, cy + 26 * scale]], 3 * scale, c);
    eye(cx + 61 * scale, cy - 96 * scale);
    smile(cx + 59 * scale, cy - 84 * scale, 5 * scale);
  }

  function drawLion(cx, cy, scale, bounce) {
    const c = '#78350f';
    oval(cx - 8 * scale, cy + 18 * scale, 62 * scale, 30 * scale, c, '#fbbf24');
    circle(cx + 52 * scale, cy - 15 * scale, 34 * scale, c, '#92400e');
    circle(cx + 52 * scale, cy - 15 * scale, 23 * scale, c, '#fde68a');
    line([[cx - 47 * scale, cy + 39 * scale], [cx - 56 * scale, cy + 70 * scale + bounce]], 5 * scale, c);
    line([[cx - 5 * scale, cy + 43 * scale], [cx - 3 * scale, cy + 72 * scale - bounce]], 5 * scale, c);
    line([[cx + 32 * scale, cy + 36 * scale], [cx + 38 * scale, cy + 70 * scale + bounce]], 5 * scale, c);
    line([[cx - 70 * scale, cy + 13 * scale], [cx - 91 * scale, cy - 8 * scale], [cx - 83 * scale, cy - 20 * scale]], 4 * scale, c);
    circle(cx - 83 * scale, cy - 20 * scale, 7 * scale, c, '#92400e', 3);
    eye(cx + 43 * scale, cy - 21 * scale);
    eye(cx + 61 * scale, cy - 21 * scale);
    circle(cx + 52 * scale, cy - 11 * scale, 3 * scale, '#111827', '#111827', 1);
    smile(cx + 52 * scale, cy - 7 * scale, 7 * scale);
  }

  function drawMonkey(cx, cy, scale, bounce) {
    const c = '#713f12';
    oval(cx, cy + 15 * scale, 45 * scale, 55 * scale, c, '#a16207');
    circle(cx, cy - 44 * scale, 31 * scale, c, '#a16207');
    circle(cx - 27 * scale, cy - 47 * scale, 12 * scale, c, '#fde68a');
    circle(cx + 27 * scale, cy - 47 * scale, 12 * scale, c, '#fde68a');
    oval(cx, cy - 34 * scale, 20 * scale, 13 * scale, c, '#fde68a');
    line([[cx - 35 * scale, cy + 1 * scale], [cx - 74 * scale, cy - 25 * scale], [cx - 88 * scale, cy - 9 * scale]], 5 * scale, c);
    line([[cx + 35 * scale, cy + 1 * scale], [cx + 73 * scale, cy - 21 * scale], [cx + 86 * scale, cy - 6 * scale]], 5 * scale, c);
    line([[cx - 20 * scale, cy + 65 * scale], [cx - 29 * scale, cy + 90 * scale + bounce]], 5 * scale, c);
    line([[cx + 20 * scale, cy + 65 * scale], [cx + 31 * scale, cy + 90 * scale - bounce]], 5 * scale, c);
    g.strokeStyle = c;
    g.lineWidth = 4 * scale;
    g.beginPath();
    g.arc(cx + 50 * scale, cy + 26 * scale, 33 * scale, -0.4, 1.5 * Math.PI);
    g.stroke();
    eye(cx - 8 * scale, cy - 47 * scale);
    eye(cx + 8 * scale, cy - 47 * scale);
    smile(cx, cy - 34 * scale, 7 * scale);
  }

  function drawZebra(cx, cy, scale, bounce) {
    const c = '#111827';
    oval(cx - 8 * scale, cy + 10 * scale, 65 * scale, 31 * scale, c, '#f8fafc');
    line([[cx + 40 * scale, cy - 4 * scale], [cx + 55 * scale, cy - 52 * scale]], 10 * scale, '#f8fafc');
    circle(cx + 62 * scale, cy - 61 * scale, 22 * scale, c, '#f8fafc');
    for (let x = -55; x <= 35; x += 20) {
      line([[cx + x * scale, cy - 14 * scale], [cx + (x + 12) * scale, cy + 28 * scale]], 3 * scale, c);
    }
    line([[cx + 43 * scale, cy - 46 * scale], [cx + 62 * scale, cy - 25 * scale]], 3 * scale, c);
    line([[cx + 55 * scale, cy - 77 * scale], [cx + 46 * scale, cy - 94 * scale]], 3 * scale, c);
    line([[cx + 69 * scale, cy - 78 * scale], [cx + 77 * scale, cy - 95 * scale]], 3 * scale, c);
    line([[cx - 49 * scale, cy + 34 * scale], [cx - 56 * scale, cy + 70 * scale + bounce]], 5 * scale, c);
    line([[cx - 7 * scale, cy + 39 * scale], [cx - 6 * scale, cy + 73 * scale - bounce]], 5 * scale, c);
    line([[cx + 32 * scale, cy + 34 * scale], [cx + 39 * scale, cy + 70 * scale + bounce]], 5 * scale, c);
    line([[cx - 72 * scale, cy + 8 * scale], [cx - 91 * scale, cy + 23 * scale]], 3 * scale, c);
    eye(cx + 68 * scale, cy - 66 * scale);
    smile(cx + 68 * scale, cy - 57 * scale, 5 * scale);
  }

  function drawPenguin(cx, cy, scale, bounce) {
    const c = '#111827';
    oval(cx, cy + 5 * scale, 45 * scale, 66 * scale, c, '#1f2937');
    oval(cx, cy + 18 * scale, 28 * scale, 45 * scale, '#f8fafc', '#f8fafc', 2);
    circle(cx, cy - 47 * scale, 30 * scale, c, '#1f2937');
    line([[cx - 35 * scale, cy - 1 * scale], [cx - 64 * scale, cy + 24 * scale]], 5 * scale, c);
    line([[cx + 35 * scale, cy - 1 * scale], [cx + 64 * scale, cy + 24 * scale]], 5 * scale, c);
    line([[cx - 18 * scale, cy + 69 * scale], [cx - 33 * scale, cy + 82 * scale + bounce]], 5 * scale, '#f97316');
    line([[cx + 18 * scale, cy + 69 * scale], [cx + 33 * scale, cy + 82 * scale - bounce]], 5 * scale, '#f97316');
    g.fillStyle = '#f97316';
    g.beginPath();
    g.moveTo(cx, cy - 44 * scale);
    g.lineTo(cx + 18 * scale, cy - 35 * scale);
    g.lineTo(cx, cy - 28 * scale);
    g.closePath();
    g.fill();
    eye(cx - 9 * scale, cy - 52 * scale);
    eye(cx + 9 * scale, cy - 52 * scale);
    smile(cx, cy - 31 * scale, 5 * scale);
  }

  function render(frame = 0) {
    if (destroyed) return;
    resize();
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 240;
    const t = frame / 60;
    const animal = animals[clampIndex(state.animalIndex)];
    const fade = 0.84 + pulse * 0.16;
    const bounce = Math.sin(t * 6) * 4 * fade;
    const scale = Math.min(w / 330, h / 260) * (0.86 + pulse * 0.04);
    const cx = w * 0.5;
    const cy = h * 0.52;

    g.clearRect(0, 0, w, h);
    drawGround(w, h, t);

    g.save();
    g.translate(Math.sin(t * 1.8) * 3, Math.sin(t * 2.3) * 2);
    if (animal.name === 'elephant') drawElephant(cx, cy, scale, bounce);
    if (animal.name === 'giraffe') drawGiraffe(cx, cy + 18 * scale, scale, bounce);
    if (animal.name === 'lion') drawLion(cx, cy, scale, bounce);
    if (animal.name === 'monkey') drawMonkey(cx, cy, scale, bounce);
    if (animal.name === 'zebra') drawZebra(cx, cy, scale, bounce);
    if (animal.name === 'penguin') drawPenguin(cx, cy, scale, bounce);
    g.restore();

    badge.textContent = animal.name;
    pulse *= 0.91;
  }

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    state.lastStep = step;
    const cycle = Math.max(4, Math.round(state.cycleSteps));
    if (step % cycle !== 0) return;
    state.animalIndex = clampIndex(state.animalIndex + 1);
    pulse = 1;
    ctx.bus.pubGlobal('zoo_stick_animal', {
      name: animals[state.animalIndex].name,
      index: state.animalIndex,
      step
    });
  });

  render(0);

  return {
    update(frame) {
      render(frame);
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
    }
  };
}
