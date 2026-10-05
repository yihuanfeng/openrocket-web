<script setup lang="ts">
// 组件库（设计 Tab 右侧）：OpenRocket 官方 4 类分区 + 官方图标
import { useI18n } from 'vue-i18n';
const emit = defineEmits<{ add: [type: string] }>();

const { t } = useI18n();

// GitHub Pages 子路径部署：资源统一走相对 BASE_URL
const base = import.meta.env.BASE_URL;

/** 官方图标文件名（component-icons/*-large.png） */
interface LibItem {
  code: string;        // 组件类型码
  zh: string;          // 中文名
  en: string;          // 官方英文名
  descKey: string;     // 描述 i18n key
  supported: boolean;  // Web 当前是否支持创建
  icon: string;        // 官方图标文件
}

const GROUPS: { titleKey: string; en: string; items: LibItem[] }[] = [
  {
    titleKey: 'lib.groups.assembly', en: 'Assembly',
    items: [
      { code: 'stage', zh: '级', en: 'Stage', descKey: 'lib.desc.stage', supported: true, icon: 'stage' },
      { code: 'boosters', zh: '助推器', en: 'Boosters', descKey: 'lib.desc.boosters', supported: true, icon: 'boosters' },
      { code: 'pods', zh: '捆绑舱', en: 'Pods', descKey: 'lib.desc.pods', supported: true, icon: 'pods' },
    ],
  },
  {
    titleKey: 'lib.groups.body', en: 'Body & Fin',
    items: [
      { code: 'nosecone', zh: '头锥', en: 'Nose Cone', descKey: 'lib.desc.nosecone', supported: true, icon: 'nosecone' },
      { code: 'bodytube', zh: '机身管', en: 'Body Tube', descKey: 'lib.desc.bodytube', supported: true, icon: 'bodytube' },
      { code: 'transition', zh: '过渡段', en: 'Transition', descKey: 'lib.desc.transition', supported: true, icon: 'transition' },
      { code: 'trapezoidfinset', zh: '梯形尾翼', en: 'Trapezoidal Fin', descKey: 'lib.desc.trapezoidfinset', supported: true, icon: 'trapezoidfin' },
      { code: 'ellipticalfinset', zh: '椭圆尾翼', en: 'Elliptical Fin', descKey: 'lib.desc.ellipticalfinset', supported: true, icon: 'ellipticalfin' },
      { code: 'freeformfinset', zh: '自由尾翼', en: 'Freeform Fin', descKey: 'lib.desc.freeformfinset', supported: true, icon: 'freeformfin' },
      { code: 'tubefinset', zh: '管尾翼', en: 'Tube Fin', descKey: 'lib.desc.tubefinset', supported: true, icon: 'tubefin' },
      { code: 'launchlug', zh: '发射导环', en: 'Launch Lug', descKey: 'lib.desc.launchlug', supported: true, icon: 'launchlug' },
      { code: 'railbutton', zh: '导轨按钮', en: 'Rail Button', descKey: 'lib.desc.railbutton', supported: true, icon: 'railbutton' },
    ],
  },
  {
    titleKey: 'lib.groups.inner', en: 'Inner',
    items: [
      { code: 'innertube', zh: '内管', en: 'Inner Tube', descKey: 'lib.desc.innertube', supported: true, icon: 'innertube' },
      { code: 'tubecoupler', zh: '管接头', en: 'Tube Coupler', descKey: 'lib.desc.tubecoupler', supported: true, icon: 'tubecoupler' },
      { code: 'centeringring', zh: '定心环', en: 'Centering Ring', descKey: 'lib.desc.centeringring', supported: true, icon: 'centeringring' },
      { code: 'bulkhead', zh: '隔框', en: 'Bulkhead', descKey: 'lib.desc.bulkhead', supported: true, icon: 'bulkhead' },
      { code: 'engineblock', zh: '发动机挡块', en: 'Engine Block', descKey: 'lib.desc.engineblock', supported: true, icon: 'engineblock' },
    ],
  },
  {
    titleKey: 'lib.groups.recovery', en: 'Mass & Recovery',
    items: [
      { code: 'parachute', zh: '降落伞', en: 'Parachute', descKey: 'lib.desc.parachute', supported: true, icon: 'parachute' },
      { code: 'streamer', zh: '飘带', en: 'Streamer', descKey: 'lib.desc.streamer', supported: true, icon: 'streamer' },
      { code: 'shockcord', zh: '减震绳', en: 'Shock Cord', descKey: 'lib.desc.shockcord', supported: true, icon: 'shockcord' },
      { code: 'masscomponent', zh: '配重', en: 'Mass Component', descKey: 'lib.desc.masscomponent', supported: true, icon: 'mass' },
    ],
  },
];

function click(item: LibItem): void {
  if (item.code === 'stage') { emit('add', 'stage'); return; }
  if (item.supported) emit('add', item.code);
}
</script>

<template>
  <div class="lib">
    <div v-for="g in GROUPS" :key="g.en" class="lib-group">
      <div class="lib-group-title">
        <span class="grp-zh">{{ t(g.titleKey) }}</span>
        <span class="grp-en">{{ g.en }}</span>
      </div>
      <button
        v-for="item in g.items"
        :key="item.code"
        class="lib-item"
        :class="{ off: !item.supported }"
        :title="item.supported ? t(item.descKey) : t(item.descKey) + t('lib.notSupported')"
        @click="click(item)"
      >
        <span class="li-icon"><img :src="`${base}ork-assets/component-icons/${item.icon}-large.png`" :alt="item.en" draggable="false" /></span>
        <span class="li-text">
          <span class="li-name">
            {{ item.zh }}
            <span class="li-en">{{ item.en }}</span>
          </span>
          <span class="li-desc">{{ t(item.descKey) }}</span>
        </span>
        <span class="li-tag" v-if="!item.supported">{{ t('lib.notSupported') }}</span>
        <span class="li-plus" v-else>＋</span>
      </button>
    </div>
    <p class="lib-tip">{{ t('lib.tip') }}</p>
  </div>
</template>

<style scoped>
.lib { display: flex; flex-direction: column; gap: 14px; padding: 2px 4px 12px; }
.lib-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 7px;
}
.lib-group-title {
  grid-column: 1 / -1;
  display: flex; align-items: baseline; gap: 8px;
  font-size: 11px; color: var(--text-3); font-weight: 700; letter-spacing: 0.6px;
  padding: 2px 2px 0; margin-bottom: 1px; text-transform: uppercase;
}
.grp-en { font-size: 10px; font-weight: 500; color: var(--text-4, #a3aab5); letter-spacing: 0.4px; }
.lib-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%;
  background: #f8fafc; border: 1px solid #e6eaf1; border-radius: 8px;
  padding: 7px 4px 6px; cursor: pointer; text-align: center; color: var(--text);
  font: inherit; transition: background 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s;
  min-width: 0;
}
.lib-item:hover:not(.off) { background: #eef4fb; border-color: #7cb6f2; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(10, 132, 255, 0.10); }
.lib-item.off { opacity: 0.5; cursor: not-allowed; }
.li-icon {
  width: 100%; height: 40px; flex: none; display: grid; place-items: center;
  background: #fff; border: 1px solid #e8ecf3; border-radius: 6px;
}
.li-icon img { width: 34px; height: auto; image-rendering: auto; }
.lib-item:hover:not(.off) .li-icon { border-color: #cfe3fb; }
.li-text { display: flex; flex-direction: column; align-items: center; min-width: 0; width: 100%; }
.li-name { font-size: 11.5px; font-weight: 600; display: flex; flex-direction: column; align-items: center; gap: 1px; line-height: 1.2; white-space: nowrap; }
.li-en { font-size: 9px; color: var(--text-4, #a3aab5); font-weight: 500; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.li-desc { font-size: 9.5px; color: var(--text-3); line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.li-plus { position: absolute; top: 4px; right: 6px; color: var(--primary); font-size: 13px; opacity: 0; transition: opacity 0.12s; font-weight: 700; }
.lib-item:hover .li-plus { opacity: 1; }
.li-tag {
  position: absolute; top: 4px; right: 5px; font-size: 9px; color: #a3aab5; border: 1px solid #d8dce3;
  border-radius: 4px; padding: 0 4px; white-space: nowrap; background: #fff;
}
.lib-tip { font-size: 11px; color: var(--text-3); line-height: 1.5; margin: 2px 0 0; padding: 0 2px; }
</style>
