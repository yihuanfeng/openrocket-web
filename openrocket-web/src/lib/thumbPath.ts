// 示例缩略图共享几何：水平绘制火箭轮廓（z=0 鼻尖朝左），
// 与 2D/3D 共用 layoutRocket 官方轴向语义；ExampleThumb.vue 与
// scripts/gen-thumbs.ts（批量生成 SVG 资产）共用此模块，避免逻辑漂移。
import type { RocketComponent } from './types';
import { layoutRocket } from './geometry';

export const THUMB_W = 116;
export const THUMB_H = 44;
export const THUMB_PAD = 5;

export interface ThumbPath { d: string; mirror: boolean }
export interface ThumbRender {
  w: number;
  h: number;
  pad: number;
  paths: ThumbPath[];
}

const INNER_KINDS = new Set(['innertube', 'enginemount', 'engineblock', 'tubecoupler', 'bulkhead', 'centeringring']);
const FIN_KINDS = new Set(['finset', 'fintab', 'trapezoidfinset', 'ellipticalfinset', 'freeformfinset']);

export function buildThumbPaths(root: RocketComponent): ThumbRender {
  const shapes = layoutRocket(root);
  let maxZ = 0, maxR = 0;
  for (const s of shapes) {
    maxZ = Math.max(maxZ, s.z1);
    maxR = Math.max(maxR, s.r0, s.r1);
  }
  maxZ = Math.max(maxZ, 0.001);
  maxR = Math.max(maxR, 0.001);

  const W = THUMB_W, H = THUMB_H, PAD = THUMB_PAD;
  const midY = H / 2;
  // 轴向 x（鼻尖朝左）；径向按高度限制放大以便可见（缩略图为示意，不保真实长径比）
  const unitX = (W - PAD * 2) / maxZ;
  const rScale = Math.min((H - 10) / 2 / maxR, W * 0.12 / maxR);
  const pt = (a: number, r: number): string => `${(PAD + a * unitX).toFixed(1)} ${(midY + r * rScale).toFixed(1)}`;

  const paths: ThumbPath[] = [];
  for (const s of shapes) {
    if (INNER_KINDS.has(s.kind)) continue;
    const a0 = s.z0, a1 = s.z1;
    const r0 = s.r0, r1 = s.r1;
    let d: string;
    if (s.kind === 'nosecone') {
      const shape = String(s.comp.properties?.['shape'] ?? 'ogive').toLowerCase();
      d = shape === 'conical'
        ? `M ${pt(a0, 0)} L ${pt(a1, r1)} L ${pt(a1, 0)} Z`
        : `M ${pt(a0, 0)} Q ${pt((a0 + a1) / 2, r1 * 0.55)} ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
    } else if (FIN_KINDS.has(s.kind)) {
      const h = parseFloat(s.comp.properties['height'] ?? '') || 0.05; // 米；pt() 内部会乘 rScale
      const rootc = Math.max(a1 - a0, 0.001);
      const tipc = parseFloat(s.comp.properties['tipchord'] ?? '');
      const tipcPx = (Number.isFinite(tipc) && tipc > 0 ? tipc / rootc : 1) * (a1 - a0);
      const sweep = parseFloat(s.comp.properties['sweep'] ?? '');
      const sweepPx = (Number.isFinite(sweep) && sweep > 0 ? sweep : rootc * 0.4) * unitX;
      const tipStart = a0 + Math.min(sweepPx, (a1 - a0) * 0.7);
      d = `M ${pt(a0, r0)} L ${pt(tipStart, r0 + h)} L ${pt(Math.min(tipStart + tipcPx, a1), r0 + h)} L ${pt(a1, r0)} Z`;
    } else {
      d = `M ${pt(a0, 0)} L ${pt(a0, r0)} L ${pt(a1, r1)} L ${pt(a1, 0)} Z`;
    }
    paths.push({ d, mirror: true });
  }
  return { w: W, h: H, pad: PAD, paths };
}
