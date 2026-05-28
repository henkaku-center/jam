// Modern classical chamber element: clocked piano figures, slow string pad,
// and a restrained notation-inspired canvas visual.
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 98.17 + salt * 311.9) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const state = {
    enabled: prevState?.enabled ?? true,
    rootMidi: Number.isFinite(prevState?.rootMidi) ? prevState.rootMidi : 50,
    intensity: Number.isFinite(prevState?.intensity) ? prevState.intensity : 0.68,
    room: Number.isFinite(prevState?.room) ? prevState.room : 0.48,
    motion: Number.isFinite(prevState?.motion) ? prevState.motion : 0.56
  };

  dom.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        background: #f6f2ea;
        color: #151515;
        border: 1px solid rgba(20, 20, 20, 0.18);
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        overflow: hidden;
      }
      .top {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
      }
      h1 {
        margin: 0;
        color: #141414;
        font: 650 13px/1.1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      button {
        width: 30px;
        height: 24px;
        border: 1px solid #242424;
        border-radius: 4px;
        background: #151515;
        color: #f8f3e8;
        cursor: pointer;
        font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
      }
      button.off {
        background: #f6f2ea;
        color: #151515;
      }
      .canvasWrap {
        min-height: 0;
        position: relative;
        background:
          linear-gradient(90deg, rgba(21,21,21,0.05) 1px, transparent 1px) 0 0 / 32px 100%,
          #fbf8ef;
        border: 1px solid rgba(21, 21, 21, 0.16);
        border-radius: 6px;
        overflow: hidden;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }
      label {
        display: grid;
        gap: 3px;
        min-width: 0;
        color: #414141;
        white-space: nowrap;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #111;
      }
      .readout {
        color: #8a1f20;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
    <div class="root">
      <div class="top">
        <h1>MODERN CLASSICAL</h1>
        <button id="toggle" title="Toggle sound">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="canvasWrap"><canvas id="score"></canvas></div>
      <div class="controls">
        <label>root <input id="root" type="range" min="38" max="62" step="1" value="${state.rootMidi}"></label>
        <label>pulse <input id="intensity" type="range" min="0" max="1" step="0.001" value="${state.intensity}"></label>
        <label>room <input id="room" type="range" min="0" max="1" step="0.001" value="${state.room}"></label>
        <label>motion <input id="motion" type="range" min="0" max="1" step="0.001" value="${state.motion}"></label>
      </div>
    </div>
  `;

  const canvas = dom.querySelector('#score');
  const view = canvas.getContext('2d');
  const toggleButton = dom.querySelector('#toggle');
  const rootSlider = dom.querySelector('#root');
  const intensitySlider = dom.querySelector('#intensity');
  const roomSlider = dom.querySelector('#room');
  const motionSlider = dom.querySelector('#motion');

  const output = ctx.audioCtx.createGain();
  const dry = ctx.audioCtx.createGain();
  const wet = ctx.audioCtx.createGain();
  const delay = ctx.audioCtx.createDelay(1.4);
  const delayFeedback = ctx.audioCtx.createGain();
  const delayFilter = ctx.audioCtx.createBiquadFilter();
  const convolver = ctx.audioCtx.createConvolver();
  const reverbGain = ctx.audioCtx.createGain();
  const padFilter = ctx.audioCtx.createBiquadFilter();
  const padGain = ctx.audioCtx.createGain();
  const limiter = ctx.audioCtx.createDynamicsCompressor();

  output.gain.value = 0.72;
  dry.gain.value = 0.88;
  wet.gain.value = state.room;
  delay.delayTime.value = 0.375;
  delayFeedback.gain.value = 0.22;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 2600;
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 1800;
  padFilter.Q.value = 0.8;
  padGain.gain.value = 0;
  limiter.threshold.value = -18;
  limiter.knee.value = 18;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.18;

  const makeImpulse = () => {
    const length = Math.floor(ctx.audioCtx.sampleRate * 1.8);
    const buffer = ctx.audioCtx.createBuffer(2, length, ctx.audioCtx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.9);
        data[i] = (Math.random() * 2 - 1) * fade * 0.34;
      }
    }
    return buffer;
  };

  convolver.buffer = makeImpulse();
  dry.connect(output);
  output.connect(limiter);
  limiter.connect(ctx.audioOut);
  wet.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayFilter.connect(output);
  wet.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);
  padFilter.connect(padGain);
  padGain.connect(dry);
  padGain.connect(wet);

  const chordOffsets = [
    [0, 7, 14, 17],
    [3, 10, 14, 19],
    [-2, 5, 12, 16],
    [2, 9, 12, 21],
    [-5, 2, 9, 14],
    [0, 4, 11, 18]
  ];
  const pianoPattern = [0, 7, 12, null, 14, 7, 3, null, 10, 17, 14, null, 12, 5, 9, null];
  const activeNodes = new Set();
  const particles = [];
  const padOscillators = [];

  const remember = (...nodes) => {
    nodes.forEach((node) => activeNodes.add(node));
  };

  const forgetLater = (time, ...nodes) => {
    const ms = Math.max(100, (time - now()) * 1000 + 160);
    const id = setTimeout(() => {
      timers.delete(id);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
        activeNodes.delete(node);
      });
    }, ms);
    timers.add(id);
  };

  const timers = new Set();

  const makeBellWave = () => {
    const real = new Float32Array(18);
    const imag = new Float32Array(18);
    imag[1] = 0.9;
    imag[2] = 0.18;
    imag[3] = 0.08;
    imag[5] = 0.035;
    imag[8] = 0.018;
    return ctx.audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
  };

  const bellWave = makeBellWave();

  const triggerPiano = (midi, velocity, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration * (1.7 + state.room * 1.5);
    const body = ctx.audioCtx.createOscillator();
    const overtone = ctx.audioCtx.createOscillator();
    const thunk = ctx.audioCtx.createOscillator();
    const bodyGain = ctx.audioCtx.createGain();
    const overtoneGain = ctx.audioCtx.createGain();
    const thunkGain = ctx.audioCtx.createGain();
    const filter = ctx.audioCtx.createBiquadFilter();
    const pan = ctx.audioCtx.createStereoPanner();

    body.setPeriodicWave(bellWave);
    overtone.type = 'sine';
    thunk.type = 'triangle';
    body.frequency.setValueAtTime(freq, t);
    overtone.frequency.setValueAtTime(freq * (2.004 + randomFor(step, 4) * 0.006), t);
    thunk.frequency.setValueAtTime(freq * 0.5, t);
    body.detune.setValueAtTime((randomFor(step, 2) - 0.5) * 5, t);
    pan.pan.setValueAtTime((randomFor(step, 9) - 0.5) * 0.7, t);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + velocity * 2200 + state.motion * 1600, t);
    filter.frequency.exponentialRampToValueAtTime(420 + state.motion * 900, t + duration * 1.25);
    filter.Q.setValueAtTime(1.4, t);

    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.2 * velocity, t + 0.012);
    bodyGain.gain.exponentialRampToValueAtTime(0.045 * velocity, t + 0.18);
    bodyGain.gain.setTargetAtTime(0.0001, t + duration * 0.9, 0.18 + state.room * 0.12);
    overtoneGain.gain.setValueAtTime(0.0001, t);
    overtoneGain.gain.exponentialRampToValueAtTime(0.07 * velocity, t + 0.006);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    thunkGain.gain.setValueAtTime(0.034 * velocity, t);
    thunkGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    body.connect(bodyGain);
    overtone.connect(overtoneGain);
    thunk.connect(thunkGain);
    bodyGain.connect(filter);
    overtoneGain.connect(filter);
    thunkGain.connect(filter);
    filter.connect(pan);
    pan.connect(dry);
    pan.connect(wet);

    body.start(t);
    overtone.start(t);
    thunk.start(t);
    body.stop(stopAt);
    overtone.stop(t + 0.5);
    thunk.stop(t + 0.07);

    remember(body, overtone, thunk, bodyGain, overtoneGain, thunkGain, filter, pan);
    forgetLater(stopAt, body, overtone, thunk, bodyGain, overtoneGain, thunkGain, filter, pan);
    particles.push({
      x: 20 + (step % 16) / 15 * 260,
      y: 112 - (midi - state.rootMidi) * 2.6,
      radius: 2.5 + velocity * 5,
      life: 1,
      tone: midi
    });
    while (particles.length > 80) particles.shift();
  };

  const createPad = () => {
    for (let note = 0; note < 4; note += 1) {
      for (let detune = 0; detune < 2; detune += 1) {
        const osc = ctx.audioCtx.createOscillator();
        const gain = ctx.audioCtx.createGain();
        osc.type = detune ? 'triangle' : 'sine';
        osc.frequency.value = midiToFreq(state.rootMidi + chordOffsets[0][note]);
        osc.detune.value = detune ? 7 : -5;
        gain.gain.value = note === 0 ? 0.07 : 0.045;
        osc.connect(gain);
        gain.connect(padFilter);
        osc.start();
        padOscillators.push({ osc, gain, note, detune });
      }
    }
  };

  const retunePad = (absoluteStep, scheduledTime) => {
    const chordIndex = Math.floor(absoluteStep / 16) % chordOffsets.length;
    const offsets = chordOffsets[chordIndex];
    const t = Math.max(scheduledTime || now(), now());
    padOscillators.forEach(({ osc, gain, note, detune }) => {
      const octave = detune ? 12 : 0;
      const target = midiToFreq(state.rootMidi + offsets[note] + octave);
      osc.frequency.setTargetAtTime(target, t, 0.24);
      gain.gain.setTargetAtTime((note === 0 ? 0.07 : 0.043) * (0.75 + state.motion * 0.6), t, 0.08);
    });
  };

  createPad();
  retunePad(0, now());

  let currentStep = -1;
  let lastTickTime = now();
  let lastBpm = 120;
  let animationId = 0;
  let dpr = 1;

  const updateControls = () => {
    toggleButton.textContent = state.enabled ? 'ON' : 'OFF';
    toggleButton.classList.toggle('off', !state.enabled);
    const t = now();
    wet.gain.setTargetAtTime(state.room, t, 0.04);
    delayFeedback.gain.setTargetAtTime(0.12 + state.room * 0.36, t, 0.04);
    reverbGain.gain.setTargetAtTime(0.22 + state.room * 0.36, t, 0.04);
    padGain.gain.setTargetAtTime(state.enabled ? 0.13 + state.intensity * 0.17 : 0.0001, t, 0.08);
    padFilter.frequency.setTargetAtTime(680 + state.motion * 2600, t, 0.08);
    output.gain.setTargetAtTime(state.enabled ? 0.56 + state.intensity * 0.24 : 0.0001, t, 0.04);
  };

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration, bpm }) => {
    currentStep = step % 16;
    lastTickTime = time || now();
    lastBpm = bpm || lastBpm;
    delay.delayTime.setTargetAtTime((60 / lastBpm) * 0.75, Math.max(now(), time || now()), 0.04);
    if (step % 16 === 0) retunePad(step, time);
    if (!state.enabled) return;

    const base = pianoPattern[currentStep];
    if (!Number.isFinite(base)) return;
    const densityGate = currentStep % 4 === 0 ? 0 : 0.22 - state.motion * 0.17;
    if (randomFor(step, 17) < densityGate) return;
    const register = step % 64 >= 48 && currentStep % 4 === 2 ? 12 : 0;
    const accent = currentStep === 0 || currentStep === 10 ? 1.15 : 1;
    const velocity = clamp((0.38 + state.intensity * 0.5) * accent * (0.86 + randomFor(step, 5) * 0.22), 0.18, 1);
    triggerPiano(state.rootMidi + base + register, velocity, time, duration, step);

    if (state.motion > 0.72 && currentStep % 8 === 6) {
      triggerPiano(state.rootMidi + base + 24, velocity * 0.42, time + duration * 0.48, duration * 0.65, step + 1000);
    }
  });

  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = () => {
    resizeCanvas();
    const w = canvas.width;
    const h = canvas.height;
    const beatPhase = ((now() - lastTickTime) * (lastBpm / 60) * 4) % 1;
    view.clearRect(0, 0, w, h);
    view.save();
    view.scale(dpr, dpr);
    const cw = w / dpr;
    const ch = h / dpr;

    view.fillStyle = '#fbf8ef';
    view.fillRect(0, 0, cw, ch);
    view.strokeStyle = 'rgba(20,20,20,0.23)';
    view.lineWidth = 1;
    for (let line = -2; line <= 2; line += 1) {
      const y = ch * 0.5 + line * 13;
      view.beginPath();
      view.moveTo(10, y);
      view.lineTo(cw - 10, y);
      view.stroke();
    }

    view.fillStyle = 'rgba(138,31,32,0.12)';
    const playX = 14 + ((currentStep + beatPhase) / 16) * (cw - 28);
    view.fillRect(playX, 8, 2, ch - 16);

    particles.forEach((particle) => {
      particle.life -= 0.018;
      particle.x += 0.45 + state.motion * 0.55;
      particle.y += Math.sin(now() * 1.7 + particle.tone) * 0.12;
    });
    while (particles.length && particles[0].life <= 0) particles.shift();

    particles.forEach((particle) => {
      const x = clamp(particle.x / 300 * cw, 12, cw - 12);
      const y = clamp(ch * 0.5 + (particle.y - 100) * 0.72, 14, ch - 14);
      view.globalAlpha = clamp(particle.life, 0, 1);
      view.fillStyle = '#151515';
      view.beginPath();
      view.ellipse(x, y, particle.radius, particle.radius * 0.72, -0.22, 0, Math.PI * 2);
      view.fill();
      view.strokeStyle = '#8a1f20';
      view.beginPath();
      view.moveTo(x + particle.radius * 0.7, y - particle.radius * 0.3);
      view.lineTo(x + particle.radius * 0.7, y - 20 - state.motion * 14);
      view.stroke();
    });
    view.globalAlpha = 1;
    view.fillStyle = '#8a1f20';
    view.font = '10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    view.fillText(`step ${String(currentStep + 1).padStart(2, '0')}  bpm ${Math.round(lastBpm)}`, 12, ch - 10);
    view.restore();
    animationId = requestAnimationFrame(draw);
  };

  const onToggle = () => {
    state.enabled = !state.enabled;
    updateControls();
  };
  const onRoot = () => {
    state.rootMidi = Number(rootSlider.value);
    retunePad(currentStep < 0 ? 0 : currentStep, now());
  };
  const onIntensity = () => {
    state.intensity = Number(intensitySlider.value);
    updateControls();
  };
  const onRoom = () => {
    state.room = Number(roomSlider.value);
    updateControls();
  };
  const onMotion = () => {
    state.motion = Number(motionSlider.value);
    updateControls();
  };

  toggleButton.addEventListener('click', onToggle);
  rootSlider.addEventListener('input', onRoot);
  intensitySlider.addEventListener('input', onIntensity);
  roomSlider.addEventListener('input', onRoom);
  motionSlider.addEventListener('input', onMotion);

  updateControls();
  draw();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      cancelAnimationFrame(animationId);
      unsubscribeClock();
      timers.forEach((id) => clearTimeout(id));
      toggleButton.removeEventListener('click', onToggle);
      rootSlider.removeEventListener('input', onRoot);
      intensitySlider.removeEventListener('input', onIntensity);
      roomSlider.removeEventListener('input', onRoom);
      motionSlider.removeEventListener('input', onMotion);
      padOscillators.forEach(({ osc, gain }) => {
        try { osc.stop(); } catch (_) {}
        try { osc.disconnect(); gain.disconnect(); } catch (_) {}
      });
      activeNodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
      try {
        output.disconnect();
        dry.disconnect();
        wet.disconnect();
        delay.disconnect();
        delayFeedback.disconnect();
        delayFilter.disconnect();
        convolver.disconnect();
        reverbGain.disconnect();
        padFilter.disconnect();
        padGain.disconnect();
        limiter.disconnect();
      } catch (_) {}
    }
  };
}
