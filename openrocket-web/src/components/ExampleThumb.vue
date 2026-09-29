<script setup lang="ts">
// 示例缩略图：水平绘制火箭轮廓小图（复用 OpenRocket 轴向语义，z=0 鼻尖朝左）
import { computed } from 'vue';
import type { RocketComponent } from '../lib/types';
import { layoutRocket, type GeoSeg } from '../lib/geometry';

const props = defineProps<{ root: RocketComponent }>();

type Th = GeoSeg;

/** 统一几何布局（官方轴向语义 + 半径继承），与 2D/3D 一致 */
const shapes = computed(() => layoutRocket(props.root));
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
