const DEFAULT_STATE = {
  enabled: true,
  root: 43,
  scale: "minor",
  pattern: [0, 3, 7, 10, 12, 10, 7, 3],
  wave: "sawtooth",
  tone: 0.58,
  shimmer: 0.42,
  drive: 0.24,
  release: 0.62,
  volume: 0.58,
};

const SCALE_INTERVALS = {
  minor: [0, 2, 3, 5, 7, 8, 10, 12],
  dorian: [0, 2, 3, 5, 7, 9, 10, 12],
  phrygian: [0, 1, 3, 5, 7, 8, 10, 12],
  major: [0, 2, 4, 5, 7, 9, 11, 12],
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function migrateState(prevState) {
  const prev = prevState && typeof prevState === "object" ? prevState : {};
  return {
    ...DEFAULT_STATE,
    ...prev,
    enabled: typeof prev.enabled === "boolean" ? prev.enabled : DEFAULT_STATE.enabled,
    root: clamp(prev.root ?? DEFAULT_STATE.root, 24, 72),
    scale: SCALE_INTERVALS[prev.scale] ? prev.scale : DEFAULT_STATE.scale,
    pattern: Array.isArray(prev.pattern) && prev.pattern.length
      ? prev.pattern.slice(0, 16).map((v) => clamp(v, -12, 24))
      : DEFAULT_STATE.pattern.slice(),
    tone: clamp(prev.tone ?? DEFAULT_STATE.tone, 0, 1),
    shimmer: clamp(prev.shimmer ?? DEFAULT_STATE.shimmer, 0, 1),
    drive: clamp(prev.drive ?? DEFAULT_STATE.drive, 0, 1),
    release: clamp(prev.release ?? DEFAULT_STATE.release, 0, 1),
    volume: clamp(prev.volume ?? DEFAULT_STATE.volume, 0, 1),
    wave: ["sawtooth", "triangle", "square"].includes(prev.wave) ? prev.wave : DEFAULT_STATE.wave,
  };
}

function midiToHz(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function makeCurve(amount) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const k = amount * 38 + 1;
  for (let i = 0; i < samples; i += 1) {
    const x = (i / (samples - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export default function setup(ctx, prevState) {
  const { audioCtx, audioOut, bus, domRoot, clock } = ctx;
  const state = migrateState(prevState);
  const activeSources = new Set();
  const unsubscribers = [];
  let destroyed = false;
  let currentStep = 0;
  let pulse = 0;
  let rafPhase = 0;

  const output = audioCtx.createGain();
  const shaper = audioCtx.createWaveShaper();
  const delay = audioCtx.createDelay(0.75);
  const delayGain = audioCtx.createGain();
  const delayFilter = audioCtx.createBiquadFilter();

  output.gain.value = 0.001;
  shaper.curve = makeCurve(state.drive);
  shaper.oversample = "2x";
  delay.delayTime.value = 0.1875;
  delayGain.gain.value = state.shimmer * 0.26;
  delayFilter.type = "highpass";
  delayFilter.frequency.value = 900;

  output.connect(shaper);
  shaper.connect(audioOut);
  shaper.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayGain);
  delayGain.connect(audioOut);

  function applyContinuousParams(time = audioCtx.currentTime) {
    output.gain.cancelScheduledValues(time);
    output.gain.setTargetAtTime(state.enabled ? state.volume * 0.36 : 0.0001, time, 0.035);
    delayGain.gain.cancelScheduledValues(time);
    delayGain.gain.setTargetAtTime(state.shimmer * 0.26, time, 0.08);
    shaper.curve = makeCurve(state.drive);
  }

  function publishState(key, value) {
    bus.pubGlobal(`elem_6cbc3i1t5:${key}`, value);
  }

  function updateState(key, value) {
    if (key === "root") state.root = clamp(value, 24, 72);
    else if (["tone", "shimmer", "drive", "release", "volume"].includes(key)) state[key] = clamp(value, 0, 1);
    else if (key === "scale" && SCALE_INTERVALS[value]) state.scale = value;
    else if (key === "wave" && ["sawtooth", "triangle", "square"].includes(value)) state.wave = value;
    else if (key === "enabled") state.enabled = Boolean(value);
    applyContinuousParams();
    renderValues();
  }

  function voice(time, note, accent) {
    if (destroyed || !state.enabled) return;

    const freq = midiToHz(note);
    const length = 0.08 + state.release * 0.54;
    const filterBase = 420 + state.tone * 4200;
    const filterPeak = filterBase * (1.55 + accent * 0.75);
    const gainPeak = (0.12 + accent * 0.1) * state.volume;

    const oscA = audioCtx.createOscillator();
    const oscB = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    const pan = audioCtx.createStereoPanner();

    oscA.type = state.wave;
    oscB.type = state.wave === "square" ? "triangle" : state.wave;
    oscA.frequency.setValueAtTime(freq, time);
    oscB.frequency.setValueAtTime(freq * (1.003 + state.shimmer * 0.012), time);

    filter.type = "lowpass";
    filter.Q.setValueAtTime(7 + state.tone * 7, time);
    filter.frequency.setValueAtTime(filterPeak, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(90, filterBase * 0.42), time + length);

    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak), time + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
    pan.pan.setValueAtTime(((currentStep % 4) - 1.5) * 0.18, time);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(output);

    const record = { oscA, oscB, filter, amp, pan };
    activeSources.add(record);
    oscA.onended = () => {
      activeSources.delete(record);
      try {
        oscA.disconnect();
        oscB.disconnect();
        filter.disconnect();
        amp.disconnect();
        pan.disconnect();
      } catch {
        // Already disconnected during teardown.
      }
    };

    oscA.start(time);
    oscB.start(time);
    oscA.stop(time + length + 0.04);
    oscB.stop(time + length + 0.04);
  }

  function noteForStep(step) {
    const patternDegree = state.pattern[step % state.pattern.length];
    const intervals = SCALE_INTERVALS[state.scale] || SCALE_INTERVALS.minor;
    const octave = Math.floor(patternDegree / intervals.length) * 12;
    const degree = ((patternDegree % intervals.length) + intervals.length) % intervals.length;
    return state.root + octave + intervals[degree];
  }

  function render() {
    domRoot.innerHTML = `
      <style>
        :host { display: block; width: 100%; height: 100%; }
        .synth {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
          position: relative;
          color: #eef7ff;
          background:
            radial-gradient(circle at 22% 16%, rgba(49, 196, 141, 0.38), transparent 34%),
            radial-gradient(circle at 84% 36%, rgba(255, 151, 77, 0.28), transparent 38%),
            linear-gradient(145deg, #10151f, #1e2430 48%, #121922);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 8px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 34px rgba(0,0,0,0.32);
        }
        canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          opacity: 0.72;
        }
        .panel {
          position: relative;
          z-index: 2;
          height: 100%;
          padding: 12px;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto 1fr auto;
          gap: 8px;
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .title {
          min-width: 0;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
          line-height: 1;
        }
        .subtitle {
          color: rgba(238, 247, 255, 0.66);
          font-size: 10px;
          margin-top: 3px;
        }
        button {
          width: 34px;
          height: 28px;
          border-radius: 7px;
          border: 1px solid rgba(255,255,255,0.2);
          color: #fff;
          background: rgba(255,255,255,0.12);
          cursor: pointer;
          font-size: 13px;
        }
        button[data-on="true"] {
          background: #31c48d;
          color: #07130f;
          border-color: rgba(255,255,255,0.42);
          box-shadow: 0 0 18px rgba(49, 196, 141, 0.42);
        }
        .steps {
          align-self: center;
          display: grid;
          grid-template-columns: repeat(8, minmax(0, 1fr));
          gap: 5px;
        }
        .dot {
          aspect-ratio: 1;
          min-width: 0;
          border-radius: 6px;
          background: rgba(255,255,255,0.11);
          border: 1px solid rgba(255,255,255,0.12);
          box-shadow: inset 0 -8px 12px rgba(0,0,0,0.16);
          transition: transform 90ms ease, background 90ms ease, box-shadow 90ms ease;
        }
        .dot.live {
          transform: translateY(-2px);
          background: #ff974d;
          box-shadow: 0 0 18px rgba(255, 151, 77, 0.66);
        }
        .controls {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px 10px;
        }
        label {
          display: grid;
          gap: 3px;
          color: rgba(238,247,255,0.72);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0;
        }
        input[type="range"] {
          width: 100%;
          accent-color: #31c48d;
        }
        select {
          width: 100%;
          min-width: 0;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.18);
          background: rgba(9, 13, 20, 0.62);
          color: #eef7ff;
          font-size: 10px;
          padding: 3px 5px;
        }
      </style>
      <div class="synth">
        <canvas></canvas>
        <div class="panel">
          <div class="top">
            <div>
              <div class="title">Glass Pulse</div>
              <div class="subtitle">clocked synth voice</div>
            </div>
            <button id="enabled" title="Toggle synth" data-on="${state.enabled}">${state.enabled ? "I" : "O"}</button>
          </div>
          <div class="steps" aria-hidden="true">
            ${state.pattern.map((_, i) => `<div class="dot" data-step="${i}"></div>`).join("")}
          </div>
          <div class="controls">
            <label>Scale
              <select id="scale">
                ${Object.keys(SCALE_INTERVALS).map((name) => `<option value="${name}" ${state.scale === name ? "selected" : ""}>${name}</option>`).join("")}
              </select>
            </label>
            <label>Wave
              <select id="wave">
                ${["sawtooth", "triangle", "square"].map((name) => `<option value="${name}" ${state.wave === name ? "selected" : ""}>${name}</option>`).join("")}
              </select>
            </label>
            <label>Tone <input id="tone" type="range" min="0" max="1" step="0.01" value="${state.tone}"></label>
            <label>Shimmer <input id="shimmer" type="range" min="0" max="1" step="0.01" value="${state.shimmer}"></label>
            <label>Drive <input id="drive" type="range" min="0" max="1" step="0.01" value="${state.drive}"></label>
            <label>Release <input id="release" type="range" min="0" max="1" step="0.01" value="${state.release}"></label>
          </div>
        </div>
      </div>
    `;

    const bindRange = (id) => {
      const node = domRoot.querySelector(`#${id}`);
      node.addEventListener("input", () => publishState(id, Number(node.value)));
    };
    ["tone", "shimmer", "drive", "release"].forEach(bindRange);

    domRoot.querySelector("#scale").addEventListener("change", (event) => publishState("scale", event.target.value));
    domRoot.querySelector("#wave").addEventListener("change", (event) => publishState("wave", event.target.value));
    domRoot.querySelector("#enabled").addEventListener("click", () => publishState("enabled", !state.enabled));
  }

  function renderValues() {
    const enabled = domRoot.querySelector("#enabled");
    if (enabled) {
      enabled.dataset.on = String(state.enabled);
      enabled.textContent = state.enabled ? "I" : "O";
    }
    ["tone", "shimmer", "drive", "release"].forEach((id) => {
      const node = domRoot.querySelector(`#${id}`);
      if (node && Number(node.value) !== state[id]) node.value = state[id];
    });
    const scale = domRoot.querySelector("#scale");
    const wave = domRoot.querySelector("#wave");
    if (scale) scale.value = state.scale;
    if (wave) wave.value = state.wave;
  }

  function draw() {
    const canvas = domRoot.querySelector("canvas");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const g = canvas.getContext("2d");
    g.clearRect(0, 0, width, height);
    rafPhase += 0.018;
    pulse *= 0.9;

    for (let i = 0; i < 22; i += 1) {
      const x = (i / 21) * width;
      const y = height * (0.48 + Math.sin(rafPhase + i * 0.7) * 0.11);
      const radius = (8 + Math.sin(rafPhase * 1.6 + i) * 5 + pulse * 18) * dpr;
      g.beginPath();
      g.fillStyle = i % 2 ? "rgba(49,196,141,0.18)" : "rgba(255,151,77,0.16)";
      g.arc(x, y, Math.max(2, radius), 0, Math.PI * 2);
      g.fill();
    }
  }

  render();
  applyContinuousParams();

  ["enabled", "scale", "wave", "tone", "shimmer", "drive", "release", "volume", "root"].forEach((key) => {
    unsubscribers.push(bus.subGlobal(`elem_6cbc3i1t5:${key}`, (value) => updateState(key, value)));
  });

  unsubscribers.push(bus.sub("filter_cutoff", (value) => {
    if (typeof value === "number") {
      state.tone = clamp((value - 220) / 7600, 0, 1);
      renderValues();
    }
  }));

  const unsubscribeClock = clock.onTick(({ step, time }) => {
    currentStep = step % state.pattern.length;
    pulse = 1;
    const accent = currentStep % 4 === 0 ? 1 : 0.35;
    voice(time, noteForStep(currentStep), accent);
    if (currentStep % 2 === 0) {
      voice(time + 0.018, noteForStep(currentStep) + 12, accent * state.shimmer * 0.6);
    }
    bus.pub("glass_pulse_note", { note: noteForStep(currentStep), step: currentStep });
  });

  return {
    update() {
      draw();
      domRoot.querySelectorAll(".dot").forEach((dot, index) => {
        dot.classList.toggle("live", index === currentStep && pulse > 0.18);
      });
    },
    getState() {
      return {
        enabled: state.enabled,
        root: state.root,
        scale: state.scale,
        pattern: state.pattern.slice(),
        wave: state.wave,
        tone: state.tone,
        shimmer: state.shimmer,
        drive: state.drive,
        release: state.release,
        volume: state.volume,
      };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      unsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
      activeSources.forEach(({ oscA, oscB, filter, amp, pan }) => {
        try {
          oscA.stop();
          oscB.stop();
        } catch {
          // Oscillators may already be stopped.
        }
        try {
          oscA.disconnect();
          oscB.disconnect();
          filter.disconnect();
          amp.disconnect();
          pan.disconnect();
        } catch {
          // Nodes may already be disconnected.
        }
      });
      activeSources.clear();
      try {
        output.disconnect();
        shaper.disconnect();
        delay.disconnect();
        delayFilter.disconnect();
        delayGain.disconnect();
      } catch {
        // Nodes may already be disconnected.
      }
      domRoot.innerHTML = "";
    },
  };
}