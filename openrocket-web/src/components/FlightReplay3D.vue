<script setup lang="ts">
// 3D 空间飞行回放：两种模式
//  - 全景（panorama）：深蓝背景 + 地面网格 + 空间轨迹 + 事件标记 + 刻度尺（科学视角，原版保留）
//  - 实景（scenic）：电影级发射直播视角 —— 天空渐变/云/太阳、草地发射场、追拍相机（火箭居中、视角跟随速度方位）、
//    尾焰 + 烟雾粒子（燃烧期由 acceleration 推断）、开伞伞盘+伞绳、实景 HUD
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FlightProfile, RocketComponent } from '../lib/types';
import { buildRocketFaces, normalizeFaces3D } from '../lib/rocketFaces3d';

const props = defineProps<{ profile: FlightProfile | null; model?: RocketComponent | null }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);
const progress = ref(0); // 0..1
const tNow = ref(0);
const zNow = ref(0);
const vNow = ref(0);
const mode = ref<'scenic' | 'panorama'>('scenic');

let rotY = 0.55;
let rotYUnset = true; // 实景追拍：首次/每次播放开始时与速度方位直接对齐，避免起飞固定倾斜
let rotX = 0.35;
let scale = 1;
let raf = 0;
let lastTs = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let manualView = false; // 实景追拍：用户拖拽后切手动视角；再次播放恢复追拍
let ro: ResizeObserver | null = null;

// —— 简化火箭几何（局部坐标：长轴沿 +Z，鼻锥在 +Z 端） ——
interface Pt { x: number; y: number; z: number }
interface Face { p: Pt[]; fill: string; light: number }
const ROCKET_R = 0.02;
const ROCKET_LEN = 0.3;
const FIN_N = 3;

function rocketFaces(): Face[] {
  const faces: Face[] = [];
  const r = ROCKET_R, len = ROCKET_LEN;
  const SEG = 10;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    faces.push({ p: [{ x: r * c0, y: r * s0, z: 0 }, { x: r * c1, y: r * s1, z: 0 }, { x: r * c1, y: r * s1, z: len }], fill: '#dfe9fb', light: 0.95 + 0.05 * ((c0 + c1) / 2) });
    faces.push({ p: [{ x: r * c0, y: r * s0, z: 0 }, { x: r * c1, y: r * s1, z: len }, { x: r * c0, y: r * s0, z: len }], fill: '#dfe9fb', light: 0.95 + 0.05 * ((c0 + c1) / 2) });
  }
  const tipZ = len * 1.35;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    faces.push({ p: [{ x: r * c0, y: r * s0, z: len }, { x: r * c1, y: r * s1, z: len }, { x: 0, y: 0, z: tipZ }], fill: '#c9d6f2', light: 1.0 });
  }
  const fh = 0.05, fr = 0.035;
  for (let i = 0; i < FIN_N; i++) {
    const ang = (i / FIN_N) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dirX = c, dirY = s;
    faces.push({ p: [{ x: r * c, y: r * s, z: 0.01 }, { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 }, { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 + fh }], fill: '#d94f2b', light: 0.95 });
    faces.push({ p: [{ x: r * c, y: r * s, z: 0.01 }, { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 + fh }, { x: r * c, y: r * s, z: 0.01 + fh }], fill: '#d94f2b', light: 0.95 });
  }
  return faces;
}
const ROCKET_FACES = rocketFaces();

/** 真实模型三角面（复用 RocketView3D 同一构建源：部件配色/外形/尾翼轮廓/并联级），
 *  归一化到 ROCKET_LEN 长度并翻转轴向（模型 z=0 为鼻端 → 鼻端在 +Z 与简化几何一致）；
 *  无 model 时回退简化几何 */
const modelFaces = ref<Face[] | null>(null);
function rebuildModel(): void {
  const root = props.model;
  if (!root) {
    modelFaces.value = null;
    return;
  }
  const tris = buildRocketFaces(root, null);
  modelFaces.value = normalizeFaces3D(tris, ROCKET_LEN).map((t) => ({
    p: t.pts.map(([x, y, z]) => ({ x, y, z })),
    fill: t.color,
    light: 1,
  }));
}
watch(() => props.model, rebuildModel, { immediate: true });
function rocketFacesNow(): Face[] {
  return modelFaces.value ?? ROCKET_FACES;
}

/** 局部 +Z 长轴旋转到 dir 方向（先绕 Y pitch，再绕 Z yaw） */
function orient(faces: Face[], dir: { x: number; y: number; z: number }): Face[] {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-9) return faces.map((f) => ({ p: f.p.map((q) => ({ ...q })), fill: f.fill, light: f.light }));
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
  const h = Math.hypot(dx, dy);
  // 俯仰角：dir 与 +Z 的夹角。sin=水平分量 h、cos=垂直分量 dz（此前 sP/cPv 写反，
  // 导致垂直上升(dir=+Z)时火箭轴被转到 x-z 对角 45°，呈现"一起飞就斜着飞"）
  const sP = h > 1e-9 ? h : 0, cPv = dz;
  const sY = h > 1e-9 ? dy / h : 0, cY = h > 1e-9 ? dx / h : 1;
  return faces.map((f) => ({
    p: f.p.map((q) => {
      const x2 = q.x * cPv + q.z * sP;
      const y2 = q.y;
      const z2 = -q.x * sP + q.z * cPv;
      return { x: x2 * cY - y2 * sY, y: x2 * sY + y2 * cY, z: z2 };
    }),
    fill: f.fill, light: f.light,
  }));
}

function lerpArr(arr: number[] | undefined, t: number): number {
  if (!arr || arr.length === 0) return 0;
  if (t <= 0) return arr[0];
  const n = arr.length - 1;
  if (t >= 1) return arr[n];
  const f = t * n;
  const i = Math.min(n - 1, Math.floor(f));
  const fr = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * fr;
}
function lerpTime(arr: number[] | undefined, t: number, t0: number, t1: number): number {
  if (!arr || arr.length === 0) return 0;
  const f = (t - t0) / (t1 - t0);
  return lerpArr(arr, f);
}

/** 燃烧结束时刻：最后一个加速度 > 0.5 m/s² 的时间点（用于驱动尾焰粒子） */
function burnEndOf(p: FlightProfile): number {
  if (!p.acceleration || p.acceleration.length < 2) return 0;
  let end = 0;
  for (let i = 1; i < p.acceleration.length; i++) {
    if (p.acceleration[i] > 0.5) end = p.time[i];
  }
  return end;
}

// —— 实景模式：尾焰/烟雾粒子 ——
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; sz: number; smoke: boolean }
const parts: Particle[] = [];
const MAX_P = 320;
function spawnExhaust(x: number, y: number, z: number, dir: { x: number; y: number; z: number }, dt: number): void {
  if (parts.length > MAX_P - 4) parts.splice(0, parts.length - MAX_P + 4);
  const n = Math.max(2, Math.round(90 * dt));
  for (let i = 0; i < n; i++) {
    const rnd = (Math.random() - 0.5) * 2;
    const flame = Math.random() < 0.72;
    parts.push({
      x: x + (Math.random() - 0.5) * 0.008,
      y: y + (Math.random() - 0.5) * 0.008,
      z: z + (Math.random() - 0.5) * 0.008,
      vx: -dir.x * (flame ? 5 + Math.random() * 5 : 2 + Math.random() * 3) + rnd * 0.8,
      vy: -dir.y * (flame ? 5 + Math.random() * 5 : 2 + Math.random() * 3) + rnd * 0.8,
      vz: -dir.z * (flame ? 5 + Math.random() * 5 : 2 + Math.random() * 3) + rnd * 0.8 - 0.6,
      life: flame ? 0.16 + Math.random() * 0.12 : 1.6 + Math.random() * 1.6,
      max: flame ? 0.28 : 3.2,
      sz: flame ? 0.012 + Math.random() * 0.01 : 0.02 + Math.random() * 0.02,
      smoke: !flame,
    });
  }
}
function stepParts(dt: number): void {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.vx *= 1 - 1.2 * dt; p.vy *= 1 - 1.2 * dt; p.vz = p.vz * (1 - 1.2 * dt) + 1.1 * dt;
    if (p.smoke) p.sz += dt * 0.018;
  }
}

// —— 程序化云（屏幕空间） ——
const CLOUDS = Array.from({ length: 7 }, (_, i) => ({
  sx: (i * 0.73) % 1, sy: 0.10 + (i * 0.21) % 1 * 0.4, sw: 0.12 + (i % 3) * 0.05, sh: 0.035 + (i % 2) * 0.018, spd: 0.004 + (i % 4) * 0.0025,
}));

function drawScenic(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const p = props.profile;
  const cxp = w / 2;
  // 天空：垂直渐变（地平线暖白 → 高空深蓝）
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
  sky.addColorStop(0, '#0e2b63');
  sky.addColorStop(0.5, '#3d74b8');
  sky.addColorStop(1, '#b7d6ea');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // 太阳（右上）
  const sunX = w * 0.82, sunY = h * 0.16;
  const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 130);
  halo.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
  halo.addColorStop(0.18, 'rgba(255, 240, 190, 0.5)');
  halo.addColorStop(1, 'rgba(255, 240, 190, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(sunX, sunY, 130, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff8dc';
  ctx.beginPath(); ctx.arc(sunX, sunY, 26, 0, Math.PI * 2); ctx.fill();
  // 云（缓慢漂移）
  ctx.save();
  for (const c of CLOUDS) {
    const cx = ((c.sx + tNow.value * c.spd) % 1.3) * w - w * 0.15;
    const cy = c.sy * h * 0.5;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, c.sw * w, c.sh * h, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + c.sw * w * 0.45, cy + c.sh * h * 0.25, c.sw * w * 0.6, c.sh * h * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(cx - c.sw * w * 0.42, cy + c.sh * h * 0.3, c.sw * w * 0.55, c.sh * h * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // 地面（地平线以下草地 + 远景渐变）
  const grd = ctx.createLinearGradient(0, h * 0.56, 0, h);
  grd.addColorStop(0, '#6da04a');
  grd.addColorStop(0.25, '#4e7d35');
  grd.addColorStop(1, '#2f5222');
  ctx.fillStyle = grd;
  ctx.fillRect(0, h * 0.56, w, h - h * 0.56);
  // 远山轮廓（地平线剪影）
  ctx.fillStyle = 'rgba(70, 105, 70, 0.55)';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.57);
  const HILL_SEG = 24;
  for (let s = 0; s <= HILL_SEG; s++) {
    const x = (s / HILL_SEG) * w;
    ctx.lineTo(x, h * 0.57 - Math.abs(Math.sin(x * 0.012 + 1.3)) * h * 0.03 - Math.sin(x * 0.03) * h * 0.012);
  }
  ctx.lineTo(w, h * 0.58); ctx.lineTo(0, h * 0.58);
  ctx.closePath(); ctx.fill();

  if (!p || p.time.length < 2) {
    ctx.fillStyle = '#234';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('运行仿真后在此回放实景飞行', cxp, h * 0.4);
    return;
  }
  const N = p.time.length;
  const tMax = p.time[N - 1];
  const t0 = p.time[0];
  const tx = p.trailX ?? [];
  const ty = p.trailY ?? [];
  const hasTrail = tx.length === N;
  const tCur = progress.value * tMax;
  tNow.value = tCur;
  zNow.value = lerpTime(p.altitude, tCur, t0, tMax);
  vNow.value = lerpTime(p.velocity, tCur, t0, tMax);
  const f = (tCur - t0) / (tMax - t0);
  const iF = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))));
  const xCur = hasTrail ? lerpArr(tx, f) : 0;
  const yCur = hasTrail ? lerpArr(ty, f) : 0;
  const ip = Math.max(0, iF - 2), in_ = Math.min(N - 1, iF + 2);
  const dtS = Math.max(1e-6, tMax * (in_ - ip) / (N - 1));
  const dvx = hasTrail ? (tx[in_] - tx[ip]) / dtS : 0;
  const dvy = hasTrail ? (ty[in_] - ty[ip]) / dtS : 0;
  const dvz = p.velocity[iF] ?? 0;
  const deployed = tCur >= p.timeToApogee_s && zNow.value < p.maxAltitude_m * 0.99 && p.altitude[N - 1] < p.maxAltitude_m;

  // 相机：视角跟随速度水平方位（追拍）；俯视随高度渐变——起飞低空近平视（真实发射直播感），高空逐步俯视
  // 用户拖拽（manualView）时保持手动偏航，不自动追拍；再次播放恢复
  const yaw = Math.atan2(dvy, dvx);
  if (rotYUnset) { rotY = yaw; rotYUnset = false; }
  else if (!manualView) rotY += (yaw - rotY) * 0.12;
  const rY = rotY;
  // 俯仰运镜：起飞前/低空相机高空俯瞰（rX≈0.98≈56°，在火箭斜上方俯视发射台全场），
  // 随高度指数衰减转为近距离追拍（rX≈0.1-0.3），形成"俯瞰开场 → 追拍跟进"镜头语言
  const rX = 0.08 + 0.9 * Math.exp(-zNow.value / 25) + Math.min(1, zNow.value / 100) * 0.2;
  const cP = Math.cos(rX), sP = Math.sin(rX);
  // 以火箭为中心；火箭画面纵向位置：低空在下方（0.64h）→ 高空升至中心（0.50h），"跟随上升"运镜
  const cypDyn = h * (0.64 - 0.14 * Math.min(1, zNow.value / 70));
  const unit = Math.min(w, h) * 0.58 * scale;
  const proj = (x: number, y: number, z: number) => {
    const rx = x - xCur, ry = y - yCur, rz = z - zNow.value;
    const cY = Math.cos(rY), sY = Math.sin(rY);
    const x1 = rx * cY - ry * sY;
    const y1 = rx * sY + ry * cY;
    const y2 = y1 * cP - rz * sP;
    const z2 = y1 * sP + rz * cP;
    return { x: cxp + x1 * unit, y: cypDyn - z2 * unit, depth: y2, scale: 1 / (1 + Math.max(0, z2) * 0.02) };
  };

  // 发射场（火箭相对原点，地面）：距离较近时显示
  if (zNow.value < p.maxAltitude_m * 0.45) {
    const pad = proj(0, 0, 0);
    const under = zNow.value < 120;
    ctx.strokeStyle = 'rgba(220, 235, 250, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad.x, pad.y); ctx.lineTo(pad.x, pad.y - 26); ctx.stroke(); // 导杆
    ctx.beginPath(); ctx.moveTo(pad.x - 12, pad.y); ctx.lineTo(pad.x + 12, pad.y); ctx.stroke();
    ctx.fillStyle = 'rgba(230, 240, 250, 0.5)';
    ctx.beginPath(); ctx.ellipse(pad.x, pad.y, 10, 4, 0, 0, Math.PI * 2); ctx.fill();
    if (under) {
      ctx.fillStyle = '#dff0d0';
      ctx.font = '10px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('发射场', pad.x, pad.y - 30);
    }
  }

  // 已飞轨迹（尾迹，相对坐标淡蓝）
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(180, 215, 255, 0.35)';
  ctx.beginPath();
  for (let i = 0; i <= iF; i++) {
    const pt = proj(hasTrail ? (tx[i] ?? 0) : 0, hasTrail ? (ty[i] ?? 0) : 0, p.altitude[i]);
    if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // 尾焰粒子（燃烧期发射）
  const burnEnd = burnEndOf(p);
  if (tCur < burnEnd) {
    const vLen = Math.hypot(dvx, dvy, dvz) || 1;
    spawnExhaust(xCur - (dvx / vLen) * 0.12, yCur - (dvy / vLen) * 0.12, zNow.value - (dvz / vLen) * 0.12, { x: dvx, y: dvy, z: dvz }, 1 / 60);
  }
  stepParts(1 / 60);
  for (const pt of parts) {
    const s = proj(pt.x, pt.y, pt.z);
    const a = Math.max(0, pt.life / pt.max);
    if (pt.smoke) {
      ctx.fillStyle = `rgba(210, 214, 220, ${(a * 0.4).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1.2, pt.sz * unit * s.scale), 0, Math.PI * 2); ctx.fill();
    } else {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, Math.max(1.5, pt.sz * unit * s.scale * 2.2));
      g.addColorStop(0, `rgba(255, 236, 160, ${a.toFixed(3)})`);
      g.addColorStop(0.4, `rgba(255, 160, 60, ${(a * 0.9).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1.5, pt.sz * unit * s.scale * 2.2), 0, Math.PI * 2); ctx.fill();
    }
  }

  // 火箭
  const faces: Face[] = [];
  const oriented = orient(rocketFacesNow(), { x: dvx, y: dvy, z: dvz });
  for (const f2 of oriented) {
    faces.push({ p: f2.p.map((q) => ({ x: q.x + xCur, y: q.y + yCur, z: q.z + zNow.value })), fill: f2.fill, light: f2.light });
  }
  // 开伞：伞盘 + 伞绳
  if (deployed) {
    const R = 0.055;
    const canopy: Face[] = [];
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
      canopy.push({
        p: [{ x: 0, y: 0, z: ROCKET_LEN * 1.6 }, { x: R * Math.cos(a0), y: R * Math.sin(a0), z: ROCKET_LEN * 1.6 }, { x: R * Math.cos(a1), y: R * Math.sin(a1), z: ROCKET_LEN * 1.6 }],
        fill: '#ff7a00', light: 0.9,
      });
    }
    const oCanopy = orient(canopy, { x: dvx, y: dvy, z: dvz });
    for (const f3 of oCanopy) {
      faces.push({ p: f3.p.map((q) => ({ x: q.x + xCur, y: q.y + yCur, z: q.z + zNow.value })), fill: f3.fill, light: f3.light });
    }
    // 伞绳
    ctx.strokeStyle = 'rgba(240, 240, 245, 0.7)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const top = proj(xCur + Math.cos(a) * R * 0.5, yCur + Math.sin(a) * R * 0.5, zNow.value + ROCKET_LEN * 1.55);
      const bot = proj(xCur, yCur, zNow.value + ROCKET_LEN * 0.6);
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(bot.x, bot.y); ctx.stroke();
    }
  }
  const drawn = faces
    .map((f4) => ({ f4, d: f4.p.reduce((s, q) => s + proj(q.x, q.y, q.z).depth, 0) / f4.p.length }))
    .sort((a, b) => b.d - a.d);
  for (const { f4 } of drawn) {
    const pts = f4.p.map((q) => proj(q.x, q.y, q.z));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = f4.fill;
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(30, 60, 120, 0.10)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // 实景 HUD
  const hDist = Math.hypot(xCur, yCur);
  ctx.fillStyle = 'rgba(8, 20, 45, 0.55)';
  ctx.fillRect(w - 190, 10, 178, 74);
  ctx.strokeStyle = 'rgba(140, 200, 255, 0.4)';
  ctx.strokeRect(w - 190, 10, 178, 74);
  ctx.fillStyle = '#e8f4ff';
  ctx.font = '600 14px -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`高度 ${zNow.value.toFixed(1)} m`, w - 22, 30);
  ctx.font = '12px -apple-system, sans-serif';
  ctx.fillStyle = '#b8d8f5';
  ctx.fillText(`速度 ${vNow.value.toFixed(1)} m/s`, w - 22, 50);
  ctx.fillText(`t ${tCur.toFixed(3)}s · 漂移 ${hDist.toFixed(1)}m`, w - 22, 70);
  const state = zNow.value <= 0 ? '地面' : deployed ? '伞降中' : tCur < p.timeToApogee_s ? '上升' : '滑行';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.font = '700 15px -apple-system, sans-serif';
  ctx.fillText(`● ${state}${deployed ? '（已开伞）' : ''}`, 14, 28);
  ctx.font = '10px -apple-system, sans-serif';
  ctx.fillStyle = 'rgba(200, 225, 250, 0.75)';
  ctx.fillText('实景飞行 · 视角跟随火箭', 14, h - 10);
}

function drawPanorama(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const p = props.profile;
  ctx.fillStyle = '#0b1630';
  ctx.fillRect(0, 0, w, h);
  const cxp = w / 2, cyp = h * 0.64;
  const maxZ = p && p.maxAltitude_m > 0 ? p.maxAltitude_m : 30;
  let hSpan = 1;
  if (p && p.trailX && p.trailY) {
    for (let i = 0; i < p.trailX.length; i++) hSpan = Math.max(hSpan, Math.abs(p.trailX[i] ?? 0), Math.abs(p.trailY[i] ?? 0));
  }
  const sceneMax = Math.max(maxZ * 0.62, hSpan * 0.75, 6);
  const unit = Math.min(w, h) * 0.30 * scale / Math.max(sceneMax, 0.001);
  const proj = (x: number, y: number, z: number) => {
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const cP = Math.cos(rotX), sP = Math.sin(rotX);
    const x1 = x * cY - y * sY;
    const y1 = x * sY + y * cY;
    const y2 = y1 * cP - z * sP;
    const z2 = y1 * sP + z * cP;
    return { x: cxp + x1 * unit, y: cyp - z2 * unit, depth: y2 };
  };
  const gridN = 7;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.18)';
  const gMax = Math.max(hSpan * 1.6, maxZ * 0.4, 30);
  for (let i = -gridN; i <= gridN; i++) {
    const g = (i / gridN) * gMax;
    const a = proj(g, -gMax, 0), b = proj(g, gMax, 0);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = proj(-gMax, g, 0), d = proj(gMax, g, 0);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.6)';
  ctx.lineWidth = 1.5;
  const gA = proj(-gMax, -gMax, 0), gB = proj(gMax, -gMax, 0), gC = proj(gMax, gMax, 0), gD = proj(-gMax, gMax, 0);
  ctx.beginPath(); ctx.moveTo(gA.x, gA.y); ctx.lineTo(gB.x, gB.y); ctx.lineTo(gC.x, gC.y); ctx.lineTo(gD.x, gD.y); ctx.closePath(); ctx.stroke();
  const padR = Math.max(1.2, Math.min(3, hSpan * 0.3));
  ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
  const padPts = [proj(-padR, -padR, 0), proj(padR, -padR, 0), proj(padR, padR, 0), proj(-padR, padR, 0)];
  ctx.beginPath(); ctx.moveTo(padPts[0].x, padPts[0].y);
  for (let i = 1; i < padPts.length; i++) ctx.lineTo(padPts[i].x, padPts[i].y);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const zSteps = Math.min(8, Math.ceil(maxZ / 10));
  const rulerX = gMax * 1.15;
  for (let i = 0; i <= zSteps; i++) {
    const z = (maxZ / zSteps) * i;
    const pt = proj(rulerX, 0, z);
    ctx.beginPath(); ctx.moveTo(pt.x - 4, pt.y); ctx.lineTo(pt.x + 4, pt.y); ctx.stroke();
    ctx.fillText(`${Math.round(z)} m`, pt.x + 7, pt.y + 3);
  }
  if (p && p.time.length > 1) {
    const N = p.time.length;
    const tMax = p.time[N - 1];
    const t0 = p.time[0];
    const tx = p.trailX ?? [];
    const ty = p.trailY ?? [];
    const hasTrail = tx.length === N;
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(96, 180, 255, 0.75)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const pt = proj(hasTrail ? (tx[i] ?? 0) : 0, hasTrail ? (ty[i] ?? 0) : 0, p.altitude[i]);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const pt = proj(hasTrail ? (tx[i] ?? 0) : 0, hasTrail ? (ty[i] ?? 0) : 0, 0);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const tCur = progress.value * tMax;
    tNow.value = tCur;
    zNow.value = lerpTime(p.altitude, tCur, t0, tMax);
    vNow.value = lerpTime(p.velocity, tCur, t0, tMax);
    const f = (tCur - t0) / (tMax - t0);
    const iF = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))));
    const xCur = hasTrail ? lerpArr(tx, f) : 0;
    const yCur = hasTrail ? lerpArr(ty, f) : 0;
    const ip = Math.max(0, iF - 2), in_ = Math.min(N - 1, iF + 2);
    const dtS = Math.max(1e-6, tMax * (in_ - ip) / (N - 1));
    const dvx = hasTrail ? (tx[in_] - tx[ip]) / dtS : 0;
    const dvy = hasTrail ? (ty[in_] - ty[ip]) / dtS : 0;
    const dvz = p.velocity[iF] ?? 0;
    const deployed = tCur >= p.timeToApogee_s && zNow.value < p.maxAltitude_m * 0.99 && p.altitude[N - 1] < p.maxAltitude_m;
    const faces: Face[] = [];
    // 全景：火箭按真实比例在场景里不足 1px（unit≈1.6px/m，0.42m→0.7px）不可见，
    // 独立放大到画面约 40px，位置仍锚定轨迹点；伞盘随火箭同比例放大
    const rs = Math.max(0.01, 40 / Math.max(ROCKET_LEN * unit, 1e-6));
    const oriented = orient(rocketFacesNow(), { x: dvx, y: dvy, z: dvz });
    for (const f2 of oriented) {
      faces.push({ p: f2.p.map((q) => ({ x: q.x * rs + xCur, y: q.y * rs + yCur, z: q.z * rs + zNow.value })), fill: f2.fill, light: f2.light });
    }
    if (deployed) {
      const R = 0.055 * rs;
      const canopy: Face[] = [];
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        canopy.push({ p: [{ x: 0, y: 0, z: ROCKET_LEN * 1.6 * rs }, { x: R * Math.cos(a0), y: R * Math.sin(a0), z: ROCKET_LEN * 1.6 * rs }, { x: R * Math.cos(a1), y: R * Math.sin(a1), z: ROCKET_LEN * 1.6 * rs }], fill: '#ff7a00', light: 0.9 });
      }
      const oCanopy = orient(canopy, { x: dvx, y: dvy, z: dvz });
      for (const f3 of oCanopy) {
        faces.push({ p: f3.p.map((q) => ({ x: q.x + xCur, y: q.y + yCur, z: q.z + zNow.value })), fill: f3.fill, light: f3.light });
      }
    }
    const drawn = faces.map((f4) => ({ f4, d: f4.p.reduce((s, q) => s + proj(q.x, q.y, q.z).depth, 0) / f4.p.length })).sort((a, b) => b.d - a.d);
    for (const { f4 } of drawn) {
      const pts = f4.p.map((q) => proj(q.x, q.y, q.z));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = f4.fill;
      ctx.globalAlpha = 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(10, 40, 100, 0.08)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
    const mark = (idx: number, color: string, label: string) => {
      const pt = proj(hasTrail ? (tx[idx] ?? 0) : 0, hasTrail ? (ty[idx] ?? 0) : 0, p.altitude[idx]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(label, pt.x + 7, pt.y - 4);
    };
    let apI = 0;
    for (let i = 1; i < N; i++) if (p.altitude[i] > p.altitude[apI]) apI = i;
    mark(apI, '#ff7a00', `远地点 ${p.maxAltitude_m.toFixed(0)} m（t=${p.timeToApogee_s.toFixed(3)}s）`);
    mark(N - 1, '#22c55e', `着陆（t=${tMax.toFixed(3)}s）`);
    const hDist = Math.hypot(xCur, yCur);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`t=${tCur.toFixed(3)}s  高度=${zNow.value.toFixed(1)}m  速度=${vNow.value.toFixed(1)}m/s  漂移=${hDist.toFixed(1)}m`, w - 12, 20);
    const state = zNow.value <= 0 ? '地面' : deployed ? '伞降' : tCur < p.timeToApogee_s ? '上升' : '滑行';
    ctx.textAlign = 'left';
    ctx.fillStyle = deployed ? '#ff7a00' : '#38bdf8';
    ctx.fillText(`状态：${state}${deployed ? '（已开伞）' : ''}`, 12, 20);
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('拖拽旋转 · 滚轮缩放', 12, h - 8);
  } else {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('运行仿真后在此回放飞行轨迹', cxp, cyp);
  }
}

function draw(): void {
  const cv = canvas.value;
  if (!cv) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr) cv.width = w * dpr;
  if (cv.height !== h * dpr) cv.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (mode.value === 'scenic') drawScenic(ctx, w, h);
  else drawPanorama(ctx, w, h);
}

function tick(ts: number): void {
  try {
    const p = props.profile;
    if (p && p.time.length > 1) {
      const dt = lastTs ? (ts - lastTs) / 1000 : 0;
      lastTs = ts;
      const tMax = p.time[p.time.length - 1];
      progress.value = Math.min(1, progress.value + dt / tMax);
      if (progress.value >= 1) playing.value = false;
    }
    draw();
  } catch {
    playing.value = false;
    return;
  }
  if (playing.value) raf = requestAnimationFrame(tick);
}

function togglePlay(): void {
  if (!props.profile || props.profile.time.length < 2) return;
  playing.value = !playing.value;
  lastTs = 0;
  if (playing.value) {
    rotYUnset = true; // 每次开始播放先与当前速度方位对齐，避免承接旧偏航导致起飞斜飞
    manualView = false; // 播放恢复实景追拍（用户在拖拽中的手动视角被重置）
    raf = requestAnimationFrame(tick);
  }
}
function reset(): void {
  playing.value = false;
  cancelAnimationFrame(raf);
  progress.value = 0;
  parts.length = 0;
  draw();
}

function onDown(e: MouseEvent): void {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  if (mode.value === 'scenic') manualView = true; // 实景拖拽 → 切手动视角（暂停自动追拍）
}
function onMove(e: MouseEvent): void {
  if (!dragging) return;
  rotY += (e.clientX - lastX) * 0.008;
  rotX = Math.min(1.4, Math.max(0.05, rotX + (e.clientY - lastY) * 0.006));
  lastX = e.clientX;
  lastY = e.clientY;
  draw();
}
function onUp(): void { dragging = false; }
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  scale *= e.deltaY > 0 ? 0.88 : 1.12;
  scale = Math.min(4, Math.max(0.3, scale));
  draw();
}

onMounted(() => {
  void nextTick(() => {
    draw();
    if (canvas.value) {
      ro = new ResizeObserver(() => draw());
      ro.observe(canvas.value);
    }
  });
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  ro = null;
});
watch(() => props.profile, () => { reset(); }, { deep: false });
</script>

<template>
  <div class="replay">
    <div class="replay-head">
      <div class="replay-modes">
        <button :class="['rmode', { on: mode === 'scenic' }]" @click="mode = 'scenic'; draw()">实景</button>
        <button :class="['rmode', { on: mode === 'panorama' }]" @click="mode = 'panorama'; draw()">全景</button>
      </div>
    </div>
    <canvas
      ref="canvas"
      class="replay-canvas"
      @mousedown="onDown"
      @mousemove="onMove"
      @mouseup="onUp"
      @mouseleave="onUp"
      @wheel="onWheel"
    ></canvas>
    <div class="replay-bar">
      <button class="rbtn" :disabled="!profile || profile.time.length < 2" @click="togglePlay">{{ playing ? '⏸' : '⏵' }}</button>
      <button class="rbtn" @click="reset">⏮</button>
      <input
        v-model.number="progress"
        class="rrange"
        type="range" min="0" max="1" step="0.0005"
        :disabled="!profile || profile.time.length < 2"
        @input="draw()"
      />
      <span class="rtime">{{ (progress * (profile ? profile.time[profile.time.length - 1] : 0)).toFixed(3) }}s / {{ (profile ? profile.time[profile.time.length - 1] : 0).toFixed(3) }}s</span>
    </div>
    <div class="hint">{{ mode === 'scenic' ? '实景飞行：视角跟随火箭，尾焰/烟雾/开伞实时呈现' : '3D 空间轨迹回放（3DOF 口径：高度 + 风致漂移）· 拖拽旋转视角 · 滚轮缩放' }}</div>
  </div>
</template>

<style scoped>
.replay { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; padding: 10px; box-sizing: border-box; }
.replay-head { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.replay-modes { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
.rmode {
  padding: 4px 14px; font-size: 12px; font-weight: 600; color: var(--text-2);
  background: var(--panel); border: none; cursor: pointer; transition: background 0.12s, color 0.12s;
}
.rmode + .rmode { border-left: 1px solid var(--border); }
.rmode:hover { color: var(--text); background: var(--gray-100); }
.rmode.on { color: #fff; background: var(--primary); }
.replay-canvas {
  width: 100%; flex: 1 1 auto; min-height: 200px; border-radius: 0; border: 1px solid var(--border);
  background: #0b1630; cursor: grab; touch-action: none;
}
.replay-bar { display: flex; align-items: center; gap: 8px; }
.rbtn {
  width: 30px; height: 30px; border: 1px solid var(--border); background: var(--panel);
  border-radius: 7px; font-size: 13px; color: var(--text); cursor: pointer;
}
.rbtn:disabled { opacity: 0.4; cursor: default; }
.rbtn:not(:disabled):hover { border-color: var(--primary); color: var(--primary); }
.rrange { flex: 1; accent-color: #0a84ff; }
.rtime { font-size: 11px; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.hint { font-size: 11px; color: var(--text-3); }
</style>
