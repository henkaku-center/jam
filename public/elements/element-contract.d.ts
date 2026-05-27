export interface ElementContext {
  audioCtx: AudioContext;
  audioOut: AudioNode;
  domRoot: ShadowRoot;
  clock: {
    bpm: number;
    startTime: number;
    onTick(callback: (info: { step: number; time: number; duration: number; bpm: number }) => void): () => void;
  };
  bus: {
    pub(key: string, value: unknown): void;
    sub(key: string, callback: (value: unknown) => void): () => void;
    pubGlobal(key: string, value: unknown): void;
    subGlobal(key: string, callback: (value: unknown) => void): () => void;
  };
  sendControllerData(data: unknown): void;
}

export interface ElementRuntime {
  update?(tick: number): void;
  getState?(): unknown;
  destroy?(): void;
}

export type ElementSetup = (
  ctx: ElementContext,
  prevState: unknown
) => ElementRuntime | Promise<ElementRuntime>;
