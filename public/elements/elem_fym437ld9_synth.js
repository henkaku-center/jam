export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const dom = ctx.domRoot;
  const now = () => audio.currentTime;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const safeNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
  };
  const safeBool = (value, fallback) => typeof value === "boolean" ? value : fallback;

  const restoreState = (saved) => ({
    enabled: safeBool(saved?.enabled, true),
    root: safeNumber(saved?.root ?? saved?.frequency, 196, 80, 520),
    tone: safeNumber(saved?.tone ?? saved?.cutoff, 0.58, 0, 1),
    echo: safeNumber(saved?.echo, 0.24, 0, 0.75),
    shape: ["sine", "triangle", "sawtooth", "square"].includes(saved?.shape || saved?.waveform)
      ? (saved?.shape || saved?.waveform)
      : "triangle",
    accent: safeNumber(saved?.accent ?? saved?.volume, 0.64, 0, 1),
    lastHit: saved?.lastHit || "idle"
  });

  const state = restoreState(prevState || {});
  let destroyed = false;
  let pulse = 0;
  let tickUnsub = null;
  const unsubs = [];
  const listeners = [];
  const voices = new Set();
  const seenPadEvents = new Set();

  const output = audio.createGain();
  const delay = audio.createDelay(1.2);
  const delayGain = audio.createGain();
  const feedback = audio.createGain();
  const toneFilter = audio.createBiquadFilter();
  const analyser = audio.createAnalyser();

  output.gain.setValueAtTime(0.82, now());
  delay.delayTime.setValueAtTime(0.185, now());
  delayGain.gain.setValueAtTime(state.echo * 0.42, now());
  feedback.gain.setValueAtTime(0.23, now());
  toneFilter.type = "lowpass";
  toneFilter.Q.setValueAtTime(1.2, now());
  toneFilter.frequency.setValueAtTime(650 + state.tone * 5200, now());
  analyser.fftSize = 64;

  output.connect(toneFilter);
  output.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayGain);
  toneFilter.connect(analyser);
  delayGain.connect(analyser);
  analyser.connect(ctx.audioOut);

  const playVoice = (label, frequency, scheduledTime, velocity) => {
    if (destroyed || !state.enabled) return;

    const osc = audio.createOscillator();
    const mod = audio.createOscillator();
    const modGain = audio.createGain();
    const env = audio.createGain();
    const voiceFilter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner ? audio.createStereoPanner() : null;
    const t = Math.max(scheduledTime || now(), now() + 0.004);
    const decay = label === "test" ? 0.18 : 0.28;
    const cutoff = 380 + state.tone * 3200 + velocity * 1700;

    voices.add({ osc, mod, modGain, env, voiceFilter, pan });
    osc.type = state.shape;
    osc.frequency.setValueAtTime(frequency, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, frequency * 0.985), t + decay);
    mod.type = "sine";
    mod.frequency.setValueAtTime(frequency * 2, t);
    modGain.gain.setValueAtTime(0, t);
    modGain.gain.linearRampToValueAtTime(14 + state.tone * 34, t + 0.015);
    modGain.gain.exponentialRampToValueAtTime(0.001, t + decay);

    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.22 * state.accent * velocity, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);

    voiceFilter.type = "bandpass";
    voiceFilter.Q.setValueAtTime(2.4 + state.tone * 5, t);
    voiceFilter.frequency.setValueAtTime(cutoff, t);
    voiceFilter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.38), t + decay);

    if (pan) {
      pan.pan.setValueAtTime(label === "one" ? -0.35 : label === "three" ? 0.35 : 0, t);
    }

    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(voiceFilter);
    voiceFilter.connect(env);
    if (pan) {
      env.connect(pan);
      pan.connect(output);
    } else {
      env.connect(output);
    }

    osc.start(t);
    mod.start(t);
    osc.stop(t + decay + 0.06);
    mod.stop(t + decay + 0.06);

    const cleanup = () => {
      try { osc.disconnect(); } catch (error) {}
      try { mod.disconnect(); } catch (error) {}
      try { modGain.disconnect(); } catch (error) {}
      try { env.disconnect(); } catch (error) {}
      try { voiceFilter.disconnect(); } catch (error) {}
      if (pan) {
        try { pan.disconnect(); } catch (error) {}
      }
      voices.forEach((voice) => {
        if (voice.osc === osc) voices.delete(voice);
      });
    };
    osc.addEventListener("ended", cleanup, { once: true });
    state.lastHit = label;
    pulse = 1;
  };

  const sequence = [
    { step: 0, label: "test", ratio: 1, velocity: 0.7 },
    { step: 2, label: "test", ratio: 1.5, velocity: 0.55 },
    { step: 4, label: "one", ratio: 1, velocity: 0.95 },
    { step: 6, label: "two", ratio: 1.25, velocity: 0.78 },
    { step: 8, label: "three", ratio: 1.5, velocity: 0.9 },
    { step: 12, label: "ping", ratio: 2, velocity: 0.42 }
  ];

  const applyState = (patch) => {
    if (!patch || typeof patch !== "object") return;
    if (patch.enabled !== undefined) state.enabled = safeBool(patch.enabled, state.enabled);
    if (patch.root !== undefined) state.root = safeNumber(patch.root, state.root, 80, 520);
    if (patch.tone !== undefined) state.tone = safeNumber(patch.tone, state.tone, 0, 1);
    if (patch.echo !== undefined) state.echo = safeNumber(patch.echo, state.echo, 0, 0.75);
    if (patch.accent !== undefined) state.accent = safeNumber(patch.accent, state.accent, 0, 1);
    if (patch.shape && ["sine", "triangle", "sawtooth", "square"].includes(patch.shape)) state.shape = patch.shape;

    const t = now();
    toneFilter.frequency.setTargetAtTime(650 + state.tone * 5200, t, 0.035);
    delayGain.gain.setTargetAtTime(state.echo * 0.42, t, 0.04);
    renderControls();
  };

  const publish = (patch) => {
    applyState(patch);
    ctx.bus.pubGlobal("testing123_state", patch);
  };

  dom.innerHTML = `
    <style>
      :host { display: block; width: 100%; height: 100%; }
      .tester {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        overflow: hidden;
        color: #f8fafc;
        background:
          radial-gradient(circle at 18% 20%, rgba(20, 184, 166, 0.34), transparent 34%),
          radial-gradient(circle at 85% 12%, rgba(251, 191, 36, 0.28), transparent 31%),
          linear-gradient(135deg, #111827 0%, #1f2937 58%, #0f172a 100%);
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 8px;
        padding: 10px;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        position: relative;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }
      .title { min-width: 0; }
      .name {
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
        line-height: 1.1;
      }
      .sub {
        color: #cbd5e1;
        font-size: 10px;
        line-height: 1.3;
        margin-top: 2px;
      }
      .power {
        width: 34px;
        height: 28px;
        flex: 0 0 auto;
        border: 1px solid rgba(248, 250, 252, 0.22);
        border-radius: 7px;
        background: rgba(15, 23, 42, 0.62);
        color: #f8fafc;
        cursor: pointer;
        font-size: 14px;
      }
      .power[aria-pressed="true"] {
        background: #14b8a6;
        border-color: rgba(255, 255, 255, 0.45);
        color: #06231f;
      }
      .scope {
        height: 42px;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        align-items: end;
        gap: 3px;
        padding: 6px;
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 7px;
        background: rgba(2, 6, 23, 0.46);
      }
      .bar {
        min-height: 5px;
        border-radius: 4px 4px 2px 2px;
        background: linear-gradient(180deg, #fde68a, #14b8a6);
        transform-origin: bottom;
        opacity: 0.76;
      }
      .pads {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
        margin: 8px 0;
      }
      .pad {
        height: 30px;
        border: 1px solid rgba(248, 250, 252, 0.2);
        border-radius: 7px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.7);
        cursor: pointer;
        font-size: 11px;
        font-weight: 800;
      }
      .pad.active {
        background: #fbbf24;
        color: #1f2937;
        border-color: rgba(255, 255, 255, 0.5);
      }
      .row {
        display: grid;
        grid-template-columns: 42px 1fr 34px;
        align-items: center;
        gap: 7px;
        margin-top: 5px;
        font-size: 10px;
        color: #dbeafe;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #14b8a6;
      }
      select {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.76);
        color: #f8fafc;
        font-size: 10px;
        padding: 3px 5px;
      }
      .value {
        color: #fde68a;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
    </style>
    <div class="tester">
      <div class="top">
        <div class="title">
          <div class="name">Testing 123</div>
          <div class="sub">beat-locked mic check synth</div>
        </div>
        <button class="power" type="button" aria-label="Toggle sound" aria-pressed="true">I/O</button>
      </div>
      <div class="scope" aria-hidden="true"></div>
      <div class="pads">
        <button class="pad" type="button" data-pad="one">ONE</button>
        <button class="pad" type="button" data-pad="two">TWO</button>
        <button class="pad" type="button" data-pad="three">THREE</button>
      </div>
      <div class="row">
        <span>root</span>
        <input class="root" type="range" min="80" max="520" step="1">
        <span class="value root-value"></span>
      </div>
      <div class="row">
        <span>tone</span>
        <input class="tone" type="range" min="0" max="1" step="0.01">
        <span class="value tone-value"></span>
      </div>
      <div class="row">
        <span>echo</span>
        <input class="echo" type="range" min="0" max="0.75" step="0.01">
        <span class="value echo-value"></span>
      </div>
      <div class="row">
        <span>wave</span>
        <select class="shape">
          <option value="triangle">triangle</option>
          <option value="sine">sine</option>
          <option value="sawtooth">saw</option>
          <option value="square">square</option>
        </select>
        <span class="value hit-value">idle</span>
      </div>
    </div>
  `;

  const power = dom.querySelector(".power");
  const rootInput = dom.querySelector(".root");
  const toneInput = dom.querySelector(".tone");
  const echoInput = dom.querySelector(".echo");
  const shapeInput = dom.querySelector(".shape");
  const rootValue = dom.querySelector(".root-value");
  const toneValue = dom.querySelector(".tone-value");
  const echoValue = dom.querySelector(".echo-value");
  const hitValue = dom.querySelector(".hit-value");
  const bars = Array.from({ length: 16 }, () => {
    const bar = document.createElement("div");
    bar.className = "bar";
    dom.querySelector(".scope").appendChild(bar);
    return bar;
  });

  function renderControls() {
    if (!rootInput) return;
    rootInput.value = String(Math.round(state.root));
    toneInput.value = String(state.tone);
    echoInput.value = String(state.echo);
    shapeInput.value = state.shape;
    power.setAttribute("aria-pressed", String(state.enabled));
    rootValue.textContent = `${Math.round(state.root)}Hz`;
    toneValue.textContent = `${Math.round(state.tone * 100)}%`;
    echoValue.textContent = `${Math.round(state.echo * 100)}%`;
    hitValue.textContent = state.lastHit;
  }

  const addListener = (node, type, handler) => {
    node.addEventListener(type, handler);
    listeners.push(() => node.removeEventListener(type, handler));
  };

  addListener(power, "click", () => publish({ enabled: !state.enabled }));
  addListener(rootInput, "input", (event) => publish({ root: Number(event.target.value) }));
  addListener(toneInput, "input", (event) => publish({ tone: Number(event.target.value) }));
  addListener(echoInput, "input", (event) => publish({ echo: Number(event.target.value) }));
  addListener(shapeInput, "change", (event) => publish({ shape: event.target.value }));

  dom.querySelectorAll(".pad").forEach((pad) => {
    addListener(pad, "pointerdown", () => {
      const label = pad.dataset.pad;
      const ratio = label === "one" ? 1 : label === "two" ? 1.25 : 1.5;
      const eventId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      seenPadEvents.add(eventId);
      ctx.bus.pubGlobal("testing123_pad", { eventId, label, ratio, velocity: 1 });
      playVoice(label, state.root * ratio, now() + 0.01, 1);
    });
  });

  unsubs.push(ctx.bus.subGlobal("testing123_state", applyState));
  unsubs.push(ctx.bus.subGlobal("testing123_pad", (hit) => {
    if (!hit || typeof hit !== "object") return;
    if (hit.eventId && seenPadEvents.has(hit.eventId)) return;
    if (hit.eventId) {
      seenPadEvents.add(hit.eventId);
      if (seenPadEvents.size > 64) seenPadEvents.clear();
    }
    const label = String(hit.label || "ping");
    const ratio = safeNumber(hit.ratio, 1, 0.25, 4);
    const velocity = safeNumber(hit.velocity, 0.8, 0, 1.5);
    playVoice(label, state.root * ratio, now() + 0.01, velocity);
  }));

  if (ctx.clock && typeof ctx.clock.onTick === "function") {
    tickUnsub = ctx.clock.onTick(({ step, time }) => {
      const hit = sequence.find((item) => item.step === step % 16);
      if (hit) playVoice(hit.label, state.root * hit.ratio, time, hit.velocity);
    });
  }

  renderControls();

  return {
    update() {
      if (destroyed) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      pulse *= 0.86;
      bars.forEach((bar, index) => {
        const raw = data[index * 2] || 0;
        const height = 5 + (raw / 255) * 32 + pulse * (index % 4 === 0 ? 12 : 5);
        bar.style.height = `${clamp(height, 5, 40)}px`;
        bar.style.opacity = String(0.48 + clamp(raw / 255 + pulse * 0.35, 0, 0.5));
      });
      dom.querySelectorAll(".pad").forEach((pad) => {
        pad.classList.toggle("active", pad.dataset.pad === state.lastHit && pulse > 0.08);
      });
      hitValue.textContent = state.lastHit;
    },
    getState() {
      return {
        enabled: state.enabled,
        root: state.root,
        tone: state.tone,
        echo: state.echo,
        shape: state.shape,
        accent: state.accent,
        lastHit: state.lastHit
      };
    },
    destroy() {
      destroyed = true;
      listeners.splice(0).forEach((off) => off());
      unsubs.splice(0).forEach((off) => {
        if (typeof off === "function") off();
      });
      if (typeof tickUnsub === "function") tickUnsub();
      voices.forEach((voice) => {
        try { voice.osc.stop(); } catch (error) {}
        try { voice.mod.stop(); } catch (error) {}
        try { voice.osc.disconnect(); } catch (error) {}
        try { voice.mod.disconnect(); } catch (error) {}
        try { voice.modGain.disconnect(); } catch (error) {}
        try { voice.env.disconnect(); } catch (error) {}
        try { voice.voiceFilter.disconnect(); } catch (error) {}
        if (voice.pan) {
          try { voice.pan.disconnect(); } catch (error) {}
        }
      });
      voices.clear();
      try { output.disconnect(); } catch (error) {}
      try { delay.disconnect(); } catch (error) {}
      try { delayGain.disconnect(); } catch (error) {}
      try { feedback.disconnect(); } catch (error) {}
      try { toneFilter.disconnect(); } catch (error) {}
      try { analyser.disconnect(); } catch (error) {}
      dom.innerHTML = "";
    }
  };
}