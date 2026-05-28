const STATE_VERSION = 'psytrance-synth-v2';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const state = {
    stateVersion: STATE_VERSION,
    enabled: prevState?.enabled ?? true,
    volume: finite(prevState?.volume, 0.74),
    cutoff: finite(prevState?.cutoff, 0.62),
    resonance: finite(prevState?.resonance, 0.72),
    drive: finite(prevState?.drive, 0.64),
    acid: finite(prevState?.acid, 0.58),
    motion: finite(prevState?.motion, 0.68),
    noise: finite(prevState?.noise, 0.42),
    pattern: Number.isInteger(prevState?.pattern) ? clamp(prevState.pattern, 0, 2) : 0
  };

  const output = audio.createGain();
  const bassBus = audio.createGain();
  const leadBus = audio.createGain();
  const psyBus = audio.createGain();
  const noiseBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.9);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = state.enabled ? state.volume : 0;
  bassBus.gain.value = 0.72;
  leadBus.gain.value = 0.42;
  psyBus.gain.value = 0.34;
  noiseBus.gain.value = 0.2;
  compressor.threshold.value = -18;
  compressor.knee.value = 16;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.12;
  delay.delayTime.value = 0.187;
  feedback.gain.value = 0.28;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3800;
  wet.gain.value = 0.22;

  bassBus.connect(shaper);
  leadBus.connect(shaper);
  psyBus.connect(shaper);
  noiseBus.connect(shaper);
  shaper.connect(output);
  leadBus.connect(delay);
  psyBus.connect(delay);
  noiseBus.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);
  output.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let stepSeconds = 0.125;
  let destroyed = false;

  const patterns = [
    {
      name: 'rolling',
      bass: [36, 36, 36, 36, 36, 36, 39, 36, 36, 36, 43, 36, 36, 36, 39, 43],
      accent: [1, 0, 0.45, 0, 0.7, 0, 0.5, 0, 1, 0, 0.55, 0, 0.72, 0, 0.5, 0.25],
      lead: [72, null, null, 79, null, 75, null, null, 72, null, 82, null, 79, null, 75, null],
      blip: [0, 1, 0, 0, 1, 0, 0, 0.7, 0, 1, 0, 0, 1, 0, 0.6, 0],
      psy: [null, null, 91, null, null, 88, null, null, null, 96, null, 91, null, null, 86, null],
      noise: [0.72, 0, 0, 0.32, 0, 0.55, 0, 0, 0.85, 0, 0.42, 0, 0, 0.7, 0, 0.5]
    },
    {
      name: 'forest',
      bass: [36, 36, 36, 41, 36, 36, 43, 36, 36, 39, 36, 36, 43, 36, 41, 36],
      accent: [1, 0.25, 0, 0.55, 0.7, 0, 0.5, 0, 1, 0.35, 0, 0.45, 0.8, 0, 0.55, 0],
      lead: [79, null, 82, null, null, 77, null, 75, 79, null, null, 84, null, 82, null, 75],
      blip: [1, 0, 0.6, 0, 0, 1, 0, 0.7, 1, 0, 0, 0.6, 0, 1, 0, 0.7],
      psy: [88, null, null, 91, null, 96, null, null, 87, null, 94, null, null, 99, null, 91],
      noise: [0, 0.5, 0, 0, 0.65, 0, 0.4, 0, 0, 0.55, 0, 0.7, 0, 0, 0.45, 0.6]
    },
    {
      name: 'goa',
      bass: [33, 33, 40, 33, 33, 45, 33, 40, 33, 33, 43, 33, 45, 33, 40, 43],
      accent: [1, 0, 0.62, 0, 0.75, 0.48, 0, 0.45, 1, 0, 0.6, 0, 0.85, 0, 0.5, 0.35],
      lead: [69, null, 76, null, 81, null, 79, null, 76, null, 84, null, 81, 79, null, 76],
      blip: [0.8, 0, 0, 1, 0, 0.7, 0, 0, 0.8, 0, 1, 0, 0, 0.7, 0, 1],
      psy: [81, null, 93, null, null, 88, null, 96, null, 84, null, null, 100, null, 88, null],
      noise: [0.6, 0, 0.36, 0, 0.78, 0, 0, 0.52, 0.72, 0, 0.44, 0, 0, 0.66, 0, 0.5]
    }
  ];

  const makeDriveCurve = () => {
    const amount = 1.2 + state.drive * 12;
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) * (0.72 + state.drive * 0.22);
    }
    return curve;
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.5), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.28 + (Math.random() * 2 - 1) * 0.72;
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
    }, Math.max(120, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const setParam = (param, value, time = audio.currentTime, smoothing = 0.025) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const playBass = (time, midi, accent) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = stepSeconds * 0.74;
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const sub = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();

    osc.type = 'sawtooth';
    sub.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(3 + state.resonance * 13 + accent * 5, t);
    filter.frequency.setValueAtTime(180 + state.cutoff * 1200 + accent * 1100, t);
    filter.frequency.exponentialRampToValueAtTime(90 + state.cutoff * 360, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime((0.28 + accent * 0.14) * state.volume, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(amp);
    amp.connect(bassBus);
    osc.start(t);
    sub.start(t);
    osc.stop(t + length + 0.04);
    sub.stop(t + length + 0.04);
    track(length + 0.08, osc, sub, filter, amp);
  };

  const playLead = (time, midi, accent) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = stepSeconds * (1.5 + state.acid * 1.4);
    const freq = midiToFreq(midi);
    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const fm = audio.createOscillator();
    const fmDepth = audio.createGain();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    oscA.type = 'sawtooth';
    oscB.type = state.acid > 0.5 ? 'square' : 'triangle';
    fm.type = 'sine';
    oscA.frequency.setValueAtTime(freq, t);
    oscB.frequency.setValueAtTime(freq * 1.005, t);
    oscA.detune.setValueAtTime(-6 - state.motion * 8, t);
    oscB.detune.setValueAtTime(7 + state.motion * 11, t);
    fm.frequency.setValueAtTime(freq * (2 + state.acid), t);
    fmDepth.gain.setValueAtTime(freq * state.acid * 0.025, t);
    fmDepth.gain.exponentialRampToValueAtTime(freq * 0.004, t + length);
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(5 + state.resonance * 18, t);
    filter.frequency.setValueAtTime(580 + state.cutoff * 4200 + accent * 1600, t);
    filter.frequency.exponentialRampToValueAtTime(320 + state.cutoff * 900, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime((0.13 + accent * 0.07) * state.volume, t + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (pan) pan.pan.setValueAtTime((currentStep % 8 - 3.5) / 5, t);

    fm.connect(fmDepth);
    fmDepth.connect(oscA.frequency);
    fmDepth.connect(oscB.frequency);
    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(amp);
    if (pan) {
      amp.connect(pan);
      pan.connect(leadBus);
    } else {
      amp.connect(leadBus);
    }
    oscA.start(t);
    oscB.start(t);
    fm.start(t);
    oscA.stop(t + length + 0.05);
    oscB.stop(t + length + 0.05);
    fm.stop(t + length + 0.05);
    track(length + 0.1, oscA, oscB, fm, fmDepth, filter, amp, ...(pan ? [pan] : []));
  };

  const playBlip = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.045 + state.motion * 0.06;
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(midiToFreq(84 + ((currentStep * 7) % 12)), t);
    filter.type = 'highpass';
    filter.frequency.value = 1600 + state.cutoff * 5200;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.075 * velocity * state.volume, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(leadBus);
    osc.start(t);
    osc.stop(t + length + 0.03);
    track(length + 0.08, osc, filter, amp);
  };

  const playPsyNote = (time, midi, accent) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = stepSeconds * (0.58 + state.motion * 0.45);
    const freq = midiToFreq(midi);
    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    oscA.type = 'square';
    oscB.type = 'sawtooth';
    oscA.frequency.setValueAtTime(freq, t);
    oscB.frequency.setValueAtTime(freq * 1.5, t);
    oscA.detune.setValueAtTime(-14 - state.acid * 18, t);
    oscB.detune.setValueAtTime(11 + state.motion * 26, t);
    oscA.detune.linearRampToValueAtTime(24 + accent * 18, t + length);
    oscB.detune.linearRampToValueAtTime(-18 - state.motion * 20, t + length);
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(8 + state.resonance * 20, t);
    filter.frequency.setValueAtTime(1200 + state.cutoff * 6200 + accent * 1800, t);
    filter.frequency.exponentialRampToValueAtTime(420 + state.cutoff * 1800, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime((0.055 + state.acid * 0.05 + accent * 0.025) * state.volume, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (pan) pan.pan.setValueAtTime(Math.sin((currentStep + state.motion * 8) * 1.7) * 0.72, t);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(amp);
    if (pan) {
      amp.connect(pan);
      pan.connect(psyBus);
    } else {
      amp.connect(psyBus);
    }
    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + length + 0.04);
    oscB.stop(t + length + 0.04);
    track(length + 0.08, oscA, oscB, filter, amp, ...(pan ? [pan] : []));
  };

  const playNoise = (time, velocity) => {
    if (state.noise <= 0.001) return;
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = stepSeconds * (0.42 + state.motion * 0.38);
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    source.buffer = noiseBuffer;
    source.playbackRate.setValueAtTime(0.8 + state.motion * 1.2 + velocity * 0.55, t);
    filter.type = 'bandpass';
    filter.Q.setValueAtTime(0.9 + state.resonance * 7, t);
    filter.frequency.setValueAtTime(900 + state.cutoff * 5200 + velocity * 2400, t);
    filter.frequency.exponentialRampToValueAtTime(2800 + state.cutoff * 7200, t + length * 0.7);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.18 * velocity * state.noise * state.volume, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (pan) pan.pan.setValueAtTime(Math.cos(currentStep * 0.9) * 0.56, t);

    source.connect(filter);
    filter.connect(amp);
    if (pan) {
      amp.connect(pan);
      pan.connect(noiseBus);
    } else {
      amp.connect(noiseBus);
    }
    source.start(t);
    source.stop(t + length + 0.04);
    track(length + 0.08, source, filter, amp, ...(pan ? [pan] : []));
  };

  const syncAudio = () => {
    shaper.curve = makeDriveCurve();
    shaper.oversample = '2x';
    setParam(output.gain, state.enabled ? state.volume : 0, audio.currentTime, 0.03);
    setParam(leadBus.gain, 0.25 + state.acid * 0.35, audio.currentTime, 0.04);
    setParam(psyBus.gain, 0.18 + state.motion * 0.24, audio.currentTime, 0.04);
    setParam(noiseBus.gain, 0.08 + state.noise * 0.3, audio.currentTime, 0.04);
    setParam(delay.delayTime, stepSeconds * (1.4 + state.motion * 1.2), audio.currentTime, 0.05);
    setParam(feedback.gain, 0.14 + state.motion * 0.28, audio.currentTime, 0.05);
    setParam(wet.gain, 0.08 + state.acid * 0.22, audio.currentTime, 0.05);
    setParam(delayTone.frequency, 1600 + state.cutoff * 5200, audio.currentTime, 0.05);
  };

  const onTick = ({ step, time, duration }) => {
    if (destroyed) return;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    render();
    if (!state.enabled) return;

    const pattern = patterns[state.pattern] || patterns[0];
    const accent = pattern.accent[currentStep] || 0;
    const swing = currentStep % 2 ? stepSeconds * state.motion * 0.06 : 0;
    const t = time + swing;
    playBass(t, pattern.bass[currentStep], accent);
    if (pattern.lead[currentStep] !== null) playLead(t + stepSeconds * 0.02, pattern.lead[currentStep], accent);
    if (pattern.blip[currentStep]) playBlip(t + stepSeconds * 0.52, pattern.blip[currentStep]);
    if (pattern.psy[currentStep] !== null) playPsyNote(t + stepSeconds * 0.16, pattern.psy[currentStep], accent);
    if (pattern.noise[currentStep]) playNoise(t + stepSeconds * 0.74, pattern.noise[currentStep]);
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .psy {
        box-sizing: border-box;
        height: 100%;
        min-width: 300px;
        min-height: 230px;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 8px;
        padding: 10px;
        overflow: hidden;
        color: #ecfeff;
        background:
          linear-gradient(135deg, rgba(4, 9, 12, 0.98), rgba(8, 14, 23, 0.98) 52%, rgba(18, 10, 24, 0.98)),
          repeating-linear-gradient(90deg, rgba(45, 212, 191, 0.08) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(45, 212, 191, 0.56);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      h2 {
        margin: 0;
        color: #99f6e4;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 2px;
        color: #94a3b8;
        font-size: 9px;
      }
      button,
      select,
      input {
        font: inherit;
      }
      button {
        height: 27px;
        min-width: 50px;
        color: #031414;
        background: #5eead4;
        border: 1px solid rgba(153, 246, 228, 0.72);
        border-radius: 5px;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.82);
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
        grid-template-columns: 48px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      input[type="range"] {
        min-width: 0;
        width: 100%;
        accent-color: #5eead4;
      }
      .pattern {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      select {
        min-width: 0;
        height: 24px;
        color: #ecfeff;
        background: rgba(2, 6, 23, 0.72);
        border: 1px solid rgba(45, 212, 191, 0.38);
        border-radius: 5px;
      }
      .grid {
        min-height: 0;
        display: grid;
        grid-template-rows: repeat(5, minmax(0, 1fr));
        gap: 5px;
      }
      .row {
        display: grid;
        grid-template-columns: 38px repeat(16, minmax(7px, 1fr));
        gap: 3px;
      }
      .name {
        display: grid;
        align-items: center;
        color: #94a3b8;
        font-size: 9px;
      }
      .cell {
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(15, 23, 42, 0.82);
        border-radius: 3px;
        opacity: 0.42;
      }
      .cell.on.bass { background: #14b8a6; border-color: rgba(94, 234, 212, 0.76); }
      .cell.on.lead { background: #a78bfa; border-color: rgba(196, 181, 253, 0.76); }
      .cell.on.blip { background: #facc15; border-color: rgba(254, 240, 138, 0.76); }
      .cell.on.psy { background: #fb7185; border-color: rgba(253, 164, 175, 0.82); }
      .cell.on.noise { background: #f97316; border-color: rgba(253, 186, 116, 0.82); }
      .cell.play {
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 0 12px rgba(45, 212, 191, 0.68);
      }
    </style>
    <div class="psy">
      <div class="top">
        <div>
          <h2>Psytrance Synth</h2>
          <div class="sub">rolling bassline, acid lead, gated blips</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal"></span></label>
        <label>cut <input id="cutoff" type="range" min="0" max="1" step="0.01"><span id="cutoffVal"></span></label>
        <label>reso <input id="resonance" type="range" min="0" max="1" step="0.01"><span id="resonanceVal"></span></label>
        <label>drive <input id="drive" type="range" min="0" max="1" step="0.01"><span id="driveVal"></span></label>
        <label>acid <input id="acid" type="range" min="0" max="1" step="0.01"><span id="acidVal"></span></label>
        <label>move <input id="motion" type="range" min="0" max="1" step="0.01"><span id="motionVal"></span></label>
        <label>noise <input id="noise" type="range" min="0" max="1" step="0.01"><span id="noiseVal"></span></label>
      </div>
      <div class="pattern">
        <span>mode</span>
        <select id="pattern">
          <option value="0">rolling</option>
          <option value="1">forest</option>
          <option value="2">goa</option>
        </select>
      </div>
      <div id="grid" class="grid"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const patternSelect = $('#pattern');
  const gridEl = $('#grid');
  const sliders = {
    volume: $('#volume'),
    cutoff: $('#cutoff'),
    resonance: $('#resonance'),
    drive: $('#drive'),
    acid: $('#acid'),
    motion: $('#motion'),
    noise: $('#noise')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    cutoff: $('#cutoffVal'),
    resonance: $('#resonanceVal'),
    drive: $('#driveVal'),
    acid: $('#acidVal'),
    motion: $('#motionVal'),
    noise: $('#noiseVal')
  };

  const renderGrid = () => {
    const pattern = patterns[state.pattern] || patterns[0];
    const rows = [
      ['bass', 'bass', pattern.bass],
      ['lead', 'lead', pattern.lead],
      ['blip', 'blip', pattern.blip],
      ['psy', 'psy', pattern.psy],
      ['noise', 'noise', pattern.noise]
    ];
    gridEl.innerHTML = rows.map(([label, className, row]) => `
      <div class="row">
        <div class="name">${label}</div>
        ${row.map((value, index) => `<div class="cell ${className} ${value ? 'on' : ''} ${index === currentStep ? 'play' : ''}"></div>`).join('')}
      </div>
    `).join('');
  };

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('off', !state.enabled);
    patternSelect.value = String(state.pattern);
    Object.entries(sliders).forEach(([key, input]) => {
      if (input.value !== String(state[key])) input.value = String(state[key]);
      valueEls[key].textContent = state[key].toFixed(2);
    });
    renderGrid();
  };

  const onEnabled = () => {
    state.enabled = !state.enabled;
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

  enabledButton.addEventListener('click', onEnabled);
  patternSelect.addEventListener('change', onPattern);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(onTick);
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
      enabledButton.removeEventListener('click', onEnabled);
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
        output.disconnect(); bassBus.disconnect(); leadBus.disconnect(); psyBus.disconnect(); noiseBus.disconnect(); shaper.disconnect();
        compressor.disconnect(); delay.disconnect(); feedback.disconnect(); delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
