export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];

export const COLORS: Record<"red" | "blue", RGBA> = {
  red: [229, 57, 53, 255],
  blue: [30, 136, 229, 255]
};

function colorDist(a: RGB, b: RGB) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.abs(dr) + Math.abs(dg) + Math.abs(db);
}

function getRGB(data: Uint8ClampedArray, i: number): RGB {
  return [data[i], data[i + 1], data[i + 2]];
}

/**
 * 배경 마스크: "테두리(캔버스 가장자리)와 연결된 배경색 픽셀"만 1로 표시
 * -> 내부 흰색 영역(라인으로 막힌 곳)은 0이므로 칠할 수 있음
 */
export function buildBackgroundMask(
  img: ImageData,
  bg: RGB,
  tol: number
): Uint8Array {
  const { width: w, height: h, data } = img;

  // IMPORTANT:
  // For line drawings, a high tolerance can treat anti-aliased line pixels as "background"
  // and leak through the line into inner regions. Clamp tolerance and require high luminance.
  const bgLum = luminance(bg);
  const tolMask = Math.min(tol, 25);                 // ✅ tighter than estimateBackground tol
  const minLum = Math.max(200, bgLum - 15);          // ✅ background must be bright

  const mask = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  let qs = 0, qe = 0;

  const isBgLike = (x: number, y: number) => {
    const idx = (y * w + x) * 4;
    const c = getRGB(data, idx);
    // require both color similarity AND brightness (prevents passing through light-gray edges)
    return colorDist(c, bg) <= tolMask && luminance(c) >= minLum;
  };

  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (mask[p]) return;
    if (!isBgLike(x, y)) return;
    mask[p] = 1;
    qx[qe] = x;
    qy[qe] = y;
    qe++;
  };

  // BFS from the canvas border: only border-connected "background" is marked.
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  while (qs < qe) {
    const x = qx[qs];
    const y = qy[qs];
    qs++;

    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }

  return mask;
}

export function colorDist3(a: RGB, b: RGB) {
  return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
}
export function luminance(rgb: RGB) {
  return 0.299*rgb[0] + 0.587*rgb[1] + 0.114*rgb[2];
}

export function estimateBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0,0,w,h).data;
  const sample = (x:number,y:number): RGB => {
    const i=(y*w + x)*4;
    return [data[i], data[i+1], data[i+2]];
  };

  const samples: RGB[] = [];
  const pts: Array<[number,number]> = [
    [0,0],[w-1,0],[0,h-1],[w-1,h-1],
    [Math.floor(w/2),0],[Math.floor(w/2),h-1],
    [0,Math.floor(h/2)],[w-1,Math.floor(h/2)]
  ];
  for (const [x,y] of pts) samples.push(sample(x,y));

  const n=20;
  for (let k=0;k<n;k++){
    samples.push(sample(Math.floor((w-1)*k/(n-1)), 0));
    samples.push(sample(Math.floor((w-1)*k/(n-1)), h-1));
    samples.push(sample(0, Math.floor((h-1)*k/(n-1))));
    samples.push(sample(w-1, Math.floor((h-1)*k/(n-1))));
  }

  let r=0,g=0,b=0;
  for (const s of samples){ r+=s[0]; g+=s[1]; b+=s[2]; }
  r=Math.round(r/samples.length);
  g=Math.round(g/samples.length);
  b=Math.round(b/samples.length);
  const bg: RGB = [r,g,b];

  const lum = luminance(bg);
  const tol = lum > 220 ? 55 : 40;

  return { bg, tol };
}

export function floodFillWithBgMask(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: RGB | RGBA,
  bgMask: Uint8Array,
  colorTol = 30
) {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  if (x < 0 || y < 0 || x >= w || y >= h) return;

  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;

  let startP = y * w + x;

  // Don't paint the outer background.
  if (bgMask[startP] === 1) return;

  // If the user taps on a line pixel, try to find a nearby bright interior pixel.
  // This makes "fill the region inside the line" work even if the tap lands on the stroke.
  const startIdx0 = startP * 4;
  const startRGB0: RGB = [data[startIdx0], data[startIdx0 + 1], data[startIdx0 + 2]];
  const startLum0 = luminance(startRGB0);
  if (startLum0 < 230) {
    const radius = 3;
    let found: number | null = null;
    for (let dy = -radius; dy <= radius && found === null; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const p = ny * w + nx;
        if (bgMask[p] === 1) continue;
        const i = p * 4;
        const c: RGB = [data[i], data[i + 1], data[i + 2]];
        if (luminance(c) >= 240) {
          found = p;
          break;
        }
      }
    }
    if (found !== null) startP = found;
  }

  const startIdx = startP * 4;
  const target: RGB = [data[startIdx], data[startIdx + 1], data[startIdx + 2]];

  // If already the same color, return
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;

  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let qs = 0, qe = 0;

  const withinTol = (p: number) => {
    const i = p * 4;
    const c: RGB = [data[i], data[i + 1], data[i + 2]];
    return colorDist(c, target) <= colorTol;
  };

  const paint = (p: number) => {
    const i = p * 4;
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
  };

  const push = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;

    // Never fill border-connected background.
    if (bgMask[p] === 1) return;

    // Only fill pixels similar to the starting pixel.
    if (!withinTol(p)) return;

    q[qe++] = p;
  };

  push(startP);

  while (qs < qe) {
    const p = q[qs++];
    paint(p);

    const px = p % w;
    const py = (p / w) | 0;

    if (px > 0) push(p - 1);
    if (px + 1 < w) push(p + 1);
    if (py > 0) push(p - w);
    if (py + 1 < h) push(p + w);
  }

  ctx.putImageData(img, 0, 0);
}

