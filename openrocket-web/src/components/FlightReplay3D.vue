<script setup lang="ts">
// B3：仿真轨迹 3D 回放 —— 由 JS 引擎的 3DOF 轨迹数据（trailX/trailY/altitude）驱动真实空间飞行：
// 火箭沿空间轨迹移动、姿态跟随速度矢量（上升段上仰、伞降段下坠），地面网格/发射台/轨迹投影/事件标记/实时 HUD。
// 与 RocketView3D 同套伪 3D 数学（rotY/rotX 旋转 + 透视 + unit 缩放），视角可拖拽旋转、滚轮缩放。
// 口径：无 trailX/trailY（如 WASM 引擎输出）时回退垂直轨迹（仅高度）。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FlightProfile } from '../lib/types';

const props = defineProps<{ profile: FlightProfile | null }>();

const canvas = ref<HTMLCanvasElement | null>(null);
const playing = ref(false);
const progress = ref(0); // 0..1
const tNow = ref(0);
const zNow = ref(0);
const vNow = ref(0);

let rotY = 0.55;
let rotX = 0.35;
let scale = 1;
let raf = 0;
let lastTs = 0;
let dragging = false;
let lastX = 0;
let lastY = 0;
let ro: ResizeObserver | null = null;

// —— 简化火箭几何（本体局部坐标：长轴沿 +Z，鼻锥在 +Z 端） ——
interface Pt { x: number; y: number; z: number }
interface Face { p: Pt[]; fill: string; light: number }
const ROCKET_R = 0.02;   // 简化半径（m）
const ROCKET_LEN = 0.3;  // 简化长度（m）
const FIN_N = 3;

function rocketFaces(): Face[] {
  const faces: Face[] = [];
  const r = ROCKET_R, len = ROCKET_LEN;
  const SEG = 10;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    faces.push({
      p: [
        { x: r * c0, y: r * s0, z: 0 },
        { x: r * c1, y: r * s1, z: 0 },
        { x: r * c1, y: r * s1, z: len },
      ],
      fill: '#2f6fed', light: 0.9 + 0.1 * ((c0 + c1) / 2),
    });
    faces.push({
      p: [
        { x: r * c0, y: r * s0, z: 0 },
        { x: r * c1, y: r * s1, z: len },
        { x: r * c0, y: r * s0, z: len },
      ],
      fill: '#2f6fed', light: 0.9 + 0.1 * ((c0 + c1) / 2),
    });
  }
  const tipZ = len * 1.35;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    faces.push({
      p: [
        { x: r * c0, y: r * s0, z: len },
        { x: r * c1, y: r * s1, z: len },
        { x: 0, y: 0, z: tipZ },
      ],
      fill: '#1f56c8', light: 1.0,
    });
  }
  const fh = 0.05, fr = 0.035;
  for (let i = 0; i < FIN_N; i++) {
    const ang = (i / FIN_N) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    const dirX = c, dirY = s;
    faces.push({
      p: [
        { x: r * c, y: r * s, z: 0.01 },
        { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 },
        { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 + fh },
      ],
      fill: '#3b82f6', light: 0.95,
    });
    faces.push({
      p: [
        { x: r * c, y: r * s, z: 0.01 },
        { x: r * c + dirX * fr, y: r * s + dirY * fr, z: 0.01 + fh },
        { x: r * c, y: r * s, z: 0.01 + fh },
      ],
      fill: '#3b82f6', light: 0.95,
    });
  }
  return faces;
}
const ROCKET_FACES = rocketFaces();

/** 把局部 +Z 长轴旋转到 dir（速度矢量）方向：先绕 Y 抬起 pitch，再绕 Z 转到水平方位 yaw */
function orient(faces: Face[], dir: { x: number; y: number; z: number }): Face[] {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-9) return faces.map((f) => ({ p: f.p.map((q) => ({ ...q })), fill: f.fill, light: f.light }));
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
  const h = Math.hypot(dx, dy);
  // pitch = asin(dz)（长轴与水平面夹角）；sP/cPv 即 sin/cos(pitch)，yaw 由水平分量方位确定
  const sP = dz, cPv = h > 1e-9 ? h : 1;
  const sY = h > 1e-9 ? dy / h : 0, cY = h > 1e-9 ? dx / h : 1;
  return faces.map((f) => ({
    p: f.p.map((q) => {
      // 绕 Y（pitch）：x2 = x·cP + z·sP；z2 = -x·sP + z·cP
      const x2 = q.x * cPv + q.z * sP;
      const y2 = q.y;
      const z2 = -q.x * sP + q.z * cPv;
      // 绕 Z（yaw）
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
/** 按 profile 时间 t（秒）插值采样序列 */
function lerpTime(arr: number[] | undefined, t: number, t0: number, t1: number): number {
  if (!arr || arr.length === 0) return 0;
  const f = (t - t0) / (t1 - t0);
  return lerpArr(arr, f);
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
  ctx.fillStyle = '#0b1630';
  ctx.fillRect(0, 0, w, h);

  const p = props.profile;
  const cxp = w / 2, cyp = h * 0.48;
  const maxZ = p && p.maxAltitude_m > 0 ? p.maxAltitude_m : 30;
  // 水平范围（轨迹包络 + 下限，保证至少能看到发射台区域）
  let hSpan = 1;
  if (p && p.trailX && p.trailY) {
    for (let i = 0; i < p.trailX.length; i++) {
      hSpan = Math.max(hSpan, Math.abs(p.trailX[i] ?? 0), Math.abs(p.trailY[i] ?? 0));
    }
  }
  const sceneMax = Math.max(maxZ * 0.55, hSpan * 0.75, 6);
  const unit = Math.min(w, h) * 0.38 * scale / Math.max(sceneMax, 0.001);

  const proj = (x: number, y: number, z: number) => {
    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const cP = Math.cos(rotX), sP = Math.sin(rotX);
    const x1 = x * cY - y * sY;
    const y1 = x * sY + y * cY;
    // 绕 X 轴俯仰（rotX>0 时从上方看）
    const y2 = y1 * cP - z * sP;
    const z2 = y1 * sP + z * cP;
    return { x: cxp + x1 * unit, y: cyp - z2 * unit, depth: y2 };
  };

  // 地面网格（X–Y 平面，随视角旋转）
  const gridN = 7;
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.10)';
  const gMax = Math.max(hSpan * 1.6, 5);
  for (let i = -gridN; i <= gridN; i++) {
    const g = (i / gridN) * gMax;
    const a = proj(g, -gMax, 0), b = proj(g, gMax, 0);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = proj(-gMax, g, 0), d = proj(gMax, g, 0);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  // 地面边线
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
  ctx.lineWidth = 1.5;
  const gA = proj(-gMax, -gMax, 0), gB = proj(gMax, -gMax, 0), gC = proj(gMax, gMax, 0), gD = proj(-gMax, gMax, 0);
  ctx.beginPath(); ctx.moveTo(gA.x, gA.y); ctx.lineTo(gB.x, gB.y); ctx.lineTo(gC.x, gC.y); ctx.lineTo(gD.x, gD.y); ctx.closePath(); ctx.stroke();
  // 发射台（原点小平台）
  const padR = Math.max(0.5, Math.min(2, hSpan * 0.2));
  ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
  const padPts = [proj(-padR, -padR, 0), proj(padR, -padR, 0), proj(padR, padR, 0), proj(-padR, padR, 0)];
  ctx.beginPath(); ctx.moveTo(padPts[0].x, padPts[0].y);
  for (let i = 1; i < padPts.length; i++) ctx.lineTo(padPts[i].x, padPts[i].y);
  ctx.closePath(); ctx.fill();

  // Z 刻度尺（高度，置于场景右侧，避开轨迹）
  ctx.fillStyle = '#64748b';
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

    // —— 完整轨迹曲线（空间 3D）——
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(56, 130, 246, 0.35)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const pt = proj(hasTrail ? (tx[i] ?? 0) : 0, hasTrail ? (ty[i] ?? 0) : 0, p.altitude[i]);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    // 轨迹地面投影（虚线）
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.25)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const pt = proj(hasTrail ? (tx[i] ?? 0) : 0, hasTrail ? (ty[i] ?? 0) : 0, 0);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // —— 当前状态（按 progress 插值）——
    const tCur = progress.value * tMax;
    tNow.value = tCur;
    zNow.value = lerpTime(p.altitude, tCur, t0, tMax);
    vNow.value = lerpTime(p.velocity, tCur, t0, tMax);
    const f = (tCur - t0) / (tMax - t0);
    const iF = Math.max(0, Math.min(N - 1, Math.round(f * (N - 1))));
    const xCur = hasTrail ? lerpArr(tx, f) : 0;
    const yCur = hasTrail ? lerpArr(ty, f) : 0;
    // 速度矢量（轨迹差分 + 垂直速度）
    const ip = Math.max(0, iF - 2), in_ = Math.min(N - 1, iF + 2);
    const dtS = Math.max(1e-6, tMax * (in_ - ip) / (N - 1));
    const dvx = hasTrail ? (tx[in_] - tx[ip]) / dtS : 0;
    const dvy = hasTrail ? (ty[in_] - ty[ip]) / dtS : 0;
    const dvz = (p.velocity[iF] ?? 0);
    const deployed = tCur >= p.timeToApogee_s && zNow.value < p.maxAltitude_m * 0.99 && p.altitude[N - 1] < p.maxAltitude_m;

    // 火箭：局部面片定向到速度矢量 + 平移
    const faces: Face[] = [];
    const oriented = orient(ROCKET_FACES, { x: dvx, y: dvy, z: dvz });
    for (const f2 of oriented) {
      faces.push({ p: f2.p.map((q) => ({ x: q.x + xCur, y: q.y + yCur, z: q.z + zNow.value })), fill: f2.fill, light: f2.light });
    }
    // 开伞：伞盘画在火箭长轴顶端（局部 +Z 端），随姿态定向
    if (deployed) {
      const R = 0.055;
      const canopy: Face[] = [];
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        canopy.push({
          p: [
            { x: 0, y: 0, z: ROCKET_LEN * 1.6 },
            { x: R * Math.cos(a0), y: R * Math.sin(a0), z: ROCKET_LEN * 1.6 },
            { x: R * Math.cos(a1), y: R * Math.sin(a1), z: ROCKET_LEN * 1.6 },
          ],
          fill: '#ff7a00', light: 0.9,
        });
      }
      const oCanopy = orient(canopy, { x: dvx, y: dvy, z: dvz });
      for (const f3 of oCanopy) {
        faces.push({ p: f3.p.map((q) => ({ x: q.x + xCur, y: q.y + yCur, z: q.z + zNow.value })), fill: f3.fill, light: f3.light });
      }
    }
    // 画家算法
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
      ctx.globalAlpha = Math.min(1, f4.light);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(10, 40, 100, 0.25)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // —— 事件标记：远地点 / 开伞 / 着陆 ——
    const mark = (idx: number, color: string, label: string) => {
      const pt = proj(hasTrail ? (tx[idx] ?? 0) : 0, hasTrail ? (ty[idx] ?? 0) : 0, p.altitude[idx]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(label, pt.x + 7, pt.y - 4);
    };
    // 远地点索引
    let apI = 0;
    for (let i = 1; i < N; i++) if (p.altitude[i] > p.altitude[apI]) apI = i;
    mark(apI, '#ff7a00', `远地点 ${p.maxAltitude_m.toFixed(0)} m（t=${p.timeToApogee_s.toFixed(1)}s）`);
    mark(N - 1, '#22c55e', `着陆（t=${tMax.toFixed(1)}s）`);

    // —— HUD（实时数值）——
    const hDist = Math.hypot(xCur, yCur);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`t=${tCur.toFixed(1)}s  高度=${zNow.value.toFixed(0)}m  速度=${vNow.value.toFixed(1)}m/s  漂移=${hDist.toFixed(1)}m`, w - 12, 20);
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

function tick(ts: number): void {
  const p = props.profile;
  if (p && p.time.length > 1) {
    const dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    const tMax = p.time[p.time.length - 1];
    progress.value = Math.min(1, progress.value + dt / tMax);
    if (progress.value >= 1) playing.value = false;
  }
  draw();
  if (playing.value) raf = requestAnimationFrame(tick);
}

function togglePlay(): void {
  if (!props.profile || props.profile.time.length < 2) return;
  playing.value = !playing.value;
  lastTs = 0;
  if (playing.value) raf = requestAnimationFrame(tick);
}
function reset(): void {
  playing.value = false;
  cancelAnimationFrame(raf);
  progress.value = 0;
  draw();
}

function onDown(e: MouseEvent): void { dragging = true; lastX = e.clientX; lastY = e.clientY; }
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
      <span class="rtime">{{ (progress * (profile ? profile.time[profile.time.length - 1] : 0)).toFixed(1) }}s / {{ (profile ? profile.time[profile.time.length - 1] : 0).toFixed(1) }}s</span>
    </div>
    <div class="hint">3D 空间轨迹回放（3DOF 口径：高度 + 风致漂移）· 拖拽旋转视角 · 滚轮缩放</div>
  </div>
</template>

<style scoped>
.replay { display: flex; flex-direction: column; gap: 8px; }
.replay-canvas {
  width: 100%; height: 260px; border-radius: 8px; border: 1px solid var(--border);
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
