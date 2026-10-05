<template>
  <div class="db-page">
    <!-- 页头：返回 + 标题 + 筛选栏 -->
    <header class="db-top">
      <button class="btn onDark db-back" @click="emit('close')">← {{ t('db.back') }}</button>
      <div class="db-title">{{ t('db.title') }}<span class="db-title-sub">{{ t('db.subtitle') }}</span></div>
      <div class="db-top-filters">
        <input v-model="query" class="db-search" :placeholder="t('db.searchPh')" />
        <select v-model="mfg" class="db-sel" :title="t('db.manufacturer')">
          <option value="">{{ t('db.manufacturer') }} · {{ t('db.all') }}</option>
          <option v-for="m in manufacturers" :key="m" :value="m">{{ m }}</option>
        </select>
        <div class="db-chips" :title="t('db.impulseClass')">
          <button v-for="c in IMPULSE_CLASSES" :key="c" class="db-chip" :class="{ on: classes.includes(c) }" @click="toggleClass(c)">{{ c }}</button>
        </div>
        <input v-model.number="diaMin" type="number" min="0" class="db-num" :placeholder="t('db.diaMin')" :title="t('db.diameter')" />
        <span class="db-dia-sep">–</span>
        <input v-model.number="diaMax" type="number" min="0" class="db-num" :placeholder="t('db.diaMax')" :title="t('db.diameter')" />
        <select v-model="mtype" class="db-sel" :title="t('db.type')">
          <option value="">{{ t('db.type') }} · {{ t('db.all') }}</option>
          <option v-for="tp in TYPE_OPTS" :key="tp" :value="tp">{{ t('db.motorType.' + tp) }}</option>
        </select>
        <select v-model="delayMode" class="db-sel" :title="t('db.delayLabel')">
          <option value="">{{ t('db.delayLabel') }} · {{ t('db.all') }}</option>
          <option value="has">{{ t('db.delay.has') }}</option>
          <option value="none">{{ t('db.delay.none') }}</option>
        </select>
        <button class="btn mini db-reset" @click="resetFilters">{{ t('db.reset') }}</button>
      </div>
      <div class="db-count">{{ t('db.count', { n: filtered.length }) }}</div>
    </header>

    <!-- 表格 -->
    <div class="db-table-wrap">
      <table class="db-table">
        <thead>
          <tr>
            <th v-for="col in cols" :key="col.key" class="db-th" :class="{ sortable: col.sortable, asc: sortKey === col.key && sortDir === 1, desc: sortKey === col.key && sortDir === -1 }" @click="col.sortable && setSort(col.key)">
              <span>{{ t('db.col.' + col.key) }}</span><span v-if="col.sortable" class="db-sort-ic">↕</span>
            </th>
            <th class="db-th db-th-act">{{ t('db.col.action') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in pageRows" :key="e.id" class="db-row" :class="{ on: selectedId === e.id }" @click="select(e)">
            <td class="db-td-name">{{ e.d }}</td>
            <td>{{ e.m }}</td>
            <td>{{ e.cl }}</td>
            <td class="db-td-num">{{ e.dia }}</td>
            <td class="db-td-num">{{ e.len }}</td>
            <td>{{ t('db.motorType.' + e.t) || e.t }}</td>
            <td class="db-td-num">{{ fmtImp(e.ti) }}</td>
            <td class="db-td-num">{{ e.at.toFixed(1) }}</td>
            <td class="db-td-num">{{ e.mt.toFixed(1) }}</td>
            <td class="db-td-num">{{ e.bt.toFixed(1) }}</td>
            <td class="db-td-num">{{ delaysToList(e.del).join('/') || '—' }}</td>
            <td class="db-td-num">{{ fmtW(e.w0) }}</td>
            <td class="db-td-num">{{ e.files.length }}</td>
            <td class="db-td-act">
              <button
                class="btn mini db-add-row" :class="{ saved: isSaved(e) }"
                :disabled="isSaved(e)"
                @click.stop="addFromRow(e)"
              >{{ isSaved(e) ? t('db.saved') : t('db.add') }}</button>
            </td>
          </tr>
          <tr v-if="filtered.length === 0"><td :colspan="cols.length + 1" class="db-empty">{{ t('db.empty') }}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 分页 -->
    <div class="db-pager">
      <button class="btn mini" :disabled="page <= 1" @click="page--">‹</button>
      <span class="db-page">{{ page }} / {{ pageCount }}</span>
      <button class="btn mini" :disabled="page >= pageCount" @click="page++">›</button>
      <select v-model="pageSize" class="db-sel db-page-size">
        <option :value="20">20</option>
        <option :value="50">50</option>
        <option :value="100">100</option>
      </select>
    </div>

    <!-- 详情面板 -->
    <section class="db-detail" :class="{ open: !!selected }">
      <template v-if="selected">
        <div class="db-detail-head">
          <div class="db-d-name">{{ selected.d }} <span class="db-d-mfg">{{ selected.m }}</span></div>
          <button class="btn primary sm db-add" :disabled="detailLoading || isSaved(selected)" @click="addToLibrary">
            {{ isSaved(selected) ? t('db.saved') : (detailLoading ? t('db.loading') : t('db.add')) }}
          </button>
        </div>
        <div class="db-d-body">
          <div ref="chartEl" class="db-chart" :class="{ dim: detailLoading }"></div>
          <div class="db-d-right">
            <div class="db-d-meta">
              <div class="db-meta-grid">
                <span class="db-mk">{{ t('db.meta.impulse') }}</span><b>{{ fmtImp(selected.ti) }} N·s</b>
                <span class="db-mk">{{ t('db.meta.thrust') }}</span><b>{{ selected.at }} / {{ selected.mt }} N</b>
                <span class="db-mk">{{ t('db.meta.burn') }}</span><b>{{ selected.bt }}s</b>
                <span class="db-mk">{{ t('db.meta.delays') }}</span><b>{{ selected.del || '—' }}</b>
                <span class="db-mk">{{ t('db.meta.weight') }}</span><b>{{ fmtW(selected.w0) }}g</b>
                <span class="db-mk">{{ t('db.meta.type') }}</span><b>{{ t('db.motorType.' + selected.t) || selected.t }}</b>
                <span class="db-mk">{{ t('db.meta.case') }}</span><b>{{ selected.ci || '—' }}</b>
                <span class="db-mk">{{ t('db.meta.prop') }}</span><b>{{ selected.pi || '—' }}</b>
              </div>
            </div>
            <div v-if="detailError" class="empty warn db-err">{{ detailError }}</div>
            <div v-if="detailSpec" class="db-spec">
              <div class="db-spec-row"><span>{{ t('db.spec.total') }}</span><b>{{ fmtImp(detailSpec.totalImpulseNs) }} N·s</b></div>
              <div class="db-spec-row"><span>{{ t('db.spec.peak') }}</span><b>{{ detailSpec.maxThrust.toFixed(1) }} N</b></div>
              <div class="db-spec-row"><span>{{ t('db.spec.burn') }}</span><b>{{ detailSpec.burnTime.toFixed(2) }} s</b></div>
              <div class="db-spec-row"><span>{{ t('db.spec.delay') }}</span><b>{{ detailSpec.delay }} s</b></div>
              <div class="db-spec-row"><span>{{ t('db.spec.mass') }}</span><b>{{ (detailSpec.mass0 * 1000).toFixed(0) }} g → {{ (detailSpec.mass1 * 1000).toFixed(0) }} g</b></div>
              <div class="db-spec-src">{{ detailSpec.source }}</div>
            </div>
            <div v-if="selected.files.length > 1" class="db-files">
              <div class="db-lbl">{{ t('db.dataFiles') }} ({{ selected.files.length }})</div>
              <div class="db-files-row">
                <button
                  v-for="(f, i) in selected.files" :key="f.i"
                  class="db-file-chip" :class="{ on: activeFile === i }"
                  @click="loadCurve(selected, i)"
                >{{ f.f }} · {{ f.s }}</button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import * as echarts from 'echarts';
import { loadMotorDBIndex, motorRawUrl, delaysToList, uniqueManufacturers, IMPULSE_CLASSES, type MotorIndexEntry } from '../lib/motorDB';
import { parseRseFile, parseEngFile, type MotorSpec } from '../lib/engines';

const { t } = useI18n();
const TYPE_OPTS = ['reload', 'SU', 'hybrid'] as const;

interface Col { key: string; sortable: boolean }
const cols: Col[] = [
  { key: 'designation', sortable: true }, { key: 'manufacturer', sortable: true },
  { key: 'class', sortable: true }, { key: 'dia', sortable: true }, { key: 'len', sortable: true },
  { key: 'type', sortable: false }, { key: 'impulse', sortable: true }, { key: 'avgThrust', sortable: true },
  { key: 'maxThrust', sortable: true }, { key: 'burn', sortable: true }, { key: 'delay', sortable: true },
  { key: 'weight', sortable: true }, { key: 'files', sortable: true },
];

const index = ref<MotorIndexEntry[]>([]);
const loading = ref(true);
const query = ref('');
const mfg = ref('');
const classes = ref<string[]>([]);
const diaMin = ref<number | null>(null);
const diaMax = ref<number | null>(null);
const mtype = ref('');
const delayMode = ref('');
const page = ref(1);
const pageSize = ref(50);
const sortKey = ref('manufacturer');
const sortDir = ref<1 | -1>(1);

const emit = defineEmits<{ (e: 'close'): void; (e: 'add-motor', m: MotorSpec): void; (e: 'remove-motor', id: string): void }>();
const props = defineProps<{ savedMotors: MotorSpec[] }>();

const manufacturers = computed(() => uniqueManufacturers(index.value));

function toggleClass(c: string) {
  const i = classes.value.indexOf(c);
  if (i >= 0) classes.value.splice(i, 1); else classes.value.push(c);
  page.value = 1;
}
function resetFilters() {
  query.value = ''; mfg.value = ''; classes.value = []; diaMin.value = null; diaMax.value = null;
  mtype.value = ''; delayMode.value = ''; page.value = 1;
}
function setSort(key: string) {
  if (sortKey.value === key) sortDir.value = sortDir.value === 1 ? -1 : 1;
  else { sortKey.value = key; sortDir.value = 1; }
  page.value = 1;
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  const arr = index.value.filter((e) => {
    if (q && !e.d.toLowerCase().includes(q) && !(e.c ?? '').toLowerCase().includes(q) && !e.m.toLowerCase().includes(q)) return false;
    if (mfg.value && e.m !== mfg.value) return false;
    if (classes.value.length && !classes.value.includes(e.cl)) return false;
    if (diaMin.value != null && e.dia < diaMin.value) return false;
    if (diaMax.value != null && e.dia > diaMax.value) return false;
    if (mtype.value && e.t !== mtype.value) return false;
    if (delayMode.value === 'has' && delaysToList(e.del).length === 0) return false;
    if (delayMode.value === 'none' && delaysToList(e.del).length > 0) return false;
    return true;
  });
  const k = sortKey.value;
  const dir = sortDir.value;
  arr.sort((a, b) => {
    const va = k === 'designation' ? a.d : k === 'manufacturer' ? a.m : k === 'class' ? a.cl
      : k === 'delay' ? (delaysToList(a.del)[0] ?? -1)
      : k === 'files' ? a.files.length
      : (a as unknown as Record<string, number>)[k] ?? 0;
    const vb = k === 'designation' ? b.d : k === 'manufacturer' ? b.m : k === 'class' ? b.cl
      : k === 'delay' ? (delaysToList(b.del)[0] ?? -1)
      : k === 'files' ? b.files.length
      : (b as unknown as Record<string, number>)[k] ?? 0;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
  return arr;
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value));
watch([filtered, pageSize], () => { if (page.value > pageCount.value) page.value = pageCount.value; });

// —— 详情与曲线 ——
const selected = ref<MotorIndexEntry | null>(null);
const selectedId = ref<string | null>(null);
const detailSpec = ref<MotorSpec | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
const activeFile = ref(0);
const curveCache = new Map<string, MotorSpec>();
const chartEl = ref<HTMLDivElement | null>(null);
let inst: echarts.ECharts | null = null;

function isSaved(e: MotorIndexEntry): boolean {
  return props.savedMotors.some((m) => m.id === `db-${e.id}` || m.id.startsWith(`db-${e.id}`));
}
function fmtImp(v: number): string { return v >= 100 ? v.toFixed(0) : v.toFixed(1); }
function fmtW(v: number): string { return Math.round(v).toString(); }

function select(e: MotorIndexEntry) {
  selected.value = e;
  selectedId.value = e.id;
  activeFile.value = 0;
  detailSpec.value = null;
  detailError.value = '';
  loadCurve(e, 0);
}

async function loadCurve(e: MotorIndexEntry, fileIdx: number) {
  const f = e.files[fileIdx];
  if (!f) return;
  activeFile.value = fileIdx;
  detailLoading.value = true;
  detailError.value = '';
  const cached = curveCache.get(f.i);
  if (cached) {
    detailSpec.value = cached;
    detailLoading.value = false;
    renderCurve(cached);
    return;
  }
  try {
    const res = await fetch(motorRawUrl(f.p));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const spec = f.f === 'RSE' ? parseRseFile(text) : parseEngFile(text);
    if (!spec) throw new Error('parse failed');
    spec.custom = true;
    spec.source = `motor-database · ${e.m} · ${e.d}（thrustcurve.org ${f.s === 'cert' ? 'cert' : 'measured'}）`;
    curveCache.set(f.i, spec);
    detailSpec.value = spec;
    renderCurve(spec);
  } catch (err) {
    detailError.value = `${t('db.loadFail')} ${f.p}`;
    if (fileIdx + 1 < e.files.length) await loadCurve(e, fileIdx + 1);
  } finally {
    detailLoading.value = false;
  }
}

function renderCurve(spec: MotorSpec) {
  if (!chartEl.value) return;
  if (!inst) inst = echarts.init(chartEl.value);
  inst.setOption({
    grid: { left: 48, right: 16, top: 34, bottom: 30 },
    title: { text: spec.name, left: 4, top: 2, textStyle: { fontSize: 12, color: '#8fd0ff' } },
    tooltip: { trigger: 'axis', confine: true },
    xAxis: { type: 'value', name: 't (s)', nameTextStyle: { color: '#7ea6c2' }, axisLabel: { color: '#9fc0da' }, splitLine: { lineStyle: { color: 'rgba(120,180,255,0.12)' } } },
    yAxis: { type: 'value', name: 'F (N)', nameTextStyle: { color: '#7ea6c2' }, axisLabel: { color: '#9fc0da' }, splitLine: { lineStyle: { color: 'rgba(120,180,255,0.12)' } } },
    series: [{
      type: 'line', showSymbol: false, data: spec.curve.time.map((tm, i) => [tm, spec.curve.thrust[i]]),
      lineStyle: { color: '#2f9bff', width: 2 }, areaStyle: { color: 'rgba(47,155,255,0.18)' },
    }],
  });
}

/** 从表格行直接加入：详情已加载用实测；否则按首个延迟构造（索引规格近似），确保立即可装配 */
function addFromRow(e: MotorIndexEntry) {
  const dels = delaysToList(e.del);
  if (dels.length === 0) return;
  if (detailSpec.value && selectedId.value === e.id) {
    emit('add-motor', detailSpec.value);
    return;
  }
  const del = dels[0];
  const shellKg = Math.max((e.w0 - e.w1) / 1000, 0.004);
  const approx: MotorSpec = {
    id: `db-${e.id}-${del}`, name: `${e.d}-${del}`, class: e.cl, diameterMM: e.dia, lengthMM: e.len,
    delay: del, burnTime: e.bt, maxThrust: e.mt, totalImpulseNs: e.ti,
    mass0: e.w0 / 1000, mass1: shellKg, propellant: e.w1 / 1000,
    curve: { time: [0, 0.1 * e.bt, e.bt], thrust: [0, e.mt, 0] },
    source: `motor-database · ${e.m} · ${e.d}（索引规格近似，详情曲线可用后加载实测）`,
    custom: true, manufacturer: e.m, caseInfo: e.ci ?? undefined, propInfo: e.pi ?? undefined,
  };
  emit('add-motor', approx);
}

function addToLibrary() {
  if (!detailSpec.value) return;
  emit('add-motor', detailSpec.value);
}

onMounted(async () => {
  try {
    index.value = await loadMotorDBIndex();
  } finally {
    loading.value = false;
  }
});
onBeforeUnmount(() => { inst?.dispose(); inst = null; });
watch(chartEl, (el) => { if (el && detailSpec.value) renderCurve(detailSpec.value); });
</script>

<style scoped>
.db-page { display: flex; flex-direction: column; height: 100%; min-height: 0; background: #07121f; color: #d8ecff; color-scheme: dark; }
.db-top { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid #12314f; flex-wrap: wrap; }
.db-back { flex-shrink: 0; }
.db-title { font-size: 14px; font-weight: 700; color: #e8f4ff; display: flex; flex-direction: column; margin-right: 6px; }
.db-title-sub { font-size: 10.5px; color: #6f96b5; font-weight: 400; }
.db-top-filters { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.db-search { width: 220px; padding: 5px 8px; background: #0a1a2b; border: 1px solid #12314f; color: #d8ecff; font-size: 12px; }
.db-search::placeholder, .db-num::placeholder { color: #6f96b5; }
.db-sel { padding: 5px 6px; background: #0a1a2b; border: 1px solid #12314f; color: #cfe6ff; font-size: 12px; }
.db-chips { display: flex; flex-wrap: wrap; gap: 3px; }
.db-chip { font-size: 11px; padding: 3px 7px; background: transparent; border: 1px solid #1c4a73; color: #8fb8d9; cursor: pointer; }
.db-chip.on { background: #1668c7; border-color: #1668c7; color: #fff; }
.db-num { width: 60px; padding: 5px 6px; background: #0a1a2b; border: 1px solid #12314f; color: #cfe6ff; font-size: 12px; }
.db-dia-sep { color: #5a7f9d; }
.db-reset { flex-shrink: 0; }
.db-count { font-size: 12px; color: #7ea6c2; flex-shrink: 0; }

.db-table-wrap { flex: 1; overflow: auto; min-height: 0; }
.db-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.db-th { text-align: left; padding: 7px 8px; background: #0c2036; color: #9fc0da; font-weight: 600; border-bottom: 1px solid #12314f; position: sticky; top: 0; z-index: 1; white-space: nowrap; user-select: none; }
.db-th.sortable { cursor: pointer; }
.db-th.sortable:hover { color: #d8ecff; }
.db-th.asc, .db-th.desc { color: #2f9bff; }
.db-sort-ic { font-size: 10px; opacity: 0.6; margin-left: 2px; }
.db-row { cursor: pointer; }
.db-row:hover td { background: rgba(47, 155, 255, 0.06); }
.db-row.on td { background: rgba(47, 155, 255, 0.14); }
.db-row td { padding: 6px 8px; border-bottom: 1px solid rgba(18, 49, 79, 0.5); color: #cfe6ff; white-space: nowrap; }
.db-td-name { font-weight: 600; color: #e8f4ff; }
.db-td-num { text-align: right; font-variant-numeric: tabular-nums; color: #b8d6ef; }
.db-td-act { text-align: center; }
.db-th-act { text-align: center; }
.db-add-row.saved { opacity: 0.7; }
.db-empty { text-align: center; padding: 24px; color: #6f96b5; }

.db-pager { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-top: 1px solid #12314f; }
.db-page { font-size: 12px; color: #9fc0da; }
.db-page-size { width: 64px; }

.db-detail { display: none; border-top: 1px solid #12314f; background: #0a1a2b; }
.db-detail.open { display: block; }
.db-detail-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
.db-d-name { font-size: 16px; font-weight: 700; color: #e8f4ff; }
.db-d-mfg { font-size: 12px; color: #6f96b5; margin-left: 8px; font-weight: 400; }
.db-d-body { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 4px 16px; padding: 0 12px 12px; }
.db-chart { height: 220px; }
.db-chart.dim { opacity: 0.5; }
.db-d-right { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.db-meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: 12px; }
.db-mk { color: #6f96b5; }
.db-meta-grid b { color: #d8ecff; font-weight: 600; }
.db-err { font-size: 11.5px; }
.db-spec { display: flex; flex-direction: column; gap: 3px; }
.db-spec-row { display: flex; justify-content: space-between; font-size: 12px; color: #9fc0da; border-bottom: 1px dashed rgba(18, 49, 79, 0.7); padding: 2px 0; }
.db-spec-row b { color: #d8ecff; }
.db-spec-src { font-size: 10.5px; color: #6f96b5; line-height: 1.5; }
.db-lbl { font-size: 11px; color: #7ea6c2; margin-bottom: 4px; }
.db-files-row { display: flex; flex-wrap: wrap; gap: 4px; }
.db-file-chip { font-size: 11px; padding: 2px 8px; background: transparent; border: 1px solid #1c4a73; color: #8fb8d9; cursor: pointer; }
.db-file-chip.on { background: #1668c7; border-color: #1668c7; color: #fff; }
</style>
