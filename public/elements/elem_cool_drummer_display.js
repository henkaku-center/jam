const STATE_VERSION = 'cool-drummer-display-v1';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    energy: finite(prevState?.energy, 0.74),
    glow: finite(prevState?.glow, 0.68),
    trails: finite(prevState?.trails, 0.58)
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .display {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 190px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background:
          radial-gradient(circle at 18% 22%, rgba(45, 212, 191, 0.24), transparent 28%),
          radial-gradient(circle at 82% 18%, rgba(251, 113, 133, 0.2), transparent 28%),
          linear-gradient(135deg, rgba(10, 12, 17, 0.98), rgba(30, 32, 35, 0.98));
        isolation: isolate;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
    <div class="display">
      <canvas id="drummer" aria-label="Animated drummer display"></canvas>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#drummer');
  const cx = canvas.getContext('2d', { alpha: true });
  let raf = 0;
  let destroyed = false;
  let beatPulse = 0;
  let kickPulse = 0;
  let snarePulse = 0;
  let hatPulse = 0;
  let stepPulse = 0;
  let currentStep = 0;
  let lastTime = performance.now();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  };

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resize)
    : null;
  if (resizeObserver) resizeObserver.observe(canvas);

  const drawRoundRect = (x, y, w, h, r) => {
    const radius = Math.min(r, w * 0.5, h * 0.5);
    cx.beginPath();
    cx.moveTo(x + radius, y);
    cx.lineTo(x + w - radius, y);
    cx.quadraticCurveTo(x + w, y, x + w, y + radius);
    cx.lineTo(x + w, y + h - radius);
    cx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    cx.lineTo(x + radius, y + h);
    cx.quadraticCurveTo(x, y + h, x, y + h - radius);
    cx.lineTo(x, y + radius);
    cx.quadraticCurveTo(x, y, x + radius, y);
    cx.closePath();
  };

  const ellipse = (x, y, rx, ry, rotation = 0) => {
    cx.beginPath();
    cx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
  };

  const line = (x1, y1, x2, y2) => {
    cx.beginPath();
    cx.moveTo(x1, y1);
    cx.lineTo(x2, y2);
  };

  const drawStick = (shoulderX, shoulderY, tipX, tipY, width, color) => {
    cx.save();
    cx.strokeStyle = color;
    cx.lineWidth = width;
    cx.lineCap = 'round';
    line(shoulderX, shoulderY, tipX, tipY);
    cx.stroke();
    cx.restore();
  };

  const drawCymbal = (x, y, rx, ry, tilt, hit) => {
    cx.save();
    cx.translate(x, y);
    cx.rotate(tilt);
    const glow = 0.45 + hit * 0.55;
    cx.shadowColor = `rgba(250, 204, 21, ${0.35 + hit * 0.38})`;
    cx.shadowBlur = 18 + hit * 28;
    const grad = cx.createLinearGradient(-rx, -ry, rx, ry);
    grad.addColorStop(0, '#fef08a');
    grad.addColorStop(0.48, '#facc15');
    grad.addColorStop(1, '#a16207');
    ellipse(0, 0, rx * (1 + hit * 0.06), ry * (1 + hit * 0.16));
    cx.fillStyle = grad;
    cx.globalAlpha = glow;
    cx.fill();
    cx.globalAlpha = 1;
    cx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
    cx.lineWidth = 1.5;
    cx.stroke();
    ellipse(0, 0, rx * 0.22, ry * 0.32);
    cx.fillStyle = 'rgba(255, 255, 255, 0.34)';
    cx.fill();
    cx.restore();
  };

  const drawDrum = (x, y, rx, ry, depth, color, hit) => {
    cx.save();
    cx.shadowColor = `rgba(45, 212, 191, ${0.18 + hit * 0.36})`;
    cx.shadowBlur = 10 + hit * 22;
    const body = cx.createLinearGradient(x - rx, y - ry, x + rx, y + depth);
    body.addColorStop(0, color);
    body.addColorStop(1, '#111827');
    drawRoundRect(x - rx, y - ry * 0.3, rx * 2, depth, Math.max(4, ry * 0.3));
    cx.fillStyle = body;
    cx.fill();
    cx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    cx.lineWidth = 1.5;
    cx.stroke();

    const head = cx.createRadialGradient(x - rx * 0.25, y - ry * 0.25, 3, x, y, rx);
    head.addColorStop(0, '#f8fafc');
    head.addColorStop(0.62, '#cbd5e1');
    head.addColorStop(1, '#64748b');
    ellipse(x, y, rx * (1 + hit * 0.045), ry * (1 + hit * 0.085));
    cx.fillStyle = head;
    cx.fill();
    cx.strokeStyle = '#e2e8f0';
    cx.lineWidth = 2;
    cx.stroke();

    if (hit > 0.04) {
      cx.globalAlpha = hit * 0.7;
      cx.strokeStyle = '#ffffff';
      cx.lineWidth = 2;
      ellipse(x, y, rx * (1 + hit * 0.28), ry * (1 + hit * 0.28));
      cx.stroke();
    }
    cx.restore();
  };

  const drawBackground = (w, h, t, pulse) => {
    cx.save();
    cx.fillStyle = 'rgba(8, 10, 14, 0.92)';
    cx.fillRect(0, 0, w, h);

    const barCount = 22;
    for (let i = 0; i < barCount; i += 1) {
      const x = (i / (barCount - 1)) * w;
      const phase = t * 0.004 + i * 0.72;
      const height = h * (0.12 + 0.16 * Math.sin(phase) ** 2 + pulse * 0.12 * (i % 4 === currentStep % 4 ? 1 : 0));
      const hue = i % 3 === 0 ? '45, 212, 191' : i % 3 === 1 ? '251, 113, 133' : '250, 204, 21';
      cx.fillStyle = `rgba(${hue}, ${0.08 + pulse * 0.09})`;
      drawRoundRect(x - w / barCount * 0.28, h - height - 10, w / barCount * 0.36, height, 4);
      cx.fill();
    }

    cx.strokeStyle = `rgba(226, 232, 240, ${0.08 + pulse * 0.09})`;
    cx.lineWidth = 1;
    for (let i = 0; i < 7; i += 1) {
      const y = h * (0.18 + i * 0.1) + Math.sin(t * 0.0015 + i) * 4;
      line(0, y, w, y);
      cx.stroke();
    }
    cx.restore();
  };

  const drawDrummer = (w, h, t) => {
    const s = Math.min(w / 430, h / 300);
    const cx0 = w * 0.5;
    const floor = h * 0.82;
    const groove = Math.sin(t * 0.011);
    const nod = Math.sin(t * 0.016) * 5 * s + beatPulse * 7 * s;
    const lean = Math.sin(t * 0.006) * 4 * s;
    const bodyX = cx0 + lean;
    const bodyY = floor - 104 * s + nod * 0.25;
    const headX = bodyX + groove * 5 * s;
    const headY = bodyY - 50 * s + nod;
    const leftHit = snarePulse + hatPulse * 0.4;
    const rightHit = kickPulse * 0.35 + hatPulse;
    const leftHandX = cx0 - 84 * s + leftHit * 20 * s;
    const leftHandY = floor - 96 * s + Math.sin(t * 0.02) * 7 * s - leftHit * 34 * s;
    const rightHandX = cx0 + 88 * s - rightHit * 10 * s;
    const rightHandY = floor - 112 * s + Math.cos(t * 0.018) * 8 * s - rightHit * 42 * s;

    drawDrum(cx0, floor - 38 * s, 86 * s, 32 * s, 56 * s, '#ef4444', kickPulse);
    drawDrum(cx0 - 72 * s, floor - 84 * s, 43 * s, 19 * s, 36 * s, '#0891b2', snarePulse);
    drawDrum(cx0 + 74 * s, floor - 82 * s, 43 * s, 19 * s, 36 * s, '#7c3aed', kickPulse * 0.28 + stepPulse * 0.3);
    drawCymbal(cx0 - 122 * s, floor - 134 * s, 58 * s, 13 * s, -0.22, hatPulse);
    drawCymbal(cx0 + 132 * s, floor - 150 * s, 62 * s, 14 * s, 0.18, hatPulse * 0.4 + snarePulse * 0.5);

    cx.save();
    cx.lineCap = 'round';
    cx.lineJoin = 'round';

    cx.strokeStyle = 'rgba(148, 163, 184, 0.44)';
    cx.lineWidth = 4 * s;
    line(cx0 - 122 * s, floor - 122 * s, cx0 - 132 * s, floor - 20 * s);
    cx.stroke();
    line(cx0 + 132 * s, floor - 137 * s, cx0 + 124 * s, floor - 18 * s);
    cx.stroke();

    const jacket = cx.createLinearGradient(bodyX - 45 * s, bodyY - 10 * s, bodyX + 55 * s, bodyY + 78 * s);
    jacket.addColorStop(0, '#0f172a');
    jacket.addColorStop(0.5, '#1e293b');
    jacket.addColorStop(1, '#111827');
    drawRoundRect(bodyX - 44 * s, bodyY - 4 * s, 88 * s, 95 * s, 22 * s);
    cx.fillStyle = jacket;
    cx.fill();
    cx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    cx.lineWidth = 2 * s;
    cx.stroke();

    cx.fillStyle = '#14b8a6';
    cx.beginPath();
    cx.moveTo(bodyX - 15 * s, bodyY + 1 * s);
    cx.lineTo(bodyX + 16 * s, bodyY + 1 * s);
    cx.lineTo(bodyX + 5 * s, bodyY + 60 * s);
    cx.lineTo(bodyX - 8 * s, bodyY + 60 * s);
    cx.closePath();
    cx.fill();

    cx.strokeStyle = '#334155';
    cx.lineWidth = 17 * s;
    line(bodyX - 33 * s, bodyY + 12 * s, leftHandX, leftHandY);
    cx.stroke();
    line(bodyX + 33 * s, bodyY + 12 * s, rightHandX, rightHandY);
    cx.stroke();

    cx.fillStyle = '#f4c99a';
    ellipse(leftHandX, leftHandY, 9 * s, 8 * s);
    cx.fill();
    ellipse(rightHandX, rightHandY, 9 * s, 8 * s);
    cx.fill();

    drawStick(leftHandX, leftHandY, cx0 - 66 * s + leftHit * 8 * s, floor - 92 * s + leftHit * 20 * s, 4 * s, '#f8fafc');
    drawStick(rightHandX, rightHandY, cx0 + 112 * s, floor - 152 * s + rightHit * 16 * s, 4 * s, '#f8fafc');

    cx.fillStyle = '#f4c99a';
    ellipse(headX, headY, 30 * s, 33 * s);
    cx.fill();
    cx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    cx.lineWidth = 1.4 * s;
    cx.stroke();

    cx.fillStyle = '#111827';
    cx.beginPath();
    cx.moveTo(headX - 32 * s, headY - 20 * s);
    cx.quadraticCurveTo(headX + 8 * s, headY - 49 * s, headX + 34 * s, headY - 14 * s);
    cx.quadraticCurveTo(headX + 8 * s, headY - 26 * s, headX - 32 * s, headY - 20 * s);
    cx.fill();

    cx.fillStyle = '#020617';
    drawRoundRect(headX - 25 * s, headY - 4 * s, 22 * s, 12 * s, 5 * s);
    cx.fill();
    drawRoundRect(headX + 5 * s, headY - 4 * s, 22 * s, 12 * s, 5 * s);
    cx.fill();
    cx.strokeStyle = '#020617';
    cx.lineWidth = 3 * s;
    line(headX - 3 * s, headY + 2 * s, headX + 5 * s, headY + 2 * s);
    cx.stroke();

    cx.strokeStyle = '#7f1d1d';
    cx.lineWidth = 2 * s;
    cx.beginPath();
    cx.arc(headX + 2 * s, headY + 15 * s, 10 * s, 0.08, Math.PI - 0.08);
    cx.stroke();

    cx.strokeStyle = '#06b6d4';
    cx.lineWidth = 6 * s;
    cx.beginPath();
    cx.arc(headX, headY - 5 * s, 35 * s, Math.PI * 1.08, Math.PI * 1.92);
    cx.stroke();
    cx.fillStyle = '#0f172a';
    ellipse(headX - 33 * s, headY - 2 * s, 9 * s, 15 * s);
    cx.fill();
    ellipse(headX + 33 * s, headY - 2 * s, 9 * s, 15 * s);
    cx.fill();

    if (state.trails > 0.02) {
      cx.globalCompositeOperation = 'screen';
      cx.globalAlpha = state.trails * (0.22 + beatPulse * 0.2);
      cx.strokeStyle = '#22d3ee';
      cx.lineWidth = 2 * s;
      line(leftHandX - 14 * s, leftHandY + 12 * s, cx0 - 112 * s, floor - 136 * s);
      cx.stroke();
      cx.strokeStyle = '#fb7185';
      line(rightHandX + 12 * s, rightHandY + 10 * s, cx0 + 144 * s, floor - 152 * s);
      cx.stroke();
    }

    cx.restore();
  };

  const draw = (now) => {
    if (destroyed) return;
    resize();
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const dt = clamp((now - lastTime) / 16.666, 0.25, 3);
    lastTime = now;

    beatPulse *= Math.pow(0.9, dt);
    kickPulse *= Math.pow(0.86, dt);
    snarePulse *= Math.pow(0.84, dt);
    hatPulse *= Math.pow(0.82, dt);
    stepPulse *= Math.pow(0.88, dt);

    const pulse = clamp(beatPulse + kickPulse * 0.35 + snarePulse * 0.28 + hatPulse * 0.18, 0, 1.4);
    drawBackground(width, height, now, pulse);

    cx.save();
    cx.globalCompositeOperation = 'screen';
    cx.globalAlpha = 0.18 + state.glow * 0.2 + pulse * 0.2;
    const glow = cx.createRadialGradient(width * 0.52, height * 0.58, 10, width * 0.52, height * 0.58, Math.max(width, height) * 0.72);
    glow.addColorStop(0, '#2dd4bf');
    glow.addColorStop(0.42, '#fb7185');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    cx.fillStyle = glow;
    cx.fillRect(0, 0, width, height);
    cx.restore();

    drawDrummer(width, height, now);
    raf = requestAnimationFrame(draw);
  };

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    currentStep = step % 16;
    stepPulse = 1;
    beatPulse = Math.max(beatPulse, currentStep % 4 === 0 ? 1 : 0.55);
    if (currentStep % 4 === 0) kickPulse = Math.max(kickPulse, 0.72);
    if (currentStep === 4 || currentStep === 12) snarePulse = Math.max(snarePulse, 0.8);
    hatPulse = Math.max(hatPulse, 0.42);
  });

  const unsubscribeHit = typeof ctx.bus?.sub === 'function'
    ? ctx.bus.sub('pocketDrums:hit', (hit) => {
      const velocity = clamp(Number(hit?.velocity) || 0.5, 0, 1.2) * state.energy;
      if (hit?.voice === 'kick') kickPulse = Math.max(kickPulse, velocity);
      if (hit?.voice === 'snare' || hit?.voice === 'rim') snarePulse = Math.max(snarePulse, velocity);
      if (hit?.voice === 'hat' || hit?.voice === 'open') hatPulse = Math.max(hatPulse, velocity);
      beatPulse = Math.max(beatPulse, 0.3 + velocity * 0.5);
    })
    : () => {};

  resize();
  raf = requestAnimationFrame(draw);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      unsubscribeClock();
      unsubscribeHit();
      if (resizeObserver) resizeObserver.disconnect();
    }
  };
}
