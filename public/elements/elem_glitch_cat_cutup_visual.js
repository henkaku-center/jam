const STATE_VERSION = 'glitch-cat-cutup-v2';

const CAT_SCENES = [
  'https://placecats.com/neo/720/480',
  'https://placecats.com/millie/720/480',
  'https://placecats.com/bella/720/480',
  'https://placecats.com/g/720/480',
  'https://placecats.com/720/480',
  'https://placecats.com/poppy/720/480'
];

const FANTASY_MELODY = [
  { step: 0, midi: 62, length: 3.4, velocity: 0.78 },
  { step: 4, midi: 69, length: 2.6, velocity: 0.7 },
  { step: 7, midi: 67, length: 1.7, velocity: 0.56 },
  { step: 9, midi: 65, length: 2.7, velocity: 0.64 },
  { step: 12, midi: 60, length: 3.4, velocity: 0.66 },
  { step: 16, midi: 62, length: 2.3, velocity: 0.72 },
  { step: 19, midi: 65, length: 1.6, velocity: 0.56 },
  { step: 21, midi: 67, length: 2.2, velocity: 0.62 },
  { step: 24, midi: 72, length: 3.3, velocity: 0.78 },
  { step: 28, midi: 69, length: 3.2, velocity: 0.68 },
  { step: 32, midi: 67, length: 2.8, velocity: 0.66 },
  { step: 35, midi: 65, length: 1.7, velocity: 0.54 },
  { step: 37, midi: 62, length: 3.2, velocity: 0.7 },
  { step: 41, midi: 57, length: 2.2, velocity: 0.56 },
  { step: 44, midi: 60, length: 2.6, velocity: 0.62 },
  { step: 48, midi: 62, length: 3.1, velocity: 0.75 },
  { step: 52, midi: 69, length: 2.2, velocity: 0.62 },
  { step: 55, midi: 72, length: 1.8, velocity: 0.72 },
  { step: 57, midi: 74, length: 2.5, velocity: 0.78 },
  { step: 60, midi: 72, length: 3.6, velocity: 0.7 }
];

const FANTASY_HARMONY = [
  { step: 0, notes: [38, 45, 50] },
  { step: 16, notes: [41, 48, 53] },
  { step: 32, notes: [36, 43, 50] },
  { step: 48, notes: [38, 45, 53] }
];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const state = {
    stateVersion: STATE_VERSION,
    speed: finite(prevState?.speed, 0.72),
    glitch: finite(prevState?.glitch, 0.88),
    smear: finite(prevState?.smear, 0.58),
    music: prevState?.music !== false,
    melody: finite(prevState?.melody, 0.68)
  };

  let frameTimer = 0;
  let raf = 0;
  let sceneIndex = 0;
  let altIndex = 2;
  let frame = 0;
  let currentStep = -1;
  let currentNote = '--';
  let melodyFlash = 0;

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  const output = audio.createGain();
  const melodyBus = audio.createGain();
  const padBus = audio.createGain();
  const delay = audio.createDelay(1.5);
  const feedback = audio.createGain();
  const delayFilter = audio.createBiquadFilter();
  const wet = audio.createGain();
  const compressor = audio.createDynamicsCompressor();

  output.gain.value = state.music ? state.melody : 0.0001;
  melodyBus.gain.value = 0.74;
  padBus.gain.value = 0.28;
  delay.delayTime.value = 0.48;
  feedback.gain.value = 0.26;
  delayFilter.type = 'lowpass';
  delayFilter.frequency.value = 2800;
  wet.gain.value = 0.32;
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 2.3;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.24;

  melodyBus.connect(output);
  melodyBus.connect(delay);
  padBus.connect(output);
  delay.connect(delayFilter);
  delayFilter.connect(feedback);
  feedback.connect(delay);
  delayFilter.connect(wet);
  wet.connect(output);
  output.connect(compressor);
  compressor.connect(ctx.audioOut);

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .cat-glitch {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 180px;
        overflow: hidden;
        background: rgba(18, 20, 25, 0.25);
        border-radius: 8px;
        border: 1px solid rgba(42, 45, 53, 0.6);
        isolation: isolate;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      .scene,
      .rgb,
      .slice {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        will-change: transform, filter, opacity, clip-path;
      }

      .scene {
        filter: contrast(1.22) saturate(1.1) brightness(0.92);
        transform: scale(1.035);
      }

      .scene.alt {
        mix-blend-mode: lighten;
        opacity: 0;
        filter: contrast(1.7) saturate(0.35) invert(1);
      }

      .rgb {
        pointer-events: none;
        opacity: 0.42;
        mix-blend-mode: screen;
      }

      .rgb.red {
        filter: sepia(1) saturate(8) hue-rotate(302deg);
      }

      .rgb.cyan {
        filter: sepia(1) saturate(8) hue-rotate(132deg);
      }

      .slice {
        opacity: 0.95;
        mix-blend-mode: hard-light;
        filter: contrast(1.55) saturate(1.6);
      }

      .static,
      .scan,
      .counter {
        position: absolute;
        pointer-events: none;
      }

      .static {
        inset: 0;
        opacity: calc(0.18 + var(--noise, 0) * 0.18);
        mix-blend-mode: screen;
        background:
          repeating-radial-gradient(circle at 20% 30%, rgba(255,255,255,0.22) 0 1px, transparent 1px 3px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 4px);
        background-size: 13px 11px, 100% 4px;
        transform: translate3d(var(--static-x, 0px), var(--static-y, 0px), 0);
      }

      .scan {
        inset: 0;
        z-index: 8;
        opacity: 0.42;
        background: rgba(18, 20, 25, 0.25);
        transform: translateY(var(--scan-y, 0%));
        mix-blend-mode: overlay;
      }

      .counter {
        right: 8px;
        bottom: 7px;
        z-index: 12;
        color: rgba(255, 255, 255, 0.72);
        text-shadow: 1px 0 #ef4444, -1px 0 #22d3ee;
      }

      .chant {
        position: absolute;
        left: 8px;
        bottom: 7px;
        z-index: 12;
        display: grid;
        grid-template-columns: auto auto;
        gap: 6px;
        align-items: center;
        color: rgba(244, 239, 214, 0.84);
        text-shadow: 0 0 10px rgba(250, 204, 21, 0.55), 1px 0 #ef4444, -1px 0 #22d3ee;
      }

      .chant::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: rgba(250, 204, 21, calc(0.28 + var(--melody-flash, 0) * 0.62));
        box-shadow: 0 0 calc(4px + var(--melody-flash, 0) * 16px) rgba(250, 204, 21, 0.86);
      }

      .cat-glitch.burst .scene {
        filter: contrast(2.1) saturate(0.25) brightness(1.25);
      }

      .cat-glitch.burst .scene.alt {
        opacity: 0.64;
      }
    </style>
    <div class="cat-glitch" id="root">
      <div class="scene" id="main"></div>
      <div class="scene alt" id="alt"></div>
      <div class="rgb red" id="red"></div>
      <div class="rgb cyan" id="cyan"></div>
      <div id="slices"></div>
      <div class="static" id="static"></div>
      <div class="scan"></div>
      <div class="chant" id="chant">FANTASY//--</div>
      <div class="counter" id="counter"></div>
    </div>
  `;

  const root = ctx.domRoot.querySelector('#root');
  const main = ctx.domRoot.querySelector('#main');
  const alt = ctx.domRoot.querySelector('#alt');
  const red = ctx.domRoot.querySelector('#red');
  const cyan = ctx.domRoot.querySelector('#cyan');
  const slices = ctx.domRoot.querySelector('#slices');
  const staticLayer = ctx.domRoot.querySelector('#static');
  const counter = ctx.domRoot.querySelector('#counter');
  const chant = ctx.domRoot.querySelector('#chant');

  const pickScene = (offset = 0) => CAT_SCENES[(sceneIndex + offset + CAT_SCENES.length) % CAT_SCENES.length];
  const setBackground = (element, url) => {
    element.style.backgroundImage = `url("${url}")`;
  };

  const randomScene = () => CAT_SCENES[Math.floor(Math.random() * CAT_SCENES.length)];
  const noteName = (midi) => {
    const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
  };

  const cleanupNode = (node, stopAt) => {
    liveNodes.add(node);
    const removeAt = Math.max(0, (stopAt - audio.currentTime + 0.1) * 1000);
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      liveNodes.delete(node);
      try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
    }, removeAt);
    cleanupTimers.add(timer);
  };

  const triggerNote = (midi, velocity, time, tickDuration, length = 1, bus = melodyBus) => {
    const start = Math.max(time || audio.currentTime, audio.currentTime + 0.004);
    const duration = Math.max(0.16, tickDuration * length);
    const end = start + duration;
    const freq = midiToFreq(midi);
    const voice = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();
    const main = audio.createOscillator();
    const air = audio.createOscillator();
    const sub = audio.createOscillator();
    const vibrato = audio.createOscillator();
    const vibratoDepth = audio.createGain();

    main.type = 'triangle';
    air.type = 'sine';
    sub.type = 'sine';
    vibrato.type = 'sine';
    main.frequency.setValueAtTime(freq, start);
    air.frequency.setValueAtTime(freq * 2.01, start);
    sub.frequency.setValueAtTime(freq * 0.5, start);
    vibrato.frequency.setValueAtTime(4.8, start);
    vibratoDepth.gain.setValueAtTime(freq * 0.006, start);
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(main.frequency);
    vibratoDepth.connect(air.frequency);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(720, start);
    filter.frequency.linearRampToValueAtTime(2100 + velocity * 1200, start + Math.min(0.28, duration * 0.35));
    filter.frequency.setTargetAtTime(980, start + duration * 0.52, 0.24);
    filter.Q.value = 0.65;

    pan.pan.setValueAtTime(Math.sin(midi * 1.7) * 0.18, start);
    voice.gain.setValueAtTime(0.0001, start);
    voice.gain.linearRampToValueAtTime(0.12 * velocity, start + Math.min(0.22, duration * 0.3));
    voice.gain.setTargetAtTime(0.052 * velocity, start + duration * 0.54, 0.2);
    voice.gain.linearRampToValueAtTime(0.0001, end + 0.34);

    main.connect(filter);
    air.connect(filter);
    sub.connect(filter);
    filter.connect(voice);
    voice.connect(pan);
    pan.connect(bus);

    [main, air, sub, vibrato].forEach((osc) => {
      liveNodes.add(osc);
      osc.start(start);
      osc.stop(end + 0.45);
      osc.addEventListener('ended', () => liveNodes.delete(osc), { once: true });
    });
    [voice, filter, pan, vibratoDepth].forEach((node) => cleanupNode(node, end + 0.48));
  };

  const triggerHarmony = (notes, time, tickDuration) => {
    notes.forEach((midi, index) => {
      triggerNote(midi, 0.32 - index * 0.025, (time || audio.currentTime) + index * 0.018, tickDuration, 7.5, padBus);
    });
  };

  const makeDrone = (midi, gainValue, detune = 0) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);
    osc.detune.value = detune;
    gain.gain.value = gainValue;
    filter.type = 'lowpass';
    filter.frequency.value = 640;
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(padBus);
    osc.start();
    liveNodes.add(osc);
    liveNodes.add(gain);
    liveNodes.add(filter);
  };

  makeDrone(38, 0.06, -4);
  makeDrone(45, 0.042, 5);

  const renderSlices = () => {
    const count = 7 + Math.round(state.glitch * 10);
    const pieces = [];
    for (let i = 0; i < count; i += 1) {
      const y = Math.random() * 96;
      const h = 2 + Math.random() * (5 + state.glitch * 11);
      const x = (Math.random() - 0.5) * (24 + state.glitch * 86);
      const scale = 1.02 + Math.random() * 0.05;
      const hue = Math.round((Math.random() - 0.5) * 70);
      const image = Math.random() < state.glitch ? randomScene() : pickScene();
      pieces.push(`<div class="slice" style="
        clip-path: inset(${y}% 0 ${Math.max(0, 100 - y - h)}% 0);
        background-image: url('${image}');
        transform: translate3d(${x.toFixed(1)}px, ${(Math.random() - 0.5) * 8}px, 0) scale(${scale.toFixed(3)});
        filter: hue-rotate(${hue}deg) contrast(${(1.25 + Math.random() * 1.2).toFixed(2)}) saturate(${(0.55 + Math.random() * 2.4).toFixed(2)});
      "></div>`);
    }
    slices.innerHTML = pieces.join('');
  };

  const cut = () => {
    frame += 1;
    const jump = Math.random() < 0.58 + state.glitch * 0.3;
    if (jump) sceneIndex = Math.floor(Math.random() * CAT_SCENES.length);
    else sceneIndex = (sceneIndex + 1) % CAT_SCENES.length;
    altIndex = Math.floor(Math.random() * CAT_SCENES.length);

    const mainUrl = pickScene();
    const altUrl = CAT_SCENES[altIndex];
    setBackground(main, mainUrl);
    setBackground(alt, altUrl);
    setBackground(red, mainUrl);
    setBackground(cyan, altUrl);

    const blast = Math.random() < state.glitch * 0.55;
    root.classList.toggle('burst', blast);
    const smear = state.smear;
    const redX = (Math.random() - 0.5) * (8 + smear * 42);
    const cyanX = (Math.random() - 0.5) * (8 + smear * 52);
    const skew = (Math.random() - 0.5) * state.glitch * 9;
    main.style.transform = `translate3d(${(Math.random() - 0.5) * state.glitch * 20}px, ${(Math.random() - 0.5) * state.glitch * 10}px, 0) scale(${(1.02 + Math.random() * 0.08).toFixed(3)}) skewX(${skew.toFixed(2)}deg)`;
    alt.style.transform = `translate3d(${(-redX).toFixed(1)}px, ${(Math.random() - 0.5) * 18}px, 0) scale(1.06)`;
    red.style.transform = `translate3d(${redX.toFixed(1)}px, 0, 0) scale(1.035)`;
    cyan.style.transform = `translate3d(${cyanX.toFixed(1)}px, ${(Math.random() - 0.5) * 12}px, 0) scale(1.04)`;
    counter.textContent = `CAT//${String(frame % 10000).padStart(4, '0')}`;
    renderSlices();

    clearTimeout(frameTimer);
    const interval = 42 + (1 - state.speed) * 130 + Math.random() * 46;
    frameTimer = setTimeout(cut, interval);
  };

  const animate = () => {
    const noise = Math.random();
    melodyFlash *= 0.88;
    staticLayer.style.setProperty('--noise', noise.toFixed(3));
    staticLayer.style.setProperty('--static-x', `${Math.round((Math.random() - 0.5) * 14)}px`);
    staticLayer.style.setProperty('--static-y', `${Math.round((Math.random() - 0.5) * 10)}px`);
    root.style.setProperty('--scan-y', `${((performance.now() * 0.04) % 120 - 10).toFixed(1)}%`);
    root.style.setProperty('--melody-flash', melodyFlash.toFixed(3));
    chant.textContent = `FANTASY//${currentNote}`;
    raf = requestAnimationFrame(animate);
  };

  const handleTick = ({ step, time, duration }) => {
    currentStep = step % 64;
    const when = time || audio.currentTime;
    const tickDuration = duration || 0.125;
    output.gain.setTargetAtTime(state.music ? state.melody : 0.0001, Math.max(audio.currentTime, when), 0.08);

    const melodyEvent = FANTASY_MELODY.find((event) => event.step === currentStep);
    if (melodyEvent) {
      currentNote = noteName(melodyEvent.midi);
      melodyFlash = 1;
      triggerNote(melodyEvent.midi, melodyEvent.velocity, when, tickDuration, melodyEvent.length);
      if (melodyEvent.velocity > 0.7) {
        triggerNote(melodyEvent.midi + 12, melodyEvent.velocity * 0.34, when + tickDuration * 0.08, tickDuration, Math.max(1.2, melodyEvent.length * 0.58));
      }
    }

    const harmonyEvent = FANTASY_HARMONY.find((event) => event.step === currentStep);
    if (harmonyEvent) triggerHarmony(harmonyEvent.notes, when, tickDuration);
  };

  CAT_SCENES.forEach((url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  });

  cut();
  animate();
  const unsubscribeClock = ctx.clock.onTick(handleTick);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      clearTimeout(frameTimer);
      cancelAnimationFrame(raf);
      unsubscribeClock();
      slices.innerHTML = '';
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        output.disconnect();
        melodyBus.disconnect();
        padBus.disconnect();
        delay.disconnect();
        feedback.disconnect();
        delayFilter.disconnect();
        wet.disconnect();
        compressor.disconnect();
      } catch (_) {}
    }
  };
}
