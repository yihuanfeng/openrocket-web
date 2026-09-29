<script setup lang="ts">
// 组件库（设计 Tab 右侧）：OpenRocket 官方 4 类分区 + 官方图标
const emit = defineEmits<{ add: [type: string] }>();

/** 官方图标文件名（component-icons/*-large.png） */
interface LibItem {
  code: string;        // 组件类型码
  zh: string;          // 中文名
  en: string;          // 官方英文名
  desc: string;
  supported: boolean;  // Web 当前是否支持创建
  icon: string;        // 官方图标文件
}

const GROUPS: { title: string; en: string; items: LibItem[] }[] = [
  {
    title: '装配', en: 'Assembly',
    items: [
      { code: 'stage', zh: '级', en: 'Stage', desc: '火箭的基本框架，至少一级', supported: true, icon: 'stage' },
      { code: 'boosters', zh: '助推器', en: 'Boosters', desc: '可分离的并联助推级', supported: false, icon: 'boosters' },
      { code: 'pods', zh: '捆绑舱', en: 'Pods', desc: '不可分离的侧挂舱（如侧挂电机）', supported: false, icon: 'pods' },
    ],
  },
  {
    title: '机身与尾翼', en: 'Body & Fin',
    items: [
      { code: 'nosecone', zh: '头锥', en: 'Nose Cone', desc: '气动头部，多种外形', supported: true, icon: 'nosecone' },
      { code: 'bodytube', zh: '机身管', en: 'Body Tube', desc: '主体管，可设为电机座', supported: true, icon: 'bodytube' },
      { code: 'transition', zh: '过渡段', en: 'Transition', desc: '前后直径不同的变径段', supported: true, icon: 'transition' },
      { code: 'trapezoidfinset', zh: '梯形尾翼', en: 'Trapezoidal Fin', desc: '默认 3 片，保证稳定', supported: true, icon: 'trapezoidfin' },
      { code: 'ellipticalfinset', zh: '椭圆尾翼', en: 'Elliptical Fin', desc: '椭圆外形的尾翼组', supported: true, icon: 'ellipticalfin' },
      { code: 'freeformfinset', zh: '自由尾翼', en: 'Freeform Fin', desc: '自定义任意外形', supported: true, icon: 'freeformfin' },
      { code: 'launchlug', zh: '发射导环', en: 'Launch Lug', desc: '套在发射杆上的导环', supported: true, icon: 'launchlug' },
      { code: 'railbutton', zh: '导轨按钮', en: 'Rail Button', desc: '轨道发射导轨按钮', supported: false, icon: 'railbutton' },
    ],
  },
  {
    title: '内部组件', en: 'Inner',
    items: [
      { code: 'innertube', zh: '内管', en: 'Inner Tube', desc: '内部管，可作电机座', supported: true, icon: 'innertube' },
      { code: 'tubecoupler', zh: '管接头', en: 'Tube Coupler', desc: '连接两节机身管', supported: true, icon: 'tubecoupler' },
      { code: 'centeringring', zh: '定心环', en: 'Centering Ring', desc: '支撑内管/电机', supported: true, icon: 'centeringring' },
      { code: 'bulkhead', zh: '隔框', en: 'Bulkhead', desc: '封闭舱段的隔板', supported: true, icon: 'bulkhead' },
      { code: 'engineblock', zh: '发动机挡块', en: 'Engine Block', desc: '防止电机前移', supported: true, icon: 'engineblock' },
    ],
  },
  {
    title: '质量与回收', en: 'Mass & Recovery',
    items: [
      { code: 'parachute', zh: '降落伞', en: 'Parachute', desc: '主回收伞', supported: true, icon: 'parachute' },
      { code: 'streamer', zh: '飘带', en: 'Streamer', desc: '轻型阻力回收', supported: true, icon: 'streamer' },
      { code: 'shockcord', zh: '减震绳', en: 'Shock Cord', desc: '舱段连接弹性绳', supported: true, icon: 'shockcord' },
      { code: 'masscomponent', zh: '配重', en: 'Mass Component', desc: '调整重心位置', supported: true, icon: 'mass' },
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
        <span class="grp-zh">{{ g.title }}</span>
        <span class="grp-en">{{ g.en }}</span>
      </div>
      <button
        v-for="item in g.items"
        :key="item.code"
        class="lib-item"
        :class="{ off: !item.supported }"
        :title="item.supported ? item.desc : item.desc + '（Web 版当前未开放）'"
        @click="click(item)"
      >
        <span class="li-icon"><img :src="`/ork-assets/component-icons/${item.icon}-large.png`" :alt="item.en" draggable="false" /></span>
        <span class="li-text">
          <span class="li-name">
            {{ item.zh }}
            <span class="li-en">{{ item.en }}</span>
          </span>
          <span class="li-desc">{{ item.desc }}</span>
        </span>
        <span class="li-tag" v-if="!item.supported">即将支持</span>
        <span class="li-plus" v-else>＋</span>
      </button>
    </div>
    <p class="lib-tip">点击即加（默认参数），选中后在下方预览区右侧编辑属性。来源：OpenRocket 官方组件库。</p>
  </div>
</template>

<style scoped>
.lib { display: flex; flex-direction: column; gap: 14px; padding: 2px 4px 12px; }
.lib-group { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.lib-group-title {
  grid-column: 1 / -1;
  display: flex; align-items: baseline; gap: 8px;
  font-size: 11px; color: var(--text-3); font-weight: 700; letter-spacing: 0.6px;
  padding: 2px 2px 0; margin-bottom: 1px; text-transform: uppercase;
}
.grp-en { font-size: 10px; font-weight: 500; color: var(--text-4, #a3aab5); letter-spacing: 0.4px; }
.lib-item {
  position: relative;
  display: flex; flex-direction: column; align-items: center; gap: 5px; width: 100%;
  background: #f8fafc; border: 1px solid #e6eaf1; border-radius: 8px;
  padding: 9px 6px 8px; cursor: pointer; text-align: center; color: var(--text);
  font: inherit; transition: background 0.12s, border-color 0.12s, transform 0.12s, box-shadow 0.12s;
  min-width: 0;
}
.lib-item:hover:not(.off) { background: #eef4fb; border-color: #7cb6f2; transform: translateY(-1px); box-shadow: 0 2px 8px rgba(10, 132, 255, 0.10); }
.lib-item.off { opacity: 0.5; cursor: not-allowed; }
.li-icon {
  width: 100%; height: 50px; flex: none; display: grid; place-items: center;
  background: #fff; border: 1px solid #e8ecf3; border-radius: 6px;
}
.li-icon img { width: 42px; height: auto; image-rendering: auto; }
.lib-item:hover:not(.off) .li-icon { border-color: #cfe3fb; }
.li-text { display: flex; flex-direction: column; align-items: center; min-width: 0; width: 100%; }
.li-name { font-size: 12.5px; font-weight: 600; display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.li-en { font-size: 10px; color: var(--text-4, #a3aab5); font-weight: 500; }
.li-desc { font-size: 10.5px; color: var(--text-3); line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.li-plus { position: absolute; top: 5px; right: 7px; color: var(--primary); font-size: 14px; opacity: 0; transition: opacity 0.12s; font-weight: 700; }
.lib-item:hover .li-plus { opacity: 1; }
.li-tag {
  position: absolute; top: 5px; right: 6px; font-size: 9.5px; color: #a3aab5; border: 1px solid #d8dce3;
  border-radius: 4px; padding: 1px 5px; white-space: nowrap; background: #fff;
}
.lib-tip { font-size: 11px; color: var(--text-3); line-height: 1.5; margin: 2px 0 0; padding: 0 2px; }
</style>
