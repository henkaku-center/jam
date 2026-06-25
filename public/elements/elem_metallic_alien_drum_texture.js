const STATE_VERSION = 'metallic-alien-drum-texture-v1';
const HIT_EVENT = 'metallicAlienDrums:hit';
const VOICES = ['core', 'shell', 'shard', 'vent', 'ping'];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const dom = ctx.domRoot;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: clamp(finite(prevState?.volume, 0.64), 0, 1.1),
    density: clamp(finite(prevState?.density, 0.58), 0, 1),
    alloy: clamp(finite(prevState?.alloy, 0.7), 0, 1),
    mutation: clamp(finite(prevState?.mutation, 0.42), 0, 1),
    decay: clamp(finite(prevState?.decay, 0.48), 0, 1),
    swing: clamp(finite(prevState?.swing, 0.12), 0, 0.38)
  };

  let destroyed = false;
  let activeStep = -1;
  let pulse = 0;
  let seed = 29;
  let lastUiStep = -1;
  const liveNodes = new Set();
  const cleanupTimers = new Set();

  const output = audio.createGain();
  const drumBus = audio.createGain();
  const metalBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const tone = audio.createBiquadFilter();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.9);
  const delayTone = audio.createBiquadFilter();
  const feedback = audio.createGain();
  const wet = audio.createGain();

  output.gain.value = state.running ? state.volume : 0;
  drumBus.gain.value = 0.92;
  metalBus.gain.value = 0.52;
  tone.type = 'bandpass';
  tone.frequency.value = 2100;
  tone.Q.value = 0.65;
  compressor.threshold.value = -18;
  compressor.knee.value = 16;
  compressor.ratio.value = 4.2;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.13;
  delay.delayTime.value = 0.165;
  delayTone.type = 'highpass';
  delayTone.frequency.value = 1200;
  feedback.gain.value = 0.2;
  wet.gain.value = 0.14;

  drumBus.connect(tone);
  metalBus.connect(tone);
  tone.connect(shaper);
  shaper.connect(output);
  metalBus.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);
  output.connect(compressor);
  compressor.connect(ctx.audioOut);

  const makeDriveCurve = () => {
    const amount = 1.4 + state.alloy * 9;
    const curve = new Float32Array(512);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * amount) * (0.72 + state.alloy * 0.16);
    }
    return curve;
  };

  const noiseBuffer = (() => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 1.1), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      last = last * 0.32 + (Math.random() * 2 - 1) * 0.68;
      data[index] = last;
    }
    return buffer;
  })();

  const updateAudio = () => {
    const now = audio.currentTime;
    output.gain.setTargetAtTime(state.running ? state.volume : 0, now, 0.018);
    tone.frequency.setTargetAtTime(1200 + state.alloy * 4400, now, 0.04);
    tone.Q.setTargetAtTime(0.45 + state.alloy * 1.2, now, 0.04);
    delay.delayTime.setTargetAtTime(0.105 + state.mutation * 0.13, now, 0.05);
    feedback.gain.setTargetAtTime(0.08 + state.decay * 0.24, now, 0.05);
    wet.gain.setTargetAtTime(0.05 + state.mutation * 0.18, now, 0.05);
    shaper.curve = makeDriveCurve();
    shaper.oversample = '2x';
  };

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try {
          if (typeof node.disconnect === 'function') node.disconnect();
        } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(100, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const safeTime = (time) => Math.max(Number(time) || audio.currentTime, audio.currentTime + 0.001);
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1 + seed * 0.13) * (89.31 + salt * 7.17)) * 43758.5453123;
    return raw - Math.floor(raw);
  };
  const maybePan = (node, pan, destination) => {
    if (typeof audio.createStereoPanner !== 'function') {
      node.connect(destination);
      return [];
    }
    const panner = audio.createStereoPanner();
    panner.pan.value = pan;
    node.connect(panner);
    panner.connect(destination);
    return [panner];
  };
  const publishHit = (voice, time, velocity) => {
    ctx.bus.pub(HIT_EVENT, { voice, time, velocity, step: activeStep, seed });
  };

  const playCore = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.18 + state.decay * 0.2;
    const osc = audio.createOscillator();
    const mod = audio.createOscillator();
    const modGain = audio.createGain();
    const gain = audio.createGain();
    const click = audio.createBufferSource();
    const clickFilter = audio.createBiquadFilter();
    const clickGain = audio.createGain();

    osc.type = 'sine';
    mod.type = 'square';
    osc.frequency.setValueAtTime(118 + state.alloy * 45, t);
    osc.frequency.exponentialRampToValueAtTime(38 + state.mutation * 10, t + length);
    mod.frequency.setValueAtTime(74 + state.alloy * 260, t);
    modGain.gain.setValueAtTime(24 + state.alloy * 85, t);
    modGain.gain.exponentialRampToValueAtTime(0.001, t + length * 0.85);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.78 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    click.buffer = noiseBuffer;
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(5200 + state.alloy * 3600, t);
    clickGain.gain.setValueAtTime(0.16 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(drumBus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(drumBus);
    osc.start(t);
    mod.start(t);
    click.start(t, 0, 0.035);
    osc.stop(t + length + 0.04);
    mod.stop(t + length + 0.04);
    track(length + 0.08, osc, mod, modGain, gain, click, clickFilter, clickGain);
    publishHit('core', t, velocity);
  };

  const playShell = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.1 + state.decay * 0.16;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const band = audio.createBiquadFilter();
    const gain = audio.createGain();
    const ring = audio.createOscillator();
    const ringGain = audio.createGain();

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(740 + state.alloy * 900, t);
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1700 + state.mutation * 1900, t);
    band.Q.setValueAtTime(1.1 + state.alloy * 1.3, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.38 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    ring.type = 'triangle';
    ring.frequency.setValueAtTime(235 + state.alloy * 430, t);
    ringGain.gain.setValueAtTime(0.12 * velocity, t);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(high);
    high.connect(band);
    band.connect(gain);
    gain.connect(drumBus);
    ring.connect(ringGain);
    ringGain.connect(metalBus);
    noise.start(t, 0, length + 0.04);
    ring.start(t);
    ring.stop(t + 0.16);
    track(length + 0.08, noise, high, band, gain, ring, ringGain);
    publishHit('shell', t, velocity);
  };

  const playShard = (time, velocity, open = false) => {
    const t = safeTime(time);
    const length = open ? 0.2 + state.decay * 0.2 : 0.035 + state.decay * 0.035;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const peak = audio.createBiquadFilter();
    const gain = audio.createGain();

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(open ? 3800 : 6800 + state.alloy * 1500, t);
    peak.type = 'bandpass';
    peak.frequency.setValueAtTime(8800 + state.mutation * 4200, t);
    peak.Q.setValueAtTime(open ? 0.85 : 2.2 + state.alloy * 1.2, t);
    gain.gain.setValueAtTime((open ? 0.15 : 0.09) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    noise.connect(high);
    high.connect(peak);
    peak.connect(gain);
    const extras = maybePan(gain, open ? 0.22 : -0.22 + randomFor(activeStep, 19) * 0.44, metalBus);
    noise.start(t, 0, length + 0.035);
    track(length + 0.08, noise, high, peak, gain, ...extras);
    publishHit(open ? 'vent' : 'shard', t, velocity);
  };

  const playPing = (time, velocity) => {
    const t = safeTime(time);
    const base = 520 + randomFor(activeStep, 41) * 1220 + state.alloy * 520;
    const length = 0.07 + state.decay * 0.08;
    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const band = audio.createBiquadFilter();
    const gain = audio.createGain();

    oscA.type = 'sine';
    oscB.type = 'sawtooth';
    oscA.frequency.setValueAtTime(base, t);
    oscB.frequency.setValueAtTime(base * (1.47 + state.mutation * 0.31), t);
    band.type = 'bandpass';
    band.frequency.setValueAtTime(base * 1.24, t);
    band.Q.setValueAtTime(6 + state.alloy * 7, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11 * velocity, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    oscA.connect(band);
    oscB.connect(band);
    band.connect(gain);
    const extras = maybePan(gain, -0.45 + randomFor(activeStep, 43) * 0.9, metalBus);
    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + length + 0.03);
    oscB.stop(t + length + 0.03);
    track(length + 0.07, oscA, oscB, band, gain, ...extras);
    publishHit('ping', t, velocity);
  };

  const threshold = (voice, step) => {
    const bar = step % 16;
    if (voice === 'core') return [0, 7, 8, 13].includes(bar) ? 0.24 : 0.92;
    if (voice === 'shell') return [4, 12].includes(bar) ? 0.18 : [3, 10, 15].includes(bar) ? 0.62 : 0.96;
    if (voice === 'shard') return bar % 2 === 0 ? 0.36 : 0.52;
    if (voice === 'vent') return [2, 6, 10, 14].includes(bar) ? 0.42 : 0.93;
    return [1, 5, 9, 11, 15].includes(bar) ? 0.46 : 0.84;
  };

  const playStep = ({ step, time, duration }) => {
    if (destroyed) return;
    activeStep = step % 16;
    seed = step % 64 === 0 ? seed + 1 : seed;
    pulse = 1;
    syncUi();
    if (!state.running) return;

    const stepSeconds = clamp(Number.isFinite(duration) ? duration : 0.125, 0.05, 0.45);
    const swingOffset = activeStep % 2 ? stepSeconds * state.swing : 0;
    const t = safeTime(time + swingOffset);
    const densityLift = 0.46 * state.density;
    const accent = activeStep % 4 === 0 ? 1.08 : activeStep % 2 === 0 ? 0.82 : 0.68;
    const human = (salt) => (randomFor(step, salt) - 0.5) * 0.007;

    if (randomFor(step, 1) > threshold('core', step) - densityLift) {
      playCore(t + human(3), clamp(accent * (0.72 + randomFor(step, 4) * 0.35), 0.05, 1.1));
    }
    if (randomFor(step, 7) > threshold('shell', step) - densityLift * 0.7) {
      playShell(t + human(8), clamp(0.66 + randomFor(step, 9) * 0.38, 0.05, 1));
    }
    if (randomFor(step, 13) > threshold('shard', step) - densityLift * 0.9) {
      playShard(t + human(14), clamp(0.42 + randomFor(step, 15) * 0.42, 0.05, 0.95), false);
    }
    if (randomFor(step, 17) > threshold('vent', step) - densityLift * 0.55) {
      playShard(t + stepSeconds * 0.04 + human(18), clamp(0.34 + randomFor(step, 20) * 0.44, 0.05, 0.9), true);
    }
    if (randomFor(step, 23) > threshold('ping', step) - state.mutation * 0.28) {
      playPing(t + stepSeconds * (0.18 + randomFor(step, 24) * 0.56), clamp(0.34 + randomFor(step, 25) * 0.5, 0.05, 0.9));
    }

    ctx.bus.pub('metallicAlienDrums:step', { step: activeStep, seed });
  };

  dom.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      * { box-sizing: border-box; }
      .panel {
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 218px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 9px;
        overflow: hidden;
        padding: 10px;
        color: #e5edf2;
        background:
          linear-gradient(145deg, rgba(11, 16, 20, 0.96), rgba(34, 39, 36, 0.96) 58%, rgba(22, 21, 28, 0.96));
        border: 1px solid rgba(174, 188, 196, 0.28);
        border-radius: 8px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 56px;
        gap: 8px;
        align-items: center;
      }
      h2 {
        margin: 0;
        color: #d9fff4;
        font: 800 14px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        height: 12px;
        margin-top: 4px;
        color: #8ea4a8;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        height: 28px;
        min-width: 0;
        border: 1px solid rgba(174, 188, 196, 0.32);
        border-radius: 5px;
        color: #d7fff6;
        background: rgba(12, 17, 20, 0.88);
        font: inherit;
        cursor: pointer;
      }
      button.on {
        color: #0b1114;
        background: #7dd3fc;
        border-color: #7dd3fc;
        font-weight: 800;
      }
      .matrix {
        min-height: 0;
        display: grid;
        grid-template-rows: repeat(5, minmax(0, 1fr));
        gap: 4px;
      }
      .lane {
        display: grid;
        grid-template-columns: 42px repeat(16, minmax(7px, 1fr));
        gap: 3px;
        align-items: stretch;
      }
      .label {
        display: grid;
        align-items: center;
        color: #bdc8c9;
        font-size: 9px;
        text-transform: uppercase;
      }
      .cell {
        min-width: 0;
        min-height: 10px;
        border: 1px solid rgba(83, 96, 101, 0.72);
        border-radius: 2px;
        background: rgba(5, 8, 10, 0.66);
      }
      .cell.seed {
        background: color-mix(in srgb, var(--voice-color) 48%, rgba(5, 8, 10, 0.66));
      }
      .cell.hot {
        background: var(--voice-color);
        box-shadow: 0 0 calc(3px + var(--pulse) * 12px) color-mix(in srgb, var(--voice-color) 65%, transparent);
      }
      .cell.now {
        outline: 2px solid #f5f0d8;
        outline-offset: -2px;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px 9px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 28px;
        gap: 5px;
        align-items: center;
        color: #c8d4d6;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #9be7c8;
      }
      .read {
        color: #f5f0d8;
        text-align: right;
        font-size: 10px;
      }
      @media (max-width: 360px) {
        .panel { min-width: 240px; padding: 8px; gap: 7px; }
        .lane { grid-template-columns: 36px repeat(16, minmax(5px, 1fr)); gap: 2px; }
        .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        label { grid-template-columns: 38px minmax(0, 1fr) 25px; font-size: 10px; }
      }
    </style>
    <div class="panel">
      <div class="top">
        <div>
          <h2>Metallic Alien Drums</h2>
          <div class="sub">generative alloy impacts, vents, shards</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div id="matrix" class="matrix"></div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal" class="read"></span></label>
        <label>dens <input id="density" type="range" min="0" max="1" step="0.01"><span id="densityVal" class="read"></span></label>
        <label>alloy <input id="alloy" type="range" min="0" max="1" step="0.01"><span id="alloyVal" class="read"></span></label>
        <label>mut <input id="mutation" type="range" min="0" max="1" step="0.01"><span id="mutationVal" class="read"></span></label>
        <label>decay <input id="decay" type="range" min="0" max="1" step="0.01"><span id="decayVal" class="read"></span></label>
        <label>swing <input id="swing" type="range" min="0" max="0.38" step="0.01"><span id="swingVal" class="read"></span></label>
      </div>
    </div>
  `;

  const $ = (selector) => dom.querySelector(selector);
  const runButton = $('#run');
  const matrix = $('#matrix');
  const sliders = {
    volume: $('#volume'),
    density: $('#density'),
    alloy: $('#alloy'),
    mutation: $('#mutation'),
    decay: $('#decay'),
    swing: $('#swing')
  };
  const readouts = {
    volume: $('#volumeVal'),
    density: $('#densityVal'),
    alloy: $('#alloyVal'),
    mutation: $('#mutationVal'),
    decay: $('#decayVal'),
    swing: $('#swingVal')
  };

  const voiceColors = {
    core: '#f97373',
    shell: '#7dd3fc',
    shard: '#f5f0d8',
    vent: '#9be7c8',
    ping: '#c4b5fd'
  };
  const cells = new Map();
  VOICES.forEach((voice) => {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.style.setProperty('--voice-color', voiceColors[voice]);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = voice;
    lane.append(label);
    const row = [];
    for (let index = 0; index < 16; index += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      lane.append(cell);
      row.push(cell);
    }
    matrix.append(lane);
    cells.set(voice, row);
  });

  const syncUi = () => {
    runButton.textContent = state.running ? 'on' : 'off';
    runButton.classList.toggle('on', state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (document.activeElement !== slider) slider.value = String(state[key]);
      readouts[key].textContent = state[key].toFixed(key === 'volume' ? 2 : 1);
    });
    if (activeStep !== lastUiStep) {
      VOICES.forEach((voice) => {
        const row = cells.get(voice);
        row.forEach((cell, index) => cell.classList.toggle('now', index === activeStep));
      });
      lastUiStep = activeStep;
    }
  };

  const refreshMatrix = () => {
    for (let step = 0; step < 16; step += 1) {
      VOICES.forEach((voice, voiceIndex) => {
        const cell = cells.get(voice)[step];
        const chance = randomFor(step, 100 + voiceIndex) > threshold(voice, step) - state.density * 0.34;
        cell.classList.toggle('seed', chance);
      });
    }
  };

  const onRun = () => {
    state.running = !state.running;
    updateAudio();
    syncUi();
  };
  runButton.addEventListener('click', onRun);

  const onSlider = (event) => {
    const key = event.currentTarget.id;
    state[key] = Number(event.currentTarget.value);
    if (key === 'density' || key === 'mutation') refreshMatrix();
    updateAudio();
    syncUi();
  };
  Object.values(sliders).forEach((slider) => slider.addEventListener('input', onSlider));

  const unsubscribeTick = ctx.clock.onTick(playStep);
  updateAudio();
  refreshMatrix();
  syncUi();

  return {
    update() {
      pulse = Math.max(0, pulse * 0.9 - 0.008);
      if (!matrix) return;
      dom.querySelector('.panel')?.style.setProperty('--pulse', pulse.toFixed(3));
      if (activeStep >= 0) {
        VOICES.forEach((voice, voiceIndex) => {
          const row = cells.get(voice);
          row.forEach((cell, index) => {
            const active = index === activeStep && cell.classList.contains('seed');
            cell.classList.toggle('hot', active && pulse > 0.08 + voiceIndex * 0.012);
          });
        });
      }
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      runButton.removeEventListener('click', onRun);
      Object.values(sliders).forEach((slider) => slider.removeEventListener('input', onSlider));
      unsubscribeTick();
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      liveNodes.forEach((node) => {
        try {
          if (typeof node.stop === 'function') node.stop();
        } catch (_) {}
        try {
          if (typeof node.disconnect === 'function') node.disconnect();
        } catch (_) {}
      });
      liveNodes.clear();
      [drumBus, metalBus, shaper, tone, delay, delayTone, feedback, wet, output, compressor].forEach((node) => {
        try {
          node.disconnect();
        } catch (_) {}
      });
    }
  };
}
