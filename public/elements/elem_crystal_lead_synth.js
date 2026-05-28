// Crystal Lead Synth Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const moodVersion = 'laidback-v1';
  const isLaidBackState = prevState?.moodVersion === moodVersion;
  const defaultSequence = [12, null, null, null, 10, null, null, 7, null, null, 10, null, 12, null, null, null];
  const scaleChoices = [null, 7, 10, 12, 15, 17, 19, 22, 24, 27];
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const cloneSequence = (sequence) => {
    const source = Array.isArray(sequence) ? sequence : defaultSequence;
    return Array.from({ length: 16 }, (_, index) => {
      const value = source[index];
      return Number.isFinite(value) ? value : null;
    });
  };

  const state = {
    moodVersion,
    enabled: prevState?.enabled ?? true,
    rootMidi: isLaidBackState && Number.isFinite(prevState?.rootMidi) ? prevState.rootMidi : 57,
    sequence: cloneSequence(isLaidBackState ? prevState?.sequence : defaultSequence),
    tone: isLaidBackState && Number.isFinite(prevState?.tone) ? prevState.tone : 0.42,
    drive: isLaidBackState && Number.isFinite(prevState?.drive) ? prevState.drive : 0.16,
    echo: isLaidBackState && Number.isFinite(prevState?.echo) ? prevState.echo : 0.46,
    space: isLaidBackState && Number.isFinite(prevState?.space) ? prevState.space : 0.42,
    width: isLaidBackState && Number.isFinite(prevState?.width) ? prevState.width : 0.58,
    density: isLaidBackState && Number.isFinite(prevState?.density) ? prevState.density : 0.48
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 91.71 + salt * 267.13) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const velocities = [0.9, 0, 0.62, 0.5, 0, 0.56, 0.42, 0, 0.48, 0, 0.68, 0.55, 0, 0.82, 0.44, 0];
  const noteLabel = (offset) => {
    if (!Number.isFinite(offset)) return '-';
    return noteNames[(state.rootMidi + offset + 1200) % 12];
  };

  const output = ctx.audioCtx.createGain();
  const dry = ctx.audioCtx.createGain();
  const delaySend = ctx.audioCtx.createGain();
  const reverbSend = ctx.audioCtx.createGain();
  const delay = ctx.audioCtx.createDelay(1.2);
  const delayFeedback = ctx.audioCtx.createGain();
  const delayFilter = ctx.audioCtx.createBiquadFilter();
  const convolver = ctx.audioCtx.createConvolver();
  const reverbGain = ctx.audioCtx.createGain();
  const analyser = ctx.audioCtx.createAnalyser();

  output.gain.setValueAtTime(0.48, now());
  dry.gain.setValueAtTime(0.9, now());
  delay.delayTime.setValueAtTime(60 / 90 * 0.5, now());
  delayFeedback.gain.setValueAtTime(0.28, now());
  delayFilter.type = 'lowpass';
  delayFilter.frequency.setValueAtTime(4200, now());
  analyser.fftSize = 128;

  const makeImpulse = () => {
    const sampleRate = ctx.audioCtx.sampleRate;
    const length = Math.floor(sampleRate * 1.3);
    const impulse = ctx.audioCtx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const fade = Math.pow(1 - i / length, 2.4);
        data[i] = (Math.random() * 2 - 1) * fade * 0.55;
      }
    }
    return impulse;
  };

  convolver.buffer = makeImpulse();
  delaySend.gain.setValueAtTime(state.echo, now());
  reverbSend.gain.setValueAtTime(state.space, now());
  reverbGain.gain.setValueAtTime(0.34, now());

  dry.connect(output);
  output.connect(analyser);
  analyser.connect(ctx.audioOut);
  delaySend.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayFilter.connect(output);
  reverbSend.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  const makeShaper = (amount) => {
    const samples = 2048;
    const curve = new Float32Array(samples);
    const k = 1 + amount * 38;
    for (let i = 0; i < samples; i += 1) {
      const x = i * 2 / samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  };

  const makeLeadWave = () => {
    const real = new Float32Array(24);
    const imag = new Float32Array(24);
    real[0] = 0;
    imag[1] = 0.9;
    imag[2] = 0.34;
    imag[3] = 0.22;
    imag[4] = 0.12;
    imag[5] = 0.09;
    imag[7] = 0.05;
    imag[11] = 0.03;
    return ctx.audioCtx.createPeriodicWave(real, imag, { disableNormalization: false });
  };

  const leadWave = makeLeadWave();
  const activeNodes = new Set();

  const remember = (...nodes) => {
    nodes.forEach((node) => activeNodes.add(node));
  };

  const forgetLater = (time, ...nodes) => {
    const ms = Math.max(80, (time - now()) * 1000 + 100);
    setTimeout(() => {
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (e) {}
        activeNodes.delete(node);
      });
    }, ms);
  };

  const setParam = (param, value, time = now(), smoothing = 0.025) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const updateFx = () => {
    const t = now();
    setParam(delaySend.gain, state.echo, t);
    setParam(reverbSend.gain, state.space, t);
    delayFeedback.gain.setTargetAtTime(0.22 + state.echo * 0.42, t, 0.04);
    delayFilter.frequency.setTargetAtTime(2400 + state.tone * 5200, t, 0.04);
  };

  const triggerNote = (midi, velocity, time, duration, step) => {
    const t = Math.max(time, now() + 0.003);
    const freq = midiToFreq(midi);
    const releaseAt = t + duration * (1.45 + state.density * 0.8);
    const stopAt = releaseAt + 0.55;

    const voiceGain = ctx.audioCtx.createGain();
    const amp = ctx.audioCtx.createGain();
    const shaper = ctx.audioCtx.createWaveShaper();
    const filter = ctx.audioCtx.createBiquadFilter();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const pan = ctx.audioCtx.createStereoPanner();
    const fmOsc = ctx.audioCtx.createOscillator();
    const fmDepth = ctx.audioCtx.createGain();

    shaper.curve = makeShaper(state.drive);
    shaper.oversample = '4x';
    filter.type = 'lowpass';
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(140, t);
    pan.pan.setValueAtTime((randomFor(step, 5) - 0.5) * state.width, t);

    filter.frequency.setValueAtTime(420 + state.tone * 650, t);
    filter.frequency.exponentialRampToValueAtTime(1150 + state.tone * 3000 + velocity * 700, t + 0.09);
    filter.frequency.exponentialRampToValueAtTime(620 + state.tone * 1700, releaseAt);
    filter.Q.setValueAtTime(3.8 + state.drive * 3.5, t);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.13 * velocity, t + 0.04);
    amp.gain.exponentialRampToValueAtTime(0.08 * velocity, t + 0.18);
    amp.gain.setTargetAtTime(0.0001, releaseAt, 0.13);

    voiceGain.gain.setValueAtTime(0.56, t);
    voiceGain.connect(shaper);
    shaper.connect(highpass);
    highpass.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(dry);
    pan.connect(delaySend);
    pan.connect(reverbSend);

    fmOsc.type = 'sine';
    fmOsc.frequency.setValueAtTime(freq * 2.01, t);
    fmDepth.gain.setValueAtTime(freq * (0.008 + state.drive * 0.028), t);
    fmDepth.gain.exponentialRampToValueAtTime(freq * 0.004, t + 0.12);

    const detunes = [-5, -2, 3, 7];
    const oscillators = detunes.map((detune, index) => {
      const osc = ctx.audioCtx.createOscillator();
      osc.setPeriodicWave(leadWave);
      osc.frequency.setValueAtTime(freq * (index === 3 ? 2 : 1), t);
      osc.detune.setValueAtTime(detune * state.width, t);
      osc.detune.linearRampToValueAtTime((detune + (randomFor(step, index) - 0.5) * 4) * state.width, t + 0.08);
      fmDepth.connect(osc.frequency);
      osc.connect(voiceGain);
      osc.start(t);
      osc.stop(stopAt);
      return osc;
    });

    const sub = ctx.audioCtx.createOscillator();
    const subGain = ctx.audioCtx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(freq * 0.5, t);
    subGain.gain.setValueAtTime(0.045 * velocity, t);
    sub.connect(subGain);
    subGain.connect(voiceGain);
    sub.start(t);
    sub.stop(stopAt);

    fmOsc.connect(fmDepth);
    fmOsc.start(t);
    fmOsc.stop(t + 0.16);

    remember(voiceGain, amp, shaper, filter, highpass, pan, fmOsc, fmDepth, sub, subGain, ...oscillators);
    forgetLater(stopAt, voiceGain, amp, shaper, filter, highpass, pan, fmOsc, fmDepth, sub, subGain, ...oscillators);
  };

  let currentStep = -1;
  let pulse = 0;
  let lastBpm = 120;
  let visualPhase = 0;
  const prismBursts = [];

  const spawnPrismBurst = (midi, velocity, step) => {
    const hue = 68 + ((midi - state.rootMidi) * 9) % 110;
    for (let i = 0; i < 9; i += 1) {
      prismBursts.push({
        x: 119,
        y: 36,
        angle: -0.35 + i * 0.087 + (randomFor(step, i + 30) - 0.5) * 0.08,
        speed: 0.8 + velocity * 1.9 + randomFor(step, i + 40) * 0.7,
        life: 1,
        hue: hue + i * 11,
        size: 1.2 + velocity * 2.6
      });
    }
    while (prismBursts.length > 70) prismBursts.shift();
  };

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration, bpm }) => {
    currentStep = step % 16;
    lastBpm = bpm || lastBpm;
    delay.delayTime.setTargetAtTime((60 / lastBpm) * 0.5, Math.max(time, now()), 0.03);
    if (!state.enabled) return;

    const note = state.sequence[currentStep];
    if (note === null) return;
    if (randomFor(step, 11) > state.density) return;

    const phraseOctave = 0;
    const accent = step % 16 === 0 ? 1.08 : 1;
    const velocity = clamp(velocities[currentStep] * accent, 0.1, 1);
    triggerNote(state.rootMidi + note + phraseOctave, velocity, time, duration, step);
    spawnPrismBurst(state.rootMidi + note + phraseOctave, velocity, step);

    if (currentStep === 14 && state.density > 0.72) {
      triggerNote(state.rootMidi + 24, 0.32, time + duration * 0.48, duration * 0.42, step + 1000);
      spawnPrismBurst(state.rootMidi + 24, 0.32, step + 1000);
    }
    pulse = Math.max(pulse, velocity);
  });

  const render = () => {
    dom.innerHTML = `
      <style>
        .lead {
          width: 260px;
          height: 200px;
          box-sizing: border-box;
          padding: 5px;
          background: #0c1117;
          border: 1px solid #a3e635;
          border-radius: 8px;
          color: #f8fafc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow: hidden;
          box-shadow: 0 8px 22px rgba(132, 204, 22, 0.18);
        }
        h3 {
          margin: 0 0 3px;
          font-size: 10px;
          line-height: 1.15;
          color: #bef264;
          text-align: center;
          letter-spacing: 0;
        }
        .scope {
          height: 48px;
          margin-bottom: 4px;
          border: 1px solid #334155;
          background: #05070a;
          border-radius: 6px;
          overflow: hidden;
        }
        canvas {
          display: block;
          width: 100%;
          height: 100%;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 2px 6px;
        }
        label {
          display: grid;
          gap: 0;
          color: #cbd5e1;
          font-size: 7px;
          line-height: 1;
        }
        input[type="range"] {
          width: 100%;
          height: 12px;
          accent-color: #a3e635;
        }
        .footer {
          display: grid;
          grid-template-columns: 1fr 52px;
          gap: 5px;
          align-items: center;
          margin-top: 4px;
        }
        .melody {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 2px;
        }
        .note-cell {
          height: 11px;
          min-width: 0;
          padding: 0;
          border: 0;
          background: #1f2937;
          color: #d9f99d;
          border-radius: 2px;
          font: inherit;
          font-size: 6px;
          line-height: 11px;
          cursor: pointer;
        }
        .note-cell.on {
          background: #4d7c0f;
        }
        .note-cell.current {
          background: #eab308;
          color: #17200b;
          box-shadow: 0 0 8px rgba(234, 179, 8, 0.8);
        }
        button.toggle {
          height: 20px;
          border: 1px solid #a3e635;
          border-radius: 4px;
          background: ${state.enabled ? '#a3e635' : '#1f2937'};
          color: ${state.enabled ? '#17200b' : '#d9f99d'};
          font: inherit;
          font-size: 8px;
          padding: 0 2px;
          cursor: pointer;
        }
      </style>
      <div class="lead">
        <h3>CRYSTAL LEAD</h3>
        <div class="scope"><canvas id="scope" width="248" height="48"></canvas></div>
        <div class="grid">
          <label>Tone <input id="tone" type="range" min="0" max="1" step="0.01" value="${state.tone}"></label>
          <label>Drive <input id="drive" type="range" min="0" max="1" step="0.01" value="${state.drive}"></label>
          <label>Echo <input id="echo" type="range" min="0" max="0.8" step="0.01" value="${state.echo}"></label>
          <label>Space <input id="space" type="range" min="0" max="0.7" step="0.01" value="${state.space}"></label>
          <label>Width <input id="width" type="range" min="0" max="1" step="0.01" value="${state.width}"></label>
          <label>Density <input id="density" type="range" min="0.2" max="1" step="0.01" value="${state.density}"></label>
        </div>
        <div class="footer">
          <div class="melody" id="melody"></div>
          <button class="toggle" id="enabled">${state.enabled ? 'Lead On' : 'Muted'}</button>
        </div>
      </div>
    `;

    const bindRange = (id, key) => {
      const input = dom.querySelector(`#${id}`);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        state[key] = value;
        ctx.bus.pubGlobal(`lead_${key}`, value);
        updateFx();
      });
    };

    ['tone', 'drive', 'echo', 'space', 'width', 'density'].forEach((key) => bindRange(key, key));

    const enabled = dom.querySelector('#enabled');
    enabled.addEventListener('click', () => {
      ctx.bus.pubGlobal('lead_enabled', !state.enabled);
    });

    const melody = dom.querySelector('#melody');
    state.sequence.forEach((note, index) => {
      const stepButton = document.createElement('button');
      stepButton.type = 'button';
      stepButton.className = `note-cell ${note === null ? '' : 'on'}`;
      stepButton.textContent = noteLabel(note);
      stepButton.dataset.index = String(index);
      stepButton.addEventListener('click', () => {
        const nextSequence = cloneSequence(state.sequence);
        const currentChoice = scaleChoices.findIndex((choice) => choice === nextSequence[index]);
        nextSequence[index] = scaleChoices[(currentChoice + 1) % scaleChoices.length];
        ctx.bus.pubGlobal('lead_sequence', nextSequence);
      });
      melody.appendChild(stepButton);
    });
  };

  render();
  updateFx();

  const unsubscribers = [
    ctx.bus.subGlobal('lead_enabled', (enabled) => {
      state.enabled = Boolean(enabled);
      render();
    }),
    ctx.bus.subGlobal('lead_sequence', (sequence) => {
      state.sequence = cloneSequence(sequence);
      render();
    }),
    ...['tone', 'drive', 'echo', 'space', 'width', 'density'].map((key) => ctx.bus.subGlobal(`lead_${key}`, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      state[key] = number;
      const input = dom.querySelector(`#${key}`);
      if (input) input.value = String(number);
      updateFx();
    }))
  ];

  if (!isLaidBackState) {
    state.rootMidi = 57;
    state.sequence = cloneSequence(defaultSequence);
    state.tone = 0.42;
    state.drive = 0.16;
    state.echo = 0.46;
    state.space = 0.42;
    state.width = 0.58;
    state.density = 0.48;
    updateFx();
    render();
  }

  // --- Zefiro wind controller: breath -> master expression, lip -> tone bias ---
  // Base output gain is preserved; breath multiplies it. When no breath has
  // arrived (cc11 still undefined) we keep the original constant level so the
  // synth is usable without the wind controller plugged in.
  const BASE_OUTPUT_GAIN = 0.48;
  let zefiroBreath = null; // 0..1 once first message arrives
  let zefiroLip = null;    // 0..1 once first message arrives

  const applyZefiroExpression = () => {
    const t = now();
    if (zefiroBreath === null) {
      output.gain.setTargetAtTime(BASE_OUTPUT_GAIN, t, 0.02);
    } else {
      // Mild exponential feel so quiet breath stays quiet, like an EWI.
      const env = Math.pow(zefiroBreath, 1.4);
      output.gain.setTargetAtTime(BASE_OUTPUT_GAIN * env, t, 0.015);
    }
  };

  const applyZefiroTone = () => {
    if (zefiroLip === null) return;
    const t = now();
    // Lip biases the delay-filter brightness around whatever 'tone' is set to.
    const toneWithBias = clamp(state.tone + (zefiroLip - 0.5) * 0.6, 0, 1);
    delayFilter.frequency.setTargetAtTime(2400 + toneWithBias * 5200, t, 0.04);
  };

  unsubscribers.push(
    ctx.bus.subGlobal('global:zefiro:cc11', (value) => {
      if (!Number.isFinite(value)) return;
      zefiroBreath = clamp(value, 0, 1);
      applyZefiroExpression();
    }),
    ctx.bus.subGlobal('global:zefiro:cc1', (value) => {
      if (!Number.isFinite(value)) return;
      zefiroLip = clamp(value, 0, 1);
      applyZefiroTone();
    })
  );
  applyZefiroExpression();

  const waveData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);

  return {
    update() {
      pulse *= 0.88;
      const canvas = dom.querySelector('#scope');
      if (canvas) {
        const g = canvas.getContext('2d');
        analyser.getByteTimeDomainData(waveData);
        analyser.getByteFrequencyData(freqData);

        let lowEnergy = 0;
        let midEnergy = 0;
        let highEnergy = 0;
        for (let i = 0; i < freqData.length; i += 1) {
          const value = freqData[i] / 255;
          if (i < 8) lowEnergy += value;
          else if (i < 24) midEnergy += value;
          else highEnergy += value;
        }
        lowEnergy /= 8;
        midEnergy /= 16;
        highEnergy /= Math.max(1, freqData.length - 24);
        const energy = clamp(lowEnergy * 0.55 + midEnergy * 0.75 + highEnergy * 0.35 + pulse * 0.45, 0, 1.5);
        visualPhase += 0.018 + energy * 0.055;

        g.save();
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = `rgba(5, 7, 10, ${0.22 - Math.min(0.16, energy * 0.08)})`;
        g.fillRect(0, 0, canvas.width, canvas.height);

        const bg = g.createLinearGradient(0, 0, canvas.width, canvas.height);
        bg.addColorStop(0, `hsla(${120 + visualPhase * 40}, 85%, 7%, 0.55)`);
        bg.addColorStop(0.45, `hsla(${185 + midEnergy * 90}, 78%, ${7 + energy * 9}%, 0.58)`);
        bg.addColorStop(1, `hsla(${58 + lowEnergy * 90}, 92%, ${8 + pulse * 12}%, 0.65)`);
        g.fillStyle = bg;
        g.fillRect(0, 0, canvas.width, canvas.height);

        g.globalAlpha = 0.24;
        g.strokeStyle = '#334155';
        g.lineWidth = 1;
        for (let x = 18; x < canvas.width; x += 24) {
          g.beginPath();
          g.moveTo(x, 0);
          g.lineTo(x - 28, canvas.height);
          g.stroke();
        }
        g.globalAlpha = 1;

        const centerX = canvas.width * 0.5;
        const centerY = canvas.height * 0.52;
        const prismRadius = 15 + pulse * 5;
        const prism = [
          [centerX, centerY - prismRadius],
          [centerX + prismRadius * 1.12, centerY + prismRadius * 0.76],
          [centerX - prismRadius * 1.12, centerY + prismRadius * 0.76]
        ];

        g.globalCompositeOperation = 'lighter';
        for (let ring = 0; ring < 5; ring += 1) {
          const radius = 10 + ring * 12 + energy * 13 + Math.sin(visualPhase * 2 + ring) * 4;
          g.strokeStyle = `hsla(${95 + ring * 42 + visualPhase * 90}, 94%, ${48 + ring * 4}%, ${0.1 + energy * 0.2})`;
          g.lineWidth = 1 + energy * 1.6;
          g.beginPath();
          for (let i = 0; i <= 80; i += 1) {
            const angle = i / 80 * Math.PI * 2;
            const wave = waveData[(i * 3 + ring * 7) % waveData.length] / 255 - 0.5;
            const r = radius + wave * (9 + energy * 18);
            const x = centerX + Math.cos(angle + visualPhase * (ring % 2 ? -0.7 : 0.7)) * r;
            const y = centerY + Math.sin(angle + visualPhase * (ring % 2 ? -0.7 : 0.7)) * r * 0.55;
            if (i === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }

        for (let i = 0; i < 18; i += 1) {
          const magnitude = freqData[i + 2] / 255;
          const x = i / 17 * canvas.width;
          const h = magnitude * (20 + energy * 28);
          g.fillStyle = `hsla(${72 + i * 13 + visualPhase * 120}, 95%, ${52 + magnitude * 26}%, ${0.2 + magnitude * 0.55})`;
          g.fillRect(x, canvas.height - h, Math.max(4, canvas.width / 22), h);
          g.fillRect(canvas.width - x - Math.max(4, canvas.width / 22), 0, Math.max(4, canvas.width / 22), h * 0.64);
        }

        g.lineWidth = 1.4 + energy * 2.2;
        for (let i = 0; i < 11; i += 1) {
          const y = centerY - 17 + i * 3.4 + Math.sin(visualPhase * 3 + i) * energy * 5;
          g.strokeStyle = `hsla(${64 + i * 19 + visualPhase * 130}, 96%, 62%, ${0.18 + energy * 0.42})`;
          g.beginPath();
          g.moveTo(0, y - energy * 9);
          g.lineTo(centerX - prismRadius * 0.72, centerY);
          g.lineTo(canvas.width, y + 5 + energy * 11);
          g.stroke();
        }

        prismBursts.forEach((burst) => {
          burst.x += Math.cos(burst.angle) * burst.speed;
          burst.y += Math.sin(burst.angle) * burst.speed;
          burst.life *= 0.93;
          g.fillStyle = `hsla(${burst.hue}, 95%, 64%, ${burst.life})`;
          g.beginPath();
          g.arc(burst.x, burst.y, burst.size * burst.life, 0, Math.PI * 2);
          g.fill();
        });
        for (let i = prismBursts.length - 1; i >= 0; i -= 1) {
          if (prismBursts[i].life < 0.04) prismBursts.splice(i, 1);
        }

        const prismFill = g.createLinearGradient(centerX - 20, centerY - 20, centerX + 20, centerY + 20);
        prismFill.addColorStop(0, `hsla(${88 + visualPhase * 80}, 95%, 64%, ${0.28 + energy * 0.24})`);
        prismFill.addColorStop(0.52, `hsla(${178 + midEnergy * 120}, 94%, 62%, ${0.16 + energy * 0.24})`);
        prismFill.addColorStop(1, `hsla(${46 + lowEnergy * 80}, 96%, 58%, ${0.22 + energy * 0.3})`);
        g.fillStyle = prismFill;
        g.beginPath();
        g.moveTo(prism[0][0], prism[0][1]);
        g.lineTo(prism[1][0], prism[1][1]);
        g.lineTo(prism[2][0], prism[2][1]);
        g.closePath();
        g.fill();
        g.strokeStyle = energy > 0.1 ? '#fef08a' : '#bef264';
        g.lineWidth = 1.4 + energy * 1.4;
        g.stroke();

        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = `rgba(248, 250, 252, ${0.36 + energy * 0.36})`;
        g.lineWidth = 1.2;
        g.beginPath();
        for (let i = 0; i < waveData.length; i += 1) {
          const x = i / (waveData.length - 1) * canvas.width;
          const y = 6 + waveData[i] / 255 * (canvas.height - 12);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
      }

      const stepNodes = dom.querySelectorAll('.note-cell');
      stepNodes.forEach((stepNode) => {
        stepNode.classList.toggle('current', Number(stepNode.dataset.index) === currentStep);
      });
    },
    getState() {
      return { ...state };
    },
    destroy() {
      unsubscribeClock();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      activeNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (e) {}
        try { node.disconnect(); } catch (e) {}
      });
      [output, dry, delaySend, reverbSend, delay, delayFeedback, delayFilter, convolver, reverbGain, analyser].forEach((node) => {
        try { node.disconnect(); } catch (e) {}
      });
    }
  };
}
