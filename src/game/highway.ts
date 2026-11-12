/**
 * Pista do "Cavaco Hero": desenho em canvas com perspectiva (o braço se afastando).
 * Funções de projeção são puras (testadas); `drawHighway` só desenha.
 */

/** Segundos de música visíveis entre o horizonte e a linha de acerto. */
export const LOOKAHEAD = 4.2;
/** Quanto a distância "aperta" o que está longe (perspectiva). */
const K = 1.7;
/** Quanto um acorde ainda aparece depois de passar da linha (s). */
export const PAST = 0.28;

/** Cores das 4 cordas (4ª → 1ª), no espírito do Guitar Hero. */
export const LANE_COLORS = ['#2ee66b', '#ff4d5a', '#ffd23f', '#3fa9ff'];

export interface Geometry {
  w: number;
  h: number;
  /** y do horizonte (onde as notas nascem). */
  horizonY: number;
  /** y da linha de acerto. */
  strikeY: number;
  nearW: number;
  farW: number;
  /** raio da gema na linha de acerto. */
  gemR: number;
}

export function makeGeometry(w: number, h: number): Geometry {
  const nearW = Math.min(w * 0.94, 460);
  return { w, h, horizonY: h * 0.2, strikeY: h * 0.83, nearW, farW: nearW * 0.3, gemR: nearW * 0.092 };
}

/**
 * Escala de profundidade: 1 na linha de acerto (dt = 0), 0 no horizonte (dt = LOOKAHEAD), > 1 depois de passar.
 * Não é linear: o que está longe fica comprimido, como numa estrada.
 */
export function depthScale(dt: number): number {
  const z = Math.max(-0.9 / K, dt / LOOKAHEAD);
  return (1 - z) / (1 + K * z);
}

export const projectY = (g: Geometry, s: number) => g.horizonY + (g.strikeY - g.horizonY) * s;
export const widthAt = (g: Geometry, s: number) => g.farW + (g.nearW - g.farW) * s;
/** x do centro da corda `lane` (0 = 4ª … 3 = 1ª) na profundidade `s`. */
export const laneX = (g: Geometry, lane: number, s: number) => g.w / 2 + ((lane - 1.5) / 4) * widthAt(g, s);
/** Tamanho relativo de um objeto na profundidade `s` (nunca some de vez no horizonte). */
export const sizeAt = (s: number) => 0.3 + 0.7 * Math.min(s, 1.25);

export interface GameChord {
  start: number;
  end: number;
  name: string;
  root: number;
  /** Casa de cada corda (4ª → 1ª); null se não há formação. */
  frets: number[] | null;
}

export interface Flash {
  lane: number;
  /** instante (relógio de parede, s) em que acendeu. */
  at: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export interface Scene {
  t: number;
  /** relógio de parede em segundos (para animações que não dependem da música). */
  now: number;
  chords: GameChord[];
  /** tempos das palhetadas detectadas. */
  strums: number[];
  flashes: Flash[];
  particles: Particle[];
  /** Texto do último julgamento ("PERFEITO!", "ERROU"…), sobe e some. */
  popup?: { text: string; color: string; at: number };
  /** Instante do último erro: a linha de acerto pisca em vermelho. */
  missAt?: number;
}

const hue = (root: number) => root * 30;

/* ---------- desempenho: nada de brilho/degradê calculado a cada quadro ----------
 * Gemas (com o número da casa) e nomes de acorde são desenhados UMA vez num canvas escondido e depois só copiados
 * (drawImage), que é a operação mais barata do canvas. Degradês da pista são guardados por geometria. */
type Sprite = HTMLCanvasElement;
const sprites = new Map<string, Sprite>();

function sprite(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): Sprite {
  let s = sprites.get(key);
  if (!s) {
    s = document.createElement('canvas');
    s.width = w;
    s.height = h;
    const c = s.getContext('2d');
    if (c) paint(c);
    sprites.set(key, s);
  }
  return s;
}

const GEM = 72; // raio do sprite da gema, em pixels

function gemSprite(lane: number, fret: number): Sprite {
  return sprite(`gem:${lane}:${fret}`, GEM * 2 + 8, Math.round(GEM * 1.32) + 8, (c) => {
    const col = LANE_COLORS[lane] as string;
    const x = GEM + 4, y = GEM * 0.66 + 4, r = GEM;
    c.beginPath();
    c.ellipse(x, y, r, r * 0.66, 0, 0, Math.PI * 2);
    if (fret === 0) {
      c.fillStyle = 'rgba(8,10,14,0.88)';
      c.fill();
      c.strokeStyle = col;
      c.lineWidth = 9;
      c.stroke();
    } else {
      const gr = c.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.25, col);
      gr.addColorStop(1, shade(col));
      c.fillStyle = gr;
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.92)';
      c.lineWidth = 5;
      c.stroke();
    }
    if (fret >= 0) {
      c.font = `900 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineWidth = 8;
      c.strokeStyle = 'rgba(0,0,0,0.78)';
      c.strokeText(String(fret), x, y + r * 0.04);
      c.fillStyle = '#fff';
      c.fillText(String(fret), x, y + r * 0.04);
    }
  });
}

function nameSprite(name: string, root: number): Sprite {
  return sprite(`name:${name}:${root}`, 420, 96, (c) => {
    c.font = '900 italic 68px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = `hsl(${root * 30},90%,60%)`;
    c.shadowBlur = 18;
    c.lineWidth = 10;
    c.strokeStyle = 'rgba(0,0,0,0.9)';
    c.strokeText(name, 210, 50);
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    c.fillText(name, 210, 50);
  });
}

function popupSprite(text: string, color: string): Sprite {
  return sprite(`pop:${text}:${color}`, 520, 110, (c) => {
    c.font = '900 italic 72px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 12;
    c.strokeStyle = 'rgba(0,0,0,0.9)';
    c.strokeText(text, 260, 56);
    c.fillStyle = color;
    c.fillText(text, 260, 56);
  });
}

const gradients = new WeakMap<Geometry, { body: CanvasGradient; string: CanvasGradient; fog: CanvasGradient }>();
function gradientsFor(ctx: CanvasRenderingContext2D, g: Geometry) {
  let gr = gradients.get(g);
  if (!gr) {
    const body = ctx.createLinearGradient(0, g.horizonY, 0, g.h);
    body.addColorStop(0, 'rgba(12,10,16,0.55)');
    body.addColorStop(0.5, 'rgba(22,15,12,0.86)');
    body.addColorStop(1, 'rgba(34,21,13,0.94)');
    const string = ctx.createLinearGradient(0, g.horizonY, 0, g.h);
    string.addColorStop(0, 'rgba(255,255,255,0.05)');
    string.addColorStop(1, 'rgba(235,235,245,0.75)');
    const fog = ctx.createLinearGradient(0, g.horizonY - 4, 0, g.horizonY + (g.strikeY - g.horizonY) * 0.2);
    fog.addColorStop(0, 'rgba(5,7,10,0.95)');
    fog.addColorStop(1, 'rgba(5,7,10,0)');
    gr = { body, string, fog };
    gradients.set(g, gr);
  }
  return gr;
}

export function drawHighway(ctx: CanvasRenderingContext2D, g: Geometry, sc: Scene): void {
  const { w, h } = g;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const grads = gradientsFor(ctx, g);
  const sBottom = (h - g.horizonY) / (g.strikeY - g.horizonY);
  const edge = (s: number, side: -1 | 1) => cx + (side * widthAt(g, s)) / 2;

  // ---- corpo da pista (braço)
  ctx.beginPath();
  ctx.moveTo(edge(0, -1), g.horizonY);
  ctx.lineTo(edge(0, 1), g.horizonY);
  ctx.lineTo(edge(sBottom, 1), h);
  ctx.lineTo(edge(sBottom, -1), h);
  ctx.closePath();
  ctx.fillStyle = grads.body;
  ctx.fill();

  // ---- trastes: linhas que correm na direção do jogador (dão a sensação de velocidade)
  const first = Math.ceil((sc.t - PAST) * 2) / 2;
  for (let tk = first; tk < sc.t + LOOKAHEAD; tk += 0.5) {
    const s = depthScale(tk - sc.t);
    if (s <= 0) continue;
    const y = projectY(g, s);
    const whole = Math.abs(tk - Math.round(tk)) < 1e-6;
    ctx.strokeStyle = `rgba(210,190,160,${(whole ? 0.34 : 0.14) * Math.min(1, s * 2.2)})`;
    ctx.lineWidth = (whole ? 2.2 : 1.2) * sizeAt(s);
    ctx.beginPath();
    ctx.moveTo(edge(s, -1), y);
    ctx.lineTo(edge(s, 1), y);
    ctx.stroke();
  }

  // ---- palhetadas detectadas: marcas claras no centro da pista
  for (const st of sc.strums) {
    const dt = st - sc.t;
    if (dt < 0 || dt > LOOKAHEAD) continue;
    const s = depthScale(dt);
    const y = projectY(g, s);
    const half = widthAt(g, s) * 0.06;
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * Math.min(1, s * 2)})`;
    ctx.lineWidth = 2.4 * sizeAt(s);
    ctx.beginPath();
    ctx.moveTo(cx - half, y);
    ctx.lineTo(cx + half, y);
    ctx.stroke();
  }

  // ---- as 4 cordas
  ctx.strokeStyle = grads.string;
  for (let l = 0; l < 4; l++) {
    ctx.lineWidth = 1 + (3 - l) * 0.45; // a 4ª corda é a mais grossa
    ctx.beginPath();
    ctx.moveTo(laneX(g, l, 0), g.horizonY);
    ctx.lineTo(laneX(g, l, sBottom), h);
    ctx.stroke();
  }

  // ---- bordas de neon (duas passadas: halo largo translúcido + linha viva; sem shadowBlur, que é caro)
  for (const side of [-1, 1] as const) {
    for (const [lw, col] of [[11, 'rgba(245,165,36,0.22)'], [3, 'rgba(255,190,70,0.95)']] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(edge(0, side), g.horizonY);
      ctx.lineTo(edge(sBottom, side), h);
      ctx.stroke();
    }
  }

  // ---- acordes: do mais distante para o mais próximo
  for (let i = sc.chords.length - 1; i >= 0; i--) {
    const c = sc.chords[i] as GameChord;
    if (c.end <= sc.t - PAST || c.start >= sc.t + LOOKAHEAD) continue;
    const dt0 = Math.max(c.start - sc.t, -PAST);
    const dt1 = Math.min(c.end - sc.t, LOOKAHEAD);
    const s0 = depthScale(dt0);
    const s1 = Math.max(0, depthScale(dt1));
    const y0 = projectY(g, s0);
    const y1 = projectY(g, s1);
    const held = c.start <= sc.t; // já chegou na linha: está sendo "segurado"

    // rastros (duração do acorde), um por corda
    ctx.globalAlpha = held ? 0.9 : 0.55;
    for (let l = 0; l < 4; l++) {
      const w0 = g.gemR * 0.2 * sizeAt(s0);
      const w1 = g.gemR * 0.2 * sizeAt(s1);
      ctx.fillStyle = LANE_COLORS[l] as string;
      ctx.beginPath();
      ctx.moveTo(laneX(g, l, s0) - w0, y0);
      ctx.lineTo(laneX(g, l, s0) + w0, y0);
      ctx.lineTo(laneX(g, l, s1) + w1, y1);
      ctx.lineTo(laneX(g, l, s1) - w1, y1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (c.start < sc.t - 0.02) continue; // a cabeça do acorde já passou da linha: só o rastro continua

    // cabeça do acorde: barra na cor do acorde + 4 gemas com a casa de cada corda
    const s = depthScale(c.start - sc.t);
    const y = projectY(g, s);
    const k = sizeAt(s);
    const r = g.gemR * k;
    ctx.globalAlpha = Math.min(1, s * 3 + 0.15);
    const xa = laneX(g, 0, s) - r * 1.25;
    const xb = laneX(g, 3, s) + r * 1.25;
    ctx.fillStyle = `hsla(${hue(c.root)},85%,55%,0.34)`;
    ctx.strokeStyle = `hsl(${hue(c.root)},90%,66%)`;
    ctx.lineWidth = 2 * k;
    roundRect(ctx, xa, y - r * 0.5, xb - xa, r, r * 0.5);
    ctx.fill();
    ctx.stroke();

    for (let l = 0; l < 4; l++) {
      const sp = gemSprite(l, c.frets ? (c.frets[l] as number) : -1);
      const sw = (sp.width * r) / GEM;
      const sh = (sp.height * r) / GEM;
      ctx.drawImage(sp, laneX(g, l, s) - sw / 2, y - sh / 2, sw, sh);
    }

    // nome do acorde, "em pé", acima da linha de gemas
    const ns = nameSprite(c.name, c.root);
    const nh = 46 * k;
    const nw = (ns.width * nh) / ns.height;
    ctx.drawImage(ns, cx - nw / 2, y - r * 0.7 - nh, nw, nh);
    ctx.globalAlpha = 1;
  }

  // ---- neblina no horizonte: as notas surgem de dentro dela
  ctx.fillStyle = grads.fog;
  ctx.fillRect(0, g.horizonY - 4, w, (g.strikeY - g.horizonY) * 0.2 + 4);

  // ---- linha de acerto: 4 alvos
  for (let l = 0; l < 4; l++) {
    const x = laneX(g, l, 1);
    const col = LANE_COLORS[l] as string;
    const fl = sc.flashes.find((f) => f.lane === l && sc.now - f.at < 0.4);
    const p = fl ? 1 - (sc.now - fl.at) / 0.4 : 0;
    const R = g.gemR * 1.18;
    ctx.beginPath();
    ctx.ellipse(x, g.strikeY, R, R * 0.66, 0, 0, Math.PI * 2);
    ctx.fillStyle = p > 0 ? col : 'rgba(8,10,14,0.8)';
    ctx.globalAlpha = p > 0 ? 0.35 + 0.65 * p : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (p > 0) {
      // halo do acerto: traço largo translúcido (barato) em vez de shadowBlur
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.35 * p;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.stroke();
    if (p > 0) {
      // onda de choque
      ctx.beginPath();
      ctx.ellipse(x, g.strikeY, R * (1 + (1 - p) * 1.5), R * 0.66 * (1 + (1 - p) * 1.5), 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${p})`;
      ctx.lineWidth = 3 * p + 0.5;
      ctx.stroke();
    }
  }

  // ---- erro: a linha de acerto pisca em vermelho
  if (sc.missAt !== undefined && sc.now - sc.missAt < 0.35) {
    ctx.globalAlpha = 0.55 * (1 - (sc.now - sc.missAt) / 0.35);
    ctx.fillStyle = '#ff2d3d';
    ctx.fillRect(edge(1, -1), g.strikeY - g.gemR * 0.9, widthAt(g, 1), g.gemR * 1.8);
    ctx.globalAlpha = 1;
  }

  // ---- julgamento: texto que sobe e some acima da linha
  if (sc.popup && sc.now - sc.popup.at < 0.8) {
    const p = (sc.now - sc.popup.at) / 0.8;
    const sp = popupSprite(sc.popup.text, sc.popup.color);
    const ph = g.gemR * 1.5 * (p < 0.15 ? 0.7 + (p / 0.15) * 0.45 : 1.15 - (p - 0.15) * 0.18);
    const pw = (sp.width * ph) / sp.height;
    ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    ctx.drawImage(sp, cx - pw / 2, g.strikeY - g.gemR * 2.4 - ph / 2 - p * g.gemR * 1.4, pw, ph);
    ctx.globalAlpha = 1;
  }

  // ---- faíscas
  for (const pt of sc.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, pt.life * 2.2));
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Versão escura de uma cor #rrggbb (borda da gema). */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = 0.45;
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

/** Faíscas de um acerto na corda `lane`. */
export function spawnSparks(g: Geometry, lane: number, into: Particle[]): void {
  const x = laneX(g, lane, 1);
  for (let i = 0; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const v = 120 + Math.random() * 260;
    into.push({ x, y: g.strikeY, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, color: i % 3 === 0 ? '#ffffff' : (LANE_COLORS[lane] as string) });
  }
}

export function stepParticles(ps: Particle[], dt: number): Particle[] {
  for (const p of ps) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 620 * dt;
    p.life -= dt;
  }
  return ps.filter((p) => p.life > 0);
}

/**
 * Relógio suave: o tempo do <video> anda aos saltos em muitos celulares; aqui o jogo avança pelo relógio
 * de alta precisão e só se realinha com o vídeo aos poucos (ou de uma vez, se a diferença for grande: seek).
 */
export class SmoothClock {
  private base = 0;
  private perf = 0;
  private started = false;

  read(mediaTime: number, nowMs: number, playing: boolean, rate: number): number {
    if (!playing || !this.started) {
      this.base = mediaTime;
      this.perf = nowMs;
      this.started = playing;
      return mediaTime;
    }
    const est = this.base + ((nowMs - this.perf) / 1000) * rate;
    const err = mediaTime - est;
    if (Math.abs(err) > 0.25) {
      this.base = mediaTime;
      this.perf = nowMs;
      return mediaTime;
    }
    // corrige devagar: 4% do erro por quadro
    this.base += err * 0.04;
    return est + err * 0.04;
  }
}
