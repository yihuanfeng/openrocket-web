<script setup lang="ts">
// 发动机配置 Tab：对齐 OpenRocket Motors & Configurations 页
// 左：飞行配置列表；右：Motor mounts（每座独立选发动机 + 移除 + 点火时序）
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { MotorSpec } from '../lib/engines';

export interface MountItemData {
  path: string;
  compName: string;
  type: string;
  outerDiaMM: number;
  motorId: string | null;
  motor: MotorSpec | null;
  ignitionDelay: number;
  fitting: MotorSpec[];
}

interface CfgRow { id: string; name: string; }

const { t } = useI18n();
const props = defineProps<{
  configs: CfgRow[];
  currentConfigId: string;
  motors: MotorSpec[];
  mounts: MountItemData[];
}>();const emit = defineEmits<{
  switchConfig: [id: string];
  newConfig: [];
  deleteConfig: [];
  renameConfig: [id: string, name: string];
  copyConfig: [];
  setMountMotor: [path: string, motorId: string | null];
  setIgnDelay: [path: string, delay: number];
  motorImport: [text: string];
}>();

const renaming = ref<string | null>(null);
const renameText = ref('');
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
function startRename(c: CfgRow): void {
  renaming.value = c.id;
  renameText.value = c.name;
}
function commitRename(c: CfgRow): void {
  const x = renameText.value.trim();
  if (x) emit('renameConfig', c.id, x);
  renaming.value = null;
}
/** 座径文本：0/未知 显示 '—'（官方 .ork 内管无 radius 时继承所在管） */
function diaText(m: MountItemData): string {
  return m.outerDiaMM > 0 ? `${m.outerDiaMM.toFixed(0)}mm` : '—';
}

// —— 选中发动机座 ——
const selectedMount = ref<string | null>(props.mounts[0]?.path ?? null);
watch(() => props.mounts, (list) => {
  if (list.length === 0) { selectedMount.value = null; return; }
  if (!selectedMount.value || !list.some((m) => m.path === selectedMount.value)) {
    selectedMount.value = list[0].path;
  }
}, { immediate: true });

const selectedItem = computed(() => props.mounts.find((m) => m.path === selectedMount.value) ?? null);

/** 发动机下拉候选：适配发动机 + 当前已选（即使不适配也保留显示） */
function motorOptions(item: MountItemData): MotorSpec[] {
  const fitIds = new Set(item.fitting.map((m) => m.id));
  const extra = item.motor && !fitIds.has(item.motor.id) ? [item.motor] : [];
  return [...item.fitting, ...extra];
}
function isFitted(item: MountItemData, m: MotorSpec): boolean {
  return item.fitting.some((x) => x.id === m.id);
}
function onMountMotor(e: Event, item: MountItemData): void {
  const id = (e.target as HTMLSelectElement).value;
  emit('setMountMotor', item.path, id === '__none__' ? null : id);
}
function onIgnDelay(e: Event, item: MountItemData): void {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (Number.isFinite(v) && v >= 0) emit('setIgnDelay', item.path, v);
}
function removeMotor(item: MountItemData): void {
  emit('setMountMotor', item.path, null);
}

/** 配置摘要：已装发动机数 / 首发动机名（当前配置即 props.mounts，App 已对齐） */
function cfgSummary(): string {
  const cfg = props.mounts;
  const n = cfg.filter((m) => m.motor).length;
  if (n === 0) return t('mcp.noMotor');
  const first = cfg.find((m) => m.motor);
  return `${n} × ${first?.motor?.name ?? ''}`;
}

function classOf(m: MotorSpec): string {
  return m.class ?? '';
}
function diaOf(m: MotorSpec): string {
  return `${m.diameterMM}×${m.lengthMM}mm`;
}

const engInput = ref<HTMLInputElement | null>(null);
function onEngFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  f.text().then((x) => { emit('motorImport', x); if (engInput.value) engInput.value.value = ''; });
}
</script>

<template>
  <div class="mcp">
    <!-- 左：飞行配置列表 -->
    <aside class="mcp-left" :style="{ width: mcpLeftW + 'px' }">
      <div class="mcp-head">
        <span class="mcp-title">{{ t('mcp.flightConfig') }}</span>
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
            <span class="cfg-motor">{{ cfgSummary() }}</span>
          </template>
        </div>
      </div>
      <div class="cfg-ops">
        <button class="cfg-btn" :title="t('mcp.newCfg')" @click="emit('newConfig')">＋ {{ t('mcp.new') }}</button>
        <button class="cfg-btn" :disabled="configs.length <= 1" :title="t('mcp.delCfg')" @click="emit('deleteConfig')">－ {{ t('mcp.delete') }}</button>
        <button class="cfg-btn" :disabled="!currentConfigId" :title="t('mcp.renameCfg')" @click="startRename(configs.find((c) => c.id === currentConfigId) ?? configs[0])">✎ {{ t('mcp.rename') }}</button>
        <button class="cfg-btn" :title="t('mcp.copyCfg')" @click="emit('copyConfig')">⧉ {{ t('mcp.copy') }}</button>
      </div>
      <p class="mcp-tip">{{ t('mcp.tip') }}</p>
    </aside>

    <!-- 分隔条：拖拽调整配置列表宽度 -->
    <div class="mcp-resize" :title="t('mcp.dragW')" @mousedown.prevent="startMcpResize($event)"></div>

    <!-- 右：Motor mounts（逐座配置） -->
    <section class="mcp-right">
      <div class="mcp-head">
        <span class="mcp-title">{{ t('mcp.mountTitle') }}</span>
        <span class="mcp-sub">Motor Mounts · per-mount engine</span>
      </div>

      <!-- Motor mounts 列表 -->
      <div class="mcp-block">
        <div class="block-title">{{ t('mcp.mounts') }}</div>
        <div v-if="mounts.length === 0" class="mcp-empty">
          {{ t('mcp.noMounts') }}
        </div>
        <div v-else class="mount-list">
          <div
            v-for="item in mounts"
            :key="item.path"
            class="mount-row"
            :class="{ on: item.path === selectedMount }"
            @click="selectedMount = item.path"
          >
            <span class="mount-check">{{ item.motor ? '■' : '□' }}</span>
            <span class="mount-name">{{ item.compName }}</span>
            <span class="mount-type">{{ item.type === 'innertube' ? t('mcp.innerTube') : t('mcp.bodyTube') }}</span>
            <span class="mount-dia">{{ diaText(item) }}</span>
            <span class="mount-motor" :class="{ empty: !item.motor }">
              {{ item.motor ? item.motor.name : t('mcp.noMotor') }}
            </span>
          </div>
        </div>
      </div>

      <!-- 选中发动机座的配置区 -->
      <div v-if="selectedItem" class="mcp-block">
        <div class="block-title">
          {{ selectedItem.compName }}
          <span class="block-sub">{{ selectedItem.type === 'innertube' ? t('mcp.innerTube') : t('mcp.bodyTube') }} · {{ t('mcp.mountDia', { d: diaText(selectedItem) }) }}</span>
        </div>

        <div class="motor-pick">
          <select class="motor-select" :value="selectedItem.motorId ?? '__none__'" @change="(e) => selectedItem && onMountMotor(e, selectedItem)">
            <option value="__none__">{{ t('mcp.noMotor') }}</option>
            <option
              v-for="m in selectedItem ? motorOptions(selectedItem) : []"
              :key="m.id"
              :value="m.id"
            >
              {{ m.name }}（{{ diaOf(m) }} · {{ classOf(m) }} · {{ m.totalImpulseNs.toFixed(1) }} N·s · {{ t('sim.delay', { d: m.delay }) }}）
            </option>
          </select>
          <button class="eng-import" @click="engInput?.click()">{{ t('sim.importEng') }}</button>
          <input ref="engInput" type="file" accept=".eng,.rse,.txt" hidden @change="onEngFile" />
        </div>
        <div v-if="selectedItem.motor && !isFitted(selectedItem, selectedItem.motor)" class="fit-warn">
          ⚠ {{ t('mcp.unfitted', { m: selectedItem.motor.name, d: selectedItem.motor.diameterMM }) }}
        </div>

        <div v-if="selectedItem.motor" class="motor-specs">
          <div class="spec-grid">
            <div class="spec"><span class="sp-label">{{ t('mcp.maxThrust') }}</span><span class="sp-val">{{ selectedItem.motor.maxThrust.toFixed(1) }} N</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.avgThrust') }}</span><span class="sp-val">{{ (selectedItem.motor.totalImpulseNs / selectedItem.motor.burnTime).toFixed(1) }} N</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.burnTime') }}</span><span class="sp-val">{{ selectedItem.motor.burnTime.toFixed(1) }} s</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.totalImpulse') }}</span><span class="sp-val">{{ selectedItem.motor.totalImpulseNs.toFixed(1) }} N·s</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.delay') }}</span><span class="sp-val">{{ selectedItem.motor.delay }} s</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.mass') }}</span><span class="sp-val">{{ (selectedItem.motor.mass0 * 1000).toFixed(0) }} g</span></div>
            <div class="spec"><span class="sp-label">{{ t('mcp.size') }}</span><span class="sp-val">{{ diaOf(selectedItem.motor) }}</span></div>
          </div>
        </div>

        <div class="ign-row">
          <label class="ign-label">{{ t('mcp.ignDelay') }}</label>
          <input
            class="ign-input"
            type="number"
            min="0"
            step="0.1"
            :value="selectedItem.ignitionDelay"
            @change="(e) => selectedItem && onIgnDelay(e, selectedItem)"
          />
          <span class="ign-unit">s</span>
          <span class="ign-note">{{ t('mcp.ignHint') }}</span>
          <button class="eng-remove" :disabled="!selectedItem.motor" @click="removeMotor(selectedItem)">{{ t('mcp.removeMotor') }}</button>
        </div>
      </div>

      <p v-else class="mcp-empty">{{ t('mcp.noMountsSel') }}</p>
    </section>
  </div>
</template>

<style scoped>
.mcp { display: flex; width: 100%; height: 100%; min-height: 0; gap: 0; }
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
.block-sub { font-size: 11px; color: var(--text-3); font-weight: 400; margin-left: 6px; }
.mcp-empty { font-size: 12px; color: var(--text-3); line-height: 1.6; padding: 6px 0; }
.mount-list { display: flex; flex-direction: column; gap: 3px; }
.mount-row {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px; font-size: 13px;
  cursor: pointer; border: 1px solid transparent; border-radius: 7px;
}
.mount-row:hover { background: var(--gray-50, #f5f6f8); }
.mount-row.on { background: var(--primary-soft); border-color: var(--blue-200); }
.mount-check { color: var(--primary); font-size: 12px; flex: none; }
.mount-name { font-weight: 500; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mount-type { font-size: 11px; color: var(--text-3); flex: none; }
.mount-dia { font-size: 11px; color: var(--text-3); flex: none; font-variant-numeric: tabular-nums; }
.mount-motor { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--primary-strong); flex: none; }
.mount-motor.empty { color: var(--text-3); font-weight: 400; }

.motor-pick { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.motor-select {
  font: inherit; font-size: 13px; color: var(--text); background: var(--bg);
  border: 1px solid var(--gray-200); border-radius: 7px; padding: 5px 10px; max-width: 320px; flex: 1;
}
.eng-import {
  font: inherit; font-size: 11px; color: var(--blue-700); background: transparent;
  border: 1px solid var(--blue-300); border-radius: 6px; padding: 3px 9px; cursor: pointer; flex: none;
}
.eng-import:hover { background: var(--blue-50, #e8f2ff); }
.fit-warn {
  font-size: 11px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a;
  border-radius: 6px; padding: 5px 9px; margin-bottom: 10px; line-height: 1.5;
}
.spec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
.spec { background: var(--bg); border: 1px solid var(--gray-100); border-radius: 8px; padding: 7px 10px; display: flex; flex-direction: column; gap: 1px; }
.sp-label { font-size: 10px; color: var(--text-3); }
.sp-val { font-size: 13px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }

.ign-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.ign-label { font-size: 12px; font-weight: 600; color: var(--text-2); }
.ign-input {
  font: inherit; font-size: 13px; width: 70px; padding: 4px 8px;
  border: 1px solid var(--gray-200); border-radius: 6px; color: var(--text);
}
.ign-unit { font-size: 12px; color: var(--text-3); }
.ign-note { font-size: 11px; color: var(--text-3); }
.eng-remove {
  font: inherit; font-size: 11px; color: #dc2626; background: transparent;
  border: 1px solid #fecaca; border-radius: 6px; padding: 3px 9px; cursor: pointer; margin-left: auto;
}
.eng-remove:hover:not(:disabled) { background: #fef2f2; }
.eng-remove:disabled { opacity: 0.4; cursor: default; }
</style>
