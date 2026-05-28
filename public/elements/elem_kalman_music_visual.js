export default function setup(ctx, prevState) {
  const state = {
    processNoise: Number.isFinite(prevState?.processNoise) ? prevState.processNoise : 0.024,
    measurementNoise: Number.isFinite(prevState?.measurementNoise) ? prevState.measurementNoise : 0.14,
    confidence: Number.isFinite(prevState?.confidence) ? prevState.confidence : 0.74
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .kalman {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 190px;
        overflow: hidden;
        border: 1px solid rgba(94, 234, 212, 0.42);
        border-radius: 8px;
        background: #05070a;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .hud {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 9px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: start;
        color: #d9fbf5;
        font: 10px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        pointer-events: none;
      }
      .title {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .name {
        color: #99f6e4;
        font-size: 12px;
      }
      .sub {
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meters {
        display: grid;
        min-width: 92px;
        gap: 3px;
      }
      .meter {
        height: 4px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.22);
      }
      .bar {
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #5eead4, #fde047, #fb7185);
      }
    </style>
    <div class="kalman">
      <canvas id="kalman-canvas" aria-label="Music reactive Kalman filter visualization"></canvas>
      <div class="hud">
        <div class="title">
          <div class="name">Kalman Filter</div>
          <div class="sub">prediction, noisy measurement, posterior estimate</div>
        </div>
        <div class="meters">
          <div class="meter"><div class="bar" id="energy"></div></div>
          <div class="meter"><div class="bar" id="bass"></div></div>
        </div>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#kalman-canvas');
  const g = canvas.getContext('2d');
  const energyBar = ctx.domRoot.querySelector('#energy');
  const bassBar = ctx.domRoot.querySelector('#bass');
  const analyser = ctx.audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.78;
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  const waveData = new Uint8Array(analyser.fftSize);
  const master = window.jamMasterGain || null;

  if (master && typeof master.connect === 'function') {
    try { master.connect(analyser); } catch {}
  }

  let x = Number.isFinite(prevState?.x) ? prevState.x : 0.1;
  let velocity = Number.isFinite(prevState?.velocity) ? prevState.velocity : 0;
  let p00 = 0.55;
  let p01 = 0;
  let p10 = 0;
  let p11 = 0.24;
  let phase = Number.isFinite(prevState?.phase) ? prevState.phase : 0;
  let lastTime = performance.now();
  let energy = 0;
  let bass = 0;
  let transient = 0;
  const history = [];

  for (let i = 0; i < 160; i += 1) {
    history.push({ truth: 0, measurement: 0, estimate: 0, variance: 0.5, energy: 0, bass: 0 });
  }

  function readAudio() {
    analyser.getByteFrequencyData(freqData);
    analyser.getByteTimeDomainData(waveData);

    let low = 0;
    let mid = 0;
    let high = 0;
    const lowBins = 10;
    const midStart = 10;
    const midEnd = 58;
    for (let i = 0; i < lowBins; i += 1) low += freqData[i] / 255;
    for (let i = midStart; i < midEnd; i += 1) mid += freqData[i] / 255;
    for (let i = midEnd; i < 150 && i < freqData.length; i += 1) high += freqData[i] / 255;

    low /= lowBins;
    mid /= Math.max(1, midEnd - midStart);
    high /= Math.max(1, Math.min(150, freqData.length) - midEnd);

    let rms = 0;
    for (let i = 0; i < waveData.length; i += 1) {
      const sample = (waveData[i] - 128) / 128;
      rms += sample * sample;
    }
    rms = Math.sqrt(rms / waveData.length);

    const nextEnergy = clamp(rms * 3.2 + low * 0.55 + mid * 0.25 + high * 0.1, 0, 1);
    transient = Math.max(0, nextEnergy - energy) * 5.5 + transient * 0.86;
    energy = energy * 0.82 + nextEnergy * 0.18;
    bass = bass * 0.84 + clamp(low * 1.35, 0, 1) * 0.16;

    if (energy < 0.012 && bass < 0.012) {
      const fallbackPulse = 0.5 + 0.5 * Math.sin(phase * 2);
      energy = Math.max(energy, fallbackPulse * 0.05);
      bass = Math.max(bass, fallbackPulse * 0.035);
    }
  }

  function stepFilter(dt) {
    phase += dt * (1.08 + energy * 1.7 + bass * 0.7);
    const truth =
      Math.sin(phase) * 0.56 +
      Math.sin(phase * 0.37 + 1.7) * 0.24 +
      Math.sin(phase * 2.1) * (0.04 + bass * 0.12);

    const noiseScale = state.measurementNoise + energy * 0.38 + transient * 0.08;
    const measurement = truth + randomNormal() * noiseScale + bass * 0.12 * Math.sin(phase * 9);
    const q = state.processNoise + transient * 0.034 + bass * 0.018;
    const r = Math.max(0.018, noiseScale * noiseScale * (1.15 - state.confidence * 0.42));

    x += velocity * dt;
    p00 = p00 + dt * (p10 + p01) + dt * dt * p11 + q;
    p01 = p01 + dt * p11;
    p10 = p10 + dt * p11;
    p11 = p11 + q * 0.18;

    const innovation = measurement - x;
    const s = p00 + r;
    const k0 = p00 / s;
    const k1 = p10 / s;
    const oldP00 = p00;
    const oldP01 = p01;
    const oldP10 = p10;
    const oldP11 = p11;

    x += k0 * innovation;
    velocity += k1 * innovation;
    p00 = (1 - k0) * oldP00;
    p01 = (1 - k0) * oldP01;
    p10 = oldP10 - k1 * oldP00;
    p11 = oldP11 - k1 * oldP01;

    history.push({
      truth,
      measurement,
      estimate: x,
      variance: Math.max(0.003, p00),
      energy,
      bass
    });
    if (history.length > 180) history.shift();
  }

  function draw() {
    resizeCanvas();
    const w = canvas.width;
    const h = canvas.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const padX = 18 * dpr;
    const midY = h * 0.56;
    const scaleY = h * 0.28;
    const top = 0;

    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#061014');
    bg.addColorStop(0.5, '#08090d');
    bg.addColorStop(1, '#101314');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);

    drawGrid(w, h, dpr, midY, scaleY, energy);
    drawConfidenceBand(w, padX, midY, scaleY);
    drawSeries(w, padX, midY, scaleY, 'truth', '#64748b', 1.2 * dpr, 0.68);
    drawMeasurements(w, padX, midY, scaleY, dpr);
    drawSeries(w, padX, midY, scaleY, 'estimate', '#5eead4', 2.2 * dpr, 0.98);
    drawStateGlyph(w, h, dpr, midY, scaleY);
    drawLabels(w, h, dpr, top);

    energyBar.style.width = `${Math.round(energy * 100)}%`;
    bassBar.style.width = `${Math.round(bass * 100)}%`;
  }

  function drawGrid(w, h, dpr, midY, scaleY, amount) {
    g.save();
    g.lineWidth = dpr;
    g.strokeStyle = `rgba(45, 212, 191, ${0.08 + amount * 0.14})`;
    for (let xPos = 0; xPos < w; xPos += 28 * dpr) {
      g.beginPath();
      g.moveTo(xPos, 0);
      g.lineTo(xPos, h);
      g.stroke();
    }
    for (let y = -1; y <= 1; y += 0.5) {
      const yy = midY - y * scaleY;
      g.beginPath();
      g.moveTo(0, yy);
      g.lineTo(w, yy);
      g.stroke();
    }
    g.restore();
  }

  function drawConfidenceBand(w, padX, midY, scaleY) {
    g.save();
    g.beginPath();
    history.forEach((point, index) => {
      const xPos = padX + index / (history.length - 1) * (w - padX * 2);
      const y = midY - (point.estimate + Math.sqrt(point.variance) * 1.8) * scaleY;
      if (index === 0) g.moveTo(xPos, y);
      else g.lineTo(xPos, y);
    });
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const point = history[index];
      const xPos = padX + index / (history.length - 1) * (w - padX * 2);
      const y = midY - (point.estimate - Math.sqrt(point.variance) * 1.8) * scaleY;
      g.lineTo(xPos, y);
    }
    g.closePath();
    const fill = g.createLinearGradient(0, midY - scaleY, 0, midY + scaleY);
    fill.addColorStop(0, 'rgba(94, 234, 212, 0.16)');
    fill.addColorStop(1, 'rgba(251, 113, 133, 0.05)');
    g.fillStyle = fill;
    g.fill();
    g.restore();
  }

  function drawSeries(w, padX, midY, scaleY, key, color, lineWidth, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = lineWidth;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = color;
    g.beginPath();
    history.forEach((point, index) => {
      const xPos = padX + index / (history.length - 1) * (w - padX * 2);
      const y = midY - point[key] * scaleY;
      if (index === 0) g.moveTo(xPos, y);
      else g.lineTo(xPos, y);
    });
    g.stroke();
    g.restore();
  }

  function drawMeasurements(w, padX, midY, scaleY, dpr) {
    g.save();
    history.forEach((point, index) => {
      if (index % 3 !== 0) return;
      const xPos = padX + index / (history.length - 1) * (w - padX * 2);
      const y = midY - point.measurement * scaleY;
      const radius = (1.3 + point.energy * 2.4 + point.bass * 1.8) * dpr;
      g.fillStyle = `rgba(253, 224, 71, ${0.24 + point.energy * 0.52})`;
      g.beginPath();
      g.arc(xPos, y, radius, 0, Math.PI * 2);
      g.fill();
    });
    g.restore();
  }

  function drawStateGlyph(w, h, dpr, midY, scaleY) {
    const latest = history[history.length - 1];
    const xPos = w - 42 * dpr;
    const y = midY - latest.estimate * scaleY;
    const varianceRadius = Math.sqrt(latest.variance) * scaleY;
    const pulse = 1 + energy * 0.9 + bass * 0.8;

    g.save();
    g.strokeStyle = `rgba(94, 234, 212, ${0.32 + energy * 0.34})`;
    g.lineWidth = 1.2 * dpr;
    g.beginPath();
    g.arc(xPos, y, Math.max(9 * dpr, varianceRadius) * pulse, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = '#5eead4';
    g.shadowColor = '#5eead4';
    g.shadowBlur = (12 + energy * 28) * dpr;
    g.beginPath();
    g.arc(xPos, y, (4.5 + bass * 4.5) * dpr, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.strokeStyle = 'rgba(251, 113, 133, 0.68)';
    g.lineWidth = 1.4 * dpr;
    g.beginPath();
    g.moveTo(xPos - 18 * dpr, midY - latest.measurement * scaleY);
    g.lineTo(xPos + 18 * dpr, midY - latest.measurement * scaleY);
    g.stroke();
    g.restore();
  }

  function drawLabels(w, h, dpr) {
    g.save();
    g.font = `${10 * dpr}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    g.fillStyle = 'rgba(203, 213, 225, 0.78)';
    g.fillText('z noisy', 18 * dpr, h - 34 * dpr);
    g.fillStyle = '#5eead4';
    g.fillText('x estimate', 18 * dpr, h - 20 * dpr);
    g.fillStyle = 'rgba(100, 116, 139, 0.9)';
    g.fillText('truth', 104 * dpr, h - 20 * dpr);
    g.fillStyle = 'rgba(253, 224, 71, 0.9)';
    g.fillText('measurement', 154 * dpr, h - 20 * dpr);
    g.fillStyle = 'rgba(203, 213, 225, 0.72)';
    g.fillText(`gain ${energy.toFixed(2)}  bass ${bass.toFixed(2)}`, w - 174 * dpr, h - 20 * dpr);
    g.restore();
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  return {
    update() {
      const now = performance.now();
      const dt = clamp((now - lastTime) / 1000, 1 / 120, 1 / 24);
      lastTime = now;
      readAudio();
      stepFilter(dt);
      draw();
    },
    getState() {
      return {
        processNoise: state.processNoise,
        measurementNoise: state.measurementNoise,
        confidence: state.confidence,
        x,
        velocity,
        phase
      };
    },
    destroy() {
      if (master && typeof master.disconnect === 'function') {
        try { master.disconnect(analyser); } catch {}
      }
      try { analyser.disconnect(); } catch {}
    }
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function randomNormal() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
