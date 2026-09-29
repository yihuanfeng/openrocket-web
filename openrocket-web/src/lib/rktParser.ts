// Rocksim .rkt 文件解析/导出：英制（英寸/盎司）→ 内部 SI（米/千克），组件映射到本地 16 种
import type { RocketComponent, RocketModel } from './types';

// —— 轻量 XML（浏览器与 node 通用；Rocksim 结构简单，无命名空间/CDATA 场景）——
interface XmlNode { tag: string; attrs: Record<string, string>; children: XmlNode[]; }

function parseXml(text: string): XmlNode {
  const nodes: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const re = /<(\/?)\s*([\w.-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const close = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrsRaw = m[3];
    const selfClose = m[4] === '/';
    if (close) {
      if (stack.length) stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    const ar = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
    let am: RegExpExecArray | null;
    while ((am = ar.exec(attrsRaw))) attrs[am[1].toLowerCase()] = am[2];
    const node: XmlNode = { tag, attrs, children: [] };
    if (stack.length) stack[stack.length - 1].children.push(node);
    else nodes.push(node);
    if (!selfClose) stack.push(node);
  }
  return nodes[0] ?? { tag: 'rocket', attrs: {}, children: [] };
}

// —— 单位换算 ——
const IN_TO_M = 0.0254;
const OZ_TO_KG = 0.028349523125;
function nf(raw: string | undefined): number {
  if (!raw) return NaN;
  const v = parseFloat(raw);
  return isNaN(v) ? NaN : v;
}
function lenIn(v: number): number { return v * IN_TO_M; } // 英寸 → 米
function lenM(v: number): string { return (v / IN_TO_M).toFixed(4); } // 米 → 英寸
function massKg(v: number): string { return (v / OZ_TO_KG).toFixed(3); } // 千克 → 盎司

const SHAPE_MAP: Record<string, string> = {
  ogive: 'ogive', conical: 'conical', parabolic: 'parabolic', power: 'power', haack: 'haack',
  'power series': 'power', 'von karman': 'ogive', ellipsoid: 'power',
};

function base(type: string, name: string): RocketComponent {
  return { type, name, children: [], properties: {}, length: 0, radius: 0, aftRadius: 0, axialOffset: 0, shape: '' };
}

function mapShape(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  return SHAPE_MAP[raw.trim().toLowerCase()] ?? fallback;
}

function mapComponent(node: XmlNode): RocketComponent | null {
  const name = node.attrs['name'] ?? node.tag;
  switch (node.tag) {
    case 'nosecone': {
      const c = base('nosecone', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      c.shape = mapShape(node.attrs['shape'], 'ogive');
      const sl = nf(node.attrs['shoulderlength']);
      const sr = nf(node.attrs['shoulderdiameter']);
      if (sl > 0) c.properties['shoulderlength'] = String(lenIn(sl));
      if (sr > 0) c.properties['shoulderradius'] = String(lenIn(sr) / 2);
      const wt = nf(node.attrs['wallthickness']);
      if (wt > 0) c.properties['wallthickness'] = String(lenIn(wt));
      return c;
    }
    case 'bodytube': {
      const c = base('bodytube', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      const wt = nf(node.attrs['wallthickness']);
      if (wt > 0) c.properties['wallthickness'] = String(lenIn(wt));
      return c;
    }
    case 'transition': {
      const c = base('transition', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['forediameter'])) / 2;
      c.aftRadius = lenIn(nf(node.attrs['aftdiameter'])) / 2;
      c.shape = mapShape(node.attrs['shape'], 'conical');
      return c;
    }
    case 'finset': {
      const c = base('trapezoidfinset', name);
      const setNum = (k: string, v: number) => { if (Number.isFinite(v)) c.properties[k] = String(v); };
      setNum('fincount', nf(node.attrs['fincount']) || 3);
      setNum('rootchord', lenIn(nf(node.attrs['rootchord'])));
      setNum('tipchord', lenIn(nf(node.attrs['tipchord'])));
      setNum('sweep', lenIn(nf(node.attrs['sweep'])));
      setNum('height', lenIn(nf(node.attrs['height'])));
      setNum('thickness', lenIn(nf(node.attrs['thickness'])));
      setNum('offset', lenIn(nf(node.attrs['position'])));
      const cant = nf(node.attrs['cant']);
      if (cant > 0) c.properties['cant'] = String(cant);
      return c;
    }
    case 'parachute': {
      const c = base('parachute', name);
      const d = nf(node.attrs['diameter']);
      if (d > 0) c.properties['diameter'] = String(lenIn(d));
      const cd = nf(node.attrs['dragcoefficient']);
      if (cd > 0) c.properties['cd'] = String(cd);
      const da = nf(node.attrs['deployaltitude']);
      if (da > 0) c.properties['deployAlt'] = String(lenIn(da));
      return c;
    }
    case 'streamer': {
      const c = base('streamer', name);
      const l = nf(node.attrs['length']);
      if (l > 0) c.length = lenIn(l);
      const w = nf(node.attrs['width']);
      if (w > 0) c.properties['width'] = String(lenIn(w));
      const cd = nf(node.attrs['dragcoefficient']);
      if (cd > 0) c.properties['cd'] = String(cd);
      return c;
    }
    case 'shockcord': {
      const c = base('shockcord', name);
      const l = nf(node.attrs['length']);
      if (l > 0) c.properties['cordlength'] = String(lenIn(l));
      return c;
    }
    case 'massobject': {
      const c = base('masscomponent', name);
      const mass = nf(node.attrs['mass']);
      if (mass > 0) c.properties['mass'] = String(mass * OZ_TO_KG);
      return c;
    }
    case 'launchlug': {
      const c = base('launchlug', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    case 'innertube': {
      const c = base('innertube', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      const wt = nf(node.attrs['wallthickness']);
      if (wt > 0) c.properties['wallthickness'] = String(lenIn(wt));
      return c;
    }
    case 'tubecoupler': {
      const c = base('tubecoupler', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    case 'bulkhead': {
      const c = base('bulkhead', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    case 'centeringring': {
      const c = base('centeringring', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    case 'engineblock': {
      const c = base('engineblock', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    case 'enginemount': {
      const c = base('innertube', name);
      c.length = lenIn(nf(node.attrs['length']));
      c.radius = lenIn(nf(node.attrs['diameter'])) / 2;
      return c;
    }
    default:
      return null;
  }
}

function parseChildren(node: XmlNode, parent: RocketComponent): void {
  for (const child of node.children) {
    if (child.tag === 'stage') {
      const stage = base('stage', child.attrs['name'] ?? 'Stage');
      parseChildren(child, stage);
      parent.children.push(stage);
      continue;
    }
    if (child.tag === 'subcomponents') {
      parseChildren(child, parent);
      continue;
    }
    const m = mapComponent(child);
    if (m) parent.children.push(m);
  }
}

export function parseRkt(text: string): RocketModel {
  const root = parseXml(text);
  const rocket: RocketComponent = base('rocket', root.attrs['name'] ?? 'Rocksim Rocket');
  parseChildren(root, rocket);
  if (rocket.children.length === 0) throw new Error('未解析到任何组件，文件可能不是有效的 Rocksim .rkt');
  return {
    formatVersion: '1.3',
    creator: 'Rocksim import',
    name: root.attrs['name'] ?? 'Rocksim Rocket',
    referenceType: 'launchrod',
    root: rocket,
  };
}

// —— 导出：本地模型 → Rocksim XML（英寸/盎司）——
const SHAPE_REV: Record<string, string> = { ogive: 'Ogive', conical: 'Conical', parabolic: 'Parabolic', power: 'Power Series', haack: 'Von Karman' };

export function modelToRkt(model: RocketModel): string {
  const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const attrsOf = (c: RocketComponent, extra: Record<string, string>): string => {
    const a: Record<string, string> = { Name: esc(c.name), ...extra };
    return Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ');
  };
  const compXml = (c: RocketComponent): string => {
    switch (c.type) {
      case 'nosecone':
        return `<NoseCone ${attrsOf(c, {
          Length: lenM(c.length), Diameter: lenM(c.radius * 2), Shape: SHAPE_REV[c.shape] ?? 'Ogive',
          ...(c.properties['shoulderlength'] ? { ShoulderLength: lenM(parseFloat(c.properties['shoulderlength'])) } : {}),
          ...(c.properties['shoulderradius'] ? { ShoulderDiameter: lenM(parseFloat(c.properties['shoulderradius']) * 2) } : {}),
          ...(c.properties['wallthickness'] ? { WallThickness: lenM(parseFloat(c.properties['wallthickness'])) } : {}),
        })} />`;
      case 'bodytube':
        return `<BodyTube ${attrsOf(c, {
          Length: lenM(c.length), Diameter: lenM(c.radius * 2),
          ...(c.properties['wallthickness'] ? { WallThickness: lenM(parseFloat(c.properties['wallthickness'])) } : {}),
        })} />`;
      case 'transition':
        return `<Transition ${attrsOf(c, {
          Length: lenM(c.length), ForeDiameter: lenM(c.radius * 2), AftDiameter: lenM(c.aftRadius * 2),
          Shape: SHAPE_REV[c.shape] ?? 'Conical',
        })} />`;
      case 'trapezoidfinset':
      case 'ellipticalfinset':
      case 'freeformfinset':
        return `<FinSet ${attrsOf(c, {
          FinCount: c.properties['fincount'] ?? '3',
          RootChord: lenM(parseFloat(c.properties['rootchord'] ?? '0.05')),
          TipChord: lenM(parseFloat(c.properties['tipchord'] ?? (c.properties['rootchord'] ?? '0.05'))),
          Sweep: lenM(parseFloat(c.properties['sweep'] ?? '0')),
          Height: lenM(parseFloat(c.properties['height'] ?? '0.05')),
          Thickness: lenM(parseFloat(c.properties['thickness'] ?? '0.0032')),
          ...(c.properties['cant'] ? { Cant: c.properties['cant'] } : {}),
          ...(c.properties['offset'] ? { Position: lenM(parseFloat(c.properties['offset'])) } : {}),
        })} />`;
      case 'parachute':
        return `<Parachute ${attrsOf(c, {
          ...(c.properties['diameter'] ? { Diameter: lenM(parseFloat(c.properties['diameter'])) } : { Diameter: '12' }),
          ...(c.properties['cd'] ? { DragCoefficient: c.properties['cd'] } : {}),
          ...(c.properties['deployAlt'] ? { DeployAltitude: lenM(parseFloat(c.properties['deployAlt'])) } : {}),
        })} />`;
      case 'streamer':
        return `<Streamer ${attrsOf(c, {
          Length: lenM(c.length || parseFloat(c.properties['length'] ?? '0.3')),
          ...(c.properties['width'] ? { Width: lenM(parseFloat(c.properties['width'])) } : {}),
          ...(c.properties['cd'] ? { DragCoefficient: c.properties['cd'] } : {}),
        })} />`;
      case 'shockcord':
        return `<ShockCord ${attrsOf(c, { Length: lenM(parseFloat(c.properties['cordlength'] ?? '0.5')) })} />`;
      case 'masscomponent':
        return `<MassObject ${attrsOf(c, { Mass: massKg(parseFloat(c.properties['mass'] ?? '0.05')) })} />`;
      case 'launchlug':
        return `<LaunchLug ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      case 'innertube':
        return `<InnerTube ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      case 'tubecoupler':
        return `<TubeCoupler ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      case 'bulkhead':
        return `<Bulkhead ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      case 'centeringring':
        return `<CenteringRing ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      case 'engineblock':
        return `<EngineBlock ${attrsOf(c, { Length: lenM(c.length), Diameter: lenM(c.radius * 2) })} />`;
      default:
        return '';
    }
  };
  const stageXml = (s: RocketComponent): string =>
    `<Stage Name="${esc(s.name)}"><Subcomponents>\n${s.children.map(compXml).join('\n')}\n</Subcomponents></Stage>`;
  const body = model.root.children.filter((c) => c.type === 'stage').map(stageXml).join('\n');
  return `<Rocket Name="${esc(model.name)}" Version="1.5" Units="inches">\n<Subcomponents>\n${body}\n</Subcomponents>\n</Rocket>`;
}
