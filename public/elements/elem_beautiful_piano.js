const STATE_VERSION = 'beautiful-piano-v1';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);

export default function setup(ctx, prevState) {
  const elementId = ctx.elementId || 'elem_beautiful_piano';
  const busKey = `beautiful-piano:${elementId}:state`;
  const matchesVersion = prevState?.stateVersion === STATE_VERSION;
  const keys = [
    ['C', 60],
    ['Db', 61],
    ['D', 62],
    ['Eb', 63],
    ['E', 64],
    ['F', 65],
    ['Gb', 66],
    ['G', 67],
    ['Ab', 68],
    ['A', 69],
    ['Bb', 70],
    ['B', 71]
  ];

  const state = {
    stateVersion: STATE_VERSION,
    enabled: typeof prevState?.enabled === 'boolean' ? prevState.enabled : true,
    keyMidi: matchesVersion && Number.isFinite(prevState?.keyMidi) ? clamp(Math.round(prevState.keyMidi), 60, 71) : 69,
    minor: typeof prevState?.minor === 'boolean' ? prevState.minor : true,
    gain: matchesVersion && Number.isFinite(prevState?.gain) ? clamp(prevState.gain, 0, 1) : 0.58,
    tone: matchesVersion && Number.isFinite(prevState?.tone) ? clamp(prevState.tone, 0, 1) : 0.48,
    sustain: matchesVersion && Number.isFinite(prevState?.sustain) ? clamp(prevState.sustain, 0, 1) : 0.62,
    room: matchesVersion && Number.isFinite(prevState?.room) ? clamp(prevState.room, 0, 1) : 0.54,
    sparkle: matchesVersion && Number.isFinite(prevState?.sparkle) ? clamp(prevState.sparkle, 0, 1) : 0.42,
    motion: matchesVersion && Number.isFinite(prevState?.motion) ? clamp(prevState.motion, 0, 1) : 0.48
  };

  const audio = ctx.audioCtx;
  const now = () => audio.currentTime;
  const rootMidi = () => state.keyMidi - 12;
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  const master = audio.createGain();
  const dry = audio.createGain();
  const reverbSend = audio.createGain();
  const convolver = audio.createConvolver();
  const reverbGain = audio.createGain();
  const delay = audio.createDelay(1.4);
  const delayFeedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const delayGain = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const analyser = audio.createAnalyser();

  master.gain.setValueAtTime(state.enabled ? state.gain : 0, now());
  dry.gain.setValueAtTime(0.84, now());
  reverbGain.gain.setValueAtTime(0.34, now());
  delay.delayTime.setValueAtTime(0.38, now());
  delayFeedback.gain.setValueAtTime(0.18, now());
  delayGain.gain.setValueAtTime(0.11, now());
  delayTone.type = 'lowpass';
  delayTone.frequency.setValueAtTime(3600, now());
  compressor.threshold.setValueAtTime(-22, now());
  compressor.knee.setValueAtTime(22, now());
  compressor.ratio.setValueAtTime(2.8, now());
  compressor.attack.setValueAtTime(0.012, now());
  compressor.release.setValueAtTime(0.28, now());
  analyser.fftSize = 256;

  const makeImpulse = () => {
    const sampleRate = audio.sampleRate;
    const length = Math.floor(sampleRate * 2.5);
    const impulse = audio.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.1);
        data[i] = (Math.random() * 2 - 1) * fade * (channel ? 0.42 : 0.38);
      }
    }
    return impulse;
  };

  const makeHammerNoise = () => {
    const length = Math.floor(audio.sampleRate * 0.09);
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      const fade = Math.pow(1 - i / length, 5);
      data[i] = (Math.random() * 2 - 1) * fade;
    }
    return buffer;
  };

  convolver.buffer = makeImpulse();
  const hammerBuffer = makeHammerNoise();

  dry.connect(master);
  reverbSend.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(master);
  delay.connect(delayTone);
  delayTone.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayTone.connect(delayGain);
  delayGain.connect(master);
  master.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.audioOut);

  const activeNodes = new Set();
  const timers = new Set();
  let currentStep = -1;
  let pulse = 0;
  let visualPhase = 0;
  let applyingRemote = false;

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

  const setParam = (param, value, time = now(), smoothing = 0.035) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const updateFx = () => {
    const t = now();
    setParam(master.gain, state.enabled ? state.gain : 0, t, 0.018);
    setParam(reverbSend.gain, 0.08 + state.room * 0.42, t, 0.04);
    setParam(reverbGain.gain, 0.16 + state.room * 0.38, t, 0.04);
    setParam(delayFeedback.gain, 0.08 + state.room * 0.25, t, 0.04);
    setParam(delayGain.gain, state.motion * 0.18, t, 0.04);
    setParam(delayTone.frequency, 1700 + state.tone * 5200, t, 0.04);
  };

  const chordOffsets = () => state.minor
    ? [
        [0, 3, 7, 12],
        [7, 10, 14, 17],
        [5, 8, 12, 15],
        [3, 7, 10, 15]
      ]
    : [
        [0, 4, 7, 12],
        [7, 11, 14, 19],
        [9, 12, 16, 21],
        [5, 9, 12, 17]
      ];

  const playPianoNote = (midi, velocity, time, length, pan = 0) => {
    if (!state.enabled) return;
    const t = Math.max(time, now() + 0.003);
    const freq = midiToFreq(midi);
    const stopAt = t + length + 0.7;
    const voice = audio.createGain();
    const toneFilter = audio.createBiquadFilter();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const hammer = audio.createBufferSource();
    const hammerGain = audio.createGain();
    const hammerFilter = audio.createBiquadFilter();

    voice.gain.setValueAtTime(0.78, t);
    toneFilter.type = 'lowpass';
    toneFilter.frequency.setValueAtTime(900 + state.tone * 5400 + state.sparkle * 2600, t);
    toneFilter.frequency.exponentialRampToValueAtTime(520 + state.tone * 2600, t + length);
    toneFilter.Q.setValueAtTime(0.7 + state.sparkle * 1.5, t);
    if (panner) panner.pan.setValueAtTime(pan, t);

    hammer.buffer = hammerBuffer;
    hammerFilter.type = 'bandpass';
    hammerFilter.frequency.setValueAtTime(1500 + state.sparkle * 3800, t);
    hammerFilter.Q.setValueAtTime(1.8, t);
    hammerGain.gain.setValueAtTime(0.0001, t);
    hammerGain.gain.exponentialRampToValueAtTime((0.012 + state.sparkle * 0.028) * velocity, t + 0.004);
    hammerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    hammer.connect(hammerFilter);
    hammerFilter.connect(hammerGain);
    hammerGain.connect(voice);
    hammer.start(t);
    hammer.stop(t + 0.09);

    const partials = [
      [1, 1, 0],
      [2.01, 0.34, 0.003],
      [3.02, 0.18, 0.007],
      [4.01, 0.08 + state.sparkle * 0.08, 0.011],
      [5.03, 0.035 + state.sparkle * 0.055, 0.017]
    ];

    const nodes = [voice, toneFilter, hammer, hammerGain, hammerFilter];
    partials.forEach(([ratio, level, detune], index) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = index === 0 && midi < 58 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq * ratio * (1 + detune), t);
      osc.detune.setValueAtTime((index - 2) * (1.5 + state.sparkle * 2.2), t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(level * velocity * 0.17, t + 0.012 + index * 0.004);
      gain.gain.exponentialRampToValueAtTime(level * velocity * 0.08, t + 0.14 + index * 0.04);
      gain.gain.setTargetAtTime(0.0001, t + length * (0.76 + index * 0.08), 0.18 + state.sustain * 0.34);
      osc.connect(gain);
      gain.connect(voice);
      osc.start(t);
      osc.stop(stopAt);
      nodes.push(osc, gain);
    });

    voice.connect(toneFilter);
    if (panner) {
      toneFilter.connect(panner);
      panner.connect(dry);
      panner.connect(reverbSend);
      panner.connect(delay);
      nodes.push(panner);
    } else {
      toneFilter.connect(dry);
      toneFilter.connect(reverbSend);
      toneFilter.connect(delay);
    }

    pulse = Math.max(pulse, velocity);
    remember(...nodes);
    cleanupLater(stopAt, ...nodes);
  };

  const playChord = (time, duration, step) => {
    const chords = chordOffsets();
    const chord = chords[Math.floor((step % 16) / 4)];
    const bass = rootMidi() + chord[0] - 12;
    const length = duration * (4.6 + state.sustain * 8.2);
    playPianoNote(bass, 0.52, time, length, -0.18);
    chord.forEach((offset, index) => {
      playPianoNote(rootMidi() + offset, 0.5 + index * 0.05, time + index * (0.018 + state.motion * 0.018), length, -0.28 + index * 0.18);
    });
  };

  const playMotion = (time, duration, step) => {
    if (state.motion < 0.08) return;
    const chords = chordOffsets();
    const chord = chords[Math.floor((step % 16) / 4)];
    const pickIndex = [0, 2, 1, 3, 2, 1, 3, 0][step % 8] % chord.length;
    const octave = step % 8 >= 4 ? 12 : 0;
    const midi = rootMidi() + chord[pickIndex] + octave;
    playPianoNote(midi, 0.18 + state.motion * 0.34, time + duration * 0.08, duration * (1.2 + state.sustain * 1.8), (pickIndex - 1.5) * 0.18);
    if (state.sparkle > 0.65 && step % 4 === 3) {
      playPianoNote(midi + 12, 0.12 + state.sparkle * 0.18, time + duration * 0.48, duration * 1.2, 0.24);
    }
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .piano {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 230px;
        display: grid;
        grid-template-rows: auto 64px auto 1fr;
        gap: 9px;
        padding: 10px;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(5, 8, 13, 0.98), rgba(14, 17, 23, 0.98) 50%, rgba(18, 23, 20, 0.98)),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.038) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(186, 230, 253, 0.56);
        border-radius: 8px;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: inset 0 0 28px rgba(125, 211, 252, 0.08);
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto auto auto;
        align-items: center;
        gap: 7px;
      }
      h2 {
        margin: 0;
        color: #bae6fd;
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
      select { font: inherit; }
      .toggle,
      .mode {
        height: 28px;
        padding: 0 9px;
        border: 1px solid rgba(186, 230, 253, 0.7);
        border-radius: 5px;
        color: #082f49;
        background: #bae6fd;
        cursor: pointer;
      }
      .toggle.off,
      .mode.off {
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
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px 9px;
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
        accent-color: #7dd3fc;
      }
      .keys {
        position: relative;
        min-height: 42px;
        display: grid;
        grid-template-columns: repeat(14, 1fr);
        gap: 2px;
        align-items: end;
      }
      .key {
        height: 38px;
        border-radius: 3px;
        border: 1px solid rgba(226, 232, 240, 0.34);
        background: linear-gradient(#f8fafc, #cbd5e1);
        opacity: 0.74;
      }
      .key.black {
        height: 25px;
        background: linear-gradient(#111827, #020617);
        border-color: rgba(15, 23, 42, 0.8);
        opacity: 0.9;
      }
      .key.active {
        background: linear-gradient(#bae6fd, #38bdf8);
        box-shadow: 0 0 12px rgba(125, 211, 252, 0.72);
        opacity: 1;
      }
    </style>
    <div class="piano">
      <div class="top">
        <div>
          <h2>Beautiful Piano</h2>
          <div class="tag">felt chords / soft arpeggio / room</div>
        </div>
        <select id="key" title="key"></select>
        <button class="mode" id="mode" type="button"></button>
        <button class="toggle" id="enabled" type="button"></button>
      </div>
      <div class="scope"><canvas id="scope" width="340" height="64"></canvas></div>
      <div class="controls">
        <label>gain <input id="gain" type="range" min="0" max="1" step="0.01"></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"></label>
        <label>sustain <input id="sustain" type="range" min="0" max="1" step="0.01"></label>
        <label>room <input id="room" type="range" min="0" max="1" step="0.01"></label>
        <label>sparkle <input id="sparkle" type="range" min="0" max="1" step="0.01"></label>
        <label>motion <input id="motion" type="range" min="0" max="1" step="0.01"></label>
      </div>
      <div class="keys" id="keys"></div>
    </div>
  `;

  const keySelect = ctx.domRoot.querySelector('#key');
  const modeButton = ctx.domRoot.querySelector('#mode');
  const enabledButton = ctx.domRoot.querySelector('#enabled');
  const keysEl = ctx.domRoot.querySelector('#keys');
  const canvas = ctx.domRoot.querySelector('#scope');
  const canvasCtx = canvas.getContext('2d');
  const inputs = {
    gain: ctx.domRoot.querySelector('#gain'),
    tone: ctx.domRoot.querySelector('#tone'),
    sustain: ctx.domRoot.querySelector('#sustain'),
    room: ctx.domRoot.querySelector('#room'),
    sparkle: ctx.domRoot.querySelector('#sparkle'),
    motion: ctx.domRoot.querySelector('#motion')
  };

  keySelect.innerHTML = keys.map(([name, midi]) => `<option value="${midi}">${name}</option>`).join('');

  const keyNodes = Array.from({ length: 14 }, (_, index) => {
    const note = index % 12;
    const el = document.createElement('div');
    el.className = `key ${[1, 3, 6, 8, 10].includes(note) ? 'black' : ''}`;
    keysEl.appendChild(el);
    return el;
  });

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'mute';
    enabledButton.classList.toggle('off', !state.enabled);
    modeButton.textContent = state.minor ? 'minor' : 'major';
    modeButton.classList.toggle('off', !state.minor);
    keySelect.value = String(state.keyMidi);
    Object.entries(inputs).forEach(([key, input]) => {
      input.value = String(state[key]);
    });
    const chord = chordOffsets()[Math.max(0, Math.floor((currentStep % 16) / 4))] || [];
    keyNodes.forEach((node, index) => {
      const note = (rootMidi() + index) % 12;
      node.classList.toggle('active', chord.some((offset) => (rootMidi() + offset) % 12 === note));
    });
  };

  const publishState = () => {
    if (applyingRemote) return;
    ctx.bus.pubGlobal(busKey, {
      enabled: state.enabled,
      keyMidi: state.keyMidi,
      minor: state.minor,
      gain: state.gain,
      tone: state.tone,
      sustain: state.sustain,
      room: state.room,
      sparkle: state.sparkle,
      motion: state.motion
    });
  };

  enabledButton.addEventListener('click', () => {
    state.enabled = !state.enabled;
    updateFx();
    render();
    publishState();
  });

  modeButton.addEventListener('click', () => {
    state.minor = !state.minor;
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
    if (typeof value.minor === 'boolean') state.minor = value.minor;
    if (Number.isFinite(value.keyMidi)) state.keyMidi = clamp(Math.round(value.keyMidi), 60, 71);
    ['gain', 'tone', 'sustain', 'room', 'sparkle', 'motion'].forEach((key) => {
      if (Number.isFinite(value[key])) state[key] = clamp(Number(value[key]), 0, 1);
    });
    updateFx();
    render();
    applyingRemote = false;
  });

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    currentStep = step % 16;
    const beat = currentStep % 4;
    if (state.enabled && beat === 0) playChord(time, duration, currentStep);
    if (state.enabled && state.motion > 0.05 && (currentStep % 2 === 1 || state.motion > 0.58)) {
      playMotion(time, duration, currentStep);
    }
    render();
  });

  const timeData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  const drawScope = () => {
    analyser.getByteTimeDomainData(timeData);
    analyser.getByteFrequencyData(freqData);
    pulse *= 0.91;
    visualPhase += 0.012 + pulse * 0.036;

    let midEnergy = 0;
    for (let i = 8; i < 42; i += 1) midEnergy += freqData[i] / 255;
    midEnergy /= 34;

    const w = canvas.width;
    const h = canvas.height;
    canvasCtx.clearRect(0, 0, w, h);
    const bg = canvasCtx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, `hsl(205, 66%, ${6 + midEnergy * 10}%)`);
    bg.addColorStop(0.48, `hsl(178, 42%, ${7 + pulse * 8}%)`);
    bg.addColorStop(1, `hsl(52, 42%, ${6 + state.room * 8}%)`);
    canvasCtx.fillStyle = bg;
    canvasCtx.fillRect(0, 0, w, h);

    canvasCtx.globalAlpha = 0.22;
    canvasCtx.strokeStyle = '#94a3b8';
    for (let x = 16; x < w; x += 24) {
      canvasCtx.beginPath();
      canvasCtx.moveTo(x, 0);
      canvasCtx.lineTo(x - 18, h);
      canvasCtx.stroke();
    }
    canvasCtx.globalAlpha = 1;

    canvasCtx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i += 1) {
      const magnitude = freqData[i + 4] / 255;
      const x = 8 + i * (w - 16) / 26;
      const barH = magnitude * h * 0.72;
      canvasCtx.fillStyle = `hsla(${190 + i * 4}, 88%, ${58 + magnitude * 22}%, ${0.12 + magnitude * 0.42})`;
      canvasCtx.fillRect(x, h - barH, Math.max(4, w / 36), barH);
    }

    canvasCtx.strokeStyle = `rgba(186, 230, 253, ${0.55 + midEnergy * 0.35})`;
    canvasCtx.lineWidth = 1.25 + midEnergy * 2.2;
    canvasCtx.beginPath();
    for (let i = 0; i < timeData.length; i += 1) {
      const x = i / (timeData.length - 1) * w;
      const y = h * 0.52 + (timeData[i] / 255 - 0.5) * h * (0.74 + pulse * 0.28);
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
    }
    canvasCtx.stroke();
    canvasCtx.globalCompositeOperation = 'source-over';

    const dotX = (currentStep % 16) / 15 * (w - 18) + 9;
    canvasCtx.fillStyle = state.enabled ? '#bae6fd' : '#64748b';
    canvasCtx.beginPath();
    canvasCtx.arc(dotX, 9 + Math.sin(visualPhase) * 2, 3 + pulse * 2.4, 0, Math.PI * 2);
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
        keyMidi: state.keyMidi,
        minor: state.minor,
        gain: state.gain,
        tone: state.tone,
        sustain: state.sustain,
        room: state.room,
        sparkle: state.sparkle,
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
      [master, dry, reverbSend, convolver, reverbGain, delay, delayFeedback, delayTone, delayGain, compressor, analyser].forEach((node) => {
        try { node.disconnect(); } catch (error) {}
      });
    }
  };
}
