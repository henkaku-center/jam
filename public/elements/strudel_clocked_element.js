export default async function setup(ctx, prevState) {
  const moodVersion = 'jangle-pop-guitar-slower-v1';
  const defaultCode = `stack(
  note("<a2 e2 f#2 d2>*4")
    .s("sawtooth")
    .lpf(820)
    .gain(0.18)
    .room(0.22),
  note("<[a3,c#4,e4] [e3,g#3,b3] [f#3,a3,c#4] [d3,f#3,a3]>*2")
    .s("gm_acoustic_guitar_steel")
    .gain(0.24)
    .room(0.28)
    .delay(0.08),
  note("a3 c#4 e4 c#4 e4 a4 b3 e4 g#4 e4 g#4 b4 f#3 a3 c#4 a3 c#4 f#4 d3 f#3 a3 f#3 a3 d4")
    .s("gm_electric_guitar_clean")
    .lpf(sine.range(2300, 4200).slow(8))
    .gain(0.3)
    .delay(0.14)
    .room(0.32)
    .jux(rev),
  note("~ e5 c#5 b4 ~ c#5 e5 a4 ~ a4 c#5 e5 ~ b4 a4 f#4")
    .s("sine")
    .lpf(3600)
    .gain(0.13)
    .delay(0.24)
    .room(0.42),
  s("bd ~ hh ~ sd ~ hh ~ bd ~ hh ~ sd oh ~ ~")
    .gain(0.5)
    .room(0.18)
)`;
  const isCurrentMoodState = prevState?.moodVersion === moodVersion;
  const initialCode = isCurrentMoodState && typeof prevState?.code === 'string' ? prevState.code : defaultCode;
  const initialDraftCode = isCurrentMoodState && typeof prevState?.draftCode === 'string' ? prevState.draftCode : initialCode;

  const state = {
    moodVersion,
    code: initialCode,
    draftCode: initialDraftCode,
    running: typeof prevState?.running === 'boolean' ? prevState.running : true,
    gain: isCurrentMoodState && Number.isFinite(prevState?.gain) ? prevState.gain : 0.58,
    error: '',
    status: 'loading'
  };

  const elementId = ctx.elementId || `strudel_${Math.random().toString(36).slice(2)}`;
  const unsubscribers = [];
  let suppressPublish = false;
  let evalTimer = 0;
  let destroyed = false;

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .panel {
        box-sizing: border-box;
        height: 100%;
        min-height: 220px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 7px;
        padding: 10px;
        overflow: hidden;
        color: #e5e7eb;
        background:
          radial-gradient(circle at 18% 0%, rgba(20, 184, 166, 0.22), transparent 34%),
          linear-gradient(135deg, #0b1120 0%, #15151e 52%, #101923 100%);
        border: 1px solid rgba(45, 212, 191, 0.5);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        min-width: 0;
      }
      .title {
        min-width: 0;
        display: grid;
        gap: 1px;
      }
      h2 {
        margin: 0;
        color: #ccfbf1;
        font-size: 13px;
        line-height: 1;
        letter-spacing: 0;
      }
      .sub {
        color: #94a3b8;
        font-size: 9px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      button, textarea, input {
        font: inherit;
      }
      .run {
        min-width: 48px;
        height: 27px;
        padding: 0 9px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 5px;
        color: #06121b;
        background: #5eead4;
        cursor: pointer;
      }
      .run.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.72);
      }
      textarea {
        width: 100%;
        min-width: 0;
        height: 100%;
        min-height: 86px;
        box-sizing: border-box;
        resize: none;
        padding: 8px;
        color: #d1fae5;
        background: rgba(2, 6, 23, 0.68);
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
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      label {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
        min-width: 0;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #5eead4;
      }
      .status {
        max-width: 142px;
        color: #94a3b8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status.error { color: #fca5a5; }
    </style>
    <div class="panel">
      <div class="top">
        <div class="title">
          <h2>Jam Strudel</h2>
          <div class="sub">Official Strudel runtime shared by jam elements</div>
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

  const runBtn = ctx.domRoot.querySelector('#run');
  const codeInput = ctx.domRoot.querySelector('#code');
  const gainInput = ctx.domRoot.querySelector('#gain');
  const statusEl = ctx.domRoot.querySelector('#status');
  const { getJamStrudelRuntime } = await import('/strudel-runtime.js');
  const runtime = await getJamStrudelRuntime({
    audioCtx: ctx.rawAudioCtx || ctx.audioCtx,
    outputNode: window.jamMasterGain || ctx.audioOut,
    audioEnabled: Boolean(window.jamAudioOutputEnabled)
  });

  const render = () => {
    runBtn.textContent = state.running ? 'stop' : 'play';
    runBtn.classList.toggle('off', !state.running);
    if (codeInput.value !== state.draftCode) codeInput.value = state.draftCode;
    if (gainInput.value !== String(state.gain)) gainInput.value = String(state.gain);
    statusEl.textContent = state.error || state.status;
    statusEl.classList.toggle('error', Boolean(state.error));
  };

  const publishState = () => {
    if (suppressPublish) return;
    ctx.bus.pubGlobal('state', {
      code: state.code,
      draftCode: state.draftCode,
      running: state.running,
      gain: state.gain,
      moodVersion: state.moodVersion
    });
  };

  const evaluateNow = async (source = state.code) => {
    if (destroyed) return;
    state.code = source;
    try {
      state.status = state.running ? 'evaluating' : 'stopped';
      state.error = '';
      render();
      const status = await runtime.evaluateElement(elementId, source, {
        running: state.running,
        gain: state.gain
      });
      state.status = state.running ? 'playing' : 'stopped';
      state.error = status.error || '';
    } catch (error) {
      state.error = error?.message || String(error);
      state.status = 'error';
    }
    render();
  };

  const commitAndEvaluate = (source = state.draftCode) => {
    clearTimeout(evalTimer);
    state.code = source;
    publishState();
    evalTimer = setTimeout(() => evaluateNow(source), 0);
  };

  const reapplyActivePattern = () => {
    clearTimeout(evalTimer);
    publishState();
    evalTimer = setTimeout(() => evaluateNow(state.code), 0);
  };

  const silenceElement = () => {
    clearTimeout(evalTimer);
    state.running = false;
    state.error = '';
    state.status = 'stopped';
    publishState();
    evalTimer = setTimeout(() => evaluateNow(state.code), 0);
    render();
  };

  runBtn.addEventListener('click', () => {
    const shouldRun = !state.running;
    state.running = shouldRun;
    render();
    if (shouldRun) commitAndEvaluate(state.draftCode);
    else reapplyActivePattern();
  });

  gainInput.addEventListener('input', () => {
    state.gain = clamp(Number(gainInput.value), 0, 1);
    render();
  });

  gainInput.addEventListener('change', reapplyActivePattern);

  codeInput.addEventListener('input', () => {
    state.draftCode = codeInput.value;
    state.error = '';
    state.status = state.draftCode === state.code ? 'ready' : 'edited';
    render();
  });

  codeInput.addEventListener('keydown', (event) => {
    if (isSilenceShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      silenceElement();
      return;
    }

    if (isIndentShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      updateDraftFromEditor(indentSelection(codeInput, event.shiftKey ? -1 : 1));
      return;
    }

    if (event.key !== 'Enter') return;
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      commitAndEvaluate(state.draftCode);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      commitAndEvaluate(getSelectionOrCurrentBlock(codeInput));
      return;
    }
    if (!event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    commitAndEvaluate(getCurrentLine(codeInput));
  });

  unsubscribers.push(ctx.bus.subGlobal('state', value => {
    if (!value || typeof value !== 'object') return;
    suppressPublish = true;
    const incomingIsCurrentMood = value.moodVersion === moodVersion;
    if (!incomingIsCurrentMood) {
      state.code = defaultCode;
      state.draftCode = defaultCode;
      state.moodVersion = moodVersion;
    } else if (typeof value.code === 'string') {
      state.code = value.code;
      state.draftCode = typeof value.draftCode === 'string' ? value.draftCode : value.code;
    }
    if (typeof value.running === 'boolean') state.running = value.running;
    if (incomingIsCurrentMood && Number.isFinite(value.gain)) state.gain = clamp(value.gain, 0, 1);
    state.moodVersion = moodVersion;
    suppressPublish = false;
    render();
    clearTimeout(evalTimer);
    evalTimer = setTimeout(() => evaluateNow(state.code), 0);
  }));

  if (!isCurrentMoodState) publishState();
  render();
  evalTimer = setTimeout(() => evaluateNow(state.code), 0);

  return {
    getState() {
      return {
        code: state.code,
        draftCode: state.draftCode,
        running: state.running,
        gain: state.gain,
        moodVersion: state.moodVersion
      };
    },
    async destroy() {
      destroyed = true;
      clearTimeout(evalTimer);
      unsubscribers.forEach(unsub => {
        try { unsub(); } catch {}
      });
      try { await runtime.removeElement(elementId); } catch {}
    }
  };
}

function updateDraftFromEditor(next) {
  if (!next) return;
  next.input.value = next.value;
  next.input.setSelectionRange(next.selectionStart, next.selectionEnd);
  next.input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

function isSilenceShortcut(event) {
  return event.key === '.' && (event.ctrlKey || event.metaKey || event.altKey);
}

function isIndentShortcut(event) {
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key === '}' || event.key === ']' || event.key === '{' || event.key === '[';
}

function getCurrentLine(input) {
  const value = input.value;
  const start = value.lastIndexOf('\n', Math.max(0, input.selectionStart - 1)) + 1;
  const endIndex = value.indexOf('\n', input.selectionStart);
  const end = endIndex === -1 ? value.length : endIndex;
  return value.slice(start, end).trim() || 'silence';
}

function getSelectionOrCurrentBlock(input) {
  const value = input.value;
  if (input.selectionStart !== input.selectionEnd) {
    return value.slice(input.selectionStart, input.selectionEnd).trim() || 'silence';
  }

  const lines = value.split('\n');
  const cursorLine = value.slice(0, input.selectionStart).split('\n').length - 1;
  let start = cursorLine;
  let end = cursorLine;
  while (start > 0 && lines[start - 1].trim()) start -= 1;
  while (end < lines.length - 1 && lines[end + 1].trim()) end += 1;
  return lines.slice(start, end + 1).join('\n').trim() || getCurrentLine(input);
}

function indentSelection(input, direction) {
  const value = input.value;
  const lineStart = value.lastIndexOf('\n', Math.max(0, input.selectionStart - 1)) + 1;
  const nextLineAfterSelection = value.indexOf('\n', input.selectionEnd);
  const lineEnd = nextLineAfterSelection === -1 ? value.length : nextLineAfterSelection;
  const before = value.slice(0, lineStart);
  const selected = value.slice(lineStart, lineEnd);
  const after = value.slice(lineEnd);
  const lines = selected.split('\n');
  const changed = lines.map(line => {
    if (direction > 0) return `  ${line}`;
    if (line.startsWith('  ')) return line.slice(2);
    if (line.startsWith('\t')) return line.slice(1);
    return line;
  });
  const nextSelected = changed.join('\n');
  const deltaStart = direction > 0 ? 2 : Math.min(lines[0].length - changed[0].length, 2);
  const deltaEnd = nextSelected.length - selected.length;
  return {
    input,
    value: `${before}${nextSelected}${after}`,
    selectionStart: Math.max(lineStart, input.selectionStart + deltaStart),
    selectionEnd: Math.max(lineStart, input.selectionEnd + deltaEnd)
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
