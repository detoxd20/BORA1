/** Gera um tom "de corda": fundamental + harmônicos com decaimento de amplitude. */
export function synth(
  freq: number,
  sampleRate: number,
  length: number,
  opts: { harmonics?: number[]; noise?: number; amp?: number; seed?: number } = {},
): Float32Array {
  const harmonics = opts.harmonics ?? [1, 0.6, 0.4, 0.25, 0.15];
  const amp = opts.amp ?? 0.3;
  const noise = opts.noise ?? 0;
  let seed = opts.seed ?? 1234;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff - 0.5;
  };
  const out = new Float32Array(length);
  const norm = harmonics.reduce((a, b) => a + Math.abs(b), 0);
  for (let i = 0; i < length; i++) {
    let v = 0;
    harmonics.forEach((h, k) => {
      v += h * Math.sin((2 * Math.PI * freq * (k + 1) * i) / sampleRate + k * 0.7);
    });
    out[i] = (amp * v) / norm + noise * rnd() * 2;
  }
  return out;
}

export const centsToRatio = (c: number) => Math.pow(2, c / 1200);
