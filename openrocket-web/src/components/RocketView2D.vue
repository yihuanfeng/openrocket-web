<script setup lang="ts">
// 2D 侧视图：支持横/竖两种摆放（竖=鼻锥朝上，横=鼻锥朝左），沿轴线渲染外形轮廓
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RocketComponent } from '../lib/types';
import { layoutRocket, type GeoSeg } from '../lib/geometry';

const { t } = useI18n();

const props = defineProps<{
  root: RocketComponent;
  selected?: RocketComponent | null;
  unitMode?: 'm' | 'mm' | 'cm';
  cgX?: number | null;
  cpX?: number | null;
  orientation?: 'vertical' | 'horizontal';
}>();
function fmtLen(vm: number): string {
  const u = props.unitMode ?? 'mm';
  const scaled = vm * (u === 'm' ? 1 : u === 'cm' ? 100 : 1000);
  return u === 'm' ? `${scaled.toFixed(3)} m` : u === 'cm' ? `${scaled.toFixed(1)} cm` : `${scaled.toFixed(0)} mm`;
}
const emit = defineEmits<{ hover: [c: RocketComponent | null]; pick: [c: RocketComponent]; change: [] }>();

const isH = computed(() => props.orientation === 'horizontal');

type Shape = GeoSeg;

/** 外形链：统一几何布局（官方轴向语义 + 半径继承） */
function buildShapes(root: RocketComponent): Shape[] {
  return layoutRocket(root);
}

const shapes = computed(() => buildShapes(props.root));

/** 视图范围（米）：并联级（xOff）纳入横向宽度 */
const view = computed(() => {
  let maxZ = 0, maxR = 0;
  for (const s of shapes.value) {
    maxZ = Math.max(maxZ, s.z1);
    maxR = Math.max(maxR, s.r0, s.r1, (s.xOff ?? 0) + s.r1);
  }
  const pad = maxR * 0.2 + 0.008;
  return { height: Math.max(maxZ, 0.05) + pad * 2, maxR, pad, length: maxZ };
});

/** 标尺区宽度（逻辑 px） */
const RULER = 34;
/** 像素密度：轴向全长映射为 420 逻辑像素；径向同比例 → 保持真实长径比 */
const PX = computed(() => 420 / Math.max(view.value.height, 0.05));
/** 逻辑宽度：横版=轴向全长；竖版=径向 + 两侧标尺/标注空间 */
const W = computed(() => Math.round(isH.value
  ? view.value.height * PX.value
  : view.value.maxR * 2 * PX.value + 2 * (RULER + 72),
));
/** 逻辑高度：竖版=轴向全长；横版=径向 + 两侧标注空间 */
const H = computed(() => Math.round(isH.value
  ? view.value.maxR * 2 * PX.value + 2 * 72
  : view.value.height * PX.value,
));

/** 轴向坐标：竖版 → y（z=0 鼻尖在顶部），横版 → x（z=0 鼻尖在左） */
function axPos(z: number): number {
  const pad = view.value.pad;
  if (isH.value) return (pad + z) / view.value.height * W.value;
  return (pad + z) / view.value.height * H.value;
}
/** 并联级侧向平移（SVG transform）：竖版 x 方向，横版 y 方向 */
function xOffT(s: Shape): string {
  const xo = (s.xOff ?? 0) * PX.value;
  if (!xo) return '';
  return isH.value ? `translate(0 ${xo.toFixed(1)})` : `translate(${xo.toFixed(1)} 0)`;
}
/** 半径坐标（中心线单侧，真实比例）：竖版 → x，横版 → y */
function radPos(r: number): number {
  const px = r * PX.value;
  if (isH.value) return H.value / 2 + px;
  return W.value / 2 + px;
}
/** 中心线坐标 */
function midLine(): number {
  return isH.value ? H.value / 2 : W.value / 2;
}

/** 点映射：(轴向 a, 径向 r) → 屏幕坐标；竖版 X=径向/Y=轴向，横版 X=轴向/Y=径向 */
function pt(a: number, r: number): string {
  const c = midLine() + r;
  return isH.value ? `${a.toFixed(1)} ${c.toFixed(1)}` : `${c.toFixed(1)} ${a.toFixed(1)}`;
}

/** 组件轮廓（中心线一侧；另一侧由镜像渲染） */
function shapePath(s: Shape): string {
  const a0 = axPos(s.z0), a1 = axPos(s.z1);
  const mid = midLine();
  const r0 = radPos(s.r0) - mid, r1 = radPos(s.r1) - mid;
  switch (s.kind) {
    case 'nosecone': {
      // 鼻锥：尖端在鼻端（a0），基部在后（a1，r1=基部半径）
      const shape = String(s.comp.properties?.['shape'] ?? 'ogive').toLowerCase();
      if (shape === 'conical') {
        return `M ${pt(a0, 0)} L ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
      }
      return `M ${pt(a0, 0)} Q ${pt((a0 + a1) / 2, r1 * 0.55)} ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
    }
    case 'transition':
      return `M ${pt(a0, 0)} L ${pt(a0, r0)} L ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
    case 'finset':
    case 'fintab':
    case 'trapezoidfinset':
    case 'ellipticalfinset':
    case 'freeformfinset':
      return finPath(s, a0, a1);
    case 'launchlug':
    case 'railbutton':
      return `M ${pt(a0, r0)} L ${pt(a1, r0)} L ${pt((a0 + a1) / 2, r0 * 1.6)} Z`;
    case 'tubefinset':
      return tubeFinPath(s, a0, a1);
    case 'parachute':
    case 'streamer':
      // 收纳伞包：小型伞形
      return `M ${pt(a0, 0)} L ${pt(a0, r0)} L ${pt((a0 + a1) / 2, r1 * 1.4)} L ${pt(a1, r0)} L ${pt(a1, 0)} Z`;
    default:
      return `M ${pt(a0, 0)} L ${pt(a0, r0)} L ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
  }
}

/** 尾翼板（按类型绘制：梯形/椭圆/自由），根弦 = z1-z0，高 = height；径向按真实比例 */
function finPath(s: Shape, a0: number, a1: number): string {
  const h = parseFloat(s.comp.properties['height'] ?? '') || 0.05;
  const r0 = radPos(s.r0) - midLine();
  const hPx = h * PX.value;
  const rootc = Math.max(s.z1 - s.z0, 0.001);

  // 椭圆尾翼：根弦 + 半椭圆翼尖（前后缘为椭圆曲线，OpenRocket EllipticalFinSet 外形）
  if (s.kind === 'ellipticalfinset') {
    const q = (t: number, fr: number) => pt(a0 + t * (a1 - a0), r0 + hPx * fr);
    return `M ${pt(a0, r0)} Q ${q(0.2, 0.55)} ${q(0.5, 1)} Q ${q(0.8, 0.55)} ${pt(a1, r0)} Z`;
  }

  // 自由尾翼：points 点序列（官方 FreeformFinSet 相对坐标 x,y，x 沿弦向 0..1，y 沿翼高 0..1）；
  // 无 points 时用默认剪式翼形
  if (s.kind === 'freeformfinset') {
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
    const d = pts.map(([fx, fr], i) => `${i === 0 ? 'M' : 'L'} ${pt(a0 + fx * (a1 - a0), r0 + hPx * Math.min(Math.max(fr, 0), 1.5))}`).join(' ');
    return `${d} Z`;
  }

  // 梯形尾翼（默认）：根弦、尖弦、后掠
  const tipc = parseFloat(s.comp.properties['tipchord'] ?? '');
  const tipcPx = (Number.isFinite(tipc) && tipc > 0 ? tipc / rootc : 1) * (a1 - a0);
  const sweep = parseFloat(s.comp.properties['sweep'] ?? '');
  const sweepPx = (Number.isFinite(sweep) && sweep > 0 ? sweep : rootc * 0.4) * PX.value;
  const tipStart = a0 + Math.min(sweepPx, (a1 - a0) * 0.7);
  const tipEnd = tipStart + tipcPx;
  // 梯形翼：翼根[根前 a0, 根后 a1]，翼尖[尖前 tipStart, 尖后 tipEnd]，高 hPx
  return `M ${pt(a0, r0)} L ${pt(tipStart, r0 + hPx)} L ${pt(Math.min(tipEnd, a1), r0 + hPx)} L ${pt(a1, r0)} Z`;
}

/** 管翼（侧视：上下两根小管轮廓，代表环绕管组） */
function tubeFinPath(s: Shape, a0: number, a1: number): string {
  const tR = radPos(s.r1) - midLine(); // 小管半径 px
  const outer = radPos(s.r1 * 2) - midLine(); // 管中心 ≈ bodyR + tubeR（6 管相切）
  return `M ${pt(a0, outer - tR)} L ${pt(a1, outer - tR)} L ${pt(a1, outer + tR)} L ${pt(a0, outer + tR)} Z`;
}

const isInner = (s: Shape) => ['innertube', 'enginemount', 'engineblock', 'tubecoupler', 'bulkhead', 'centeringring'].includes(s.kind);

// —— 悬浮信息 ——
const hoverTip = ref<{ x: number; y: number; text: string } | null>(null);
function onHoverMove(e: MouseEvent, s: Shape): void {
  const svg = svgRef.value;
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const len = (s.z1 - s.z0);
  let kindName = t('compTypes.' + s.kind);
  if (kindName.startsWith('compTypes.')) kindName = s.kind;
  const parts = [`${s.name}（${kindName}）`];
  if (len > 0) parts.push(`${t('view2d.tipLen')} ${fmtLen(len)}`);
  const maxR = Math.max(s.r0, s.r1);
  if (maxR > 0) parts.push(`${t('view2d.tipDia')} ${fmtLen(maxR * 2)}`);
  if (s.kind === 'parachute' && s.comp.properties?.['deployAlt'] !== undefined) parts.push(`${t('view2d.tipDeploy')} ${s.comp.properties['deployAlt'] === '0' ? t('view2d.apogee') : s.comp.properties['deployAlt'] + ' m'}`);
  if ((s.kind === 'parachute' || s.kind === 'streamer') && parseFloat(s.comp.properties?.['diameter'] ?? '0') > 0) parts.push(`${t('view2d.tipChute')} ${fmtLen(parseFloat(s.comp.properties['diameter'] ?? '0'))}`);
  if (s.kind === 'innertube' && s.comp.properties?.['motorId']) parts.push(`${t('view2d.tipMotor')} ${s.comp.properties['motorId']}`);
  hoverTip.value = { x: e.clientX - r.left, y: e.clientY - r.top, text: parts.join(' · ') };
}
function clearHoverTip(): void { hoverTip.value = null; }

// —— CG / CP 标记悬浮说明 ——
function onMarkMove(e: MouseEvent, kind: 'CG' | 'CP', z: number): void {
  const svg = svgRef.value;
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const tip = kind === 'CG' ? t('view2d.markCG') : t('view2d.markCP');
  hoverTip.value = { x: e.clientX - r.left, y: e.clientY - r.top, text: `${kind} ${z.toFixed(3)} m · ${tip}` };
}
const xray = ref(false);
const svgRef = ref<SVGSVGElement | null>(null);

function getSvg(): string {
  return svgRef.value ? svgRef.value.outerHTML : '';
}
defineExpose({ getSvg });

// —— 拖拽轴向调整（竖版纵向拖，横版横向拖）——
const DRAGGABLE = ['nosecone', 'bodytube', 'transition', 'innertube', 'launchlug', 'parachute'];
function canDrag(s: Shape): boolean {
  return DRAGGABLE.includes(s.kind);
}
let drag: { comp: RocketComponent; start: number; startOff: number } | null = null;
function onShapeDown(e: MouseEvent, s: Shape): void {
  if (!canDrag(s)) return;
  e.preventDefault();
  drag = {
    comp: s.comp,
    start: isH.value ? e.clientX : e.clientY,
    startOff: isNaN(s.comp.axialOffset) ? 0 : s.comp.axialOffset,
  };
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragUp);
}
function onDragMove(e: MouseEvent): void {
  if (!drag) return;
  const d = isH.value ? e.clientX - drag.start : e.clientY - drag.start;
  const axisLen = isH.value ? W.value : H.value;
  const dz = (d / axisLen) / scale.value * view.value.height;
  // 拖拽语义 = 相对父组件前端的偏移（允许负值，与官方 top 定位一致）
  drag.comp.axialMethod = 'top';
  drag.comp.axialOffset = drag.startOff + dz;
}
function onDragUp(): void {
  if (!drag) return;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragUp);
  drag = null;
  emit('change');
}

// —— 缩放平移（viewBox 动态窗口）——
const scale = ref(1);
const vx = ref(0);
const vy = ref(0);
const MIN_S = 0.4, MAX_S = 8;

function windowBox(): string {
  return `${vx.value.toFixed(1)} ${vy.value.toFixed(1)} ${(W.value / scale.value).toFixed(1)} ${(H.value / scale.value).toFixed(1)}`;
}
function resetView(): void { scale.value = 1; vx.value = 0; vy.value = 0; }

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * W.value;
  const sy = ((e.clientY - rect.top) / rect.height) * H.value;
  const vbx = vx.value + sx / scale.value;
  const vby = vy.value + sy / scale.value;
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const ns = Math.min(MAX_S, Math.max(MIN_S, scale.value * f));
  vx.value = vbx - sx / ns;
  vy.value = vby - sy / ns;
  scale.value = ns;
}

let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
function onBgDown(e: MouseEvent): void {
  pan = { sx: e.clientX, sy: e.clientY, vx: vx.value, vy: vy.value };
  window.addEventListener('mousemove', onPanMove);
  window.addEventListener('mouseup', onPanUp);
}
function onPanMove(e: MouseEvent): void {
  if (!pan) return;
  vx.value = pan.vx - (e.clientX - pan.sx) / scale.value;
  vy.value = pan.vy - (e.clientY - pan.sy) / scale.value;
}
function onPanUp(): void {
  pan = null;
  window.removeEventListener('mousemove', onPanMove);
  window.removeEventListener('mouseup', onPanUp);
}

// —— 轴向测量标尺：竖版左侧竖尺，横版底部横尺 ——
function rulerMarks(): { p: number; label: string }[] {
  const h = view.value.height;
  if (h <= 0) return [];
  const target = (38 / (isH.value ? W.value : H.value)) * h;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const cands = [mag, 2 * mag, 5 * mag, 10 * mag];
  const step = cands.find((c) => c >= target) ?? cands[cands.length - 1];
  const out: { p: number; label: string }[] = [];
  for (let z = 0; z <= h + 1e-9; z += step) {
    out.push({ p: axPos(z), label: step >= 1 ? z.toFixed(1) : (z * 100).toFixed(0) });
  }
  return out;
}
const unitLabel = computed(() => (view.value.height >= 1 ? 'm' : 'cm'));
const marks = computed(() => rulerMarks());
</script>

<template>
  <div class="view2d">
    <div class="xray2d seg">
      <button :class="{ on: !xray }" @click="xray = false">{{ t('view2d.solid') }}</button>
      <button :class="{ on: xray }" @click="xray = true">{{ t('view2d.cutaway') }}</button>
      <button class="fit" title="复位视图（1:1 全览）" @click="resetView">{{ t('view2d.reset') }}</button>
    </div>
    <svg ref="svgRef" :viewBox="windowBox()" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" @wheel.prevent="onWheel">
      <defs>
        <pattern id="grid2d" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M 16 0 L 0 0 0 16" fill="none" stroke="rgba(125,185,255,0.10)" stroke-width="1" />
        </pattern>
        <linearGradient id="bodyFill2d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5db2ff" />
          <stop offset="100%" stop-color="#0a84ff" />
        </linearGradient>
        <linearGradient id="innerFill2d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#7db9ff" />
          <stop offset="100%" stop-color="#3395ff" />
        </linearGradient>
        <linearGradient id="finFill2d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0a84ff" />
          <stop offset="100%" stop-color="#005bb5" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" :width="W" :height="H" fill="url(#grid2d)" class="bg-pan" @mousedown.self="onBgDown" />
      <!-- 轴向测量标尺 -->
      <g v-if="!isH" class="ruler">
        <line :x1="RULER / 2" :y1="axPos(0)" :x2="RULER / 2" :y2="axPos(view.height)" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
        <template v-for="t in marks" :key="'t' + t.p">
          <line :x1="RULER / 2 - 5" :x2="RULER / 2" :y1="t.p" :y2="t.p" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
          <text :x="3" :y="t.p + 3" fill="rgba(180,210,245,0.85)" font-size="9">{{ t.label }}</text>
        </template>
        <text :x="3" :y="axPos(0) - 4" fill="rgba(180,210,245,0.85)" font-size="9" font-weight="700">{{ unitLabel }}</text>
      </g>
      <g v-else class="ruler ruler-h">
        <line :x1="axPos(0)" :y1="H - RULER / 2" :x2="axPos(view.height)" :y2="H - RULER / 2" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
        <template v-for="t in marks" :key="'t' + t.p">
          <line :x1="t.p" :y1="H - RULER / 2 - 5" :x2="t.p" :y2="H - RULER / 2" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
          <text :x="t.p + 2" :y="H - RULER / 2 + 12" fill="rgba(180,210,245,0.85)" font-size="9" text-anchor="middle">{{ t.label }}</text>
        </template>
        <text :x="axPos(view.height) + 4" :y="H - RULER / 2 + 12" fill="rgba(180,210,245,0.85)" font-size="9" font-weight="700">{{ unitLabel }}</text>
      </g>
      <!-- 中心线 -->
      <line v-if="!isH" :x1="W / 2" :y1="8" :x2="W / 2" :y2="H - 24" stroke="rgba(160,205,255,0.45)" stroke-dasharray="6 5" stroke-width="1" />
      <line v-else :x1="8" :y1="H / 2" :x2="W - RULER - 8" :y2="H / 2" stroke="rgba(160,205,255,0.45)" stroke-dasharray="6 5" stroke-width="1" />
      <g v-for="(s, i) in shapes" :key="i" :transform="xOffT(s)">
        <!-- 一侧 -->
        <path
          :d="shapePath(s)"
          :fill="s.kind.includes('fin') ? 'url(#finFill2d)' : isInner(s) ? 'url(#innerFill2d)' : 'url(#bodyFill2d)'"
          :stroke="s.comp === props.selected ? '#ff7a00' : 'var(--primary-strong)'"
          :stroke-width="s.comp === props.selected ? 2.4 : 1"
          :opacity="xray && !isInner(s) ? 0.16 : 0.95"
          :class="{ draggable: canDrag(s) }"
          @mouseenter="emit('hover', s.comp)"
          @mousemove="onHoverMove($event, s)"
          @mouseleave="emit('hover', null); clearHoverTip()"
          @mousedown.prevent="onShapeDown($event, s)"
          @click="emit('pick', s.comp)"
        />
        <!-- 另一侧镜像：竖版左右镜像，横版上下镜像 -->
        <path
          v-if="!isH"
          :d="shapePath(s)"
          :transform="'translate(' + W + ', 0) scale(-1, 1)'"
          :fill="s.kind.includes('fin') ? 'url(#finFill2d)' : isInner(s) ? 'url(#innerFill2d)' : 'url(#bodyFill2d)'"
          :opacity="xray && !isInner(s) ? 0.06 : 0.35"
          @mouseenter="emit('hover', s.comp)"
          @mouseleave="emit('hover', null)"
          @click="emit('pick', s.comp)"
        />
        <path
          v-else
          :d="shapePath(s)"
          :transform="'translate(0,' + H + ') scale(1, -1)'"
          :fill="s.kind.includes('fin') ? 'url(#finFill2d)' : isInner(s) ? 'url(#innerFill2d)' : 'url(#bodyFill2d)'"
          :opacity="xray && !isInner(s) ? 0.06 : 0.35"
          @mouseenter="emit('hover', s.comp)"
          @mouseleave="emit('hover', null)"
          @click="emit('pick', s.comp)"
        />
        <title>{{ s.name }}</title>
      </g>
      <!-- CG / CP 位置标记 -->
      <template v-if="!isH">
        <g v-if="props.cgX !== null && props.cgX !== undefined" @mousemove="onMarkMove($event, 'CG', props.cgX)" @mouseleave="clearHoverTip">
          <line :x1="W / 2 + 14" :x2="W / 2 + 46" :y1="axPos(props.cgX)" :y2="axPos(props.cgX)" stroke="#34c759" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="W / 2 + 50" :cy="axPos(props.cgX)" r="4.5" fill="#34c759" stroke="#fff" stroke-width="1.5" />
          <text :x="W / 2 + 60" :y="axPos(props.cgX) + 4" fill="#5ee08a" font-size="11" font-weight="700">CG {{ props.cgX.toFixed(3) }} m</text>
        </g>
        <g v-if="props.cpX !== null && props.cpX !== undefined" @mousemove="onMarkMove($event, 'CP', props.cpX)" @mouseleave="clearHoverTip">
          <line :x1="W / 2 - 14" :x2="W / 2 - 46" :y1="axPos(props.cpX)" :y2="axPos(props.cpX)" stroke="#ff3b30" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="W / 2 - 50" :cy="axPos(props.cpX)" r="4.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5" />
          <text :x="W / 2 - 60" :y="axPos(props.cpX) + 4" fill="#ff8f87" font-size="11" font-weight="700" text-anchor="end">CP {{ props.cpX.toFixed(3) }} m</text>
        </g>
      </template>
      <template v-else>
        <g v-if="props.cgX !== null && props.cgX !== undefined" @mousemove="onMarkMove($event, 'CG', props.cgX)" @mouseleave="clearHoverTip">
          <line :x1="axPos(props.cgX)" :y1="H / 2 - 14" :x2="axPos(props.cgX)" :y2="H / 2 - 46" stroke="#34c759" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="axPos(props.cgX)" :cy="H / 2 - 50" r="4.5" fill="#34c759" stroke="#fff" stroke-width="1.5" />
          <text :x="axPos(props.cgX) + 6" :y="H / 2 - 56" fill="#5ee08a" font-size="11" font-weight="700">CG {{ props.cgX.toFixed(3) }} m</text>
        </g>
        <g v-if="props.cpX !== null && props.cpX !== undefined" @mousemove="onMarkMove($event, 'CP', props.cpX)" @mouseleave="clearHoverTip">
          <line :x1="axPos(props.cpX)" :y1="H / 2 + 14" :x2="axPos(props.cpX)" :y2="H / 2 + 46" stroke="#ff3b30" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="axPos(props.cpX)" :cy="H / 2 + 50" r="4.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5" />
          <text :x="axPos(props.cpX) + 6" :y="H / 2 + 60" fill="#ff8f87" font-size="11" font-weight="700">CP {{ props.cpX.toFixed(3) }} m</text>
        </g>
      </template>
      <text v-if="view.height > 0.05" :x="isH ? W - RULER - 4 : W / 2 + 24" :y="isH ? H / 2 + 22 : H - 10" fill="rgba(190,215,245,0.85)" font-size="10" :text-anchor="isH ? 'end' : 'start'">{{ t('view2d.info', { len: fmtLen(view.length), orient: isH ? t('view2d.orientLeft') : t('view2d.orientUp'), scale: scale.toFixed(1) }) }}</text>
    </svg>
    <div v-if="hoverTip" class="hover-tip2d" :style="{ left: hoverTip.x + 14 + 'px', top: hoverTip.y + 10 + 'px' }">
      {{ hoverTip.text }}
    </div>
  </div>
</template>

<style scoped>
.view2d {
  position: relative;
  display: flex; flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg, #0a2b66 0%, #071a45 100%);
  border: 1px solid #123a7a;
  padding: 10px 12px;
  min-height: 0;
  overflow: hidden;
  box-shadow: inset 0 0 40px rgba(10, 132, 255, 0.08);
}
.view2d svg { flex: 1; min-height: 0; }
.xray2d {
  position: absolute; top: 10px; right: 10px; z-index: 3;
}
.xray2d button {
  font: inherit; font-size: 12px; font-weight: 600; color: #cfe3ff;
  background: rgba(9, 32, 74, 0.82); border: 1px solid #1c4fa8; padding: 4px 12px; cursor: pointer;
  box-shadow: none; transition: all 0.15s ease; backdrop-filter: blur(8px);
}
.xray2d button:first-child { border-radius: 7px 0 0 7px; border-right: 0; }
.xray2d button:not(:first-child):not(.fit) { border-radius: 0; }
.xray2d button.on { background: #0a84ff; color: #fff; border-color: #0a84ff; box-shadow: 0 0 12px rgba(10,132,255,0.5); }
.xray2d button:not(.on):hover { background: rgba(30, 82, 160, 0.6); }
.draggable { cursor: ns-resize; }
.bg-pan { cursor: grab; }
.bg-pan:active { cursor: grabbing; }
.ruler { pointer-events: none; user-select: none; }
.ruler-h text { pointer-events: none; }
.xray2d .fit { border-radius: 7px; border-left: 1px solid var(--border-strong); margin-left: 6px; box-shadow: var(--sh-sm); }
.hover-tip2d {
  position: absolute; z-index: 5; pointer-events: none;
  background: rgba(20, 26, 40, 0.92); color: #fff; font-size: 11px; line-height: 1.5;
  padding: 5px 10px; border-radius: 7px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  max-width: 340px; overflow-wrap: break-word;
}
</style>
