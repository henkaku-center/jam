import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';

const ydoc = new Y.Doc();
const provider = new WebsocketProvider('ws://localhost:3000/yjs', 'jam-workspace', ydoc, { WebSocketPolyfill: WebSocket });
const elementsMap = ydoc.getMap('elements');

provider.on('status', (e) => console.log('[status]', e.status));

provider.on('sync', (isSynced) => {
  if (!isSynced) return;
  console.log('[sync] doc synced, current element count:', elementsMap.size);
  const id = 'elem_voicerec01';
  if (elementsMap.has(id)) {
    console.log('[skip] already present');
    setTimeout(() => process.exit(0), 200);
    return;
  }
  const layout = {
    id,
    x: 400, y: 80,
    width: 280, height: 220,
    filePath: '/elements/elem_voicerec01_rec.js',
    type: 'rec',
    prompt: 'voice recorder, ska upbeats'
  };
  ydoc.transact(() => { elementsMap.set(id, layout); });
  console.log('[ok] inserted', id);
  setTimeout(() => process.exit(0), 500);
});

setTimeout(() => { console.error('[timeout] no sync within 5s'); process.exit(1); }, 5000);
