const STATE_VERSION = 'white-fluffy-clouds-v1';

const FORMANTS = {
  ah: [[720, 1.0, 8], [1180, 0.42, 7], [2550, 0.18, 7]],
  ai: [[660, 0.92, 8], [1540, 0.48, 8], [2680, 0.2, 8]],
  uh: [[440, 0.95, 9], [1120, 0.38, 7], [2380, 0.16, 7]],
  ee: [[300, 0.82, 9], [2260, 0.58, 10], [3040, 0.22, 9]],
  ow: [[500, 0.98, 8], [880, 0.48, 8], [2460, 0.18, 7]]
};

const PHRASE = [
  { step: 0, label: 'white', vowel: 'ai', midi: [64, 69], length: 2.8, velocity: 0.72, breath: 0.22 },
  { step: 4, label: 'fluff', vowel: 'uh', midi: [67, 72], length: 1.55, velocity: 0.62, breath: 0.34 },
  { step: 6, label: 'ly', vowel: 'ee', midi: [72, 76], length: 1.35, velocity: 0.56, breath: 0.12 },
  { step: 10, label: 'clouds', vowel: 'ow', midi: [69, 64], length: 3.1, velocity: 0.78, breath: 0.28 }
];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const previousMatches = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    enabled: previousMatches ? prevState.enabled !== false : true,
    volume: previousMatches ? finite(prevState.volume, 0.5) : 0.5,
    tone: previousMatches ? finite(prevState.tone, 0.6) : 0.6,
    drift: previousMatches ? finite(prevState.drift, 0.42) : 0.42,
    echo: previousMatches ? finite(prevState.echo, 0.34) : 0.34
  };

  let zefiroBreath = null;
  let zefiroTone = null;
  let currentStep = -1;
  let currentWord = 'clouds';
  let pulse = 0;
  let stepSeconds = 0.125;
  let raf = 0;
  let audioStateKey = '';

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  const output = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1.4);
  const feedback = audio.createGain();
  const delayFilter = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = state.enabled ? state.volume : 0;
  highpass.type = 'highpass';
  highpass.frequency.value = 130;
  compressor.threshold.value = -23;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  delay.delayTime.value = 0.26;
  feedback.gain.value = 0.28;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 3200;
  wet.gain.value = state.echo;

  output.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(wet);
  wet.connect(output);

  ctx.domRoot.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        height: 100%;
        min-width: 300px;
        padding: 10px 12px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 8px;
        color: #eff6ff;
        background:
          radial-gradient(circle at 50% 115%, rgba(186, 230, 253, 0.22), transparent 44%),
          linear-gradient(135deg, rgba(7, 18, 30, 0.96), rgba(21, 33, 48, 0.96) 56%, rgba(12, 20, 29, 0.96));
        border: 1px solid rgba(125, 211, 252, 0.44);
        border-radius: 8px;
        font: 11px/1.32 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #bae6fd;
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 3px;
        color: #94a3b8;
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        height: 28px;
        min-width: 48px;
        padding: 0 9px;
        border: 1px solid rgba(125, 211, 252, 0.58);
        border-radius: 5px;
        color: #06121e;
        background: #7dd3fc;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.78);
        border-color: rgba(148, 163, 184, 0.34);
      }
      .controls {
        display: grid;
        gap: 5px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 7px;
        color: #dbeafe;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #7dd3fc;
      }
      .orb {
        min-height: 82px;
        border: 1px solid rgba(125, 211, 252, 0.34);
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 8px;
        padding: 10px;
        overflow: hidden;
        background:
          radial-gradient(circle at 42% 44%, rgba(255, 255, 255, 0.74), rgba(186, 230, 253, 0.44) calc(17% + var(--pulse) * 12%), transparent calc(28% + var(--pulse) * 14%)),
          radial-gradient(circle at 66% 34%, rgba(224, 242, 254, 0.34), transparent 25%),
          linear-gradient(180deg, rgba(8, 20, 32, 0.36), rgba(3, 7, 18, 0.72));
      }
      .word {
        color: #f8fafc;
        font: 700 24px/0.95 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        transform: translateY(calc(var(--pulse) * -5px));
        text-shadow: 0 0 calc(7px + var(--pulse) * 18px) rgba(186, 230, 253, 0.76);
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(16, 5px);
        gap: 3px;
        align-self: center;
      }
      .steps span {
        width: 5px;
        height: 26px;
        background: rgba(148, 163, 184, 0.24);
      }
      .steps span.wordstep {
        background: rgba(125, 211, 252, 0.42);
      }
      .steps span.on {
        background: #e0f2fe;
        box-shadow: 0 0 10px rgba(186, 230, 253, 0.72);
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h1>WHITE FLUFFY CLOUDS</h1>
          <div class="sub">clocked breath-voice mantra</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="controls">
        <label>volume <input id="volume" type="range" min="0" max="0.9" step="0.01"><span id="volumeVal"></span></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"><span id="toneVal"></span></label>
        <label>drift <input id="drift" type="range" min="0" max="1" step="0.01"><span id="driftVal"></span></label>
        <label>echo <input id="echo" type="range" min="0" max="0.8" step="0.01"><span id="echoVal"></span></label>
      </div>
      <div id="orb" class="orb" style="--pulse:0">
        <div id="word" class="word">clouds</div>
        <div id="steps" class="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const sliders = {
    volume: $('#volume'),
    tone: $('#tone'),
    drift: $('#drift'),
    echo: $('#echo')
  };
  const values = {
    volume: $('#volumeVal'),
    tone: $('#toneVal'),
    drift: $('#driftVal'),
    echo: $('#echoVal')
  };
  const orb = $('#orb');
  const wordEl = $('#word');
  const steps = $('#steps');
  const wordSteps = new Set(PHRASE.map((event) => event.step));
  const stepEls = Array.from({ length: 16 }, (_, index) => {
    const el = document.createElement('span');
    if (wordSteps.has(index)) el.classList.add('wordstep');
    steps.appendChild(el);
    return el;
  });

  const toneValue = () => clamp(zefiroTone ?? state.tone, 0, 1);
  const breathValue = () => clamp(zefiroBreath ?? 0.66, 0, 1);

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(140, seconds * 1000 + 200));
    cleanupTimers.add(timer);
  };

  const makeNoiseBuffer = (seconds) => {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.8);
    }
    return buffer;
  };

  const schedulePitch = (osc, points, startTime, duration) => {
    const drift = clamp(state.drift, 0, 1);
    osc.frequency.setValueAtTime(midiToFreq(points[0]), startTime);
    points.forEach((midi, index) => {
      if (index === 0) return;
      const position = index / (points.length - 1);
      const target = points[0] + (midi - points[0]) * (0.48 + drift * 0.52);
      osc.frequency.exponentialRampToValueAtTime(midiToFreq(target), startTime + duration * (0.22 + position * 0.66));
    });
  };

  const playWord = (event, time, tickDuration) => {
    if (!state.enabled) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const tone = toneValue();
    const breath = breathValue();
    const length = clamp(event.length * tickDuration, 0.22, 0.9);
    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const gainA = audio.createGain();
    const gainB = audio.createGain();
    const amp = audio.createGain();
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const lfo = audio.createOscillator();
    const lfoDepth = audio.createGain();
    const nodes = [oscA, oscB, gainA, gainB, amp, noise, noiseFilter, noiseGain, lfo, lfoDepth];

    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    schedulePitch(oscA, event.midi, t, length);
    schedulePitch(oscB, event.midi.map((midi) => midi + 12), t, length);
    oscA.detune.setValueAtTime(-5, t);
    oscB.detune.setValueAtTime(6, t);
    lfo.frequency.setValueAtTime(4.2 + state.drift * 2.8, t);
    lfoDepth.gain.setValueAtTime(8 + state.drift * 18, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(oscA.detune);
    lfoDepth.connect(oscB.detune);

    const peak = event.velocity * (0.48 + breath * 0.34);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.03);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * 0.62), t + length * 0.42, 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    gainA.gain.setValueAtTime(0.72, t);
    gainB.gain.setValueAtTime(0.18 + state.drift * 0.18, t);

    oscA.connect(gainA);
    oscB.connect(gainB);
    const formants = FORMANTS[event.vowel] || FORMANTS.ah;
    formants.forEach(([freq, amount, q]) => {
      const filter = audio.createBiquadFilter();
      const formantGain = audio.createGain();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * (0.9 + tone * 0.2), t);
      filter.Q.setValueAtTime(q, t);
      formantGain.gain.setValueAtTime(amount, t);
      gainA.connect(filter);
      gainB.connect(filter);
      filter.connect(formantGain);
      formantGain.connect(amp);
      nodes.push(filter, formantGain);
    });

    noise.buffer = makeNoiseBuffer(length + 0.02);
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(1500 + tone * 3000, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(event.breath * (0.16 + tone * 0.18), t + 0.014);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.6);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(amp);

    if (pan) {
      pan.pan.setValueAtTime(Math.sin(event.step * 0.71) * 0.22, t);
      amp.connect(pan);
      pan.connect(output);
      pan.connect(delay);
      nodes.push(pan);
    } else {
      amp.connect(output);
      amp.connect(delay);
    }

    oscA.start(t);
    oscB.start(t);
    noise.start(t);
    lfo.start(t);
    oscA.stop(t + length + 0.04);
    oscB.stop(t + length + 0.04);
    noise.stop(t + length + 0.02);
    lfo.stop(t + length + 0.04);
    track(length + 0.08, ...nodes);

    currentWord = event.label;
    pulse = 1;
  };

  const applyAudioState = () => {
    const key = [state.enabled, state.volume, state.echo, state.tone].join('|');
    if (key === audioStateKey) return;
    audioStateKey = key;
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, audio.currentTime, 0.035);
    wet.gain.setTargetAtTime(state.echo, audio.currentTime, 0.05);
    feedback.gain.setTargetAtTime(0.14 + state.echo * 0.46, audio.currentTime, 0.05);
    delayFilter.frequency.setTargetAtTime(1900 + toneValue() * 3800, audio.currentTime, 0.05);
  };

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('off', !state.enabled);
    Object.keys(sliders).forEach((key) => {
      if (sliders[key].value !== String(state[key])) sliders[key].value = String(state[key]);
      values[key].textContent = Number(state[key]).toFixed(2);
    });
    wordEl.textContent = currentWord;
    stepEls.forEach((el, index) => el.classList.toggle('on', index === currentStep));
    orb.style.setProperty('--pulse', pulse.toFixed(3));
    applyAudioState();
  };

  const onTick = ({ step, time, duration }) => {
    currentStep = ((step % 16) + 16) % 16;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    const tickDuration = clamp(duration || stepSeconds, 0.07, 0.34);
    delay.delayTime.setTargetAtTime(tickDuration * (1.7 + state.echo), audio.currentTime, 0.04);
    const event = PHRASE.find((item) => item.step === currentStep);
    if (event) playWord(event, time, tickDuration);
    render();
  };

  const animate = () => {
    pulse *= 0.9;
    render();
    raf = requestAnimationFrame(animate);
  };

  const onEnabled = () => {
    state.enabled = !state.enabled;
    render();
  };
  const onSlider = (key) => () => {
    state[key] = Number(sliders[key].value);
    render();
  };
  const sliderHandlers = {
    volume: onSlider('volume'),
    tone: onSlider('tone'),
    drift: onSlider('drift'),
    echo: onSlider('echo')
  };

  enabledButton.addEventListener('click', onEnabled);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));
  const unsubscribeClock = ctx.clock.onTick(onTick);
  const unsubscribeBreath = ctx.bus.subGlobal('global:zefiro:cc11', (value) => {
    if (Number.isFinite(value)) zefiroBreath = clamp(value, 0, 1);
  });
  const unsubscribeTone = ctx.bus.subGlobal('global:zefiro:cc1', (value) => {
    if (Number.isFinite(value)) zefiroTone = clamp(value, 0, 1);
  });
  render();
  raf = requestAnimationFrame(animate);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      cancelAnimationFrame(raf);
      unsubscribeClock();
      unsubscribeBreath();
      unsubscribeTone();
      enabledButton.removeEventListener('click', onEnabled);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        output.disconnect(); highpass.disconnect(); compressor.disconnect(); delay.disconnect();
        feedback.disconnect(); delayFilter.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
