// 3D 火箭模型三角面构建（RocketView3D 与 FlightReplay3D 共用同一模型源）
// 输入：组件树 root（RocketComponent）→ 输出：三角面列表（含光照颜色）
// 轴向语义：z 从鼻端（0）向尾部增加（与 layoutRocket 一致）；xOff 为并联级侧向偏移
import type { RocketComponent } from './types';
import { layoutRocket, type GeoSeg } from './geometry';

type Seg = GeoSeg;

const N = 26; // 圆周细分（更光滑）

export interface Tri3D {
  pts: number[][];
  proj?: { x: number; y: number }[];
  depth: number;
  color: string;
  kind: string;
  cls: 'outer' | 'inner' | 'fin';
  comp: RocketComponent;
  z0: number;
  z1: number;
  selected: boolean;
}

function propNum(c: RocketComponent, k: string, d: number): number {
  const v = parseFloat(c.properties?.[k] ?? '');
  return Number.isFinite(v) ? v : d;
}

function clsOf(kind: string): Tri3D['cls'] {
  if (kind.includes('fin')) return 'fin';
  if (['innertube', 'enginemount', 'engineblock'].includes(kind)) return 'inner';
  return 'outer';
}

export const COLORS3D: Record<string, [string, string, string]> = {
  // [高光, 主色, 阴影] —— 按真实火箭部件差异化配色
  nosecone: ['#ffffff', '#e9eff7', '#a8b8cc'],          // 白色玻纤头锥（亮漆）
  bodytube: ['#f4f7fb', '#dce4ee', '#94a3b8'],          // 白/浅灰玻纤机身管
  transition: ['#e6edf5', '#c2cfdd', '#7e8fa5'],        // 金属银过渡段
  trapezoidfinset: ['#ffa878', '#f4673a', '#a33a16'],   // 橙红漆尾翼
  ellipticalfinset: ['#ffa878', '#f4673a', '#a33a16'],
  freeformfinset: ['#ffa878', '#f4673a', '#a33a16'],
  finset: ['#ffa878', '#f4673a', '#a33a16'],
  tubefinset: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],        // 银灰管尾翼
  launchlug: ['#6a7484', '#424c5c', '#20262f'],         // 黑塑料导轨块
  railbutton: ['#6a7484', '#424c5c', '#20262f'],        // 黑塑料导轨按钮
  parachute: ['#ff8080', '#e04545', '#8c1f1f'],         // 红色回收伞
  streamer: ['#ffc46b', '#e8932c', '#995b0e'],          // 橙黄飘带
  shockcord: ['#f5efe0', '#dcd2ba', '#a89c80'],         // 米白减震绳
  masscomponent: ['#b8c4d2', '#8a97a8', '#56626f'],     // 金属配重
  innertube: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],         // 金属内管
  enginemount: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],       // 金属发动机座
  engineblock: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],       // 金属挡块
  tubecoupler: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],       // 金属管接头
  bulkhead: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],          // 金属隔框
  centeringring: ['#d7e1ec', '#b3c2d3', '#7b8a9d'],     // 金属定心环
  engine: ['#eef2f7', '#c8d3e0', '#7e8fa5'],            // 银金属发动机
};

function triColor(seg: Seg, light: number): string {
  const base = COLORS3D[seg.kind] ?? ['#8ec8ff', '#2f8bff', '#0a54c8'];
  const [hi, mid, lo] = base;
  // light: 0~1 → 阴影~高光 之间插值（允许轻微过曝，钳制 255）
  const ch3 = (a: string, b: string, t: number) => [
    Math.min(255, Math.round(parseInt(a.slice(1, 3), 16) + (parseInt(b.slice(1, 3), 16) - parseInt(a.slice(1, 3), 16)) * t)),
    Math.min(255, Math.round(parseInt(a.slice(3, 5), 16) + (parseInt(b.slice(3, 5), 16) - parseInt(a.slice(3, 5), 16)) * t)),
    Math.min(255, Math.round(parseInt(a.slice(5, 7), 16) + (parseInt(b.slice(5, 7), 16) - parseInt(a.slice(5, 7), 16)) * t)),
  ];
  let ca = lo, cb = mid;
  if (light > 0.5) { ca = mid; cb = hi; }
  const t = light > 0.5 ? (light - 0.5) * 2 : light * 2;
  return `rgb(${ch3(ca, cb, Math.min(t, 1.2)).join(',')})`;
}

/** 构建 3D 三角面（含光照颜色）。segs 可选传入（避免重复 layout） */
export function buildRocketFaces(root: RocketComponent, selected?: RocketComponent | null, segs?: Seg[]): Tri3D[] {
  const sList = segs ?? layoutRocket(root);
  const tris: Tri3D[] = [];
  const addQuad = (a: number[], b: number[], c: number[], d: number[], seg: Seg, light: number, sel: boolean) => {
    const cls = clsOf(seg.kind);
    tris.push({ pts: [a, b, c], depth: 0, color: triColor(seg, light), kind: seg.kind, cls, comp: seg.comp, z0: seg.z0, z1: seg.z1, selected: sel });
    tris.push({ pts: [a, c, d], depth: 0, color: triColor(seg, light * 0.96), kind: seg.kind, cls, comp: seg.comp, z0: seg.z0, z1: seg.z1, selected: sel });
  };
  const segAdd = (s: Seg, z0: number, z1: number, r0: number, r1: number, cx = 0, cy = 0) => {
    const steps = s.kind === 'nosecone' ? 10 : 4;
    const conical = s.kind === 'nosecone' && String(s.comp.properties?.['shape'] ?? 'ogive').toLowerCase() === 'conical';
    const zs: number[] = [];
    for (let i = 0; i <= steps; i++) zs.push(z0 + (z1 - z0) * i / steps);
    // 每顶点计算圆周光照（镜面高光 + 底部压暗）
    const rings = zs.map((z, i) => {
      const t = i / steps;
      const r = r0 + (r1 - r0) * (conical ? t : s.kind === 'nosecone' ? Math.sin(t * Math.PI / 2) : t);
      const ring: [number, number, number, number][] = [];
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2;
        const cAng = Math.abs(Math.cos(th + 0.5));
        let light = 0.4 + 0.6 * Math.pow(cAng, 1.4);
        if (cAng > 0.82) light += (cAng - 0.82) * 2.4; // 镜面高光
        if (cAng < 0.2) light -= (0.2 - cAng) * 0.6; // 底部反光压暗
        ring.push([cx + r * Math.cos(th), cy + r * Math.sin(th), z, Math.min(light, 1.4)]);
      }
      return ring;
    });
    const sel = s.comp === selected;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        const l = (rings[i][j][3] + rings[i][j2][3] + rings[i + 1][j2][3] + rings[i + 1][j][3]) / 4;
        addQuad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], s, l, sel);
      }
    }
  };
  for (const s of sList) {
    if (s.kind !== 'tubefinset') segAdd(s, s.z0, s.z1, s.r0, s.r1, s.xOff ?? 0, 0);
    if (s.kind === 'tubefinset') {
      // 管翼：N 根小管环绕（官方相切布局），每根画为偏移圆柱
      const count = Math.max(parseInt(propNum(s.comp, 'fincount', 6).toString(), 10) || 6, 1);
      const tubeR = Math.max(s.r0, s.r1, 0.0005);
      const rr = Math.max(s.r0, s.r1, 0.001);
      const parentR = count === 6 ? tubeR : tubeR * (1 - Math.sin(Math.PI / count)) / Math.sin(Math.PI / count);
      const centerD = parentR + tubeR;
      const xOff = s.xOff ?? 0;
      const angle0 = (parseFloat(s.comp.properties?.['angleoffset'] ?? '') || 0) * Math.PI / 180;
      for (let f = 0; f < count; f++) {
        const th = angle0 + (f / count) * Math.PI * 2;
        segAdd(s, s.z0, s.z1, tubeR, tubeR, xOff + (rr + centerD - tubeR) * Math.cos(th), (rr + centerD - tubeR) * Math.sin(th));
      }
    } else if (s.kind.includes('fin')) {
      const h = Math.max(propNum(s.comp, 'height', 0.05), 0);
      const count = Math.max(parseInt(propNum(s.comp, 'fincount', 3).toString(), 10) || 3, 1);
      const rootc = Math.max(propNum(s.comp, 'rootchord', s.z1 - s.z0), 0.001);
      const sel = s.comp === selected;
      const rr = Math.max(s.r0, s.r1, 0.001);
      // 翼面轮廓点集（[弦向因子 fx, 翼高因子 fy]），按尾翼类型区分
      const outline: Array<[number, number]> = [];
      if (s.kind === 'ellipticalfinset') {
        const n = 10;
        for (let i = 0; i <= n; i++) outline.push([i / n, Math.sin(Math.PI * i / n)]);
      } else if (s.kind === 'freeformfinset') {
        const raw = String(s.comp.properties['points'] ?? '');
        const def: Array<[number, number]> = [[0, 0], [0.12, 0.6], [0.28, 1], [0.62, 1], [0.86, 0.55], [1, 0]];
        let pts: Array<[number, number]> = def;
        if (raw) {
          const arr = raw.split(';').map((p) => {
            const [x, y] = p.split(',').map(parseFloat);
            return [x, y];
          }).filter((p) => p.length === 2 && p.every(Number.isFinite)) as Array<[number, number]>;
          if (arr.length >= 3) pts = arr;
        }
        outline.push(...pts);
      } else {
        const tipc = Math.max(propNum(s.comp, 'tipchord', rootc * 0.8), 0.001);
        const sweep = Math.max(propNum(s.comp, 'sweep', 0), 0);
        outline.push([0, 0], [Math.min(sweep / rootc, 0.8), 1], [Math.min((sweep + tipc) / rootc, 1), 1], [1, 0]);
      }
      const t = Math.max(propNum(s.comp, 'thickness', 0.003), 0.0005);
      for (let f = 0; f < count; f++) {
        const th = (f / count) * Math.PI * 2;
        const cos = Math.cos(th), sin = Math.sin(th);
        const nx = Math.sin(th), ny = -Math.cos(th); // 翼面法线方向
        const cAng = Math.abs(cos);
        let light = 0.45 + 0.5 * Math.pow(cAng, 1.3);
        if (cAng > 0.85) light += (cAng - 0.85) * 1.8;
        const xOff = s.xOff ?? 0;
        const P: Array<[number, number, number]> = outline.map(([fx, fy]) => [xOff + rr * cos + h * fy * cos, rr * sin + h * fy * sin, s.z0 + fx * rootc]);
        const P2: Array<[number, number, number]> = P.map((p) => [p[0] + nx * t, p[1] + ny * t, p[2]]);
        for (let i = 1; i < P.length - 1; i++) addQuad(P[0], P[i], P[i + 1], P[i + 1], s, light, sel);
        for (let i = 1; i < P2.length - 1; i++) addQuad(P2[i + 1], P2[i], P2[0], P2[0], s, light * 0.85, sel);
        for (let i = 0; i < P.length - 1; i++) addQuad(P[i], P[i + 1], P2[i + 1], P2[i], s, light * 0.7, sel);
      }
    }
  }
  return tris;
}

/** 把 Tri3D 归一化到目标长度（z 翻转：真实模型 z=0 为鼻端 → 目标鼻端在 +Z；保持长径比） */
export function normalizeFaces3D(faces: Tri3D[], len: number): Tri3D[] {
  let minZ = Infinity, maxZ = -Infinity, maxR = 0;
  for (const t of faces) {
    for (const p of t.pts) {
      if (p[2] < minZ) minZ = p[2];
      if (p[2] > maxZ) maxZ = p[2];
      const r = Math.hypot(p[0], p[1]);
      if (r > maxR) maxR = r;
    }
  }
  const span = Math.max(maxZ - minZ, 1e-6);
  const s = len / span;
  // 若模型径向尺寸相对长度过大（如并联级），等比缩放即可；不做额外压缩
  return faces.map((t) => ({
    ...t,
    pts: t.pts.map(([x, y, z]) => [x * s, y * s, (maxZ - z) * s]),
  }));
}
