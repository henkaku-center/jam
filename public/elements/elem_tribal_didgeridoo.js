const STATE_VERSION = 'tribal-didgeridoo-v1';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.7),
    drone: finite(prevState?.drone, 0.74),
    throat: finite(prevState?.throat, 0.58),
    overtones: finite(prevState?.overtones, 0.64),
    pulse: finite(prevState?.pulse, 0.68),
    root: finite(prevState?.root, 38)
  };

  const audio = ctx.audioCtx;
  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const droneBus = audio.createGain();
  const drumBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const lowpass = audio.createBiquadFilter();
  const formantA = audio.createBiquadFilter();
  const formantB = audio.createBiquadFilter();
  const breathFilter = audio.createBiquadFilter();
  const breathGain = audio.createGain();
  const lfo = audio.createOscillator();
  const lfoGain = audio.createGain();
  const growl = audio.createOscillator();
  const growlGain = audio.createGain();
  const oscA = audio.createOscillator();
  const oscB = audio.createOscillator();
  const oscC = audio.createOscillator();
  const gainA = audio.createGain();
  const gainB = audio.createGain();
  const gainC = audio.createGain();
  const noise = audio.createBufferSource();

  let destroyed = false;
  let currentStep = -1;
  let clockStepSeconds = 0.125;
  let visualPulse = 0;
  const liveNodes = new Set();
  const cleanupTimers = new Set();

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const makeDriveCurve = () => {
    const curve = new Float32Array(512);
    const amount = 1.8 + state.throat * 7;
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) * 0.82;
    }
    return curve;
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 1.2), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.88 + (Math.random() * 2 - 1) * 0.12;
      data[i] = last;
    }
    return buffer;
  };

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

  const tuneDrone = () => {
    const base = midiToFreq(state.root);
    oscA.frequency.setTargetAtTime(base, audio.currentTime, 0.04);
    oscB.frequency.setTargetAtTime(base * 1.005, audio.currentTime, 0.04);
    oscC.frequency.setTargetAtTime(base * 2.015, audio.currentTime, 0.04);
    growl.frequency.setTargetAtTime(24 + state.throat * 32, audio.currentTime, 0.08);
    lfo.frequency.setTargetAtTime(2.2 + state.pulse * 4.2, audio.currentTime, 0.08);
  };

  const syncAudio = () => {
    const now = audio.currentTime;
    output.gain.setTargetAtTime(state.running ? state.volume : 0, now, 0.025);
    droneBus.gain.setTargetAtTime(0.26 + state.drone * 0.42, now, 0.04);
    drumBus.gain.setTargetAtTime(0.12 + state.pulse * 0.46, now, 0.04);
    gainA.gain.setTargetAtTime(0.44 + state.drone * 0.18, now, 0.04);
    gainB.gain.setTargetAtTime(0.16 + state.throat * 0.22, now, 0.04);
    gainC.gain.setTargetAtTime(0.05 + state.overtones * 0.18, now, 0.04);
    growlGain.gain.setTargetAtTime(18 + state.throat * 54, now, 0.06);
    lfoGain.gain.setTargetAtTime(18 + state.pulse * 32, now, 0.06);
    breathGain.gain.setTargetAtTime(0.012 + state.throat * 0.038, now, 0.04);
    lowpass.frequency.setTargetAtTime(420 + state.overtones * 1500, now, 0.06);
    formantA.frequency.setTargetAtTime(180 + state.throat * 280, now, 0.06);
    formantB.frequency.setTargetAtTime(620 + state.overtones * 960, now, 0.06);
    breathFilter.frequency.setTargetAtTime(760 + state.overtones * 1800, now, 0.06);
    shaper.curve = makeDriveCurve();
    tuneDrone();
  };

  const playFrameDrum = (time, velocity, low = true) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const body = audio.createOscillator();
    const hit = audio.createBufferSource();
    const bodyGain = audio.createGain();
    const hitGain = audio.createGain();
    const hitFilter = audio.createBiquadFilter();
    const buffer = makeNoiseBuffer();
    const length = low ? 0.34 : 0.18;

    body.type = low ? 'sine' : 'triangle';
    body.frequency.setValueAtTime(low ? 128 : 210, t);
    body.frequency.exponentialRampToValueAtTime(low ? 54 : 120, t + length);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime((low ? 0.48 : 0.22) * velocity, t + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    hit.buffer = buffer;
    hitFilter.type = low ? 'lowpass' : 'bandpass';
    hitFilter.frequency.value = low ? 900 : 1800 + state.overtones * 1100;
    hitFilter.Q.value = low ? 0.8 : 1.5;
    hitGain.gain.setValueAtTime((low ? 0.11 : 0.16) * velocity, t);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 0.05 : 0.035));

    body.connect(bodyGain);
    bodyGain.connect(drumBus);
    hit.connect(hitFilter);
    hitFilter.connect(hitGain);
    hitGain.connect(drumBus);
    body.start(t);
    hit.start(t, 0, 0.08);
    body.stop(t + length + 0.02);
    track(length + 0.08, body, hit, bodyGain, hitGain, hitFilter);
  };

  const playStick = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const click = audio.createOscillator();
    const clickGain = audio.createGain();
    const filter = audio.createBiquadFilter();

    click.type = 'square';
    click.frequency.setValueAtTime(980 + state.overtones * 1700, t);
    click.frequency.exponentialRampToValueAtTime(440, t + 0.028);
    filter.type = 'bandpass';
    filter.frequency.value = 1350 + state.overtones * 2000;
    filter.Q.value = 3.5;
    clickGain.gain.setValueAtTime(0.0001, t);
    clickGain.gain.exponentialRampToValueAtTime(0.07 * velocity, t + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.038);

    click.connect(filter);
    filter.connect(clickGain);
    clickGain.connect(drumBus);
    click.start(t);
    click.stop(t + 0.05);
    track(0.08, click, filter, clickGain);
  };

  const pulseDrone = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    droneBus.gain.cancelScheduledValues(t);
    droneBus.gain.setValueAtTime(0.22 + state.drone * 0.34, t);
    droneBus.gain.linearRampToValueAtTime(0.42 + state.drone * 0.5 + velocity * 0.18, t + 0.04);
    droneBus.gain.exponentialRampToValueAtTime(0.26 + state.drone * 0.42, t + clockStepSeconds * 1.6);
  };

  const handleTick = ({ step, time, duration }) => {
    if (destroyed) return;
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    visualPulse = Math.max(visualPulse, currentStep % 4 === 0 ? 1 : 0.34);
    render();
    if (!state.running) return;

    const pattern = [1, 0, 0.28, 0, 0.64, 0.18, 0, 0.34, 0.9, 0, 0.42, 0, 0.72, 0.22, 0, 0.38];
    const lowHit = currentStep === 0 || currentStep === 8 || currentStep === 12;
    const drumVelocity = pattern[currentStep] * (0.75 + state.pulse * 0.45);
    const swing = currentStep % 2 ? clockStepSeconds * 0.09 : 0;
    const t = time + swing;

    if (drumVelocity > 0.05) {
      playFrameDrum(t, clamp(drumVelocity, 0, 1.1), lowHit);
      pulseDrone(t, drumVelocity);
      ctx.bus.pub('tribalDidgeridoo:hit', {
        voice: lowHit ? 'frame' : 'rim',
        velocity: drumVelocity,
        step: currentStep,
        time: t
      });
    }
    if ((currentStep % 2 === 1 || currentStep === 6 || currentStep === 14) && state.pulse > 0.18) {
      playStick(t + clockStepSeconds * 0.22, clamp(0.35 + state.pulse * 0.42, 0, 1));
    }
  };

  output.gain.value = state.running ? state.volume : 0;
  compressor.threshold.value = -20;
  compressor.knee.value = 16;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.18;
  shaper.oversample = '2x';
  lowpass.type = 'lowpass';
  lowpass.Q.value = 0.8;
  formantA.type = 'bandpass';
  formantA.Q.value = 6;
  formantB.type = 'bandpass';
  formantB.Q.value = 8;
  breathFilter.type = 'bandpass';
  breathFilter.Q.value = 1.2;
  oscA.type = 'sawtooth';
  oscB.type = 'triangle';
  oscC.type = 'sine';
  growl.type = 'sine';
  lfo.type = 'sine';
  noise.buffer = makeNoiseBuffer();
  noise.loop = true;

  oscA.connect(gainA);
  oscB.connect(gainB);
  oscC.connect(gainC);
  gainA.connect(shaper);
  gainB.connect(shaper);
  gainC.connect(formantB);
  growl.connect(growlGain);
  growlGain.connect(oscA.frequency);
  lfo.connect(lfoGain);
  lfoGain.connect(formantA.frequency);
  shaper.connect(lowpass);
  lowpass.connect(formantA);
  formantA.connect(droneBus);
  formantB.connect(droneBus);
  noise.connect(breathFilter);
  breathFilter.connect(breathGain);
  breathGain.connect(droneBus);
  droneBus.connect(output);
  drumBus.connect(output);
  output.connect(compressor);
  compressor.connect(ctx.audioOut);

  tuneDrone();
  syncAudio();
  oscA.start();
  oscB.start();
  oscC.start();
  growl.start();
  lfo.start();
  noise.start();

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .didge {
        box-sizing: border-box;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 9px;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(8, 10, 9, 0.98), rgba(19, 14, 10, 0.98) 52%, rgba(8, 17, 15, 0.98)),
          repeating-linear-gradient(45deg, rgba(250, 204, 21, 0.09) 0 2px, transparent 2px 18px);
        border: 1px solid rgba(244, 114, 22, 0.5);
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
        color: #fed7aa;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 2px;
        color: #a7f3d0;
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
        color: #1c1208;
        background: #fb923c;
        border: 1px solid rgba(253, 186, 116, 0.78);
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
        grid-template-columns: 54px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #e2e8f0;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #fb923c;
      }
      .root {
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        color: #e2e8f0;
      }
      select {
        min-width: 0;
        height: 24px;
        color: #ffedd5;
        background: rgba(2, 6, 23, 0.72);
        border: 1px solid rgba(251, 146, 60, 0.4);
        border-radius: 5px;
      }
      .pulse {
        min-height: 0;
        display: grid;
        grid-template-rows: repeat(2, minmax(0, 1fr));
        gap: 6px;
        align-content: end;
      }
      .rings {
        position: relative;
        min-height: 74px;
        overflow: hidden;
        border: 1px solid rgba(251, 146, 60, 0.28);
        border-radius: 6px;
        background:
          radial-gradient(circle at 50% 55%, rgba(251, 146, 60, 0.24), transparent 23%),
          linear-gradient(90deg, rgba(6, 78, 59, 0.24), rgba(41, 37, 36, 0.22), rgba(124, 45, 18, 0.22));
      }
      .ring {
        position: absolute;
        inset: 50% auto auto 50%;
        width: 16px;
        height: 16px;
        border: 1px solid rgba(253, 186, 116, 0.78);
        border-radius: 999px;
        transform: translate(-50%, -50%) scale(var(--scale));
        opacity: var(--alpha);
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(16, minmax(6px, 1fr));
        gap: 3px;
      }
      .step {
        min-height: 18px;
        border-radius: 3px;
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid rgba(148, 163, 184, 0.2);
        opacity: 0.48;
      }
      .step.hit {
        background: #fb923c;
        border-color: rgba(253, 186, 116, 0.72);
        opacity: 0.82;
      }
      .step.play {
        opacity: 1;
        box-shadow: 0 0 11px rgba(251, 146, 60, 0.74);
        transform: translateY(-1px);
      }
    </style>
    <div class="didge">
      <div class="top">
        <div>
          <h2>Tribal Didge</h2>
          <div class="sub">didgeridoo drone with frame-drum pulse</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.2" step="0.01"><span id="volumeVal"></span></label>
        <label>drone <input id="drone" type="range" min="0" max="1" step="0.01"><span id="droneVal"></span></label>
        <label>throat <input id="throat" type="range" min="0" max="1" step="0.01"><span id="throatVal"></span></label>
        <label>tone <input id="overtones" type="range" min="0" max="1" step="0.01"><span id="overtonesVal"></span></label>
        <label>pulse <input id="pulse" type="range" min="0" max="1" step="0.01"><span id="pulseVal"></span></label>
      </div>
      <div class="root">
        <span>root</span>
        <select id="root">
          <option value="34">A#0</option>
          <option value="36">C1</option>
          <option value="38">D1</option>
          <option value="41">F1</option>
        </select>
      </div>
      <div class="pulse">
        <div class="rings" id="rings"></div>
        <div class="steps" id="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const rootSelect = $('#root');
  const ringsEl = $('#rings');
  const stepsEl = $('#steps');
  const sliders = {
    volume: $('#volume'),
    drone: $('#drone'),
    throat: $('#throat'),
    overtones: $('#overtones'),
    pulse: $('#pulse')
  };
  const values = {
    volume: $('#volumeVal'),
    drone: $('#droneVal'),
    throat: $('#throatVal'),
    overtones: $('#overtonesVal'),
    pulse: $('#pulseVal')
  };
  const stepPattern = [1, 0, 0.28, 0, 0.64, 0.18, 0, 0.34, 0.9, 0, 0.42, 0, 0.72, 0.22, 0, 0.38];

  const render = () => {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    rootSelect.value = String(state.root);
    Object.entries(sliders).forEach(([key, input]) => {
      if (input.value !== String(state[key])) input.value = String(state[key]);
      values[key].textContent = state[key].toFixed(2);
    });
    const ringCount = 5;
    ringsEl.innerHTML = Array.from({ length: ringCount }, (_, index) => {
      const scale = 1 + index * 1.28 + visualPulse * (0.4 + index * 0.12);
      const alpha = clamp(0.62 - index * 0.09 + visualPulse * 0.18, 0.08, 0.92);
      return `<span class="ring" style="--scale:${scale.toFixed(2)};--alpha:${alpha.toFixed(2)}"></span>`;
    }).join('');
    stepsEl.innerHTML = stepPattern.map((value, index) => {
      const className = `step ${value ? 'hit' : ''} ${index === currentStep ? 'play' : ''}`;
      return `<span class="${className}"></span>`;
    }).join('');
    visualPulse *= 0.82;
  };

  const onRun = () => {
    state.running = !state.running;
    syncAudio();
    render();
  };

  const onRoot = () => {
    state.root = Number(rootSelect.value);
    syncAudio();
    render();
  };

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  rootSelect.addEventListener('change', onRoot);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(handleTick);
  const animation = setInterval(render, 80);
  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      clearInterval(animation);
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      rootSelect.removeEventListener('change', onRoot);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      [oscA, oscB, oscC, growl, lfo, noise].forEach((node) => {
        try { node.stop(); } catch (_) {}
      });
      [
        output, compressor, droneBus, drumBus, shaper, lowpass, formantA, formantB,
        breathFilter, breathGain, lfoGain, growlGain, gainA, gainB, gainC
      ].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
    }
  };
}
