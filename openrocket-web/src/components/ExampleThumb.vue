<script setup lang="ts">
// 示例缩略图：水平绘制火箭轮廓小图（复用 OpenRocket 轴向语义，z=0 鼻尖朝左）
import { computed } from 'vue';
import type { RocketComponent } from '../lib/types';

const props = defineProps<{ root: RocketComponent }>();

interface Th {
  z0: number; z1: number;
  r0: number; r1: number;
  kind: string;
}
function radiusAt(r: number): number { return isNaN(r) ? 0 : Math.max(0, r); }
function lengthOf(c: RocketComponent): number { const l = c.length; return isNaN(l) ? 0 : Math.max(0, l); }

function buildShapes(root: RocketComponent): Th[] {
  const shapes: Th[] = [];
  let base = 0;
  for (const stage of root.children.filter((c) => c.type === 'stage')) {
    let cursor = base;
    for (const c of stage.children) {
      let len = lengthOf(c);
      if (c.type === 'shockcord' || c.type === 'streamer' || c.type === 'masscomponent') len = 0;
      const off = isNaN(c.axialOffset) ? cursor : Math.max(cursor, c.axialOffset);
      const s: Th = {
        kind: c.type, z0: off, z1: off + len,
        r0: radiusAt(c.radius), r1: radiusAt(c.aftRadius),
      };
      if (c.type === 'nosecone') { s.r0 = 0; s.r1 = radiusAt(c.radius); }
      shapes.push(s);
      cursor = off + len;
      for (const child of c.children) {
        const clen = lengthOf(child);
        const coff = isNaN(child.axialOffset) ? 0 : child.axialOffset;
        shapes.push({
          kind: child.type, z0: off + coff, z1: off + coff + clen,
          r0: radiusAt(child.radius), r1: radiusAt(child.aftRadius),
        });
      }
    }
    base = cursor;
  }
  return shapes;
}

const shapes = computed(() => buildShapes(props.root));
const view = computed(() => {
  let maxZ = 0, maxR = 0;
  for (const s of shapes.value) {
    maxZ = Math.max(maxZ, s.z1);
    maxR = Math.max(maxR, s.r0, s.r1);
  }
  return { maxZ: Math.max(maxZ, 0.001), maxR: Math.max(maxR, 0.001) };
});

const W = 116, H = 44, PAD = 5;
const midY = H / 2;
/** 轴向 x（z=0 鼻尖在左），半径缩放（受高度限制，细长火箭径向放大以便可见） */
const unitX = (W - PAD * 2) / view.value.maxZ;
const rScale = Math.min((H - 10) / 2 / view.value.maxR, W * 0.12 / view.value.maxR);
const xAt = (z: number) => PAD + z * unitX;
const yAt = (r: number) => midY + r * rScale;

function path(s: Th): string {
  const a0 = xAt(s.z0), a1 = xAt(s.z1);
  const r0 = yAt(s.r0) - midY, r1 = yAt(s.r1) - midY;
  if (s.kind === 'nosecone') {
    return `M ${midY} ${a0} Q ${midY + r1 * 0.55} ${(a0 + a1) / 2} ${midY + r1} ${a1} L ${midY} ${a1} Z`;
  }
  return `M ${midY} ${a0} L ${midY + r0} ${a0} L ${midY + r1} ${a1} L ${midY} ${a1} Z`;
}
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" width="100%" height="100%" class="ex-thumb" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect :x="PAD - 3" y="1" :width="W - PAD * 2 + 6" :height="H - 2" rx="3" fill="#0d2f6e" />
    <path
      v-for="(s, i) in shapes"
      :key="i"
      :d="path(s)"
      fill="none"
      stroke="#4fa8ff"
      stroke-width="1.2"
    />
    <path
      v-for="(s, i) in shapes"
      :key="'m' + i"
      :d="path(s)"
      :transform="`translate(0 ${H}) scale(1 -1)`"
      fill="none"
      stroke="#4fa8ff"
      stroke-width="0.7"
      opacity="0.5"
    />
    <line :x1="PAD" :y1="midY" :x2="W - PAD" :y2="midY" stroke="#3d7fd4" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.6" />
  </svg>
</template>

<style scoped>
.ex-thumb { display: block; width: 100%; height: 46px; }
</style>
