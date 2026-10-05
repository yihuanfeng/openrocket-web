// 内置示例设计：下拉选择即加载，方便快速测试（构造逻辑与「添加组件」完全同构）
import type { RocketComponent, RocketModel } from './types';
import { makeComponent, DEFAULT_PARAMS, type ComponentParams } from './componentFactory';

function stage(name: string): RocketComponent {
  return {
    type: 'stage', name, children: [],
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
  };
}

function rocketModel(name: string, stages: RocketComponent[]): RocketModel {
  const root: RocketComponent = {
    type: 'rocket', name, children: stages,
    properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '',
  };
  return {
    formatVersion: '1.3', creator: 'OpenRocket Web', name,
    referenceType: 'launchrod', root,
  };
}

export interface Preset {
  name: string;
  desc: string;
  build: () => RocketModel;
}

// 尾翼：官方风格——根部全覆盖所在管尾端（AFTER + 负偏移，等效官方 BOTTOM 对齐管底，
// 使尾翼压在机身管上而非悬在管后）
function makeFin(type: string, over: ComponentParams = {}): RocketComponent {
  const rc = over.rootChord ?? DEFAULT_PARAMS[type]?.rootChord ?? 0.06;
  return makeComponent(type, { ...over, axialOffset: -rc, axialMethod: 'after' });
}

export const PRESETS: Preset[] = [
  {
    name: '入门小火箭（Estes 风格）',
    desc: '头锥 + 机身 + 3 片尾翼 + 降落伞',
    build: () => {
      const s = stage('Stage 1');
      const bt = makeComponent('bodytube', { length: 0.3, radius: 0.02 });
      bt.children.push(makeComponent('parachute', { axialOffset: 0.08 })); // 回收舱：机身管内前段
      // 发动机架管：机身管子组件、贴管底（BOTTOM 语义），18mm 座径装 Estes 18mm 标准发动机
      bt.children.push(makeComponent('innertube', { length: 0.09, radius: 0.009, axialMethod: 'bottom' }));
      s.children.push(
        makeComponent('nosecone', { length: 0.12, radius: 0.02, shape: 'ogive' }),
        bt,
        makeFin('trapezoidfinset', { finCount: 3, rootChord: 0.06, tipChord: 0.04, sweep: 0.03, height: 0.05, thickness: 0.0032 }),
      );
      return rocketModel('入门小火箭', [s]);
    },
  },
  {
    name: '两级火箭（多级分离仿真）',
    desc: '第 1 级 头锥+机身+尾翼；第 2 级 机身+锥尾',
    build: () => {
      const s0 = stage('Stage 1');
      s0.children.push(
        makeComponent('nosecone', { length: 0.12, radius: 0.02, shape: 'ogive' }),
        makeComponent('bodytube', { length: 0.2, radius: 0.02 }),
        makeFin('trapezoidfinset', { finCount: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.05, thickness: 0.0032 }),
      );
      const s1 = stage('Stage 2');
      s1.children.push(
        makeComponent('bodytube', { length: 0.14, radius: 0.016 }),
        makeComponent('transition', { length: 0.05, radius: 0.016, aftRadius: 0.008, shape: 'conical' }),
      );
      return rocketModel('两级火箭', [s0, s1]);
    },
  },
  {
    name: '大直径火箭（70 mm 级）',
    desc: '粗管 + 过渡段 + 4 片大尾翼 + 双伞（直径 0.5 m / 0.35 m）',
    build: () => {
      const s = stage('Stage 1');
      const nc = makeComponent('nosecone', { length: 0.18, radius: 0.035, shape: 'ogive' });
      nc.properties['shoulderlength'] = '0.04';
      nc.properties['shoulderradius'] = '0.033';
      const bt1 = makeComponent('bodytube', { length: 0.32, radius: 0.035 });
      // 双伞（回收舱）：主伞 0.5 m / 副伞 0.35 m，位于前机身管内前段
      const chute1 = makeComponent('parachute', { axialOffset: 0.06 });
      chute1.properties['diameter'] = '0.5';
      chute1.properties['cd'] = '0.8';
      const chute2 = makeComponent('parachute', { axialOffset: 0.16 });
      chute2.properties['diameter'] = '0.35';
      chute2.properties['cd'] = '0.8';
      bt1.children.push(chute1, chute2);
      s.children.push(
        nc,
        bt1,
        makeComponent('transition', { length: 0.06, radius: 0.035, aftRadius: 0.026, shape: 'conical' }),
        makeComponent('bodytube', { length: 0.28, radius: 0.026 }),
        makeFin('trapezoidfinset', { finCount: 4, rootChord: 0.12, tipChord: 0.05, sweep: 0.04, height: 0.09, thickness: 0.0032 }),
      );
      return rocketModel('大直径火箭', [s]);
    },
  },
  {
    name: '三级重型火箭（多级变径）',
    desc: '3 级变径 + 过渡段 + 肩部头锥 + 双尾翼组（工程级复杂例）',
    build: () => {
      const s0 = stage('Stage 1');
      const nc = makeComponent('nosecone', { length: 0.16, radius: 0.03, shape: 'ogive' });
      nc.properties['shoulderlength'] = '0.05';
      nc.properties['shoulderradius'] = '0.028';
      s0.children.push(
        nc,
        makeComponent('bodytube', { length: 0.24, radius: 0.03 }),
        makeFin('trapezoidfinset', { finCount: 4, rootChord: 0.1, tipChord: 0.04, sweep: 0.04, height: 0.08, thickness: 0.0032 }),
        makeComponent('innertube', { length: 0.08, radius: 0.013 }),
      );
      s0.children[3].properties['motorId'] = 'c6-5';
      const s1 = stage('Stage 2');
      s1.children.push(
        makeComponent('transition', { length: 0.05, radius: 0.03, aftRadius: 0.024, shape: 'conical' }),
        makeComponent('bodytube', { length: 0.2, radius: 0.024 }),
        makeFin('ellipticalfinset', { finCount: 3, rootChord: 0.06, height: 0.05, thickness: 0.003 }),
      );
      const s2 = stage('Stage 3');
      const bt3 = makeComponent('bodytube', { length: 0.14, radius: 0.018 });
      const chute = makeComponent('parachute', { axialOffset: 0.04 });
      chute.properties['diameter'] = '0.4';
      chute.properties['cd'] = '0.8';
      bt3.children.push(chute);
      s2.children.push(
        makeComponent('transition', { length: 0.04, radius: 0.024, aftRadius: 0.018, shape: 'ogive' }),
        bt3,
        makeFin('trapezoidfinset', { finCount: 3, rootChord: 0.04, tipChord: 0.02, sweep: 0.015, height: 0.04, thickness: 0.0025 }),
      );
      return rocketModel('三级重型火箭', [s0, s1, s2]);
    },
  },
  {
    name: '工程级精细火箭（内构展示）',
    desc: '大直径 + 肩部头锥 + 发动机架/隔框/定心环/配重 + 飘带与冲击绳',
    build: () => {
      const s = stage('Stage 1');
      const nc = makeComponent('nosecone', { length: 0.2, radius: 0.04, shape: 'parabolic' });
      nc.properties['shoulderlength'] = '0.06';
      nc.properties['shoulderradius'] = '0.038';
      const bt = makeComponent('bodytube', { length: 0.36, radius: 0.04 });
      bt.properties['wallthickness'] = '0.0015';
      const mt = makeComponent('innertube', { length: 0.1, radius: 0.013 });
      mt.properties['motorId'] = 'd12-5';
      const fin = makeFin('ellipticalfinset', { finCount: 4, rootChord: 0.1, height: 0.07, thickness: 0.0035 });
      fin.properties['cant'] = '1.5';  // 1.5° 倾斜，减少滚转
      // 回收舱（机身管内前段）：主伞 + 飘带
      const para = makeComponent('parachute', { axialOffset: 0.08 });
      para.properties['diameter'] = '0.6';
      para.properties['cd'] = '0.8';
      const streamer = makeComponent('streamer', { length: 0.4, axialOffset: 0.2 });
      streamer.properties['width'] = '0.1';
      streamer.properties['cd'] = '1.2';
      bt.children.push(para, streamer);
      s.children.push(
        nc, bt,
        makeComponent('tubecoupler', { length: 0.08, radius: 0.04 }),
        makeComponent('bulkhead', { length: 0.004, radius: 0.04 }),
        mt,
        makeComponent('centeringring', { length: 0.006, radius: 0.04 }),
        makeComponent('engineblock', { length: 0.012, radius: 0.013 }),
        makeComponent('shockcord', { axialOffset: 0.02, cordlength: 0.5 } as never),
        makeComponent('masscomponent', { axialOffset: 0.1 }),
        fin,
        makeComponent('launchlug', { length: 0.05, radius: 0.004, axialOffset: 0.12 }),
      );
      return rocketModel('工程级精细火箭', [s]);
    },
  },
  {
    name: '高发比竞速火箭',
    desc: '细长低阻力 + 椭圆尾翼 + 小伞（大推力比设计）',
    build: () => {
      const s = stage('Stage 1');
      const nc = makeComponent('nosecone', { length: 0.14, radius: 0.015, shape: 'power' });
      const bt = makeComponent('bodytube', { length: 0.5, radius: 0.015 });
      bt.properties['wallthickness'] = '0.0008';
      const fin = makeFin('ellipticalfinset', { finCount: 3, rootChord: 0.05, height: 0.04, thickness: 0.0025 });
      fin.properties['cant'] = '0.5';
      const para = makeComponent('parachute', { axialOffset: 0.06 }); // 回收舱：机身管内前段
      para.properties['diameter'] = '0.2';
      para.properties['cd'] = '0.8';
      bt.children.push(para);
      s.children.push(
        nc, bt,
        makeComponent('transition', { length: 0.03, radius: 0.015, aftRadius: 0.011, shape: 'conical' }),
        makeComponent('innertube', { length: 0.07, radius: 0.009 }),
        fin,
        makeComponent('launchlug', { length: 0.04, radius: 0.003, axialOffset: 0.1 }),
      );
      s.children[3].properties['motorId'] = 'a8-3';
      return rocketModel('高发比竞速火箭', [s]);
    },
  },
];
