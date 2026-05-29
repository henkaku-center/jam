// Punjabi DJ / bhangra club element: intense dhol groove, tumbi hooks,
// bass drops, brass stabs, and short synthesized hype chops.
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const now = () => audio.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 151.91 + salt * 389.17) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const state = {
    enabled: true,
    rootMidi: finite(prevState?.rootMidi, 49),
    dhol: Math.max(finite(prevState?.dhol, 0.96), 0.9),
    tumbi: Math.max(finite(prevState?.tumbi, 0.74), 0.62),
    bass: Math.max(finite(prevState?.bass, 0.84), 0.72),
    hype: Math.max(finite(prevState?.hype, 0.66), 0.5),
    club: Math.max(finite(prevState?.club, 0.86), 0.72)
  };

  dom.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 320px;
        min-height: 230px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        overflow: hidden;
        background: #0d0c12;
        color: #fff7e6;
        border: 1px solid rgba(255, 247, 230, 0.18);
        font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #ffd166;
        font: 750 13px/1.1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      button {
        width: 34px;
        height: 25px;
        border: 1px solid #ffb703;
        border-radius: 4px;
        background: #ffb703;
        color: #17110a;
        cursor: pointer;
        font: 750 11px/1 ui-sans-serif, system-ui, sans-serif;
      }
      button.off {
        background: #17131c;
        color: #fff7e6;
        border-color: rgba(255, 247, 230, 0.28);
      }
      .stage {
        min-height: 0;
        position: relative;
        overflow: hidden;
        border: 1px solid rgba(255, 247, 230, 0.16);
        border-radius: 6px;
        background:
          linear-gradient(135deg, rgba(255, 183, 3, 0.18), transparent 36%),
          radial-gradient(circle at 72% 24%, rgba(255, 0, 110, 0.18), transparent 34%),
          linear-gradient(180deg, #17131c 0%, #111925 100%);
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .steps {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 8px;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        gap: 3px;
        height: 6px;
      }
      .steps span {
        min-width: 0;
        border-radius: 2px;
        background: rgba(255, 247, 230, 0.16);
      }
      .steps span.on {
        background: #ffd166;
        box-shadow: 0 0 10px rgba(255, 209, 102, 0.76);
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 7px;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 3px;
        color: #d8d2c6;
        white-space: nowrap;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #ffb703;
      }
    </style>
    <div class="root">
      <div class="top">
        <h1>PUNJABI DJ DRUMS</h1>
        <button id="toggle" title="Toggle sound">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="stage">
        <canvas id="visual"></canvas>
        <div class="steps">${Array.from({ length: 16 }, () => '<span></span>').join('')}</div>
      </div>
      <div class="controls">
        <label>root <input id="root" type="range" min="42" max="56" step="1" value="${state.rootMidi}"></label>
        <label>dhol <input id="dhol" type="range" min="0" max="1" step="0.001" value="${state.dhol}"></label>
        <label>tumbi <input id="tumbi" type="range" min="0" max="1" step="0.001" value="${state.tumbi}"></label>
        <label>bass <input id="bass" type="range" min="0" max="1" step="0.001" value="${state.bass}"></label>
        <label>hype <input id="hype" type="range" min="0" max="1" step="0.001" value="${state.hype}"></label>
        <label>club <input id="club" type="range" min="0" max="1" step="0.001" value="${state.club}"></label>
      </div>
    </div>
  `;

  const canvas = dom.querySelector('#visual');
  const view = canvas.getContext('2d');
  const toggle = dom.querySelector('#toggle');
  const rootSlider = dom.querySelector('#root');
  const dholSlider = dom.querySelector('#dhol');
  const tumbiSlider = dom.querySelector('#tumbi');
  const bassSlider = dom.querySelector('#bass');
  const hypeSlider = dom.querySelector('#hype');
  const clubSlider = dom.querySelector('#club');
  const stepCells = [...dom.querySelectorAll('.steps span')];

  const output = audio.createGain();
  const dry = audio.createGain();
  const send = audio.createGain();
  const delay = audio.createDelay(1.2);
  const delayFeedback = audio.createGain();
  const delayFilter = audio.createBiquadFilter();
  const convolver = audio.createConvolver();
  const reverbGain = audio.createGain();
  const analyser = audio.createAnalyser();
  const limiter = audio.createDynamicsCompressor();

  output.gain.value = 0.94;
  dry.gain.value = 0.98;
  send.gain.value = 0.24 + state.club * 0.24;
  delay.delayTime.value = 0.155;
  delayFeedback.gain.value = 0.24;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 4200;
  reverbGain.gain.value = 0.18 + state.club * 0.2;
  analyser.fftSize = 256;
  limiter.threshold.value = -11;
  limiter.knee.value = 15;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.14;

  const makeImpulse = () => {
    const length = Math.floor(audio.sampleRate * 1.05);
    const buffer = audio.createBuffer(2, length, audio.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.7);
        data[i] = (Math.random() * 2 - 1) * fade * 0.32;
      }
    }
    return buffer;
  };

  convolver.buffer = makeImpulse();
  dry.connect(output);
  output.connect(analyser);
  analyser.connect(limiter);
  limiter.connect(ctx.audioOut);
  send.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayFilter.connect(output);
  send.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  const activeNodes = new Set();
  const timers = new Set();
  const bursts = [];
  let currentStep = -1;
  let lastDuration = 0.125;
  let pulse = 0;
  let resizeObserver = null;

  const remember = (...nodes) => nodes.forEach((node) => activeNodes.add(node));

  const forgetLater = (time, ...nodes) => {
    const id = setTimeout(() => {
      timers.delete(id);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
        activeNodes.delete(node);
      });
    }, Math.max(90, (time - now()) * 1000 + 150));
    timers.add(id);
  };

  const setTarget = (param, value, time = now(), smoothing = 0.025) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, value > 0 ? time : now(), smoothing);
  };

  const noiseBuffer = (() => {
    const length = Math.floor(audio.sampleRate * 0.45);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  })();

  const makeDriveCurve = (amount) => {
    const curve = new Float32Array(1024);
    const k = 1 + amount * 48;
    for (let i = 0; i < curve.length; i += 1) {
      const x = i * 2 / (curve.length - 1) - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  };

  const spawnBurst = (kind, step, amount = 1) => {
    const count = kind === 'dhol' ? 9 : kind === 'hype' ? 12 : 5;
    for (let i = 0; i < count; i += 1) {
      bursts.push({
        x: 0.14 + randomFor(step, i + 4) * 0.72,
        y: 0.18 + randomFor(step, i + 12) * 0.48,
        vx: (randomFor(step, i + 21) - 0.5) * 0.018,
        vy: -0.006 - randomFor(step, i + 33) * 0.018,
        life: 1,
        size: 1.8 + amount * 3.4 + randomFor(step, i + 44) * 2.4,
        kind
      });
    }
    while (bursts.length > 130) bursts.shift();
  };

  const triggerKick = (time, velocity, step) => {
    const t = Math.max(time, now() + 0.004);
    const stopAt = t + 0.38;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const shaper = audio.createWaveShaper();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    shaper.curve = makeDriveCurve(0.18 + state.club * 0.42);
    shaper.oversample = '2x';
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime((0.23 + state.club * 0.1) * velocity, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    osc.connect(shaper);
    shaper.connect(amp);
    amp.connect(dry);
    osc.start(t);
    osc.stop(stopAt + 0.03);
    remember(osc, amp, shaper);
    forgetLater(stopAt + 0.06, osc, amp, shaper);
    spawnBurst('kick', step, velocity);
  };

  const triggerDhol = (time, tone, velocity, step) => {
    const t = Math.max(time, now() + 0.004);
    const stopAt = t + 0.28 + state.dhol * 0.12;
    const body = audio.createOscillator();
    const slap = audio.createBufferSource();
    const bodyGain = audio.createGain();
    const slapGain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();

    body.type = 'triangle';
    body.frequency.setValueAtTime(tone, t);
    body.frequency.exponentialRampToValueAtTime(tone * 0.58, t + 0.16);
    slap.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1250 + state.dhol * 1800 + velocity * 450, t);
    filter.Q.setValueAtTime(4 + state.dhol * 8, t);
    pan.pan.setValueAtTime((randomFor(step, 19) - 0.5) * 0.72, t);

    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.18 * state.dhol * velocity, t + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    slapGain.gain.setValueAtTime(0.0001, t);
    slapGain.gain.exponentialRampToValueAtTime(0.15 * state.dhol * velocity, t + 0.003);
    slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    body.connect(bodyGain);
    slap.connect(filter);
    filter.connect(slapGain);
    bodyGain.connect(pan);
    slapGain.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    body.start(t);
    slap.start(t);
    body.stop(stopAt + 0.04);
    slap.stop(t + 0.08);
    remember(body, slap, bodyGain, slapGain, filter, pan);
    forgetLater(stopAt + 0.08, body, slap, bodyGain, slapGain, filter, pan);
    spawnBurst('dhol', step, velocity);
  };

  const triggerTumbi = (midi, time, velocity, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + 0.22 + state.tumbi * 0.08;
    const osc = audio.createOscillator();
    const pluck = audio.createBufferSource();
    const pluckGain = audio.createGain();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();

    osc.type = 'square';
    osc.frequency.setValueAtTime(freq * 1.012, t);
    osc.detune.setValueAtTime(-9 + randomFor(step, 31) * 18, t);
    pluck.buffer = noiseBuffer;
    pluckGain.gain.setValueAtTime(0.025 * state.tumbi, t);
    pluckGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400 + state.tumbi * 2700, t);
    filter.frequency.exponentialRampToValueAtTime(760 + state.tumbi * 1600, stopAt);
    filter.Q.setValueAtTime(7 + state.tumbi * 9, t);
    pan.pan.setValueAtTime((randomFor(step, 32) - 0.5) * 0.9, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.12 * state.tumbi * velocity, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    osc.connect(filter);
    pluck.connect(pluckGain);
    pluckGain.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    osc.start(t);
    pluck.start(t);
    osc.stop(stopAt + 0.03);
    pluck.stop(t + 0.04);
    remember(osc, pluck, pluckGain, amp, filter, pan);
    forgetLater(stopAt + 0.07, osc, pluck, pluckGain, amp, filter, pan);
    spawnBurst('tumbi', step, velocity);
  };

  const triggerBass = (midi, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration;
    const osc = audio.createOscillator();
    const sub = audio.createOscillator();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const shaper = audio.createWaveShaper();

    osc.type = 'sawtooth';
    sub.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(240 + state.club * 620, t);
    filter.Q.setValueAtTime(1.8, t);
    shaper.curve = makeDriveCurve(0.1 + state.club * 0.28);
    shaper.oversample = '2x';
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.16 * state.bass, t + 0.018);
    amp.gain.setTargetAtTime(0.0001, t + duration * 0.68, 0.09);

    osc.connect(shaper);
    sub.connect(shaper);
    shaper.connect(filter);
    filter.connect(amp);
    amp.connect(dry);
    osc.start(t);
    sub.start(t);
    osc.stop(stopAt + 0.06);
    sub.stop(stopAt + 0.06);
    remember(osc, sub, amp, filter, shaper);
    forgetLater(stopAt + 0.12, osc, sub, amp, filter, shaper);
    spawnBurst('bass', step, state.bass);
  };

  const triggerBrass = (midi, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration;
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();
    const oscillators = [-8, 0, 7].map((detune) => {
      const osc = audio.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      osc.detune.setValueAtTime(detune + (randomFor(step, detune + 60) - 0.5) * 5, t);
      osc.connect(filter);
      osc.start(t);
      osc.stop(stopAt + 0.06);
      return osc;
    });

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(650 + state.club * 1400, t);
    filter.frequency.exponentialRampToValueAtTime(1600 + state.club * 2200, t + 0.09);
    filter.Q.setValueAtTime(2.6, t);
    pan.pan.setValueAtTime((randomFor(step, 75) - 0.5) * 0.55, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.068 + state.club * 0.06, t + 0.018);
    amp.gain.setTargetAtTime(0.0001, t + duration * 0.55, 0.07);

    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    remember(amp, filter, pan, ...oscillators);
    forgetLater(stopAt + 0.12, amp, filter, pan, ...oscillators);
    spawnBurst('brass', step, state.club);
  };

  const triggerHype = (midi, time, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + 0.18 + state.hype * 0.1;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const vowel = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 1.5, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.06);
    vowel.type = 'bandpass';
    vowel.frequency.setValueAtTime(720 + randomFor(step, 83) * 680 + state.hype * 700, t);
    vowel.Q.setValueAtTime(10, t);
    pan.pan.setValueAtTime(randomFor(step, 84) > 0.5 ? 0.36 : -0.36, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.075 * state.hype, t + 0.018);
    amp.gain.exponentialRampToValueAtTime(0.0001, stopAt);

    osc.connect(vowel);
    vowel.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    osc.start(t);
    osc.stop(stopAt + 0.03);
    remember(osc, amp, vowel, pan);
    forgetLater(stopAt + 0.07, osc, amp, vowel, pan);
    spawnBurst('hype', step, state.hype);
  };

  const tumbiPattern = [24, null, 24, 31, null, 28, 26, null, 24, 31, null, 28, 26, null, 21, 24];
  const bassPattern = [0, 0, 7, 0, 5, 5, 7, 5, 0, 0, 7, 0, -2, -2, 5, -2];
  const brassPattern = [12, null, null, null, 19, null, null, null, 17, null, null, null, 19, null, 22, null];
  const dholPattern = [1, 0.54, 0.76, 0.9, 1, 0.58, 0.82, 0.96, 1, 0.62, 0.78, 0.9, 1, 0.74, 0.86, 1.08];
  const progression = [0, 0, 5, 7, 0, 0, 7, 5];

  const updateFx = (time) => {
    setTarget(send.gain, 0.12 + state.club * 0.34 + state.hype * 0.06, time, 0.04);
    setTarget(delay.delayTime, lastDuration * (1.25 + state.club * 0.65), time, 0.04);
    setTarget(delayFeedback.gain, 0.13 + state.club * 0.26, time, 0.04);
    setTarget(delayFilter.frequency, 2500 + state.tumbi * 2600, time, 0.04);
    setTarget(reverbGain.gain, 0.14 + state.club * 0.28, time, 0.04);
  };

  const handleTick = ({ step, time, duration }) => {
    currentStep = step % 16;
    if (Number.isFinite(duration) && duration > 0) lastDuration = clamp(duration, 0.055, 0.35);
    stepCells.forEach((cell, index) => cell.classList.toggle('on', index === currentStep));
    if (!state.enabled) return;

    const bar = Math.floor(step / 16);
    const root = state.rootMidi + progression[bar % progression.length];
    const t = Math.max(time, now() + 0.004);
    const accent = currentStep % 4 === 0 ? 1 : currentStep % 2 === 0 ? 0.72 : 0.5;
    updateFx(t);

    if ([0, 4, 8, 12].includes(currentStep)) triggerKick(t, 1.0 + state.club * 0.12, step);
    if ([2, 6, 10, 14].includes(currentStep) && state.club > 0.18) triggerKick(t + lastDuration * 0.42, 0.48 + state.club * 0.34, step + 200);
    if ([3, 7, 11, 15].includes(currentStep) && state.club > 0.55) triggerKick(t + lastDuration * 0.76, 0.25 + state.club * 0.26, step + 260);

    const dholVelocity = clamp(dholPattern[currentStep] * (0.78 + state.dhol * 0.42), 0.18, 1.24);
    const dholTone = currentStep % 4 === 0 ? 86 : currentStep % 2 === 0 ? 118 : 168;
    triggerDhol(t + (currentStep % 2 ? lastDuration * 0.045 : 0), dholTone, dholVelocity, step);
    if ([3, 7, 11, 15].includes(currentStep)) {
      triggerDhol(t + lastDuration * 0.48, 184, clamp(0.58 + state.dhol * 0.32, 0.1, 1.12), step + 500);
    }
    if (currentStep === 15) {
      triggerDhol(t + lastDuration * 0.25, 210, 0.72 + state.dhol * 0.26, step + 610);
      triggerDhol(t + lastDuration * 0.68, 152, 0.8 + state.dhol * 0.24, step + 620);
    }

    const tumbiOffset = tumbiPattern[currentStep];
    if (tumbiOffset !== null && randomFor(step, 91) < 0.72 + state.tumbi * 0.28) {
      triggerTumbi(root + tumbiOffset, t + (currentStep % 2 ? lastDuration * 0.05 : 0), clamp(0.58 + accent * 0.34, 0.1, 1), step);
    }

    if (currentStep % 4 === 0 || (state.bass > 0.78 && currentStep % 4 === 2)) {
      triggerBass(root - 24 + bassPattern[currentStep], t, lastDuration * 3.0, step);
    }

    const brassOffset = brassPattern[currentStep];
    if (brassOffset !== null && state.club > 0.18) {
      triggerBrass(root + brassOffset, t + lastDuration * 0.08, lastDuration * 1.15, step);
    }

    if ((currentStep === 7 || currentStep === 15 || (state.hype > 0.75 && currentStep === 3)) && state.hype > 0.08) {
      triggerHype(root + 24 + (currentStep === 15 ? 7 : 0), t + lastDuration * 0.1, step);
    }

    pulse = Math.max(pulse, 0.45 + accent * 0.52);
  };

  const unsubscribeClock = ctx.clock.onTick(handleTick);

  const syncToggle = () => {
    toggle.textContent = state.enabled ? 'ON' : 'OFF';
    toggle.classList.toggle('off', !state.enabled);
  };

  const bindRange = (input, key, parser = Number) => {
    const handler = () => {
      state[key] = parser(input.value);
      updateFx(now());
    };
    input.addEventListener('input', handler);
    return () => input.removeEventListener('input', handler);
  };

  const unbinders = [
    bindRange(rootSlider, 'rootMidi', (value) => Number.parseInt(value, 10)),
    bindRange(dholSlider, 'dhol'),
    bindRange(tumbiSlider, 'tumbi'),
    bindRange(bassSlider, 'bass'),
    bindRange(hypeSlider, 'hype'),
    bindRange(clubSlider, 'club')
  ];

  const toggleHandler = () => {
    state.enabled = !state.enabled;
    pulse = state.enabled ? 1 : 0.18;
    syncToggle();
  };
  toggle.addEventListener('click', toggleHandler);
  syncToggle();

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
  }
  resize();

  const bins = new Uint8Array(analyser.frequencyBinCount);
  const draw = () => {
    resize();
    const width = canvas.width;
    const height = canvas.height;
    view.clearRect(0, 0, width, height);
    analyser.getByteFrequencyData(bins);

    const grad = view.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, '#1a1020');
    grad.addColorStop(0.5, '#151a25');
    grad.addColorStop(1, '#27140f');
    view.fillStyle = grad;
    view.fillRect(0, 0, width, height);

    const centerX = width * 0.5;
    const centerY = height * 0.48;
    const rings = 5;
    for (let i = rings; i >= 1; i -= 1) {
      const radius = (Math.min(width, height) * 0.11 * i) * (1 + pulse * 0.08);
      view.strokeStyle = i % 2
        ? `rgba(255, 209, 102, ${0.12 + pulse * 0.04})`
        : `rgba(255, 0, 110, ${0.1 + pulse * 0.04})`;
      view.lineWidth = Math.max(1, width * 0.006);
      view.beginPath();
      view.arc(centerX, centerY, radius, 0, Math.PI * 2);
      view.stroke();
    }

    const bars = 40;
    const barWidth = width / bars;
    for (let i = 0; i < bars; i += 1) {
      const value = bins[i * 2] / 255;
      const h = value * height * 0.42;
      const hueGold = i % 4 === 0;
      view.fillStyle = hueGold ? 'rgba(255, 209, 102, 0.58)' : 'rgba(86, 207, 225, 0.44)';
      view.fillRect(i * barWidth + 1, height - h - 17, Math.max(1, barWidth - 3), h);
    }

    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const burst = bursts[i];
      burst.life -= 0.024;
      burst.x += burst.vx;
      burst.y += burst.vy;
      burst.vy += 0.0008;
      if (burst.life <= 0) {
        bursts.splice(i, 1);
        continue;
      }
      const alpha = clamp(burst.life, 0, 1);
      const x = burst.x * width;
      const y = burst.y * height;
      view.fillStyle = burst.kind === 'hype'
        ? `rgba(255, 0, 110, ${alpha})`
        : burst.kind === 'tumbi'
          ? `rgba(255, 209, 102, ${alpha})`
          : `rgba(86, 207, 225, ${alpha})`;
      view.beginPath();
      view.arc(x, y, burst.size * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      view.fill();
    }

    view.fillStyle = 'rgba(255, 247, 230, 0.88)';
    view.font = `${Math.max(10, Math.floor(width * 0.032))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    view.fillText(`step ${String(currentStep + 1).padStart(2, '0')}  DHOL:${Math.round(state.dhol * 100)}  CLUB:${Math.round(state.club * 100)}`, 12, 22);
    pulse *= 0.9;
  };

  return {
    update() {
      draw();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      unsubscribeClock?.();
      toggle.removeEventListener('click', toggleHandler);
      unbinders.forEach((unbind) => unbind());
      if (resizeObserver) resizeObserver.disconnect();
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      activeNodes.forEach((node) => {
        try {
          if (typeof node.stop === 'function') node.stop();
        } catch (_) {}
        try {
          if (typeof node.disconnect === 'function') node.disconnect();
        } catch (_) {}
      });
      activeNodes.clear();
      try { output.disconnect(); } catch (_) {}
      try { dry.disconnect(); } catch (_) {}
      try { send.disconnect(); } catch (_) {}
      try { delay.disconnect(); } catch (_) {}
      try { delayFeedback.disconnect(); } catch (_) {}
      try { delayFilter.disconnect(); } catch (_) {}
      try { convolver.disconnect(); } catch (_) {}
      try { reverbGain.disconnect(); } catch (_) {}
      try { analyser.disconnect(); } catch (_) {}
      try { limiter.disconnect(); } catch (_) {}
    }
  };
}
