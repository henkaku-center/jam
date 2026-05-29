// Metallic country loop: banjo rolls, slide-steel bends, walking bass,
// and inharmonic anvil hits scheduled from the shared Jam clock.
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const now = () => audio.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 127.113 + salt * 419.77) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const state = {
    enabled: prevState?.enabled ?? true,
    rootMidi: finite(prevState?.rootMidi, 43),
    twang: finite(prevState?.twang, 0.72),
    metal: finite(prevState?.metal, 0.64),
    dust: finite(prevState?.dust, 0.38),
    swing: finite(prevState?.swing, 0.54),
    room: finite(prevState?.room, 0.44),
    midiDevice: prevState?.midiDevice ?? 'waiting'
  };

  const midi = {
    device: state.midiDevice,
    cc: null,
    value: 0,
    active: false
  };

  dom.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto 1fr auto auto;
        gap: 8px;
        overflow: hidden;
        background: #11100d;
        color: #f7f2e8;
        border: 1px solid rgba(247, 242, 232, 0.18);
        font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
      }
      h1 {
        margin: 0;
        color: #f3d77a;
        font: 700 13px/1.1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      button {
        width: 34px;
        height: 25px;
        border: 1px solid #d9a441;
        border-radius: 4px;
        background: #c47f22;
        color: #130d08;
        cursor: pointer;
        font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
      }
      button.off {
        background: #211b16;
        color: #f7f2e8;
        border-color: rgba(247, 242, 232, 0.28);
      }
      .stage {
        position: relative;
        min-height: 0;
        border: 1px solid rgba(247, 242, 232, 0.16);
        border-radius: 6px;
        overflow: hidden;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.06), transparent 38%),
          radial-gradient(circle at 28% 22%, rgba(243,215,122,0.14), transparent 32%),
          linear-gradient(135deg, #171411 0%, #2b2118 46%, #1b1b1d 100%);
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .meter {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 8px;
        height: 5px;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        gap: 3px;
      }
      .meter span {
        display: block;
        min-width: 0;
        border-radius: 2px;
        background: rgba(247, 242, 232, 0.18);
      }
      .meter span.on {
        background: #e8c457;
        box-shadow: 0 0 8px rgba(232, 196, 87, 0.72);
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 7px;
      }
      .midi {
        min-width: 0;
        color: #a9c8d3;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .midi.active {
        color: #bde7c9;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 3px;
        color: #d9cfbd;
        white-space: nowrap;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #d9a441;
      }
      .readout {
        overflow: hidden;
        text-overflow: ellipsis;
        color: #a9c8d3;
      }
    </style>
    <div class="root">
      <div class="top">
        <h1>METAL COUNTRY</h1>
        <button id="toggle" title="Toggle sound">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="stage">
        <canvas id="scope"></canvas>
        <div class="meter">${Array.from({ length: 16 }, () => '<span></span>').join('')}</div>
      </div>
      <div class="midi" id="midiStatus">MIDI: waiting for controller</div>
      <div class="controls">
        <label>root <input id="root" type="range" min="36" max="55" step="1" value="${state.rootMidi}"></label>
        <label>twang <input id="twang" type="range" min="0" max="1" step="0.001" value="${state.twang}"></label>
        <label>metal <input id="metal" type="range" min="0" max="1" step="0.001" value="${state.metal}"></label>
        <label>dust <input id="dust" type="range" min="0" max="1" step="0.001" value="${state.dust}"></label>
        <label>swing <input id="swing" type="range" min="0" max="1" step="0.001" value="${state.swing}"></label>
      </div>
    </div>
  `;

  const canvas = dom.querySelector('#scope');
  const view = canvas.getContext('2d');
  const toggle = dom.querySelector('#toggle');
  const rootSlider = dom.querySelector('#root');
  const twangSlider = dom.querySelector('#twang');
  const metalSlider = dom.querySelector('#metal');
  const dustSlider = dom.querySelector('#dust');
  const swingSlider = dom.querySelector('#swing');
  const midiStatus = dom.querySelector('#midiStatus');
  const meterCells = [...dom.querySelectorAll('.meter span')];

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

  output.gain.value = 0.72;
  dry.gain.value = 0.86;
  send.gain.value = 0.32;
  delay.delayTime.value = 0.19;
  delayFeedback.gain.value = 0.24;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 3600;
  reverbGain.gain.value = 0.22 + state.room * 0.2;
  analyser.fftSize = 256;
  limiter.threshold.value = -16;
  limiter.knee.value = 16;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.16;

  const makeImpulse = () => {
    const length = Math.floor(audio.sampleRate * 1.15);
    const buffer = audio.createBuffer(2, length, audio.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.2);
        const grit = Math.sin(i * 0.037) * 0.18 + (Math.random() * 2 - 1) * 0.82;
        data[i] = grit * fade * 0.34;
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
  const sparks = [];
  let currentStep = -1;
  let lastDuration = 0.125;
  let pulse = 0;
  let resizeObserver = null;

  const remember = (...nodes) => {
    nodes.forEach((node) => activeNodes.add(node));
  };

  const forgetLater = (time, ...nodes) => {
    const id = setTimeout(() => {
      timers.delete(id);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
        activeNodes.delete(node);
      });
    }, Math.max(80, (time - now()) * 1000 + 160));
    timers.add(id);
  };

  const setTarget = (param, value, time = now(), smoothing = 0.025) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const syncMidiStatus = () => {
    const ccText = midi.cc === null ? 'no CC yet' : `CC${midi.cc} ${Math.round(midi.value * 127)}`;
    midiStatus.textContent = `MIDI: ${midi.device || 'unknown'} | ${ccText}`;
    midiStatus.classList.toggle('active', midi.active);
  };

  const setControl = (key, input, value) => {
    const next = clamp(Number(value), 0, 1);
    state[key] = next;
    input.value = next.toFixed(3);
  };

  const noiseBuffer = (() => {
    const length = Math.floor(audio.sampleRate * 0.35);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  })();

  const makeDriveCurve = (amount) => {
    const samples = 1024;
    const curve = new Float32Array(samples);
    const k = 1 + amount * 42;
    for (let i = 0; i < samples; i += 1) {
      const x = i * 2 / (samples - 1) - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return curve;
  };

  const spawnSpark = (kind, step, strength = 1) => {
    const count = kind === 'anvil' ? 10 : kind === 'steel' ? 7 : 4;
    for (let i = 0; i < count; i += 1) {
      sparks.push({
        x: 0.18 + randomFor(step, i + count) * 0.64,
        y: 0.18 + randomFor(step, i + 42) * 0.52,
        vx: (randomFor(step, i + 81) - 0.5) * (0.018 + strength * 0.022),
        vy: -0.006 - randomFor(step, i + 99) * 0.018,
        life: 1,
        size: 1.6 + randomFor(step, i + 14) * 3.2 + strength * 1.8,
        kind
      });
    }
    while (sparks.length > 100) sparks.shift();
  };

  const triggerBanjo = (midi, velocity, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration * (1.15 + state.dust * 0.7);
    const body = audio.createOscillator();
    const bright = audio.createOscillator();
    const noise = audio.createBufferSource();
    const noiseGain = audio.createGain();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const notch = audio.createBiquadFilter();
    const shaper = audio.createWaveShaper();
    const pan = audio.createStereoPanner();

    body.type = 'triangle';
    bright.type = 'square';
    noise.buffer = noiseBuffer;
    body.frequency.setValueAtTime(freq, t);
    bright.frequency.setValueAtTime(freq * 2.01, t);
    bright.detune.setValueAtTime((randomFor(step, 7) - 0.5) * 8, t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1150 + state.twang * 2600 + velocity * 900, t);
    filter.frequency.exponentialRampToValueAtTime(680 + state.twang * 1500, stopAt);
    filter.Q.setValueAtTime(4.5 + state.twang * 10, t);
    notch.type = 'notch';
    notch.frequency.setValueAtTime(380 + state.metal * 520, t);
    notch.Q.setValueAtTime(4, t);
    shaper.curve = makeDriveCurve(0.08 + state.metal * 0.34);
    shaper.oversample = '2x';
    pan.pan.setValueAtTime((randomFor(step, 11) - 0.5) * 0.78, t);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.18 * velocity, t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.038 * velocity, t + 0.09);
    amp.gain.setTargetAtTime(0.0001, t + duration * 0.72, 0.05 + state.dust * 0.06);
    noiseGain.gain.setValueAtTime(0.02 + state.twang * 0.035, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

    body.connect(shaper);
    bright.connect(shaper);
    noise.connect(noiseGain);
    noiseGain.connect(shaper);
    shaper.connect(notch);
    notch.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(send);

    body.start(t);
    bright.start(t);
    noise.start(t);
    body.stop(stopAt + 0.04);
    bright.stop(stopAt + 0.04);
    noise.stop(t + 0.07);
    remember(body, bright, noise, noiseGain, amp, filter, notch, shaper, pan);
    forgetLater(stopAt + 0.08, body, bright, noise, noiseGain, amp, filter, notch, shaper, pan);
    spawnSpark('banjo', step, velocity);
  };

  const triggerSteel = (midi, time, duration, step, slideFrom = -2) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration * (2.2 + state.room);
    const osc = audio.createOscillator();
    const overtone = audio.createOscillator();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();

    osc.type = 'sawtooth';
    overtone.type = 'sine';
    osc.frequency.setValueAtTime(midiToFreq(midi + slideFrom), t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.16 + state.twang * 0.11);
    overtone.frequency.setValueAtTime(midiToFreq(midi + slideFrom + 12), t);
    overtone.frequency.exponentialRampToValueAtTime(freq * 2.002, t + 0.18 + state.twang * 0.1);
    osc.detune.setValueAtTime(-4, t);
    osc.detune.linearRampToValueAtTime(5 + state.twang * 9, t + 0.28);
    osc.detune.linearRampToValueAtTime(-2, stopAt);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(820 + state.twang * 2200, t);
    filter.frequency.exponentialRampToValueAtTime(1700 + state.twang * 3600, t + 0.2);
    filter.frequency.exponentialRampToValueAtTime(720 + state.dust * 560, stopAt);
    filter.Q.setValueAtTime(5 + state.metal * 5, t);
    pan.pan.setValueAtTime(randomFor(step, 22) > 0.5 ? 0.48 : -0.48, t);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.105 + state.twang * 0.045, t + 0.04);
    amp.gain.setTargetAtTime(0.0001, t + duration * 1.28, 0.28);

    osc.connect(filter);
    overtone.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    osc.start(t);
    overtone.start(t);
    osc.stop(stopAt + 0.08);
    overtone.stop(stopAt + 0.08);
    remember(osc, overtone, amp, filter, pan);
    forgetLater(stopAt + 0.14, osc, overtone, amp, filter, pan);
    spawnSpark('steel', step, 0.85);
  };

  const triggerBass = (midi, time, duration, step) => {
    const t = Math.max(time, now() + 0.004);
    const freq = midiToFreq(midi);
    const stopAt = t + duration * 1.8;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const filter = audio.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 1.018, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.045);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(210 + state.dust * 130 + state.metal * 80, t);
    filter.Q.setValueAtTime(1.2, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.16, t + 0.016);
    amp.gain.exponentialRampToValueAtTime(0.055, t + 0.15);
    amp.gain.setTargetAtTime(0.0001, t + duration * 1.1, 0.08);

    osc.connect(filter);
    filter.connect(amp);
    amp.connect(dry);
    osc.start(t);
    osc.stop(stopAt + 0.05);
    remember(osc, amp, filter);
    forgetLater(stopAt + 0.1, osc, amp, filter);
    spawnSpark('bass', step, 0.55);
  };

  const triggerAnvil = (time, step, accent = 1) => {
    const t = Math.max(time, now() + 0.004);
    const stopAt = t + 0.34 + state.metal * 0.14;
    const hit = audio.createBufferSource();
    const hitGain = audio.createGain();
    const band = audio.createBiquadFilter();
    const ringA = audio.createOscillator();
    const ringB = audio.createOscillator();
    const ringGain = audio.createGain();
    const pan = audio.createStereoPanner();

    hit.buffer = noiseBuffer;
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1850 + state.metal * 3200 + randomFor(step, 33) * 800, t);
    band.Q.setValueAtTime(8 + state.metal * 14, t);
    hitGain.gain.setValueAtTime(0.0001, t);
    hitGain.gain.exponentialRampToValueAtTime((0.075 + state.metal * 0.085) * accent, t + 0.004);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.065);

    ringA.type = 'sine';
    ringB.type = 'triangle';
    ringA.frequency.setValueAtTime(660 + state.metal * 540 + randomFor(step, 37) * 90, t);
    ringB.frequency.setValueAtTime(1327 + state.metal * 850 + randomFor(step, 39) * 140, t);
    ringGain.gain.setValueAtTime(0.0001, t);
    ringGain.gain.exponentialRampToValueAtTime((0.048 + state.metal * 0.074) * accent, t + 0.006);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    pan.pan.setValueAtTime((randomFor(step, 41) - 0.5) * 0.9, t);

    hit.connect(band);
    band.connect(hitGain);
    ringA.connect(ringGain);
    ringB.connect(ringGain);
    hitGain.connect(pan);
    ringGain.connect(pan);
    pan.connect(dry);
    pan.connect(send);
    hit.start(t);
    ringA.start(t);
    ringB.start(t);
    hit.stop(t + 0.09);
    ringA.stop(stopAt + 0.04);
    ringB.stop(stopAt + 0.04);
    remember(hit, hitGain, band, ringA, ringB, ringGain, pan);
    forgetLater(stopAt + 0.08, hit, hitGain, band, ringA, ringB, ringGain, pan);
    spawnSpark('anvil', step, accent);
  };

  const progression = [0, 0, 5, 0, 7, 5, 0, 7];
  const roll = [12, 19, 24, 16, 19, 28, 24, 19, 12, 16, 24, 19, 14, 21, 26, 19];
  const walk = [0, 4, 7, 9, 5, 4, 2, 0, 7, 9, 11, 12, 5, 4, 2, 0];

  const updateFx = (time) => {
    setTarget(send.gain, 0.18 + state.room * 0.28 + state.dust * 0.08, time, 0.04);
    setTarget(delay.delayTime, lastDuration * (1.3 + state.swing * 0.7), time, 0.04);
    setTarget(delayFeedback.gain, 0.16 + state.dust * 0.22, time, 0.04);
    setTarget(delayFilter.frequency, 2200 + state.twang * 2600 - state.dust * 700, time, 0.04);
    setTarget(reverbGain.gain, 0.18 + state.room * 0.25, time, 0.04);
  };

  const handleTick = ({ step, time, duration, bpm }) => {
    currentStep = step % 16;
    if (Number.isFinite(duration) && duration > 0) lastDuration = clamp(duration, 0.055, 0.35);
    meterCells.forEach((cell, index) => cell.classList.toggle('on', index === currentStep));
    if (!state.enabled) return;

    const bar = Math.floor(step / 16);
    const chordRoot = state.rootMidi + progression[bar % progression.length];
    const t = Math.max(time, now() + 0.004);
    const offbeatDelay = currentStep % 2 ? lastDuration * state.swing * 0.24 : 0;
    const accent = currentStep % 4 === 0 ? 1 : currentStep % 2 === 0 ? 0.74 : 0.56;
    const rollNote = chordRoot + roll[currentStep] + (bar % 4 === 3 && currentStep > 9 ? 2 : 0);
    const banjoDuration = lastDuration * (0.62 + state.dust * 0.22);

    updateFx(t);
    triggerBanjo(rollNote, clamp(0.58 + accent * 0.34, 0.15, 1), t + offbeatDelay, banjoDuration, step);

    if (currentStep % 4 === 0) {
      triggerBass(state.rootMidi - 12 + walk[currentStep], t, lastDuration * 3.2, step);
    }
    if (currentStep === 3 || currentStep === 11) {
      triggerAnvil(t + offbeatDelay * 0.4, step, currentStep === 11 ? 0.8 : 1);
    }
    if (currentStep === 7 || currentStep === 15) {
      const steelOffset = currentStep === 15 ? 24 : 16;
      triggerSteel(chordRoot + steelOffset, t + lastDuration * 0.16, lastDuration * (2.4 + state.dust), step, currentStep === 15 ? -4 : -2);
    }
    if (state.metal > 0.72 && currentStep % 8 === 5) {
      triggerAnvil(t + lastDuration * 0.45, step + 1000, 0.55);
    }

    pulse = Math.max(pulse, 0.42 + accent * 0.45);
    if (bpm) dom.host?.style?.setProperty('--jam-bpm', String(bpm));
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
    bindRange(twangSlider, 'twang'),
    bindRange(metalSlider, 'metal'),
    bindRange(dustSlider, 'dust'),
    bindRange(swingSlider, 'swing')
  ];

  const handleMidi = (cc, value) => {
    const v = clamp(Number(value), 0, 1);
    midi.cc = cc;
    midi.value = v;
    midi.active = true;
    if (cc === 11) {
      setControl('metal', metalSlider, 0.24 + v * 0.76);
      setControl('dust', dustSlider, 0.18 + v * 0.5);
    } else if (cc === 1) {
      setControl('twang', twangSlider, 0.28 + v * 0.72);
    } else if (cc === 16) {
      setControl('dust', dustSlider, 0.08 + v * 0.84);
    } else if (cc === 17) {
      setControl('swing', swingSlider, 0.05 + v * 0.88);
    }
    pulse = Math.max(pulse, 0.72);
    updateFx(now());
    syncMidiStatus();
  };

  const midiUnsubscribers = [
    ctx.bus.subGlobal('global:zefiro:device', (value) => {
      midi.device = String(value || 'unknown');
      state.midiDevice = midi.device;
      syncMidiStatus();
    }),
    ctx.bus.subGlobal('global:zefiro:cc11', (value) => handleMidi(11, value)),
    ctx.bus.subGlobal('global:zefiro:cc1', (value) => handleMidi(1, value)),
    ctx.bus.subGlobal('global:zefiro:cc16', (value) => handleMidi(16, value)),
    ctx.bus.subGlobal('global:zefiro:cc17', (value) => handleMidi(17, value))
  ];
  syncMidiStatus();

  const toggleHandler = () => {
    state.enabled = !state.enabled;
    pulse = state.enabled ? 1 : 0.2;
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
    grad.addColorStop(0, '#1a1511');
    grad.addColorStop(0.48, '#2a2118');
    grad.addColorStop(1, '#121417');
    view.fillStyle = grad;
    view.fillRect(0, 0, width, height);

    view.strokeStyle = 'rgba(243, 215, 122, 0.32)';
    view.lineWidth = Math.max(1, width * 0.004);
    for (let stringIndex = 0; stringIndex < 5; stringIndex += 1) {
      const y = height * (0.28 + stringIndex * 0.105);
      view.beginPath();
      for (let x = 0; x <= width; x += 8) {
        const wave = Math.sin(x * 0.028 + stringIndex * 1.2 + now() * (3 + state.twang * 3));
        const amp = pulse * height * (0.006 + stringIndex * 0.0015);
        const yy = y + wave * amp;
        if (x === 0) view.moveTo(x, yy);
        else view.lineTo(x, yy);
      }
      view.stroke();
    }

    const barCount = 32;
    const barWidth = width / barCount;
    for (let i = 0; i < barCount; i += 1) {
      const value = bins[i * 2] / 255;
      const h = value * height * 0.38;
      view.fillStyle = i % 4 === 0 ? 'rgba(169, 200, 211, 0.5)' : 'rgba(232, 196, 87, 0.45)';
      view.fillRect(i * barWidth + 1, height - h - 15, Math.max(1, barWidth - 3), h);
    }

    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= 0.026;
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vy += 0.0009;
      if (spark.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      const alpha = clamp(spark.life, 0, 1);
      const x = spark.x * width;
      const y = spark.y * height;
      view.fillStyle = spark.kind === 'anvil'
        ? `rgba(210, 231, 236, ${alpha})`
        : spark.kind === 'steel'
          ? `rgba(243, 215, 122, ${alpha})`
          : `rgba(196, 127, 34, ${alpha})`;
      view.beginPath();
      view.arc(x, y, spark.size * (window.devicePixelRatio || 1), 0, Math.PI * 2);
      view.fill();
    }

    view.fillStyle = 'rgba(247, 242, 232, 0.86)';
    view.font = `${Math.max(10, Math.floor(width * 0.033))}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    view.fillText(`step ${String(currentStep + 1).padStart(2, '0')}  Grit:${Math.round(state.metal * 100)}  MIDI:${midi.active ? 'on' : 'wait'}`, 12, 22);
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
      midiUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
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
