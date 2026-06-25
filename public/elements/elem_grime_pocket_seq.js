export default function setup(ctx, prevState) {
  const STEPS = 16;
  const VOICES = [
    { id: 'kick', label: 'KICK', color: '#e63946' },
    { id: 'snare', label: 'SNARE', color: '#f5a623' },
    { id: 'hat', label: 'HAT', color: '#3b82f6' },
    { id: 'bass', label: 'BASS', color: '#e63946' }
  ];

  const DEFAULT_PATTERN = {
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0]
  };
  const BASS_NOTES = [43.65, 43.65, 51.91, 38.89, 43.65, 32.7, 38.89, 43.65, 29.14, 43.65, 38.89, 51.91, 43.65, 38.89, 32.7, 43.65];

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
  const copyPattern = (source, fallback) => {
    const out = {};
    for (const voice of VOICES) {
      const incoming = Array.isArray(source?.[voice.id]) ? source[voice.id] : fallback[voice.id];
      out[voice.id] = Array.from({ length: STEPS }, (_, i) => incoming[i] ? 1 : 0);
    }
    return out;
  };
  const normalizeState = (incoming = {}) => ({
    schema: 1,
    enabled: bool(incoming.enabled, true),
    volume: clamp(finite(incoming.volume, 0.68), 0, 1),
    swing: clamp(finite(incoming.swing, 0.28), 0, 0.65),
    grime: clamp(finite(incoming.grime, 0.52), 0, 1),
    accent: clamp(finite(incoming.accent, 0.72), 0, 1),
    fill: clamp(finite(incoming.fill, 0), 0, 1),
    pattern: copyPattern(incoming.pattern ?? incoming, DEFAULT_PATTERN)
  });

  const state = normalizeState(prevState);
  let activeStep = -1;
  let renderedStep = -1;
  let pulse = 0;
  let lastTickAt = 0;
  let rafHue = 0;
  const scheduledNodes = new Set();
  const cleanupTimers = new Set();

  const output = ctx.audioCtx.createGain();
  const drive = ctx.audioCtx.createWaveShaper();
  const tone = ctx.audioCtx.createBiquadFilter();
  const safety = ctx.audioCtx.createDynamicsCompressor();
  output.gain.value = state.enabled ? state.volume : 0;
  drive.curve = makeDriveCurve(state.grime);
  drive.oversample = '2x';
  tone.type = 'lowpass';
  tone.frequency.value = 6200;
  tone.Q.value = 0.55;
  safety.threshold.value = -18;
  safety.knee.value = 16;
  safety.ratio.value = 4;
  safety.attack.value = 0.004;
  safety.release.value = 0.16;
  output.connect(drive);
  drive.connect(tone);
  tone.connect(safety);
  safety.connect(ctx.audioOut);

  const noiseBuffer = makeNoiseBuffer(ctx.audioCtx);

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      * {
        box-sizing: border-box;
      }
      .seq {
        width: 100%;
        height: 100%;
        min-width: 270px;
        min-height: 190px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        padding: 10px;
        background: rgba(26, 28, 33, 0.86);
        border: 1px solid #2a2d35;
        color: #d4d8e0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .top {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: start;
      }
      .title {
        min-width: 0;
      }
      .name {
        font: 700 12px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 3px;
        color: #555d6e;
        font-size: 10px;
        line-height: 1.2;
      }
      button {
        appearance: none;
        border: 1px solid #2a2d35;
        border-radius: 0;
        background: #1a1c21;
        color: #d4d8e0;
        min-height: 28px;
        padding: 0 9px;
        font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        cursor: pointer;
      }
      button[aria-pressed="true"] {
        color: #1a1c21;
        background: #f5a623;
        border-color: #f5a623;
      }
      .gridWrap {
        min-height: 0;
        overflow: hidden;
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 5px 7px;
        align-content: center;
      }
      .voiceLabel {
        min-width: 42px;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        color: #d4d8e0;
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .row {
        display: grid;
        grid-template-columns: repeat(16, minmax(9px, 1fr));
        gap: 3px;
        min-width: 0;
      }
      .step {
        position: relative;
        width: 100%;
        aspect-ratio: 1 / 1;
        min-height: 11px;
        padding: 0;
        border: 1px solid #2a2d35;
        background: rgba(18, 20, 25, 0.72);
        color: transparent;
      }
      .step:nth-child(4n + 1) {
        border-color: #555d6e;
      }
      .step.active {
        background: var(--voice-color);
        border-color: var(--voice-color);
      }
      .step.playhead {
        outline: 1px solid #d4d8e0;
        outline-offset: -2px;
      }
      .step.hit {
        transform: translateY(-1px);
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }
      label {
        display: grid;
        grid-template-rows: auto auto;
        gap: 3px;
        min-width: 0;
        color: #555d6e;
        font-size: 9px;
        line-height: 1.1;
        text-transform: uppercase;
      }
      .read {
        color: #d4d8e0;
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #3b82f6;
      }
      canvas {
        width: 100%;
        height: 26px;
        border: 1px solid #2a2d35;
        background: #111318;
      }
      @media (max-width: 360px) {
        .seq {
          padding: 8px;
          gap: 6px;
        }
        .controls {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .voiceLabel {
          min-width: 37px;
          font-size: 9px;
        }
      }
    </style>
    <div class="seq">
      <div class="top">
        <div class="title">
          <div class="name">GRIME POCKET SEQ</div>
          <div class="sub" id="status">armed</div>
        </div>
        <button id="enable" type="button" aria-pressed="${state.enabled ? 'true' : 'false'}">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="gridWrap" id="grid"></div>
      <div class="controls">
        <label>vol <span class="read" id="volumeRead"></span><input id="volume" type="range" min="0" max="1" step="0.01"></label>
        <label>swing <span class="read" id="swingRead"></span><input id="swing" type="range" min="0" max="0.65" step="0.01"></label>
        <label>grime <span class="read" id="grimeRead"></span><input id="grime" type="range" min="0" max="1" step="0.01"></label>
        <label>fill <span class="read" id="fillRead"></span><input id="fill" type="range" min="0" max="1" step="0.01"></label>
      </div>
      <canvas id="scope" width="520" height="40" aria-hidden="true"></canvas>
    </div>
  `;

  const grid = ctx.domRoot.querySelector('#grid');
  const enableButton = ctx.domRoot.querySelector('#enable');
  const status = ctx.domRoot.querySelector('#status');
  const scope = ctx.domRoot.querySelector('#scope');
  const scopeCtx = scope.getContext('2d');
  const sliders = {
    volume: ctx.domRoot.querySelector('#volume'),
    swing: ctx.domRoot.querySelector('#swing'),
    grime: ctx.domRoot.querySelector('#grime'),
    fill: ctx.domRoot.querySelector('#fill')
  };
  const reads = {
    volume: ctx.domRoot.querySelector('#volumeRead'),
    swing: ctx.domRoot.querySelector('#swingRead'),
    grime: ctx.domRoot.querySelector('#grimeRead'),
    fill: ctx.domRoot.querySelector('#fillRead')
  };

  buildGrid();
  render();
  drawScope(0);

  const publishState = () => {
    ctx.bus.pubGlobal('grimePocketSeq:state', serializeState());
  };

  const onEnable = () => {
    resumeAudio();
    state.enabled = !state.enabled;
    syncOutput();
    render();
    publishState();
  };
  enableButton.addEventListener('click', onEnable);

  const onGridClick = (event) => {
    const button = event.target.closest('.step');
    if (!button) return;
    const voice = button.dataset.voice;
    const step = Number(button.dataset.step);
    if (!state.pattern[voice] || !Number.isInteger(step)) return;
    resumeAudio();
    state.pattern[voice][step] = state.pattern[voice][step] ? 0 : 1;
    renderStep(voice, step);
    publishState();
  };
  grid.addEventListener('click', onGridClick);

  const sliderListeners = [];
  for (const [key, slider] of Object.entries(sliders)) {
    const listener = () => {
      resumeAudio();
      state[key] = finite(slider.value, state[key]);
      if (key === 'grime') drive.curve = makeDriveCurve(state.grime);
      syncOutput();
      renderControls();
      publishState();
    };
    slider.addEventListener('input', listener);
    sliderListeners.push([slider, listener]);
  }

  const unsubscribeState = safeUnsub(ctx.bus.subGlobal('grimePocketSeq:state', (incoming) => {
    if (!incoming || typeof incoming !== 'object') return;
    const next = normalizeState(incoming);
    Object.assign(state, next);
    state.pattern = copyPattern(next.pattern, DEFAULT_PATTERN);
    syncOutput();
    drive.curve = makeDriveCurve(state.grime);
    render();
  }));

  const unsubscribeTick = safeUnsub(ctx.clock.onTick(({ step, time, duration, bpm }) => {
    const stepIndex = ((step % STEPS) + STEPS) % STEPS;
    const sixteenth = Number.isFinite(duration) && duration > 0 ? duration : 60 / Math.max(1, finite(bpm, 140)) / 4;
    const swingOffset = stepIndex % 2 === 1 ? sixteenth * state.swing * 0.48 : 0;
    const eventTime = time + swingOffset;
    activeStep = stepIndex;
    lastTickAt = ctx.audioCtx.currentTime;
    pulse = 1;
    ctx.bus.pub('grimePocketSeq:step', { step: stepIndex, enabled: state.enabled });
    if (!state.enabled) return;
    scheduleStep(stepIndex, eventTime, sixteenth);
  }));

  function buildGrid() {
    grid.innerHTML = '';
    for (const voice of VOICES) {
      const label = document.createElement('div');
      label.className = 'voiceLabel';
      label.textContent = voice.label;
      grid.appendChild(label);

      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.voice = voice.id;
      for (let i = 0; i < STEPS; i += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'step';
        button.dataset.voice = voice.id;
        button.dataset.step = String(i);
        button.style.setProperty('--voice-color', voice.color);
        button.setAttribute('aria-label', `${voice.label} step ${i + 1}`);
        row.appendChild(button);
      }
      grid.appendChild(row);
    }
  }

  function render() {
    enableButton.textContent = state.enabled ? 'ON' : 'OFF';
    enableButton.setAttribute('aria-pressed', state.enabled ? 'true' : 'false');
    status.textContent = state.enabled ? `step ${activeStep + 1 || 1} / ${STEPS}` : 'muted';
    for (const voice of VOICES) {
      for (let i = 0; i < STEPS; i += 1) renderStep(voice.id, i);
    }
    renderControls();
  }

  function renderStep(voice, step) {
    const button = grid.querySelector(`.step[data-voice="${voice}"][data-step="${step}"]`);
    if (!button) return;
    const isActive = state.pattern[voice]?.[step] === 1;
    button.classList.toggle('active', isActive);
    button.classList.toggle('playhead', step === activeStep);
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  }

  function renderPlayhead(previous, next) {
    for (const voice of VOICES) {
      if (previous >= 0) renderStep(voice.id, previous);
      renderStep(voice.id, next);
    }
    status.textContent = state.enabled ? `step ${next + 1} / ${STEPS}` : 'muted';
  }

  function renderControls() {
    sliders.volume.value = String(state.volume);
    sliders.swing.value = String(state.swing);
    sliders.grime.value = String(state.grime);
    sliders.fill.value = String(state.fill);
    reads.volume.textContent = `${Math.round(state.volume * 100)}%`;
    reads.swing.textContent = `${Math.round(state.swing * 100)}%`;
    reads.grime.textContent = `${Math.round(state.grime * 100)}%`;
    reads.fill.textContent = `${Math.round(state.fill * 100)}%`;
  }

  function syncOutput() {
    const now = ctx.audioCtx.currentTime;
    output.gain.cancelScheduledValues(now);
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, now, 0.015);
  }

  function resumeAudio() {
    if (ctx.audioCtx.state === 'suspended' && typeof ctx.audioCtx.resume === 'function') {
      ctx.audioCtx.resume().catch(() => {});
    }
  }

  function scheduleStep(step, time, duration) {
    const accent = step % 4 === 0 ? 1 + state.accent * 0.55 : 1;
    const fillHit = state.fill > 0.04 && ((step + 3) % 8 === 0 || (state.fill > 0.62 && step % 2 === 1));
    const has = (voice) => state.pattern[voice]?.[step] === 1;

    if (has('kick')) playKick(time, 0.7 * accent);
    if (has('snare') || (fillHit && step % 4 === 2)) playSnare(time, fillHit ? 0.42 : 0.64);
    if (has('hat') || fillHit) playHat(time + (fillHit ? duration * 0.45 : 0), fillHit ? 0.24 : 0.34);
    if (has('bass')) playBass(time, duration, BASS_NOTES[step], 0.46 * accent);
  }

  function playKick(time, velocity) {
    const osc = ctx.audioCtx.createOscillator();
    const gain = ctx.audioCtx.createGain();
    const click = ctx.audioCtx.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(124, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.08);
    osc.frequency.exponentialRampToValueAtTime(31, time + 0.26);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.9 * velocity, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    click.type = 'lowpass';
    click.frequency.setValueAtTime(1200 + state.grime * 1800, time);
    osc.connect(click);
    click.connect(gain);
    gain.connect(output);
    trackNode(osc, time + 0.38);
    trackNode(gain, time + 0.42, false);
    trackNode(click, time + 0.42, false);
    osc.start(time);
    osc.stop(time + 0.38);
  }

  function playSnare(time, velocity) {
    const noise = ctx.audioCtx.createBufferSource();
    const noiseGain = ctx.audioCtx.createGain();
    const band = ctx.audioCtx.createBiquadFilter();
    const body = ctx.audioCtx.createOscillator();
    const bodyGain = ctx.audioCtx.createGain();
    noise.buffer = noiseBuffer;
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1600 + state.grime * 1400, time);
    band.Q.setValueAtTime(0.85, time);
    noiseGain.gain.setValueAtTime(0.0001, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.52 * velocity, time + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    body.type = 'triangle';
    body.frequency.setValueAtTime(176, time);
    bodyGain.gain.setValueAtTime(0.0001, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.16 * velocity, time + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(output);
    body.connect(bodyGain);
    bodyGain.connect(output);
    trackNode(noise, time + 0.18);
    trackNode(body, time + 0.13);
    trackNode(noiseGain, time + 0.22, false);
    trackNode(band, time + 0.22, false);
    trackNode(bodyGain, time + 0.16, false);
    noise.start(time);
    noise.stop(time + 0.18);
    body.start(time);
    body.stop(time + 0.13);
  }

  function playHat(time, velocity) {
    const noise = ctx.audioCtx.createBufferSource();
    const gain = ctx.audioCtx.createGain();
    const high = ctx.audioCtx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(6200 - state.grime * 1200, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.22 * velocity, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.055 + state.fill * 0.04);
    noise.connect(high);
    high.connect(gain);
    gain.connect(output);
    trackNode(noise, time + 0.12);
    trackNode(gain, time + 0.14, false);
    trackNode(high, time + 0.14, false);
    noise.start(time);
    noise.stop(time + 0.12);
  }

  function playBass(time, duration, frequency, velocity) {
    const osc = ctx.audioCtx.createOscillator();
    const gain = ctx.audioCtx.createGain();
    const filter = ctx.audioCtx.createBiquadFilter();
    const length = clamp(duration * (0.72 + state.fill * 0.18), 0.045, 0.22);
    osc.type = state.grime > 0.55 ? 'sawtooth' : 'square';
    osc.frequency.setValueAtTime(frequency, time);
    osc.detune.setValueAtTime(state.grime * -9, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(110 + state.grime * 90, time);
    filter.frequency.exponentialRampToValueAtTime(820 + state.grime * 700, time + 0.025);
    filter.frequency.exponentialRampToValueAtTime(95 + state.grime * 140, time + length);
    filter.Q.setValueAtTime(7 + state.grime * 7, time);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.33 * velocity, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    trackNode(osc, time + length + 0.03);
    trackNode(gain, time + length + 0.05, false);
    trackNode(filter, time + length + 0.05, false);
    osc.start(time);
    osc.stop(time + length + 0.03);
  }

  function makeNoiseBuffer(audioCtx) {
    const length = Math.max(1, Math.floor(audioCtx.sampleRate * 0.5));
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = last * 0.62 + (Math.random() * 2 - 1) * 0.38;
      data[i] = last;
    }
    return buffer;
  }

  function makeDriveCurve(amount) {
    const n = 512;
    const curve = new Float32Array(n);
    const driveAmount = 1 + amount * 38;
    for (let i = 0; i < n; i += 1) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + driveAmount) * x) / (1 + driveAmount * Math.abs(x));
    }
    return curve;
  }

  function trackNode(node, stopAt, stopCapable = true) {
    scheduledNodes.add(node);
    const delay = Math.max(0, (stopAt - ctx.audioCtx.currentTime + 0.2) * 1000);
    const timer = window.setTimeout(() => {
      cleanupTimers.delete(timer);
      scheduledNodes.delete(node);
      try {
        if (stopCapable && typeof node.stop === 'function') node.stop();
      } catch {}
      try {
        if (typeof node.disconnect === 'function') node.disconnect();
      } catch {}
    }, delay);
    cleanupTimers.add(timer);
  }

  function serializeState() {
    return {
      schema: 1,
      enabled: state.enabled,
      volume: state.volume,
      swing: state.swing,
      grime: state.grime,
      accent: state.accent,
      fill: state.fill,
      pattern: copyPattern(state.pattern, DEFAULT_PATTERN)
    };
  }

  function safeUnsub(value) {
    return typeof value === 'function' ? value : () => {};
  }

  function drawScope(now) {
    if (!scopeCtx) return;
    const w = scope.width;
    const h = scope.height;
    scopeCtx.clearRect(0, 0, w, h);
    scopeCtx.fillStyle = '#111318';
    scopeCtx.fillRect(0, 0, w, h);
    scopeCtx.strokeStyle = '#2a2d35';
    scopeCtx.lineWidth = 1;
    for (let i = 0; i < STEPS; i += 1) {
      const x = Math.floor((i / STEPS) * w) + 0.5;
      scopeCtx.beginPath();
      scopeCtx.moveTo(x, 0);
      scopeCtx.lineTo(x, h);
      scopeCtx.stroke();
    }
    const decay = Math.max(0, 1 - (ctx.audioCtx.currentTime - lastTickAt) * 7);
    const amp = (pulse * 0.65 + decay * 0.35) * (state.enabled ? 1 : 0.18);
    const colors = ['#e63946', '#3b82f6', '#f5a623'];
    scopeCtx.lineWidth = 2;
    scopeCtx.strokeStyle = colors[Math.floor(rafHue) % colors.length];
    scopeCtx.beginPath();
    for (let x = 0; x < w; x += 1) {
      const phase = (x / w) * Math.PI * 4;
      const grimeFold = Math.sin(phase * (1.5 + state.grime * 2) + now * 0.006);
      const y = h * 0.5 + Math.sin(phase + now * 0.004) * h * 0.18 * amp + grimeFold * h * 0.08 * state.grime * amp;
      if (x === 0) scopeCtx.moveTo(x, y);
      else scopeCtx.lineTo(x, y);
    }
    scopeCtx.stroke();
    if (activeStep >= 0) {
      scopeCtx.fillStyle = state.enabled ? '#d4d8e0' : '#555d6e';
      scopeCtx.fillRect(Math.floor((activeStep / STEPS) * w), 0, Math.max(1, Math.floor(w / STEPS)), 2);
    }
  }

  return {
    update(tick) {
      pulse *= 0.9;
      rafHue = (rafHue + 0.015 + state.grime * 0.025) % 3;
      drawScope(Number.isFinite(tick) ? tick : performance.now());
      if (renderedStep !== activeStep) {
        renderPlayhead(renderedStep, activeStep);
        renderedStep = activeStep;
      }
    },
    getState() {
      return serializeState();
    },
    destroy() {
      enableButton.removeEventListener('click', onEnable);
      grid.removeEventListener('click', onGridClick);
      for (const [slider, listener] of sliderListeners) slider.removeEventListener('input', listener);
      unsubscribeState();
      unsubscribeTick();
      for (const timer of cleanupTimers) window.clearTimeout(timer);
      cleanupTimers.clear();
      for (const node of scheduledNodes) {
        try {
          if (typeof node.stop === 'function') node.stop();
        } catch {}
        try {
          if (typeof node.disconnect === 'function') node.disconnect();
        } catch {}
      }
      scheduledNodes.clear();
      output.disconnect();
      drive.disconnect();
      tone.disconnect();
      safety.disconnect();
      ctx.domRoot.innerHTML = '';
    }
  };
}