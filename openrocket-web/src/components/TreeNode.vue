<script setup lang="ts">
// 组件树节点：递归渲染（自引用），官方图标 + 选中高亮 + 拖拽重排
import type { RocketComponent } from '../lib/types';

interface DropInfo { comp: RocketComponent; pos: 'before' | 'after' }

const props = defineProps<{
  comp: RocketComponent;
  depth: number;
  open: Set<RocketComponent>;
  selected: RocketComponent | null;
  hovered?: RocketComponent | null;
  draggable: boolean;
  dragComp: RocketComponent | null;
  dropTarget: DropInfo | null;
}>();

const emit = defineEmits<{
  toggle: [c: RocketComponent];
  click: [c: RocketComponent];
  copy: [c: RocketComponent];
  remove: [c: RocketComponent];
  move: [c: RocketComponent, dir: number];
  dragstart: [e: DragEvent, c: RocketComponent];
  dragover: [e: DragEvent, c: RocketComponent];
  drop: [e: DragEvent, c: RocketComponent];
  dragend: [];
}>();

// GitHub Pages 子路径部署：资源统一走相对 BASE_URL
const base = import.meta.env.BASE_URL;

const ICON: Record<string, string> = {
  rocket: 'stage', stage: 'stage', boosters: 'boosters', podset: 'pods', pods: 'pods',
  nosecone: 'nosecone', bodytube: 'bodytube', transition: 'transition',
  trapezoidfinset: 'trapezoidfin', ellipticalfinset: 'ellipticalfin', freeformfinset: 'freeformfin',
  tubefins: 'tubefin', railbutton: 'railbutton', launchlug: 'launchlug',
  innertube: 'innertube', tubecoupler: 'tubecoupler', centeringring: 'centeringring',
  bulkhead: 'bulkhead', engineblock: 'engineblock',
  parachute: 'parachute', streamer: 'streamer', shockcord: 'shockcord', masscomponent: 'mass',
};
function iconOf(c: RocketComponent): string {
  return `${base}ork-assets/component-icons/${ICON[c.type] ?? 'stage'}-small.png`;
}
const typeLabels: Record<string, string> = {
  rocket: '火箭', stage: '级', boosters: '助推器', podset: '捆绑舱',
  nosecone: '头锥', bodytube: '机身管', transition: '过渡段',
  finset: '尾翼组', trapezoidfinset: '梯形尾翼组', ellipticalfinset: '椭圆尾翼组',
  freeformfinset: '自由形状尾翼', tubefins: '管尾翼',
  launchlug: '发射导环', railbutton: '导轨按钮',
  innertube: '内管', enginemount: '发动机架', engineblock: '发动机挡块',
  tubecoupler: '管接头', bulkhead: '隔框', centeringring: '定心环',
  parachute: '降落伞', streamer: '飘带', shockcord: '减震绳', masscomponent: '配重',
};
function typeOf(c: RocketComponent): string {
  return typeLabels[c.type] ?? c.type;
}

// 拖拽落点样式（由 props 计算）
function dropClsOf(c: RocketComponent): Record<string, boolean> {
  return {
    'drop-before': props.dropTarget?.comp === c && props.dropTarget.pos === 'before',
    'drop-after': props.dropTarget?.comp === c && props.dropTarget.pos === 'after',
    dragging: props.dragComp === c,
  };
}
</script>

<template>
  <div>
    <span
      class="row"
      :class="[{ active: selected === comp, hover: hovered === comp }, dropClsOf(comp)]"
      :style="{ paddingLeft: 6 + depth * 14 + 'px' }"
      :draggable="draggable"
      @click="emit('click', comp)"
      @dragstart="emit('dragstart', $event, comp)"
      @dragover="emit('dragover', $event, comp)"
      @drop="emit('drop', $event, comp)"
      @dragend="emit('dragend')"
    >
      <span class="toggle" @click.stop="emit('toggle', comp)">{{ comp.children.length ? (open.has(comp) ? '▼' : '▶') : '·' }}</span>
      <img class="t-icon" :src="iconOf(comp)" alt="" draggable="false" />
      <span class="label">{{ comp.name }}</span>
      <span class="type">{{ typeOf(comp) }}</span>
      <span class="ops">
        <span class="op mv" title="上移" @click.stop="emit('move', comp, -1)">↑</span>
        <span class="op mv" title="下移" @click.stop="emit('move', comp, 1)">↓</span>
        <span class="op" title="复制" @click.stop="emit('copy', comp)">⧉</span>
        <span class="op del" title="删除（Delete）" @click.stop="emit('remove', comp)">✕</span>
      </span>
    </span>
    <div v-if="open.has(comp) && comp.children.length">
      <TreeNode
        v-for="(c, i) in comp.children"
        :key="i"
        :comp="c"
        :depth="depth + 1"
        :open="open"
        :selected="selected"
        :hovered="hovered"
        :draggable="true"
        :drag-comp="dragComp"
        :drop-target="dropTarget"
        @toggle="(c2) => emit('toggle', c2)"
        @click="(c2) => emit('click', c2)"
        @copy="(c2) => emit('copy', c2)"
        @remove="(c2) => emit('remove', c2)"
        @move="(c2, d) => emit('move', c2, d)"
        @dragstart="(e, c2) => emit('dragstart', e, c2)"
        @dragover="(e, c2) => emit('dragover', e, c2)"
        @drop="(e, c2) => emit('drop', e, c2)"
        @dragend="() => emit('dragend')"
      />
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: 6px; cursor: pointer;
}
.row:hover { background: var(--primary-soft); }
.row.active { background: var(--primary-soft); box-shadow: inset 2px 0 0 var(--primary); }
.row.hover { background: var(--blue-100); box-shadow: inset 2px 0 0 var(--blue-300); }
.toggle {
  width: 24px; height: 24px; flex: none; display: grid; place-items: center;
  text-align: center; color: var(--text-2); font-size: 12px; line-height: 1;
  border-radius: 5px; cursor: pointer; user-select: none;
  transition: background 0.12s, color 0.12s;
}
.toggle:hover { background: var(--primary-soft); color: var(--primary-strong); }
.t-icon { width: 22px; height: auto; flex: none; opacity: 0.85; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { margin-left: auto; color: var(--text-3); font-size: 11px; flex: none; }
.ops { display: none; align-items: center; gap: 2px; flex: none; margin-left: 8px; }
.row:hover .ops { display: inline-flex; }
.op { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 4px; font-size: 11px; color: var(--text-2); cursor: pointer; }
.op:hover { background: var(--primary-soft); color: var(--primary-strong); }
.op.del:hover { background: #fdf2f1; color: #dc2626; }
.op.mv:hover { background: var(--blue-100); color: var(--primary-strong); }
.op.mv { font-weight: 700; }
.row.dragging { opacity: 0.45; }
.row.drop-before { box-shadow: inset 0 2px 0 0 var(--primary); background: var(--primary-soft); }
.row.drop-after { box-shadow: inset 0 -2px 0 0 var(--primary); background: var(--primary-soft); }
</style>
