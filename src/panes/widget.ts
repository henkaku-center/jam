import { SignalBus } from '../bus';
import { makePaneDom, PaneState, setStatus } from './base';

type WidgetKind = 'slider' | 'button' | 'xy';

export function mountWidgetPane(
  state: PaneState,
  parent: HTMLElement,
  bus: SignalBus,
): () => void {
  if (!state.data.has('shape')) state.data.set('shape', 'slider');
  if (!state.data.has('signal')) state.data.set('signal', 'knob');
  if (!state.data.has('min')) state.data.set('min', 0);
  if (!state.data.has('max')) state.data.set('max', 1);
  if (!state.data.has('value')) state.data.set('value', 0.5);

  const kind = state.data.get('shape') as WidgetKind;
  const { root, body, footer, onClose } = makePaneDom(state, `WIDGET · ${kind.toUpperCase()}`);

  const controls = document.createElement('div');
  controls.className = 'widget-controls';

  const bind = document.createElement('div');
  bind.className = 'widget-bind';
  const bindLabel = document.createElement('label');
  bindLabel.textContent = 'SIGNAL:';
  const bindInput = document.createElement('input');
  bindInput.type = 'text';
  bindInput.value = state.data.get('signal');
  bindInput.addEventListener('change', () => {
    state.data.set('signal', bindInput.value || 'knob');
  });
  const kindSelect = document.createElement('select');
  kindSelect.className = 'widget-kind-select';
  ['slider', 'button', 'xy'].forEach((k) => {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k.toUpperCase();
    if (k === kind) opt.selected = true;
    kindSelect.appendChild(opt);
  });
  kindSelect.addEventListener('change', () => {
    state.data.set('shape', kindSelect.value);
  });
  bind.appendChild(bindLabel);
  bind.appendChild(bindInput);
  bind.appendChild(kindSelect);

  const render = document.createElement('div');
  render.className = 'widget-render';

  controls.appendChild(bind);
  controls.appendChild(render);
  body.appendChild(controls);

  function renderWidget() {
    render.innerHTML = '';
    const k = state.data.get('shape') as WidgetKind;
    const signal = state.data.get('signal') as string;
    const min = Number(state.data.get('min') ?? 0);
    const max = Number(state.data.get('max') ?? 1);
    const initial = Number(state.data.get('value') ?? 0.5);

    if (k === 'slider') {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'widget-slider';
      slider.min = String(min);
      slider.max = String(max);
      slider.step = String((max - min) / 1000);
      slider.value = String(initial);
      const valDisplay = document.createElement('div');
      valDisplay.className = 'widget-value';
      valDisplay.textContent = `${signal} = ${initial.toFixed(3)}`;
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        state.data.set('value', v);
        bus.set(signal, v);
        valDisplay.textContent = `${signal} = ${v.toFixed(3)}`;
      });
      render.appendChild(valDisplay);
      render.appendChild(slider);
      bus.set(signal, initial);
    } else if (k === 'button') {
      const btn = document.createElement('button');
      btn.className = 'widget-button';
      btn.textContent = `▶ ${signal.toUpperCase()}`;
      btn.addEventListener('click', () => bus.pulse(signal));
      render.appendChild(btn);
    } else if (k === 'xy') {
      const pad = document.createElement('div');
      pad.style.cssText = `
        position: relative;
        width: 100%;
        height: 120px;
        background: #222;
        border: 2px solid #fff;
        cursor: crosshair;
      `;
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: absolute;
        width: 14px;
        height: 14px;
        background: var(--nes-pink);
        border: 2px solid #fff;
        transform: translate(-50%, -50%);
        pointer-events: none;
      `;
      pad.appendChild(dot);
      const valDisplay = document.createElement('div');
      valDisplay.className = 'widget-value';
      valDisplay.textContent = `${signal}_x, ${signal}_y`;
      render.appendChild(valDisplay);
      render.appendChild(pad);

      let active = false;
      const update = (ev: MouseEvent) => {
        const rect = pad.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, 1 - (ev.clientY - rect.top) / rect.height));
        dot.style.left = `${x * 100}%`;
        dot.style.top = `${(1 - y) * 100}%`;
        bus.set(`${signal}_x`, x);
        bus.set(`${signal}_y`, y);
        valDisplay.textContent = `${signal}_x=${x.toFixed(2)} ${signal}_y=${y.toFixed(2)}`;
      };
      pad.addEventListener('mousedown', (e) => {
        active = true;
        update(e);
      });
      pad.addEventListener('mousemove', (e) => {
        if (active) update(e);
      });
      window.addEventListener('mouseup', () => {
        active = false;
      });
    }
  }

  state.data.observe(() => {
    const k = state.data.get('shape') as WidgetKind;
    (root.querySelector('.pane-title') as HTMLElement).textContent = `WIDGET · ${k.toUpperCase()}`;
    kindSelect.value = k;
    if (bindInput.value !== state.data.get('signal')) {
      bindInput.value = state.data.get('signal');
    }
    renderWidget();
  });

  renderWidget();
  setStatus(footer, 'drag, tweak, jam', true);
  parent.appendChild(root);

  let closed = false;
  onClose(() => {
    if (closed) return;
    closed = true;
    root.remove();
    state.data.set('_deleted', true);
  });

  return () => onClose(() => {});
}
