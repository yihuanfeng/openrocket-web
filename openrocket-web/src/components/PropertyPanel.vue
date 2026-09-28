<script setup lang="ts">
// 属性面板（阶段 2 编辑闭环）：支持数值编辑 + 删除组件
import { computed } from 'vue';
import type { RocketComponent } from '../lib/types';
import { MATERIALS, TUBES, SURFACES, nearestTube } from '../lib/materials';
import { MOTORS } from '../lib/engines';

const props = defineProps<{ component: RocketComponent | null; hovered?: RocketComponent | null }>();
const emit = defineEmits<{
  (e: 'changed'): void;
  (e: 'remove'): void;
}>();

// 可编辑数值字段（key, 显示名, 单位；finset 参数存 properties，其余为组件字段）
const EDITABLE: Record<string, Array<[string, string, string]>> = {
  nosecone: [['length', '长度', 'm'], ['radius', '半径', 'm']],
  bodytube: [['length', '长度', 'm'], ['radius', '半径', 'm']],
  transition: [['length', '长度', 'm'], ['radius', '前端半径', 'm'], ['aftRadius', '后端半径', 'm']],
  trapezoidfinset: [
    ['fincount', '翼片数', ''],
    ['rootchord', '根弦', 'm'],
    ['tipchord', '梢弦', 'm'],
    ['sweep', '后掠', 'm'],
    ['height', '高度', 'm'],
    ['thickness', '厚度', 'm'],
  ],
  parachute: [['axialOffset', '轴向偏移', 'm']],
  launchlug: [['axialOffset', '轴向偏移', 'm'], ['length', '长度', 'm'], ['radius', '半径', 'm']],
  innertube: [['length', '长度', 'm'], ['radius', '半径', 'm']],
  ellipticalfinset: [
    ['fincount', '翼片数', ''],
    ['rootchord', '根弦', 'm'],
    ['height', '高度', 'm'],
    ['thickness', '厚度', 'm'],
  ],
  freeformfinset: [
    ['fincount', '翼片数', ''],
    ['rootchord', '根弦', 'm'],
    ['tipchord', '梢弦', 'm'],
    ['sweep', '后掠', 'm'],
    ['height', '高度', 'm'],
    ['thickness', '厚度', 'm'],
  ],
  tubecoupler: [['length', '长度', 'm'], ['radius', '半径', 'm']],
  bulkhead: [['length', '厚度', 'm'], ['radius', '半径', 'm']],
  centeringring: [['length', '厚度', 'm'], ['radius', '半径', 'm']],
  engineblock: [['length', '长度', 'm'], ['radius', '半径', 'm']],
  masscomponent: [['axialOffset', '轴向偏移', 'm'], ['mass', '质量', 'kg']],
  streamer: [['axialOffset', '轴向偏移', 'm'], ['length', '长度', 'm']],
  shockcord: [['axialOffset', '轴向偏移', 'm'], ['cordlength', '绳长', 'm']],
};

const SHAPES = ['ogive', 'conical', 'parabolic', 'power', 'haack'];
const DEPLOY_ALTITUDES = [0, 100, 200, 300, 400, 500];

// —— P0-3 增强选择器：材料（全部组件）/ 标准直径 / 表面处理 / 伞部署 ——
const TUBE_TYPES = ['bodytube', 'innertube', 'tubecoupler'];
const SURFACE_TYPES = ['nosecone', 'bodytube', 'transition'];
const DEPLOY_TYPES = ['parachute', 'streamer'];

const showMaterial = computed(() => !!props.component && Object.prototype.hasOwnProperty.call(EDITABLE, props.component.type));
const showMotor = computed(() => !!props.component && props.component.type === 'innertube');
const showTube = computed(() => !!props.component && TUBE_TYPES.includes(props.component.type));
const showSurface = computed(() => !!props.component && SURFACE_TYPES.includes(props.component.type));
const showDeploy = computed(() => !!props.component && DEPLOY_TYPES.includes(props.component.type));

const tubeValue = computed(() => {
  const c = props.component;
  if (!c) return '';
  const saved = c.properties['tube'];
  if (saved && TUBES.some((t) => t.id === saved)) return saved;
  return nearestTube(Number(c.radius) || 0);
});
function onTubeChange(e: Event): void {
  const c = props.component;
  if (!c) return;
  const id = (e.target as HTMLSelectElement).value;
  const t = TUBES.find((x) => x.id === id);
  if (t) {
    c.radius = t.radiusM;
    c.properties['tube'] = t.id;
  } else {
    c.properties['tube'] = '';
  }
  emit('changed');
}
function onPropChange(key: string, e: Event): void {
  const c = props.component;
  if (!c) return;
  c.properties[key] = (e.target as HTMLSelectElement).value;
  emit('changed');
}

const editableFields = computed<Array<[string, string, string]>>(
  () => (props.component ? EDITABLE[props.component.type] ?? [] : []),
);

function fieldVal(key: string): string {
  const c = props.component;
  if (!c) return '';
  const v = getNum(c, key);
  return isNaN(v) ? '' : String(v);
}

function getNum(c: RocketComponent, key: string): number {
  if (key === 'length' || key === 'radius' || key === 'aftRadius' || key === 'axialOffset') {
    return (c as unknown as Record<string, number>)[key];
  }
  const raw = c.properties[key];
  if (raw === undefined) return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
}

function setNum(c: RocketComponent, key: string, v: number): void {
  if (key === 'length' || key === 'radius' || key === 'aftRadius' || key === 'axialOffset') {
    (c as unknown as Record<string, number>)[key] = v;
  } else {
    c.properties[key] = String(v);
  }
}

function onNumChange(key: string, e: Event): void {
  const c = props.component;
  if (!c) return;
  const input = e.target as HTMLInputElement;
  const v = parseFloat(input.value);
  if (isNaN(v) || v < 0) {
    // 非法输入：回退显示原值
    input.value = fieldVal(key);
    return;
  }
  setNum(c, key, v);
  emit('changed');
}

function onShapeChange(e: Event): void {
  const c = props.component;
  if (!c) return;
  const v = (e.target as HTMLSelectElement).value;
  if (!v || c.shape === v) return;
  c.shape = v;
  emit('changed');
}

function onNameChange(e: Event): void {
  const c = props.component;
  if (!c) return;
  const v = (e.target as HTMLInputElement).value.trim();
  if (!v || c.name === v) return;
  c.name = v;
  emit('changed');
}

const readOnlyItems = computed<Array<[string, string]>>(() => {
  const c = props.component;
  if (!c) return [];
  const out: Array<[string, string]> = [];
  out.push(['名称', c.name]);
  out.push(['类型', c.type]);
  const skipKeys = new Set(['material', 'tube', 'surface', 'deployAlt', 'overridemass', 'massoverride', 'shape']);
  for (const [k, v] of Object.entries(c.properties)) {
    if (EDITABLE[c.type]?.some(([ek]) => ek === k)) continue;
    if (skipKeys.has(k)) continue;
    out.push([k, v]);
  }
  return out;
});
</script>

<template>
  <div class="panel">
    <div v-if="props.hovered && props.hovered !== component" class="hover-tip">
      悬停：{{ props.hovered.name }} · {{ props.hovered.type }}
    </div>
    <template v-if="component">
      <div class="head">
        <input class="comp-name" :value="component.name" title="点击修改组件名称" @change="onNameChange" />
        <button class="del" title="删除该组件（含子组件）" @click="emit('remove')">删除</button>
      </div>
      <table>
        <tbody>
          <tr v-for="([key, label, unit]) in editableFields" :key="'e-' + key">
            <td class="k">{{ label }}</td>
            <td class="v">
              <input
                class="num"
                type="number"
                step="any"
                min="0"
                :value="fieldVal(key)"
                @change="onNumChange(key, $event)"
              />
              <span v-if="unit" class="unit">{{ unit }}</span>
            </td>
          </tr>
          <tr v-if="showMaterial">
            <td class="k">材料</td>
            <td class="v">
              <select class="sel" :value="component.properties['material'] || ''" @change="onPropChange('material', $event)">
                <option value="">默认</option>
                <option v-for="m in MATERIALS" :key="m.name" :value="m.name">{{ m.name }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="showMotor">
            <td class="k">发动机</td>
            <td class="v">
              <select class="sel" :value="component.properties['motorId'] || ''" @change="onPropChange('motorId', $event)">
                <option value="">默认（仿真面板选择）</option>
                <option v-for="m in MOTORS" :key="m.id" :value="m.id">{{ m.name }}（{{ m.class }}级 · {{ m.totalImpulseNs.toFixed(1) }} N·s · 延迟{{ m.delay }}s）</option>
              </select>
            </td>
          </tr>
          <tr v-if="showTube">
            <td class="k">标准直径</td>
            <td class="v">
              <select class="sel" :value="tubeValue" @change="onTubeChange">
                <option value="">自定义</option>
                <option v-for="t in TUBES" :key="t.id" :value="t.id">
                  {{ t.id }}（Ø{{ (t.radiusM * 2 * 1000).toFixed(1) }} mm）
                </option>
              </select>
            </td>
          </tr>
          <tr v-if="showSurface">
            <td class="k">表面处理</td>
            <td class="v">
              <select class="sel" :value="component.properties['surface'] || 'standard'" @change="onPropChange('surface', $event)">
                <option v-for="s in SURFACES" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="showDeploy">
            <td class="k">开伞高度</td>
            <td class="v">
              <select class="sel" :value="component.properties['deployAlt'] || '0'" @change="onPropChange('deployAlt', $event)">
                <option v-for="a in DEPLOY_ALTITUDES" :key="a" :value="String(a)">{{ a === 0 ? '远地点（0 m）' : a + ' m' }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="component.shape && (component.type === 'nosecone' || component.type === 'transition')">
            <td class="k">形状</td>
            <td class="v">
              <select class="sel" :value="component.shape" @change="onShapeChange">
                <option v-for="s in SHAPES" :key="s" :value="s">{{ s }}</option>
              </select>
            </td>
          </tr>
          <tr v-for="([k, v]) in readOnlyItems" :key="'r-' + k">
            <td class="k">{{ k }}</td>
            <td class="v">{{ v }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <div v-else class="empty">在左侧选择一个组件</div>
  </div>
</template>

<style scoped>
.panel { font-size: 13px; background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-lg); padding: 12px 14px; }
.hover-tip { background: var(--blue-100); color: var(--primary-strong); border: 1px solid var(--blue-200); border-radius: var(--r-sm); padding: 6px 10px; font-size: 12px; margin-bottom: 10px; }
.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.comp-name {
  font-weight: 600; color: var(--text); font-size: 14px;
  border: 1px solid transparent; border-radius: 6px; padding: 2px 6px;
  background: transparent; min-width: 0; flex: 1;
}
.comp-name:hover { border-color: var(--line, rgba(120,140,180,0.35)); }
.comp-name:focus { outline: none; border-color: var(--accent, #0a84ff); background: #fff; }
.del {
  background: none; border: 1px solid var(--red-300, #f5c6c6); color: #dc2626; border-radius: 6px;
  font-size: 12px; padding: 3px 10px; cursor: pointer; flex: none;
}
.del:hover { background: var(--red-soft, #fdf2f1); }
table { width: 100%; border-collapse: collapse; }
tr { border-bottom: 1px solid var(--gray-100); }
tr:last-child { border-bottom: none; }
td { padding: 6px 4px; vertical-align: middle; }
.k { color: var(--text-2); width: 40%; font-size: 12px; }
.v { word-break: break-all; font-size: 13px; color: var(--text); font-variant-numeric: tabular-nums; }
.num {
  width: 96px; padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
  font-size: 13px; color: var(--text); background: #fff; font-variant-numeric: tabular-nums;
}
.num:focus { outline: none; border-color: var(--primary); box-shadow: var(--focus-ring); }
.sel { padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); font-size: 13px; }
.unit { color: var(--text-3); margin-left: 4px; font-size: 11px; }
.empty { color: var(--text-3); padding: 14px; text-align: center; background: #fff; border: 1px dashed var(--border); border-radius: 10px; }
</style>
