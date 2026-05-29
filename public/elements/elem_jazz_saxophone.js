const STATE_VERSION = 'jazz-saxophone-v2';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);

  const isCurrentState = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: isCurrentState ? finite(prevState?.volume, 0.9) : 0.9,
    tone: isCurrentState ? finite(prevState?.tone, 0.68) : 0.68,
    breath: isCurrentState ? finite(prevState?.breath, 0.42) : 0.42,
    vibrato: isCurrentState ? finite(prevState?.vibrato, 0.48) : 0.48,
    room: isCurrentState ? finite(prevState?.room, 0.42) : 0.42,
    swing: isCurrentState ? finite(prevState?.swing, 0.18) : 0.18
  };

  const phrase = [
    { n: 62, v: 0.7, l: 1.8 },
    null,
    { n: 65, v: 0.58, l: 0.82 },
    { n: 67, v: 0.62, l: 0.9 },
    { n: 69, v: 0.82, l: 2.4 },
    null,
    { n: 72, v: 0.54, l: 0.82 },
    { n: 71, v: 0.46, l: 0.72 },
    { n: 69, v: 0.68, l: 1.5 },
    { n: 67, v: 0.48, l: 0.72 },
    { n: 65, v: 0.56, l: 1.25 },
    null,
    { n: 64, v: 0.48, l: 0.75 },
    { n: 65, v: 0.62, l: 0.75 },
    { n: 69, v: 0.82, l: 1.95 },
    null
  ];

  const output = audio.createGain();
  const dry = audio.createGain();
  const delay = audio.createDelay(1);
  const delayFeedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const analyser = audio.createAnalyser();

  output.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 1.24;
  delay.delayTime.value = 0.23;
  delayFeedback.gain.value = 0.24;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3300;
  wet.gain.value = state.room * 0.34;
  analyser.fftSize = 128;

  dry.connect(output);
  output.connect(analyser);
  analyser.connect(ctx.audioOut);
  dry.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let pulse = 0;
  let destroyed = false;

  function makeSaxWave() {
    const real = new Float32Array(18);
    const imag = new Float32Array(18);
    imag[1] = 0.95;
    imag[2] = 0.42;
    imag[3] = 0.62;
    imag[4] = 0.24;
    imag[5] = 0.2;
    imag[7] = 0.12;
    imag[9] = 0.06;
    return audio.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function makeNoiseBuffer() {
    const length = Math.max(1, Math.floor(audio.sampleRate * 0.55));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = last * 0.72 + (Math.random() * 2 - 1) * 0.28;
      data[i] = last;
    }
    return buffer;
  }

  const saxWave = makeSaxWave();
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
    wet.gain.setTargetAtTime(state.room * 0.34, t, 0.04);
    delayFeedback.gain.setTargetAtTime(0.16 + state.room * 0.24, t, 0.04);
    delayTone.frequency.setTargetAtTime(1900 + state.tone * 3600, t, 0.04);
  }

  function playNote(note, time, stepDuration, step) {
    const t = Math.max(time, audio.currentTime + 0.002);
    const length = stepDuration * note.l;
    const stopAt = t + length + 0.5;
    const freq = midiToFreq(note.n);
    const velocity = note.v;

    const source = audio.createOscillator();
    const support = audio.createOscillator();
    const breath = audio.createBufferSource();
    const breathFilter = audio.createBiquadFilter();
    const breathGain = audio.createGain();
    const formantA = audio.createBiquadFilter();
    const formantB = audio.createBiquadFilter();
    const body = audio.createBiquadFilter();
    const amp = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const vibratoOsc = audio.createOscillator();
    const vibratoGain = audio.createGain();
    const bendGain = audio.createGain();
    const nodes = [source, support, breath, breathFilter, breathGain, formantA, formantB, body, amp, vibratoOsc, vibratoGain, bendGain];

    source.setPeriodicWave(saxWave);
    support.type = 'triangle';
    breath.buffer = noiseBuffer;
    breath.loop = true;
    source.frequency.setValueAtTime(freq * 0.985, t);
    source.frequency.exponentialRampToValueAtTime(freq, t + 0.055);
    support.frequency.setValueAtTime(freq * 0.5, t);

    vibratoOsc.type = 'sine';
    vibratoOsc.frequency.setValueAtTime(5.2 + state.vibrato * 2.1, t);
    vibratoGain.gain.setValueAtTime(freq * (0.001 + state.vibrato * 0.006), t);
    vibratoGain.gain.linearRampToValueAtTime(freq * (0.002 + state.vibrato * 0.018), t + Math.min(0.28, length * 0.45));
    vibratoOsc.connect(vibratoGain);
    vibratoGain.connect(source.frequency);

    bendGain.gain.setValueAtTime(freq * (step % 4 === 0 ? -0.012 : 0.008), t);
    bendGain.gain.linearRampToValueAtTime(0, t + 0.13);
    bendGain.connect(source.frequency);

    breathFilter.type = 'bandpass';
    breathFilter.frequency.setValueAtTime(1700 + state.tone * 2400, t);
    breathFilter.Q.setValueAtTime(0.85, t);
    breathGain.gain.setValueAtTime(0.0001, t);
    breathGain.gain.exponentialRampToValueAtTime(state.breath * velocity * 0.07, t + 0.026);
    breathGain.gain.setTargetAtTime(0.0001, t + length, 0.08);

    formantA.type = 'bandpass';
    formantB.type = 'bandpass';
    body.type = 'lowpass';
    formantA.frequency.setValueAtTime(610 + state.tone * 380, t);
    formantA.Q.setValueAtTime(4.8, t);
    formantB.frequency.setValueAtTime(1380 + state.tone * 720, t);
    formantB.Q.setValueAtTime(5.4, t);
    body.frequency.setValueAtTime(1300 + state.tone * 3600 + velocity * 900, t);
    body.Q.setValueAtTime(1.4 + state.tone * 1.2, t);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.38 * velocity, t + 0.045);
    amp.gain.linearRampToValueAtTime(0.28 * velocity, t + Math.min(0.22, length * 0.5));
    amp.gain.setTargetAtTime(0.0001, t + length, 0.11);

    if (pan) {
      pan.pan.setValueAtTime(Math.sin(step * 0.72) * 0.22, t);
      nodes.push(pan);
    }

    source.connect(formantA);
    source.connect(body);
    support.connect(formantA);
    support.connect(body);
    formantA.connect(formantB);
    formantB.connect(body);
    body.connect(amp);
    breath.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(amp);

    if (pan) {
      amp.connect(pan);
      pan.connect(dry);
    } else {
      amp.connect(dry);
    }

    source.start(t);
    support.start(t);
    breath.start(t);
    vibratoOsc.start(t);
    source.stop(stopAt);
    support.stop(stopAt);
    breath.stop(stopAt);
    vibratoOsc.stop(stopAt);
    track(length + 0.7, ...nodes);
  }

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .sax {
        box-sizing: border-box;
        height: 100%;
        min-width: 300px;
        min-height: 230px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        padding: 12px;
        overflow: hidden;
        color: #f8fafc;
        background: linear-gradient(135deg, #15120d, #17202a 54%, #08111a);
        border: 1px solid rgba(251, 191, 36, 0.5);
        border-radius: 8px;
        box-shadow: inset 0 0 28px rgba(251, 191, 36, 0.08);
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
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px 10px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 54px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #e5e7eb;
      }
      input {
        width: 100%;
        min-width: 0;
        accent-color: #fbbf24;
      }
      .staff {
        min-height: 0;
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
        padding-top: 8px;
        border-top: 1px solid rgba(251, 191, 36, 0.18);
      }
      .note {
        min-width: 0;
        height: calc(16px + var(--height) * 44px);
        border: 1px solid rgba(251, 191, 36, 0.22);
        border-radius: 4px 4px 8px 8px;
        background: rgba(15, 23, 42, 0.76);
        opacity: 0.45;
      }
      .note.on {
        opacity: 0.85;
        background: linear-gradient(180deg, rgba(253, 230, 138, 0.85), rgba(146, 64, 14, 0.5));
      }
      .note.now {
        opacity: 1;
        transform: translateY(-3px);
        box-shadow: 0 0 calc(8px + var(--pulse) * 18px) rgba(251, 191, 36, 0.72);
      }
    </style>
    <div class="sax">
      <div class="top">
        <div>
          <h2>Jazz Sax</h2>
          <div class="sub">smoky clocked tenor line</div>
        </div>
        <div class="buttons">
          <button id="blow" type="button">blow</button>
          <button id="run" type="button"></button>
        </div>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1" step="0.01"><span id="volumeVal"></span></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"><span id="toneVal"></span></label>
        <label>breath <input id="breath" type="range" min="0" max="1" step="0.01"><span id="breathVal"></span></label>
        <label>vib <input id="vibrato" type="range" min="0" max="1" step="0.01"><span id="vibratoVal"></span></label>
        <label>room <input id="room" type="range" min="0" max="1" step="0.01"><span id="roomVal"></span></label>
        <label>swing <input id="swing" type="range" min="0" max="0.38" step="0.01"><span id="swingVal"></span></label>
      </div>
      <div class="staff" id="staff"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const blowButton = $('#blow');
  const staff = $('#staff');
  const sliders = {
    volume: $('#volume'),
    tone: $('#tone'),
    breath: $('#breath'),
    vibrato: $('#vibrato'),
    room: $('#room'),
    swing: $('#swing')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    tone: $('#toneVal'),
    breath: $('#breathVal'),
    vibrato: $('#vibratoVal'),
    room: $('#roomVal'),
    swing: $('#swingVal')
  };

  const noteEls = phrase.map((note, index) => {
    const el = document.createElement('div');
    const height = note ? clamp((note.n - 60) / 14, 0.05, 1) : 0.04;
    el.className = `note ${note ? 'on' : ''}`;
    el.style.setProperty('--height', String(height));
    el.title = note ? `step ${index + 1}` : 'rest';
    staff.appendChild(el);
    return el;
  });

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
      valueEls[key].textContent = state[key].toFixed(2);
    });
    noteEls.forEach((el, index) => {
      el.classList.toggle('now', index === currentStep);
      el.style.setProperty('--pulse', String(pulse));
    });
  }

  function onRun() {
    state.running = !state.running;
    syncAudio();
    render();
  }

  function onBlow() {
    const note = { n: 69, v: 1, l: 2.6 };
    pulse = 1;
    playNote(note, audio.currentTime + 0.01, 0.22, currentStep + 1);
    render();
  }

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  blowButton.addEventListener('click', onBlow);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = ((step % 16) + 16) % 16;
    const note = phrase[currentStep];
    pulse = Math.max(pulse, note ? 1 : 0.22);
    if (state.running && note) {
      const swingOffset = currentStep % 2 ? duration * state.swing : 0;
      playNote(note, time + swingOffset, duration, step);
    }
    render();
  });

  syncAudio();
  render();

  return {
    update() {
      pulse *= 0.86;
      render();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      blowButton.removeEventListener('click', onBlow);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        dry.disconnect();
        output.disconnect();
        delay.disconnect();
        delayFeedback.disconnect();
        delayTone.disconnect();
        wet.disconnect();
        analyser.disconnect();
      } catch (_) {}
    }
  };
}
