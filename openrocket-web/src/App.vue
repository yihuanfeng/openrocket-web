<script setup lang="ts">
// 主应用：上功能区（设计/发动机配置/模拟发射 三 Tab）+ 下预览（2D/3D + 属性 + 信息条）
import { ref, toRaw, watch, onMounted, onBeforeUnmount, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { parseOrk } from './lib/orkParser';
import { layoutRocket } from './lib/geometry';
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
import { CURATED_MOTORS } from './lib/motorDB';
import ComponentLibrary from './components/ComponentLibrary.vue';
import MotorConfigPanel from './components/MotorConfigPanel.vue';
import MotorDatabasePanel from './components/MotorDatabasePanel.vue';
import { makeComponent } from './lib/componentFactory';
import { PRESETS } from './lib/presets';
import { modelToOrkBlob, type OrkWebMeta } from './lib/orkSerializer';

const { t, locale } = useI18n();
const viewMode = ref<'2d' | '3d'>('2d');
// 部署路径基准（GH Pages 子路径部署兼容；本地/根路径为 './'）
const base = import.meta.env.BASE_URL;
// 默认横置摆放（无存储记录时）；用户切换后尊重 localStorage
const orientation = ref<'vertical' | 'horizontal'>(localStorage.getItem('ork:orient') === 'v' ? 'vertical' : 'horizontal');
function setOrient(o: 'vertical' | 'horizontal'): void {
  orientation.value = o;
  localStorage.setItem('ork:orient', o === 'horizontal' ? 'h' : 'v');
}
const view2dRef = ref<InstanceType<typeof RocketView2D> | null>(null);
const view3dRef = ref<InstanceType<typeof RocketView3D> | null>(null);

// —— 新布局：功能区 Tab（设计 / 发动机配置 / 模拟发射）——
const activeTab = ref<'design' | 'motor' | 'sim'>('design');

/** 发动机库独立页面（hash 路由 #/motors，全屏覆盖主布局） */
const dbOpen = ref(false);
function syncHash() { dbOpen.value = window.location.hash === '#/motors'; }
function openDb() { window.location.hash = '#/motors'; dbOpen.value = true; }
function closeDb() { window.location.hash = ''; dbOpen.value = false; }
// 主布局：v=上下（功能区在上、预览在下）、h=左右（功能区在左、预览在右）
type LayoutMode = 'v' | 'h';
const layoutMode = ref<LayoutMode>((localStorage.getItem('ork:layout') as LayoutMode) || 'v');
function setLayout(m: LayoutMode): void {
  layoutMode.value = m;
  localStorage.setItem('ork:layout', m);
}
// 设置面板
const settingsOpen = ref(false);
const settingsTab = ref<'layout' | 'unit' | 'lang'>('layout');
function setLang(l: 'zh' | 'en'): void {
  locale.value = l;
  localStorage.setItem('ork:lang', l);
}

// 功能区尺寸：上下=高度百分比，左右=宽度百分比；分隔条双模式拖拽
const workH = ref(Number(localStorage.getItem('ork:workH')) || 44);
const workW = ref(Number(localStorage.getItem('ork:workW')) || 48);
const workAreaStyle = computed(() =>
  layoutMode.value === 'h'
    ? { width: workW.value + '%' }
    : { height: `min(${workH.value}%, calc(100vh - 390px))` },
);
function startVResize(e: MouseEvent): void {
  e.preventDefault();
  const isH = layoutMode.value === 'h';
  const start = isH ? e.clientX : e.clientY;
  const startPct = isH ? workW.value : workH.value;
  const onMove = (ev: MouseEvent) => {
    const mainRow = document.querySelector('.main-row');
    const span = isH
      ? (mainRow?.clientWidth ?? 1200)
      : (document.querySelector('.app')?.clientHeight ?? 800);
    const dist = isH ? ev.clientX - start : ev.clientY - start;
    const pct = startPct + (dist / span) * 100;
    if (isH) workW.value = Math.min(72, Math.max(25, pct));
    else workH.value = Math.min(74, Math.max(30, pct));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    localStorage.setItem(isH ? 'ork:workW' : 'ork:workH', String(isH ? workW.value : workH.value));
  };
  document.body.style.cursor = isH ? 'col-resize' : 'row-resize';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

// —— 发动机座路径定位（发动机配置 Tab 用）——
function mountCandidates(root: RocketComponent): RocketComponent[] {
  const out: RocketComponent[] = [];
  const walk = (c: RocketComponent, path: number[]) => {
    if (c.type === 'innertube' || (c.type === 'bodytube' && c.properties?.['motormount'] === 'true')) {
      (c as unknown as { __mPath?: string }).__mPath = path.join('.');
      out.push(c);
    }
    for (let i = 0; i < (c.children ?? []).length; i++) walk(c.children[i], [...path, i]);
  };
  walk(root, []);
  return out;
}
function mountPathOf(c: RocketComponent): string {
  return (c as unknown as { __mPath?: string }).__mPath ?? '';
}

// —— 预览信息条（官方风格：长度/直径/质量/远地点/速度/稳定度/CG/CP）——
function rocketLength(root: RocketComponent): number {
  const segs = layoutRocket(root);
  return segs.length ? Math.max(...segs.map((s) => s.z1)) : 0;
}
function maxDiameter(root: RocketComponent): number {
  const segs = layoutRocket(root);
  return segs.length ? Math.max(...segs.map((s) => Math.max(s.r0, s.r1))) * 2 : 0;
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
function typeLabelOf(c: RocketComponent | null): string {
  if (!c) return '';
  const key = c.type === 'rocket' || c.type === 'podset' ? c.type : c.type;
  const v = t(`compTypes.${key}`);
  return v.startsWith('compTypes.') ? c.type : v;
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
    // P0-2：飞行配置与自定义发动机随设计一起持久化
    const payload = {
      model: toRaw(model.value),
      configs: configs.value.map((c) => ({ id: c.id, name: c.name, mounts: c.mounts.map((m) => ({ ...m })) })),
      customMotors: customMotors.value,
    };
    localStorage.setItem(AUTO_KEY, JSON.stringify(payload));
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
    const parsed = JSON.parse(raw) as
      | RocketModel
      | { model: RocketModel; configs?: FlightConfig[]; customMotors?: MotorSpec[] };
    const m = 'model' in parsed ? parsed.model : parsed;
    model.value = m;
    selected.value = m.root.children[0] ?? m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    fileName.value = '';
    restoreInfo.value = null;
    if ('model' in parsed) {
      if (parsed.configs && parsed.configs.length > 0) {
        configs.value = parsed.configs;
        currentConfigId.value = parsed.configs[0].id;
      }
      if (parsed.customMotors) customMotors.value = parsed.customMotors;
    }
    ensureMounts(activeConfig());
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
    configs.value = [{ id: 'cfg-default', name: '默认配置', mounts: [] }];
    currentConfigId.value = 'cfg-default';
    customMotors.value = [];
    applyMotorMeta(m);
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
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: NaN, shape: '',
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
const customMotors = ref<MotorSpec[]>([]);
// —— 飞行配置：命名配置 = 每个发动机座独立选发动机 + 点火时序（对齐 OpenRocket Motors & Configurations）——
interface MountConfig { path: string; motorId: string | null; ignitionDelay: number; }
interface FlightConfig { id: string; name: string; mounts: MountConfig[]; }
const configs = ref<FlightConfig[]>([{ id: 'cfg-default', name: '默认配置', mounts: [] }]);
const currentConfigId = ref('cfg-default');

/** 补齐配置的发动机座条目（模型结构变化后自动对齐：新座补空、失效座保留不删） */
function ensureMounts(cfg: FlightConfig): void {
  if (!model.value) return;
  const paths = mountCandidates(model.value.root).map((m) => mountPathOf(m));
  const map = new Map(cfg.mounts.map((m) => [m.path, m]));
  const next: MountConfig[] = [];
  for (const p of paths) {
    const ex = map.get(p);
    next.push(ex ? { ...ex } : { path: p, motorId: null, ignitionDelay: 0 });
  }
  cfg.mounts = next;
}
function activeConfig(): FlightConfig {
  const cfg = configs.value.find((c) => c.id === currentConfigId.value) ?? configs.value[0];
  ensureMounts(cfg);
  return cfg;
}
const allMotors = computed(() => [...MOTORS, ...CURATED_MOTORS, ...customMotors.value]);
function motorByIdSafe(id: string): MotorSpec | null {
  return allMotors.value.find((m) => m.id === id) ?? null;
}
/** 面板数据结构：当前配置 × 当前模型发动机座（含直径适配过滤） */
interface MountItem {
  path: string; comp: RocketComponent; name: string; compName: string; type: string;
  outerDiaMM: number; motorId: string | null; motor: MotorSpec | null;
  ignitionDelay: number; fitting: MotorSpec[];
}
const mountItems = computed<MountItem[]>(() => {
  if (!model.value) return [];
  const cfg = activeConfig();
  return mountCandidates(model.value.root).map((comp) => {
    const path = mountPathOf(comp);
    const mc = cfg.mounts.find((m) => m.path === path);
    const motorId = mc?.motorId ?? null;
    const motor = motorId ? motorByIdSafe(motorId) : null;
    // 座径：官方 innertube 通常无 <radius>（继承所在管半径），此处向上取父级半径兜底
    let dia = comp.radius;
    if (!Number.isFinite(dia)) {
      const parent = findParent(model.value!.root, comp);
      if (parent && Number.isFinite(parent.radius)) dia = parent.radius;
    }
    const outerDia = (Number.isFinite(dia) ? dia * 2 : 0) * 1000;
    return {
      path, comp, name: comp.name, compName: comp.name, type: comp.type,
      outerDiaMM: outerDia,
      motorId, motor,
      ignitionDelay: mc?.ignitionDelay ?? 0,
      // 直径适配：发动机直径 ≤ 座径 + 0.5mm 容差（同径可装，跨径档过滤；官方允许大座装小发动机，用适配环）
      fitting: allMotors.value.filter((m) => m.diameterMM <= outerDia + 0.5),
    };
  });
});
function setMountMotor(path: string, motorId: string | null): void {
  const cfg = activeConfig();
  const mc = cfg.mounts.find((m) => m.path === path);
  if (mc) { mc.motorId = motorId; scheduleAutoSave(); scheduleAnalyze(); }
}
function setIgnDelay(path: string, d: number): void {
  const cfg = activeConfig();
  const mc = cfg.mounts.find((m) => m.path === path);
  if (mc && Number.isFinite(d) && d >= 0) { mc.ignitionDelay = Math.round(d * 100) / 100; scheduleAutoSave(); }
}
/** P1-4：属性面板选发动机 → 同步到对应发动机座的飞行配置（同一数据通路） */
function onPanelMotorChange(id: string): void {
  if (!model.value || !selected.value) return;
  const path = mountPathOf(selected.value);
  if (!path) return; // 非发动机座组件（如普通 innertube 无 motormount 标记），仅保留属性
  setMountMotor(path, id || null);
}
/** 模拟发射 tab 快捷选发动机：写入当前配置第一个发动机座（与配置面板同一数据通路），等效官方「发射台快捷换发动机」 */
function onSimMotorChange(m: MotorSpec): void {
  if (!model.value) return;
  const cfg = activeConfig();
  const first = cfg.mounts.find((mc) => mc.motorId) ?? cfg.mounts[0];
  if (first) {
    first.motorId = m.id;
    scheduleAutoSave();
    scheduleAnalyze();
  }
}
/** 主发动机（当前配置第一个非空发动机座）——仿真面板 / 顶部默认展示用 */
const primaryMotor = computed<MotorSpec>(() => {
  const cfg = activeConfig();
  for (const mc of cfg.mounts) {
    if (mc.motorId) { const m = motorByIdSafe(mc.motorId); if (m) return m; }
  }
  return motorById(DEFAULT_MOTOR_ID);
});
/** 仿真发动机序列：每座发动机 + 点火时序（跳过未装发动机座）；空则回退默认发动机 */
function mountedMotors(): { motor: MotorSpec; ignitionDelay: number }[] {
  const cfg = activeConfig();
  const out: { motor: MotorSpec; ignitionDelay: number }[] = [];
  for (const mc of cfg.mounts) {
    if (mc.motorId) { const m = motorByIdSafe(mc.motorId); if (m) out.push({ motor: m, ignitionDelay: mc.ignitionDelay }); }
  }
  if (out.length === 0) out.push({ motor: motorById(DEFAULT_MOTOR_ID), ignitionDelay: 0 });
  return out;
}
function switchConfig(id: string) {
  const cfg = configs.value.find((c) => c.id === id);
  if (!cfg) return;
  currentConfigId.value = cfg.id;
  ensureMounts(cfg);
  simProfile.value = null;
  scheduleAutoSave();
  scheduleAnalyze();
}
function newConfig() {
  const n = configs.value.length + 1;
  const id = 'cfg-' + Date.now().toString(36);
  const src = activeConfig();
  configs.value.push({ id, name: `配置 ${n}`, mounts: src.mounts.map((m) => ({ ...m })) });
  currentConfigId.value = id;
  scheduleAutoSave();
}
function deleteConfig() {
  if (configs.value.length <= 1) return;
  const idx = configs.value.findIndex((c) => c.id === currentConfigId.value);
  configs.value = configs.value.filter((c) => c.id !== currentConfigId.value);
  const next = configs.value[Math.max(0, idx - 1)];
  currentConfigId.value = next.id;
  ensureMounts(next);
  scheduleAutoSave();
  scheduleAnalyze();
}
function renameConfig(id: string, name: string): void {
  const c = configs.value.find((x) => x.id === id);
  if (c) { c.name = name; scheduleAutoSave(); }
}
function copyConfig(): void {
  const cur = activeConfig();
  const n = configs.value.length + 1;
  const id = 'cfg-' + Date.now().toString(36);
  configs.value.push({ id, name: `配置 ${n}`, mounts: cur.mounts.map((m) => ({ ...m })) });
  currentConfigId.value = id;
  scheduleAutoSave();
}
// —— P1-5 仿真条件（风/温度/气压）——
const simConditions = ref<SimConditions>({ ...DEFAULT_CONDITIONS });
// —— P1-7 多配置对比：同火箭多发动机并行仿真，出对比表 ——
interface CompareRow { motorId: string; motorName: string; profile: FlightProfile; }
const compareRows = ref<CompareRow[]>([]);
const compareLoading = ref(false);
watch(
  () => simProfile.value,
  (p) => {
    if (!p || p.error) return;
    const row: CompareRow = { motorId: primaryMotor.value.id, motorName: primaryMotor.value.name, profile: p };
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
    const all = MOTORS;
    const rows = await Promise.all(all.map(async (m) => ({ m, p: await eng.simulate(model.value as RocketModel, [{ motor: m, ignitionDelay: 0 }], simConditions.value) })));
    compareRows.value = rows
      .filter((r): r is { m: MotorSpec; p: FlightProfile } => !!r.p && !r.p.error)
      .map((r) => ({ motorId: r.m.id, motorName: r.m.name, profile: r.p }));
  } finally {
    compareLoading.value = false;
  }
}
function selectCompareRow(row: CompareRow): void {
  const cfg = activeConfig();
  const first = cfg.mounts.find((mc) => mc.motorId);
  if (first) { first.motorId = row.motorId; first.ignitionDelay = 0; }
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
    simProfile.value = await eng.simulate(model.value, mountedMotors(), simConditions.value);
  } finally {
    simLoading.value = false;
  }
}

// —— P1-6 延迟优化（异步分片，不阻塞 UI；基于主发动机）——
async function runOptimizeDelay() {
  if (!model.value) return;
  delayScanLoading.value = true;
  delayScan.value = null;
  try {
    const eng = getEngineBridge();
    if (eng.kind === 'none') return;
    delayScan.value = await eng.optimizeDelay(model.value, primaryMotor.value, simConditions.value);
  } finally {
    delayScanLoading.value = false;
  }
}

// —— 发动机导入（RASP/ENG）——
function onMotorImport(text: string) {
  const m = parseEngFile(text);
  if (!m) return;
  addCustomMotor(m);
}

/** 加入自定义发动机（管理页/文件导入共用）：去重、自动填入首个空发动机座 */
function addCustomMotor(m: MotorSpec) {
  customMotors.value = [...customMotors.value.filter((x) => x.id !== m.id), m];
  const first = activeConfig().mounts.find((mc) => mc.motorId === null);
  if (first) { first.motorId = m.id; scheduleAutoSave(); }
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
    applyMotorMeta(m);
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
onMounted(() => {
  syncHash();
  window.addEventListener('hashchange', syncHash);
});
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
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: NaN, shape: '',
  };
  const root: RocketComponent = {
    type: 'rocket', name: '新火箭', children: [stage],
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: NaN, shape: '',
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
      properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: NaN, shape: '',
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
  configs.value = [{ id: 'cfg-default', name: '默认配置', mounts: [] }];
  currentConfigId.value = 'cfg-default';
  customMotors.value = [];
  applyMotorMeta(m);
  void runAnalyze();
}

async function saveOrk(): Promise<void> {
  if (!model.value) return;
  // P0-2：飞行配置与自定义发动机随 .ork 一起导出（Web 扩展注释，官方可忽略）
  const blob = await modelToOrkBlob(model.value, {
    configs: configs.value.map((c) => ({ id: c.id, name: c.name, mounts: c.mounts.map((m) => ({ ...m })) })),
    customMotors: customMotors.value,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(model.value.name || 'rocket').replace(/[\\/:*?"<>|]/g, '_')}.ork`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** 加载后恢复飞行配置：优先 .ork 内嵌 meta；否则把组件属性上的 motorId 同步进默认配置（官方/旧文件兼容） */
function applyMotorMeta(m: RocketModel & { webMeta?: OrkWebMeta | null }): void {
  const meta = m.webMeta;
  if (meta && meta.configs && meta.configs.length > 0) {
    configs.value = meta.configs.map((c) => ({ id: c.id, name: c.name, mounts: c.mounts.map((x) => ({ ...x })) }));
    currentConfigId.value = meta.configs[0].id;
    if (meta.customMotors) customMotors.value = meta.customMotors;
  } else {
    // 旧文件：组件 [meta] motorId → 首个空发动机座（官方 OpenRocket 语义：发动机座上的发动机）
    configs.value = [{ id: 'cfg-default', name: '默认配置', mounts: [] }];
    currentConfigId.value = 'cfg-default';
    const firstMount = mountCandidates(m.root)[0];
    if (firstMount) {
      const mid = firstMount.properties?.['motorId'];
      if (mid) {
        const cfg = configs.value[0];
        ensureMounts(cfg);
        const mc = cfg.mounts.find((x) => x.path === mountPathOf(firstMount));
        if (mc) mc.motorId = mid;
      }
    }
  }
  ensureMounts(activeConfig());
}

async function loadOfficialExample(file: string): Promise<void> {
  error.value = '';
  loading.value = true;
  menuOpen.value = false;
  examplesOpen.value = false;
  try {
    const resp = await fetch(`${base}ork-assets/examples/${encodeURIComponent(file)}.ork`);
    if (!resp.ok) throw new Error(`官方示例加载失败（HTTP ${resp.status}）`);
    const m = await parseOrk(await resp.arrayBuffer());
    model.value = m;
    fileName.value = file + '.ork';
    selected.value = m.root;
    history.value = [deepClone(m)];
    historyIndex.value = 0;
    simProfile.value = null;
    applyMotorMeta(m);
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
import { engineDiag } from './lib/engine';
const engineKind = ref(getEngineBridge().kind);
function engineLabel(): string {
  const k = engineKind.value;
  if (k === 'wasm') return t('engine.wasm');
  if (k === 'http') return t('engine.http');
  return t('engine.js');
}
function engineTip(): string {
  const d = engineDiag();
  return d.supported ? t('engine.diagOk') : t('engine.diagNo');
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('hashchange', syncHash);
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
  if (isNaN(v)) return t('prop.note.stabNaN');
  if (v < 1) return t('prop.note.unstable');
  if (v <= 2) return t('prop.note.stable');
  return t('prop.note.overStable');
}
</script>

<template>
  <div class="app" @dragover.prevent @drop="onDrop">
    <!-- 发动机库独立页面（全屏） -->
    <div v-if="dbOpen" class="db-screen">
      <MotorDatabasePanel
        :saved-motors="customMotors"
        @close="closeDb"
        @add-motor="(m: MotorSpec) => addCustomMotor(m)"
        @remove-motor="(id: string) => (customMotors = customMotors.filter((m) => m.id !== id))"
      />
    </div>

    <div v-if="restoreInfo" class="restore-bar">
      <span>{{ t('app.restore.title', { time: restoreInfo.time }) }}</span>
      <button class="btn primary sm" @click="restoreAuto">{{ t('app.restore.restore') }}</button>
      <button class="btn ghost sm" @click="discardAuto">{{ t('app.restore.discard') }}</button>
    </div>

    <!-- 顶栏 -->
    <header class="topbar">
      <div class="brand">
        <img class="logo" :src="base + 'ork-assets/logo/openrocket-256.png'" alt="OpenRocket" />
        <span class="brand-name">OpenRocket<span class="web">Web</span></span>
        <span v-if="model" class="doc-name">{{ model.name }}<span v-if="fileName" class="doc-file"> · {{ fileName }}</span></span>
      </div>
      <div class="tb-sep"></div>

      <button class="btn onDark examples-trigger" :title="t('app.file.examplePanel')" @click="examplesOpen = true">{{ t('app.file.examples') }}</button>

      <div class="menu" ref="fileMenuEl">
        <button class="btn onDark menu-trigger" :class="{ active: menuOpen }" @click.stop="menuOpen = !menuOpen">{{ t('app.file.menu') }}</button>
        <div v-if="menuOpen" class="menu-panel">
          <button class="mi" @click="newRocket">{{ t('app.file.new') }}</button>
          <label class="mi file">{{ t('app.file.open') }}<input ref="fileInput" type="file" accept=".ork,.rkt" style="display: none" @change="onPick" /></label>
          <button class="mi" :disabled="!model" @click="saveOrk">{{ t('app.file.saveOrk') }}</button>
          <div class="mi-sep"></div>
          <button class="mi" @click="examplesOpen = true">{{ t('app.file.examplePanel') }}</button>
          <div class="mi-sep"></div>
          <div class="mi-head">{{ t('app.file.export') }}</div>
          <button class="mi" :disabled="!model" @click="onExportBy('svg')">{{ t('app.file.svg') }}</button>
          <button class="mi" :disabled="!model" @click="onExportBy('csv')">{{ t('app.file.csv') }}</button>
          <button class="mi" :disabled="!model" @click="exportRkt">{{ t('app.file.rkt') }}</button>
          <button class="mi" :disabled="!model" @click="onExportBy('obj')">{{ t('app.file.obj') }}</button>
          <button class="mi" :disabled="!model" @click="exportPdf">{{ t('app.file.pdf') }}</button>
        </div>
      </div>

      <button class="btn onDark db-trigger" :title="t('app.db')" @click="openDb">🗄 {{ t('app.db') }}</button>

      <div class="spacer"></div>
      <span v-if="loading" class="status">{{ t('common.loading') }}</span>
      <span v-if="error" class="error">{{ t('common.error', { msg: error }) }}</span>
      <span class="engine-tag" :title="engineTip()">{{ engineLabel() }}</span>
      <button class="btn primary sim-btn" :disabled="!model || simLoading" @click="runSimulate">{{ simLoading ? t('app.sim.running') : t('app.sim.run') }}</button>
      <button class="btn icon onDark settings-btn" :class="{ active: settingsOpen }" :title="t('settings.settings')" @click="settingsOpen = !settingsOpen">⚙</button>
    </header>

    <!-- 功能区 Tab 栏 -->
    <nav class="work-tabs">
      <button :class="{ on: activeTab === 'design' }" @click="activeTab = 'design'">
        <span class="tab-ic">✏</span>{{ t('app.tabs.design') }}<span class="tab-en">Design</span>
      </button>
      <button :class="{ on: activeTab === 'motor' }" @click="activeTab = 'motor'">
        <span class="tab-ic">⚙</span>{{ t('app.tabs.motors') }}<span class="tab-en">Motors</span>
      </button>
      <button :class="{ on: activeTab === 'sim' }" @click="activeTab = 'sim'">
        <span class="tab-ic">🚀</span>{{ t('app.tabs.flight') }}<span class="tab-en">Flight</span>
      </button>
      <span v-if="dirty" class="dirty-tag" :title="t('app.unsavedTip')">{{ t('app.unsaved') }}</span>
    </nav>

    <!-- 主行：功能区 + 分隔条 + 预览（v=上下 / h=左右） -->
    <div class="main-row" :class="layoutMode === 'h' ? 'layout-h' : 'layout-v'">
    <!-- 功能区 -->
    <section class="work-area" :style="workAreaStyle">
      <div v-if="engineKind === 'none'" class="engine-warn">
        <b>{{ t('app.engineUnavailable') }}</b> — {{ engineTip() }}
      </div>

      <!-- 设计 Tab：左组件树 + 右组件库 -->
      <template v-if="activeTab === 'design'">
        <aside class="tree-col" :style="{ width: leftW + 'px' }">
          <div class="pane-title">
            <span>{{ t('app.tree.title') }}</span>
            <span class="tree-ops">
              <button class="mini" :disabled="!canUndo()" :title="t('app.undoTip')" @click="undo">↶</button>
              <button class="mini" :disabled="!canRedo()" :title="t('app.redoTip')" @click="redo">↷</button>
              <button class="mini" :disabled="!model" :title="t('app.tree.addStageTip')" @click="addStage">{{ t('app.tree.addStage') }}</button>
            </span>
          </div>
          <ComponentTree v-if="model" :root="model.root" v-model="selected" :hovered="hoveredComp" @copy="copyComponent" @remove="removeComponent" @move="moveComponent" @move-to="moveToComponent" />
          <div v-else class="hint">{{ t('app.tree.empty') }}</div>
        </aside>
        <div class="resize-handle" :title="t('app.resizeW')" @mousedown.prevent="startResize('left', $event)"></div>
        <section class="lib-col">
          <div class="pane-title">
            <span>{{ t('app.lib.title') }}</span>
            <span class="lib-count">{{ t('app.lib.subtitle') }}</span>
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
          :motors="allMotors"
          :mounts="mountItems"
          @switch-config="switchConfig"
          @new-config="newConfig"
          @delete-config="deleteConfig"
          @rename-config="renameConfig"
          @copy-config="copyConfig"
          @set-mount-motor="setMountMotor"
          @set-ign-delay="setIgnDelay"
          @motor-import="onMotorImport"
        />
      </template>

      <!-- 模拟发射 Tab -->
      <template v-else>
        <div class="sim-scroll">
          <SimulationPanel
            :profile="simProfile"
            :loading="simLoading"
            :motors="allMotors"
            :motor-id="primaryMotor.id"
            :conditions="simConditions"
            :delay-scan="delayScan"
            :delay-loading="delayScanLoading"
            :compare-rows="compareRows"
            :compare-loading="compareLoading"
            @motor-import="onMotorImport"
            @motor-change="onSimMotorChange"
            @conditions-change="(c: SimConditions) => (simConditions = c)"
            @optimize-delay="runOptimizeDelay"
            @compare-all="runCompareAll"
            @select-compare="selectCompareRow"
          />
        </div>
      </template>
    </section>

    <!-- 垂直分隔条（v：调功能区/预览区高度；h：调左右宽度） -->
    <div class="v-resize" :title="layoutMode === 'h' ? t('app.resizeWorkW') : t('app.resizeWorkH')" @mousedown.prevent="startVResize($event)"></div>

    <!-- 预览区 -->
    <section class="preview-area">
      <div class="prev-head">
        <div class="seg view-seg">
          <button :class="{ on: viewMode === '2d' }" @click="viewMode = '2d'">{{ t('app.view.v2d') }}</button>
          <button :class="{ on: viewMode === '3d' }" @click="viewMode = '3d'">{{ t('app.view.v3d') }}</button>
          <span class="view-sep"></span>
          <button :class="{ on: orientation === 'vertical' }" :title="t('app.view.orientVTip')" @click="setOrient('vertical')">{{ t('app.view.orientV') }}</button>
          <button :class="{ on: orientation === 'horizontal' }" :title="t('app.view.orientHTip')" @click="setOrient('horizontal')">{{ t('app.view.orientH') }}</button>
        </div>
        <div class="prev-title">{{ model ? model.name : t('app.view.name') }}</div>
        <div class="prev-stab" v-if="previewInfo.stability != null" :style="{ color: stabColor() }" :title="stabNote()">
          {{ t('prop.stabLabel', { v: previewInfo.stability.toFixed(2) }) }}
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
            <div class="es-title">{{ t('app.empty.title') }}</div>
            <div class="es-cards">
              <button class="es-card" @click="newRocket">
                <span class="es-icon">＋</span>
                <span class="es-name">{{ t('app.empty.newRocket') }}</span>
                <span class="es-desc">{{ t('app.empty.newRocketDesc') }}</span>
              </button>
              <button class="es-card" @click="fileInput?.click()">
                <span class="es-icon">⇪</span>
                <span class="es-name">{{ t('app.empty.openOrk') }}</span>
                <span class="es-desc">{{ t('app.empty.openOrkDesc') }}</span>
              </button>
            </div>
            <p class="es-sub">{{ t('app.empty.dragHint') }}</p>
          </div>
        </div>
        <div class="resize-handle" :title="t('app.resizeW')" @mousedown.prevent="startResize('right', $event)"></div>
        <aside class="prop-col" :style="{ width: rightW + 'px' }">
          <div class="pane-title">
            <span>{{ t('prop.title') }}</span>
            <span v-if="selected" class="prop-type">{{ typeLabelOf(selected) }}</span>
          </div>
          <PropertyPanel
            :component="selected"
            :hovered="hoveredComp"
            :unit-mode="unitMode"
            :motors="allMotors"
            @changed="onPropChanged"
            @remove="removeSelected"
            @motor-id-change="(id: string) => onPanelMotorChange(id)"
          />
        </aside>
      </div>

      <!-- 信息条（官方风格） -->
      <div class="info-bar">
        <div class="info-item"><span class="i-label">{{ t('app.status.length') }}</span><span class="i-val">{{ fmtLen2(previewInfo.length) }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.maxDia') }}</span><span class="i-val">Ø {{ fmtLen2(previewInfo.diameter) }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.mass') }}</span><span class="i-val">{{ previewInfo.mass != null ? fmtMass(previewInfo.mass) : '—' }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.apogee') }}</span><span class="i-val">{{ previewInfo.apogee != null ? previewInfo.apogee.toFixed(0) + ' m' : '—' }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.maxSpeed') }}</span><span class="i-val">{{ previewInfo.maxV != null ? previewInfo.maxV.toFixed(1) + ' m/s' : '—' }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.cg') }}</span><span class="i-val">{{ previewInfo.cg != null ? fmtLen2(previewInfo.cg) : '—' }}</span></div>
        <div class="info-item"><span class="i-label">{{ t('app.status.cp') }}</span><span class="i-val">{{ previewInfo.cp != null ? fmtLen2(previewInfo.cp) : '—' }}</span></div>
      </div>
    </section>
    </div><!-- /main-row -->

    <!-- 设置面板 -->
    <div v-if="settingsOpen" class="settings-overlay" @click.self="settingsOpen = false">
      <div class="settings-panel">
        <div class="settings-head">
          <span>{{ t('settings.settings') }}</span>
          <button class="settings-x" :title="t('common.close')" @click="settingsOpen = false">×</button>
        </div>
        <div class="settings-body">
          <aside class="settings-tabs">
            <button :class="{ on: settingsTab === 'layout' }" @click="settingsTab = 'layout'">{{ t('settings.tabLayout') }}</button>
            <button :class="{ on: settingsTab === 'unit' }" @click="settingsTab = 'unit'">{{ t('settings.tabUnit') }}</button>
            <button :class="{ on: settingsTab === 'lang' }" @click="settingsTab = 'lang'">{{ t('settings.tabLang') }}</button>
            <button class="soon" disabled>{{ t('settings.tabAppearance') }}<span>{{ t('settings.soon') }}</span></button>
          </aside>
          <section class="settings-content">
            <template v-if="settingsTab === 'layout'">
              <div class="set-title">{{ t('settings.mainLayout') }}</div>
              <div class="layout-options">
                <button class="lo" :class="{ on: layoutMode === 'v' }" @click="setLayout('v')">
                  <span class="lo-pic v"><i class="a"></i><i class="b"></i></span>
                  <span class="lo-txt"><b>{{ t('settings.layoutV') }}</b><small>{{ t('settings.layoutVDesc') }}</small></span>
                </button>
                <button class="lo" :class="{ on: layoutMode === 'h' }" @click="setLayout('h')">
                  <span class="lo-pic h"><i class="a"></i><i class="b"></i></span>
                  <span class="lo-txt"><b>{{ t('settings.layoutH') }}</b><small>{{ t('settings.layoutHDesc') }}</small></span>
                </button>
              </div>
            </template>
            <template v-else-if="settingsTab === 'unit'">
              <div class="set-title">{{ t('settings.lengthUnit') }}</div>
              <div class="unit-options">
                <button :class="{ on: unitMode === 'm' }" @click="unitMode = 'm'">{{ t('settings.unitM') }}</button>
                <button :class="{ on: unitMode === 'mm' }" @click="unitMode = 'mm'">{{ t('settings.unitMM') }}</button>
                <button :class="{ on: unitMode === 'cm' }" @click="unitMode = 'cm'">{{ t('settings.unitCM') }}</button>
              </div>
              <p class="set-note">{{ t('settings.unitHint') }}</p>
            </template>
            <template v-else-if="settingsTab === 'lang'">
              <div class="set-title">{{ t('settings.lang') }}</div>
              <div class="unit-options">
                <button :class="{ on: locale === 'zh' }" @click="setLang('zh')">{{ t('common.zh') }}</button>
                <button :class="{ on: locale === 'en' }" @click="setLang('en')">{{ t('common.en') }}</button>
              </div>
            </template>
          </section>
        </div>
      </div>
    </div>

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
/* 发动机库独立页面：全屏覆盖主布局 */
.db-screen { position: fixed; inset: 0; z-index: 60; background: #07121f; }
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

/* —— 主行：功能区 + 分隔条 + 预览；v=上下（默认），h=左右 —— */
.main-row { display: flex; flex: 1; min-height: 0; }
.main-row.layout-v { flex-direction: column; }
.main-row.layout-h { flex-direction: row; }
.main-row.layout-h .work-area { height: auto !important; min-width: 0; }
.main-row.layout-h .v-resize {
  width: 5px; height: auto; cursor: col-resize;
}
.main-row.layout-h .v-resize::after {
  left: 1px; right: auto; top: 0; bottom: 0; width: 3px; height: auto;
}
.main-row.layout-h .preview-area { flex: 1; min-width: 0; }
.main-row.layout-h .prev-body { min-width: 0; }
.main-row.layout-h .canvas-wrap { min-width: 0; }

/* 顶栏设置按钮 */
.settings-btn {
  font-size: 22px; line-height: 1; padding: 4px 11px;
  display: inline-flex; align-items: center; justify-content: center;
}
.settings-btn.active { background: rgba(255, 255, 255, 0.18); }

/* —— 设置面板：左侧 tabs + 内容 —— */
.settings-overlay {
  position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center;
  background: rgba(8, 20, 40, 0.45); backdrop-filter: blur(2px);
}
.settings-panel {
  width: 760px; max-width: 94vw; height: 480px; max-height: 86vh;
  display: flex; flex-direction: column;
  background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
  box-shadow: 0 24px 60px rgba(6, 18, 40, 0.45);
  overflow: hidden; animation: set-in 0.16s ease;
}
@keyframes set-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
.settings-head {
  display: flex; align-items: center; justify-content: space-between; flex: none;
  padding: 12px 16px; font-size: 14px; font-weight: 700;
  border-bottom: 1px solid var(--border);
}
.settings-x {
  width: 26px; height: 26px; border-radius: 7px; border: none; background: transparent;
  font-size: 15px; color: var(--text-2); cursor: pointer;
}
.settings-x:hover { background: var(--gray-100); color: var(--text); }
.settings-body { display: flex; flex: 1; min-height: 0; }
.settings-tabs {
  width: 128px; flex: none; display: flex; flex-direction: column; gap: 2px;
  padding: 12px 8px; background: var(--bg); border-right: 1px solid var(--border);
}
.settings-tabs button {
  text-align: left; font: inherit; font-size: 13px; font-weight: 600; color: var(--text-2);
  background: transparent; border: none; border-radius: 7px; padding: 8px 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between;
}
.settings-tabs button:hover { background: var(--gray-100); color: var(--text); }
.settings-tabs button.on { background: var(--primary-soft); color: var(--primary-strong); }
.settings-tabs button.soon { opacity: 0.45; cursor: not-allowed; }
.settings-tabs button.soon span {
  font-size: 9px; color: var(--text-3); border: 1px solid var(--border); border-radius: 20px; padding: 1px 6px;
}
.settings-content { flex: 1; min-width: 0; overflow: auto; padding: 18px 22px; }
.set-title { font-size: 13px; font-weight: 700; color: var(--text); margin-bottom: 12px; }
.layout-options { display: flex; flex-direction: column; gap: 8px; }
.lo {
  display: flex; align-items: center; gap: 12px; text-align: left;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
  background: var(--bg); border: 1.5px solid var(--border); transition: border-color 0.12s, box-shadow 0.12s;
}
.lo:hover { border-color: var(--blue-300); }
.lo.on { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-soft); }
.lo-pic {
  width: 64px; height: 42px; flex: none; border-radius: 7px; overflow: hidden;
  background: var(--gray-100); border: 1px solid var(--border); position: relative;
}
.lo-pic i { position: absolute; display: block; background: var(--primary); border-radius: 2px; }
.lo-pic.v i.a { left: 4px; right: 4px; top: 4px; height: 13px; opacity: 0.9; }
.lo-pic.v i.b { left: 4px; right: 4px; bottom: 4px; height: 17px; opacity: 0.55; }
.lo-pic.h i.a { top: 4px; bottom: 4px; left: 4px; width: 26px; opacity: 0.9; }
.lo-pic.h i.b { top: 4px; bottom: 4px; right: 4px; width: 26px; opacity: 0.55; }
.lo-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lo-txt b { font-size: 13px; color: var(--text); }
.lo-txt small { font-size: 11px; color: var(--text-3); }
.unit-options { display: flex; flex-direction: column; gap: 8px; }
.unit-options button {
  text-align: left; font: inherit; font-size: 13px; font-weight: 600; color: var(--text-2);
  background: var(--bg); border: 1.5px solid var(--border); border-radius: 9px;
  padding: 10px 14px; cursor: pointer; transition: border-color 0.12s, box-shadow 0.12s;
}
.unit-options button:hover { border-color: var(--blue-300); }
.unit-options button.on { border-color: var(--primary); color: var(--primary-strong); box-shadow: 0 0 0 3px var(--primary-soft); }
.set-note { margin-top: 12px; font-size: 11px; color: var(--text-3); line-height: 1.6; }
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
