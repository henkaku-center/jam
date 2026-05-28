const STATE_VERSION = 'chopin-nocturne-riff-v1';

// Public-domain Chopin-inspired phrase, shaped around the famous Op. 9 No. 2 contour.
const RIFF = [
  { step: 0, notes: [63, 67], length: 1.55, velocity: 0.72 },
  { step: 2, notes: [70], length: 0.85, velocity: 0.58 },
  { step: 3, notes: [67], length: 0.72, velocity: 0.46 },
  { step: 4, notes: [65, 70], length: 1.25, velocity: 0.66 },
  { step: 6, notes: [63], length: 0.9, velocity: 0.48 },
  { step: 8, notes: [62, 65], length: 1.4, velocity: 0.64 },
  { step: 10, notes: [58], length: 0.85, velocity: 0.44 },
  { step: 11, notes: [60], length: 0.72, velocity: 0.46 },
  { step: 12, notes: [63, 67, 70], length: 1.8, velocity: 0.72 }
];

const BASS = [
  { step: 0, notes: [39, 51, 58] },
  { step: 4, notes: [44, 51, 56] },
  { step: 8, notes: [34, 46, 53] },
  { step: 12, notes: [39, 51, 55] }
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
    volume: previousMatches ? finite(prevState.volume, 0.52) : 0.52,
    tone: previousMatches ? finite(prevState.tone, 0.58) : 0.58,
    ornament: previousMatches ? finite(prevState.ornament, 0.48) : 0.48,
    room: previousMatches ? finite(prevState.room, 0.34) : 0.34
  };

  let currentStep = -1;
  let currentLabel = 'Eb nocturne';
  let pulse = 0;
  let stepSeconds = 0.125;
  let raf = 0;
  let audioStateKey = '';

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1.2);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = state.enabled ? state.volume : 0;
  compressor.threshold.value = -22;
  compressor.knee.value = 20;
  compressor.ratio.value = 2.6;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  delay.delayTime.value = 0.31;
  feedback.gain.value = 0.22;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3400;
  wet.gain.value = state.room;

  output.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
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
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(13, 18, 28, 0.96), rgba(30, 24, 38, 0.96) 56%, rgba(12, 18, 24, 0.96)),
          repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(216, 180, 254, 0.42);
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
        color: #e9d5ff;
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
        border: 1px solid rgba(216, 180, 254, 0.58);
        border-radius: 5px;
        color: #13091f;
        background: #d8b4fe;
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
        grid-template-columns: 66px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 7px;
        color: #ddd6fe;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #d8b4fe;
      }
      .stage {
        min-height: 78px;
        border: 1px solid rgba(216, 180, 254, 0.32);
        background:
          radial-gradient(circle at 48% 44%, rgba(233, 213, 255, 0.32), transparent calc(25% + var(--pulse) * 11%)),
          linear-gradient(180deg, rgba(13, 18, 30, 0.58), rgba(4, 8, 18, 0.82));
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 8px;
        padding: 10px;
        overflow: hidden;
      }
      .label {
        color: #faf5ff;
        font: 700 22px/0.95 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        transform: translateY(calc(var(--pulse) * -5px));
        text-shadow: 0 0 calc(6px + var(--pulse) * 16px) rgba(216, 180, 254, 0.72);
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
      .steps span.note {
        background: rgba(216, 180, 254, 0.38);
      }
      .steps span.on {
        background: #f5d0fe;
        box-shadow: 0 0 10px rgba(216, 180, 254, 0.76);
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h1>CHOPIN RIFF</h1>
          <div class="sub">clocked public-domain nocturne loop</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="controls">
        <label>volume <input id="volume" type="range" min="0" max="0.9" step="0.01"><span id="volumeVal"></span></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"><span id="toneVal"></span></label>
        <label>ornament <input id="ornament" type="range" min="0" max="1" step="0.01"><span id="ornamentVal"></span></label>
        <label>room <input id="room" type="range" min="0" max="0.8" step="0.01"><span id="roomVal"></span></label>
      </div>
      <div id="stage" class="stage" style="--pulse:0">
        <div id="label" class="label">Eb nocturne</div>
        <div id="steps" class="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const sliders = {
    volume: $('#volume'),
    tone: $('#tone'),
    ornament: $('#ornament'),
    room: $('#room')
  };
  const values = {
    volume: $('#volumeVal'),
    tone: $('#toneVal'),
    ornament: $('#ornamentVal'),
    room: $('#roomVal')
  };
  const stage = $('#stage');
  const labelEl = $('#label');
  const steps = $('#steps');
  const noteSteps = new Set([...RIFF.map((event) => event.step), ...BASS.map((event) => event.step)]);
  const stepEls = Array.from({ length: 16 }, (_, index) => {
    const el = document.createElement('span');
    if (noteSteps.has(index)) el.classList.add('note');
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
    }, Math.max(140, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  };

  const playPianoNote = (time, midi, velocity, length, panValue = 0, sendDelay = true) => {
    const t = Math.max(time, audio.currentTime + 0.004);
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const overtone = audio.createOscillator();
    const strike = audio.createBufferSource();
    const strikeFilter = audio.createBiquadFilter();
    const strikeGain = audio.createGain();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const nodes = [osc, overtone, strike, strikeFilter, strikeGain, gain, filter];

    osc.type = 'triangle';
    overtone.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    overtone.frequency.setValueAtTime(freq * 2.01, t);
    osc.detune.setValueAtTime(-2, t);
    overtone.detune.setValueAtTime(3, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1050 + state.tone * 3800 + velocity * 900, t);
    filter.frequency.exponentialRampToValueAtTime(520 + state.tone * 1300, t + length);
    filter.Q.setValueAtTime(1.1, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, velocity * 0.16), t + 0.012);
    gain.gain.setTargetAtTime(Math.max(0.0001, velocity * 0.06), t + length * 0.3, 0.11);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (pan) {
      pan.pan.setValueAtTime(panValue, t);
      nodes.push(pan);
    }

    const strikeBuffer = audio.createBuffer(1, Math.max(1, Math.floor(audio.sampleRate * 0.035)), audio.sampleRate);
    const data = strikeBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.5);
    }
    strike.buffer = strikeBuffer;
    strikeFilter.type = 'highpass';
    strikeFilter.frequency.setValueAtTime(1800 + state.tone * 2800, t);
    strikeGain.gain.setValueAtTime(0.0001, t);
    strikeGain.gain.exponentialRampToValueAtTime(velocity * 0.028, t + 0.003);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    osc.connect(gain);
    overtone.connect(gain);
    gain.connect(filter);
    strike.connect(strikeFilter);
    strikeFilter.connect(strikeGain);
    strikeGain.connect(filter);
    if (pan) {
      filter.connect(pan);
      pan.connect(output);
      if (sendDelay) pan.connect(delay);
    } else {
      filter.connect(output);
      if (sendDelay) filter.connect(delay);
    }

    osc.start(t);
    overtone.start(t);
    strike.start(t);
    osc.stop(t + length + 0.04);
    overtone.stop(t + length + 0.04);
    strike.stop(t + 0.05);
    track(length + 0.08, ...nodes);
  };

  const playRiffEvent = (event, time, tickDuration) => {
    const length = clamp(event.length * tickDuration, 0.09, 0.72);
    event.notes.forEach((midi, index) => {
      playPianoNote(time + index * 0.012, midi, event.velocity * (index ? 0.74 : 1), length, -0.16 + index * 0.16);
    });
    if (state.ornament > 0.35 && event.notes.length === 1 && event.step % 4 !== 0) {
      playPianoNote(time + tickDuration * 0.46, event.notes[0] + 2, event.velocity * state.ornament * 0.38, tickDuration * 0.72, 0.18, false);
    }
    currentLabel = 'Op. 9 echo';
    pulse = 1;
  };

  const playBassEvent = (event, time, tickDuration) => {
    event.notes.forEach((midi, index) => {
      playPianoNote(time + index * tickDuration * 0.36, midi, 0.42 - index * 0.06, tickDuration * 1.4, -0.32, index === 2);
    });
  };

  const applyAudioState = () => {
    const key = [state.enabled, state.volume, state.room, state.tone].join('|');
    if (key === audioStateKey) return;
    audioStateKey = key;
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, audio.currentTime, 0.035);
    wet.gain.setTargetAtTime(state.room, audio.currentTime, 0.05);
    feedback.gain.setTargetAtTime(0.12 + state.room * 0.42, audio.currentTime, 0.05);
    delayTone.frequency.setTargetAtTime(1900 + state.tone * 3600, audio.currentTime, 0.05);
  };

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('off', !state.enabled);
    Object.keys(sliders).forEach((key) => {
      if (sliders[key].value !== String(state[key])) sliders[key].value = String(state[key]);
      values[key].textContent = Number(state[key]).toFixed(2);
    });
    labelEl.textContent = currentLabel;
    stepEls.forEach((el, index) => el.classList.toggle('on', index === currentStep));
    stage.style.setProperty('--pulse', pulse.toFixed(3));
    applyAudioState();
  };

  const onTick = ({ step, time, duration }) => {
    currentStep = ((step % 16) + 16) % 16;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    const tickDuration = clamp(duration || stepSeconds, 0.07, 0.34);
    delay.delayTime.setTargetAtTime(tickDuration * (2 + state.room), audio.currentTime, 0.04);
    if (!state.enabled) {
      render();
      return;
    }
    const riff = RIFF.find((event) => event.step === currentStep);
    const bass = BASS.find((event) => event.step === currentStep);
    if (bass) playBassEvent(bass, time, tickDuration);
    if (riff) playRiffEvent(riff, time, tickDuration);
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
    ornament: onSlider('ornament'),
    room: onSlider('room')
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
        feedback.disconnect(); delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
