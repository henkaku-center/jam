const DEFAULT_CODE = `stack(
  s("bd ~ ~ bd ~ ~ bd ~ ~ bd ~ ~ bd ~ ~ ~")
    .gain(0.74)
    .lpf(180)
    .room(0.1),
  s("~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ cp ~")
    .gain(0.52)
    .room(0.18),
  s("hh*16")
    .gain(0.14)
    .room(0.08),
  s("~ ~ ~ oh ~ ~ ~ ~ ~ ~ ~ oh ~ ~ ~ ~")
    .gain(0.18)
    .room(0.16),
  note("c2 ~ ~ eb2 ~ f2 ~ ~ g1 ~ ~ bb1 ~ ~ ~ ~")
    .s("sawtooth")
    .lpf(sine.range(240, 860).slow(4))
    .gain(0.24)
)`;

const STATE_VERSION = 'hiphop-strudel-beat-v1';

export default async function setup(ctx, prevState) {
  const elementId = ctx.elementId || `hiphop_strudel_${Math.random().toString(36).slice(2)}`;
  const previousMatches = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    code: previousMatches && typeof prevState?.code === 'string' ? prevState.code : DEFAULT_CODE,
    draftCode: previousMatches && typeof prevState?.draftCode === 'string'
      ? prevState.draftCode
      : (previousMatches && typeof prevState?.code === 'string' ? prevState.code : DEFAULT_CODE),
    running: typeof prevState?.running === 'boolean' ? prevState.running : true,
    gain: previousMatches && Number.isFinite(prevState?.gain) ? clamp(prevState.gain, 0, 1) : 0.72,
    status: 'loading',
    error: ''
  };

  let destroyed = false;
  let evalTimer = 0;
  let runtime = null;

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .panel {
        box-sizing: border-box;
        height: 100%;
        min-height: 220px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        padding: 10px;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(135deg, rgba(6, 7, 10, 0.96), rgba(19, 21, 25, 0.96) 54%, rgba(8, 18, 20, 0.96)),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(45, 212, 191, 0.46);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      .title {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      h2 {
        margin: 0;
        color: #99f6e4;
        font-size: 13px;
        line-height: 1;
        letter-spacing: 0;
      }
      .sub,
      .status {
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub { font-size: 9px; }
      button,
      textarea,
      input {
        font: inherit;
      }
      .run {
        height: 28px;
        min-width: 54px;
        padding: 0 10px;
        color: #041011;
        background: #5eead4;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 5px;
        cursor: pointer;
      }
      .run.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.78);
      }
      textarea {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        height: 100%;
        min-height: 96px;
        resize: none;
        padding: 8px;
        color: #ecfeff;
        background: rgba(0, 0, 0, 0.44);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        outline: none;
      }
      textarea:focus {
        border-color: #5eead4;
        box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.18);
      }
      .bottom {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #5eead4;
      }
      .status {
        max-width: 132px;
      }
      .status.error {
        color: #fca5a5;
      }
    </style>
    <div class="panel">
      <div class="top">
        <div class="title">
          <h2>Hip Hop Strudel</h2>
          <div class="sub">dusty 84 bpm drums and sub bass</div>
        </div>
        <button class="run" id="run" type="button"></button>
      </div>
      <textarea id="code" spellcheck="false"></textarea>
      <div class="bottom">
        <label>gain <input id="gain" type="range" min="0" max="1" step="0.01"></label>
        <div class="status" id="status"></div>
      </div>
    </div>
  `;

  const runButton = ctx.domRoot.querySelector('#run');
  const codeInput = ctx.domRoot.querySelector('#code');
  const gainInput = ctx.domRoot.querySelector('#gain');
  const statusEl = ctx.domRoot.querySelector('#status');
  const { getJamStrudelRuntime } = await import('/strudel-runtime.js');
  runtime = await getJamStrudelRuntime({
    audioCtx: ctx.rawAudioCtx || ctx.audioCtx,
    outputNode: ctx.audioOut,
    audioEnabled: Boolean(window.jamAudioOutputEnabled)
  });

  const render = () => {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    if (codeInput.value !== state.draftCode) codeInput.value = state.draftCode;
    if (gainInput.value !== String(state.gain)) gainInput.value = String(state.gain);
    statusEl.textContent = state.error || state.status;
    statusEl.classList.toggle('error', Boolean(state.error));
  };

  const evaluate = async (source = state.code) => {
    if (destroyed) return;
    state.code = source;
    state.status = state.running ? 'evaluating' : 'stopped';
    state.error = '';
    render();

    try {
      const result = await runtime.evaluateElement(elementId, source, {
        running: state.running,
        gain: state.gain
      });
      state.status = state.running ? 'playing' : 'stopped';
      state.error = result.error || '';
    } catch (error) {
      state.status = 'error';
      state.error = error?.message || String(error);
    }

    render();
  };

  const scheduleEvaluate = (source = state.code) => {
    clearTimeout(evalTimer);
    evalTimer = setTimeout(() => evaluate(source), 0);
  };

  runButton.addEventListener('click', () => {
    state.running = !state.running;
    if (state.running) {
      state.code = state.draftCode;
    }
    render();
    scheduleEvaluate(state.code);
  });

  gainInput.addEventListener('input', () => {
    state.gain = clamp(Number(gainInput.value), 0, 1);
    render();
  });

  gainInput.addEventListener('change', () => {
    scheduleEvaluate(state.code);
  });

  codeInput.addEventListener('input', () => {
    state.draftCode = codeInput.value;
    state.status = state.draftCode === state.code ? 'ready' : 'edited';
    state.error = '';
    render();
  });

  codeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      state.code = state.draftCode;
      scheduleEvaluate(state.code);
    }
  });

  render();
  scheduleEvaluate(state.code);

  return {
    getState() {
      return {
        stateVersion: state.stateVersion,
        code: state.code,
        draftCode: state.draftCode,
        running: state.running,
        gain: state.gain
      };
    },
    async destroy() {
      destroyed = true;
      clearTimeout(evalTimer);
      if (runtime) {
        try { await runtime.removeElement(elementId); } catch {}
      }
    }
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
