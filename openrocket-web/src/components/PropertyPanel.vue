<script setup lang="ts">
// 属性面板（阶段 2 编辑闭环）：支持数值编辑 + 删除组件
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { RocketComponent } from '../lib/types';
import { MATERIALS, TUBES, SURFACES, nearestTube } from '../lib/materials';
import { MOTORS } from '../lib/engines';

const { t } = useI18n();
const props = defineProps<{ component: RocketComponent | null; hovered?: RocketComponent | null; unitMode?: 'm' | 'mm' | 'cm'; motors?: typeof MOTORS }>();
const emit = defineEmits<{
  (e: 'changed'): void;
  (e: 'remove'): void;
  (e: 'motorIdChange', id: string): void;
}>();

// 可编辑数值字段（key, i18n label key, 单位；finset 参数存 properties，其余为组件字段）
// —— 组件参数全覆盖：轴向偏移/密度/壁厚/肩部/伞直径与 CD/尾翼倾斜与位置 ——
const EDITABLE: Record<string, Array<[string, string, string]>> = {
  nosecone: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³'], ['shoulderlength', 'prop.len.shoulderLength', 'm'], ['shoulderradius', 'prop.len.shoulderRadius', 'm']],
  bodytube: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³'], ['wallthickness', 'prop.len.wallThickness', 'm']],
  transition: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.frontRadius', 'm'], ['aftRadius', 'prop.len.aftRadius', 'm'], ['density', 'prop.len.density', 'kg/m³'], ['wallthickness', 'prop.len.wallThickness', 'm']],
  trapezoidfinset: [
    ['offset', 'prop.len.offset', 'm'],
    ['fincount', 'prop.len.finCount', ''],
    ['rootchord', 'prop.len.rootChord', 'm'],
    ['tipchord', 'prop.len.tipChord', 'm'],
    ['sweep', 'prop.len.sweep', 'm'],
    ['height', 'prop.len.height', 'm'],
    ['thickness', 'prop.len.thickness', 'm'],
    ['cant', 'prop.len.cant', '°'],
  ],
  parachute: [['axialOffset', 'prop.len.axialOffset', 'm'], ['diameter', 'prop.len.diameter', 'm'], ['cd', 'prop.len.cd', '']],
  launchlug: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  innertube: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  ellipticalfinset: [
    ['offset', 'prop.len.offset', 'm'],
    ['fincount', 'prop.len.finCount', ''],
    ['rootchord', 'prop.len.rootChord', 'm'],
    ['height', 'prop.len.height', 'm'],
    ['thickness', 'prop.len.thickness', 'm'],
    ['cant', 'prop.len.cant', '°'],
  ],
  freeformfinset: [
    ['offset', 'prop.len.offset', 'm'],
    ['fincount', 'prop.len.finCount', ''],
    ['rootchord', 'prop.len.rootChord', 'm'],
    ['tipchord', 'prop.len.tipChord', 'm'],
    ['sweep', 'prop.len.sweep', 'm'],
    ['height', 'prop.len.height', 'm'],
    ['thickness', 'prop.len.thickness', 'm'],
    ['cant', 'prop.len.cant', '°'],
  ],
  tubecoupler: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  bulkhead: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.thickness', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  centeringring: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.thickness', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  engineblock: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['radius', 'prop.len.radius', 'm'], ['density', 'prop.len.density', 'kg/m³']],
  masscomponent: [['axialOffset', 'prop.len.axialOffset', 'm'], ['mass', 'prop.len.mass', 'kg']],
  streamer: [['axialOffset', 'prop.len.axialOffset', 'm'], ['length', 'prop.len.length', 'm'], ['width', 'prop.len.width', 'm'], ['cd', 'prop.len.cd', '']],
  shockcord: [['axialOffset', 'prop.len.axialOffset', 'm'], ['cordlength', 'prop.len.cordLength', 'm']],
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

// 单位制：长度类字段（内部恒存 m）按 unitMode 显示/输入
const LEN_KEYS = new Set(['length', 'radius', 'aftRadius', 'axialOffset', 'thickness', 'wallthickness', 'shoulderlength', 'shoulderradius', 'diameter', 'width', 'cordlength', 'rootchord', 'tipchord', 'sweep', 'height', 'offset']);
const LEN_FACTOR: Record<string, number> = { m: 1, mm: 1000, cm: 100 };
function isLenKey(key: string): boolean { return LEN_KEYS.has(key); }
function fmtNum(v: number, key: string): string {
  const u = props.unitMode ?? 'mm';
  if (isLenKey(key)) {
    const scaled = v * (LEN_FACTOR[u] ?? 1);
    return u === 'm' ? scaled.toFixed(4) : u === 'cm' ? scaled.toFixed(2) : scaled.toFixed(1);
  }
  return String(v);
}

function fieldVal(key: string): string {
  const c = props.component;
  if (!c) return '';
  const v = getNum(c, key);
  return isNaN(v) ? '' : fmtNum(v, key);
}

function getNum(c: RocketComponent, key: string): number {
  if (key === 'length' || key === 'radius' || key === 'aftRadius' || key === 'axialOffset' || key === 'density') {
    return (c as unknown as Record<string, number>)[key];
  }
  const raw = c.properties[key];
  if (raw === undefined) return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
}

function setNum(c: RocketComponent, key: string, v: number): void {
  if (key === 'length' || key === 'radius' || key === 'aftRadius' || key === 'axialOffset' || key === 'density') {
    (c as unknown as Record<string, number>)[key] = v;
  } else {
    c.properties[key] = String(v);
  }
}

const invalidKeys = ref<Set<string>>(new Set());
function onNumChange(key: string, e: Event): void {
  const c = props.component;
  if (!c) return;
  const input = e.target as HTMLInputElement;
  const raw = input.value.trim();
  if (raw === '') {
    // 空输入 = 清除该属性：轴向偏移恢复「自动接续」（AFTER + 0 等效位置）
    if (key === 'axialOffset') {
      (c as unknown as { axialOffset?: number; axialMethod?: string }).axialOffset = NaN;
      (c as unknown as { axialMethod?: string }).axialMethod = undefined;
    } else {
      setNum(c, key, NaN);
    }
    const next = new Set(invalidKeys.value); next.delete(key);
    invalidKeys.value = next;
    emit('changed');
    return;
  }
  const v = parseFloat(raw);
  if (isNaN(v) || (v < 0 && key !== 'axialOffset')) {
    invalidKeys.value = new Set(invalidKeys.value).add(key);
    input.title = t('prop.invalidNum');
    return; // 保留输入框内容，红框提示
  }
  const next = new Set(invalidKeys.value); next.delete(key);
  invalidKeys.value = next;
  const store = isLenKey(key) ? v / (LEN_FACTOR[props.unitMode ?? 'mm'] ?? 1) : v;
  setNum(c, key, store);
  if (key === 'axialOffset') {
    // 轴向偏移 = 相对前一组件尾端的 AFTER 偏移；仅当组件无显式轴向方法时补语义，
    // 官方 method（bottom/middle/top）组件保持原语义，offset 作为配合量
    const cAny = c as unknown as { axialMethod?: string };
    if (!cAny.axialMethod) cAny.axialMethod = 'after';
  }
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
  out.push([t('prop.name'), c.name]);
  out.push([t('prop.type'), c.type]);
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
      {{ t('prop.hover') }}：{{ props.hovered.name }} · {{ props.hovered.type }}
    </div>
    <template v-if="component">
      <div class="head">
        <input class="comp-name" :value="component.name" :title="t('prop.editName')" @change="onNameChange" />
        <button class="del" :title="t('prop.delTip')" @click="emit('remove')">{{ t('prop.delete') }}</button>
      </div>
      <table>
        <tbody>
          <tr v-for="([key, label, unit]) in editableFields" :key="'e-' + key">
            <td class="k">{{ t(label) }}</td>
            <td class="v">
              <input
                class="num"
                :class="{ invalid: invalidKeys.has(key) }"
                type="number"
                step="any"
                min="0"
                :value="fieldVal(key)"
                @change="onNumChange(key, $event)"
              />
              <span v-if="unit" class="unit">{{ unit === 'm' ? (props.unitMode ?? 'mm') : unit }}</span>
            </td>
          </tr>
          <tr v-if="showMaterial">
            <td class="k">{{ t('prop.material') }}</td>
            <td class="v">
              <select class="sel" :value="component.properties['material'] || ''" @change="onPropChange('material', $event)">
                <option value="">{{ t('prop.default') }}</option>
                <option v-for="m in MATERIALS" :key="m.name" :value="m.name">{{ m.name }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="showMotor">
            <td class="k">{{ t('prop.motor') }}</td>
            <td class="v">
              <select
                class="sel"
                :value="component.properties['motorId'] || ''"
                @change="
                  (e) => {
                    onPropChange('motorId', e);
                    emit('motorIdChange', (e.target as HTMLSelectElement).value);
                  }
                "
              >
                <option value="">{{ t('prop.motorDefault') }}</option>
                <option v-for="m in props.motors ?? MOTORS" :key="m.id" :value="m.id">{{ m.name }}（{{ m.class }} · {{ m.totalImpulseNs.toFixed(1) }} N·s · {{ t('sim.delay', { d: m.delay }) }}）</option>
              </select>
              <span class="motor-note">{{ t('prop.motorNote') }}</span>
            </td>
          </tr>
          <tr v-if="showTube">
            <td class="k">{{ t('prop.tube') }}</td>
            <td class="v">
              <select class="sel" :value="tubeValue" @change="onTubeChange">
                <option value="">{{ t('prop.custom') }}</option>
                <option v-for="t in TUBES" :key="t.id" :value="t.id">
                  {{ t.id }}（Ø{{ (t.radiusM * 2 * 1000).toFixed(1) }} mm）
                </option>
              </select>
            </td>
          </tr>
          <tr v-if="showSurface">
            <td class="k">{{ t('prop.surface') }}</td>
            <td class="v">
              <select class="sel" :value="component.properties['surface'] || 'standard'" @change="onPropChange('surface', $event)">
                <option v-for="s in SURFACES" :key="s.id" :value="s.id">{{ t('prop.surf.' + s.id) }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="showDeploy">
            <td class="k">{{ t('prop.deployAlt') }}</td>
            <td class="v">
              <select class="sel" :value="component.properties['deployAlt'] || '0'" @change="onPropChange('deployAlt', $event)">
                <option v-for="a in DEPLOY_ALTITUDES" :key="a" :value="String(a)">{{ a === 0 ? '远地点（0 m）' : a + ' m' }}</option>
              </select>
            </td>
          </tr>
          <tr v-if="component.shape && (component.type === 'nosecone' || component.type === 'transition')">
            <td class="k">{{ t('prop.shape') }}</td>
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
    <div v-else class="empty">{{ t('prop.placeholder') }}</div>
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
.num.invalid { border-color: var(--red); box-shadow: 0 0 0 2px rgba(255, 59, 48, 0.18); }
.sel { padding: 4px 6px; border: 1px solid var(--border); border-radius: var(--r-sm); font-size: 13px; }
.motor-note { display: block; font-size: 10px; color: var(--text-3); margin-top: 3px; line-height: 1.4; }
.unit { color: var(--text-3); margin-left: 4px; font-size: 11px; }
.empty { color: var(--text-3); padding: 14px; text-align: center; background: #fff; border: 1px dashed var(--border); border-radius: 10px; }
</style>
