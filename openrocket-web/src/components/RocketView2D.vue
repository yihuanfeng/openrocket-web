<script setup lang="ts">
// 2D 侧视图：竖直显示火箭（鼻锥朝上），沿轴线渲染外形轮廓（米 → SVG 坐标）
import { computed, ref } from 'vue';
import type { RocketComponent } from '../lib/types';

const props = defineProps<{ root: RocketComponent; selected?: RocketComponent | null; cgX?: number | null; cpX?: number | null }>();
const emit = defineEmits<{ hover: [c: RocketComponent | null]; pick: [c: RocketComponent]; change: [] }>();

interface Shape {
  z0: number; z1: number;   // 轴向范围（米），0=底部，向上递增，鼻锥在最上
  r0: number; r1: number;   // 前/后半径（米）——竖直图按 OpenRocket 语义：鼻锥半径=基部
  kind: string;
  name: string;
  comp: RocketComponent;
}

function radiusAt(r: number): number {
  return isNaN(r) ? 0 : Math.max(0, r);
}
function lengthOf(c: RocketComponent): number {
  const l = c.length;
  return isNaN(l) ? 0 : Math.max(0, l);
}

/** 计算外形链：OpenRocket 轴向语义 —— z=0 在鼻尖（视觉顶部），z 递增向尾部（视觉向下）；
 *  stage 数组顺序 = 鼻端→尾部（第一个 stage 在最上方）；stage 内组件顺序同样为鼻端→尾部。
 *  头锥：尖端在 z0（鼻端），基部在 z1；过渡段：radius=前端（z0），aftRadius=后端（z1）。 */
function buildShapes(root: RocketComponent): Shape[] {
  const shapes: Shape[] = [];
  const stages = root.children.filter((c) => c.type === 'stage');
  let base = 0; // 鼻端偏移（z=0 起，逐级向尾部推进）
  for (const stage of stages) {
    let cursor = base;
    for (const c of stage.children) {
      let len = lengthOf(c);
      const isHang = c.type === 'shockcord' || c.type === 'streamer' || c.type === 'masscomponent';
      if (isHang) len = 0;
      const off = isNaN(c.axialOffset) ? cursor : Math.max(cursor, c.axialOffset);
      const s: Shape = {
        kind: c.type,
        z0: off,
        z1: off + len,
        r0: radiusAt(c.radius),
        r1: radiusAt(c.aftRadius),
        name: c.name,
        comp: c,
      };
      if (c.type === 'nosecone') {
        // 头锥：尖端在鼻端（z0），基部在后（z1）
        s.r0 = 0;
        s.r1 = radiusAt(c.radius);
      }
      shapes.push(s);
      cursor = off + len;
      for (const child of c.children) {
        const clen = lengthOf(child);
        const coff = isNaN(child.axialOffset) ? 0 : child.axialOffset;
        shapes.push({
          kind: child.type,
          z0: off + coff,
          z1: off + coff + clen,
          r0: radiusAt(child.radius),
          r1: radiusAt(child.aftRadius),
          name: child.name,
          comp: child,
        });
      }
    }
    base = cursor;
  }
  return shapes;
}

const shapes = computed(() => buildShapes(props.root));

/** 视图范围（米） */
const view = computed(() => {
  let maxZ = 0, maxR = 0;
  for (const s of shapes.value) {
    maxZ = Math.max(maxZ, s.z1);
    maxR = Math.max(maxR, s.r0, s.r1);
  }
  const pad = maxR * 0.2 + 0.008;
  return { height: Math.max(maxZ, 0.05) + pad * 2, maxR, pad };
});

const W = 600;
const H = computed(() => Math.max(420, Math.round(view.value.height * 90)));

/** 米 → SVG 坐标：z=0 鼻尖在顶部（y 小），z 增大向尾部（y 大/底部）；x 中心线=300 */
function yAt(z: number): number {
  const pad = view.value.pad;
  return (pad + z) / view.value.height * H.value;
}
function xAt(r: number): number {
  return W / 2 + (r / Math.max(view.value.maxR * 0.7, 0.001)) * (W * 0.36);
}

/** 组件轮廓（右半：中心线到 r） */
function shapePath(s: Shape): string {
  const y0 = yAt(s.z0), y1 = yAt(s.z1);
  const r0 = xAt(s.r0) - W / 2, r1 = xAt(s.r1) - W / 2;
  switch (s.kind) {
    case 'nosecone':
      // 头锥：尖端在鼻端（z0→y0=顶部），基部在后（z1→y1=下方，r1=基部半径）
      return `M ${W / 2} ${y0} Q ${W / 2 + r1 * 0.55} ${(y0 + y1) / 2} ${W / 2 + r1} ${y1} L ${W / 2} ${y1} Z`;
    case 'transition':
      return `M ${W / 2} ${y0} L ${W / 2 + r0} ${y0} L ${W / 2 + r1} ${y1} L ${W / 2} ${y1} Z`;
    case 'finset':
    case 'fintab':
    case 'trapezoidfinset':
    case 'ellipticalfinset':
      return finPath(s, y0, y1);
    case 'launchlug':
    case 'railbutton':
      return `M ${W / 2 + r0} ${y0} L ${W / 2 + r0} ${y1} L ${W / 2 + r0 * 1.6} ${(y0 + y1) / 2} Z`;
    default:
      return `M ${W / 2} ${y0} L ${W / 2 + r0} ${y0} L ${W / 2 + r1} ${y1} L ${W / 2} ${y1} Z`;
  }
}

/** 尾翼（一侧三角板） */
function finPath(s: Shape, y0: number, y1: number): string {
  const h = parseFloat(s.comp.properties['height'] ?? '') || 0.05;
  const r0 = xAt(s.r0) - W / 2;
  const hPx = (h / Math.max(view.value.maxR * 0.7, 0.001)) * (W * 0.36);
  return `M ${W / 2 + r0} ${y0} L ${W / 2 + r0 + hPx} ${y0} L ${W / 2 + r0 + hPx} ${y1} L ${W / 2 + r0} ${y1} Z`;
}

const isInner = (s: Shape) => ['innertube', 'enginemount', 'engineblock'].includes(s.kind);

// —— P1-5：视图内悬浮信息（组件名 + 关键尺寸）——
const hoverTip = ref<{ x: number; y: number; text: string } | null>(null);
function onHoverMove(e: MouseEvent, s: Shape): void {
  const svg = svgRef.value;
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const len = (s.z1 - s.z0);
  const kindLabel = { nosecone: '头锥', bodytube: '机身管', transition: '过渡段', trapezoidfinset: '梯形尾翼', ellipticalfinset: '椭圆尾翼', freeformfinset: '自由尾翼', parachute: '降落伞', streamer: '飘带', shockcord: '冲击绳', masscomponent: '配重', launchlug: '发射导环', innertube: '发动机架管', tubecoupler: '管接头', bulkhead: '隔框', centeringring: '定心环', engineblock: '发动机挡块' } as Record<string, string>;
  const parts = [`${s.name}（${kindLabel[s.kind] ?? s.kind}）`];
  if (len > 0) parts.push(`长 ${(len * 100).toFixed(1)} cm`);
  const maxR = Math.max(s.r0, s.r1);
  if (maxR > 0) parts.push(`径 ${(maxR * 200).toFixed(1)} mm`);
  if (s.kind === 'parachute' && s.comp.properties?.['deployAlt'] !== undefined) parts.push(`开伞 ${s.comp.properties['deployAlt'] === '0' ? '远地点' : s.comp.properties['deployAlt'] + ' m'}`);
  if ((s.kind === 'parachute' || s.kind === 'streamer') && parseFloat(s.comp.properties?.['diameter'] ?? '0') > 0) parts.push(`伞径 ${(parseFloat(s.comp.properties['diameter'] ?? '0') * 1000).toFixed(0)} mm`);
  if (s.kind === 'innertube' && s.comp.properties?.['motorId']) parts.push(`电机 ${s.comp.properties['motorId']}`);
  hoverTip.value = { x: e.clientX - r.left, y: e.clientY - r.top, text: parts.join(' · ') };
}
function clearHoverTip(): void { hoverTip.value = null; }
const xray = ref(false);
const svgRef = ref<SVGSVGElement | null>(null);

function getSvg(): string {
  return svgRef.value ? svgRef.value.outerHTML : '';
}
defineExpose({ getSvg });

// —— 拖拽轴向调整（竖直拖动改变轴向位置）——
const DRAGGABLE = ['nosecone', 'bodytube', 'transition', 'innertube', 'launchlug', 'parachute'];
function canDrag(s: Shape): boolean {
  return DRAGGABLE.includes(s.kind);
}
let drag: { comp: RocketComponent; startY: number; startOff: number } | null = null;
function onShapeDown(e: MouseEvent, s: Shape): void {
  if (!canDrag(s)) return;
  e.preventDefault();
  drag = {
    comp: s.comp,
    startY: e.clientY,
    startOff: isNaN(s.comp.axialOffset) ? 0 : s.comp.axialOffset,
  };
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragUp);
}
function onDragMove(e: MouseEvent): void {
  if (!drag) return;
  const dy = e.clientY - drag.startY;
  const dz = (dy / H.value) / scale.value * view.value.height; // 鼻尖基准：屏幕 y 向下 = z 向尾部（增大）；除以 scale 还原逻辑坐标
  drag.comp.axialOffset = Math.max(0, drag.startOff + dz);
}
function onDragUp(): void {
  if (!drag) return;
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragUp);
  drag = null;
  emit('change');
}

// —— P1：缩放平移（viewBox 动态窗口，SVG 内部坐标不变 → hover/拾取/拖拽自动正确）——
const scale = ref(1);   // 1=自适应全览
const vx = ref(0);      // viewBox 左上角（逻辑坐标）
const vy = ref(0);
const MIN_S = 0.4, MAX_S = 8;

/** viewBox 字符串：窗口宽=W/scale、高=H/scale，左上角 (vx, vy) */
function windowBox(): string {
  return `${vx.value.toFixed(1)} ${vy.value.toFixed(1)} ${(W / scale.value).toFixed(1)} ${(H.value / scale.value).toFixed(1)}`;
}
function resetView(): void { scale.value = 1; vx.value = 0; vy.value = 0; }

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  // 鼠标在屏幕坐标（0..W, 0..H 逻辑映射）
  const sx = ((e.clientX - rect.left) / rect.width) * W;
  const sy = ((e.clientY - rect.top) / rect.height) * H.value;
  // 当前鼠标对应的 viewBox 坐标
  const vbx = vx.value + sx / scale.value;
  const vby = vy.value + sy / scale.value;
  const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  const ns = Math.min(MAX_S, Math.max(MIN_S, scale.value * f));
  // 保持鼠标下内容不动
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

// —— P1：轴向测量标尺（SVG 逻辑坐标，随缩放同步）——
const RULER = 34; // 标尺占用左侧宽度（px）
function rulerTicks(): { y: number; label: string }[] {
  const h = view.value.height;
  if (h <= 0) return [];
  // 目标刻度间距 ~38px 逻辑高，反推米数后取 1/2/5×10ⁿ
  const target = (38 / H.value) * h;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const cands = [mag, 2 * mag, 5 * mag, 10 * mag];
  const step = cands.find((c) => c >= target) ?? cands[cands.length - 1];
  const out: { y: number; label: string }[] = [];
  for (let z = 0; z <= h + 1e-9; z += step) {
    out.push({ y: yAt(z), label: step >= 1 ? z.toFixed(1) : (z * 100).toFixed(0) });
  }
  return out;
}
const unitLabel = computed(() => (view.value.height >= 1 ? 'm' : 'cm'));
</script>

<template>
  <div class="view2d">
    <div class="xray2d seg">
      <button :class="{ on: !xray }" @click="xray = false">实体</button>
      <button :class="{ on: xray }" @click="xray = true">剖视</button>
      <button class="fit" title="复位视图（1:1 全览）" @click="resetView">⤢ 复位</button>
    </div>
    <svg ref="svgRef" :viewBox="windowBox()" width="100%" :height="H" xmlns="http://www.w3.org/2000/svg" @wheel.prevent="onWheel">
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
      <!-- 轴向测量标尺（左侧） -->
      <g class="ruler">
        <line :x1="RULER / 2" :y1="yAt(0)" :x2="RULER / 2" :y2="yAt(view.height)" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
        <template v-for="t in rulerTicks()" :key="'t' + t.y">
          <line :x1="RULER / 2 - 5" :x2="RULER / 2" :y1="t.y" :y2="t.y" stroke="rgba(160,205,255,0.5)" stroke-width="1" />
          <text :x="3" :y="t.y + 3" fill="rgba(180,210,245,0.85)" font-size="9">{{ t.label }}</text>
        </template>
        <text :x="3" :y="yAt(0) - 4" fill="rgba(180,210,245,0.85)" font-size="9" font-weight="700">{{ unitLabel }}</text>
      </g>
      <line :x1="W / 2" :y1="8" :x2="W / 2" :y2="H - 24" stroke="rgba(160,205,255,0.45)" stroke-dasharray="6 5" stroke-width="1" />
      <g v-for="(s, i) in shapes" :key="i">
        <!-- 右半 -->
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
        <!-- 左半镜像 -->
        <path
          :d="shapePath(s)"
          transform="translate(600, 0) scale(-1, 1)"
          :fill="s.kind.includes('fin') ? 'url(#finFill2d)' : isInner(s) ? 'url(#innerFill2d)' : 'url(#bodyFill2d)'"
          :opacity="xray && !isInner(s) ? 0.06 : 0.35"
          @mouseenter="emit('hover', s.comp)"
          @mouseleave="emit('hover', null)"
          @click="emit('pick', s.comp)"
        />
        <title>{{ s.name }}</title>
      </g>
      <!-- CG / CP 位置标记 -->
      <g v-if="props.cgX !== null && props.cgX !== undefined">
        <line :x1="W / 2 + 14" :x2="W / 2 + 46" :y1="yAt(props.cgX)" :y2="yAt(props.cgX)" stroke="#34c759" stroke-width="1.6" stroke-dasharray="3 3" />
        <circle :cx="W / 2 + 50" :cy="yAt(props.cgX)" r="4.5" fill="#34c759" stroke="#fff" stroke-width="1.5" />
        <text :x="W / 2 + 60" :y="yAt(props.cgX) + 4" fill="#5ee08a" font-size="11" font-weight="700">CG {{ props.cgX.toFixed(3) }} m</text>
      </g>
      <g v-if="props.cpX !== null && props.cpX !== undefined">
        <line :x1="W / 2 - 14" :x2="W / 2 - 46" :y1="yAt(props.cpX)" :y2="yAt(props.cpX)" stroke="#ff3b30" stroke-width="1.6" stroke-dasharray="3 3" />
        <circle :cx="W / 2 - 50" :cy="yAt(props.cpX)" r="4.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5" />
        <text :x="W / 2 - 60" :y="yAt(props.cpX) + 4" fill="#ff8f87" font-size="11" font-weight="700" text-anchor="end">CP {{ props.cpX.toFixed(3) }} m</text>
      </g>
      <text v-if="view.height > 0.05" :x="W / 2 + 24" :y="H - 10" fill="rgba(190,215,245,0.85)" font-size="10">总长 {{ view.height.toFixed(2) }} m · 鼻锥朝上 · 滚轮缩放 / 空白拖拽平移（×{{ scale.toFixed(1) }}）</text>
    </svg>
    <div v-if="hoverTip" class="hover-tip2d" :style="{ left: hoverTip.x + 14 + 'px', top: hoverTip.y + 10 + 'px' }">
      {{ hoverTip.text }}
    </div>
  </div>
</template>

<style scoped>
.view2d {
  position: relative;
  background: linear-gradient(180deg, #0a2b66 0%, #071a45 100%);
  border: 1px solid #123a7a;
  border-radius: var(--r-md);
  padding: 10px 12px;
  min-height: 260px;
  overflow: auto;
  box-shadow: inset 0 0 40px rgba(10, 132, 255, 0.08);
}
.xray2d {
  position: absolute; top: 10px; right: 10px; z-index: 3;
}
.xray2d button {
  font: inherit; font-size: 12px; font-weight: 600; color: rgba(220, 238, 255, 0.92);
  background: rgba(255, 255, 255, 0.09); border: 1px solid rgba(255, 255, 255, 0.18); padding: 4px 12px; cursor: pointer;
  box-shadow: none; transition: all 0.15s ease; backdrop-filter: blur(8px);
}
.xray2d button:first-child { border-radius: 7px 0 0 7px; border-right: 0; }
.xray2d button:last-child { border-radius: 0 7px 7px 0; }
.xray2d button.on { background: #0a84ff; color: #fff; border-color: #0a84ff; box-shadow: 0 0 12px rgba(10,132,255,0.5); }
.xray2d button:not(.on):hover { background: rgba(255, 255, 255, 0.18); }
.draggable { cursor: ns-resize; }
.bg-pan { cursor: grab; }
.bg-pan:active { cursor: grabbing; }
.ruler { pointer-events: none; user-select: none; }
.xray2d .fit { border-radius: 7px; border-left: 1px solid var(--border-strong); margin-left: 6px; box-shadow: var(--sh-sm); }
.hover-tip2d {
  position: absolute; z-index: 5; pointer-events: none;
  background: rgba(20, 26, 40, 0.92); color: #fff; font-size: 11px; line-height: 1.5;
  padding: 5px 10px; border-radius: 7px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
}
</style>
