// OpenRocket 组件数据模型（阶段 1 查看器用）

export interface RocketComponent {
  /** 组件类型（XML 标签名），如 nosecone / bodytube / transition / stage */
  type: string;
  /** 组件名称 */
  name: string;
  /** 子组件（递归） */
  children: RocketComponent[];
  /** XML 中其余属性/子元素的原始文本值（key → value） */
  properties: Record<string, string>;
  /** 几何（SI 单位：米），解析失败时为 NaN */
  length: number;
  /** 前端半径（米） */
  radius: number;
  /** 后端半径（米） */
  aftRadius: number;
  /** 相对父组件的轴向偏移（米） */
  axialOffset: number;
  /** 形状（头锥/过渡段）：ogive / parabolic / conical / power / haack */
  shape: string;
  /** 材料密度（kg/m³，bulk 型；0/缺省 = 引擎默认材料，未解析到材料时保持默认） */
  density?: number;
}

export interface RocketModel {
  /** .ork 文件格式版本 */
  formatVersion: string;
  /** 创建者 */
  creator: string;
  /** 火箭名称 */
  name: string;
  /** 参考类型（CG/CP 参照） */
  referenceType: string;
  /** 根组件树 */
  root: RocketComponent;
}

/** 6DOF 仿真结果（阶段 3：摘要 + 飞行剖面时间序列） */
export interface FlightProfile {
  maxAltitude_m: number;
  maxVelocity_ms: number;
  maxAcceleration_ms2: number;
  maxMachNumber: number;
  timeToApogee_s: number;
  flightTime_s: number;
  groundHitVelocity_ms: number;
  launchRodVelocity_ms: number;
  optimumDelay_s: number;
  hasErrors: boolean;
  /** 仿真失败时的错误说明（如设计无发动机） */
  error?: string;
  /** 横向风偏（m）：线性风场近似，风速恒定 × 飞行时间 */
  windDrift_m: number;
  time: number[];
  altitude: number[];
  velocity: number[];
  acceleration: number[];
  mach: number[];
}

/** 仿真环境条件（P1-5）：地面风速 / 温度 / 气压 */
export interface SimConditions {
  /** 地面风速（m/s），线性风场近似（全高度恒定，无边界层衰减） */
  windSpeed_ms: number;
  /** 地面温度（°C，ISA 标准 15°C） */
  temperature_C: number;
  /** 地面气压（hPa，标准 1013.25） */
  pressure_hPa: number;
}

/** 延迟优化扫描结果（P1-6） */
export interface DelayScanRow {
  delay_s: number;
  maxAltitude_m: number;
  flightTime_s: number;
  deployed: boolean;
}
export interface DelayScanResult {
  motorId: string;
  apogee_s: number;
  burn_s: number;
  /** 最优延迟 = 远地点时刻 − 燃尽时刻（OpenRocket 口径） */
  bestDelay_s: number;
  rows: DelayScanRow[];
}

/** 引擎计算结果（阶段 1 由引擎桥提供） */
export interface EngineAnalysis {
  mass: number | null;
  cgX: number | null;
  cpX: number | null;
  /** 稳定性余量（口径：静稳定度，CP-CG 与直径比值或长度比值，由引擎口径说明） */
  stability: number | null;
  source: 'wasm' | 'http' | 'js' | 'none';
  detail?: string;
}

export const UNIT_LABEL = 'm';
