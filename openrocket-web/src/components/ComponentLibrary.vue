<script setup lang="ts">
// 组件库（左栏底部）：分类列出可添加组件，点击即加（默认参数，属性面板改值）
import { COMPONENT_TYPES } from '../lib/componentFactory';

const emit = defineEmits<{ add: [type: string] }>();

const GROUPS: { title: string; types: string[] }[] = [
  { title: '轴向组件', types: ['nosecone', 'bodytube', 'transition', 'tubecoupler', 'bulkhead', 'centeringring', 'engineblock'] },
  { title: '尾翼', types: ['trapezoidfinset', 'ellipticalfinset', 'freeformfinset'] },
  { title: '回收与配重', types: ['parachute', 'streamer', 'shockcord', 'masscomponent'] },
  { title: '挂件', types: ['launchlug', 'innertube'] },
];

const ICONS: Record<string, string> = {
  nosecone: '◭', bodytube: '▭', transition: '◺', tubecoupler: '⧉',
  bulkhead: '▬', centeringring: '◍', engineblock: '◉',
  trapezoidfinset: '△', ellipticalfinset: '◠', freeformfinset: '◟',
  parachute: '☂', streamer: '∿', shockcord: '≈', masscomponent: '●',
  launchlug: '◌', innertube: '◎',
};
const DESCS: Record<string, string> = {
  nosecone: '气动头部，默认 0.12 m',
  bodytube: '主体管，默认 0.3 m',
  transition: '变径段，默认 0.05 m',
  tubecoupler: '两节机身间的连接管',
  bulkhead: '封闭舱段隔板（薄壁）',
  centeringring: '内管定心环（薄环）',
  engineblock: '发动机轴向定位挡块',
  trapezoidfinset: '默认 3 片，保证稳定',
  ellipticalfinset: '椭圆外形的尾翼组',
  freeformfinset: '自定义根/梢弦与后掠',
  parachute: '回收伞，挂最后一个管',
  streamer: '轻型回收飘带',
  shockcord: '舱段连接的弹性绳',
  masscomponent: '配重，调整重心位置',
  launchlug: '发射杆导环',
  innertube: '发动机架管（自动挂 C6）',
};

function group(types: string[]) {
  return COMPONENT_TYPES.filter((t) => types.includes(t.code));
}
</script>

<template>
  <div class="lib lib-scroll">
    <div v-for="g in GROUPS" :key="g.title" class="lib-group">
      <div class="lib-group-title">{{ g.title }}</div>
      <button v-for="t in group(g.types)" :key="t.code" class="lib-item" :title="DESCS[t.code]" @click="emit('add', t.code)">
        <span class="li-icon">{{ ICONS[t.code] }}</span>
        <span class="li-text">
          <span class="li-name">{{ t.label }}</span>
          <span class="li-desc">{{ DESCS[t.code] }}</span>
        </span>
        <span class="li-plus">＋</span>
      </button>
    </div>
    <p class="lib-tip">点击即加（默认尺寸），添加后右侧属性面板可改参数。</p>
  </div>
</template>

<style scoped>
.lib { display: flex; flex-direction: column; gap: 12px; }
.lib-group { display: flex; flex-direction: column; gap: 4px; }
.lib-group-title { font-size: 11px; color: var(--text-3); font-weight: 600; margin-bottom: 2px; }
.lib-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  background: #f8fafc; border: 1px solid #e6eaf1; border-radius: 8px;
  padding: 6px 8px; cursor: pointer; text-align: left; color: var(--text);
  font: inherit; transition: background 0.12s, border-color 0.12s;
}
.lib-item:hover { background: #eef4fb; border-color: #b9cfe4; }
.li-icon { width: 20px; text-align: center; color: var(--primary); font-size: 14px; flex: none; }
.li-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.li-name { font-size: 13px; font-weight: 500; }
.li-desc { font-size: 11px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.li-plus { color: var(--primary); font-size: 14px; flex: none; opacity: 0; transition: opacity 0.12s; }
.lib-item:hover .li-plus { opacity: 1; }
.lib-tip { font-size: 11px; color: var(--text-3); line-height: 1.5; margin: 0; }
</style>
