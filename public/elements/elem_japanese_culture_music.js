const STATE_VERSION = 'japanese-culture-music-v1';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.82),
    koto: finite(prevState?.koto, 0.72),
    shakuhachi: finite(prevState?.shakuhachi, 0.56),
    taiko: finite(prevState?.taiko, 0.58),
    ambience: finite(prevState?.ambience, 0.48)
  };

  const scale = [50, 53, 55, 60, 62, 65, 67, 72]; // D in-sen inspired, original phrase.
  const kotoPattern = [0, 2, 4, 6, 5, 3, 2, null, 1, 3, 5, 7, 6, 4, 2, null];
  const flutePattern = [null, null, 4, null, 5, null, null, null, 6, null, 5, null, 3, null, null, null];

  const master = audio.createGain();
  const dry = audio.createGain();
  const delay = audio.createDelay(1.2);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const compressor = audio.createDynamicsCompressor();

  master.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 0.95;
  delay.delayTime.value = 0.31;
  feedback.gain.value = 0.25;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3200;
  wet.gain.value = state.ambience * 0.32;
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 2.8;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.2;

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

  function makeNoiseBuffer(seconds = 0.6) {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = last * 0.58 + (Math.random() * 2 - 1) * 0.42;
      data[i] = last;
    }
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
    wet.gain.setTargetAtTime(state.ambience * 0.32, t, 0.04);
    feedback.gain.setTargetAtTime(0.16 + state.ambience * 0.28, t, 0.04);
  }

  function playKoto(time, midi, velocity, duration) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const freq = midiToFreq(midi);
    const body = audio.createOscillator();
    const bright = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const high = audio.createBiquadFilter();

    body.type = 'triangle';
    bright.type = 'square';
    body.frequency.setValueAtTime(freq, t);
    bright.frequency.setValueAtTime(freq * 2.01, t);
    bright.detune.setValueAtTime(-7, t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 2.8, t);
    filter.Q.setValueAtTime(4.2, t);
    high.type = 'highpass';
    high.frequency.setValueAtTime(150, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18 * velocity * state.koto, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.035 * velocity * state.koto, t + 0.12);
    gain.gain.setTargetAtTime(0.0001, t + duration, 0.1);

    body.connect(filter);
    bright.connect(filter);
    filter.connect(high);
    high.connect(gain);
    gain.connect(dry);
    body.start(t);
    bright.start(t);
    body.stop(t + duration + 0.4);
    bright.stop(t + duration + 0.4);
    track(duration + 0.6, body, bright, filter, high, gain);
  }

  function playShakuhachi(time, midi, velocity, duration) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const freq = midiToFreq(midi);
    const tone = audio.createOscillator();
    const breath = audio.createBufferSource();
    const breathFilter = audio.createBiquadFilter();
    const breathGain = audio.createGain();
    const gain = audio.createGain();
    const formant = audio.createBiquadFilter();
    const vibrato = audio.createOscillator();
    const vibratoGain = audio.createGain();

    tone.type = 'triangle';
    tone.frequency.setValueAtTime(freq * 0.985, t);
    tone.frequency.exponentialRampToValueAtTime(freq, t + 0.16);
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(4.7, t);
    vibratoGain.gain.setValueAtTime(freq * 0.004, t);
    vibratoGain.gain.linearRampToValueAtTime(freq * 0.014, t + 0.45);
    vibrato.connect(vibratoGain);
    vibratoGain.connect(tone.frequency);

    breath.buffer = noiseBuffer;
    breath.loop = true;
    breathFilter.type = 'bandpass';
    breathFilter.frequency.setValueAtTime(1500, t);
    breathFilter.Q.setValueAtTime(0.9, t);
    breathGain.gain.setValueAtTime(0.0001, t);
    breathGain.gain.exponentialRampToValueAtTime(0.045 * velocity * state.shakuhachi, t + 0.08);
    breathGain.gain.setTargetAtTime(0.0001, t + duration, 0.12);

    formant.type = 'lowpass';
    formant.frequency.setValueAtTime(1250, t);
    formant.Q.setValueAtTime(1.8, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.12 * velocity * state.shakuhachi, t + 0.12);
    gain.gain.setTargetAtTime(0.0001, t + duration, 0.18);

    tone.connect(formant);
    formant.connect(gain);
    breath.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(gain);
    gain.connect(dry);
    tone.start(t);
    breath.start(t);
    vibrato.start(t);
    tone.stop(t + duration + 0.4);
    breath.stop(t + duration + 0.4);
    vibrato.stop(t + duration + 0.4);
    track(duration + 0.65, tone, breath, breathFilter, breathGain, gain, formant, vibrato, vibratoGain);
  }

  function playTaiko(time, velocity, deep = false) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const osc = audio.createOscillator();
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const noiseGain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(deep ? 92 : 138, t);
    osc.frequency.exponentialRampToValueAtTime(deep ? 42 : 72, t + 0.24);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((deep ? 0.66 : 0.38) * velocity * state.taiko, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (deep ? 0.42 : 0.18));

    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(deep ? 210 : 680, t);
    noiseFilter.Q.setValueAtTime(0.7, t);
    noiseGain.gain.setValueAtTime(0.12 * velocity * state.taiko, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    osc.connect(gain);
    gain.connect(dry);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(dry);
    osc.start(t);
    noise.start(t);
    osc.stop(t + 0.48);
    noise.stop(t + 0.12);
    track(0.6, osc, noise, noiseFilter, gain, noiseGain);
  }

  function playShoPad(time, rootMidi, duration) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const nodes = [gain, filter];
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1450 + state.ambience * 1200, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.035 * state.ambience, t + 0.5);
    gain.gain.setTargetAtTime(0.0001, t + duration, 0.35);

    [0, 5, 7, 12].forEach((offset, index) => {
      const osc = audio.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(midiToFreq(rootMidi + offset), t);
      osc.detune.setValueAtTime((index - 1.5) * 5, t);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.7);
      nodes.push(osc);
    });

    filter.connect(gain);
    gain.connect(dry);
    track(duration + 0.9, ...nodes);
  }

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .jp {
        box-sizing: border-box;
        height: 100%;
        min-width: 320px;
        min-height: 240px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        padding: 12px;
        overflow: hidden;
        color: #f8fafc;
        background:
          radial-gradient(circle at 18% 20%, rgba(248, 113, 113, 0.22), transparent 32%),
          linear-gradient(135deg, #131521, #1d2433 56%, #090b12);
        border: 1px solid rgba(251, 191, 36, 0.46);
        border-radius: 8px;
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
        color: #fef3c7;
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
        min-width: 58px;
        color: #111827;
        background: #fbbf24;
        border: 1px solid #fde68a;
        border-radius: 5px;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.78);
        border-color: rgba(148, 163, 184, 0.42);
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
        color: #e5e7eb;
        font-size: 9px;
      }
      input {
        width: 100%;
        min-width: 0;
        accent-color: #fbbf24;
      }
      .steps {
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        border-top: 1px solid rgba(251, 191, 36, 0.18);
        padding-top: 12px;
      }
      .step {
        min-width: 0;
        height: calc(14px + var(--height) * 44px);
        border: 1px solid rgba(251, 191, 36, 0.22);
        border-radius: 999px 999px 4px 4px;
        background: rgba(15, 23, 42, 0.78);
        opacity: 0.5;
      }
      .step.on {
        background: linear-gradient(180deg, rgba(254, 243, 199, 0.92), rgba(185, 28, 28, 0.38));
        opacity: 0.9;
      }
      .step.now {
        opacity: 1;
        transform: translateY(-3px);
        box-shadow: 0 0 calc(8px + var(--pulse) * 18px) rgba(251, 191, 36, 0.68);
      }
    </style>
    <div class="jp">
      <div class="top">
        <div>
          <h2>Nihon Soundscape</h2>
          <div class="sub">koto, shakuhachi, taiko, and sho colors</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"></label>
        <label>koto <input id="koto" type="range" min="0" max="1" step="0.01"></label>
        <label>flute <input id="shakuhachi" type="range" min="0" max="1" step="0.01"></label>
        <label>taiko <input id="taiko" type="range" min="0" max="1" step="0.01"></label>
        <label>air <input id="ambience" type="range" min="0" max="1" step="0.01"></label>
      </div>
      <div class="steps" id="steps"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const stepsEl = $('#steps');
  const sliders = {
    volume: $('#volume'),
    koto: $('#koto'),
    shakuhachi: $('#shakuhachi'),
    taiko: $('#taiko'),
    ambience: $('#ambience')
  };

  const stepEls = kotoPattern.map((noteIndex) => {
    const el = document.createElement('div');
    el.className = `step ${noteIndex === null ? '' : 'on'}`;
    el.style.setProperty('--height', String(noteIndex === null ? 0.06 : clamp((noteIndex + 1) / scale.length, 0.08, 1)));
    stepsEl.appendChild(el);
    return el;
  });

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
    stepEls.forEach((el, index) => {
      el.classList.toggle('now', index === currentStep);
      el.style.setProperty('--pulse', String(clamp(pulse, 0, 1)));
    });
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
    pulse = Math.max(pulse, currentStep % 4 === 0 ? 1 : 0.45);
    if (!state.running) {
      render();
      return;
    }

    const noteIndex = kotoPattern[currentStep];
    if (noteIndex !== null) {
      playKoto(time, scale[noteIndex], currentStep % 4 === 0 ? 1 : 0.72, duration * 1.65);
    }

    const fluteIndex = flutePattern[currentStep];
    if (fluteIndex !== null) {
      playShakuhachi(time + duration * 0.07, scale[fluteIndex] + 12, 0.86, duration * 3.2);
    }

    if ([0, 8].includes(currentStep)) playTaiko(time, 1, true);
    if ([6, 14].includes(currentStep)) playTaiko(time, 0.62, false);
    if (currentStep % 16 === 0) playShoPad(time, 50, duration * 12);

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
