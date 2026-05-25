// Drum Step Sequencer Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    steps: prevState?.steps || [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    instrument: prevState?.instrument || 'kick',
    pitch: prevState?.pitch || 60,
    ...prevState
  };

  // Web Audio trigger node
  const playTrigger = (time) => {
    if (state.instrument === 'kick') {
      const osc = ctx.audioCtx.createOscillator();
      const gain = ctx.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(ctx.audioOut);

      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);
      gain.gain.setValueAtTime(1, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);

      osc.start(time);
      osc.stop(time + 0.3);
    } else if (state.instrument === 'snare') {
      // White noise snare
      const bufferSize = ctx.audioCtx.sampleRate * 0.2;
      const buffer = ctx.audioCtx.createBuffer(1, bufferSize, ctx.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1000;

      const gain = ctx.audioCtx.createGain();
      gain.gain.setValueAtTime(0.7, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.audioOut);

      noise.start(time);
      noise.stop(time + 0.2);
    } else {
      // Hi-Hat/Click
      const osc = ctx.audioCtx.createOscillator();
      const gain = ctx.audioCtx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(ctx.audioOut);

      osc.frequency.setValueAtTime(8000, time);
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

      osc.start(time);
      osc.stop(time + 0.06);
    }
  };

  const renderUI = () => {
    dom.innerHTML = `
      <style>
        .card {
          background: rgba(20, 25, 35, 0.95);
          border: 2px solid #06b6d4;
          border-radius: 12px;
          padding: 15px;
          color: #fff;
          font-family: monospace;
          box-shadow: 0 4px 20px rgba(6, 182, 212, 0.2);
          width: 340px;
          box-sizing: border-box;
        }
        h3 { margin: 0 0 10px 0; color: #06b6d4; text-align: center; font-size: 14px; }
        .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; align-items: center; }
        .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin: 10px 0; }
        .step {
          height: 24px;
          background: #1e293b;
          border: 1px solid #475569;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: bold;
        }
        .step.active {
          background: #06b6d4;
          border-color: #22d3ee;
          box-shadow: 0 0 8px #06b6d4;
          color: #0f172a;
        }
        .step.current {
          outline: 2px solid #f43f5e;
        }
      </style>
      <div class="card">
        <h3>🥁 STEP SEQUENCER</h3>
        <div class="row">
          <span>Instrument:</span>
          <select id="inst-select" style="background:#1e1e24; color:white; border:1px solid #06b6d4; border-radius:4px; padding:2px;">
            <option value="kick" ${state.instrument==='kick'?'selected':''}>Kick Drum</option>
            <option value="snare" ${state.instrument==='snare'?'selected':''}>Snare Drum</option>
            <option value="hat" ${state.instrument==='hat'?'selected':''}>Hi-Hat</option>
          </select>
        </div>
        <div class="grid" id="steps-grid"></div>
      </div>
    `;

    const grid = dom.querySelector('#steps-grid');
    grid.innerHTML = '';
    state.steps.forEach((active, index) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = `step ${active ? 'active' : ''}`;
      stepDiv.textContent = index + 1;
      stepDiv.dataset.index = index;
      grid.appendChild(stepDiv);

      stepDiv.addEventListener('click', () => {
        const nextSteps = [...state.steps];
        nextSteps[index] = nextSteps[index] ? 0 : 1;
        ctx.bus.pubGlobal('seq_steps', nextSteps);
      });
    });

    const instSelect = dom.querySelector('#inst-select');
    instSelect.addEventListener('change', (e) => {
      ctx.bus.pubGlobal('seq_inst', e.target.value);
    });
  };

  renderUI();

  // Watch global state changes
  const unsub1 = ctx.bus.subGlobal('seq_steps', (steps) => {
    state.steps = steps;
    renderUI();
  });
  const unsub2 = ctx.bus.subGlobal('seq_inst', (inst) => {
    state.instrument = inst;
    renderUI();
  });

  let currentStepIndex = -1;

  // Clock ticks subscription
  const unsubscribeClock = ctx.clock.onTick(({ step, time }) => {
    const idx = step % state.steps.length;
    currentStepIndex = idx;
    
    // Schedule actual Web Audio events
    if (state.steps[idx] === 1) {
      playTrigger(time);
    }
  });

  return {
    update(tick) {
      // Highlight current playhead step visually
      const steps = dom.querySelectorAll('.step');
      steps.forEach((s, idx) => {
        if (idx === currentStepIndex) {
          s.classList.add('current');
        } else {
          s.classList.remove('current');
        }
      });
    },
    getState() {
      return state;
    },
    destroy() {
      unsubscribeClock();
      unsub1();
      unsub2();
    }
  };
}