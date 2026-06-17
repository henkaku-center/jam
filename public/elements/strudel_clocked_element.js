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
    error: '',
    status: 'loading'
  };

  const elementId = ctx.elementId || `strudel_${Math.random().toString(36).slice(2)}`;
  const unsubscribers = [];
  let suppressPublish = false;
  let evalTimer = 0;
  let resizeFrame = 0;
  let lastLayoutSize = { width: 0, height: 0 };
  let lastCameraZoom = null;
  let destroyed = false;

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: inline-block;
        user-select: text;
        -webkit-user-select: text;
        overflow: visible;
      }
      #editor {
        box-sizing: border-box;
        display: inline-block;
        min-width: 16ch;
        min-height: 1.35em;
        overflow: visible;
        color: #d4d8e0;
        background: transparent;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        user-select: text;
        -webkit-user-select: text;
      }
      .code-bridge {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .cm-editor {
        display: inline-block;
        width: max-content;
        min-width: 16ch;
        height: auto;
        overflow: visible;
        background: transparent;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        isolation: isolate;
        --strudel-cursor-cell-width: 1ch;
      }
      .cm-scroller {
        display: inline-block;
        width: max-content;
        min-width: 16ch;
        min-height: 1.35em;
        height: auto;
        overflow: visible !important;
        font-family: inherit;
      }
      .cm-content {
        width: max-content;
        min-width: 16ch;
        padding: 0;
        caret-color: transparent;
        text-shadow: 0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9);
      }
      .cm-line {
        text-shadow: 0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9);
      }
      @keyframes strudel-block-cursor-blink {
        0%, 49% { opacity: 1; }
        50%, 100% { opacity: 0; }
      }
      .cm-editor.cm-focused {
        outline: none !important;
      }
      .cm-cursorLayer {
        pointer-events: none;
        z-index: 20;
      }
      .cm-cursor {
        display: block !important;
        box-sizing: border-box;
        border: 1px solid #67e8f9 !important;
        width: var(--strudel-cursor-cell-width) !important;
        min-width: var(--strudel-cursor-cell-width);
        margin-left: 0;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        mix-blend-mode: normal;
        animation: none;
      }
      .cm-editor.cm-focused .cm-cursor {
        border: 0 !important;
        background: rgba(255, 255, 255, 0.01);
        backdrop-filter: invert(1);
        -webkit-backdrop-filter: invert(1);
        animation: strudel-block-cursor-blink 1.05s steps(1, end) infinite;
      }
      .cm-editor .cm-activeLine {
        background: transparent !important;
      }
      .cm-editor.cm-focused .cm-activeLine {
        background: rgba(255,255,255,0.04) !important;
      }
      .cm-tooltip {
        border: 1px solid #2a2d35;
        background: rgba(18, 20, 25, 0.95);
        color: #d4d8e0;
        overflow: visible;
      }
      .cm-tooltip-autocomplete ul {
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .cm-tooltip-autocomplete ul li[aria-selected] {
        background: rgba(59, 130, 246, 0.2);
        color: #d4d8e0;
      }
    </style>
    <textarea id="code" class="code-bridge" spellcheck="false" tabindex="-1" aria-hidden="true"></textarea>
    <div id="editor" data-no-drag></div>
  `;

  const codeBridge = ctx.domRoot.querySelector('#code');
  const editorRoot = ctx.domRoot.querySelector('#editor');
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
    Prec,
    acceptCompletion,
    autocompletion,
    bracketMatching,
    closeBrackets,
    closeBracketsKeymap,
    completionKeymap,
    defaultHighlightStyle,
    defaultKeymap,
    drawSelection,
    dropCursor,
    highlightActiveLine,
    highlightSelectionMatches,
    history,
    historyKeymap,
    indentLess,
    indentMore,
    indentOnInput,
    jamStrudelAutocomplete,
    javascript,
    keymap,
    searchKeymap,
    startCompletion,
    strudelTheme,
    syntaxHighlighting
  } = editorKit;
  let applyingEditorChange = false;
  let editorView = null;

  const render = () => {
    setEditorValue(state.draftCode);
    syncCodeBridge();
    scheduleEditorResize();
  };

  const updateDraft = (source) => {
    state.draftCode = source;
    state.error = '';
    state.status = state.draftCode === state.code ? 'ready' : 'edited';
    syncCodeBridge();
    render();
  };

  const runEditorShortcut = (event) => {
    if (isDeleteWindowShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      ctx.deleteSelf?.();
      return true;
    }

    if (isSilenceShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      return silenceEditor();
    }

    if (isIndentShortcut(event)) {
      event.preventDefault();
      event.stopPropagation();
      const command = event.shiftKey || event.key === '[' || event.key === '{' ? indentLess : indentMore;
      return command(editorView);
    }

    if (event.key !== 'Enter') return false;
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      return evaluateFullEditor(editorView);
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      return evaluateSelectionOrBlock(editorView);
    }
    if (!event.shiftKey) return false;
    event.preventDefault();
    event.stopPropagation();
    return evaluateCurrentLine(editorView);
  };

  const evaluateFullEditor = (view) => {
    commitAndEvaluate(view.state.doc.toString());
    return true;
  };

  const evaluateSelectionOrBlock = (view) => {
    commitAndEvaluate(getSelectionOrCurrentBlock(view));
    return true;
  };

  const evaluateCurrentLine = (view) => {
    commitAndEvaluate(getCurrentLine(view));
    return true;
  };

  const silenceEditor = () => {
    silenceElement();
    return true;
  };

  const deleteWindow = () => {
    ctx.deleteSelf?.();
    return true;
  };

  const completeOrIndent = (view) => acceptCompletion(view) || startCompletion(view) || indentMore(view);

  const jamShortcutKeymap = [
    { key: 'Alt-Enter', run: evaluateFullEditor, preventDefault: true },
    { key: 'Ctrl-Enter', run: evaluateSelectionOrBlock, preventDefault: true },
    { key: 'Mod-Enter', run: evaluateSelectionOrBlock, preventDefault: true },
    { key: 'Shift-Enter', run: evaluateCurrentLine, preventDefault: true },
    { key: 'Ctrl-.', run: silenceEditor, preventDefault: true },
    { key: 'Mod-.', run: silenceEditor, preventDefault: true },
    { key: 'Alt-.', run: silenceEditor, preventDefault: true },
    { key: 'Ctrl-[', run: indentLess, preventDefault: true },
    { key: 'Ctrl-]', run: indentMore, preventDefault: true },
    { key: 'Mod-[', run: indentLess, preventDefault: true },
    { key: 'Mod-]', run: indentMore, preventDefault: true },
    { key: 'Ctrl-Delete', run: deleteWindow, preventDefault: true },
    { key: 'Ctrl-Backspace', run: deleteWindow, preventDefault: true },
    { key: 'Tab', run: completeOrIndent, preventDefault: true }
  ];

  const editorTheme = EditorView.theme({
    '&': {
      color: '#d4d8e0',
      background: 'transparent !important'
    },
    '&.cm-editor': {
      background: 'transparent !important',
      isolation: 'isolate'
    },
    '.cm-scroller': {
      background: 'transparent !important'
    },
    '.cm-activeLine': {
      background: 'transparent !important'
    },
    '&.cm-focused .cm-activeLine': {
      background: 'rgba(255,255,255,0.04) !important'
    },
    '.cm-content': {
      minHeight: '100%',
      caretColor: 'transparent',
      textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)'
    },
    '&.cm-focused': {
      outline: 'none'
    },
    '.cm-cursorLayer': {
      pointerEvents: 'none',
      zIndex: '20'
    },
    '.cm-cursor': {
      display: 'block !important',
      boxSizing: 'border-box',
      border: '1px solid #67e8f9 !important',
      width: 'var(--strudel-cursor-cell-width) !important',
      minWidth: 'var(--strudel-cursor-cell-width)',
      marginLeft: '0',
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      mixBlendMode: 'normal',
      animation: 'none'
    },
    '&.cm-focused .cm-cursor': {
      border: '0 !important',
      background: 'rgba(255, 255, 255, 0.01)',
      backdropFilter: 'invert(1)',
      WebkitBackdropFilter: 'invert(1)',
      animation: 'strudel-block-cursor-blink 1.05s steps(1, end) infinite'
    },
    '.cm-line': {
      padding: '0',
      textShadow: '0 0 6px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.9)'
    }
  });

  editorView = new EditorView({
    parent: editorRoot,
    state: EditorState.create({
      doc: state.draftCode,
      extensions: [
        Prec.highest(keymap.of(jamShortcutKeymap)),
        history(),
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
          if (update.docChanged || update.geometryChanged || update.viewportChanged) {
            scheduleEditorResize();
          }
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
          ...completionKeymap
        ])
      ]
    })
  });
  editorRoot.cmView = editorView;
  scheduleEditorResize();

  const publishState = () => {
    if (suppressPublish) return;
    ctx.bus.pubGlobal('state', {
      code: state.code,
      draftCode: state.draftCode,
      running: state.running,
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
        running: state.running
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

  const silenceElement = () => {
    clearTimeout(evalTimer);
    state.running = false;
    state.error = '';
    state.status = 'stopped';
    publishState();
    evalTimer = setTimeout(() => evaluateNow(state.code), 0);
    render();
  };

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
    } else if (typeof value.code === 'string') {
      state.code = value.code;
      state.draftCode = typeof value.draftCode === 'string' ? value.draftCode : value.code;
      if (typeof value.running === 'boolean') state.running = value.running;
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
    update() {
      const zoom = window.__jamCamera?.zoom ?? 1;
      if (zoom !== lastCameraZoom) {
        lastCameraZoom = zoom;
        scheduleEditorResize();
      }
    },
    getState() {
      return {
        code: state.code,
        draftCode: state.draftCode,
        running: state.running,
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
      cancelAnimationFrame(resizeFrame);
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

  function scheduleEditorResize() {
    if (destroyed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(measureAndPublishEditorSize);
  }

  function measureAndPublishEditorSize() {
    resizeFrame = 0;
    if (destroyed || !editorRoot.isConnected) return;

    const content = editorRoot.querySelector('.cm-content');
    const lineCount = editorView?.state.doc.lines || 1;
    const lineHeight = readPixelSize(editorRoot.querySelector('.cm-line'), 'lineHeight', 15);
    const charWidth = readCharWidth();
    setCursorCellWidth(charWidth);
    const longestLineLength = Math.max(16, ...editorView.state.doc.toString().split('\n').map(line => line.length));
    const measuredWidth = Math.ceil(Math.max(
      editorRoot.scrollWidth,
      content?.scrollWidth || 0,
      longestLineLength * charWidth
    ));
    const measuredHeight = Math.ceil(Math.max(
      editorRoot.scrollHeight,
      content?.scrollHeight || 0,
      lineCount * lineHeight
    ));
    const nextSize = {
      width: clamp(measuredWidth + 2, 120, 1200),
      height: clamp(measuredHeight + 2, 20, 900)
    };

    if (Math.abs(nextSize.width - lastLayoutSize.width) < 2 &&
        Math.abs(nextSize.height - lastLayoutSize.height) < 2) {
      return;
    }

    lastLayoutSize = nextSize;
    ctx.requestLayout?.(nextSize);
  }

  function readPixelSize(element, property, fallback) {
    const value = element ? Number.parseFloat(getComputedStyle(element)[property]) : NaN;
    return Number.isFinite(value) ? value : fallback;
  }

  function readCharWidth() {
    const content = editorRoot.querySelector('.cm-content') || editorRoot;
    const probe = document.createElement('span');
    probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit;';
    content.appendChild(probe);
    const width = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return Number.isFinite(width) && width > 0 ? width : 7;
  }

  function setCursorCellWidth(charWidth) {
    if (!Number.isFinite(charWidth) || charWidth <= 0) return;
    const editor = editorRoot.querySelector('.cm-editor');
    editor?.style.setProperty('--strudel-cursor-cell-width', `${charWidth.toFixed(3)}px`);
  }
}

function isSilenceShortcut(event) {
  return event.key === '.' && (event.ctrlKey || event.metaKey || event.altKey);
}

function isDeleteWindowShortcut(event) {
  return (event.key === 'Delete' || event.key === 'Backspace') &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey;
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
