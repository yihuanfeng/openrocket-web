// WASM 引擎桥：加载 phase0-poc（TeaVM）编译产物，把 RocketModel 翻译为 design 动作序列。
// 依赖浏览器 WebAssembly GC（engine.ts 静态检测不支持时自动降级 JS 引擎）。
import type { EngineAnalysis, FlightProfile, RocketModel } from './types';
import type { EngineBridge } from './engine';
import { modelToDesignActions, skippedComponentTypes } from './designSerializer';

interface TeavmInstance {
  instance: { exports: Record<string, unknown> };
}
let wasmPromise: Promise<TeavmInstance> | null = null;
async function ensureWasm(): Promise<TeavmInstance> {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      // TeaVM 运行时（classes.wasm-runtime.js）为 IIFE：执行后注入 globalThis.TeaVM.wasmGC
      const base = import.meta.env.BASE_URL;
      const rtRes = await fetch(`${base}wasm/classes.wasm-runtime.js`);
      if (!rtRes.ok) throw new Error(`TeaVM 运行时加载失败（${rtRes.status}）`);
      const rtText = await rtRes.text();
      // 动态执行自己产物的静态加载器（不在 CSP 受限环境）；加载 wasm 并返回实例
      const loader = new Function(rtText);
      loader();
      const T = (globalThis as unknown as {
        TeaVM?: { wasmGC?: { load: (url: string, opts: unknown) => Promise<TeavmInstance> } };
      }).TeaVM;
      if (!T?.wasmGC) throw new Error('TeaVM 全局未注入（wasmGC 缺失）');
      return await T.wasmGC.load(`${import.meta.env.BASE_URL}wasm/classes.wasm`, {});
    })();
  }
  return wasmPromise;
}

export class WasmEngine implements EngineBridge {
  readonly kind = 'wasm' as const;

  async analyze(model: RocketModel): Promise<EngineAnalysis> {
    try {
      const teavm = await ensureWasm();
      const ex = teavm.instance.exports;
      const actions = modelToDesignActions(model);
      if (actions.length === 0) {
        return {
          mass: null, cgX: null, cpX: null, stability: null,
          source: 'wasm',
          detail: '设计中没有可计算的组件（仅支持 头锥/机身/过渡段/梯形尾翼/降落伞/发射耳/发动机架管）',
        };
      }
      const add = ex['designAddComponent'] as (...a: number[]) => unknown;
      const analyze = ex['designAnalyze'] as () => unknown;
      const beginStage = ex['designBeginStage'] as (() => unknown) | undefined;
      if (typeof add !== 'function' || typeof analyze !== 'function') {
        throw new Error('WASM 设计接口导出缺失（需重新编译 phase0-poc）');
      }
      (ex['designReset'] as () => unknown)();
      for (const a of actions) {
        if (a.action === 'beginStage') {
          if (typeof beginStage === 'function') (beginStage as () => unknown)();
          continue;
        }
        const p = a.p;
        add(p.type, p.length, p.radius, p.aftRadius, p.axialOffset, p.shape,
          p.c[0], p.c[1], p.c[2], p.c[3], p.c[4], p.c[5], p.c[6], p.c[7], p.density ?? 0);
      }
      const javaStr = analyze();
      const toJs = ex['teavm.stringToJs'] as (s: object) => string;
      const data = JSON.parse(toJs(javaStr as object)) as {
        mass?: number; cgX?: number; cpX?: number; stability?: number; length?: number;
        components?: number; error?: string;
      };
      if (data.error) {
        return {
          mass: null, cgX: null, cpX: null, stability: null,
          source: 'wasm',
          detail: `WASM 引擎报错：${data.error}`,
        };
      }
      const skipped = skippedComponentTypes(model);
      const skippedNote = skipped.length > 0 ? `；未参与计算的组件类型：${skipped.join('、')}` : '';
      return {
        mass: data.mass ?? null,
        cgX: data.cgX ?? null,
        cpX: data.cpX ?? null,
        stability: data.stability ?? null,
        source: 'wasm',
        detail: `口径：WASM（TeaVM）内由 OpenRocket core 按本文件 ${data.components ?? 0} 个组件构造火箭并计算，稳定性 = (CP−CG)/箭长。${skippedNote}`,
      };
    } catch (e) {
      return {
        mass: null, cgX: null, cpX: null, stability: null,
        source: 'wasm',
        detail: `引擎调用失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
  /** 对当前设计跑仿真（阶段 3）：designSimulate → 摘要 + 飞行剖面；WASM 为单电机内置实现，忽略多发动机参数 */
  async simulate(model: RocketModel, _motors?: import('./jsEngine').MountedMotor[], _cond?: import('./types').SimConditions): Promise<FlightProfile | null> {
    try {
      const teavm = await ensureWasm();
      const ex = teavm.instance.exports;
      const actions = modelToDesignActions(model);
      if (actions.length === 0) return null;
      const sim = ex['designSimulate'] as () => unknown;
      if (typeof sim !== 'function') {
        throw new Error('WASM 仿真接口导出缺失（需重新编译 phase0-poc）');
      }
      const add = ex['designAddComponent'] as (...a: number[]) => unknown;
      const beginStage = ex['designBeginStage'] as (() => unknown) | undefined;
      (ex['designReset'] as () => unknown)();
      for (const a of actions) {
        if (a.action === 'beginStage') {
          if (typeof beginStage === 'function') (beginStage as () => unknown)();
          continue;
        }
        const p = a.p;
        add(p.type, p.length, p.radius, p.aftRadius, p.axialOffset, p.shape,
          p.c[0], p.c[1], p.c[2], p.c[3], p.c[4], p.c[5], p.c[6], p.c[7], p.density ?? 0);
      }
      const javaStr = sim();
      const toJs = ex['teavm.stringToJs'] as (s: object) => string;
      const data = JSON.parse(toJs(javaStr as object)) as FlightProfile & { error?: string };
      if (data.error) {
        throw new Error(data.error);
      }
      return data;
    } catch (e) {
      console.error('仿真失败：', e);
      return null;
    }
  }

  /** P1-6：WASM 引擎（WebAssembly GC 实验通道）暂不实现延迟扫描，抛错由上层捕获 */
  async optimizeDelay(): Promise<import('./types').DelayScanResult> {
    throw new Error('WASM 引擎暂不支持延迟优化扫描（请使用 JS 计算引擎）');
  }
}
