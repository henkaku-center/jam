const STATE_VERSION = 'ska-reggae-offbeats-v1';

const CHORDS = [
  { name: 'Gm', notes: [67, 70, 74, 79] },
  { name: 'Cm', notes: [67, 72, 75, 79] },
  { name: 'D7', notes: [66, 72, 74, 78] },
  { name: 'Bb', notes: [65, 70, 74, 77] }
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
    volume: previousMatches ? finite(prevState.volume, 0.58) : 0.58,
    skank: previousMatches ? finite(prevState.skank, 0.82) : 0.82,
    organ: previousMatches ? finite(prevState.organ, 0.48) : 0.48,
    rim: previousMatches ? finite(prevState.rim, 0.42) : 0.42,
    delay: previousMatches ? finite(prevState.delay, 0.24) : 0.24
  };

  let currentStep = -1;
  let currentChord = CHORDS[0].name;
  let pulse = 0;
  let stepSeconds = 0.125;
  let raf = 0;
  let audioStateKey = '';

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1);
  const feedback = audio.createGain();
  const delayFilter = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = state.enabled ? state.volume : 0;
  compressor.threshold.value = -20;
  compressor.knee.value = 16;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.12;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.22;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 3600;
  wet.gain.value = state.delay;

  output.connect(compressor);
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
        min-width: 280px;
        padding: 10px 12px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 8px;
        color: #ecfccb;
        background:
          linear-gradient(135deg, rgba(8, 18, 12, 0.96), rgba(35, 36, 16, 0.96) 58%, rgba(18, 10, 8, 0.96)),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(132, 204, 22, 0.44);
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
        color: #bef264;
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
        border: 1px solid rgba(190, 242, 100, 0.56);
        border-radius: 5px;
        color: #07140f;
        background: #bef264;
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
        grid-template-columns: 58px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 7px;
        color: #dbeafe;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #bef264;
      }
      .stage {
        min-height: 76px;
        border: 1px solid rgba(132, 204, 22, 0.34);
        background:
          radial-gradient(circle at calc(50% + var(--pulse) * 12%) 48%, rgba(250, 204, 21, 0.36), transparent calc(21% + var(--pulse) * 13%)),
          linear-gradient(180deg, rgba(4, 12, 8, 0.72), rgba(20, 13, 7, 0.82));
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 8px;
        padding: 9px;
        overflow: hidden;
      }
      .chord {
        color: #fef3c7;
        font: 700 26px/0.95 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        transform: translateY(calc(var(--pulse) * -4px));
        text-shadow: 0 0 calc(5px + var(--pulse) * 14px) rgba(250, 204, 21, 0.6);
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
      .steps span.off {
        background: rgba(190, 242, 100, 0.42);
      }
      .steps span.on {
        background: #facc15;
        box-shadow: 0 0 10px rgba(250, 204, 21, 0.72);
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h1>SKA OFFBEATS</h1>
          <div class="sub">skank chords, bubble organ, rim ticks</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="controls">
        <label>volume <input id="volume" type="range" min="0" max="1" step="0.01"><span id="volumeVal"></span></label>
        <label>skank <input id="skank" type="range" min="0" max="1" step="0.01"><span id="skankVal"></span></label>
        <label>organ <input id="organ" type="range" min="0" max="1" step="0.01"><span id="organVal"></span></label>
        <label>rim <input id="rim" type="range" min="0" max="1" step="0.01"><span id="rimVal"></span></label>
        <label>delay <input id="delay" type="range" min="0" max="0.7" step="0.01"><span id="delayVal"></span></label>
      </div>
      <div id="stage" class="stage" style="--pulse:0">
        <div id="chord" class="chord">Gm</div>
        <div id="steps" class="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const sliders = {
    volume: $('#volume'),
    skank: $('#skank'),
    organ: $('#organ'),
    rim: $('#rim'),
    delay: $('#delay')
  };
  const values = {
    volume: $('#volumeVal'),
    skank: $('#skankVal'),
    organ: $('#organVal'),
    rim: $('#rimVal'),
    delay: $('#delayVal')
  };
  const stage = $('#stage');
  const chordEl = $('#chord');
  const steps = $('#steps');
  const stepEls = Array.from({ length: 16 }, (_, index) => {
    const el = document.createElement('span');
    if (index % 4 === 2) el.classList.add('off');
    steps.appendChild(el);
    return el;
  });

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

  const makeNoiseBuffer = (seconds) => {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.9);
    }
    return buffer;
  };

  const chordForStep = (step) => CHORDS[Math.floor(step / 16) % CHORDS.length];

  const playSkank = (time, chord, velocity, tickDuration) => {
    if (!state.enabled || state.skank <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const length = clamp(tickDuration * 0.88, 0.055, 0.19);
    const bus = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pick = audio.createBufferSource();
    const pickFilter = audio.createBiquadFilter();
    const pickGain = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const nodes = [bus, filter, pick, pickFilter, pickGain];

    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(state.skank * velocity * 0.24, t + 0.009);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + length);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1450 + velocity * 850, t);
    filter.Q.setValueAtTime(2.2, t);
    pick.buffer = makeNoiseBuffer(length + 0.015);
    pickFilter.type = 'highpass';
    pickFilter.frequency.setValueAtTime(2400, t);
    pickGain.gain.setValueAtTime(0.0001, t);
    pickGain.gain.exponentialRampToValueAtTime(state.skank * 0.08, t + 0.004);
    pickGain.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.42);
    if (pan) {
      pan.pan.setValueAtTime(Math.sin(currentStep * 0.9) * 0.24, t);
      nodes.push(pan);
    }

    chord.notes.forEach((midi, index) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = index % 2 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(midi), t);
      osc.detune.setValueAtTime((index - 1.5) * 4, t);
      gain.gain.setValueAtTime(index === 0 ? 0.58 : 0.42, t);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(t);
      osc.stop(t + length + 0.025);
      nodes.push(osc, gain);
    });

    pick.connect(pickFilter);
    pickFilter.connect(pickGain);
    pickGain.connect(bus);
    bus.connect(filter);
    if (pan) {
      filter.connect(pan);
      pan.connect(output);
      pan.connect(delay);
    } else {
      filter.connect(output);
      filter.connect(delay);
    }
    pick.start(t);
    pick.stop(t + length + 0.02);
    track(length + 0.06, ...nodes);
  };

  const playOrganBubble = (time, chord, step, tickDuration) => {
    if (!state.enabled || state.organ <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const length = clamp(tickDuration * 0.72, 0.045, 0.16);
    const bus = audio.createGain();
    const filter = audio.createBiquadFilter();
    const note = chord.notes[(step + 1) % chord.notes.length] - (step % 8 === 1 ? 12 : 0);
    const nodes = [bus, filter];
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(state.organ * 0.11, t + 0.012);
    bus.gain.exponentialRampToValueAtTime(0.0001, t + length);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(950 + state.organ * 1800, t);
    filter.Q.setValueAtTime(3.4, t);

    [0, 12, 19].forEach((interval, index) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(midiToFreq(note + interval), t);
      gain.gain.setValueAtTime(index === 0 ? 0.58 : 0.22, t);
      osc.connect(gain);
      gain.connect(bus);
      osc.start(t);
      osc.stop(t + length + 0.03);
      nodes.push(osc, gain);
    });

    bus.connect(filter);
    filter.connect(output);
    if (step % 4 === 1) filter.connect(delay);
    track(length + 0.05, ...nodes);
  };

  const playRim = (time, tickDuration, accent = 1) => {
    if (!state.enabled || state.rim <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const length = clamp(tickDuration * 0.34, 0.035, 0.1);
    const noise = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    noise.buffer = makeNoiseBuffer(length);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2500 + accent * 600, t);
    filter.Q.setValueAtTime(7, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(state.rim * 0.14 * accent, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    if (accent > 0.9) gain.connect(delay);
    noise.start(t);
    noise.stop(t + length + 0.015);
    track(length + 0.04, noise, filter, gain);
  };

  const applyAudioState = () => {
    const key = [state.enabled, state.volume, state.delay].join('|');
    if (key === audioStateKey) return;
    audioStateKey = key;
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, audio.currentTime, 0.035);
    wet.gain.setTargetAtTime(state.delay, audio.currentTime, 0.05);
    feedback.gain.setTargetAtTime(0.12 + state.delay * 0.42, audio.currentTime, 0.05);
  };

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('off', !state.enabled);
    Object.keys(sliders).forEach((key) => {
      if (sliders[key].value !== String(state[key])) sliders[key].value = String(state[key]);
      values[key].textContent = Number(state[key]).toFixed(2);
    });
    chordEl.textContent = currentChord;
    stepEls.forEach((el, index) => el.classList.toggle('on', index === currentStep));
    stage.style.setProperty('--pulse', pulse.toFixed(3));
    applyAudioState();
  };

  const onTick = ({ step, time, duration }) => {
    currentStep = ((step % 16) + 16) % 16;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    const tickDuration = clamp(duration || stepSeconds, 0.07, 0.34);
    delay.delayTime.setTargetAtTime(tickDuration * 1.48, audio.currentTime, 0.04);
    const chord = chordForStep(step);
    currentChord = chord.name;

    if (currentStep % 4 === 2) {
      playSkank(time, chord, currentStep === 10 ? 1 : 0.82, tickDuration);
      pulse = 1;
    }
    if (currentStep % 2 === 1) {
      const swing = currentStep % 4 === 3 ? tickDuration * 0.08 : 0;
      playOrganBubble(time + swing, chord, currentStep, tickDuration);
      pulse = Math.max(pulse, 0.42);
    }
    if ([3, 7, 11, 15].includes(currentStep)) {
      playRim(time, tickDuration, currentStep === 15 ? 1 : 0.72);
    }

    render();
  };

  const animate = () => {
    pulse *= 0.88;
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
    skank: onSlider('skank'),
    organ: onSlider('organ'),
    rim: onSlider('rim'),
    delay: onSlider('delay')
  };

  enabledButton.addEventListener('click', onEnabled);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));
  const unsubscribeClock = ctx.clock.onTick(onTick);
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
        output.disconnect(); compressor.disconnect(); delay.disconnect();
        feedback.disconnect(); delayFilter.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
