import * as Y from 'yjs';

export type PaneKind = 'code' | 'prompt' | 'widget' | 'sampler';

export type PaneState = {
  id: string;
  kind: PaneKind;
  x: number;
  y: number;
  w: number;
  h: number;
  data: Y.Map<any>;
};

export function makePaneDom(state: PaneState, title: string): {
  root: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  onClose: (fn: () => void) => void;
} {
  const root = document.createElement('div');
  root.className = 'pane';
  root.dataset.paneId = state.id;
  root.style.left = `${state.x}px`;
  root.style.top = `${state.y}px`;
  root.style.width = `${state.w}px`;
  root.style.height = `${state.h}px`;

  const header = document.createElement('div');
  header.className = `pane-header ${state.kind}`;
  const titleEl = document.createElement('div');
  titleEl.className = 'pane-title';
  titleEl.textContent = title;
  const actions = document.createElement('div');
  actions.className = 'pane-actions';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'pane-btn';
  closeBtn.textContent = 'X';
  actions.appendChild(closeBtn);
  header.appendChild(titleEl);
  header.appendChild(actions);

  const body = document.createElement('div');
  body.className = 'pane-body';

  const footer = document.createElement('div');
  footer.className = 'pane-footer';

  root.appendChild(header);
  root.appendChild(body);
  root.appendChild(footer);

  // drag
  let dragging = false;
  let dx = 0;
  let dy = 0;
  header.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.pane-btn')) return;
    dragging = true;
    const rect = root.getBoundingClientRect();
    dx = e.clientX - rect.left;
    dy = e.clientY - rect.top;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, e.clientX - dx);
    const y = Math.max(0, e.clientY - dy);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    state.data.set('x', x);
    state.data.set('y', y);
  });
  window.addEventListener('mouseup', () => {
    dragging = false;
  });

  let closeFn: (() => void) | null = null;
  closeBtn.addEventListener('click', () => closeFn?.());

  return {
    root,
    body,
    footer,
    onClose: (fn) => {
      closeFn = fn;
    },
  };
}

export function setStatus(footer: HTMLElement, msg: string, ok = false): void {
  footer.textContent = msg;
  footer.classList.toggle('ok', ok);
}
