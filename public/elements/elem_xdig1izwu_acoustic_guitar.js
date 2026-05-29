const STATE_VERSION = 'xdig-acoustic-guitar-v1';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export default function setup(ctx, prevState) {
  const elementId = ctx.elementId || 'elem_xdig1izwu';
  const busKey = `acoustic-guitar:${elementId}:state`;
  const matchesVersion = prevState?.stateVersion === STATE_VERSION;

  const keys = [
    ['C', 60], ['D', 62], ['E', 64], ['F', 65], ['G', 67], ['A', 69], ['Bb', 70]
  ];

  const state = {
    stateVersion: STATE_VERSION,
    enabled: typeof prevState?.enabled === 'boolean' ? prevState.enabled : true,
    keyMidi: matchesVersion && Number.isFinite(prevState?.keyMidi) ? clamp(Math.round(prevState.keyMidi), 60, 70) : 64,
    gain: matchesVersion && Number.isFinite(prevState?.gain) ? clamp(prevState.gain, 0, 1) : 0.58,
    warmth: matchesVersion && Number.isFinite(prevState?.warmth) ? clamp(prevState.warmth, 0, 1) : 0.62,
    pluck: matchesVersion && Number.isFinite(prevState?.pluck) ? clamp(prevState.pluck, 0, 1) : 0.5,
    room: matchesVersion && Number.isFinite(prevState?.room) ? clamp(prevState.room, 0, 1) : 0.46,
    motion: matchesVersion && Number.isFinite(prevState?.motion) ? clamp(prevState.motion, 0, 1) : 0.55
  };

  const audio = ctx.audioCtx;
  const now = () => audio.currentTime;
  const rootMidi = () => state.keyMidi - 12;

  const master = audio.createGain();
  const dry = audio.createGain();
  const bodyFilter = audio.createBiquadFilter();
  const delay = audio.createDelay(1.2);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const delayGain = audio.createGain();
  const convolver = audio.createConvolver();
  const reverbGain = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const analyser = audio.createAnalyser();

  master.gain.setValueAtTime(state.enabled ? state.gain : 0, now());
  dry.gain.setValueAtTime(0.9, now());
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.setValueAtTime(2900, now());
  bodyFilter.Q.setValueAtTime(1, now());
  delay.delayTime.setValueAtTime(0.28, now());
  feedback.gain.setValueAtTime(0.16, now());
  delayTone.type = 'lowpass';
  delayTone.frequency.setValueAtTime(3200, now());
  delayGain.gain.setValueAtTime(0.1, now());
  reverbGain.gain.setValueAtTime(0.24, now());
  compressor.threshold.setValueAtTime(-20, now());
  compressor.knee.setValueAtTime(18, now());
  compressor.ratio.setValueAtTime(3, now());
  compressor.attack.setValueAtTime(0.006, now());
  compressor.release.setValueAtTime(0.22, now());
  analyser.fftSize = 256;

  const makeImpulse = () => {
    const length = Math.floor(audio.sampleRate * 1.75);
    const impulse = audio.createBuffer(2, length, audio.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.4);
        data[i] = (Math.random() * 2 - 1) * fade * 0.32;
      }
    }
    return impulse;
  };

  const makeNoise = () => {
    const length = Math.floor(audio.sampleRate * 0.06);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const fade = Math.pow(1 - i / length, 4.5);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    return buffer;
  };

  convolver.buffer = makeImpulse();
  const pluckNoise = makeNoise();

  dry.connect(bodyFilter);
  bodyFilter.connect(master);
  bodyFilter.connect(delay);
  bodyFilter.connect(convolver);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(delayGain);
  delayGain.connect(master);
  convolver.connect(reverbGain);
  reverbGain.connect(master);
  master.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.audioOut);

  const activeNodes = new Set();
  const timers = new Set();
  let currentStep = -1;
  let pulse = 0;
  let phase = 0;
  let applyingRemote = false;

  const chords = [
    [0, 4, 7, 12, 16],
    [7, 11, 14, 19, 23],
    [9, 12, 16, 21, 24],
    [5, 9, 12, 17, 21]
  ];
  const arp = [0, 2, 4, 1, 3, 2, 4, 0];

  const remember = (...nodes) => nodes.forEach((node) => activeNodes.add(node));

  const cleanupLater = (time, ...nodes) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (error) {}
        activeNodes.delete(node);
      });
    }, Math.max(120, (time - now()) * 1000 + 160));
    timers.add(timer);
  };

  const setParam = (param, value, time = now(), smoothing = 0.04) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const updateFx = () => {
    const t = now();
    setParam(master.gain, state.enabled ? state.gain : 0, t, 0.018);
    setParam(bodyFilter.frequency, 950 + (1 - state.warmth) * 2100 + state.pluck * 3100, t, 0.06);
    setParam(bodyFilter.Q, 0.75 + state.warmth * 2.2, t, 0.06);
    setParam(feedback.gain, 0.06 + state.room * 0.24, t, 0.06);
    setParam(delayGain.gain, 0.035 + state.motion * 0.15, t, 0.06);
    setParam(delayTone.frequency, 1200 + state.pluck * 4500, t, 0.06);
    setParam(reverbGain.gain, 0.08 + state.room * 0.36, t, 0.06);
  };

  const playString = (midi, velocity, time, length, panValue = 0) => {
    if (!state.enabled) return;
    const t = Math.max(time, now() + 0.003);
    const freq = midiToFreq(midi);
    const stopAt = t + length + 0.55;

    const noise = audio.createBufferSource();
    const noiseGain = audio.createGain();
    const noiseFilter = audio.createBiquadFilter();
    const osc = audio.createOscillator();
    const harmonic = audio.createOscillator();
    const oscGain = audio.createGain();
    const harmonicGain = audio.createGain();
    const voice = audio.createGain();
    const stringFilter = audio.createBiquadFilter();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    noise.buffer = pluckNoise;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(600 + state.pluck * 4200, t);
    noiseFilter.Q.setValueAtTime(1.7 + state.pluck * 2, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime((0.045 + state.pluck * 0.07) * velocity, t + 0.004);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    osc.type = 'triangle';
    harmonic.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    harmonic.frequency.setValueAtTime(freq * 2.004, t);
    osc.detune.setValueAtTime(-2.5, t);
    harmonic.detune.setValueAtTime(2.5, t);

    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(0.17 * velocity, t + 0.012);
    oscGain.gain.exponentialRampToValueAtTime(0.076 * velocity, t + 0.16);
    oscGain.gain.setTargetAtTime(0.0001, t + length, 0.17 + state.warmth * 0.24);
    harmonicGain.gain.setValueAtTime(0.0001, t);
    harmonicGain.gain.exponentialRampToValueAtTime((0.026 + state.pluck * 0.04) * velocity, t + 0.018);
    harmonicGain.gain.setTargetAtTime(0.0001, t + length * 0.65, 0.12);

    stringFilter.type = 'lowpass';
    stringFilter.frequency.setValueAtTime(1000 + state.pluck * 5000 + velocity * 900, t);
    stringFilter.frequency.exponentialRampToValueAtTime(620 + state.warmth * 1400 + state.pluck * 1200, t + length);
    stringFilter.Q.setValueAtTime(0.8 + state.warmth * 2.1, t);
    voice.gain.setValueAtTime(0.9, t);
    if (pan) pan.pan.setValueAtTime(panValue, t);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(voice);
    osc.connect(oscGain);
    harmonic.connect(harmonicGain);
    oscGain.connect(voice);
    harmonicGain.connect(voice);
    voice.connect(stringFilter);
    if (pan) {
      stringFilter.connect(pan);
      pan.connect(dry);
    } else {
      stringFilter.connect(dry);
    }

    noise.start(t);
    noise.stop(t + 0.06);
    osc.start(t);
    harmonic.start(t);
    osc.stop(stopAt);
    harmonic.stop(stopAt);

    pulse = Math.max(pulse, velocity);
    remember(noise, noiseGain, noiseFilter, osc, harmonic, oscGain, harmonicGain, voice, stringFilter, ...(pan ? [pan] : []));
    cleanupLater(stopAt, noise, noiseGain, noiseFilter, osc, harmonic, oscGain, harmonicGain, voice, stringFilter, ...(pan ? [pan] : []));
  };

  const playStrum = (time, duration, step) => {
    const chord = chords[Math.floor((step % 16) / 4)];
    chord.forEach((offset, index) => {
      const low = index === 0 ? -12 : 0;
      const strumDelay = index * (0.018 + state.motion * 0.018);
      playString(rootMidi() + offset + low, 0.52 + index * 0.045, time + strumDelay, duration * (3.4 + state.warmth * 4.4), -0.34 + index * 0.17);
    });
  };

  const playArp = (time, duration, step) => {
    if (state.motion < 0.05) return;
    const chord = chords[Math.floor((step % 16) / 4)];
    const index = arp[step % arp.length] % chord.length;
    const octave = step % 8 >= 4 ? 12 : 0;
    playString(rootMidi() + chord[index] + octave, 0.24 + state.motion * 0.28, time + duration * 0.06, duration * (1.15 + state.warmth * 1.6), -0.24 + index * 0.12);
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .guitar {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 230px;
        display: grid;
        grid-template-rows: auto 70px auto 1fr;
        gap: 9px;
        padding: 10px;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(8, 9, 12, 0.98), rgba(18, 21, 18, 0.98) 52%, rgba(24, 18, 10, 0.98)),
          repeating-linear-gradient(0deg, rgba(252, 211, 77, 0.055) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(252, 211, 77, 0.58);
        border-radius: 8px;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
        color: #fde68a;
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
      button, input, select { font: inherit; }
      .toggle {
        height: 28px;
        min-width: 48px;
        padding: 0 9px;
        border: 1px solid rgba(252, 211, 77, 0.72);
        border-radius: 5px;
        color: #1c1917;
        background: #fde68a;
        cursor: pointer;
      }
      .toggle.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.82);
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
        background: #040609;
        overflow: hidden;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 2px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        height: 14px;
        accent-color: #fcd34d;
      }
      .strings {
        display: grid;
        gap: 5px;
        align-content: center;
        min-height: 38px;
      }
      .string {
        height: 2px;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba(148, 163, 184, 0.18), rgba(253, 230, 138, 0.86), rgba(148, 163, 184, 0.18));
        box-shadow: 0 0 8px rgba(252, 211, 77, 0.22);
      }
      .string.active {
        background: linear-gradient(90deg, rgba(45, 212, 191, 0.2), #fef3c7, rgba(45, 212, 191, 0.2));
        box-shadow: 0 0 14px rgba(252, 211, 77, 0.65);
      }
    </style>
    <div class="guitar">
      <div class="top">
        <div>
          <h2>Acoustic Guitar</h2>
          <div class="tag">warm strums / fingerpicked motion</div>
        </div>
        <select id="key" title="key"></select>
        <button class="toggle" id="enabled" type="button"></button>
      </div>
      <div class="scope"><canvas id="scope" width="340" height="70"></canvas></div>
      <div class="controls">
        <label>gain <input id="gain" type="range" min="0" max="1" step="0.01"></label>
        <label>warm <input id="warmth" type="range" min="0" max="1" step="0.01"></label>
        <label>pluck <input id="pluck" type="range" min="0" max="1" step="0.01"></label>
        <label>room <input id="room" type="range" min="0" max="1" step="0.01"></label>
        <label>move <input id="motion" type="range" min="0" max="1" step="0.01"></label>
      </div>
      <div class="strings" id="strings"></div>
    </div>
  `;

  const keySelect = ctx.domRoot.querySelector('#key');
  const enabledButton = ctx.domRoot.querySelector('#enabled');
  const canvas = ctx.domRoot.querySelector('#scope');
  const canvasCtx = canvas.getContext('2d');
  const stringsEl = ctx.domRoot.querySelector('#strings');
  const inputs = {
    gain: ctx.domRoot.querySelector('#gain'),
    warmth: ctx.domRoot.querySelector('#warmth'),
    pluck: ctx.domRoot.querySelector('#pluck'),
    room: ctx.domRoot.querySelector('#room'),
    motion: ctx.domRoot.querySelector('#motion')
  };

  keySelect.innerHTML = keys.map(([name, midi]) => `<option value="${midi}">${name}</option>`).join('');
  const stringNodes = Array.from({ length: 6 }, () => {
    const node = document.createElement('div');
    node.className = 'string';
    stringsEl.appendChild(node);
    return node;
  });

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'mute';
    enabledButton.classList.toggle('off', !state.enabled);
    keySelect.value = String(state.keyMidi);
    Object.entries(inputs).forEach(([key, input]) => {
      input.value = String(state[key]);
    });
    stringNodes.forEach((node, index) => {
      node.classList.toggle('active', (currentStep + index) % 6 < 2 && pulse > 0.08);
    });
  };

  const publishState = () => {
    if (applyingRemote) return;
    ctx.bus.pubGlobal(busKey, {
      enabled: state.enabled,
      keyMidi: state.keyMidi,
      gain: state.gain,
      warmth: state.warmth,
      pluck: state.pluck,
      room: state.room,
      motion: state.motion
    });
  };

  enabledButton.addEventListener('click', () => {
    state.enabled = !state.enabled;
    updateFx();
    render();
    publishState();
  });

  keySelect.addEventListener('change', () => {
    state.keyMidi = Number(keySelect.value);
    render();
    publishState();
  });

  Object.entries(inputs).forEach(([key, input]) => {
    input.addEventListener('input', () => {
      state[key] = clamp(Number(input.value), 0, 1);
      updateFx();
      publishState();
    });
  });

  const unsubscribeRemote = ctx.bus.subGlobal(busKey, (value) => {
    if (!value || typeof value !== 'object') return;
    applyingRemote = true;
    if (typeof value.enabled === 'boolean') state.enabled = value.enabled;
    if (Number.isFinite(value.keyMidi)) state.keyMidi = clamp(Math.round(value.keyMidi), 60, 70);
    ['gain', 'warmth', 'pluck', 'room', 'motion'].forEach((key) => {
      if (Number.isFinite(value[key])) state[key] = clamp(Number(value[key]), 0, 1);
    });
    updateFx();
    render();
    applyingRemote = false;
  });

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    currentStep = step % 16;
    delay.delayTime.setTargetAtTime(duration * (1.35 + state.room * 0.8), now(), 0.04);
    if (state.enabled && currentStep % 4 === 0) playStrum(time, duration, currentStep);
    if (state.enabled && (currentStep % 2 === 1 || state.motion > 0.62)) playArp(time, duration, currentStep);
    render();
  });

  const timeData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const drawScope = () => {
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);
    pulse *= 0.9;
    phase += 0.014 + pulse * 0.04;

    let mid = 0;
    for (let i = 8; i < 48; i += 1) mid += freqData[i] / 255;
    mid /= 40;

    const w = canvas.width;
    const h = canvas.height;
    const bg = canvasCtx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, `hsl(165, 44%, ${6 + mid * 9}%)`);
    bg.addColorStop(0.54, `hsl(39, 68%, ${7 + pulse * 9}%)`);
    bg.addColorStop(1, `hsl(220, 44%, ${5 + state.room * 8}%)`);
    canvasCtx.fillStyle = bg;
    canvasCtx.fillRect(0, 0, w, h);

    canvasCtx.globalAlpha = 0.25;
    canvasCtx.strokeStyle = '#94a3b8';
    for (let y = 12; y < h; y += 10) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(0, y + Math.sin(phase + y) * pulse * 3);
      canvasCtx.lineTo(w, y + Math.cos(phase + y) * pulse * 3);
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;

    canvasCtx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 30; i += 1) {
      const magnitude = freqData[i + 3] / 255;
      const x = i / 29 * w;
      const barH = magnitude * h * 0.68;
      canvasCtx.fillStyle = `hsla(${42 + i * 4}, 92%, ${58 + magnitude * 20}%, ${0.1 + magnitude * 0.42})`;
      canvasCtx.fillRect(x, h - barH, Math.max(4, w / 42), barH);
    }

    canvasCtx.strokeStyle = `rgba(254, 243, 199, ${0.54 + mid * 0.34})`;
    canvasCtx.lineWidth = 1.3 + mid * 2.2;
    canvasCtx.beginPath();
    for (let i = 0; i < timeData.length; i += 1) {
      const x = i / (timeData.length - 1) * w;
      const y = h * 0.5 + (timeData[i] / 255 - 0.5) * h * (0.72 + pulse * 0.4);
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
    }
    canvasCtx.stroke();
    canvasCtx.globalCompositeOperation = 'source-over';

    const dotX = (currentStep % 16) / 15 * (w - 18) + 9;
    canvasCtx.fillStyle = state.enabled ? '#fcd34d' : '#64748b';
    canvasCtx.beginPath();
    canvasCtx.arc(dotX, 9 + pulse * 4, 3.2 + pulse * 2.3, 0, Math.PI * 2);
    canvasCtx.fill();
  };

  updateFx();
  render();

  return {
    update() {
      drawScope();
      render();
    },
    getState() {
      return {
        stateVersion: STATE_VERSION,
        enabled: state.enabled,
        keyMidi: state.keyMidi,
        gain: state.gain,
        warmth: state.warmth,
        pluck: state.pluck,
        room: state.room,
        motion: state.motion
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
      [master, dry, bodyFilter, delay, feedback, delayTone, delayGain, convolver, reverbGain, compressor, analyser].forEach((node) => {
        try { node.disconnect(); } catch (error) {}
      });
    }
  };
}
