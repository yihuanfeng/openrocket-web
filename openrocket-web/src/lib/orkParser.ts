// .ork 文件解析：ZIP/gzip/纯 XML 识别 → XML 解析 → 组件树模型
import JSZip from 'jszip';
import type { RocketComponent, RocketModel } from './types';

/** 从 XML 文本节点中取数值，兼容 "auto 0.033528"、"0.254" 等格式 */
function parseNum(raw: string | null | undefined): number {
  if (!raw) return NaN;
  const m = raw.trim().match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function textOf(el: Element, tag: string): string | null {
  const child = el.getElementsByTagName(tag)[0];
  if (!child) return null;
  const text = child.textContent;
  return text === null ? null : text.trim();
}

function numOf(el: Element, tag: string): number {
  return parseNum(textOf(el, tag));
}

/** 递归解析 <subcomponents> 下的组件节点 */
function parseChildren(parentEl: Element, parent: RocketComponent): void {
  const sub = parentEl.getElementsByTagName('subcomponents')[0];
  if (!sub) return;
  for (const el of Array.from(sub.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'stage') {
      const stage: RocketComponent = {
        type: 'stage',
        name: textOf(el, 'name') ?? 'Stage',
        children: [],
        properties: collectProps(el),
        length: 0,
        radius: NaN,
        aftRadius: NaN,
        axialOffset: 0,
        shape: '',
      };
      parseChildren(el, stage);
      parent.children.push(stage);
      continue;
    }
    // 材料密度（kg/m³）：只取 bulk 型（体积×密度=质量）；surface/line 型不用于质量近似
    let density = 0;
    const matEl = el.getElementsByTagName('material')[0];
    if (matEl && matEl.getAttribute('type') === 'bulk') {
      const d = parseFloat(matEl.getAttribute('density') ?? '');
      if (Number.isFinite(d) && d > 0) density = d;
    }
    // 前端扩展属性（material 名称 / [meta] 注释：surface、deployAlt）
    const comment = textOf(el, 'comment');
    const metaProps: Record<string, string> = {};
    if (matEl && matEl.getAttribute('name')) metaProps['material'] = matEl.getAttribute('name') as string;
    if (comment && comment.includes('[meta]')) {
      const metaBody = comment.split('[meta]')[1] ?? '';
      for (const kv of metaBody.split(';')) {
        const eq = kv.indexOf('=');
        if (eq > 0) metaProps[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
      }
    }
    const comp: RocketComponent = {
      type: tag,
      name: textOf(el, 'name') ?? tag,
      children: [],
      properties: { ...collectProps(el), ...metaProps },
      length: numOf(el, 'length'),
      radius: numOf(el, 'radius'),
      aftRadius: numOf(el, 'aftradius'),
      axialOffset: numOf(el, 'axialoffset'),
      shape: textOf(el, 'shape') ?? '',
      density,
    };
    // 半径语义（对齐 OpenRocket 几何）：
    //  - nosecone：尖端 fore=0，基部 aft=aftradius（xml 无 radius 字段）
    //  - transition：fore=foreradius、aft=aftradius（xml 无 radius 字段）
    //  - bodytube 等：radius=aftRadius=radius
    if (tag === 'nosecone') {
      if (isNaN(comp.aftRadius)) comp.aftRadius = comp.radius;
      comp.radius = 0; // 尖端
    } else if (tag === 'transition') {
      const fore = numOf(el, 'foreradius');
      if (!isNaN(fore)) comp.radius = fore;
      if (isNaN(comp.aftRadius)) comp.aftRadius = comp.radius;
    } else {
      if (isNaN(comp.radius)) comp.radius = numOf(el, 'aftshoulderradius');
      if (isNaN(comp.aftRadius)) comp.aftRadius = comp.radius;
    }
    // 官方尾翼键为 sweeplength；前端统一用 sweep（designSerializer/PropertyPanel 读取）
    if ((tag === 'trapezoidfinset' || tag === 'freeformfinset') && comp.properties.sweeplength !== undefined && comp.properties.sweep === undefined) {
      comp.properties.sweep = comp.properties.sweeplength;
      delete comp.properties.sweeplength;
    }
    parseChildren(el, comp);
    parent.children.push(comp);
  }
}

/** 收集组件下其余单值子元素为原始属性（name → text） */
function collectProps(el: Element): Record<string, string> {
  const props: Record<string, string> = {};
  for (const child of Array.from(el.children)) {
    const tag = child.tagName.toLowerCase();
    if (['subcomponents', 'name'].includes(tag)) continue;
    const text = child.textContent?.trim();
    if (text) props[tag] = text;
  }
  return props;
}

/** 解压 .ork 字节，返回其中的 XML 文本 */
async function decompressToXml(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  // ZIP 签名 PK\x03\x04
  if (bytes.length > 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => n.endsWith('.ork') || n.endsWith('.xml'));
    if (names.length === 0) throw new Error('ZIP 内未找到 rocket.ork');
    return await zip.files[names[0]].async('string');
  }
  // gzip 签名 1f 8b（浏览器 DecompressionStream）
  if (bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  // 纯文本 XML
  return new TextDecoder('utf-8').decode(bytes);
}

/** 解析 .ork 文件字节为火箭模型 */
export async function parseOrk(buffer: ArrayBuffer): Promise<RocketModel> {
  const xml = await decompressToXml(buffer);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const rootEl = doc.documentElement;
  if (rootEl.tagName.toLowerCase() !== 'openrocket') {
    throw new Error('不是有效的 OpenRocket 文件（缺少 <openrocket> 根节点）');
  }
  const rocketEl = rootEl.getElementsByTagName('rocket')[0];
  if (!rocketEl) throw new Error('文件中缺少 <rocket> 节点');

  const root: RocketComponent = {
    type: 'rocket',
    name: textOf(rocketEl, 'name') ?? 'Rocket',
    children: [],
    properties: collectProps(rocketEl),
    length: 0,
    radius: NaN,
    aftRadius: NaN,
    axialOffset: 0,
    shape: '',
  };
  parseChildren(rocketEl, root);

  const model: RocketModel = {
    formatVersion: rootEl.getAttribute('version') ?? '',
    creator: rootEl.getAttribute('creator') ?? '',
    name: root.name,
    referenceType: textOf(rocketEl, 'referencetype') ?? '',
    root,
  };
  return model;
}

/** 递归遍历所有组件 */
export function walkComponents(root: RocketComponent, visit: (c: RocketComponent, depth: number) => void): void {
  const walk = (c: RocketComponent, depth: number) => {
    visit(c, depth);
    for (const ch of c.children) walk(ch, depth + 1);
  };
  walk(root, 0);
}
