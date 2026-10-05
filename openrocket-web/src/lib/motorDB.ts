// OpenRocket motor-database（thrustcurve.org 实测数据）接入层
// 数据由 scripts/fetch-motor-db.ts 生成（git clone openrocket/motor-database → 解析 → 本目录 JSON）
// 关联链：文件名 hash(simfileId) → simfile_to_motor.json → motorId → motors_metadata.json

import type { MotorSpec } from './engines';
import curatedJson from './motorDB/curated.json';

/** 全量索引条目（index.json 压缩字段，不含曲线；曲线按需从 GitHub raw 加载） */
export interface MotorIndexEntry {
  id: string;        // motorId
  m: string;         // manufacturer
  d: string;         // designation
  c: string | null;  // commonName
  cl: string;        // impulseClass
  dia: number;       // 直径 mm
  len: number;       // 长度 mm
  t: string;         // type: single-use / reload / plugged
  at: number;        // 平均推力 N
  mt: number;        // 峰值推力 N
  ti: number;        // 总冲 N·s
  bt: number;        // 燃时 s
  w0: number;        // 初始重量 g
  w1: number;        // 推进剂重量 g
  del: string | null;// delays（"P" / "0" / "3,5,7"）
  ci: string | null; // caseInfo
  pi: string | null; // propInfo
  sp: boolean;       // sparky
  files: { i: string; f: string; s: string; p: string }[]; // 曲线文件（simfileId/format/source/path）
}

/** 精选实测发动机（含曲线，并入配置/仿真下拉） */
export const CURATED_MOTORS = curatedJson as MotorSpec[];

/** 管理页按需加载全量索引（code-split，不进主包） */
export async function loadMotorDBIndex(): Promise<MotorIndexEntry[]> {
  const mod = await import('./motorDB/index.json');
  return mod.default as MotorIndexEntry[];
}

/** 按路径构造 GitHub raw 下载 URL（motor-database main 分支） */
export function motorRawUrl(path: string): string {
  return `https://raw.githubusercontent.com/openrocket/motor-database/main/${path}`;
}

/** delays 字段 → 数值延迟列表（"3,5,7" → [3,5,7]；"P"/空 → []） */
export function delaysToList(del: string | null): number[] {
  if (!del) return [];
  const m = del.match(/\d+(?:,\s*\d+)*/);
  return m ? m[0].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n)) : [];
}

/** 厂商去重排序列表（筛选用） */
export function uniqueManufacturers(index: MotorIndexEntry[]): string[] {
  return [...new Set(index.map((e) => e.m))].sort((a, b) => a.localeCompare(b));
}

/** 冲量级排序列表（筛选用） */
export const IMPULSE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'];
