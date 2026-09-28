<script setup lang="ts">
// 添加组件面板（参数化添加）：选择类型 + 填参数 → 构造组件（默认参数来自 componentFactory）
import { ref } from 'vue';
import type { RocketComponent } from '../lib/types';
import { COMPONENT_TYPES, DEFAULT_PARAMS, makeComponent } from '../lib/componentFactory';

const emit = defineEmits<{ add: [comp: RocketComponent]; close: [] }>();

const SHAPES = ['ogive', 'conical', 'parabolic', 'power', 'haack'];

const type = ref('bodytube');
const length = ref(0.3);
const radius = ref(0.02);
const aftRadius = ref(0.02);
const shape = ref('ogive');
const axialOffset = ref(0);
const finCount = ref(3);
const rootChord = ref(0.06);
const tipChord = ref(0.04);
const sweep = ref(0.03);
const finHeight = ref(0.05);
const thickness = ref(0.0032);

function onTypeChange(): void {
  // 切换类型时载入该类型默认值
  const d = DEFAULT_PARAMS[type.value] ?? {};
  length.value = d.length ?? 0.3;
  radius.value = d.radius ?? 0.02;
  aftRadius.value = d.aftRadius ?? radius.value;
  shape.value = d.shape ?? 'ogive';
  axialOffset.value = d.axialOffset ?? 0;
  finCount.value = d.finCount ?? 3;
  rootChord.value = d.rootChord ?? 0.06;
  tipChord.value = d.tipChord ?? 0.04;
  sweep.value = d.sweep ?? 0.03;
  finHeight.value = d.height ?? 0.05;
  thickness.value = d.thickness ?? 0.0032;
}

function submit(): void {
  emit(
    'add',
    makeComponent(type.value, {
      length: length.value,
      radius: radius.value,
      aftRadius: aftRadius.value,
      shape: shape.value,
      axialOffset: axialOffset.value,
      finCount: finCount.value,
      rootChord: rootChord.value,
      tipChord: tipChord.value,
      sweep: sweep.value,
      height: finHeight.value,
      thickness: thickness.value,
    }),
  );
}
</script>

<template>
  <div class="panel">
    <div class="head">
      <span class="t">添加组件（参数化）</span>
      <button class="x" @click="emit('close')">✕</button>
    </div>
    <div class="body">
      <label class="row">
        <span>类型</span>
        <select v-model="type" @change="onTypeChange">
          <option v-for="t in COMPONENT_TYPES" :key="t.code" :value="t.code">{{ t.label }}</option>
        </select>
      </label>

      <label v-if="['nosecone', 'bodytube', 'transition', 'launchlug', 'innertube'].includes(type)" class="row">
        <span>长度 (m)</span>
        <input v-model.number="length" type="number" step="0.01" min="0" />
      </label>

      <label v-if="['nosecone', 'bodytube', 'transition', 'launchlug', 'innertube'].includes(type)" class="row">
        <span>{{ type === 'nosecone' ? '后端半径 (m)' : type === 'transition' ? '前端半径 (m)' : '半径 (m)' }}</span>
        <input v-model.number="radius" type="number" step="0.001" min="0" />
      </label>

      <label v-if="type === 'transition'" class="row">
        <span>后端半径 (m)</span>
        <input v-model.number="aftRadius" type="number" step="0.001" min="0" />
      </label>

      <label v-if="['nosecone', 'transition'].includes(type)" class="row">
        <span>外形</span>
        <select v-model="shape">
          <option v-for="s in SHAPES" :key="s" :value="s">{{ s }}</option>
        </select>
      </label>

      <template v-if="type === 'trapezoidfinset'">
        <label class="row"><span>片数</span><input v-model.number="finCount" type="number" step="1" min="1" /></label>
        <label class="row"><span>根弦 (m)</span><input v-model.number="rootChord" type="number" step="0.01" min="0" /></label>
        <label class="row"><span>梢弦 (m)</span><input v-model.number="tipChord" type="number" step="0.01" min="0" /></label>
        <label class="row"><span>后掠 (m)</span><input v-model.number="sweep" type="number" step="0.01" min="0" /></label>
        <label class="row"><span>高度 (m)</span><input v-model.number="finHeight" type="number" step="0.01" min="0" /></label>
        <label class="row"><span>厚度 (m)</span><input v-model.number="thickness" type="number" step="0.0001" min="0" /></label>
      </template>

      <label v-if="['parachute', 'launchlug'].includes(type)" class="row">
        <span>轴向偏移 (m)</span>
        <input v-model.number="axialOffset" type="number" step="0.01" min="0" />
      </label>

      <p v-if="type === 'trapezoidfinset'" class="tip">尾翼会挂到最后一个轴向组件（建议先添加机身管）。</p>
      <p v-else-if="type === 'parachute'" class="tip">降落伞挂到最后一个轴向组件，轴向偏移为相对其顶部的距离。</p>
    </div>
    <div class="foot">
      <button class="ok" @click="submit">添加到当前级</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: fixed; top: 64px; right: 24px; width: 300px; z-index: 30;
  background: #fff; border: 1px solid #d5dde5; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(43, 52, 64, 0.14);
  font-size: 13px; color: var(--text);
}
.head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid #e8edf2; }
.t { font-weight: 600; }
.x { border: none; background: none; cursor: pointer; color: #8a97a6; font-size: 13px; }
.body { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; max-height: 60vh; overflow: auto; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.row span { color: #5f7386; flex: none; }
.row input, .row select {
  width: 120px; padding: 4px 6px; border: 1px solid #ccd5df; border-radius: 5px; font-size: 13px;
}
.tip { font-size: 11px; color: #8a97a6; margin: 0; line-height: 1.5; }
.foot { padding: 10px 14px; border-top: 1px solid #e8edf2; text-align: right; }
.ok { background: #3b6ea5; color: #fff; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 13px; }
.ok:hover { background: #345f8f; }
</style>
