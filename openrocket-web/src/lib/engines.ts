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
    id: 'd12-5', name: 'D12-5', class: 'D', diameterMM: 18, lengthMM: 70,
    delay: 5, burnTime: 1.7, maxThrust: 29.7, totalImpulseNs: 17.0,
    mass0: 0.042, mass1: 0.0209, propellant: 0.0211,
    curve: buildCurve(17.0, 29.7, 1.7),
    source: 'ThrustCurve 认证 17.0 N·s / 29.7 N / 1.7 s；42 g，推进剂 21.1 g',
  },
  {
    id: 'a10-3t', name: 'A10-3T', class: 'A', diameterMM: 13, lengthMM: 46,
    delay: 3, burnTime: 0.5, maxThrust: 11.1, totalImpulseNs: 1.6,
    mass0: 0.0094, mass1: 0.0066, propellant: 0.0028,
    curve: buildCurve(1.6, 11.1, 0.5),
    source: 'A10-3T 规格（1.6 N·s / ~11 N / 0.5 s），13mm 迷你级',
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
