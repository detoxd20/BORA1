import workletUrl from './pitch.worklet.ts?worker&url';
import type { PitchWorkletMessage, PitchWorkletOptions } from './pitch.worklet';
import type { PitchFrame } from '../tuner/tunerState';

export type EngineErrorKind = 'denied' | 'no-device' | 'unsupported' | 'unknown';

export class EngineError extends Error {
  constructor(
    public kind: EngineErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface EngineInfo {
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  state: AudioContextState;
  deviceLabel: string;
  /** Quadros de pitch por segundo (saúde do worklet). */
  framesPerSec: number;
}

type FrameListener = (f: PitchFrame) => void;

/**
 * Microfone → AudioWorklet (pitch). Sem eco/ruído/ganho automáticos:
 * esses filtros do navegador distorcem a nota de instrumentos.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private listeners = new Set<FrameListener>();
  private frameCount = 0;
  private fpsWindowStart = 0;
  private fps = 0;
  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.ctx?.resume();
  };

  get running(): boolean {
    return this.ctx !== null;
  }

  subscribe(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  info(): EngineInfo | null {
    if (!this.ctx) return null;
    const track = this.stream?.getAudioTracks()[0];
    return {
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: (this.ctx.baseLatency ?? 0) * 1000,
      outputLatencyMs: (this.ctx.outputLatency ?? 0) * 1000,
      state: this.ctx.state,
      deviceLabel: track?.label ?? '',
      framesPerSec: this.fps,
    };
  }

  async start(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new EngineError(
        'unsupported',
        'Este navegador não suporta captura de áudio em tempo real. Use o Chrome atualizado.',
      );
    }

    // O contexto é criado dentro do gesto do usuário (toque no botão).
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
    } catch (e) {
      void ctx.close();
      const name = (e as DOMException).name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new EngineError(
          'denied',
          'Permissão do microfone negada. Toque no cadeado ao lado do endereço, libere o microfone e recarregue.',
        );
      }
      if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new EngineError('no-device', 'Nenhum microfone encontrado neste aparelho.');
      }
      throw new EngineError('unknown', `Não foi possível abrir o microfone (${name}).`);
    }

    try {
      await ctx.audioWorklet.addModule(workletUrl);
    } catch {
      this.stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      throw new EngineError('unknown', 'Falha ao carregar o processador de áudio.');
    }

    const source = ctx.createMediaStreamSource(this.stream);
    const options: PitchWorkletOptions = {
      windowSize: 2048,
      hop: 512,
      minFreq: 200,
      maxFreq: 1000,
      skipBelowDb: -65,
    };
    const node = new AudioWorkletNode(ctx, 'pitch-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: options,
    });
    node.port.onmessage = (ev: MessageEvent<PitchWorkletMessage>) => {
      const m = ev.data;
      this.tickFps();
      const frame: PitchFrame = { t: m.t, freq: m.freq, clarity: m.clarity, levelDb: m.levelDb };
      this.listeners.forEach((l) => l(frame));
    };

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.6;

    // Ganho 0 até o destino: mantém o grafo "puxado" pelo navegador sem sair som (sem microfonia).
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    source.connect(analyser);
    node.connect(mute).connect(ctx.destination);

    this.ctx = ctx;
    this.node = node;
    this.analyser = analyser;
    this.fpsWindowStart = performance.now();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.stream.getAudioTracks()[0]?.addEventListener('ended', () => void this.stop());
    await ctx.resume();
  }

  async stop(): Promise<void> {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const ctx = this.ctx;
    this.ctx = null;
    this.node = null;
    this.analyser = null;
    this.stream = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }

  private tickFps(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.fps = (this.frameCount * 1000) / (now - this.fpsWindowStart);
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
  }
}
