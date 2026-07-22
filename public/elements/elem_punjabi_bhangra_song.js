const STATE_VERSION = 'punjabi-bhangra-song-v1';

const CHORDS = [
  { name: 'D', notes: [50, 57, 62, 66] },
  { name: 'G', notes: [55, 59, 62, 67] },
  { name: 'A', notes: [57, 61, 64, 69] },
  { name: 'D', notes: [50, 57, 62, 66] }
];

const TUMBI_PHRASE = [74, 74, 81, 79, 74, 76, 79, 76, 74, 74, 81, 83, 81, 79, 76, 74];
const DHOL_BASS = [1, 0, 0.45, 0, 0.7, 0, 0.35, 0, 1, 0, 0.55, 0, 0.75, 0, 0.45, 0];
const DHOL_TREBLE = [0, 0.65, 0, 0.9, 0.35, 0.75, 0, 1, 0, 0.65, 0, 0.9, 0.35, 0.8, 0, 1];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const previousMatches = prevState?.stateVersion === STATE_VERSION;

  const state = {
    stateVersion: STATE_VERSION,
    running: previousMatches ? prevState.running !== false : true,
    volume: previousMatches ? finite(prevState.volume, 0.74) : 0.74,
    dhol: previousMatches ? finite(prevState.dhol, 0.9) : 0.9,
    tumbi: previousMatches ? finite(prevState.tumbi, 0.82) : 0.82,
    harmonium: previousMatches ? finite(prevState.harmonium, 0.5) : 0.5,
    room: previousMatches ? finite(prevState.room, 0.28) : 0.28
  };

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let currentChord = CHORDS[0].name;
  let pulse = 0;
  let stepSeconds = 0.125;
  let raf = 0;
  let destroyed = false;

  const output = audio.createGain();
  const dry = audio.createGain();
  const send = audio.createGain();
  const delay = audio.createDelay(1);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const limiter = audio.createDynamicsCompressor();

  output.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 0.9;
  send.gain.value = 0.28;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.23;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3600;
  wet.gain.value = state.room;
  limiter.threshold.value = -18;
  limiter.knee.value = 18;
  limiter.ratio.value = 5;
  limiter.attack.value = 0.004;
  limiter.release.value = 0.15;

  dry.connect(output);
  send.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);
  output.connect(limiter);
  limiter.connect(ctx.audioOut);

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .root {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 220px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 9px;
        padding: 11px;
        overflow: hidden;
        color: #f8fafc;
        background: rgba(18, 20, 25, 0.25);
        border: 1px solid rgba(42, 45, 53, 0.62);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h2 {
        margin: 0;
        color: #fbbf24;
        font: 800 14px/1 ui-sans-serif, system-ui, sans-serif;
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
        height: 29px;
        min-width: 54px;
        color: #111827;
        background: #fbbf24;
        border: 1px solid rgba(42, 45, 53, 0.62);
        border-radius: 5px;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(18, 20, 25, 0.25);
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
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #22c55e;
      }
      .stage {
        min-height: 0;
        display: grid;
        grid-template-columns: 80px minmax(0, 1fr);
        gap: 10px;
        align-items: stretch;
        border-top: 1px solid rgba(251, 191, 36, 0.2);
        padding-top: 10px;
      }
      .badge {
        min-width: 0;
        display: grid;
        place-items: center;
        border: 1px solid rgba(42, 45, 53, 0.62);
        background: rgba(18, 20, 25, 0.28);
        color: #fef3c7;
        font: 800 24px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        transform: scale(calc(1 + var(--pulse) * 0.05));
        box-shadow: 0 0 calc(5px + var(--pulse) * 17px) rgba(251, 191, 36, 0.42);
      }
      .steps {
        min-width: 0;
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 4px;
        align-items: end;
      }
      .step {
        min-width: 0;
        height: calc(18px + var(--height) * 54px);
        border: 1px solid rgba(42, 45, 53, 0.62);
        border-radius: 4px;
        background: rgba(148, 163, 184, 0.16);
        opacity: 0.62;
      }
      .step.hit {
        background: rgba(34, 197, 94, 0.32);
      }
      .step.now {
        opacity: 1;
        background: #fbbf24;
        transform: translateY(-3px);
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h2>Punjabi Bhangra</h2>
          <div class="sub">original dhol, tumbi, harmonium groove</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1" step="0.01"></label>
        <label>dhol <input id="dhol" type="range" min="0" max="1.2" step="0.01"></label>
        <label>tumbi <input id="tumbi" type="range" min="0" max="1.2" step="0.01"></label>
        <label>harm <input id="harmonium" type="range" min="0" max="1" step="0.01"></label>
        <label>room <input id="room" type="range" min="0" max="0.75" step="0.01"></label>
      </div>
      <div class="stage" id="stage" style="--pulse:0">
        <div class="badge" id="chord">D</div>
        <div class="steps" id="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const chordEl = $('#chord');
  const stage = $('#stage');
  const stepsEl = $('#steps');
  const sliders = {
    volume: $('#volume'),
    dhol: $('#dhol'),
    tumbi: $('#tumbi'),
    harmonium: $('#harmonium'),
    room: $('#room')
  };

  const stepEls = TUMBI_PHRASE.map((note, index) => {
    const el = document.createElement('div');
    const height = clamp((DHOL_BASS[index] + DHOL_TREBLE[index] + 0.35) / 2.2, 0.16, 1);
    el.className = `step ${DHOL_BASS[index] || DHOL_TREBLE[index] ? 'hit' : ''}`;
    el.style.setProperty('--height', height.toFixed(3));
    stepsEl.appendChild(el);
    return el;
  });

  function makeNoiseBuffer(seconds = 0.2) {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      last = last * 0.32 + (Math.random() * 2 - 1) * 0.68;
      data[i] = last * Math.pow(1 - i / length, 1.25);
    }
    return buffer;
  }

  function track(seconds, ...nodes) {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  }

  function applyAudioState() {
    const t = audio.currentTime;
    output.gain.setTargetAtTime(state.running ? state.volume : 0, t, 0.035);
    wet.gain.setTargetAtTime(state.room, t, 0.05);
    feedback.gain.setTargetAtTime(0.12 + state.room * 0.42, t, 0.05);
    send.gain.setTargetAtTime(0.18 + state.room * 0.42, t, 0.05);
  }

  function playDholBass(time, velocity) {
    if (!state.running || state.dhol <= 0 || velocity <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const osc = audio.createOscillator();
    const body = audio.createGain();
    const click = audio.createBufferSource();
    const clickFilter = audio.createBiquadFilter();
    const clickGain = audio.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.18);
    body.gain.setValueAtTime(0.0001, t);
    body.gain.exponentialRampToValueAtTime(0.72 * velocity * state.dhol, t + 0.004);
    body.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    click.buffer = makeNoiseBuffer(0.06);
    clickFilter.type = 'lowpass';
    clickFilter.frequency.setValueAtTime(720, t);
    clickGain.gain.setValueAtTime(0.12 * velocity * state.dhol, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

    osc.connect(body);
    body.connect(dry);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(dry);
    osc.start(t);
    click.start(t);
    osc.stop(t + 0.42);
    click.stop(t + 0.08);
    track(0.5, osc, body, click, clickFilter, clickGain);
  }

  function playDholTreble(time, velocity) {
    if (!state.running || state.dhol <= 0 || velocity <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const noise = audio.createBufferSource();
    const snap = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const snapGain = audio.createGain();

    noise.buffer = makeNoiseBuffer(0.12);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1700 + velocity * 850, t);
    filter.Q.setValueAtTime(2.6, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.22 * velocity * state.dhol, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.105);

    snap.type = 'triangle';
    snap.frequency.setValueAtTime(260 + velocity * 120, t);
    snap.frequency.exponentialRampToValueAtTime(185, t + 0.08);
    snapGain.gain.setValueAtTime(0.0001, t);
    snapGain.gain.exponentialRampToValueAtTime(0.12 * velocity * state.dhol, t + 0.004);
    snapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(dry);
    gain.connect(send);
    snap.connect(snapGain);
    snapGain.connect(dry);
    noise.start(t);
    snap.start(t);
    noise.stop(t + 0.13);
    snap.stop(t + 0.13);
    track(0.2, noise, snap, filter, gain, snapGain);
  }

  function playTumbi(time, midi, velocity, tickDuration) {
    if (!state.running || state.tumbi <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const sub = audio.createOscillator();
    const pick = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const pickGain = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const length = clamp(tickDuration * 0.9, 0.08, 0.22);
    const nodes = [osc, sub, pick, filter, gain, pickGain];

    osc.type = 'sawtooth';
    sub.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);
    osc.detune.setValueAtTime((currentStep % 2 ? 9 : -6), t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 2.1, t);
    filter.Q.setValueAtTime(6.5, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2 * velocity * state.tumbi, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    pick.buffer = makeNoiseBuffer(0.035);
    pickGain.gain.setValueAtTime(0.065 * velocity * state.tumbi, t);
    pickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    pick.connect(pickGain);
    pickGain.connect(gain);
    if (pan) {
      pan.pan.setValueAtTime(Math.sin(currentStep * 0.8) * 0.22, t);
      nodes.push(pan);
      gain.connect(pan);
      pan.connect(dry);
      pan.connect(send);
    } else {
      gain.connect(dry);
      gain.connect(send);
    }

    osc.start(t);
    sub.start(t);
    pick.start(t);
    osc.stop(t + length + 0.03);
    sub.stop(t + length + 0.03);
    pick.stop(t + 0.04);
    track(length + 0.08, ...nodes);
  }

  function playHarmonium(time, chord, tickDuration) {
    if (!state.running || state.harmonium <= 0) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const duration = clamp(tickDuration * 3.65, 0.4, 1.1);
    const bus = audio.createGain();
    const filter = audio.createBiquadFilter();
    const trem = audio.createOscillator();
    const tremGain = audio.createGain();
    const nodes = [bus, filter, trem, tremGain];

    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.exponentialRampToValueAtTime(0.075 * state.harmonium, t + 0.09);
    bus.gain.setTargetAtTime(0.0001, t + duration, 0.18);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1050 + state.harmonium * 1600, t);
    filter.Q.setValueAtTime(1.2, t);
    trem.type = 'sine';
    trem.frequency.setValueAtTime(5.4, t);
    tremGain.gain.setValueAtTime(0.012, t);
    trem.connect(tremGain);

    chord.notes.forEach((midi, index) => {
      const osc = audio.createOscillator();
      const voiceGain = audio.createGain();
      osc.type = index % 2 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(midi), t);
      osc.detune.setValueAtTime((index - 1.5) * 5, t);
      tremGain.connect(osc.detune);
      voiceGain.gain.setValueAtTime(index === 0 ? 0.56 : 0.36, t);
      osc.connect(voiceGain);
      voiceGain.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.3);
      nodes.push(osc, voiceGain);
    });

    filter.connect(bus);
    bus.connect(dry);
    bus.connect(send);
    trem.start(t);
    trem.stop(t + duration + 0.3);
    track(duration + 0.5, ...nodes);
  }

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    chordEl.textContent = currentChord;
    stage.style.setProperty('--pulse', String(clamp(pulse, 0, 1)));
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
    stepEls.forEach((el, index) => el.classList.toggle('now', index === currentStep));
    applyAudioState();
  }

  function onRun() {
    state.running = !state.running;
    render();
  }

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    render();
  }]));

  runButton.addEventListener('click', onRun);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = ((step % 16) + 16) % 16;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    const tickDuration = clamp(duration || stepSeconds, 0.07, 0.34);
    const chord = CHORDS[Math.floor((((step % 64) + 64) % 64) / 16) % CHORDS.length];
    currentChord = chord.name;
    delay.delayTime.setTargetAtTime(tickDuration * 1.45, audio.currentTime, 0.04);

    const bass = DHOL_BASS[currentStep];
    const treble = DHOL_TREBLE[currentStep];
    if (bass) playDholBass(time, bass);
    if (treble) playDholTreble(time + (currentStep % 4 === 3 ? tickDuration * 0.045 : 0), treble);

    const phraseOffset = Math.floor(step / 16) % 2 === 0 ? 0 : 2;
    const note = TUMBI_PHRASE[currentStep] + phraseOffset;
    const tumbiVelocity = currentStep % 4 === 0 ? 1 : 0.72;
    playTumbi(time + tickDuration * 0.02, note, tumbiVelocity, tickDuration);

    if (currentStep % 4 === 0) playHarmonium(time, chord, tickDuration);
    pulse = Math.max(pulse, currentStep % 4 === 0 ? 1 : 0.52);
    render();
  });

  render();
  const animate = () => {
    pulse *= 0.88;
    render();
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
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
        output.disconnect();
        dry.disconnect();
        send.disconnect();
        delay.disconnect();
        feedback.disconnect();
        delayTone.disconnect();
        wet.disconnect();
        limiter.disconnect();
      } catch (_) {}
    }
  };
}
