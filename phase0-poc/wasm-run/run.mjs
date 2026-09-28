import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const dir = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(dir, '..', 'target', 'generated', 'wasm', 'teavm');
const require = createRequire(import.meta.url);
require(path.join(wasmDir, 'classes.wasm-runtime.js'));

const TeaVM = globalThis.TeaVM;
const teavm = await TeaVM.wasmGC.load(path.join(wasmDir, 'classes.wasm'), { nodejs: true });
const fn = teavm.instance.exports['runAnalysisWasm'];
const result = fn();
const jsStr = teavm.instance.exports['teavm.stringToJs'](result);
console.log(jsStr);
