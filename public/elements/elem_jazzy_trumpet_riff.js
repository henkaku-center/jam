const STATE_VERSION = 'jazzy-trumpet-riff-v1';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const isCurrentState = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: isCurrentState ? finite(prevState?.volume, 1.18) : 1.18,
    bite: isCurrentState ? finite(prevState?.bite, 0.72) : 0.72,
    room: isCurrentState ? finite(prevState?.room, 0.34) : 0.34,
    cycleBars: isCurrentState ? finite(prevState?.cycleBars, 16) : 16,
    phraseBars: isCurrentState ? finite(prevState?.phraseBars, 2) : 2
  };

  const phrase = [
    { s: 0, n: 70, v: 1.05, l: 0.9, a: -10 },
    { s: 1, n: 73, v: 0.82, l: 0.65, a: -6 },
    { s: 2, n: 75, v: 0.92, l: 0.75, a: -2 },
    { s: 4, n: 80, v: 1.18, l: 1.4, a: 0, stab: true },
    { s: 6, n: 78, v: 0.74, l: 0.55, a: -4 },
    { s: 7, n: 77, v: 0.78, l: 0.65, a: -2 },
    { s: 8, n: 75, v: 1.02, l: 1.05, a: -5 },
    { s: 10, n: 77, v: 0.86, l: 0.55, a: 0 },
    { s: 11, n: 80, v: 0.92, l: 0.8, a: 3 },
    { s: 12, n: 82, v: 1.25, l: 1.8, a: 5, stab: true },
    { s: 15, n: 80, v: 0.84, l: 0.55, a: -5 },
    { s: 16, n: 82, v: 1.16, l: 0.75, a: -2 },
    { s: 17, n: 85, v: 0.94, l: 0.6, a: 2 },
    { s: 18, n: 87, v: 1.08, l: 1.1, a: 0 },
    { s: 20, n: 89, v: 1.22, l: 1.55, a: 3, stab: true },
    { s: 22, n: 87, v: 0.8, l: 0.55, a: -4 },
    { s: 23, n: 85, v: 0.86, l: 0.65, a: -2 },
    { s: 24, n: 82, v: 1.05, l: 0.85, a: -5 },
    { s: 26, n: 80, v: 0.86, l: 0.55, a: -3 },
    { s: 27, n: 78, v: 0.82, l: 0.55, a: -1 },
    { s: 28, n: 77, v: 1.1, l: 1.0, a: 0 },
    { s: 30, n: 70, v: 1.34, l: 1.95, a: -7, stab: true }
  ];

  const output = audio.createGain();
  const dry = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.8);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const analyser = audio.createAnalyser();

  output.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 1.1;
  compressor.threshold.value = -19;
  compressor.knee.value = 12;
  compressor.ratio.value = 5.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
  delay.delayTime.value = 0.17;
  feedback.gain.value = 0.18;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3600;
  wet.gain.value = state.room * 0.28;
  analyser.fftSize = 128;

  dry.connect(output);
  dry.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);
  output.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let destroyed = false;
  let lastLaunchStep = -1;
  let currentStep = -1;
  let pulse = 0;
  let nextLaunchIn = 0;

  function makeTrumpetWave() {
    const real = new Float32Array(18);
    const imag = new Float32Array(18);
    imag[1] = 0.9;
    imag[2] = 0.72;
    imag[3] = 0.48;
    imag[4] = 0.32;
    imag[5] = 0.24;
    imag[6] = 0.16;
    imag[8] = 0.08;
    imag[10] = 0.04;
    return audio.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function makeNoiseBuffer() {
    const length = Math.max(1, Math.floor(audio.sampleRate * 0.5));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.54 + (Math.random() * 2 - 1) * 0.46;
      data[i] = last;
    }
    return buffer;
  }

  const trumpetWave = makeTrumpetWave();
  const noiseBuffer = makeNoiseBuffer();

  function track(seconds, ...nodes) {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 260));
    cleanupTimers.add(timer);
  }

  function syncAudio() {
    const t = audio.currentTime;
    output.gain.setTargetAtTime(state.running ? state.volume : 0, t, 0.025);
    wet.gain.setTargetAtTime(state.room * 0.28, t, 0.04);
    feedback.gain.setTargetAtTime(0.1 + state.room * 0.24, t, 0.04);
    delayTone.frequency.setTargetAtTime(2400 + state.bite * 3000, t, 0.04);
  }

  function playVoice(note, time, stepDuration, offsetMidi = 0, gainScale = 1, panValue = 0) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const length = Math.max(0.045, stepDuration * note.l);
    const stopAt = t + length + 0.34;
    const freq = midiToFreq(note.n + offsetMidi);
    const velocity = clamp(note.v * gainScale, 0, 1.6);
    const bite = clamp(state.bite, 0, 1);

    const main = audio.createOscillator();
    const bright = audio.createOscillator();
    const sub = audio.createOscillator();
    const breath = audio.createBufferSource();
    const breathFilter = audio.createBiquadFilter();
    const breathGain = audio.createGain();
    const preGain = audio.createGain();
    const formantA = audio.createBiquadFilter();
    const formantB = audio.createBiquadFilter();
    const bell = audio.createBiquadFilter();
    const amp = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const vibrato = audio.createOscillator();
    const vibratoGain = audio.createGain();
    const nodes = [main, bright, sub, breath, breathFilter, breathGain, preGain, formantA, formantB, bell, amp, vibrato, vibratoGain];

    main.setPeriodicWave(trumpetWave);
    bright.type = 'sawtooth';
    sub.type = 'triangle';
    breath.buffer = noiseBuffer;
    breath.loop = true;

    const scoop = Math.pow(2, ((note.a || -4) / 1200));
    main.frequency.setValueAtTime(freq * scoop, t);
    main.frequency.exponentialRampToValueAtTime(freq, t + 0.035);
    bright.frequency.setValueAtTime(freq * 1.002, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);

    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(5.4, t);
    vibratoGain.gain.setValueAtTime(freq * 0.001, t);
    vibratoGain.gain.linearRampToValueAtTime(freq * (0.005 + bite * 0.01), t + Math.min(0.2, length * 0.55));
    vibrato.connect(vibratoGain);
    vibratoGain.connect(main.frequency);
    vibratoGain.connect(bright.frequency);

    preGain.gain.setValueAtTime(0.76, t);
    formantA.type = 'bandpass';
    formantB.type = 'bandpass';
    bell.type = 'lowpass';
    formantA.frequency.setValueAtTime(760 + bite * 560, t);
    formantA.Q.setValueAtTime(5.8, t);
    formantB.frequency.setValueAtTime(1850 + bite * 1180, t);
    formantB.Q.setValueAtTime(6.4, t);
    bell.frequency.setValueAtTime(2100 + bite * 6200 + velocity * 700, t);
    bell.Q.setValueAtTime(1.1 + bite * 1.7, t);

    breathFilter.type = 'highpass';
    breathFilter.frequency.setValueAtTime(1800 + bite * 2500, t);
    breathGain.gain.setValueAtTime(0.0001, t);
    breathGain.gain.exponentialRampToValueAtTime(0.026 * velocity * (0.4 + bite), t + 0.012);
    breathGain.gain.setTargetAtTime(0.0001, t + length * 0.8, 0.05);

    const attack = note.stab ? 0.01 : 0.018;
    const peak = 0.3 * velocity;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    amp.gain.linearRampToValueAtTime(Math.max(0.0002, peak * 0.74), t + Math.min(0.12, length * 0.5));
    amp.gain.setTargetAtTime(0.0001, t + length, note.stab ? 0.055 : 0.085);

    if (pan) {
      pan.pan.setValueAtTime(panValue, t);
      nodes.push(pan);
    }

    main.connect(preGain);
    bright.connect(preGain);
    sub.connect(preGain);
    preGain.connect(formantA);
    preGain.connect(bell);
    formantA.connect(formantB);
    formantB.connect(bell);
    breath.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(bell);
    bell.connect(amp);

    if (pan) {
      amp.connect(pan);
      pan.connect(dry);
    } else {
      amp.connect(dry);
    }

    main.start(t);
    bright.start(t);
    sub.start(t);
    breath.start(t);
    vibrato.start(t);
    main.stop(stopAt);
    bright.stop(stopAt);
    sub.stop(stopAt);
    breath.stop(stopAt);
    vibrato.stop(stopAt);
    track(length + 0.42, ...nodes);
  }

  function playNote(note, time, stepDuration) {
    playVoice(note, time, stepDuration, 0, 1, note.stab ? -0.08 : 0.02);
    if (note.stab) {
      playVoice(note, time + 0.006, stepDuration, -5, 0.58, -0.34);
      playVoice(note, time + 0.011, stepDuration, -9, 0.42, 0.36);
    }
  }

  function launchPhrase(step, time, stepDuration) {
    if (!state.running || destroyed || step === lastLaunchStep) return;
    lastLaunchStep = step;
    pulse = 1;
    phrase.forEach((note) => {
      playNote(note, time + note.s * stepDuration, stepDuration);
    });
  }

  function onTick({ step, time, duration }) {
    currentStep = step;
    const cycleSteps = Math.max(16, Math.round(state.cycleBars) * 16);
    const phraseSteps = Math.max(16, Math.round(state.phraseBars) * 16);
    const position = ((step % cycleSteps) + cycleSteps) % cycleSteps;
    nextLaunchIn = position === 0 ? 0 : cycleSteps - position;

    if (position === 0) {
      launchPhrase(step, time, duration);
    } else if (position < phraseSteps) {
      pulse = Math.max(pulse, 0.36);
    }
  }

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .trumpet {
        box-sizing: border-box;
        height: 100%;
        min-width: 320px;
        min-height: 220px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        padding: 13px;
        overflow: hidden;
        color: #fff7ed;
        background: linear-gradient(135deg, #20130a, #162033 56%, #090c12);
        border: 1px solid rgba(251, 191, 36, 0.55);
        border-radius: 8px;
        box-shadow: inset 0 0 30px rgba(251, 191, 36, 0.1);
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 10px;
      }
      h2 {
        margin: 0;
        color: #fde68a;
        font: 800 15px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 3px;
        color: #cbd5e1;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        height: 30px;
        padding: 0 10px;
        border: 1px solid rgba(251, 191, 36, 0.45);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.76);
        color: #fde68a;
        font: inherit;
        cursor: pointer;
      }
      button.active {
        background: rgba(180, 83, 9, 0.38);
        color: #fff7ed;
      }
      .stage {
        position: relative;
        height: 64px;
        border: 1px solid rgba(251, 191, 36, 0.24);
        border-radius: 8px;
        background:
          radial-gradient(circle at 28% 42%, rgba(251, 191, 36, var(--glow, 0.16)), transparent 34%),
          linear-gradient(90deg, rgba(15, 23, 42, 0.9), rgba(69, 26, 3, 0.54));
        overflow: hidden;
      }
      .bell {
        position: absolute;
        left: 18px;
        top: 15px;
        width: 35px;
        height: 35px;
        border-radius: 50%;
        border: 8px solid rgba(251, 191, 36, 0.9);
        border-left-width: 3px;
        transform: scale(var(--scale, 1));
      }
      .beam {
        position: absolute;
        left: 52px;
        top: 24px;
        width: 72%;
        height: 16px;
        transform-origin: left center;
        transform: scaleX(var(--scale, 0.2));
        background: linear-gradient(90deg, rgba(251, 191, 36, 0.48), rgba(248, 250, 252, 0));
      }
      .readout {
        position: absolute;
        right: 10px;
        bottom: 8px;
        color: #fed7aa;
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      label {
        display: grid;
        gap: 5px;
        color: #fed7aa;
      }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #f59e0b;
      }
      .footer {
        align-self: end;
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: #94a3b8;
      }
    </style>
    <div class="trumpet">
      <div class="top">
        <div>
          <h2>Jazzy Trumpet Hit</h2>
          <div class="sub">original loud two-bar brass riff every 16 bars</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="stage" id="stage">
        <div class="bell"></div>
        <div class="beam"></div>
        <div class="readout" id="readout"></div>
      </div>
      <div class="controls">
        <label>
          <span class="row"><span>volume</span><span id="volumeVal"></span></span>
          <input id="volume" type="range" min="0" max="1.5" step="0.01">
        </label>
        <label>
          <span class="row"><span>bite</span><span id="biteVal"></span></span>
          <input id="bite" type="range" min="0" max="1" step="0.01">
        </label>
      </div>
      <div class="footer">
        <span>period 16 bars</span>
        <span>length 2 bars</span>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const els = {
    run: $('#run'),
    stage: $('#stage'),
    readout: $('#readout'),
    volume: $('#volume'),
    volumeVal: $('#volumeVal'),
    bite: $('#bite'),
    biteVal: $('#biteVal')
  };

  function render() {
    els.run.textContent = state.running ? 'on' : 'off';
    els.run.classList.toggle('active', state.running);
    els.volume.value = String(state.volume);
    els.bite.value = String(state.bite);
    els.volumeVal.textContent = state.volume.toFixed(2);
    els.biteVal.textContent = `${Math.round(state.bite * 100)}%`;
    els.readout.textContent = currentStep < 0 ? 'arming' : `next ${nextLaunchIn} steps`;
    els.stage.style.setProperty('--glow', String(0.12 + pulse * 0.48));
    els.stage.style.setProperty('--scale', String(0.9 + pulse * 0.34));
  }

  function publish(key, value) {
    ctx.bus.pubGlobal(`trumpet_riff_${key}`, value);
  }

  function onRun() {
    state.running = !state.running;
    publish('running', state.running);
    syncAudio();
    render();
  }

  function onVolume() {
    state.volume = clamp(Number(els.volume.value), 0, 1.5);
    publish('volume', state.volume);
    syncAudio();
    render();
  }

  function onBite() {
    state.bite = clamp(Number(els.bite.value), 0, 1);
    publish('bite', state.bite);
    syncAudio();
    render();
  }

  els.run.addEventListener('click', onRun);
  els.volume.addEventListener('input', onVolume);
  els.bite.addEventListener('input', onBite);

  const unsubs = [
    ctx.clock.onTick(onTick),
    ctx.bus.subGlobal('trumpet_riff_running', (value) => {
      if (typeof value !== 'boolean') return;
      state.running = value;
      syncAudio();
      render();
    }),
    ctx.bus.subGlobal('trumpet_riff_volume', (value) => {
      if (!Number.isFinite(Number(value))) return;
      state.volume = clamp(Number(value), 0, 1.5);
      syncAudio();
      render();
    }),
    ctx.bus.subGlobal('trumpet_riff_bite', (value) => {
      if (!Number.isFinite(Number(value))) return;
      state.bite = clamp(Number(value), 0, 1);
      syncAudio();
      render();
    })
  ];

  function update() {
    pulse *= 0.9;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i];
    pulse = Math.max(pulse, clamp(sum / (data.length * 180), 0, 1));
    render();
  }

  syncAudio();
  render();

  return {
    update,
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      els.run.removeEventListener('click', onRun);
      els.volume.removeEventListener('input', onVolume);
      els.bite.removeEventListener('input', onBite);
      unsubs.forEach((unsubscribe) => unsubscribe());
      cleanupTimers.forEach(clearTimeout);
      cleanupTimers.clear();
      liveNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      });
      liveNodes.clear();
      [dry, delay, feedback, delayTone, wet, output, compressor, analyser].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
    }
  };
}
