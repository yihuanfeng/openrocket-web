<script setup lang="ts">
// 阶段 3：6DOF 仿真结果面板（Tab：摘要 / 高度·速度 / 加速度·马赫）
import { nextTick, onBeforeUnmount, onMounted, ref, watch, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECharts } from 'echarts/core';
import type { DelayScanResult, FlightProfile, SimConditions } from '../lib/types';
import type { MotorSpec } from '../lib/engines';
import FlightReplay3D from './FlightReplay3D.vue';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const { t } = useI18n();
const props = defineProps<{
  profile: FlightProfile | null;
  loading: boolean;
  motors: MotorSpec[];
  motorId: string;
  conditions: SimConditions;
  delayScan: DelayScanResult | null;
  delayLoading: boolean;
  compareRows: Array<{ motorId: string; motorName: string; profile: FlightProfile }>;
  compareLoading: boolean;
}>();
const emit = defineEmits<{
  motorChange: [m: MotorSpec];
  motorImport: [text: string];
  conditionsChange: [c: SimConditions];
  optimizeDelay: [];
  compareAll: [];
  selectCompare: [row: { motorId: string; motorName: string; profile: FlightProfile }];
}>();

const tab = ref<'summary' | 'alt' | 'acc' | 'replay' | 'compare'>('summary');
const chartA = ref<HTMLDivElement | null>(null);
const chartB = ref<HTMLDivElement | null>(null);
let instA: ECharts | null = null;
let instB: ECharts | null = null;

const C = {
  axisLine: { lineStyle: { color: 'var(--border)' } },
  axisLabel: { color: 'var(--text-2)', fontSize: 11 },
  splitLine: { lineStyle: { color: '#eef1f5' } },
  nameTextStyle: { color: 'var(--text-2)', fontSize: 11 },
};

function seriesOf(label: string, y: number[], time: number[], color: string, yAxisIndex = 0) {
  return {
    name: label, type: 'line' as const, showSymbol: false, yAxisIndex,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    data: time.map((t, i) => [t, y[i] ?? null]),
  };
}

function render(): void {
  const p = props.profile;
  if (!instA || !instB) return;
  if (!p || p.time.length === 0) {
    instA.clear();
    instB.clear();
    return;
  }
  const time = p.time;
  const xAxis = {
    type: 'value' as const, min: 0, max: time[time.length - 1],
    name: 't (s)', nameLocation: 'middle' as const, nameGap: 24,
    axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: C.splitLine,
    nameTextStyle: C.nameTextStyle,
  };
  instA.setOption({
    animation: false,
    tooltip: { trigger: 'axis', triggerOn: 'mousemove|click', renderMode: 'richText', confine: true },
    legend: { data: ['高度', '速度'], top: 4, textStyle: { color: 'var(--text-2)', fontSize: 11 } },
    grid: { left: 48, right: 56, top: 32, bottom: 34 },
    xAxis,
    yAxis: [
      { type: 'value', name: '高度 (m)', scale: true, axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: C.splitLine, nameTextStyle: C.nameTextStyle },
      { type: 'value', name: '速度 (m/s)', scale: true, axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: { show: false }, nameTextStyle: C.nameTextStyle },
    ],
    series: [
      seriesOf('高度', p.altitude, time, 'var(--primary)'),
      seriesOf('速度', p.velocity, time, '#ff7a00', 1),
    ],
  }, true);
  instB.setOption({
    animation: false,
    tooltip: { trigger: 'axis', triggerOn: 'mousemove|click', renderMode: 'richText', confine: true },
    legend: { data: ['加速度', '马赫'], top: 4, textStyle: { color: 'var(--text-2)', fontSize: 11 } },
    grid: { left: 56, right: 56, top: 32, bottom: 34 },
    xAxis,
    yAxis: [
      { type: 'value', name: '加速度 (m/s²)', scale: true, axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: C.splitLine, nameTextStyle: C.nameTextStyle },
      { type: 'value', name: '马赫数', scale: true, axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: { show: false }, nameTextStyle: C.nameTextStyle },
    ],
    series: [
      seriesOf('加速度', p.acceleration, time, 'var(--primary)'),
      seriesOf('马赫', p.mach, time, '#7a8aa0', 1),
    ],
  }, true);
}

function resize(): void {
  instA?.resize();
  instB?.resize();
}

const summaryItems = (p: FlightProfile) => {
  const items: Array<[string, string]> = [
    [t('sim.maxAlt'), `${p.maxAltitude_m.toFixed(1)} m`],
    [t('sim.maxVel'), `${p.maxVelocity_ms.toFixed(1)} m/s`],
    [t('sim.maxAcc'), `${p.maxAcceleration_ms2.toFixed(1)} m/s²`],
    [t('sim.maxMach'), p.maxMachNumber.toFixed(3)],
    [t('sim.windDrift'), `${p.windDrift_m.toFixed(1)} m`],
    [t('sim.toApogee'), `${p.timeToApogee_s.toFixed(1)} s`],
    [t('sim.totalTime'), `${p.flightTime_s.toFixed(1)} s`],
  ];
  if (p.mass_kg) items.splice(3, 0, [t('sim.launchMass'), `${(p.mass_kg * 1000).toFixed(0)} g`]);
  if (p.twr) items.splice(4, 0, [t('sim.twr'), p.twr.toFixed(1)]);
  if (p.launchRodVelocity_ms > 0) items.push([t('sim.rodVel'), `${p.launchRodVelocity_ms.toFixed(1)} m/s`]);
  if (p.groundHitVelocity_ms > 0) items.push([t('sim.landVel'), `${p.groundHitVelocity_ms.toFixed(1)} m/s`]);
  return items;
};

// —— 多配置对比曲线（ECharts，高度-时间叠加）——
const chartC = ref<HTMLDivElement | null>(null);
let instC: ECharts | null = null;
const PALETTE = ['#0a84ff', '#ff7a00', '#22c55e', '#e11d48', '#a855f7', '#eab308', '#14b8a6', '#f97316', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];

function renderCompare(): void {
  if (!instC) return;
  const rows = props.compareRows;
  if (rows.length === 0) { instC.clear(); return; }
  let tMax = 0;
  for (const r of rows) tMax = Math.max(tMax, r.profile.time[r.profile.time.length - 1] ?? 0);
  const series = rows.map((r, i) => {
    const on = r.motorId === props.motorId;
    return {
      name: r.motorName,
      type: 'line' as const,
      showSymbol: false,
      lineStyle: { width: on ? 2.6 : 1.4, color: PALETTE[i % PALETTE.length], opacity: on ? 1 : 0.55 },
      itemStyle: { color: PALETTE[i % PALETTE.length] },
      data: r.profile.time.map((tt, j) => [tt, r.profile.altitude[j] ?? null]),
    };
  });
  instC.setOption({
    animation: false,
    tooltip: { trigger: 'axis', triggerOn: 'mousemove|click', renderMode: 'richText', confine: true },
    legend: { type: 'scroll', top: 0, textStyle: { color: 'var(--text-2)', fontSize: 10 } },
    grid: { left: 44, right: 16, top: 28, bottom: 24 },
    xAxis: {
      type: 'value', min: 0, max: tMax,
      name: 't (s)', nameLocation: 'middle', nameGap: 22,
      axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: C.splitLine, nameTextStyle: C.nameTextStyle,
    },
    yAxis: {
      type: 'value', name: '高度 (m)', nameLocation: 'middle', nameGap: 30, scale: true,
      axisLine: C.axisLine, axisLabel: C.axisLabel, splitLine: C.splitLine, nameTextStyle: C.nameTextStyle,
    },
    series,
  }, true);
}

watch(
  () => props.compareRows,
  (rows) => {
    // chartC 容器在 compare tab 首次激活后才挂载，onMounted 时可能不存在 → 惰性初始化
    if (rows.length > 0 && !instC && chartC.value) instC = echarts.init(chartC.value);
    if (tab.value === 'compare') void nextTick(renderCompare);
  },
  { deep: true },
);
watch(() => props.motorId, () => { if (tab.value === 'compare') renderCompare(); });

function onTab(): void {
  void nextTick(() => {
    resize();
    if (tab.value === 'compare') renderCompare();
  });
}

onMounted(() => {
  if (chartA.value) instA = echarts.init(chartA.value);
  if (chartB.value) instB = echarts.init(chartB.value);
  if (chartC.value) instC = echarts.init(chartC.value);
  render();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  instA?.dispose();
  instB?.dispose();
  instC?.dispose();
  instA = null;
  instB = null;
  instC = null;
});

watch(() => props.profile, render);

const currentMotor = computed(() => props.motors.find((m) => m.id === props.motorId) ?? props.motors[0]);

/** 顶部发动机下拉按来源分组：内置 Estes 全系 / motor-database 各厂商 / 用户导入 */
const motorGroups = computed(() => {
  const groups = new Map<string, typeof props.motors>();
  for (const m of props.motors) {
    let label: string;
    if (m.custom) label = t('sim.motorGroup.custom');
    else if (m.manufacturer) label = `${t('sim.motorGroup.db')} · ${m.manufacturer}`;
    else label = t('sim.motorGroup.builtin');
    const g = groups.get(label) ?? [];
    g.push(m);
    groups.set(label, g);
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }));
});
const engInput = ref<HTMLInputElement | null>(null);
function onEngChange(e: Event) {
  const id = (e.target as HTMLSelectElement).value;
  const m = props.motors.find((x) => x.id === id);
  if (m) emit('motorChange', m);
}
function onCondNum(key: keyof SimConditions, e: Event) {
  const v = parseFloat((e.target as HTMLInputElement).value);
  if (isNaN(v) || v < 0) return;
  emit('conditionsChange', { ...props.conditions, [key]: v });
}
function onEngFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  f.text().then((t) => { emit('motorImport', t); if (engInput.value) engInput.value.value = ''; });
}
</script>

<template>
  <div class="sim-pane">
    <div class="pane-head">
      <span class="pane-title">{{ t('sim.result') }}</span>
      <div v-if="profile && !profile.error" class="tabs">
        <button :class="['tab', { on: tab === 'summary' }]" @click="tab = 'summary'; onTab()">{{ t('sim.tabSummary') }}</button>
        <button :class="['tab', { on: tab === 'alt' }]" @click="tab = 'alt'; onTab()">{{ t('sim.tabAlt') }}</button>
        <button :class="['tab', { on: tab === 'acc' }]" @click="tab = 'acc'; onTab()">{{ t('sim.tabAcc') }}</button>
        <button :class="['tab', { on: tab === 'replay' }]" @click="tab = 'replay'; onTab()">{{ t('sim.tabReplay') }}</button>
        <button :class="['tab', { on: tab === 'compare' }]" @click="tab = 'compare'; onTab()">{{ t('sim.tabCompare') }}</button>
      </div>
    </div>

    <div class="motor-bar">
      <span class="motor-label">{{ t('sim.motor') }}</span>
      <select class="motor-select" :value="motorId" @change="onEngChange">
        <optgroup v-for="g in motorGroups" :key="g.label" :label="g.label">
          <option v-for="m in g.items" :key="m.id" :value="m.id">
            {{ m.name }}（{{ m.class }} · {{ m.totalImpulseNs.toFixed(1) }} N·s · {{ t('sim.delay', { d: m.delay }) }}）
          </option>
        </optgroup>
      </select>
      <span v-if="currentMotor" class="motor-specs">
        {{ t('sim.peak', { v: currentMotor.maxThrust.toFixed(1) }) }} · {{ t('sim.burn', { v: currentMotor.burnTime.toFixed(1) }) }} · {{ (currentMotor.mass0 * 1000).toFixed(0) }} g
      </span>
      <button class="motor-import" @click="engInput?.click()">{{ t('sim.importEng') }}</button>
      <input ref="engInput" type="file" accept=".eng,.rse,.txt" hidden @change="onEngFile" />
    </div>

    <div class="cond-bar">
      <span class="motor-label">{{ t('sim.conditions') }}</span>
      <label class="cond-item">{{ t('sim.wind') }} <input class="cond-input" type="number" min="0" step="0.5" :value="conditions.windSpeed_ms" @change="onCondNum('windSpeed_ms', $event)" /> m/s</label>
      <label class="cond-item">{{ t('sim.temp') }} <input class="cond-input" type="number" min="-50" max="60" step="1" :value="conditions.temperature_C" @change="onCondNum('temperature_C', $event)" /> °C</label>
      <label class="cond-item">{{ t('sim.pressure') }} <input class="cond-input" type="number" min="800" max="1100" step="1" :value="conditions.pressure_hPa" @change="onCondNum('pressure_hPa', $event)" /> hPa</label>
    </div>

    <div class="opt-bar">
      <button class="motor-import" :disabled="delayLoading || !profile" @click="emit('optimizeDelay')">
        {{ delayLoading ? t('sim.scanning') : t('sim.optDelay') }}
      </button>
      <span v-if="delayScan" class="opt-result">
        {{ t('sim.optResult', { d: delayScan.bestDelay_s, ap: delayScan.apogee_s.toFixed(1), b: delayScan.burn_s.toFixed(1) }) }}
      </span>
    </div>
    <div v-if="delayScan" class="delay-table">
      <table>
        <thead><tr><th>{{ t('sim.delayS') }}</th><th>{{ t('sim.altM') }}</th><th>{{ t('sim.flightS') }}</th><th>{{ t('sim.deploy') }}</th></tr></thead>
        <tbody>
          <tr v-for="r in delayScan.rows" :key="r.delay_s" :class="{ best: r.delay_s === delayScan.bestDelay_s }">
            <td>{{ r.delay_s }}</td>
            <td>{{ r.maxAltitude_m.toFixed(0) }}</td>
            <td>{{ r.flightTime_s.toFixed(1) }}</td>
            <td>{{ r.deployed ? t('common.yes') : t('common.no') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'compare'" class="compare-box">
      <div class="opt-bar">
        <button class="motor-import" :disabled="compareLoading" @click="emit('compareAll')">
          {{ compareLoading ? t('sim.comparing') : t('sim.compareAll') }}
        </button>
        <span class="opt-result">{{ t('sim.configCount', { n: compareRows.length }) }}</span>
      </div>
      <div v-if="compareRows.length === 0" class="empty">{{ t('sim.compareEmpty') }}</div>
      <template v-else>
        <div ref="chartC" class="chart compare-chart"></div>
        <div class="delay-table compare-table">
          <table>
            <thead><tr><th>{{ t('sim.motor') }}</th><th>{{ t('sim.maxAlt') }}</th><th>{{ t('sim.maxVel') }}</th><th>{{ t('sim.maxMach') }}</th><th>{{ t('sim.windDrift') }}</th><th>{{ t('sim.toApogee') }}</th><th>{{ t('sim.totalTime') }}</th></tr></thead>
            <tbody>
              <tr
                v-for="r in compareRows"
                :key="r.motorId"
                :class="{ on: r.motorId === motorId }"
                :title="t('sim.viewCurve', { name: r.motorName })""
                @click="emit('selectCompare', r)"
              >
                <td class="cmp-name">{{ r.motorName }}</td>
                <td>{{ r.profile.maxAltitude_m.toFixed(0) }} m</td>
                <td>{{ r.profile.maxVelocity_ms.toFixed(1) }} m/s</td>
                <td>{{ r.profile.maxMachNumber.toFixed(2) }}</td>
                <td>{{ r.profile.windDrift_m.toFixed(0) }} m</td>
                <td>{{ r.profile.timeToApogee_s.toFixed(1) }} s</td>
                <td>{{ r.profile.flightTime_s.toFixed(1) }} s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <div v-if="profile && profile.error" class="empty warn">{{ profile.error }}</div>
    <div v-else-if="profile">
      <div v-if="tab === 'summary'" class="sum-grid">
        <div v-for="([label, val]) in summaryItems(profile)" :key="label" class="sum-item">
          <span class="sum-label">{{ label }}</span>
          <span class="sum-val">{{ val }}</span>
        </div>
      </div>
      <div v-show="tab === 'alt'" ref="chartA" class="chart"></div>
      <div v-show="tab === 'acc'" ref="chartB" class="chart"></div>
      <div v-show="tab === 'replay'">
        <FlightReplay3D :profile="profile" />
      </div>
    </div>
    <div v-else-if="loading" class="empty">{{ t('sim.running') }}</div>
    <div v-else class="empty">{{ t('sim.notRun') }}</div>
  </div>
</template>

<style scoped>
.motor-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.motor-label { font-size: 11px; color: var(--text-3); font-weight: 600; }
.motor-select {
  font: inherit; font-size: 12px; color: var(--text); background: var(--bg);
  border: 1px solid var(--gray-200, #d0d0d8); border-radius: 6px; padding: 3px 8px; max-width: 280px;
}
.motor-specs { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.motor-import {
  font: inherit; font-size: 11px; color: var(--blue-700, #0060df); background: transparent;
  border: 1px solid var(--blue-300, #7cc0ff); border-radius: 6px; padding: 2px 8px; cursor: pointer;
}
.motor-import:hover { background: var(--blue-50, #e8f2ff); }
.cond-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.cond-item { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--text-3); }
.cond-input {
  width: 52px; padding: 2px 4px; border: 1px solid var(--border); border-radius: 5px;
  font-size: 11px; color: var(--text); background: #fff; font-variant-numeric: tabular-nums;
}
.opt-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.opt-result { font-size: 11px; color: var(--blue-700, #0060df); font-weight: 600; }
.delay-table { max-height: 150px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; }
.delay-table table { width: 100%; border-collapse: collapse; font-size: 11px; }
.delay-table th { position: sticky; top: 0; background: var(--bg); color: var(--text-3); font-weight: 600; padding: 4px 8px; text-align: right; border-bottom: 1px solid var(--border); }
.delay-table td { padding: 3px 8px; text-align: right; font-variant-numeric: tabular-nums; }
.delay-table tr.best { background: var(--blue-100, #e8f2ff); font-weight: 600; }
.compare-table { max-height: 220px; cursor: pointer; }
.compare-chart { height: 190px; margin-bottom: 8px; }
.compare-table tbody tr:hover { background: var(--gray-50, #f5f6f8); }
.compare-table tbody tr.on { background: var(--blue-100, #e8f2ff); font-weight: 600; }
.compare-table td.cmp-name { text-align: left; font-weight: 600; }
.sim-pane { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 12px 14px; }
.pane-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.pane-title { font-size: 12px; color: var(--text-2); font-weight: 600; }
.tabs { display: flex; gap: 4px; background: var(--gray-100); border-radius: 7px; padding: 2px; }
.tab {
  border: none; background: transparent; font: inherit; font-size: 12px; color: var(--text-2);
  padding: 4px 10px; border-radius: 5px; cursor: pointer;
}
.tab.on { background: var(--panel); color: var(--text); font-weight: 600; box-shadow: var(--sh-sm); }
.sum-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.sum-item { background: var(--bg); border: 1px solid var(--gray-100); border-radius: var(--r-md); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.sum-label { font-size: 11px; color: var(--text-3); }
.sum-val { font-size: 15px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.chart { width: 100%; height: 240px; }
.empty { color: var(--text-3); font-size: 13px; padding: 20px; text-align: center; }
.empty.warn { color: var(--red-600, #dc2626); }
</style>
