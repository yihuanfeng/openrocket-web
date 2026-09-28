// 材料库 / 标准直径系列 / 表面处理（P0-3 属性面板补全）
// 密度单位 kg/m³，与 jsEngine DEFAULT_DENSITY 默认类型对齐（未指定材料时沿用类型默认）。

export interface Material {
  name: string;
  density: number;
  desc?: string;
}

export const MATERIALS: Material[] = [
  { name: '纸板 (Cardboard)', density: 855, desc: '机身/内衬管默认' },
  { name: '轻木 (Balsa)', density: 160, desc: '轻质尾翼' },
  { name: '胶合板 (Plywood)', density: 630, desc: '尾翼默认' },
  { name: '聚苯乙烯 (Polystyrene)', density: 1050, desc: '头锥默认' },
  { name: 'ABS 塑料', density: 1050, desc: '结构塑料件' },
  { name: '聚丙烯 (Polypropylene)', density: 905, desc: '柔性塑料' },
  { name: '尼龙 (Nylon)', density: 1150, desc: '绳/布' },
  { name: '铝 (Aluminum)', density: 2700, desc: '金属件' },
  { name: '玻璃纤维 (Fiberglass)', density: 1900, desc: '高强管' },
  { name: '碳纤维 (Carbon Fiber)', density: 1600, desc: '高性能管' },
];

export function materialDensity(name?: string): number | undefined {
  if (!name) return undefined;
  const hit = MATERIALS.find((m) => m.name === name);
  return hit?.density;
}

// —— 标准管径系列（Estes BT 系列，外径；半径 m）——
// 数据来源：Estes 标准机身管径对照（BT-5 … BT-80），单位英寸换算 mm 后取半径。
export interface TubeSize {
  id: string;   // 如 BT-50
  odInch: number; // 外径（英寸）
  radiusM: number; // 半径（m）
}

export const TUBES: TubeSize[] = [
  { id: 'BT-5',  odInch: 0.541, radiusM: 0.00687 },
  { id: 'BT-20', odInch: 0.736, radiusM: 0.00935 },
  { id: 'BT-50', odInch: 0.976, radiusM: 0.0124 },
  { id: 'BT-55', odInch: 1.325, radiusM: 0.01683 },
  { id: 'BT-60', odInch: 1.637, radiusM: 0.02079 },
  { id: 'BT-70', odInch: 2.217, radiusM: 0.02816 },
  { id: 'BT-80', odInch: 2.6,   radiusM: 0.03302 },
];

/** 半径 → 最近标准管径 id（误差 > 5% 视为自定义，返回空） */
export function nearestTube(radiusM: number): string | '' {
  if (!(radiusM > 0)) return '';
  let best = '';
  let bestErr = 0.05;
  for (const t of TUBES) {
    const err = Math.abs(t.radiusM - radiusM) / radiusM;
    if (err < bestErr) { bestErr = err; best = t.id; }
  }
  return best;
}

// —— 表面处理（影响气动阻力：摩擦系数乘子）——
export const SURFACES: Array<{ id: string; label: string; factor: number }> = [
  { id: 'smooth', label: '光滑（抛光/喷漆）', factor: 0.95 },
  { id: 'standard', label: '标准（原厂表面）', factor: 1.0 },
  { id: 'rough', label: '粗糙（接缝/贴纸）', factor: 1.12 },
];

export function surfaceFactor(id?: string): number {
  return SURFACES.find((s) => s.id === id)?.factor ?? 1;
}

// —— 伞部署（0 = 远地点开伞；>0 = 下降至该高度开伞，m）——
export const DEPLOY_ALTITUDES = [0, 100, 200, 300, 400, 500];
