import Hydra from 'hydra-synth';
import {
  initAudioOnFirstClick,
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
      await initAudioOnFirstClick();
      await evalScope(
        controls,
        miniAllStrings,
        import('@strudel/core'),
        import('@strudel/mini'),
        import('@strudel/webaudio'),
      );
      await registerSynthSounds();
      samples('github:tidalcycles/dirt-samples');
      this.strudelRepl = repl({
        defaultOutput: webaudioOutput,
        getTime: () => (this.strudelRepl?.scheduler.getAudioContext().currentTime) ?? 0,
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

  stopAudio(): void {
    this.strudelRepl?.scheduler?.stop();
  }
}
