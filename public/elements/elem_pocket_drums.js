const STATE_VERSION = 'pocket-drums-v1';
const HIT_EVENT = 'pocketDrums:hit';

const PATTERNS = [
  {
    name: 'pocket',
    kick: [1, 0, 0, 0.42, 0, 0.62, 0, 0, 0.92, 0, 0.36, 0, 0, 0.72, 0, 0.24],
    snare: [0, 0, 0, 0, 0.88, 0, 0, 0.22, 0, 0, 0, 0, 0.94, 0, 0.24, 0],
    hat: [0.48, 0.26, 0.42, 0.28, 0.52, 0.24, 0.46, 0.3, 0.5, 0.26, 0.44, 0.28, 0.54, 0.24, 0.5, 0.34],
    open: [0, 0, 0.38, 0, 0, 0, 0.42, 0, 0, 0, 0.36, 0, 0, 0, 0.54, 0],
    rim: [0, 0, 0, 0.24, 0, 0, 0.2, 0, 0, 0.18, 0, 0, 0, 0, 0.28, 0]
  },
  {
    name: 'four',
    kick: [1, 0, 0, 0, 0.92, 0, 0, 0, 1, 0, 0, 0, 0.92, 0, 0, 0],
    snare: [0, 0, 0, 0, 0.78, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0],
    hat: [0, 0.44, 0, 0.4, 0, 0.46, 0, 0.52, 0, 0.44, 0, 0.4, 0, 0.46, 0, 0.58],
    open: [0, 0, 0.58, 0, 0, 0, 0.62, 0, 0, 0, 0.58, 0, 0, 0, 0.66, 0],
    rim: [0, 0, 0, 0, 0, 0.18, 0, 0, 0, 0, 0, 0, 0, 0.16, 0, 0.22]
  },
  {
    name: 'break',
    kick: [1, 0, 0, 0.56, 0, 0.8, 0, 0, 0.96, 0, 0.42, 0, 0, 0.78, 0.4, 0],
    snare: [0, 0, 0.16, 0, 0.94, 0, 0, 0.24, 0, 0, 0, 0.18, 0.9, 0, 0.28, 0],
    hat: [0.38, 0.22, 0.52, 0.24, 0.44, 0.28, 0.58, 0.22, 0.4, 0.24, 0.5, 0.28, 0.46, 0.24, 0.62, 0.34],
    open: [0, 0, 0, 0.34, 0, 0, 0.42, 0, 0, 0, 0, 0.38, 0, 0, 0.58, 0],
    rim: [0, 0.22, 0, 0, 0, 0, 0.26, 0, 0, 0.18, 0, 0.22, 0, 0, 0, 0.3]
  }
];

const VOICES = ['kick', 'snare', 'hat', 'open', 'rim'];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const dom = ctx.domRoot;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    pattern: Number.isInteger(prevState?.pattern) ? clamp(prevState.pattern, 0, PATTERNS.length - 1) : 0,
    volume: finite(prevState?.volume, 0.74),
    swing: finite(prevState?.swing, 0.1),
    grit: finite(prevState?.grit, 0.34),
    decay: finite(prevState?.decay, 0.46),
    fill: finite(prevState?.fill, 0.28)
  };

  const output = audio.createGain();
  const drumBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const tone = audio.createBiquadFilter();
  const compressor = audio.createDynamicsCompressor();
  const send = audio.createGain();
  const delay = audio.createDelay(0.8);
  const delayFilter = audio.createBiquadFilter();
  const feedback = audio.createGain();
  const wet = audio.createGain();

  output.gain.value = state.running ? state.volume : 0;
  drumBus.gain.value = 0.9;
  tone.type = 'lowpass';
  tone.frequency.value = 9200;
  tone.Q.value = 0.45;
  compressor.threshold.value = -18;
  compressor.knee.value = 14;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  send.gain.value = 0.12;
  delay.delayTime.value = 0.18;
  delayFilter.type = 'highpass';
  delayFilter.frequency.value = 1100;
  feedback.gain.value = 0.18;
  wet.gain.value = 0.12;

  drumBus.connect(tone);
  tone.connect(shaper);
  shaper.connect(output);
  drumBus.connect(send);
  send.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(wet);
  wet.connect(output);
  output.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let lastTickStep = null;
  let pulse = 0;
  let destroyed = false;

  const makeDriveCurve = () => {
    const amount = 1.2 + state.grit * 8;
    const curve = new Float32Array(512);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index / (curve.length - 1)) * 2 - 1;
      curve[index] = Math.tanh(x * amount) * (0.78 + state.grit * 0.12);
    }
    return curve;
  };

  const updateAudio = () => {
    const now = audio.currentTime;
    output.gain.setTargetAtTime(state.running ? state.volume : 0, now, 0.018);
    tone.frequency.setTargetAtTime(5600 + (1 - state.grit) * 6800, now, 0.05);
    tone.Q.setTargetAtTime(0.35 + state.grit * 0.9, now, 0.05);
    send.gain.setTargetAtTime(0.06 + state.fill * 0.18, now, 0.05);
    feedback.gain.setTargetAtTime(0.08 + state.decay * 0.2, now, 0.05);
    wet.gain.setTargetAtTime(0.06 + state.fill * 0.16, now, 0.05);
    shaper.curve = makeDriveCurve();
    shaper.oversample = '2x';
  };

  const noiseBuffer = (() => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.7), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      last = last * 0.2 + (Math.random() * 2 - 1) * 0.8;
      data[index] = last;
    }
    return buffer;
  })();

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
    }, Math.max(120, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  };

  const safeTime = (time) => Math.max(Number(time) || audio.currentTime, audio.currentTime + 0.001);

  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 117.31 + salt * 41.71) * 43758.5453123;
    return raw - Math.floor(raw);
  };

  const pubHit = (voice, time, velocity) => {
    ctx.bus.pub(HIT_EVENT, { voice, time, velocity, step: currentStep, pattern: state.pattern });
  };

  const playKick = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.2 + state.decay * 0.22;
    const osc = audio.createOscillator();
    const click = audio.createBufferSource();
    const clickFilter = audio.createBiquadFilter();
    const bodyGain = audio.createGain();
    const clickGain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(132 + velocity * 26, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + length);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.82 * velocity, t + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    click.buffer = noiseBuffer;
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(5200 + state.grit * 1800, t);
    clickGain.gain.setValueAtTime(0.14 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);

    osc.connect(bodyGain);
    bodyGain.connect(drumBus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(drumBus);
    osc.start(t);
    click.start(t, 0, 0.04);
    osc.stop(t + length + 0.04);
    track(length + 0.08, osc, click, clickFilter, bodyGain, clickGain);
    pubHit('kick', t, velocity);
  };

  const playSnare = (time, velocity) => {
    const t = safeTime(time);
    const length = 0.11 + state.decay * 0.16;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const band = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(520 + state.grit * 320, t);
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1450 + state.grit * 1550, t);
    band.Q.setValueAtTime(0.9 + state.grit * 0.8, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.4 * velocity, t + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    body.type = 'triangle';
    body.frequency.setValueAtTime(198, t);
    body.frequency.exponentialRampToValueAtTime(142, t + 0.08);
    bodyGain.gain.setValueAtTime(0.08 * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    noise.connect(high);
    high.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(drumBus);
    body.connect(bodyGain);
    bodyGain.connect(drumBus);
    noise.start(t, 0, length + 0.04);
    body.start(t);
    body.stop(t + 0.15);
    track(length + 0.09, noise, high, band, noiseGain, body, bodyGain);
    pubHit('snare', t, velocity);
  };

  const playHat = (time, velocity, open = false) => {
    const t = safeTime(time);
    const length = open ? 0.19 + state.decay * 0.28 : 0.04 + state.decay * 0.04;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const peak = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(open ? 3800 + state.grit * 1200 : 6200 + state.grit * 2200, t);
    peak.type = 'bandpass';
    peak.frequency.setValueAtTime(8200 + state.grit * 1700, t);
    peak.Q.setValueAtTime(open ? 0.7 : 1.5, t);
    gain.gain.setValueAtTime((open ? 0.15 : 0.07) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(open ? 0.26 : -0.22 + randomFor(currentStep, 9) * 0.44, t);

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
    pubHit(open ? 'open' : 'hat', t, velocity);
  };

  const playRim = (time, velocity) => {
    const t = safeTime(time);
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    osc.type = 'square';
    osc.frequency.setValueAtTime(720 + state.grit * 520, t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(960 + state.grit * 1050, t);
    filter.Q.setValueAtTime(8.5, t);
    gain.gain.setValueAtTime(0.07 * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    if (panner) panner.pan.setValueAtTime(-0.36, t);

    osc.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(drumBus);
    } else {
      gain.connect(drumBus);
    }
    osc.start(t);
    osc.stop(t + 0.09);
    track(0.14, osc, filter, gain, ...(panner ? [panner] : []));
    pubHit('rim', t, velocity);
  };

  const playVoice = (voice, time, velocity) => {
    if (voice === 'kick') playKick(time, velocity);
    if (voice === 'snare') playSnare(time, velocity);
    if (voice === 'hat') playHat(time, velocity, false);
    if (voice === 'open') playHat(time, velocity, true);
    if (voice === 'rim') playRim(time, velocity);
  };

  const playStep = (step, time, duration) => {
    currentStep = step % 16;
    const pattern = PATTERNS[state.pattern];
    const stepSeconds = clamp(duration || 0.125, 0.06, 0.4);
    const swing = currentStep % 2 ? stepSeconds * state.swing : 0;
    const at = safeTime(time + swing);
    const accent = currentStep % 4 === 0 ? 1.08 : currentStep % 2 === 0 ? 0.92 : 0.78;
    const human = (salt) => (randomFor(step, salt) - 0.5) * 0.006;

    VOICES.forEach((voice, index) => {
      const base = pattern[voice][currentStep] || 0;
      if (base > 0) playVoice(voice, at + human(index + 2), clamp(base * accent, 0.04, 1.1));
    });

    const fillPush = state.fill > 0.02 && randomFor(step, 22) < state.fill * 0.38;
    if (fillPush && [7, 11, 14, 15].includes(currentStep)) {
      playHat(at + stepSeconds * 0.5 + human(31), 0.22 + state.fill * 0.36, false);
    }
    if (state.fill > 0.48 && [15, 31].includes(step % 32)) {
      playSnare(at + stepSeconds * 0.47 + human(33), 0.32 + state.fill * 0.34);
      playRim(at + stepSeconds * 0.72 + human(34), 0.28 + state.fill * 0.25);
    }

    pulse = 1;
    ctx.bus.pub('pocketDrums:step', { step: currentStep, pattern: state.pattern });
  };

  dom.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .drums {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 8px;
        padding: 10px;
        color: #e8edf4;
        background: linear-gradient(135deg, rgba(20, 23, 27, 0.96), rgba(30, 33, 34, 0.96));
        border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 52px;
        gap: 8px;
        align-items: center;
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
      .status {
        margin-top: 4px;
        height: 6px;
        overflow: hidden;
        border-radius: 3px;
        background: rgba(15, 23, 42, 0.7);
      }
      .status span {
        display: block;
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #2dd4bf, #facc15, #fb7185);
      }
      button,
      input {
        font: inherit;
      }
      button {
        min-width: 0;
        height: 27px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 5px;
        color: #dbeafe;
        background: rgba(15, 23, 42, 0.74);
        cursor: pointer;
      }
      button:hover {
        border-color: rgba(226, 232, 240, 0.52);
      }
      .run {
        color: #111827;
        background: #34d399;
        font-weight: 700;
      }
      .run.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.74);
      }
      .patterns {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
      }
      .patterns .active {
        color: #111827;
        background: #facc15;
        font-weight: 700;
      }
      .lanes {
        min-height: 72px;
        display: grid;
        grid-template-rows: repeat(5, minmax(0, 1fr));
        gap: 3px;
      }
      .lane {
        display: grid;
        grid-template-columns: 38px repeat(16, minmax(8px, 1fr));
        gap: 3px;
        align-items: stretch;
      }
      .label {
        display: grid;
        align-items: center;
        color: #cbd5e1;
        font-size: 10px;
      }
      .step {
        min-width: 0;
        min-height: 11px;
        height: 100%;
        border-radius: 3px;
        background: rgba(15, 23, 42, 0.72);
        border: 1px solid rgba(71, 85, 105, 0.6);
      }
      .step.on {
        opacity: 0.55;
      }
      .step.hot {
        opacity: 1;
      }
      .step.now {
        outline: 2px solid #f8fafc;
        outline-offset: -2px;
      }
      .lane[data-voice="kick"] .step.on { background: #fb7185; }
      .lane[data-voice="snare"] .step.on { background: #38bdf8; }
      .lane[data-voice="hat"] .step.on { background: #fde047; }
      .lane[data-voice="open"] .step.on { background: #34d399; }
      .lane[data-voice="rim"] .step.on { background: #c084fc; }
      .controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 9px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 30px;
        gap: 5px;
        align-items: center;
        color: #d1d5db;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #22c55e;
      }
      @media (max-width: 360px) {
        .drums { min-width: 240px; padding: 8px; }
        .lane { grid-template-columns: 32px repeat(16, minmax(6px, 1fr)); gap: 2px; }
        .label { font-size: 9px; }
        label { grid-template-columns: 34px minmax(0, 1fr) 26px; }
      }
    </style>
    <div class="drums">
      <div class="top">
        <div>
          <h1>Pocket Drums</h1>
          <div class="status"><span id="meter"></span></div>
        </div>
        <button id="run" class="run" type="button"></button>
      </div>
      <div id="patterns" class="patterns"></div>
      <div id="lanes" class="lanes"></div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal"></span></label>
        <label>swing <input id="swing" type="range" min="0" max="0.36" step="0.01"><span id="swingVal"></span></label>
        <label>grit <input id="grit" type="range" min="0" max="1" step="0.01"><span id="gritVal"></span></label>
        <label>decay <input id="decay" type="range" min="0" max="1" step="0.01"><span id="decayVal"></span></label>
        <label>fill <input id="fill" type="range" min="0" max="1" step="0.01"><span id="fillVal"></span></label>
      </div>
    </div>
  `;

  const $ = (selector) => dom.querySelector(selector);
  const runButton = $('#run');
  const patternBox = $('#patterns');
  const lanes = $('#lanes');
  const meter = $('#meter');
  const sliders = {
    volume: $('#volume'),
    swing: $('#swing'),
    grit: $('#grit'),
    decay: $('#decay'),
    fill: $('#fill')
  };
  const values = {
    volume: $('#volumeVal'),
    swing: $('#swingVal'),
    grit: $('#gritVal'),
    decay: $('#decayVal'),
    fill: $('#fillVal')
  };

  const patternButtons = PATTERNS.map((pattern, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = pattern.name;
    button.dataset.pattern = String(index);
    patternBox.appendChild(button);
    return button;
  });

  const stepEls = {};
  VOICES.forEach((voice) => {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.dataset.voice = voice;
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = voice === 'snare' ? 'snr' : voice === 'kick' ? 'kck' : voice;
    lane.appendChild(label);
    stepEls[voice] = [];
    for (let index = 0; index < 16; index += 1) {
      const step = document.createElement('div');
      step.className = 'step';
      lane.appendChild(step);
      stepEls[voice].push(step);
    }
    lanes.appendChild(lane);
  });

  const render = () => {
    runButton.textContent = state.running ? 'ON' : 'OFF';
    runButton.classList.toggle('off', !state.running);
    patternButtons.forEach((button, index) => button.classList.toggle('active', index === state.pattern));

    Object.entries(sliders).forEach(([key, input]) => {
      input.value = String(state[key]);
      values[key].textContent = state[key].toFixed(key === 'volume' ? 2 : 2);
    });

    const pattern = PATTERNS[state.pattern];
    VOICES.forEach((voice) => {
      pattern[voice].forEach((amount, index) => {
        const step = stepEls[voice][index];
        step.classList.toggle('on', amount > 0);
        step.classList.toggle('hot', amount >= 0.7);
        step.classList.toggle('now', index === currentStep);
      });
    });
  };

  const onRun = () => {
    state.running = !state.running;
    updateAudio();
    render();
  };

  const onPatternClick = (event) => {
    const button = event.target.closest('button[data-pattern]');
    if (!button) return;
    state.pattern = clamp(Number(button.dataset.pattern) || 0, 0, PATTERNS.length - 1);
    render();
  };

  const onSliderInput = (event) => {
    const key = event.target.id;
    if (!Object.hasOwn(sliders, key)) return;
    state[key] = Number(event.target.value);
    updateAudio();
    render();
  };

  runButton.addEventListener('click', onRun);
  patternBox.addEventListener('click', onPatternClick);
  Object.values(sliders).forEach((input) => input.addEventListener('input', onSliderInput));

  const unsubscribeTick = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed || lastTickStep === step) return;
    lastTickStep = step;
    if (state.running) playStep(step, time, duration);
    else {
      currentStep = step % 16;
      render();
    }
  });

  updateAudio();
  render();

  return {
    update() {
      pulse *= 0.88;
      meter.style.width = `${Math.round(clamp(pulse, 0, 1) * 100)}%`;
      if (pulse > 0.02) render();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      runButton.removeEventListener('click', onRun);
      patternBox.removeEventListener('click', onPatternClick);
      Object.values(sliders).forEach((input) => input.removeEventListener('input', onSliderInput));
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
      [output, drumBus, shaper, tone, compressor, send, delay, delayFilter, feedback, wet].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
    }
  };
}
