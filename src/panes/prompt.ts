import { SignalBus } from '../bus';
import { Stage } from '../stage';
import { makePaneDom, PaneState, setStatus } from './base';

// v0 stub agent: parses simple natural-language intents and routes them.
// Real agent endpoint goes here in v2.
type Intent =
  | { kind: 'set'; signal: string; value: number }
  | { kind: 'pulse'; signal: string }
  | { kind: 'visual'; code: string }
  | { kind: 'audio'; code: string }
  | { kind: 'unknown'; raw: string };

function parseIntent(text: string): Intent {
  const t = text.trim().toLowerCase();

  const set = t.match(/set\s+(\w+)\s+(?:to\s+)?([\d.]+)/);
  if (set) return { kind: 'set', signal: set[1], value: Number(set[2]) };

  const pulse = t.match(/(?:pulse|trigger|hit)\s+(\w+)/);
  if (pulse) return { kind: 'pulse', signal: pulse[1] };

  // canned visual recipes
  if (/rainbow|colou?rful/.test(t)) {
    return {
      kind: 'visual',
      code: `osc(20, 0.1, 1.3).kaleid(${Math.floor(Math.random() * 6) + 3}).colorama(0.5).out()`,
    };
  }
  if (/calm|slow|chill/.test(t)) {
    return {
      kind: 'visual',
      code: `osc(4, 0.02, 0.3).rotate(0.1).out()`,
    };
  }
  if (/glitch|chaos|wild/.test(t)) {
    return {
      kind: 'visual',
      code: `noise(8, 0.3).modulate(osc(10,0.1,0.5)).pixelate(40,40).out()`,
    };
  }
  if (/dark|void|black/.test(t)) {
    return { kind: 'visual', code: `solid(0,0,0).out()` };
  }
  if (/(pulse|react|sync).*kick|kick.*(pulse|react)/.test(t)) {
    return {
      kind: 'visual',
      code: `osc(10, 0.1, 1).scale(() => 1 + b('kick')*0.5).out()`,
    };
  }

  // canned audio recipes
  if (/(beat|drum|kick)/.test(t)) {
    return { kind: 'audio', code: `s("bd*4, [~ sd]*2, hh*8").gain(0.7)` };
  }
  if (/bass|low/.test(t)) {
    return {
      kind: 'audio',
      code: `note("c2 c2 g1 a1").s("sawtooth").lpf(800).gain(0.6)`,
    };
  }
  if (/melody|tune|happy/.test(t)) {
    return {
      kind: 'audio',
      code: `note("c4 e4 g4 b4 [a4 g4]").s("triangle").gain(0.5)`,
    };
  }
  if (/(silent|stop|quiet)/.test(t)) {
    return { kind: 'audio', code: `silence` };
  }

  return { kind: 'unknown', raw: text };
}

export function mountPromptPane(
  state: PaneState,
  parent: HTMLElement,
  stage: Stage,
  bus: SignalBus,
): () => void {
  const { root, body, footer, onClose } = makePaneDom(state, 'PROMPT · NATURAL LANG');

  const help = document.createElement('div');
  help.className = 'prompt-suggest';
  help.innerHTML = `
    try:<br/>
    • <i>make a beat</i><br/>
    • <i>rainbow visuals</i><br/>
    • <i>pulse with kick</i><br/>
    • <i>set knob to 0.8</i><br/>
    • <i>trigger boom</i><br/>
    • <i>calm</i> / <i>glitch</i> / <i>dark</i>
  `;

  const input = document.createElement('textarea');
  input.className = 'prompt-input';
  input.placeholder = 'describe what you want...';
  input.rows = 3;

  const sendBtn = document.createElement('button');
  sendBtn.className = 'nes-btn is-primary';
  sendBtn.textContent = 'SEND (⌘↵)';
  sendBtn.style.fontSize = '9px';

  const log = document.createElement('div');
  log.className = 'prompt-log';
  log.textContent = '> agent ready (offline stub)';

  body.appendChild(help);
  body.appendChild(input);
  body.appendChild(sendBtn);
  body.appendChild(log);

  function append(line: string) {
    log.textContent += '\n' + line;
    log.scrollTop = log.scrollHeight;
  }

  async function send() {
    const text = input.value.trim();
    if (!text) return;
    append(`> ${text}`);
    const intent = parseIntent(text);
    switch (intent.kind) {
      case 'set':
        bus.set(intent.signal, intent.value);
        append(`  · bus.set(${intent.signal}, ${intent.value})`);
        setStatus(footer, 'OK', true);
        break;
      case 'pulse':
        bus.pulse(intent.signal);
        append(`  · bus.pulse(${intent.signal})`);
        setStatus(footer, 'OK', true);
        break;
      case 'visual': {
        append(`  · eval visual:\n  ${intent.code}`);
        const r = stage.evalVisual(intent.code);
        if (r.ok) setStatus(footer, 'visual updated', true);
        else setStatus(footer, '✗ ' + r.error);
        break;
      }
      case 'audio': {
        append(`  · eval audio:\n  ${intent.code}`);
        const r = await stage.evalAudio(intent.code);
        if (r.ok) setStatus(footer, 'audio updated', true);
        else setStatus(footer, '✗ ' + r.error);
        break;
      }
      case 'unknown':
        append(`  · (offline agent doesn't grok "${intent.raw}" — try one of the hints)`);
        setStatus(footer, 'unrecognized');
        break;
    }
    input.value = '';
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  setStatus(footer, '⌘+Enter to send');
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
