// 发动机库：Estes 常见 18mm 标准发动机的规格近似曲线
// 数据来源：Estes 官方规格页/Engine Chart（estesrockets.com、estes_engines_chart.pdf）+ ThrustCurve 认证值。
// 口径说明：推力曲线为基于「总冲 / 峰值推力 / 燃时」规格的分段线性近似（梯形），非实测数据；
//   总冲面积与官方规格一致（C6 演示曲线此前来自 OpenRocket 内置 demo，现按 Estes 规格真实化）。

export interface MotorCurvePoint { t: number; thrust: number; } // 秒 / 牛顿

export interface MotorSpec {
  id: string;
  name: string;            // 如 C6-5
  class: string;           // 字母级：A/B/C/D
  diameterMM: number;      // 18（标准 Estes）
  lengthMM: number;        // 70
  delay: number;           // 燃尽后延迟（s）
  burnTime: number;        // 燃时（s）
  maxThrust: number;       // 峰值推力（N，规格）
  totalImpulseNs: number;  // 总冲（N·s，规格）
  mass0: number;           // 初始质量（kg）
  mass1: number;           // 燃尽质量（kg）
  propellant: number;      // 推进剂质量（kg）
  curve: { time: number[]; thrust: number[] }; // 分段线性（面积≈总冲）
  source: string;          // 数据来源标注
  custom?: boolean;        // 用户导入
  manufacturer?: string;   // 厂商（motor-database 精选库）
  caseInfo?: string;
  propInfo?: string;
}

/** 由规格生成梯形曲线：0→peak(0.1B)→peak→0(B)，平台宽度反解使面积=总冲；平台为负则尖峰 */
export function buildCurve(totalImpulse: number, peak: number, burn: number): { time: number[]; thrust: number[] } {
  const t1 = 0.1 * burn;
  const t2 = (2 * totalImpulse) / peak - burn + t1;
  if (t2 <= t1 + 0.03) {
    const peakEff = Math.min(peak, (2 * totalImpulse) / burn);
    return { time: [0, 0.15 * burn, burn], thrust: [0, peakEff, 0] };
  }
  return { time: [0, t1, Math.min(t2, burn - 0.02), burn], thrust: [0, peak, peak, 0] };
}

export const MOTORS: MotorSpec[] = [
  {
    id: 'a8-3', name: 'A8-3', class: 'A', diameterMM: 18, lengthMM: 70,
    delay: 3, burnTime: 0.5, maxThrust: 10.7, totalImpulseNs: 2.5,
    mass0: 0.0156, mass1: 0.0113, propellant: 0.0043,
    curve: buildCurve(2.5, 10.7, 0.5),
    source: 'Estes Engine Chart：2.5 N·s / 10.7 N / 0.5 s；重量 0.55 oz',
  },
  {
    id: 'b4-4', name: 'B4-4', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 4, burnTime: 0.9, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0173, mass1: 0.0118, propellant: 0.0055,
    curve: buildCurve(5.0, 12.1, 0.9),
    source: 'B 级规格（5.0 N·s / 12.1 N，燃时 0.9 s 近似）',
  },
  {
    id: 'b6-4', name: 'B6-4', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 4, burnTime: 0.8, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0179, mass1: 0.0123, propellant: 0.0056,
    curve: buildCurve(5.0, 12.1, 0.8),
    source: 'Estes 官方：5.0 N·s / 12.1 N / 0.8 s；重量 0.63 oz',
  },
  {
    id: 'c6-3', name: 'C6-3', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 3, burnTime: 1.6, maxThrust: 15.3, totalImpulseNs: 10.0,
    mass0: 0.0258, mass1: 0.0133, propellant: 0.0125,
    curve: buildCurve(10.0, 15.3, 1.6),
    source: 'C6 规格（10.0 N·s / 15.3 N / 1.6 s），延迟 3 s 变体',
  },
  {
    id: 'c6-5', name: 'C6-5', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 5, burnTime: 1.6, maxThrust: 15.3, totalImpulseNs: 10.0,
    mass0: 0.0258, mass1: 0.0133, propellant: 0.0125,
    curve: buildCurve(10.0, 15.3, 1.6),
    source: 'Estes 官方：10.0 N·s / 15.3 N / 1.6 s / 延迟 5 s；25.8 g，推进剂 12.48 g',
  },
  {
    id: 'c6-7', name: 'C6-7', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 7, burnTime: 1.6, maxThrust: 15.3, totalImpulseNs: 10.0,
    mass0: 0.0258, mass1: 0.0133, propellant: 0.0125,
    curve: buildCurve(10.0, 15.3, 1.6),
    source: 'C6 规格（10.0 N·s / 15.3 N / 1.6 s），延迟 7 s 变体',
  },
  {
    id: 'd12-5', name: 'D12-5', class: 'D', diameterMM: 24, lengthMM: 70,
    delay: 5, burnTime: 1.7, maxThrust: 29.7, totalImpulseNs: 17.0,
    mass0: 0.042, mass1: 0.0209, propellant: 0.0211,
    curve: buildCurve(17.0, 29.7, 1.7),
    source: 'ThrustCurve 认证 17.0 N·s / 29.7 N / 1.7 s；42 g，推进剂 21.1 g（24×70mm）',
  },
  {
    id: 'a10-3t', name: 'A10-3T', class: 'A', diameterMM: 13, lengthMM: 46,
    delay: 3, burnTime: 0.5, maxThrust: 11.1, totalImpulseNs: 1.6,
    mass0: 0.0094, mass1: 0.0066, propellant: 0.0028,
    curve: buildCurve(1.6, 11.1, 0.5),
    source: 'A10-3T 规格（1.6 N·s / ~11 N / 0.5 s），13mm 迷你级',
  },
  // —— Estes 全系扩充（官方 Engine Chart 规格 + ThrustCurve 认证值）——
  {
    id: 'a3-4t', name: 'A3-4T', class: 'A', diameterMM: 13, lengthMM: 45,
    delay: 4, burnTime: 0.5, maxThrust: 8.3, totalImpulseNs: 2.5,
    mass0: 0.0099, mass1: 0.0056, propellant: 0.0043,
    curve: buildCurve(2.5, 8.3, 0.5),
    source: 'Estes Engine Chart：A3-4T 2.5 N·s / 8.3 N / 0.5 s，13×45mm；重量近似 9.9 g',
  },
  {
    id: 'a8-5', name: 'A8-5', class: 'A', diameterMM: 18, lengthMM: 70,
    delay: 5, burnTime: 0.5, maxThrust: 10.7, totalImpulseNs: 2.5,
    mass0: 0.0156, mass1: 0.0113, propellant: 0.0043,
    curve: buildCurve(2.5, 10.7, 0.5),
    source: 'A8 规格（2.5 N·s / 10.7 N / 0.5 s），延迟 5 s 变体',
  },
  {
    id: 'b4-2', name: 'B4-2', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 2, burnTime: 0.9, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0173, mass1: 0.0118, propellant: 0.0055,
    curve: buildCurve(5.0, 12.1, 0.9),
    source: 'B4 规格（5.0 N·s / 12.1 N / 0.9 s），延迟 2 s 变体',
  },
  {
    id: 'b4-6', name: 'B4-6', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 6, burnTime: 0.9, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0173, mass1: 0.0118, propellant: 0.0055,
    curve: buildCurve(5.0, 12.1, 0.9),
    source: 'B4 规格（5.0 N·s / 12.1 N / 0.9 s），延迟 6 s 变体',
  },
  {
    id: 'b6-2', name: 'B6-2', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 2, burnTime: 0.8, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0179, mass1: 0.0123, propellant: 0.0056,
    curve: buildCurve(5.0, 12.1, 0.8),
    source: 'B6 规格（5.0 N·s / 12.1 N / 0.8 s），延迟 2 s 变体',
  },
  {
    id: 'b6-6', name: 'B6-6', class: 'B', diameterMM: 18, lengthMM: 70,
    delay: 6, burnTime: 0.8, maxThrust: 12.1, totalImpulseNs: 5.0,
    mass0: 0.0179, mass1: 0.0123, propellant: 0.0056,
    curve: buildCurve(5.0, 12.1, 0.8),
    source: 'B6 规格（5.0 N·s / 12.1 N / 0.8 s），延迟 6 s 变体',
  },
  {
    id: 'c11-3', name: 'C11-3', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 3, burnTime: 0.8, maxThrust: 16.7, totalImpulseNs: 10.0,
    mass0: 0.0295, mass1: 0.017, propellant: 0.0125,
    curve: buildCurve(10.0, 16.7, 0.8),
    source: 'ThrustCurve 认证：C11 10.0 N·s / 16.7 N / 0.8 s；重量近似 29.5 g',
  },
  {
    id: 'c5-3', name: 'C5-3', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 3, burnTime: 1.85, maxThrust: 20.4, totalImpulseNs: 10.0,
    mass0: 0.0236, mass1: 0.0126, propellant: 0.011,
    curve: buildCurve(10.0, 20.4, 1.85),
    source: 'Estes 官方（estesrockets.com）：10.0 N·s / 20.4 N / 1.85 s / 延迟 3 s；23.6 g，推进剂 11 g。ThrustCurve 实测认证总冲 7.8 N·s，两者口径不同',
  },
  {
    id: 'c11-5', name: 'C11-5', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 5, burnTime: 0.8, maxThrust: 16.7, totalImpulseNs: 10.0,
    mass0: 0.0295, mass1: 0.017, propellant: 0.0125,
    curve: buildCurve(10.0, 16.7, 0.8),
    source: 'C11 规格（10.0 N·s / 16.7 N / 0.8 s），延迟 5 s 变体',
  },
  {
    id: 'c11-7', name: 'C11-7', class: 'C', diameterMM: 18, lengthMM: 70,
    delay: 7, burnTime: 0.8, maxThrust: 16.7, totalImpulseNs: 10.0,
    mass0: 0.0295, mass1: 0.017, propellant: 0.0125,
    curve: buildCurve(10.0, 16.7, 0.8),
    source: 'C11 规格（10.0 N·s / 16.7 N / 0.8 s），延迟 7 s 变体',
  },
  {
    id: 'd12-3', name: 'D12-3', class: 'D', diameterMM: 24, lengthMM: 70,
    delay: 3, burnTime: 1.7, maxThrust: 29.7, totalImpulseNs: 17.0,
    mass0: 0.042, mass1: 0.0209, propellant: 0.0211,
    curve: buildCurve(17.0, 29.7, 1.7),
    source: 'D12 规格（17.0 N·s / 29.7 N / 1.7 s），延迟 3 s 变体',
  },
  {
    id: 'd12-7', name: 'D12-7', class: 'D', diameterMM: 24, lengthMM: 70,
    delay: 7, burnTime: 1.7, maxThrust: 29.7, totalImpulseNs: 17.0,
    mass0: 0.042, mass1: 0.0209, propellant: 0.0211,
    curve: buildCurve(17.0, 29.7, 1.7),
    source: 'D12 规格（17.0 N·s / 29.7 N / 1.7 s），延迟 7 s 变体',
  },
  {
    id: 'e9-4', name: 'E9-4', class: 'E', diameterMM: 24, lengthMM: 110,
    delay: 4, burnTime: 3.2, maxThrust: 18.2, totalImpulseNs: 30.0,
    mass0: 0.0638, mass1: 0.0308, propellant: 0.033,
    curve: buildCurve(30.0, 18.2, 3.2),
    source: 'Estes Engine Chart：E9 30.0 N·s / 18.2 N / 3.2 s，24×110mm；重量近似 63.8 g',
  },
  {
    id: 'e9-6', name: 'E9-6', class: 'E', diameterMM: 24, lengthMM: 110,
    delay: 6, burnTime: 3.2, maxThrust: 18.2, totalImpulseNs: 30.0,
    mass0: 0.0638, mass1: 0.0308, propellant: 0.033,
    curve: buildCurve(30.0, 18.2, 3.2),
    source: 'E9 规格（30.0 N·s / 18.2 N / 3.2 s），延迟 6 s 变体',
  },
  {
    id: 'e12-4', name: 'E12-4', class: 'E', diameterMM: 24, lengthMM: 110,
    delay: 4, burnTime: 1.9, maxThrust: 28.6, totalImpulseNs: 30.0,
    mass0: 0.0638, mass1: 0.0308, propellant: 0.033,
    curve: buildCurve(30.0, 28.6, 1.9),
    source: 'ThrustCurve 认证：E12 30.0 N·s / 28.6 N / 1.9 s，24×110mm；重量近似 63.8 g',
  },
  {
    id: 'e12-6', name: 'E12-6', class: 'E', diameterMM: 24, lengthMM: 110,
    delay: 6, burnTime: 1.9, maxThrust: 28.6, totalImpulseNs: 30.0,
    mass0: 0.0638, mass1: 0.0308, propellant: 0.033,
    curve: buildCurve(30.0, 28.6, 1.9),
    source: 'E12 规格（30.0 N·s / 28.6 N / 1.9 s），延迟 6 s 变体',
  },
  {
    id: 'f15-4', name: 'F15-4', class: 'F', diameterMM: 24, lengthMM: 110,
    delay: 4, burnTime: 3.2, maxThrust: 25.0, totalImpulseNs: 40.0,
    mass0: 0.0921, mass1: 0.0481, propellant: 0.044,
    curve: buildCurve(40.0, 25.0, 3.2),
    source: 'Estes Engine Chart：F15 40.0 N·s / 25.0 N / 3.2 s，24×110mm；重量近似 92.1 g',
  },
  {
    id: 'f15-6', name: 'F15-6', class: 'F', diameterMM: 24, lengthMM: 110,
    delay: 6, burnTime: 3.2, maxThrust: 25.0, totalImpulseNs: 40.0,
    mass0: 0.0921, mass1: 0.0481, propellant: 0.044,
    curve: buildCurve(40.0, 25.0, 3.2),
    source: 'F15 规格（40.0 N·s / 25.0 N / 3.2 s），延迟 6 s 变体',
  },
  {
    id: 'f15-8', name: 'F15-8', class: 'F', diameterMM: 24, lengthMM: 110,
    delay: 8, burnTime: 3.2, maxThrust: 25.0, totalImpulseNs: 40.0,
    mass0: 0.0921, mass1: 0.0481, propellant: 0.044,
    curve: buildCurve(40.0, 25.0, 3.2),
    source: 'F15 规格（40.0 N·s / 25.0 N / 3.2 s），延迟 8 s 变体',
  },
];

export const DEFAULT_MOTOR_ID = 'c6-5';

export function motorById(id: string): MotorSpec {
  return MOTORS.find((m) => m.id === id) ?? MOTORS[4];
}

/** 解析 RASP .eng 文本（ThrustCurve 格式）→ 自定义发动机；失败返回 null */
export function parseEngFile(text: string): MotorSpec | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith(';') && !l.startsWith('#'));
  if (lines.length < 2) return null;
  const head = lines[0].split(/\s+/);
  const name = head[0] ?? 'Custom';
  const delay = parseFloat(head[3] ?? '0') || 0;
  const propellant = parseFloat(head[5] ?? '0') || 0; // kg（第 5 列常见为推进剂 kg）
  const pts: number[][] = [];
  for (const l of lines.slice(1)) {
    const p = l.split(/\s+/).map(Number);
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
  }
  if (pts.length < 2) return null;
  // 提取规格（总冲由梯形积分算，峰推取最大值）
  let impulse = 0;
  for (let i = 1; i < pts.length; i++) impulse += 0.5 * (pts[i - 1][1] + pts[i][1]) * (pts[i][0] - pts[i - 1][0]);
  const peak = Math.max(...pts.map((p) => p[1]));
  const end = pts[pts.length - 1][0];
  // 质量近似：壳重 = 推进剂 × 0.45（黑火药发动机典型），初始 = 壳 + 推进剂
  const shell = Math.max(propellant * 0.45, 0.004);
  const m1 = shell;
  const m0 = shell + propellant;
  return {
    id: 'custom-' + name.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    name, class: (name[0] ?? 'C').toUpperCase(), diameterMM: 18, lengthMM: 70,
    delay, burnTime: end, maxThrust: peak, totalImpulseNs: impulse,
    mass0: m0, mass1: m1, propellant,
    curve: { time: pts.map((p) => p[0]), thrust: pts.map((p) => p[1]) },
    source: '用户导入 RASP/ENG 文件',
    custom: true,
  };
}

/** 解析 RASP XML（.rse，ThrustCurve 下载格式）→ MotorSpec；失败返回 null。
 *  属性含 mfg/code/dia(英寸)/len(英寸)/delays/avgThrust/peakThrust/Itot/burn-time/initWt/propWt，数据点为 <eng-data t f m cg/> */
export function parseRseFile(text: string): MotorSpec | null {
  const attrs = text.match(/<engine\s([^>]*)>/);
  if (!attrs) return null;
  const a: Record<string, string> = {};
  for (const m of attrs[1].matchAll(/([A-Za-z-]+)\s*=\s*"([^"]*)"/g)) a[m[1]] = m[2];
  const code = (a.code ?? a.Code ?? '').trim();
  if (!code) return null;
  const mfg = (a.mfg ?? 'ThrustCurve').trim();
  const name = `${mfg.replace(/\s+/g, '')} ${code}`.trim();
  const delay = parseInt(String(a.delays ?? '0').match(/\d+/)?.[0] ?? '0', 10) || 0;
  // ThrustCurve .rse 的 dia/len 属性单位为毫米（与 motor-database metadata 一致，非 RASP 英寸惯例）
  const diaMM = parseFloat(a.dia ?? '0') || 0;
  const lenMM = parseFloat(a.len ?? '0') || 0;
  const propG = parseFloat(a.propWt ?? '0') || 0;   // 推进剂（克）
  const initG = parseFloat(a.initWt ?? '0') || 0;   // 初始重量（克）
  const pts: number[][] = [];
  const re = /<eng-data\s+t="([\d.\-eE]+)"\s+f="([\d.\-eE]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const t = parseFloat(m[1]); const f = parseFloat(m[2]);
    if (Number.isFinite(t) && Number.isFinite(f)) pts.push([t, f]);
  }
  if (pts.length < 2) return null;
  let impulse = 0;
  for (let i = 1; i < pts.length; i++) impulse += 0.5 * (pts[i - 1][1] + pts[i][1]) * (pts[i][0] - pts[i - 1][0]);
  const peak = Math.max(...pts.map((p) => p[1]));
  const end = pts[pts.length - 1][0];
  const propKg = propG / 1000;
  const m1 = Math.max((initG - propG) / 1000, 0.004);
  const m0 = initG / 1000;
  return {
    id: 'custom-' + name.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    name, class: (code[0] ?? 'C').toUpperCase(),
    diameterMM: Math.round(diaMM), lengthMM: Math.round(lenMM),
    delay, burnTime: Math.round(end * 100) / 100, maxThrust: Math.round(peak * 100) / 100,
    totalImpulseNs: Math.round(impulse * 100) / 100,
    mass0: m0, mass1: m1, propellant: propKg,
    curve: { time: pts.map((p) => p[0]), thrust: pts.map((p) => p[1]) },
    source: `RASP XML（${mfg}）实测数据`,
    custom: true,
  };
}
