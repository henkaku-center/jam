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
  const theme = getStrudelWindowTheme(elementId);
  const unsubscribers = [];
  let suppressPublish = false;
  let evalTimer = 0;
  let cursorBarToggleTimer = 0;
  let resizeFrame = 0;
  let editorOverlayFrame = 0;
  let lastLayoutSize = { width: 0, height: 0 };
  let lastCameraZoom = null;
  let destroyed = false;
  let cursorBarVisible = false;
  let cursorOverlay = null;
  let selectionOverlay = null;
  let remoteCursorOverlay = null;
  let remoteSelectionOverlay = null;
  let activeLineHandle = null;
  let editorOverlayStyle = null;
  let yjs = null;

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
        color: ${theme.text};
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
        pointer-events: auto;
      }
      .cm-editor {
        display: inline-block;
        width: max-content;
        min-width: 16ch;
        height: auto;
        overflow: visible;
        color: ${theme.text} !important;
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
        color: ${theme.text};
        caret-color: transparent;
        text-shadow: none;
      }
      .cm-line {
        color: ${theme.text};
        position: relative;
        overflow: visible;
        text-shadow: none;
      }
      .cm-line span,
      .cm-content span {
        text-shadow: none !important;
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
        border: 1px solid ${theme.cursor} !important;
        width: var(--strudel-cursor-cell-width) !important;
        min-width: var(--strudel-cursor-cell-width);
        overflow: hidden;
        margin-left: 0;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        mix-blend-mode: normal;
        animation: none;
      }
      .cm-editor.cm-focused .cm-cursor {
        border: 0 !important;
        background: transparent;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
        mix-blend-mode: normal;
        animation: none;
      }
      .cm-editor .cm-activeLine {
        background: transparent !important;
      }
      .cm-editor.cm-focused .cm-activeLine {
        background: ${theme.activeLine} !important;
      }
      .cm-editor.cm-focused .cm-activeLine::before {
        content: "";
        display: none;
      }
      .cm-ySelection {
        background: transparent !important;
        background-color: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
        mix-blend-mode: normal;
        filter: none;
        outline: none;
      }
      .cm-yLineSelection {
        background: transparent !important;
        background-color: transparent !important;
        margin: 0 !important;
        padding: 0 !important;
        mix-blend-mode: normal;
        filter: none;
        outline: none;
      }
      .cm-ySelectionCaret {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow: hidden;
        animation: none !important;
      }
      .cm-ySelectionCaretDot {
        display: none !important;
      }
      .cm-ySelectionInfo {
        display: none !important;
      }
      .cm-editor.cm-focused .cm-selectionBackground,
      .cm-editor.cm-editor.cm-focused .cm-selectionBackground,
      .cm-editor .cm-line::selection,
      .cm-editor .cm-selectionLayer .cm-selectionBackground,
      .cm-editor.cm-editor .cm-selectionLayer .cm-selectionBackground,
      .cm-editor .cm-content ::selection {
        background: transparent !important;
        background-color: transparent !important;
      }
      .cm-tooltip {
        border: 1px solid ${theme.tooltipBorder};
        background: rgba(0, 5, 8, 0.98);
        color: ${theme.text};
        overflow: visible;
      }
      .cm-tooltip-autocomplete ul {
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .cm-tooltip-autocomplete ul li[aria-selected] {
        background: ${theme.tooltipSelected};
        color: ${theme.text};
      }
    </style>
    <textarea id="code" class="code-bridge" spellcheck="false" tabindex="-1" aria-hidden="true"></textarea>
    <div id="editor" data-no-drag></div>
  `;

  const codeBridge = ctx.domRoot.querySelector('#code');
  const editorRoot = ctx.domRoot.querySelector('#editor');
  const editorKit = await import('/vendor/strudel-editor.js');
  yjs = await import('yjs');
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
    highlightExtension,
    highlightMiniLocations,
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
    syntaxHighlighting,
    updateMiniLocations,
    yCollab,
    yUndoManagerKeymap
  } = editorKit;
  let applyingEditorChange = false;
  let editorView = null;
  let lastActiveLineDragStart = 0;
  const yText = getCollaborativeCodeText();
  if (yText) state.draftCode = yText.toString();

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
      color: `${theme.text} !important`,
      background: 'transparent !important'
    },
    '&.cm-editor': {
      color: `${theme.text} !important`,
      background: 'transparent !important',
      isolation: 'isolate',
      '--foreground': theme.cursor
    },
    '.cm-scroller': {
      background: 'transparent !important'
    },
    '.cm-line, .cm-content': {
      color: theme.text,
      textShadow: 'none !important'
    },
    '.cm-line span, .cm-content span': {
      textShadow: 'none !important'
    },
    '.cm-line .ͼ11, .cm-line .ͼ16, .cm-content .ͼ11, .cm-content .ͼ16': {
      color: `${theme.function} !important`
    },
    '.cm-line .ͼy, .cm-line .ͼw, .cm-content .ͼy, .cm-content .ͼw': {
      color: `${theme.keyword} !important`
    },
    '.cm-line .ͼs, .cm-line .ͼ19, .cm-content .ͼs, .cm-content .ͼ19': {
      color: `${theme.string} !important`
    },
    '.cm-line .ͼ13, .cm-content .ͼ13': {
      color: `${theme.number} !important`
    },
    '.cm-activeLine': {
      background: 'transparent !important'
    },
    '&.cm-focused .cm-activeLine': {
      background: `${theme.activeLine} !important`
    },
    '&.cm-focused .cm-activeLine::before': {
      content: '""',
      display: 'none'
    },
    '.cm-ySelection': {
      background: 'transparent !important',
      backgroundColor: 'transparent !important',
      margin: '0 !important',
      padding: '0 !important',
      mixBlendMode: 'normal',
      filter: 'none',
      outline: 'none'
    },
    '.cm-yLineSelection': {
      background: 'transparent !important',
      backgroundColor: 'transparent !important',
      margin: '0 !important',
      padding: '0 !important',
      mixBlendMode: 'normal',
      filter: 'none',
      outline: 'none'
    },
    '.cm-ySelectionCaret': {
      display: 'none !important',
      width: '0 !important',
      minWidth: '0 !important',
      height: '0 !important',
      margin: '0 !important',
      padding: '0 !important',
      border: '0 !important',
      overflow: 'hidden',
      animation: 'none !important'
    },
    '.cm-ySelectionCaretDot': {
      display: 'none !important'
    },
    '.cm-ySelectionInfo': {
      display: 'none !important'
    },
    '&.cm-focused .cm-selectionBackground, &.cm-editor.cm-editor.cm-focused .cm-selectionBackground, & .cm-line::selection, & .cm-selectionLayer .cm-selectionBackground, &.cm-editor.cm-editor .cm-selectionLayer .cm-selectionBackground, & .cm-content ::selection': {
      background: 'transparent !important',
      backgroundColor: 'transparent !important'
    },
    '.cm-content': {
      minHeight: '100%',
      caretColor: 'transparent',
      textShadow: 'none'
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
      border: `1px solid ${theme.cursor} !important`,
      width: 'var(--strudel-cursor-cell-width) !important',
      minWidth: 'var(--strudel-cursor-cell-width)',
      overflow: 'hidden',
      marginLeft: '0',
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      mixBlendMode: 'normal',
      animation: 'none'
    },
    '&.cm-focused .cm-cursor': {
      border: '0 !important',
      background: 'transparent',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
      mixBlendMode: 'normal',
      animation: 'none'
    },
    '.cm-line': {
      padding: '0',
      position: 'relative',
      overflow: 'visible',
      textShadow: 'none'
    }
  });

  editorView = new EditorView({
    parent: editorRoot,
    state: EditorState.create({
      doc: state.draftCode,
      extensions: [
        Prec.highest(keymap.of(jamShortcutKeymap)),
        ...getUndoAndCollaborationExtensions(),
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
        highlightExtension,
        highlightActiveLine(),
        highlightSelectionMatches(),
        strudelTheme,
        editorTheme,
        EditorView.updateListener.of(update => {
          if (update.docChanged || update.geometryChanged || update.viewportChanged) {
            scheduleEditorResize();
          }
          if (update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || update.focusChanged) {
            scheduleEditorOverlaySync();
          }
          if (!update.docChanged || applyingEditorChange) return;
          updateDraft(update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          keydown: runEditorShortcut,
          focus() {
            scheduleEditorOverlaySync();
            return false;
          },
          blur() {
            scheduleEditorOverlaySync();
            return false;
          },
          pointerdown(event) {
            if (beginActiveLineMarkerDrag(event)) return true;
            event.stopPropagation();
            return false;
          },
          mousedown(event) {
            if (beginActiveLineMarkerDrag(event)) return true;
            event.stopPropagation();
            return false;
          }
        }),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...(yText ? yUndoManagerKeymap : historyKeymap),
          ...completionKeymap
        ])
      ]
    })
  });
  editorRoot.cmView = editorView;
  installActiveLineMarkerDragHandle();
  installPatternHighlighting();
  installRemoteAwarenessOverlaySync();
  scheduleEditorResize();
  scheduleEditorOverlaySync();

  const publishState = () => {
    if (suppressPublish) return;
    state.draftCode = getEditorValue();
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
    state.draftCode = getEditorValue();
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
      const incomingDraftCode = typeof value.draftCode === 'string' ? value.draftCode : value.code;
      if (yText) seedCollaborativeCodeText(yText, incomingDraftCode);
      state.draftCode = yText ? getEditorValue() : incomingDraftCode;
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
  scheduleNextCursorBarSync();
  evalTimer = setTimeout(() => evaluateNow(state.code), 0);

  return {
    update() {
      const zoom = window.__jamCamera?.zoom ?? 1;
      if (zoom !== lastCameraZoom) {
        lastCameraZoom = zoom;
        scheduleEditorResize();
        scheduleEditorOverlaySync();
      }
      if (editorView?.hasFocus || hasRemoteAwarenessCursor()) scheduleEditorOverlaySync();
    },
    getState() {
      state.draftCode = getEditorValue();
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
      clearTimeout(cursorBarToggleTimer);
      unsubscribers.forEach(unsub => {
        try { unsub(); } catch {}
      });
      try { editorView?.destroy(); } catch {}
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(editorOverlayFrame);
      removeEditorOverlays();
      if (typeof ctx.isCurrentInstance !== 'function' || ctx.isCurrentInstance()) {
        try { await runtime.removeElement(elementId); } catch {}
      }
    }
  };

  function getEditorValue() {
    return editorView?.state.doc.toString() ?? state.draftCode;
  }

  function getCollaborativeCodeText() {
    if (!ctx.ydoc || typeof ctx.ydoc.getText !== 'function') return null;
    const text = ctx.ydoc.getText(`strudel:${elementId}:code`);
    seedCollaborativeCodeText(text, state.draftCode || state.code || getRuntimeDebugSource());
    return text;
  }

  function seedCollaborativeCodeText(text, source) {
    if (!text || text.length > 0 || !source) return;
    text.insert(0, String(source));
  }

  function getRuntimeDebugSource() {
    return window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '';
  }

  function getUndoAndCollaborationExtensions() {
    if (!yText) return [history()];
    return [
      yCollab(yText, ctx.awareness || null)
    ];
  }

  function installPatternHighlighting() {
    const handleMiniLocations = event => {
      if (event.detail?.elementId !== elementId || !editorView) return;
      updateMiniLocations(editorView, event.detail.miniLocations || []);
    };
    const handleHighlightFrame = event => {
      if (event.detail?.elementId !== elementId || !editorView) return;
      highlightMiniLocations(editorView, event.detail.phase || 0, event.detail.haps || []);
    };

    window.addEventListener('jam-strudel-mini-locations', handleMiniLocations);
    window.addEventListener('jam-strudel-highlight-frame', handleHighlightFrame);
    unsubscribers.push(() => {
      window.removeEventListener('jam-strudel-mini-locations', handleMiniLocations);
      window.removeEventListener('jam-strudel-highlight-frame', handleHighlightFrame);
    });

    const existingLocations = window.__jamStrudelRuntimeDebug?.miniLocations?.[elementId];
    if (existingLocations?.length) updateMiniLocations(editorView, existingLocations);
  }

  function installRemoteAwarenessOverlaySync() {
    if (!ctx.awareness?.on || !ctx.awareness?.off) return;
    const handleAwarenessChange = () => scheduleEditorOverlaySync();
    ctx.awareness.on('change', handleAwarenessChange);
    unsubscribers.push(() => ctx.awareness.off('change', handleAwarenessChange));
  }

  function installActiveLineMarkerDragHandle() {
    const handlePointerStart = (event) => {
      beginActiveLineMarkerDrag(event);
    };
    editorRoot.addEventListener('pointerdown', handlePointerStart, true);
    editorRoot.addEventListener('mousedown', handlePointerStart, true);
    unsubscribers.push(() => {
      editorRoot.removeEventListener('pointerdown', handlePointerStart, true);
      editorRoot.removeEventListener('mousedown', handlePointerStart, true);
    });
  }

  function beginActiveLineMarkerDrag(event, options = {}) {
    if (!event || event.button !== 0 || (!options.skipHitTest && !isActiveLineMarkerEvent(event))) return false;
    event.preventDefault();
    event.stopPropagation();

    const now = performance.now();
    if (now - lastActiveLineDragStart < 80) return true;
    lastActiveLineDragStart = now;

    const point = {
      clientX: event.clientX,
      clientY: event.clientY
    };
    if (typeof ctx.beginElementDrag === 'function') {
      ctx.beginElementDrag(point);
    } else {
      editorRoot.dispatchEvent(new CustomEvent('jam-begin-element-drag', {
        bubbles: true,
        composed: true,
        detail: point
      }));
    }
    return true;
  }

  function isActiveLineMarkerEvent(event) {
    if (!editorView?.hasFocus) return false;
    const activeLine = editorRoot.querySelector('.cm-activeLine');
    if (!activeLine) return false;
    const rect = activeLine.getBoundingClientRect();
    const markerWidth = Math.max(readCharWidth() * 1.5, 12);
    return event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      event.clientX >= rect.left - markerWidth &&
      event.clientX <= rect.left;
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

  function scheduleNextCursorBarSync() {
    clearTimeout(cursorBarToggleTimer);
    const delayMs = getMsUntilNextBar();
    cursorBarToggleTimer = setTimeout(() => {
      if (destroyed) return;
      cursorBarVisible = getSharedCursorBarVisibility();
      scheduleEditorOverlaySync();
      scheduleNextCursorBarSync();
    }, delayMs);
  }

  function scheduleEditorResize() {
    if (destroyed || resizeFrame) return;
    resizeFrame = requestAnimationFrame(measureAndPublishEditorSize);
  }

  function scheduleEditorOverlaySync() {
    if (destroyed || editorOverlayFrame) return;
    editorOverlayFrame = requestAnimationFrame(syncEditorOverlays);
  }

  function syncEditorOverlays() {
    editorOverlayFrame = 0;
    if (destroyed || !editorView || !editorRoot.isConnected) {
      hideCursorOverlay();
      hideSelectionOverlay();
      hideRemoteCursorOverlay();
      hideRemoteSelectionOverlay();
      hideActiveLineHandle();
      return;
    }

    cursorBarVisible = getSharedCursorBarVisibility();
    syncRemoteAwarenessOverlays();

    if (!editorView.hasFocus) {
      hideCursorOverlay();
      hideSelectionOverlay();
      hideActiveLineHandle();
      return;
    }

    syncActiveLineHandle();

    const hasSelection = editorView.state.selection.ranges.some(range => !range.empty);
    if (hasSelection) {
      hideCursorOverlay();
      syncSelectionOverlay();
      return;
    }
    hideSelectionOverlay();

    const selection = editorView.state.selection.main;
    const coords = getCursorCoords(selection.head);
    if (!coords) {
      hideCursorOverlay();
      return;
    }

    const overlay = ensureCursorOverlay();
    overlay.style.display = 'block';
    overlay.style.left = `${coords.left}px`;
    overlay.style.top = `${coords.top}px`;
    overlay.style.width = `${Math.max(1, readCharWidth())}px`;
    overlay.style.height = `${Math.max(1, coords.bottom - coords.top)}px`;
    applyCursorBlinkTiming(overlay);
  }

  function getSharedCursorBarVisibility() {
    const bpm = Number(ctx.clock?.bpm) || 120;
    const startTime = Number(ctx.clock?.startTime) || Date.now();
    const syncNow = typeof ctx.clock?.now === 'function' ? ctx.clock.now() : Date.now();
    const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
    const barIndex = Math.floor(Math.max(0, elapsedBeats) / 4);
    return barIndex % 2 === 0;
  }

  function syncActiveLineHandle() {
    const activeLine = editorRoot.querySelector('.cm-activeLine');
    if (!activeLine) {
      hideActiveLineHandle();
      return;
    }
    const rect = activeLine.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideActiveLineHandle();
      return;
    }
    const handle = ensureActiveLineHandle();
    const width = Math.max(readCharWidth() * 1.5, 12);
    handle.style.display = 'block';
    handle.style.left = `${rect.left - width}px`;
    handle.style.top = `${rect.top}px`;
    handle.style.width = `${width}px`;
    handle.style.height = `${rect.height}px`;
    handle.style.lineHeight = `${rect.height}px`;
  }

  function ensureActiveLineHandle() {
    ensureEditorOverlayStyle();
    if (!activeLineHandle) {
      activeLineHandle = document.createElement('div');
      activeLineHandle.className = 'jam-strudel-active-line-handle';
      activeLineHandle.dataset.strudelActiveLineHandle = elementId;
      activeLineHandle.textContent = '❯';
      const handlePointerStart = (event) => beginActiveLineMarkerDrag(event, { skipHitTest: true });
      activeLineHandle.addEventListener('mouseenter', () => {
        activeLineHandle.textContent = '✥';
      });
      activeLineHandle.addEventListener('mouseleave', () => {
        activeLineHandle.textContent = '❯';
      });
      activeLineHandle.addEventListener('pointerdown', handlePointerStart);
      activeLineHandle.addEventListener('mousedown', handlePointerStart);
      document.body.appendChild(activeLineHandle);
    }
    return activeLineHandle;
  }

  function getMsUntilNextBar() {
    const bpm = Number(ctx.clock?.bpm) || 120;
    const startTime = Number(ctx.clock?.startTime) || Date.now();
    const syncNow = typeof ctx.clock?.now === 'function' ? ctx.clock.now() : Date.now();
    const beatMs = 60000 / bpm;
    const barMs = beatMs * 4;
    const elapsedMs = Math.max(0, syncNow - startTime);
    const msIntoBar = ((elapsedMs % barMs) + barMs) % barMs;
    return clamp(Math.ceil(barMs - msIntoBar) + 4, 16, 10000);
  }

  function getCursorCoords(pos) {
    return editorView.coordsAtPos(pos) ||
      editorView.coordsAtPos(pos, -1) ||
      editorView.coordsAtPos(pos, 1);
  }

  function applyCursorBlinkTiming(node, timing = getSharedCursorBlinkTiming()) {
    node.style.setProperty('--jam-strudel-cursor-blink-cycle', `${timing.cycleMs}ms`);
    node.style.setProperty('--jam-strudel-cursor-blink-delay', `${timing.delayMs}ms`);
  }

  function getSharedCursorBlinkTiming() {
    const bpm = Number(ctx.clock?.bpm) || 120;
    const startTime = Number(ctx.clock?.startTime) || Date.now();
    const syncNow = typeof ctx.clock?.now === 'function' ? ctx.clock.now() : Date.now();
    const barMs = (60000 / bpm) * 4;
    const cycleMs = barMs * 2;
    const elapsedMs = Math.max(0, syncNow - startTime);
    const elapsedInCycle = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;
    return {
      cycleMs,
      delayMs: -elapsedInCycle
    };
  }

  function syncSelectionOverlay() {
    const rects = getRangeOverlayRects(editorView.state.selection.ranges);
    if (!rects.length) {
      hideSelectionOverlay();
      return;
    }

    const overlay = ensureSelectionOverlay();
    overlay.style.display = 'block';
    while (overlay.children.length < rects.length) {
      const rectNode = document.createElement('div');
      rectNode.className = 'jam-strudel-document-selection-rect';
      overlay.appendChild(rectNode);
    }
    while (overlay.children.length > rects.length) {
      overlay.lastElementChild?.remove();
    }

    rects.forEach((rect, index) => {
      const rectNode = overlay.children[index];
      rectNode.style.left = `${rect.left}px`;
      rectNode.style.top = `${rect.top}px`;
      rectNode.style.width = `${rect.width}px`;
      rectNode.style.height = `${rect.height}px`;
    });
  }

  function getRangeOverlayRects(ranges) {
    const rects = [];
    const { doc } = editorView.state;
    for (const range of ranges) {
      if (range.empty || range.from === range.to) continue;
      const from = Math.min(range.from, range.to);
      const to = Math.max(range.from, range.to);
      let line = doc.lineAt(from);
      while (line.from <= to) {
        const segmentFrom = Math.max(from, line.from);
        const segmentTo = Math.min(to, line.to);
        if (segmentFrom < segmentTo) {
          const start = editorView.coordsAtPos(segmentFrom, 1);
          const end = editorView.coordsAtPos(segmentTo, -1);
          if (start && end) {
            const left = Math.min(start.left, end.left);
            const right = Math.max(start.left, end.left);
            const top = Math.min(start.top, end.top);
            const bottom = Math.max(start.bottom, end.bottom);
            rects.push({
              left,
              top,
              width: Math.max(1, right - left),
              height: Math.max(1, bottom - top)
            });
          }
        }
        if (line.to >= to || line.number >= doc.lines) break;
        line = doc.line(line.number + 1);
      }
    }
    return rects;
  }

  function syncRemoteAwarenessOverlays() {
    const ranges = getRemoteAwarenessRanges();
    const selectionRanges = ranges.filter(range => range.from !== range.to);
    syncRemoteSelectionOverlay(selectionRanges);
    syncRemoteCursorOverlay(ranges);
  }

  function syncRemoteCursorOverlay(ranges) {
    if (!ranges.length) {
      hideRemoteCursorOverlay();
      return;
    }

    const overlay = ensureRemoteCursorOverlay();
    overlay.style.display = 'block';
    while (overlay.children.length < ranges.length) {
      const cursorNode = document.createElement('div');
      cursorNode.className = 'jam-strudel-remote-cursor-rect';
      overlay.appendChild(cursorNode);
    }
    while (overlay.children.length > ranges.length) {
      overlay.lastElementChild?.remove();
    }

    const charWidth = Math.max(1, readCharWidth());
    const blinkTiming = getSharedCursorBlinkTiming();
    ranges.forEach((range, index) => {
      const cursorNode = overlay.children[index];
      const coords = getCursorCoords(range.head);
      if (!coords) {
        cursorNode.style.display = 'none';
        return;
      }
      cursorNode.style.display = 'block';
      cursorNode.style.left = `${coords.left}px`;
      cursorNode.style.top = `${coords.top}px`;
      cursorNode.style.width = `${charWidth}px`;
      cursorNode.style.height = `${Math.max(1, coords.bottom - coords.top)}px`;
      applyCursorBlinkTiming(cursorNode, blinkTiming);
    });
  }

  function syncRemoteSelectionOverlay(ranges) {
    const rects = getRangeOverlayRects(ranges);
    if (!rects.length) rects.push(...getRemoteSelectionMarkRects());
    if (!rects.length) {
      hideRemoteSelectionOverlay();
      return;
    }

    const overlay = ensureRemoteSelectionOverlay();
    overlay.style.display = 'block';
    while (overlay.children.length < rects.length) {
      const rectNode = document.createElement('div');
      rectNode.className = 'jam-strudel-remote-selection-rect';
      overlay.appendChild(rectNode);
    }
    while (overlay.children.length > rects.length) {
      overlay.lastElementChild?.remove();
    }

    rects.forEach((rect, index) => {
      const rectNode = overlay.children[index];
      rectNode.style.left = `${rect.left}px`;
      rectNode.style.top = `${rect.top}px`;
      rectNode.style.width = `${rect.width}px`;
      rectNode.style.height = `${rect.height}px`;
    });
  }

  function getRemoteSelectionMarkRects() {
    const rects = [];
    const marks = editorRoot.querySelectorAll('.cm-ySelection, .cm-yLineSelection');
    marks.forEach(mark => {
      for (const rect of mark.getClientRects()) {
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects.push({
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        });
      }
    });
    return rects;
  }

  function getRemoteAwarenessRanges() {
    if (!ctx.awareness?.getStates || !ctx.awareness?.doc || !yText || !yjs) return [];
    const ranges = [];
    const states = ctx.awareness.getStates();
    const localClientId = ctx.awareness.doc.clientID;
    for (const [clientId, awarenessState] of states.entries()) {
      if (clientId === localClientId) continue;
      const cursor = awarenessState?.cursor;
      if (!cursor?.anchor || !cursor?.head) continue;
      const anchor = yjs.createAbsolutePositionFromRelativePosition(cursor.anchor, yText.doc);
      const head = yjs.createAbsolutePositionFromRelativePosition(cursor.head, yText.doc);
      if (!anchor || !head || anchor.type !== yText || head.type !== yText) continue;
      ranges.push({
        from: Math.min(anchor.index, head.index),
        to: Math.max(anchor.index, head.index),
        head: clamp(head.index, 0, editorView.state.doc.length)
      });
    }
    return ranges;
  }

  function hasRemoteAwarenessCursor() {
    if (!ctx.awareness?.getStates || !ctx.awareness?.doc) return false;
    const localClientId = ctx.awareness.doc.clientID;
    for (const [clientId, awarenessState] of ctx.awareness.getStates().entries()) {
      if (clientId !== localClientId && awarenessState?.cursor?.anchor && awarenessState?.cursor?.head) return true;
    }
    return false;
  }

  function ensureCursorOverlay() {
    ensureEditorOverlayStyle();
    if (!cursorOverlay) {
      cursorOverlay = document.createElement('div');
      cursorOverlay.className = 'jam-strudel-document-cursor';
      cursorOverlay.dataset.strudelCursorOverlay = elementId;
      document.body.appendChild(cursorOverlay);
    }
    return cursorOverlay;
  }

  function ensureEditorOverlayStyle() {
    if (!editorOverlayStyle) {
      editorOverlayStyle = document.createElement('style');
      editorOverlayStyle.textContent = `
        .jam-strudel-document-cursor,
        .jam-strudel-remote-cursor-rect {
          position: fixed;
          display: none;
          pointer-events: none;
          mix-blend-mode: difference;
          filter: none;
          animation: jam-strudel-cursor-bar-blink var(--jam-strudel-cursor-blink-cycle, 4000ms) steps(1, end) infinite;
          animation-delay: var(--jam-strudel-cursor-blink-delay, 0ms);
          z-index: 2147483647;
        }
        .jam-strudel-document-cursor {
          background: #fff;
        }
        .jam-strudel-document-selection {
          display: none;
          pointer-events: none;
        }
        .jam-strudel-document-selection-rect,
        .jam-strudel-remote-selection-rect {
          position: fixed;
          mix-blend-mode: difference;
          filter: none;
          animation: none;
          z-index: 2147483646;
        }
        .jam-strudel-document-selection-rect {
          background: #fff;
        }
        .jam-strudel-remote-cursor,
        .jam-strudel-remote-selection {
          display: none;
          pointer-events: none;
        }
        .jam-strudel-remote-cursor-rect,
        .jam-strudel-remote-selection-rect {
          background: ${theme.remoteCursor};
        }
        .jam-strudel-remote-selection-rect {
          background: ${theme.remoteSelection};
        }
        .jam-strudel-active-line-handle {
          position: fixed;
          display: none;
          color: ${theme.cursor};
          background: transparent;
          font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          text-align: right;
          cursor: move;
          user-select: none;
          pointer-events: auto;
          z-index: 2147483647;
        }
        @keyframes jam-strudel-cursor-bar-blink {
          0%, 49.999% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `;
      document.head.appendChild(editorOverlayStyle);
    }
  }

  function ensureSelectionOverlay() {
    ensureEditorOverlayStyle();
    if (!selectionOverlay) {
      selectionOverlay = document.createElement('div');
      selectionOverlay.className = 'jam-strudel-document-selection';
      selectionOverlay.dataset.strudelSelectionOverlay = elementId;
      document.body.appendChild(selectionOverlay);
    }
    return selectionOverlay;
  }

  function ensureRemoteCursorOverlay() {
    ensureEditorOverlayStyle();
    if (!remoteCursorOverlay) {
      remoteCursorOverlay = document.createElement('div');
      remoteCursorOverlay.className = 'jam-strudel-remote-cursor';
      remoteCursorOverlay.dataset.strudelRemoteCursorOverlay = elementId;
      document.body.appendChild(remoteCursorOverlay);
    }
    return remoteCursorOverlay;
  }

  function ensureRemoteSelectionOverlay() {
    ensureEditorOverlayStyle();
    if (!remoteSelectionOverlay) {
      remoteSelectionOverlay = document.createElement('div');
      remoteSelectionOverlay.className = 'jam-strudel-remote-selection';
      remoteSelectionOverlay.dataset.strudelRemoteSelectionOverlay = elementId;
      document.body.appendChild(remoteSelectionOverlay);
    }
    return remoteSelectionOverlay;
  }

  function hideCursorOverlay() {
    if (cursorOverlay) cursorOverlay.style.display = 'none';
  }

  function hideSelectionOverlay() {
    if (selectionOverlay) selectionOverlay.style.display = 'none';
  }

  function hideRemoteCursorOverlay() {
    if (remoteCursorOverlay) remoteCursorOverlay.style.display = 'none';
  }

  function hideRemoteSelectionOverlay() {
    if (remoteSelectionOverlay) remoteSelectionOverlay.style.display = 'none';
  }

  function hideActiveLineHandle() {
    if (activeLineHandle) activeLineHandle.style.display = 'none';
  }

  function removeEditorOverlays() {
    cursorOverlay?.remove();
    selectionOverlay?.remove();
    remoteCursorOverlay?.remove();
    remoteSelectionOverlay?.remove();
    activeLineHandle?.remove();
    editorOverlayStyle?.remove();
    cursorOverlay = null;
    selectionOverlay = null;
    remoteCursorOverlay = null;
    remoteSelectionOverlay = null;
    activeLineHandle = null;
    editorOverlayStyle = null;
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
    setCursorTextMetrics(editor);
  }

  function setCursorTextMetrics(editor) {
    if (!editor) return;
    const line = editorRoot.querySelector('.cm-line');
    if (!line) return;

    const lineStyle = getComputedStyle(line);
    const lineRect = line.getBoundingClientRect();
    const computedLineHeight = Number.parseFloat(lineStyle.lineHeight);
    const computedFontSize = Number.parseFloat(lineStyle.fontSize);
    const visualScale = Number.isFinite(computedLineHeight) && computedLineHeight > 0
      ? lineRect.height / computedLineHeight
      : 1;
    const fontSize = Number.isFinite(computedFontSize) ? computedFontSize * visualScale : 11;
    const lineHeight = Number.isFinite(lineRect.height) && lineRect.height > 0 ? lineRect.height : fontSize * 1.35;

    editor.style.setProperty('--strudel-cursor-font-family', lineStyle.fontFamily);
    editor.style.setProperty('--strudel-cursor-font-size', `${fontSize.toFixed(3)}px`);
    editor.style.setProperty('--strudel-cursor-line-height', `${lineHeight.toFixed(3)}px`);
  }

}

function isSilenceShortcut(event) {
  return event.key === '.' && (event.ctrlKey || event.metaKey || event.altKey);
}

function getStrudelWindowTheme(elementId) {
  const palettes = [
    {
      text: '#e0f2fe',
      cursor: '#38bdf8',
      function: '#7dd3fc',
      keyword: '#c4b5fd',
      string: '#86efac',
      number: '#f0abfc',
      active: '#0ea5e9'
    },
    {
      text: '#fff7ed',
      cursor: '#fb923c',
      function: '#fdba74',
      keyword: '#fde047',
      string: '#f9a8d4',
      number: '#a7f3d0',
      active: '#f97316'
    },
    {
      text: '#f5f3ff',
      cursor: '#a78bfa',
      function: '#c4b5fd',
      keyword: '#f0abfc',
      string: '#67e8f9',
      number: '#fde68a',
      active: '#8b5cf6'
    },
    {
      text: '#ecfeff',
      cursor: '#22d3ee',
      function: '#5eead4',
      keyword: '#fca5a5',
      string: '#bef264',
      number: '#93c5fd',
      active: '#06b6d4'
    },
    {
      text: '#fefce8',
      cursor: '#eab308',
      function: '#facc15',
      keyword: '#fb7185',
      string: '#5eead4',
      number: '#c084fc',
      active: '#ca8a04'
    },
    {
      text: '#fdf2f8',
      cursor: '#f472b6',
      function: '#f9a8d4',
      keyword: '#93c5fd',
      string: '#fde047',
      number: '#86efac',
      active: '#db2777'
    },
    {
      text: '#eef2ff',
      cursor: '#818cf8',
      function: '#a5b4fc',
      keyword: '#2dd4bf',
      string: '#fda4af',
      number: '#fcd34d',
      active: '#4f46e5'
    }
  ];
  const palette = palettes[hashString(String(elementId || 'strudel')) % palettes.length];
  return {
    ...palette,
    activeLine: rgbaFromHex(palette.active, 0.24),
    tooltipBorder: rgbaFromHex(palette.cursor, 0.8),
    tooltipSelected: rgbaFromHex(palette.active, 0.62),
    remoteCursor: palette.string,
    remoteSelection: rgbaFromHex(palette.string, 0.38)
  };
}

function hashString(source) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rgbaFromHex(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(255, 255, 255, ${alpha})`;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
