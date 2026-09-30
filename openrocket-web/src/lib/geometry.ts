// 统一火箭几何布局：把组件树转成带绝对轴向位置 z0/z1 与半径 r0/r1 的段列表，
// 严格遵循 OpenRocket 轴向定位语义（position 相对父组件鼻端）：
//   TOP/ABSOLUTE : position = offset
//   AFTER(自动)  : position = outerLen + offset     （无 <axialoffset> 元素）
//   MIDDLE       : position = offset + (outerLen - innerLen) / 2
//   BOTTOM       : position = offset + (outerLen - innerLen)
// 2D 侧视图与 3D 投影共用本模块，保证两种视图几何一致。
import type { RocketComponent } from './types';

export interface GeoSeg {
  kind: string;
  name: string;
  comp: RocketComponent;
  /** 轴向范围（米），0 = 鼻尖，向尾部递增 */
  z0: number;
  z1: number;
  /** 前/后半径（米），已做半径继承 */
  r0: number;
  r1: number;
  /** 父组件轴向范围（供悬停/定位参考） */
  parentZ0: number;
  parentLen: number;
  /** 层级：0 = stage 直系（外形），1 = 子组件（内部件/挂件/尾翼） */
  depth: number;
}

export function isPos(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function propPos(c: RocketComponent, k: string): number {
  const v = parseFloat(c.properties?.[k] ?? '');
  return Number.isFinite(v) && v > 0 ? v : NaN;
}

/** 组件轴向长度（米）：
 *  - 尾翼 = rootchord（缺省 0.05）
 *  - 伞/飘带 = packedlength（缺省 0.03）
 *  - 其余 = length（NaN/负 → 0，挂件 shockcord/masscomponent 无物理长度） */
export function lenOf(c: RocketComponent): number {
  if (c.type.includes('fin')) {
    return isPos(c.length) ? c.length : propPos(c, 'rootchord') || 0.05;
  }
  if (c.type === 'parachute' || c.type === 'streamer') {
    return propPos(c, 'packedlength') || 0.03;
  }
  const l = c.length;
  return isNaN(l) ? 0 : Math.max(0, l);
}

/** 组件有效半径（米）：
 *  - nosecone 基部 = aftradius（尖端 0）
 *  - parachute/streamer = packedradius
 *  - 其余 radius/aftradius 无效时继承父半径（内部件/尾翼挂在父管上） */
export function radiusOf(c: RocketComponent, parentR: number): number {
  if (c.type === 'parachute' || c.type === 'streamer') {
    return propPos(c, 'packedradius') || parentR || 0.009;
  }
  // 管翼：自动半径按官方 TubeFinSet 相切公式；显式 radius 优先
  if (c.type === 'tubefinset') {
    const explicit = propPos(c, 'radius');
    if (isPos(explicit)) return explicit;
    const n = Math.max(parseInt((c.properties?.['fincount'] ?? '6'), 10) || 6, 1);
    if (n >= 3) {
      const s = Math.sin(Math.PI / n);
      return isPos(parentR * s / (1 - s)) ? (parentR * s) / (1 - s) : parentR;
    }
    return parentR;
  }
  let r = c.radius;
  if (c.type === 'nosecone') {
    r = c.aftRadius;
  } else if (!isPos(r)) {
    r = c.aftRadius;
  }
  if (!isPos(r)) r = parentR;
  return isPos(r) ? r : 0;
}

/** OpenRocket 轴向定位：返回组件前端相对父组件鼻端的 position（米） */
export function axialPos(c: RocketComponent, innerLen: number, outerLen: number): number {
  const off = isNaN(c.axialOffset) ? 0 : c.axialOffset;
  const m = c.axialMethod ?? '';
  switch (m) {
    case 'bottom':
      return off + (outerLen - innerLen);
    case 'middle':
      return off + (outerLen - innerLen) / 2;
    case 'after':
      return outerLen + off;
    case 'top':
    case 'absolute':
    default:
      // top/absolute：相对父鼻端；未知 method 按 top 处理（官方默认值 0）
      return off;
  }
}

/** 外形身体类组件（其半径可作为后续无半径组件的安装面，如尾翼/导环） */
function isBodyKind(t: string): boolean {
  return t === 'bodytube' || t === 'nosecone' || t === 'transition';
}

/** 把组件树展开为带绝对位置的段列表（z=0 鼻尖，向尾部递增） */
export function layoutRocket(root: RocketComponent): GeoSeg[] {
  const segs: GeoSeg[] = [];
  let base = 0; // 上级 stage 尾端（多级首尾相连）
  for (const stage of root.children) {
    if (stage.type !== 'stage') continue;
    // stage 自身轴向位置：无 offset = AFTER 接续在上级尾端；有 offset 按父=rocket(outerLen=已用 base) 计算
    let sBase: number;
    if (isNaN(stage.axialOffset)) {
      sBase = base;
    } else {
      sBase = base + axialPos(stage, 0, base);
    }
    // stage 全长估计：AFTER 直系子组件接续长度（供 TOP/MIDDLE/BOTTOM 引用 outerLen）
    let estLen = 0;
    for (const c of stage.children) {
      if (isNaN(c.axialOffset)) estLen += lenOf(c);
    }
    let cursor = sBase;
    // 前面最近的身体组件半径：无显式半径的挂件（尾翼/导环/伞）安装在其表面（官方 Finset 半径继承）
    let prevBodyR = 0;
    for (const c of stage.children) {
      const len = lenOf(c);
      let pos: number;
      if (isNaN(c.axialOffset)) {
        pos = cursor - sBase; // AFTER：自动接续
      } else {
        pos = axialPos(c, len, estLen);
      }
      const z0 = sBase + pos;
      const z1 = z0 + len;
      let r = radiusOf(c, 0);
      if (!isPos(r)) r = prevBodyR; // 尾翼等挂件：继承最近身体组件半径
      const r0 = c.type === 'nosecone' ? 0 : r;
      const r1 = c.type === 'nosecone' ? radiusOf(c, 0) : r;
      // 父实体先 push（2D SVG 中父在下层，子组件叠在其上可见）
      segs.push({ kind: c.type, name: c.name, comp: c, z0, z1, r0, r1, parentZ0: sBase, parentLen: estLen, depth: 0 });
      if (isBodyKind(c.type)) prevBodyR = r1;
      // 子组件（内部件/挂件/尾翼）：父 = 本组件，outerLen = 本组件长度
      for (const ch of c.children ?? []) {
        const clen = lenOf(ch);
        let cpos: number;
        if (isNaN(ch.axialOffset)) {
          cpos = len; // AFTER 子组件：父尾端
        } else {
          cpos = axialPos(ch, clen, len);
        }
        const cz0 = z0 + cpos;
        const cr = radiusOf(ch, r1);
        segs.push({
          kind: ch.type,
          name: ch.name,
          comp: ch,
          z0: cz0,
          z1: cz0 + clen,
          r0: ch.type === 'nosecone' ? 0 : cr,
          r1: ch.type === 'nosecone' ? radiusOf(ch, 0) : cr,
          parentZ0: z0,
          parentLen: len,
          depth: 1,
        });
      }
      cursor = Math.max(cursor, z1);
    }
    base = cursor;
  }
  return segs;
}
