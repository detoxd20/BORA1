/** FFT radix-2 in-place (sem dependências). `re`/`im` têm tamanho potência de 2. */
export class FFT {
  private cos: Float64Array;
  private sin: Float64Array;
  private rev: Uint32Array;
  constructor(public readonly size: number) {
    if (size & (size - 1)) throw new Error('FFT: tamanho deve ser potência de 2');
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i] as number;
      if (j > i) {
        const tr = re[i] as number, ti = im[i] as number;
        re[i] = re[j] as number; im[i] = im[j] as number;
        re[j] = tr; im[j] = ti;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const c = this.cos[k] as number, s = -(this.sin[k] as number);
          const a = i + j, b = a + half;
          const xr = (re[b] as number) * c - (im[b] as number) * s;
          const xi = (re[b] as number) * s + (im[b] as number) * c;
          re[b] = (re[a] as number) - xr; im[b] = (im[a] as number) - xi;
          re[a] = (re[a] as number) + xr; im[a] = (im[a] as number) + xi;
        }
      }
    }
  }
}

export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
