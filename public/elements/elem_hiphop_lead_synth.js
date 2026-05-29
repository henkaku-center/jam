const STATE_VERSION = 'hiphop-lead-synth-v1';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export default function setup(ctx, prevState) {
  const elementId = ctx.elementId || 'elem_hiphop_lead_synth';
  const busKey = `hiphop-lead:${elementId}:state`;
  const matchesVersion = prevState?.stateVersion === STATE_VERSION;
  const defaultSequence = [0, null, 3, null, 5, null, 7, null, 10, null, 7, 5, null, 3, null, 12];
  const scaleChoices = [null, 0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];
  const roots = [
    ['C', 48],
    ['C#', 49],
    ['D', 50],
    ['Eb', 51],
    ['E', 52],
    ['F', 53],
    ['F#', 54],
    ['G', 55],
    ['Ab', 56],
    ['A', 57],
    ['Bb', 58],
    ['B', 59]
  ];

  const cloneSequence = (sequence) => {
    const source = Array.isArray(sequence) ? sequence : defaultSequence;
    return Array.from({ length: 16 }, (_, index) => {
      const value = source[index];
      return Number.isFinite(value) ? clamp(Math.round(value), 0, 24) : null;
    });
  };

  const state = {
    stateVersion: STATE_VERSION,
    enabled: typeof prevState?.enabled === 'boolean' ? prevState.enabled : true,
    rootMidi: matchesVersion && Number.isFinite(prevState?.rootMidi) ? clamp(Math.round(prevState.rootMidi), 48, 59) : 53,
    sequence: cloneSequence(matchesVersion ? prevState?.sequence : defaultSequence),
    gain: matchesVersion && Number.isFinite(prevState?.gain) ? clamp(prevState.gain, 0, 1) : 0.62,
    cutoff: matchesVersion && Number.isFinite(prevState?.cutoff) ? clamp(prevState.cutoff, 0, 1) : 0.52,
    drive: matchesVersion && Number.isFinite(prevState?.drive) ? clamp(prevState.drive, 0, 1) : 0.38,
    glide: matchesVersion && Number.isFinite(prevState?.glide) ? clamp(prevState.glide, 0, 1) : 0.46,
    delay: matchesVersion && Number.isFinite(prevState?.delay) ? clamp(prevState.delay, 0, 1) : 0.34,
    swing: matchesVersion && Number.isFinite(prevState?.swing) ? clamp(prevState.swing, 0, 1) : 0.28,
    roll: matchesVersion && Number.isFinite(prevState?.roll) ? clamp(prevState.roll, 0, 1) : 0.22
  };

  const now = () => ctx.audioCtx.currentTime;
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 137.31 + salt * 53.77) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const output = ctx.audioCtx.createGain();
  const dry = ctx.audioCtx.createGain();
  const delaySend = ctx.audioCtx.createGain();
  const delay = ctx.audioCtx.createDelay(1.5);
  const delayFeedback = ctx.audioCtx.createGain();
  const delayFilter = ctx.audioCtx.createBiquadFilter();
  const reverbSend = ctx.audioCtx.createGain();
  const convolver = ctx.audioCtx.createConvolver();
  const reverbGain = ctx.audioCtx.createGain();
  const analyser = ctx.audioCtx.createAnalyser();

  output.gain.setValueAtTime(state.enabled ? state.gain : 0, now());
  dry.gain.setValueAtTime(0.86, now());
  delay.delayTime.setValueAtTime(0.28, now());
  delayFeedback.gain.setValueAtTime(0.26, now());
  delayFilter.type = 'lowpass';
  delayFilter.frequency.setValueAtTime(3600, now());
  reverbGain.gain.setValueAtTime(0.18, now());
  analyser.fftSize = 256;

  const makeImpulse = () => {
    const sampleRate = ctx.audioCtx.sampleRate;
    const length = Math.floor(sampleRate * 0.9);
    const impulse = ctx.audioCtx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.7);
        data[i] = (Math.random() * 2 - 1) * fade * 0.38;
      }
    }
    return impulse;
  };

  convolver.buffer = makeImpulse();
  dry.connect(output);
  delaySend.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayFilter.connect(output);
  reverbSend.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);
  output.connect(analyser);
  analyser.connect(ctx.audioOut);

  const makeShaper = (amount) => {
    const samples = 2048;
    const curve = new Float32Array(samples);
    const k = 2 + amount * 52;
    for (let i = 0; i < samples; i += 1) {
      const x = i * 2 / samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  };

  const makeLeadWave = () => {
    const real = new Float32Array(32);
    const imag = new Float32Array(32);
    imag[1] = 1;
    imag[2] = 0.34;
    imag[3] = 0.46;
    imag[5] = 0.24;
    imag[7] = 0.18;
    imag[9] = 0.1;
    imag[13] = 0.06;
    return ctx.audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
  };

  const leadWave = makeLeadWave();
  const activeNodes = new Set();
  const timers = new Set();
  let currentStep = -1;
  let lastBpm = 92;
  let lastFreq = midiToFreq(state.rootMidi);
  let pulse = 0;
  let visualPhase = 0;
  let applyingRemote = false;

  const remember = (...nodes) => nodes.forEach((node) => activeNodes.add(node));

  const forgetLater = (time, ...nodes) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (error) {}
        activeNodes.delete(node);
      });
    }, Math.max(80, (time - now()) * 1000 + 120));
    timers.add(timer);
  };

  const setParam = (param, value, time = now(), smoothing = 0.025) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const updateFx = () => {
    const t = now();
    setParam(output.gain, state.enabled ? state.gain : 0, t, 0.018);
    setParam(delaySend.gain, state.delay * 0.48, t, 0.03);
    setParam(reverbSend.gain, 0.08 + state.delay * 0.16, t, 0.04);
    setParam(delayFeedback.gain, 0.18 + state.delay * 0.32, t, 0.04);
    setParam(delayFilter.frequency, 1900 + state.cutoff * 4200, t, 0.04);
  };

  const noteName = (offset) => {
    if (!Number.isFinite(offset)) return '--';
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return names[(state.rootMidi + offset + 1200) % 12];
  };

  const triggerNote = (midi, velocity, time, duration, step, short = false) => {
    if (!state.enabled) return;
    const t = Math.max(time, now() + 0.003);
    const freq = midiToFreq(midi);
    const glideTime = Math.min(0.12, state.glide * 0.11);
    const releaseAt = t + duration * (short ? 0.34 : 0.82);
    const stopAt = releaseAt + 0.5;
    const voiceGain = ctx.audioCtx.createGain();
    const shaper = ctx.audioCtx.createWaveShaper();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const filter = ctx.audioCtx.createBiquadFilter();
    const amp = ctx.audioCtx.createGain();
    const pan = ctx.audioCtx.createStereoPanner();
    const biteOsc = ctx.audioCtx.createOscillator();
    const biteGain = ctx.audioCtx.createGain();

    shaper.curve = makeShaper(state.drive);
    shaper.oversample = '4x';
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(130, t);
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(4.4 + state.drive * 5.2, t);
    filter.frequency.setValueAtTime(420 + state.cutoff * 560, t);
    filter.frequency.exponentialRampToValueAtTime(980 + state.cutoff * 4300 + velocity * 900, t + 0.045);
    filter.frequency.exponentialRampToValueAtTime(520 + state.cutoff * 2100, releaseAt);
    pan.pan.setValueAtTime((randomFor(step, 3) - 0.5) * 0.42, t);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime((short ? 0.12 : 0.19) * velocity, t + 0.012);
    amp.gain.exponentialRampToValueAtTime((short ? 0.045 : 0.09) * velocity, t + 0.12);
    amp.gain.setTargetAtTime(0.0001, releaseAt, short ? 0.035 : 0.11);

    voiceGain.gain.setValueAtTime(0.58, t);
    voiceGain.connect(shaper);
    shaper.connect(highpass);
    highpass.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(delaySend);
    pan.connect(reverbSend);

    biteOsc.type = 'sine';
    biteOsc.frequency.setValueAtTime(freq * 2.02, t);
    biteGain.gain.setValueAtTime(freq * (0.003 + state.drive * 0.018), t);
    biteGain.gain.exponentialRampToValueAtTime(freq * 0.002, t + 0.08);
    biteOsc.connect(biteGain);

    const detunes = [-8, -2, 4];
    const oscillators = detunes.map((detune, index) => {
      const osc = ctx.audioCtx.createOscillator();
      osc.setPeriodicWave(leadWave);
      const startFreq = state.glide > 0.03 ? lastFreq : freq;
      osc.frequency.setValueAtTime(startFreq, t);
      if (glideTime > 0.002 && Math.abs(Math.log2(freq / Math.max(1, startFreq))) < 1.2) {
        osc.frequency.exponentialRampToValueAtTime(freq, t + glideTime);
      } else {
        osc.frequency.setValueAtTime(freq, t);
      }
      osc.detune.setValueAtTime(detune + (randomFor(step, index + 8) - 0.5) * 3, t);
      biteGain.connect(osc.frequency);
      osc.connect(voiceGain);
      osc.start(t);
      osc.stop(stopAt);
      return osc;
    });

    const sub = ctx.audioCtx.createOscillator();
    const subGain = ctx.audioCtx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(freq * 0.5, t);
    subGain.gain.setValueAtTime(0.036 * velocity, t);
    sub.connect(subGain);
    subGain.connect(voiceGain);
    sub.start(t);
    sub.stop(stopAt);
    biteOsc.start(t);
    biteOsc.stop(t + 0.12);

    lastFreq = freq;
    pulse = Math.max(pulse, velocity);
    remember(voiceGain, shaper, highpass, filter, amp, pan, biteOsc, biteGain, sub, subGain, ...oscillators);
    forgetLater(stopAt, voiceGain, shaper, highpass, filter, amp, pan, biteOsc, biteGain, sub, subGain, ...oscillators);
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .lead {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 210px;
        display: grid;
        grid-template-rows: auto 54px auto auto;
        gap: 7px;
        padding: 10px;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(11, 12, 16, 0.98), rgba(21, 22, 24, 0.98) 55%, rgba(18, 28, 24, 0.98)),
          repeating-linear-gradient(90deg, rgba(250, 204, 21, 0.07) 0 1px, transparent 1px 22px);
        border: 1px solid rgba(250, 204, 21, 0.58);
        border-radius: 8px;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: inset 0 0 24px rgba(20, 184, 166, 0.08);
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 7px;
      }
      h2 {
        margin: 0;
        color: #facc15;
        font-size: 14px;
        line-height: 1;
        letter-spacing: 0;
      }
      .tag {
        margin-top: 2px;
        color: #94a3b8;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button,
      input,
      select {
        font: inherit;
      }
      .toggle {
        width: 46px;
        height: 28px;
        padding: 0;
        border: 1px solid rgba(250, 204, 21, 0.7);
        border-radius: 5px;
        color: #111827;
        background: #facc15;
        cursor: pointer;
      }
      .toggle.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.8);
      }
      select {
        height: 28px;
        color: #ecfeff;
        background: rgba(2, 6, 23, 0.78);
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 5px;
        outline: none;
      }
      .scope {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 6px;
        background: #05070a;
        overflow: hidden;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px 8px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 5px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        height: 14px;
        accent-color: #14b8a6;
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(8, minmax(0, 1fr));
        gap: 3px;
      }
      .step {
        height: 20px;
        min-width: 0;
        padding: 0;
        color: #d1fae5;
        background: rgba(31, 41, 55, 0.94);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 4px;
        cursor: pointer;
        overflow: hidden;
        text-overflow: clip;
      }
      .step.on {
        color: #042f2e;
        background: #2dd4bf;
        border-color: rgba(153, 246, 228, 0.72);
      }
      .step.current {
        color: #111827;
        background: #facc15;
        border-color: #fef08a;
        box-shadow: 0 0 12px rgba(250, 204, 21, 0.68);
      }
    </style>
    <div class="lead">
      <div class="top">
        <div>
          <h2>Hip Hop Lead</h2>
          <div class="tag">minor hook / glide / tape delay</div>
        </div>
        <select id="root" title="root note"></select>
        <button class="toggle" id="enabled" type="button"></button>
      </div>
      <div class="scope"><canvas id="scope" width="320" height="54"></canvas></div>
      <div class="controls">
        <label>gain <input id="gain" type="range" min="0" max="1" step="0.01"></label>
        <label>cut <input id="cutoff" type="range" min="0" max="1" step="0.01"></label>
        <label>drive <input id="drive" type="range" min="0" max="1" step="0.01"></label>
        <label>glide <input id="glide" type="range" min="0" max="1" step="0.01"></label>
        <label>delay <input id="delayAmount" type="range" min="0" max="1" step="0.01"></label>
        <label>roll <input id="roll" type="range" min="0" max="1" step="0.01"></label>
      </div>
      <div class="steps" id="steps"></div>
    </div>
  `;

  const rootSelect = ctx.domRoot.querySelector('#root');
  const enabledButton = ctx.domRoot.querySelector('#enabled');
  const gainInput = ctx.domRoot.querySelector('#gain');
  const cutoffInput = ctx.domRoot.querySelector('#cutoff');
  const driveInput = ctx.domRoot.querySelector('#drive');
  const glideInput = ctx.domRoot.querySelector('#glide');
  const delayInput = ctx.domRoot.querySelector('#delayAmount');
  const rollInput = ctx.domRoot.querySelector('#roll');
  const stepsEl = ctx.domRoot.querySelector('#steps');
  const canvas = ctx.domRoot.querySelector('#scope');
  const canvasCtx = canvas.getContext('2d');

  rootSelect.innerHTML = roots.map(([name, midi]) => `<option value="${midi}">${name}</option>`).join('');

  const stepButtons = state.sequence.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step';
    button.dataset.index = String(index);
    stepsEl.appendChild(button);
    return button;
  });

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'mute';
    enabledButton.classList.toggle('off', !state.enabled);
    rootSelect.value = String(state.rootMidi);
    gainInput.value = String(state.gain);
    cutoffInput.value = String(state.cutoff);
    driveInput.value = String(state.drive);
    glideInput.value = String(state.glide);
    delayInput.value = String(state.delay);
    rollInput.value = String(state.roll);
    stepButtons.forEach((button, index) => {
      const note = state.sequence[index];
      button.textContent = noteName(note);
      button.classList.toggle('on', note !== null);
      button.classList.toggle('current', index === currentStep);
    });
  };

  const publishState = () => {
    if (applyingRemote) return;
    ctx.bus.pubGlobal(busKey, {
      enabled: state.enabled,
      rootMidi: state.rootMidi,
      sequence: state.sequence,
      gain: state.gain,
      cutoff: state.cutoff,
      drive: state.drive,
      glide: state.glide,
      delay: state.delay,
      swing: state.swing,
      roll: state.roll
    });
  };

  const setRange = (key, input) => {
    input.addEventListener('input', () => {
      state[key] = clamp(Number(input.value), 0, 1);
      updateFx();
      publishState();
    });
  };

  enabledButton.addEventListener('click', () => {
    state.enabled = !state.enabled;
    updateFx();
    render();
    publishState();
  });

  rootSelect.addEventListener('change', () => {
    state.rootMidi = Number(rootSelect.value);
    lastFreq = midiToFreq(state.rootMidi);
    render();
    publishState();
  });

  setRange('gain', gainInput);
  setRange('cutoff', cutoffInput);
  setRange('drive', driveInput);
  setRange('glide', glideInput);
  setRange('delay', delayInput);
  setRange('roll', rollInput);

  stepButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      const currentChoice = scaleChoices.findIndex((choice) => choice === state.sequence[index]);
      state.sequence[index] = scaleChoices[(currentChoice + 1) % scaleChoices.length];
      render();
      publishState();
    });
  });

  const unsubscribeRemote = ctx.bus.subGlobal(busKey, (value) => {
    if (!value || typeof value !== 'object') return;
    applyingRemote = true;
    if (typeof value.enabled === 'boolean') state.enabled = value.enabled;
    if (Number.isFinite(value.rootMidi)) state.rootMidi = clamp(Math.round(value.rootMidi), 48, 59);
    if (Array.isArray(value.sequence)) state.sequence = cloneSequence(value.sequence);
    ['gain', 'cutoff', 'drive', 'glide', 'delay', 'swing', 'roll'].forEach((key) => {
      if (Number.isFinite(value[key])) state[key] = clamp(Number(value[key]), 0, 1);
    });
    updateFx();
    render();
    applyingRemote = false;
  });

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration, bpm }) => {
    currentStep = step % 16;
    lastBpm = bpm || lastBpm;
    delay.delayTime.setTargetAtTime((60 / lastBpm) * 0.75, Math.max(time, now()), 0.04);
    render();
    if (!state.enabled) return;

    const offset = state.sequence[currentStep];
    if (offset === null) return;
    const swingOffset = currentStep % 2 === 1 ? duration * state.swing * 0.36 : 0;
    const accent = currentStep === 0 || currentStep === 10 ? 1 : 0.78;
    const human = 0.9 + randomFor(step, 17) * 0.16;
    triggerNote(state.rootMidi + offset, accent * human, time + swingOffset, duration, step);

    if ((currentStep === 14 || currentStep === 15) && state.roll > 0.05) {
      const rollCount = state.roll > 0.62 ? 3 : 2;
      for (let i = 1; i <= rollCount; i += 1) {
        const rollTime = time + swingOffset + duration * i / (rollCount + 1);
        const rollMidi = state.rootMidi + offset + (i === rollCount ? 12 : 0);
        triggerNote(rollMidi, 0.36 + state.roll * 0.22, rollTime, duration * 0.42, step + i * 100, true);
      }
    }
  });

  const timeData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const drawScope = () => {
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);
    pulse *= 0.9;
    visualPhase += 0.018 + pulse * 0.06;

    let low = 0;
    let mid = 0;
    for (let i = 0; i < freqData.length; i += 1) {
      const v = freqData[i] / 255;
      if (i < 12) low += v;
      else if (i < 44) mid += v;
    }
    low /= 12;
    mid /= 32;
    const energy = clamp(low * 0.7 + mid * 0.55 + pulse * 0.42, 0, 1.4);

    const w = canvas.width;
    const h = canvas.height;
    canvasCtx.clearRect(0, 0, w, h);
    const bg = canvasCtx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, `hsl(${185 + energy * 40}, 70%, ${5 + energy * 8}%)`);
    bg.addColorStop(0.52, `hsl(${45 + pulse * 30}, 82%, ${6 + energy * 9}%)`);
    bg.addColorStop(1, `hsl(${160 + mid * 70}, 64%, ${5 + energy * 7}%)`);
    canvasCtx.fillStyle = bg;
    canvasCtx.fillRect(0, 0, w, h);

    canvasCtx.globalAlpha = 0.28;
    canvasCtx.strokeStyle = '#475569';
    canvasCtx.lineWidth = 1;
    for (let x = 0; x < w; x += 24) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x + 18, h);
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;

    canvasCtx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 24; i += 1) {
      const magnitude = freqData[i + 2] / 255;
      const barW = w / 28;
      const x = 8 + i * (barW + 2);
      const barH = magnitude * (h * 0.68);
      canvasCtx.fillStyle = `hsla(${168 + i * 5 + visualPhase * 90}, 84%, ${48 + magnitude * 24}%, ${0.16 + magnitude * 0.54})`;
      canvasCtx.fillRect(x, h - barH, barW, barH);
    }

    canvasCtx.strokeStyle = `rgba(250, 204, 21, ${0.55 + energy * 0.32})`;
    canvasCtx.lineWidth = 1.4 + energy * 1.8;
    canvasCtx.beginPath();
    for (let i = 0; i < timeData.length; i += 1) {
      const x = i / (timeData.length - 1) * w;
      const y = h * 0.5 + (timeData[i] / 255 - 0.5) * h * (0.78 + energy * 0.36);
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
    }
    canvasCtx.stroke();

    canvasCtx.globalCompositeOperation = 'source-over';
    const dotX = (currentStep % 16) / 15 * (w - 18) + 9;
    canvasCtx.fillStyle = state.enabled ? '#2dd4bf' : '#64748b';
    canvasCtx.beginPath();
    canvasCtx.arc(dotX, 8 + pulse * 3, 3.2 + pulse * 2.4, 0, Math.PI * 2);
    canvasCtx.fill();
  };

  updateFx();
  render();

  return {
    update() {
      drawScope();
    },
    getState() {
      return {
        stateVersion: STATE_VERSION,
        enabled: state.enabled,
        rootMidi: state.rootMidi,
        sequence: [...state.sequence],
        gain: state.gain,
        cutoff: state.cutoff,
        drive: state.drive,
        glide: state.glide,
        delay: state.delay,
        swing: state.swing,
        roll: state.roll
      };
    },
    destroy() {
      unsubscribeClock();
      unsubscribeRemote();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      activeNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (error) {}
        try { node.disconnect(); } catch (error) {}
      });
      activeNodes.clear();
      [output, dry, delaySend, delay, delayFeedback, delayFilter, reverbSend, convolver, reverbGain, analyser].forEach((node) => {
        try { node.disconnect(); } catch (error) {}
      });
    }
  };
}
