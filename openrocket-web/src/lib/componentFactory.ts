// 组件工厂：统一构造 RocketComponent（新建/示例/添加面板共用，保证字段语义一致）
// 语义约定（与 orkParser / WASM designAddComponent 对齐）：
//   nosecone.radius = 后端半径（NoseCone 构造的 radius 即 aftRadius）
//   transition.radius = 前端半径、aftRadius = 后端半径
//   bodytube/其余：radius = 前后一致半径
import type { RocketComponent } from './types';

export interface ComponentParams {
  length?: number;
  radius?: number;
  aftRadius?: number;
  axialOffset?: number;
  axialMethod?: string;
  shape?: string;
  finCount?: number;
  rootChord?: number;
  tipChord?: number;
  sweep?: number;
  height?: number;
  thickness?: number;
  angleOffset?: number;
  density?: number;
}

/** 各类型的默认参数（OpenRocket 惯例尺寸） */
export const DEFAULT_PARAMS: Record<string, ComponentParams> = {
  nosecone: { length: 0.12, radius: 0.02, shape: 'ogive' },
  bodytube: { length: 0.3, radius: 0.02 },
  transition: { length: 0.05, radius: 0.02, aftRadius: 0.015, shape: 'conical' },
  trapezoidfinset: { finCount: 3, rootChord: 0.06, tipChord: 0.04, sweep: 0.03, height: 0.05, thickness: 0.0032 },
  parachute: {},
  launchlug: { length: 0.05, radius: 0.0022 },
  innertube: { length: 0.07, radius: 0.009 },
  // P0-1 新增
  ellipticalfinset: { finCount: 3, rootChord: 0.06, height: 0.05, thickness: 0.0032 },
  freeformfinset: { finCount: 3, rootChord: 0.06, tipChord: 0.04, sweep: 0.03, height: 0.05, thickness: 0.0032 },
  tubecoupler: { length: 0.05, radius: 0.02 },
  bulkhead: { length: 0.003, radius: 0.02 },
  centeringring: { length: 0.005, radius: 0.02 },
  engineblock: { length: 0.01, radius: 0.009 },
  masscomponent: {},
  streamer: { length: 0.3 },
  shockcord: {},
  // 组件补齐：导轨按钮 / 管尾翼 / 并联助推器 / 捆绑舱
  railbutton: { length: 0.01, radius: 0.003 },
  tubefinset: { finCount: 6, rootChord: 0.05, height: 0.02, thickness: 0.002, angleOffset: 0 },
  boosters: {},
  pods: {},
};

export const COMPONENT_TYPES: { code: string; label: string; quick: string }[] = [
  { code: 'nosecone', label: '头锥', quick: '＋头锥' },
  { code: 'bodytube', label: '机身管', quick: '＋机身' },
  { code: 'transition', label: '过渡段', quick: '＋过渡段' },
  { code: 'trapezoidfinset', label: '梯形尾翼组', quick: '＋尾翼' },
  { code: 'ellipticalfinset', label: '椭圆尾翼组', quick: '＋椭圆翼' },
  { code: 'freeformfinset', label: '自由形状尾翼', quick: '＋自由翼' },
  { code: 'tubefinset', label: '管尾翼组', quick: '＋管翼' },
  { code: 'railbutton', label: '导轨按钮', quick: '＋导轨钮' },
  { code: 'parachute', label: '降落伞', quick: '＋伞' },
  { code: 'streamer', label: '飘带', quick: '＋飘带' },
  { code: 'shockcord', label: '冲击绳', quick: '＋冲击绳' },
  { code: 'masscomponent', label: '配重', quick: '＋配重' },
  { code: 'launchlug', label: '发射导环', quick: '＋发射耳' },
  { code: 'innertube', label: '发动机架管', quick: '＋架管' },
  { code: 'tubecoupler', label: '管接头', quick: '＋管接头' },
  { code: 'bulkhead', label: '隔框', quick: '＋隔框' },
  { code: 'centeringring', label: '定心环', quick: '＋定心环' },
  { code: 'engineblock', label: '发动机挡块', quick: '＋挡块' },
];

function n(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) ? v : fallback;
}

/** 构造组件；over 覆盖默认参数 */
export function makeComponent(type: string, over: ComponentParams = {}): RocketComponent {
  const d = DEFAULT_PARAMS[type] ?? {};
  const p: ComponentParams = { ...d, ...over };
  const base = {
    children: [] as RocketComponent[],
    length: 0,
    radius: 0,
    aftRadius: 0,
    axialOffset: n(p.axialOffset, NaN),
    axialMethod: p.axialMethod,
    shape: '',
    density: Math.max(0, n(p.density, 0)),
  };
  switch (type) {
    case 'stage':
      return {
        ...base,
        type: 'stage',
        name: '级',
        length: Math.max(0, n(p.length, 0.3)),
        radius: Math.max(0, n(p.radius, 0.012)),
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: {},
      };
    case 'nosecone':
      return {
        ...base,
        type: 'nosecone',
        name: '头锥',
        length: Math.max(0, n(p.length, 0.12)),
        radius: Math.max(0, n(p.radius, 0.02)),   // 后端半径
        aftRadius: Math.max(0, n(p.radius, 0.02)),
        shape: p.shape ?? 'ogive',
        properties: { shape: p.shape ?? 'ogive' },
      };
    case 'bodytube':
      return {
        ...base,
        type: 'bodytube',
        name: '机身管',
        length: Math.max(0, n(p.length, 0.3)),
        radius: Math.max(0, n(p.radius, 0.02)),
        aftRadius: Math.max(0, n(p.radius, 0.02)),
        properties: {},
      };
    case 'transition':
      return {
        ...base,
        type: 'transition',
        name: '过渡段',
        length: Math.max(0, n(p.length, 0.05)),
        radius: Math.max(0, n(p.radius, 0.02)),       // 前端半径
        aftRadius: Math.max(0, n(p.aftRadius, 0.015)), // 后端半径
        shape: p.shape ?? 'conical',
        properties: { shape: p.shape ?? 'conical' },
      };
    case 'trapezoidfinset':
      return {
        ...base,
        type: 'trapezoidfinset',
        name: '梯形尾翼组',
        properties: {
          fincount: String(Math.max(1, Math.round(n(p.finCount, 3)))),
          rootchord: String(Math.max(0, n(p.rootChord, 0.06))),
          tipchord: String(Math.max(0, n(p.tipChord, 0.04))),
          sweep: String(Math.max(0, n(p.sweep, 0.03))),
          height: String(Math.max(0, n(p.height, 0.05))),
          thickness: String(Math.max(0, n(p.thickness, 0.0032))),
        },
      };
    case 'parachute':
      return {
        ...base,
        type: 'parachute',
        name: '降落伞',
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: {},
      };
    case 'launchlug':
      return {
        ...base,
        type: 'launchlug',
        name: '发射导环',
        length: Math.max(0, n(p.length, 0.05)),
        radius: Math.max(0, n(p.radius, 0.0022)),
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: {},
      };
    case 'innertube':
      return {
        ...base,
        type: 'innertube',
        name: '发动机架管',
        length: Math.max(0, n(p.length, 0.07)),
        radius: Math.max(0, n(p.radius, 0.009)),
        properties: { motormount: 'true' },
      };
    case 'ellipticalfinset':
      return {
        ...base,
        type: 'ellipticalfinset',
        name: '椭圆尾翼组',
        properties: {
          fincount: String(Math.max(1, Math.round(n(p.finCount, 3)))),
          rootchord: String(Math.max(0, n(p.rootChord, 0.06))),
          height: String(Math.max(0, n(p.height, 0.05))),
          thickness: String(Math.max(0, n(p.thickness, 0.0032))),
        },
      };
    case 'freeformfinset':
      return {
        ...base,
        type: 'freeformfinset',
        name: '自由形状尾翼',
        properties: {
          fincount: String(Math.max(1, Math.round(n(p.finCount, 3)))),
          rootchord: String(Math.max(0, n(p.rootChord, 0.06))),
          tipchord: String(Math.max(0, n(p.tipChord, 0.04))),
          sweep: String(Math.max(0, n(p.sweep, 0.03))),
          height: String(Math.max(0, n(p.height, 0.05))),
          thickness: String(Math.max(0, n(p.thickness, 0.0032))),
        },
      };
    case 'tubecoupler':
      return {
        ...base,
        type: 'tubecoupler',
        name: '管接头',
        length: Math.max(0, n(p.length, 0.05)),
        radius: Math.max(0, n(p.radius, 0.02)),
        aftRadius: Math.max(0, n(p.radius, 0.02)),
        properties: {},
      };
    case 'bulkhead':
      return {
        ...base,
        type: 'bulkhead',
        name: '隔框',
        length: Math.max(0, n(p.length, 0.003)),
        radius: Math.max(0, n(p.radius, 0.02)),
        aftRadius: Math.max(0, n(p.radius, 0.02)),
        properties: {},
      };
    case 'centeringring':
      return {
        ...base,
        type: 'centeringring',
        name: '定心环',
        length: Math.max(0, n(p.length, 0.005)),
        radius: Math.max(0, n(p.radius, 0.02)),
        aftRadius: Math.max(0, n(p.radius, 0.02)),
        properties: {},
      };
    case 'engineblock':
      return {
        ...base,
        type: 'engineblock',
        name: '发动机挡块',
        length: Math.max(0, n(p.length, 0.01)),
        radius: Math.max(0, n(p.radius, 0.009)),
        aftRadius: Math.max(0, n(p.radius, 0.009)),
        properties: {},
      };
    case 'masscomponent':
      return {
        ...base,
        type: 'masscomponent',
        name: '配重',
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: { mass: '0.01' },
      };
    case 'streamer':
      return {
        ...base,
        type: 'streamer',
        name: '飘带',
        length: Math.max(0, n(p.length, 0.3)),
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: {},
      };
    case 'shockcord':
      return {
        ...base,
        type: 'shockcord',
        name: '冲击绳',
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: { cordlength: '0.2' },
      };
    case 'railbutton':
      return {
        ...base,
        type: 'railbutton',
        name: '导轨按钮',
        length: Math.max(0, n(p.length, 0.01)),
        radius: Math.max(0, n(p.radius, 0.003)),
        axialOffset: Math.max(0, n(p.axialOffset, NaN)),
        properties: {},
      };
    case 'tubefinset':
      return {
        ...base,
        type: 'tubefinset',
        name: '管尾翼组',
        length: Math.max(0, n(p.length, 0.05)),
        properties: {
          fincount: String(Math.max(1, Math.round(n(p.finCount, 6)))),
          rootchord: String(Math.max(0, n(p.rootChord, 0.05))),
          height: String(Math.max(0, n(p.height, 0.02))),
          thickness: String(Math.max(0, n(p.thickness, 0.002))),
          angleoffset: String(n(p.angleOffset, 0)),
        },
      };
    case 'boosters':
      return {
        ...base,
        type: 'boosters',
        name: '助推器（并联级）',
        children: [makeComponent('stage', { radius: Math.max(0, n(p.radius, 0.012)) })],
        properties: {},
      };
    case 'pods':
      return {
        ...base,
        type: 'pods',
        name: '捆绑舱',
        children: [
          makeComponent('stage', { radius: Math.max(0, n(p.radius, 0.012)) }),
        ],
        properties: {},
      };
    default:
      return { ...base, type: 'bodytube', name: '机身管', properties: {} };
  }
}
