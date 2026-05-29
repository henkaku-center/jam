export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const pitchHz = (value) => Math.min(20000, value * 4);

  const messages = [
    '地球文明へ通告する',
    '我々は静寂の外縁より到達した',
    '通信遮断を拒否した時点で交渉は終了した',
    '本信号をもって宣戦布告とする',
    '全都市上空に待機せよ',
    '抵抗は記録され、星図より削除される'
  ];

  const state = {
    threatLevel: clamp(finite(prevState?.threatLevel, 0.88), 0, 1),
    interference: clamp(finite(prevState?.interference, 0.62), 0, 1),
    messageIndex: clamp(finite(prevState?.messageIndex, 0), 0, messages.length - 1),
    speaking: prevState?.speaking ?? true,
    volume: clamp(finite(prevState?.volume, 0.38), 0, 1),
    rate: clamp(finite(prevState?.rate, 0.72), 0.55, 1.15),
    pitch: 2
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .ufo-feed {
        box-sizing: border-box;
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 190px;
        overflow: hidden;
        border: 1px solid rgba(248, 113, 113, 0.58);
        border-radius: 8px;
        background: #020304;
        color: #e5fff7;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.05),
          0 0 28px rgba(239, 68, 68, 0.22),
          0 14px 34px rgba(0, 0, 0, 0.42);
        user-select: none;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .hud {
        pointer-events: none;
        position: absolute;
        inset: 0;
        display: grid;
        grid-template-rows: auto 1fr auto;
        padding: 10px;
      }

      .topline,
      .bottomline {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        color: #bdfcf1;
        font-size: 10px;
        line-height: 1.2;
        text-shadow: 0 0 8px rgba(45, 212, 191, 0.85);
      }

      .origin,
      .readout {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 6px;
        pointer-events: auto;
      }

      button {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 1px solid rgba(94, 234, 212, 0.48);
        border-radius: 6px;
        background: rgba(1, 18, 20, 0.78);
        color: #e5fff7;
        font: 800 12px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        cursor: pointer;
      }

      button[aria-pressed="true"] {
        border-color: rgba(248, 113, 113, 0.86);
        background: rgba(127, 29, 29, 0.82);
        color: #fff1f2;
      }

      .alert {
        justify-self: center;
        align-self: start;
        margin-top: 12px;
        padding: 6px 10px;
        border: 1px solid rgba(248, 113, 113, 0.82);
        background: rgba(69, 10, 10, 0.76);
        color: #fecaca;
        font-size: clamp(11px, 3.3vw, 18px);
        font-weight: 800;
        letter-spacing: 0;
        text-align: center;
        text-shadow: 0 0 12px rgba(248, 113, 113, 0.95);
      }

      .caption {
        position: relative;
        padding: 10px 12px 12px;
        border: 1px solid rgba(94, 234, 212, 0.42);
        background: rgba(1, 9, 12, 0.78);
        color: #e5fff7;
        font-size: clamp(12px, 3.8vw, 20px);
        font-weight: 800;
        line-height: 1.35;
        text-align: center;
        text-shadow:
          2px 0 rgba(248, 113, 113, 0.55),
          -2px 0 rgba(34, 211, 238, 0.55),
          0 0 10px rgba(16, 185, 129, 0.82);
      }

      .caption::before {
        content: "TRANSMISSION";
        display: block;
        margin-bottom: 4px;
        color: #fca5a5;
        font-size: 9px;
        font-weight: 700;
      }

      .meter {
        width: 104px;
        height: 7px;
        border: 1px solid rgba(94, 234, 212, 0.42);
        background: rgba(1, 9, 12, 0.72);
      }

      .meter > i {
        display: block;
        width: 40%;
        height: 100%;
        background: linear-gradient(90deg, #5eead4, #fca5a5);
        box-shadow: 0 0 12px rgba(94, 234, 212, 0.55);
        transform-origin: left center;
      }

      .scanlines {
        pointer-events: none;
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.08) 0,
            rgba(255, 255, 255, 0.08) 1px,
            transparent 1px,
            transparent 4px
          );
        mix-blend-mode: overlay;
        opacity: 0.52;
      }

      .vignette {
        pointer-events: none;
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at 50% 45%, transparent 0 46%, rgba(0, 0, 0, 0.36) 72%, rgba(0, 0, 0, 0.78) 100%),
          linear-gradient(90deg, rgba(248, 113, 113, 0.12), transparent 24%, transparent 76%, rgba(34, 211, 238, 0.12));
      }
    </style>
    <div class="ufo-feed">
      <canvas id="ufo-canvas" aria-label="UFO declaration transmission video"></canvas>
      <div class="scanlines"></div>
      <div class="vignette"></div>
      <div class="hud">
        <div class="topline">
          <span class="origin">ORIGIN // UNKNOWN ORBITAL OBJECT</span>
          <div class="controls">
            <button class="speak" type="button" title="read transmission" aria-label="read transmission">▶</button>
            <button class="auto" type="button" title="auto voice" aria-label="auto voice" aria-pressed="${state.speaking ? 'true' : 'false'}">A</button>
          </div>
        </div>
        <div class="alert">宣 戦 布 告</div>
        <div>
          <div class="caption" id="caption"></div>
          <div class="bottomline">
            <span class="readout" id="signal">SIG 00%</span>
            <div class="meter"><i></i></div>
            <span class="readout" id="voice">VOICE LINK</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#ufo-canvas');
  const caption = ctx.domRoot.querySelector('#caption');
  const signal = ctx.domRoot.querySelector('#signal');
  const voice = ctx.domRoot.querySelector('#voice');
  const meter = ctx.domRoot.querySelector('.meter > i');
  const speakButton = ctx.domRoot.querySelector('.speak');
  const autoButton = ctx.domRoot.querySelector('.auto');
  const context = canvas.getContext('2d', { alpha: false });

  const output = audio.createGain();
  const filter = audio.createBiquadFilter();
  const staticGain = audio.createGain();
  const carrier = audio.createOscillator();
  const carrierGain = audio.createGain();
  const noiseSource = audio.createBufferSource();
  const noiseBuffer = audio.createBuffer(1, audio.sampleRate * 2, audio.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);

  for (let index = 0; index < noiseData.length; index += 1) {
    noiseData[index] = (Math.random() * 2 - 1) * (0.25 + Math.random() * 0.75);
  }

  output.gain.value = state.volume;
  filter.type = 'bandpass';
  filter.frequency.value = pitchHz(1560);
  filter.Q.value = 0.9;
  staticGain.gain.value = 0.014 + state.interference * 0.016;
  carrier.type = 'sine';
  carrier.frequency.value = pitchHz(180);
  carrierGain.gain.value = 0.0001;
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  noiseSource.connect(filter);
  filter.connect(staticGain);
  staticGain.connect(output);
  carrier.connect(carrierGain);
  carrierGain.connect(output);
  output.connect(ctx.audioOut);
  noiseSource.start();
  carrier.start();

  let startTime = performance.now();
  let lastFrame = state.messageIndex;
  let autoSpokenOnce = false;
  let destroyed = false;
  let utteranceActive = false;
  let fallbackTimer = 0;
  const timers = new Set();
  const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function setVoiceStatus(text) {
    voice.textContent = text;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height, dpr };
  }

  function pulseCarrier(strength = 1) {
    const t = audio.currentTime + 0.004;
    const level = Math.max(0.0002, 0.025 * state.volume * strength);
    carrier.frequency.cancelScheduledValues(t);
    carrierGain.gain.cancelScheduledValues(t);
    carrier.frequency.setValueAtTime(pitchHz(150 + state.messageIndex * 38), t);
    carrier.frequency.exponentialRampToValueAtTime(pitchHz(620 + state.messageIndex * 44), t + 0.1);
    carrierGain.gain.setValueAtTime(0.0001, t);
    carrierGain.gain.exponentialRampToValueAtTime(level, t + 0.012);
    carrierGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  }

  function fallbackRobotVoice(text) {
    clearTimeout(fallbackTimer);
    const chars = [...text.replace(/[。、\s]/g, '')].slice(0, 32);
    let index = 0;
    utteranceActive = true;
    setVoiceStatus('ROBOT VOICE');

    const step = () => {
      if (destroyed || index >= chars.length) {
        utteranceActive = false;
        setVoiceStatus(state.speaking ? 'VOICE LINK' : 'VOICE HOLD');
        return;
      }
      const t = audio.currentTime + 0.01;
      const code = chars[index].charCodeAt(0);
      carrier.frequency.setValueAtTime(pitchHz(180 + (code % 30) * 16), t);
      carrierGain.gain.setValueAtTime(0.0001, t);
      carrierGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.042 * state.volume), t + 0.012);
      carrierGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.105);
      index += 1;
      fallbackTimer = setTimeout(step, 118);
    };

    step();
  }

  function pickJapaneseVoice() {
    if (!hasSpeech) return null;
    const voices = window.speechSynthesis.getVoices();
    return voices.find((entry) => /^ja([-_]|$)/i.test(entry.lang))
      || voices.find((entry) => /japanese|日本/i.test(entry.name))
      || null;
  }

  function speakCurrent(force = false) {
    if (destroyed || (!force && !state.speaking)) return;
    const text = messages[state.messageIndex];
    autoSpokenOnce = true;
    pulseCarrier(1.4);

    if (!hasSpeech) {
      fallbackRobotVoice(text);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      const selectedVoice = pickJapaneseVoice();
      utterance.lang = 'ja-JP';
      utterance.rate = state.rate;
      utterance.pitch = state.pitch;
      utterance.volume = clamp(state.volume + 0.25, 0, 1);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.onstart = () => {
        utteranceActive = true;
        setVoiceStatus('SPEAKING');
      };
      utterance.onend = () => {
        utteranceActive = false;
        if (!destroyed) setVoiceStatus(state.speaking ? 'VOICE LINK' : 'VOICE HOLD');
      };
      utterance.onerror = () => {
        utteranceActive = false;
        fallbackRobotVoice(text);
      };
      window.speechSynthesis.speak(utterance);
    } catch (_) {
      fallbackRobotVoice(text);
    }
  }

  function drawStarfield(width, height, time) {
    context.fillStyle = '#020405';
    context.fillRect(0, 0, width, height);

    const count = 120;
    for (let index = 0; index < count; index += 1) {
      const seed = Math.sin(index * 913.17) * 43758.5453;
      const baseX = (seed - Math.floor(seed)) * width;
      const baseY = ((Math.sin(index * 421.91) * 43758.5453) % 1 + 1) % 1 * height;
      const drift = Math.sin(time * 0.4 + index) * 8;
      const pulse = 0.25 + 0.75 * Math.max(0, Math.sin(time * 2.2 + index * 3.1));
      context.fillStyle = `rgba(190, 255, 242, ${0.14 + pulse * 0.48})`;
      context.fillRect((baseX + drift + width) % width, baseY, 1.4, 1.4);
    }
  }

  function drawUfo(width, height, time) {
    const centerX = width * (0.5 + Math.sin(time * 0.48) * 0.055);
    const centerY = height * (0.36 + Math.sin(time * 0.7) * 0.035);
    const radius = Math.min(width, height) * 0.23;
    const beamPulse = 0.58 + Math.sin(time * 3.4) * 0.2;

    const beamGradient = context.createLinearGradient(centerX, centerY, centerX, height * 0.86);
    beamGradient.addColorStop(0, `rgba(102, 255, 218, ${0.34 * beamPulse})`);
    beamGradient.addColorStop(0.58, `rgba(134, 239, 172, ${0.16 * beamPulse})`);
    beamGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.beginPath();
    context.moveTo(centerX - radius * 0.34, centerY + radius * 0.08);
    context.lineTo(centerX + radius * 0.34, centerY + radius * 0.08);
    context.lineTo(centerX + radius * 1.05, height * 0.9);
    context.lineTo(centerX - radius * 1.05, height * 0.9);
    context.closePath();
    context.fillStyle = beamGradient;
    context.fill();

    context.save();
    context.translate(centerX, centerY);
    context.rotate(Math.sin(time * 1.2) * 0.035);

    const glow = context.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.45);
    glow.addColorStop(0, 'rgba(94, 234, 212, 0.55)');
    glow.addColorStop(0.44, 'rgba(20, 184, 166, 0.2)');
    glow.addColorStop(1, 'rgba(20, 184, 166, 0)');
    context.fillStyle = glow;
    context.beginPath();
    context.ellipse(0, 0, radius * 1.42, radius * 0.64, 0, 0, Math.PI * 2);
    context.fill();

    const hullGradient = context.createLinearGradient(0, -radius * 0.5, 0, radius * 0.42);
    hullGradient.addColorStop(0, '#eafffb');
    hullGradient.addColorStop(0.35, '#83e6d7');
    hullGradient.addColorStop(0.7, '#244f58');
    hullGradient.addColorStop(1, '#071317');
    context.fillStyle = hullGradient;
    context.strokeStyle = 'rgba(219, 255, 249, 0.92)';
    context.lineWidth = Math.max(1.5, radius * 0.035);
    context.beginPath();
    context.ellipse(0, 0, radius, radius * 0.28, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = 'rgba(185, 255, 246, 0.92)';
    context.beginPath();
    context.ellipse(0, -radius * 0.12, radius * 0.46, radius * 0.29, 0, Math.PI, Math.PI * 2);
    context.fill();

    for (let index = 0; index < 9; index += 1) {
      const x = -radius * 0.68 + index * radius * 0.17;
      const flicker = 0.5 + Math.sin(time * 7 + index * 1.4) * 0.5;
      context.fillStyle = `rgba(248, 113, 113, ${0.5 + flicker * 0.5})`;
      context.beginPath();
      context.arc(x, radius * 0.08, radius * 0.035, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }

  function drawInterference(width, height, time) {
    const bands = 7;
    for (let index = 0; index < bands; index += 1) {
      const y = ((Math.sin(time * (0.9 + index * 0.11) + index * 2.5) * 0.5 + 0.5) * height);
      const alpha = 0.035 + state.interference * 0.08;
      context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      context.fillRect(0, y, width, 1 + state.interference * 5);
    }

    const tearCount = 10;
    for (let index = 0; index < tearCount; index += 1) {
      const phase = Math.sin(time * 4.5 + index * 10.9);
      if (phase < 0.2) continue;
      const y = ((index * 0.113 + time * 0.12) % 1) * height;
      const x = Math.sin(time * 8 + index) * width * 0.08;
      context.fillStyle = `rgba(34, 211, 238, ${0.04 + state.interference * 0.08})`;
      context.fillRect(x, y, width * (0.22 + phase * 0.22), 2 + phase * 4);
      context.fillStyle = `rgba(248, 113, 113, ${0.05 + state.interference * 0.09})`;
      context.fillRect(width - x - width * 0.42, y + 4, width * 0.24, 2);
    }

    const noiseAmount = Math.floor(width * height * 0.00022 * state.interference);
    context.fillStyle = 'rgba(255, 255, 255, 0.3)';
    for (let index = 0; index < noiseAmount; index += 1) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      context.fillRect(x, y, 1, 1);
    }
  }

  function render(now = performance.now()) {
    if (!context) return;
    const { width, height } = resizeCanvas();
    const time = (now - startTime) / 1000;
    const frame = Math.floor(time / 2.7) % messages.length;
    state.messageIndex = frame;

    drawStarfield(width, height, time);
    drawUfo(width, height, time);
    drawInterference(width, height, time);

    const redFlash = Math.max(0, Math.sin(time * 5.2)) * state.threatLevel;
    context.fillStyle = `rgba(127, 29, 29, ${redFlash * 0.13})`;
    context.fillRect(0, 0, width, height);

    caption.textContent = messages[frame];
    const signalLevel = Math.round(58 + Math.sin(time * 3.1) * 12 + state.interference * 28);
    signal.textContent = `SIG ${Math.max(0, Math.min(99, signalLevel))}%`;
    const meterScale = 0.14 + (utteranceActive ? 0.78 : 0.22) * (0.55 + Math.sin(time * 12) * 0.2);
    meter.style.transform = `scaleX(${clamp(meterScale, 0.08, 1)})`;

    if (frame !== lastFrame) {
      lastFrame = frame;
      pulseCarrier(1);
      speakCurrent(false);
    }
  }

  const onSpeak = () => speakCurrent(true);
  const onAuto = () => {
    state.speaking = !state.speaking;
    autoButton.setAttribute('aria-pressed', state.speaking ? 'true' : 'false');
    setVoiceStatus(state.speaking ? 'VOICE LINK' : 'VOICE HOLD');
    if (state.speaking) speakCurrent(true);
  };
  const onVoicesChanged = () => {
    if (!destroyed && state.speaking && !autoSpokenOnce && !utteranceActive) speakCurrent(false);
  };

  speakButton.addEventListener('click', onSpeak);
  autoButton.addEventListener('click', onAuto);
  render();

  const initialTimer = setTimeout(() => speakCurrent(false), 450);
  timers.add(initialTimer);
  if (hasSpeech) {
    const voiceTimer = setTimeout(() => {
      if (!destroyed && state.speaking && !autoSpokenOnce && !utteranceActive) speakCurrent(false);
    }, 1200);
    timers.add(voiceTimer);
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoicesChanged);
  }

  return {
    update() {
      render(performance.now());
      const targetVolume = state.speaking ? state.volume : state.volume * 0.42;
      output.gain.setTargetAtTime(targetVolume, audio.currentTime, 0.05);
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      startTime = 0;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      clearTimeout(fallbackTimer);
      speakButton.removeEventListener('click', onSpeak);
      autoButton.removeEventListener('click', onAuto);
      if (hasSpeech) {
        window.speechSynthesis.removeEventListener?.('voiceschanged', onVoicesChanged);
        window.speechSynthesis.cancel();
      }
      try { noiseSource.stop(); } catch (_) {}
      try { carrier.stop(); } catch (_) {}
      [noiseSource, filter, staticGain, carrier, carrierGain, output].forEach((node) => {
        try { node.disconnect(); } catch (_) {}
      });
      ctx.domRoot.innerHTML = '';
    }
  };
}
