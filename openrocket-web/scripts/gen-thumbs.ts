// 批量生成所有示例（内置 PRESETS + 官方 .ork）的缩略图 SVG 资产。
// 用法：npm run gen:thumbs
// 产物：public/ork-assets/examples/thumbs/<文件名>.svg（官方示例）/ thumbs-builtin/<名称>.svg（内置示例）
// 说明：几何与 ExampleThumb.vue 共用 src/lib/thumbPath.ts；新增/修改示例后重跑本脚本即可刷新资产。
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { parseOrk } from '../src/lib/orkParser';
import { layoutRocket } from '../src/lib/geometry';
import { buildThumbPaths, THUMB_W, THUMB_H, THUMB_PAD } from '../src/lib/thumbPath';
import type { RocketComponent } from '../src/lib/types';
import { PRESETS } from '../src/lib/presets';

// Node 环境无 DOMParser，注入 polyfill（浏览器端由平台提供）
(globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser = DOMParser;

// 注意：经 esbuild bundle 后 import.meta.url 指向临时产物，必须用 cwd（npm run 在项目根执行）
const ROOT = process.cwd();
const EXAMPLES_DIR = join(ROOT, 'public', 'ork-assets', 'examples');

function svgFrom(root: RocketComponent): string {
  const r = buildThumbPaths(root);
  const inner = r.paths
    .map((p) =>
      `<path d="${p.d}" fill="none" stroke="#4fa8ff" stroke-width="1.2"/>` +
      (p.mirror
        ? `<path d="${p.d}" transform="translate(0 ${r.h}) scale(1 -1)" fill="none" stroke="#4fa8ff" stroke-width="0.7" opacity="0.5"/>`
        : ''),
    )
    .join('\n  ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.w} ${r.h}" width="${THUMB_W * 2}" height="${THUMB_H * 2}" preserveAspectRatio="xMidYMid meet">\n` +
    `  <rect x="${THUMB_PAD - 3}" y="1" width="${r.w - THUMB_PAD * 2 + 6}" height="${r.h - 2}" rx="3" fill="#0d2f6e"/>\n` +
    `  ${inner}\n` +
    `  <line x1="${THUMB_PAD}" y1="${r.h / 2}" x2="${r.w - THUMB_PAD}" y2="${r.h / 2}" stroke="#3d7fd4" stroke-width="0.5" stroke-dasharray="3 2" opacity="0.6"/>\n` +
    `</svg>\n`
  );
}

function measure(root: RocketComponent): { len: number; dia: number } {
  let maxZ = 0, maxR = 0;
  for (const s of layoutRocket(root)) {
    maxZ = Math.max(maxZ, s.z1);
    maxR = Math.max(maxR, s.r0, s.r1);
  }
  return { len: Math.round(maxZ * 1000), dia: Math.round(maxR * 2 * 1000) };
}

function main(): Promise<void> {
  const outDir = join(EXAMPLES_DIR, 'thumbs');
  mkdirSync(outDir, { recursive: true });
  const report: string[] = [];
  const tasks: Promise<void>[] = [];

  // 官方示例：解析 .ork → 缩略图
  const files = readdirSync(EXAMPLES_DIR)
    .filter((f) => f.endsWith('.ork'))
    .sort();
  for (const f of files) {
    tasks.push((async () => {
      try {
        const buf = readFileSync(join(EXAMPLES_DIR, f));
        const root = (await parseOrk(buf)).root;
        const out = join(outDir, f.replace(/\.ork$/, '.svg'));
        writeFileSync(out, svgFrom(root));
        const { len, dia } = measure(root);
        report.push(`✓ ${f} → thumbs/${f.replace(/\.ork$/, '.svg')}（${(len / 1000).toFixed(3)} m / Ø${dia} mm）`);
      } catch (e) {
        report.push(`✗ ${f}: ${(e as Error).message}`);
      }
    })());
  }

  // 内置示例
  const bDir = join(EXAMPLES_DIR, 'thumbs-builtin');
  mkdirSync(bDir, { recursive: true });
  for (const p of PRESETS) {
    tasks.push((async () => {
      try {
        const root = p.build().root;
        const safe = p.name.replace(/[^\w\u4e00-\u9fa5-]+/g, '_');
        writeFileSync(join(bDir, `${safe}.svg`), svgFrom(root));
        const { len, dia } = measure(root);
        report.push(`✓ [内置] ${p.name} → thumbs-builtin/${safe}.svg（${(len / 1000).toFixed(3)} m / Ø${dia} mm）`);
      } catch (e) {
        report.push(`✗ [内置] ${p.name}: ${(e as Error).message}`);
      }
    })());
  }

  return Promise.all(tasks).then(() => {
    report.sort();
    console.log(report.join('\n'));
    console.log(`\n共 ${report.filter((r) => r.startsWith('✓')).length}/${report.length} 个示例生成成功。`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
