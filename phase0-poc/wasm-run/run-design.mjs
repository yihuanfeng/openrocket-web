import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(dir, '..', 'target', 'generated', 'wasm', 'teavm');
const require = createRequire(import.meta.url);
require(path.join(wasmDir, 'classes.wasm-runtime.js'));

const teavm = await TeaVM.wasmGC.load(path.join(wasmDir, 'classes.wasm'), { nodejs: true });
const ex = teavm.instance.exports;
const callStr = (name) => ex['teavm.stringToJs'](ex[name]());

// 1) 内置测试火箭（参照）
console.log('builtin :', callStr('runAnalysisWasm'));

// 2) 单级简化版
ex['designReset']();
ex['designAddComponent'](1.0, 0.07, 0.012, 0.012, 0.0, 1.0, 0,0,0,0,0,0,0,0);
ex['designAddComponent'](2.0, 0.20, 0.012, 0.012, 0.0, 1.0, 0,0,0,0,0,0,0,0);
ex['designAddComponent'](4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.05, 0.03, 0.02, 0.05, 0.0032, 0.0, 0.0);
ex['designAddComponent'](5.0, 0.0, 0.0, 0.0, 0.028, 0.0, 0,0,0,0,0,0,0,0);
console.log('design  :', callStr('designAnalyze'));

// 3) 两级版：stage0 同单级，stage1 加机身+尾锥
ex['designReset']();
ex['designAddComponent'](1.0, 0.07, 0.012, 0.012, 0.0, 1.0, 0,0,0,0,0,0,0,0);
ex['designAddComponent'](2.0, 0.20, 0.012, 0.012, 0.0, 1.0, 0,0,0,0,0,0,0,0);
ex['designAddComponent'](4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 3.0, 0.05, 0.03, 0.02, 0.05, 0.0032, 0.0, 0.0);
ex['designBeginStage']();
ex['designAddComponent'](2.0, 0.15, 0.010, 0.010, 0.0, 1.0, 0,0,0,0,0,0,0,0);
ex['designAddComponent'](3.0, 0.04, 0.010, 0.006, 0.0, 2.0, 0,0,0,0,0,0,0,0);
console.log('2stage :', callStr('designAnalyze'));
