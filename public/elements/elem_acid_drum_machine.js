const STATE_VERSION = 'acid-drum-machine-v1';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.78),
    drive: finite(prevState?.drive, 0.58),
    squelch: finite(prevState?.squelch, 0.72),
    decay: finite(prevState?.decay, 0.54),
    shuffle: finite(prevState?.shuffle, 0.38),
    pattern: Number.isInteger(prevState?.pattern) ? clamp(prevState.pattern, 0, 2) : 0
  };

  const audio = ctx.audioCtx;
  const master = audio.createGain();
  const drumBus = audio.createGain();
  const acidBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.8);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  master.gain.value = state.running ? state.volume : 0;
  drumBus.gain.value = 0.92;
  acidBus.gain.value = 0.42;
  compressor.threshold.value = -17;
  compressor.knee.value = 14;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.14;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.22;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3400;
  wet.gain.value = 0.18;

  drumBus.connect(shaper);
  acidBus.connect(shaper);
  shaper.connect(master);
  acidBus.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let clockStepSeconds = 0.125;
  let destroyed = false;

  const patterns = [
    {
      name: 'classic',
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.8, 0, 1, 0, 0.7, 0],
      snare: [0, 0, 0, 0, 0.78, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.38, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0.3, 0],
      hat: [0.38, 0.22, 0.36, 0.2, 0.42, 0.22, 0.32, 0.24, 0.4, 0.2, 0.36, 0.22, 0.45, 0.22, 0.34, 0.28],
      acid: [36, null, 43, 36, null, 48, null, 46, 36, null, 43, null, 39, null, 46, 48]
    },
    {
      name: 'warehouse',
      kick: [1, 0, 0.45, 0, 1, 0, 0, 0.35, 1, 0, 0.5, 0, 1, 0.25, 0, 0.45],
      snare: [0, 0, 0, 0, 0.86, 0, 0, 0.22, 0, 0, 0, 0, 0.9, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.52, 0.16, 0, 0, 0, 0, 0, 0, 0.56, 0.18, 0, 0.22],
      hat: [0.34, 0.3, 0.42, 0.26, 0.36, 0.32, 0.48, 0.26, 0.34, 0.3, 0.46, 0.24, 0.38, 0.32, 0.5, 0.28],
      acid: [36, 36, null, 43, 39, null, 46, null, 36, null, 48, 46, null, 43, 39, null]
    },
    {
      name: 'breaker',
      kick: [1, 0, 0, 0.55, 0, 0.8, 0, 0, 1, 0, 0.42, 0, 0, 0.75, 0.35, 0],
      snare: [0, 0, 0, 0, 0.88, 0, 0, 0, 0, 0, 0, 0.22, 0.86, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.4, 0, 0.24, 0, 0, 0, 0, 0, 0.46, 0, 0.26, 0],
      hat: [0.34, 0.28, 0.2, 0.48, 0.38, 0.25, 0.5, 0.2, 0.34, 0.28, 0.44, 0.22, 0.4, 0.24, 0.58, 0.3],
      acid: [36, null, 36, 43, null, 39, 46, null, 36, 43, null, 48, 46, null, 39, 43]
    }
  ];

  const makeDriveCurve = () => {
    const amount = 1.4 + state.drive * 8;
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) * (0.78 + state.drive * 0.14);
    }
    return curve;
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.45), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.16 + (Math.random() * 2 - 1) * 0.84;
      data[i] = last;
    }
    return buffer;
  };

  const noiseBuffer = makeNoiseBuffer();

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  };

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const playKick = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.18 + state.decay * 0.24;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const click = audio.createBufferSource();
    const clickGain = audio.createGain();
    const clickFilter = audio.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(118 + velocity * 35, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    click.buffer = noiseBuffer;
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 5200;
    clickGain.gain.setValueAtTime(0.18 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

    osc.connect(gain);
    gain.connect(drumBus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(drumBus);
    osc.start(t);
    osc.stop(t + length + 0.04);
    click.start(t);
    click.stop(t + 0.04);
    track(length + 0.08, osc, gain, click, clickGain, clickFilter);
  };

  const playSnare = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.1 + state.decay * 0.16;
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1700 + state.squelch * 900;
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.45 * velocity, t + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    body.type = 'triangle';
    body.frequency.setValueAtTime(178, t);
    body.frequency.exponentialRampToValueAtTime(132, t + 0.08);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.16 * velocity, t + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(drumBus);
    body.connect(bodyGain);
    bodyGain.connect(drumBus);
    noise.start(t);
    noise.stop(t + length + 0.03);
    body.start(t);
    body.stop(t + 0.16);
    track(length + 0.08, noise, noiseFilter, noiseGain, body, bodyGain);
  };

  const playClap = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const filter = audio.createBiquadFilter();
    const output = audio.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1450;
    filter.Q.value = 1.1;
    output.connect(drumBus);
    filter.connect(output);

    [0, 0.014, 0.028].forEach((offset, index) => {
      const src = audio.createBufferSource();
      const gain = audio.createGain();
      src.buffer = noiseBuffer;
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime((0.19 - index * 0.035) * velocity, t + offset + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.055 + state.decay * 0.03);
      src.connect(gain);
      gain.connect(filter);
      src.start(t + offset);
      src.stop(t + offset + 0.12);
      track(0.18, src, gain);
    });
    track(0.2, filter, output);
  };

  const playHat = (time, velocity, open = false) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = open ? 0.16 + state.decay * 0.18 : 0.035 + state.decay * 0.05;
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    src.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 6200 + state.squelch * 2800;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((open ? 0.15 : 0.105) * velocity, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(drumBus);
    src.start(t);
    src.stop(t + length + 0.03);
    track(length + 0.08, src, filter, gain);
  };

  const playAcid = (time, midi, velocity, accent) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = clockStepSeconds * (0.62 + state.decay * 0.48);
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const sub = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    osc.type = 'sawtooth';
    sub.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);
    osc.detune.setValueAtTime(accent ? 8 : -5, t);
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(8 + state.squelch * 16, t);
    filter.frequency.setValueAtTime(360 + state.squelch * 5400 + accent * 1500, t);
    filter.frequency.exponentialRampToValueAtTime(130 + state.squelch * 620, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((accent ? 0.38 : 0.23) * velocity, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(acidBus);
    osc.start(t);
    sub.start(t);
    osc.stop(t + length + 0.05);
    sub.stop(t + length + 0.05);
    track(length + 0.1, osc, sub, filter, gain);
  };

  const syncAudio = () => {
    shaper.curve = makeDriveCurve();
    shaper.oversample = '2x';
    master.gain.setTargetAtTime(state.running ? state.volume : 0, audio.currentTime, 0.02);
    acidBus.gain.setTargetAtTime(0.25 + state.squelch * 0.34, audio.currentTime, 0.04);
    wet.gain.setTargetAtTime(0.08 + state.squelch * 0.18, audio.currentTime, 0.04);
    feedback.gain.setTargetAtTime(0.1 + state.drive * 0.18, audio.currentTime, 0.04);
  };

  const handleTick = ({ step, time, duration }) => {
    if (destroyed) return;
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    render();
    if (!state.running) return;

    const pattern = patterns[state.pattern] || patterns[0];
    const swing = currentStep % 2 ? clockStepSeconds * state.shuffle * 0.22 : 0;
    const t = time + swing;
    const accent = currentStep % 4 === 0 ? 1 : 0;

    delay.delayTime.setTargetAtTime(clockStepSeconds * (1.2 + state.shuffle * 0.8), audio.currentTime, 0.03);

    if (pattern.kick[currentStep]) playKick(t, pattern.kick[currentStep] * (accent ? 1.08 : 0.9));
    if (pattern.snare[currentStep]) playSnare(t, pattern.snare[currentStep]);
    if (pattern.clap[currentStep]) playClap(t + 0.004, pattern.clap[currentStep]);
    if (pattern.hat[currentStep]) playHat(t, pattern.hat[currentStep], currentStep % 8 === 6 || currentStep === 15);
    if (pattern.acid[currentStep] !== null) {
      playAcid(t + clockStepSeconds * 0.018, pattern.acid[currentStep], 0.75 + accent * 0.25, Boolean(accent));
    }
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .acid {
        box-sizing: border-box;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 9px;
        overflow: hidden;
        color: #eef2ff;
        background:
          linear-gradient(135deg, rgba(11, 14, 18, 0.98), rgba(18, 24, 20, 0.98) 56%, rgba(27, 22, 14, 0.98)),
          repeating-linear-gradient(90deg, rgba(251, 191, 36, 0.08) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(250, 204, 21, 0.5);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      h2 {
        margin: 0;
        color: #fde68a;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 2px;
        color: #94a3b8;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button,
      select,
      input {
        font: inherit;
      }
      button {
        height: 28px;
        min-width: 50px;
        color: #0f172a;
        background: #facc15;
        border: 1px solid rgba(254, 240, 138, 0.72);
        border-radius: 5px;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.8);
        border-color: rgba(148, 163, 184, 0.42);
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 10px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #facc15;
      }
      .pattern {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      select {
        min-width: 0;
        height: 24px;
        color: #fefce8;
        background: rgba(2, 6, 23, 0.72);
        border: 1px solid rgba(250, 204, 21, 0.36);
        border-radius: 5px;
      }
      .grid {
        min-height: 0;
        display: grid;
        grid-template-rows: repeat(5, minmax(0, 1fr));
        gap: 4px;
      }
      .row {
        min-height: 0;
        display: grid;
        grid-template-columns: 36px repeat(16, minmax(8px, 1fr));
        gap: 3px;
        align-items: stretch;
      }
      .name {
        color: #94a3b8;
        display: grid;
        align-items: center;
        font-size: 9px;
      }
      .cell {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.82);
        border-radius: 3px;
        opacity: 0.48;
      }
      .cell.on.kick { background: #f43f5e; border-color: rgba(251, 113, 133, 0.74); }
      .cell.on.snare { background: #22d3ee; border-color: rgba(103, 232, 249, 0.72); }
      .cell.on.hat { background: #eab308; border-color: rgba(254, 240, 138, 0.68); }
      .cell.on.acid { background: #84cc16; border-color: rgba(190, 242, 100, 0.72); }
      .cell.on.clap { background: #a78bfa; border-color: rgba(196, 181, 253, 0.72); }
      .cell.play {
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 0 10px rgba(250, 204, 21, 0.62);
      }
    </style>
    <div class="acid">
      <div class="top">
        <div>
          <h2>Acid Drum</h2>
          <div class="sub">clocked 909 grit with a resonant pulse</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.2" step="0.01"><span id="volumeVal"></span></label>
        <label>drive <input id="drive" type="range" min="0" max="1" step="0.01"><span id="driveVal"></span></label>
        <label>squelch <input id="squelch" type="range" min="0" max="1" step="0.01"><span id="squelchVal"></span></label>
        <label>decay <input id="decay" type="range" min="0" max="1" step="0.01"><span id="decayVal"></span></label>
      </div>
      <div class="pattern">
        <span>mode</span>
        <select id="pattern">
          <option value="0">classic</option>
          <option value="1">warehouse</option>
          <option value="2">breaker</option>
        </select>
      </div>
      <div id="grid" class="grid"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const gridEl = $('#grid');
  const patternSelect = $('#pattern');
  const sliders = {
    volume: $('#volume'),
    drive: $('#drive'),
    squelch: $('#squelch'),
    decay: $('#decay')
  };
  const values = {
    volume: $('#volumeVal'),
    drive: $('#driveVal'),
    squelch: $('#squelchVal'),
    decay: $('#decayVal')
  };

  const renderGrid = () => {
    const pattern = patterns[state.pattern] || patterns[0];
    const rows = [
      ['kick', 'kick', pattern.kick],
      ['snare', 'snare', pattern.snare],
      ['clap', 'clap', pattern.clap],
      ['hat', 'hat', pattern.hat],
      ['acid', 'acid', pattern.acid]
    ];
    gridEl.innerHTML = rows.map(([label, className, row]) => `
      <div class="row">
        <div class="name">${label}</div>
        ${row.map((value, index) => `<div class="cell ${className} ${value ? 'on' : ''} ${index === currentStep ? 'play' : ''}"></div>`).join('')}
      </div>
    `).join('');
  };

  const render = () => {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    patternSelect.value = String(state.pattern);
    Object.entries(sliders).forEach(([key, input]) => {
      if (input.value !== String(state[key])) input.value = String(state[key]);
      values[key].textContent = state[key].toFixed(2);
    });
    renderGrid();
  };

  const onRun = () => {
    state.running = !state.running;
    syncAudio();
    render();
  };

  const onPattern = () => {
    state.pattern = clamp(Number(patternSelect.value), 0, patterns.length - 1);
    render();
  };

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  patternSelect.addEventListener('change', onPattern);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(handleTick);
  syncAudio();
  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      patternSelect.removeEventListener('change', onPattern);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        master.disconnect(); drumBus.disconnect(); acidBus.disconnect(); shaper.disconnect();
        compressor.disconnect(); delay.disconnect(); feedback.disconnect(); delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
