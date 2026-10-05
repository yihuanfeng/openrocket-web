// 引擎桥：统一接口——WASM 优先（需 WebAssembly GC）；不支持时降级为 JS 静态分析引擎
import type { DelayScanResult, EngineAnalysis, FlightProfile, RocketModel, SimConditions } from './types';
import type { MotorSpec } from './engines';
import type { MountedMotor } from './jsEngine';
import { WasmEngine } from './wasmEngine';
import { JsEngine } from './jsEngine';

export interface EngineBridge {
  /** 计算整箭质量、CG、CP、稳定性（输入为已解析的火箭模型） */
  analyze(model: RocketModel): Promise<EngineAnalysis>;
  /** 对当前设计跑仿真，返回飞行剖面；motors = 已装配发动机序列（含点火时序），缺省回退 C6-5 */
  simulate(model: RocketModel, motors?: MountedMotor[], cond?: SimConditions): Promise<FlightProfile | null>;
  /** 延迟优化扫描（P1-6）：候选延迟全仿真，返回最优延迟与扫描表（WASM 引擎不支持时抛错） */
  optimizeDelay(model: RocketModel, motor?: MotorSpec, cond?: SimConditions): Promise<DelayScanResult>;
  readonly kind: 'wasm' | 'http' | 'js' | 'none';
}

/** 引擎不可用时的占位实现（浏览器不支持 WebAssembly GC 等场景） */
export class NoopEngine implements EngineBridge {
  readonly kind = 'none' as const;
  async analyze(): Promise<EngineAnalysis> {
    return {
      mass: null, cgX: null, cpX: null, stability: null,
      source: 'none',
      detail: engineDiag().tip,
    };
  }
  async simulate(): Promise<FlightProfile | null> {
    return null;
  }
  async optimizeDelay(): Promise<DelayScanResult> {
    throw new Error(engineDiag().tip);
  }
}

export interface EngineDiag {
  supported: boolean;
  hasWasm: boolean;
  hasGC: boolean;
  ua: string;
  tip: string;
}

/** 诊断浏览器对 WASM 引擎的支持情况（含可操作指引） */
export function engineDiag(): EngineDiag {
  const hasWasm = typeof WebAssembly !== 'undefined';
  let hasGC = false;
  try {
    hasGC = !!(WebAssembly as unknown as { GC?: unknown }).GC;
  } catch {
    hasGC = false;
  }
  const supported = hasWasm && hasGC;
  const tip = supported
    ? '浏览器支持 WebAssembly GC，WASM 引擎可正常运行。'
    : `当前浏览器无法运行 WASM 引擎（WebAssembly GC 不可用）。请改用 Chrome/Edge 119+、Safari 17+、Firefox 120+ 打开本页以启用仿真；或等待 JS 引擎（进行中）就绪后任意浏览器可用。`;
  return { supported, hasWasm, hasGC, ua: typeof navigator !== 'undefined' ? navigator.userAgent : '', tip };
}

/** 检测浏览器是否支持 WebAssembly GC（TeaVM wasmGC 产物必需）——当前逻辑并入 engineDiag() */

let current: EngineBridge = engineDiag().supported ? new WasmEngine() : new JsEngine();

export function setEngineBridge(bridge: EngineBridge): void {
  current = bridge;
}

export function getEngineBridge(): EngineBridge {
  return current;
}

/** 引擎状态标签（顶栏展示）— 仅返回 kind，文案由 UI 本地化 */
export function engineKindLabel(): 'wasm' | 'http' | 'js' | 'none' {
  return current.kind;
}
