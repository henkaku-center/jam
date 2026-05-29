const STATE_VERSION = 'auto-mixer-v1';
const STATE_KEY = 'mixer_state';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const round = (value, places = 4) => Number(value.toFixed(places));

  const state = {
    version: STATE_VERSION,
    master: clamp(finite(prevState?.master, 1), 0, 1.25),
    channels: { ...(prevState?.channels || {}) }
  };

  let channelIds = [];
  let rafId = 0;
  let lastScan = 0;
  let lastMeterPaint = 0;
  let suppressPublish = false;
  const meters = new Map();
  const keyListeners = new Map();

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        height: 100%;
      }
      * {
        box-sizing: border-box;
      }
      .mixer {
        height: 100%;
        min-height: 260px;
        display: grid;
        grid-template-rows: auto 1fr;
        background: #151515;
        color: #f2f0e7;
        border: 1px solid rgba(242, 240, 231, 0.14);
        font: 12px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow: hidden;
      }
      .topbar {
        min-height: 52px;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 140px;
        gap: 14px;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(242, 240, 231, 0.12);
        background: #20201e;
      }
      .title {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .name {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status {
        color: #a7a399;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .master {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) 34px;
        gap: 8px;
        align-items: center;
      }
      .master label {
        color: #d9d5c8;
        font-weight: 700;
        text-transform: uppercase;
        font-size: 10px;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #20c7a6;
      }
      .master-output {
        color: #ffc857;
        font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-align: right;
      }
      .channels {
        min-height: 0;
        display: flex;
        align-items: stretch;
        gap: 8px;
        padding: 10px;
        overflow: auto hidden;
      }
      .empty {
        width: 100%;
        min-height: 180px;
        display: grid;
        place-items: center;
        color: #9a968d;
        border: 1px dashed rgba(242, 240, 231, 0.18);
        background: #181817;
      }
      .strip {
        flex: 0 0 86px;
        min-width: 86px;
        display: grid;
        grid-template-rows: 38px 24px 62px 1fr 24px;
        gap: 8px;
        padding: 8px;
        border: 1px solid rgba(242, 240, 231, 0.13);
        background: #242421;
      }
      .channel-name {
        min-width: 0;
        color: #f2f0e7;
        font-weight: 700;
        font-size: 11px;
        line-height: 1.15;
        overflow: hidden;
      }
      .channel-type {
        margin-top: 3px;
        color: #8ee0cf;
        font: 700 9px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-transform: uppercase;
      }
      .meter {
        position: relative;
        height: 16px;
        overflow: hidden;
        border: 1px solid rgba(242, 240, 231, 0.16);
        background: #10100f;
      }
      .meter-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        background: linear-gradient(90deg, #20c7a6 0%, #d4d249 58%, #ff6b4a 100%);
      }
      .filter {
        display: grid;
        place-items: center;
        gap: 5px;
      }
      .knob {
        --turn: 135deg;
        position: relative;
        width: 42px;
        height: 42px;
        border-radius: 50%;
        border: 1px solid rgba(242, 240, 231, 0.24);
        background:
          radial-gradient(circle at 50% 55%, #30302d 0 52%, #111 53% 100%);
        cursor: ns-resize;
        outline: none;
        touch-action: none;
      }
      .knob:focus-visible {
        box-shadow: 0 0 0 2px #20c7a6;
      }
      .knob::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 7px;
        width: 3px;
        height: 12px;
        border-radius: 99px;
        background: #ffc857;
        transform: translateX(-50%) rotate(var(--turn));
        transform-origin: 50% 14px;
      }
      .freq {
        color: #bcb7aa;
        font: 700 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .fader-wrap {
        min-height: 112px;
        display: grid;
        place-items: center;
      }
      .fader {
        width: 116px;
        transform: rotate(-90deg);
      }
      .mute {
        width: 100%;
        height: 24px;
        border: 1px solid rgba(242, 240, 231, 0.18);
        background: #1a1a18;
        color: #d9d5c8;
        font: 800 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        cursor: pointer;
      }
      .mute.active {
        background: #b83b35;
        border-color: #ff7a6e;
        color: #fff7ed;
      }
    </style>
    <section class="mixer">
      <div class="topbar">
        <div class="title">
          <div class="name">Auto Mixer</div>
          <div class="status" id="status">Scanning channels</div>
        </div>
        <div class="master">
          <label for="master">Main</label>
          <input id="master" type="range" min="0" max="1.25" step="0.001" value="${state.master}">
          <output class="master-output" id="masterOut"></output>
        </div>
      </div>
      <div class="channels" id="channels"></div>
    </section>
  `;

  const channelsEl = ctx.domRoot.querySelector('#channels');
  const statusEl = ctx.domRoot.querySelector('#status');
  const masterEl = ctx.domRoot.querySelector('#master');
  const masterOutEl = ctx.domRoot.querySelector('#masterOut');

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  const cutoffFromNorm = (norm) => {
    const min = Math.log(160);
    const max = Math.log(20000);
    return Math.exp(min + clamp(norm, 0, 1) * (max - min));
  };

  const normFromCutoff = (freq) => {
    const min = Math.log(160);
    const max = Math.log(20000);
    return clamp((Math.log(clamp(freq, 160, 20000)) - min) / (max - min), 0, 1);
  };

  const formatFreq = (norm) => {
    const freq = cutoffFromNorm(norm);
    return freq >= 1000 ? `${(freq / 1000).toFixed(freq >= 10000 ? 0 : 1)}k` : `${Math.round(freq)}`;
  };

  const labelFor = (element) => {
    const layout = element.layout || {};
    const prompt = String(layout.prompt || '').trim();
    if (prompt) return prompt.replace(/^hand-authored\s+/i, '').slice(0, 38);
    const file = String(layout.filePath || element.id || 'channel').split('/').pop() || element.id;
    return file.replace(/^elem_/, '').replace(/\.js$/i, '').replaceAll('_', ' ').slice(0, 38);
  };

  const isMixable = (id, element) => {
    if (id === ctx.elementId) return false;
    if (!element?.audioVolumeNode || !element?.audioFilterNode) return false;
    const type = String(element.layout?.type || '').toLowerCase();
    return type !== 'visual' && type !== 'controller' && type !== 'mixer';
  };

  const getChannel = (id) => {
    const existing = state.channels[id] || {};
    const channel = {
      volume: clamp(finite(existing.volume, 1), 0, 1.25),
      filter: clamp(finite(existing.filter, 1), 0, 1),
      muted: Boolean(existing.muted)
    };
    state.channels[id] = channel;
    return channel;
  };

  const currentElements = () => {
    const map = window.activeElements;
    if (!map || typeof map.entries !== 'function') return [];
    return [...map.entries()]
      .filter(([id, element]) => isMixable(id, element))
      .sort((a, b) => String(a[1]?.layout?.x ?? 0) - String(b[1]?.layout?.x ?? 0));
  };

  const serializeState = () => ({
    version: STATE_VERSION,
    master: round(state.master),
    channels: Object.fromEntries(Object.entries(state.channels).map(([id, channel]) => [id, {
      volume: round(clamp(finite(channel.volume, 1), 0, 1.25)),
      filter: round(clamp(finite(channel.filter, 1), 0, 1)),
      muted: Boolean(channel.muted)
    }]))
  });

  const publishState = () => {
    if (suppressPublish) return;
    ctx.bus.pubGlobal(STATE_KEY, serializeState());
  };

  const attachMeter = (id, element) => {
    if (!element?.audioPannerNode) return null;
    const current = meters.get(id);
    if (current?.source === element.audioPannerNode) return current;
    if (current) {
      try { current.source.disconnect(current.analyser); } catch (_) {}
      try { current.analyser.disconnect(); } catch (_) {}
    }
    const analyser = ctx.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.75;
    try {
      element.audioPannerNode.connect(analyser);
    } catch (_) {
      return null;
    }
    const meter = {
      source: element.audioPannerNode,
      analyser,
      data: new Uint8Array(analyser.fftSize)
    };
    meters.set(id, meter);
    return meter;
  };

  const cleanupMeters = (activeIds) => {
    for (const [id, meter] of meters) {
      if (activeIds.has(id)) continue;
      try { meter.source.disconnect(meter.analyser); } catch (_) {}
      try { meter.analyser.disconnect(); } catch (_) {}
      meters.delete(id);
    }
  };

  const render = () => {
    const entries = currentElements();
    channelIds = entries.map(([id]) => id);
    const activeIds = new Set(channelIds);
    cleanupMeters(activeIds);

    statusEl.textContent = channelIds.length === 1
      ? '1 audio channel'
      : `${channelIds.length} audio channels`;
    masterOutEl.textContent = `${Math.round(state.master * 100)}%`;
    masterEl.value = String(state.master);

    if (!entries.length) {
      channelsEl.innerHTML = '<div class="empty">No playing elements detected</div>';
      return;
    }

    channelsEl.innerHTML = entries.map(([id, element]) => {
      const channel = getChannel(id);
      const norm = channel.filter;
      const turn = -135 + norm * 270;
      const type = escapeHtml(element.layout?.type || 'audio');
      const name = escapeHtml(labelFor(element));
      const mutedClass = channel.muted ? ' active' : '';
      const muteText = channel.muted ? 'MUTED' : 'ON';
      return `
        <article class="strip" data-id="${escapeHtml(id)}">
          <div class="channel-name" title="${name}">
            ${name}
            <div class="channel-type">${type}</div>
          </div>
          <div class="meter"><div class="meter-fill" data-meter="${escapeHtml(id)}"></div></div>
          <div class="filter">
            <div
              class="knob"
              role="slider"
              tabindex="0"
              aria-label="Filter cutoff"
              aria-valuemin="160"
              aria-valuemax="20000"
              aria-valuenow="${Math.round(cutoffFromNorm(norm))}"
              data-action="filter"
              data-id="${escapeHtml(id)}"
              style="--turn:${turn}deg"
            ></div>
            <div class="freq" data-freq="${escapeHtml(id)}">${formatFreq(norm)}</div>
          </div>
          <div class="fader-wrap">
            <input
              class="fader"
              type="range"
              min="0"
              max="1.25"
              step="0.001"
              value="${channel.volume}"
              data-action="volume"
              data-id="${escapeHtml(id)}"
              aria-label="Channel volume"
            >
          </div>
          <button class="mute${mutedClass}" type="button" data-action="mute" data-id="${escapeHtml(id)}">${muteText}</button>
        </article>
      `;
    }).join('');
  };

  const paintKnob = (id) => {
    const channel = getChannel(id);
    const knob = ctx.domRoot.querySelector(`.knob[data-id="${CSS.escape(id)}"]`);
    const freq = ctx.domRoot.querySelector(`[data-freq="${CSS.escape(id)}"]`);
    const cutoff = cutoffFromNorm(channel.filter);
    if (knob) {
      knob.style.setProperty('--turn', `${-135 + channel.filter * 270}deg`);
      knob.setAttribute('aria-valuenow', String(Math.round(cutoff)));
    }
    if (freq) freq.textContent = formatFreq(channel.filter);
  };

  const applyChannelNodes = () => {
    const now = ctx.audioCtx.currentTime;
    for (const [id, element] of currentElements()) {
      const channel = getChannel(id);
      const volume = channel.muted ? 0 : channel.volume * state.master;
      const cutoff = cutoffFromNorm(channel.filter);
      try {
        element.audioVolumeNode.gain.setTargetAtTime(volume, now, 0.025);
      } catch (_) {}
      try {
        element.audioFilterNode.type = 'lowpass';
        element.audioFilterNode.frequency.setTargetAtTime(cutoff, now, 0.03);
        element.audioFilterNode.Q.setTargetAtTime(0.72 + (1 - channel.filter) * 5.5, now, 0.03);
      } catch (_) {}
      attachMeter(id, element);
    }
  };

  const paintMeters = () => {
    for (const [id, meter] of meters) {
      const fill = ctx.domRoot.querySelector(`[data-meter="${CSS.escape(id)}"]`);
      if (!fill) continue;
      meter.analyser.getByteTimeDomainData(meter.data);
      let sum = 0;
      for (let i = 0; i < meter.data.length; i += 1) {
        const centered = (meter.data[i] - 128) / 128;
        sum += centered * centered;
      }
      const rms = Math.sqrt(sum / meter.data.length);
      const level = clamp(Math.pow(rms * 5.5, 0.7), 0, 1);
      fill.style.width = `${Math.round(level * 100)}%`;
    }
  };

  const scanIfChanged = (timestamp) => {
    if (timestamp - lastScan < 700) return;
    lastScan = timestamp;
    const nextIds = currentElements().map(([id]) => id);
    if (nextIds.length !== channelIds.length || nextIds.some((id, index) => id !== channelIds[index])) {
      render();
    }
  };

  const frame = (timestamp) => {
    scanIfChanged(timestamp);
    applyChannelNodes();
    if (timestamp - lastMeterPaint > 32) {
      paintMeters();
      lastMeterPaint = timestamp;
    }
    rafId = requestAnimationFrame(frame);
  };

  const onInput = (event) => {
    const target = event.target;
    if (target === masterEl) {
      state.master = clamp(Number(target.value), 0, 1.25);
      masterOutEl.textContent = `${Math.round(state.master * 100)}%`;
      publishState();
      return;
    }
    if (target?.dataset?.action !== 'volume') return;
    const id = target.dataset.id;
    getChannel(id).volume = clamp(Number(target.value), 0, 1.25);
    publishState();
  };

  const onClick = (event) => {
    const target = event.target.closest?.('[data-action="mute"]');
    if (!target) return;
    const id = target.dataset.id;
    const channel = getChannel(id);
    channel.muted = !channel.muted;
    target.classList.toggle('active', channel.muted);
    target.textContent = channel.muted ? 'MUTED' : 'ON';
    publishState();
  };

  let drag = null;
  const onPointerDown = (event) => {
    const target = event.target.closest?.('[data-action="filter"]');
    if (!target) return;
    event.preventDefault();
    target.setPointerCapture?.(event.pointerId);
    const id = target.dataset.id;
    drag = {
      id,
      startY: event.clientY,
      startValue: getChannel(id).filter,
      pointerId: event.pointerId
    };
  };

  const onPointerMove = (event) => {
    if (!drag) return;
    const next = clamp(drag.startValue + (drag.startY - event.clientY) * 0.006, 0, 1);
    getChannel(drag.id).filter = next;
    paintKnob(drag.id);
    publishState();
  };

  const onPointerUp = () => {
    drag = null;
  };

  const onKeyDown = (event) => {
    const target = event.target;
    if (target?.dataset?.action !== 'filter') return;
    const id = target.dataset.id;
    const channel = getChannel(id);
    const keyStep = event.shiftKey ? 0.08 : 0.025;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      channel.filter = clamp(channel.filter + keyStep, 0, 1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      channel.filter = clamp(channel.filter - keyStep, 0, 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      channel.filter = normFromCutoff(160);
    } else if (event.key === 'End') {
      event.preventDefault();
      channel.filter = 1;
    } else {
      return;
    }
    paintKnob(id);
    publishState();
  };

  const applyRemoteState = (nextState) => {
    if (!nextState || typeof nextState !== 'object') return;
    suppressPublish = true;
    state.master = clamp(finite(nextState.master, state.master), 0, 1.25);
    if (nextState.channels && typeof nextState.channels === 'object') {
      for (const [id, channel] of Object.entries(nextState.channels)) {
        state.channels[id] = {
          volume: clamp(finite(channel?.volume, getChannel(id).volume), 0, 1.25),
          filter: clamp(finite(channel?.filter, getChannel(id).filter), 0, 1),
          muted: Boolean(channel?.muted)
        };
      }
    }
    render();
    suppressPublish = false;
  };

  ctx.domRoot.addEventListener('input', onInput);
  ctx.domRoot.addEventListener('click', onClick);
  ctx.domRoot.addEventListener('pointerdown', onPointerDown);
  ctx.domRoot.addEventListener('pointermove', onPointerMove);
  ctx.domRoot.addEventListener('pointerup', onPointerUp);
  ctx.domRoot.addEventListener('pointercancel', onPointerUp);
  ctx.domRoot.addEventListener('keydown', onKeyDown);

  const unsubscribe = ctx.bus.subGlobal(STATE_KEY, applyRemoteState);

  render();
  publishState();
  rafId = requestAnimationFrame(frame);

  return {
    update() {},
    getState() {
      return serializeState();
    },
    destroy() {
      cancelAnimationFrame(rafId);
      unsubscribe();
      cleanupMeters(new Set());
      keyListeners.clear();
    }
  };
}
