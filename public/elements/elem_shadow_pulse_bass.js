export default function setup(ctx, prevState) {
  const state = {
    enabled: prevState?.enabled ?? true,
    rootMidi: Number.isFinite(prevState?.rootMidi) ? prevState.rootMidi : 45,
    body: Number.isFinite(prevState?.body) ? prevState.body : 0.72,
    bite: Number.isFinite(prevState?.bite) ? prevState.bite : 0.38,
    decay: Number.isFinite(prevState?.decay) ? prevState.decay : 0.56,
    motion: Number.isFinite(prevState?.motion) ? prevState.motion : 0.46
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);
  const now = () => ctx.audioCtx.currentTime;
  const pattern = [0, null, 0, -2, null, 0, 3, null, -5, null, 0, null, 3, 2, null, -2];
  const accents = [1, 0, 0.58, 0.72, 0, 0.86, 0.52, 0, 0.92, 0, 0.64, 0, 0.78, 0.48, 0, 0.58];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  ctx.domRoot.innerHTML = `
    <style>
      .bass {
        box-sizing: border-box;
        height: 100%;
        padding: 12px;
        background: radial-gradient(circle at 20% 10%, #281414 0, #0c1014 42%, #06080a 100%);
        color: #f2efe9;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        overflow: hidden;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #f5d7b7;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.06em;
      }
      button {
        border: 1px solid #6f3e32;
        background: #15191d;
        color: #f2efe9;
        font: inherit;
        padding: 5px 8px;
        cursor: pointer;
      }
      button[aria-pressed="true"] {
        background: #4f241d;
        border-color: #d99164;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 10px;
      }
      label {
        display: grid;
        gap: 4px;
        color: #b7c4c9;
      }
      .line {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #d99164;
      }
      .steps {
        align-self: end;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        gap: 4px;
        min-height: 48px;
        align-items: end;
      }
      .step {
        position: relative;
        height: 34px;
        border: 1px solid #26343a;
        background: #0d1518;
        overflow: hidden;
      }
      .step::before {
        content: "";
        position: absolute;
        inset: auto 0 0;
        height: var(--level, 20%);
        background: linear-gradient(#e0b065, #784035);
        opacity: 0.74;
      }
      .step.active {
        border-color: #f1c17d;
        box-shadow: 0 0 12px #d9916466;
      }
      .step.mute::before {
        opacity: 0.12;
      }
      .readout {
        display: flex;
        justify-content: space-between;
        color: #8fa1a8;
      }
    </style>
    <div class="bass">
      <div class="top">
        <h1>SHADOW PULSE BASS</h1>
        <button id="toggle" type="button" aria-pressed="${state.enabled}">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="grid">
        <label>
          <span class="line"><span>root</span><span id="rootText"></span></span>
          <input id="root" type="range" min="33" max="57" step="1" value="${state.rootMidi}">
        </label>
        <label>
          <span class="line"><span>body</span><span id="bodyText"></span></span>
          <input id="body" type="range" min="0" max="1" step="0.001" value="${state.body}">
        </label>
        <label>
          <span class="line"><span>bite</span><span id="biteText"></span></span>
          <input id="bite" type="range" min="0" max="1" step="0.001" value="${state.bite}">
        </label>
        <label>
          <span class="line"><span>decay</span><span id="decayText"></span></span>
          <input id="decay" type="range" min="0" max="1" step="0.001" value="${state.decay}">
        </label>
      </div>
      <div>
        <div class="readout"><span id="noteText">-</span><span>louder original dark pop bass</span></div>
        <div id="steps" class="steps"></div>
      </div>
    </div>
  `;

  const toggle = ctx.domRoot.querySelector('#toggle');
  const rootSlider = ctx.domRoot.querySelector('#root');
  const bodySlider = ctx.domRoot.querySelector('#body');
  const biteSlider = ctx.domRoot.querySelector('#bite');
  const decaySlider = ctx.domRoot.querySelector('#decay');
  const rootText = ctx.domRoot.querySelector('#rootText');
  const bodyText = ctx.domRoot.querySelector('#bodyText');
  const biteText = ctx.domRoot.querySelector('#biteText');
  const decayText = ctx.domRoot.querySelector('#decayText');
  const noteText = ctx.domRoot.querySelector('#noteText');
  const stepsRoot = ctx.domRoot.querySelector('#steps');

  const stepEls = pattern.map((note, index) => {
    const el = document.createElement('span');
    el.className = `step${note === null ? ' mute' : ''}`;
    el.style.setProperty('--level', `${Math.max(10, accents[index] * 100)}%`);
    stepsRoot.appendChild(el);
    return el;
  });

  const output = ctx.audioCtx.createGain();
  const compressor = ctx.audioCtx.createDynamicsCompressor();
  const analyser = ctx.audioCtx.createAnalyser();
  output.gain.setValueAtTime(1.35, now());
  compressor.threshold.setValueAtTime(-20, now());
  compressor.knee.setValueAtTime(18, now());
  compressor.ratio.setValueAtTime(4, now());
  compressor.attack.setValueAtTime(0.008, now());
  compressor.release.setValueAtTime(0.18, now());
  analyser.fftSize = 64;
  output.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.audioOut);

  const activeNodes = new Set();
  const timers = new Set();

  const remember = (...nodes) => {
    nodes.forEach((node) => activeNodes.add(node));
  };

  const forgetLater = (time, ...nodes) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
        activeNodes.delete(node);
      });
    }, Math.max(80, (time - now()) * 1000 + 160));
    timers.add(timer);
  };

  const makeDriveCurve = (amount) => {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = 1 + amount * 36;
    for (let i = 0; i < samples; i += 1) {
      const x = i * 2 / (samples - 1) - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return curve;
  };

  const render = () => {
    const noteName = noteNames[(state.rootMidi + 1200) % 12];
    rootText.textContent = `${noteName}${Math.floor(state.rootMidi / 12) - 1}`;
    bodyText.textContent = state.body.toFixed(2);
    biteText.textContent = state.bite.toFixed(2);
    decayText.textContent = state.decay.toFixed(2);
    toggle.textContent = state.enabled ? 'ON' : 'OFF';
    toggle.setAttribute('aria-pressed', String(state.enabled));
  };

  const triggerBass = (offset, velocity, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const midi = state.rootMidi + offset;
    const freq = midiToFreq(midi);
    const noteLength = duration * (1.05 + state.decay * 1.9);
    const releaseAt = t + noteLength;
    const stopAt = releaseAt + 0.16;

    const sub = ctx.audioCtx.createOscillator();
    const tone = ctx.audioCtx.createOscillator();
    const click = ctx.audioCtx.createOscillator();
    const subGain = ctx.audioCtx.createGain();
    const toneGain = ctx.audioCtx.createGain();
    const clickGain = ctx.audioCtx.createGain();
    const voice = ctx.audioCtx.createGain();
    const filter = ctx.audioCtx.createBiquadFilter();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const shaper = ctx.audioCtx.createWaveShaper();
    const pan = ctx.audioCtx.createStereoPanner();

    sub.type = 'sine';
    tone.type = 'triangle';
    click.type = 'square';
    sub.frequency.setValueAtTime(freq * 0.5, t);
    sub.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.497), t + 0.08);
    tone.frequency.setValueAtTime(freq, t);
    tone.detune.setValueAtTime(-5 + state.motion * 10, t);
    click.frequency.setValueAtTime(freq * 4, t);

    filter.type = 'lowpass';
    filter.Q.setValueAtTime(1.4 + state.bite * 6.5, t);
    filter.frequency.setValueAtTime(140 + state.body * 90, t);
    filter.frequency.exponentialRampToValueAtTime(520 + state.bite * 2100 + velocity * 520, t + 0.026);
    filter.frequency.exponentialRampToValueAtTime(95 + state.body * 260, releaseAt);
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(24, t);
    shaper.curve = makeDriveCurve(0.18 + state.bite * 0.52);
    shaper.oversample = '4x';
    pan.pan.setValueAtTime(((step % 4) - 1.5) * 0.018, t);

    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime((0.3 + state.body * 0.27) * velocity, t + 0.014);
    subGain.gain.setTargetAtTime(0.0001, releaseAt, 0.055 + state.decay * 0.08);
    toneGain.gain.setValueAtTime(0.0001, t);
    toneGain.gain.exponentialRampToValueAtTime((0.07 + state.bite * 0.16) * velocity, t + 0.01);
    toneGain.gain.setTargetAtTime(0.0001, t + 0.09 + state.decay * 0.18, 0.08);
    clickGain.gain.setValueAtTime(0.0001, t);
    clickGain.gain.exponentialRampToValueAtTime(0.032 * state.bite * velocity, t + 0.004);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);
    voice.gain.setValueAtTime(1.05, t);

    sub.connect(subGain);
    tone.connect(toneGain);
    click.connect(clickGain);
    subGain.connect(voice);
    toneGain.connect(voice);
    clickGain.connect(voice);
    voice.connect(shaper);
    shaper.connect(highpass);
    highpass.connect(filter);
    filter.connect(pan);
    pan.connect(output);

    sub.start(t);
    tone.start(t);
    click.start(t);
    sub.stop(stopAt);
    tone.stop(stopAt);
    click.stop(t + 0.04);

    remember(sub, tone, click, subGain, toneGain, clickGain, voice, filter, highpass, shaper, pan);
    forgetLater(stopAt, sub, tone, click, subGain, toneGain, clickGain, voice, filter, highpass, shaper, pan);
  };

  let currentStep = -1;
  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    currentStep = ((step % 16) + 16) % 16;
    stepEls.forEach((el, index) => el.classList.toggle('active', index === currentStep));

    if (!state.enabled) {
      noteText.textContent = 'muted';
      return;
    }

    const note = pattern[currentStep];
    if (note === null) {
      noteText.textContent = 'rest';
      return;
    }

    const velocity = accents[currentStep];
    const swungTime = currentStep % 2 === 1 ? time + duration * state.motion * 0.18 : time;
    triggerBass(note, velocity, swungTime, duration, step);
    noteText.textContent = `${noteNames[(state.rootMidi + note + 1200) % 12]} / step ${currentStep + 1}`;
  });

  const bindRange = (slider, key) => {
    const handler = () => {
      state[key] = clamp(Number(slider.value), 0, 1);
      render();
    };
    slider.addEventListener('input', handler);
    return () => slider.removeEventListener('input', handler);
  };

  const onRoot = () => {
    state.rootMidi = Number(rootSlider.value);
    render();
  };
  const onToggle = () => {
    state.enabled = !state.enabled;
    render();
  };

  rootSlider.addEventListener('input', onRoot);
  toggle.addEventListener('click', onToggle);
  const unbindBody = bindRange(bodySlider, 'body');
  const unbindBite = bindRange(biteSlider, 'bite');
  const unbindDecay = bindRange(decaySlider, 'decay');

  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      unsubscribeClock();
      rootSlider.removeEventListener('input', onRoot);
      toggle.removeEventListener('click', onToggle);
      unbindBody();
      unbindBite();
      unbindDecay();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      activeNodes.forEach((node) => {
        try {
          if (typeof node.stop === 'function') node.stop();
        } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      });
      activeNodes.clear();
      try {
        output.disconnect();
        compressor.disconnect();
        analyser.disconnect();
      } catch (_) {}
    }
  };
}
