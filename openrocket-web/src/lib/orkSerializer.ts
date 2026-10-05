// .ork 序列化：RocketModel → OpenRocket XML → ZIP 压缩包（与 orkParser 互逆）
// 生成最小有效格式：只写引擎计算的必需字段，官方 OpenRocket 可正常加载。
import JSZip from 'jszip';
import type { RocketComponent, RocketModel } from './types';
import { materialDensity } from './materials';

const XML_DECL = "<?xml version='1.0' encoding='utf-8'?>\n";

/** 轴向偏移序列化：无显式偏移（NaN）= 官方 AFTER 自动接续，不写 <axialoffset> */
function axLine(c: RocketComponent, method: string): string {
  return Number.isFinite(c.axialOffset)
    ? `<axialoffset method="${method}">${numStr(c.axialOffset)}</axialoffset>`
    : '';
}

function numStr(v: number | undefined, fallback = 0): string {
  const x = v !== undefined && Number.isFinite(v) ? v : fallback;
  // 保留足够精度，去掉多余尾零
  return String(Math.round(x * 1e9) / 1e9);
}

function numProp(p: Record<string, string>, key: string, fallback: number): number {
  const v = p[key];
  if (!v) return fallback;
  const m = v.trim().match(/-?\d+(\.\d+)?([eE][+-]?\d+)?/);
  return m ? parseFloat(m[0]) : fallback;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** 通用元数据：材料（标准 <material> 元素）+ 前端扩展属性（surface/deployAlt 存 [meta] 注释，官方可忽略） */
function commonMeta(c: RocketComponent, ind2: string): string[] {
  const p = c.properties ?? {};
  const out: string[] = [];
  const matName = p['material'];
  if (matName) {
    const d = materialDensity(matName);
    if (d) out.push(`${ind2}<material type="bulk" density="${numStr(d)}" name="${esc(matName)}" />`);
    else if ((c as { density?: number }).density) out.push(`${ind2}<material type="bulk" density="${numStr((c as { density?: number }).density)}" name="${esc(matName)}" />`);
  } else if ((c as { density?: number }).density) {
    out.push(`${ind2}<material type="bulk" density="${numStr((c as { density?: number }).density)}" />`);
  }
  const meta: string[] = [];
  if (p['surface']) meta.push(`surface=${p['surface']}`);
  if (p['deployAlt']) meta.push(`deployAlt=${p['deployAlt']}`);
  if (p['motorId']) meta.push(`motorId=${p['motorId']}`);
  if (meta.length) out.push(`${ind2}<comment>[meta] ${meta.join(';')}</comment>`);
  return out;
}

/** 组件 → XML 元素字符串（子组件写入 <subcomponents>） */
function compToXml(c: RocketComponent, depth: number): string {
  const ind = '  '.repeat(depth);
  const ind2 = '  '.repeat(depth + 1);
  const p = c.properties ?? {};
  const lines: string[] = [];

  switch (c.type) {
    case 'stage': {
      lines.push(`${ind}<stage>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Stage')}</name>`);
      lines.push(...commonMeta(c, ind2));
      if (c.children.length > 0) {
        lines.push(`${ind2}<subcomponents>`);
        for (const ch of c.children) {
          const s2 = compToXml(ch, depth + 2);
          if (s2) lines.push(s2);
        }
        lines.push(`${ind2}</subcomponents>`);
      }
      lines.push(`${ind}</stage>`);
      return lines.join('\n');
    }
    case 'nosecone':
      lines.push(`${ind}<nosecone>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Nose cone')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<shape>${esc(c.shape || p.shape || 'ogive')}</shape>`);
      lines.push(`${ind2}<aftradius>${numStr(Number.isFinite(c.aftRadius) ? c.aftRadius : c.radius)}</aftradius>`);
      // aftshoulderradius 让 orkParser 的 radius 兜底读回同一值（前端 radius 语义=后端半径）
      lines.push(`${ind2}<aftshoulderradius>${numStr(Number.isFinite(c.aftRadius) ? c.aftRadius : c.radius)}</aftshoulderradius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.002))}</thickness>`);
      break;
    case 'bodytube':
      lines.push(`${ind}<bodytube>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Body tube')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.0007))}</thickness>`);
      break;
    case 'transition':
      lines.push(`${ind}<transition>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Transition')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<shape>${esc(c.shape || p.shape || 'conical')}</shape>`);
      lines.push(`${ind2}<foreradius>${numStr(c.radius)}</foreradius>`);
      lines.push(`${ind2}<aftradius>${numStr(c.aftRadius)}</aftradius>`);
      // aftshoulderradius 让 orkParser 的 radius 兜底读回前端半径
      lines.push(`${ind2}<aftshoulderradius>${numStr(c.radius)}</aftshoulderradius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.002))}</thickness>`);
      break;
    case 'trapezoidfinset': {
      lines.push(`${ind}<trapezoidfinset>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Fin set')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<instancecount>${Math.round(numProp(p, 'fincount', 3))}</instancecount>`);
      // 轴向位置：absolute（相对父组件 fore，与前端 axialOffset 语义一致，round-trip 保真）
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<position type="absolute">${numStr(c.axialOffset)}</position>`);
      lines.push(`${ind2}<radiusoffset method="surface">0.0</radiusoffset>`);
      lines.push(`${ind2}<angleoffset method="relative">0.0</angleoffset>`);
      lines.push(`${ind2}<rotation>0.0</rotation>`);
      lines.push(`${ind2}<fincount>${Math.round(numProp(p, 'fincount', 3))}</fincount>`);
      lines.push(`${ind2}<rootchord>${numStr(numProp(p, 'rootchord', 0.06))}</rootchord>`);
      lines.push(`${ind2}<tipchord>${numStr(numProp(p, 'tipchord', 0.04))}</tipchord>`);
      // 官方键为 sweeplength；前端 properties 用 sweep（componentFactory/PropertyPanel）
      lines.push(`${ind2}<sweeplength>${numStr(numProp(p, 'sweep', 0))}</sweeplength>`);
      lines.push(`${ind2}<height>${numStr(numProp(p, 'height', 0.05))}</height>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.0032))}</thickness>`);
      lines.push(`${ind2}<cant>0.0</cant>`);
      break;
    }
    case 'parachute':
      lines.push(`${ind}<parachute>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Parachute')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<packedlength>${numStr(numProp(p, 'packedlength', 0.05))}</packedlength>`);
      lines.push(`${ind2}<packedradius>${numStr(numProp(p, 'packedradius', 0.02))}</packedradius>`);
      if (p['deployevent']) lines.push(`${ind2}<deployevent>${esc(p['deployevent'])}</deployevent>`);
      if (p['deployaltitude']) lines.push(`${ind2}<deployaltitude>${esc(p['deployaltitude'])}</deployaltitude>`);
      if (p['deploydelay']) lines.push(`${ind2}<deploydelay>${esc(p['deploydelay'])}</deploydelay>`);
      if (p['cd']) lines.push(`${ind2}<cd>${esc(p['cd'])}</cd>`);
      if (p['diameter']) lines.push(`${ind2}<diameter>${esc(p['diameter'])}</diameter>`);
      if (p['overridemass'] || p['massoverride']) lines.push(`${ind2}<overridemass>${esc(p['overridemass'] || p['massoverride'])}</overridemass>`);
      break;
    case 'launchlug':
      lines.push(`${ind}<launchlug>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Launch lug')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}${axLine(c, 'top')}`);
      break;
    case 'innertube':
      lines.push(`${ind}<innertube>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Inner tube')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<motormount>true</motormount>`);
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      break;
    case 'shockcord':
      lines.push(`${ind}<shockcord>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Shock cord')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<cordlength>${numStr(numProp(p, 'cordlength', 0.2))}</cordlength>`);
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      break;
    case 'streamer':
      lines.push(`${ind}<streamer>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Streamer')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<stripnumber>1</stripnumber>`);
      lines.push(`${ind2}<striplength>${numStr(c.length || 0.3)}</striplength>`);
      lines.push(`${ind2}<stripwidth>0.05</stripwidth>`);
      break;
    case 'masscomponent':
      lines.push(`${ind}<masscomponent>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Mass component')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<mass>${numStr(numProp(p, 'mass', 0.01))}</mass>`);
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      break;
    case 'freeformfinset': {
      lines.push(`${ind}<freeformfinset>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Free-form fin set')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<instancecount>${Math.round(numProp(p, 'fincount', 3))}</instancecount>`);
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<position type="absolute">${numStr(c.axialOffset)}</position>`);
      lines.push(`${ind2}<radiusoffset method="surface">0.0</radiusoffset>`);
      lines.push(`${ind2}<angleoffset method="relative">0.0</angleoffset>`);
      lines.push(`${ind2}<rotation>0.0</rotation>`);
      lines.push(`${ind2}<fincount>${Math.round(numProp(p, 'fincount', 3))}</fincount>`);
      lines.push(`${ind2}<rootchord>${numStr(numProp(p, 'rootchord', 0.06))}</rootchord>`);
      lines.push(`${ind2}<tipchord>${numStr(numProp(p, 'tipchord', 0.04))}</tipchord>`);
      lines.push(`${ind2}<sweeplength>${numStr(numProp(p, 'sweep', 0))}</sweeplength>`);
      lines.push(`${ind2}<height>${numStr(numProp(p, 'height', 0.05))}</height>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.0032))}</thickness>`);
      lines.push(`${ind2}<cant>0.0</cant>`);
      break;
    }
    case 'tubecoupler':
      lines.push(`${ind}<tubecoupler>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Tube coupler')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.0007))}</thickness>`);
      break;
    case 'bulkhead':
      lines.push(`${ind}<bulkhead>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Bulkhead')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.003))}</thickness>`);
      break;
    case 'centeringring':
      lines.push(`${ind}<centeringring>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Centering ring')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.003))}</thickness>`);
      break;
    case 'engineblock':
      lines.push(`${ind}<engineblock>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Engine block')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<length>${numStr(c.length)}</length>`);
      lines.push(`${ind2}<radius>${numStr(c.radius)}</radius>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.005))}</thickness>`);
      break;
    case 'ellipticalfinset': {
      lines.push(`${ind}<ellipticalfinset>`);
      lines.push(`${ind2}<name>${esc(c.name || 'Elliptical fin set')}</name>`);
      lines.push(...commonMeta(c, ind2));
      lines.push(`${ind2}<instancecount>${Math.round(numProp(p, 'fincount', 3))}</instancecount>`);
      lines.push(`${ind2}${axLine(c, 'absolute')}`);
      lines.push(`${ind2}<position type="absolute">${numStr(c.axialOffset)}</position>`);
      lines.push(`${ind2}<radiusoffset method="surface">0.0</radiusoffset>`);
      lines.push(`${ind2}<angleoffset method="relative">0.0</angleoffset>`);
      lines.push(`${ind2}<rotation>0.0</rotation>`);
      lines.push(`${ind2}<fincount>${Math.round(numProp(p, 'fincount', 3))}</fincount>`);
      lines.push(`${ind2}<length>${numStr(numProp(p, 'rootchord', 0.06))}</length>`);
      lines.push(`${ind2}<height>${numStr(numProp(p, 'height', 0.05))}</height>`);
      lines.push(`${ind2}<thickness>${numStr(numProp(p, 'thickness', 0.0032))}</thickness>`);
      lines.push(`${ind2}<cant>0.0</cant>`);
      break;
    }
    default:
      // 未知类型：跳过（序列化器不写不支持的组件）
      return '';
  }

  // 子组件（尾翼挂件等）
  if (c.children.length > 0) {
    lines.push(`${ind2}<subcomponents>`);
    for (const ch of c.children) {
      const s = compToXml(ch, depth + 2);
      if (s) lines.push(s);
    }
    lines.push(`${ind2}</subcomponents>`);
  }
  lines.push(`${ind}</${c.type}>`);
  return lines.join('\n');
}

/** 飞行配置与自定义发动机（Web 扩展，存于 XML 注释，官方 OpenRocket 可忽略） */
export interface OrkWebMeta {
  configs?: { id: string; name: string; mounts: { path: string; motorId: string | null; ignitionDelay: number }[] }[];
  customMotors?: import('./engines').MotorSpec[];
}

/** RocketModel → OpenRocket XML 文本（meta 序列化为 XML 注释，避免官方解析器报错） */
export function modelToOrkXml(model: RocketModel, meta?: OrkWebMeta): string {
  const out: string[] = [XML_DECL];
  out.push(`<openrocket version="1.3" creator="OpenRocket Web">`);
  out.push(`  <rocket>`);
  out.push(`    <name>${esc(model.name || 'Rocket')}</name>`);
  out.push(`    <axialoffset method="absolute">0.0</axialoffset>`);
  out.push(`    <position type="absolute">0.0</position>`);
  out.push(`    <referencetype>maximum</referencetype>`);
  out.push(`    <subcomponents>`);
  for (const child of model.root.children ?? []) {
    if (child.type !== 'stage') continue; // 只序列化 stage 结构
    const s = compToXml(child, 3);
    if (s) out.push(s);
  }
  out.push(`    </subcomponents>`);
  out.push(`  </rocket>`);
  if (meta && (meta.configs?.length || meta.customMotors?.length)) {
    // 注释内禁止出现连字符对 `--`：JSON 字符串中转义为 \u002d（JSON.parse 自动还原）
    const json = JSON.stringify(meta).replace(/--/g, '\\u002d\\u002d');
    out.push(`<!--ork-web:${json}-->`);
  }
  out.push(`</openrocket>`);
  return out.join('\n');
}

/** RocketModel → .ork 文件字节（ZIP 压缩包，内含 rocket.ork） */
export async function modelToOrkBlob(model: RocketModel, meta?: OrkWebMeta): Promise<Blob> {
  const xml = modelToOrkXml(model, meta);
  const zip = new JSZip();
  zip.file('rocket.ork', xml);
  return await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** 从 OpenRocket XML 文本提取 Web 扩展 meta（无则返回 null） */
export function parseOrkWebMeta(xml: string): OrkWebMeta | null {
  const m = xml.match(/<!--ork-web:(.*?)-->/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as OrkWebMeta;
  } catch {
    return null;
  }
}
