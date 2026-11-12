import workletUrl from './chroma.worklet.ts?worker&url';
import type { ChromaWorkletMessage } from './chroma.worklet';

export interface HeardFrame {
  /** Há quantos segundos este som aconteceu (idade), já contando metade da janela de análise. */
  ageSec: number;
  chroma: Float32Array;
  levelDb: number;
}

/**
 * Ouve o cavaquinho durante o jogo: microfone → AudioWorklet (cromagrama).
 * Sem cancelamento de eco/ruído/ganho automático: esses filtros distorcem o instrumento.
 */
export class ChordListener {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  onFrame: ((f: HeardFrame) => void) | null = null;

  get running(): boolean {
    return this.ctx !== null;
  }

  /** Precisa ser chamado dentro de um toque do usuário (permissão do microfone). */
  async start(): Promise<void> {
    if (this.ctx) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      throw new Error('Este navegador não permite ouvir o microfone em tempo real.');
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      await ctx.audioWorklet.addModule(workletUrl);
    } catch (e) {
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      void ctx.close();
      const name = (e as DOMException).name;
      throw new Error(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microfone bloqueado. Libere o microfone no cadeado ao lado do endereço.'
          : name === 'NotFoundError'
            ? 'Nenhum microfone encontrado.'
            : 'Não consegui abrir o microfone.',
      );
    }
    const source = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, 'chroma-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const half = 4096 / ctx.sampleRate / 2;
    node.port.onmessage = (ev: MessageEvent<ChromaWorkletMessage>) => {
      const m = ev.data;
      this.onFrame?.({ ageSec: Math.max(0, ctx.currentTime - m.t) + half, chroma: m.chroma, levelDb: m.levelDb });
    };
    // ganho 0 até o destino: mantém o grafo ativo sem devolver o som do microfone (sem microfonia)
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute).connect(ctx.destination);
    this.ctx = ctx;
    this.node = node;
    await ctx.resume();
  }

  async stop(): Promise<void> {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const ctx = this.ctx;
    this.ctx = null;
    this.node = null;
    this.stream = null;
    this.onFrame = null;
    if (ctx && ctx.state !== 'closed') await ctx.close();
  }
}
