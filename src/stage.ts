import Hydra from 'hydra-synth';
import {
  getAudioContext,
  initAudio,
  registerSynthSounds,
  samples,
  webaudioOutput,
} from '@strudel/webaudio';
import { evalScope, repl, controls } from '@strudel/core';
import { transpiler } from '@strudel/transpiler';
import { miniAllStrings } from '@strudel/mini';
import { SignalBus } from './bus';

export type EvalResult = { ok: true } | { ok: false; error: string };

export class Stage {
  private hydra: any;
  private strudelRepl: any;
  private lastVisualSource = '';
  private lastAudioSource = '';
  private audioReady = false;
  private bus: SignalBus;

  constructor(canvas: HTMLCanvasElement, bus: SignalBus) {
    this.bus = bus;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });

    this.hydra = new Hydra({
      canvas,
      detectAudio: false,
      enableStreamCapture: false,
      makeGlobal: true,
    });

    // expose bus on the hydra eval context
    (window as any).bus = bus;
    (window as any).b = (name: string) => bus.get(name);
  }

  async initAudio(): Promise<void> {
    if (this.audioReady) return;
    try {
      await initAudio();
      const ctx = getAudioContext();
      await ctx.resume();
      // Hydra sets globals (osc, noise, shape, src, …) via makeGlobal.
      // Its tick() also reads speed/bpm/fps/update from window each frame.
      // Strudel's evalScope overwrites many of these. Save and restore.
      const hydraGlobals = ['osc', 'noise', 'shape', 'src', 'solid', 'gradient', 'voronoi',
        'render', 'o0', 'o1', 'o2', 'o3', 's0', 's1', 's2', 's3',
        'speed', 'bpm', 'fps', 'update', 'afterUpdate',
        'time', 'mouse', 'width', 'height', 'hush', 'setResolution', 'tick',
      ].reduce((acc, k) => {
        if (k in globalThis) acc[k] = (globalThis as any)[k];
        return acc;
      }, {} as Record<string, any>);

      await evalScope(
        controls,
        miniAllStrings,
        import('@strudel/core'),
        import('@strudel/mini'),
        import('@strudel/webaudio'),
      );

      Object.assign(globalThis, hydraGlobals);
      await registerSynthSounds();
      samples('github:tidalcycles/dirt-samples');
      this.strudelRepl = repl({
        defaultOutput: webaudioOutput,
        getTime: () => getAudioContext().currentTime,
        transpiler,
      });
      this.audioReady = true;
    } catch (e) {
      console.error('Audio init failed', e);
    }
  }

  evalVisual(source: string): EvalResult {
    try {
      // Hydra exposes osc, src, o0, etc. as globals via makeGlobal:true
      // Wrap so syntax errors don't tank anything; previous shader keeps rendering.
      // eslint-disable-next-line no-new-func
      const fn = new Function(source);
      fn();
      this.lastVisualSource = source;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  async evalAudio(source: string): Promise<EvalResult> {
    if (!this.audioReady || !this.strudelRepl) {
      return { ok: false, error: 'audio not started — click START AUDIO first' };
    }
    try {
      await this.strudelRepl.evaluate(source);
      this.lastAudioSource = source;
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }

  toggleAudio(): void {
    this.strudelRepl?.scheduler?.toggle();
  }

  stopAudio(): void {
    this.strudelRepl?.scheduler?.stop();
  }
}
