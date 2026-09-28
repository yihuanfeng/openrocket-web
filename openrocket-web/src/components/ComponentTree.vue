<script setup lang="ts">
// 组件树：递归展示，支持选中
import { ref, watch } from 'vue';
import type { RocketComponent } from '../lib/types';

const props = defineProps<{ root: RocketComponent; hovered?: RocketComponent | null }>();
const selected = defineModel<RocketComponent | null>({ required: true });
const emit = defineEmits<{ copy: [c: RocketComponent]; remove: [c: RocketComponent]; move: [c: RocketComponent, dir: number]; moveTo: [c: RocketComponent, target: RocketComponent, pos: 'before' | 'after'] }>();

// —— P2：HTML5 拖拽重排（同父内；root 不可拖）——
const dragComp = ref<RocketComponent | null>(null);
const dropTarget = ref<{ comp: RocketComponent; pos: 'before' | 'after' } | null>(null);
function onDragStart(e: DragEvent, c: RocketComponent): void {
  dragComp.value = c;
  if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.name); }
}
function onDragOver(e: DragEvent, c: RocketComponent): void {
  if (!dragComp.value || dragComp.value === c) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const row = (e.currentTarget as HTMLElement);
  const r = row.getBoundingClientRect();
  dropTarget.value = { comp: c, pos: e.clientY - r.top < r.height / 2 ? 'before' : 'after' };
}
function onDrop(e: DragEvent, c: RocketComponent): void {
  e.preventDefault();
  if (dragComp.value && dragComp.value !== c) {
    emit('moveTo', dragComp.value, c, dropTarget.value?.pos ?? 'after');
  }
  dragComp.value = null;
  dropTarget.value = null;
}
function onDragEnd(): void { dragComp.value = null; dropTarget.value = null; }
const dropCls = (c: RocketComponent) => ({
  'drop-before': dropTarget.value?.comp === c && dropTarget.value.pos === 'before',
  'drop-after': dropTarget.value?.comp === c && dropTarget.value.pos === 'after',
  dragging: dragComp.value === c,
});

const open = ref<Set<RocketComponent>>(new Set());

/** 从 root 找 target 的祖先链（含自身） */
function findAncestors(node: RocketComponent, target: RocketComponent): RocketComponent[] {
  if (node === target) return [node];
  for (const ch of node.children ?? []) {
    const p = findAncestors(ch, target);
    if (p.length) return [node, ...p];
  }
  return [];
}

watch(
  () => props.root,
  () => {
    open.value = new Set();
    open.value.add(props.root);
    // 默认展开一级子节点（通常为级 Stage），让组件内容直接可见
    for (const c of props.root.children) open.value.add(c);
  },
  { immediate: true },
);

// 选中（含添加/点击）时自动展开祖先链，保证新增组件立即可见
watch(selected, (sel) => {
  if (!sel) return;
  for (const n of findAncestors(props.root, sel)) open.value.add(n);
});

function toggle(c: RocketComponent): void {
  if (open.value.has(c)) open.value.delete(c);
  else open.value.add(c);
}

function click(c: RocketComponent): void {
  selected.value = c;
  open.value.add(c);
}

const typeLabels: Record<string, string> = {
  rocket: '火箭',
  stage: '级',
  nosecone: '头锥',
  bodytube: '机身管',
  transition: '过渡段',
  finset: '尾翼组',
  trapezoidfinset: '梯形尾翼组',
  ellipticalfinset: '椭圆尾翼组',
  freeformfinset: '自由形状尾翼',
  launchlug: '发射导环',
  railbutton: '导轨按钮',
  innertube: '内管',
  enginemount: '发动机架',
  engineblock: '发动机挡块',
  tubecoupler: '管接头',
  bulkhead: '隔框',
  centeringring: '定心环',
  parachute: '降落伞',
  streamer: '飘带',
  shockcord: '冲击绳',
  masscomponent: '配重',
  podset: '捆绑舱',
};
</script>

<template>
  <div class="tree">
    <div class="node" :style="{ paddingLeft: 0 }">
      <span class="row" :class="{ active: selected === root, hover: props.hovered === root }" @click="click(root)">
        <span class="toggle" @click.stop="toggle(root)">{{ open.has(root) ? '▾' : '▸' }}</span>
        <span class="label">{{ root.name }}</span>
        <span class="type">{{ typeLabels[root.type] ?? root.type }}</span>
      </span>
      <div v-if="open.has(root) && root.children.length">
        <div v-for="(c, i) in root.children" :key="i" class="child">
          <span class="row" draggable="true" :class="[{ active: selected === c, hover: props.hovered === c }, dropCls(c)]" @click="click(c)" @dragstart="onDragStart($event, c)" @dragover="onDragOver($event, c)" @drop="onDrop($event, c)" @dragend="onDragEnd">
            <span class="toggle" @click.stop="toggle(c)">{{ c.children.length ? (open.has(c) ? '▾' : '▸') : '·' }}</span>
            <span class="label">{{ c.name }}</span>
            <span class="type">{{ typeLabels[c.type] ?? c.type }}</span>
            <span class="ops">
              <span class="op mv" title="上移" @click.stop="emit('move', c, -1)">↑</span>
              <span class="op mv" title="下移" @click.stop="emit('move', c, 1)">↓</span>
              <span class="op" title="复制（Ctrl+C / Cmd+C）" @click.stop="emit('copy', c)">⧉</span>
              <span class="op del" title="删除（Delete）" @click.stop="emit('remove', c)">✕</span>
            </span>
          </span>
          <div v-if="open.has(c) && c.children.length" style="margin-left: 16px">
            <div v-for="(g, j) in c.children" :key="j">
              <span class="row" draggable="true" :class="[{ active: selected === g, hover: props.hovered === g }, dropCls(g)]" @click="click(g)" @dragstart="onDragStart($event, g)" @dragover="onDragOver($event, g)" @drop="onDrop($event, g)" @dragend="onDragEnd">
                <span class="toggle" @click.stop="toggle(g)">{{ g.children.length ? (open.has(g) ? '▾' : '▸') : '·' }}</span>
                <span class="label">{{ g.name }}</span>
                <span class="type">{{ typeLabels[g.type] ?? g.type }}</span>
                <span class="ops">
                  <span class="op mv" title="上移" @click.stop="emit('move', g, -1)">↑</span>
                  <span class="op mv" title="下移" @click.stop="emit('move', g, 1)">↓</span>
                  <span class="op" title="复制" @click.stop="emit('copy', g)">⧉</span>
                  <span class="op del" title="删除" @click.stop="emit('remove', g)">✕</span>
                </span>
              </span>
              <div v-if="open.has(g) && g.children.length" style="margin-left: 16px">
                <div v-for="(d, k) in g.children" :key="k">
                  <span class="row" draggable="true" :class="[{ active: selected === d, hover: props.hovered === d }, dropCls(d)]" @click="click(d)" @dragstart="onDragStart($event, d)" @dragover="onDragOver($event, d)" @drop="onDrop($event, d)" @dragend="onDragEnd">
                    <span class="label" style="padding-left: 20px">{{ d.name }}</span>
                    <span class="type">{{ typeLabels[d.type] ?? d.type }}</span>
                    <span class="ops">
                      <span class="op mv" title="上移" @click.stop="emit('move', d, -1)">↑</span>
                      <span class="op mv" title="下移" @click.stop="emit('move', d, 1)">↓</span>
                      <span class="op" title="复制" @click.stop="emit('copy', d)">⧉</span>
                      <span class="op del" title="删除" @click.stop="emit('remove', d)">✕</span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree { font-size: 13px; user-select: none; color: var(--text); }
.row {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 6px; border-radius: 6px; cursor: pointer;
}
.row:hover { background: var(--primary-soft); }
.row.active { background: var(--primary-soft); box-shadow: inset 2px 0 0 var(--primary); }
.toggle { width: 14px; text-align: center; color: var(--text-2); flex: none; }
.label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { margin-left: auto; color: var(--text-3); font-size: 11px; flex: none; }
.child { margin-left: 14px; }
.row.hover { background: var(--blue-100); box-shadow: inset 2px 0 0 var(--blue-300); }
.ops { display: none; align-items: center; gap: 2px; flex: none; margin-left: auto; }
.row:hover .ops { display: inline-flex; }
.op { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 4px; font-size: 11px; color: var(--text-2); cursor: pointer; }
.op:hover { background: var(--primary-soft); color: var(--primary-strong); }
.op.del:hover { background: var(--red-soft, #fdf2f1); color: #dc2626; }
.op.mv:hover { background: var(--blue-100); color: var(--primary-strong); }
.op.mv { font-weight: 700; }
.type { margin-left: 0; }
.row.dragging { opacity: 0.45; }
.row.drop-before { box-shadow: inset 0 2px 0 0 var(--primary); background: var(--primary-soft); }
.row.drop-after { box-shadow: inset 0 -2px 0 0 var(--primary); background: var(--primary-soft); }
</style>
