<script setup lang="ts">
// B3：仿真轨迹 3D 回放 —— 用 JS/WASM 2DOF 飞行数据驱动简化火箭沿 Z 轴上升/开伞/降落。
// 与 RocketView3D 同套伪 3D 数学（rotY 旋转 + 透视 + unit 缩放），视角可拖拽旋转、滚轮缩放。
// 口径：2DOF 数据只有高度，回放为垂直轨迹（不伪造横向运动）；事件标记取自 profile 摘要。
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
let scale = 1;
let raf = 0;
let lastTs = 0;
let dragging = false;
let lastX = 0;
let ro: ResizeObserver | null = null;

// —— 简化火箭几何（世界坐标：X 横向、Y 深度、Z 高度；火箭沿 +Z 竖直） ——
interface Pt { x: number; y: number; z: number }
interface Face { p: Pt[]; fill: string; light: number }
const ROCKET_R = 0.02;   // 简化半径（m）
const ROCKET_LEN = 0.3;  // 简化长度（m）
const FIN_N = 3;

function rocketFaces(): Face[] {
  const faces: Face[] = [];
  const r = ROCKET_R, len = ROCKET_LEN;
  const SEG = 12;
  // 机身：圆柱侧向 12 段（z 从 0 到 len）
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
  // 鼻锥：圆锥（r → 0，z len → len*1.35）
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
  // 尾翼：3 片梯形（贴底、沿 Z 延伸）
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

function lerpArr(arr: number[], t: number): number {
  if (!arr || arr.length === 0) return 0;
  if (t <= arr[0]) return arr[0];
  const n = arr.length - 1;
  if (t >= arr[n]) return arr[n];
  // arr 为等间隔采样（time 数组）
  const span = arr[n] - arr[0];
  const f = (t - arr[0]) / span * n;
  const i = Math.min(n - 1, Math.floor(f));
  const fr = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * fr;
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
  ctx.fillStyle = '#f6f9ff';
  ctx.fillRect(0, 0, w, h);

  const p = props.profile;
  const cxp = w / 2, cyp = h * 0.42;
  // 场景范围
  const maxZ = p && p.maxAltitude_m > 0 ? p.maxAltitude_m : 30;
  const unit = Math.min(w, h) * 0.36 * scale / Math.max(maxZ * 0.42, 0.001);
  const baseY = cyp + h * 0.30;

  const proj = (x: number, y: number, z: number) => {
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const x1 = x * cos - y * sin;
    const y1 = x * sin + y * cos;
    return { x: cxp + x1 * unit, y: baseY - z * unit, depth: y1 };
  };

  // 地面网格（X–Y 平面）
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(13, 92, 210, 0.10)';
  for (let i = -3; i <= 3; i++) {
    const a = proj(i * maxZ * 0.08, 0, 0), b = proj(i * maxZ * 0.08, maxZ * 0.08, 0);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    const c = proj(-maxZ * 0.24, i * maxZ * 0.08, 0), d = proj(maxZ * 0.24, i * maxZ * 0.08, 0);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
  }
  // 地面线
  const gA = proj(-maxZ * 0.28, 0, 0), gB = proj(maxZ * 0.28, 0, 0);
  ctx.strokeStyle = 'rgba(13, 92, 210, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(gA.x, gA.y); ctx.lineTo(gB.x, gB.y); ctx.stroke();

  // Z 刻度尺（高度）
  ctx.fillStyle = '#64748b';
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const zSteps = Math.min(8, Math.ceil(maxZ / 10));
  for (let i = 0; i <= zSteps; i++) {
    const z = (maxZ / zSteps) * i;
    const pt = proj(0, 0, z);
    ctx.beginPath(); ctx.moveTo(pt.x - 5, pt.y); ctx.lineTo(pt.x + 5, pt.y); ctx.stroke();
    ctx.fillText(`${Math.round(z)} m`, pt.x + 8, pt.y + 3);
  }

  if (p && p.time.length > 1) {
    // 3D 轨迹（垂直路径：沿 Z 的高度曲线按时间展开到 X，形成包络面轨迹）
    const N = p.time.length;
    const tMax = p.time[N - 1];
    ctx.lineWidth = 1.6;
    // 包络线：X 向按时间比例偏移，Z 向高度 —— 直观展示“高度随时间”
    ctx.strokeStyle = 'rgba(13, 92, 210, 0.55)';
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const f = p.time[i] / tMax;
      const pt = proj((f - 0.5) * maxZ * 0.4, 0, p.altitude[i]);
      if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    // 当前火箭位置（按 progress 插值）
    const tCur = progress.value * tMax;
    tNow.value = tCur;
    zNow.value = lerpArr(p.altitude, tCur);
    vNow.value = lerpArr(p.velocity, tCur);
    const rocketZ = zNow.value;
    const deployed = tCur >= p.timeToApogee_s && p.altitude[N - 1] < p.maxAltitude_m;

    // 火箭（简化面片，Z 从 rocketZ 起）
    const faces: Face[] = [];
    for (const f of ROCKET_FACES) {
      faces.push({ p: f.p.map((q) => ({ x: q.x, y: q.y, z: q.z + rocketZ })), fill: f.fill, light: f.light });
    }
    // 开伞：画伞面（半透明扇形）
    if (deployed) {
      const R = 0.05;
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2;
        faces.push({
          p: [
            { x: 0, y: 0, z: rocketZ + ROCKET_LEN * 1.35 },
            { x: R * Math.cos(a0), y: R * Math.sin(a0), z: rocketZ + ROCKET_LEN * 1.35 },
            { x: R * Math.cos(a1), y: R * Math.sin(a1), z: rocketZ + ROCKET_LEN * 1.35 },
          ],
          fill: '#ff7a00', light: 0.9,
        });
      }
    }
    // 画家算法排序（按深度远→近）
    const drawn = faces
      .map((f) => ({ f, d: f.p.reduce((s, q) => s + proj(q.x, q.y, q.z).depth, 0) / f.p.length }))
      .sort((a, b) => b.d - a.d);
    for (const { f } of drawn) {
      const pts = f.p.map((q) => proj(q.x, q.y, q.z));
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = f.fill;
      ctx.globalAlpha = Math.min(1, f.light);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(10, 40, 100, 0.25)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 事件标记
    ctx.textAlign = 'left';
    // 远地点（开伞点）
    const ap = proj(0, 0, p.maxAltitude_m);
    ctx.fillStyle = '#ff7a00';
    ctx.beginPath(); ctx.arc(ap.x, ap.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px -apple-system, sans-serif';
    ctx.fillStyle = '#b45309';
    ctx.fillText(`远地点 ${p.maxAltitude_m.toFixed(0)} m（t=${p.timeToApogee_s.toFixed(1)}s）`, ap.x + 8, ap.y - 4);
    // 当前数值
    ctx.fillStyle = '#0f172a';
    ctx.font = '600 12px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`t=${tCur.toFixed(1)}s  高度=${zNow.value.toFixed(0)}m  速度=${vNow.value.toFixed(1)}m/s`, w - 12, 18);
    // 状态
    ctx.textAlign = 'left';
    const state = rocketZ <= 0 ? '地面' : deployed ? '伞降' : tCur < p.timeToApogee_s ? '上升' : '滑行';
    ctx.fillStyle = deployed ? '#ff7a00' : '#0a84ff';
    ctx.fillText(`状态：${state}${deployed ? '（已开伞）' : ''}`, 12, 18);
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

function onDown(e: MouseEvent): void { dragging = true; lastX = e.clientX; }
function onMove(e: MouseEvent): void {
  if (!dragging) return;
  rotY += (e.clientX - lastX) * 0.008;
  lastX = e.clientX;
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
    // Tab 切换（v-show）后尺寸从 0 变为实际值，自动重绘
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
    <div class="hint">拖拽旋转视角 · 滚轮缩放 · 回放数据为 2DOF 口径（垂直轨迹）</div>
  </div>
</template>

<style scoped>
.replay { display: flex; flex-direction: column; gap: 8px; }
.replay-canvas {
  width: 100%; height: 260px; border-radius: 8px; border: 1px solid var(--border);
  background: #f6f9ff; cursor: grab; touch-action: none;
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
