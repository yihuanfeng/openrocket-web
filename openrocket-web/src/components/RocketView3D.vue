<script setup lang="ts">
// 3D 视图 v2：Apple 标准材质渲染——金属高光 / 地面阴影 / 尺寸标注 / 部件高亮
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RocketComponent } from '../lib/types';
import { layoutRocket, type GeoSeg } from '../lib/geometry';
import { buildRocketFaces, type Tri3D } from '../lib/rocketFaces3d';

const { t } = useI18n();
const props = defineProps<{ root: RocketComponent; selected?: RocketComponent | null; cgX?: number | null; cpX?: number | null; orientation?: 'vertical' | 'horizontal' }>();
const emit = defineEmits<{ hover: [c: RocketComponent | null]; pick: [c: RocketComponent | null] }>();
const isH = computed(() => props.orientation === 'horizontal');

type Seg = GeoSeg;
type Tri = Tri3D;

/** 轴向段：统一几何布局（官方轴向语义 + 半径继承），2D/3D 共用同一几何 */
function buildSegs(root: RocketComponent): Seg[] {
  return layoutRocket(root);
}

const segs = computed(() => buildSegs(props.root));
const total = computed(() => Math.max(segs.value.reduce((m, s) => Math.max(m, s.z1), 0), 0.05));
const maxR = computed(() => Math.max(...segs.value.map((s) => Math.max(s.r0, s.r1)), 0.001));
// —— 3D 几何与材质 ——（三角面构建与材质配色统一在 src/lib/rocketFaces3d.ts，与回放共用）
function buildTris(): Tri[] {
  return buildRocketFaces(props.root, props.selected, segs.value);
}

/** 按倍率压暗/提亮 rgb 颜色（f<1 变暗，f>1 变亮） */
function scaleRGB(rgb: string, f: number): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  const clamp = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return `rgb(${clamp(Number(m[0]) * f)},${clamp(Number(m[1]) * f)},${clamp(Number(m[2]) * f)})`;
}

// —— 程序化表面材质（半透明纹理叠加在光照色上，保留明暗与部件主色）——
const PAT_DEFS: Record<string, (c: CanvasRenderingContext2D, s: number) => void> = {
  // 金属：宽水平亮带 + 细磨砂颗粒（大块质感，非细密线）
  metal(c, s) {
    c.fillStyle = 'rgba(255,255,255,0.20)';
    c.fillRect(0, 0, s, 10);
    c.fillStyle = 'rgba(255,255,255,0.10)';
    c.fillRect(0, 22, s, 6);
    c.fillStyle = 'rgba(0,0,0,0.16)';
    c.fillRect(0, 40, s, 8);
    // 颗粒噪点（少量圆点）
    c.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 6; i++) { c.beginPath(); c.arc((i * 13 + 5) % s, (i * 9 + 3) % s, 1.2, 0, Math.PI * 2); c.fill(); }
  },
  // 碳纤维：菱形编织格（粗交叉带 + 深色格底）
  carbon(c, s) {
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.fillRect(0, 0, s, s);
    c.strokeStyle = 'rgba(255,255,255,0.30)';
    c.lineWidth = 3;
    for (let i = -s; i < s * 2; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + s, s); c.stroke(); }
    c.strokeStyle = 'rgba(0,0,0,0.45)';
    for (let i = -s; i < s * 2; i += 16) { c.beginPath(); c.moveTo(i + 8, 0); c.lineTo(i + 8 + s, s); c.stroke(); }
  },
  // 布料：稀疏大方格缝线
  fabric(c, s) {
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 2;
    for (let i = 0; i <= s; i += 16) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, s); c.stroke();
      c.beginPath(); c.moveTo(0, i); c.lineTo(s, i); c.stroke();
    }
  },
  // 亮漆：宽高光带（模拟清漆光泽）
  gloss(c, s) {
    const g = c.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.40)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
    g.addColorStop(0.75, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  },
};
// 部件 → 材质 + 叠加透明度
const MAT_MAP: Record<string, { pat?: string; a: number }> = {
  nosecone: { pat: 'gloss', a: 0.42 },
  bodytube: { pat: 'gloss', a: 0.3 },
  transition: { pat: 'metal', a: 0.38 },
  trapezoidfinset: { pat: 'gloss', a: 0.28 },
  ellipticalfinset: { pat: 'gloss', a: 0.28 },
  freeformfinset: { pat: 'gloss', a: 0.28 },
  finset: { pat: 'gloss', a: 0.28 },
  tubefinset: { pat: 'metal', a: 0.34 },
  launchlug: { pat: 'metal', a: 0.22 },
  railbutton: { pat: 'metal', a: 0.22 },
  parachute: { pat: 'fabric', a: 0.5 },
  streamer: { pat: 'fabric', a: 0.5 },
  shockcord: { pat: 'fabric', a: 0.3 },
  masscomponent: { pat: 'metal', a: 0.32 },
  innertube: { pat: 'metal', a: 0.3 },
  enginemount: { pat: 'metal', a: 0.3 },
  engineblock: { pat: 'metal', a: 0.3 },
  tubecoupler: { pat: 'metal', a: 0.3 },
  bulkhead: { pat: 'metal', a: 0.3 },
  centeringring: { pat: 'metal', a: 0.3 },
  engine: { pat: 'metal', a: 0.4 },
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

// —— 交互状态 ——
const canvas = ref<HTMLCanvasElement | null>(null);
// —— CG/CP 标记悬浮说明 ——
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
    ? { x: mx, y: my, text: `${best.kind} ${best.z.toFixed(3)} m · ${best.kind === 'CG' ? t('view3d.markCG') : t('view3d.markCP')}` }
    : null;
}
const lastTris: Tri[] = [];
let ctx: CanvasRenderingContext2D | null = null;
let rotY = 0;
let tilt = 0.02;
let scale = 1;
let dragging = false;
let lastX = 0, lastY = 0;
let raf = 0;
const hoverName = ref('');
const xrayTarget = ref(false);

// —— P2：视角预设（等距 / 正视 / 侧视 / 顶视，300ms lerp 过渡）——
const VIEW_PRESETS = {
  iso: { rotY: 0.6, tilt: 0.38 },
  front: { rotY: 0, tilt: 1.42 },
  side: { rotY: 0, tilt: 0.02 },
  top: { rotY: Math.PI / 2, tilt: 1.42 },
} as const;
const viewPreset = ref<'iso' | 'front' | 'side' | 'top'>('side');
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

  // 背景：深蓝径向渐变（Apple 科技感）+ 底部柔光晕
  const g = ctx.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.55, Math.max(w, h) * 0.75);
  g.addColorStop(0, '#123a7a');
  g.addColorStop(0.55, '#0a2b66');
  g.addColorStop(1, '#071a45');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createRadialGradient(w * 0.5, h * 0.28, 0, w * 0.5, h * 0.28, Math.max(w, h) * 0.5);
  g2.addColorStop(0, 'rgba(90,150,255,0.16)');
  g2.addColorStop(1, 'rgba(90,150,255,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  const cxp = w / 2, cyp = h * 0.46;

  const tris = buildTris();
  const maxZ = total.value;
  // 比例适配：竖版轴向占高、径向占宽；横版轴向占宽、径向占高
  const unit = (isH.value
    ? Math.min(w * 0.62 / Math.max(maxZ, 0.05), h * 0.32 / Math.max(maxR.value * 2.2, 0.01))
    : Math.min(w * 0.36 / Math.max(maxR.value * 2.2, 0.01), h * 0.66 / Math.max(maxZ, 0.05))) * scale;
  // 竖版：z=0 鼻尖在顶部，主体垂直居中；横版：z=0 鼻尖在左，主体垂直居中
  const baseY = isH.value ? cyp : cyp - maxZ * unit * 0.5;

  // 变换 + 深度排序（轨道球：先绕竖直轴 yaw，再绕屏幕水平轴 pitch，任意方向自由旋转）
  // 投影后按包围盒居中——旋转锚点为火箭中心而非鼻尖
  const rawPts: Array<{ t: Tri; pr: { x: number; y: number; depth: number }[] }> = [];
  for (const t of tris) {
    const pr = t.pts.map(([x, y, z]) => {
      const cY = Math.cos(rotY), sY = Math.sin(rotY);
      const c2 = Math.cos(tilt), s2 = Math.sin(tilt);
      const x1 = x * cY + z * sY, z1 = -x * sY + z * cY; // 绕竖直轴（yaw）：x-z 平面
      const y2 = y * c2 - z1 * s2, z2 = y * s2 + z1 * c2; // 绕水平轴（pitch）：y-z 平面
      if (isH.value) {
        // 横版：旋转后轴向（z2）→ 屏幕 x（头朝左），半径 → 屏幕 y；深度取 x1（屏幕法线残余）
        return { x: z2 * unit, y: y2 * unit, depth: x1 };
      }
      // 竖版：yaw 后 x1 → 屏幕 x，轴向（z2）→ 屏幕 y；深度取 y2（视线残余）
      return { x: x1 * unit, y: z2 * unit, depth: y2 };
    });
    rawPts.push({ t, pr });
  }
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const { pr } of rawPts) {
    for (const p of pr) {
      if (p.x < bMinX) bMinX = p.x; if (p.x > bMaxX) bMaxX = p.x;
      if (p.y < bMinY) bMinY = p.y; if (p.y > bMaxY) bMaxY = p.y;
    }
  }
  const cy0 = isH.value ? cyp : baseY + maxZ * unit * 0.5; // 竖版目标中心：火箭全长中点
  const offX = cxp - (bMinX + bMaxX) / 2;
  const offY = cy0 - (bMinY + bMaxY) / 2;
  for (const { t, pr } of rawPts) {
    for (const p of pr) { p.x += offX; p.y += offY; }
    t.depth = (pr[0].depth + pr[1].depth + pr[2].depth) / 3;
    t.proj = pr;
  }
  const bounds = { minX: bMinX + offX, maxX: bMaxX + offX, minY: bMinY + offY, maxY: bMaxY + offY };
  tris.sort((a, b) => a.depth - b.depth);

  // 中心轴点投影（与主渲染同一矩阵 + 同一居中偏移）：供阴影/渐变/刻度/CG-CP 等随火箭跟随
  const projAxis = (z: number) => {
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const c2 = Math.cos(tilt), s2 = Math.sin(tilt);
    const x1 = z * sY, z1 = z * cY; // (0,0,z) 绕竖直轴
    const y2 = -z1 * s2, z2 = z1 * c2; // 绕水平轴
    if (isH.value) return { x: offX + z2 * unit, y: offY + y2 * unit };
    return { x: offX + x1 * unit, y: offY + z2 * unit };
  };

  // 地面阴影（贴旋转后火箭尾端，随火箭跟随；竖版在底部、横版在尾端）
  ctx.save();
  const shP = projAxis(maxZ);
  const shCX = isH.value ? shP.x + 8 : shP.x;
  const shCY = isH.value ? shP.y : shP.y + 8;
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
      // 轴向渐变：跨整个部件连续（前段提亮 → 后段压暗），沿旋转后中心轴投影（随火箭跟随，无箍线）
      const pa = projAxis(t.z0), pb = projAxis(t.z1);
      const g2 = ctx.createLinearGradient(pa.x, pa.y, pb.x, pb.y);
      g2.addColorStop(0, scaleRGB(t.color, 1.16));
      g2.addColorStop(0.5, t.color);
      g2.addColorStop(1, scaleRGB(t.color, 0.74));
      ctx.fillStyle = g2;
      ctx.fill();
      if (mat) {
        // 材质纹理叠加：半透明纹理盖在渐变上（保留明暗与部件主色）
        ctx.globalAlpha = MAT_MAP[t.kind]?.a ?? 0.3;
        ctx.fillStyle = mat;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (t.selected) {
        ctx.strokeStyle = '#ff9f0a';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(255,159,10,0.8)';
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // 实体模式无描边：表面完全平滑连续（不显示三角网格边界）
    }
  }

  // CG / CP 位置标记：中心轴上点随旋转矩阵投影（拖动视角时标记跟随火箭），标签引到侧旁避免遮挡
  const c = ctx;
  const marks: { x: number; y: number; kind: string; z: number }[] = [];
  const mk = (z: number, color: string, label: string) => {
    if (!(z >= 0 && z <= maxZ)) return;
    const p = projAxis(z);
    // 标签/圆点偏移方向：横版引向上方，竖版引向右侧，避免盖在火箭本体上
    const lx = isH.value ? p.x : p.x + maxR.value * unit + 14;
    const ly = isH.value ? p.y - maxR.value * unit - 14 : p.y;
    marks.push({ x: lx, y: ly, kind: label, z });
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.setLineDash([4, 3]);
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(lx, ly);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = color;
    c.beginPath();
    c.arc(lx, ly, 4.5, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = color;
    c.font = '600 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
    c.textAlign = isH.value ? 'center' : 'left';
    c.fillText(`${label} ${z.toFixed(3)} m`, lx + (isH.value ? 0 : 10), ly + (isH.value ? -8 : 4));
  };
  if (props.cgX !== null && props.cgX !== undefined) mk(props.cgX, '#34c759', 'CG');
  if (props.cpX !== null && props.cpX !== undefined) mk(props.cpX, '#ff3b30', 'CP');
  markSpots.value = marks;

  // Z 轴刻度尺：沿旋转后中心轴投影分布（随火箭旋转跟随），整体偏移到火箭表面外侧
  // （正交旋转 + 正交投影下，半径投影最大长度恒为 r·unit，与视角无关）
  const pHead = projAxis(0), pTail = projAxis(maxZ);
  const dX = pTail.x - pHead.x, dY = pTail.y - pHead.y;
  const axLen = Math.hypot(dX, dY);
  // 轴投影法向（刻度短线方向）；轴垂直于屏幕时退化为水平短线
  const nx = axLen > 0.001 ? -dY / axLen : (isH.value ? 0 : 1);
  const ny = axLen > 0.001 ? dX / axLen : 0;
  const rVis = maxR.value * unit + 10; // 旋转后可见最大半径 + 间隙
  c.strokeStyle = 'rgba(210,232,255,0.3)';
  c.lineWidth = 1;
  c.font = '400 10px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const z = (maxZ * i) / ticks;
    const p = projAxis(z);
    const cx = p.x + nx * rVis, cy = p.y + ny * rVis;
    c.beginPath();
    c.moveTo(cx - nx * 5, cy - ny * 5);
    c.lineTo(cx + nx * 5, cy + ny * 5);
    c.stroke();
    c.fillStyle = 'rgba(210,232,255,0.55)';
    c.textAlign = 'center';
    c.fillText(z.toFixed(2), cx + nx * 12, cy + ny * 12 + 4);
  }
  // Z 轴标签：跟随旋转后轴端点，同样偏移到表面外侧
  c.fillStyle = 'rgba(210,232,255,0.6)';
  c.font = '500 10px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  c.textAlign = 'left';
  c.fillText(t('view3d.axisZ') + (isH.value ? '→' : ''), pTail.x + nx * (rVis + 6) + 2, pTail.y + ny * (rVis + 6) + 4);

  // XYZ 轴指示器（左下角罗盘，随视角旋转；与主渲染同一轨道球矩阵）
  const ox = 52, oy = h - 62;
  const axisVec = (vx: number, vy: number, vz: number) => {
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const c2 = Math.cos(tilt), s2 = Math.sin(tilt);
    const x1 = vx * cY + vz * sY;
    const z1 = -vx * sY + vz * cY;
    const y2 = vy * c2 - z1 * s2;
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
  c.fillText(t('view3d.refFrame'), ox, oy + 18);

  // 尺寸标注：总长 + 最大直径（锚定旋转后包围盒边缘，随火箭视角跟随）
  ctx.fillStyle = 'rgba(210,228,255,0.9)';
  ctx.font = '500 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  ctx.textAlign = 'left';
  if (isH.value) {
    const tipY = bounds.minY - 14;
    ctx.fillText(`⏤ ${maxZ.toFixed(3)} m`, bounds.minX, tipY);
    ctx.strokeStyle = 'rgba(210,228,255,0.4)';
    ctx.lineWidth = 1;
    const diaX = bounds.maxX + 16;
    ctx.beginPath();
    ctx.moveTo(diaX, bounds.minY); ctx.lineTo(diaX, bounds.maxY);
    ctx.moveTo(diaX - 4, bounds.minY); ctx.lineTo(diaX + 4, bounds.minY);
    ctx.moveTo(diaX - 4, bounds.maxY); ctx.lineTo(diaX + 4, bounds.maxY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,228,255,0.75)';
    ctx.fillText(`⌀ ${(maxR.value * 2 * 1000).toFixed(0)} mm`, diaX + 8, (bounds.minY + bounds.maxY) / 2);
  } else {
    const tipX = bounds.maxX + 14;
    ctx.fillText(`⏤ ${maxZ.toFixed(3)} m`, tipX, bounds.maxY + 4);
    ctx.strokeStyle = 'rgba(210,228,255,0.4)';
    ctx.lineWidth = 1;
    const diaY = bounds.maxY + 22;
    ctx.beginPath();
    ctx.moveTo(bounds.minX, diaY); ctx.lineTo(bounds.maxX, diaY);
    ctx.moveTo(bounds.minX, diaY - 4); ctx.lineTo(bounds.minX, diaY + 4);
    ctx.moveTo(bounds.maxX, diaY - 4); ctx.lineTo(bounds.maxX, diaY + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(210,228,255,0.75)';
    ctx.fillText(`⌀ ${(maxR.value * 2 * 1000).toFixed(0)} mm`, bounds.maxX + 8, diaY + 3);
  }

  // 底部状态行
  ctx.fillStyle = 'rgba(210,228,255,0.55)';
  ctx.font = '400 11px -apple-system, "SF Pro Text", "PingFang SC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(hoverName.value || (xrayT.value > 0.5 ? t('view3d.hintCut') : t('view3d.hintDrag')), w / 2, h - 8);
}

let dragDist = 0; // 拖动累计距离：区分「旋转拖动」与「点击选中」

function onDown(e: MouseEvent): void {
  dragging = true;
  lastX = e.clientX; lastY = e.clientY;
  dragDist = 0;
}
function onMove(e: MouseEvent): void {
  if (dragging) {
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    dragDist += Math.abs(dx) + Math.abs(dy);
    // 轨道球：水平拖动绕竖直轴（转台方位），垂直拖动绕屏幕水平轴（俯仰）；自由环绕不钳制
    rotY += dx * 0.009;
    tilt += dy * 0.004;
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
  if (dragDist > 6) return; // 刚做过旋转拖动，忽略本次 click（避免误选中）
  const rect = cv.getBoundingClientRect();
  const hit = pickAt(e.clientX - rect.left, e.clientY - rect.top);
  // 点击组件选中；点击空白处取消选中
  emit('pick', hit);
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
      <button :class="{ on: !xrayTarget }" @click="xrayTarget = false">{{ t('view3d.solid') }}</button>
      <button :class="{ on: xrayTarget }" @click="xrayTarget = true">{{ t('view3d.cutaway') }}</button>
    </div>
    <div class="view-preset seg">
      <button
        v-for="(_, k) in VIEW_PRESETS"
        :key="k"
        :class="{ on: viewPreset === k }"
        :title="t('view3d.presets.' + k)"
        @click="setViewPreset(k as 'iso' | 'front' | 'side' | 'top')"
      >{{ t('view3d.presets.' + k) }}</button>
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
