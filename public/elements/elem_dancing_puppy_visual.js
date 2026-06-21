const STATE_VERSION = 'dancing-puppy-visual-v1';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    energy: clamp(finite(prevState?.energy, 0.86), 0, 1),
    lights: clamp(finite(prevState?.lights, 0.72), 0, 1),
    camera: clamp(finite(prevState?.camera, 0.55), 0, 1)
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .stage {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 190px;
        overflow: hidden;
        border: 1px solid rgba(226, 232, 240, 0.2);
        border-radius: 8px;
        background: #07110f;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .grain {
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0.22;
        mix-blend-mode: screen;
        background:
          repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0 1px, transparent 1px 5px),
          radial-gradient(circle at 50% 55%, transparent 0 58%, rgba(0,0,0,0.54) 100%);
      }
    </style>
    <div class="stage">
      <canvas id="puppy" aria-label="Animated dancing puppy visual"></canvas>
      <div class="grain"></div>
    </div>
  `;

  const host = ctx.domRoot.querySelector('.stage');
  const canvas = ctx.domRoot.querySelector('#puppy');
  const cx = canvas.getContext('2d', { alpha: false });

  let raf = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let destroyed = false;
  let beatPulse = 0;
  let stepPulse = 0;
  let currentStep = 0;
  let lastFrame = performance.now();

  const resize = () => {
    const rect = host.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(host);
  resize();

  const ellipse = (x, y, rx, ry, rotation, fill, stroke = null, lineWidth = 1) => {
    cx.beginPath();
    cx.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    cx.fillStyle = fill;
    cx.fill();
    if (stroke) {
      cx.strokeStyle = stroke;
      cx.lineWidth = lineWidth;
      cx.stroke();
    }
  };

  const drawRoundRect = (x, y, w, h, r, fill) => {
    const radius = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
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
    cx.fillStyle = fill;
    cx.fill();
  };

  const line = (x1, y1, x2, y2, color, size) => {
    cx.beginPath();
    cx.moveTo(x1, y1);
    cx.lineTo(x2, y2);
    cx.strokeStyle = color;
    cx.lineWidth = size;
    cx.lineCap = 'round';
    cx.stroke();
  };

  const drawBackground = (time, pulse) => {
    const floorY = height * 0.78;
    const gradient = cx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#08131a');
    gradient.addColorStop(0.42, '#20112d');
    gradient.addColorStop(1, '#102016');
    cx.fillStyle = gradient;
    cx.fillRect(0, 0, width, height);

    for (let i = 0; i < 12; i += 1) {
      const hue = (time * 0.035 + i * 31 + currentStep * 9) % 360;
      const x = (i / 11) * width;
      const targetX = width * (0.15 + ((i * 0.19 + time * 0.00008) % 0.7));
      cx.strokeStyle = `hsla(${hue}, 88%, 62%, ${0.1 + state.lights * 0.22 + pulse * 0.12})`;
      cx.lineWidth = 2 + pulse * 5;
      cx.beginPath();
      cx.moveTo(x, 0);
      cx.lineTo(targetX, floorY);
      cx.stroke();
    }

    cx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    cx.fillRect(0, floorY, width, height - floorY);

    const tileW = Math.max(22, width / 12);
    for (let y = floorY; y < height + tileW; y += tileW) {
      for (let x = -tileW; x < width + tileW; x += tileW) {
        const mix = ((Math.floor(x / tileW) + Math.floor(y / tileW)) & 1) === 0;
        cx.fillStyle = mix ? 'rgba(45, 212, 191, 0.12)' : 'rgba(244, 114, 182, 0.1)';
        cx.beginPath();
        cx.moveTo(x, y);
        cx.lineTo(x + tileW, y + tileW * 0.18);
        cx.lineTo(x + tileW * 0.5, y + tileW * 0.38);
        cx.lineTo(x - tileW * 0.5, y + tileW * 0.2);
        cx.closePath();
        cx.fill();
      }
    }

    for (let i = 0; i < 18; i += 1) {
      const angle = time * 0.0013 + i;
      const x = width * (0.5 + Math.sin(angle * 0.7) * 0.45);
      const y = height * (0.12 + ((i * 0.17 + time * 0.00003) % 0.52));
      const r = 2 + ((i + currentStep) % 5) + pulse * 4;
      cx.fillStyle = `hsla(${(i * 37 + currentStep * 18) % 360}, 86%, 68%, ${0.18 + state.lights * 0.32})`;
      cx.beginPath();
      cx.arc(x, y, r, 0, Math.PI * 2);
      cx.fill();
    }
  };

  const drawPuppy = (time, pulse) => {
    const unit = Math.min(width, height) / 5.25;
    const phase = time * 0.0065 * (0.75 + state.energy * 0.8);
    const hop = Math.abs(Math.sin(phase * 2)) * unit * 0.18 * state.energy + pulse * unit * 0.1;
    const sway = Math.sin(phase) * unit * 0.28 * state.energy;
    const twist = Math.sin(phase * 1.2) * 0.13 * state.energy;
    const cx0 = width * 0.5 + sway;
    const cy0 = height * 0.63 - hop;
    const tailSwing = Math.sin(phase * 2.4) * 0.72;
    const earFlip = Math.sin(phase * 2.1) * unit * 0.14;
    const pawSwing = Math.sin(phase * 2 + Math.PI * 0.25) * unit * 0.34 * state.energy;
    const footSwing = Math.sin(phase * 2 + Math.PI) * unit * 0.28 * state.energy;

    cx.save();
    cx.translate(cx0, cy0);
    cx.rotate(twist);

    cx.save();
    cx.globalAlpha = 0.38;
    ellipse(0, unit * 1.48 + hop * 0.35, unit * 1.08, unit * 0.22, 0, '#000000');
    cx.restore();

    line(unit * 0.62, unit * 0.08, unit * 1.15, -unit * 0.32 + tailSwing * unit * 0.2, '#9a6a42', unit * 0.18);
    line(unit * 1.15, -unit * 0.32 + tailSwing * unit * 0.2, unit * 1.38, -unit * 0.58 - tailSwing * unit * 0.12, '#f3c187', unit * 0.14);

    line(-unit * 0.36, unit * 0.55, -unit * 0.68 + footSwing, unit * 1.28, '#d99a5e', unit * 0.2);
    line(unit * 0.34, unit * 0.55, unit * 0.72 - footSwing, unit * 1.27, '#d99a5e', unit * 0.2);
    ellipse(-unit * 0.78 + footSwing, unit * 1.34, unit * 0.24, unit * 0.11, -0.08, '#f1b778', '#5a351f', 1.2);
    ellipse(unit * 0.82 - footSwing, unit * 1.34, unit * 0.24, unit * 0.11, 0.08, '#f1b778', '#5a351f', 1.2);

    ellipse(0, unit * 0.34, unit * 0.82, unit * 0.92, -twist * 0.5, '#c9854d', '#5a351f', 2);
    ellipse(-unit * 0.12, unit * 0.46, unit * 0.52, unit * 0.56, 0.02, '#f1c18b');

    line(-unit * 0.55, -unit * 0.03, -unit * 1.08, -unit * 0.52 + pawSwing, '#d99a5e', unit * 0.2);
    line(unit * 0.55, -unit * 0.02, unit * 1.08, -unit * 0.52 - pawSwing, '#d99a5e', unit * 0.2);
    ellipse(-unit * 1.12, -unit * 0.56 + pawSwing, unit * 0.18, unit * 0.16, 0.15, '#f1b778', '#5a351f', 1.2);
    ellipse(unit * 1.12, -unit * 0.56 - pawSwing, unit * 0.18, unit * 0.16, -0.15, '#f1b778', '#5a351f', 1.2);

    cx.save();
    cx.translate(0, -unit * 0.68);
    cx.rotate(Math.sin(phase * 1.7) * 0.08);

    ellipse(-unit * 0.56, -unit * 0.26 + earFlip, unit * 0.22, unit * 0.5, -0.5, '#8b5a37', '#4a2b19', 1.5);
    ellipse(unit * 0.56, -unit * 0.26 - earFlip, unit * 0.22, unit * 0.5, 0.5, '#8b5a37', '#4a2b19', 1.5);
    ellipse(0, 0, unit * 0.66, unit * 0.58, 0, '#d99a5e', '#5a351f', 2);
    ellipse(0, unit * 0.18, unit * 0.36, unit * 0.25, 0, '#f5d1a7');
    ellipse(-unit * 0.18, -unit * 0.08, unit * 0.06, unit * 0.075, 0, '#111827');
    ellipse(unit * 0.18, -unit * 0.08, unit * 0.06, unit * 0.075, 0, '#111827');
    ellipse(-unit * 0.16, -unit * 0.1, unit * 0.018, unit * 0.022, 0, '#f8fafc');
    ellipse(unit * 0.16, -unit * 0.1, unit * 0.018, unit * 0.022, 0, '#f8fafc');
    ellipse(0, unit * 0.08, unit * 0.12, unit * 0.085, 0, '#1f130d');

    cx.strokeStyle = '#1f130d';
    cx.lineWidth = unit * 0.035;
    cx.lineCap = 'round';
    cx.beginPath();
    cx.moveTo(-unit * 0.13, unit * 0.2);
    cx.quadraticCurveTo(0, unit * 0.31 + Math.sin(phase * 4) * unit * 0.025, unit * 0.13, unit * 0.2);
    cx.stroke();

    cx.fillStyle = '#ef4444';
    cx.beginPath();
    cx.ellipse(unit * 0.12, unit * 0.28, unit * 0.07, unit * 0.13 * (0.6 + pulse), 0.2, 0, Math.PI * 2);
    cx.fill();
    cx.restore();

    drawRoundRect(-unit * 0.42, -unit * 0.1, unit * 0.84, unit * 0.17, unit * 0.08, '#22c55e');
    ellipse(0, unit * 0.02, unit * 0.09, unit * 0.09, 0, '#facc15', '#713f12', 1);

    cx.restore();
  };

  const drawCameraShake = () => {
    if (state.camera <= 0.02) return;
    const count = 8 + Math.floor(state.camera * 12);
    for (let i = 0; i < count; i += 1) {
      cx.fillStyle = `rgba(255,255,255,${0.015 + Math.random() * 0.045})`;
      cx.fillRect(
        (Math.random() - 0.5) * width * 0.05 * state.camera,
        Math.random() * height,
        width * (0.65 + Math.random() * 0.45),
        1 + Math.random() * 2
      );
    }
  };

  const draw = (time) => {
    if (destroyed) return;
    const elapsed = Math.min(80, time - lastFrame);
    lastFrame = time;
    beatPulse = Math.max(0, beatPulse - elapsed * 0.0046);
    stepPulse = Math.max(0, stepPulse - elapsed * 0.006);

    const pulse = clamp(beatPulse + stepPulse * 0.35, 0, 1);
    drawBackground(time, pulse);
    drawPuppy(time, pulse);
    drawCameraShake();

    if (pulse > 0.02) {
      cx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.08})`;
      cx.fillRect(0, 0, width, height);
    }

    raf = requestAnimationFrame(draw);
  };

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    currentStep = step % 16;
    stepPulse = Math.max(stepPulse, 0.45);
    if (currentStep % 4 === 0) beatPulse = 1;
  });

  raf = requestAnimationFrame(draw);

  return {
    update() {},
    getState() {
      return {
        stateVersion: STATE_VERSION,
        energy: state.energy,
        lights: state.lights,
        camera: state.camera
      };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      unsubscribeClock();
      if (resizeObserver) resizeObserver.disconnect();
    }
  };
}
