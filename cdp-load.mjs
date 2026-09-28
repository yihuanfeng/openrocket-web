const pages = await (await fetch('http://localhost:9223/json')).json();
const page = pages.find((p) => p.url.includes('localhost:4173'));
if (!page) { console.error('page not found'); process.exit(1); }
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
// 选择两级火箭示例
console.log(await evalJs(`(() => {
  const sel = document.querySelector('select.preset');
  if (!sel) return 'no select';
  // 触发 Vue change
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, '两级火箭（仿真暂不支持多级）');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return 'selected: ' + sel.value;
})()`));
await new Promise((r) => setTimeout(r, 1200));
// 检查树内容
console.log('树:', await evalJs(`[...document.querySelectorAll('.tree .row')].map(r=>r.textContent.trim().replace(/\\s+/g,' ')).join(' | ')`));
// 截图由 Chrome --screenshot 处理，这里先确认 2D canvas 存在
console.log('canvas 数量:', await evalJs(`document.querySelectorAll('canvas').length`));
ws.close();
process.exit(0);
