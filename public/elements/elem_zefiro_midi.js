// Zefiro MIDI source element.
// Reads CCs from a Web MIDI input (Artinoise Zefiro by default) and publishes
// them to the jam global bus so any element in the room can subscribe to
// breath/lip/accelerometer streams. Whichever client has the device attached
// becomes the source for everyone.
//
// Bus keys (all under global: namespace):
//   global:zefiro:cc<N>      normalized 0..1 float (latest value)
//   global:zefiro:cc<N>_raw  integer 0..127
//   global:zefiro:active     array of CC numbers seen this session
//   global:zefiro:device     human-readable device name
//
// CC defaults (per Artinoise spec; user may remap in Zefiro Manager):
//   CC11 = breath, CC1 = lip/mod, CC16/17 = Pro accelerometer.

export default function setup(ctx, prevState) {
  const PUBLISH_HZ = 30;
  const PREFERRED_NAME = /zefiro/i;

  const state = {
    deviceId: prevState?.deviceId ?? null,
    deviceName: prevState?.deviceName ?? null,
    lastValues: {} // ccNum -> raw int
  };

  // Track which CCs have changed since last publish so we don't spam Yjs.
  const dirty = new Set();
  // Track which CCs we've ever published so we can render a meter list.
  const seenCCs = new Set();
  // Visible history of recent messages for debug.
  const log = [];
  const MAX_LOG = 6;

  ctx.domRoot.innerHTML = `
    <style>
      :host, .root { box-sizing: border-box; }
      .root {
        height: 100%;
        padding: 10px 12px;
        background: #06090d;
        color: #d1fae5;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 8px;
        overflow: hidden;
      }
      h1 {
        margin: 0;
        font: 600 12px ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.04em;
        color: #67e8f9;
      }
      .status {
        font-size: 10px;
        color: #94a3b8;
      }
      .status.ok { color: #4ade80; }
      .status.warn { color: #fbbf24; }
      .status.err { color: #f87171; }
      select {
        width: 100%;
        background: #0f172a;
        color: #e2e8f0;
        border: 1px solid #1e293b;
        font: inherit;
        padding: 3px 4px;
      }
      .meters {
        overflow: auto;
        display: grid;
        gap: 3px;
        align-content: start;
      }
      .meter {
        display: grid;
        grid-template-columns: 56px 1fr 36px;
        gap: 6px;
        align-items: center;
      }
      .meter .label { color: #a5f3fc; }
      .meter .bar {
        position: relative;
        height: 8px;
        background: #0f172a;
        border: 1px solid #1e293b;
        overflow: hidden;
      }
      .meter .bar > span {
        position: absolute;
        inset: 0 auto 0 0;
        background: linear-gradient(90deg, #22d3ee, #a78bfa);
      }
      .meter .val { text-align: right; color: #cbd5e1; }
      .log {
        font-size: 10px;
        color: #64748b;
        white-space: pre-wrap;
        max-height: 60px;
        overflow: hidden;
      }
    </style>
    <div class="root">
      <h1>ZEFIRO MIDI</h1>
      <div>
        <div class="status" id="status">requesting MIDI access...</div>
        <select id="picker" style="display:none"></select>
      </div>
      <div class="meters" id="meters"></div>
      <div class="log" id="log"></div>
    </div>
  `;

  const statusEl = ctx.domRoot.querySelector('#status');
  const pickerEl = ctx.domRoot.querySelector('#picker');
  const metersEl = ctx.domRoot.querySelector('#meters');
  const logEl = ctx.domRoot.querySelector('#log');

  const setStatus = (text, cls = '') => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`.trim();
  };

  const ccLabel = (n) => {
    if (n === 11) return 'breath';
    if (n === 1) return 'lip/mod';
    if (n === 2) return 'breath2';
    if (n === 7) return 'volume';
    if (n === 16) return 'tilt';
    if (n === 17) return 'roll';
    return `cc${n}`;
  };

  const renderMeters = () => {
    const ccs = [...seenCCs].sort((a, b) => a - b);
    metersEl.innerHTML = ccs.map((n) => {
      const raw = state.lastValues[n] ?? 0;
      const pct = Math.round((raw / 127) * 100);
      return `
        <div class="meter" data-cc="${n}">
          <span class="label">cc${n} ${ccLabel(n)}</span>
          <span class="bar"><span style="right:${100 - pct}%"></span></span>
          <span class="val">${raw}</span>
        </div>
      `;
    }).join('');
  };

  const updateMeter = (cc) => {
    const row = metersEl.querySelector(`.meter[data-cc="${cc}"]`);
    if (!row) { renderMeters(); return; }
    const raw = state.lastValues[cc] ?? 0;
    const pct = Math.round((raw / 127) * 100);
    row.querySelector('.bar > span').style.right = `${100 - pct}%`;
    row.querySelector('.val').textContent = String(raw);
  };

  const pushLog = (text) => {
    log.unshift(text);
    if (log.length > MAX_LOG) log.length = MAX_LOG;
    logEl.textContent = log.join('\n');
  };

  let midiAccess = null;
  let currentInput = null;
  let publishTimer = null;
  const inputHandlers = new WeakMap();

  const detachCurrentInput = () => {
    if (currentInput && inputHandlers.has(currentInput)) {
      currentInput.removeEventListener('midimessage', inputHandlers.get(currentInput));
      inputHandlers.delete(currentInput);
    }
    currentInput = null;
  };

  const handleMidiMessage = (event) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const status = data[0] & 0xf0;
    if (status !== 0xb0) return; // CC only for v1
    const cc = data[1];
    const value = data[2] ?? 0;
    state.lastValues[cc] = value;
    seenCCs.add(cc);
    dirty.add(cc);
  };

  const attachInput = (input) => {
    detachCurrentInput();
    currentInput = input;
    state.deviceId = input.id;
    state.deviceName = input.name || input.id;
    const handler = handleMidiMessage;
    input.addEventListener('midimessage', handler);
    inputHandlers.set(input, handler);
    setStatus(`listening: ${state.deviceName}`, 'ok');
    pushLog(`attached ${state.deviceName}`);
    // Announce on bus for other elements (and for debug overlays).
    ctx.bus.pubGlobal('global:zefiro:device', state.deviceName);
  };

  const refreshPicker = () => {
    if (!midiAccess) return;
    const inputs = [...midiAccess.inputs.values()];
    pickerEl.innerHTML = inputs.map((inp) => {
      const selected = inp.id === state.deviceId ? 'selected' : '';
      return `<option value="${inp.id}" ${selected}>${inp.name || inp.id}</option>`;
    }).join('') || '<option value="">(no inputs)</option>';
    pickerEl.style.display = inputs.length > 0 ? 'block' : 'none';
    return inputs;
  };

  const autoPick = (inputs) => {
    if (state.deviceId) {
      const match = inputs.find((i) => i.id === state.deviceId);
      if (match) return match;
    }
    const preferred = inputs.find((i) => PREFERRED_NAME.test(i.name || ''));
    return preferred || inputs[0] || null;
  };

  const onPickerChange = () => {
    if (!midiAccess) return;
    const input = midiAccess.inputs.get(pickerEl.value);
    if (input) attachInput(input);
  };
  pickerEl.addEventListener('change', onPickerChange);

  const onStateChange = () => {
    const inputs = refreshPicker();
    if (!inputs || inputs.length === 0) {
      detachCurrentInput();
      setStatus('no MIDI inputs connected', 'warn');
      return;
    }
    // If our current device disappeared, repick.
    if (currentInput && !inputs.some((i) => i.id === currentInput.id)) {
      detachCurrentInput();
    }
    if (!currentInput) {
      const pick = autoPick(inputs);
      if (pick) attachInput(pick);
    }
  };

  const startPublishLoop = () => {
    publishTimer = setInterval(() => {
      if (dirty.size === 0) return;
      for (const cc of dirty) {
        const raw = state.lastValues[cc] ?? 0;
        const norm = raw / 127;
        ctx.bus.pubGlobal(`global:zefiro:cc${cc}`, norm);
        ctx.bus.pubGlobal(`global:zefiro:cc${cc}_raw`, raw);
        updateMeter(cc);
      }
      ctx.bus.pubGlobal('global:zefiro:active', [...seenCCs].sort((a, b) => a - b));
      dirty.clear();
    }, Math.round(1000 / PUBLISH_HZ));
  };

  const init = async () => {
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI not supported in this browser (need Chrome/Edge)', 'err');
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      setStatus(`MIDI access denied: ${err.message || err}`, 'err');
      return;
    }
    midiAccess.addEventListener('statechange', onStateChange);
    onStateChange();
    startPublishLoop();
  };

  init();

  return {
    update() {},
    getState() {
      return {
        deviceId: state.deviceId,
        deviceName: state.deviceName
      };
    },
    destroy() {
      if (publishTimer) clearInterval(publishTimer);
      detachCurrentInput();
      if (midiAccess) {
        try { midiAccess.removeEventListener('statechange', onStateChange); } catch (_) {}
      }
      pickerEl.removeEventListener('change', onPickerChange);
    }
  };
}
