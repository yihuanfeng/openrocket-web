<script setup lang="ts">
// 组件树：递归展示（任意层级），节点带 OpenRocket 官方图标，支持选中/拖拽重排/增删复制
import { ref, watch } from 'vue';
import type { RocketComponent } from '../lib/types';
import TreeNode from './TreeNode.vue';

const props = defineProps<{ root: RocketComponent; hovered?: RocketComponent | null }>();
const selected = defineModel<RocketComponent | null>({ required: true });
const emit = defineEmits<{ copy: [c: RocketComponent]; remove: [c: RocketComponent]; move: [c: RocketComponent, dir: number]; moveTo: [c: RocketComponent, target: RocketComponent, pos: 'before' | 'after'] }>();

// —— HTML5 拖拽重排（同父内；root 不可拖）——
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
  const row = e.currentTarget as HTMLElement;
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

const open = ref<Set<RocketComponent>>(new Set());

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
    for (const c of props.root.children) open.value.add(c);
    // 默认展开「身体组件」（机身管）：让内部件（降落伞/内管/定心环/发动机架等）打开即见，
    // 而不需要用户逐个点击展开——这是新手最常找不到的一层
    const walk = (node: RocketComponent): void => {
      if (node.type === 'bodytube') open.value.add(node);
      for (const ch of node.children ?? []) walk(ch);
    };
    walk(props.root);
  },
  { immediate: true },
);

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
</script>

<template>
  <div class="tree">
    <TreeNode
      :comp="root"
      :depth="0"
      :open="open"
      :selected="selected"
      :hovered="props.hovered"
      :draggable="false"
      :drag-comp="dragComp"
      :drop-target="dropTarget"
      @toggle="toggle"
      @click="click"
      @copy="(c) => emit('copy', c)"
      @remove="(c) => emit('remove', c)"
      @move="(c, d) => emit('move', c, d)"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @drop="onDrop"
      @dragend="onDragEnd"
    />
  </div>
</template>

<style scoped>
.tree { font-size: 13px; user-select: none; color: var(--text); }
</style>
