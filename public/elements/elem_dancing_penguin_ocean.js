const STATE_VERSION = 'dancing-penguin-ocean-v1';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.82),
    waves: finite(prevState?.waves, 0.72),
    melody: finite(prevState?.melody, 0.68),
    dance: finite(prevState?.dance, 0.78),
    sparkle: finite(prevState?.sparkle, 0.56)
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; }
      .penguin {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 340px;
        min-height: 250px;
        overflow: hidden;
        border: 1px solid rgba(125, 211, 252, 0.5);
        border-radius: 8px;
        background: #061827;
        color: #ecfeff;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
        bottom: 10px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 9px;
        align-items: end;
      }
      .panel {
        min-width: 0;
        padding: 8px;
        border: 1px solid rgba(224, 242, 254, 0.22);
        border-radius: 8px;
        background: rgba(3, 7, 18, 0.62);
        backdrop-filter: blur(8px);
      }
      h2 {
        margin: 0 0 6px;
        color: #e0f2fe;
        font: 800 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 7px;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 3px;
        color: #bae6fd;
        font-size: 9px;
      }
      input {
        width: 100%;
        min-width: 0;
        accent-color: #38bdf8;
      }
      button {
        width: 58px;
        height: 34px;
        color: #082f49;
        background: #7dd3fc;
        border: 1px solid #e0f2fe;
        border-radius: 7px;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #dbeafe;
        background: rgba(15, 23, 42, 0.82);
        border-color: rgba(186, 230, 253, 0.34);
      }
    </style>
    <div class="penguin">
      <canvas id="canvas" aria-label="Dancing penguin ocean scene"></canvas>
      <div class="hud">
        <div class="panel">
          <h2>Penguin Tide</h2>
          <div class="controls">
            <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"></label>
            <label>waves <input id="waves" type="range" min="0" max="1" step="0.01"></label>
            <label>melody <input id="melody" type="range" min="0" max="1" step="0.01"></label>
            <label>dance <input id="dance" type="range" min="0" max="1" step="0.01"></label>
            <label>glint <input id="sparkle" type="range" min="0" max="1" step="0.01"></label>
          </div>
        </div>
        <button id="run" type="button"></button>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#canvas');
  const g = canvas.getContext('2d');
  const runButton = ctx.domRoot.querySelector('#run');
  const sliders = {
    volume: ctx.domRoot.querySelector('#volume'),
    waves: ctx.domRoot.querySelector('#waves'),
    melody: ctx.domRoot.querySelector('#melody'),
    dance: ctx.domRoot.querySelector('#dance'),
    sparkle: ctx.domRoot.querySelector('#sparkle')
  };

  const master = audio.createGain();
  const dry = audio.createGain();
  const ocean = audio.createGain();
  const delay = audio.createDelay(0.9);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const compressor = audio.createDynamicsCompressor();

  master.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 0.9;
  ocean.gain.value = state.waves * 0.32;
  delay.delayTime.value = 0.27;
  feedback.gain.value = 0.24;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 4300;
  wet.gain.value = 0.22;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  dry.connect(master);
  dry.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);
  ocean.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let beatPulse = 0;
  let hatPulse = 0;
  let bubbleSeed = 0;
  let destroyed = false;

  function makeNoiseBuffer(seconds = 1.2) {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  const noiseBuffer = makeNoiseBuffer();
  const oceanSource = audio.createBufferSource();
  const oceanFilter = audio.createBiquadFilter();
  const oceanLfo = audio.createOscillator();
  const oceanLfoGain = audio.createGain();

  oceanSource.buffer = noiseBuffer;
  oceanSource.loop = true;
  oceanFilter.type = 'lowpass';
  oceanFilter.frequency.value = 620;
  oceanFilter.Q.value = 0.55;
  oceanLfo.type = 'sine';
  oceanLfo.frequency.value = 0.13;
  oceanLfoGain.gain.value = 360;
  oceanLfo.connect(oceanLfoGain);
  oceanLfoGain.connect(oceanFilter.frequency);
  oceanSource.connect(oceanFilter);
  oceanFilter.connect(ocean);
  oceanSource.start();
  oceanLfo.start();

  function track(seconds, ...nodes) {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  }

  function syncAudio() {
    const t = audio.currentTime;
    master.gain.setTargetAtTime(state.running ? state.volume : 0, t, 0.025);
    ocean.gain.setTargetAtTime(state.waves * 0.32, t, 0.05);
    wet.gain.setTargetAtTime(0.12 + state.sparkle * 0.24, t, 0.04);
    feedback.gain.setTargetAtTime(0.12 + state.sparkle * 0.28, t, 0.04);
    delayTone.frequency.setTargetAtTime(2200 + state.sparkle * 5200, t, 0.04);
  }

  function playBell(time, midi, velocity, length = 0.42) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const mod = audio.createOscillator();
    const modGain = audio.createGain();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();

    osc.type = 'sine';
    mod.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    mod.frequency.setValueAtTime(freq * 2.01, t);
    modGain.gain.setValueAtTime(freq * (0.35 + state.sparkle * 0.42), t);
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(260, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13 * velocity * state.melody, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    osc.start(t);
    mod.start(t);
    osc.stop(t + length + 0.12);
    mod.stop(t + length + 0.12);
    track(length + 0.25, osc, mod, modGain, filter, gain);
  }

  function playBass(time, midi, velocity) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16 * velocity, t + 0.012);
    gain.gain.setTargetAtTime(0.0001, t + 0.28, 0.08);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    osc.start(t);
    osc.stop(t + 0.7);
    track(0.85, osc, filter, gain);
  }

  function playSplash(time, velocity) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200 + state.sparkle * 1600, t);
    filter.Q.setValueAtTime(0.8, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13 * velocity * state.waves, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    src.start(t);
    src.stop(t + 0.2);
    track(0.28, src, filter, gain);
  }

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, dpr };
  }

  function drawPenguin(cx, cy, scale, t) {
    const dance = Math.sin(t * 7.5) * (10 + state.dance * 16) + beatPulse * 15;
    const bob = Math.sin(t * 9) * (5 + state.dance * 5) - beatPulse * 10;
    const tilt = Math.sin(t * 4.2) * 0.18 * state.dance;
    g.save();
    g.translate(cx, cy + bob);
    g.rotate(tilt);
    g.scale(scale, scale);

    g.fillStyle = '#f97316';
    g.beginPath();
    g.ellipse(-25, 82, 26, 9, 0.08, 0, Math.PI * 2);
    g.ellipse(25, 82, 26, 9, -0.08, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#07111f';
    g.beginPath();
    g.ellipse(0, 18, 64, 82, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#f8fafc';
    g.beginPath();
    g.ellipse(0, 35, 42, 58, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#07111f';
    g.beginPath();
    g.ellipse(0, -48, 48, 44, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#f8fafc';
    g.beginPath();
    g.arc(-16, -52, 13, 0, Math.PI * 2);
    g.arc(16, -52, 13, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#020617';
    g.beginPath();
    g.arc(-14, -52, 5, 0, Math.PI * 2);
    g.arc(18, -52, 5, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = '#fb923c';
    g.beginPath();
    g.moveTo(-9, -35);
    g.lineTo(13, -35);
    g.lineTo(0, -22);
    g.closePath();
    g.fill();

    g.strokeStyle = '#07111f';
    g.lineWidth = 16;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-54, 10);
    g.quadraticCurveTo(-90, 18 + dance, -94, 46 + dance * 0.3);
    g.moveTo(54, 10);
    g.quadraticCurveTo(90, 18 - dance, 94, 46 - dance * 0.3);
    g.stroke();

    g.strokeStyle = 'rgba(125, 211, 252, 0.72)';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, 6, 72 + hatPulse * 14, 0.12, Math.PI - 0.12);
    g.stroke();
    g.restore();
  }

  function draw() {
    if (destroyed) return;
    const { width: w, height: h, dpr } = resizeCanvas();
    const t = performance.now() * 0.001;
    const horizon = h * 0.55;

    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0c4a6e');
    sky.addColorStop(0.48, '#38bdf8');
    sky.addColorStop(1, '#083344');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);

    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (let i = 0; i < 26; i += 1) {
      const x = (i * 83 + Math.sin(t * 0.6 + i) * 18) % w;
      const y = h * (0.1 + (i % 7) * 0.055);
      g.beginPath();
      g.arc(x, y, (1.4 + (i % 4)) * dpr, 0, Math.PI * 2);
      g.fill();
    }

    const sea = g.createLinearGradient(0, horizon, 0, h);
    sea.addColorStop(0, '#0369a1');
    sea.addColorStop(1, '#082f49');
    g.fillStyle = sea;
    g.fillRect(0, horizon, w, h - horizon);

    for (let band = 0; band < 6; band += 1) {
      const y = horizon + band * h * 0.08 + Math.sin(t * 1.2 + band) * 5 * dpr;
      g.strokeStyle = `rgba(224, 242, 254, ${0.16 + band * 0.035})`;
      g.lineWidth = (2 + band * 0.35) * dpr;
      g.beginPath();
      for (let x = -20 * dpr; x <= w + 20 * dpr; x += 16 * dpr) {
        const wave = Math.sin(x * 0.014 / dpr + t * (1.7 + band * 0.15) + band) * (7 + state.waves * 12) * dpr;
        if (x < -10 * dpr) g.moveTo(x, y + wave);
        else g.lineTo(x, y + wave);
      }
      g.stroke();
    }

    g.fillStyle = '#f8fafc';
    g.beginPath();
    g.ellipse(w * 0.5, h * 0.84, w * 0.22, h * 0.045, 0, 0, Math.PI * 2);
    g.fill();

    for (let i = 0; i < 18; i += 1) {
      const phase = (t * (0.08 + i * 0.005) + i * 0.17 + bubbleSeed) % 1;
      const x = (w * (0.1 + ((i * 0.37) % 0.82)) + Math.sin(t + i) * 16 * dpr);
      const y = h * (1.05 - phase * 0.78);
      const r = (2 + (i % 5) + hatPulse * 4) * dpr;
      g.strokeStyle = `rgba(186, 230, 253, ${0.18 + phase * 0.38})`;
      g.lineWidth = dpr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.stroke();
    }

    drawPenguin(w * 0.5, h * 0.58, Math.min(w, h) / 390, t);
  }

  function onRun() {
    state.running = !state.running;
    syncAudio();
    render();
  }

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const melody = [71, 74, 78, 81, 78, 74, 73, null, 69, 73, 76, 78, 76, 74, 71, null];
  const bass = [47, null, 54, null, 52, null, 54, null, 45, null, 52, null, 50, null, 54, null];

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = ((step % 16) + 16) % 16;
    beatPulse = Math.max(beatPulse, currentStep % 4 === 0 ? 1 : 0.45);
    if (!state.running) {
      render();
      return;
    }

    if (currentStep % 4 === 0) playSplash(time, 0.9);
    if (currentStep % 2 === 1) {
      playSplash(time + duration * 0.06, 0.38);
      hatPulse = Math.max(hatPulse, 0.72);
    }
    if (bass[currentStep] !== null) playBass(time, bass[currentStep], 0.72);
    if (melody[currentStep] !== null) {
      playBell(time + (currentStep % 2 ? duration * 0.04 : 0), melody[currentStep], 0.72, duration * 1.25);
    }
    if (currentStep % 8 === 6 && state.sparkle > 0.35) {
      playBell(time + duration * 0.25, melody[(currentStep + 2) % melody.length] || 78, 0.42, duration * 0.8);
    }
    bubbleSeed = (bubbleSeed + 0.037) % 1;
    render();
  });

  syncAudio();
  render();
  draw();

  return {
    update() {
      beatPulse *= 0.88;
      hatPulse *= 0.78;
      draw();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try { oceanSource.stop(); } catch (_) {}
      try { oceanLfo.stop(); } catch (_) {}
      try {
        oceanSource.disconnect();
        oceanFilter.disconnect();
        oceanLfo.disconnect();
        oceanLfoGain.disconnect();
        master.disconnect();
        dry.disconnect();
        ocean.disconnect();
        delay.disconnect();
        feedback.disconnect();
        delayTone.disconnect();
        wet.disconnect();
        compressor.disconnect();
      } catch (_) {}
    }
  };
}
