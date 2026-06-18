const STATE_VERSION = 'step-drum-machine-v1';
const GLOBAL_KEY = 'stepDrumMachine:v1';
const HIT_EVENT = 'stepDrumMachine:hit';

const VOICES = [
  { id: 'kick', label: 'KICK', short: 'KCK', quiet: 0.58, loud: 1 },
  { id: 'snare', label: 'SNARE', short: 'SNR', quiet: 0.52, loud: 0.9 },
  { id: 'clap', label: 'CLAP', short: 'CLP', quiet: 0.44, loud: 0.78 },
  { id: 'hat', label: 'HAT', short: 'HAT', quiet: 0.34, loud: 0.62 },
  { id: 'openHat', label: 'OPEN', short: 'OPN', quiet: 0.45, loud: 0.76 }
];

const PRESETS = [
  {
    name: 'electro',
    pattern: {
      kick: [1, 0, 0, 0.34, 0.88, 0, 0.25, 0, 1, 0, 0.34, 0, 0.9, 0, 0, 0.42],
      snare: [0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0, 0.18, 0.88, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.42, 0, 0, 0, 0, 0, 0, 0, 0.48, 0, 0.22, 0],
      hat: [0.42, 0.24, 0.38, 0.28, 0.44, 0.24, 0.4, 0.3, 0.44, 0.24, 0.38, 0.28, 0.46, 0.24, 0.4, 0.36],
      openHat: [0, 0, 0.48, 0, 0, 0, 0.56, 0, 0, 0, 0.46, 0, 0, 0, 0.62, 0]
    }
  },
  {
    name: 'house',
    pattern: {
      kick: [1, 0, 0, 0, 0.94, 0, 0, 0, 1, 0, 0, 0, 0.94, 0, 0, 0],
      snare: [0, 0, 0, 0, 0.82, 0, 0, 0, 0, 0, 0, 0, 0.86, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0, 0, 0, 0.64, 0, 0, 0],
      hat: [0, 0.38, 0, 0.42, 0, 0.4, 0, 0.48, 0, 0.38, 0, 0.42, 0, 0.4, 0, 0.54],
      openHat: [0, 0, 0.58, 0, 0, 0, 0.62, 0, 0, 0, 0.58, 0, 0, 0, 0.66, 0]
    }
  },
  {
    name: 'break',
    pattern: {
      kick: [1, 0, 0, 0.62, 0, 0.82, 0, 0, 0.95, 0, 0.38, 0, 0, 0.76, 0.42, 0],
      snare: [0, 0, 0, 0, 0.9, 0, 0, 0.18, 0, 0, 0, 0, 0.88, 0, 0.24, 0],
      clap: [0, 0, 0, 0, 0.34, 0, 0.24, 0, 0, 0, 0, 0, 0.36, 0, 0.26, 0],
      hat: [0.36, 0.22, 0.46, 0.3, 0.38, 0.24, 0.54, 0.2, 0.36, 0.24, 0.48, 0.32, 0.4, 0.24, 0.58, 0.34],
      openHat: [0, 0, 0, 0.34, 0, 0, 0.48, 0, 0, 0, 0, 0.38, 0, 0, 0.56, 0]
    }
  }
];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const dom = ctx.domRoot;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const safeTime = (time) => Math.max(Number(time) || audio.currentTime, audio.currentTime + 0.001);

  const clonePattern = (pattern) => {
    const source = pattern && typeof pattern === 'object' ? pattern : PRESETS[0].pattern;
    const next = {};
    VOICES.forEach((voice) => {
      const steps = Array.isArray(source[voice.id]) ? source[voice.id] : PRESETS[0].pattern[voice.id];
      next[voice.id] = Array.from({ length: 16 }, (_, index) => clamp(Number(steps[index]) || 0, 0, 1));
    });
    return next;
  };

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.78),
    swing: finite(prevState?.swing, 0.14),
    decay: finite(prevState?.decay, 0.52),
    tone: finite(prevState?.tone, 0.58),
    drive: finite(prevState?.drive, 0.26),
    accent: finite(prevState?.accent, 0.22),
    preset: Number.isInteger(prevState?.preset) ? clamp(prevState.preset, 0, PRESETS.length - 1) : 0,
    pattern: clonePattern(prevState?.stateVersion === STATE_VERSION ? prevState.pattern : PRESETS[0].pattern)
  };

  const master = audio.createGain();
  const drumBus = audio.createGain();
  const toneFilter = audio.createBiquadFilter();
  const shaper = audio.createWaveShaper();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.6);
  const delayFilter = audio.createBiquadFilter();
  const feedback = audio.createGain();
  const wet = audio.createGain();

  master.gain.value = state.running ? state.volume : 0;
  drumBus.gain.value = 0.86;
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 5200 + state.tone * 7600;
  toneFilter.Q.value = 0.3 + state.tone * 0.8;
  compressor.threshold.value = -17;
  compressor.knee.value = 16;
  compressor.ratio.value = 3.8;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.14;
  delay.delayTime.value = 0.145;
  delayFilter.type = 'highpass';
  delayFilter.frequency.value = 900;
  feedback.gain.value = 0.18;
  wet.gain.value = 0.1;

  drumBus.connect(toneFilter);
  toneFilter.connect(shaper);
  shaper.connect(master);
  drumBus.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let clockStepSeconds = 0.125;
  let meter = 0;
  let destroyed = false;

  const makeDriveCurve = () => {
    const amount = 1 + state.drive * 7;
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) * (0.82 + state.drive * 0.1);
    }
    return curve;
  };

  const updateAudioParams = () => {
    master.gain.setTargetAtTime(state.running ? state.volume : 0, audio.currentTime, 0.018);
    toneFilter.frequency.setTargetAtTime(3800 + state.tone * 9200, audio.currentTime, 0.04);
    toneFilter.Q.setTargetAtTime(0.35 + state.tone * 0.95, audio.currentTime, 0.04);
    wet.gain.setTargetAtTime(0.06 + state.decay * 0.12, audio.currentTime, 0.04);
    feedback.gain.setTargetAtTime(0.1 + state.decay * 0.18, audio.currentTime, 0.04);
    shaper.curve = makeDriveCurve();
    shaper.oversample = '4x';
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.8), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.18 + white * 0.82;
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
    }, Math.max(120, seconds * 1000 + 240));
    cleanupTimers.add(timer);
  };

  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 127.31 + salt * 71.17) * 43758.5453123;
    return raw - Math.floor(raw);
  };

  const publishHit = (voice, time, velocity) => {
    ctx.bus.pub(HIT_EVENT, {
      voice,
      time,
      velocity: clamp(velocity, 0, 1.2),
      step: currentStep
    });
  };

  const playKick = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.18 + state.decay * 0.24;
    const osc = audio.createOscillator();
    const click = audio.createBufferSource();
    const clickFilter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const clickGain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(128 + velocity * 34, t);
    osc.frequency.exponentialRampToValueAtTime(43, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.92 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    click.buffer = noiseBuffer;
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(5200 + state.tone * 2400, t);
    clickGain.gain.setValueAtTime(0.16 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);

    osc.connect(gain);
    gain.connect(drumBus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(drumBus);
    osc.start(t);
    osc.stop(t + length + 0.04);
    click.start(t, 0, 0.05);
    track(length + 0.08, osc, click, clickFilter, gain, clickGain);
    publishHit('kick', t, velocity);
  };

  const playSnare = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.12 + state.decay * 0.18;
    const noise = audio.createBufferSource();
    const band = audio.createBiquadFilter();
    const high = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noise.buffer = noiseBuffer;
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1450 + state.tone * 1450, t);
    band.Q.setValueAtTime(0.8 + state.tone * 0.7, t);
    high.type = 'highpass';
    high.frequency.setValueAtTime(420, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.42 * velocity, t + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    body.type = 'triangle';
    body.frequency.setValueAtTime(205, t);
    body.frequency.exponentialRampToValueAtTime(145, t + 0.08);
    bodyGain.gain.setValueAtTime(0.09 * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    noise.connect(high);
    high.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(drumBus);
    body.connect(bodyGain);
    bodyGain.connect(drumBus);
    noise.start(t, 0, length + 0.03);
    body.start(t);
    body.stop(t + 0.16);
    track(length + 0.08, noise, band, high, noiseGain, body, bodyGain);
    publishHit('snare', t, velocity);
  };

  const playClap = (time, velocity) => {
    const t = safeTime(time);
    const filter = audio.createBiquadFilter();
    const output = audio.createGain();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1500 + state.tone * 900, t);
    filter.Q.setValueAtTime(0.85, t);
    filter.connect(output);
    output.connect(drumBus);

    [0, 0.014, 0.029, 0.061].forEach((offset, index) => {
      const burst = audio.createBufferSource();
      const gain = audio.createGain();
      const at = t + offset;
      burst.buffer = noiseBuffer;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime((0.22 - index * 0.026) * velocity, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.075 + state.decay * 0.04);
      burst.connect(gain);
      gain.connect(filter);
      burst.start(at, 0, 0.16);
      track(0.24 + offset, burst, gain);
    });

    track(0.34, filter, output);
    publishHit('clap', t, velocity);
  };

  const playHat = (time, velocity, open) => {
    const t = safeTime(time);
    const length = open ? 0.22 + state.decay * 0.3 : 0.045 + state.decay * 0.045;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const peak = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(open ? 3800 + state.tone * 1700 : 6000 + state.tone * 2400, t);
    high.Q.setValueAtTime(open ? 0.5 : 0.9, t);
    peak.type = 'bandpass';
    peak.frequency.setValueAtTime(7600 + state.tone * 2200, t);
    peak.Q.setValueAtTime(open ? 0.7 : 1.6, t);
    gain.gain.setValueAtTime((open ? 0.18 : 0.09) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(open ? 0.28 : -0.28 + randomFor(currentStep, 6) * 0.56, t);

    noise.connect(high);
    high.connect(peak);
    peak.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(drumBus);
    } else {
      gain.connect(drumBus);
    }
    noise.start(t, 0, length + 0.03);
    track(length + 0.08, noise, high, peak, gain, ...(panner ? [panner] : []));
    publishHit(open ? 'openHat' : 'hat', t, velocity);
  };

  const triggerVoice = (voice, time, velocity) => {
    if (voice === 'kick') playKick(time, velocity);
    if (voice === 'snare') playSnare(time, velocity);
    if (voice === 'clap') playClap(time, velocity);
    if (voice === 'hat') playHat(time, velocity, false);
    if (voice === 'openHat') playHat(time, velocity, true);
  };

  const randomPattern = () => {
    const next = clonePattern(PRESETS[state.preset].pattern);
    for (let index = 0; index < 16; index += 1) {
      if (![0, 4, 8, 12].includes(index) && Math.random() < 0.2) next.kick[index] = Math.max(next.kick[index], 0.25 + Math.random() * 0.38);
      if (![4, 12].includes(index) && Math.random() < 0.1) next.snare[index] = 0.24 + Math.random() * 0.32;
      if (Math.random() < 0.2) next.clap[index] = Math.max(next.clap[index], 0.2 + Math.random() * 0.32);
      if (Math.random() < 0.45) next.hat[index] = Math.max(next.hat[index], 0.18 + Math.random() * 0.5);
      if (index % 4 === 2 && Math.random() < 0.5) next.openHat[index] = 0.38 + Math.random() * 0.35;
    }
    state.pattern = next;
  };

  const clearPattern = () => {
    VOICES.forEach((voice) => {
      state.pattern[voice.id] = Array.from({ length: 16 }, () => 0);
    });
  };

  const applyPreset = (index) => {
    state.preset = clamp(index, 0, PRESETS.length - 1);
    state.pattern = clonePattern(PRESETS[state.preset].pattern);
  };

  const setStep = (voiceId, index) => {
    const voice = VOICES.find((entry) => entry.id === voiceId);
    if (!voice) return;
    const current = state.pattern[voiceId][index] || 0;
    state.pattern[voiceId][index] = current > 0.75 ? 0 : current > 0 ? voice.loud : voice.quiet;
  };

  dom.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .machine {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 360px;
        min-height: 278px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr auto auto;
        gap: 8px;
        padding: 10px;
        color: #eef2ff;
        background: linear-gradient(135deg, rgba(13, 17, 23, 0.96), rgba(28, 31, 34, 0.96));
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #f8fafc;
        font: 700 15px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .sub {
        margin-top: 3px;
        color: #9ca3af;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      button,
      input {
        font: inherit;
      }
      button {
        height: 27px;
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 5px;
        color: #dbeafe;
        background: rgba(15, 23, 42, 0.72);
        cursor: pointer;
      }
      button:hover {
        border-color: rgba(226, 232, 240, 0.5);
      }
      .run {
        width: 58px;
        color: #111827;
        background: #34d399;
        font-weight: 700;
      }
      .run.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.72);
      }
      .presets {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 5px;
      }
      .presets button {
        padding: 0 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .presets .active {
        color: #111827;
        background: #fbbf24;
        font-weight: 700;
      }
      .grid {
        min-height: 106px;
        display: grid;
        grid-template-rows: repeat(5, minmax(0, 1fr));
        gap: 4px;
      }
      .row {
        min-width: 0;
        display: grid;
        grid-template-columns: 44px repeat(16, minmax(13px, 1fr));
        gap: 3px;
        align-items: stretch;
      }
      .voice {
        display: grid;
        align-items: center;
        color: #cbd5e1;
        font-size: 10px;
      }
      .step {
        min-width: 0;
        height: 100%;
        min-height: 17px;
        padding: 0;
        border-radius: 3px;
        color: transparent;
        background: rgba(15, 23, 42, 0.78);
        border-color: rgba(71, 85, 105, 0.68);
      }
      .step.beat {
        border-color: rgba(226, 232, 240, 0.44);
      }
      .step.on {
        opacity: 1;
      }
      .step.soft {
        opacity: 0.62;
      }
      .step.now {
        outline: 2px solid #f8fafc;
        outline-offset: -2px;
      }
      .row[data-voice="kick"] .step.on { background: #fb7185; }
      .row[data-voice="snare"] .step.on { background: #38bdf8; }
      .row[data-voice="clap"] .step.on { background: #c084fc; }
      .row[data-voice="hat"] .step.on { background: #fde047; }
      .row[data-voice="openHat"] .step.on { background: #34d399; }
      .controls {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px 10px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 30px;
        align-items: center;
        gap: 5px;
        color: #d1d5db;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #22c55e;
      }
      .meter {
        height: 8px;
        overflow: hidden;
        border-radius: 3px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(15, 23, 42, 0.72);
      }
      .meter span {
        display: block;
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #34d399, #fbbf24, #fb7185);
      }
      @media (max-width: 460px) {
        .machine { min-width: 300px; }
        .controls { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .row { grid-template-columns: 36px repeat(16, minmax(10px, 1fr)); gap: 2px; }
        .voice { font-size: 9px; }
      }
    </style>
    <div class="machine">
      <div class="top">
        <div>
          <h1>Step Drum Machine</h1>
          <div class="sub">five voice synthesized rhythm box</div>
        </div>
        <button id="run" class="run" type="button"></button>
      </div>
      <div id="presets" class="presets"></div>
      <div id="grid" class="grid"></div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal"></span></label>
        <label>swing <input id="swing" type="range" min="0" max="0.36" step="0.01"><span id="swingVal"></span></label>
        <label>decay <input id="decay" type="range" min="0" max="1" step="0.01"><span id="decayVal"></span></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"><span id="toneVal"></span></label>
        <label>drive <input id="drive" type="range" min="0" max="1" step="0.01"><span id="driveVal"></span></label>
        <label>acc <input id="accent" type="range" min="0" max="0.45" step="0.01"><span id="accentVal"></span></label>
      </div>
      <div class="meter"><span id="meter"></span></div>
    </div>
  `;

  const $ = (selector) => dom.querySelector(selector);
  const runButton = $('#run');
  const presetsEl = $('#presets');
  const gridEl = $('#grid');
  const meterEl = $('#meter');
  const sliders = {
    volume: $('#volume'),
    swing: $('#swing'),
    decay: $('#decay'),
    tone: $('#tone'),
    drive: $('#drive'),
    accent: $('#accent')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    swing: $('#swingVal'),
    decay: $('#decayVal'),
    tone: $('#toneVal'),
    drive: $('#driveVal'),
    accent: $('#accentVal')
  };

  const presetButtons = PRESETS.map((preset, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = preset.name;
    button.dataset.preset = String(index);
    presetsEl.appendChild(button);
    return button;
  });

  const randomButton = document.createElement('button');
  randomButton.type = 'button';
  randomButton.textContent = 'random';
  randomButton.dataset.action = 'random';
  presetsEl.appendChild(randomButton);

  const clearButton = document.createElement('button');
  clearButton.type = 'button';
  clearButton.textContent = 'clear';
  clearButton.dataset.action = 'clear';
  presetsEl.appendChild(clearButton);

  const stepButtons = {};
  VOICES.forEach((voice) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.voice = voice.id;
    const label = document.createElement('div');
    label.className = 'voice';
    label.textContent = voice.short;
    row.appendChild(label);
    stepButtons[voice.id] = [];

    for (let index = 0; index < 16; index += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'step';
      button.dataset.voice = voice.id;
      button.dataset.index = String(index);
      button.title = `${voice.label} ${index + 1}`;
      row.appendChild(button);
      stepButtons[voice.id].push(button);
    }
    gridEl.appendChild(row);
  });

  const render = () => {
    runButton.textContent = state.running ? 'ON' : 'OFF';
    runButton.classList.toggle('off', !state.running);
    presetButtons.forEach((button, index) => button.classList.toggle('active', index === state.preset));

    Object.entries(sliders).forEach(([key, input]) => {
      input.value = String(state[key]);
      valueEls[key].textContent = key === 'volume' ? Math.round(state[key] * 100) : Math.round(state[key] * 100);
    });

    VOICES.forEach((voice) => {
      state.pattern[voice.id].forEach((velocity, index) => {
        const button = stepButtons[voice.id][index];
        button.classList.toggle('on', velocity > 0);
        button.classList.toggle('soft', velocity > 0 && velocity < 0.7);
        button.classList.toggle('beat', index % 4 === 0);
        button.classList.toggle('now', index === currentStep);
        button.style.opacity = velocity > 0 ? String(0.48 + velocity * 0.52) : '';
      });
    });
  };

  const publishState = () => {
    ctx.bus.pubGlobal(GLOBAL_KEY, {
      ...state,
      pattern: clonePattern(state.pattern)
    });
  };

  const onRun = () => {
    state.running = !state.running;
    updateAudioParams();
    render();
    publishState();
  };

  const onPresetClick = (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.preset !== undefined) {
      applyPreset(Number(target.dataset.preset));
    } else if (target.dataset.action === 'random') {
      randomPattern();
    } else if (target.dataset.action === 'clear') {
      clearPattern();
    } else {
      return;
    }
    render();
    publishState();
  };

  const onGridClick = (event) => {
    const target = event.target.closest('.step');
    if (!target) return;
    const voice = target.dataset.voice;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;
    setStep(voice, index);
    render();
    publishState();
  };

  const onSlider = (event) => {
    const key = Object.entries(sliders).find(([, input]) => input === event.target)?.[0];
    if (!key) return;
    state[key] = Number(event.target.value);
    updateAudioParams();
    render();
    publishState();
  };

  runButton.addEventListener('click', onRun);
  presetsEl.addEventListener('click', onPresetClick);
  gridEl.addEventListener('click', onGridClick);
  Object.values(sliders).forEach((input) => input.addEventListener('input', onSlider));

  const unsubscribeGlobal = ctx.bus.subGlobal(GLOBAL_KEY, (value) => {
    if (!value || typeof value !== 'object' || value.stateVersion !== STATE_VERSION) return;
    state.running = Boolean(value.running);
    state.volume = clamp(Number(value.volume) || 0, 0, 1.1);
    state.swing = clamp(Number(value.swing) || 0, 0, 0.36);
    state.decay = clamp(Number(value.decay) || 0, 0, 1);
    state.tone = clamp(Number(value.tone) || 0, 0, 1);
    state.drive = clamp(Number(value.drive) || 0, 0, 1);
    state.accent = clamp(Number(value.accent) || 0, 0, 0.45);
    state.preset = Number.isInteger(value.preset) ? clamp(value.preset, 0, PRESETS.length - 1) : state.preset;
    state.pattern = clonePattern(value.pattern);
    updateAudioParams();
    render();
  });

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    render();
    if (!state.running) return;

    const stepSeconds = clamp(duration || clockStepSeconds, 0.055, 0.4);
    const swing = currentStep % 2 === 1 ? stepSeconds * state.swing : 0;
    const accent = currentStep % 4 === 0 ? 1 + state.accent : currentStep % 2 === 0 ? 1 : 0.88;
    const at = time + swing;

    VOICES.forEach((voice, voiceIndex) => {
      const baseVelocity = state.pattern[voice.id][currentStep] || 0;
      if (!baseVelocity) return;
      const jitter = (randomFor(step, voiceIndex + 12) - 0.5) * 0.006;
      const velocity = clamp(baseVelocity * accent * (0.94 + randomFor(step, voiceIndex + 22) * 0.12), 0.04, 1.15);
      triggerVoice(voice.id, at + jitter, velocity);
      meter = Math.max(meter, velocity);
    });

    delay.delayTime.setTargetAtTime(stepSeconds * (0.72 + state.swing * 0.6), audio.currentTime, 0.03);
  });

  updateAudioParams();
  render();

  return {
    update() {
      meter *= 0.88;
      meterEl.style.width = `${Math.round(clamp(meter, 0, 1) * 100)}%`;
    },
    getState() {
      return {
        ...state,
        pattern: clonePattern(state.pattern)
      };
    },
    destroy() {
      destroyed = true;
      runButton.removeEventListener('click', onRun);
      presetsEl.removeEventListener('click', onPresetClick);
      gridEl.removeEventListener('click', onGridClick);
      Object.values(sliders).forEach((input) => input.removeEventListener('input', onSlider));
      unsubscribeClock();
      unsubscribeGlobal();
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      liveNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      });
      liveNodes.clear();
      [drumBus, toneFilter, shaper, delay, delayFilter, feedback, wet, master, compressor].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
    }
  };
}
