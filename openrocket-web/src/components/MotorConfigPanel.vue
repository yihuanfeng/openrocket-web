<script setup lang="ts">
// 发动机配置 Tab：对齐 OpenRocket Motors & Configuration 页
// 左：飞行配置列表；右：Motor mounts + 电机选择 + 点火方式
import { ref, computed } from 'vue';
import type { RocketComponent } from '../lib/types';
import type { MotorSpec } from '../lib/engines';

interface FlightConfig { id: string; name: string; motorId: string; }

const props = defineProps<{
  configs: FlightConfig[];
  currentConfigId: string;
  motors: MotorSpec[];
  motorId: string;
  mounts: RocketComponent[]; // 可装电机的组件（电机座）
}>();
const emit = defineEmits<{
  switchConfig: [id: string];
  newConfig: [];
  deleteConfig: [];
  renameConfig: [id: string, name: string];
  copyConfig: [];
  motorChange: [m: MotorSpec];
  motorImport: [text: string];
}>();

const renaming = ref<string | null>(null);
const renameText = ref('');
// 左侧配置列表宽度（可拖拽，持久化）
const mcpLeftW = ref(Number(localStorage.getItem('ork:mcpLeftW')) || 248);
function startMcpResize(e: MouseEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startW = mcpLeftW.value;
  const onMove = (ev: MouseEvent) => {
    mcpLeftW.value = Math.min(420, Math.max(160, startW + (ev.clientX - startX)));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    localStorage.setItem('ork:mcpLeftW', String(mcpLeftW.value));
  };
  document.body.style.cursor = 'col-resize';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}
function startRename(c: FlightConfig): void {
  renaming.value = c.id;
  renameText.value = c.name;
}
function commitRename(c: FlightConfig): void {
  const t = renameText.value.trim();
  if (t) emit('renameConfig', c.id, t);
  renaming.value = null;
}

const currentMotor = computed(() => props.motors.find((m) => m.id === props.motorId) ?? props.motors[0]);
const engInput = ref<HTMLInputElement | null>(null);
function onEngSelect(e: Event): void {
  const id = (e.target as HTMLSelectElement).value;
  const m = props.motors.find((x) => x.id === id);
  if (m) emit('motorChange', m);
}
function onEngFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  f.text().then((t) => { emit('motorImport', t); if (engInput.value) engInput.value.value = ''; });
}

// 总冲量字母档（官方：A=2.5-5 N·s，B=5-10，C=10-20，D=20-40，E=40-80，F=80-160，G=160-320）
function classOf(m: MotorSpec): string {
  return m.class ?? '';
}
</script>

<template>
  <div class="mcp">
    <!-- 左：飞行配置列表 -->
    <aside class="mcp-left" :style="{ width: mcpLeftW + 'px' }">
      <div class="mcp-head">
        <span class="mcp-title">飞行配置</span>
        <span class="mcp-sub">Flight Configurations</span>
      </div>
      <div class="cfg-list">
        <div
          v-for="c in configs"
          :key="c.id"
          class="cfg-row"
          :class="{ on: c.id === currentConfigId }"
          @click="emit('switchConfig', c.id)"
        >
          <span class="cfg-dot"></span>
          <template v-if="renaming === c.id">
            <input
              v-model="renameText"
              class="cfg-rename"
              @keyup.enter="commitRename(c)"
              @keyup.esc="renaming = null"
              @blur="commitRename(c)"
            />
          </template>
          <template v-else>
            <span class="cfg-name">{{ c.name }}</span>
            <span class="cfg-motor">{{ c.motorId }}</span>
          </template>
        </div>
      </div>
      <div class="cfg-ops">
        <button class="cfg-btn" title="新建配置（复制当前发动机）" @click="emit('newConfig')">＋ 新建</button>
        <button class="cfg-btn" :disabled="configs.length <= 1" title="删除当前配置" @click="emit('deleteConfig')">－ 删除</button>
        <button class="cfg-btn" :disabled="!currentConfigId" title="重命名当前配置" @click="startRename(configs.find((c) => c.id === currentConfigId) ?? configs[0])">✎ 重命名</button>
        <button class="cfg-btn" title="复制当前配置" @click="emit('copyConfig')">⧉ 复制</button>
      </div>
      <p class="mcp-tip">配置 = 发动机选择方案；切换配置即切换仿真发动机。</p>
    </aside>

    <!-- 分隔条：拖拽调整配置列表宽度 -->
    <div class="mcp-resize" title="拖拽调整宽度" @mousedown.prevent="startMcpResize($event)"></div>

    <!-- 右：Motor mounts + Select motor -->
    <section class="mcp-right">
      <div class="mcp-head">
        <span class="mcp-title">电机安装与选择</span>
        <span class="mcp-sub">Motor Mounts & Select</span>
      </div>

      <!-- Motor mounts -->
      <div class="mcp-block">
        <div class="block-title">Motor Mounts（电机座）</div>
        <div v-if="mounts.length === 0" class="mcp-empty">
          当前设计没有电机座。添加「内管（发动机架管）」或把「机身管」设为电机座后，可在此选择发动机。
        </div>
        <div v-else class="mount-list">
          <div v-for="(m, i) in mounts" :key="i" class="mount-row">
            <span class="mount-check">☑</span>
            <span class="mount-name">{{ m.name }}</span>
            <span class="mount-type">{{ m.type === 'innertube' ? '内管' : '机身管' }}</span>
          </div>
        </div>
      </div>

      <!-- Select motor -->
      <div class="mcp-block">
        <div class="block-title">Select Motor（选择发动机）</div>
        <div class="motor-pick">
          <select class="motor-select" :value="motorId" @change="onEngSelect">
            <option v-for="m in motors" :key="m.id" :value="m.id">
              {{ m.name }}（{{ classOf(m) }} 级 · {{ m.totalImpulseNs.toFixed(1) }} N·s · 延迟 {{ m.delay }}s）
            </option>
          </select>
          <button class="eng-import" @click="engInput?.click()">导入 .eng</button>
          <input ref="engInput" type="file" accept=".eng,.rse,.txt" hidden @change="onEngFile" />
        </div>
        <div v-if="currentMotor" class="motor-specs">
          <div class="spec-grid">
            <div class="spec"><span class="sp-label">最大推力</span><span class="sp-val">{{ currentMotor.maxThrust.toFixed(1) }} N</span></div>
            <div class="spec"><span class="sp-label">平均推力</span><span class="sp-val">{{ (currentMotor.totalImpulseNs / currentMotor.burnTime).toFixed(1) }} N</span></div>
            <div class="spec"><span class="sp-label">燃时</span><span class="sp-val">{{ currentMotor.burnTime.toFixed(1) }} s</span></div>
            <div class="spec"><span class="sp-label">总冲量</span><span class="sp-val">{{ currentMotor.totalImpulseNs.toFixed(1) }} N·s</span></div>
            <div class="spec"><span class="sp-label">抛射延迟</span><span class="sp-val">{{ currentMotor.delay }} s</span></div>
            <div class="spec"><span class="sp-label">质量</span><span class="sp-val">{{ (currentMotor.mass0 * 1000).toFixed(0) }} g</span></div>
          </div>
        </div>
      </div>

      <!-- Ignition -->
      <div class="mcp-block">
        <div class="block-title">Ignition（点火方式）</div>
        <div class="ign-row">
          <span class="ign-opt"><span class="radio on"></span>自动（抛射药点燃下一级）</span>
          <span class="ign-note">Web 版当前支持自动点火与延迟优化，见「模拟发射」Tab。</span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mcp { display: flex; height: 100%; min-height: 0; gap: 0; }
.mcp-left {
  flex: none; border-right: 1px solid var(--border);
  display: flex; flex-direction: column; padding: 14px 14px 10px; min-height: 0; overflow: auto;
}
.mcp-resize {
  flex: none; width: 5px; cursor: col-resize; position: relative; z-index: 8;
  background: var(--border); transition: background 0.15s ease;
}
.mcp-resize::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 1px; width: 3px;
  background: transparent; transition: background 0.15s ease;
}
.mcp-resize:hover::after, .mcp-resize:active::after { background: var(--primary); }
.mcp-right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px 18px; overflow: auto; }
.mcp-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.mcp-title { font-size: 15px; font-weight: 700; color: var(--text); }
.mcp-sub { font-size: 11px; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.4px; }

.cfg-list { display: flex; flex-direction: column; gap: 3px; flex: 1; min-height: 0; overflow: auto; }
.cfg-row {
  display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 7px;
  cursor: pointer; border: 1px solid transparent;
}
.cfg-row:hover { background: var(--gray-50, #f5f6f8); }
.cfg-row.on { background: var(--primary-soft); border-color: var(--blue-200); box-shadow: inset 2px 0 0 var(--primary); }
.cfg-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--gray-300); flex: none; }
.cfg-row.on .cfg-dot { background: var(--primary); }
.cfg-name { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cfg-motor { font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.cfg-rename {
  font: inherit; font-size: 12px; width: 100%; padding: 2px 6px;
  border: 1px solid var(--primary); border-radius: 5px; outline: none;
}
.cfg-ops { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
.cfg-btn {
  font: inherit; font-size: 11px; color: var(--text-2); background: #fff;
  border: 1px solid var(--gray-200); border-radius: 6px; padding: 4px 8px; cursor: pointer;
}
.cfg-btn:hover:not(:disabled) { border-color: var(--blue-300); color: var(--primary-strong); background: var(--blue-50, #e8f2ff); }
.cfg-btn:disabled { opacity: 0.4; cursor: default; }
.mcp-tip { font-size: 11px; color: var(--text-3); line-height: 1.5; margin: 12px 0 0; }

.mcp-block { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
.block-title { font-size: 12px; font-weight: 700; color: var(--text-2); margin-bottom: 8px; }
.mcp-empty { font-size: 12px; color: var(--text-3); line-height: 1.6; padding: 6px 0; }
.mount-list { display: flex; flex-direction: column; gap: 3px; }
.mount-row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 13px; }
.mount-row:hover { background: var(--gray-50, #f5f6f8); border-radius: 6px; }
.mount-check { color: var(--primary); font-size: 13px; }
.mount-name { font-weight: 500; }
.mount-type { margin-left: auto; font-size: 11px; color: var(--text-3); }

.motor-pick { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.motor-select {
  font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
  border: 1px solid var(--gray-200); border-radius: 7px; padding: 5px 10px; max-width: 300px; flex: 1;
}
.eng-import {
  font: inherit; font-size: 11px; color: var(--blue-700); background: transparent;
  border: 1px solid var(--blue-300); border-radius: 6px; padding: 3px 9px; cursor: pointer; flex: none;
}
.eng-import:hover { background: var(--blue-50, #e8f2ff); }
.spec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; }
.spec { background: var(--bg); border: 1px solid var(--gray-100); border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 1px; }
.sp-label { font-size: 10px; color: var(--text-3); }
.sp-val { font-size: 14px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

.ign-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ign-opt { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 500; }
.radio {
  width: 14px; height: 14px; border-radius: 50%; border: 1px solid var(--primary);
  display: grid; place-items: center; position: relative;
}
.radio.on::after { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--primary); }
.ign-note { font-size: 11px; color: var(--text-3); }
</style>
