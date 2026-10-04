<script setup lang="ts">
// 3D 视图 v2：Apple 标准材质渲染——金属高光 / 地面阴影 / 尺寸标注 / 部件高亮
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { RocketComponent } from '../lib/types';
import { layoutRocket, type GeoSeg } from '../lib/geometry';

const props = defineProps<{ root: RocketComponent; selected?: RocketComponent | null; cgX?: number | null; cpX?: number | null; orientation?: 'vertical' | 'horizontal' }>();
const emit = defineEmits<{ hover: [c: RocketComponent | null]; pick: [c: RocketComponent] }>();
const isH = computed(() => props.orientation === 'horizontal');

type Seg = GeoSeg;

function propNum(c: RocketComponent, k: string, d: number): number {
  const v = parseFloat(c.properties?.[k] ?? '');
  return Number.isFinite(v) ? v : d;
}

/** 轴向段：统一几何布局（官方轴向语义 + 半径继承），2D/3D 共用同一几何 */
function buildSegs(root: RocketComponent): Seg[] {
  return layoutRocket(root);
}

const segs = computed(() => buildSegs(props.root));
const total = computed(() => Math.max(segs.value.reduce((m, s) => Math.max(m, s.z1), 0), 0.05));
const maxR = computed(() => Math.max(...segs.value.map((s) => Math.max(s.r0, s.r1)), 0.001));

// —— 3D 几何与材质 ——
const N = 26; // 圆周细分（更光滑）

interface Tri {
  pts: number[][];
  proj?: { x: number; y: number }[];
  depth: number;
  color: string;
  selected: boolean;
  cls: 'outer' | 'inner' | 'fin';
  kind: string;
  comp: RocketComponent;
}

function clsOf(kind: string): Tri['cls'] {
  if (kind.includes('fin')) return 'fin';
  if (['innertube', 'enginemount', 'engineblock'].includes(kind)) return 'inner';
  return 'outer';
}

const COLORS: Record<string, [string, string, string]> = {
  // [高光, 主色, 阴影]
  nosecone: ['#6db9ff', '#0a84ff', '#0057b8'],
  bodytube: ['#8ec8ff', '#2f8bff', '#0a54c8'],
  transition: ['#9ad2ff', '#3f97ff', '#0a5cd6'],
  trapezoidfinset: ['#4da3ff', '#0a5cd6', '#062a66'],
  ellipticalfinset: ['#4da3ff', '#0a5cd6', '#062a66'],
  finset: ['#4da3ff', '#0a5cd6', '#062a66'],
  innertube: ['#a8d8ff', '#5aa7ff', '#1a66cc'],
  enginemount: ['#a8d8ff', '#5aa7ff', '#1a66cc'],
  engineblock: ['#a8d8ff', '#5aa7ff', '#1a66cc'],
  launchlug: ['#8ec8ff', '#2f8bff', '#0a54c8'],
  railbutton: ['#8ec8ff', '#2f8bff', '#0a54c8'],
  parachute: ['#ffd9a0', '#ffb34d', '#c97b0a'],
};

function triColor(seg: Seg, light: number): string {
  const base = COLORS[seg.kind] ?? ['#8ec8ff', '#2f8bff', '#0a54c8'];
  const [hi, mid, lo] = base;
  // light: 0~1 → 阴影~高光 之间插值（三通道分别插值，保持蓝色系）
  const ch3 = (a: string, b: string, t: number) => [
    Math.round(parseInt(a.slice(1, 3), 16) + (parseInt(b.slice(1, 3), 16) - parseInt(a.slice(1, 3), 16)) * t),
    Math.round(parseInt(a.slice(3, 5), 16) + (parseInt(b.slice(3, 5), 16) - parseInt(a.slice(3, 5), 16)) * t),
    Math.round(parseInt(a.slice(5, 7), 16) + (parseInt(b.slice(5, 7), 16) - parseInt(a.slice(5, 7), 16)) * t),
  ];
  let ca = lo, cb = mid;
  if (light > 0.5) { ca = mid; cb = hi; }
  const t = light > 0.5 ? (light - 0.5) * 2 : light * 2;
  return `rgb(${ch3(ca, cb, t).join(',')})`;
}

// —— 程序化表面材质（半透明纹理叠加在光照色上，保留明暗与部件主色）——
const PAT_DEFS: Record<string, (c: CanvasRenderingContext2D, s: number) => void> = {
  // 碳纤维：45° 斜纹编织（白高光 + 黑阴影线）
  carbon(c, s) {
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 1;
    for (let i = -s; i < s * 2; i += 7) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,0.30)';
    for (let i = -s; i < s * 2; i += 7) { c.beginPath(); c.moveTo(i + 3.5, 0); c.lineTo(i + 3.5 + s, s); c.stroke(); }
  },
  // 金属拉丝：细水平磨砂线
  brushed(c, s) {
    for (let y = 0; y < s; y += 3) {
      c.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
      c.fillRect(0, y, s, 2);
    }
  },
  // 布料：经纬细网格
  fabric(c, s) {
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 1;
    for (let i = 0; i <= s; i += 8) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, s); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(s, i); c.stroke();
    }
  },
  // 玻纤光泽：横向高光带（模拟曲面反射）
  gloss(c, s) {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.32, 'rgba(255,255,255,0.34)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
};
// 部件 → 材质 + 叠加透明度
const MAT_MAP: Record<string, { pat?: string; a: number }> = {
  nosecone: { pat: 'gloss', a: 0.5 },
  bodytube: { pat: 'carbon', a: 0.34 },
  transition: { pat: 'brushed', a: 0.32 },
  trapezoidfinset: { pat: 'carbon', a: 0.26 },
  ellipticalfinset: { pat: 'carbon', a: 0.26 },
  finset: { pat: 'carbon', a: 0.26 },
  parachute: { pat: 'fabric', a: 0.5 },
  streamer: { pat: 'fabric', a: 0.5 },
  innertube: { pat: 'brushed', a: 0.2 },
  enginemount: { pat: 'brushed', a: 0.2 },
  engineblock: { pat: 'brushed', a: 0.2 },
};
const patCache = new Map<string, CanvasPattern | null>();
function getPat(kind: string, ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const mat = MAT_MAP[kind];
  if (!mat?.pat) return null;
  const key = mat.pat;
  if (patCache.has(key)) return patCache.get(key) ?? null;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const c2 = cv.getContext('2d');
  if (!c2) { patCache.set(key, null); return null; }
  PAT_DEFS[key]?.(c2, 64);
  const p = ctx.createPattern(cv, 'repeat');
  patCache.set(key, p);
  return p;
}

function buildTris(): Tri[] {
  const tris: Tri[] = [];
  const addQuad = (a: number[], b: number[], c: number[], d: number[], seg: Seg, light: number, sel: boolean) => {
    const cls = clsOf(seg.kind);
    tris.push({ pts: [a, b, c], depth: 0, color: triColor(seg, light), selected: sel, cls, kind: seg.kind, comp: seg.comp });
    tris.push({ pts: [a, c, d], depth: 0, color: triColor(seg, light * 0.96), selected: sel, cls, kind: seg.kind, comp: seg.comp });
  };
  const segAdd = (s: Seg, z0: number, z1: number, r0: number, r1: number, cx = 0, cy = 0) => {
    const steps = s.kind === 'nosecone' ? 6 : 2;
    const conical = s.kind === 'nosecone' && String(s.comp.properties?.['shape'] ?? 'ogive').toLowerCase() === 'conical';
    const zs: number[] = [];
    for (let i = 0; i <= steps; i++) zs.push(z0 + (z1 - z0) * i / steps);
    const rings = zs.map((z, i) => {
      const t = i / steps;
      const r = r0 + (r1 - r0) * (conical ? t : s.kind === 'nosecone' ? Math.sin(t * Math.PI / 2) : t);
      const ring: [number, number, number][] = [];
      for (let j = 0; j < N; j++) {
        const th = (j / N) * Math.PI * 2;
        ring.push([cx + r * Math.cos(th), cy + r * Math.sin(th), z]);
      }
      return ring;
    });
    const sel = s.comp === props.selected;
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < N; j++) {
        const j2 = (j + 1) % N;
        // 圆周方向光照：面向观察者一侧亮
        const ang = (j / N) * Math.PI * 2 + 0.5;
        const light = 0.42 + 0.58 * Math.pow(Math.abs(Math.cos(ang)), 0.8);
        // 轴向高光：沿长度方向渐变（前段稍亮）
        const axial = 1 - 0.22 * ((z0 + z1) / 2 / Math.max(total.value, 0.001));
        addQuad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], s, light * axial, sel);
      }
    }
  };
  for (const s of segs.value) {
    if (s.kind !== 'tubefinset') segAdd(s, s.z0, s.z1, s.r0, s.r1, s.xOff ?? 0, 0);
    if (s.kind === 'tubefinset') {
      // 管翼：N 根小管环绕（官方相切布局），每根画为偏移圆柱
      const count = Math.max(parseInt(propNum(s.comp, 'fincount', 6).toString(), 10) || 6, 1);
      const tubeR = Math.max(s.r0, s.r1, 0.0005);
      const rr = Math.max(s.r0, s.r1, 0.001);
      // 管中心距 = bodyR + tubeR（官方相切）；parentR 用 6 管相切公式反推（bodyR = tubeR*sin(π/n)/(1-sin) 的逆用：近似 2*tubeR 对 n=6）
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
      const sel = s.comp === props.selected;
      const rr = Math.max(s.r0, s.r1, 0.001);
      // 翼面轮廓点集（[弦向因子 fx, 翼高因子 fy]），按尾翼类型区分（OpenRocket 外形语义）
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
        const light = 0.5 + 0.4 * Math.abs(cos);
        // 轮廓 3D 点（翼面外侧 + 厚度偏移侧）
        const xOff = s.xOff ?? 0;
        const P: Array<[number, number, number]> = outline.map(([fx, fy]) => [xOff + rr * cos + h * fy * cos, rr * sin + h * fy * sin, s.z0 + fx * rootc]);
        const P2: Array<[number, number, number]> = P.map((p) => [p[0] + nx * t, p[1] + ny * t, p[2]]);
        // 上表面（以根前点为扇心的三角扇）
        for (let i = 1; i < P.length - 1; i++) addQuad(P[0], P[i], P[i + 1], P[i + 1], s, light, sel);
        // 下表面（法线反向）
        for (let i = 1; i < P2.length - 1; i++) addQuad(P2[i + 1], P2[i], P2[0], P2[0], s, light * 0.85, sel);
        // 侧边（薄板边缘）
        for (let i = 0; i < P.length - 1; i++) addQuad(P[i], P[i + 1], P2[i + 1], P2[i], s, light * 0.7, sel);
      }
    }
  }
  return tris;
}

// —— 交互状态 ——
const canvas = ref<HTMLCanvasElement | null>(null);
// —— CG/CP 标记悬浮说明 ——
const MARK_TIPS: Record<string, string> = {
  CG: '重心（Center of Gravity）· 全箭质量平衡点：CP 在其后，飞行才稳定',
  CP: '压心（Center of Pressure）· 气动合力作用点：应在 CG 之后（静稳定裕度 > 0）',
};
const markSpots = ref<{ x: number; y: number; kind: string; z: number }[]>([]);
const markTip = ref<{ x: number; y: number; text: string } | null>(null);
function onCvMove(e: MouseEvent): void {
  const cv = canvas.value;
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let best: { x: number; y: number; kind: string; z: number } | null = null;
  let bd = 18;
  for (const m of markSpots.value) {
    const d = Math.hypot(m.x - mx, m.y - my);
    if (d < bd) { bd = d; best = m; }
  }
  markTip.value = best
    ? { x: mx, y: my, text: `${best.kind} ${best.z.toFixed(3)} m · ${MARK_TIPS[best.kind]}` }
    : null;
}
const lastTris: Tri[] = [];
let ctx: CanvasRenderingContext2D | null = null;
let rotY = 0.6;
let tilt = 0.38;
let scale = 1;
let dragging = false;
let lastX = 0, lastY = 0;
let raf = 0;
const hoverName = ref('');
const xrayTarget = ref(false);

// —— P2：视角预设（等距 / 正视 / 侧视 / 顶视，300ms lerp 过渡）——
const VIEW_PRESETS = {
  iso: { rotY: 0.6, tilt: 0.38, label: '等距' },
  front: { rotY: 0, tilt: 1.42, label: '正视' },
  side: { rotY: 0, tilt: 0.02, label: '侧视' },
  top: { rotY: Math.PI / 2, tilt: 1.42, label: '顶视' },
} as const;
const viewPreset = ref<'iso' | 'front' | 'side' | 'top'>('iso');
let presetAnim = 0;
function setViewPreset(p: 'iso' | 'front' | 'side' | 'top'): void {
  if (viewPreset.value === p) return;
  viewPreset.value = p;
  const target = VIEW_PRESETS[p];
  const r0 = rotY, t0 = tilt;
  const tStart = performance.now();
  if (presetAnim) cancelAnimationFrame(presetAnim);
  const step = (now: number) => {
    const k = Math.min(1, (now - tStart) / 300);
    const e = 1 - Math.pow(1 - k, 3); // easeOutCubic
    rotY = r0 + (target.rotY - r0) * e;
    tilt = t0 + (target.tilt - t0) * e;
    draw();
    if (k < 1) presetAnim = requestAnimationFrame(step);
    else presetAnim = 0;
  };
  presetAnim = requestAnimationFrame(step);
}
const xrayT = ref(0); // 0=实体 → 1=剖视 平滑过渡
let lastHover: RocketComponent | null = null;

function draw(): void {
  const cv = canvas.value;
  if (!cv || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // 背景：深蓝径向渐变（Apple 科技感）
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.55, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#123a7a');
  g.addColorStop(0.55, '#0a2b66');
  g.addColorStop(1, '#071a45');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 细网格（透视收敛感）
  const cxp = w / 2, cyp = h * 0.46;
  ctx.strokeStyle = 'rgba(125,185,255,0.10)';
  ctx.lineWidth = 1;
  for (let i = -14; i <= 14; i++) {
    ctx.beginPath(); ctx.moveTo(cxp + i * 24, 0); ctx.lineTo(cxp + i * 24 * 1.6, h); ctx.stroke();
  }
  for (let i = 0; i <= 10; i++) {
    const yy = cyp + i * 30;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(w, yy); ctx.stroke();
  }

  const tris = buildTris();
  const maxZ = total.value;
  // 比例适配：竖版轴向占高、径向占宽；横版轴向占宽、径向占高
  const unit = (isH.value
    ? Math.min(w * 0.62 / Math.max(maxZ, 0.05), h * 0.32 / Math.max(maxR.value * 2.2, 0.01))
    : Math.min(w * 0.36 / Math.max(maxR.value * 2.2, 0.01), h * 0.66 / Math.max(maxZ, 0.05))) * scale;
  // 竖版：z=0 鼻尖在顶部，主体垂直居中；横版：z=0 鼻尖在左，主体垂直居中
  const baseY = isH.value ? cyp : cyp - maxZ * unit * 0.5;
  const axOff = (z: number) => (isH.value ? cxp - maxZ * unit * 0.5 + z * unit : 0);
  const axPos3 = (z: number) => (isH.value ? axOff(z) : baseY + z * unit);

  // 地面阴影（竖版在底部；横版在尾部右侧）
  ctx.save();
  const shCX = isH.value ? cxp + maxZ * unit * 0.5 + 8 : cxp;
  const shCY = isH.value ? cyp : baseY + maxZ * unit + 8;
  ctx.translate(shCX, shCY);
  ctx.scale(isH.value ? 0.3 : 1, isH.value ? 1 : 0.24);
  const shR = Math.max(maxR.value * unit * 2.2, 20);
  const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, shR);
  grad.addColorStop(0, 'rgba(0,0,0,0.42)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.16)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, shR, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // 变换 + 深度排序
  for (const t of tris) {
    const pr = t.pts.map(([x, y, z]) => {
      const cos = Math.cos(rotY), sin = Math.sin(rotY);
      const x1 = x * cos - y * sin, y1 = x * sin + y * cos;
      const c2 = Math.cos(tilt), s2 = Math.sin(tilt);
      const y2 = y1 * c2 - z * s2, z2 = y1 * s2 + z * c2;
      if (isH.value) {
        // 横版：轴向 z → 屏幕 x（头朝左），半径 → 屏幕 y
        return { x: cxp - maxZ * unit * 0.5 + z * unit, y: baseY + y1 * unit, depth: y2 };
      }
      return { x: cxp + x1 * unit, y: baseY + z2 * unit, depth: y2 };
    });
    t.depth = (pr[0].depth + pr[1].depth + pr[2].depth) / 3;
    t.proj = pr;
  }
  tris.sort((a, b) => a.depth - b.depth);

  lastTris.length = 0;
  lastTris.push(...tris);
  const xt = xrayT.value;
  for (const t of tris) {
    const p = t.proj ?? [];
    if (p.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y);
    ctx.closePath();
    ctx.fillStyle = t.color;
    if (xt > 0.01 && t.cls === 'outer') {
      // 剖视：外壳半透明 + 线框（随过渡插值）
      ctx.globalAlpha = 1 - 0.87 * xt;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(170,215,255,${0.4 * xt})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (xt > 0.01 && t.cls === 'inner') {
      // 内部件：剖视下提亮并描边
      ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.75 * xt})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      const mat = xt <= 0.01 ? getPat(t.kind, ctx) : null;
      if (mat) {
        // 材质纹理叠加：先光照色打底，再半透明纹理（保留明暗与部件主色）
        ctx.fillStyle = t.color;
        ctx.fill();
        ctx.globalAlpha = MAT_MAP[t.kind]?.a ?? 0.3;
        ctx.fillStyle = mat;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = t.color;
        ctx.fill();
      }
      if (t.selected) {
        ctx.strokeStyle = '#ff9f0a';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,159,10,0.8)';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }

  // CG / CP 位置标记（竖版侧面竖线；横版顶部垂线）
  const c = ctx;
  const marks: { x: number; y: number; kind: string; z: number }[] = [];
  const mk = (z: number, color: string, label: string) => {
    if (!(z >= 0 && z <= maxZ)) return;
    const ax = axPos3(z);
    const perp = isH.value ? cyp - maxR.value * unit - 18 : cxp + (maxR.value * unit + 14);
    if (isH.value) marks.push({ x: ax, y: perp, kind: label, z });
    else marks.push({ x: perp, y: ax, kind: label, z });
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.setLineDash([4, 3]);
    c.beginPath();
    if (isH.value) {
      c.moveTo(ax, cyp - maxR.value * unit - 4);
      c.lineTo(ax, cyp + maxR.value * unit + 10);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = color;
      c.beginPath();
      c.arc(ax, perp, 4.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = color;
      c.font = '600 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
      c.textAlign = 'center';
      c.fillText(`${label} ${z.toFixed(3)} m`, ax, perp - 8);
    } else {
      c.moveTo(perp, ax);
      c.lineTo(perp, baseY + maxZ * unit + 10);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = color;
      c.beginPath();
      c.arc(perp, ax, 4.5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 1.5;
      c.stroke();
      c.fillStyle = color;
      c.font = '600 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
      c.textAlign = perp > cxp ? 'left' : 'right';
      c.fillText(`${label} ${z.toFixed(3)} m`, perp + (perp > cxp ? 10 : -10), ax + 4);
    }
  };
  if (props.cgX !== null && props.cgX !== undefined) mk(props.cgX, '#34c759', 'CG');
  if (props.cpX !== null && props.cpX !== undefined) mk(props.cpX, '#ff3b30', 'CP');
  markSpots.value = marks;

  // Z 轴刻度尺（竖版中心线垂直+右侧小字；横版中心线水平+下方小字）
  c.strokeStyle = 'rgba(210,232,255,0.3)';
  c.lineWidth = 1;
  c.font = '400 10px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const z = (maxZ * i) / ticks;
    const ap = axPos3(z);
    if (isH.value) {
      c.beginPath();
      c.moveTo(ap, cyp - 5);
      c.lineTo(ap, cyp + 5);
      c.stroke();
      c.fillStyle = 'rgba(210,232,255,0.55)';
      c.textAlign = 'center';
      c.fillText(z.toFixed(2), ap, cyp + 16);
    } else {
      c.beginPath();
      c.moveTo(cxp - 5, ap);
      c.lineTo(cxp + 5, ap);
      c.stroke();
      c.fillStyle = 'rgba(210,232,255,0.55)';
      c.textAlign = 'left';
      c.fillText(z.toFixed(2), cxp + 9, ap + 3);
    }
  }
  c.fillStyle = 'rgba(210,232,255,0.6)';
  c.font = '500 10px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  if (isH.value) {
    c.textAlign = 'left';
    c.fillText('Z（轴向）→', cxp - maxZ * unit * 0.5, cyp + 32);
  } else {
    c.textAlign = 'left';
    c.fillText('Z（轴向）', cxp + 9, baseY + maxZ * unit + 14);
  }

  // XYZ 轴指示器（左下角罗盘，随视角旋转）
  const ox = 52, oy = h - 62;
  const axisVec = (vx: number, vy: number, vz: number) => {
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const c2 = Math.cos(tilt), s2 = Math.sin(tilt);
    const x1 = vx * cos - vy * sin;
    const y1 = vx * sin + vy * cos;
    const y2 = y1 * c2 - vz * s2;
    return { ex: ox + x1 * 32, ey: oy - y2 * 32 };
  };
  const axisDraw = (vx: number, vy: number, vz: number, color: string, label: string) => {
    const { ex, ey } = axisVec(vx, vy, vz);
    c.strokeStyle = color;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(ox, oy);
    c.lineTo(ex, ey);
    c.stroke();
    const ang = Math.atan2(ey - oy, ex - ox);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(ex, ey);
    c.lineTo(ex - 9 * Math.cos(ang - 0.38), ey - 9 * Math.sin(ang - 0.38));
    c.lineTo(ex - 9 * Math.cos(ang + 0.38), ey - 9 * Math.sin(ang + 0.38));
    c.closePath();
    c.fill();
    c.font = '600 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
    c.textAlign = 'left';
    c.fillText(label, ex + 5, ey + 4);
  };
  axisDraw(1, 0, 0, '#ff453a', 'X');
  axisDraw(0, 1, 0, '#32d74b', 'Y');
  axisDraw(0, 0, 1, '#0a84ff', 'Z');
  c.fillStyle = 'rgba(210,232,255,0.45)';
  c.font = '400 9px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  c.textAlign = 'center';
  c.fillText('参考系', ox, oy + 18);

  // 尺寸标注：总长 + 最大直径（竖版在底部；横版在顶部）
  ctx.fillStyle = 'rgba(210,228,255,0.9)';
  ctx.font = '500 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  if (isH.value) {
    const tipY = cyp - maxR.value * unit - 40;
    ctx.fillText(`⏤ ${maxZ.toFixed(3)} m`, cxp - maxZ * unit * 0.5, tipY);
    ctx.strokeStyle = 'rgba(210,228,255,0.4)';
    ctx.lineWidth = 1;
    const diaX = cxp + maxZ * unit * 0.5 + 16;
    const diaY = maxR.value * unit;
    ctx.beginPath();
    ctx.moveTo(diaX, cyp - diaY); ctx.lineTo(diaX, cyp + diaY);
    ctx.moveTo(diaX - 4, cyp - diaY); ctx.lineTo(diaX + 4, cyp - diaY);
    ctx.moveTo(diaX - 4, cyp + diaY); ctx.lineTo(diaX + 4, cyp + diaY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,228,255,0.75)';
    ctx.fillText(`⌀ ${(maxR.value * 2 * 1000).toFixed(0)} mm`, diaX + 8, cyp);
  } else {
    const tipY = baseY + maxZ * unit + 6;
    ctx.fillText(`⏤ ${maxZ.toFixed(3)} m`, cxp + maxR.value * unit + 14, tipY + 4);
    ctx.strokeStyle = 'rgba(210,228,255,0.4)';
    ctx.lineWidth = 1;
    const diaY = baseY + maxZ * unit + 22;
    const diaX = maxR.value * unit + 10;
    ctx.beginPath();
    ctx.moveTo(cxp - diaX, diaY); ctx.lineTo(cxp + diaX, diaY);
    ctx.moveTo(cxp - diaX, diaY - 4); ctx.lineTo(cxp - diaX, diaY + 4);
    ctx.moveTo(cxp + diaX, diaY - 4); ctx.lineTo(cxp + diaX, diaY + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,228,255,0.75)';
    ctx.fillText(`⌀ ${(maxR.value * 2 * 1000).toFixed(0)} mm`, cxp + diaX + 8, diaY + 3);
  }

  // 底部状态行
  ctx.fillStyle = 'rgba(210,228,255,0.55)';
  ctx.font = '400 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hoverName.value || (xrayT.value > 0.5 ? '剖视模式 · 拖拽旋转 · 滚轮缩放' : '拖拽旋转 · 滚轮缩放'), w / 2, h - 8);
}

function onDown(e: MouseEvent): void {
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
}
function onMove(e: MouseEvent): void {
  if (dragging) {
    rotY += (e.clientX - lastX) * 0.009;
    tilt = Math.min(Math.max(tilt + (e.clientY - lastY) * 0.004, 0.05), 1.35);
    lastX = e.clientX; lastY = e.clientY;
    return;
  }
  // 悬停拾取：点在投影三角形内且深度最前
  const cv = canvas.value;
  if (!cv) return;
  const rect = cv.getBoundingClientRect();
  const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
  if (hit !== lastHover) {
    lastHover = hit;
    hoverName.value = hit ? hit.name : '';
    emit('hover', hit);
  }
}

function pickAt(mx: number, my: number): RocketComponent | null {
  let best: RocketComponent | null = null;
  let bestD = -Infinity;
  for (const t of lastTris) {
    const p = t.proj;
    if (!p || p.length < 3) continue;
    const d1 = (mx - p[1].x) * (p[0].y - p[1].y) - (p[0].x - p[1].x) * (my - p[1].y);
    const d2 = (mx - p[2].x) * (p[1].y - p[2].y) - (p[1].x - p[2].x) * (my - p[2].y);
    const d3 = (mx - p[0].x) * (p[2].y - p[0].y) - (p[2].x - p[0].x) * (my - p[0].y);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (neg && pos) continue;
    if (t.depth > bestD) { bestD = t.depth; best = t.comp; }
  }
  return best;
}

function onCanvasClick(e: MouseEvent): void {
  const cv = canvas.value;
  if (!cv) return;
  const rect = cv.getBoundingClientRect();
  const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
  if (hit) emit('pick', hit);
}

function getObj(): string {
  const tris = buildTris();
  const verts: number[][] = [];
  const faces: number[][] = [];
  for (const t of tris) {
    const idx = t.pts.map((pt) => {
      let i = verts.findIndex(
        (v) => Math.abs(v[0] - pt[0]) < 1e-6 && Math.abs(v[1] - pt[1]) < 1e-6 && Math.abs(v[2] - pt[2]) < 1e-6,
      );
      if (i < 0) {
        verts.push([pt[0], pt[1], pt[2]]);
        i = verts.length - 1;
      }
      return i + 1;
    });
    faces.push([idx[0], idx[1], idx[2]]);
  }
  let out = '# OpenRocket Web 3D 网格导出\n# 顶点 v x y z（z=0 鼻尖，z 增大向尾部）\n';
  for (const v of verts) out += `v ${v[0].toFixed(6)} ${v[1].toFixed(6)} ${v[2].toFixed(6)}\n`;
  for (const f of faces) out += `f ${f[0]} ${f[1]} ${f[2]}\n`;
  return out;
}
defineExpose({ getObj });
function onUp(): void { dragging = false; }
function onLeave(): void {
  if (lastHover) {
    lastHover = null;
    hoverName.value = '';
    emit('hover', null);
  }
}
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  scale *= e.deltaY > 0 ? 0.88 : 1.12;
  scale = Math.min(Math.max(scale, 0.25), 5);
}

function loop(): void {
  const cur = xrayT.value;
  const next = cur + ((xrayTarget.value ? 1 : 0) - cur) * 0.14;
  xrayT.value = Math.abs(next - cur) < 0.002 ? (xrayTarget.value ? 1 : 0) : next;
  draw();
  raf = requestAnimationFrame(loop);
}

watch(() => [props.root, props.selected] as const, () => { if (!raf) loop(); }, { deep: true });

onMounted(() => {
  const cv = canvas.value;
  if (!cv) return;
  ctx = cv.getContext('2d');
  cv.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('mouseleave', onLeave);
  cv.addEventListener('click', onCanvasClick);
  loop();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  raf = 0;
  const cv = canvas.value;
  cv?.removeEventListener('mousedown', onDown);
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', onUp);
  cv?.removeEventListener('wheel', onWheel);
  cv?.removeEventListener('mouseleave', onLeave);
  cv?.removeEventListener('click', onCanvasClick);
});
</script>

<template>
  <div class="view3d">
    <canvas ref="canvas" class="cv" @mousemove="onCvMove" @mouseleave="markTip = null" />
    <div v-if="markTip" class="mark-tip3d" :style="{ left: markTip.x + 14 + 'px', top: markTip.y + 10 + 'px' }">{{ markTip.text }}</div>
    <div class="xray-seg seg">
      <button :class="{ on: !xrayTarget }" @click="xrayTarget = false">实体</button>
      <button :class="{ on: xrayTarget }" @click="xrayTarget = true">剖视</button>
    </div>
    <div class="view-preset seg">
      <button
        v-for="(v, k) in VIEW_PRESETS"
        :key="k"
        :class="{ on: viewPreset === k }"
        :title="v.label"
        @click="setViewPreset(k as 'iso' | 'front' | 'side' | 'top')"
      >{{ v.label }}</button>
    </div>
  </div>
</template>

<style scoped>
.view3d {
  position: relative;
  display: flex;
  background: linear-gradient(180deg, #0a2b66, #071a45);
  border: 1px solid #123a7a;
  overflow: hidden;
  min-height: 0;
  height: 100%;
  box-shadow: inset 0 0 40px rgba(10, 132, 255, 0.08);
}
.cv {
  display: block;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  cursor: grab;
  touch-action: none;
}
.cv:active {
  cursor: grabbing;
}
.xray-seg {
  position: absolute; top: 10px; right: 10px; z-index: 3;
}
.mark-tip3d {
  position: absolute;
  z-index: 5;
  pointer-events: none;
  max-width: 280px;
  padding: 6px 10px;
  background: rgba(6, 20, 45, 0.94);
  border: 1px solid #1d4a99;
  border-radius: 4px;
  color: #dcecff;
  font-size: 11px;
  line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}
.view-preset {
  position: absolute; bottom: 10px; left: 10px; z-index: 3;
}
.xray-seg button {
  font: inherit; font-size: 12px; font-weight: 600; color: #cfe3ff;
  background: rgba(9, 32, 74, 0.82); border: 1px solid #1c4fa8; padding: 5px 12px; cursor: pointer;
  backdrop-filter: blur(8px); transition: all 0.15s ease;
}
.xray-seg button:first-child { border-radius: 7px 0 0 7px; border-right: 0; }
.xray-seg button:last-child { border-radius: 0 7px 7px 0; }
.xray-seg button.on { background: var(--primary); color: #fff; border-color: var(--primary); }
.xray-seg button:not(.on):hover { background: rgba(30, 82, 160, 0.6); }
</style>
