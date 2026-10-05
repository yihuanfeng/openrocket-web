// 纯 JS 静态分析引擎（质量 / CG / CP / 稳定性）——Barowman 法 + 体积×密度质量。
// 目标：与 WASM 引擎（OpenRocket core）同口径对齐，任何浏览器零依赖可用。
// 输入：前端 RocketModel（与 orkParser 解析、orkSerializer 序列化同一棵树）。
import type { EngineAnalysis, FlightProfile, RocketModel, RocketComponent, SimConditions, DelayScanResult, DelayScanRow } from './types';
import type { MotorSpec } from './engines';
import { motorById } from './engines';
import { materialDensity, surfaceFactor } from './materials';
import type { EngineBridge } from './engine';

// —— 默认材料密度（kg/m³），与 OpenRocket 常见默认对齐；文件未给材料时使用 ——
const DEFAULT_DENSITY: Record<string, number> = {
  nosecone: 1050,          // Polystyrene（OpenRocket 头锥默认）
  bodytube: 855,           // Cardboard（机身默认）
  transition: 855,         // Cardboard
  innertube: 855,          // Cardboard
  launchlug: 855,          // Cardboard
  railbutton: 1400,
  finset: 630,             // Plywood（官方 sample 尾翼默认 630）
  trapezoidfinset: 630,
  ellipticalfinset: 630,
  masscomponent: 1000,
  tubecoupler: 855,
  bulkhead: 1050,
  centeringring: 855,
  engineblock: 855,
  freeformfinset: 630,
  streamer: 600,
  shockcord: 900,
};

const DEFAULT_THICKNESS: Record<string, number> = {
  nosecone: 0.002,
  bodytube: 0.0007,
  transition: 0.002,
  innertube: 0.0007,
  launchlug: 0.0022,
  tubecoupler: 0.0007,
  bulkhead: 0.003,
  centeringring: 0.003,
  engineblock: 0.005,
  streamer: 0.0005,
};

function num(v: unknown, d = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : d;
  }
  return d;
}

function propsOf(c: RocketComponent): Record<string, string> {
  return (c.properties ?? {}) as Record<string, string>;
}

function radiusAt(r: number): number {
  return isNaN(r) || r < 0 ? 0 : r;
}

interface Geo {
  off: number;   // 距鼻尖的起点（m）
  len: number;
  r0: number;    // 前半径（m）
  r1: number;    // 后半径（m）
  kind: string;
  c: RocketComponent;
  density: number;   // 有效密度（文件材料或默认）
  thickness: number; // 壁厚（m，轴向组件）
}

/** 单级轴向堆叠（与 buildGeos 同语义，用于按级质量/几何） */
function buildStageGeos(stage: RocketComponent): Geo[] {
  const geos: Geo[] = [];
  {
    let cursor = 0;
    for (const c of stage.children) {
      let len = Math.max(0, num(c.length));
      // 挂件（stage 直挂）：不占轴向堆叠——尾翼挂上一轴向组件底部（bottom 语义）；
      // 冲击绳/飘带/配重为质量挂件（len 不推进 cursor），轴向位置由 axialOffset 指定
      let off: number;
      if (c.type.includes('fin')) {
        // 尾翼不占轴向堆叠（bottom 语义挂上一轴向组件底部）
        len = 0;
        const root = Math.max(num(propsOf(c)['rootchord'], 0) || num(propsOf(c)['length'], 0.05), 0);
        off = cursor - root;
      } else if (c.type === 'shockcord' || c.type === 'streamer' || c.type === 'masscomponent') {
        len = 0;
        off = Math.max(cursor, num(c.axialOffset));
      } else {
        off = Math.max(cursor, num(c.axialOffset));
      }
      let r0 = radiusAt(num(c.radius));
      let r1 = radiusAt(num(c.aftRadius));
      const kind = c.type;
      // 鼻锥统一语义：尖端 fore=0、基部 aft=基部半径（兼容 preset 直构模型 radius=基部）
      if (kind === 'nosecone') { r1 = Math.max(r0, r1); r0 = 0; }
      let density = num((c as { density?: number }).density, 0);
      if (density <= 0) density = materialDensity(propsOf(c)['material']) ?? DEFAULT_DENSITY[kind] ?? 855;
      let thickness = num(propsOf(c)['wallthickness'], 0) || num(propsOf(c)['thickness'], 0);
      if (thickness <= 0) thickness = DEFAULT_THICKNESS[kind] ?? 0.001;
      geos.push({ off, len, r0, r1, kind, c, density, thickness });
      cursor = off + len;
      // 内部子组件（innertube / enginemount / engineblock / 尾翼）平铺到同一坐标域
      for (const child of c.children ?? []) {
        const clen = Math.max(0, num(child.length));
        // 尾翼/发射耳按 OpenRocket 定位语义：轴向 offset 相对父组件底部（bottom），
        // 尾部基准=父组件底；尾翼起点（根前缘）= 底部 − rootchord
        let coff: number;
        if (child.type.includes('fin')) {
          const root = Math.max(num(propsOf(child)['rootchord'], 0) || num(propsOf(child)['length'], 0.05), 0);
          const bottom = off + Math.max(0, num(c.length)) + Math.min(0, num(child.axialOffset));
          coff = bottom - root;
        } else {
          coff = off + Math.max(0, num(child.axialOffset));
        }
        let cr0 = radiusAt(num(child.radius));
        let cr1 = radiusAt(num(child.aftRadius));
        // 尾翼等子组件无自身半径：取父组件（机身）半径用于干扰因子
        if (child.type.includes('fin')) { cr0 = cr1 = Math.max(radiusAt(num(c.aftRadius)), radiusAt(num(c.radius)), r0, r1); }
        geos.push({
          off: coff, len: clen, r0: cr0, r1: cr1, kind: child.type, c: child,
          density: (num((child as { density?: number }).density, 0) || materialDensity(propsOf(child)['material']) || (DEFAULT_DENSITY[child.type] ?? 855)),
          thickness: (num(propsOf(child)['thickness'], 0) || (DEFAULT_THICKNESS[child.type] ?? 0.001)),
        });
      }
    }
  }
  return geos;
}

/** 轴向堆叠：从鼻尖起算（OpenRocket 坐标：X 从头部尖端向后为正）。
 * 多级：级间 base 累积——上一级尾部接下一级头部，级序影响全箭几何。 */
function buildGeos(root: RocketComponent): Geo[] {
  const geos: Geo[] = [];
  let base = 0;
  for (const stage of root.children) {
    if (stage.type !== 'stage') continue;
    const sgs = buildStageGeos(stage);
    let stageLen = 0;
    for (const g of sgs) {
      g.off += base;
      stageLen = Math.max(stageLen, g.off + g.len);
    }
    geos.push(...sgs);
    base = stageLen;
  }
  return geos;
}

/** 单级结构质量（kg）：复用 massPart 逐组件累加 */
function stageMassOf(stage: RocketComponent): number {
  let m = 0;
  for (const g of buildStageGeos(stage)) {
    const part = massPart(g);
    if (part && part.m > 0) m += part.m;
  }
  return m;
}

/** 旋转体实心体积（m³），shape: ogive/conical/parabolic/power/haack */
function solidVolume(kind: string, len: number, r0: number, r1: number, shape: string): number {
  if (len <= 0) return 0;
  if (kind === 'nosecone') {
    // 头锥：基部半径=后半径（解析后 r0=0 尖端、r1=基部）
    const base = Math.max(r0, r1);
    const k = shape === 'conical' ? 1 / 3 : shape === 'ogive' ? 0.466 : shape === 'parabolic' ? 0.5 : 0.5;
    return k * Math.PI * base * base * len;
  }
  if (kind === 'transition') {
    // 圆台：r0 前(小) r1 后(大)——OpenRocket 过渡段前接小径后接大径
    return (1 / 3) * Math.PI * len * (r0 * r0 + r0 * r1 + r1 * r1);
  }
  // 圆柱（bodytube 等）
  return Math.PI * r0 * r0 * len;
}

/** 壳体积（外体积 - 内体积），轴向组件按壁厚挖空 */
function shellVolume(kind: string, len: number, r0: number, r1: number, thickness: number, shape: string): number {
  const t = Math.min(thickness, Math.max(r0, r1) * 0.9);
  if (t <= 0) return solidVolume(kind, len, r0, r1, shape);
  const ir0 = Math.max(0, r0 - t);
  const ir1 = Math.max(0, r1 - t);
  return solidVolume(kind, len, r0, r1, shape) - solidVolume(kind, len, ir0, ir1, shape);
}

/** 组件质心（相对组件起点，m）——实心旋转体体积质心，与 OpenRocket MassCalculator 同源 */
function localCG(kind: string, len: number, r0: number, r1: number, shape: string): number {
  if (kind === 'nosecone') {
    // 实心体积质心：conical=0.75L、ogive≈0.534L、parabolic=0.5L（OpenRocket cpCache 公式 L·A1−V / A1−A0）
    if (shape === 'conical') return len * 0.75;
    if (shape === 'ogive') return len * 0.534;
    return len * 0.5;
  }
  if (kind === 'transition') {
    // 圆台质心（从小端量起）
    return len * (r0 * r0 + 2 * r0 * r1 + 3 * r1 * r1) / (4 * (r0 * r0 + r0 * r1 + r1 * r1));
  }
  return len / 2;
}

/** 尾翼单翼面积（m²）：梯形 (root+tip)/2 × height */
function finArea(p: Record<string, string>): number {
  const root = num(p['rootchord'], 0) || num(p['length'], 0.05);
  const tip = num(p['tipchord'], 0) || root * 0.6;
  const h = num(p['height'], 0.03);
  return ((root + tip) / 2) * h;
}

// —— 平均气动弦 MAC：48 段数值积分，严格对齐 FinSetCalc.calculateFinGeometry ——
const FIN_DIV = 48;
interface FinMac { macLen: number; macLead: number; macSpan: number; cosG: number; span: number; finArea: number; }
function finMac(p: Record<string, string>): FinMac {
  const root = Math.max(num(p['rootchord'], 0) || num(p['length'], 0.05), 0);
  // tipchord 缺省：按 root 的 0.6 近似（椭圆尾翼无 tip 概念，圆整为 0.6·root，round-trip 一致）
  const tip = Math.max(num(p['tipchord'], 0) || root * 0.6, 0);
  const span = Math.max(num(p['height'], 0.03), 1e-9);
  const sweep = Math.max(num(p['sweep'], 0), 0); // 前缘后掠（沿轴）
  const dy = span / (FIN_DIV - 1);
  let macLen = 0, macLead = 0, macSpan = 0, area = 0, cosG = 0;
  for (let i = 0; i < FIN_DIV; i++) {
    const y = i * dy;
    const f = y / span;
    const lead = sweep * f;
    const trail = lead + root + (tip - root) * f;
    const L = trail - lead;
    macLen += L * L;
    macLead += lead * L;
    macSpan += y * L;
    area += L;
    if (i > 0) {
      const fp = (i - 1) / (FIN_DIV - 1);
      const leadP = sweep * fp;
      const trailP = leadP + root + (tip - root) * fp;
      const dx = (trail + lead) / 2 - (trailP + leadP) / 2;
      const hy = Math.hypot(dx, dy);
      if (hy !== 0) cosG += dy / hy;
    }
  }
  if (area > 1e-12) { macLen /= area; macLead /= area; macSpan /= area; }
  else { macLen = 0; macLead = 0; macSpan = 0; }
  cosG /= (FIN_DIV - 1);
  return { macLen, macLead, macSpan, cosG, span, finArea: area * dy };
}

interface MassPart { m: number; x: number; } // 质量 + 质心（距鼻尖）

function massPart(g: Geo): MassPart | null {
  const p = propsOf(g.c);
  const x0 = g.off;
  const shape = (p['shape'] || 'ogive').toLowerCase();
  // 覆盖质量（伞/配重等）
  const ov = num(p['overridemass'], 0) || num(p['massoverride'], 0);
  if (g.kind === 'parachute' || g.kind === 'streamer') {
    if (ov > 0) return { m: ov, x: x0 + g.len / 2 };
    return { m: 0.002, x: x0 + g.len / 2 };
  }
  if (g.kind === 'shockcord') {
    // 弹性绳质量近似：0.02 kg/m × cordlength
    const cl = num(p['cordlength'], 0.2);
    return { m: Math.max(0.002, 0.02 * cl), x: x0 + g.len / 2 };
  }
  if (g.kind === 'masscomponent') {
    return { m: ov > 0 ? ov : 0.05, x: x0 + g.len / 2 };
  }
  if (g.kind.includes('fin')) {
    const area = finArea(p);
    const t = num(p['thickness'], 0.0032);
    const n = Math.max(1, parseInt(p['fincount'] ?? '3', 10) || 3);
    const m = n * area * t * (g.density || 630);
    // 质心：MAC 中点（对齐 OpenRocket 尾翼质心=MAC 中心）
    const mac = finMac(p);
    const cg = mac.macLead + 0.5 * mac.macLen;
    // 尾翼质心 = MAC 中点（与组件 length 字段无关：前端 fin len=0，解析后 len=根弦，统一用 cg）
    return { m, x: x0 + cg };
  }
  // 轴向组件：壳体积 × 密度
  const v = shellVolume(g.kind, g.len, g.r0, g.r1, g.thickness, shape);
  const m = v * g.density;
  if (m <= 0) return null;
  return { m, x: x0 + localCG(g.kind, g.len, g.r0, g.r1, shape) };
}

// —— Barrowman 气动：法向力系数导数 CNα 与压心（距鼻尖） ——
// 公式严格迁移自 OpenRocket core barrowman 包（SymmetricComponentCalc / FinSetCalc），
// 口径：Mach=0.3（与官方互验 OrkLoadTest 一致）、refArea=π·Rmax²、θ=0 攻角面。
interface AeroPart { cna: number; xcp: number; }

function aeroPart(g: Geo, dRef: number): AeroPart {
  const p = propsOf(g.c);
  const shape = (p['shape'] || 'ogive').toLowerCase();
  const x0 = g.off;
  const refArea = Math.PI * Math.pow(dRef / 2, 2);
  if (g.kind === 'nosecone' || g.kind === 'transition') {
    // 官方：cnaCache = 2·(A1−A0) / refArea；cpCache = (L·A1 − fullVolume) / (A1−A0)（相对组件前缘）
    // A0=fore 面积、A1=aft 面积；头锥 fore=0。收缩段（boattail）cna 为负。
    const A0 = Math.PI * g.r0 * g.r0;
    const A1 = Math.PI * g.r1 * g.r1;
    const dA = A1 - A0;
    if (Math.abs(dA) < 1e-12) return { cna: 0, xcp: x0 + g.len / 2 }; // 圆柱（tube）：CNα=0
    const vol = solidVolume(g.kind, g.len, g.r0, g.r1, shape);
    const cna = 2 * dA / refArea;
    const xcp = x0 + (g.len * A1 - vol) / dA;
    return { cna, xcp };
  }
  if (g.kind === 'bodytube') {
    // 官方 BodyTube：isTube=true → CNα=0（仅 Galejs 体升力，AOA 相关小项，静分析忽略）
    return { cna: 0, xcp: x0 + g.len / 2 };
  }
  if (g.kind.includes('fin')) {
    // 官方 FinSetCalc：
    // CNα1 = 2π·span² / (1 + √(1 + (1−Mach²)·(span²/(finArea·cosΓ))²)) / refArea（单片，亚音速）
    // 干扰 (1+τ)²（亚音速 fallback 与 NACA1307 式21/14 等价），τ = r/(span+r)
    // 翼片方位求和 Σsin²(θ−φᵢ)，θ=0、φᵢ=2πi/N → N 片等分时 Σ=N/2（与官方 getCP 单攻角面同口径）
    // CP = macLead + 0.25·macLength（亚音速四分之一弦）
    const M = 0.3;
    const n = Math.max(1, parseInt(p['fincount'] ?? '3', 10) || 3);
    const mac = finMac(p);
    if (mac.finArea < 1e-12 || mac.span < 1e-12 || mac.cosG < 1e-12) return { cna: 0, xcp: x0 };
    const rBody = Math.max(radiusAt(num(g.c.radius)), g.r0, g.r1); // 翼根处机身半径
    const term = (mac.span * mac.span) / (mac.finArea * mac.cosG);
    const cna1 = 2 * Math.PI * mac.span * mac.span / (1 + Math.sqrt(1 + (1 - M * M) * term * term)) / refArea;
    const tau = rBody / Math.max(mac.span + rBody, 1e-9);
    const interference = Math.pow(1 + tau, 2);
    const sinSum = n >= 2 ? n / 2 : 0; // θ=0 时 N 片等分翼的 Σsin²
    const cna = cna1 * interference * sinSum;
    const xcp = x0 + mac.macLead + 0.25 * mac.macLen;
    return { cna, xcp };
  }
  // launchlug / railbutton / parachute / 其他：CNα=0
  return { cna: 0, xcp: x0 + g.len / 2 };
}

/** 主分析入口 */
export function analyzeModel(model: RocketModel): {
  mass: number; cgX: number; cpX: number; stability: number; length: number; components: number;
} {
  const geos = buildGeos(model.root);
  if (geos.length === 0) {
    return { mass: 0, cgX: 0, cpX: 0, stability: 0, length: 0, components: 0 };
  }
  // 参考直径（最大组件直径）与箭长
  let dRef = 0;
  let length = 0;
  for (const g of geos) {
    dRef = Math.max(dRef, g.r0 * 2, g.r1 * 2);
    length = Math.max(length, g.off + g.len);
  }
  if (dRef <= 0) dRef = 0.04;

  // 质量 / CG
  let m = 0, mx = 0;
  let count = 0;
  for (const g of geos) {
    const part = massPart(g);
    if (part && part.m > 0) {
      m += part.m;
      mx += part.m * part.x;
      count++;
    }
  }
  const mass = m;
  const cgX = m > 0 ? mx / m : 0;

  // CP（Barrowman 叠加）
  let cnaSum = 0, cnaX = 0;
  for (const g of geos) {
    const a = aeroPart(g, dRef);
    cnaSum += a.cna;
    cnaX += a.cna * a.xcp;
  }
  const cpX = cnaSum > 0 ? cnaX / cnaSum : 0;
  // 稳定性 = (CP−CG) / 箭长（与 OpenRocket/WASM 同口径）
  const stability = length > 0 ? (cpX - cgX) / length : 0;

  return { mass, cgX, cpX, stability, length, components: count };
}

/** JS 引擎实现（分析可用；6DOF 仿真留 WASM，JS 版暂不支持） */
export class JsEngine implements EngineBridge {
  readonly kind = 'js' as const;

  async analyze(model: RocketModel): Promise<EngineAnalysis> {
    try {
      const r = analyzeModel(model);
      return {
        mass: r.mass,
        cgX: r.cgX,
        cpX: r.cpX,
        stability: r.stability,
        source: 'js',
        detail: `口径：JS 引擎（Barowman 法，${r.components} 个组件，参考直径 ${(Math.max(2 * Math.max(...geosDiam(model)), 0).toFixed(3))} m）`,
      };
    } catch (e) {
      return {
        mass: null, cgX: null, cpX: null, stability: null,
        source: 'js',
        detail: `JS 引擎计算失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  async simulate(model: RocketModel, motors?: MountedMotor[], cond?: SimConditions): Promise<FlightProfile | null> {
    try {
      const mm = motors && motors.length > 0 ? motors : [{ motor: motorById('c6-5'), ignitionDelay: 0 }];
      return simulate2dof(model, mm, cond ?? DEFAULT_CONDITIONS);
    } catch (e) {
      console.error('JS 仿真失败：', e);
      return {
        maxAltitude_m: 0, maxVelocity_ms: 0, maxAcceleration_ms2: 0, maxMachNumber: 0,
        timeToApogee_s: 0, flightTime_s: 0, groundHitVelocity_ms: 0,
        launchRodVelocity_ms: 0, optimumDelay_s: 0, hasErrors: true, windDrift_m: 0,
        error: e instanceof Error ? e.message : String(e),
        time: [], altitude: [], velocity: [], acceleration: [], mach: [],
        trailX: [], trailY: [],
      };
    }
  }

  /** 延迟优化扫描（P1-6）：对候选延迟跑全仿真，验证最优延迟=远地点−燃尽；
   *  异步分片（每 2 次仿真让出事件循环），避免阻塞 UI；基于主电机（第一台） */
  async optimizeDelay(model: RocketModel, motor: MotorSpec, cond?: SimConditions): Promise<DelayScanResult> {
    const m0 = motor ?? motorById('c6-5');
    const cond0 = cond ?? DEFAULT_CONDITIONS;
    const base = await simulate2dof(model, [{ motor: m0, ignitionDelay: 0 }], cond0);
    const apogee = base.timeToApogee_s;
    const burn = m0.curve.time[m0.curve.time.length - 1];
    const maxDelay = Math.max(12, Math.ceil(apogee + 4));
    const rows: DelayScanRow[] = [];
    for (let d = 0; d <= maxDelay; d++) {
      const p = await simulate2dof(model, [{ motor: { ...m0, delay: d }, ignitionDelay: 0 }], cond0);
      rows.push({
        delay_s: d,
        maxAltitude_m: p.maxAltitude_m,
        flightTime_s: p.flightTime_s,
        deployed: p.flightTime_s > apogee + 0.5, // 落地前开伞 → 飞行时间显著大于到远地点时间
      });
      if (d % 2 === 1) await new Promise((r) => setTimeout(r, 0)); // 让出主线程
    }
    // 最优延迟 = 使开伞时刻=远地点（OpenRocket 口径）；取最接近 apogee−burn 的整秒
    const bestDelay_s = Math.round(Math.max(0, apogee - burn));
    return { motorId: m0.id, apogee_s: apogee, burn_s: burn, bestDelay_s, rows };
  }
}

// ================= JS 2DOF 质点仿真（发动机库驱动） =================
// 说明：简化模型 = 垂直 2DOF（推力/重力/阻力），不含侧风、倾斜与 3D 转动；
// 发动机默认 C6-5（Estes 规格近似曲线，见 engines.ts）；本结果与官方桌面版 6DOF 存在口径差异
// （质量口径、气动模型、发动机曲线），不作为精确飞行预测。
// 多电机：每电机座一台，按各自 ignitionDelay 点火（0=与主级同时，>0=级间/助推延迟点火）；
// 同时点火的电机推力叠加，推进剂各自消耗。主级 = 第一个电机（其点火时序为仿真 0 时刻）。

/** 已装配电机：motor + 相对主级点火的延迟（秒） */
export interface MountedMotor { motor: MotorSpec; ignitionDelay: number; }

const G = 9.80665;
export const DEFAULT_CONDITIONS: SimConditions = { windSpeed_ms: 0, temperature_C: 15, pressure_hPa: 1013.25, windDir_deg: 90 };
const LAUNCH_ROD = 1.0;
const PARACHUTE_FACTOR = 30; // 开伞后阻力放大系数（伞 CdA ≈ 体 CdA × 30，量级合理）

function thrustAt(t: number, motor: MotorSpec): number {
  const T = motor.curve.time;
  const F = motor.curve.thrust;
  if (t <= 0 || t >= T[T.length - 1]) return 0;
  for (let i = 1; i < T.length; i++) {
    if (t <= T[i]) {
      const f = (t - T[i - 1]) / (T[i] - T[i - 1]);
      return F[i - 1] + (F[i] - F[i - 1]) * f;
    }
  }
  return 0;
}
/** 多发动机峰值推力叠加（初始推重比分子：各机各自曲线峰值之和） */
function maxThrustOf(motors: MountedMotor[]): number {
  let s = 0;
  for (const mm of motors) {
    let peak = 0;
    for (const f of mm.motor.curve.thrust) if (f > peak) peak = f;
    s += peak;
  }
  return s;
}
function tGround(cond: SimConditions): number {
  return 288.15 + ((cond?.temperature_C ?? 15) - 15);
}
function airDensity(h: number, cond?: SimConditions): number {
  const hh = Math.max(Math.min(h, 11000), 0);
  const T0 = tGround(cond ?? DEFAULT_CONDITIONS);
  const T = T0 - 0.0065 * hh;
  const pressFactor = (cond?.pressure_hPa ?? 1013.25) / 1013.25;
  // 地面温度修正：密度 ∝ P/T（热空气密度低）；标高递减沿用 ISA 指数律
  return 1.225 * pressFactor * (288.15 / T0) * Math.pow(T / T0, 4.25588);
}
function speedOfSound(h: number, cond?: SimConditions): number {
  const hh = Math.max(Math.min(h, 11000), 0);
  const T0 = tGround(cond ?? DEFAULT_CONDITIONS);
  const T = T0 - 0.0065 * hh;
  return 340.294 * Math.sqrt(T / T0);
}
/** 伞部署高度（m；0=远地点开伞）：取第一个带 deployAlt 的 parachute/streamer */
function findDeployAlt(model: RocketModel): number {
  let alt = 0;
  const walk = (c: RocketComponent) => {
    if (alt === 0 && (c.type === 'parachute' || c.type === 'streamer')) {
      alt = Math.max(0, parseFloat(c.properties['deployAlt'] ?? '0') || 0);
    }
    for (const ch of c.children ?? []) walk(ch);
  };
  walk(model.root);
  return alt;
}

function simCdA(_model: RocketModel): number {
  let rMax = 0, finA = 0, surf = 1;
  const walk = (c: RocketComponent) => {
    for (const r of [c.radius, c.aftRadius]) {
      if (Number.isFinite(r) && r > rMax) rMax = r;
    }
    if (c.type === 'nosecone' || c.type === 'bodytube' || c.type === 'transition') {
      const f = surfaceFactor(c.properties['surface']);
      if (f > surf) surf = f;
    }
    if (c.type.includes('fin')) {
      const n = parseInt(c.properties['fincount'] ?? '3', 10) || 3;
      const h = parseFloat(c.properties['height'] ?? '0.05') || 0.05;
      const rc = parseFloat(c.properties['rootchord'] ?? '0.05') || 0.05;
      finA += n * 0.5 * h * rc;
    }
    for (const ch of c.children ?? []) walk(ch);
  };
  walk(_model.root);
  // 体阻力（细长体 Cd≈0.45）+ 尾翼摩擦/压差阻力（Cd≈0.02）；表面处理作摩擦系数乘子
  return (0.45 * Math.PI * rMax * rMax + 0.02 * finA) * surf;
}

/** 伞/飘带展开后的气动面积×CD（πd²/4·Cd 累加；仅设了直径+CD 的伞计入） */
function chuteCdAOf(model: RocketModel): number {
  let chuteCdA = 0;
  const chuteWalk = (c: RocketComponent) => {
    if (c.type === 'parachute' || c.type === 'streamer') {
      const d = parseFloat(c.properties['diameter'] ?? '0') || 0;
      const cd = parseFloat(c.properties['cd'] ?? '0') || 0;
      if (d > 0 && cd > 0) chuteCdA += (Math.PI * d * d / 4) * cd;
    }
    for (const ch of c.children ?? []) chuteWalk(ch);
  };
  chuteWalk(model.root);
  return chuteCdA;
}

// 3DOF 仿真：纵向（高度/速度）+ 偏航平面（横风侧向漂移，Heun 积分），多级分离/开伞/发射杆约束
// motors：已装配电机序列（含点火时序），至少 1 台；主级 = motors[0]
function simulate2dof(model: RocketModel, motors: MountedMotor[], cond: SimConditions): FlightProfile {
  const a0 = analyzeModel(model);
  if (!(a0.mass > 0)) {
    return {
      maxAltitude_m: 0, maxVelocity_ms: 0, maxAcceleration_ms2: 0, maxMachNumber: 0,
      timeToApogee_s: 0, flightTime_s: 0, groundHitVelocity_ms: 0,
      launchRodVelocity_ms: 0, optimumDelay_s: 0, hasErrors: true, windDrift_m: 0,
      error: '火箭质量无效，无法仿真',
      time: [], altitude: [], velocity: [], acceleration: [], mach: [],
      trailX: [], trailY: [],
    };
  }
  const cda = simCdA(model);
  const chuteCdA = chuteCdAOf(model);
  const wind = Math.max(0, cond.windSpeed_ms ?? 0);
  // 多级：起飞质量为全箭，上级（最后一个 stage）燃尽时刻分离下级质量
  const stages = (model.root.children ?? []).filter((c) => c.type === 'stage');
  let mStruct = a0.mass;
  let sepMass = 0;
  let separated = false;
  if (stages.length > 1) {
    const upper = stages[stages.length - 1];
    const upperMass = stageMassOf(upper);
    if (upperMass > 0 && upperMass < a0.mass) {
      mStruct = upperMass;
      sepMass = a0.mass - upperMass;
    }
  }

  // 电机参数：主级燃尽、各电机总冲（曲线积分）、开伞时刻 = max(远地点, 主级燃尽+主级延迟)
  const main = motors[0];
  const burnMain = main.motor.curve.time[main.motor.curve.time.length - 1];
  const impulses = motors.map((mm) => {
    let s = 0;
    for (let i = 1; i < mm.motor.curve.time.length; i++) {
      s += 0.5 * (mm.motor.curve.thrust[i - 1] + mm.motor.curve.thrust[i]) * (mm.motor.curve.time[i] - mm.motor.curve.time[i - 1]);
    }
    return Math.max(s, 1e-9);
  });
  const ejectT = burnMain + main.motor.delay;
  /** 所有电机在 t 时刻的合成推力（各自偏移点火时序后叠加） */
  const thrustAtAll = (t: number): number => {
    let T = 0;
    for (let i = 0; i < motors.length; i++) T += thrustAt(t - motors[i].ignitionDelay, motors[i].motor);
    return T;
  };
  // 各电机剩余推进剂质量（从 mass0 消耗到 mass1）
  const remMasses = motors.map((mm) => mm.motor.mass0);
  const totalMass = () => mStruct + remMasses.reduce((a, b) => a + b, 0) + (separated ? 0 : sepMass);

  let t = 0, z = 0, v = 0;
  let x = 0, vx = 0, y = 0, vy = 0; // 3DOF 水平面：X=下风轴（沿风向分解），Y=横风轴；发射杆约束时锁定
  // 风向分解：默认 90°（风沿 +Y，兼容旧口径 windDrift=y）；用户可设 windDir_deg 指定风向
  const wDir = ((cond.windDir_deg ?? 90) % 360) * Math.PI / 180;
  const windX = wind * Math.cos(wDir);
  const windY = wind * Math.sin(wDir);
  let m = totalMass();
  let onRod = true;
  let deployed = false;
  let apogee = 0, apogeeT = 0;
  let maxV = 0, maxA = 0, maxMach = 0, rodV = 0, groundV = 0;
  const times: number[] = [], alts: number[] = [], vels: number[] = [], accs: number[] = [], machs: number[] = [];
  const trailXs: number[] = [], trailYs: number[] = [];
  const pushSample = () => {
    const a = (thrustAtAll(t) - G * m) / m; // 净加速度（不含阻力，供展示）
    times.push(t); alts.push(z); vels.push(v); accs.push(a);
    machs.push(Math.abs(v) / speedOfSound(Math.max(z, 0), cond));
    trailXs.push(x); trailYs.push(y);
  };
  pushSample();

  const dt = 0.005;
  let lastSample = 0;
  while (t < 240 && z >= -0.001) {
    const T = thrustAtAll(t);
    const rho = airDensity(Math.max(z, 0), cond);
    // 开伞后：阻力取 基础CdA×30 与 伞CdA 的较大者（伞展开后阻力主导下降段；未设伞参数时保持旧逻辑）
    const cdaEff = deployed ? Math.max(cda * PARACHUTE_FACTOR, chuteCdA) : cda;
    const D = 0.5 * rho * v * v * cdaEff * (v > 0 ? 1 : -1);
    const a = (T - G * m - D) / m;

    // Heun（改进欧拉）
    const v1 = v + a * dt;
    const z1 = Math.max(z + v1 * dt, -0.002);
    const T1 = thrustAtAll(t + dt);
    const rho1 = airDensity(Math.max(z1, 0), cond);
    const D1 = 0.5 * rho1 * v1 * v1 * cdaEff * (v1 > 0 ? 1 : -1);
    const a1 = (T1 - G * m - D1) / m;
    let v2 = v + (a + a1) * 0.5 * dt;
    let z2 = z + (v + v2) * 0.5 * dt;

    // —— 水平面（3DOF）：两轴分别被风场 (windX, windY) 的阻力驱动，速度趋近当地风 ——
    // 下降段阻力刚度高（cdaEff 放大 30 倍），大步长 Heun 会超调越过风速导致数值振荡/漂移虚高；
    // 用 limRel 保证相对风速单步单调衰减、不越过风速。
    const limRel = (v: number, wind: number, dv: number): number => {
      const rel = v - wind;
      return v - Math.sign(rel) * Math.min(Math.abs(dv), Math.abs(rel));
    };
    const Dx = 0.5 * rho * (vx - windX) * Math.abs(vx - windX) * cdaEff;
    const ax = -Dx / m;
    const vx1 = limRel(vx, windX, ax * dt);
    const Dx1 = 0.5 * rho1 * (vx1 - windX) * Math.abs(vx1 - windX) * cdaEff;
    const ax1 = -Dx1 / m;
    let vx2 = limRel(vx, windX, (ax + ax1) * 0.5 * dt);
    let x2 = x + (vx + vx2) * 0.5 * dt;

    const Dy = 0.5 * rho * (vy - windY) * Math.abs(vy - windY) * cdaEff;
    const ay = -Dy / m;
    const vy1 = limRel(vy, windY, ay * dt);
    const Dy1 = 0.5 * rho1 * (vy1 - windY) * Math.abs(vy1 - windY) * cdaEff;
    const ay1 = -Dy1 / m;
    let vy2 = limRel(vy, windY, (ay + ay1) * 0.5 * dt);
    let y2 = y + (vy + vy2) * 0.5 * dt;

    if (onRod) {
      // 发射杆：导轨约束水平面（无漂移）
      x2 = 0; vx2 = 0;
      y2 = 0; vy2 = 0;
      // 发射杆阶段：不陷入地面（发射台支撑）、速度不反向
      z2 = Math.max(z2, 0);
      v2 = Math.max(v2, 0);
      if (z2 >= LAUNCH_ROD) {
        onRod = false;
        rodV = v2;
      }
    }
    // 推进剂消耗：各电机按自身推力比例分摊
    for (let i = 0; i < motors.length; i++) {
      const th = thrustAt(t - motors[i].ignitionDelay, motors[i].motor);
      if (th > 0) {
        remMasses[i] = Math.max(motors[i].motor.mass1, remMasses[i] - (motors[i].motor.propellant * th * dt) / impulses[i]);
      }
    }
    m = totalMass();
    // 多级分离：主级燃尽瞬间抛掉下级
    if (!separated && sepMass > 0 && t >= burnMain) {
      m -= sepMass;
      separated = true;
    }
    // 记录远地点（v 由正转负）
    if (apogeeT === 0 && v2 <= 0 && v > 0) {
      apogee = Math.max(z, z2);
      apogeeT = t + dt;
    }
    // 开伞：默认 max(远地点, 主级燃尽+主级延迟)；若指定伞部署高度 deployAlt>0，则下降至该高度再开伞
    if (!deployed && apogeeT > 0 && t >= ejectT) {
      const deployAlt = findDeployAlt(model);
      const atDeploy = deployAlt > 0 ? z <= deployAlt : t >= apogeeT;
      if (atDeploy) deployed = true;
    }
    v = v2; z = z2; vx = vx2; x = x2; vy = vy2; y = y2; t += dt;
    const av = Math.abs(v);
    if (av > maxV) maxV = av;
    if (a > maxA) maxA = a;
    const mach = av / speedOfSound(Math.max(z, 0), cond);
    if (mach > maxMach) maxMach = mach;
    const sInt = deployed ? 0.2 : 0.02;
    if (t - lastSample >= sInt) { pushSample(); lastSample = t; }
    if (z < 0 && apogee > 0) { groundV = v; break; }
  }
  // 补最后一个采样点
  if (times[times.length - 1] !== t) pushSample();

  return {
    maxAltitude_m: apogee,
    maxVelocity_ms: maxV,
    maxAcceleration_ms2: maxA,
    maxMachNumber: maxMach,
    timeToApogee_s: apogeeT,
    flightTime_s: t,
    groundHitVelocity_ms: groundV,
    launchRodVelocity_ms: rodV,
    optimumDelay_s: Math.max(0, apogeeT - burnMain), // 使远地点开伞的最优延迟
    windDrift_m: Math.hypot(x, y), // 3DOF 水平漂移：风阻积分的真实漂移
    mass_kg: a0.mass, // 起飞质量（含发动机，多级为全箭）
    twr: maxThrustOf(motors) / (a0.mass * G), // 初始推重比（各机峰值推力叠加 / 起飞重力）
    hasErrors: false,
    error: undefined,
    time: times, altitude: alts, velocity: vels, acceleration: accs, mach: machs,
    trailX: trailXs, trailY: trailYs,
  };
}

function geosDiam(model: RocketModel): number[] {
  const out: number[] = [];
  const walk = (c: RocketComponent) => {
    out.push(num(c.radius) * 2, num(c.aftRadius) * 2);
    for (const ch of c.children ?? []) walk(ch);
  };
  walk(model.root);
  return out;
}
