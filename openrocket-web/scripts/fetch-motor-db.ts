/**
 * 从 OpenRocket motor-database（thrustcurve.org 实测数据）生成 Web 版发动机库数据。
 *
 * 输入：本地克隆目录（git clone --depth 1 https://github.com/openrocket/motor-database）
 * 输出：
 *   src/lib/motorDB/index.json   —— 全量型号索引（~2000 条，筛选/列表用，不含曲线）
 *   src/lib/motorDB/curated.json —— 精选可仿真发动机（含实测曲线，并入配置下拉）
 *
 * 关联链（官方数据已核实）：文件名 24hex hash = simfileId → simfile_to_motor.json → motorId → motors_metadata.json（全规格）
 *
 * 用法：node scripts/fetch-motor-db.mjs <motor-db克隆路径>
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '/tmp/motor-db';
const outDir = join(process.cwd(), 'src/lib/motorDB');
if (!existsSync(root)) { console.error('motor-db clone dir not found:', root); process.exit(1); }

const meta = JSON.parse(readFileSync(join(root, 'data/thrustcurve.org/motors_metadata.json'), 'utf8')).motors;
const simToMotor = JSON.parse(readFileSync(join(root, 'data/thrustcurve.org/simfile_to_motor.json'), 'utf8'));

/** 递归收集 data 下全部发动机文件 */
function collectFiles(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collectFiles(p, acc);
    else if (/\.(rse|eng|rasp)$/i.test(e)) acc.push(p);
  }
  return acc;
}

/** 从 .rse XML 提取推力曲线点 [[t,f],...] */
function parseRseCurve(text) {
  const pts = [];
  const re = /<eng-data\s+t="([\d.\-eE]+)"\s+f="([\d.\-eE]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    const t = parseFloat(m[1]); const f = parseFloat(m[2]);
    if (Number.isFinite(t) && Number.isFinite(f)) pts.push([t, f]);
  }
  return pts;
}

/** 从 RASP 文本（.eng/.rasp）提取曲线点（跳过注释行与头部行） */
function parseRaspCurve(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith(';') && !l.startsWith('#'));
  const pts = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(/\s+/).map(Number);
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([p[0], p[1]]);
  }
  return pts;
}

/** 提取全部数字延迟：delays="0,3,5" → [0,3,5]；"P"/空 → []（plugged 无延迟不可用） */
function allDelays(delays) {
  if (!delays) return [];
  const m = String(delays).match(/\d+(?:,\s*\d+)*/);
  if (!m) return [];
  return m[0].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

/** 型号名 → 延迟变体名：designation 尾数字与 delay 相同（如 A8-3、delay=3）则保持，否则追加 -delay（如 A8 → A8-3；A8-3、delay=5 → A8-3-5） */
function nameFor(designation, delay) {
  const m = String(designation).match(/(\d+)$/);
  if (m && parseInt(m[1], 10) === delay) return designation;
  return `${designation}-${delay}`;
}

const files = collectFiles(join(root, 'data'));
const byMotor = new Map(); // motorId → { meta, files: [...] }

let missingSim = 0, missingMeta = 0;
for (const f of files) {
  const base = f.split('/').pop();
  const hm = base.match(/_([0-9a-f]{24})\./);
  const simId = hm ? hm[1] : null;
  const s = simId ? simToMotor[simId] : null;
  if (!s) { missingSim++; continue; }
  let e = byMotor.get(s.motorId);
  if (!e) { e = { meta: meta[s.motorId], files: [] }; byMotor.set(s.motorId, e); }
  e.files.push({ simfileId: simId, format: s.format, source: s.source, path: f.replace(root + '/', ''), license: s.license ?? null });
  if (!meta[s.motorId]) missingMeta++;
}
console.log(`files=${files.length} motorGroups=${byMotor.size} missingSim=${missingSim} missingMeta=${missingMeta}`);

/** 压缩字段名索引条目 */
const index = [];
for (const [motorId, e] of byMotor) {
  const d = e.meta;
  if (!d) continue;
  index.push({
    id: motorId,
    m: d.manufacturer,
    d: d.designation,
    c: d.commonName ?? null,
    cl: d.impulseClass,
    dia: Math.round(d.diameter * 100) / 100,
    len: Math.round(d.length * 100) / 100,
    t: d.type,
    at: Math.round(d.avgThrustN * 100) / 100,
    mt: Math.round(d.maxThrustN * 100) / 100,
    ti: Math.round(d.totImpulseNs * 100) / 100,
    bt: Math.round(d.burnTimeS * 100) / 100,
    w0: d.totalWeightG,
    w1: d.propWeightG,
    del: d.delays ?? null,
    ci: d.caseInfo ?? null,
    pi: d.propInfo ?? null,
    sp: !!d.sparky,
    files: e.files.map((f) => ({ i: f.simfileId, f: f.format, s: f.source, p: f.path })),
  });
}
index.sort((a, b) => a.m.localeCompare(b.m) || a.d.localeCompare(b.d));
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
console.log('index.json entries =', index.length, 'bytes =', Buffer.byteLength(JSON.stringify(index)));

/** 精选：主流厂商 + 数字延迟（可仿真）+ 冲量级 A–G + 小口径优先；每型号取 source=cert 的第一个文件曲线 */
const prefer = ['Estes Industries', 'Quest Aerospace', 'AeroTech', 'Apogee Components', 'Raketenmodellbau Klima', 'Cesaroni Technology', 'Loki Research', 'Animal Motor Works'];
const classes = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
const curated = [];
let haveCurve = 0, skipped = 0;
for (const it of index) {
  const dels = allDelays(it.del);
  if (dels.length === 0) { skipped++; continue; }        // plugged/无延迟
  if (!prefer.includes(it.m)) { skipped++; continue; }
  if (!classes.has(it.cl)) { skipped++; continue; }
  if (it.dia > 54) { skipped++; continue; }
  const f = it.files.find((x) => x.s === 'cert') ?? it.files[0];
  if (!f) { skipped++; continue; }
  const text = readFileSync(join(root, f.p), 'utf8');
  const pts = f.f === 'RSE' ? parseRseCurve(text) : parseRaspCurve(text);
  if (pts.length < 2) { skipped++; continue; }
  let impulse = 0;
  for (let i = 1; i < pts.length; i++) impulse += 0.5 * (pts[i - 1][1] + pts[i][1]) * (pts[i][0] - pts[i - 1][0]);
  const peak = Math.max(...pts.map((p) => p[1]));
  const end = pts[pts.length - 1][0];
  const shellKg = Math.max((it.w0 - it.w1) / 1000, 0.004);
  for (const del of dels) {
    curated.push({
      id: `db-${it.id}-${del}`,
      name: nameFor(it.d, del),
      class: it.cl,
      diameterMM: it.dia, lengthMM: it.len,
      delay: del, burnTime: Math.round(end * 100) / 100,
      maxThrust: Math.round(peak * 100) / 100, totalImpulseNs: Math.round(impulse * 100) / 100,
      mass0: Math.round((it.w0 / 1000) * 10000) / 10000,
      mass1: Math.round(shellKg * 10000) / 10000,
      propellant: Math.round((it.w1 / 1000) * 10000) / 10000,
      curve: { time: pts.map((p) => p[0]), thrust: pts.map((p) => p[1]) },
      source: `OpenRocket motor-database · ${it.m} · thrustcurve.org ${f.s === 'cert' ? '认证' : '实测'}数据`,
      manufacturer: it.m,
      caseInfo: it.ci, propInfo: it.pi,
    });
    haveCurve++;
  }
}
writeFileSync(join(outDir, 'curated.json'), JSON.stringify(curated));
console.log(`curated = ${curated.length} (haveCurve=${haveCurve} skipped=${skipped}) bytes = ${Buffer.byteLength(JSON.stringify(curated))}`);
