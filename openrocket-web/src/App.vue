<script setup lang="ts">
// 主应用：上功能区（设计/发动机配置/模拟发射 三 Tab）+ 下预览（2D/3D + 属性 + 信息条）
import { ref, toRaw, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { parseOrk } from './lib/orkParser';
import { parseRkt, modelToRkt } from './lib/rktParser';
import type { RocketComponent, RocketModel, EngineAnalysis, FlightProfile, SimConditions, DelayScanResult } from './lib/types';
import { DEFAULT_CONDITIONS } from './lib/jsEngine';
import { getEngineBridge } from './lib/engine';
import ComponentTree from './components/ComponentTree.vue';
import PropertyPanel from './components/PropertyPanel.vue';
import RocketView2D from './components/RocketView2D.vue';
import RocketView3D from './components/RocketView3D.vue';
import ExamplesPanel from './components/ExamplesPanel.vue';
import SimulationPanel from './components/SimulationPanel.vue';
import { MOTORS, DEFAULT_MOTOR_ID, motorById, parseEngFile } from './lib/engines';
import type { MotorSpec } from './lib/engines';
import ComponentLibrary from './components/ComponentLibrary.vue';
import MotorConfigPanel from './components/MotorConfigPanel.vue';
import { makeComponent } from './lib/componentFactory';
import { PRESETS } from './lib/presets';
import { modelToOrkBlob } from './lib/orkSerializer';

const viewMode = ref<'2d' | '3d'>('2d');
const orientation = ref<'vertical' | 'horizontal'>('vertical');
const view2dRef = ref<InstanceType<typeof RocketView2D> | null>(null);
const view3dRef = ref<InstanceType<typeof RocketView3D> | null>(null);

// —— 新布局：功能区 Tab（设计 / 发动机配置 / 模拟发射）——
const activeTab = ref<'design' | 'motor' | 'sim'>('design');
// 功能区高度（百分比），预览区占剩余；可垂直拖拽
const workH = ref(Number(localStorage.getItem('ork:workH')) || 44);
function startVResize(e: MouseEvent): void {
  e.preventDefault();
  const startY = e.clientY;
  const startH = workH.value;
  const onMove = (ev: MouseEvent) => {
    const h = document.querySelector('.app')?.clientHeight ?? 800;
    const pct = startH + ((ev.clientY - startY) / h) * 100;
    workH.value = Math.min(74, Math.max(30, pct));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    localStorage.setItem('ork:workH', String(workH.value));
  };
  document.body.style.cursor = 'row-resize';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// —— 配置重命名 / 复制（发动机配置 Tab）——
function renameConfig(id: string, name: string): void {
  const c = configs.value.find((x) => x.id === id);
  if (c) { c.name = name; scheduleAutoSave(); }
}
function copyConfig(): void {
  const cur = configs.value.find((c) => c.id === currentConfigId.value);
  if (!cur) return;
  const n = configs.value.length + 1;
  const id = 'cfg-' + Date.now().toString(36);
  configs.value.push({ id, name: `配置 ${n}`, motorId: cur.motorId });
  currentConfigId.value = id;
  scheduleAutoSave();
}

// —— 电机座列表（发动机配置 Tab）——
function motorMounts(): RocketComponent[] {
  const out: RocketComponent[] = [];
  const walk = (c: RocketComponent) => {
    if (c.type === 'innertube') out.push(c);
    else if (c.type === 'bodytube' && c.properties?.['motormount'] === 'true') out.push(c);
    for (const ch of c.children ?? []) walk(ch);
  };
  if (model.value) walk(model.value.root);
  return out;
}

// —— 预览信息条（官方风格：长度/直径/质量/远地点/速度/稳定度/CG/CP）——
function rocketLength(root: RocketComponent): number {
  const stageLen = (s: RocketComponent) => (s.children ?? []).reduce((a, c) => a + (Number.isFinite(c.length) ? Math.max(0, c.length as number) : 0), 0);
  const lens = (root.children ?? []).filter((c) => c.type === 'stage').map(stageLen);
  return lens.length ? Math.max(...lens) : 0;
}
function maxDiameter(root: RocketComponent): number {
  const maxR = (c: RocketComponent): number => Math.max(
    Number.isFinite(c.radius) ? (c.radius as number) : 0,
    ...(c.children ?? []).map(maxR),
  );
  return maxR(root) * 2;
}
const previewInfo = computed(() => {
  const a = analysis.value;
  const p = simProfile.value;
  return {
    length: model.value ? rocketLength(model.value.root) : 0,
    diameter: model.value ? maxDiameter(model.value.root) : 0,
    mass: a && a.mass != null ? a.mass : null,
    cg: a && a.cgX != null ? a.cgX : null,
    cp: a && a.cpX != null ? a.cpX : null,
    stability: a && a.stability != null ? a.stability : null,
    apogee: p && !p.error ? p.maxAltitude_m : null,
    maxV: p && !p.error ? p.maxVelocity_ms : null,
  };
});
function fmtLen2(v: number): string {
  const u = unitMode.value;
  if (u === 'm') return v.toFixed(3) + ' m';
  if (u === 'cm') return (v * 100).toFixed(1) + ' cm';
  return (v * 1000).toFixed(0) + ' mm';
}
function fmtMass(v: number): string {
  return v >= 0.1 ? v.toFixed(3) + ' kg' : (v * 1000).toFixed(1) + ' g';
}
const TYPE_LABEL2: Record<string, string> = {
  rocket: '火箭', stage: '级', nosecone: '头锥', bodytube: '机身管', transition: '过渡段',
  tubecoupler: '管接头', bulkhead: '隔框', centeringring: '定心环', engineblock: '发动机挡块',
  innertube: '内管', trapezoidfinset: '梯形尾翼', ellipticalfinset: '椭圆尾翼',
  freeformfinset: '自由尾翼', parachute: '降落伞', streamer: '飘带', shockcord: '减震绳',
  masscomponent: '配重', launchlug: '发射导环', railbutton: '导轨按钮', podset: '捆绑舱',
};
function typeLabelOf(c: RocketComponent | null): string {
  return c ? (TYPE_LABEL2[c.type] ?? c.type) : '';
}

// 组件库添加：级走 addStage，其余 quickAdd
function onLibAdd(type: string): void {
  if (type === 'stage') { addStage(); return; }
  quickAdd(type);
}

// —— P1 自动保存 / 未保存提示 / 启动恢复 ——
const AUTO_KEY = 'ork:autosave:v1';
const AUTO_TIME_KEY = 'ork:autosave:time';
const dirty = ref(false);
const restoreInfo = ref<{ time: string } | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let suppressSave = false; // 丢弃恢复时临时抑制自动保存（示例成基线前不落盘）

function scheduleAutoSave(): void {
  dirty.value = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAuto, 400);
}
function saveAuto(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (!model.value) return;
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(toRaw(model.value)));
    localStorage.setItem(AUTO_TIME_KEY, String(Date.now()));
    dirty.value = false;
  } catch (e) {
    // 存储满/不可用时静默降级，不影响编辑
  }
}
function restoreAuto(): void {
  const raw = localStorage.getItem(AUTO_KEY);
  if (!raw) return;
  try {
    const m = JSON.parse(raw) as RocketModel;
    model.value = m;
    selected.value = m.root.children[0] ?? m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    fileName.value = '';
    restoreInfo.value = null;
    void runAnalyze();
    scheduleAutoSave();
  } catch (e) {
    localStorage.removeItem(AUTO_KEY);
    restoreInfo.value = null;
  }
}
function discardAuto(): void {
  localStorage.removeItem(AUTO_KEY);
  localStorage.removeItem(AUTO_TIME_KEY);
  restoreInfo.value = null;
  suppressSave = true;
  const starter = PRESETS[0];
  if (starter) {
    const m = starter.build();
    model.value = m;
    selected.value = m.root.children[0] ?? m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    void runAnalyze();
  }
  // watch 回调为异步（flush pre），需等其跑完再恢复自动保存
  setTimeout(() => { suppressSave = false; }, 400);
}
function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 打开页面：默认加载入门小火箭作为工作底稿；有自动存档时额外显示恢复条（用户决定是否恢复）
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  const t = localStorage.getItem(AUTO_TIME_KEY);
  const raw = localStorage.getItem(AUTO_KEY);
  const hasAuto = !!(t && raw);
  if (hasAuto) suppressSave = true; // 程序化加载入门小火箭期间不覆盖用户上次存档
  const starter = PRESETS[0];
  if (starter) {
    const m = starter.build();
    model.value = m;
    fileName.value = '';
    selected.value = m.root.children[0] ?? m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    void runAnalyze();
  }
  if (hasAuto) {
    restoreInfo.value = { time: fmtTime(Number(t)) };
    setTimeout(() => { suppressSave = false; }, 500);
  }
});

// 关闭/刷新前若有未落盘变更则提示（自动保存已兜底）
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
window.addEventListener('beforeunload', onBeforeUnload);

const model = ref<RocketModel | null>(null);
// 模型任何编辑（含撤销/重做/拖拽/属性）→ 标记未保存并延迟落盘（须在 model 声明后注册）
watch(
  () => model.value,
  () => {
    if (suppressSave) return;
    scheduleAutoSave();
  },
  { deep: true }
);
const selected = ref<RocketComponent | null>(null);
const hoveredComp = ref<RocketComponent | null>(null);
const fileName = ref('');
const error = ref('');
const loading = ref(false);
const analysis = ref<EngineAnalysis | null>(null);

// —— 撤销/重做：快照栈（存“变更后”状态）——
const history = ref<RocketModel[]>([]);
const historyIndex = ref(-1);
const MAX_HISTORY = 60;

/** 深拷贝模型/组件：先 toRaw 解掉 Vue 响应式 Proxy，再 JSON 往返，避免 deepClone(proxy) 抛 DataCloneError */
function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(toRaw(v))) as T;
}

/** 提交历史快照：在 model 修改完成后调用，记录修改后的状态（撤销/重做恢复到该快照） */
function commitHistory(): void {
  if (!model.value) return;
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(deepClone(model.value));
  historyIndex.value++;
  if (history.value.length > MAX_HISTORY) {
    history.value.shift();
    historyIndex.value--;
  }
}

function canUndo(): boolean {
  return historyIndex.value > 0;
}
function canRedo(): boolean {
  return historyIndex.value < history.value.length - 1;
}

function undo(): void {
  if (!canUndo()) return;
  historyIndex.value--;
  model.value = deepClone(history.value[historyIndex.value]);
  selected.value = null;
  simProfile.value = null;
  scheduleAnalyze();
}
function redo(): void {
  if (!canRedo()) return;
  historyIndex.value++;
  model.value = deepClone(history.value[historyIndex.value]);
  selected.value = null;
  simProfile.value = null;
  scheduleAnalyze();
}

// —— 引擎重算（编辑后防抖 300ms）——
let analyzeTimer: number | undefined;

function scheduleAnalyze(): void {
  if (analyzeTimer !== undefined) window.clearTimeout(analyzeTimer);
  analyzeTimer = window.setTimeout(() => {
    analyzeTimer = undefined;
    void runAnalyze();
  }, 300);
}

async function runAnalyze(): Promise<void> {
  if (!model.value) return;
  const eng = getEngineBridge();
  if (eng.kind === 'none') return;
  analysis.value = await eng.analyze(model.value);
}

// —— 编辑回调 / 删除 ——
function onPropChanged(): void {
  simProfile.value = null;
  scheduleAnalyze();
  commitHistory();
}

function findParent(node: RocketComponent, target: RocketComponent): RocketComponent | null {
  for (const child of node.children) {
    if (child === target) return node;
    const found = findParent(child, target);
    if (found) return found;
  }
  return null;
}

function removeComponent(c: RocketComponent): void {
  if (!model.value) return;
  const parent = findParent(model.value.root, c);
  if (!parent) return;
  simProfile.value = null;
  const idx = parent.children.indexOf(c);
  parent.children.splice(idx, 1);
  selected.value = parent;
  scheduleAnalyze();
  commitHistory();
}

/** 在树中查找 comp 的父容器（root/stage/组件），找不到返回 null */
function findParentOf(root: RocketComponent, comp: RocketComponent): RocketComponent | null {
  const stack: RocketComponent[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if ((n.children ?? []).includes(comp)) return n;
    stack.push(...(n.children ?? []));
  }
  return null;
}

/** P0：组件顺序调整（同父内上移/下移），级/组件/子组件通用 */
function moveComponent(comp: RocketComponent, dir: number): void {
  if (!model.value) return;
  const parent = findParentOf(model.value.root, comp);
  if (!parent) return;
  const idx = parent.children.indexOf(comp);
  const ni = idx + dir;
  if (ni < 0 || ni >= parent.children.length) return;
  parent.children.splice(idx, 1);
  parent.children.splice(ni, 0, comp);
  selected.value = comp;
  scheduleAnalyze();
  commitHistory();
}

/** P2：拖拽重排——同父内移动到目标组件前/后 */
function moveToComponent(drag: RocketComponent, target: RocketComponent, pos: 'before' | 'after'): void {
  if (!model.value) return;
  const pa = findParentOf(model.value.root, drag);
  const pb = findParentOf(model.value.root, target);
  if (!pa || pa !== pb) return; // 仅同父内重排（跨级结构约束复杂，暂不开放）
  const items = pa.children;
  const from = items.indexOf(drag);
  let to = items.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  items.splice(from, 1);
  to = items.indexOf(target);
  const at = pos === 'before' ? to : to + 1;
  items.splice(at, 0, drag);
  selected.value = drag;
  scheduleAnalyze();
  commitHistory();
}

/** 模型发动机：第一个带 motorId 的发动机架管（innertube）优先 */
function findModelMotor(model: RocketModel): MotorSpec | null {
  const stack: RocketComponent[] = [model.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'innertube' && n.properties?.['motorId']) {
      const m = motorById(n.properties['motorId']);
      if (m) return m;
    }
    stack.push(...(n.children ?? []));
  }
  return null;
}

function removeSelected(): void {
  const c = selected.value;
  if (!c || !model.value) return;
  removeComponent(c);
}

// —— C3: 复制 / 粘贴 ——
let copied: RocketComponent | null = null;

function copyComponent(c: RocketComponent): void {
  copied = deepClone(c);
}

function pasteComponent(): void {
  if (!copied || !model.value || !selected.value) return;
  const parent = findParent(model.value.root, selected.value);
  if (!parent) return;
  simProfile.value = null;
  const clone = deepClone(copied);
  const idx = parent.children.indexOf(selected.value);
  parent.children.splice(idx + 1, 0, clone);
  selected.value = clone;
  scheduleAnalyze();
  commitHistory();
}

function onKeydown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement | null;
  if (t && ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName)) return;
  const meta = e.metaKey || e.ctrlKey;
  // 撤销/重做不依赖选中，须在任何 selected 判断之前处理
  if (meta && (e.key === 'z' || e.key === 'Z')) {
    if (e.shiftKey) redo();
    else undo();
    e.preventDefault();
    return;
  } else if (meta && (e.key === 'y' || e.key === 'Y')) {
    redo();
    e.preventDefault();
    return;
  }
  if (!selected.value) return;
  if (meta && (e.key === 'c' || e.key === 'C')) {
    copyComponent(selected.value);
    e.preventDefault();
  } else if (meta && (e.key === 'v' || e.key === 'V')) {
    pasteComponent();
    e.preventDefault();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    removeComponent(selected.value);
    e.preventDefault();
  }
}

// —— C2: 级管理 ——
function addStage(): void {
  if (!model.value) return;
  const n = model.value.root.children.filter((c) => c.type === 'stage').length + 1;
  const stage: RocketComponent = {
    type: 'stage', name: `Stage ${n}`, children: [],
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
  };
  simProfile.value = null;
  model.value.root.children.push(stage);
  selected.value = stage;
  scheduleAnalyze();
  commitHistory();
}

// —— 仿真 ——
const simProfile = ref<FlightProfile | null>(null);
const simLoading = ref(false);
const selectedMotor = ref<MotorSpec>(motorById(DEFAULT_MOTOR_ID));
const customMotors = ref<MotorSpec[]>([]);
// —— P1-4 飞行配置：命名配置 = 发动机选择；切换配置即切换仿真发动机 ——
interface FlightConfig { id: string; name: string; motorId: string; }
const configs = ref<FlightConfig[]>([{ id: 'cfg-default', name: '默认配置', motorId: DEFAULT_MOTOR_ID }]);
const currentConfigId = ref('cfg-default');
function switchConfig(id: string) {
  const cfg = configs.value.find((c) => c.id === id);
  if (!cfg) return;
  currentConfigId.value = cfg.id;
  selectedMotor.value = motorById(cfg.motorId);
}
function newConfig() {
  const n = configs.value.length + 1;
  const id = 'cfg-' + Date.now().toString(36);
  configs.value.push({ id, name: `配置 ${n}`, motorId: selectedMotor.value.id });
  currentConfigId.value = id;
}
function deleteConfig() {
  if (configs.value.length <= 1) return;
  const idx = configs.value.findIndex((c) => c.id === currentConfigId.value);
  configs.value = configs.value.filter((c) => c.id !== currentConfigId.value);
  const next = configs.value[Math.max(0, idx - 1)];
  currentConfigId.value = next.id;
  selectedMotor.value = motorById(next.motorId);
}
// —— P1-5 仿真条件（风/温度/气压）——
const simConditions = ref<SimConditions>({ ...DEFAULT_CONDITIONS });
// —— P1-7 多配置对比：同火箭多电机并行仿真，出对比表 ——
interface CompareRow { motorId: string; motorName: string; profile: FlightProfile; }
const compareRows = ref<CompareRow[]>([]);
const compareLoading = ref(false);
watch(
  () => simProfile.value,
  (p) => {
    if (!p || p.error) return;
    const row: CompareRow = { motorId: selectedMotor.value.id, motorName: selectedMotor.value.name, profile: p };
    const i = compareRows.value.findIndex((r) => r.motorId === row.motorId);
    if (i >= 0) compareRows.value.splice(i, 1, row);
    else { compareRows.value.push(row); if (compareRows.value.length > 12) compareRows.value.shift(); }
  },
);
async function runCompareAll(): Promise<void> {
  if (!model.value) return;
  compareLoading.value = true;
  try {
    const eng = getEngineBridge();
    if (eng.kind === 'none') return;
    const all = [...MOTORS, ...customMotors.value];
    const rows = await Promise.all(all.map(async (m) => ({ m, p: await eng.simulate(model.value as RocketModel, m, simConditions.value) })));
    compareRows.value = rows
      .filter((r): r is { m: MotorSpec; p: FlightProfile } => !!r.p && !r.p.error)
      .map((r) => ({ motorId: r.m.id, motorName: r.m.name, profile: r.p }));
  } finally {
    compareLoading.value = false;
  }
}
function selectCompareRow(row: CompareRow): void {
  const m = [...MOTORS, ...customMotors.value].find((x) => x.id === row.motorId);
  if (m) selectedMotor.value = m;
  simProfile.value = row.profile;
}
// —— P1-6 延迟优化 ——
const delayScan = ref<DelayScanResult | null>(null);
const delayScanLoading = ref(false);

async function runSimulate(): Promise<void> {
  if (!model.value) return;
  simLoading.value = true;
  try {
    const eng = getEngineBridge();
    if (eng.kind === 'none') {
      simProfile.value = null;
      return;
    }
    const mountMotor = findModelMotor(model.value);
    simProfile.value = await eng.simulate(model.value, mountMotor ?? selectedMotor.value, simConditions.value);
  } finally {
    simLoading.value = false;
  }
}

// —— P1-6 延迟优化（异步分片，不阻塞 UI）——
async function runOptimizeDelay() {
  if (!model.value) return;
  delayScanLoading.value = true;
  delayScan.value = null;
  try {
    const eng = getEngineBridge();
    if (eng.kind === 'none') return;
    delayScan.value = await eng.optimizeDelay(model.value, selectedMotor.value, simConditions.value);
  } finally {
    delayScanLoading.value = false;
  }
}

// —— 发动机导入（RASP/ENG）——
function onMotorImport(text: string) {
  const m = parseEngFile(text);
  if (!m) return;
  customMotors.value = [...customMotors.value.filter((x) => x.id !== m.id), m];
  selectedMotor.value = m;
}

// —— 打开文件 ——
const fileInput = ref<HTMLInputElement | null>(null);

async function openFile(file: File): Promise<void> {
  error.value = '';
  loading.value = true;
  analysis.value = null;
  try {
    const buf = await file.arrayBuffer();
    const lower = file.name.toLowerCase();
    const m = lower.endsWith('.rkt') ? parseRkt(new TextDecoder().decode(buf)) : await parseOrk(buf);
    model.value = m;
    fileName.value = file.name;
    selected.value = m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    simProfile.value = null;
    await runAnalyze();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    model.value = null;
    history.value = [];
    historyIndex.value = -1;
  } finally {
    loading.value = false;
  }
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) void openFile(file);
}

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void openFile(file);
  input.value = ''; // 允许再次选择同一文件
}

// —— 新建 / 添加 / 示例 / 保存 ——
const menuOpen = ref(false);
const examplesOpen = ref(false);
const fileMenuEl = ref<HTMLElement | null>(null);
function closeMenu(e: MouseEvent): void {
  if (menuOpen.value && fileMenuEl.value && !fileMenuEl.value.contains(e.target as Node)) menuOpen.value = false;
}
onMounted(() => window.addEventListener('mousedown', closeMenu));
onBeforeUnmount(() => window.removeEventListener('mousedown', closeMenu));

// —— 侧栏宽度：可拖拽调宽 + localStorage 记忆 ——
const leftW = ref(Number(localStorage.getItem('ork:leftW')) || 264);
const rightW = ref(Number(localStorage.getItem('ork:rightW')) || 324);
function startResize(side: 'left' | 'right', e: MouseEvent): void {
  e.preventDefault();
  const startX = e.clientX;
  const startW = side === 'left' ? leftW.value : rightW.value;
  const onMove = (ev: MouseEvent) => {
    const d = ev.clientX - startX;
    if (side === 'left') leftW.value = Math.min(430, Math.max(190, startW + d));
    else rightW.value = Math.min(430, Math.max(190, startW - d));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    localStorage.setItem('ork:leftW', String(leftW.value));
    localStorage.setItem('ork:rightW', String(rightW.value));
  };
  document.body.style.cursor = 'col-resize';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

function newRocket(): void {
  const stage: RocketComponent = {
    type: 'stage', name: 'Stage 1', children: [],
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
  };
  const root: RocketComponent = {
    type: 'rocket', name: '新火箭', children: [stage],
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
  };
  const m: RocketModel = {
    formatVersion: '1.3', creator: 'OpenRocket Web', name: '新火箭',
    referenceType: 'launchrod', root,
  };
  model.value = m;
  fileName.value = '';
  selected.value = stage;
  history.value = [deepClone(m)];
  historyIndex.value = 0;
  simProfile.value = null;
  analysis.value = null;
  error.value = '';
  void runAnalyze();
}

function findStageOf(node: RocketComponent | null): RocketComponent {
  const root = model.value?.root;
  if (!root) {
    const fallback: RocketComponent = {
      type: 'stage', name: 'Stage 1', children: [],
      properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
    };
    return fallback;
  }
  if (node?.type === 'stage') return node;
  const search = (n: RocketComponent): RocketComponent | null => {
    if (n.type === 'stage') return n;
    for (const child of n.children ?? []) {
      if (child === node) return n.type === 'stage' ? n : search(n);
      const found = search(child);
      if (found) return found;
    }
    return null;
  };
  const direct = node ? search(root) : null;
  if (direct) return direct;
  return root.children.find((c) => c.type === 'stage') ?? root;
}

function addToModel(comp: RocketComponent): void {
  if (!model.value) newRocket();
  if (!model.value) return;
  const stage = findStageOf(selected.value);
  simProfile.value = null;
  stage.children.push(comp);
  selected.value = comp;
  scheduleAnalyze();
  commitHistory();
}

function quickAdd(type: string): void {
  addToModel(makeComponent(type));
}

function loadPresetByName(name: string): void {
  menuOpen.value = false;
  examplesOpen.value = false;
  const preset = PRESETS.find((p) => p.name === name);
  if (!preset) return;
  const m = preset.build();
  model.value = m;
  fileName.value = '';
  selected.value = m.root.children[0] ?? m.root;
  history.value = [deepClone(m)];
  historyIndex.value = 0;
  simProfile.value = null;
  analysis.value = null;
  error.value = '';
  void runAnalyze();
}

async function saveOrk(): Promise<void> {
  if (!model.value) return;
  const blob = await modelToOrkBlob(model.value);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(model.value.name || 'rocket').replace(/[\\/:*?"<>|]/g, '_')}.ork`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function loadOfficialExample(file: string): Promise<void> {
  error.value = '';
  loading.value = true;
  menuOpen.value = false;
  examplesOpen.value = false;
  try {
    const resp = await fetch(`/ork-assets/examples/${encodeURIComponent(file)}.ork`);
    if (!resp.ok) throw new Error(`官方示例加载失败（HTTP ${resp.status}）`);
    const m = await parseOrk(await resp.arrayBuffer());
    model.value = m;
    fileName.value = file + '.ork';
    selected.value = m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    simProfile.value = null;
    await runAnalyze();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

// —— 导出 SVG / CSV / OBJ ——
function downloadText(name: string, text: string, mime: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function collectComponents(c: RocketComponent): RocketComponent[] {
  const out: RocketComponent[] = [c];
  for (const child of c.children ?? []) out.push(...collectComponents(child));
  return out;
}

function exportSvg(): void {
  const svg = view2dRef.value?.getSvg();
  if (!svg) return;
  downloadText(`${(model.value?.name || 'rocket').replace(/[\\/:*?"<>|]/g, '_')}.svg`, svg, 'image/svg+xml');
}

function exportCsv(): void {
  if (!model.value) return;
  const rows = collectComponents(model.value.root);
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('name,type,length_m,radius_m,aftRadius_m,axialOffset_m,shape,density_kgm3');
  for (const c of rows) {
    lines.push([
      esc(c.name), esc(c.type),
      (Number.isFinite(c.length) ? c.length : ''), (Number.isFinite(c.radius) ? c.radius : ''),
      (Number.isFinite(c.aftRadius) ? c.aftRadius : ''), (Number.isFinite(c.axialOffset) ? c.axialOffset : ''),
      esc(c.shape ?? ''), c.density ?? '',
    ].join(','));
  }
  downloadText(`${(model.value.name || 'rocket').replace(/[\\/:*?"<>|]/g, '_')}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
}

function exportObj(): void {
  const obj = view3dRef.value?.getObj();
  if (!obj) return;
  downloadText(`${(model.value?.name || 'rocket').replace(/[\\/:*?"<>|]/g, '_')}.obj`, obj, 'text/plain');
}

function onExportBy(kind: string): void {
  menuOpen.value = false;
  if (kind === 'svg') exportSvg();
  else if (kind === 'csv') exportCsv();
  else if (kind === 'obj') exportObj();
}

// —— 打印 / 导出 PDF：生成打印友好页（组件清单 + 参数 + 仿真摘要），浏览器「另存为 PDF」 ——
const TYPE_LABEL: Record<string, string> = {
  rocket: '火箭', stage: '级', nosecone: '头锥', bodytube: '机身管', transition: '过渡段',
  tubecoupler: '管接头', bulkhead: '隔框', centeringring: '定心环', engineblock: '发动机挡块',
  innertube: '发动机架管', trapezoidfinset: '梯形尾翼', ellipticalfinset: '椭圆尾翼',
  freeformfinset: '自由尾翼', parachute: '降落伞', streamer: '飘带', shockcord: '冲击绳',
  masscomponent: '配重', launchlug: '发射导环',
};
const PROP_LABEL: Record<string, string> = {
  material: '材料', surface: '表面', shape: '形状', fincount: '翼片', rootchord: '根弦',
  tipchord: '梢弦', sweep: '后掠', height: '翼高', thickness: '厚度', motorId: '发动机',
  diameter: '伞径', cd: '阻力系数', deployAlt: '开伞高度', cordlength: '绳长', width: '宽度',
  mass: '质量', cant: '倾斜角', offset: '轴向位置', wallthickness: '壁厚',
  shoulderlength: '肩长', shoulderradius: '肩半径',
};
function fmtLen(v: number): string {
  return Number.isFinite(v) ? (v >= 0.001 ? `${(v * 1000).toFixed(1)} mm` : `${(v * 1e6).toFixed(0)} µm`) : '—';
}
function exportPdf(): void {
  if (!model.value) return;
  menuOpen.value = false;
  const m = model.value;
  const rows = collectComponents(m.root);
  const propText = (c: RocketComponent): string => {
    const parts: string[] = [];
    if (c.shape) parts.push(`形状 ${c.shape}`);
    for (const [k, v] of Object.entries(c.properties)) {
      if (!v) continue;
      const label = PROP_LABEL[k] ?? k;
      parts.push(`${label} ${v}`);
    }
    if (c.density) parts.push(`密度 ${c.density} kg/m³`);
    return parts.join(' · ');
  };
  const rowsHtml = rows.map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${TYPE_LABEL[c.type] ?? c.type}</td>
      <td>${c.name}</td>
      <td class="num">${fmtLen(c.length)}</td>
      <td class="num">${fmtLen(c.radius)}</td>
      <td class="num">${fmtLen(c.aftRadius)}</td>
      <td class="num">${fmtLen(c.axialOffset)}</td>
      <td>${propText(c)}</td>
    </tr>`).join('');
  const a = analysis.value;
  const p = simProfile.value;
  const summaryRows = a && a.mass != null && a.cgX != null && a.cpX != null ? `
    <tr><td>总质量</td><td class="num">${a.mass.toFixed(3)} kg</td></tr>
    <tr><td>质心 (CG)</td><td class="num">${(a.cgX * 1000).toFixed(1)} mm</td></tr>
    <tr><td>压心 (CP)</td><td class="num">${(a.cpX * 1000).toFixed(1)} mm</td></tr>
    <tr><td>稳定裕度</td><td class="num">${(a.stability ?? 0).toFixed(2)} 口径</td></tr>` : '';
  const simRows = p && !p.error ? `
    <tr><td>最高高度</td><td class="num">${p.maxAltitude_m.toFixed(1)} m</td></tr>
    <tr><td>最大速度</td><td class="num">${p.maxVelocity_ms.toFixed(1)} m/s</td></tr>
    <tr><td>最大马赫</td><td class="num">${p.maxMachNumber.toFixed(3)}</td></tr>
    <tr><td>到远地点</td><td class="num">${p.timeToApogee_s.toFixed(1)} s</td></tr>
    <tr><td>总飞行时间</td><td class="num">${p.flightTime_s.toFixed(1)} s</td></tr>
    <tr><td>横向风偏</td><td class="num">${p.windDrift_m.toFixed(1)} m</td></tr>` : '';
  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>${m.name} — 设计报告</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 11px/1.5 -apple-system, "PingFang SC", sans-serif; color: #1d1d1f; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .meta { color: #6e6e73; font-size: 11px; margin-bottom: 14px; }
  h2 { font-size: 13px; border-bottom: 1.5px solid #1d1d1f; padding-bottom: 3px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th, td { border: 0.5px solid #c7c7cc; padding: 3px 6px; text-align: left; vertical-align: top; }
  th { background: #f5f5f7; font-weight: 600; white-space: nowrap; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
  @media print { a { display: none; } }
</style></head><body>
<h1>${m.name}</h1>
<div class="meta">OpenRocket Web · 生成于 ${new Date().toLocaleString('zh-CN')} · 组件 ${rows.length - 1} 个 · ${m.creator ?? 'OpenRocket Web'}</div>
<h2>设计总览</h2>
<table><tbody>${summaryRows}<tr><td>组件数</td><td class="num">${rows.length - 1}</td></tr></tbody></table>
<h2>组件清单</h2>
<table>
  <thead><tr><th>#</th><th>类型</th><th>名称</th><th>长度</th><th>半径</th><th>后端半径</th><th>轴向偏移</th><th>参数</th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
${p && !p.error ? `<h2>仿真结果</h2><table><tbody>${simRows}</tbody></table>` : ''}
</body></html>`;
  const win = window.open('', '_blank', 'width=980,height=760');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 350);
}

// —— 单位制（全局：属性面板/2D 悬浮一致；长度内部恒存 m）——
type UnitMode = 'm' | 'mm' | 'cm';
const unitMode = ref<UnitMode>((localStorage.getItem('ork:unit') as UnitMode) || 'mm');
watch(unitMode, (u) => localStorage.setItem('ork:unit', u));

function exportRkt(): void {
  if (!model.value) return;
  menuOpen.value = false;
  const xml = modelToRkt(model.value);
  const blob = new Blob([xml], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (model.value.name || 'rocket').replace(/[\s\/\\:]+/g, '_') + '.rkt';
  a.click();
  URL.revokeObjectURL(url);
}

// —— 引擎状态 ——
import { engineLabel, engineDiag } from './lib/engine';
const engineKind = ref(getEngineBridge().kind);
function engineTip(): string {
  return engineDiag().tip;
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  if (saveTimer) clearTimeout(saveTimer);
});

// —— 稳定性标尺（口径：CG 到 CP 的距离 / 火箭长度）——
function stabVal(): number {
  const v = analysis.value?.stability;
  return v !== null && v !== undefined && Number.isFinite(v) ? v : NaN;
}
function stabPin(): string {
  const v = stabVal();
  if (isNaN(v)) return '0%';
  const pct = Math.min(Math.max(v, 0), 3) / 3 * 100;
  return pct + '%';
}
function stabColor(): string {
  const v = stabVal();
  if (isNaN(v)) return '#8ba3c4';
  if (v < 1) return '#dc2626';
  if (v <= 2) return '#16a34a';
  return '#1677ff';
}
function stabNote(): string {
  const v = stabVal();
  if (isNaN(v)) return '暂无法计算';
  if (v < 1) return '不稳定（<1 口径）：需加大尾翼或后移重心';
  if (v <= 2) return '稳定（1–2 口径，常规推荐区间）';
  return '过稳定（>2 口径）：飞行可能过于迟钝';
}
</script>

<template>
  <div class="app" @dragover.prevent @drop="onDrop">
    <div v-if="restoreInfo" class="restore-bar">
      <span>检测到上次未完成的工作（自动保存于 {{ restoreInfo.time }}）</span>
      <button class="btn primary sm" @click="restoreAuto">恢复</button>
      <button class="btn ghost sm" @click="discardAuto">丢弃</button>
    </div>

    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <img class="logo" src="/ork-assets/logo/openrocket-256.png" alt="OpenRocket" />
        <span class="brand-name">OpenRocket<span class="web">Web</span></span>
        <span v-if="model" class="doc-name">{{ model.name }}<span v-if="fileName" class="doc-file"> · {{ fileName }}</span></span>
      </div>
      <div class="tb-sep"></div>

      <button class="btn onDark examples-trigger" title="打开示例面板" @click="examplesOpen = true">示例 ▾</button>

      <div class="menu" ref="fileMenuEl">
        <button class="btn onDark menu-trigger" :class="{ active: menuOpen }" @click.stop="menuOpen = !menuOpen">文件 ▾</button>
        <div v-if="menuOpen" class="menu-panel">
          <button class="mi" @click="newRocket">新建</button>
          <label class="mi file">打开…<input ref="fileInput" type="file" accept=".ork,.rkt" style="display: none" @change="onPick" /></label>
          <button class="mi" :disabled="!model" @click="saveOrk">保存 .ork</button>
          <div class="mi-sep"></div>
          <button class="mi" @click="examplesOpen = true">示例设计面板（内置 6 + 官方 16）…</button>
          <div class="mi-sep"></div>
          <div class="mi-head">导出</div>
          <button class="mi" :disabled="!model" @click="onExportBy('svg')">SVG 图形</button>
          <button class="mi" :disabled="!model" @click="onExportBy('csv')">CSV 组件清单</button>
          <button class="mi" :disabled="!model" @click="exportRkt">导出 RKT（Rocksim）</button>
          <button class="mi" :disabled="!model" @click="onExportBy('obj')">OBJ 3D 模型</button>
          <button class="mi" :disabled="!model" @click="exportPdf">打印 / 导出 PDF</button>
        </div>
      </div>

      <div class="spacer"></div>
      <span v-if="loading" class="status">解析中…</span>
      <span v-if="error" class="error">错误：{{ error }}</span>
      <select class="unit-select" :value="unitMode" @change="unitMode = ($event.target as HTMLSelectElement).value as UnitMode" title="长度单位（内部恒存米）">
        <option value="m">m</option>
        <option value="mm">mm</option>
        <option value="cm">cm</option>
      </select>
      <span class="engine-tag" :title="engineTip()">{{ engineLabel() }}</span>
      <button class="btn primary sim-btn" :disabled="!model || simLoading" @click="runSimulate">{{ simLoading ? '仿真中…' : '▶ 仿真' }}</button>
    </header>

    <!-- 功能区 Tab 栏 -->
    <nav class="work-tabs">
      <button :class="{ on: activeTab === 'design' }" @click="activeTab = 'design'">
        <span class="tab-ic">✏</span>设计<span class="tab-en">Design</span>
      </button>
      <button :class="{ on: activeTab === 'motor' }" @click="activeTab = 'motor'">
        <span class="tab-ic">⚙</span>发动机配置<span class="tab-en">Motors</span>
      </button>
      <button :class="{ on: activeTab === 'sim' }" @click="activeTab = 'sim'">
        <span class="tab-ic">🚀</span>模拟发射<span class="tab-en">Flight</span>
      </button>
      <span v-if="dirty" class="dirty-tag" title="有未落盘更改，正在自动保存">● 未保存</span>
    </nav>

    <!-- 功能区 -->
    <section class="work-area" :style="{ height: workH + '%' }">
      <div v-if="engineKind === 'none'" class="engine-warn">
        <b>引擎不可用</b> — {{ engineTip() }}
      </div>

      <!-- 设计 Tab：左组件树 + 右组件库 -->
      <template v-if="activeTab === 'design'">
        <aside class="tree-col" :style="{ width: leftW + 'px' }">
          <div class="pane-title">
            <span>组件树</span>
            <span class="tree-ops">
              <button class="mini" :disabled="!canUndo()" title="撤销（Cmd/Ctrl+Z）" @click="undo">↶</button>
              <button class="mini" :disabled="!canRedo()" title="重做" @click="redo">↷</button>
              <button class="mini" :disabled="!model" title="添加新级（多级火箭）" @click="addStage">＋ 级</button>
            </span>
          </div>
          <ComponentTree v-if="model" :root="model.root" v-model="selected" :hovered="hoveredComp" @copy="copyComponent" @remove="removeComponent" @move="moveComponent" @move-to="moveToComponent" />
          <div v-else class="hint">新建或打开设计后显示</div>
        </aside>
        <div class="resize-handle" title="拖拽调整宽度" @mousedown.prevent="startResize('left', $event)"></div>
        <section class="lib-col">
          <div class="pane-title">
            <span>组件库</span>
            <span class="lib-count">OpenRocket 官方 · 4 类</span>
          </div>
          <div class="lib-scroll">
            <ComponentLibrary @add="onLibAdd" />
          </div>
        </section>
      </template>

      <!-- 发动机配置 Tab -->
      <template v-else-if="activeTab === 'motor'">
        <MotorConfigPanel
          :configs="configs"
          :current-config-id="currentConfigId"
          :motors="[...MOTORS, ...customMotors]"
          :motor-id="selectedMotor.id"
          :mounts="motorMounts()"
          @switch-config="switchConfig"
          @new-config="newConfig"
          @delete-config="deleteConfig"
          @rename-config="renameConfig"
          @copy-config="copyConfig"
          @motor-change="(m: MotorSpec) => (selectedMotor = m)"
          @motor-import="onMotorImport"
        />
      </template>

      <!-- 模拟发射 Tab -->
      <template v-else>
        <div class="sim-scroll">
          <SimulationPanel
            :profile="simProfile"
            :loading="simLoading"
            :motors="[...MOTORS, ...customMotors]"
            :motor-id="selectedMotor.id"
            :conditions="simConditions"
            :delay-scan="delayScan"
            :delay-loading="delayScanLoading"
            :compare-rows="compareRows"
            :compare-loading="compareLoading"
            @motor-change="(m: MotorSpec) => (selectedMotor = m)"
            @motor-import="onMotorImport"
            @conditions-change="(c: SimConditions) => (simConditions = c)"
            @optimize-delay="runOptimizeDelay"
            @compare-all="runCompareAll"
            @select-compare="selectCompareRow"
          />
        </div>
      </template>
    </section>

    <!-- 垂直分隔条（调功能区/预览区高度） -->
    <div class="v-resize" title="拖拽调整功能区高度" @mousedown.prevent="startVResize($event)"></div>

    <!-- 预览区 -->
    <section class="preview-area">
      <div class="prev-head">
        <div class="seg view-seg">
          <button :class="{ on: viewMode === '2d' }" @click="viewMode = '2d'">2D 侧视</button>
          <button :class="{ on: viewMode === '3d' }" @click="viewMode = '3d'">3D 视图</button>
          <span class="view-sep"></span>
          <button :class="{ on: orientation === 'vertical' }" title="火箭竖直摆放" @click="orientation = 'vertical'">竖</button>
          <button :class="{ on: orientation === 'horizontal' }" title="火箭水平摆放" @click="orientation = 'horizontal'">横</button>
        </div>
        <div class="prev-title">{{ model ? model.name : '火箭预览' }}</div>
        <div class="prev-stab" v-if="previewInfo.stability != null" :style="{ color: stabColor() }" :title="stabNote()">
          稳定度 {{ previewInfo.stability.toFixed(2) }} 口径
        </div>
        <div class="prev-scale">
          <div class="stab-scale">
            <div class="stab-zone z-unstable"></div>
            <div class="stab-zone z-ok"></div>
            <div class="stab-zone z-over"></div>
            <span class="stab-mark m0">0</span><span class="stab-mark m1">1</span><span class="stab-mark m2">2</span><span class="stab-mark m3">3</span>
            <span class="stab-pin" :style="{ left: stabPin() }"></span>
          </div>
        </div>
      </div>

      <div class="prev-body">
        <div class="canvas-wrap">
          <RocketView3D ref="view3dRef" v-if="viewMode === '3d' && model" :root="model.root" :selected="selected" :cg-x="analysis?.cgX ?? null" :cp-x="analysis?.cpX ?? null" :orientation="orientation" @hover="hoveredComp = $event" @pick="selected = $event" />
          <RocketView2D ref="view2dRef" v-else-if="model" :root="model.root" :selected="selected" :unit-mode="unitMode" :cg-x="analysis?.cgX ?? null" :cp-x="analysis?.cpX ?? null" :orientation="orientation" @hover="hoveredComp = $event" @pick="selected = $event" @change="onPropChanged" />
          <div v-else class="empty-state">
            <div class="es-title">开始设计你的火箭</div>
            <div class="es-cards">
              <button class="es-card" @click="newRocket">
                <span class="es-icon">＋</span>
                <span class="es-name">新建火箭</span>
                <span class="es-desc">从空白开始，用上方组件库搭建</span>
              </button>
              <button class="es-card" @click="fileInput?.click()">
                <span class="es-icon">⇪</span>
                <span class="es-name">打开 .ork</span>
                <span class="es-desc">加载已有的 OpenRocket 设计文件</span>
              </button>
            </div>
            <p class="es-sub">或将 .ork 文件拖入窗口 · 也可用顶部「文件 → 示例设计」快速体验</p>
          </div>
        </div>
        <div class="resize-handle" title="拖拽调整宽度" @mousedown.prevent="startResize('right', $event)"></div>
        <aside class="prop-col" :style="{ width: rightW + 'px' }">
          <div class="pane-title">
            <span>属性</span>
            <span v-if="selected" class="prop-type">{{ typeLabelOf(selected) }}</span>
          </div>
          <PropertyPanel :component="selected" :hovered="hoveredComp" :unit-mode="unitMode" @changed="onPropChanged" @remove="removeSelected" />
        </aside>
      </div>

      <!-- 信息条（官方风格） -->
      <div class="info-bar">
        <div class="info-item"><span class="i-label">长度</span><span class="i-val">{{ fmtLen2(previewInfo.length) }}</span></div>
        <div class="info-item"><span class="i-label">最大直径</span><span class="i-val">Ø {{ fmtLen2(previewInfo.diameter) }}</span></div>
        <div class="info-item"><span class="i-label">质量</span><span class="i-val">{{ previewInfo.mass != null ? fmtMass(previewInfo.mass) : '—' }}</span></div>
        <div class="info-item"><span class="i-label">远地点</span><span class="i-val">{{ previewInfo.apogee != null ? previewInfo.apogee.toFixed(0) + ' m' : '—' }}</span></div>
        <div class="info-item"><span class="i-label">最大速度</span><span class="i-val">{{ previewInfo.maxV != null ? previewInfo.maxV.toFixed(1) + ' m/s' : '—' }}</span></div>
        <div class="info-item"><span class="i-label">重心 CG</span><span class="i-val">{{ previewInfo.cg != null ? fmtLen2(previewInfo.cg) : '—' }}</span></div>
        <div class="info-item"><span class="i-label">压心 CP</span><span class="i-val">{{ previewInfo.cp != null ? fmtLen2(previewInfo.cp) : '—' }}</span></div>
      </div>
    </section>

    <ExamplesPanel
      :open="examplesOpen"
      @close="examplesOpen = false"
      @load-preset="loadPresetByName"
      @load-official="loadOfficialExample"
    />
  </div>
</template>


<style scoped>
/* —— Apple HIG × Figma 规范：三栏工作台 —— */
.app {
  display: flex; flex-direction: column; height: 100vh; width: 100%;
  font-family: var(--sans); color: var(--text); background: var(--bg);
}

/* 顶栏：深蓝渐变 + 毛玻璃 */
.topbar {
  display: flex; align-items: center; gap: var(--sp-3);
  height: 52px; padding: 0 var(--sp-4); flex: none;
  background: var(--topbar-grad);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 4px 20px rgba(8, 26, 61, 0.35);
  position: relative; z-index: 10;
}
.tb-sep { width: 1px; height: 20px; background: rgba(255, 255, 255, 0.15); margin: 0 4px; flex: none; }
.topbar::after {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0) 55%);
}
.brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.logo {
  width: 26px; height: 26px; flex: none; display: grid; place-items: center;
  font-size: 14px; color: #fff; border-radius: 8px;
  background: linear-gradient(160deg, #2f8bff, #0a5cd6);
  box-shadow: 0 2px 8px rgba(10, 132, 255, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}
.brand-name { font-weight: var(--fw-bold); font-size: var(--fs-callout); letter-spacing: 0.2px; color: #fff; }
.doc-name { font-size: var(--fs-body); color: rgba(216, 232, 255, 0.82); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }
.doc-file { color: rgba(158, 190, 235, 0.66); }
.top-group { display: flex; align-items: center; gap: var(--sp-2); flex: none; }
.top-group.hist { gap: 4px; }
.spacer { flex: 1; }
.status { font-size: var(--fs-body); color: rgba(216, 232, 255, 0.82); }
.error { font-size: var(--fs-body); color: #ffb4ad; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.unit-select {
  font: inherit; font-size: 12px; color: var(--text); background: var(--bg);
  border: 1px solid var(--gray-200, #d0d0d8); border-radius: 6px; padding: 3px 6px; margin-right: 4px;
}
.engine-tag {
  font-size: var(--fs-caption); color: #d9ecff; background: rgba(10, 132, 255, 0.24);
  border: 1px solid rgba(125, 185, 255, 0.5); border-radius: var(--r-full); padding: 3px 12px; flex: none;
  cursor: help; backdrop-filter: blur(6px);
}
.engine-warn {
  background: var(--orange-soft); border-bottom: 1px solid #f4d0a0; color: #b45309;
  font-size: var(--fs-body); padding: 7px var(--sp-4); flex: none;
}
.preset.field {
  background: rgba(255, 255, 255, 0.1); color: #e8f1ff; border-color: rgba(150, 200, 255, 0.5);
  padding: 5px 10px; font-size: var(--fs-body); backdrop-filter: blur(8px);
}
.preset.field option { color: var(--text); background: #fff; }

/* —— 新布局：上功能区（三 Tab）+ 下预览 —— */
.work-tabs {
  display: flex; align-items: center; gap: 4px; flex: none;
  height: 40px; padding: 0 14px;
  background: var(--panel); border-bottom: 1px solid var(--border);
}
.work-tabs button {
  display: inline-flex; align-items: baseline; gap: 6px;
  font: inherit; font-size: 13px; font-weight: 600; color: var(--text-2);
  background: transparent; border: none; border-radius: 7px;
  padding: 6px 14px; cursor: pointer; position: relative;
  transition: color 0.12s, background 0.12s;
}
.work-tabs button:hover { color: var(--text); background: var(--gray-100); }
.work-tabs button.on { color: var(--primary-strong); background: var(--primary-soft); }
.work-tabs button.on::after {
  content: ''; position: absolute; left: 14px; right: 14px; bottom: -1px;
  height: 2px; border-radius: 1px; background: var(--primary);
}
.tab-ic { font-size: 12px; }
.tab-en { font-size: 10px; color: var(--text-4, #a3aab5); font-weight: 500; letter-spacing: 0.3px; }
.work-tabs button.on .tab-en { color: var(--blue-300); }

.work-area { flex: none; display: flex; min-height: 0; overflow: hidden; background: var(--bg); }
.tree-col {
  flex: none; display: flex; flex-direction: column; gap: 0;
  background: var(--panel); border-right: 1px solid var(--border); overflow: hidden;
}
.tree-col .pane-title { padding: 10px 8px 6px 14px; margin-bottom: 0; }
.tree-col .tree { flex: 1; min-height: 0; overflow: auto; padding: 4px 6px 10px; }
.lib-col { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
.lib-col .pane-title { padding: 10px 8px 6px 6px; margin-bottom: 0; }
.lib-count { font-size: 10px; color: var(--text-3); font-weight: 500; }
.lib-scroll { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 14px; }
.sim-scroll { flex: 1; min-width: 0; overflow: auto; padding: 14px 18px; background: var(--bg); }
.sim-scroll .sim-pane { min-height: 100%; }

/* 垂直分隔条（功能区/预览区高度） */
.v-resize {
  flex: none; height: 5px; cursor: row-resize; position: relative; z-index: 8;
  background: var(--border); transition: background 0.15s ease;
}
.v-resize::after {
  content: ''; position: absolute; left: 0; right: 0; top: 1px; height: 3px;
  background: transparent; transition: background 0.15s ease;
}
.v-resize:hover::after, .v-resize:active::after { background: var(--primary); }

/* —— 预览区 —— */
.preview-area { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg); }
.prev-head {
  display: flex; align-items: center; gap: 14px; flex: none;
  height: 38px; padding: 0 14px; background: var(--panel);
  border-bottom: 1px solid var(--border);
}
.prev-title { font-size: 13px; font-weight: 600; color: var(--text-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.prev-stab { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.prev-scale { margin-left: auto; width: 190px; }
.prev-scale .stab-scale { height: 8px; }
.prev-scale .stab-mark { top: 11px; font-size: 9px; }
.prev-scale .stab-pin { top: -3px; height: 14px; }

.prev-body { flex: 1; display: flex; min-height: 0; }
.canvas-wrap { flex: 1; min-width: 0; position: relative; overflow: hidden; }
.prop-col {
  flex: none; display: flex; flex-direction: column; min-height: 0;
  background: var(--panel); border-left: 1px solid var(--border); overflow: auto;
}
.prop-col .pane-title { padding: 10px 12px 6px; margin-bottom: 0; }
.prop-type { font-size: 10px; color: var(--primary-strong); font-weight: 600; }

/* 信息条 */
.info-bar {
  flex: none; display: flex; align-items: center; gap: 0;
  height: 34px; padding: 0 8px; background: var(--panel);
  border-top: 1px solid var(--border);
  overflow-x: auto; white-space: nowrap;
}
.info-item {
  display: flex; align-items: baseline; gap: 6px; padding: 0 12px;
  border-right: 1px solid var(--border); flex: none;
}
.info-item:last-child { border-right: none; }
.i-label { font-size: 10px; color: var(--text-3); font-weight: 600; letter-spacing: 0.4px; }
.i-val { font-size: 12px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }


/* —— 文件菜单 —— */
.menu { position: relative; }
.menu-trigger.active { background: rgba(255, 255, 255, 0.16); color: #fff; }
.menu-panel {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 60;
  min-width: 210px; padding: 6px;
  background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--border); border-radius: var(--r-md);
  box-shadow: var(--sh-lg); display: flex; flex-direction: column;
  max-height: min(560px, calc(100vh - 70px)); overflow-y: auto;
}
.mi {
  font: inherit; font-size: var(--fs-body); color: var(--text); text-align: left;
  padding: 7px 10px; border: none; border-radius: var(--r-sm); background: transparent; cursor: pointer;
  display: flex; align-items: center; gap: 8px;
}
.mi:hover:not(:disabled) { background: var(--primary); color: #fff; }
.mi:disabled { opacity: 0.45; cursor: default; }
.mi.file { cursor: pointer; }
.mi-sep { height: 1px; background: var(--gray-200); margin: 5px 4px; }
.mi-head { font-size: var(--fs-caption); color: var(--text-3); font-weight: 600; padding: 6px 10px 2px; letter-spacing: 0.4px; }
.mi-en { margin-left: auto; font-size: 10px; color: var(--text-4, #a3aab5); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }

/* —— 工具条（可折叠） —— */
.toolbar {
  display: flex; align-items: center; gap: var(--sp-3);
  height: 38px; padding: 0 var(--sp-4); flex: none;
  background: var(--panel); border-bottom: 1px solid var(--border);
}
.tb-group { display: flex; align-items: center; gap: 6px; }
.tb-sep-h { width: 1px; height: 18px; background: var(--gray-200); }
.toolbar .cfg-select { max-width: 140px; padding: 4px 8px; font-size: 12px; }
.toolbar .dirty-tag { color: var(--warn); font-size: var(--fs-caption); }

/* 拖拽分隔条 */
.resize-handle {
  flex: none; width: 6px; cursor: col-resize; position: relative; z-index: 6;
  background: transparent;
}
.resize-handle::after {
  content: ''; position: absolute; left: 2px; top: 0; bottom: 0; width: 2px;
  background: transparent; transition: background 0.15s ease;
}
.resize-handle:hover::after, .resize-handle:active::after { background: var(--primary); }
.pane-title {
  font-size: var(--fs-body); color: var(--text); font-weight: var(--fw-semibold);
  margin-bottom: var(--sp-2); display: flex; align-items: center; justify-content: space-between;
  letter-spacing: 0.1px; padding-left: 8px; position: relative;
}
.pane-title::before {
  content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
  width: 3px; height: 13px; border-radius: 2px;
  background: linear-gradient(180deg, #3395ff, #0a84ff);
  box-shadow: 0 0 6px rgba(10, 132, 255, 0.45);
}
.view-seg { flex: none; }
.view-sep { width: 1px; height: 16px; background: var(--border-strong); margin: 0 4px; align-self: center; }
.cfg { flex: none; gap: 4px; }
.cfg-select { max-width: 120px; }
.mini {
  font: inherit; font-size: var(--fs-caption); font-weight: var(--fw-medium);
  color: var(--primary-strong); background: var(--primary-soft);
  border: 1px solid var(--blue-200); border-radius: var(--r-sm); padding: 3px 10px; cursor: pointer;
}
.mini:hover:not(:disabled) { background: var(--blue-100); }
.mini:disabled { opacity: 0.4; cursor: default; }
.hint { color: var(--text-3); font-size: var(--fs-body); padding: var(--sp-2); }


.empty-state {
  flex: 1; min-height: 240px; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: var(--sp-5);
  border: 1.5px dashed var(--gray-300); border-radius: var(--r-md);
  background: radial-gradient(120% 120% at 50% 0%, #f8fbff 0%, #eef4fd 100%);
  padding: var(--sp-6);
}
.es-title { font-size: var(--fs-title3); font-weight: var(--fw-bold); color: var(--text); }
.es-cards { display: flex; gap: var(--sp-4); flex-wrap: wrap; justify-content: center; }
.es-card {
  width: 200px; padding: var(--sp-5) var(--sp-4); background: #fff; border: 1px solid var(--border);
  border-radius: var(--r-xl); cursor: pointer; text-align: center; font: inherit;
  display: flex; flex-direction: column; align-items: center; gap: var(--sp-2);
  box-shadow: var(--sh-sm); transition: all 0.18s ease;
}
.es-card:hover { border-color: var(--blue-400); box-shadow: var(--sh-md); transform: translateY(-2px); }
.es-icon {
  width: 44px; height: 44px; display: grid; place-items: center; font-size: 20px; color: var(--primary);
  background: var(--primary-soft); border-radius: var(--r-lg); margin-bottom: 2px;
}
.es-name { font-size: var(--fs-callout); font-weight: var(--fw-semibold); color: var(--text); }
.es-desc { font-size: var(--fs-body); color: var(--text-3); line-height: 1.5; }
.es-sub { font-size: var(--fs-body); color: var(--text-3); margin: 0; }

/* 分析卡 */
.analysis-pane { }
.metrics { display: flex; gap: var(--sp-6); flex-wrap: wrap; margin-bottom: var(--sp-2); }
.metric { display: flex; flex-direction: column; gap: 2px; }
.m-label { font-size: var(--fs-caption); color: var(--text-3); font-weight: var(--fw-medium); letter-spacing: 0.3px; text-transform: uppercase; }
.m-val { font-size: var(--fs-title3); font-weight: var(--fw-bold); color: var(--text); font-variant-numeric: tabular-nums; }
.m-unit { font-size: var(--fs-caption); font-weight: var(--fw-regular); color: var(--text-3); margin-left: 3px; }
.src { font-size: var(--fs-caption); color: var(--text-3); margin-top: var(--sp-2); }

/* 稳定性标尺 */
.stab-bar-wrap { margin: var(--sp-2) 0 2px; }
.stab-scale {
  position: relative; height: 12px; border-radius: var(--r-full);
  display: flex; background: var(--gray-100); overflow: hidden;
  border: 1px solid var(--gray-200);
}
.stab-zone { height: 100%; }
.z-unstable { width: 33.33%; background: linear-gradient(90deg, #ffd9d6, #ffb4ad); }
.z-ok { width: 33.34%; background: linear-gradient(90deg, #c9ecd2, #9fe3b5); }
.z-over { width: 33.33%; background: linear-gradient(90deg, #cfe3ff, #a9ccff); }
.stab-mark { position: absolute; top: 15px; font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.stab-mark.m0 { left: 0; }
.stab-mark.m1 { left: 33.33%; transform: translateX(-50%); }
.stab-mark.m2 { left: 66.66%; transform: translateX(-50%); }
.stab-mark.m3 { right: 0; }
.stab-pin {
  position: absolute; top: -4px; width: 5px; height: 18px; border-radius: 3px;
  background: #fff; border: 2px solid var(--blue-600); transform: translateX(-2.5px);
  box-shadow: 0 1px 4px rgba(10, 132, 255, 0.55); z-index: 2;
}
.stab-note { display: block; font-size: var(--fs-body); margin-top: var(--sp-2); font-weight: var(--fw-medium); }
.restore-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  background: linear-gradient(90deg, var(--primary-soft), #fff);
  border-bottom: 1px solid var(--border);
  font-size: 13px; color: var(--text-1);
}
.restore-bar .btn { margin-left: auto; }
.restore-bar .btn:last-child { margin-left: 0; }
.dirty-tag { color: #ff9f0a; font-size: 14px; font-weight: 700; margin-right: 2px; animation: blink 1.2s ease-in-out infinite; }
@keyframes blink { 50% { opacity: 0.35; } }
</style>
