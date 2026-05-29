const STATE_VERSION = 'roland-909-thing-v1';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    enabled: prevState?.enabled ?? true,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.74),
    drive: finite(prevState?.drive, 0.18),
    swing: finite(prevState?.swing, 0.08),
    density: finite(prevState?.density, 0.54),
    hatTone: finite(prevState?.hatTone, 0.64)
  };

  let currentStep = -1;
  let pulse = 0;
  let destroyed = false;

  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const limiter = audio.createGain();

  output.gain.value = state.enabled && state.running ? state.volume : 0;
  compressor.threshold.value = -16;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.8;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.13;
  limiter.gain.value = 0.88;

  output.connect(compressor);
  compressor.connect(limiter);
  limiter.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(90, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const noiseBuffer = (() => {
    const length = Math.max(1, Math.floor(audio.sampleRate * 1.2));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  })();

  const makeNoise = () => {
    const source = audio.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    return source;
  };

  const makeDriveCurve = (amount) => {
    const curve = new Float32Array(256);
    const k = 1 + amount * 10;
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k);
    }
    return curve;
  };

  const connectVoice = (node, gain, pan = 0) => {
    const shaper = audio.createWaveShaper();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    shaper.curve = makeDriveCurve(state.drive);
    shaper.oversample = '2x';
    if (panner) {
      panner.pan.value = pan;
      node.connect(shaper);
      shaper.connect(gain);
      gain.connect(panner);
      panner.connect(output);
      return [shaper, panner];
    }
    node.connect(shaper);
    shaper.connect(gain);
    gain.connect(output);
    return [shaper];
  };

  const playKick = (time, velocity = 1) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const click = makeNoise();
    const clickFilter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const clickGain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(172, t);
    osc.frequency.exponentialRampToValueAtTime(51, t + 0.055);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.28);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.92 * velocity, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 5200;
    clickGain.gain.setValueAtTime(0.18 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);

    const extra = connectVoice(osc, gain);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(output);

    osc.start(t);
    click.start(t);
    osc.stop(t + 0.46);
    click.stop(t + 0.04);
    track(0.5, osc, click, clickFilter, gain, clickGain, ...extra);
  };

  const playSnare = (time, velocity = 1) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const noise = makeNoise();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1850;
    noiseFilter.Q.value = 0.9;
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.54 * velocity, t + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);

    body.type = 'triangle';
    body.frequency.setValueAtTime(182, t);
    body.frequency.exponentialRampToValueAtTime(154, t + 0.11);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.28 * velocity, t + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(noiseFilter);
    const noiseExtra = connectVoice(noiseFilter, noiseGain, 0.04);
    const bodyExtra = connectVoice(body, bodyGain, -0.02);

    noise.start(t);
    body.start(t);
    noise.stop(t + 0.22);
    body.stop(t + 0.16);
    track(0.26, noise, body, noiseFilter, noiseGain, bodyGain, ...noiseExtra, ...bodyExtra);
  };

  const playClap = (time, velocity = 1) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const source = makeNoise();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    filter.type = 'bandpass';
    filter.frequency.value = 1370;
    filter.Q.value = 0.72;
    gain.gain.setValueAtTime(0.0001, t);
    [0, 0.017, 0.034].forEach((offset, index) => {
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime((0.24 - index * 0.035) * velocity, t + offset + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.022);
    });
    gain.gain.setValueAtTime(0.16 * velocity, t + 0.058);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.23);

    source.connect(filter);
    const extra = connectVoice(filter, gain, 0.08);
    source.start(t);
    source.stop(t + 0.26);
    track(0.3, source, filter, gain, ...extra);
  };

  const playHat = (time, velocity = 1, open = false) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const source = makeNoise();
    const highpass = audio.createBiquadFilter();
    const peak = audio.createBiquadFilter();
    const gain = audio.createGain();
    const length = open ? 0.24 + state.density * 0.1 : 0.045;

    highpass.type = 'highpass';
    highpass.frequency.value = 6100 + state.hatTone * 2600;
    peak.type = 'bandpass';
    peak.frequency.value = 8500 + state.hatTone * 3600;
    peak.Q.value = open ? 1.2 : 2.4;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((open ? 0.23 : 0.18) * velocity, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    source.connect(highpass);
    highpass.connect(peak);
    const extra = connectVoice(peak, gain, open ? 0.16 : -0.12);
    source.start(t);
    source.stop(t + length + 0.03);
    track(length + 0.07, source, highpass, peak, gain, ...extra);
  };

  const playRim = (time, velocity = 1) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    osc.type = 'square';
    osc.frequency.value = 870;
    filter.type = 'bandpass';
    filter.frequency.value = 2100;
    filter.Q.value = 8.5;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.14 * velocity, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(filter);
    const extra = connectVoice(filter, gain, -0.18);
    osc.start(t);
    osc.stop(t + 0.07);
    track(0.1, osc, filter, gain, ...extra);
  };

  const handleTick = ({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = step % 16;
    pulse = Math.max(pulse, 0.32);
    syncUi();
    if (!state.enabled || !state.running) return;

    const stepDuration = clamp(Number.isFinite(duration) ? duration : 0.125, 0.05, 0.4);
    const swingOffset = currentStep % 2 ? stepDuration * clamp(state.swing, 0, 0.32) : 0;
    const t = time + swingOffset;
    const accent = currentStep % 4 === 0 ? 1 : currentStep % 2 === 0 ? 0.78 : 0.62;
    const density = clamp(state.density, 0, 1);

    if ([0, 4, 8, 12].includes(currentStep)) playKick(t, accent);
    if (density > 0.62 && [3, 10, 14].includes(currentStep)) playKick(t, 0.48 + density * 0.22);
    if ([4, 12].includes(currentStep)) {
      playSnare(t, 0.86);
      playClap(t + stepDuration * 0.018, 0.72);
    }
    if (density > 0.72 && [7, 15].includes(currentStep)) playSnare(t, 0.34);
    if ([2, 6, 10, 14].includes(currentStep)) playHat(t, 0.7 + density * 0.22, true);
    if (currentStep % 2 === 0 || density > 0.46) playHat(t, currentStep % 2 === 0 ? 0.48 : 0.28 + density * 0.22, false);
    if (density > 0.54 && [5, 11, 13].includes(currentStep)) playRim(t, 0.42 + density * 0.22);
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .machine {
        box-sizing: border-box;
        height: 100%;
        min-width: 260px;
        min-height: 210px;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 9px;
        padding: 11px;
        overflow: hidden;
        color: #f3f4f6;
        background:
          linear-gradient(135deg, #151515 0%, #24211e 55%, #101315 100%),
          repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(248, 113, 113, 0.45);
        border-radius: 7px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h2 {
        margin: 0;
        color: #fca5a5;
        font: 800 14px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 3px;
        color: #a3a3a3;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .buttons {
        display: flex;
        gap: 5px;
      }
      button {
        height: 27px;
        min-width: 42px;
        padding: 0 8px;
        color: #fef2f2;
        background: #292524;
        border: 1px solid #57534e;
        border-radius: 5px;
        font: inherit;
        cursor: pointer;
      }
      button.on {
        color: #111827;
        background: #fb923c;
        border-color: #fed7aa;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 3px;
        min-height: 24px;
      }
      .step {
        min-width: 0;
        border: 1px solid #44403c;
        background: #1c1917;
      }
      .step.beat {
        border-color: #78716c;
      }
      .step.now {
        background: #f97316;
        border-color: #fed7aa;
        box-shadow: 0 0 14px rgba(249, 115, 22, 0.58);
      }
      .step.hit {
        background-image: linear-gradient(180deg, rgba(248,113,113,0.95), rgba(124,45,18,0.4));
      }
      .controls {
        align-self: start;
        display: grid;
        gap: 7px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 7px;
        color: #d6d3d1;
      }
      input[type="range"] {
        min-width: 0;
        width: 100%;
        accent-color: #fb923c;
      }
      .meters {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 5px;
        align-items: end;
        min-height: 38px;
      }
      .voice {
        display: grid;
        gap: 3px;
        color: #a8a29e;
        font-size: 9px;
        text-align: center;
      }
      .lamp {
        height: 16px;
        border: 1px solid #44403c;
        background: #0c0a09;
      }
      .voice.active .lamp {
        background: #f43f5e;
        border-color: #fecdd3;
        box-shadow: 0 0 calc(5px + var(--pulse) * 18px) rgba(244, 63, 94, 0.66);
      }
    </style>
    <div class="machine">
      <div class="top">
        <div>
          <h2>909 Thing</h2>
          <div class="sub">clocked kick clap hats rim</div>
        </div>
        <div class="buttons">
          <button id="run" type="button"></button>
          <button id="enabled" type="button"></button>
        </div>
      </div>
      <div id="steps" class="steps"></div>
      <div class="controls">
        <label>volume <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal"></span></label>
        <label>drive <input id="drive" type="range" min="0" max="0.7" step="0.01"><span id="driveVal"></span></label>
        <label>swing <input id="swing" type="range" min="0" max="0.28" step="0.01"><span id="swingVal"></span></label>
        <label>busy <input id="density" type="range" min="0" max="1" step="0.01"><span id="densityVal"></span></label>
        <label>hats <input id="hatTone" type="range" min="0" max="1" step="0.01"><span id="hatToneVal"></span></label>
      </div>
      <div class="meters" id="meters">
        <div class="voice" data-voice="kick"><span class="lamp"></span><span>kick</span></div>
        <div class="voice" data-voice="snare"><span class="lamp"></span><span>snare</span></div>
        <div class="voice" data-voice="clap"><span class="lamp"></span><span>clap</span></div>
        <div class="voice" data-voice="hat"><span class="lamp"></span><span>hat</span></div>
        <div class="voice" data-voice="rim"><span class="lamp"></span><span>rim</span></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const enabledButton = $('#enabled');
  const stepsEl = $('#steps');
  const sliders = {
    volume: $('#volume'),
    drive: $('#drive'),
    swing: $('#swing'),
    density: $('#density'),
    hatTone: $('#hatTone')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    drive: $('#driveVal'),
    swing: $('#swingVal'),
    density: $('#densityVal'),
    hatTone: $('#hatToneVal')
  };
  const voices = Array.from(ctx.domRoot.querySelectorAll('.voice'));

  const stepEls = Array.from({ length: 16 }, (_, index) => {
    const el = document.createElement('div');
    el.className = `step ${index % 4 === 0 ? 'beat' : ''}`;
    stepsEl.appendChild(el);
    return el;
  });

  const hitSteps = new Set([0, 2, 4, 6, 8, 10, 12, 14]);

  function syncUi() {
    output.gain.setTargetAtTime(state.enabled && state.running ? state.volume : 0, audio.currentTime, 0.025);
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('on', state.running);
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('on', state.enabled);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
    valueEls.volume.textContent = state.volume.toFixed(2);
    valueEls.drive.textContent = state.drive.toFixed(2);
    valueEls.swing.textContent = state.swing.toFixed(2);
    valueEls.density.textContent = state.density.toFixed(2);
    valueEls.hatTone.textContent = state.hatTone.toFixed(2);
    stepEls.forEach((el, index) => {
      el.classList.toggle('now', index === currentStep && state.enabled && state.running);
      el.classList.toggle('hit', hitSteps.has(index) || (state.density > 0.62 && [3, 5, 10, 11, 13, 14].includes(index)));
    });
    pulse *= 0.84;
    voices.forEach((voice) => {
      const active = state.enabled && state.running && (
        (voice.dataset.voice === 'kick' && [0, 4, 8, 12].includes(currentStep)) ||
        (voice.dataset.voice === 'snare' && [4, 12].includes(currentStep)) ||
        (voice.dataset.voice === 'clap' && [4, 12].includes(currentStep)) ||
        (voice.dataset.voice === 'hat' && currentStep >= 0 && currentStep % 2 === 0) ||
        (voice.dataset.voice === 'rim' && state.density > 0.54 && [5, 11, 13].includes(currentStep))
      );
      voice.classList.toggle('active', active);
      voice.style.setProperty('--pulse', pulse.toFixed(3));
    });
  }

  const onRun = () => {
    state.running = !state.running;
    syncUi();
  };
  const onEnabled = () => {
    state.enabled = !state.enabled;
    syncUi();
  };
  const onSlider = (key) => () => {
    state[key] = Number(sliders[key].value);
    syncUi();
  };

  runButton.addEventListener('click', onRun);
  enabledButton.addEventListener('click', onEnabled);
  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, onSlider(key)]));
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(handleTick);
  syncUi();

  return {
    update() {
      if (pulse > 0.01) syncUi();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
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
        output.disconnect();
        compressor.disconnect();
        limiter.disconnect();
      } catch (_) {}
    }
  };
}
