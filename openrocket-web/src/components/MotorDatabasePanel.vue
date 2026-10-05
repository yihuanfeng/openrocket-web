<template>
  <div class="db-panel">
    <!-- 左：筛选栏 -->
    <aside class="db-filters">
      <div class="pane-title"><span>{{ t('db.filter') }}</span></div>
      <div class="db-filter-body">
        <input v-model="query" class="db-search" :placeholder="t('db.searchPh')" />
        <label class="db-lbl">{{ t('db.manufacturer') }}</label>
        <select v-model="mfg" class="db-sel">
          <option value="">{{ t('db.all') }}</option>
          <option v-for="m in manufacturers" :key="m" :value="m">{{ m }}</option>
        </select>
        <label class="db-lbl">{{ t('db.impulseClass') }}</label>
        <div class="db-chips">
          <button v-for="c in IMPULSE_CLASSES" :key="c" class="db-chip" :class="{ on: classes.includes(c) }" @click="toggleClass(c)">{{ c }}</button>
        </div>
        <label class="db-lbl">{{ t('db.diameter') }} (mm)</label>
        <div class="db-dia">
          <input v-model.number="diaMin" type="number" min="0" class="db-num" placeholder="0" />
          <span class="db-dia-sep">–</span>
          <input v-model.number="diaMax" type="number" min="0" class="db-num" placeholder="∞" />
        </div>
        <label class="db-lbl">{{ t('db.type') }}</label>
        <select v-model="mtype" class="db-sel">
          <option value="">{{ t('db.all') }}</option>
          <option v-for="tp in TYPE_OPTS" :key="tp" :value="tp">{{ t('db.motorType.' + tp) }}</option>
        </select>
        <label class="db-lbl">{{ t('db.delayLabel') }}</label>
        <select v-model="delayMode" class="db-sel">
          <option value="">{{ t('db.all') }}</option>
          <option value="has">{{ t('db.delay.has') }}</option>
          <option value="none">{{ t('db.delay.none') }}</option>
        </select>
        <button class="btn mini db-reset" @click="resetFilters">{{ t('db.reset') }}</button>
        <div class="db-count">{{ t('db.count', { n: filtered.length }) }}</div>
      </div>
    </aside>

    <!-- 中：列表 -->
    <section class="db-list-col">
      <div class="pane-title">
        <span>{{ t('db.title') }}</span>
        <span class="lib-count">{{ t('db.subtitle') }}</span>
      </div>
      <div class="db-list">
        <button v-for="e in pageRows" :key="e.id" class="db-row" :class="{ on: selectedId === e.id }" @click="select(e)">
          <span class="db-row-name">{{ e.d }}<span class="db-row-mfg">{{ e.m }}</span></span>
          <span class="db-row-meta">{{ e.cl }} · Ø{{ e.dia }}mm · {{ fmtImp(e.ti) }} N·s<span v-if="delaysToList(e.del).length" class="db-row-del"> · d{{ delaysToList(e.del).join('/') }}</span></span>
        </button>
        <div v-if="filtered.length === 0" class="hint">{{ t('db.empty') }}</div>
      </div>
      <div class="db-pager">
        <button class="btn mini" :disabled="page <= 1" @click="page--">‹</button>
        <span class="db-page">{{ page }} / {{ pageCount }}</span>
        <button class="btn mini" :disabled="page >= pageCount" @click="page++">›</button>
      </div>
    </section>

    <!-- 右：详情 -->
    <section class="db-detail-col">
      <div class="pane-title"><span>{{ t('db.detail') }}</span></div>
      <div v-if="!selected" class="hint">{{ t('db.detailPh') }}</div>
      <template v-else>
        <div class="db-detail-head">
          <div class="db-d-name">{{ selected.d }} <span class="db-d-mfg">{{ selected.m }}</span></div>
          <button
            class="btn primary sm db-add"
            :disabled="detailLoading || isSaved()"
            @click="addToLibrary"
          >{{ isSaved() ? t('db.saved') : (detailLoading ? t('db.loading') : t('db.add')) }}</button>
        </div>
        <div class="db-d-meta">
          <span v-if="selected.cl">{{ t('db.meta.class') }} {{ selected.cl }}</span>
          <span>Ø{{ selected.dia }} × {{ selected.len }}mm</span>
          <span>{{ t('db.meta.type') }}: {{ t('db.motorType.' + selected.t) || selected.t }}</span>
          <span v-if="selected.ci">{{ t('db.meta.case') }} {{ selected.ci }}</span>
          <span v-if="selected.pi">{{ t('db.meta.prop') }} {{ selected.pi }}</span>
          <span v-if="selected.sp">⚡ sparky</span>
          <span>{{ t('db.meta.impulse') }} {{ selected.ti }} N·s</span>
          <span>{{ t('db.meta.thrust') }} {{ selected.at }} / {{ selected.mt }} N</span>
          <span>{{ t('db.meta.burn') }} {{ selected.bt }}s</span>
          <span>{{ t('db.meta.weight') }} {{ selected.w0 }}g</span>
          <span v-if="selected.del">{{ t('db.meta.delays') }} {{ selected.del }}</span>
        </div>
        <!-- 推力曲线 -->
        <div ref="chartEl" class="db-chart" :class="{ dim: detailLoading }"></div>
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
          <button
            v-for="(f, i) in selected.files" :key="f.i"
            class="db-file-chip" :class="{ on: activeFile === i }"
            @click="loadCurve(selected, i)"
          >{{ f.f }} · {{ f.s }}</button>
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
const PAGE = 25;

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

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return index.value.filter((e) => {
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
});
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE)));
const pageRows = computed(() => filtered.value.slice((page.value - 1) * PAGE, page.value * PAGE));
watch([filtered], () => { if (page.value > pageCount.value) page.value = pageCount.value; });

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

const props = defineProps<{ savedMotors: MotorSpec[] }>();
const emit = defineEmits<{ (e: 'add-motor', m: MotorSpec): void; (e: 'remove-motor', id: string): void }>();

function isSaved(): boolean {
  return detailSpec.value ? props.savedMotors.some((m) => m.id === detailSpec.value!.id) : false;
}

function fmtImp(v: number): string { return v >= 100 ? v.toFixed(0) : v.toFixed(1); }

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
    grid: { left: 44, right: 14, top: 30, bottom: 26 },
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
.db-panel { display: grid; grid-template-columns: 210px minmax(0, 1fr) 400px; height: 100%; min-height: 0; }
.db-filters { border-right: 1px solid var(--line, #12314f); overflow-y: auto; display: flex; flex-direction: column; }
.db-filter-body { padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.db-search { width: 100%; box-sizing: border-box; padding: 4px 8px; background: var(--bg2, #0a1a2b); border: 1px solid var(--line, #12314f); color: #d8ecff; border-radius: 0; font-size: 12px; }
.db-sel { width: 100%; padding: 4px 6px; background: var(--bg2, #0a1a2b); border: 1px solid var(--line, #12314f); color: #cfe6ff; font-size: 12px; }
.db-lbl { font-size: 11px; color: #7ea6c2; margin-top: 6px; }
.db-chips { display: flex; flex-wrap: wrap; gap: 3px; }
.db-chip { font-size: 11px; padding: 2px 7px; background: transparent; border: 1px solid #1c4a73; color: #8fb8d9; cursor: pointer; }
.db-chip.on { background: #1668c7; border-color: #1668c7; color: #fff; }
.db-dia { display: flex; align-items: center; gap: 4px; }
.db-num { width: 100%; padding: 3px 6px; background: var(--bg2, #0a1a2b); border: 1px solid var(--line, #12314f); color: #cfe6ff; font-size: 12px; box-sizing: border-box; }
.db-dia-sep { color: #5a7f9d; }
.db-reset { margin-top: 8px; width: 100%; }
.db-count { font-size: 11px; color: #7ea6c2; margin-top: 6px; }

.db-list-col { display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--line, #12314f); }
.db-list { flex: 1; overflow-y: auto; min-height: 0; }
.db-row { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 7px 10px; background: transparent; border: none; border-bottom: 1px solid rgba(18, 49, 79, 0.6); cursor: pointer; color: #cfe6ff; }
.db-row:hover { background: rgba(47, 155, 255, 0.08); }
.db-row.on { background: rgba(47, 155, 255, 0.16); box-shadow: inset 2px 0 0 #2f9bff; }
.db-row-name { font-size: 13px; font-weight: 600; color: #e8f4ff; }
.db-row-mfg { font-size: 11px; color: #6f96b5; margin-left: 6px; font-weight: 400; }
.db-row-meta { font-size: 11px; color: #8fb8d9; margin-top: 2px; }
.db-row-del { color: #ffd479; }
.db-pager { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border-top: 1px solid var(--line, #12314f); }
.db-page { font-size: 12px; color: #9fc0da; }

.db-detail-col { display: flex; flex-direction: column; min-width: 0; overflow-y: auto; }
.db-detail-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; gap: 8px; }
.db-d-name { font-size: 16px; font-weight: 700; color: #e8f4ff; }
.db-d-mfg { font-size: 12px; color: #6f96b5; margin-left: 8px; font-weight: 400; }
.db-add { flex-shrink: 0; }
.db-d-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 0 12px 10px; font-size: 11.5px; color: #9fc0da; border-bottom: 1px solid var(--line, #12314f); }
.db-chart { height: 210px; margin: 8px 12px; }
.db-chart.dim { opacity: 0.5; }
.db-err { margin: 0 12px 8px; font-size: 11.5px; }
.db-spec { padding: 0 12px 10px; display: flex; flex-direction: column; gap: 4px; }
.db-spec-row { display: flex; justify-content: space-between; font-size: 12px; color: #9fc0da; border-bottom: 1px dashed rgba(18, 49, 79, 0.7); padding: 3px 0; }
.db-spec-row b { color: #d8ecff; }
.db-spec-src { font-size: 10.5px; color: #6f96b5; margin-top: 4px; line-height: 1.5; }
.db-files { padding: 0 12px 12px; }
.db-file-chip { font-size: 11px; padding: 2px 8px; margin: 0 4px 4px 0; background: transparent; border: 1px solid #1c4a73; color: #8fb8d9; cursor: pointer; }
.db-file-chip.on { background: #1668c7; border-color: #1668c7; color: #fff; }
</style>
