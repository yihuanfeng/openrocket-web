<script setup lang="ts">
// 通用浮动窗口：可拖动标题栏移动、右下角拖拽调整大小、位置/尺寸持久化
import { onBeforeUnmount, onMounted, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    title: string;
    /** 持久化键（localStorage 记忆位置与尺寸） */
    storeKey?: string;
    width?: number;
    height?: number;
  }>(),
  { storeKey: '', width: 960, height: 620 },
);

const emit = defineEmits<{ close: [] }>();

const pos = ref({ x: 0, y: 0 });
const size = ref({ w: props.width, h: props.height });
const init = ref(false);

// 拖动标题栏
let dragMode: 'move' | 'resize' | null = null;
let sx = 0, sy = 0;
let base = { x: 0, y: 0, w: 0, h: 0 };

function onDragStart(e: MouseEvent): void {
  if (e.button !== 0) return;
  dragMode = 'move';
  sx = e.clientX; sy = e.clientY;
  base = { x: pos.value.x, y: pos.value.y, w: size.value.w, h: size.value.h };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onResizeStart(e: MouseEvent): void {
  if (e.button !== 0) return;
  e.stopPropagation();
  dragMode = 'resize';
  sx = e.clientX; sy = e.clientY;
  base = { x: pos.value.x, y: pos.value.y, w: size.value.w, h: size.value.h };
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e: MouseEvent): void {
  const dx = e.clientX - sx, dy = e.clientY - sy;
  const vw = window.innerWidth, vh = window.innerHeight;
  if (dragMode === 'move') {
    // 窗口整体约束在视口内（保证右下角缩放手柄始终可抓）
    pos.value.x = Math.min(Math.max(0, base.x + dx), Math.max(0, vw - base.w - 8));
    pos.value.y = Math.min(Math.max(0, base.y + dy), Math.max(0, vh - 48));
  } else if (dragMode === 'resize') {
    size.value.w = Math.min(Math.max(420, base.w + dx), vw - pos.value.x - 8);
    size.value.h = Math.min(Math.max(320, base.h + dy), vh - pos.value.y - 8);
  }
}

function onDragEnd(): void {
  dragMode = null;
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
  save();
}

function save(): void {
  if (!props.storeKey) return;
  try {
    localStorage.setItem(`ork:win:${props.storeKey}`, JSON.stringify({ x: pos.value.x, y: pos.value.y, w: size.value.w, h: size.value.h }));
  } catch { /* 忽略存储失败 */ }
}

function load(): void {
  if (!props.storeKey) return;
  try {
    const raw = localStorage.getItem(`ork:win:${props.storeKey}`);
    if (!raw) return;
    const d = JSON.parse(raw) as { x: number; y: number; w: number; h: number };
    pos.value.x = Math.min(Math.max(0, d.x), Math.max(0, window.innerWidth - d.w - 8));
    pos.value.y = Math.min(Math.max(0, d.y), Math.max(0, window.innerHeight - 48));
    size.value.w = Math.min(Math.max(420, d.w), window.innerWidth - 8);
    size.value.h = Math.min(Math.max(320, d.h), window.innerHeight - 8);
  } catch { /* 忽略解析失败 */ }
}

onMounted(() => {
  load();
  // 默认居中（无记忆时）
  if (!init.value) {
    init.value = true;
    if (!localStorage.getItem(`ork:win:${props.storeKey}`)) {
      pos.value.x = Math.max(0, Math.round((window.innerWidth - size.value.w) / 2));
      pos.value.y = Math.max(0, Math.round((window.innerHeight - size.value.h) / 2) - 40);
    }
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragEnd);
});
</script>

<template>
  <div class="fwin" :style="{ left: pos.x + 'px', top: pos.y + 'px', width: size.w + 'px', height: size.h + 'px' }">
    <div class="fwin-head" @mousedown="onDragStart">
      <span class="fwin-title">{{ title }}</span>
      <span class="fwin-grip">⠿</span>
      <button class="fwin-close" title="关闭" @click.stop="emit('close')">✕</button>
    </div>
    <div class="fwin-body">
      <slot />
    </div>
    <div class="fwin-resize" @mousedown="onResizeStart" />
  </div>
</template>

<style scoped>
.fwin {
  position: fixed;
  z-index: 3000;
  display: flex;
  flex-direction: column;
  background: var(--bg, #0d1b34);
  border: 1px solid var(--blue-500, #1f6fff);
  box-shadow: 0 12px 40px rgba(4, 12, 34, 0.55);
  border-radius: 0;
  min-width: 420px;
  min-height: 320px;
  overflow: hidden;
}
.fwin-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  background: var(--blue-700, #0b3fa0);
  color: #fff;
  cursor: move;
  user-select: none;
  flex: 0 0 auto;
}
.fwin-title { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.fwin-grip { margin-left: auto; font-size: 12px; opacity: 0.55; }
.fwin-close {
  font: inherit; font-size: 12px; line-height: 1;
  color: #fff; background: transparent; border: none;
  padding: 4px 6px; cursor: pointer; border-radius: 0;
}
.fwin-close:hover { background: rgba(255, 255, 255, 0.18); }
.fwin-body { flex: 1 1 auto; min-height: 0; display: flex; }
.fwin-body > * { width: 100%; height: 100%; }
.fwin-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--blue-400, #4f8fff) 50%);
  opacity: 0.7;
}
.fwin-resize:hover { opacity: 1; }
</style>
