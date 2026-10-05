<script setup lang="ts">
// 示例面板：Web 内置示例 + OpenRocket 官方示例（带真实构成介绍 + 实时 2D 缩略图），模态展示
import { onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { PRESETS } from '../lib/presets';
import { parseOrk } from '../lib/orkParser';
import ExampleThumb from './ExampleThumb.vue';
import type { RocketComponent } from '../lib/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: []; loadPreset: [name: string]; loadOfficial: [file: string] }>();
// 部署路径基准（GH Pages 子路径部署兼容）
const base = import.meta.env.BASE_URL;
const { t } = useI18n();

/** 统计一个组件树（用于内置示例真实构成） */
function statTree(root: { type: string; children: unknown[] }): { total: number; types: string[] } {
  const counts: Record<string, number> = {};
  (function walk(c: { type: string; children: unknown[] }) {
    counts[c.type] = (counts[c.type] || 0) + 1;
    for (const ch of c.children) walk(ch as { type: string; children: unknown[] });
  })(root);
  const total = Object.values(counts).reduce((a, b) => a + b, 0) - (counts.rocket || 0);
  return { total, types: Object.keys(counts).filter((t) => t !== 'rocket') };
}

const builtin = PRESETS.map((p, i) => {
  const m = p.build();
  const s = statTree(m.root);
  return {
    name: p.name, desc: p.desc, total: s.total,
    kinds: s.types.length,
    badge: i === 0 ? '默认' : '',
    root: m.root,
  };
});

/** OpenRocket 官方示例（构成统计来自官方 .ork 实解析；缩略图实时渲染官方文件） */
const official = reactive(
  [
    { file: 'A simple model rocket', zh: '简单模型火箭', intro: 'OpenRocket 官方入门示例：头锥 + 机身 + 3 片梯形尾翼 + 降落伞 + 发射导环，配 A8-3 / B6-4 / C6 电机。适合第一支火箭与基础飞行验证。', total: 10, lenM: 405, dia: 25 },
    { file: 'Three stage low power rocket', zh: '三级低功率火箭', intro: '三级串联结构（含自由尾翼组），多级分离设计。适合验证多级分离、级间点火时序与多级重心/压心计算。', total: 23, lenM: 560, dia: 25 },
    { file: 'Two stage high power rocket', zh: '两级高功率火箭', intro: '全库最复杂的构型之一：Sustainer + Booster 双级、Ø102 mm 大直径、隔框/管接头/导轨按钮齐全。适合压力测试大火箭解析与工程级布局。', total: 30, lenM: 2051, dia: 102 },
    { file: 'Parallel booster staging', zh: '并联助推级', intro: '含 parallelstage 并联助推级（侧挂助推、发射后分离）。适合验证并联助推、助推器分离与多级组合仿真。', total: 8, lenM: 1143, dia: 57 },
    { file: 'Clustered motors', zh: '簇式发动机', intro: '多根内管 + 椭圆尾翼的发动机簇构型，多台电机并联点火。适合测试多电机簇配置与推力叠加。', total: 14, lenM: 705, dia: 55 },
    { file: 'Dual parachute deployment', zh: '双伞回收', intro: '主伞 + 副伞两级开伞时序（含导轨按钮），回收系统示例。适合验证双伞部署高度配置与回收仿真。', total: 16, lenM: 1477, dia: 57 },
    { file: 'Tube fin rocket', zh: '管尾翼火箭', intro: 'tubefinset 管状尾翼（4 根小管环绕），OpenRocket 少见的管尾翼气动构型。适合管尾翼气动与仿真测试。', total: 7, lenM: 577, dia: 25 },
    { file: 'Pods--airframes and winglets', zh: '捆绑舱（翼面）', intro: 'podset 捆绑舱 + freeformfinset 自由尾翼（翼面）。适合验证侧挂舱 Pods 结构与自由外形尾翼。', total: 14, lenM: 441, dia: 34 },
    { file: 'Pods--powered with recovery deployment', zh: '捆绑舱（动力回收）', intro: 'podset 侧挂舱 + 飘带回收组合，动力舱段示例。适合侧挂舱与轻型回收组合测试。', total: 5, lenM: 175, dia: 25 },
    { file: 'Deployable payload', zh: '可部署载荷', intro: '隔框舱段 + 可部署载荷 + 主伞，载荷分离构型。适合验证载荷舱、质量配平与回收部署。', total: 13, lenM: 507, dia: 25 },
    { file: 'Airstart timing', zh: '空中点火时序', intro: 'Ø195 mm 大直径、2.6 m 长的大型多级火箭，空中二次点火构型。适合多级空中点火时序仿真。', total: 14, lenM: 2565, dia: 195 },
    { file: 'ARC payload rocket', zh: 'ARC 载荷火箭', intro: '1.1 m 长、Ø56 mm 专业载荷构型：隔框 + 管接头 + 载荷舱。适合工程级载荷火箭布局。', total: 13, lenM: 1067, dia: 56 },
    { file: 'Chute release', zh: '开伞器释放', intro: '含开伞器（Chute Release）机制的双伞构型：开伞器延迟主伞释放。适合开伞器机制与延迟部署仿真。', total: 13, lenM: 1035, dia: 64 },
    { file: 'Simulation scripting', zh: '仿真脚本', intro: '2.7 m 大型构型，官方用于演示仿真脚本（事件脚本配置）。Web 端已加载设计，脚本配置待支持。', total: 22, lenM: 2705, dia: 140 },
    { file: 'Simulation extensions', zh: '仿真扩展', intro: '与脚本示例同大型构型，演示仿真扩展事件（自定义部署/事件）。适合扩展事件与高级仿真概念。', total: 22, lenM: 2705, dia: 140 },
    { file: '3D printable nose cone and fins', zh: '3D 打印头锥与尾翼', intro: 'Ø25 mm 可 3D 打印构型：头锥与尾翼按打印友好设计。适合 3D 打印验证与轻量化设计。', total: 13, lenM: 334, dia: 25 },
  ].map((o) => ({ ...o, root: null as RocketComponent | null, loading: false })),
);

// 官方示例 .ork 解析缓存（首次打开面板时并行加载一次）
const officialRoots = new Map<string, Promise<RocketComponent>>();
function loadOfficialRoot(file: string): Promise<RocketComponent> {
  if (!officialRoots.has(file)) {
    officialRoots.set(file, (async () => {
      const resp = await fetch(`${base}ork-assets/examples/${encodeURIComponent(file)}.ork`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const m = await parseOrk(await resp.arrayBuffer());
      return m.root;
    })());
  }
  return officialRoots.get(file)!;
}

function ensureOfficialThumbs(): void {
  for (const o of official) {
    if (o.root || o.loading) continue;
    o.loading = true;
    loadOfficialRoot(o.file)
      .then((root) => { o.root = root; })
      .catch(() => { o.loading = false; });
  }
}

onMounted(ensureOfficialThumbs);
watch(() => props.open, (v) => { if (v) ensureOfficialThumbs(); });

const tab = ref<'builtin' | 'official'>('builtin');
function close(): void { emit('close'); }
function esc(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="ex-overlay" @click.self="close">
      <div class="ex-panel" role="dialog" aria-modal="true" tabindex="-1" @keydown="esc">
        <div class="ex-head">
          <div class="ex-title">
            <img :src="base + 'ork-assets/logo/openrocket-256.png'" alt="OpenRocket" class="ex-logo" />
            <div>
              <h3>{{ t('examples.title') }}</h3>
              <p>{{ t('examples.subtitle') }}</p>
            </div>
          </div>
          <button class="ex-close" :title="t('common.close') + '（Esc）'" @click="close">✕</button>
        </div>
        <div class="ex-tabs">
          <button :class="{ on: tab === 'builtin' }" @click="tab = 'builtin'">{{ t('examples.builtin', { n: builtin.length }) }}</button>
          <button :class="{ on: tab === 'official' }" @click="tab = 'official'">{{ t('examples.official', { n: official.length }) }}</button>
        </div>
        <div class="ex-body">
          <template v-if="tab === 'builtin'">
            <button v-for="(p, i) in builtin" :key="p.name" class="ex-card" @click="emit('loadPreset', PRESETS[i].name)">
              <ExampleThumb :root="p.root" />
              <div class="ex-card-main">
                <span class="ex-name">{{ t('examples.builtinNames.' + i) }}</span>
                <span v-if="p.badge" class="ex-badge">{{ t('examples.defaultBadge') }}</span>
                <span class="ex-meta">{{ t('examples.meta', { total: p.total, kinds: p.kinds }) }}</span>
              </div>
              <span class="ex-desc">{{ t('examples.builtinDescs.' + i) }}</span>
              <span class="ex-load">{{ t('examples.load') }}</span>
            </button>
          </template>
          <template v-else>
            <button v-for="(o, i) in official" :key="o.file" class="ex-card" @click="emit('loadOfficial', o.file)">
              <div class="ex-thumb-box">
                <ExampleThumb v-if="o.root" :root="o.root" />
                <span v-else class="ex-thumb-ph">{{ o.loading ? t('common.loading') : '◌' }}</span>
              </div>
              <div class="ex-card-main">
                <span class="ex-name">{{ t('examples.officialNames.' + i) }}</span>
                <span class="ex-meta">{{ o.total }} · {{ o.lenM }} mm · Ø{{ o.dia }} mm</span>
              </div>
              <span class="ex-desc">{{ t('examples.officialIntros.' + i) }}</span>
              <span class="ex-file">{{ o.file }}.ork</span>
              <span class="ex-load">{{ t('examples.load') }}</span>
            </button>
          </template>
        </div>
        <div class="ex-foot">
          <span>{{ t('examples.officialSource') }}</span>
          <button class="ex-foot-btn" @click="close">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ex-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(8, 14, 28, 0.62);
  backdrop-filter: blur(3px);
  display: flex; align-items: center; justify-content: center;
}
.ex-panel {
  width: min(820px, calc(100vw - 48px));
  max-height: calc(100vh - 72px);
  background: #f5f8fc;
  border: 1px solid var(--blue-200);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(4, 14, 36, 0.42);
  display: flex; flex-direction: column;
  overflow: hidden;
  outline: none;
}
.ex-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 16px 18px 12px;
  background: linear-gradient(180deg, #eaf3fd, #f5f8fc);
  border-bottom: 1px solid #e0e9f4;
}
.ex-title { display: flex; align-items: center; gap: 12px; }
.ex-logo { width: 40px; height: 40px; border-radius: 8px; background: #fff; border: 1px solid #e3ebf4; }
.ex-title h3 { margin: 0; font-size: 16px; color: var(--text); }
.ex-title p { margin: 2px 0 0; font-size: 12px; color: var(--text-3); }
.ex-close {
  border: 0; background: #fff; border: 1px solid #e3ebf4; border-radius: 8px;
  width: 30px; height: 30px; font-size: 13px; color: var(--text-3); cursor: pointer;
}
.ex-close:hover { color: var(--text); border-color: var(--blue-300); }
.ex-tabs { display: flex; gap: 6px; padding: 10px 18px 0; }
.ex-tabs button {
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--text-3);
  background: transparent; border: 1px solid transparent; border-radius: 8px 8px 0 0;
  padding: 7px 14px; cursor: pointer;
}
.ex-tabs button.on { color: var(--primary-strong); background: #fff; border-color: #e0e9f4; border-bottom-color: #fff; }
.ex-body {
  flex: 1; overflow-y: auto;
  padding: 12px 18px 16px;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px;
  align-content: start;
}
.ex-card {
  position: relative; display: flex; flex-direction: column; gap: 4px;
  background: #fff; border: 1px solid #e6eaf1; border-radius: 10px;
  padding: 8px 12px 9px; text-align: left; cursor: pointer; font: inherit;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
  min-width: 0;
}
.ex-card:hover { border-color: #7cb6f2; box-shadow: 0 3px 12px rgba(10, 132, 255, 0.10); transform: translateY(-1px); }
.ex-thumb-box { width: 100%; height: 46px; border-radius: 6px; overflow: hidden; background: #0d2f6e; display: grid; place-items: center; }
.ex-thumb-ph { color: rgba(160, 200, 255, 0.7); font-size: 12px; }
.ex-card-main { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ex-name { font-size: 13.5px; font-weight: 700; color: var(--text); }
.ex-badge {
  font-size: 9.5px; font-weight: 700; color: #fff; background: var(--primary);
  border-radius: 4px; padding: 1px 6px; letter-spacing: 0.5px;
}
.ex-meta { font-size: 10.5px; color: var(--text-4, #a3aab5); font-weight: 500; }
.ex-desc { font-size: 11.5px; color: var(--text-3); line-height: 1.5; }
.ex-file { font-size: 10px; color: var(--text-4, #a3aab5); font-family: ui-monospace, Menlo, monospace; }
.ex-load {
  position: absolute; right: 11px; bottom: 10px;
  font-size: 11px; font-weight: 700; color: var(--primary-strong);
  opacity: 0; transition: opacity 0.12s;
}
.ex-card:hover .ex-load { opacity: 1; }
.ex-foot {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 18px; border-top: 1px solid #e0e9f4; background: #f5f8fc;
}
.ex-foot span { font-size: 11px; color: var(--text-4, #a3aab5); }
.ex-foot-btn {
  font: inherit; font-size: 12px; font-weight: 600; color: #fff; background: var(--primary);
  border: 0; border-radius: 7px; padding: 6px 16px; cursor: pointer;
}
.ex-foot-btn:hover { background: var(--primary-strong); }
@media (max-width: 720px) {
  .ex-body { grid-template-columns: 1fr; }
}
</style>
