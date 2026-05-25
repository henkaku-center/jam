import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:3000/yjs', 'jam-workspace', ydoc, { WebSocketPolyfill: WebSocket });
const elementsMap = ydoc.getMap('elements');

provider.on('sync', (isSynced) => {
  if (!isSynced) return;
  const id = 'elem_voicerec01';
  const existing = elementsMap.get(id);
  if (!existing) {
    console.error('[err] element not found, run add-recorder first');
    process.exit(1);
  }
  const bumped = { ...existing, prompt: `${(existing.prompt || '').replace(/ \(r\d+\)$/, '')} (r${Date.now() % 10000})` };
  ydoc.transact(() => { elementsMap.set(id, bumped); });
  console.log('[ok] prompt bumped to trigger hot-reload:', bumped.prompt);
  setTimeout(() => process.exit(0), 500);
});

setTimeout(() => { console.error('[timeout]'); process.exit(1); }, 5000);
