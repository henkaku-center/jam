// 808 Sub Bass Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const defaultSequence = [33, null, null, 33, 36, null, null, null, 31, null, null, 31, null, null, 36, null];
  const defaultVelocities = [1, 0, 0, 0.58, 0.78, 0, 0, 0, 0.9, 0, 0, 0.55, 0, 0, 0.86, 0];
  const scaleChoices = [null, 28, 31, 33, 36, 38, 40, 43, 45];

  const cloneSequence = (sequence) => {
    const source = Array.isArray(sequence) ? sequence : defaultSequence;
    return Array.from({ length: 16 }, (_, index) => Number.isFinite(source[index]) ? source[index] : null);
  };

  const state = {
    enabled: prevState?.enabled ?? true,
    sequence: cloneSequence(prevState?.sequence),
    velocities: Array.isArray(prevState?.velocities) ? prevState.velocities.slice(0, 16) : defaultVelocities.slice(),
    volume: Number.isFinite(prevState?.volume) ? prevState.volume : 0.82,
    drive: Number.isFinite(prevState?.drive) ? prevState.drive : 0.58,
    tone: Number.isFinite(prevState?.tone) ? prevState.tone : 0.42,
    decay: Number.isFinite(prevState?.decay) ? prevState.decay : 0.72,
    glide: Number.isFinite(prevState?.glide) ? prevState.glide : 0.08
  };
  while (state.velocities.length < 16) state.velocities.push(0);

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const noteLabel = (midi) => Number.isFinite(midi) ? noteNames[(midi + 1200) % 12] : '-';

  const output = ctx.audioCtx.createGain();
  const analyser = ctx.audioCtx.createAnalyser();
  output.gain.setValueAtTime(state.volume, now());
  analyser.fftSize = 128;
  output.connect(analyser);
  analyser.connect(ctx.audioOut);

  const makeShaper = (amount) => {
    const curve = new Float32Array(2048);
    const k = 1 + amount * 46;
    for (let i = 0; i < curve.length; i += 1) {
      const x = i * 2 / curve.length - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  };

  let currentStep = -1;
  let pulse = 0;
  let lastMidi = state.sequence.find(Number.isFinite) || 33;
  const activeNodes = new Set();

  const remember = (...nodes) => nodes.forEach((node) => activeNodes.add(node));
  const forgetLater = (stopAt, ...nodes) => {
    setTimeout(() => {
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (e) {}
        activeNodes.delete(node);
      });
    }, Math.max(100, (stopAt - now()) * 1000 + 100));
  };

  const triggerBass = (midi, velocity, time, duration) => {
    if (!state.enabled) return;
    const t = Math.max(time, now() + 0.003);
    const targetFreq = midiToFreq(midi);
    const startFreq = midiToFreq(lastMidi);
    const noteLength = duration * (2.4 + state.decay * 5.2);
    const stopAt = t + noteLength + 0.18;

    const sub = ctx.audioCtx.createOscillator();
    const body = ctx.audioCtx.createOscillator();
    const click = ctx.audioCtx.createOscillator();
    const subGain = ctx.audioCtx.createGain();
    const bodyGain = ctx.audioCtx.createGain();
    const clickGain = ctx.audioCtx.createGain();
    const shaper = ctx.audioCtx.createWaveShaper();
    const lowpass = ctx.audioCtx.createBiquadFilter();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const amp = ctx.audioCtx.createGain();

    sub.type = 'sine';
    body.type = 'sawtooth';
    click.type = 'triangle';
    shaper.curve = makeShaper(state.drive);
    shaper.oversample = '4x';
    lowpass.type = 'lowpass';
    highpass.type = 'highpass';

    sub.frequency.setValueAtTime(startFreq, t);
    sub.frequency.exponentialRampToValueAtTime(Math.max(20, targetFreq * 1.9), t + 0.018);
    sub.frequency.exponentialRampToValueAtTime(targetFreq, t + 0.045 + state.glide * 0.12);
    body.frequency.setValueAtTime(targetFreq, t);
    body.detune.setValueAtTime(-5, t);
    click.frequency.setValueAtTime(1200, t);
    click.frequency.exponentialRampToValueAtTime(70, t + 0.022);

    subGain.gain.setValueAtTime(0.92 * velocity, t);
    subGain.gain.setTargetAtTime(0.0001, t + noteLength * 0.7, 0.13 + state.decay * 0.08);
    bodyGain.gain.setValueAtTime(0.22 * velocity * state.drive, t);
    bodyGain.gain.setTargetAtTime(0.0001, t + noteLength * 0.48, 0.07);
    clickGain.gain.setValueAtTime(0.18 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    lowpass.frequency.setValueAtTime(180 + state.tone * 1900 + velocity * 420, t);
    lowpass.frequency.exponentialRampToValueAtTime(92 + state.tone * 760, t + noteLength);
    lowpass.Q.setValueAtTime(1.2 + state.drive * 2.8, t);
    highpass.frequency.setValueAtTime(24, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(state.volume, t + 0.01);
    amp.gain.setTargetAtTime(0.0001, t + noteLength, 0.07);

    sub.connect(subGain);
    body.connect(bodyGain);
    click.connect(clickGain);
    subGain.connect(shaper);
    bodyGain.connect(shaper);
    clickGain.connect(shaper);
    shaper.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(amp);
    amp.connect(output);

    sub.start(t);
    body.start(t);
    click.start(t);
    sub.stop(stopAt);
    body.stop(stopAt);
    click.stop(t + 0.04);
    lastMidi = midi;
    pulse = Math.max(pulse, velocity);

    remember(sub, body, click, subGain, bodyGain, clickGain, shaper, lowpass, highpass, amp);
    forgetLater(stopAt, sub, body, click, subGain, bodyGain, clickGain, shaper, lowpass, highpass, amp);
  };

  const render = () => {
    dom.innerHTML = `
      <style>
        .bass {
          width: 260px;
          height: 200px;
          box-sizing: border-box;
          padding: 8px;
          background: #0b0b0c;
          border: 1px solid #fb923c;
          border-radius: 8px;
          color: #fff7ed;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(251, 146, 60, 0.22);
        }
        h3 {
          margin: 0 0 6px;
          color: #fed7aa;
          font-size: 12px;
          text-align: center;
          letter-spacing: 0;
        }
        .scope {
          height: 42px;
          margin-bottom: 6px;
          background: #050505;
          border: 1px solid #431407;
          border-radius: 6px;
          overflow: hidden;
        }
        canvas {
          display: block;
          width: 100%;
          height: 100%;
        }
        .controls {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 5px;
          margin-bottom: 7px;
        }
        label {
          display: grid;
          gap: 1px;
          color: #fed7aa;
          font-size: 7px;
        }
        input[type="range"] {
          width: 100%;
          accent-color: #fb923c;
        }
        .seq {
          display: grid;
          grid-template-columns: repeat(16, 1fr);
          gap: 2px;
          margin-bottom: 7px;
        }
        .note {
          height: 18px;
          min-width: 0;
          padding: 0;
          border: 0;
          border-radius: 3px;
          background: #1f1309;
          color: #ffedd5;
          font: inherit;
          font-size: 7px;
          cursor: pointer;
        }
        .note.on {
          background: #ea580c;
          color: #111827;
          box-shadow: 0 0 8px rgba(234, 88, 12, 0.7);
        }
        .note.current {
          background: #facc15;
          color: #1f1300;
        }
        .footer {
          display: grid;
          grid-template-columns: 1fr 58px;
          gap: 7px;
          align-items: center;
          color: #fdba74;
          font-size: 9px;
        }
        button {
          height: 22px;
          border: 1px solid #fb923c;
          border-radius: 4px;
          background: ${state.enabled ? '#fb923c' : '#1f1309'};
          color: ${state.enabled ? '#1f1300' : '#fed7aa'};
          font: inherit;
          font-size: 9px;
          cursor: pointer;
        }
      </style>
      <div class="bass">
        <h3>808 SUB BASS</h3>
        <div class="scope"><canvas id="bass-scope" width="242" height="42"></canvas></div>
        <div class="controls">
          <label>Vol <input id="volume" type="range" min="0" max="1" step="0.01" value="${state.volume}"></label>
          <label>Drive <input id="drive" type="range" min="0" max="1" step="0.01" value="${state.drive}"></label>
          <label>Tone <input id="tone" type="range" min="0" max="1" step="0.01" value="${state.tone}"></label>
          <label>Decay <input id="decay" type="range" min="0.15" max="1" step="0.01" value="${state.decay}"></label>
          <label>Glide <input id="glide" type="range" min="0" max="1" step="0.01" value="${state.glide}"></label>
        </div>
        <div class="seq" id="bass-seq"></div>
        <div class="footer">
          <span>Click notes to cycle pitch/rest</span>
          <button id="enabled">${state.enabled ? 'Bass On' : 'Muted'}</button>
        </div>
      </div>
    `;

    ['volume', 'drive', 'tone', 'decay', 'glide'].forEach((key) => {
      const input = dom.querySelector(`#${key}`);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        state[key] = value;
        if (key === 'volume') output.gain.setTargetAtTime(value, now(), 0.03);
        ctx.bus.pubGlobal(`bass_${key}`, value);
      });
    });

    dom.querySelector('#enabled').addEventListener('click', () => {
      ctx.bus.pubGlobal('bass_enabled', !state.enabled);
    });

    const seq = dom.querySelector('#bass-seq');
    state.sequence.forEach((midi, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `note ${Number.isFinite(midi) ? 'on' : ''}`;
      button.textContent = noteLabel(midi);
      button.dataset.index = String(index);
      button.addEventListener('click', () => {
        const next = cloneSequence(state.sequence);
        const currentIndex = scaleChoices.findIndex((choice) => choice === next[index]);
        next[index] = scaleChoices[(currentIndex + 1) % scaleChoices.length];
        ctx.bus.pubGlobal('bass_sequence', next);
      });
      seq.appendChild(button);
    });
  };

  render();

  const unsubscribers = [
    ctx.bus.subGlobal('bass_enabled', (enabled) => {
      state.enabled = Boolean(enabled);
      render();
    }),
    ctx.bus.subGlobal('bass_sequence', (sequence) => {
      state.sequence = cloneSequence(sequence);
      render();
    }),
    ...['volume', 'drive', 'tone', 'decay', 'glide'].map((key) => ctx.bus.subGlobal(`bass_${key}`, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      state[key] = number;
      if (key === 'volume') output.gain.setTargetAtTime(number, now(), 0.03);
      const input = dom.querySelector(`#${key}`);
      if (input) input.value = String(number);
    }))
  ];

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    currentStep = step % 16;
    const midi = state.sequence[currentStep];
    const velocity = state.velocities[currentStep] || 0.85;
    if (Number.isFinite(midi)) triggerBass(midi, velocity, time, duration);
  });

  const waveData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  return {
    update() {
      pulse *= 0.9;
      const canvas = dom.querySelector('#bass-scope');
      if (canvas) {
        const g = canvas.getContext('2d');
        analyser.getByteTimeDomainData(waveData);
        analyser.getByteFrequencyData(freqData);
        let low = pulse;
        for (let i = 0; i < 8; i += 1) low += freqData[i] / 255 / 8;
        low = clamp(low, 0, 1.3);
        g.fillStyle = `rgba(5, 5, 5, ${0.28 - Math.min(0.12, low * 0.06)})`;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = `rgba(251, 146, 60, ${0.16 + low * 0.42})`;
        for (let i = 0; i < 18; i += 1) {
          const magnitude = freqData[i] / 255;
          const h = magnitude * (16 + low * 24);
          g.fillRect(i * 14, canvas.height - h, 9, h);
        }
        g.strokeStyle = `rgba(255, 237, 213, ${0.38 + low * 0.32})`;
        g.lineWidth = 2 + low * 2;
        g.beginPath();
        for (let i = 0; i < waveData.length; i += 1) {
          const x = i / (waveData.length - 1) * canvas.width;
          const y = waveData[i] / 255 * canvas.height;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      dom.querySelectorAll('.note').forEach((note) => {
        note.classList.toggle('current', Number(note.dataset.index) === currentStep);
      });
    },
    getState() {
      return {
        enabled: state.enabled,
        sequence: cloneSequence(state.sequence),
        velocities: state.velocities.slice(),
        volume: state.volume,
        drive: state.drive,
        tone: state.tone,
        decay: state.decay,
        glide: state.glide
      };
    },
    destroy() {
      unsubscribeClock();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      activeNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (e) {}
        try { node.disconnect(); } catch (e) {}
      });
      try { output.disconnect(); } catch (e) {}
      try { analyser.disconnect(); } catch (e) {}
    }
  };
}
