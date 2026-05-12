import * as Y from 'yjs';

type Listener = (value: number, name: string) => void;

export class SignalBus {
  private y: Y.Map<number>;
  private listeners = new Set<Listener>();
  private nameListeners = new Map<string, Set<Listener>>();

  constructor(doc: Y.Doc) {
    this.y = doc.getMap<number>('bus');
    this.y.observe((event) => {
      event.changes.keys.forEach((_change, key) => {
        const value = this.y.get(key);
        if (typeof value !== 'number') return;
        this.listeners.forEach((fn) => fn(value, key));
        this.nameListeners.get(key)?.forEach((fn) => fn(value, key));
      });
    });
  }

  set(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    this.y.set(name, value);
  }

  get(name: string): number {
    const v = this.y.get(name);
    return typeof v === 'number' ? v : 0;
  }

  pulse(name: string): void {
    this.set(name, 1);
    setTimeout(() => this.set(name, 0), 80);
  }

  names(): string[] {
    return Array.from(this.y.keys());
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    this.y.forEach((v, k) => {
      if (typeof v === 'number') out[k] = v;
    });
    return out;
  }

  onAny(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  on(name: string, fn: Listener): () => void {
    let set = this.nameListeners.get(name);
    if (!set) {
      set = new Set();
      this.nameListeners.set(name, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }
}
