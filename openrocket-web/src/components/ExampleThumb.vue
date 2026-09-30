<script setup lang="ts">
// 示例缩略图：水平绘制火箭轮廓小图（复用 OpenRocket 轴向语义，z=0 鼻尖朝左）
// 几何逻辑与 scripts/gen-thumbs.ts 共用 src/lib/thumbPath.ts，保持一致
import { computed } from 'vue';
import type { RocketComponent } from '../lib/types';
import { buildThumbPaths } from '../lib/thumbPath';

const props = defineProps<{ root: RocketComponent }>();
const r = computed(() => buildThumbPaths(props.root));
</script>

<template>
  <svg :viewBox="`0 0 ${r.w} ${r.h}`" width="100%" height="100%" class="ex-thumb" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect :x="r.pad - 3" y="1" :width="r.w - r.pad * 2 + 6" :height="r.h - 2" rx="3" fill="#0d2f6e" />
    <path
      v-for="(p, i) in r.paths"
      :key="i"
      :d="p.d"
      fill="none"
      stroke="#4fa8ff"
      stroke-width="1.2"
    />
    <path
      v-for="(p, i) in r.paths"
      :key="'m' + i"
      :d="p.d"
      :transform="`translate(0 ${r.h}) scale(1 -1)`"
      fill="none"
      stroke="#4fa8ff"
      stroke-width="0.7"
      opacity="0.5"
    />
    <line :x1="r.pad" :y1="r.h / 2" :x2="r.w - r.pad" :y2="r.h / 2" stroke="#3d7fd4" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.6" />
  </svg>
</template>

<style scoped>
.ex-thumb { display: block; width: 100%; height: 46px; }
</style>
