export default async function setup(ctx, prevState) {
  const moodVersion = 'blank-v1';
  const defaultCode = '';
  const isCurrentMoodState = prevState?.moodVersion === moodVersion;
  const initialCode = isCurrentMoodState && typeof prevState?.code === 'string' ? prevState.code : defaultCode;
  const initialDraftCode = isCurrentMoodState && typeof prevState?.draftCode === 'string' ? prevState.draftCode : initialCode;

  const state = {
    moodVersion,
    code: initialCode,
    draftCode: initialDraftCode,
    running: isCurrentMoodState && typeof prevState?.running === 'boolean' ? prevState.running : false,
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
      :host {
        display: block;
        height: 100%;
        user-select: text;
        -webkit-user-select: text;
      }
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
        user-select: text;
        -webkit-user-select: text;
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
      button, input {
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
      .code-bridge {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      #editor {
        width: 100%;
        min-width: 0;
        height: 100%;
        min-height: 86px;
        box-sizing: border-box;
        background: rgba(2, 6, 23, 0.68);
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        overflow: hidden;
      }
      #editor:focus-within {
        border-color: #5eead4;
        box-shadow: 0 0 0 2px rgba(45, 212, 191, 0.18);
      }
      .cm-editor {
        height: 100%;
        background: transparent;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .cm-scroller {
        height: 100%;
        min-height: 86px;
      }
      .cm-content {
        padding: 8px 4px;
        caret-color: #facc15;
      }
      .cm-gutters {
        border-right: 1px solid rgba(148, 163, 184, 0.18);
      }
      .cm-tooltip {
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 6px;
        background: #0f172a;
        color: #e5e7eb;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
        overflow: hidden;
      }
      .cm-tooltip-autocomplete ul {
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .cm-tooltip-autocomplete ul li[aria-selected] {
        background: rgba(45, 212, 191, 0.25);
        color: #f8fafc;
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
      <textarea id="code" class="code-bridge" spellcheck="false" tabindex="-1" aria-hidden="true"></textarea>
      <div id="editor" data-no-drag></div>
      <div class="bottom">
        <label>gain <input id="gain" type="range" min="0" max="1" step="0.01"></label>
        <div class="status" id="status"></div>
      </div>
    </div>
  `;

  const runBtn = ctx.domRoot.querySelector('#run');
  const codeBridge = ctx.domRoot.querySelector('#code');
  const editorRoot = ctx.domRoot.querySelector('#editor');
  const gainInput = ctx.domRoot.querySelector('#gain');
  const statusEl = ctx.domRoot.querySelector('#status');
  const editorKit = await import('/vendor/strudel-editor.js');
  const { getJamStrudelRuntime } = await import('/strudel-runtime.js');
  const runtime = await getJamStrudelRuntime({
    audioCtx: ctx.rawAudioCtx || ctx.audioCtx,
    outputNode: window.jamMasterGain || ctx.audioOut,
    audioEnabled: Boolean(window.jamAudioOutputEnabled)
  });
  const {
    EditorState,
    EditorView,
    autocompletion,
    bracketMatching,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    defaultHighlightStyle,
    defaultKeymap,
    drawSelection,
    dropCursor,
    foldGutter,
    foldKeymap,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSelectionMatches,
    history,
    historyKeymap,
    indentLess,
    indentMore,
    indentOnInput,
    jamStrudelAutocomplete,
    javascript,
    keymap,
    lineNumbers,
    searchKeymap,
    strudelTheme,
    syntaxHighlighting
  } = editorKit;
  let applyingEditorChange = false;
  let editorView = null;

  const render = () => {
    runBtn.textContent = state.running ? 'stop' : 'play';
    runBtn.classList.toggle('off', !state.running);
    setEditorValue(state.draftCode);
    syncCodeBridge();
    if (gainInput.value !== String(state.gain)) gainInput.value = String(state.gain);
    statusEl.textContent = state.error || state.status;
    statusEl.classList.toggle('error', Boolean(state.error));
  };

  const updateDraft = (source) => {
    state.draftCode = source;
    state.error = '';
    state.status = state.draftCode === state.code ? 'ready' : 'edited';
    syncCodeBridge();
    render();
  };

  const runEditorShortcut = (event) => {
    if (isSilenceShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      silenceElement();
      return true;
    }

    if (isIndentShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      const command = event.shiftKey || event.key === '[' || event.key === '{' ? indentLess : indentMore;
      command(editorView);
      return true;
    }

    if (event.key !== 'Enter') return false;
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      commitAndEvaluate(getEditorValue());
      return true;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      commitAndEvaluate(getSelectionOrCurrentBlock(editorView));
      return true;
    }
    if (!event.shiftKey) return false;
    event.preventDefault();
    event.stopPropagation();
    commitAndEvaluate(getCurrentLine(editorView));
    return true;
  };

  const editorTheme = EditorView.theme({
    '&': {
      color: '#d1fae5'
    },
    '.cm-content': {
      minHeight: '100%'
    },
    '.cm-focused': {
      outline: 'none'
    },
    '.cm-line': {
      padding: '0 4px'
    }
  });

  editorView = new EditorView({
    parent: editorRoot,
    state: EditorState.create({
      doc: state.draftCode,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [jamStrudelAutocomplete],
          closeOnBlur: false
        }),
        javascript(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightActiveLine(),
        highlightSelectionMatches(),
        strudelTheme,
        editorTheme,
        EditorView.updateListener.of(update => {
          if (!update.docChanged || applyingEditorChange) return;
          updateDraft(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          keydown: runEditorShortcut,
          pointerdown(event) {
            event.stopPropagation();
            return false;
          },
          mousedown(event) {
            event.stopPropagation();
            return false;
          }
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap
        ])
      ]
    })
  });
  editorRoot.cmView = editorView;

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
    state.running = true;
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

  codeBridge.addEventListener('input', () => {
    setEditorValue(codeBridge.value, codeBridge.selectionStart, codeBridge.selectionEnd);
    updateDraft(codeBridge.value);
  });

  codeBridge.addEventListener('pointerdown', event => event.stopPropagation());
  codeBridge.addEventListener('mousedown', event => event.stopPropagation());

  codeBridge.addEventListener('keydown', runEditorShortcut);

  unsubscribers.push(ctx.bus.subGlobal('state', value => {
    if (!value || typeof value !== 'object') return;
    suppressPublish = true;
    const incomingIsCurrentMood = value.moodVersion === moodVersion;
    if (!incomingIsCurrentMood) {
      state.code = defaultCode;
      state.draftCode = defaultCode;
      state.moodVersion = moodVersion;
      state.running = false;
      state.gain = 0.58;
    } else if (typeof value.code === 'string') {
      state.code = value.code;
      state.draftCode = typeof value.draftCode === 'string' ? value.draftCode : value.code;
      if (typeof value.running === 'boolean') state.running = value.running;
      if (Number.isFinite(value.gain)) state.gain = clamp(value.gain, 0, 1);
    }
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
      try { editorView?.destroy(); } catch {}
      try { await runtime.removeElement(elementId); } catch {}
    }
  };

  function getEditorValue() {
    return editorView?.state.doc.toString() ?? state.draftCode;
  }

  function setEditorValue(value, selectionStart, selectionEnd = selectionStart) {
    if (!editorView) {
      codeBridge.value = value;
      return;
    }
    const current = editorView.state.doc.toString();
    if (current !== value) {
      const anchor = Number.isFinite(selectionStart) ? clamp(selectionStart, 0, value.length) : undefined;
      const head = Number.isFinite(selectionEnd) ? clamp(selectionEnd, 0, value.length) : anchor;
      applyingEditorChange = true;
      try {
        editorView.dispatch({
          changes: { from: 0, to: current.length, insert: value },
          selection: anchor === undefined ? undefined : { anchor, head }
        });
      } finally {
        applyingEditorChange = false;
      }
    }
    syncCodeBridge();
  }

  function syncCodeBridge() {
    const value = getEditorValue();
    if (codeBridge.value !== value) codeBridge.value = value;
  }
}

function isSilenceShortcut(event) {
  return event.key === '.' && (event.ctrlKey || event.metaKey || event.altKey);
}

function isIndentShortcut(event) {
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key === '}' || event.key === ']' || event.key === '{' || event.key === '[';
}

function getCurrentLine(view) {
  const selection = view.state.selection.main;
  return view.state.doc.lineAt(selection.from).text.trim() || 'silence';
}

function getSelectionOrCurrentBlock(view) {
  const selection = view.state.selection.main;
  if (!selection.empty) {
    return view.state.sliceDoc(selection.from, selection.to).trim() || 'silence';
  }

  const doc = view.state.doc;
  const cursorLine = doc.lineAt(selection.from).number;
  let start = cursorLine;
  let end = cursorLine;
  while (start > 1 && doc.line(start - 1).text.trim()) start -= 1;
  while (end < doc.lines && doc.line(end + 1).text.trim()) end += 1;

  const lines = [];
  for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
    lines.push(doc.line(lineNumber).text);
  }
  return lines.join('\n').trim() || getCurrentLine(view);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
