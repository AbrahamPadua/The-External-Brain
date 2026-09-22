type Point = [number, number];
type Branch = {
  samples: Point[];
  lengths: number[];
  length: number;
  thickness: number;
  active: boolean;
  distance: number;
};

const roots: Point[][] = [
  [[710, 510], [600, 472], [500, 397], [403, 320], [315, 272], [202, 276], [132, 294]],
  [[710, 510], [617, 424], [559, 322], [495, 213], [453, 134], [380, 67]],
  [[710, 510], [736, 442], [769, 349], [810, 240], [814, 153], [778, 58]],
  [[710, 510], [808, 457], [887, 410], [970, 371], [1022, 307]],
  [[710, 510], [815, 510], [904, 525], [1043, 534]],
  [[710, 510], [697, 601], [690, 681], [696, 774], [722, 870]],
  [[697, 601], [628, 636], [556, 646], [484, 642], [444, 667]],
  [[697, 601], [780, 624], [858, 660], [948, 656], [979, 653]],
  [[697, 601], [748, 667], [793, 724], [859, 750], [890, 752]],
  [[500, 397], [468, 329], [469, 248], [451, 159], [462, 61]],
  [[559, 322], [576, 233], [615, 150], [620, 68]],
  [[403, 320], [393, 408], [372, 481], [327, 551], [279, 588]],
  [[315, 272], [299, 338], [236, 398], [179, 453]],
  [[808, 457], [849, 366], [890, 274], [915, 177]],
  [[887, 410], [944, 432], [1000, 468], [1052, 485]],
  [[617, 424], [639, 343], [690, 270], [711, 180], [683, 77]],
];

let seed = 71;
const random = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const branches: Branch[] = [];
function branch(points: Point[], thickness: number, active: boolean, distance = 0): Branch {
  const samples: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[i];
    const c = points[i + 1];
    const d = points[Math.min(points.length - 1, i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      samples.push([
        0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - d[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + d[0]) * t3),
        0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3),
      ]);
    }
  }
  samples.push(points[points.length - 1]);
  let length = 0;
  const lengths = samples.map((p, i) => {
    if (i > 0) length += Math.hypot(p[0] - samples[i - 1][0], p[1] - samples[i - 1][1]);
    return length;
  });
  const b: Branch = { samples, lengths, length, thickness, active, distance };
  branches.push(b);
  return b;
}

function nearestDistance(point: Point): number {
  let best = Infinity;
  let distance = 0;
  for (const b of branches) {
    for (let i = 0; i < b.samples.length; i++) {
      const p = b.samples[i];
      const delta = Math.hypot(p[0] - point[0], p[1] - point[1]);
      if (delta < best) {
        best = delta;
        distance = b.distance + b.lengths[i];
      }
    }
  }
  return distance;
}

for (let r = 0; r < roots.length; r++) {
  const points = roots[r];
  const start = nearestDistance(points[0]);
  const main = branch(points, r < 6 ? 7 : 4.1, true, start);
  branch(points.map(([x, y], i) => [x - 18 - Math.sin(i * 1.7 + r) * 15, y + 9 + Math.cos(i + r) * 12]), r < 6 ? 4.8 : 2.7, false, start);
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const prev = points[i - 1];
    const angle = Math.atan2(y - prev[1], x - prev[0]);
    const side = (i + r) % 2 ? 1 : -1;
    const turn = angle + side * (0.48 + random() * 0.6);
    const len = 48 + random() * 67;
    const tip: Point = [x + Math.cos(turn) * len, y + Math.sin(turn) * len];
    const mid: Point = [x + Math.cos(turn - 0.18 * side) * len * 0.5, y + Math.sin(turn - 0.18 * side) * len * 0.5];
    const child = branch([[x, y], mid, tip], 2.2 + random() * 1.2, random() > 0.27, main.distance + main.lengths[i * 24]);
    const fork = turn + side * 0.5;
    const l = len * 0.43;
    branch([mid, [mid[0] + Math.cos(fork) * l * 0.5, mid[1] + Math.sin(fork) * l * 0.5], [mid[0] + Math.cos(fork) * l, mid[1] + Math.sin(fork) * l]], 1.3, child.active, child.distance + child.lengths[24]);
  }
}

export function startConnectingIdeas(canvas: HTMLCanvasElement, dark: boolean): () => void {
  const context = canvas.getContext('2d');
  const backdrop = document.createElement('canvas');
  const backgroundContext = backdrop.getContext('2d');
  if (!context || !backgroundContext) return () => {};
  const ctx: CanvasRenderingContext2D = context;
  const bg: CanvasRenderingContext2D = backgroundContext;

  const palette: [number, number, number][] = dark
    ? [[18, 89, 243], [255, 59, 92], [0, 229, 255]]
    : [[18, 89, 243], [255, 46, 85], [0, 168, 204]];

  function colorAt(phase: number): string {
    const pos = ((phase % 3) + 3) % 3;
    const index = Math.floor(pos);
    const mix = (1 - Math.cos((pos - index) * Math.PI)) / 2;
    const next = (index + 1) % 3;
    const r = Math.round(palette[index][0] + (palette[next][0] - palette[index][0]) * mix);
    const g = Math.round(palette[index][1] + (palette[next][1] - palette[index][1]) * mix);
    const b = Math.round(palette[index][2] + (palette[next][2] - palette[index][2]) * mix);
    return `${r},${g},${b}`;
  }

  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
  let lastFrame = 0;
  let destroyed = false;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  function renderBackground(): void {
    backdrop.width = Math.round(width * dpr);
    backdrop.height = Math.round(height * dpr);
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.fillStyle = dark ? '#060A14' : '#F8F9FE';
    bg.fillRect(0, 0, width, height);
    bg.strokeStyle = dark ? 'rgba(100,140,220,0.06)' : 'rgba(18,89,243,0.06)';
    bg.lineWidth = 0.7;
    bg.beginPath();
    for (let x = 0; x < width; x += 32) { bg.moveTo(x, 0); bg.lineTo(x, height); }
    for (let y = 0; y < height; y += 32) { bg.moveTo(0, y); bg.lineTo(width, y); }
    bg.stroke();
    const glow = bg.createRadialGradient(width * 0.5, height * 0.46, 0, width * 0.5, height * 0.46, Math.min(width, height) * (dark ? 0.52 : 0.48));
    if (dark) {
      glow.addColorStop(0, 'rgba(18, 89, 243, 0.14)');
      glow.addColorStop(0.5, 'rgba(255, 59, 92, 0.04)');
      glow.addColorStop(1, 'rgba(6, 10, 20, 0)');
    } else {
      glow.addColorStop(0, 'rgba(255, 46, 85, 0.05)');
      glow.addColorStop(0.5, 'rgba(18, 89, 243, 0.03)');
      glow.addColorStop(1, 'rgba(248, 249, 254, 0)');
    }
    bg.fillStyle = glow;
    bg.fillRect(0, 0, width, height);
  }

  function draw(ms: number): void {
    const t = reduced.matches ? 2.3 : ms / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(backdrop, 0, 0);
    const scale = Math.max(0.08, Math.min(width / 1280, (height * 0.68 - 65) / 900, 0.64));
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (width / 2 - 600 * scale), dpr * (height * 0.43 - 450 * scale));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const b of branches) {
      const p = b.samples;
      for (let i = 1; i < p.length; i++) {
        const distance = b.distance + b.lengths[i];
        const rgb = colorAt(distance / 410 - t * 0.19 + (b.active ? 0 : 0.65));
        const phase = ((distance - t * 145) % 470 + 470) % 470;
        const delta = Math.min(phase, 470 - phase);
        const signal = Math.exp(-delta * delta / 1900);
        const shimmer = 0.5 + 0.5 * Math.sin(distance * 0.009 - t * 1.3);
        ctx.beginPath();
        ctx.moveTo(p[i - 1][0], p[i - 1][1]);
        ctx.lineTo(p[i][0], p[i][1]);
        const strokeAlpha = dark ? 0.32 + shimmer * 0.22 + signal * 0.46 : 0.45 + shimmer * 0.2 + signal * 0.35;
        const widthDecay = dark ? 0.79 : 0.75;
        const widthBase = dark ? 0.8 : 1.0;
        const widthMul = dark ? 0.88 + signal * 0.18 : 0.9 + signal * 0.25;
        ctx.lineWidth = Math.max(widthBase, b.thickness * (1 - widthDecay * i / p.length)) * widthMul;
        ctx.strokeStyle = `rgba(${rgb},${strokeAlpha})`;
        ctx.shadowBlur = 0;
        ctx.stroke();
        if (signal > 0.08) {
          ctx.shadowColor = `rgba(${rgb},${signal * (dark ? 0.75 : 0.55)})`;
          ctx.shadowBlur = (dark ? 12 : 8) * scale * dpr;
          ctx.strokeStyle = `rgba(${rgb},${dark ? signal * 0.85 : Math.min(1, 0.7 + signal * 0.3)})`;
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
    }

    const breath = 1 + 0.045 * Math.sin(t * Math.PI / 2.2);
    ctx.translate(710, 510);
    ctx.scale(breath, breath);

    const haloR = dark ? 72 : 66;
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, haloR);
    halo.addColorStop(0, dark ? 'rgba(255, 59, 92, 0.45)' : 'rgba(255,46,85,0.22)');
    halo.addColorStop(0.45, dark ? 'rgba(18, 89, 243, 0.25)' : 'rgba(18,89,243,0.10)');
    halo.addColorStop(1, 'rgba(18, 89, 243, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, Math.PI * 2);
    ctx.fill();

    const somaColor = dark ? '#FF3B5C' : '#FF2E55';
    const soma = ctx.createRadialGradient(-5, -5, 1, 0, 0, dark ? 24 : 23);
    soma.addColorStop(0, somaColor);
    soma.addColorStop(0.6, somaColor);
    soma.addColorStop(1, '#1259F3');
    ctx.beginPath();
    ctx.moveTo(-24, -17);
    ctx.bezierCurveTo(-8, -19, 12, -11, 29, -12);
    ctx.bezierCurveTo(18, 2, 6, 21, -7, 24);
    ctx.bezierCurveTo(-17, 16, -18, 0, -24, -17);
    ctx.fillStyle = soma;
    ctx.shadowColor = dark ? somaColor : 'rgba(255,46,85,0.45)';
    ctx.shadowBlur = (dark ? 18 : 14) * scale * dpr;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = dark ? somaColor : '#E11D48';
    ctx.lineWidth = dark ? 1.2 : 1.5;
    ctx.stroke();

    if (dark) {
      ctx.beginPath(); ctx.arc(-3, 0, 6.5, 0, Math.PI * 2); ctx.fillStyle = '#060A14'; ctx.fill();
      ctx.beginPath(); ctx.arc(-4, -1, 2.8, 0, Math.PI * 2); ctx.fillStyle = '#00E5FF';
      ctx.shadowColor = '#00E5FF'; ctx.shadowBlur = 6 * scale * dpr; ctx.fill(); ctx.shadowBlur = 0;
    } else {
      ctx.beginPath(); ctx.arc(-3, 0, 6, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.beginPath(); ctx.arc(-3, 0, 6, 0, Math.PI * 2); ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath(); ctx.arc(-4, -1, 2.4, 0, Math.PI * 2); ctx.fillStyle = '#0284C7'; ctx.fill();
    }
  }

  function loop(ms: number): void {
    if (destroyed || reduced.matches || document.hidden) return;
    frame = requestAnimationFrame(loop);
    if (ms - lastFrame < 33.33) return;
    lastFrame = ms;
    draw(ms);
  }

  function restart(): void {
    cancelAnimationFrame(frame);
    if (destroyed) return;
    if (reduced.matches) {
      draw(2300);
    } else if (!document.hidden) {
      lastFrame = performance.now();
      draw(lastFrame);
      frame = requestAnimationFrame(loop);
    }
  }

  function resize(): void {
    width = canvas.clientWidth || window.innerWidth || 800;
    height = canvas.clientHeight || window.innerHeight || 600;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    renderBackground();
  }

  function onResize(): void {
    resize();
    restart();
  }

  function onVisibilityChange(): void {
    if (document.hidden) {
      cancelAnimationFrame(frame);
    } else {
      restart();
    }
  }

  function onReducedChange(): void {
    restart();
  }

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
  reduced.addEventListener('change', onReducedChange);

  resize();
  if (reduced.matches) {
    draw(2300);
  } else {
    draw(0);
    if (!document.hidden) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(loop);
    }
  }

  return () => {
    destroyed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    reduced.removeEventListener('change', onReducedChange);
  };
}
