import { writeFileSync } from "fs";
const pages = await (await fetch('http://localhost:9224/json')).json();
const page = pages.find((p) => p.url.includes('localhost:4173'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2500));
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || 'unknown'));
  return r.result?.value;
}
const shot = async (f) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(f, Buffer.from(r.data, 'base64'));
};
// 切两级火箭 + 3D 视图
await evalJs(`(() => {
  const setV = (sel, v) => { const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(sel, v); sel.dispatchEvent(new Event('change', { bubbles: true })); };
  setV(document.querySelector('select.preset'), '两级火箭（仿真暂不支持多级）');
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 1000));
await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='3D视图'); if(b){b.click(); return 'clicked 3D';} return 'no btn'; })()`);
await new Promise((r) => setTimeout(r, 1200));
console.log('canvas:', await evalJs(`document.querySelectorAll('canvas').length`));
await shot('/tmp/3d-two.png');
console.log('两级 3D 已截图');
// 切回入门小火箭 3D
await evalJs(`(() => {
  const setV = (sel, v) => { const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(sel, v); sel.dispatchEvent(new Event('change', { bubbles: true })); };
  setV(document.querySelector('select.preset'), '入门小火箭（Estes 风格）');
  return 'ok';
})()`);
await new Promise((r) => setTimeout(r, 1000));
await shot('/tmp/3d-basic.png');
console.log('入门小火箭 3D 已截图');
ws.close();
process.exit(0);
