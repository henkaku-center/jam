import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Awareness } from 'y-protocols/awareness';

const COLORS = ['#e76e55', '#92cc41', '#209cee', '#f7d51d', '#b8b8b8', '#dc7e00'];
const ADJECTIVES = ['fast', 'loud', 'soft', 'wild', 'cool', 'neon', 'pixel', 'glitch'];
const NOUNS = ['frog', 'cat', 'bot', 'fox', 'owl', 'wave', 'beat', 'star'];

function randomName(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}-${n}`;
}

export type Sync = {
  doc: Y.Doc;
  provider: WebrtcProvider;
  awareness: Awareness;
  room: string;
};

export function connect(room: string): Sync {
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(`jam-${room}`, doc, {
    signaling: [],
  });
  const awareness = provider.awareness;
  const stored = localStorage.getItem('jam.user');
  let user: { name: string; color: string };
  if (stored) {
    user = JSON.parse(stored);
  } else {
    user = {
      name: randomName(),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
    localStorage.setItem('jam.user', JSON.stringify(user));
  }
  awareness.setLocalStateField('user', user);
  return { doc, provider, awareness, room };
}

export function roomFromHash(): string {
  const h = window.location.hash.replace(/^#/, '').trim();
  if (h) return h;
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const room = `${adj}-${noun}-${Math.floor(Math.random() * 100)}`;
  window.location.hash = room;
  return room;
}
