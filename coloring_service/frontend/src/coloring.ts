export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];

export const COLORS: Record<"red" | "blue", RGBA> = {
  red: [229, 57, 53, 255],
  blue: [30, 136, 229, 255]
};

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

export function floodFillNoBackground(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: RGBA,
  bg: RGB,
  bgTol: number
) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.getImageData(0,0,w,h);
  const data = img.data;

  const idx0 = (y*w + x)*4;
  const startRGB: RGB = [data[idx0], data[idx0+1], data[idx0+2]];
  const startA = data[idx0+3];
  if (startA === 0) return;

  // 배경 클릭이면 무시
  if (colorDist3(startRGB, bg) <= bgTol) return;

  // 선(어두운 픽셀) 위 클릭이면 무시
  if (luminance(startRGB) < 120) return;

  // 이미 같은 색이면 무시
  if (Math.abs(startRGB[0]-fill[0]) + Math.abs(startRGB[1]-fill[1]) + Math.abs(startRGB[2]-fill[2]) < 10) return;

  const tol = 55;
  const visited = new Uint8Array(w*h);
  const stack: Array<[number,number]> = [[x,y]];

  while (stack.length) {
    const [cx,cy] = stack.pop()!;
    if (cx<0||cy<0||cx>=w||cy>=h) continue;
    const p = cy*w + cx;
    if (visited[p]) continue;
    visited[p] = 1;

    const i = p*4;
    const rgb: RGB = [data[i], data[i+1], data[i+2]];
    const a = data[i+3];
    if (a === 0) continue;

    // 배경/선은 장벽
    if (colorDist3(rgb, bg) <= bgTol) continue;
    if (luminance(rgb) < 120) continue;

    // 시작색과 유사한 픽셀만
    if (colorDist3(rgb, startRGB) > tol) continue;

    data[i] = fill[0];
    data[i+1] = fill[1];
    data[i+2] = fill[2];
    data[i+3] = 255;

    stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
  }

  ctx.putImageData(img, 0, 0);
}
