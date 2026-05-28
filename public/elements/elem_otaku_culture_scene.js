const STATE_VERSION = 'otaku-culture-scene-v1';
const IMAGE_URL = '/assets/otaku_culture_neon.png';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.78),
    sparkle: finite(prevState?.sparkle, 0.62),
    bass: finite(prevState?.bass, 0.58),
    nostalgia: finite(prevState?.nostalgia, 0.44),
    energy: finite(prevState?.energy, 0.72)
  };

  const chordRoots = [57, 53, 55, 52];
  const lead = [69, 72, 76, 74, 72, 69, 67, null, 69, 74, 76, 79, 76, 74, 72, null];
  const arp = [0, 7, 12, 16, 12, 7, 4, 7, 0, 7, 12, 19, 16, 12, 7, 4];

  const master = audio.createGain();
  const dry = audio.createGain();
  const delay = audio.createDelay(0.8);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const compressor = audio.createDynamicsCompressor();

  master.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 0.9;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.28;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 4200;
  wet.gain.value = 0.24;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;

  dry.connect(master);
  dry.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let pulse = 0;
  let destroyed = false;

  function makeNoiseBuffer() {
    const length = Math.max(1, Math.floor(audio.sampleRate * 0.45));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  const noiseBuffer = makeNoiseBuffer();

  function track(seconds, ...nodes) {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  }

  function syncAudio() {
    const t = audio.currentTime;
    master.gain.setTargetAtTime(state.running ? state.volume : 0, t, 0.025);
    feedback.gain.setTargetAtTime(0.16 + state.nostalgia * 0.28, t, 0.04);
    wet.gain.setTargetAtTime(0.1 + state.nostalgia * 0.34, t, 0.04);
    delayTone.frequency.setTargetAtTime(2200 + state.sparkle * 5200, t, 0.04);
  }

  function playTone(time, midi, length, velocity, type, destination = dry) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();

    osc.type = type;
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900 + state.sparkle * 4600 + velocity * 1200, t);
    filter.Q.setValueAtTime(1.1 + state.nostalgia * 3.4, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(velocity, t + 0.012);
    gain.gain.setTargetAtTime(0.0001, t + length, 0.05);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    osc.start(t);
    osc.stop(t + length + 0.18);
    track(length + 0.3, osc, filter, gain);
  }

  function playKick(time, velocity) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(128, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.2);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.72 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(gain);
    gain.connect(dry);
    osc.start(t);
    osc.stop(t + 0.36);
    track(0.45, osc, gain);
  }

  function playSnare(time, velocity) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 0.8;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28 * velocity, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    src.start(t);
    src.stop(t + 0.16);
    track(0.22, src, filter, gain);
  }

  function playHat(time, velocity) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    src.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 6400;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08 * velocity, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    src.start(t);
    src.stop(t + 0.07);
    track(0.12, src, filter, gain);
  }

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; }
      .scene {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 360px;
        min-height: 260px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: 8px;
        color: #fff7ed;
        background: #080612;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .art {
        position: absolute;
        inset: 0;
        background-image: url("${IMAGE_URL}");
        background-size: cover;
        background-position: center;
        transform: scale(1.015);
        filter: saturate(1.12) contrast(1.04);
      }
      .veil {
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 46%, rgba(255, 255, 255, 0.04), transparent 36%),
          linear-gradient(180deg, rgba(4, 2, 12, 0.08), rgba(4, 2, 12, 0.42));
        pointer-events: none;
      }
      .hud {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 10px;
        align-items: end;
      }
      .panel {
        min-width: 0;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        background: rgba(5, 6, 18, 0.68);
        backdrop-filter: blur(8px);
      }
      h2 {
        margin: 0 0 6px;
        color: #ffffff;
        font: 800 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 7px;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 3px;
        color: #fef3c7;
        font-size: 9px;
      }
      input {
        width: 100%;
        min-width: 0;
        accent-color: #fb7185;
      }
      button {
        width: 58px;
        height: 34px;
        color: #111827;
        background: #fef08a;
        border: 1px solid #ffffff;
        border-radius: 7px;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #e5e7eb;
        background: rgba(15, 23, 42, 0.82);
        border-color: rgba(255, 255, 255, 0.3);
      }
      .meter {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.18);
      }
      .meter > div {
        width: calc(var(--pulse) * 100%);
        height: 100%;
        background: linear-gradient(90deg, #22d3ee, #fb7185, #fef08a);
      }
    </style>
    <div class="scene">
      <div class="art"></div>
      <div class="veil"></div>
      <div class="hud">
        <div class="panel">
          <h2>Otaku Neon Pop</h2>
          <div class="controls">
            <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"></label>
            <label>sparkle <input id="sparkle" type="range" min="0" max="1" step="0.01"></label>
            <label>bass <input id="bass" type="range" min="0" max="1" step="0.01"></label>
            <label>retro <input id="nostalgia" type="range" min="0" max="1" step="0.01"></label>
            <label>energy <input id="energy" type="range" min="0" max="1" step="0.01"></label>
          </div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="meter"><div id="meter-fill"></div></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const meterFill = $('#meter-fill');
  const sliders = {
    volume: $('#volume'),
    sparkle: $('#sparkle'),
    bass: $('#bass'),
    nostalgia: $('#nostalgia'),
    energy: $('#energy')
  };

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
    meterFill.style.setProperty('--pulse', String(clamp(pulse, 0, 1)));
  }

  function onRun() {
    state.running = !state.running;
    syncAudio();
    render();
  }

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = ((step % 16) + 16) % 16;
    pulse = Math.max(pulse, currentStep % 4 === 0 ? 1 : 0.42);
    if (!state.running) {
      render();
      return;
    }

    const chordIndex = Math.floor((step % 64) / 16);
    const root = chordRoots[chordIndex] || chordRoots[0];
    const eighth = duration * 0.5;

    if (currentStep % 4 === 0) playKick(time, 0.82 + state.energy * 0.18);
    if (currentStep === 4 || currentStep === 12) playSnare(time, 0.88);
    if (currentStep % 2 === 1 || state.energy > 0.62) playHat(time, currentStep % 2 ? 0.62 : 0.4);

    const bassNote = root - 24 + (currentStep === 10 ? 7 : 0);
    if ([0, 6, 8, 14].includes(currentStep)) {
      playTone(time, bassNote, duration * 1.3, 0.12 + state.bass * 0.2, 'sawtooth');
    }

    const leadMidi = lead[currentStep];
    if (leadMidi !== null) {
      playTone(time + (currentStep % 2 ? duration * 0.04 : 0), leadMidi, duration * 0.92, 0.08 + state.energy * 0.08, state.nostalgia > 0.5 ? 'square' : 'triangle');
    }

    if (currentStep % 2 === 0) {
      playTone(time + eighth * 0.35, root + arp[currentStep], duration * 0.48, 0.035 + state.sparkle * 0.055, 'square');
    }

    if (currentStep % 8 === 0) {
      [0, 4, 7, 11].forEach((offset, index) => {
        playTone(time + index * 0.012, root + offset, duration * 3.6, 0.035 + state.nostalgia * 0.025, 'triangle', dry);
      });
    }

    render();
  });

  syncAudio();
  render();

  return {
    update() {
      pulse *= 0.88;
      render();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        master.disconnect();
        dry.disconnect();
        delay.disconnect();
        feedback.disconnect();
        delayTone.disconnect();
        wet.disconnect();
        compressor.disconnect();
      } catch (_) {}
    }
  };
}
