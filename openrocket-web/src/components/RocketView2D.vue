<script setup lang="ts">
// 2D 侧视图：支持横/竖两种摆放（竖=鼻锥朝上，横=鼻锥朝左），沿轴线渲染外形轮廓
import { computed, ref } from 'vue';
import type { RocketComponent } from '../lib/types';

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

interface Shape {
  z0: number; z1: number;   // 轴向范围（米），0=鼻端，向上递增向尾部
  r0: number; r1: number;   // 前/后半径（米）
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

/** 计算外形链：OpenRocket 轴向语义 —— z=0 在鼻尖，z 递增向尾部；stage 数组顺序=鼻端→尾部 */
function buildShapes(root: RocketComponent): Shape[] {
  const shapes: Shape[] = [];
  const stages = root.children.filter((c) => c.type === 'stage');
  let base = 0;
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
/** 竖版：轴向走 y，高度动态；横版：轴向走 x，高度扁一点 */
const H = computed(() => (isH.value ? Math.max(300, Math.round(view.value.height * 55)) : Math.max(420, Math.round(view.value.height * 90))));

/** 轴向坐标：竖版 → y（z=0 鼻尖在顶部），横版 → x（z=0 鼻尖在左） */
function axPos(z: number): number {
  const pad = view.value.pad;
  if (isH.value) return (pad + z) / view.value.height * W;
  return (pad + z) / view.value.height * H.value;
}
/** 半径坐标（中心线单侧）：竖版 → x（中心线 W/2 向右），横版 → y（中心线 H/2 向下） */
function radPos(r: number): number {
  const s = r / Math.max(view.value.maxR * 0.7, 0.001);
  if (isH.value) return H.value / 2 + s * (H.value * 0.36);
  return W / 2 + s * (W * 0.36);
}
/** 中心线坐标 */
function midLine(): number {
  return isH.value ? H.value / 2 : W / 2;
}

/** 组件轮廓（中心线一侧；另一侧由镜像渲染） */
function shapePath(s: Shape): string {
  const a0 = axPos(s.z0), a1 = axPos(s.z1);
  const mid = midLine();
  const r0 = radPos(s.r0) - mid, r1 = radPos(s.r1) - mid;
  switch (s.kind) {
    case 'nosecone':
      // 鼻锥：尖端在鼻端（a0），基部在后（a1，r1=基部半径）
      return `M ${mid} ${a0} Q ${mid + r1 * 0.55} ${(a0 + a1) / 2} ${mid + r1} ${a1} L ${mid} ${a1} Z`;
    case 'transition':
      return `M ${mid} ${a0} L ${mid + r0} ${a0} L ${mid + r1} ${a1} L ${mid} ${a1} Z`;
    case 'finset':
    case 'fintab':
    case 'trapezoidfinset':
    case 'ellipticalfinset':
      return finPath(s, a0, a1);
    case 'launchlug':
    case 'railbutton':
      return `M ${mid + r0} ${a0} L ${mid + r0} ${a1} L ${mid + r0 * 1.6} ${(a0 + a1) / 2} Z`;
    default:
      return `M ${mid} ${a0} L ${mid + r0} ${a0} L ${mid + r1} ${a1} L ${mid} ${a1} Z`;
  }
}

/** 尾翼（一侧三角板） */
function finPath(s: Shape, a0: number, a1: number): string {
  const h = parseFloat(s.comp.properties['height'] ?? '') || 0.05;
  const r0 = radPos(s.r0) - midLine();
  const hPx = (h / Math.max(view.value.maxR * 0.7, 0.001)) * (isH.value ? H.value * 0.36 : W * 0.36);
  return `M ${midLine() + r0} ${a0} L ${midLine() + r0 + hPx} ${a0} L ${midLine() + r0 + hPx} ${a1} L ${midLine() + r0} ${a1} Z`;
}

const isInner = (s: Shape) => ['innertube', 'enginemount', 'engineblock'].includes(s.kind);

// —— 悬浮信息 ——
const hoverTip = ref<{ x: number; y: number; text: string } | null>(null);
function onHoverMove(e: MouseEvent, s: Shape): void {
  const svg = svgRef.value;
  if (!svg) return;
  const r = svg.getBoundingClientRect();
  const len = (s.z1 - s.z0);
  const kindLabel = { nosecone: '头锥', bodytube: '机身管', transition: '过渡段', trapezoidfinset: '梯形尾翼', ellipticalfinset: '椭圆尾翼', freeformfinset: '自由尾翼', parachute: '降落伞', streamer: '飘带', shockcord: '冲击绳', masscomponent: '配重', launchlug: '发射导环', innertube: '发动机架管', tubecoupler: '管接头', bulkhead: '隔框', centeringring: '定心环', engineblock: '发动机挡块' } as Record<string, string>;
  const parts = [`${s.name}（${kindLabel[s.kind] ?? s.kind}）`];
  if (len > 0) parts.push(`长 ${fmtLen(len)}`);
  const maxR = Math.max(s.r0, s.r1);
  if (maxR > 0) parts.push(`径 ${fmtLen(maxR * 2)}`);
  if (s.kind === 'parachute' && s.comp.properties?.['deployAlt'] !== undefined) parts.push(`开伞 ${s.comp.properties['deployAlt'] === '0' ? '远地点' : s.comp.properties['deployAlt'] + ' m'}`);
  if ((s.kind === 'parachute' || s.kind === 'streamer') && parseFloat(s.comp.properties?.['diameter'] ?? '0') > 0) parts.push(`伞径 ${fmtLen(parseFloat(s.comp.properties['diameter'] ?? '0'))}`);
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
  const axisLen = isH.value ? W : H.value;
  const dz = (d / axisLen) / scale.value * view.value.height;
  drag.comp.axialOffset = Math.max(0, drag.startOff + dz);
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
  return `${vx.value.toFixed(1)} ${vy.value.toFixed(1)} ${(W / scale.value).toFixed(1)} ${(H.value / scale.value).toFixed(1)}`;
}
function resetView(): void { scale.value = 1; vx.value = 0; vy.value = 0; }

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const svg = svgRef.value;
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * W;
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
const RULER = 34;
function rulerMarks(): { p: number; label: string }[] {
  const h = view.value.height;
  if (h <= 0) return [];
  const target = (38 / (isH.value ? W : H.value)) * h;
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
      <g v-for="(s, i) in shapes" :key="i">
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
          transform="translate(600, 0) scale(-1, 1)"
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
        <g v-if="props.cgX !== null && props.cgX !== undefined">
          <line :x1="W / 2 + 14" :x2="W / 2 + 46" :y1="axPos(props.cgX)" :y2="axPos(props.cgX)" stroke="#34c759" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="W / 2 + 50" :cy="axPos(props.cgX)" r="4.5" fill="#34c759" stroke="#fff" stroke-width="1.5" />
          <text :x="W / 2 + 60" :y="axPos(props.cgX) + 4" fill="#5ee08a" font-size="11" font-weight="700">CG {{ props.cgX.toFixed(3) }} m</text>
        </g>
        <g v-if="props.cpX !== null && props.cpX !== undefined">
          <line :x1="W / 2 - 14" :x2="W / 2 - 46" :y1="axPos(props.cpX)" :y2="axPos(props.cpX)" stroke="#ff3b30" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="W / 2 - 50" :cy="axPos(props.cpX)" r="4.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5" />
          <text :x="W / 2 - 60" :y="axPos(props.cpX) + 4" fill="#ff8f87" font-size="11" font-weight="700" text-anchor="end">CP {{ props.cpX.toFixed(3) }} m</text>
        </g>
      </template>
      <template v-else>
        <g v-if="props.cgX !== null && props.cgX !== undefined">
          <line :x1="axPos(props.cgX)" :y1="H / 2 - 14" :x2="axPos(props.cgX)" :y2="H / 2 - 46" stroke="#34c759" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="axPos(props.cgX)" :cy="H / 2 - 50" r="4.5" fill="#34c759" stroke="#fff" stroke-width="1.5" />
          <text :x="axPos(props.cgX) + 6" :y="H / 2 - 56" fill="#5ee08a" font-size="11" font-weight="700">CG {{ props.cgX.toFixed(3) }} m</text>
        </g>
        <g v-if="props.cpX !== null && props.cpX !== undefined">
          <line :x1="axPos(props.cpX)" :y1="H / 2 + 14" :x2="axPos(props.cpX)" :y2="H / 2 + 46" stroke="#ff3b30" stroke-width="1.6" stroke-dasharray="3 3" />
          <circle :cx="axPos(props.cpX)" :cy="H / 2 + 50" r="4.5" fill="#ff3b30" stroke="#fff" stroke-width="1.5" />
          <text :x="axPos(props.cpX) + 6" :y="H / 2 + 60" fill="#ff8f87" font-size="11" font-weight="700">CP {{ props.cpX.toFixed(3) }} m</text>
        </g>
      </template>
      <text v-if="view.height > 0.05" :x="isH ? W - RULER - 4 : W / 2 + 24" :y="isH ? H / 2 + 22 : H - 10" fill="rgba(190,215,245,0.85)" font-size="10" :text-anchor="isH ? 'end' : 'start'">总长 {{ fmtLen(view ? view.height : 0) }} · {{ isH ? '鼻锥朝左' : '鼻锥朝上' }} · 滚轮缩放 / 空白拖拽平移（×{{ scale.toFixed(1) }}）</text>
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
.ruler-h text { pointer-events: none; }
.xray2d .fit { border-radius: 7px; border-left: 1px solid var(--border-strong); margin-left: 6px; box-shadow: var(--sh-sm); }
.hover-tip2d {
  position: absolute; z-index: 5; pointer-events: none;
  background: rgba(20, 26, 40, 0.92); color: #fff; font-size: 11px; line-height: 1.5;
  padding: 5px 10px; border-radius: 7px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
  white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
}
</style>
