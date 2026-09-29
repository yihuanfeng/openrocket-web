<script setup lang="ts">
// 阶段 3：6DOF 仿真结果面板（Tab：摘要 / 高度·速度 / 加速度·马赫）
import { nextTick, onBeforeUnmount, onMounted, ref, watch, computed } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECharts } from 'echarts/core';
import type { DelayScanResult, FlightProfile, SimConditions } from '../lib/types';
import type { MotorSpec } from '../lib/engines';
import FlightReplay3D from './FlightReplay3D.vue';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

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

function onTab(): void {
  void nextTick(resize);
}

onMounted(() => {
  if (chartA.value) instA = echarts.init(chartA.value);
  if (chartB.value) instB = echarts.init(chartB.value);
  render();
  window.addEventListener('resize', resize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize);
  instA?.dispose();
  instB?.dispose();
  instA = null;
  instB = null;
});

watch(() => props.profile, render);

const currentMotor = computed(() => props.motors.find((m) => m.id === props.motorId) ?? props.motors[0]);
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

const summaryItems = (p: FlightProfile) => [
  ['最高高度', `${p.maxAltitude_m.toFixed(1)} m`],
  ['最大速度', `${p.maxVelocity_ms.toFixed(1)} m/s`],
  ['最大加速度', `${p.maxAcceleration_ms2.toFixed(1)} m/s²`],
  ['最大马赫', p.maxMachNumber.toFixed(3)],
  ['横向风偏', `${p.windDrift_m.toFixed(1)} m`],
  ['到远地点', `${p.timeToApogee_s.toFixed(1)} s`],
  ['总飞行时间', `${p.flightTime_s.toFixed(1)} s`],
];
</script>

<template>
  <div class="sim-pane">
    <div class="pane-head">
      <span class="pane-title">仿真结果</span>
      <div v-if="profile && !profile.error" class="tabs">
        <button :class="['tab', { on: tab === 'summary' }]" @click="tab = 'summary'; onTab()">摘要</button>
        <button :class="['tab', { on: tab === 'alt' }]" @click="tab = 'alt'; onTab()">高度 · 速度</button>
        <button :class="['tab', { on: tab === 'acc' }]" @click="tab = 'acc'; onTab()">加速度 · 马赫</button>
        <button :class="['tab', { on: tab === 'replay' }]" @click="tab = 'replay'; onTab()">回放</button>
        <button :class="['tab', { on: tab === 'compare' }]" @click="tab = 'compare'; onTab()">多配置对比</button>
      </div>
    </div>

    <div class="motor-bar">
      <span class="motor-label">发动机</span>
      <select class="motor-select" :value="motorId" @change="onEngChange">
        <option v-for="m in motors" :key="m.id" :value="m.id">
          {{ m.name }}（{{ m.class }} 级 · {{ m.totalImpulseNs.toFixed(1) }} N·s · 延迟 {{ m.delay }}s）
        </option>
      </select>
      <span v-if="currentMotor" class="motor-specs">
        {{ currentMotor.maxThrust.toFixed(1) }} N 峰值 · 燃时 {{ currentMotor.burnTime.toFixed(1) }}s · {{ (currentMotor.mass0 * 1000).toFixed(0) }} g
      </span>
      <button class="motor-import" @click="engInput?.click()">导入 .eng</button>
      <input ref="engInput" type="file" accept=".eng,.rse,.txt" hidden @change="onEngFile" />
    </div>

    <div class="cond-bar">
      <span class="motor-label">条件</span>
      <label class="cond-item">风 <input class="cond-input" type="number" min="0" step="0.5" :value="conditions.windSpeed_ms" @change="onCondNum('windSpeed_ms', $event)" /> m/s</label>
      <label class="cond-item">温 <input class="cond-input" type="number" min="-50" max="60" step="1" :value="conditions.temperature_C" @change="onCondNum('temperature_C', $event)" /> °C</label>
      <label class="cond-item">压 <input class="cond-input" type="number" min="800" max="1100" step="1" :value="conditions.pressure_hPa" @change="onCondNum('pressure_hPa', $event)" /> hPa</label>
    </div>

    <div class="opt-bar">
      <button class="motor-import" :disabled="delayLoading || !profile" @click="emit('optimizeDelay')">
        {{ delayLoading ? '扫描中…' : '计算最优延迟' }}
      </button>
      <span v-if="delayScan" class="opt-result">
        最优延迟 {{ delayScan.bestDelay_s }}s（远地点 {{ delayScan.apogee_s.toFixed(1) }}s − 燃尽 {{ delayScan.burn_s.toFixed(1) }}s）
      </span>
    </div>
    <div v-if="delayScan" class="delay-table">
      <table>
        <thead><tr><th>延迟 s</th><th>高度 m</th><th>飞行 s</th><th>开伞</th></tr></thead>
        <tbody>
          <tr v-for="r in delayScan.rows" :key="r.delay_s" :class="{ best: r.delay_s === delayScan.bestDelay_s }">
            <td>{{ r.delay_s }}</td>
            <td>{{ r.maxAltitude_m.toFixed(0) }}</td>
            <td>{{ r.flightTime_s.toFixed(1) }}</td>
            <td>{{ r.deployed ? '是' : '否' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="tab === 'compare'" class="compare-box">
      <div class="opt-bar">
        <button class="motor-import" :disabled="compareLoading" @click="emit('compareAll')">
          {{ compareLoading ? '对比中…' : '对比全部电机（并行仿真）' }}
        </button>
        <span class="opt-result">{{ compareRows.length }} 个配置</span>
      </div>
      <div v-if="compareRows.length === 0" class="empty">运行一次仿真或点击「对比全部电机」生成多电机对比表。</div>
      <div v-else class="delay-table compare-table">
        <table>
          <thead><tr><th>发动机</th><th>最高高度</th><th>最大速度</th><th>最大马赫</th><th>风偏</th><th>到远地点</th><th>总飞行</th></tr></thead>
          <tbody>
            <tr
              v-for="r in compareRows"
              :key="r.motorId"
              :class="{ on: r.motorId === motorId }"
              :title="'查看 ' + r.motorName + ' 的飞行曲线'"
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
    <div v-else-if="loading" class="empty">仿真运行中…（6DOF 全飞行，约数秒）</div>
    <div v-else class="empty">尚未仿真。点击顶部「仿真」按钮运行全飞行模拟。</div>
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
