// Groove Drum Sequencer Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const voices = ['kick', 'snare', 'hat', 'openHat'];
  const voiceLabels = {
    kick: 'KCK',
    snare: 'SNR',
    hat: 'HAT',
    openHat: 'OPN'
  };
  const grooveStyle = 'lean_on_bounce';

  const defaultPattern = {
    kick: [1, 0, 0, 0.42, 0, 0, 0.88, 0, 0.36, 0, 0, 0, 1, 0, 0.52, 0],
    snare: [0, 0, 0.14, 0, 0.96, 0, 0, 0, 0, 0, 0.18, 0, 1, 0, 0.22, 0],
    hat: [0.32, 0.18, 0.56, 0.2, 0.3, 0.18, 0.62, 0.22, 0.34, 0.18, 0.54, 0.2, 0.32, 0.18, 0.68, 0.24],
    openHat: [0, 0, 0.34, 0, 0, 0, 0.3, 0, 0, 0, 0.36, 0, 0, 0, 0.44, 0]
  };

  const clonePattern = (pattern) => {
    const next = {};
    voices.forEach((voice) => {
      const source = Array.isArray(pattern?.[voice]) ? pattern[voice] : defaultPattern[voice];
      next[voice] = Array.from({ length: 16 }, (_, index) => {
        const value = Number(source[index] || 0);
        return Math.max(0, Math.min(1, value));
      });
    });
    return next;
  };

  const isLegacyQuarterPattern = (steps) => {
    if (!Array.isArray(steps) || steps.length !== 16) return false;
    return steps.every((step, index) => Boolean(step) === [0, 4, 8, 12].includes(index));
  };

  const migratePattern = () => {
    if (prevState?.pattern && prevState.grooveStyle === grooveStyle) return clonePattern(prevState.pattern);
    if (Array.isArray(prevState?.steps) && !isLegacyQuarterPattern(prevState.steps)) {
      const migrated = clonePattern(defaultPattern);
      migrated.kick = prevState.steps.map((step) => step ? 1 : 0).slice(0, 16);
      while (migrated.kick.length < 16) migrated.kick.push(0);
      return migrated;
    }
    return clonePattern(defaultPattern);
  };

  let state = {
    grooveStyle,
    pattern: migratePattern(),
    groove: typeof prevState?.groove === 'number' ? prevState.groove : 0.14,
    variation: prevState?.variation ?? true
  };

  const noiseBuffer = (() => {
    const bufferSize = Math.floor(ctx.audioCtx.sampleRate * 0.7);
    const buffer = ctx.audioCtx.createBuffer(1, bufferSize, ctx.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  })();

  const safeTime = (time) => Math.max(time, ctx.audioCtx.currentTime + 0.001);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 127.1 + salt * 311.7) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const playKick = (time, velocity) => {
    const t = safeTime(time);
    const osc = ctx.audioCtx.createOscillator();
    const click = ctx.audioCtx.createOscillator();
    const gain = ctx.audioCtx.createGain();
    const clickGain = ctx.audioCtx.createGain();

    osc.type = 'sine';
    click.type = 'triangle';
    osc.connect(gain);
    click.connect(clickGain);
    gain.connect(ctx.audioOut);
    clickGain.connect(ctx.audioOut);

    osc.frequency.setValueAtTime(150 + velocity * 25, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.22);
    gain.gain.setValueAtTime(0.95 * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    click.frequency.setValueAtTime(1200, t);
    click.frequency.exponentialRampToValueAtTime(90, t + 0.025);
    clickGain.gain.setValueAtTime(0.14 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    osc.start(t);
    click.start(t);
    osc.stop(t + 0.34);
    click.stop(t + 0.04);
  };

  const playSnare = (time, velocity) => {
    const t = safeTime(time);
    const noise = ctx.audioCtx.createBufferSource();
    const noiseFilter = ctx.audioCtx.createBiquadFilter();
    const noiseGain = ctx.audioCtx.createGain();
    const body = ctx.audioCtx.createOscillator();
    const bodyGain = ctx.audioCtx.createGain();

    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1800 + velocity * 1200, t);
    noiseFilter.Q.setValueAtTime(0.9, t);
    noiseGain.gain.setValueAtTime(0.55 * velocity, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);

    body.type = 'triangle';
    body.frequency.setValueAtTime(190, t);
    body.frequency.exponentialRampToValueAtTime(145, t + 0.12);
    bodyGain.gain.setValueAtTime(0.22 * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.audioOut);
    body.connect(bodyGain);
    bodyGain.connect(ctx.audioOut);

    noise.start(t, 0, 0.2);
    body.start(t);
    body.stop(t + 0.14);
  };

  const playHat = (time, velocity, open = false) => {
    const t = safeTime(time);
    const noise = ctx.audioCtx.createBufferSource();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const gain = ctx.audioCtx.createGain();
    const duration = open ? 0.28 : 0.055;

    noise.buffer = noiseBuffer;
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(open ? 5600 : 7200, t);
    highpass.Q.setValueAtTime(0.8, t);
    gain.gain.setValueAtTime((open ? 0.22 : 0.16) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    noise.connect(highpass);
    highpass.connect(gain);
    gain.connect(ctx.audioOut);
    noise.start(t, 0, duration + 0.02);
  };

  const triggerVoice = (voice, time, velocity) => {
    if (voice === 'kick') playKick(time, velocity);
    if (voice === 'snare') playSnare(time, velocity);
    if (voice === 'hat') playHat(time, velocity, false);
    if (voice === 'openHat') playHat(time, velocity, true);
  };

  const getVelocity = (voice, index, absoluteStep) => {
    let velocity = state.pattern[voice]?.[index] || 0;

    if (state.variation) {
      const phraseStep = absoluteStep % 64;
      if (voice === 'kick' && (phraseStep === 57 || phraseStep === 63)) velocity = Math.max(velocity, 0.46);
      if (voice === 'snare' && [58, 60, 62, 63].includes(phraseStep)) velocity = Math.max(velocity, phraseStep === 63 ? 0.46 : 0.28);
      if (voice === 'hat' && phraseStep >= 56) velocity = Math.max(velocity, phraseStep % 2 ? 0.42 : 0.62);
    }

    if (!velocity) return 0;
    if (velocity < 0.35 && randomFor(absoluteStep, voices.indexOf(voice) + 1) < 0.22) return 0;
    if (voice === 'hat') velocity *= index % 4 === 0 ? 1.16 : index % 2 === 0 ? 0.96 : 0.72;
    return clamp(velocity * (0.92 + randomFor(absoluteStep, voices.indexOf(voice) + 8) * 0.16), 0.04, 1);
  };

  let currentStepIndex = -1;

  const renderUI = () => {
    dom.innerHTML = `
      <style>
        .card {
          width: 260px;
          box-sizing: border-box;
          padding: 10px;
          background: #111827;
          border: 1px solid #22d3ee;
          border-radius: 8px;
          color: #f8fafc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          box-shadow: 0 6px 18px rgba(8, 145, 178, 0.24);
        }
        h3 {
          margin: 0 0 8px;
          color: #67e8f9;
          font-size: 13px;
          line-height: 1.2;
          text-align: center;
          letter-spacing: 0;
        }
        .controls {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 6px;
          margin-bottom: 8px;
          color: #cbd5e1;
          font-size: 10px;
        }
        input[type="range"] {
          width: 118px;
          accent-color: #22d3ee;
        }
        label {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        input[type="checkbox"] {
          accent-color: #22d3ee;
        }
        .matrix {
          display: grid;
          gap: 4px;
        }
        .lane {
          display: grid;
          grid-template-columns: 34px repeat(16, 1fr);
          gap: 2px;
          align-items: center;
        }
        .label {
          color: #94a3b8;
          font-size: 9px;
        }
        .step {
          height: 18px;
          min-width: 0;
          border: 1px solid #334155;
          border-radius: 3px;
          background: #1f2937;
          color: transparent;
          cursor: pointer;
          padding: 0;
          font-size: 9px;
          line-height: 16px;
          text-align: center;
        }
        .step.active {
          color: #082f49;
          background: #22d3ee;
          border-color: #67e8f9;
          box-shadow: 0 0 8px rgba(34, 211, 238, 0.55);
        }
        .step.ghost {
          color: #cffafe;
          background: #155e75;
          border-color: #0891b2;
          box-shadow: none;
        }
        .step.current {
          outline: 2px solid #fb7185;
          outline-offset: 1px;
        }
      </style>
      <div class="card">
        <h3>GROOVE DRUMS</h3>
        <div class="controls">
          <label>Groove <input id="groove" type="range" min="0" max="0.32" step="0.01" value="${state.groove}"></label>
          <label><input id="variation" type="checkbox" ${state.variation ? 'checked' : ''}> Fills</label>
        </div>
        <div class="matrix" id="pattern-matrix"></div>
      </div>
    `;

    const matrix = dom.querySelector('#pattern-matrix');
    voices.forEach((voice) => {
      const lane = document.createElement('div');
      lane.className = 'lane';

      const label = document.createElement('div');
      label.className = 'label';
      label.textContent = voiceLabels[voice];
      lane.appendChild(label);

      state.pattern[voice].forEach((velocity, index) => {
        const stepButton = document.createElement('button');
        stepButton.type = 'button';
        stepButton.className = `step ${velocity ? 'active' : ''} ${velocity > 0 && velocity < 0.5 ? 'ghost' : ''}`;
        stepButton.textContent = velocity ? Math.max(1, Math.round(velocity * 9)) : '';
        stepButton.dataset.voice = voice;
        stepButton.dataset.index = index;
        stepButton.title = `${voiceLabels[voice]} ${index + 1}`;
        lane.appendChild(stepButton);

        stepButton.addEventListener('click', () => {
          const nextPattern = clonePattern(state.pattern);
          const current = nextPattern[voice][index];
          const defaultVelocity = voice === 'hat' || voice === 'openHat' ? 0.55 : 1;
          nextPattern[voice][index] = current > 0.66 ? 0 : current > 0 ? 1 : defaultVelocity;
          ctx.bus.pubGlobal('drum_pattern', nextPattern);
        });
      });

      matrix.appendChild(lane);
    });

    dom.querySelector('#groove').addEventListener('input', (event) => {
      ctx.bus.pubGlobal('drum_groove', Number(event.target.value));
    });

    dom.querySelector('#variation').addEventListener('change', (event) => {
      ctx.bus.pubGlobal('drum_variation', event.target.checked);
    });
  };

  renderUI();

  const unsubPattern = ctx.bus.subGlobal('drum_pattern', (pattern) => {
    state.pattern = clonePattern(pattern);
    renderUI();
  });
  const unsubGroove = ctx.bus.subGlobal('drum_groove', (groove) => {
    state.groove = clamp(Number(groove) || 0, 0, 0.32);
  });
  const unsubVariation = ctx.bus.subGlobal('drum_variation', (variation) => {
    state.variation = Boolean(variation);
    renderUI();
  });

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    const index = step % 16;
    currentStepIndex = index;
    const swingOffset = index % 2 === 1 ? duration * state.groove : 0;

    voices.forEach((voice, voiceIndex) => {
      const velocity = getVelocity(voice, index, step);
      if (!velocity) return;
      const jitter = (randomFor(step, voiceIndex + 20) - 0.5) * 0.008;
      triggerVoice(voice, time + swingOffset + jitter, velocity);
    });
  });

  return {
    update() {
      const steps = dom.querySelectorAll('.step');
      steps.forEach((stepButton) => {
        stepButton.classList.toggle('current', Number(stepButton.dataset.index) === currentStepIndex);
      });
    },
    getState() {
      return state;
    },
    destroy() {
      unsubscribeClock();
      unsubPattern();
      unsubGroove();
      unsubVariation();
    }
  };
}
