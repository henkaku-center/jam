const STATE_VERSION = 'edm-laser-background-v1';

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hsla(hue, saturation, lightness, alpha) {
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

export default function setup(ctx, prevState) {
  const previousMatches = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    intensity: previousMatches ? clamp(finite(prevState.intensity, 0.9), 0, 1) : 0.9,
    density: previousMatches ? clamp(finite(prevState.density, 0.76), 0, 1) : 0.76,
    haze: previousMatches ? clamp(finite(prevState.haze, 0.64), 0, 1) : 0.64,
    sweep: previousMatches ? clamp(finite(prevState.sweep, 0.82), 0, 1) : 0.82
  };

  let width = 1;
  let height = 1;
  let dpr = 1;
  let raf = 0;
  let tickStep = 0;
  let beatPulse = 0;
  let kickPulse = 0;
  let snarePulse = 0;
  let lastTickAt = performance.now();

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
        pointer-events: none;
      }

      .laser-bg {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 360px;
        min-height: 220px;
        overflow: hidden;
        background: transparent;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
    <div class="laser-bg">
      <canvas id="laser-canvas" aria-label="EDM laser light background"></canvas>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#laser-canvas');
  const view = canvas.getContext('2d', { alpha: true });
  const frameStyle = document.createElement('style');
  frameStyle.textContent = `
    #wrapper-${ctx.elementId} {
      pointer-events: none !important;
    }
    #wrapper-${ctx.elementId}.active-focus::after {
      display: none !important;
    }
  `;
  document.head.appendChild(frameStyle);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(rect.width));
    const nextHeight = Math.max(1, Math.floor(rect.height));
    const nextDpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return;

    width = nextWidth;
    height = nextHeight;
    dpr = nextDpr;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    view.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawBeam(originX, originY, angle, length, hue, alpha, thickness) {
    const endX = originX + Math.cos(angle) * length;
    const endY = originY + Math.sin(angle) * length;
    const gradient = view.createLinearGradient(originX, originY, endX, endY);
    gradient.addColorStop(0, hsla(hue, 100, 66, 0));
    gradient.addColorStop(0.12, hsla(hue, 100, 64, alpha * 0.9));
    gradient.addColorStop(0.52, hsla(hue + 24, 100, 58, alpha));
    gradient.addColorStop(1, hsla(hue + 72, 100, 64, 0));

    view.save();
    view.globalCompositeOperation = 'lighter';
    view.strokeStyle = gradient;
    view.lineCap = 'round';
    view.lineWidth = thickness * 4.5;
    view.globalAlpha = 0.16 + alpha * 0.24;
    view.beginPath();
    view.moveTo(originX, originY);
    view.lineTo(endX, endY);
    view.stroke();

    view.lineWidth = thickness;
    view.globalAlpha = 0.72 + alpha * 0.28;
    view.beginPath();
    view.moveTo(originX, originY);
    view.lineTo(endX, endY);
    view.stroke();
    view.restore();
  }

  function drawMirrorBeam(centerX, centerY, angle, length, hue, alpha, thickness) {
    drawBeam(centerX, centerY, angle, length, hue, alpha, thickness);
    drawBeam(width - centerX, centerY, Math.PI - angle, length, hue + 115, alpha * 0.88, thickness * 0.9);
  }

  function draw(now) {
    resize();
    const time = now * 0.001;
    const decay = Math.min(1, Math.max(0.82, 0.94 - state.intensity * 0.04));
    beatPulse *= decay;
    kickPulse *= decay * 0.98;
    snarePulse *= decay * 0.97;

    view.globalCompositeOperation = 'source-over';
    view.clearRect(0, 0, width, height);

    const horizon = height * (0.47 + Math.sin(time * 0.18) * 0.035);
    const pulse = clamp(beatPulse, 0, 1);
    const kick = clamp(kickPulse, 0, 1);
    const snare = clamp(snarePulse, 0, 1);
    const scan = time * (0.34 + state.sweep * 0.78);
    const centerX = width * (0.5 + Math.sin(time * 0.17) * 0.08);
    const rigY = horizon + Math.sin(time * 0.23) * height * 0.08;
    const beamCount = Math.floor(10 + state.density * 16);
    const length = Math.hypot(width, height) * 1.2;

    view.save();
    view.globalCompositeOperation = 'lighter';
    const haze = view.createRadialGradient(centerX, rigY, 0, centerX, rigY, Math.max(width, height) * 0.72);
    haze.addColorStop(0, `rgba(0, 255, 230, ${0.04 + state.haze * 0.09 + kick * 0.04})`);
    haze.addColorStop(0.38, `rgba(255, 0, 190, ${0.025 + state.haze * 0.075 + snare * 0.03})`);
    haze.addColorStop(1, 'rgba(0, 0, 0, 0)');
    view.fillStyle = haze;
    view.fillRect(0, 0, width, height);
    view.restore();

    for (let i = 0; i < beamCount; i += 1) {
      const ratio = beamCount === 1 ? 0.5 : i / (beamCount - 1);
      const side = i % 2 === 0 ? -1 : 1;
      const spread = 0.28 + state.sweep * 0.62;
      const wobble = Math.sin(scan * (0.8 + ratio * 0.7) + i * 1.618) * 0.38;
      const fan = (ratio - 0.5) * spread + wobble * 0.22;
      const angle = -Math.PI / 2 + fan + side * Math.sin(time * 0.31 + i) * 0.08;
      const hue = (178 + i * 23 + Math.sin(time * 0.19 + i) * 38 + tickStep * 4) % 360;
      const flicker = 0.68 + Math.sin(time * 8.0 + i * 2.3) * 0.13;
      const alpha = (0.16 + state.intensity * 0.34 + pulse * 0.24) * flicker;
      const thickness = 1.2 + state.intensity * 2.2 + (i % 4 === tickStep % 4 ? pulse * 2.2 : 0);
      const originX = centerX + Math.sin(time * 0.47 + i) * width * 0.08;
      const originY = rigY + Math.cos(time * 0.37 + i * 0.3) * height * 0.04;
      drawMirrorBeam(originX, originY, angle, length, hue, alpha, thickness);
    }

    view.save();
    view.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i += 1) {
      const y = horizon + i * height * 0.065;
      const depth = i / 8;
      const alpha = (0.08 + kick * 0.1) * (1 - depth * 0.58);
      view.strokeStyle = `rgba(0, 248, 255, ${alpha})`;
      view.lineWidth = 1;
      view.beginPath();
      view.moveTo(width * (0.05 + depth * 0.18), y);
      view.lineTo(width * (0.95 - depth * 0.18), y);
      view.stroke();
    }

    const vanishingX = centerX;
    for (let i = -9; i <= 9; i += 1) {
      const offset = i / 9;
      view.strokeStyle = `rgba(255, 0, 205, ${0.045 + snare * 0.08})`;
      view.lineWidth = 1;
      view.beginPath();
      view.moveTo(vanishingX, horizon);
      view.lineTo(width * (0.5 + offset * 0.92), height);
      view.stroke();
    }
    view.restore();

    view.save();
    view.globalCompositeOperation = 'lighter';
    const strobeAlpha = Math.max(0, pulse - 0.45) * 0.18;
    if (strobeAlpha > 0.002) {
      view.fillStyle = `rgba(180, 245, 255, ${strobeAlpha})`;
      view.fillRect(0, 0, width, height);
    }
    view.restore();

    raf = requestAnimationFrame(draw);
  }

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    tickStep = ((step % 16) + 16) % 16;
    lastTickAt = performance.now();
    beatPulse = 1;
    if (tickStep % 4 === 0) kickPulse = 1;
    if (tickStep === 4 || tickStep === 12) snarePulse = 1;
  });

  const visibilityTimer = setInterval(() => {
    if (performance.now() - lastTickAt > 900) beatPulse = Math.max(beatPulse, 0.32);
  }, 500);

  raf = requestAnimationFrame(draw);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(visibilityTimer);
      unsubscribeClock();
      frameStyle.remove();
    }
  };
}
