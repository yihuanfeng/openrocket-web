// 火箭模型 → WASM 设计接口参数序列化
// 与 phase0-poc 的 SimEntry.designAddComponent 槽位布局严格对应：
//   (type, length, radius, aftRadius, axialOffset, shape, c1..c8)
//   type: 1=头锥 2=机身 3=过渡段 4=尾翼 5=降落伞 6=发射耳 7=发动机架管
//   shape: 1=ogive 2=conical 3=parabolic 4=power 5=haack
import type { RocketComponent, RocketModel } from './types';

/** 传递给 WASM 的单组件参数（14 槽位） */
export interface DesignComponentParams {
  /** [0] 组件类型码 */
  type: number;
  /** [1] 长度（m） */
  length: number;
  /** [2] 前端半径（m） */
  radius: number;
  /** [3] 后端半径（m） */
  aftRadius: number;
  /** [4] 轴向偏移（m，降落伞/挂件用） */
  axialOffset: number;
  /** [5] 外形码 */
  shape: number;
  /** [6..13] c1..c8（尾翼：fincount, rootchord, tipchord, sweep, height, thickness） */
  c: number[];
  /** [14] 材料密度（kg/m³，0 = 引擎默认材料） */
  density: number;
}

const SHAPE_CODE: Record<string, number> = {
  ogive: 1,
  conical: 2,
  parabolic: 3,
  power: 4,
  haack: 5,
};

function shapeCode(raw: string | undefined): number {
  const key = (raw ?? '').trim().toLowerCase();
  return SHAPE_CODE[key] ?? 1;
}

function num(props: Record<string, string>, key: string): number {
  const v = props[key];
  if (!v) return NaN;
  const m = v.trim().match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/** XML 组件 tag → WASM 类型码；不支持的类型返回 0（跳过） */
function typeCode(tag: string): number {
  switch (tag) {
    case 'nosecone': return 1;
    case 'bodytube': return 2;
    case 'transition': return 3;
    case 'trapezoidfinset': return 4;
    case 'parachute': return 5;
    case 'launchlug': return 6;
    case 'innertube': return 7;
    default: return 0;
  }
}

/** 深度优先收集可计算组件（按 XML 顺序，即轴向堆叠顺序） */
function collect(comp: RocketComponent, out: DesignComponentParams[]): void {
  const code = typeCode(comp.type);
  const p = comp.properties ?? {};
  if (code > 0) {
    const shape = comp.shape || (p.shape ?? '');
    let c: number[] = [0, 0, 0, 0, 0, 0, 0, 0];
    if (code === 4) {
      // 尾翼：c1=fincount c2=rootchord c3=tipchord c4=sweep c5=height c6=thickness
      c = [
        num(p, 'fincount') || 3,
        num(p, 'rootchord') || 0,
        num(p, 'tipchord') || 0,
        num(p, 'sweep') || 0,
        num(p, 'height') || 0,
        num(p, 'thickness') || 0.0032,
        0, 0,
      ];
    } else {
      // 轴向组件（头锥/机身/过渡段）：c8 传壁厚（官方 <thickness>，0=引擎默认）
      c[7] = num(p, 'thickness') || 0;
    }
    out.push({
      type: code,
      length: Number.isFinite(comp.length) ? comp.length : 0,
      radius: Number.isFinite(comp.radius) ? comp.radius : 0,
      aftRadius: Number.isFinite(comp.aftRadius) ? comp.aftRadius : 0,
      axialOffset: Number.isFinite(comp.axialOffset) ? comp.axialOffset : 0,
      shape: shapeCode(shape),
      c,
      density: comp.density ?? 0,
    });
  }
  for (const child of comp.children ?? []) collect(child, out);
}

/** 设计动作序列：stage 边界 + 组件添加（与 WASM designBeginStage/designAddComponent 对应） */
export type DesignAction =
  | { action: 'beginStage' }
  | { action: 'add'; p: DesignComponentParams };

/**
 * 把 RocketModel 序列化为 WASM 设计动作序列。
 * 规则：rocket 下的 stage 依次对应 WASM stage（第一个有效 stage 不发送边界）；
 * 无 stage 包裹的组件归第 0 级；空 stage 跳过。
 */
export function modelToDesignActions(model: RocketModel): DesignAction[] {
  const out: DesignAction[] = [];
  const root = model.root;
  let firstStageSeen = false;
  for (const child of root.children ?? []) {
    if (child.type === 'stage') {
      const comps: DesignComponentParams[] = [];
      collect(child, comps);
      if (comps.length === 0) continue;
      if (firstStageSeen) out.push({ action: 'beginStage' });
      firstStageSeen = true;
      for (const p of comps) out.push({ action: 'add', p });
    } else {
      const comps: DesignComponentParams[] = [];
      collect(child, comps);
      for (const p of comps) out.push({ action: 'add', p });
    }
  }
  if (out.length === 0) {
    const comps: DesignComponentParams[] = [];
    collect(root, comps);
    for (const p of comps) out.push({ action: 'add', p });
  }
  return out;
}

/** 把 RocketModel 序列化为 WASM 设计参数表（单级平铺，兼容旧调用） */
export function modelToDesignParams(model: RocketModel): DesignComponentParams[] {
  const out: DesignComponentParams[] = [];
  collect(model.root, out);
  return out;
}

/** 统计被跳过的组件类型（供 UI 如实说明引擎计算范围） */
export function skippedComponentTypes(model: RocketModel): string[] {
  const skipped = new Set<string>();
  const walk = (comp: RocketComponent): void => {
    if (typeCode(comp.type) === 0 && comp.type !== 'rocket' && comp.type !== 'stage') {
      skipped.add(comp.type);
    }
    for (const child of comp.children ?? []) walk(child);
  };
  walk(model.root);
  return [...skipped];
}
