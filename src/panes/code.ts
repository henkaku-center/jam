import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Stage } from '../stage';
import { makePaneDom, PaneState, setStatus } from './base';

export function mountCodePane(
  state: PaneState,
  parent: HTMLElement,
  stage: Stage,
  awareness: Awareness,
): () => void {
  const target = state.data.get('target') ?? 'visual';
  if (!state.data.has('target')) state.data.set('target', target);

  const title = target === 'audio' ? 'CODE · AUDIO' : 'CODE · VISUAL';
  const { root, body, footer, onClose } = makePaneDom(state, title);

  // target toggle in header
  const toggle = document.createElement('button');
  toggle.className = 'pane-btn';
  toggle.textContent = target.toUpperCase();
  toggle.title = 'switch between audio / visual';
  toggle.addEventListener('click', () => {
    const cur = state.data.get('target') ?? 'visual';
    state.data.set('target', cur === 'audio' ? 'visual' : 'audio');
  });
  root.querySelector('.pane-actions')!.prepend(toggle);

  state.data.observe(() => {
    const t = state.data.get('target') ?? 'visual';
    toggle.textContent = t.toUpperCase();
    const head = root.querySelector('.pane-title') as HTMLElement;
    head.textContent = t === 'audio' ? 'CODE · AUDIO' : 'CODE · VISUAL';
  });

  const ytext = state.data.get('code') as Y.Text;

  const view = new EditorView({
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              run();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        javascript(),
        yCollab(ytext, awareness),
        EditorView.theme({
          '&': { backgroundColor: '#fff', color: '#000' },
          '.cm-gutters': { backgroundColor: '#ddd', color: '#555', border: 'none' },
          '.cm-activeLine': { backgroundColor: '#ffe' },
        }),
      ],
    }),
    parent: body,
  });

  async function run() {
    const code = view.state.doc.toString();
    const t = state.data.get('target') ?? 'visual';
    const result =
      t === 'audio' ? await stage.evalAudio(code) : stage.evalVisual(code);
    if (result.ok) setStatus(footer, 'OK · ' + new Date().toLocaleTimeString(), true);
    else setStatus(footer, '✗ ' + result.error);
  }

  const runBtn = document.createElement('button');
  runBtn.className = 'pane-btn';
  runBtn.textContent = '▶ RUN (⌘↵)';
  runBtn.addEventListener('click', run);
  root.querySelector('.pane-actions')!.prepend(runBtn);

  setStatus(footer, '⌘+Enter to run');
  parent.appendChild(root);

  let closed = false;
  onClose(() => {
    if (closed) return;
    closed = true;
    view.destroy();
    root.remove();
    state.data.set('_deleted', true);
  });

  return () => onClose(() => {});
}
