const STATE_VERSION = 'madoka-t0-a2-p5-embed-v2-eruption-audio';
const SOURCE_URL = 'https://aps-i.chibatech.dev/examples/madoka-t0-a2/';
const FPS = 60;
const INITIAL_ERUPTION_START = 100 / FPS;
const INITIAL_ERUPTION_DURATION = 188 / FPS;

export default function setup(ctx, prevState) {
  const pitchHz = (value) => Math.min(20000, value * 4);
  const state = {
    stateVersion: STATE_VERSION,
    loadedAt: prevState?.loadedAt || Date.now(),
    soundEnabled: prevState?.soundEnabled ?? true
  };

  const audio = ctx.audioCtx;
  const output = audio.createGain();
  output.gain.value = 0.82;
  output.connect(ctx.audioOut);

  const activeNodes = new Set();
  const timers = new Set();
  let noiseBuffer = null;

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .frame-shell {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 420px;
        min-height: 300px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: #000;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #000;
      }
      .label {
        position: absolute;
        left: 10px;
        bottom: 9px;
        padding: 5px 7px;
        border-radius: 6px;
        color: rgba(248, 250, 252, 0.78);
        background: rgba(2, 6, 23, 0.48);
        border: 1px solid rgba(148, 163, 184, 0.18);
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        pointer-events: none;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.72);
      }
      .controls {
        position: absolute;
        right: 9px;
        bottom: 8px;
        display: flex;
        gap: 6px;
      }
      button {
        width: 28px;
        height: 24px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 6px;
        color: rgba(248, 250, 252, 0.8);
        background: rgba(2, 6, 23, 0.48);
        font: 14px/1 ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
      }
      button:hover {
        background: rgba(15, 23, 42, 0.68);
      }
      button[aria-pressed="false"] {
        color: rgba(248, 250, 252, 0.42);
        border-color: rgba(148, 163, 184, 0.18);
      }
    </style>
    <div class="frame-shell">
      <iframe
        id="frame"
        title="APS-I madoka-t0-a2 full p5.js example"
        src="${SOURCE_URL}"
        loading="eager"
        allow="fullscreen"
        referrerpolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      ></iframe>
      <div class="label">APS-I madoka-t0-a2</div>
      <div class="controls">
        <button id="sound" type="button" title="Toggle eruption sound" aria-pressed="${state.soundEnabled ? 'true' : 'false'}">S</button>
        <button id="reload" type="button" title="Reload p5 scene">R</button>
      </div>
    </div>
  `;

  const frame = ctx.domRoot.querySelector('#frame');
  const reload = ctx.domRoot.querySelector('#reload');
  const sound = ctx.domRoot.querySelector('#sound');

  function trackNode(node) {
    activeNodes.add(node);
    node.addEventListener?.('ended', () => {
      activeNodes.delete(node);
      try {
        node.disconnect();
      } catch {}
    }, { once: true });
    return node;
  }

  function trackTimer(timer) {
    timers.add(timer);
    return timer;
  }

  function clearTimers() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }

  function makeNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const seconds = 3.5;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * seconds), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = last * 0.82 + (Math.random() * 2 - 1) * 0.18;
      data[i] = last;
    }
    noiseBuffer = buffer;
    return buffer;
  }

  function scheduleEnvelope(param, start, points) {
    param.cancelScheduledValues(start);
    for (const point of points) {
      const [offset, value, curve = 'linear'] = point;
      const time = start + offset;
      if (curve === 'exp') param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
      else param.linearRampToValueAtTime(value, time);
    }
  }

  function playRumble(start, duration, intensity = 1) {
    const bus = audio.createGain();
    const low = audio.createBiquadFilter();
    const sub = audio.createOscillator();
    const wobble = audio.createOscillator();
    const wobbleGain = audio.createGain();
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();

    bus.gain.setValueAtTime(0.0001, start);
    scheduleEnvelope(bus.gain, start, [
      [0.05, 0.26 * intensity],
      [duration * 0.28, 0.42 * intensity],
      [duration * 0.74, 0.22 * intensity],
      [duration, 0.0001, 'exp']
    ]);

    sub.type = 'sine';
    sub.frequency.setValueAtTime(pitchHz(34), start);
    sub.frequency.exponentialRampToValueAtTime(pitchHz(24), start + duration);
    wobble.type = 'sine';
    wobble.frequency.setValueAtTime(5.4, start);
    wobbleGain.gain.setValueAtTime(9, start);
    wobble.connect(wobbleGain);
    wobbleGain.connect(sub.frequency);

    low.type = 'lowpass';
    low.frequency.setValueAtTime(pitchHz(90), start);
    low.Q.setValueAtTime(0.6, start);

    noise.buffer = makeNoiseBuffer();
    noise.loop = true;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(pitchHz(115), start);
    noiseFilter.Q.setValueAtTime(0.85, start);
    noiseGain.gain.setValueAtTime(0.22 * intensity, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    sub.connect(low);
    low.connect(bus);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(bus);
    bus.connect(output);

    for (const node of [sub, wobble, noise]) trackNode(node);
    activeNodes.add(bus);
    activeNodes.add(low);
    activeNodes.add(wobbleGain);
    activeNodes.add(noiseFilter);
    activeNodes.add(noiseGain);

    sub.start(start);
    wobble.start(start);
    noise.start(start);
    sub.stop(start + duration + 0.08);
    wobble.stop(start + duration + 0.08);
    noise.stop(start + duration + 0.08);

    trackTimer(setTimeout(() => {
      for (const node of [bus, low, wobbleGain, noiseFilter, noiseGain]) {
        activeNodes.delete(node);
        try {
          node.disconnect();
        } catch {}
      }
    }, Math.max(0, (start + duration + 0.2 - audio.currentTime) * 1000)));
  }

  function playBlast(start, intensity = 1) {
    const bus = audio.createGain();
    const boom = audio.createOscillator();
    const boomGain = audio.createGain();
    const crack = audio.createBufferSource();
    const crackFilter = audio.createBiquadFilter();
    const crackGain = audio.createGain();

    bus.gain.setValueAtTime(0.78 * intensity, start);
    bus.gain.exponentialRampToValueAtTime(0.0001, start + 1.45);

    boom.type = 'triangle';
    boom.frequency.setValueAtTime(pitchHz(78), start);
    boom.frequency.exponentialRampToValueAtTime(pitchHz(32), start + 0.52);
    boomGain.gain.setValueAtTime(0.34 * intensity, start);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);

    crack.buffer = makeNoiseBuffer();
    crackFilter.type = 'highpass';
    crackFilter.frequency.setValueAtTime(pitchHz(520), start);
    crackFilter.frequency.exponentialRampToValueAtTime(pitchHz(150), start + 0.42);
    crackGain.gain.setValueAtTime(0.42 * intensity, start);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.72);

    boom.connect(boomGain);
    boomGain.connect(bus);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(bus);
    bus.connect(output);

    for (const node of [boom, crack]) trackNode(node);
    activeNodes.add(bus);
    activeNodes.add(boomGain);
    activeNodes.add(crackFilter);
    activeNodes.add(crackGain);

    boom.start(start);
    crack.start(start);
    boom.stop(start + 1.2);
    crack.stop(start + 0.8);

    trackTimer(setTimeout(() => {
      for (const node of [bus, boomGain, crackFilter, crackGain]) {
        activeNodes.delete(node);
        try {
          node.disconnect();
        } catch {}
      }
    }, Math.max(0, (start + 1.6 - audio.currentTime) * 1000)));
  }

  function playSteam(start, duration, intensity = 1) {
    const source = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    source.buffer = makeNoiseBuffer();
    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(pitchHz(1400), start);
    filter.frequency.exponentialRampToValueAtTime(pitchHz(620), start + duration);
    filter.Q.setValueAtTime(0.9, start);
    scheduleEnvelope(gain.gain, start, [
      [0.04, 0.16 * intensity],
      [duration * 0.35, 0.24 * intensity],
      [duration, 0.0001, 'exp']
    ]);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    trackNode(source);
    activeNodes.add(filter);
    activeNodes.add(gain);
    source.start(start);
    source.stop(start + duration + 0.08);

    trackTimer(setTimeout(() => {
      for (const node of [filter, gain]) {
        activeNodes.delete(node);
        try {
          node.disconnect();
        } catch {}
      }
    }, Math.max(0, (start + duration + 0.2 - audio.currentTime) * 1000)));
  }

  function scheduleInitialEruption() {
    if (!state.soundEnabled) return;
    const base = audio.currentTime + INITIAL_ERUPTION_START;
    playRumble(base - 0.32, INITIAL_ERUPTION_DURATION + 0.9, 1);
    playBlast(base + 0.18, 1);
    playSteam(base + 0.55, INITIAL_ERUPTION_DURATION + 0.5, 0.95);

    for (const offset of [0.72, 1.18, 1.82, 2.44, 2.9]) {
      trackTimer(setTimeout(() => {
        if (state.soundEnabled) playBlast(audio.currentTime, 0.35 + Math.random() * 0.22);
      }, Math.max(0, (INITIAL_ERUPTION_START + offset) * 1000)));
    }

    scheduleReEruptionLoop(18 + Math.random() * 10);
  }

  function scheduleReEruptionLoop(delaySeconds) {
    if (!state.soundEnabled) return;
    trackTimer(setTimeout(() => {
      if (!state.soundEnabled) return;
      const now = audio.currentTime;
      playRumble(now, 3.2, 0.55);
      playBlast(now + 0.12, 0.58);
      playSteam(now + 0.4, 2.4, 0.5);
      scheduleReEruptionLoop(19 + Math.random() * 18);
    }, delaySeconds * 1000));
  }

  function stopSound() {
    clearTimers();
    for (const node of activeNodes) {
      try {
        if (typeof node.stop === 'function') node.stop();
      } catch {}
      try {
        node.disconnect();
      } catch {}
    }
    activeNodes.clear();
  }

  function restartTimeline() {
    stopSound();
    if (state.soundEnabled) scheduleInitialEruption();
  }

  const onReload = () => {
    state.loadedAt = Date.now();
    frame.src = `${SOURCE_URL}?jamReload=${state.loadedAt}`;
    restartTimeline();
  };

  const onSoundToggle = () => {
    state.soundEnabled = !state.soundEnabled;
    sound.setAttribute('aria-pressed', state.soundEnabled ? 'true' : 'false');
    if (state.soundEnabled) {
      audio.resume?.();
      restartTimeline();
    } else {
      stopSound();
    }
  };

  reload.addEventListener('click', onReload);
  sound.addEventListener('click', onSoundToggle);
  scheduleInitialEruption();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      reload.removeEventListener('click', onReload);
      sound.removeEventListener('click', onSoundToggle);
      stopSound();
      output.disconnect();
      frame.src = 'about:blank';
    }
  };
}
