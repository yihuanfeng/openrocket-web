// 内置示例设计：下拉选择即加载，方便快速测试（构造逻辑与「添加组件」完全同构）
import type { RocketComponent, RocketModel } from './types';
import { makeComponent } from './componentFactory';

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

export const PRESETS: Preset[] = [
  {
    name: '入门小火箭（Estes 风格）',
    desc: '头锥 + 机身 + 3 片尾翼 + 降落伞',
    build: () => {
      const s = stage('Stage 1');
      s.children.push(
        makeComponent('nosecone', { length: 0.12, radius: 0.02, shape: 'ogive' }),
        makeComponent('bodytube', { length: 0.3, radius: 0.02 }),
        makeComponent('trapezoidfinset', { finCount: 3, rootChord: 0.06, tipChord: 0.04, sweep: 0.03, height: 0.05, thickness: 0.0032 }),
        makeComponent('parachute', { axialOffset: 0.1 }),
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
        makeComponent('trapezoidfinset', { finCount: 3, rootChord: 0.05, tipChord: 0.03, sweep: 0.02, height: 0.05, thickness: 0.0032 }),
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
    desc: '粗管 + 过渡段 + 4 片大尾翼 + 双伞',
    build: () => {
      const s = stage('Stage 1');
      s.children.push(
        makeComponent('nosecone', { length: 0.18, radius: 0.035, shape: 'ogive' }),
        makeComponent('bodytube', { length: 0.32, radius: 0.035 }),
        makeComponent('transition', { length: 0.06, radius: 0.035, aftRadius: 0.026, shape: 'conical' }),
        makeComponent('bodytube', { length: 0.28, radius: 0.026 }),
        makeComponent('trapezoidfinset', { finCount: 4, rootChord: 0.12, tipChord: 0.05, sweep: 0.04, height: 0.09, thickness: 0.0032 }),
        makeComponent('parachute', { axialOffset: 0.05 }),
        makeComponent('parachute', { axialOffset: 0.12 }),
      );
      return rocketModel('大直径火箭', [s]);
    },
  },
];
